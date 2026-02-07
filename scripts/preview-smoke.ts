import assert from "node:assert/strict";
import { parseConfig } from "../src/core/index.js";
import { buildRuntimePreview, type RuntimePreviewEntry } from "../src/preview/runtime-preview.js";

function flattenTitles(entries: RuntimePreviewEntry[]): string[] {
  const result: string[] = [];
  for (const entry of entries) {
    result.push(entry.title);
    if (entry.children) {
      result.push(...flattenTitles(entry.children));
    }
  }
  return result;
}

function run(): void {
  const source = `
modify(find="Refresh", menu="System")
remove(find="NVIDIA*")
menu(type='desktop|back' title="Go To") {
  item(title="Open Terminal")
}
menu(type='file' mode='single' title="File Tools") {
  item(title="Rename Safe")
}
menu(vis=key.shift() title="Dev") {
  item(title="VSCode")
}
`.trim();

  const document = parseConfig(source);

  const desktopPreview = buildRuntimePreview(document, {
    locationType: "desktop",
    selectionCount: 0,
    selectionName: "Desktop",
    shiftKey: false,
    leftButton: false,
    hasAdmin: false,
  });

  const desktopSystemTitles = flattenTitles(desktopPreview.systemEntries);
  assert.ok(desktopSystemTitles.includes("System"), "Expected grouped system menu from modify(menu=...).");
  assert.ok(!desktopSystemTitles.some((title) => title.startsWith("NVIDIA")), "Expected remove rule to hide NVIDIA entries.");
  assert.ok(flattenTitles(desktopPreview.shellEntries).includes("Go To"), "Expected desktop custom menu visible.");
  assert.ok(flattenTitles(desktopPreview.combinedEntries).includes("Go To"), "Expected combined preview to include shell nodes.");
  assert.ok(!flattenTitles(desktopPreview.shellEntries).includes("Dev"), "Expected vis=key.shift() hidden without Shift.");

  const filePreview = buildRuntimePreview(document, {
    locationType: "file",
    selectionCount: 1,
    selectionName: "readme.md",
    shiftKey: true,
    leftButton: false,
    hasAdmin: false,
  });
  const fileShellTitles = flattenTitles(filePreview.shellEntries);
  assert.ok(fileShellTitles.includes("File Tools"), "Expected file menu visible for file context.");
  assert.ok(fileShellTitles.includes("Dev"), "Expected Shift-only menu visible when Shift is true.");

  console.log("preview-smoke: OK");
}

run();
