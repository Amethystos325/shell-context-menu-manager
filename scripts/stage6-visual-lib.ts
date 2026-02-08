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
  };
}

interface ExtractOptions {
  lang?: string;
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

const EDGE_TOKEN_ALLOWLIST = new Set([
  "go",
  "to",
  "by",
  "as",
  "in",
  "on",
  "of",
]);

function normalizeTitle(value: string): string {
  return value.trim().toLowerCase();
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

function cleanLine(raw: string): { title: string; submenu: boolean } | null {
  const compact = raw.replace(/\s+/g, " ").trim();
  if (!compact) {
    return null;
  }

  const submenu = /[>›»]\s*$/.test(compact);
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
    submenu: submenu || KNOWN_SUBMENU_TITLES.has(normalizeTitle(text)),
  };
}

function parseTextToEntries(text: string, confidence: number): VisualMenuEntry[] {
  const rows = text.split(/\r?\n/);
  const deduped = new Set<string>();
  const entries: VisualMenuEntry[] = [];
  let blankGap = 0;

  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    const raw = rows[rowIndex].trim();
    if (!raw) {
      blankGap += 1;
      continue;
    }
    const cleaned = cleanLine(raw);
    if (!cleaned) {
      continue;
    }
    const key = normalizeTitle(cleaned.title);
    if (!key || deduped.has(key)) {
      blankGap = 0;
      continue;
    }
    deduped.add(key);
    entries.push({
      title: cleaned.title,
      submenu: cleaned.submenu,
      disabled: undefined,
      separatorBefore: blankGap > 0,
      confidence: Number(confidence.toFixed(2)),
      bbox: { x: 0, y: entries.length, width: 0, height: 1 },
    });
    blankGap = 0;
  }

  return entries;
}

async function createOcrWorker(lang: string): Promise<Worker> {
  const worker = await createWorker(lang, 1, {
    cachePath: path.resolve(process.cwd(), ".cache", "tesseract"),
    logger: () => {
      // quiet
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

  const enhancedBuffer = await source
    .grayscale()
    .normalize()
    .sharpen({ sigma: 1.1 })
    .resize({
      width: Math.floor(metadata.width * 1.5),
      height: Math.floor(metadata.height * 1.5),
      kernel: "cubic",
    })
    .png()
    .toBuffer();

  const worker = await createOcrWorker(options.lang ?? "eng");
  try {
    const ocr = await worker.recognize(enhancedBuffer);
    const confidence = Number(ocr.data.confidence ?? 0);
    const entries = parseTextToEntries(String(ocr.data.text ?? ""), confidence);
    return {
      imagePath: resolvedPath,
      width: metadata.width,
      height: metadata.height,
      entries,
      debug: {
        lineCount: entries.length,
        meanOcrConfidence: Number(confidence.toFixed(2)),
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
