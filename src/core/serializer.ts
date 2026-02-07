import type {
  Attribute,
  AttributeValue,
  ConfigDocument,
  ConfigNode,
  ImportNode,
  MenuNode,
  RawNode,
} from "./types.js";

export interface SerializeOptions {
  indent?: string;
  trailingNewline?: boolean;
}

function serializeImport(node: ImportNode): string {
  if (node.section && node.section.trim()) {
    return `import ${node.section.trim()} ${JSON.stringify(node.path)}`;
  }
  return `import ${JSON.stringify(node.path)}`;
}

function serializeAttributes(attributes: Attribute[]): string {
  if (attributes.length === 0) {
    return "()";
  }

  const pairs = attributes.map((attr) => `${attr.key}=${serializeValue(attr.value)}`);
  return `(${pairs.join(", ")})`;
}

function serializeValue(value: AttributeValue): string {
  if (value.raw && value.raw.trim().length > 0) {
    return value.raw.trim();
  }

  if (value.kind === "string") {
    return JSON.stringify(String(value.value));
  }

  return String(value.value);
}

function serializeMenu(node: MenuNode, indent: string, level: number): string {
  const prefix = indent.repeat(level);
  const head = `${prefix}menu${serializeAttributes(node.attributes)} {`;
  if (node.children.length === 0) {
    return `${head}\n${prefix}}`;
  }

  const children = node.children.map((child) => serializeNode(child, indent, level + 1)).join("\n");
  return `${head}\n${children}\n${prefix}}`;
}

function serializeRaw(node: RawNode, indent: string, level: number): string {
  const prefix = indent.repeat(level);
  if (!node.text.includes("\n")) {
    return `${prefix}${node.text}`;
  }
  return node.text
    .split(/\r?\n/)
    .map((line) => `${prefix}${line}`)
    .join("\n");
}

function serializeNode(node: ConfigNode, indent: string, level: number): string {
  const prefix = indent.repeat(level);
  if (node.kind === "import") {
    return `${prefix}${serializeImport(node)}`;
  }

  if (node.kind === "menu") {
    return serializeMenu(node, indent, level);
  }

  if (node.kind === "separator") {
    if (node.attributes.length === 0) {
      return `${prefix}separator`;
    }
    return `${prefix}separator${serializeAttributes(node.attributes)}`;
  }

  if (node.kind === "raw") {
    return serializeRaw(node, indent, level);
  }

  return `${prefix}${node.kind}${serializeAttributes(node.attributes)}`;
}

export function serializeConfig(document: ConfigDocument, options: SerializeOptions = {}): string {
  const indent = options.indent ?? "  ";
  const trailingNewline = options.trailingNewline ?? true;
  const content = document.nodes.map((node) => serializeNode(node, indent, 0)).join("\n");
  return trailingNewline ? `${content}\n` : content;
}
