import type {
  Attribute,
  ConfigDocument,
  ConfigNode,
  MenuNode,
  ValidationIssue,
} from "./types.js";

const TYPE_ALLOWED = new Set([
  "file",
  "files",
  "dir",
  "dirs",
  "folder",
  "desktop",
  "background",
  "drive",
  "*",
]);

const MODE_ALLOWED = new Set(["single", "multiple", "none", "normal", "all"]);

function getAttribute(node: Extract<ConfigNode, { attributes: Attribute[] }>, key: string): Attribute | undefined {
  return node.attributes.find((attr) => attr.key === key);
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

function validateItem(node: Extract<ConfigNode, { kind: "item" }>, issues: ValidationIssue[]): void {
  const title = decodeAttributeAsString(getAttribute(node, "title"));
  const cmd = decodeAttributeAsString(getAttribute(node, "cmd"));
  const type = decodeAttributeAsString(getAttribute(node, "type"));
  const mode = decodeAttributeAsString(getAttribute(node, "mode"));

  if (!title) {
    pushIssue(issues, node, "E_REQUIRED", "item.title is required.");
  }
  if (!cmd) {
    pushIssue(issues, node, "E_REQUIRED", "item.cmd is required.");
  }
  if (type && !TYPE_ALLOWED.has(type)) {
    pushIssue(issues, node, "E_FIELD_INVALID", `item.type has unsupported value: ${type}`);
  }
  if (mode && !MODE_ALLOWED.has(mode)) {
    pushIssue(issues, node, "E_FIELD_INVALID", `item.mode has unsupported value: ${mode}`);
  }
}

function validateMenu(node: MenuNode, issues: ValidationIssue[]): void {
  const title = decodeAttributeAsString(getAttribute(node, "title"));
  const type = decodeAttributeAsString(getAttribute(node, "type"));
  const mode = decodeAttributeAsString(getAttribute(node, "mode"));

  if (!title) {
    pushIssue(issues, node, "E_REQUIRED", "menu.title is required.");
  }
  if (type && !TYPE_ALLOWED.has(type)) {
    pushIssue(issues, node, "E_FIELD_INVALID", `menu.type has unsupported value: ${type}`);
  }
  if (mode && !MODE_ALLOWED.has(mode)) {
    pushIssue(issues, node, "E_FIELD_INVALID", `menu.mode has unsupported value: ${mode}`);
  }
}

function validateModify(node: Extract<ConfigNode, { kind: "modify" }>, issues: ValidationIssue[]): void {
  const find = decodeAttributeAsString(getAttribute(node, "find"));
  if (!find) {
    pushIssue(issues, node, "E_REQUIRED", "modify.find is required.");
  }
}

function validateRemove(node: Extract<ConfigNode, { kind: "remove" }>, issues: ValidationIssue[]): void {
  const find = decodeAttributeAsString(getAttribute(node, "find"));
  if (!find) {
    pushIssue(issues, node, "E_REQUIRED", "remove.find is required.");
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

  if (node.kind === "modify") {
    validateModify(node, issues);
    return;
  }

  if (node.kind === "remove") {
    validateRemove(node, issues);
  }
}

export function validateConfig(document: ConfigDocument): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  for (const node of document.nodes) {
    walkNode(node, issues);
  }
  return issues;
}
