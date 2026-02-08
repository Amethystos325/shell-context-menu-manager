import path from "node:path";
import { spawnSync } from "node:child_process";

interface CliArgs {
  imagePath: string;
  baselinePath: string;
  samplePath: string;
  shiftKey: boolean;
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

function parseArgs(argv: string[]): CliArgs {
  let imagePath = path.resolve(process.cwd(), "res", "desktop.png");
  let baselinePath = path.resolve(process.cwd(), "docs", "Stage6_Desktop_Baseline.json");
  let samplePath = "C:\\Users\\Public\\Desktop";
  let shiftKey = false;

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
    }
  }

  return { imagePath, baselinePath, samplePath, shiftKey };
}

function runNpmScript(scriptName: string): { ok: boolean; output: string } {
  const result = spawnSync("npm", ["run", scriptName], {
    cwd: process.cwd(),
    encoding: "utf-8",
    shell: true,
  });
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`.trim();
  return { ok: result.status === 0, output };
}

function runVisualDiffJson(args: CliArgs): { ok: boolean; output: string; parsed?: VisualDiffJson } {
  const tsxCliPath = path.resolve(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs");
  const commandArgs = [
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

function runAutoPlan(args: CliArgs): { ok: boolean; output: string } {
  const tsxCliPath = path.resolve(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs");
  const commandArgs = [
    tsxCliPath,
    "scripts/stage6-autoplan.ts",
    "--image",
    args.imagePath,
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
  return { ok: result.status === 0, output };
}

function run(): void {
  const args = parseArgs(process.argv.slice(2));
  const failures: string[] = [];

  const matrix = runNpmScript("stage6:matrix");
  console.log("\n=== stage6:matrix ===");
  console.log(matrix.output || "(no output)");
  if (!matrix.ok) {
    failures.push("stage6:matrix");
  }

  const visualDiff = runVisualDiffJson(args);
  console.log("\n=== stage6:visual-diff ===");
  if (!visualDiff.ok || !visualDiff.parsed) {
    console.log(visualDiff.output || "(no output)");
    failures.push("stage6:visual-diff");
  } else {
    const summary = visualDiff.parsed.summary;
    const ocrConfidence = visualDiff.parsed.ocr.meanOcrConfidence;
    console.log(
      `visual summary: missing=${summary.missingTitles.length} extra=${summary.extraTitles.length} order=${summary.orderMismatches.length} submenu=${summary.submenuMismatches.length} disabled=${summary.disabledMismatches.length} ocr=${ocrConfidence}`,
    );
    const visualFail =
      summary.missingTitles.length > 0 ||
      summary.extraTitles.length > 0 ||
      summary.orderMismatches.length > 0 ||
      summary.submenuMismatches.length > 0 ||
      summary.disabledMismatches.length > 0;
    if (visualFail) {
      failures.push("stage6:visual-diff");
      console.log("visual diff details:");
      console.log(visualDiff.output);
    } else {
      console.log("visual diff: OK");
      if (ocrConfidence < 65) {
        console.log(`visual diff warning: OCR confidence is low (${ocrConfidence}).`);
      }
    }
  }

  const autoplan = runAutoPlan(args);
  console.log("\n=== stage6:autoplan ===");
  console.log(autoplan.output || "(no output)");
  if (!autoplan.ok) {
    failures.push("stage6:autoplan");
  }

  const previewSmoke = runNpmScript("preview:smoke");
  console.log("\n=== preview:smoke ===");
  console.log(previewSmoke.output || "(no output)");
  if (!previewSmoke.ok) {
    failures.push("preview:smoke");
  }

  const typecheck = runNpmScript("typecheck");
  console.log("\n=== typecheck ===");
  console.log(typecheck.output || "(no output)");
  if (!typecheck.ok) {
    failures.push("typecheck");
  }

  const lint = runNpmScript("lint");
  console.log("\n=== lint ===");
  console.log(lint.output || "(no output)");
  if (!lint.ok) {
    failures.push("lint");
  }

  if (failures.length > 0) {
    console.error(`\nstage6-regress: FAIL (${failures.join(", ")})`);
    process.exit(1);
  }
  console.log("\nstage6-regress: OK");
}

run();
