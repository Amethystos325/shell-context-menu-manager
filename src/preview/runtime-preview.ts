import type { Attribute, ConfigDocument, ConfigNode } from "../core/types.js";

export type PreviewLocationType = "desktop" | "file" | "dir" | "drive" | "back" | "taskbar";

export interface RuntimePreviewContext {
  locationType: PreviewLocationType;
  selectionCount: number;
  selectionName: string;
  currentPath?: string;
  backgroundMode?: boolean;
  shiftKey: boolean;
  leftButton: boolean;
  hasAdmin: boolean;
  clipboardHasContent?: boolean;
  systemItemsOverride?: string[];
  systemSubmenuTitles?: string[];
  systemMenuEntries?: RuntimeSystemMenuEntry[];
}

export interface RuntimeSystemMenuEntry {
  title: string;
  submenu?: boolean;
  disabled?: boolean;
  children?: RuntimeSystemMenuEntry[];
}

export interface RuntimePreviewEntry {
  id: string;
  kind: "menu" | "item" | "separator";
  title: string;
  source: "system" | "shell";
  labelOnly?: boolean;
  disabled?: boolean;
  submenu?: boolean;
  separatorBefore?: boolean;
  separatorAfter?: boolean;
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
  disabled: boolean;
}

interface SystemItemState {
  id: string;
  title: string;
  index: number;
  orderHint: number;
  hidden: boolean;
  labelOnly: boolean;
  disabled: boolean;
  submenu: boolean;
  children: RuntimePreviewEntry[];
  menuGroup: string;
}

const KNOWN_VIS_HIDDEN = new Set(["hidden", "hide", "vis.hidden"]);
const KNOWN_VIS_LABEL = new Set(["label", "vis.label"]);
const KNOWN_VIS_DISABLED = new Set(["disabled", "disable", "vis.disabled"]);

const DEFAULT_SYSTEM_ITEMS: Record<PreviewLocationType, string[]> = {
  desktop: [
    "View",
    "Sort by",
    "Refresh",
    "Paste",
    "Undo Copy",
    "Open with Code",
    "Open Git Bash here",
    "Open Folder as IntelliJ IDEA Community Edition Project",
    "Open Folder as WebStorm Project",
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

const DESKTOP_ORDER_HINTS: Record<string, number> = {
  view: 10,
  "sort by": 20,
  refresh: 30,
  paste: 100,
  "undo copy": 110,
  "open with code": 120,
  "open git bash here": 130,
  "open folder as intellij idea community edition project": 140,
  "open folder as webstorm project": 150,
  terminal: 240,
  "file manage": 250,
  "go to": 260,
  "nvidia app": 340,
  "nvidia control panel": 350,
  new: 450,
  "display settings": 460,
  personalize: 470,
};

const DESKTOP_SUBMENU_TITLES = new Set(["view", "sort by", "new"]);
const BACKGROUND_SUBMENU_TITLES = new Set(["view", "sort by", "group by", "new"]);

function isSystemSubmenuTitle(context: RuntimePreviewContext, title: string): boolean {
  const normalized = normalizeToken(title);
  const override = new Set((context.systemSubmenuTitles ?? []).map(normalizeToken));
  if (override.has(normalized)) {
    return true;
  }
  if (context.locationType === "desktop") {
    return DESKTOP_SUBMENU_TITLES.has(normalized);
  }
  if (context.locationType === "back") {
    return BACKGROUND_SUBMENU_TITLES.has(normalized);
  }
  return false;
}

const DEFAULT_SELECTION_NAME: Record<PreviewLocationType, string> = {
  desktop: "Desktop",
  file: "example.txt",
  dir: "example-folder",
  drive: "C:",
  back: "This folder",
  taskbar: "Taskbar",
};

export const DEFAULT_RUNTIME_PREVIEW_CONTEXT: RuntimePreviewContext = {
  locationType: "desktop",
  selectionCount: 1,
  selectionName: DEFAULT_SELECTION_NAME.desktop,
  backgroundMode: true,
  shiftKey: false,
  leftButton: false,
  hasAdmin: false,
};

export function getDefaultSelectionName(locationType: PreviewLocationType): string {
  return DEFAULT_SELECTION_NAME[locationType];
}

export function getDefaultSystemItems(locationType: PreviewLocationType): string[] {
  return [...(DEFAULT_SYSTEM_ITEMS[locationType] ?? [])];
}

export function getRecommendedSelectionCount(locationType: PreviewLocationType): number {
  if (locationType === "taskbar") {
    return 0;
  }
  if (locationType === "desktop" || locationType === "back") {
    return 1;
  }
  return 1;
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

function toTitleCaseWords(text: string): string {
  return text
    .split(" ")
    .filter((part) => part.trim().length > 0)
    .map((part) => part[0].toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

function humanizeToken(token: string): string {
  const target = token.split(".").filter(Boolean).pop() ?? token;
  const normalized = target
    .replace(/^@+/, "")
    .replace(/[_-]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .trim();
  if (!normalized) {
    return token;
  }
  return toTitleCaseWords(normalized);
}

function extractFirstQuotedLiteral(expression: string): string | null {
  const match = expression.match(/"([^"\\]*(?:\\.[^"\\]*)*)"|'([^'\\]*(?:\\.[^'\\]*)*)'/);
  if (!match) {
    return null;
  }
  const literal = match[1] ?? match[2] ?? "";
  return literal.replace(/\\t/g, " ").replace(/\\n/g, " ").trim();
}

function resolveDisplayText(rawText: string): string {
  const trimmed = stripQuotes(rawText).trim();
  if (!trimmed) {
    return "";
  }

  const titleRef = trimmed.match(/\btitle\.([A-Za-z0-9_.-]+)/i);
  if (titleRef) {
    return humanizeToken(titleRef[1]);
  }

  if (/^[A-Za-z_@][A-Za-z0-9_.@-]*$/.test(trimmed)) {
    return humanizeToken(trimmed);
  }

  const firstLiteral = extractFirstQuotedLiteral(trimmed);
  if (firstLiteral) {
    return firstLiteral;
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

function evaluateNumericComparisons(
  expression: string,
  token: string,
  value: number,
): ConditionEval | null {
  const escapedToken = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(`${escapedToken}\\s*(==|!=|>=|<=|>|<)\\s*(-?\\d+)`, "gi");
  const checks = [...expression.matchAll(regex)];
  if (checks.length === 0) {
    return null;
  }

  const results = checks.map((match) => {
    const operator = match[1];
    const expected = Number(match[2]);
    if (Number.isNaN(expected)) {
      return false;
    }
    if (operator === "==") {
      return value === expected;
    }
    if (operator === "!=") {
      return value !== expected;
    }
    if (operator === ">=") {
      return value >= expected;
    }
    if (operator === "<=") {
      return value <= expected;
    }
    if (operator === ">") {
      return value > expected;
    }
    return value < expected;
  });

  const matched = hasOrOperator(expression) ? results.some(Boolean) : results.every(Boolean);
  return { matched, uncertain: false };
}

function getPathSegmentsLength(targetPath: string): number {
  const normalized = targetPath.replaceAll("/", "\\").trim();
  if (!normalized) {
    return 0;
  }
  const parts = normalized.split("\\").filter((part) => part.length > 0 && part !== ".");
  return parts.length;
}

function resolveContextPath(context: RuntimePreviewContext): string {
  const explicit = (context.currentPath ?? "").trim();
  if (explicit) {
    return explicit;
  }
  if (/^[a-zA-Z]:[\\/]/.test(context.selectionName) || context.selectionName.startsWith("\\\\")) {
    return context.selectionName.trim();
  }
  return "";
}

function matchesMode(modeText: string, context: RuntimePreviewContext): ConditionEval {
  const normalized = normalizeToken(modeText);
  if (!normalized) {
    return { matched: true, uncertain: false };
  }

  const wantsMultiple = normalized.includes("multiple") || normalized.includes("mode.multiple");
  const wantsSingle = normalized.includes("single") || normalized.includes("mode.single");

  if (wantsMultiple && !wantsSingle) {
    return { matched: context.selectionCount > 0, uncertain: false };
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
  const normalizedWhere = whereText.toLowerCase();
  const pathValue = resolveContextPath(context);
  const parentLen = getPathSegmentsLength(pathValue);
  const parentLenEval = evaluateNumericComparisons(normalizedWhere, "@sel.parent.len", parentLen);
  const sysVerMajorEval = evaluateNumericComparisons(normalizedWhere, "sys.ver.major", 11);
  const packageExistsRegex = /package\.exists\s*\(\s*["'][^"']+["']\s*\)/i;
  const packageExists = packageExistsRegex.test(normalizedWhere);
  const keyRButton = normalizedWhere.includes("key.rbutton()");
  const tokenChecks: ConditionEval[] = [];
  if (parentLenEval) {
    tokenChecks.push(parentLenEval);
  }
  if (sysVerMajorEval) {
    tokenChecks.push(sysVerMajorEval);
  }
  if (packageExists) {
    tokenChecks.push({ matched: true, uncertain: false });
  }
  if (keyRButton) {
    tokenChecks.push({ matched: false, uncertain: false });
  }

  const tokenMatched = tokenChecks.length === 0
    ? true
    : hasOrOperator(normalizedWhere)
      ? tokenChecks.some((item) => item.matched)
      : tokenChecks.every((item) => item.matched);
  const tokenUncertain = tokenChecks.some((item) => item.uncertain);

  return {
    matched: whereEval.matched && tokenMatched,
    uncertain: typeEval.uncertain || modeEval.uncertain || whereEval.uncertain || tokenUncertain,
  };
}

function evaluateVisibility(node: AttributedNode, context: RuntimePreviewContext): VisibilityEval {
  const base = evaluateNodeContext(node, context);
  if (!base.matched) {
    return { ...base, labelOnly: false, disabled: false };
  }

  const visText = getAttributeText(node, "vis");
  if (!visText) {
    return { ...base, labelOnly: false, disabled: false };
  }

  const normalized = normalizeToken(visText);
  if (KNOWN_VIS_HIDDEN.has(normalized)) {
    return { matched: false, uncertain: false, labelOnly: false, disabled: false };
  }
  if (KNOWN_VIS_LABEL.has(normalized)) {
    return { matched: true, uncertain: base.uncertain, labelOnly: true, disabled: false };
  }
  if (KNOWN_VIS_DISABLED.has(normalized)) {
    return { matched: true, uncertain: base.uncertain, labelOnly: false, disabled: true };
  }

  const visEval = evaluateKnownBooleanSignals(visText, context);
  return {
    matched: visEval.matched,
    uncertain: base.uncertain || visEval.uncertain,
    labelOnly: false,
    disabled: false,
  };
}

function titleOfNode(node: AttributedNode): string {
  const title = resolveDisplayText(getAttributeText(node, "title"));
  if (title) {
    return title;
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

function parseSeparatorHints(node: AttributedNode): { before: boolean; after: boolean } {
  const sepText = getAttributeText(node, "sep") || getAttributeText(node, "separator");
  if (!sepText) {
    return { before: false, after: false };
  }

  const token = normalizeToken(sepText);
  if (!token) {
    return { before: true, after: false };
  }
  if (token.includes("both")) {
    return { before: true, after: true };
  }
  if (token.includes("top") || token.includes("before")) {
    return { before: true, after: false };
  }
  if (token.includes("bottom") || token.includes("after")) {
    return { before: false, after: true };
  }
  if (token === "true" || token === "1" || token === "yes") {
    return { before: true, after: false };
  }
  return { before: false, after: false };
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
  const separatorHints = parseSeparatorHints(node);

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
      disabled: visibility.disabled,
      separatorBefore: separatorHints.before,
      separatorAfter: separatorHints.after,
      children,
    };
  }

  return {
    id: node.id,
    kind: node.kind,
    title: titleOfNode(node),
    source: "shell",
    labelOnly: visibility.labelOnly,
    disabled: visibility.disabled,
    separatorBefore: separatorHints.before,
    separatorAfter: separatorHints.after,
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

function getSystemOrderHint(
  context: RuntimePreviewContext,
  title: string,
  fallbackIndex: number,
): number {
  const normalized = normalizeToken(title);
  if (context.locationType === "desktop" || context.locationType === "back") {
    const mapped = DESKTOP_ORDER_HINTS[normalized];
    if (mapped !== undefined) {
      return mapped;
    }
    return 200 + fallbackIndex;
  }
  return fallbackIndex * 10;
}

function computeShellTopLevelHint(
  node: ConfigNode,
  index: number,
  context: RuntimePreviewContext,
): number {
  const isDesktopLike = context.locationType === "desktop" || context.locationType === "back";
  const orderBias = index / 1000;

  if (!isAttributedNode(node)) {
    return isDesktopLike ? 250 + orderBias : 2000 + index;
  }

  const shellTitle = titleOfNode(node);
  const titleHint = DESKTOP_ORDER_HINTS[normalizeToken(shellTitle)];
  if (isDesktopLike && titleHint !== undefined) {
    return titleHint + orderBias;
  }

  const position = getAttributeText(node, "pos") || getAttributeText(node, "position");
  if (position) {
    const token = normalizeToken(position);
    if (token.includes("top") || token.includes("before")) {
      return isDesktopLike ? 240 + orderBias : -2000 + index;
    }
    if (token.includes("bottom") || token.includes("after")) {
      return isDesktopLike ? 260 + orderBias : 4000 + index;
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
      return isDesktopLike ? 240 + orderBias : -1500 + index;
    }
    if (token.includes("bottom") || token.includes("after")) {
      return isDesktopLike ? 260 + orderBias : 3500 + index;
    }
    if (token.includes("both")) {
      return isDesktopLike ? 255 + orderBias : 3550 + index;
    }
  }

  return isDesktopLike ? 250 + orderBias : 2000 + index;
}

function buildCombinedEntries(
  context: RuntimePreviewContext,
  systemEntries: RuntimePreviewEntry[],
  shellTopEntries: Array<{ entry: RuntimePreviewEntry; hint: number; order: number }>,
): RuntimePreviewEntry[] {
  const combined: Array<{ entry: RuntimePreviewEntry; hint: number; order: number }> = [];
  for (let index = 0; index < systemEntries.length; index += 1) {
    combined.push({
      entry: systemEntries[index],
      hint: getSystemOrderHint(context, systemEntries[index].title, index),
      order: index,
    });
  }

  combined.push(...shellTopEntries);
  combined.sort((a, b) => (a.hint === b.hint ? a.order - b.order : a.hint - b.hint));
  const dedupedCombined: Array<{ entry: RuntimePreviewEntry; hint: number; order: number }> = [];
  const titleIndex = new Map<string, number>();
  for (const item of combined) {
    if (item.entry.kind === "separator") {
      dedupedCombined.push(item);
      continue;
    }
    const key = normalizeToken(item.entry.title);
    if (!key) {
      dedupedCombined.push(item);
      continue;
    }
    const existingIndex = titleIndex.get(key);
    if (existingIndex === undefined) {
      titleIndex.set(key, dedupedCombined.length);
      dedupedCombined.push(item);
      continue;
    }
    const existing = dedupedCombined[existingIndex];
    const shouldReplace = existing.entry.source === "system" && item.entry.source === "shell";
    if (shouldReplace) {
      dedupedCombined[existingIndex] = item;
    }
  }
  const desktopLike = context.locationType === "desktop" || context.locationType === "back";

  const staged: RuntimePreviewEntry[] = [];
  const pushSeparator = (seed: string, source: RuntimePreviewEntry["source"]) => {
    const prev = staged[staged.length - 1];
    if (prev?.kind === "separator") {
      return;
    }
    staged.push({
      id: `combined-sep-${seed}`,
      kind: "separator",
      title: "separator",
      source,
    });
  };

  for (let index = 0; index < dedupedCombined.length; index += 1) {
    const current = dedupedCombined[index];
    const next = dedupedCombined[index + 1];

    if (current.entry.separatorBefore) {
      pushSeparator(`before-${index}`, current.entry.source);
    }

    staged.push(current.entry);

    const gapNeedsSeparator = desktopLike && next && next.hint - current.hint >= 50;
    if (current.entry.separatorAfter || gapNeedsSeparator) {
      pushSeparator(`after-${index}`, current.entry.source);
    }
  }

  const normalized: RuntimePreviewEntry[] = [];
  for (const entry of staged) {
    if (entry.kind === "separator" && normalized.length === 0) {
      continue;
    }
    const prev = normalized[normalized.length - 1];
    if (entry.kind === "separator" && prev?.kind === "separator") {
      continue;
    }
    normalized.push(entry);
  }
  if (normalized[normalized.length - 1]?.kind === "separator") {
    normalized.pop();
  }
  return normalized;
}

function normalizeRuntimeSystemMenuEntries(
  entries: RuntimeSystemMenuEntry[] | undefined,
): RuntimeSystemMenuEntry[] | undefined {
  if (!entries) {
    return undefined;
  }

  const normalized: RuntimeSystemMenuEntry[] = [];
  for (const entry of entries) {
    const title = stripQuotes(String(entry.title ?? "")).trim();
    if (!title) {
      continue;
    }
    const children = normalizeRuntimeSystemMenuEntries(entry.children) ?? [];
    normalized.push({
      title,
      submenu: Boolean(entry.submenu),
      disabled: Boolean(entry.disabled),
      children,
    });
  }
  return normalized;
}

function toRuntimeSystemChildren(
  entries: RuntimeSystemMenuEntry[],
  parentId: string,
): RuntimePreviewEntry[] {
  const out: RuntimePreviewEntry[] = [];
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    const id = `${parentId}-child-${index}`;
    const nested = toRuntimeSystemChildren(entry.children ?? [], id);
    const hasChildren = nested.length > 0;
    out.push({
      id,
      kind: hasChildren ? "menu" : "item",
      title: entry.title,
      source: "system",
      disabled: Boolean(entry.disabled),
      submenu: Boolean(entry.submenu) || hasChildren,
      children: hasChildren ? nested : undefined,
    });
  }
  return out;
}

function applyRulesToSystemItems(
  context: RuntimePreviewContext,
  rules: Array<Extract<ConfigNode, { kind: "modify" | "remove" }>>,
): { entries: RuntimePreviewEntry[]; removedItems: number; modifiedItems: number } {
  const baseMenuEntries = context.systemMenuEntries ?? [];
  const overrideTitles = (context.systemItemsOverride ?? [])
    .map((item) => stripQuotes(item).trim())
    .filter((item) => item.length > 0);
  const useOverrides = Array.isArray(context.systemItemsOverride);
  const baseTitles = useOverrides
    ? [...new Set(overrideTitles)]
    : DEFAULT_SYSTEM_ITEMS[context.locationType] ?? [];

  const states: SystemItemState[] =
    baseMenuEntries.length > 0
      ? baseMenuEntries.map((entry, index) => {
          const children = toRuntimeSystemChildren(entry.children ?? [], `system-${index}`);
          return {
            id: `system-${index}`,
            title: entry.title,
            index,
            orderHint: getSystemOrderHint(context, entry.title, index),
            hidden: false,
            labelOnly: false,
            disabled: Boolean(entry.disabled),
            submenu: Boolean(entry.submenu) || children.length > 0 || isSystemSubmenuTitle(context, entry.title),
            children,
            menuGroup: "",
          };
        })
      : baseTitles.map((title, index) => ({
          id: `system-${index}`,
          title,
          index,
          orderHint: getSystemOrderHint(context, title, index),
          hidden: false,
          labelOnly: false,
          disabled: false,
          submenu: isSystemSubmenuTitle(context, title),
          children: [],
          menuGroup: "",
        }));

  if (!context.clipboardHasContent) {
    for (const item of states) {
      const key = normalizeToken(item.title);
      if (key === "paste") {
        item.disabled = true;
      }
      if (key === "undo copy") {
        item.hidden = true;
      }
    }
  }

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
        item.title = resolveDisplayText(title);
        item.submenu = item.children.length > 0 || isSystemSubmenuTitle(context, item.title);
      }

      const menu = getAttributeText(rule, "menu");
      if (menu) {
        item.menuGroup = resolveDisplayText(menu);
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
        if (KNOWN_VIS_DISABLED.has(vis)) {
          item.disabled = true;
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
    const hasChildren = item.children.length > 0;
    const entry: RuntimePreviewEntry = {
      id: item.id,
      kind: hasChildren ? "menu" : "item",
      title: item.title,
      source: "system",
      labelOnly: item.labelOnly,
      disabled: item.disabled,
      submenu: item.submenu || hasChildren,
      children: hasChildren ? item.children : undefined,
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
    clipboardHasContent: Boolean(context.clipboardHasContent),
    systemItemsOverride: context.systemItemsOverride
      ? context.systemItemsOverride
          .map((item) => stripQuotes(item).trim())
          .filter((item) => item.length > 0)
      : undefined,
    systemSubmenuTitles: context.systemSubmenuTitles
      ? context.systemSubmenuTitles
          .map((item) => stripQuotes(item).trim())
          .filter((item) => item.length > 0)
      : undefined,
    systemMenuEntries: normalizeRuntimeSystemMenuEntries(context.systemMenuEntries),
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
        hint: computeShellTopLevelHint(node, index, normalizedContext),
        order: 10000 + index,
      };
    })
    .filter((item): item is { entry: RuntimePreviewEntry; hint: number; order: number } => Boolean(item));

  const shellEntries = shellTopEntries.map((item) => item.entry);
  const combinedEntries = buildCombinedEntries(normalizedContext, system.entries, shellTopEntries);

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
