import path from "node:path";
import { writeFile } from "node:fs/promises";
import sharp from "sharp";
import { createWorker, type Worker } from "tesseract.js";

export interface VisualMenuEntry {
  title: string;
  submenu?: boolean;
  disabled?: boolean;
  separatorBefore?: boolean;
  confidence: number;
  bbox: { x: number; y: number; width: number; height: number };
}

export interface VisualExtractResult {
  imagePath: string;
  width: number;
  height: number;
  entries: VisualMenuEntry[];
  debug: {
    lineCount: number;
    meanOcrConfidence: number;
    rowBandCount: number;
    medianLineGap: number;
    submenuThreshold: number;
    disabledThreshold: number;
  };
}

interface ExtractOptions {
  lang?: string;
}

interface ParsedLine {
  title: string;
  submenuHint: boolean;
}

interface PixelFrame {
  width: number;
  height: number;
  channels: number;
  data: Buffer;
}

interface RowBand {
  top: number;
  bottom: number;
  score: number;
}

const KNOWN_SUBMENU_TITLES = new Set([
  "view",
  "sort by",
  "terminal",
  "file manage",
  "go to",
  "new",
]);

const TITLE_FIXUPS: Array<{ pattern: RegExp; title: string }> = [
  { pattern: /^goto$/i, title: "Go To" },
  { pattern: /^sortby$/i, title: "Sort by" },
  { pattern: /^nvidia contr/i, title: "NVIDIA Control Panel" },
];

const EDGE_TOKEN_ALLOWLIST = new Set(["go", "to", "by", "as", "in", "on", "of"]);

function normalizeTitle(value: string): string {
  return value.trim().toLowerCase();
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function average(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function median(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }
  return sorted[mid];
}

function stddev(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  const mean = average(values);
  const variance = average(values.map((value) => (value - mean) ** 2));
  return Math.sqrt(variance);
}

function extractCliArgs(argv: string[]): { imagePath: string; outPath?: string; lang: string } {
  let imagePath = "";
  let outPath = "";
  let lang = "eng";

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--image") {
      imagePath = argv[index + 1] ?? "";
      index += 1;
      continue;
    }
    if (token === "--out") {
      outPath = argv[index + 1] ?? "";
      index += 1;
      continue;
    }
    if (token === "--lang") {
      lang = argv[index + 1] ?? "eng";
      index += 1;
      continue;
    }
  }

  if (!imagePath.trim()) {
    throw new Error("Missing --image <path>");
  }

  return {
    imagePath: path.resolve(process.cwd(), imagePath),
    outPath: outPath.trim() ? path.resolve(process.cwd(), outPath) : undefined,
    lang: lang.trim() || "eng",
  };
}

function cleanLine(raw: string): ParsedLine | null {
  const compact = raw.replace(/\s+/g, " ").trim();
  if (!compact) {
    return null;
  }

  const submenuHint = /[>›»]\s*$/.test(compact);
  let text = compact.replace(/[>›»|]+\s*$/g, "").trim();
  if (!text) {
    return null;
  }

  text = text
    .replace(/^[^A-Za-z0-9\u4E00-\u9FFF]+/g, "")
    .replace(/[^A-Za-z0-9\u4E00-\u9FFF]+$/g, "")
    .trim();
  if (!text) {
    return null;
  }

  const tokens = text.split(/\s+/).filter(Boolean);

  const normalizeToken = (token: string): string =>
    token.replace(/[^\p{L}\p{N}\u4E00-\u9FFF]/gu, "");
  const isEdgeNoiseToken = (token: string): boolean => {
    const core = normalizeToken(token);
    if (!core) {
      return true;
    }
    if (core.length > 2) {
      return false;
    }
    return !EDGE_TOKEN_ALLOWLIST.has(core.toLowerCase());
  };

  while (tokens.length > 1 && isEdgeNoiseToken(tokens[0])) {
    tokens.shift();
  }
  while (tokens.length > 1 && isEdgeNoiseToken(tokens[tokens.length - 1])) {
    tokens.pop();
  }

  text = tokens.join(" ").trim();
  if (!text || text.length <= 1) {
    return null;
  }

  for (const fixup of TITLE_FIXUPS) {
    if (fixup.pattern.test(text)) {
      text = fixup.title;
      break;
    }
  }

  return {
    title: text,
    submenuHint: submenuHint || KNOWN_SUBMENU_TITLES.has(normalizeTitle(text)),
  };
}

function parseTextToLines(text: string): ParsedLine[] {
  const rows = text.split(/\r?\n/);
  const deduped = new Set<string>();
  const lines: ParsedLine[] = [];

  for (const row of rows) {
    const cleaned = cleanLine(row.trim());
    if (!cleaned) {
      continue;
    }
    const key = normalizeTitle(cleaned.title);
    if (!key || deduped.has(key)) {
      continue;
    }
    deduped.add(key);
    lines.push(cleaned);
  }

  return lines;
}

function getLuma(frame: PixelFrame, x: number, y: number): number {
  const xx = clamp(Math.floor(x), 0, frame.width - 1);
  const yy = clamp(Math.floor(y), 0, frame.height - 1);
  const base = (yy * frame.width + xx) * frame.channels;
  const r = frame.data[base] ?? 0;
  if (frame.channels === 1) {
    return r;
  }
  const g = frame.data[base + 1] ?? r;
  const b = frame.data[base + 2] ?? r;
  return Math.round(0.299 * r + 0.587 * g + 0.114 * b);
}

function smoothSignal(signal: number[], windowRadius: number): number[] {
  if (signal.length === 0) {
    return [];
  }
  const output: number[] = new Array(signal.length).fill(0);
  for (let index = 0; index < signal.length; index += 1) {
    const start = Math.max(0, index - windowRadius);
    const end = Math.min(signal.length - 1, index + windowRadius);
    let sum = 0;
    let count = 0;
    for (let cursor = start; cursor <= end; cursor += 1) {
      sum += signal[cursor];
      count += 1;
    }
    output[index] = count > 0 ? sum / count : 0;
  }
  return output;
}

function buildRowSignal(frame: PixelFrame): number[] {
  const xStart = Math.floor(frame.width * 0.08);
  const xEnd = Math.floor(frame.width * 0.9);
  const signal: number[] = new Array(frame.height).fill(0);
  for (let y = 0; y < frame.height; y += 1) {
    let brightCount = 0;
    for (let x = xStart; x < xEnd; x += 1) {
      if (getLuma(frame, x, y) >= 165) {
        brightCount += 1;
      }
    }
    signal[y] = brightCount;
  }
  return smoothSignal(signal, 2);
}

function createSyntheticBands(lineCount: number, frameHeight: number): RowBand[] {
  if (lineCount <= 0) {
    return [];
  }
  const topPadding = Math.floor(frameHeight * 0.05);
  const bottomPadding = Math.floor(frameHeight * 0.05);
  const usable = Math.max(10, frameHeight - topPadding - bottomPadding);
  const step = usable / Math.max(1, lineCount);
  const bands: RowBand[] = [];
  for (let index = 0; index < lineCount; index += 1) {
    const center = topPadding + step * (index + 0.5);
    const top = clamp(Math.round(center - step * 0.24), 0, frameHeight - 1);
    const bottom = clamp(Math.round(center + step * 0.24), top, frameHeight - 1);
    bands.push({ top, bottom, score: 0 });
  }
  return bands;
}

function pickPeakCenters(signal: number[], lineCount: number): number[] {
  if (lineCount <= 0 || signal.length === 0) {
    return [];
  }
  const smoothed = smoothSignal(signal, 3);
  const base = average(smoothed);
  const deviation = stddev(smoothed);
  const minPeak = base + deviation * 0.6;

  const candidates: Array<{ y: number; value: number }> = [];
  for (let y = 1; y < smoothed.length - 1; y += 1) {
    const current = smoothed[y];
    if (current < minPeak) {
      continue;
    }
    if (current >= smoothed[y - 1] && current > smoothed[y + 1]) {
      candidates.push({ y, value: current });
    }
  }

  const tryPick = (minDistance: number): number[] => {
    const byPower = [...candidates].sort((a, b) => b.value - a.value);
    const chosen: number[] = [];
    for (const peak of byPower) {
      if (chosen.some((value) => Math.abs(value - peak.y) < minDistance)) {
        continue;
      }
      chosen.push(peak.y);
      if (chosen.length >= lineCount) {
        break;
      }
    }
    return chosen.sort((a, b) => a - b);
  };

  const initialDistance = Math.max(12, Math.floor(signal.length / Math.max(8, lineCount * 2.6)));
  let selected = tryPick(initialDistance);
  if (selected.length === 0) {
    selected = tryPick(Math.max(8, Math.floor(initialDistance * 0.7)));
  }

  if (selected.length === 0) {
    return [];
  }
  if (selected.length > lineCount) {
    const reduced: number[] = [];
    for (let index = 0; index < lineCount; index += 1) {
      const ratio = lineCount === 1 ? 0 : index / (lineCount - 1);
      const candidateIndex = Math.round(ratio * (selected.length - 1));
      reduced.push(selected[candidateIndex]);
    }
    return reduced;
  }
  if (selected.length < lineCount) {
    const first = selected[0];
    const last = selected[selected.length - 1];
    const fallback: number[] = [];
    for (let index = 0; index < lineCount; index += 1) {
      const ratio = lineCount === 1 ? 0 : index / (lineCount - 1);
      fallback.push(Math.round(first + (last - first) * ratio));
    }
    return fallback;
  }
  return selected;
}

function buildBandsFromCenters(
  centers: number[],
  frameHeight: number,
): RowBand[] {
  if (centers.length === 0) {
    return [];
  }
  const gaps: number[] = [];
  for (let index = 1; index < centers.length; index += 1) {
    gaps.push(centers[index] - centers[index - 1]);
  }
  const medianGap = median(gaps.filter((gap) => gap > 0));
  const half = clamp(Math.round((medianGap || 26) * 0.24), 8, 20);
  return centers.map((center) => {
    const top = clamp(center - half, 0, frameHeight - 1);
    const bottom = clamp(center + half, top, frameHeight - 1);
    return { top, bottom, score: 0 };
  });
}

function sampleBrightMean(
  frame: PixelFrame,
  xStartRatio: number,
  xEndRatio: number,
  top: number,
  bottom: number,
): number {
  const xStart = clamp(Math.floor(frame.width * xStartRatio), 0, frame.width - 1);
  const xEnd = clamp(Math.floor(frame.width * xEndRatio), xStart + 1, frame.width);
  const yStart = clamp(top, 0, frame.height - 1);
  const yEnd = clamp(bottom, yStart + 1, frame.height);

  const values: number[] = [];
  for (let y = yStart; y < yEnd; y += 1) {
    for (let x = xStart; x < xEnd; x += 1) {
      values.push(getLuma(frame, x, y));
    }
  }
  if (values.length === 0) {
    return 0;
  }

  values.sort((a, b) => b - a);
  const topCount = Math.max(1, Math.floor(values.length * 0.05));
  return average(values.slice(0, topCount));
}

function sampleBrightDensity(
  frame: PixelFrame,
  xStartRatio: number,
  xEndRatio: number,
  top: number,
  bottom: number,
  threshold: number,
): number {
  const xStart = clamp(Math.floor(frame.width * xStartRatio), 0, frame.width - 1);
  const xEnd = clamp(Math.floor(frame.width * xEndRatio), xStart + 1, frame.width);
  const yStart = clamp(top, 0, frame.height - 1);
  const yEnd = clamp(bottom, yStart + 1, frame.height);

  let bright = 0;
  let total = 0;
  for (let y = yStart; y < yEnd; y += 1) {
    for (let x = xStart; x < xEnd; x += 1) {
      if (getLuma(frame, x, y) >= threshold) {
        bright += 1;
      }
      total += 1;
    }
  }
  return total > 0 ? bright / total : 0;
}

function detectHorizontalRule(
  frame: PixelFrame,
  fromY: number,
  toY: number,
): boolean {
  const top = clamp(fromY, 0, frame.height - 1);
  const bottom = clamp(toY, top, frame.height - 1);
  if (bottom - top < 2) {
    return false;
  }

  const xStart = Math.floor(frame.width * 0.02);
  const xEnd = Math.floor(frame.width * 0.98);
  const rowMeans: number[] = [];
  for (let y = top; y <= bottom; y += 1) {
    let sum = 0;
    let count = 0;
    for (let x = xStart; x < xEnd; x += 1) {
      sum += getLuma(frame, x, y);
      count += 1;
    }
    rowMeans.push(count > 0 ? sum / count : 0);
  }

  const peak = Math.max(...rowMeans);
  const base = average(rowMeans);
  return peak > base + 12 && peak > 70;
}

async function createOcrWorker(lang: string): Promise<Worker> {
  const worker = await createWorker(lang, 1, {
    cachePath: path.resolve(process.cwd(), ".cache", "tesseract"),
    logger: () => {
      // Keep OCR quiet by default.
    },
  });
  await worker.setParameters({
    preserve_interword_spaces: "1",
    tessedit_pageseg_mode: "6",
  });
  return worker;
}

export async function extractMenuFromScreenshot(
  imagePath: string,
  options: ExtractOptions = {},
): Promise<VisualExtractResult> {
  const resolvedPath = path.resolve(imagePath);
  const source = sharp(resolvedPath);
  const metadata = await source.metadata();
  if (!metadata.width || !metadata.height) {
    throw new Error(`Failed to read image metadata: ${resolvedPath}`);
  }

  const resizeWidth = Math.max(1, Math.floor(metadata.width * 1.5));
  const resizeHeight = Math.max(1, Math.floor(metadata.height * 1.5));
  const enhanced = source
    .grayscale()
    .normalize()
    .sharpen({ sigma: 1.1 })
    .resize({ width: resizeWidth, height: resizeHeight, kernel: "cubic" });

  const [pngBuffer, rawObject] = await Promise.all([
    enhanced.clone().png().toBuffer(),
    enhanced.clone().raw().toBuffer({ resolveWithObject: true }),
  ]);

  const frame: PixelFrame = {
    width: rawObject.info.width,
    height: rawObject.info.height,
    channels: rawObject.info.channels,
    data: rawObject.data,
  };

  const worker = await createOcrWorker(options.lang ?? "eng");
  try {
    const ocr = await worker.recognize(pngBuffer);
    const confidence = Number(ocr.data.confidence ?? 0);
    const parsedLines = parseTextToLines(String(ocr.data.text ?? ""));
    const rowSignal = buildRowSignal(frame);
    let peakCenters = pickPeakCenters(rowSignal, parsedLines.length);
    if (peakCenters.length > 0) {
      const firstRatio = peakCenters[0] / Math.max(1, frame.height);
      const lastRatio = peakCenters[peakCenters.length - 1] / Math.max(1, frame.height);
      const looksMisaligned = firstRatio > 0.14 || lastRatio < 0.78;
      if (looksMisaligned) {
        peakCenters = [];
      }
    }
    const alignedBands =
      peakCenters.length > 0
        ? buildBandsFromCenters(peakCenters, frame.height)
        : createSyntheticBands(parsedLines.length, frame.height);

    const lineGaps: number[] = [];
    for (let index = 1; index < alignedBands.length; index += 1) {
      const prevCenter = (alignedBands[index - 1].top + alignedBands[index - 1].bottom) / 2;
      const nextCenter = (alignedBands[index].top + alignedBands[index].bottom) / 2;
      const gap = nextCenter - prevCenter;
      if (gap > 0) {
        lineGaps.push(gap);
      }
    }
    const medianLineGap = median(lineGaps);

    const arrowDensities = alignedBands.map((band) =>
      sampleBrightDensity(
        frame,
        0.955,
        0.99,
        band.top - 2,
        band.bottom + 2,
        185,
      ),
    );
    const submenuThreshold = Math.max(
      0.02,
      median(arrowDensities) + stddev(arrowDensities) * 1.8,
    );

    const textBrightness = alignedBands.map((band) =>
      sampleBrightMean(frame, 0.14, 0.84, band.top - 2, band.bottom + 2),
    );
    const medianTextBrightness = median(textBrightness);
    const brightnessStddev = stddev(textBrightness);
    const disabledThreshold = Math.max(0, medianTextBrightness - brightnessStddev * 1.65);
    const hasDisabledOutlier =
      medianTextBrightness > 0 &&
      textBrightness.some((value) => value < medianTextBrightness * 0.9) &&
      brightnessStddev > 1;

    const entries: VisualMenuEntry[] = parsedLines.map((line, index) => {
      const band = alignedBands[index] ?? {
        top: Math.floor((frame.height / Math.max(1, parsedLines.length)) * index),
        bottom: Math.floor((frame.height / Math.max(1, parsedLines.length)) * (index + 1)),
        score: 0,
      };
      const prev = index > 0 ? alignedBands[index - 1] : undefined;
      const gapFromPrevious = prev
        ? band.top - prev.bottom
        : 0;
      const separatorByGap =
        Boolean(prev) && medianLineGap > 0 && gapFromPrevious > medianLineGap * 1.3;
      const separatorByRule =
        Boolean(prev) &&
        gapFromPrevious > medianLineGap * 0.75 &&
        detectHorizontalRule(frame, prev.bottom + 1, band.top - 1);
      const arrowDensity = arrowDensities[index] ?? 0;
      const submenu = line.submenuHint || arrowDensity >= submenuThreshold;
      const brightness = textBrightness[index] ?? 0;
      const disabled = hasDisabledOutlier && brightness <= disabledThreshold ? true : undefined;

      return {
        title: line.title,
        submenu,
        disabled,
        separatorBefore: separatorByGap || separatorByRule,
        confidence: Number(confidence.toFixed(2)),
        bbox: {
          x: Math.floor(frame.width * 0.08),
          y: band.top,
          width: Math.floor(frame.width * 0.84),
          height: Math.max(1, band.bottom - band.top + 1),
        },
      };
    });

    return {
      imagePath: resolvedPath,
      width: metadata.width,
      height: metadata.height,
      entries,
      debug: {
        lineCount: entries.length,
        meanOcrConfidence: Number(confidence.toFixed(2)),
        rowBandCount: peakCenters.length,
        medianLineGap: Number(medianLineGap.toFixed(2)),
        submenuThreshold: Number(submenuThreshold.toFixed(4)),
        disabledThreshold: Number(disabledThreshold.toFixed(2)),
      },
    };
  } finally {
    await worker.terminate();
  }
}

export async function runVisualExtractCli(argv: string[]): Promise<void> {
  const args = extractCliArgs(argv);
  const result = await extractMenuFromScreenshot(args.imagePath, { lang: args.lang });
  const output = JSON.stringify(result, null, 2);
  if (args.outPath) {
    await writeFile(args.outPath, output, "utf-8");
  }
  console.log(output);
}
