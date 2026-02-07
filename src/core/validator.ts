import type {
  Attribute,
  ConfigDocument,
  ConfigNode,
  MenuNode,
  ValidationIssue,
} from "./types.js";

type AttributedNode = Extract<ConfigNode, { attributes: Attribute[] }>;

const KNOWN_TYPE_TOKENS = new Set([
  "*",
  "all",
  "file",
  "files",
  "dir",
  "dirs",
  "folder",
  "background",
  "drive",
  "desktop",
  "taskbar",
  "namespace",
  "back",
  "back.file",
  "back.dir",
  "dir.back",
  "drive.back",
  "recyclebin",
  "this",
  "window",
]);

const KNOWN_MODE_TOKENS = new Set([
  "none",
  "single",
  "multiple",
  "multi_single",
  "multi_unique",
  "normal",
  "all",
]);

function normalizeKey(key: string): string {
  return key.trim().toLowerCase();
}

function getAttribute(node: AttributedNode, key: string): Attribute | undefined {
  const normalized = normalizeKey(key);
  return node.attributes.find((attr) => normalizeKey(attr.key) === normalized);
}

function hasAttribute(node: AttributedNode, key: string): boolean {
  return Boolean(getAttribute(node, key));
}

function decodeAttributeAsString(attribute: Attribute | undefined): string | undefined {
  if (!attribute) {
    return undefined;
  }

  if (attribute.value.kind === "string") {
    return String(attribute.value.value).trim();
  }

  return attribute.value.raw.trim();
}

function pushIssue(
  issues: ValidationIssue[],
  node: ConfigNode,
  code: string,
  message: string,
  severity: "error" | "warning" = "error",
): void {
  issues.push({
    code,
    message,
    severity,
    nodeId: node.id,
    range: node.range,
  });
}

function isExpressionLike(raw: string): boolean {
  return /[(){}[\]@'$"<>!=+\-*/%]/.test(raw) || /\b(and|or|if)\b/i.test(raw);
}

function splitPipeTokens(raw: string): string[] {
  return raw
    .split("|")
    .map((token) => token.trim().toLowerCase())
    .filter((token) => token.length > 0);
}

function validateTypeField(node: AttributedNode, issues: ValidationIssue[], fieldName: string): void {
  const value = decodeAttributeAsString(getAttribute(node, fieldName));
  if (!value) {
    return;
  }

  if (isExpressionLike(value)) {
    return;
  }

  const tokens = splitPipeTokens(value);
  if (tokens.length === 0) {
    return;
  }

  const unknownTokens = tokens.filter((token) => !KNOWN_TYPE_TOKENS.has(token));
  if (unknownTokens.length > 0) {
    pushIssue(
      issues,
      node,
      "W_TYPE_TOKEN_UNKNOWN",
      `${fieldName} contains unknown type token(s): ${unknownTokens.join(", ")}`,
      "warning",
    );
  }
}

function validateModeField(node: AttributedNode, issues: ValidationIssue[], fieldName: string): void {
  const value = decodeAttributeAsString(getAttribute(node, fieldName));
  if (!value) {
    return;
  }

  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return;
  }

  if (isExpressionLike(normalized)) {
    return;
  }

  if (normalized.startsWith("mode.")) {
    const modeToken = normalized.slice("mode.".length);
    if (!modeToken || KNOWN_MODE_TOKENS.has(modeToken)) {
      return;
    }
    pushIssue(
      issues,
      node,
      "W_MODE_TOKEN_UNKNOWN",
      `${fieldName} contains unknown mode token: ${modeToken}`,
      "warning",
    );
    return;
  }

  if (!KNOWN_MODE_TOKENS.has(normalized)) {
    pushIssue(
      issues,
      node,
      "W_MODE_TOKEN_UNKNOWN",
      `${fieldName} contains unknown mode token: ${value}`,
      "warning",
    );
  }
}

function validateVisualNodeBase(node: AttributedNode, issues: ValidationIssue[]): void {
  validateTypeField(node, issues, "type");
  validateModeField(node, issues, "mode");
}

function validateItem(node: Extract<ConfigNode, { kind: "item" }>, issues: ValidationIssue[]): void {
  validateVisualNodeBase(node, issues);
}

function validateMenu(node: MenuNode, issues: ValidationIssue[]): void {
  validateVisualNodeBase(node, issues);
}

function validateModifyOrRemove(
  node: Extract<ConfigNode, { kind: "modify" | "remove" }>,
  issues: ValidationIssue[],
): void {
  validateVisualNodeBase(node, issues);

  const selectorKeys = ["find", "where", "in", "id", "name"];
  const hasSelector = selectorKeys.some((key) => hasAttribute(node, key));
  if (!hasSelector) {
    pushIssue(
      issues,
      node,
      "W_SELECTOR_MISSING",
      `${node.kind} should define at least one selector: ${selectorKeys.join("/")}.`,
      "warning",
    );
  }
}

function walkNode(node: ConfigNode, issues: ValidationIssue[]): void {
  if (node.kind === "import") {
    if (!node.path.trim()) {
      pushIssue(issues, node, "E_REQUIRED", "import path cannot be empty.");
    }
    return;
  }

  if (node.kind === "item") {
    validateItem(node, issues);
    return;
  }

  if (node.kind === "menu") {
    validateMenu(node, issues);
    for (const child of node.children) {
      walkNode(child, issues);
    }
    return;
  }

  if (node.kind === "modify" || node.kind === "remove") {
    validateModifyOrRemove(node, issues);
    return;
  }

  if (node.kind === "separator" || node.kind === "raw") {
    return;
  }
}

export function validateConfig(document: ConfigDocument): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  for (const node of document.nodes) {
    walkNode(node, issues);
  }
  return issues;
}
