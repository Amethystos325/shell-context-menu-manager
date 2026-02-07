import type { Attribute, ConfigDocument, ConfigNode } from "../core/types.js";

export type PreviewLocationType = "desktop" | "file" | "dir" | "drive" | "back" | "taskbar";

export interface RuntimePreviewContext {
  locationType: PreviewLocationType;
  selectionCount: number;
  selectionName: string;
  shiftKey: boolean;
  leftButton: boolean;
  hasAdmin: boolean;
}

export interface RuntimePreviewEntry {
  id: string;
  kind: "menu" | "item" | "separator";
  title: string;
  source: "system" | "shell";
  labelOnly?: boolean;
  children?: RuntimePreviewEntry[];
}

export interface RuntimePreviewRuleStats {
  totalRules: number;
  activeRules: number;
  removedItems: number;
  modifiedItems: number;
  uncertainRules: number;
}

export interface RuntimePreviewResult {
  systemEntries: RuntimePreviewEntry[];
  shellEntries: RuntimePreviewEntry[];
  combinedEntries: RuntimePreviewEntry[];
  ruleStats: RuntimePreviewRuleStats;
}

type AttributedNode = Extract<ConfigNode, { attributes: Attribute[] }>;

interface ConditionEval {
  matched: boolean;
  uncertain: boolean;
}

interface VisibilityEval extends ConditionEval {
  labelOnly: boolean;
}

interface SystemItemState {
  id: string;
  title: string;
  index: number;
  orderHint: number;
  hidden: boolean;
  labelOnly: boolean;
  menuGroup: string;
}

const KNOWN_VIS_HIDDEN = new Set(["hidden", "hide", "vis.hidden"]);
const KNOWN_VIS_LABEL = new Set(["label", "vis.label"]);

const DEFAULT_SYSTEM_ITEMS: Record<PreviewLocationType, string[]> = {
  desktop: [
    "View",
    "Sort by",
    "Refresh",
    "Paste",
    "Undo Copy",
    "Open with Code",
    "Open Git Bash here",
    "NVIDIA App",
    "NVIDIA Control Panel",
    "New",
    "Display settings",
    "Personalize",
  ],
  file: [
    "Open",
    "Open with",
    "Copy",
    "Cut",
    "Delete",
    "Rename",
    "Properties",
  ],
  dir: [
    "Open",
    "Open in Terminal",
    "Pin to Quick access",
    "Copy",
    "Cut",
    "Delete",
    "Rename",
    "Properties",
  ],
  drive: [
    "Open",
    "Open in new window",
    "Pin to Quick access",
    "Format",
    "Eject",
    "Properties",
  ],
  back: [
    "View",
    "Sort by",
    "Group by",
    "Refresh",
    "Paste",
    "New",
    "Properties",
  ],
  taskbar: [
    "Toolbars",
    "Search",
    "Task Manager",
    "Taskbar settings",
  ],
};

const DEFAULT_SELECTION_NAME: Record<PreviewLocationType, string> = {
  desktop: "Desktop",
  file: "example.txt",
  dir: "example-folder",
  drive: "C:",
  back: "This folder",
  taskbar: "Taskbar",
};

export const DEFAULT_RUNTIME_PREVIEW_CONTEXT: RuntimePreviewContext = {
  locationType: "file",
  selectionCount: 2,
  selectionName: DEFAULT_SELECTION_NAME.file,
  shiftKey: false,
  leftButton: false,
  hasAdmin: false,
};

export function getDefaultSelectionName(locationType: PreviewLocationType): string {
  return DEFAULT_SELECTION_NAME[locationType];
}

export function getRecommendedSelectionCount(locationType: PreviewLocationType): number {
  if (locationType === "desktop" || locationType === "taskbar") {
    return 0;
  }
  return 2;
}

function isAttributedNode(node: ConfigNode): node is AttributedNode {
  return "attributes" in node;
}

function getAttribute(node: AttributedNode, key: string): Attribute | undefined {
  const normalized = key.toLowerCase();
  return node.attributes.find((attr) => attr.key.toLowerCase() === normalized);
}

function getAttributeText(node: AttributedNode, key: string): string {
  const attr = getAttribute(node, key);
  if (!attr) {
    return "";
  }
  if (attr.value.kind === "string") {
    return String(attr.value.value).trim();
  }
  return String(attr.value.raw ?? attr.value.value ?? "").trim();
}

function stripQuotes(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith("\"") && trimmed.endsWith("\"")) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function normalizeToken(input: string): string {
  return stripQuotes(input).toLowerCase().trim();
}

function parsePipePatterns(input: string): string[] {
  return stripQuotes(input)
    .split("|")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

function toWildcardRegex(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`, "i");
}

function matchesAnyPattern(value: string, patterns: string[]): boolean {
  const trimmed = value.trim();
  if (!trimmed || patterns.length === 0) {
    return false;
  }

  return patterns.some((pattern) => {
    const normalized = stripQuotes(pattern).trim();
    if (!normalized) {
      return false;
    }
    if (normalized.startsWith(".") && !normalized.includes("*")) {
      return trimmed.toLowerCase().endsWith(normalized.toLowerCase());
    }
    return toWildcardRegex(normalized).test(trimmed);
  });
}

function hasOrOperator(expression: string): boolean {
  const lower = expression.toLowerCase();
  return lower.includes("||") || /\bor\b/.test(lower);
}

function evaluateSelCountComparisons(expression: string, selectionCount: number): ConditionEval | null {
  const checks = [...expression.matchAll(/sel\.count\s*(==|!=|>=|<=|>|<)\s*(\d+)/gi)];
  if (checks.length === 0) {
    return null;
  }

  const results = checks.map((match) => {
    const operator = match[1];
    const value = Number(match[2]);
    if (Number.isNaN(value)) {
      return false;
    }
    if (operator === "==") {
      return selectionCount === value;
    }
    if (operator === "!=") {
      return selectionCount !== value;
    }
    if (operator === ">=") {
      return selectionCount >= value;
    }
    if (operator === "<=") {
      return selectionCount <= value;
    }
    if (operator === ">") {
      return selectionCount > value;
    }
    return selectionCount < value;
  });

  const matched = hasOrOperator(expression) ? results.some(Boolean) : results.every(Boolean);
  return { matched, uncertain: false };
}

function evaluateKnownBooleanSignals(expression: string, context: RuntimePreviewContext): ConditionEval {
  const normalized = expression.toLowerCase();
  const checks: boolean[] = [];
  let uncertain = false;

  const pushTokenCheck = (token: string, value: boolean) => {
    const negated = normalized.includes(`!${token}`);
    const direct = normalized.includes(token);
    if (negated) {
      checks.push(!value);
    } else if (direct) {
      checks.push(value);
    }
  };

  pushTokenCheck("wnd.is_desktop", context.locationType === "desktop");
  pushTokenCheck("window.is_desktop", context.locationType === "desktop");
  pushTokenCheck("wnd.is_taskbar", context.locationType === "taskbar");
  pushTokenCheck("window.is_taskbar", context.locationType === "taskbar");
  pushTokenCheck("wnd.is_edit", false);
  pushTokenCheck("window.is_edit", false);
  pushTokenCheck("key.shift()", context.shiftKey);
  pushTokenCheck("key.shift", context.shiftKey);
  pushTokenCheck("key.lbutton()", context.leftButton);
  pushTokenCheck("key.lbutton", context.leftButton);
  pushTokenCheck("has_admin", context.hasAdmin);

  const countEval = evaluateSelCountComparisons(normalized, context.selectionCount);
  if (countEval) {
    checks.push(countEval.matched);
  } else if (normalized.includes("sel.count")) {
    const negated = normalized.includes("!sel.count");
    checks.push(negated ? context.selectionCount === 0 : context.selectionCount > 0);
  }

  const maybeUnknownMarkers = [
    "this.",
    "package.",
    "str.",
    "sys.",
    "io.",
    "command.",
    "id.",
    "@(",
    "sel.type",
    "sel.file",
    "sel.parent",
  ];

  if (maybeUnknownMarkers.some((marker) => normalized.includes(marker))) {
    uncertain = true;
  }

  if (checks.length === 0) {
    return { matched: true, uncertain };
  }

  if (hasOrOperator(normalized)) {
    if (checks.some(Boolean)) {
      return { matched: true, uncertain };
    }
    if (uncertain) {
      return { matched: true, uncertain: true };
    }
    return { matched: false, uncertain: false };
  }

  if (checks.every(Boolean)) {
    return { matched: true, uncertain };
  }

  return { matched: false, uncertain };
}

function matchesMode(modeText: string, context: RuntimePreviewContext): ConditionEval {
  const normalized = normalizeToken(modeText);
  if (!normalized) {
    return { matched: true, uncertain: false };
  }

  const wantsMultiple = normalized.includes("multiple") || normalized.includes("mode.multiple");
  const wantsSingle = normalized.includes("single") || normalized.includes("mode.single");

  if (wantsMultiple && !wantsSingle) {
    return { matched: context.selectionCount > 1, uncertain: false };
  }

  if (wantsSingle && !wantsMultiple) {
    return { matched: context.selectionCount === 1, uncertain: false };
  }

  return { matched: true, uncertain: true };
}

function expandContextTypes(locationType: PreviewLocationType): string[] {
  if (locationType === "desktop") {
    return ["desktop", "back", "namespace"];
  }
  if (locationType === "back") {
    return ["back", "dir.back", "drive.back"];
  }
  if (locationType === "file") {
    return ["file"];
  }
  if (locationType === "dir") {
    return ["dir", "back.dir"];
  }
  if (locationType === "drive") {
    return ["drive", "back.drive", "drive.back"];
  }
  return ["taskbar"];
}

function typeTokenMatches(ruleToken: string, ctxToken: string): boolean {
  if (ruleToken === "*" || ruleToken === "all") {
    return true;
  }

  if (ruleToken === ctxToken) {
    return true;
  }

  const a = new Set(ruleToken.split(".").filter(Boolean));
  const b = new Set(ctxToken.split(".").filter(Boolean));
  if (a.size === 0 || b.size === 0) {
    return false;
  }

  const aInB = [...a].every((part) => b.has(part));
  const bInA = [...b].every((part) => a.has(part));
  return aInB || bInA;
}

function matchesType(typeText: string, context: RuntimePreviewContext): ConditionEval {
  const normalized = normalizeToken(typeText);
  if (!normalized) {
    return { matched: true, uncertain: false };
  }

  const tokens = parsePipePatterns(normalized).map(normalizeToken);
  if (tokens.length === 0) {
    return { matched: true, uncertain: true };
  }

  const candidates = expandContextTypes(context.locationType);
  const matched = tokens.some((token) => candidates.some((candidate) => typeTokenMatches(token, candidate)));
  return { matched, uncertain: false };
}

function evaluateNodeContext(node: AttributedNode, context: RuntimePreviewContext): ConditionEval {
  const typeEval = matchesType(getAttributeText(node, "type"), context);
  if (!typeEval.matched) {
    return typeEval;
  }

  const modeEval = matchesMode(getAttributeText(node, "mode"), context);
  if (!modeEval.matched) {
    return modeEval;
  }

  const whereText = getAttributeText(node, "where");
  if (!whereText) {
    return { matched: true, uncertain: typeEval.uncertain || modeEval.uncertain };
  }

  const whereEval = evaluateKnownBooleanSignals(whereText, context);
  return {
    matched: whereEval.matched,
    uncertain: typeEval.uncertain || modeEval.uncertain || whereEval.uncertain,
  };
}

function evaluateVisibility(node: AttributedNode, context: RuntimePreviewContext): VisibilityEval {
  const base = evaluateNodeContext(node, context);
  if (!base.matched) {
    return { ...base, labelOnly: false };
  }

  const visText = getAttributeText(node, "vis");
  if (!visText) {
    return { ...base, labelOnly: false };
  }

  const normalized = normalizeToken(visText);
  if (KNOWN_VIS_HIDDEN.has(normalized)) {
    return { matched: false, uncertain: false, labelOnly: false };
  }
  if (KNOWN_VIS_LABEL.has(normalized)) {
    return { matched: true, uncertain: base.uncertain, labelOnly: true };
  }

  const visEval = evaluateKnownBooleanSignals(visText, context);
  return {
    matched: visEval.matched,
    uncertain: base.uncertain || visEval.uncertain,
    labelOnly: false,
  };
}

function titleOfNode(node: AttributedNode): string {
  const title = getAttributeText(node, "title");
  if (title) {
    return stripQuotes(title);
  }
  if (node.kind === "separator") {
    return "separator";
  }
  return `[${node.kind}]`;
}

function parseFindPatterns(node: AttributedNode): string[] {
  const find = getAttributeText(node, "find");
  if (!find) {
    return [];
  }
  return parsePipePatterns(find);
}

function includeByFind(node: AttributedNode, context: RuntimePreviewContext): boolean {
  const patterns = parseFindPatterns(node);
  if (patterns.length === 0) {
    return true;
  }
  return matchesAnyPattern(context.selectionName, patterns);
}

function toShellPreviewNode(node: ConfigNode, context: RuntimePreviewContext): RuntimePreviewEntry | null {
  if (!isAttributedNode(node)) {
    return null;
  }

  if (node.kind !== "menu" && node.kind !== "item" && node.kind !== "separator") {
    return null;
  }

  const visibility = evaluateVisibility(node, context);
  if (!visibility.matched || !includeByFind(node, context)) {
    return null;
  }

  if (node.kind === "menu") {
    const children = node.children
      .map((child) => toShellPreviewNode(child, context))
      .filter((child): child is RuntimePreviewEntry => Boolean(child));
    if (children.length === 0) {
      return null;
    }
    return {
      id: node.id,
      kind: "menu",
      title: titleOfNode(node),
      source: "shell",
      labelOnly: visibility.labelOnly,
      children,
    };
  }

  return {
    id: node.id,
    kind: node.kind,
    title: titleOfNode(node),
    source: "shell",
    labelOnly: visibility.labelOnly,
  };
}

function collectRules(nodes: ConfigNode[], context: RuntimePreviewContext): {
  activeRules: Array<Extract<ConfigNode, { kind: "modify" | "remove" }>>;
  totalRules: number;
  uncertainRules: number;
  activeCount: number;
} {
  const queue = [...nodes];
  const activeRules: Array<Extract<ConfigNode, { kind: "modify" | "remove" }>> = [];
  let totalRules = 0;
  let uncertainRules = 0;

  while (queue.length > 0) {
    const node = queue.shift();
    if (!node) {
      continue;
    }

    if (node.kind === "menu") {
      queue.push(...node.children);
      continue;
    }

    if (node.kind !== "modify" && node.kind !== "remove") {
      continue;
    }

    totalRules += 1;
    const evaluation = evaluateNodeContext(node, context);
    if (evaluation.uncertain) {
      uncertainRules += 1;
    }
    if (evaluation.matched) {
      activeRules.push(node);
    }
  }

  return {
    activeRules,
    totalRules,
    uncertainRules,
    activeCount: activeRules.length,
  };
}

function computeOrderHint(rawPosition: string, fallback: number): number {
  const normalized = normalizeToken(rawPosition);
  if (!normalized) {
    return fallback;
  }
  if (normalized.includes("top") || normalized.includes("before")) {
    return -1000 + fallback;
  }
  if (normalized.includes("bottom") || normalized.includes("after")) {
    return 1000 + fallback;
  }
  const numeric = Number(normalized);
  if (!Number.isNaN(numeric)) {
    return numeric;
  }
  return fallback;
}

function computeShellTopLevelHint(node: ConfigNode, index: number): number {
  if (!isAttributedNode(node)) {
    return 2000 + index;
  }

  const position = getAttributeText(node, "pos") || getAttributeText(node, "position");
  if (position) {
    const token = normalizeToken(position);
    if (token.includes("top") || token.includes("before")) {
      return -2000 + index;
    }
    if (token.includes("bottom") || token.includes("after")) {
      return 4000 + index;
    }
    const numeric = Number(token);
    if (!Number.isNaN(numeric)) {
      return numeric;
    }
  }

  const sep = getAttributeText(node, "sep") || getAttributeText(node, "separator");
  if (sep) {
    const token = normalizeToken(sep);
    if (token.includes("top") || token.includes("before")) {
      return -1500 + index;
    }
    if (token.includes("bottom") || token.includes("after")) {
      return 3500 + index;
    }
  }

  return 2000 + index;
}

function buildCombinedEntries(
  systemEntries: RuntimePreviewEntry[],
  shellTopEntries: Array<{ entry: RuntimePreviewEntry; hint: number; order: number }>,
): RuntimePreviewEntry[] {
  const combined: Array<{ entry: RuntimePreviewEntry; hint: number; order: number }> = [];
  for (let index = 0; index < systemEntries.length; index += 1) {
    combined.push({
      entry: systemEntries[index],
      hint: index,
      order: index,
    });
  }

  combined.push(...shellTopEntries);
  combined.sort((a, b) => (a.hint === b.hint ? a.order - b.order : a.hint - b.hint));
  return combined.map((item) => item.entry);
}

function applyRulesToSystemItems(
  context: RuntimePreviewContext,
  rules: Array<Extract<ConfigNode, { kind: "modify" | "remove" }>>,
): { entries: RuntimePreviewEntry[]; removedItems: number; modifiedItems: number } {
  const baseTitles = DEFAULT_SYSTEM_ITEMS[context.locationType] ?? [];
  const states: SystemItemState[] = baseTitles.map((title, index) => ({
    id: `system-${index}`,
    title,
    index,
    orderHint: index,
    hidden: false,
    labelOnly: false,
    menuGroup: "",
  }));

  let removedItems = 0;
  let modifiedItems = 0;

  for (const rule of rules) {
    const findPatterns = parseFindPatterns(rule);
    if (findPatterns.length === 0) {
      continue;
    }

    for (const item of states) {
      if (item.hidden) {
        continue;
      }
      if (!matchesAnyPattern(item.title, findPatterns)) {
        continue;
      }

      if (rule.kind === "remove") {
        item.hidden = true;
        removedItems += 1;
        continue;
      }

      modifiedItems += 1;

      const title = getAttributeText(rule, "title");
      if (title) {
        item.title = stripQuotes(title);
      }

      const menu = getAttributeText(rule, "menu");
      if (menu) {
        item.menuGroup = stripQuotes(menu);
      }

      const position = getAttributeText(rule, "pos") || getAttributeText(rule, "position");
      if (position) {
        item.orderHint = computeOrderHint(position, item.index);
      }

      const visText = getAttributeText(rule, "vis");
      if (visText) {
        const vis = normalizeToken(visText);
        if (KNOWN_VIS_HIDDEN.has(vis)) {
          item.hidden = true;
        }
        if (KNOWN_VIS_LABEL.has(vis)) {
          item.labelOnly = true;
        }
      }
    }
  }

  const visible = states
    .filter((item) => !item.hidden)
    .sort((a, b) => (a.orderHint === b.orderHint ? a.index - b.index : a.orderHint - b.orderHint));

  const grouped = new Map<string, RuntimePreviewEntry[]>();
  const directItems: RuntimePreviewEntry[] = [];

  for (const item of visible) {
    const entry: RuntimePreviewEntry = {
      id: item.id,
      kind: "item",
      title: item.title,
      source: "system",
      labelOnly: item.labelOnly,
    };
    if (!item.menuGroup) {
      directItems.push(entry);
      continue;
    }
    const group = grouped.get(item.menuGroup) ?? [];
    group.push(entry);
    grouped.set(item.menuGroup, group);
  }

  const groupedMenus = [...grouped.entries()].map(([groupTitle, children], index) => ({
    id: `system-group-${index}`,
    kind: "menu" as const,
    title: groupTitle,
    source: "system" as const,
    children,
  }));

  return {
    entries: [...directItems, ...groupedMenus],
    removedItems,
    modifiedItems,
  };
}

export function buildRuntimePreview(
  document: ConfigDocument,
  context: RuntimePreviewContext,
): RuntimePreviewResult {
  const clampedSelectionCount = Math.max(0, Math.floor(context.selectionCount));
  const normalizedContext: RuntimePreviewContext = {
    ...context,
    selectionCount: clampedSelectionCount,
    selectionName: context.selectionName.trim() || getDefaultSelectionName(context.locationType),
  };

  const ruleCollection = collectRules(document.nodes, normalizedContext);
  const system = applyRulesToSystemItems(normalizedContext, ruleCollection.activeRules);

  const shellTopEntries = document.nodes
    .map((node, index) => {
      const entry = toShellPreviewNode(node, normalizedContext);
      if (!entry) {
        return null;
      }
      return {
        entry,
        hint: computeShellTopLevelHint(node, index),
        order: 10000 + index,
      };
    })
    .filter((item): item is { entry: RuntimePreviewEntry; hint: number; order: number } => Boolean(item));

  const shellEntries = shellTopEntries.map((item) => item.entry);
  const combinedEntries = buildCombinedEntries(system.entries, shellTopEntries);

  return {
    systemEntries: system.entries,
    shellEntries,
    combinedEntries,
    ruleStats: {
      totalRules: ruleCollection.totalRules,
      activeRules: ruleCollection.activeCount,
      removedItems: system.removedItems,
      modifiedItems: system.modifiedItems,
      uncertainRules: ruleCollection.uncertainRules,
    },
  };
}
