import assert from "node:assert/strict";
import { parseConfig } from "../src/core/index.js";
import {
  addNode,
  getNodeAttribute,
  getNodeById,
  getNodeByPath,
  getNodePathById,
  moveNodeByDrop,
  updateImportPath,
  updateNodeAttribute,
} from "../src/editor/document-utils.js";

function run(): void {
  const source = `
import "imports/a.nss"
menu(title="Root") {
  item(title="A", cmd="a.exe")
  item(title="B", cmd="b.exe")
  menu(title="Group") {
    item(title="C", cmd="c.exe")
  }
}
`.trim();

  const initial = parseConfig(source);
  const rootMenu = initial.nodes.find((node) => node.kind === "menu");
  assert.ok(rootMenu && rootMenu.kind === "menu", "Missing root menu.");

  const itemA = rootMenu.children.find((node) => getNodeAttribute(node, "title") === "A");
  const itemB = rootMenu.children.find((node) => getNodeAttribute(node, "title") === "B");
  assert.ok(itemA && itemB, "Expected item A and B.");

  const moved = moveNodeByDrop(initial, itemB.id, itemA.id, "before").document;
  const movedRoot = moved.nodes.find((node) => node.kind === "menu");
  assert.ok(movedRoot && movedRoot.kind === "menu", "Missing moved root menu.");
  assert.equal(getNodeAttribute(movedRoot.children[0], "title"), "B");

  const group = movedRoot.children.find((node) => getNodeAttribute(node, "title") === "Group");
  assert.ok(group && group.kind === "menu", "Expected group node.");
  const insideMoved = moveNodeByDrop(moved, itemA.id, group.id, "inside").document;
  const insideRoot = insideMoved.nodes.find((node) => node.kind === "menu");
  assert.ok(insideRoot && insideRoot.kind === "menu", "Missing inside root menu.");
  const insideGroup = insideRoot.children.find((node) => getNodeAttribute(node, "title") === "Group");
  assert.ok(insideGroup && insideGroup.kind === "menu", "Expected group after inside move.");
  assert.ok(insideGroup.children.some((node) => getNodeAttribute(node, "title") === "A"));

  const illegalMove = moveNodeByDrop(insideMoved, insideGroup.id, insideGroup.children[0].id, "inside").document;
  const illegalRoot = illegalMove.nodes.find((node) => node.kind === "menu");
  assert.ok(illegalRoot && illegalRoot.kind === "menu", "Missing root after illegal move.");
  assert.ok(illegalRoot.children.some((node) => getNodeAttribute(node, "title") === "Group"));

  const importNode = insideMoved.nodes.find((node) => node.kind === "import");
  assert.ok(importNode && importNode.kind === "import", "Missing import node.");
  const importUpdated = updateImportPath(insideMoved, importNode.id, "imports/next.nss");
  const importUpdatedNode = importUpdated.nodes.find((node) => node.kind === "import");
  assert.ok(importUpdatedNode && importUpdatedNode.kind === "import", "Missing updated import node.");
  assert.equal(importUpdatedNode.path, "imports/next.nss");

  const pathToGroup = getNodePathById(importUpdated, insideGroup.id);
  assert.ok(pathToGroup, "Expected group path.");
  const groupByPath = getNodeByPath(importUpdated, pathToGroup ?? null);
  assert.ok(groupByPath && groupByPath.kind === "menu", "Expected node by path.");
  assert.equal(getNodeAttribute(groupByPath, "title"), "Group");

  const attrUpdated = updateNodeAttribute(importUpdated, itemB.id, "title", "B-Updated");
  const updatedNode = getNodeById(attrUpdated, itemB.id);
  assert.ok(updatedNode, "Missing updated node.");
  assert.equal(getNodeAttribute(updatedNode, "title"), "B-Updated");

  const withNewRoot = addNode(attrUpdated, null, "item");
  assert.ok(withNewRoot.document.nodes.length >= attrUpdated.nodes.length + 1);

  console.log("editor-smoke: OK");
}

run();
