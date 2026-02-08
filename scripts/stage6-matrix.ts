import path from "node:path";
import { spawnSync } from "node:child_process";

interface MatrixCase {
  name: string;
  baselinePath: string;
  samplePath?: string;
}

function parseCount(output: string, label: string): number {
  const regex = new RegExp(`${label}\\((\\d+)\\)`, "i");
  const match = output.match(regex);
  if (!match) {
    return Number.NaN;
  }
  return Number(match[1]);
}

function runCase(testCase: MatrixCase): { ok: boolean; output: string } {
  const tsxCliPath = path.resolve(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs");
  const args = [tsxCliPath, "scripts/stage6-diff.ts", "--baseline", testCase.baselinePath];
  if (testCase.samplePath) {
    args.push("--sample-path", testCase.samplePath);
  }

  const result = spawnSync(process.execPath, args, {
    cwd: process.cwd(),
    encoding: "utf-8",
    shell: false,
  });

  const runtimeError = result.error ? `${result.error.name}: ${result.error.message}` : "";
  const output = `${runtimeError}\n${result.stdout ?? ""}\n${result.stderr ?? ""}`.trim();
  if (result.status !== 0) {
    return { ok: false, output };
  }

  const missing = parseCount(output, "missing");
  const extra = parseCount(output, "extra");
  const order = parseCount(output, "order-mismatch");
  const submenu = parseCount(output, "submenu-mismatch");
  const disabled = parseCount(output, "disabled-mismatch");
  const ok = [missing, extra, order, submenu, disabled].every(
    (value) => Number.isFinite(value) && value === 0,
  );
  return { ok, output };
}

function run(): void {
  const root = process.cwd();
  const cases: MatrixCase[] = [
    {
      name: "desktop-combined",
      baselinePath: "docs/Stage6_Desktop_Baseline.json",
      samplePath: "C:\\Users\\Public\\Desktop",
    },
    {
      name: "file-combined",
      baselinePath: "docs/Stage6_File_Baseline.json",
      samplePath: path.resolve(root, "README.md"),
    },
    {
      name: "dir-combined",
      baselinePath: "docs/Stage6_Dir_Baseline.json",
      samplePath: root,
    },
    {
      name: "back-combined",
      baselinePath: "docs/Stage6_Back_Baseline.json",
      samplePath: root,
    },
    {
      name: "drive-combined",
      baselinePath: "docs/Stage6_Drive_Baseline.json",
      samplePath: "C:\\",
    },
    {
      name: "taskbar-combined",
      baselinePath: "docs/Stage6_Taskbar_Baseline.json",
    },
  ];

  const failures: string[] = [];
  for (const testCase of cases) {
    const result = runCase(testCase);
    console.log(`\n=== ${testCase.name} ===`);
    console.log(result.output || "(no output)");
    if (!result.ok) {
      failures.push(testCase.name);
    }
  }

  if (failures.length > 0) {
    console.error(`\nstage6-matrix: FAIL (${failures.join(", ")})`);
    process.exit(1);
  }
  console.log("\nstage6-matrix: OK");
}

run();
