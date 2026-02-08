import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";

interface CliArgs {
  outPath: string;
  captureMode: "screen" | "menu";
  triggerMode: "auto" | "right-click" | "keyboard";
  x?: number;
  y?: number;
  timeoutMs: number;
  menuReadyDelayMs: number;
  padding: number;
  desktopFocusDelayMs: number;
  focusDesktop: boolean;
  shiftKey: boolean;
  keepMenuOpen: boolean;
  jsonOnly: boolean;
  dryRun: boolean;
}

interface CaptureResult {
  outputPath: string;
  captureMode?: "screen" | "menu";
  click: {
    x: number;
    y: number;
  };
  menuRect: {
    left: number;
    top: number;
    right: number;
    bottom: number;
    width: number;
    height: number;
  };
  captureRect: {
    left: number;
    top: number;
    right: number;
    bottom: number;
    width: number;
    height: number;
  };
}

function getPowerShellPath(): string {
  return process.env.windir
    ? path.join(process.env.windir, "System32", "WindowsPowerShell", "v1.0", "powershell.exe")
    : "powershell.exe";
}

function getCaptureScriptPath(): string {
  const candidates = [
    path.resolve(process.cwd(), "electron", "scripts", "context-menu-capture.ps1"),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  throw new Error("context-menu-capture.ps1 not found.");
}

function parseInteger(value: string, flag: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid value for ${flag}: ${value}`);
  }
  return parsed;
}

function parseArgs(argv: string[]): CliArgs {
  let outPath = path.resolve(process.cwd(), "artifacts", "stage6", "desktop-live.png");
  let captureMode: "screen" | "menu" = "screen";
  let triggerMode: "auto" | "right-click" | "keyboard" = "auto";
  let x: number | undefined;
  let y: number | undefined;
  let timeoutMs = 5000;
  let menuReadyDelayMs = 180;
  let padding = 8;
  let desktopFocusDelayMs = 180;
  let focusDesktop = true;
  let shiftKey = false;
  let keepMenuOpen = false;
  let jsonOnly = false;
  let dryRun = false;

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--out") {
      outPath = path.resolve(process.cwd(), argv[index + 1] ?? "");
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
    if (token === "--json") {
      jsonOnly = true;
      continue;
    }
    if (token === "--dry-run") {
      dryRun = true;
    }
  }

  return {
    outPath,
    captureMode,
    triggerMode,
    x,
    y,
    timeoutMs,
    menuReadyDelayMs,
    padding,
    desktopFocusDelayMs,
    focusDesktop,
    shiftKey,
    keepMenuOpen,
    jsonOnly,
    dryRun,
  };
}

function buildPowerShellArgs(scriptPath: string, args: CliArgs): string[] {
  const outputDir = path.dirname(args.outPath);
  mkdirSync(outputDir, { recursive: true });

  const psArgs = [
    "-NoProfile",
    "-STA",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    scriptPath,
    "-OutputPath",
    args.outPath,
    "-CaptureMode",
    args.captureMode,
    "-TriggerMode",
    args.triggerMode,
    "-TimeoutMs",
    String(Math.max(0, args.timeoutMs)),
    "-MenuReadyDelayMs",
    String(Math.max(0, args.menuReadyDelayMs)),
    "-Padding",
    String(Math.max(0, args.padding)),
    "-DesktopFocusDelayMs",
    String(Math.max(0, args.desktopFocusDelayMs)),
  ];

  if (args.x !== undefined) {
    psArgs.push("-X", String(args.x));
  }
  if (args.y !== undefined) {
    psArgs.push("-Y", String(args.y));
  }
  if (args.focusDesktop) {
    psArgs.push("-FocusDesktop");
  }
  if (args.shiftKey) {
    psArgs.push("-Shift");
  }
  if (args.keepMenuOpen) {
    psArgs.push("-KeepMenuOpen");
  }

  return psArgs;
}

function runCapture(args: CliArgs): CaptureResult {
  const scriptPath = getCaptureScriptPath();
  const shellPath = getPowerShellPath();
  const shellArgs = buildPowerShellArgs(scriptPath, args);

  if (args.dryRun) {
    const payload: CaptureResult = {
      outputPath: args.outPath,
      captureMode: args.captureMode,
      click: { x: args.x ?? -1, y: args.y ?? -1 },
      menuRect: { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 },
      captureRect: { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 },
    };
    console.log(`dry-run: ${shellPath} ${shellArgs.join(" ")}`);
    return payload;
  }

  const result = spawnSync(shellPath, shellArgs, {
    cwd: process.cwd(),
    encoding: "utf-8",
    shell: false,
    windowsHide: true,
  });
  const stdout = `${result.stdout ?? ""}`.trim();
  const stderr = `${result.stderr ?? ""}`.trim();

  if (result.status !== 0) {
    throw new Error(
      `stage6-real-capture failed (exit=${String(result.status)}).\nstdout:\n${stdout || "(empty)"}\nstderr:\n${stderr || "(empty)"}`,
    );
  }

  if (!stdout) {
    throw new Error("stage6-real-capture failed: empty stdout.");
  }

  try {
    return JSON.parse(stdout) as CaptureResult;
  } catch (error) {
    throw new Error(
      `stage6-real-capture failed: invalid JSON output.\nstdout:\n${stdout}\nparseError:${String(error)}`,
    );
  }
}

function run(): void {
  const args = parseArgs(process.argv.slice(2));
  const captured = runCapture(args);
  if (args.jsonOnly) {
    console.log(JSON.stringify(captured, null, 2));
    return;
  }
  console.log(
    `stage6-real-capture: mode=${captured.captureMode ?? args.captureMode} output=${captured.outputPath} click=(${captured.click.x},${captured.click.y}) menu=${captured.menuRect.width}x${captured.menuRect.height}`,
  );
}

run();
