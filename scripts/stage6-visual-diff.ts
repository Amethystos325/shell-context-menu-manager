import path from "node:path";
import { readFile } from "node:fs/promises";
import { parseAndValidate, type ConfigDocument, type ConfigNode } from "../src/core/index.js";
import {
  buildRuntimePreview,
  getDefaultSelectionName,
  getRecommendedSelectionCount,
  type RuntimePreviewContext,
  type RuntimePreviewEntry,
  type RuntimeSystemMenuEntry,
} from "../src/preview/runtime-preview.js";
import { readSystemMenuSnapshot } from "../electron/system-menu-registry.js";
import type { PreviewLocationType, SystemMenuEntry } from "../src/shared/ipc.js";
import {
  extractMenuFromScreenshot,
  type VisualExtractResult,
  type VisualMenuEntry,
} from "./stage6-visual-lib.js";

type DiffMode = "snapshot" | "combined";

interface BaselineEntry {
  title: string;
  submenu?: boolean;
  disabled?: boolean;
}

interface BaselineDocument {
  locationType: PreviewLocationType;
  mode?: DiffMode;
  configPath?: string;
  selectionName?: string;
  selectionCount?: number;
  expected: BaselineEntry[];
  optional?: BaselineEntry[];
  ignored?: string[];
  optionalPatterns?: string[];
  ignoredPatterns?: string[];
}

interface CliArgs {
  imagePath: string;
  baselinePath: string;
  samplePath: string;
  shiftKey: boolean;
  jsonOnly: boolean;
}

interface CompareSummary {
  expectedCount: number;
  actualCount: number;
  missingTitles: string[];
  extraTitles: string[];
  orderMismatches: Array<{ title: string; expectedIndex: number; actualIndex: number }>;
  submenuMismatches: Array<{ title: string; expectedSubmenu: boolean; actualSubmenu: boolean }>;
  disabledMismatches: Array<{ title: string; expectedDisabled: boolean; actualDisabled: boolean }>;
}

function normalizeTitle(value: string): string {
  return value.trim().toLowerCase();
}

function normalizeBaselineEntries(entries: unknown): BaselineEntry[] {
  if (!Array.isArray(entries)) {
    return [];
  }

  return entries
    .map((entry) => ({
      title: String((entry as BaselineEntry).title ?? "").trim(),
      submenu:
        (entry as BaselineEntry).submenu === undefined
          ? undefined
          : Boolean((entry as BaselineEntry).submenu),
      disabled:
        (entry as BaselineEntry).disabled === undefined
          ? undefined
          : Boolean((entry as BaselineEntry).disabled),
    }))
    .filter((entry) => entry.title.length > 0);
}

function normalizeStringList(values: unknown): string[] {
  if (!Array.isArray(values)) {
    return [];
  }
  return values
    .map((item) => String(item ?? "").trim())
    .filter((item) => item.length > 0);
}

function compilePatterns(patterns: string[]): RegExp[] {
  const output: RegExp[] = [];
  for (const pattern of patterns) {
    try {
      output.push(new RegExp(pattern, "i"));
    } catch {
      // ignore invalid regex
    }
  }
  return output;
}

function parseArgs(argv: string[]): CliArgs {
  let imagePath = "";
  let baselinePath = path.resolve(process.cwd(), "docs", "Stage6_Desktop_Baseline.json");
  let shiftKey = false;
  let samplePath = "";
  let jsonOnly = false;

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--image") {
      imagePath = argv[index + 1] ?? "";
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

  if (!imagePath.trim()) {
    throw new Error("Missing --image <path>");
  }

  return {
    imagePath: path.resolve(process.cwd(), imagePath),
    baselinePath,
    shiftKey,
    samplePath,
    jsonOnly,
  };
}

async function loadBaseline(filePath: string): Promise<BaselineDocument> {
  const raw = await readFile(filePath, "utf-8");
  const parsed = JSON.parse(raw) as Partial<BaselineDocument>;
  const expected = normalizeBaselineEntries(parsed.expected);
  if (!parsed.locationType || expected.length === 0) {
    throw new Error("Invalid baseline file.");
  }

  return {
    locationType: parsed.locationType as PreviewLocationType,
    mode: parsed.mode === "snapshot" ? "snapshot" : "combined",
    configPath: typeof parsed.configPath === "string" && parsed.configPath.trim() ? parsed.configPath : "res/shell.nss",
    selectionName:
      typeof parsed.selectionName === "string" && parsed.selectionName.trim()
        ? parsed.selectionName
        : undefined,
    selectionCount:
      typeof parsed.selectionCount === "number" && Number.isFinite(parsed.selectionCount)
        ? Math.max(0, Math.floor(parsed.selectionCount))
        : undefined,
    expected,
    optional: normalizeBaselineEntries(parsed.optional),
    ignored: normalizeStringList(parsed.ignored),
    optionalPatterns: normalizeStringList(parsed.optionalPatterns),
    ignoredPatterns: normalizeStringList(parsed.ignoredPatterns),
  };
}

function toTopLevelPreview(entries: RuntimePreviewEntry[]): BaselineEntry[] {
  return entries
    .filter((entry) => entry.kind !== "separator")
    .map((entry) => ({
      title: entry.title.trim(),
      submenu: entry.kind === "menu" || Boolean(entry.submenu),
      disabled: entry.disabled ? true : undefined,
    }))
    .filter((entry) => entry.title.length > 0);
}

function toTopLevelVisual(entries: VisualMenuEntry[]): BaselineEntry[] {
  return entries
    .map((entry) => ({
      title: entry.title.trim(),
      submenu: entry.submenu,
      disabled: entry.disabled,
    }))
    .filter((entry) => entry.title.length > 0);
}

function toRuntimeSystemMenuEntries(entries: SystemMenuEntry[]): RuntimeSystemMenuEntry[] {
  return entries
    .map((entry) => ({
      title: entry.title,
      icon: entry.icon,
      iconDataUrl: entry.iconDataUrl,
      submenu: entry.submenu,
      disabled: Boolean(entry.disabled),
      children: toRuntimeSystemMenuEntries(entry.children ?? []),
    }))
    .filter((entry) => entry.title.trim().length > 0);
}

function findRuntimeSystemEntryByTitle(
  entries: RuntimeSystemMenuEntry[],
  title: string,
): RuntimeSystemMenuEntry | null {
  const target = normalizeTitle(title);
  if (!target) {
    return null;
  }
  const queue = [...entries];
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) {
      continue;
    }
    if (normalizeTitle(current.title) === target) {
      return current;
    }
    if (current.children && current.children.length > 0) {
      queue.push(...current.children);
    }
  }
  return null;
}

function resolveImportPath(hostFilePath: string, importPath: string): string {
  const trimmed = importPath.trim();
  if (!trimmed) {
    return "";
  }
  if (path.isAbsolute(trimmed)) {
    return path.normalize(trimmed);
  }
  return path.normalize(path.resolve(path.dirname(hostFilePath), trimmed));
}

async function resolveDocumentWithImports(
  document: ConfigDocument,
  hostFilePath: string,
): Promise<ConfigDocument> {
  const visited = new Set<string>([path.normalize(hostFilePath).toLowerCase()]);

  const expandNodes = async (nodes: ConfigNode[], currentPath: string): Promise<ConfigNode[]> => {
    const output: ConfigNode[] = [];
    for (const node of nodes) {
      if (node.kind === "menu") {
        const children = await expandNodes(node.children, currentPath);
        output.push({ ...node, children });
        continue;
      }
      if (node.kind !== "import") {
        output.push(node);
        continue;
      }

      const importFilePath = resolveImportPath(currentPath, node.path);
      if (!importFilePath) {
        continue;
      }
      const visitKey = importFilePath.toLowerCase();
      if (visited.has(visitKey)) {
        continue;
      }
      visited.add(visitKey);

      try {
        const source = await readFile(importFilePath, "utf-8");
        const parsed = parseAndValidate(source);
        if (!parsed.document) {
          continue;
        }
        const nested = await expandNodes(parsed.document.nodes, importFilePath);
        output.push(...nested);
      } catch {
        // ignore missing optional imports
      }
    }
    return output;
  };

  return { nodes: await expandNodes(document.nodes, hostFilePath) };
}

async function loadPredictedEntries(
  baseline: BaselineDocument,
  shiftKey: boolean,
  samplePath: string,
): Promise<BaselineEntry[]> {
  const snapshot = await readSystemMenuSnapshot(
    baseline.locationType,
    shiftKey,
    samplePath,
  );
  const runtimeSystemEntries = toRuntimeSystemMenuEntries(snapshot.entries);

  const configPath = path.resolve(process.cwd(), baseline.configPath ?? "res/shell.nss");
  const source = await readFile(configPath, "utf-8");
  const parsed = parseAndValidate(source);
  if (!parsed.document) {
    throw new Error(`Failed to parse config: ${configPath}`);
  }

  const mergedDocument = await resolveDocumentWithImports(parsed.document, configPath);
  const pasteEntry = findRuntimeSystemEntryByTitle(runtimeSystemEntries, "Paste");
  const context: RuntimePreviewContext = {
    locationType: baseline.locationType,
    selectionCount: baseline.selectionCount ?? getRecommendedSelectionCount(baseline.locationType),
    selectionName:
      samplePath.trim() ||
      baseline.selectionName ||
      getDefaultSelectionName(baseline.locationType),
    shiftKey,
    leftButton: false,
    hasAdmin: false,
    backgroundMode: baseline.locationType === "desktop" || baseline.locationType === "back",
    clipboardHasContent:
      pasteEntry && typeof pasteEntry.disabled === "boolean" ? !pasteEntry.disabled : false,
    currentPath: samplePath.trim() || undefined,
    systemMenuEntries: runtimeSystemEntries,
  };
  const preview = buildRuntimePreview(mergedDocument, context);
  return toTopLevelPreview(preview.combinedEntries);
}

function compareMenus(
  predicted: BaselineEntry[],
  actual: BaselineEntry[],
  baseline: BaselineDocument,
): CompareSummary {
  const optional = baseline.optional ?? [];
  const ignored = baseline.ignored ?? [];
  const optionalPatterns = compilePatterns(baseline.optionalPatterns ?? []);
  const ignoredPatterns = compilePatterns(baseline.ignoredPatterns ?? []);

  const optionalKeys = new Set(optional.map((entry) => normalizeTitle(entry.title)).filter(Boolean));
  const ignoredKeys = new Set(ignored.map(normalizeTitle).filter(Boolean));

  const shouldIgnoreTitle = (title: string): boolean => {
    const key = normalizeTitle(title);
    if (!key) {
      return true;
    }
    if (optionalKeys.has(key) || ignoredKeys.has(key)) {
      return true;
    }
    if (optionalPatterns.some((pattern) => pattern.test(title))) {
      return true;
    }
    if (ignoredPatterns.some((pattern) => pattern.test(title))) {
      return true;
    }
    return false;
  };

  const expectedMap = new Map<string, BaselineEntry>();
  const expectedOrderKeys: string[] = [];
  for (const entry of predicted) {
    const key = normalizeTitle(entry.title);
    if (!key || expectedMap.has(key)) {
      continue;
    }
    expectedMap.set(key, entry);
    expectedOrderKeys.push(key);
  }

  const actualMap = new Map<string, BaselineEntry>();
  const actualOrderKeys: string[] = [];
  for (const entry of actual) {
    const key = normalizeTitle(entry.title);
    if (!key || actualMap.has(key)) {
      continue;
    }
    actualMap.set(key, entry);
    actualOrderKeys.push(key);
  }

  const missingTitles: string[] = [];
  for (const entry of predicted) {
    const key = normalizeTitle(entry.title);
    if (!key || shouldIgnoreTitle(entry.title)) {
      continue;
    }
    if (!actualMap.has(key)) {
      missingTitles.push(entry.title);
    }
  }

  const extraTitles: string[] = [];
  for (const entry of actual) {
    const key = normalizeTitle(entry.title);
    if (!key || expectedMap.has(key) || shouldIgnoreTitle(entry.title)) {
      continue;
    }
    extraTitles.push(entry.title);
  }

  const expectedCoreKeys = expectedOrderKeys.filter((key) => !shouldIgnoreTitle(expectedMap.get(key)?.title ?? ""));
  const actualProjectedKeys = actualOrderKeys.filter((key) => expectedCoreKeys.includes(key));
  const orderMismatches: Array<{ title: string; expectedIndex: number; actualIndex: number }> = [];
  for (let expectedIndex = 0; expectedIndex < expectedCoreKeys.length; expectedIndex += 1) {
    const key = expectedCoreKeys[expectedIndex];
    const actualIndex = actualProjectedKeys.indexOf(key);
    if (actualIndex < 0) {
      continue;
    }
    if (actualIndex !== expectedIndex) {
      orderMismatches.push({
        title: expectedMap.get(key)?.title ?? key,
        expectedIndex,
        actualIndex,
      });
    }
  }

  const submenuMismatches: Array<{ title: string; expectedSubmenu: boolean; actualSubmenu: boolean }> = [];
  const disabledMismatches: Array<{ title: string; expectedDisabled: boolean; actualDisabled: boolean }> = [];
  for (const entry of predicted) {
    if (shouldIgnoreTitle(entry.title)) {
      continue;
    }
    const key = normalizeTitle(entry.title);
    const actualEntry = actualMap.get(key);
    if (!actualEntry) {
      continue;
    }
    if (entry.submenu !== undefined) {
      const actualSubmenu = Boolean(actualEntry.submenu);
      if (actualSubmenu !== entry.submenu) {
        submenuMismatches.push({
          title: entry.title,
          expectedSubmenu: entry.submenu,
          actualSubmenu,
        });
      }
    }
    if (entry.disabled !== undefined) {
      const actualDisabled = Boolean(actualEntry.disabled);
      if (actualDisabled !== entry.disabled) {
        disabledMismatches.push({
          title: entry.title,
          expectedDisabled: entry.disabled,
          actualDisabled,
        });
      }
    }
  }

  return {
    expectedCount: expectedMap.size,
    actualCount: actualMap.size,
    missingTitles,
    extraTitles,
    orderMismatches,
    submenuMismatches,
    disabledMismatches,
  };
}

function printTextReport(
  baseline: BaselineDocument,
  visual: VisualExtractResult,
  summary: CompareSummary,
): void {
  console.log(
    `stage6-visual-diff: mode=${baseline.mode ?? "combined"} location=${baseline.locationType} expected=${summary.expectedCount} actual=${summary.actualCount}`,
  );
  console.log(`visual-ocr-lines=${visual.debug.lineCount} mean-confidence=${visual.debug.meanOcrConfidence}`);
  console.log(`missing(${summary.missingTitles.length}): ${summary.missingTitles.join(" | ") || "-"}`);
  console.log(`extra(${summary.extraTitles.length}): ${summary.extraTitles.join(" | ") || "-"}`);
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
  if (summary.disabledMismatches.length === 0) {
    console.log("disabled-mismatch(0): -");
  } else {
    console.log(`disabled-mismatch(${summary.disabledMismatches.length}):`);
    for (const mismatch of summary.disabledMismatches) {
      console.log(
        `  - ${mismatch.title}: expected disabled=${mismatch.expectedDisabled}, actual disabled=${mismatch.actualDisabled}`,
      );
    }
  }
  console.log("stage6-visual-diff: OK");
}

async function run(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const baseline = await loadBaseline(args.baselinePath);
  const predicted = await loadPredictedEntries(baseline, args.shiftKey, args.samplePath);
  const visual = await extractMenuFromScreenshot(args.imagePath, { lang: "eng" });
  const actual = toTopLevelVisual(visual.entries);
  const summary = compareMenus(predicted, actual, baseline);

  const payload = {
    baseline: {
      locationType: baseline.locationType,
      mode: baseline.mode ?? "combined",
    },
    imagePath: args.imagePath,
    ocr: visual.debug,
    predicted,
    actual,
    summary,
  };

  if (args.jsonOnly) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  printTextReport(baseline, visual, summary);
}

void run();
