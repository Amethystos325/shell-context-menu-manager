import { readFile } from "node:fs/promises";
import path from "node:path";
import { readSystemMenuSnapshot } from "../electron/system-menu-registry.js";
import type { PreviewLocationType, SystemMenuEntry } from "../src/shared/ipc.js";

interface BaselineEntry {
  title: string;
  submenu?: boolean;
}

interface BaselineDocument {
  locationType: PreviewLocationType;
  expected: BaselineEntry[];
}

interface CompareSummary {
  expectedCount: number;
  actualCount: number;
  missingTitles: string[];
  extraTitles: string[];
  orderMismatches: Array<{ title: string; expectedIndex: number; actualIndex: number }>;
  submenuMismatches: Array<{ title: string; expectedSubmenu: boolean; actualSubmenu: boolean }>;
}

function normalizeTitle(value: string): string {
  return value.trim().toLowerCase();
}

function toTopLevel(entries: SystemMenuEntry[]): BaselineEntry[] {
  return entries
    .map((entry) => ({
      title: entry.title.trim(),
      submenu: entry.submenu,
    }))
    .filter((entry) => entry.title.length > 0);
}

function parseArgs(argv: string[]): { baselinePath: string; shiftKey: boolean; samplePath: string } {
  let baselinePath = path.resolve(process.cwd(), "docs", "Stage6_Desktop_Baseline.json");
  let shiftKey = false;
  let samplePath = "";

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--baseline") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("Missing value for --baseline");
      }
      baselinePath = path.resolve(process.cwd(), value);
      index += 1;
      continue;
    }
    if (token === "--sample-path") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("Missing value for --sample-path");
      }
      samplePath = value;
      index += 1;
      continue;
    }
    if (token === "--shift") {
      shiftKey = true;
      continue;
    }
  }

  return { baselinePath, shiftKey, samplePath };
}

async function loadBaseline(filePath: string): Promise<BaselineDocument> {
  const raw = await readFile(filePath, "utf-8");
  const parsed = JSON.parse(raw) as Partial<BaselineDocument>;

  if (!parsed.locationType || typeof parsed.locationType !== "string") {
    throw new Error("Invalid baseline: locationType is required.");
  }
  if (!Array.isArray(parsed.expected)) {
    throw new Error("Invalid baseline: expected must be an array.");
  }

  const expected = parsed.expected
    .map((entry) => ({
      title: String(entry.title ?? "").trim(),
      submenu:
        entry.submenu === undefined
          ? undefined
          : Boolean(entry.submenu),
    }))
    .filter((entry) => entry.title.length > 0);

  if (expected.length === 0) {
    throw new Error("Invalid baseline: expected entries are empty.");
  }

  return {
    locationType: parsed.locationType as PreviewLocationType,
    expected,
  };
}

function compareMenus(expected: BaselineEntry[], actual: BaselineEntry[]): CompareSummary {
  const expectedMap = new Map<string, BaselineEntry>();
  const expectedOrder = new Map<string, number>();
  for (let index = 0; index < expected.length; index += 1) {
    const entry = expected[index];
    const key = normalizeTitle(entry.title);
    if (!key || expectedMap.has(key)) {
      continue;
    }
    expectedMap.set(key, entry);
    expectedOrder.set(key, index);
  }

  const actualMap = new Map<string, BaselineEntry>();
  const actualOrder = new Map<string, number>();
  for (let index = 0; index < actual.length; index += 1) {
    const entry = actual[index];
    const key = normalizeTitle(entry.title);
    if (!key || actualMap.has(key)) {
      continue;
    }
    actualMap.set(key, entry);
    actualOrder.set(key, index);
  }

  const missingTitles: string[] = [];
  for (const entry of expected) {
    const key = normalizeTitle(entry.title);
    if (!actualMap.has(key)) {
      missingTitles.push(entry.title);
    }
  }

  const extraTitles: string[] = [];
  for (const entry of actual) {
    const key = normalizeTitle(entry.title);
    if (!expectedMap.has(key)) {
      extraTitles.push(entry.title);
    }
  }

  const orderMismatches: Array<{ title: string; expectedIndex: number; actualIndex: number }> = [];
  for (const entry of expected) {
    const key = normalizeTitle(entry.title);
    const expectedIndex = expectedOrder.get(key);
    const actualIndex = actualOrder.get(key);
    if (expectedIndex === undefined || actualIndex === undefined) {
      continue;
    }
    if (expectedIndex !== actualIndex) {
      orderMismatches.push({ title: entry.title, expectedIndex, actualIndex });
    }
  }

  const submenuMismatches: Array<{ title: string; expectedSubmenu: boolean; actualSubmenu: boolean }> = [];
  for (const entry of expected) {
    if (entry.submenu === undefined) {
      continue;
    }
    const key = normalizeTitle(entry.title);
    const actualEntry = actualMap.get(key);
    if (!actualEntry) {
      continue;
    }
    const actualSubmenu = Boolean(actualEntry.submenu);
    if (actualSubmenu !== entry.submenu) {
      submenuMismatches.push({
        title: entry.title,
        expectedSubmenu: entry.submenu,
        actualSubmenu,
      });
    }
  }

  return {
    expectedCount: expected.length,
    actualCount: actual.length,
    missingTitles,
    extraTitles,
    orderMismatches,
    submenuMismatches,
  };
}

async function run(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const baseline = await loadBaseline(args.baselinePath);
  const snapshot = await readSystemMenuSnapshot(
    baseline.locationType,
    args.shiftKey,
    args.samplePath,
  );
  const actualTopLevel = toTopLevel(snapshot.entries);
  const summary = compareMenus(baseline.expected, actualTopLevel);

  console.log(
    `stage6-diff: location=${baseline.locationType} shift=${args.shiftKey} expected=${summary.expectedCount} actual=${summary.actualCount}`,
  );
  console.log(
    `missing(${summary.missingTitles.length}): ${summary.missingTitles.join(" | ") || "-"}`,
  );
  console.log(
    `extra(${summary.extraTitles.length}): ${summary.extraTitles.join(" | ") || "-"}`,
  );
  if (summary.orderMismatches.length === 0) {
    console.log("order-mismatch(0): -");
  } else {
    console.log(`order-mismatch(${summary.orderMismatches.length}):`);
    for (const mismatch of summary.orderMismatches) {
      console.log(
        `  - ${mismatch.title}: expected#${mismatch.expectedIndex + 1}, actual#${mismatch.actualIndex + 1}`,
      );
    }
  }

  if (summary.submenuMismatches.length === 0) {
    console.log("submenu-mismatch(0): -");
  } else {
    console.log(`submenu-mismatch(${summary.submenuMismatches.length}):`);
    for (const mismatch of summary.submenuMismatches) {
      console.log(
        `  - ${mismatch.title}: expected submenu=${mismatch.expectedSubmenu}, actual submenu=${mismatch.actualSubmenu}`,
      );
    }
  }
  console.log("stage6-diff: OK");
}

void run();
