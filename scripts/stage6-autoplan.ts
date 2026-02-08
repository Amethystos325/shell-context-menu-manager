import path from "node:path";
import { spawnSync } from "node:child_process";

interface CliArgs {
  imagePath: string;
  baselinePath: string;
  samplePath: string;
  shiftKey: boolean;
  jsonOnly: boolean;
}

interface VisualDiffPayload {
  ocr: {
    meanOcrConfidence: number;
    lineCount: number;
  };
  summary: {
    missingTitles: string[];
    extraTitles: string[];
    orderMismatches: Array<{ title: string; expectedIndex: number; actualIndex: number }>;
    submenuMismatches: Array<{ title: string; expectedSubmenu: boolean; actualSubmenu: boolean }>;
    disabledMismatches: Array<{ title: string; expectedDisabled: boolean; actualDisabled: boolean }>;
  };
}

interface StrategyItem {
  priority: number;
  area: string;
  reason: string;
  actions: string[];
  targetFiles: string[];
}

function parseArgs(argv: string[]): CliArgs {
  let imagePath = path.resolve(process.cwd(), "res", "desktop.png");
  let baselinePath = path.resolve(process.cwd(), "docs", "Stage6_Desktop_Baseline.json");
  let samplePath = "C:\\Users\\Public\\Desktop";
  let shiftKey = false;
  let jsonOnly = false;

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--image") {
      imagePath = path.resolve(process.cwd(), argv[index + 1] ?? "");
      index += 1;
      continue;
    }
    if (token === "--baseline") {
      baselinePath = path.resolve(process.cwd(), argv[index + 1] ?? "");
      index += 1;
      continue;
    }
    if (token === "--sample-path") {
      samplePath = argv[index + 1] ?? "";
      index += 1;
      continue;
    }
    if (token === "--shift") {
      shiftKey = true;
      continue;
    }
    if (token === "--json") {
      jsonOnly = true;
    }
  }

  return { imagePath, baselinePath, samplePath, shiftKey, jsonOnly };
}

function runVisualDiff(args: CliArgs): VisualDiffPayload {
  const tsxCliPath = path.resolve(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs");
  const scriptArgs = [
    tsxCliPath,
    "scripts/stage6-visual-diff.ts",
    "--json",
    "--image",
    args.imagePath,
    "--baseline",
    args.baselinePath,
    "--sample-path",
    args.samplePath,
  ];
  if (args.shiftKey) {
    scriptArgs.push("--shift");
  }

  const result = spawnSync(process.execPath, scriptArgs, {
    cwd: process.cwd(),
    encoding: "utf-8",
    shell: false,
  });
  if (result.status !== 0) {
    throw new Error(`stage6-visual-diff failed: ${result.stderr || result.stdout || "(no output)"}`);
  }
  return JSON.parse(result.stdout) as VisualDiffPayload;
}

function buildStrategies(payload: VisualDiffPayload): StrategyItem[] {
  const items: StrategyItem[] = [];
  const { summary, ocr } = payload;

  if (summary.missingTitles.length > 0) {
    items.push({
      priority: 1,
      area: "Missing Items",
      reason: `Screenshot has ${summary.missingTitles.length} missing items against predicted rendering.`,
      actions: [
        "Check stage6 visual extraction normalization for dropped labels (line grouping / token cleanup).",
        "If extraction is correct, align runtime source merge in system snapshot (COM + registry + CommandStore).",
        `Prioritize missing titles: ${summary.missingTitles.join(", ")}.`,
      ],
      targetFiles: [
        "scripts/stage6-visual-lib.ts",
        "electron/system-menu-registry.ts",
        "src/preview/runtime-preview.ts",
      ],
    });
  }

  if (summary.extraTitles.length > 0) {
    items.push({
      priority: 2,
      area: "Extra Items",
      reason: `Screenshot has ${summary.extraTitles.length} extra items not in predicted rendering.`,
      actions: [
        "Add environment noise rules (optionalPatterns / ignoredPatterns) if entries are plugin-specific.",
        "If entries are real system core items, extend prediction merge roots or title normalization.",
        `Review extra titles: ${summary.extraTitles.join(", ")}.`,
      ],
      targetFiles: [
        "docs/Stage6_Desktop_Baseline.json",
        "scripts/stage6-visual-diff.ts",
        "electron/system-menu-registry.ts",
      ],
    });
  }

  if (summary.orderMismatches.length > 0) {
    items.push({
      priority: 3,
      area: "Order",
      reason: `Detected ${summary.orderMismatches.length} ordering mismatches.`,
      actions: [
        "Adjust desktop order hints to reduce placement drift.",
        "Keep system/shell merge ordering deterministic after dedupe.",
      ],
      targetFiles: [
        "electron/system-menu-registry.ts",
        "src/preview/runtime-preview.ts",
      ],
    });
  }

  if (summary.submenuMismatches.length > 0) {
    items.push({
      priority: 4,
      area: "Submenu State",
      reason: `Detected ${summary.submenuMismatches.length} submenu-state mismatches.`,
      actions: [
        "Increase submenu extraction reliability in OCR right-marker detection.",
        "Validate COM submenu probing depth and submenu merge behavior.",
      ],
      targetFiles: [
        "scripts/stage6-visual-lib.ts",
        "electron/scripts/context-menu-probe.ps1",
        "electron/system-menu-registry.ts",
      ],
    });
  }

  if (summary.disabledMismatches.length > 0) {
    items.push({
      priority: 5,
      area: "Disabled State",
      reason: `Detected ${summary.disabledMismatches.length} disabled-state mismatches.`,
      actions: [
        "Check clipboard/state inference path (Paste disabled synchronization).",
        "Tune OCR disabled luminance threshold for gray text.",
      ],
      targetFiles: [
        "src/App.tsx",
        "scripts/stage6-diff.ts",
        "scripts/stage6-visual-lib.ts",
      ],
    });
  }

  if (ocr.meanOcrConfidence < 65) {
    items.push({
      priority: 6,
      area: "OCR Quality",
      reason: `OCR confidence is low (${ocr.meanOcrConfidence}).`,
      actions: [
        "Tune screenshot preprocessing (crop, resize, sharpen, gamma).",
        "Collect higher-resolution screenshots for baseline.",
      ],
      targetFiles: [
        "scripts/stage6-visual-lib.ts",
      ],
    });
  }

  if (items.length === 0) {
    items.push({
      priority: 1,
      area: "Stable",
      reason: "No structural visual diffs detected.",
      actions: [
        "Keep current strategy and run stage6-regress before each release cut.",
      ],
      targetFiles: ["scripts/stage6-regress.ts"],
    });
  }

  return items.sort((a, b) => a.priority - b.priority);
}

function computeScore(payload: VisualDiffPayload): number {
  const { summary, ocr } = payload;
  const penalty =
    summary.missingTitles.length * 20 +
    summary.extraTitles.length * 10 +
    summary.orderMismatches.length * 6 +
    summary.submenuMismatches.length * 8 +
    summary.disabledMismatches.length * 8 +
    Math.max(0, 70 - ocr.meanOcrConfidence) * 0.3;
  return Math.max(0, Math.round(100 - penalty));
}

function printText(strategies: StrategyItem[], score: number, payload: VisualDiffPayload): void {
  const { summary, ocr } = payload;
  console.log(
    `stage6-autoplan: score=${score} missing=${summary.missingTitles.length} extra=${summary.extraTitles.length} order=${summary.orderMismatches.length} submenu=${summary.submenuMismatches.length} disabled=${summary.disabledMismatches.length} ocr=${ocr.meanOcrConfidence}`,
  );
  console.log("stage6-autoplan: strategy");
  for (const item of strategies) {
    console.log(`${item.priority}. [${item.area}] ${item.reason}`);
    for (const action of item.actions) {
      console.log(`   - ${action}`);
    }
    console.log(`   - files: ${item.targetFiles.join(", ")}`);
  }
}

async function run(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const payload = runVisualDiff(args);
  const strategies = buildStrategies(payload);
  const score = computeScore(payload);
  const output = {
    score,
    summary: payload.summary,
    ocr: payload.ocr,
    strategies,
  };

  if (args.jsonOnly) {
    console.log(JSON.stringify(output, null, 2));
    return;
  }
  printText(strategies, score, payload);
}

void run();
