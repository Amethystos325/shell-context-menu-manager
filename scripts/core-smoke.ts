import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { parseAndValidate, parseConfig, roundTrip, serializeConfig } from "../src/core/index.js";
import type { ConfigDocument, ConfigNode } from "../src/core/index.js";

function normalizeNode(node: ConfigNode): unknown {
  if (node.kind === "import") {
    return {
      kind: node.kind,
      path: node.path,
      section: node.section ?? null,
    };
  }

  if (node.kind === "separator") {
    return {
      kind: node.kind,
      attributes: node.attributes.map((attr) => ({
        key: attr.key,
        kind: attr.value.kind,
        value: attr.value.value,
      })),
    };
  }

  if (node.kind === "raw") {
    return {
      kind: node.kind,
      text: node.text,
    };
  }

  if (node.kind === "menu") {
    return {
      kind: node.kind,
      attributes: node.attributes.map((attr) => ({
        key: attr.key,
        kind: attr.value.kind,
        value: attr.value.value,
      })),
      children: node.children.map(normalizeNode),
    };
  }

  return {
    kind: node.kind,
    attributes: node.attributes.map((attr) => ({
      key: attr.key,
      kind: attr.value.kind,
      value: attr.value.value,
    })),
  };
}

function normalizeDocument(document: ConfigDocument): unknown {
  return {
    nodes: document.nodes.map(normalizeNode),
  };
}

async function run(): Promise<void> {
  const sampleDir = path.resolve("samples/configs");
  const entries = await readdir(sampleDir, { withFileTypes: true });
  const sampleFiles = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".nss"))
    .map((entry) => path.join(sampleDir, entry.name))
    .sort();

  assert.ok(sampleFiles.length >= 10, `Expected at least 10 sample files, got ${sampleFiles.length}`);

  for (const filePath of sampleFiles) {
    const text = await readFile(filePath, "utf-8");
    const result = parseAndValidate(text);

    assert.equal(result.parseIssues.length, 0, `Parse failed for ${path.basename(filePath)}`);
    assert.equal(result.validationIssues.length, 0, `Validation failed for ${path.basename(filePath)}`);
    assert.ok(result.document, `Missing document for ${path.basename(filePath)}`);

    const rt = roundTrip(text);
    assert.deepEqual(
      normalizeDocument(rt.parsed),
      normalizeDocument(rt.reparsed),
      `Round-trip mismatch for ${path.basename(filePath)}`,
    );
  }

  const mutableSample = await readFile(sampleFiles[0], "utf-8");
  const parsedMutable = parseConfig(mutableSample);
  const firstMenu = parsedMutable.nodes.find((node) => node.kind === "menu");
  assert.ok(firstMenu && firstMenu.kind === "menu", "Expected menu node in mutable sample.");
  const firstItem = firstMenu.children.find((node) => node.kind === "item");
  assert.ok(firstItem && firstItem.kind === "item", "Expected item node in mutable sample.");
  const titleAttr = firstItem.attributes.find((attr) => attr.key === "title");
  assert.ok(titleAttr, "Expected title attribute in mutable sample.");
  titleAttr.value = {
    raw: "\"Open Updated\"",
    kind: "string",
    value: "Open Updated",
  };
  const mutatedText = serializeConfig(parsedMutable);
  const reparsedMutated = parseConfig(mutatedText);
  const reparsedMenu = reparsedMutated.nodes.find((node) => node.kind === "menu");
  assert.ok(reparsedMenu && reparsedMenu.kind === "menu", "Expected menu node after mutation.");
  const reparsedItem = reparsedMenu.children.find((node) => node.kind === "item");
  assert.ok(reparsedItem && reparsedItem.kind === "item", "Expected item node after mutation.");
  const reparsedTitle = reparsedItem.attributes.find((attr) => attr.key === "title");
  assert.equal(reparsedTitle?.value.value, "Open Updated", "Mutation was not preserved after reparse.");

  const parseFailure = parseAndValidate('item(title="Bad", cmd="x"');
  assert.ok(parseFailure.parseIssues.length > 0, "Expected parse issue for invalid syntax sample.");

  const validationFailure = parseAndValidate("modify()");
  assert.equal(validationFailure.parseIssues.length, 0, "Unexpected parse issue for validation sample.");
  assert.ok(
    validationFailure.validationIssues.some((issue) => issue.code === "W_SELECTOR_MISSING"),
    "Expected selector validation issue.",
  );

  console.log(`core-smoke: OK (${sampleFiles.length} samples validated)`);
}

void run();
