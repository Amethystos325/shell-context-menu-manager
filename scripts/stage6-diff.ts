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

type DiffMode = "snapshot" | "combined";

interface BaselineEntry {
  title: string;
  submenu?: boolean;
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
}

interface CompareSummary {
  expectedCount: number;
  actualCount: number;
  missingTitles: string[];
  extraTitles: string[];
  orderMismatches: Array<{ title: string; expectedIndex: number; actualIndex: number }>;
  submenuMismatches: Array<{ title: string; expectedSubmenu: boolean; actualSubmenu: boolean }>;
}

interface CliArgs {
  baselinePath: string;
  samplePath: string;
  shiftKey: boolean;
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
    }))
    .filter((entry) => entry.title.length > 0);
}

function parseArgs(argv: string[]): CliArgs {
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

  const expected = normalizeBaselineEntries(parsed.expected);
  if (expected.length === 0) {
    throw new Error("Invalid baseline: expected entries are empty.");
  }

  const mode: DiffMode = parsed.mode === "snapshot" ? "snapshot" : "combined";
  const configPath =
    typeof parsed.configPath === "string" && parsed.configPath.trim().length > 0
      ? parsed.configPath.trim()
      : "res/shell.nss";

  return {
    locationType: parsed.locationType as PreviewLocationType,
    mode,
    configPath,
    selectionName:
      typeof parsed.selectionName === "string" && parsed.selectionName.trim().length > 0
        ? parsed.selectionName.trim()
        : undefined,
    selectionCount:
      typeof parsed.selectionCount === "number" && Number.isFinite(parsed.selectionCount)
        ? Math.max(0, Math.floor(parsed.selectionCount))
        : undefined,
    expected,
    optional: normalizeBaselineEntries(parsed.optional),
    ignored: Array.isArray(parsed.ignored)
      ? parsed.ignored
          .map((item) => String(item).trim())
          .filter((item) => item.length > 0)
      : [],
  };
}

function toTopLevelSystem(entries: SystemMenuEntry[]): BaselineEntry[] {
  return entries
    .map((entry) => ({
      title: entry.title.trim(),
      submenu: entry.submenu,
    }))
    .filter((entry) => entry.title.length > 0);
}

function toTopLevelPreview(entries: RuntimePreviewEntry[]): BaselineEntry[] {
  return entries
    .filter((entry) => entry.kind !== "separator")
    .map((entry) => ({
      title: entry.title.trim(),
      submenu: entry.kind === "menu" || Boolean(entry.submenu),
    }))
    .filter((entry) => entry.title.length > 0);
}

function toRuntimeSystemMenuEntries(entries: SystemMenuEntry[]): RuntimeSystemMenuEntry[] {
  return entries
    .map((entry) => ({
      title: entry.title,
      submenu: entry.submenu,
      disabled: Boolean(entry.disabled),
      children: toRuntimeSystemMenuEntries(entry.children ?? []),
    }))
    .filter((entry) => entry.title.trim().length > 0);
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
        const imported = await readFile(importFilePath, "utf-8");
        const parsed = parseAndValidate(imported);
        if (!parsed.document) {
          continue;
        }
        const nested = await expandNodes(parsed.document.nodes, importFilePath);
        output.push(...nested);
      } catch {
        // Keep stage6-diff stable even if some optional import files are missing.
      }
    }

    return output;
  };

  const expanded = await expandNodes(document.nodes, hostFilePath);
  return { nodes: expanded };
}

async function loadCombinedTopLevelEntries(
  baseline: BaselineDocument,
  snapshotEntries: SystemMenuEntry[],
  shiftKey: boolean,
  samplePath: string,
): Promise<BaselineEntry[]> {
  const configPath = path.resolve(process.cwd(), baseline.configPath ?? "res/shell.nss");
  const source = await readFile(configPath, "utf-8");
  const parsed = parseAndValidate(source);
  if (!parsed.document) {
    throw new Error(`Failed to parse config: ${configPath}`);
  }

  const mergedDocument = await resolveDocumentWithImports(parsed.document, configPath);
  const runtimeSystemEntries = toRuntimeSystemMenuEntries(snapshotEntries);

  const context: RuntimePreviewContext = {
    locationType: baseline.locationType,
    selectionCount:
      baseline.selectionCount ?? getRecommendedSelectionCount(baseline.locationType),
    selectionName:
      samplePath.trim() ||
      baseline.selectionName ||
      getDefaultSelectionName(baseline.locationType),
    shiftKey,
    leftButton: false,
    hasAdmin: false,
    backgroundMode: baseline.locationType === "desktop" || baseline.locationType === "back",
    clipboardHasContent: false,
    currentPath: samplePath.trim() || undefined,
    systemMenuEntries: runtimeSystemEntries,
  };

  const preview = buildRuntimePreview(mergedDocument, context);
  return toTopLevelPreview(preview.combinedEntries);
}

function compareMenus(
  expected: BaselineEntry[],
  actual: BaselineEntry[],
  optional: BaselineEntry[] = [],
  ignored: string[] = [],
): CompareSummary {
  const expectedMap = new Map<string, BaselineEntry>();
  const expectedOrderKeys: string[] = [];
  for (const entry of expected) {
    const key = normalizeTitle(entry.title);
    if (!key || expectedMap.has(key)) {
      continue;
    }
    expectedMap.set(key, entry);
    expectedOrderKeys.push(key);
  }

  const optionalKeys = new Set(optional.map((entry) => normalizeTitle(entry.title)).filter(Boolean));
  const ignoredKeys = new Set(ignored.map(normalizeTitle).filter(Boolean));

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
  for (const entry of expected) {
    const key = normalizeTitle(entry.title);
    if (!actualMap.has(key)) {
      missingTitles.push(entry.title);
    }
  }

  const extraTitles: string[] = [];
  for (const entry of actual) {
    const key = normalizeTitle(entry.title);
    if (expectedMap.has(key) || optionalKeys.has(key) || ignoredKeys.has(key)) {
      continue;
    }
    extraTitles.push(entry.title);
  }

  const projectedActualExpectedKeys = actualOrderKeys.filter((key) => expectedMap.has(key));
  const orderMismatches: Array<{ title: string; expectedIndex: number; actualIndex: number }> = [];
  for (let expectedIndex = 0; expectedIndex < expectedOrderKeys.length; expectedIndex += 1) {
    const key = expectedOrderKeys[expectedIndex];
    const actualIndex = projectedActualExpectedKeys.indexOf(key);
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
    expectedCount: expectedMap.size,
    actualCount: actualMap.size,
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

  const actualTopLevel =
    baseline.mode === "snapshot"
      ? toTopLevelSystem(snapshot.entries)
      : await loadCombinedTopLevelEntries(
          baseline,
          snapshot.entries,
          args.shiftKey,
          args.samplePath,
        );

  const summary = compareMenus(
    baseline.expected,
    actualTopLevel,
    baseline.optional,
    baseline.ignored,
  );

  console.log(
    `stage6-diff: mode=${baseline.mode} location=${baseline.locationType} shift=${args.shiftKey} expected=${summary.expectedCount} actual=${summary.actualCount}`,
  );
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
  console.log("stage6-diff: OK");
}

void run();
