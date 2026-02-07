import type { Attribute, ConfigDocument, ConfigNode, MenuNode } from "../core/index.js";

type EditableNode = Extract<ConfigNode, { attributes: Attribute[] }>;
type DropPlacement = "before" | "after" | "inside";

interface NodeRef {
  node: ConfigNode;
  siblings: ConfigNode[];
  index: number;
  path: number[];
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

function findNodeRefInSiblings(
  id: string,
  siblings: ConfigNode[],
  parentPath: number[] = [],
): NodeRef | undefined {
  for (let index = 0; index < siblings.length; index += 1) {
    const node = siblings[index];
    const path = [...parentPath, index];
    if (node.id === id) {
      return { node, siblings, index, path };
    }
    if (node.kind === "menu") {
      const found = findNodeRefInSiblings(id, node.children, path);
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

function isPathPrefix(prefix: number[], target: number[]): boolean {
  if (prefix.length > target.length) {
    return false;
  }
  return prefix.every((part, index) => part === target[index]);
}

function getNodeByPathInternal(nodes: ConfigNode[], path: number[]): ConfigNode | undefined {
  if (path.length === 0) {
    return undefined;
  }
  let siblings = nodes;
  let node: ConfigNode | undefined;
  for (let depth = 0; depth < path.length; depth += 1) {
    const index = path[depth];
    node = siblings[index];
    if (!node) {
      return undefined;
    }
    if (depth < path.length - 1) {
      if (node.kind !== "menu") {
        return undefined;
      }
      siblings = node.children;
    }
  }
  return node;
}

function detachNode(document: ConfigDocument, nodeId: string): { detached: ConfigNode; document: ConfigDocument } | null {
  const ref = findNodeRef(document, nodeId);
  if (!ref) {
    return null;
  }
  const [detached] = ref.siblings.splice(ref.index, 1);
  return { detached, document };
}

function insertNodeByTarget(
  document: ConfigDocument,
  node: ConfigNode,
  targetId: string,
  placement: DropPlacement,
): boolean {
  if (placement === "inside") {
    const menu = findMenuNode(document, targetId);
    if (!menu) {
      return false;
    }
    menu.children.push(node);
    return true;
  }

  const targetRef = findNodeRef(document, targetId);
  if (!targetRef) {
    return false;
  }
  const insertIndex = placement === "before" ? targetRef.index : targetRef.index + 1;
  targetRef.siblings.splice(insertIndex, 0, node);
  return true;
}

export function getNodeById(document: ConfigDocument, nodeId: string): ConfigNode | undefined {
  return findNodeRef(document, nodeId)?.node;
}

export function getNodePathById(document: ConfigDocument, nodeId: string): number[] | null {
  return findNodeRef(document, nodeId)?.path ?? null;
}

export function getNodeByPath(document: ConfigDocument, path: number[] | null): ConfigNode | undefined {
  if (!path || path.length === 0) {
    return undefined;
  }
  return getNodeByPathInternal(document.nodes, path);
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

export function moveNodeByDrop(
  document: ConfigDocument,
  sourceNodeId: string,
  targetNodeId: string,
  placement: DropPlacement,
): { document: ConfigDocument; selectedId: string } {
  if (sourceNodeId === targetNodeId) {
    return { document, selectedId: sourceNodeId };
  }

  const sourcePath = getNodePathById(document, sourceNodeId);
  const targetPath = getNodePathById(document, targetNodeId);
  if (!sourcePath || !targetPath) {
    return { document, selectedId: sourceNodeId };
  }

  if (isPathPrefix(sourcePath, targetPath)) {
    return { document, selectedId: sourceNodeId };
  }

  const next = cloneDocument(document);
  const detachedResult = detachNode(next, sourceNodeId);
  if (!detachedResult) {
    return { document, selectedId: sourceNodeId };
  }

  const inserted = insertNodeByTarget(next, detachedResult.detached, targetNodeId, placement);
  if (!inserted) {
    next.nodes.push(detachedResult.detached);
  }

  return { document: next, selectedId: detachedResult.detached.id };
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

export function updateImportPath(document: ConfigDocument, nodeId: string, path: string): ConfigDocument {
  const next = cloneDocument(document);
  const ref = findNodeRef(next, nodeId);
  if (!ref || ref.node.kind !== "import") {
    return next;
  }
  ref.node.path = path;
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
