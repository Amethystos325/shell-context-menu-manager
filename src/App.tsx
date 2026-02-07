import { useCallback, useEffect, useMemo, useState } from "react";
import {
  createTextDiff,
  parseAndValidate,
  serializeConfig,
  validateConfig,
  type ConfigDocument,
  type ConfigNode,
  type ParseIssue,
  type TextDiff,
  type ValidationIssue,
} from "./core/index.js";
import {
  addNode,
  duplicateNode,
  getNodeAttribute,
  getNodeById,
  getNodeByPath,
  getNodePathById,
  moveNode,
  moveNodeByDrop,
  removeNode,
  updateImportPath,
  updateNodeAttribute,
} from "./editor/document-utils.js";
import type { BackupEntry, LogEntry } from "./shared/ipc.js";
import "./App.css";

const VARIABLE_SNIPPETS = [
  "@sel.path",
  "@sel.dir",
  "@sel.file.name",
  "@sel.file.title",
  "@sel.file.ext",
];

type SyncState = "synced" | "syncing" | "error";
type DropPlacement = "before" | "after" | "inside";

function formatErrorMessage(error: unknown): string {
  if (error && typeof error === "object") {
    const errorLike = error as { code?: string; message?: string; details?: string };
    if (errorLike.code) {
      return `${errorLike.code}: ${errorLike.message ?? "Unknown error."}`;
    }
    if (errorLike.message) {
      return errorLike.message;
    }
  }
  return "Unknown error.";
}

function getFirstNodeId(document: ConfigDocument | null): string | null {
  if (!document || document.nodes.length === 0) {
    return null;
  }
  return document.nodes[0].id;
}

function nodeLabel(node: ConfigNode): string {
  if (node.kind === "separator") {
    return "separator";
  }
  if (node.kind === "import") {
    return `import ${node.path}`;
  }
  const title = getNodeAttribute(node, "title") || getNodeAttribute(node, "find");
  return title ? `${node.kind}: ${title}` : node.kind;
}

function getDropSourceId(event: React.DragEvent<HTMLElement>): string | null {
  return (
    event.dataTransfer.getData("application/x-node-id") ||
    event.dataTransfer.getData("text/plain") ||
    null
  );
}

function flattenDiff(diff: TextDiff): Array<{ type: "equal" | "add" | "remove"; text: string }> {
  const lines: Array<{ type: "equal" | "add" | "remove"; text: string }> = [];
  for (const hunk of diff.hunks) {
    for (const op of hunk.operations) {
      lines.push({ type: op.type, text: op.line });
    }
  }
  return lines;
}

function collectRuleNodes(document: ConfigDocument | null): ConfigNode[] {
  if (!document) {
    return [];
  }

  const rules: ConfigNode[] = [];
  const stack = [...document.nodes];
  while (stack.length > 0) {
    const node = stack.shift();
    if (!node) {
      continue;
    }
    if (node.kind === "modify" || node.kind === "remove") {
      rules.push(node);
    }
    if (node.kind === "menu") {
      stack.push(...node.children);
    }
  }
  return rules;
}

interface TreeProps {
  nodes: ConfigNode[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onDropNode: (sourceId: string, targetId: string, placement: DropPlacement) => void;
  modelLocked: boolean;
}

function TreeView({ nodes, selectedId, onSelect, onDropNode, modelLocked }: TreeProps) {
  const handleDrop =
    (targetId: string, placement: DropPlacement) => (event: React.DragEvent<HTMLElement>) => {
      event.preventDefault();
      const sourceId = getDropSourceId(event);
      if (!sourceId || modelLocked) {
        return;
      }
      onDropNode(sourceId, targetId, placement);
    };

  const handleDragStart = (nodeId: string) => (event: React.DragEvent<HTMLButtonElement>) => {
    event.dataTransfer.setData("application/x-node-id", nodeId);
    event.dataTransfer.setData("text/plain", nodeId);
    event.dataTransfer.effectAllowed = "move";
  };

  return (
    <ul className="tree-list">
      {nodes.map((node) => (
        <li key={node.id}>
          <div
            className="drop-target"
            onDragOver={(event) => event.preventDefault()}
            onDrop={handleDrop(node.id, "before")}
          />
          <button
            type="button"
            draggable={!modelLocked}
            className={selectedId === node.id ? "tree-node active" : "tree-node"}
            onClick={() => onSelect(node.id)}
            onDragStart={handleDragStart(node.id)}
          >
            {nodeLabel(node)}
          </button>
          {node.kind === "menu" ? (
            <>
              {node.children.length > 0 ? (
                <TreeView
                  nodes={node.children}
                  selectedId={selectedId}
                  onSelect={onSelect}
                  onDropNode={onDropNode}
                  modelLocked={modelLocked}
                />
              ) : null}
              <div
                className="drop-target drop-inside"
                onDragOver={(event) => event.preventDefault()}
                onDrop={handleDrop(node.id, "inside")}
              />
            </>
          ) : null}
          <div
            className="drop-target"
            onDragOver={(event) => event.preventDefault()}
            onDrop={handleDrop(node.id, "after")}
          />
        </li>
      ))}
    </ul>
  );
}

function App() {
  const [appName, setAppName] = useState("Shell Context Menu Manager");
  const [appVersion, setAppVersion] = useState("-");
  const [filePath, setFilePath] = useState("");
  const [backupRootPath, setBackupRootPath] = useState("");
  const [status, setStatus] = useState("Ready");
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const [releaseBusy, setReleaseBusy] = useState(false);

  const [documentModel, setDocumentModel] = useState<ConfigDocument | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sourceText, setSourceText] = useState("");
  const [lastSavedText, setLastSavedText] = useState("");
  const [parseIssues, setParseIssues] = useState<ParseIssue[]>([]);
  const [validationIssues, setValidationIssues] = useState<ValidationIssue[]>([]);
  const [syncState, setSyncState] = useState<SyncState>("synced");

  const [diffPreview, setDiffPreview] = useState<TextDiff | null>(null);
  const [showDiffPreview, setShowDiffPreview] = useState(false);
  const [backups, setBackups] = useState<BackupEntry[]>([]);
  const [selectedBackupPath, setSelectedBackupPath] = useState("");
  const [backupPreviewText, setBackupPreviewText] = useState("");
  const [manualApplySteps, setManualApplySteps] = useState<string[]>([]);

  const selectedNode = useMemo(
    () => (documentModel && selectedId ? getNodeById(documentModel, selectedId) : undefined),
    [documentModel, selectedId],
  );

  const ruleNodes = useMemo(() => collectRuleNodes(documentModel), [documentModel]);
  const dirty = sourceText !== lastSavedText;
  const isPathEmpty = filePath.trim().length === 0;
  const modelLocked = syncState === "error";
  const diffLines = useMemo(() => (diffPreview ? flattenDiff(diffPreview) : []), [diffPreview]);

  const refreshBackups = useCallback(
    async (targetPath: string) => {
      if (!targetPath.trim()) {
        return;
      }
      try {
        const data = await window.shellManager.listBackups({ targetPath });
        setBackups(data);
        if (selectedBackupPath && !data.some((item) => item.backupPath === selectedBackupPath)) {
          setSelectedBackupPath("");
          setBackupPreviewText("");
        }
      } catch (error) {
        setStatus(`Refresh backups failed: ${formatErrorMessage(error)}`);
      }
    },
    [selectedBackupPath],
  );

  const applyDocument = (nextDoc: ConfigDocument, nextSelectedId?: string | null) => {
    const serialized = serializeConfig(nextDoc);
    setDocumentModel(nextDoc);
    setSourceText(serialized);
    setSelectedId(nextSelectedId ?? selectedId ?? getFirstNodeId(nextDoc));
    setParseIssues([]);
    setValidationIssues(validateConfig(nextDoc));
    setSyncState("synced");
  };

  const applySource = (text: string, asSaved = false) => {
    const result = parseAndValidate(text);
    setSourceText(text);
    setParseIssues(result.parseIssues);
    setValidationIssues(result.validationIssues);
    if (result.document) {
      setDocumentModel(result.document);
      setSelectedId(getFirstNodeId(result.document));
      setSyncState("synced");
    } else {
      setDocumentModel(null);
      setSelectedId(null);
      setSyncState("error");
    }
    if (asSaved) {
      setLastSavedText(text);
    }
  };

  useEffect(() => {
    if (!window.shellManager) {
      setStatus("Electron preload API is unavailable.");
      return;
    }

    let disposed = false;
    const init = async () => {
      try {
        const [appInfo, recentLogs] = await Promise.all([
          window.shellManager.getAppInfo(),
          window.shellManager.getRecentLogs(),
        ]);

        if (disposed) {
          return;
        }

        setAppName(appInfo.appName);
        setAppVersion(appInfo.appVersion);
        setFilePath(appInfo.defaultTestFilePath);
        setBackupRootPath(appInfo.backupRootPath);
        setLogs(recentLogs);
      } catch (error) {
        if (!disposed) {
          setStatus(`Init failed: ${formatErrorMessage(error)}`);
        }
      }
    };

    void init();
    const unsubscribe = window.shellManager.onLog((entry) => {
      setLogs((prev) => [...prev.slice(-199), entry]);
    });

    return () => {
      disposed = true;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!filePath) {
      return;
    }
    void refreshBackups(filePath);
  }, [filePath, refreshBackups]);

  useEffect(() => {
    if (syncState !== "syncing") {
      return;
    }

    const timer = window.setTimeout(() => {
      const previousPath =
        documentModel && selectedId ? getNodePathById(documentModel, selectedId) : null;
      const result = parseAndValidate(sourceText);
      setParseIssues(result.parseIssues);
      setValidationIssues(result.validationIssues);

      if (result.document) {
        setDocumentModel(result.document);
        const pathNode = getNodeByPath(result.document, previousPath);
        setSelectedId(pathNode?.id ?? getFirstNodeId(result.document));
        setSyncState("synced");
      } else {
        setSyncState("error");
      }
    }, 240);

    return () => window.clearTimeout(timer);
  }, [syncState, sourceText, documentModel, selectedId]);

  useEffect(() => {
    const handler = (event: BeforeUnloadEvent) => {
      if (!dirty) {
        return;
      }
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  const handleRead = async () => {
    setBusy(true);
    try {
      const data = await window.shellManager.readTextFile({ path: filePath });
      applySource(data.content, true);
      await refreshBackups(data.path);
      setStatus(`Loaded: ${data.path}`);
    } catch (error) {
      setStatus(`Read failed: ${formatErrorMessage(error)}`);
    } finally {
      setBusy(false);
    }
  };

  const handlePrepareSave = () => {
    const result = parseAndValidate(sourceText);
    if (result.parseIssues.length > 0) {
      setStatus("Save blocked: parse errors exist.");
      setParseIssues(result.parseIssues);
      setSyncState("error");
      return;
    }
    if (result.validationIssues.some((issue) => issue.severity === "error")) {
      setStatus("Save blocked: validation errors exist.");
      setValidationIssues(result.validationIssues);
      return;
    }

    setDiffPreview(createTextDiff(lastSavedText, sourceText));
    setShowDiffPreview(true);
  };

  const handleConfirmSave = async () => {
    setBusy(true);
    try {
      const payload = sourceText;
      const data = await window.shellManager.writeTextFile({
        path: filePath,
        content: payload,
      });
      setLastSavedText(payload);
      setShowDiffPreview(false);
      await refreshBackups(data.path);
      setStatus(
        `Saved: ${data.path} (${data.bytes} bytes)${
          data.backupPath ? `, backup=${data.backupPath}` : ""
        }`,
      );
    } catch (error) {
      setStatus(`Save failed: ${formatErrorMessage(error)}`);
    } finally {
      setBusy(false);
    }
  };

  const handleSyncModelFromSource = () => {
    const result = parseAndValidate(sourceText);
    setParseIssues(result.parseIssues);
    setValidationIssues(result.validationIssues);
    if (result.document) {
      const prevPath = documentModel && selectedId ? getNodePathById(documentModel, selectedId) : null;
      setDocumentModel(result.document);
      const nextSelectedId = getNodeByPath(result.document, prevPath)?.id ?? getFirstNodeId(result.document);
      setSelectedId(nextSelectedId);
      setSyncState("synced");
      setStatus("Model refreshed from source.");
    } else {
      setSyncState("error");
      setStatus("Source parse failed. Please fix parse issues first.");
    }
  };

  const handleApplyConfig = async () => {
    setReleaseBusy(true);
    try {
      const result = await window.shellManager.applyConfig({ targetPath: filePath });
      if (result.mode === "manual") {
        setManualApplySteps(result.manualSteps ?? []);
        setStatus(`Apply fallback to manual: ${result.message}`);
      } else {
        setManualApplySteps([]);
        setStatus(result.message);
      }
    } catch (error) {
      setStatus(`Apply failed: ${formatErrorMessage(error)}`);
    } finally {
      setReleaseBusy(false);
    }
  };

  const handleSelectBackup = async (backupPath: string) => {
    setSelectedBackupPath(backupPath);
    try {
      const preview = await window.shellManager.readTextFile({ path: backupPath });
      setBackupPreviewText(preview.content);
    } catch (error) {
      setStatus(`Backup preview failed: ${formatErrorMessage(error)}`);
    }
  };

  const handleRestoreBackup = async () => {
    if (!selectedBackupPath) {
      return;
    }
    setReleaseBusy(true);
    try {
      await window.shellManager.restoreBackup({
        targetPath: filePath,
        backupPath: selectedBackupPath,
      });
      const refreshed = await window.shellManager.readTextFile({ path: filePath });
      applySource(refreshed.content, true);
      await refreshBackups(filePath);
      setStatus(`Rollback succeeded from ${selectedBackupPath}`);
    } catch (error) {
      setStatus(`Rollback failed: ${formatErrorMessage(error)}`);
    } finally {
      setReleaseBusy(false);
    }
  };

  const handleNodeAttrChange = (key: string, value: string) => {
    if (!documentModel || !selectedId || modelLocked) {
      return;
    }
    const next = updateNodeAttribute(documentModel, selectedId, key, value);
    applyDocument(next, selectedId);
  };

  const handleImportPathChange = (value: string) => {
    if (!documentModel || !selectedId || modelLocked) {
      return;
    }
    const next = updateImportPath(documentModel, selectedId, value);
    applyDocument(next, selectedId);
  };

  const handleAddNode = (kind: ConfigNode["kind"]) => {
    if (modelLocked) {
      return;
    }
    if (!documentModel) {
      const empty: ConfigDocument = { nodes: [] };
      const { document, selectedId: nextId } = addNode(empty, null, kind);
      applyDocument(document, nextId);
      return;
    }

    const { document, selectedId: nextId } = addNode(documentModel, selectedId, kind);
    applyDocument(document, nextId);
  };

  const handleDeleteNode = () => {
    if (!documentModel || !selectedId || modelLocked) {
      return;
    }
    const { document, nextSelectedId } = removeNode(documentModel, selectedId);
    applyDocument(document, nextSelectedId);
  };

  const handleMoveNode = (direction: "up" | "down") => {
    if (!documentModel || !selectedId || modelLocked) {
      return;
    }
    const next = moveNode(documentModel, selectedId, direction);
    applyDocument(next, selectedId);
  };

  const handleDropNode = (sourceNodeId: string, targetNodeId: string, placement: DropPlacement) => {
    if (!documentModel || modelLocked) {
      return;
    }
    const { document, selectedId: nextSelectedId } = moveNodeByDrop(
      documentModel,
      sourceNodeId,
      targetNodeId,
      placement,
    );
    applyDocument(document, nextSelectedId);
  };

  const handleDuplicateNode = () => {
    if (!documentModel || !selectedId || modelLocked) {
      return;
    }
    const { document, duplicatedId } = duplicateNode(documentModel, selectedId);
    applyDocument(document, duplicatedId ?? selectedId);
  };

  const handleInsertVariable = (variable: string) => {
    if (!selectedNode || selectedNode.kind !== "item" || modelLocked) {
      return;
    }
    const prev = getNodeAttribute(selectedNode, "args");
    const next = prev ? `${prev} ${variable}` : variable;
    handleNodeAttrChange("args", next);
  };

  return (
    <main className="app-shell">
      <header className="app-header">
        <div>
          <h1>{appName}</h1>
          <p>Stage 4 Release Workflow In Progress | Version {appVersion}</p>
          {backupRootPath ? <p className="backup-root">Backups: {backupRootPath}</p> : null}
        </div>
        <div className={dirty ? "status-chip dirty" : "status-chip"}>{status}</div>
      </header>

      <section className="top-actions panel">
        <label htmlFor="file-path">Config File Path</label>
        <input
          id="file-path"
          type="text"
          value={filePath}
          onChange={(event) => setFilePath(event.target.value)}
          placeholder="C:\\path\\to\\shell.nss"
        />
        <div className="actions">
          <button type="button" onClick={handleRead} disabled={busy || isPathEmpty}>
            Read
          </button>
          <button type="button" onClick={handlePrepareSave} disabled={busy || isPathEmpty}>
            Save
          </button>
          <button type="button" onClick={handleSyncModelFromSource} disabled={busy}>
            Refresh Model
          </button>
          <button type="button" onClick={handleApplyConfig} disabled={releaseBusy || isPathEmpty}>
            Apply
          </button>
          <button type="button" onClick={() => void refreshBackups(filePath)} disabled={releaseBusy || isPathEmpty}>
            Refresh Backups
          </button>
        </div>
      </section>

      <section className="editor-grid">
        <section className="panel tree-panel">
          <h2>Menu Tree</h2>
          <div className="actions compact">
            <button type="button" onClick={() => handleAddNode("menu")} disabled={modelLocked}>
              +Menu
            </button>
            <button type="button" onClick={() => handleAddNode("item")} disabled={modelLocked}>
              +Item
            </button>
            <button type="button" onClick={() => handleAddNode("separator")} disabled={modelLocked}>
              +Sep
            </button>
            <button type="button" onClick={() => handleAddNode("modify")} disabled={modelLocked}>
              +Modify
            </button>
            <button type="button" onClick={() => handleAddNode("remove")} disabled={modelLocked}>
              +Remove
            </button>
            <button type="button" onClick={handleDuplicateNode} disabled={!selectedNode || modelLocked}>
              Copy
            </button>
            <button type="button" onClick={handleDeleteNode} disabled={!selectedNode || modelLocked}>
              Delete
            </button>
          </div>
          <div className="actions compact">
            <button type="button" onClick={() => handleMoveNode("up")} disabled={!selectedNode || modelLocked}>
              Up
            </button>
            <button type="button" onClick={() => handleMoveNode("down")} disabled={!selectedNode || modelLocked}>
              Down
            </button>
          </div>
          <p className={modelLocked ? "tree-tip warn" : "tree-tip"}>
            {modelLocked
              ? "Source contains parse errors. Fix source or refresh model to unlock tree editing."
              : "Drag node labels to reorder. Drop inside a menu to append as child."}
          </p>
          {documentModel ? (
            documentModel.nodes.length > 0 ? (
              <TreeView
                nodes={documentModel.nodes}
                selectedId={selectedId}
                onSelect={setSelectedId}
                onDropNode={handleDropNode}
                modelLocked={modelLocked}
              />
            ) : (
              <p className="empty-tip">No nodes yet. Add one from above.</p>
            )
          ) : (
            <p className="empty-tip">Load source and refresh model to start editing.</p>
          )}
        </section>

        <section className="panel attr-panel">
          <h2>Properties</h2>
          <div className="rule-center">
            <p className="rule-title">Rule Center (modify/remove)</p>
            {ruleNodes.length === 0 ? (
              <p className="empty-tip">No rule nodes yet.</p>
            ) : (
              <div className="rule-list">
                {ruleNodes.map((rule) => (
                  <button
                    key={rule.id}
                    type="button"
                    className={selectedId === rule.id ? "rule-pill active" : "rule-pill"}
                    onClick={() => setSelectedId(rule.id)}
                  >
                    {rule.kind}: {getNodeAttribute(rule, "find") || "(empty find)"}
                  </button>
                ))}
              </div>
            )}
          </div>

          {!selectedNode ? <p className="empty-tip">Select a node to edit attributes.</p> : null}
          {selectedNode && selectedNode.kind === "separator" ? (
            <p className="empty-tip">Separator has no editable properties.</p>
          ) : null}
          {selectedNode && selectedNode.kind === "import" ? (
            <div className="field-grid">
              <label htmlFor="attr-import-path">Path</label>
              <input
                id="attr-import-path"
                value={selectedNode.path}
                onChange={(event) => handleImportPathChange(event.target.value)}
                disabled={modelLocked}
              />
            </div>
          ) : null}

          {selectedNode && selectedNode.kind === "menu" ? (
            <div className="field-grid">
              <label htmlFor="attr-title">title</label>
              <input
                id="attr-title"
                value={getNodeAttribute(selectedNode, "title")}
                onChange={(event) => handleNodeAttrChange("title", event.target.value)}
                disabled={modelLocked}
              />
              <label htmlFor="attr-mode">mode</label>
              <input
                id="attr-mode"
                value={getNodeAttribute(selectedNode, "mode")}
                onChange={(event) => handleNodeAttrChange("mode", event.target.value)}
                disabled={modelLocked}
              />
              <label htmlFor="attr-type">type</label>
              <input
                id="attr-type"
                value={getNodeAttribute(selectedNode, "type")}
                onChange={(event) => handleNodeAttrChange("type", event.target.value)}
                disabled={modelLocked}
              />
              <label htmlFor="attr-image">image</label>
              <input
                id="attr-image"
                value={getNodeAttribute(selectedNode, "image")}
                onChange={(event) => handleNodeAttrChange("image", event.target.value)}
                disabled={modelLocked}
              />
            </div>
          ) : null}

          {selectedNode && selectedNode.kind === "item" ? (
            <>
              <div className="field-grid">
                <label htmlFor="item-title">title</label>
                <input
                  id="item-title"
                  value={getNodeAttribute(selectedNode, "title")}
                  onChange={(event) => handleNodeAttrChange("title", event.target.value)}
                  disabled={modelLocked}
                />
                <label htmlFor="item-cmd">cmd</label>
                <input
                  id="item-cmd"
                  value={getNodeAttribute(selectedNode, "cmd")}
                  onChange={(event) => handleNodeAttrChange("cmd", event.target.value)}
                  disabled={modelLocked}
                />
                <label htmlFor="item-args">args</label>
                <textarea
                  id="item-args"
                  value={getNodeAttribute(selectedNode, "args")}
                  onChange={(event) => handleNodeAttrChange("args", event.target.value)}
                  disabled={modelLocked}
                />
                <label htmlFor="item-type">type</label>
                <input
                  id="item-type"
                  value={getNodeAttribute(selectedNode, "type")}
                  onChange={(event) => handleNodeAttrChange("type", event.target.value)}
                  disabled={modelLocked}
                />
                <label htmlFor="item-mode">mode</label>
                <input
                  id="item-mode"
                  value={getNodeAttribute(selectedNode, "mode")}
                  onChange={(event) => handleNodeAttrChange("mode", event.target.value)}
                  disabled={modelLocked}
                />
                <label htmlFor="item-tip">tip</label>
                <input
                  id="item-tip"
                  value={getNodeAttribute(selectedNode, "tip")}
                  onChange={(event) => handleNodeAttrChange("tip", event.target.value)}
                  disabled={modelLocked}
                />
              </div>
              <div>
                <p className="variable-title">Variables</p>
                <div className="variable-row">
                  {VARIABLE_SNIPPETS.map((snippet) => (
                    <button
                      key={snippet}
                      type="button"
                      onClick={() => handleInsertVariable(snippet)}
                      disabled={modelLocked}
                    >
                      {snippet}
                    </button>
                  ))}
                </div>
              </div>
            </>
          ) : null}

          {selectedNode && (selectedNode.kind === "modify" || selectedNode.kind === "remove") ? (
            <div className="field-grid">
              <label htmlFor="rule-find">find</label>
              <input
                id="rule-find"
                value={getNodeAttribute(selectedNode, "find")}
                onChange={(event) => handleNodeAttrChange("find", event.target.value)}
                disabled={modelLocked}
              />
              {selectedNode.kind === "modify" ? (
                <>
                  <label htmlFor="rule-vis">vis</label>
                  <input
                    id="rule-vis"
                    value={getNodeAttribute(selectedNode, "vis")}
                    onChange={(event) => handleNodeAttrChange("vis", event.target.value)}
                    disabled={modelLocked}
                  />
                  <label htmlFor="rule-position">position</label>
                  <input
                    id="rule-position"
                    value={getNodeAttribute(selectedNode, "position")}
                    onChange={(event) => handleNodeAttrChange("position", event.target.value)}
                    disabled={modelLocked}
                  />
                </>
              ) : null}
            </div>
          ) : null}
        </section>

        <section className="panel source-panel">
          <h2>Source Preview</h2>
          <textarea
            value={sourceText}
            onChange={(event) => {
              setSourceText(event.target.value);
              setSyncState("syncing");
            }}
            placeholder="Source text will be shown here."
          />

          <p className={syncState === "error" ? "sync-state warn" : "sync-state"}>
            {syncState === "syncing" && "Synchronizing source to model..."}
            {syncState === "synced" && "Source and model are synchronized."}
            {syncState === "error" && "Parse errors detected. Tree/property editing is temporarily locked."}
          </p>

          <div className="issues">
            <h3>Parse Issues</h3>
            {parseIssues.length === 0 ? (
              <p className="empty-tip">No parse issues.</p>
            ) : (
              parseIssues.map((issue) => (
                <p key={`${issue.range.start.offset}-${issue.message}`}>
                  {issue.message} (line {issue.range.start.line}, col {issue.range.start.column})
                </p>
              ))
            )}
            <h3>Validation Issues</h3>
            {validationIssues.length === 0 ? (
              <p className="empty-tip">No validation issues.</p>
            ) : (
              validationIssues.map((issue) => (
                <p key={`${issue.code}-${issue.nodeId ?? "n/a"}-${issue.message}`}>
                  [{issue.severity}] {issue.message}
                </p>
              ))
            )}
          </div>
        </section>
      </section>

      <section className="release-grid">
        <section className="panel diff-panel">
          <h2>Diff Preview</h2>
          {!showDiffPreview ? (
            <p className="empty-tip">Click Save to open diff preview before write.</p>
          ) : null}
          {showDiffPreview && diffPreview ? (
            <>
              <p className="diff-summary">
                old lines: {diffPreview.oldLineCount}, new lines: {diffPreview.newLineCount},
                changes: {diffPreview.hasChanges ? "yes" : "no"}
              </p>
              <div className="diff-list">
                {diffLines.length === 0 ? (
                  <p className="empty-tip">No changed lines.</p>
                ) : (
                  diffLines.slice(0, 240).map((line, index) => (
                    <p key={`${line.type}-${index}`} className={`diff-line ${line.type}`}>
                      {line.type === "add" ? "+" : line.type === "remove" ? "-" : " "}
                      {line.text}
                    </p>
                  ))
                )}
              </div>
              <div className="actions">
                <button type="button" onClick={handleConfirmSave} disabled={busy || isPathEmpty}>
                  Confirm Save
                </button>
                <button type="button" onClick={() => setShowDiffPreview(false)} disabled={busy}>
                  Cancel
                </button>
              </div>
            </>
          ) : null}
        </section>

        <section className="panel backup-panel">
          <h2>Rollback Center</h2>
          <div className="backup-layout">
            <div className="backup-list">
              {backups.length === 0 ? (
                <p className="empty-tip">No backups yet.</p>
              ) : (
                backups.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className={selectedBackupPath === item.backupPath ? "backup-item active" : "backup-item"}
                    onClick={() => void handleSelectBackup(item.backupPath)}
                  >
                    <span>{item.fileName}</span>
                    <span>{new Date(item.createdAt).toLocaleString()}</span>
                  </button>
                ))
              )}
            </div>
            <textarea
              className="backup-preview"
              value={backupPreviewText}
              readOnly
              placeholder="Select a backup to preview content."
            />
          </div>
          <div className="actions">
            <button type="button" onClick={handleRestoreBackup} disabled={!selectedBackupPath || releaseBusy}>
              Restore Selected Backup
            </button>
          </div>
        </section>
      </section>

      {manualApplySteps.length > 0 ? (
        <section className="panel manual-panel">
          <h2>Manual Apply Steps</h2>
          {manualApplySteps.map((step) => (
            <p key={step}>{step}</p>
          ))}
        </section>
      ) : null}

      <section className="panel log-panel">
        <h2>Logs</h2>
        <div className="log-list">
          {logs.length === 0 ? (
            <p className="empty-tip">No logs yet.</p>
          ) : (
            logs
              .slice()
              .reverse()
              .map((log) => (
                <div className="log-row" key={log.id}>
                  <span className={`level level-${log.level}`}>{log.level.toUpperCase()}</span>
                  <span className="log-time">{log.time}</span>
                  <span className="log-message">{log.message}</span>
                </div>
              ))
          )}
        </div>
      </section>
    </main>
  );
}

export default App;
