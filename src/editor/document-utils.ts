import type { Attribute, ConfigDocument, ConfigNode, MenuNode } from "../core/index.js";

type EditableNode = Extract<ConfigNode, { attributes: Attribute[] }>;

interface NodeRef {
  node: ConfigNode;
  siblings: ConfigNode[];
  index: number;
}

const STRING_FIELDS = new Set([
  "title",
  "cmd",
  "args",
  "type",
  "mode",
  "image",
  "tip",
  "find",
  "vis",
  "where",
  "position",
]);

function cloneDocument(document: ConfigDocument): ConfigDocument {
  return structuredClone(document);
}

function createRange() {
  return {
    start: { offset: 0, line: 1, column: 1 },
    end: { offset: 0, line: 1, column: 1 },
  };
}

function newId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

function findNodeRefInSiblings(id: string, siblings: ConfigNode[]): NodeRef | undefined {
  for (let index = 0; index < siblings.length; index += 1) {
    const node = siblings[index];
    if (node.id === id) {
      return { node, siblings, index };
    }
    if (node.kind === "menu") {
      const found = findNodeRefInSiblings(id, node.children);
      if (found) {
        return found;
      }
    }
  }
  return undefined;
}

function findNodeRef(document: ConfigDocument, id: string): NodeRef | undefined {
  return findNodeRefInSiblings(id, document.nodes);
}

function findMenuNode(document: ConfigDocument, id: string): MenuNode | undefined {
  const ref = findNodeRef(document, id);
  return ref?.node.kind === "menu" ? ref.node : undefined;
}

function supportsAttributes(node: ConfigNode): node is EditableNode {
  return "attributes" in node;
}

function createDefaultAttributes(kind: ConfigNode["kind"]): Attribute[] {
  if (kind === "menu") {
    return [
      {
        key: "title",
        value: { raw: "\"New Menu\"", kind: "string", value: "New Menu" },
        range: createRange(),
      },
    ];
  }

  if (kind === "item") {
    return [
      {
        key: "title",
        value: { raw: "\"New Item\"", kind: "string", value: "New Item" },
        range: createRange(),
      },
      {
        key: "cmd",
        value: { raw: "\"cmd.exe\"", kind: "string", value: "cmd.exe" },
        range: createRange(),
      },
    ];
  }

  if (kind === "modify" || kind === "remove") {
    return [
      {
        key: "find",
        value: { raw: "\"Target Item\"", kind: "string", value: "Target Item" },
        range: createRange(),
      },
    ];
  }

  return [];
}

function createNode(kind: ConfigNode["kind"]): ConfigNode {
  if (kind === "separator") {
    return {
      id: newId("separator"),
      kind: "separator",
      range: createRange(),
    };
  }

  if (kind === "menu") {
    return {
      id: newId("menu"),
      kind: "menu",
      range: createRange(),
      attributes: createDefaultAttributes("menu"),
      children: [],
    };
  }

  if (kind === "item") {
    return {
      id: newId("item"),
      kind: "item",
      range: createRange(),
      attributes: createDefaultAttributes("item"),
    };
  }

  if (kind === "modify") {
    return {
      id: newId("modify"),
      kind: "modify",
      range: createRange(),
      attributes: createDefaultAttributes("modify"),
    };
  }

  return {
    id: newId("remove"),
    kind: "remove",
    range: createRange(),
    attributes: createDefaultAttributes("remove"),
  };
}

function withRenewedIds(node: ConfigNode): ConfigNode {
  if (node.kind === "menu") {
    return {
      ...node,
      id: newId("menu"),
      children: node.children.map(withRenewedIds),
    };
  }

  return {
    ...node,
    id: newId(node.kind),
  };
}

function setAttributeOnNode(node: EditableNode, key: string, value: string): void {
  const index = node.attributes.findIndex((attr) => attr.key === key);
  const isString = STRING_FIELDS.has(key);
  const raw = isString ? JSON.stringify(value) : value;
  const normalizedValue = {
    raw,
    kind: isString ? ("string" as const) : ("identifier" as const),
    value,
  };

  if (!value.trim()) {
    if (index >= 0) {
      node.attributes.splice(index, 1);
    }
    return;
  }

  if (index >= 0) {
    node.attributes[index].value = normalizedValue;
    return;
  }

  node.attributes.push({
    key,
    value: normalizedValue,
    range: createRange(),
  });
}

export function getNodeById(document: ConfigDocument, nodeId: string): ConfigNode | undefined {
  return findNodeRef(document, nodeId)?.node;
}

export function addNode(
  document: ConfigDocument,
  selectedNodeId: string | null,
  kind: ConfigNode["kind"],
): { document: ConfigDocument; selectedId: string } {
  const next = cloneDocument(document);
  const newNode = createNode(kind);

  if (!selectedNodeId) {
    next.nodes.push(newNode);
    return { document: next, selectedId: newNode.id };
  }

  const menu = findMenuNode(next, selectedNodeId);
  if (menu) {
    menu.children.push(newNode);
    return { document: next, selectedId: newNode.id };
  }

  const selectedRef = findNodeRef(next, selectedNodeId);
  if (selectedRef) {
    selectedRef.siblings.splice(selectedRef.index + 1, 0, newNode);
  } else {
    next.nodes.push(newNode);
  }

  return { document: next, selectedId: newNode.id };
}

export function removeNode(
  document: ConfigDocument,
  nodeId: string,
): { document: ConfigDocument; nextSelectedId: string | null } {
  const next = cloneDocument(document);
  const ref = findNodeRef(next, nodeId);
  if (!ref) {
    return { document: next, nextSelectedId: null };
  }

  ref.siblings.splice(ref.index, 1);
  const fallback = ref.siblings[Math.max(0, ref.index - 1)] ?? ref.siblings[ref.index] ?? null;
  return {
    document: next,
    nextSelectedId: fallback?.id ?? null,
  };
}

export function moveNode(
  document: ConfigDocument,
  nodeId: string,
  direction: "up" | "down",
): ConfigDocument {
  const next = cloneDocument(document);
  const ref = findNodeRef(next, nodeId);
  if (!ref) {
    return next;
  }

  const targetIndex = direction === "up" ? ref.index - 1 : ref.index + 1;
  if (targetIndex < 0 || targetIndex >= ref.siblings.length) {
    return next;
  }

  const [node] = ref.siblings.splice(ref.index, 1);
  ref.siblings.splice(targetIndex, 0, node);
  return next;
}

export function duplicateNode(
  document: ConfigDocument,
  nodeId: string,
): { document: ConfigDocument; duplicatedId: string | null } {
  const next = cloneDocument(document);
  const ref = findNodeRef(next, nodeId);
  if (!ref) {
    return { document: next, duplicatedId: null };
  }

  const duplicated = withRenewedIds(ref.node);
  ref.siblings.splice(ref.index + 1, 0, duplicated);
  return { document: next, duplicatedId: duplicated.id };
}

export function updateNodeAttribute(
  document: ConfigDocument,
  nodeId: string,
  key: string,
  value: string,
): ConfigDocument {
  const next = cloneDocument(document);
  const ref = findNodeRef(next, nodeId);
  if (!ref || !supportsAttributes(ref.node)) {
    return next;
  }

  setAttributeOnNode(ref.node, key, value);
  return next;
}

export function getNodeAttribute(node: ConfigNode, key: string): string {
  if (!supportsAttributes(node)) {
    return "";
  }

  const attr = node.attributes.find((item) => item.key === key);
  if (!attr) {
    return "";
  }
  if (attr.value.kind === "string") {
    return String(attr.value.value);
  }
  return attr.value.raw;
}
