import path from "node:path";
import { readdir, readFile } from "node:fs/promises";
import { parseAndValidate } from "../src/core/index.js";

interface FileResult {
  filePath: string;
  parseIssueCount: number;
  validationIssueCount: number;
  firstParseIssue?: string;
}

async function listNssFiles(rootDir: string): Promise<string[]> {
  const out: string[] = [];

  async function walk(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".nss")) {
        out.push(fullPath);
      }
    }
  }

  await walk(rootDir);
  out.sort((a, b) => a.localeCompare(b));
  return out;
}

function formatFirstParseIssue(filePath: string, message: string, line: number, column: number): string {
  return `${path.relative(process.cwd(), filePath)}:${line}:${column} ${message}`;
}

async function run(): Promise<void> {
  const rootDir = path.resolve("res");
  const files = await listNssFiles(rootDir);

  if (files.length === 0) {
    console.log("No .nss files found under ./res");
    return;
  }

  const results: FileResult[] = [];

  for (const filePath of files) {
    const content = await readFile(filePath, "utf-8");
    const checked = parseAndValidate(content);

    const firstParse = checked.parseIssues[0];
    results.push({
      filePath,
      parseIssueCount: checked.parseIssues.length,
      validationIssueCount: checked.validationIssues.length,
      firstParseIssue: firstParse
        ? formatFirstParseIssue(
            filePath,
            firstParse.message,
            firstParse.range.start.line,
            firstParse.range.start.column,
          )
        : undefined,
    });
  }

  const passed = results.filter((item) => item.parseIssueCount === 0);
  const failed = results.filter((item) => item.parseIssueCount > 0);
  const validationIssueTotal = results.reduce((sum, item) => sum + item.validationIssueCount, 0);

  console.log(`res-parse-check: total=${results.length}, parse-pass=${passed.length}, parse-fail=${failed.length}`);
  console.log(`res-parse-check: validation-issue-total=${validationIssueTotal}`);

  if (failed.length > 0) {
    console.log("---- parse failures ----");
    for (const item of failed) {
      console.log(`${path.relative(process.cwd(), item.filePath)}: parseIssues=${item.parseIssueCount}`);
      if (item.firstParseIssue) {
        console.log(`  first: ${item.firstParseIssue}`);
      }
    }
  }

  if (passed.length > 0) {
    console.log("---- parse pass files ----");
    for (const item of passed) {
      console.log(
        `${path.relative(process.cwd(), item.filePath)}: parseIssues=0, validationIssues=${item.validationIssueCount}`,
      );
    }
  }
}

void run();
