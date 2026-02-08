import path from "node:path";
import { spawnSync } from "node:child_process";

interface CliArgs {
  imagePath?: string;
  captureOutPath: string;
  captureMode: "screen" | "menu";
  triggerMode: "auto" | "right-click" | "keyboard";
  baselinePath: string;
  samplePath: string;
  shiftKey: boolean;
  x?: number;
  y?: number;
  timeoutMs: number;
  menuReadyDelayMs: number;
  padding: number;
  desktopFocusDelayMs: number;
  focusDesktop: boolean;
  keepMenuOpen: boolean;
  skipCapture: boolean;
  fullPipeline: boolean;
  maxMissing: number;
  maxExtra: number;
  maxOrder: number;
  maxSubmenu: number;
  maxDisabled: number;
}

interface CaptureResult {
  outputPath: string;
  captureMode?: "screen" | "menu";
  click: {
    x: number;
    y: number;
  };
  menuRect: {
    width: number;
    height: number;
  };
}

interface VisualDiffJson {
  ocr: {
    meanOcrConfidence: number;
  };
  summary: {
    missingTitles: string[];
    extraTitles: string[];
    orderMismatches: unknown[];
    submenuMismatches: unknown[];
    disabledMismatches: unknown[];
  };
}

function parseInteger(value: string, flag: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid value for ${flag}: ${value}`);
  }
  return parsed;
}

function parseArgs(argv: string[]): CliArgs {
  let imagePath: string | undefined;
  let captureOutPath = path.resolve(process.cwd(), "artifacts", "stage6", "desktop-live.png");
  let captureMode: "screen" | "menu" = "screen";
  let triggerMode: "auto" | "right-click" | "keyboard" = "auto";
  let baselinePath = path.resolve(process.cwd(), "docs", "Stage6_Desktop_Baseline.json");
  let samplePath = "C:\\Users\\Public\\Desktop";
  let shiftKey = false;
  let x: number | undefined;
  let y: number | undefined;
  let timeoutMs = 5000;
  let menuReadyDelayMs = 180;
  let padding = 8;
  let desktopFocusDelayMs = 180;
  let focusDesktop = true;
  let keepMenuOpen = false;
  let skipCapture = false;
  let fullPipeline = false;
  let maxMissing = 0;
  let maxExtra = 0;
  let maxOrder = 0;
  let maxSubmenu = 0;
  let maxDisabled = 0;

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--image") {
      imagePath = path.resolve(process.cwd(), argv[index + 1] ?? "");
      index += 1;
      continue;
    }
    if (token === "--capture-out") {
      captureOutPath = path.resolve(process.cwd(), argv[index + 1] ?? "");
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
    if (token === "--x") {
      x = parseInteger(argv[index + 1] ?? "", "--x");
      index += 1;
      continue;
    }
    if (token === "--y") {
      y = parseInteger(argv[index + 1] ?? "", "--y");
      index += 1;
      continue;
    }
    if (token === "--timeout-ms") {
      timeoutMs = parseInteger(argv[index + 1] ?? "", "--timeout-ms");
      index += 1;
      continue;
    }
    if (token === "--menu-ready-delay-ms") {
      menuReadyDelayMs = parseInteger(argv[index + 1] ?? "", "--menu-ready-delay-ms");
      index += 1;
      continue;
    }
    if (token === "--padding") {
      padding = parseInteger(argv[index + 1] ?? "", "--padding");
      index += 1;
      continue;
    }
    if (token === "--desktop-focus-delay-ms") {
      desktopFocusDelayMs = parseInteger(argv[index + 1] ?? "", "--desktop-focus-delay-ms");
      index += 1;
      continue;
    }
    if (token === "--capture-mode") {
      const mode = (argv[index + 1] ?? "").trim().toLowerCase();
      if (mode !== "screen" && mode !== "menu") {
        throw new Error(`Invalid value for --capture-mode: ${mode}`);
      }
      captureMode = mode;
      index += 1;
      continue;
    }
    if (token === "--trigger-mode") {
      const mode = (argv[index + 1] ?? "").trim().toLowerCase();
      if (mode !== "auto" && mode !== "right-click" && mode !== "keyboard") {
        throw new Error(`Invalid value for --trigger-mode: ${mode}`);
      }
      triggerMode = mode;
      index += 1;
      continue;
    }
    if (token === "--no-focus-desktop") {
      focusDesktop = false;
      continue;
    }
    if (token === "--shift") {
      shiftKey = true;
      continue;
    }
    if (token === "--keep-menu-open") {
      keepMenuOpen = true;
      continue;
    }
    if (token === "--skip-capture") {
      skipCapture = true;
      continue;
    }
    if (token === "--full") {
      fullPipeline = true;
      continue;
    }
    if (token === "--max-missing") {
      maxMissing = Math.max(0, parseInteger(argv[index + 1] ?? "", "--max-missing"));
      index += 1;
      continue;
    }
    if (token === "--max-extra") {
      maxExtra = Math.max(0, parseInteger(argv[index + 1] ?? "", "--max-extra"));
      index += 1;
      continue;
    }
    if (token === "--max-order") {
      maxOrder = Math.max(0, parseInteger(argv[index + 1] ?? "", "--max-order"));
      index += 1;
      continue;
    }
    if (token === "--max-submenu") {
      maxSubmenu = Math.max(0, parseInteger(argv[index + 1] ?? "", "--max-submenu"));
      index += 1;
      continue;
    }
    if (token === "--max-disabled") {
      maxDisabled = Math.max(0, parseInteger(argv[index + 1] ?? "", "--max-disabled"));
      index += 1;
      continue;
    }
  }

  return {
    imagePath,
    captureOutPath,
    captureMode,
    triggerMode,
    baselinePath,
    samplePath,
    shiftKey,
    x,
    y,
    timeoutMs,
    menuReadyDelayMs,
    padding,
    desktopFocusDelayMs,
    focusDesktop,
    keepMenuOpen,
    skipCapture,
    fullPipeline,
    maxMissing,
    maxExtra,
    maxOrder,
    maxSubmenu,
    maxDisabled,
  };
}

function runCapture(args: CliArgs): string {
  if (args.skipCapture && args.imagePath) {
    return args.imagePath;
  }

  const tsxCliPath = path.resolve(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs");
  const commandArgs = [
    tsxCliPath,
    "scripts/stage6-real-capture.ts",
    "--json",
    "--out",
    args.captureOutPath,
    "--capture-mode",
    args.captureMode,
    "--trigger-mode",
    args.triggerMode,
    "--timeout-ms",
    String(Math.max(0, args.timeoutMs)),
    "--menu-ready-delay-ms",
    String(Math.max(0, args.menuReadyDelayMs)),
    "--padding",
    String(Math.max(0, args.padding)),
    "--desktop-focus-delay-ms",
    String(Math.max(0, args.desktopFocusDelayMs)),
  ];

  if (args.x !== undefined) {
    commandArgs.push("--x", String(args.x));
  }
  if (args.y !== undefined) {
    commandArgs.push("--y", String(args.y));
  }
  if (!args.focusDesktop) {
    commandArgs.push("--no-focus-desktop");
  }
  if (args.shiftKey) {
    commandArgs.push("--shift");
  }
  if (args.keepMenuOpen) {
    commandArgs.push("--keep-menu-open");
  }

  const result = spawnSync(process.execPath, commandArgs, {
    cwd: process.cwd(),
    encoding: "utf-8",
    shell: false,
  });
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`.trim();
  if (result.status !== 0) {
    throw new Error(`stage6-real-capture failed.\n${output}`);
  }

  try {
    const parsed = JSON.parse(result.stdout) as CaptureResult;
    console.log(
      `stage6-real-regress: capture mode=${parsed.captureMode ?? args.captureMode} trigger=${args.triggerMode} output=${parsed.outputPath} click=(${parsed.click.x},${parsed.click.y}) menu=${parsed.menuRect.width}x${parsed.menuRect.height}`,
    );
    return parsed.outputPath;
  } catch (error) {
    throw new Error(
      `stage6-real-capture returned invalid JSON.\n${output}\nparseError:${String(error)}`,
    );
  }
}

function runVisualDiff(args: CliArgs, imagePath: string): { ok: boolean; output: string; parsed?: VisualDiffJson } {
  const tsxCliPath = path.resolve(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs");
  const commandArgs = [
    tsxCliPath,
    "scripts/stage6-visual-diff.ts",
    "--json",
    "--image",
    imagePath,
    "--baseline",
    args.baselinePath,
    "--sample-path",
    args.samplePath,
  ];
  if (args.shiftKey) {
    commandArgs.push("--shift");
  }

  const result = spawnSync(process.execPath, commandArgs, {
    cwd: process.cwd(),
    encoding: "utf-8",
    shell: false,
  });
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`.trim();
  if (result.status !== 0) {
    return { ok: false, output };
  }
  try {
    return { ok: true, output, parsed: JSON.parse(result.stdout) as VisualDiffJson };
  } catch (error) {
    return { ok: false, output: `${output}\nJSON parse error: ${String(error)}` };
  }
}

function runAutoPlan(args: CliArgs, imagePath: string): { ok: boolean; output: string } {
  const tsxCliPath = path.resolve(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs");
  const commandArgs = [
    tsxCliPath,
    "scripts/stage6-autoplan.ts",
    "--image",
    imagePath,
    "--baseline",
    args.baselinePath,
    "--sample-path",
    args.samplePath,
  ];
  if (args.shiftKey) {
    commandArgs.push("--shift");
  }

  const result = spawnSync(process.execPath, commandArgs, {
    cwd: process.cwd(),
    encoding: "utf-8",
    shell: false,
  });
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`.trim();
  console.log("\n=== stage6:autoplan ===");
  console.log(output || "(no output)");
  return { ok: result.status === 0, output };
}

function runFullRegress(args: CliArgs, imagePath: string): { ok: boolean; output: string } {
  const tsxCliPath = path.resolve(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs");
  const commandArgs = [
    tsxCliPath,
    "scripts/stage6-regress.ts",
    "--image",
    imagePath,
    "--baseline",
    args.baselinePath,
    "--sample-path",
    args.samplePath,
  ];
  if (args.shiftKey) {
    commandArgs.push("--shift");
  }

  const result = spawnSync(process.execPath, commandArgs, {
    cwd: process.cwd(),
    encoding: "utf-8",
    shell: false,
  });
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`.trim();
  console.log("\n=== stage6:regress ===");
  console.log(output || "(no output)");
  return { ok: result.status === 0, output };
}

function run(): void {
  const args = parseArgs(process.argv.slice(2));
  const failures: string[] = [];
  const imagePath = args.imagePath && args.skipCapture
    ? args.imagePath
    : runCapture(args);

  const visual = runVisualDiff(args, imagePath);
  console.log("\n=== stage6:visual-diff ===");
  if (!visual.ok || !visual.parsed) {
    console.log(visual.output || "(no output)");
    failures.push("stage6:visual-diff");
  } else {
    const summary = visual.parsed.summary;
    const ocrConfidence = visual.parsed.ocr.meanOcrConfidence;
    const missing = summary.missingTitles.length;
    const extra = summary.extraTitles.length;
    const order = summary.orderMismatches.length;
    const submenu = summary.submenuMismatches.length;
    const disabled = summary.disabledMismatches.length;
    console.log(
      `visual summary: missing=${missing} extra=${extra} order=${order} submenu=${submenu} disabled=${disabled} ocr=${ocrConfidence}`,
    );
    const exceeds =
      missing > args.maxMissing ||
      extra > args.maxExtra ||
      order > args.maxOrder ||
      submenu > args.maxSubmenu ||
      disabled > args.maxDisabled;
    if (exceeds) {
      failures.push("stage6:visual-diff");
      console.log(
        `thresholds: missing<=${args.maxMissing} extra<=${args.maxExtra} order<=${args.maxOrder} submenu<=${args.maxSubmenu} disabled<=${args.maxDisabled}`,
      );
      console.log("visual diff details:");
      console.log(visual.output);
    } else {
      console.log("visual diff: OK");
    }
  }

  const autoplan = runAutoPlan(args, imagePath);
  if (!autoplan.ok) {
    failures.push("stage6:autoplan");
  }

  if (args.fullPipeline) {
    const full = runFullRegress(args, imagePath);
    if (!full.ok) {
      failures.push("stage6:regress");
    }
  }

  if (failures.length > 0) {
    throw new Error(`stage6-real-regress: FAIL (${failures.join(", ")})`);
  }

  console.log("\nstage6-real-regress: OK");
}

run();
