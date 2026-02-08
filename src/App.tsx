import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import {
  getInitialLanguage,
  getLanguageLocale,
  persistLanguage,
  translate,
  type Language,
  type MessageKey,
  type TranslationParams,
} from "./i18n.js";
import {
  buildRuntimePreview,
  DEFAULT_RUNTIME_PREVIEW_CONTEXT,
  getDefaultSelectionName,
  getRecommendedSelectionCount,
  type PreviewLocationType,
  type RuntimePreviewContext,
  type RuntimePreviewEntry,
  type RuntimeSystemMenuEntry,
} from "./preview/runtime-preview.js";
import type { ShellManagerApi } from "./shared/preload-api.js";
import type { BackupEntry, LogEntry, SystemMenuEntry } from "./shared/ipc.js";
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
type AddableNodeKind = "menu" | "item" | "separator" | "modify" | "remove";
type Translator = (key: MessageKey, params?: TranslationParams) => string;

function formatErrorMessage(error: unknown, unknownMessage: string): string {
  if (error && typeof error === "object") {
    const errorLike = error as { code?: string; message?: string; details?: string };
    if (errorLike.code) {
      return `${errorLike.code}: ${errorLike.message ?? unknownMessage}`;
    }
    if (errorLike.message) {
      return errorLike.message;
    }
  }
  return unknownMessage;
}

function getFirstNodeId(document: ConfigDocument | null): string | null {
  if (!document || document.nodes.length === 0) {
    return null;
  }
  return document.nodes[0].id;
}

function nodeLabel(node: ConfigNode, t: Translator): string {
  if (node.kind === "separator") {
    return t("node.separator");
  }
  if (node.kind === "import") {
    return `${t("node.import")} ${node.path}`;
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

function toRuntimeSystemMenuEntries(entries: SystemMenuEntry[]): RuntimeSystemMenuEntry[] {
  return entries
    .map((entry) => ({
      title: entry.title,
      submenu: entry.submenu,
      disabled: Boolean(entry.disabled),
      children: toRuntimeSystemMenuEntries(entry.children ?? []),
    }))
    .filter((entry) => entry.title.trim().length > 0);
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
  t: Translator;
}

function TreeView({ nodes, selectedId, onSelect, onDropNode, modelLocked, t }: TreeProps) {
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
            {nodeLabel(node, t)}
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
                  t={t}
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

interface PreviewTreeProps {
  entries: RuntimePreviewEntry[];
  emptyText: string;
  systemTagText: string;
  shellTagText: string;
  collapsedIds: ReadonlySet<string>;
  onToggleMenu: (menuId: string) => void;
  expandLabel: string;
  collapseLabel: string;
  depth?: number;
}

interface SystemMenuSnapshotListProps {
  entries: SystemMenuEntry[];
  disabledText: string;
  depth?: number;
}

function SystemMenuSnapshotList({ entries, disabledText, depth = 0 }: SystemMenuSnapshotListProps) {
  if (entries.length === 0) {
    return null;
  }

  return (
    <ul className={depth === 0 ? "preview-system-items-list" : "preview-system-items-list nested"}>
      {entries.map((entry) => (
        <li key={entry.registryKey}>
          <div className="preview-system-item-row">
            <span className={`preview-source-badge source-${entry.source}`}>{entry.source}</span>
            <span>{entry.title}</span>
            {entry.disabled ? (
              <span className="preview-system-state-tag">{disabledText}</span>
            ) : null}
            {entry.submenu ? <span className="preview-submenu-marker">{">"}</span> : null}
          </div>
          {entry.children && entry.children.length > 0 ? (
            <SystemMenuSnapshotList
              entries={entry.children}
              disabledText={disabledText}
              depth={depth + 1}
            />
          ) : null}
        </li>
      ))}
    </ul>
  );
}

function PreviewTree({
  entries,
  emptyText,
  systemTagText,
  shellTagText,
  collapsedIds,
  onToggleMenu,
  expandLabel,
  collapseLabel,
  depth = 0,
}: PreviewTreeProps) {
  if (entries.length === 0) {
    return <p className="empty-tip">{emptyText}</p>;
  }

  return (
    <ul className={depth === 0 ? "preview-tree preview-tree-root" : "preview-tree preview-tree-nested"}>
      {entries.map((entry) => (
        <li key={entry.id}>
          <p
            className={`preview-entry source-${entry.source}${entry.labelOnly ? " label-only" : ""}${entry.disabled ? " disabled" : ""}`}
          >
            {entry.kind === "menu" ? (
              <button
                type="button"
                className="preview-toggle"
                onClick={() => onToggleMenu(entry.id)}
                title={collapsedIds.has(entry.id) ? expandLabel : collapseLabel}
              >
                {collapsedIds.has(entry.id) ? ">" : "v"}
              </button>
            ) : (
              <span className="preview-toggle-spacer" />
            )}
            <span className={`preview-source-badge source-${entry.source}`}>
              {entry.source === "system" ? systemTagText : shellTagText}
            </span>
            <span className="preview-entry-title">
              {entry.kind === "separator" ? "----------" : entry.title}
            </span>
            {(entry.kind === "menu" || entry.submenu) && entry.kind !== "separator" ? (
              <span className="preview-submenu-marker">{">"}</span>
            ) : null}
          </p>
          {entry.kind === "menu" &&
          entry.children &&
          entry.children.length > 0 &&
          !collapsedIds.has(entry.id) ? (
            <PreviewTree
              entries={entry.children}
              emptyText={emptyText}
              systemTagText={systemTagText}
              shellTagText={shellTagText}
              collapsedIds={collapsedIds}
              onToggleMenu={onToggleMenu}
              expandLabel={expandLabel}
              collapseLabel={collapseLabel}
              depth={depth + 1}
            />
          ) : null}
        </li>
      ))}
    </ul>
  );
}

function collectPreviewMenuIds(entries: RuntimePreviewEntry[]): string[] {
  const ids: string[] = [];
  const stack = [...entries];
  while (stack.length > 0) {
    const entry = stack.shift();
    if (!entry) {
      continue;
    }
    if (entry.kind === "menu") {
      ids.push(entry.id);
      if (entry.children && entry.children.length > 0) {
        stack.push(...entry.children);
      }
    }
  }
  return ids;
}

function collectNestedPreviewMenuIds(entries: RuntimePreviewEntry[]): string[] {
  const ids: string[] = [];
  const stack: Array<{ entry: RuntimePreviewEntry; depth: number }> = entries.map((entry) => ({
    entry,
    depth: 0,
  }));

  while (stack.length > 0) {
    const current = stack.shift();
    if (!current) {
      continue;
    }
    const { entry, depth } = current;
    if (entry.kind === "menu") {
      if (depth > 0) {
        ids.push(entry.id);
      }
      if (entry.children && entry.children.length > 0) {
        for (const child of entry.children) {
          stack.push({ entry: child, depth: depth + 1 });
        }
      }
    }
  }

  return ids;
}

function toWindowsPathKey(filePath: string): string {
  return filePath.replaceAll("/", "\\").toLowerCase();
}

function getWindowsDirname(filePath: string): string {
  const normalized = filePath.replaceAll("/", "\\");
  const index = normalized.lastIndexOf("\\");
  if (index < 0) {
    return normalized;
  }
  return normalized.slice(0, index);
}

function inferPreviewCurrentPath(filePath: string, locationType: PreviewLocationType): string {
  if (!filePath.trim()) {
    return locationType === "desktop" ? "C:\\Users\\Public\\Desktop" : "";
  }
  const normalized = normalizeWindowsPath(filePath);
  if (!normalized) {
    return locationType === "desktop" ? "C:\\Users\\Public\\Desktop" : "";
  }
  if (locationType === "file") {
    return normalized;
  }
  return getWindowsDirname(normalized);
}

function isAbsoluteWindowsPath(filePath: string): boolean {
  return /^[a-zA-Z]:[\\/]/.test(filePath) || filePath.startsWith("\\\\");
}

function normalizeWindowsPath(filePath: string): string {
  const normalized = filePath.replaceAll("/", "\\");
  if (!normalized) {
    return normalized;
  }

  let prefix = "";
  let rest = normalized;

  if (/^[a-zA-Z]:\\/.test(rest)) {
    prefix = rest.slice(0, 2);
    rest = rest.slice(2);
  } else if (rest.startsWith("\\\\")) {
    prefix = "\\\\";
    rest = rest.slice(2);
  }

  const parts = rest.split("\\");
  const stack: string[] = [];
  for (const part of parts) {
    if (!part || part === ".") {
      continue;
    }
    if (part === "..") {
      if (stack.length > 0) {
        stack.pop();
      }
      continue;
    }
    stack.push(part);
  }

  if (prefix === "\\\\") {
    return `\\\\${stack.join("\\")}`;
  }
  if (prefix) {
    return `${prefix}\\${stack.join("\\")}`;
  }
  return stack.join("\\");
}

function resolveImportFilePath(currentFilePath: string, importPath: string): string {
  const normalizedImport = importPath.trim();
  if (!normalizedImport) {
    return "";
  }
  if (isAbsoluteWindowsPath(normalizedImport)) {
    return normalizeWindowsPath(normalizedImport);
  }
  const baseDir = getWindowsDirname(currentFilePath);
  return normalizeWindowsPath(`${baseDir}\\${normalizedImport}`);
}

async function resolveDocumentWithImports(
  document: ConfigDocument,
  currentFilePath: string,
  api: ShellManagerApi,
): Promise<ConfigDocument> {
  const visited = new Set<string>([toWindowsPathKey(normalizeWindowsPath(currentFilePath))]);

  const expandNodes = async (nodes: ConfigNode[], hostFilePath: string): Promise<ConfigNode[]> => {
    const output: ConfigNode[] = [];
    for (const node of nodes) {
      if (node.kind === "menu") {
        const children = await expandNodes(node.children, hostFilePath);
        output.push({ ...node, children });
        continue;
      }

      if (node.kind !== "import") {
        output.push(node);
        continue;
      }

      const importFilePath = resolveImportFilePath(hostFilePath, node.path);
      if (!importFilePath) {
        continue;
      }
      const importKey = toWindowsPathKey(importFilePath);
      if (visited.has(importKey)) {
        continue;
      }
      visited.add(importKey);

      try {
        const imported = await api.readTextFile({ path: importFilePath, createIfMissing: false });
        const parsed = parseAndValidate(imported.content);
        if (!parsed.document) {
          continue;
        }
        const nested = await expandNodes(parsed.document.nodes, importFilePath);
        output.push(...nested);
      } catch {
        // Ignore missing/invalid import files in preview to keep the main editor responsive.
      }
    }
    return output;
  };

  const expanded = await expandNodes(document.nodes, currentFilePath);
  return { nodes: expanded };
}

function App() {
  const [language, setLanguage] = useState<Language>(() => getInitialLanguage());
  const t = useCallback(
    (key: MessageKey, params?: TranslationParams) => translate(language, key, params),
    [language],
  );
  const toErrorMessage = useCallback(
    (error: unknown) => formatErrorMessage(error, t("error.unknown")),
    [t],
  );
  const getShellManagerApi = useCallback((): ShellManagerApi | null => {
    const api = window.shellManager;
    if (api) {
      return api;
    }
    setStatus(t("status.preloadApiUnavailable"));
    return null;
  }, [t]);

  const [appName, setAppName] = useState("Shell Context Menu Manager");
  const [appVersion, setAppVersion] = useState("-");
  const [filePath, setFilePath] = useState("");
  const [backupRootPath, setBackupRootPath] = useState("");
  const [status, setStatus] = useState(() => translate(getInitialLanguage(), "status.ready"));
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
  const [previewDocument, setPreviewDocument] = useState<ConfigDocument | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [collapsedPreviewMenuIds, setCollapsedPreviewMenuIds] = useState<Set<string>>(new Set());
  const [systemMenuEntries, setSystemMenuEntries] = useState<SystemMenuEntry[]>([]);
  const [systemMenuLoading, setSystemMenuLoading] = useState(false);
  const [previewContext, setPreviewContext] = useState<RuntimePreviewContext>(
    {
      ...DEFAULT_RUNTIME_PREVIEW_CONTEXT,
      currentPath: "C:\\Users\\Public\\Desktop",
      systemItemsOverride: [],
      systemSubmenuTitles: [],
      systemMenuEntries: [],
    },
  );

  const selectedNode = useMemo(
    () => (documentModel && selectedId ? getNodeById(documentModel, selectedId) : undefined),
    [documentModel, selectedId],
  );

  const ruleNodes = useMemo(() => collectRuleNodes(documentModel), [documentModel]);
  const runtimePreview = useMemo(
    () => (previewDocument ? buildRuntimePreview(previewDocument, previewContext) : null),
    [previewDocument, previewContext],
  );
  const previewMenuIds = useMemo(
    () => (runtimePreview ? collectPreviewMenuIds(runtimePreview.combinedEntries) : []),
    [runtimePreview],
  );
  const nestedPreviewMenuIds = useMemo(
    () => (runtimePreview ? collectNestedPreviewMenuIds(runtimePreview.combinedEntries) : []),
    [runtimePreview],
  );
  const previewMenuSeenIdsRef = useRef<Set<string>>(new Set());
  const dirty = sourceText !== lastSavedText;
  const isPathEmpty = filePath.trim().length === 0;
  const modelLocked = syncState === "error";
  const diffLines = useMemo(() => (diffPreview ? flattenDiff(diffPreview) : []), [diffPreview]);

  const updatePreviewContext = (patch: Partial<RuntimePreviewContext>) => {
    setPreviewContext((prev) => ({ ...prev, ...patch }));
  };

  const handlePreviewLocationChange = (locationType: PreviewLocationType) => {
    setPreviewContext((prev) => ({
      ...prev,
      locationType,
      selectionName: getDefaultSelectionName(locationType),
      currentPath: inferPreviewCurrentPath(filePath, locationType),
      selectionCount: getRecommendedSelectionCount(locationType),
      systemItemsOverride: [],
      systemSubmenuTitles: [],
      systemMenuEntries: [],
    }));
  };

  useEffect(() => {
    setPreviewContext((prev) => ({
      ...prev,
      currentPath: inferPreviewCurrentPath(filePath, prev.locationType),
    }));
  }, [filePath]);

  const handleTogglePreviewMenu = useCallback((menuId: string) => {
    setCollapsedPreviewMenuIds((prev) => {
      const next = new Set(prev);
      if (next.has(menuId)) {
        next.delete(menuId);
      } else {
        next.add(menuId);
      }
      return next;
    });
  }, []);

  const handleExpandAllPreviewMenus = () => {
    setCollapsedPreviewMenuIds(new Set());
  };

  const handleCollapseAllPreviewMenus = () => {
    setCollapsedPreviewMenuIds(new Set(previewMenuIds));
  };

  useEffect(() => {
    if (previewMenuIds.length === 0) {
      setCollapsedPreviewMenuIds(new Set());
      previewMenuSeenIdsRef.current = new Set();
      return;
    }

    setCollapsedPreviewMenuIds((prev) => {
      const validIds = new Set(previewMenuIds);
      const next = new Set<string>();
      for (const id of prev) {
        if (validIds.has(id)) {
          next.add(id);
        }
      }

      const seenIds = previewMenuSeenIdsRef.current;
      for (const id of nestedPreviewMenuIds) {
        if (!seenIds.has(id)) {
          next.add(id);
        }
      }
      previewMenuSeenIdsRef.current = validIds;
      return next;
    });
  }, [nestedPreviewMenuIds, previewMenuIds]);

  const refreshSystemMenuSnapshot = useCallback(async () => {
    const api = getShellManagerApi();
    if (!api) {
      return;
    }

    setSystemMenuLoading(true);
    try {
      const snapshot = await api.getSystemMenuSnapshot({
        locationType: previewContext.locationType,
        shiftKey: previewContext.shiftKey,
        samplePath: previewContext.selectionName,
      });
      setSystemMenuEntries(snapshot.entries);
      const runtimeSystemEntries = toRuntimeSystemMenuEntries(snapshot.entries);
      const submenuTitles: string[] = [];
      const collectSubmenuTitles = (entries: RuntimeSystemMenuEntry[]) => {
        for (const entry of entries) {
          if (entry.submenu) {
            submenuTitles.push(entry.title);
          }
          if (entry.children && entry.children.length > 0) {
            collectSubmenuTitles(entry.children);
          }
        }
      };
      collectSubmenuTitles(runtimeSystemEntries);
      setPreviewContext((prev) => ({
        ...prev,
        currentPath: inferPreviewCurrentPath(filePath, prev.locationType),
        systemItemsOverride: runtimeSystemEntries.map((entry) => entry.title),
        systemSubmenuTitles: submenuTitles,
        systemMenuEntries: runtimeSystemEntries,
      }));
    } catch (error) {
      setSystemMenuEntries([]);
      setPreviewContext((prev) => ({
        ...prev,
        currentPath: inferPreviewCurrentPath(filePath, prev.locationType),
        systemItemsOverride: [],
        systemSubmenuTitles: [],
        systemMenuEntries: [],
      }));
      setStatus(t("status.systemMenuSnapshotFailed", { error: toErrorMessage(error) }));
    } finally {
      setSystemMenuLoading(false);
    }
  }, [
    filePath,
    getShellManagerApi,
    previewContext.locationType,
    previewContext.selectionName,
    previewContext.shiftKey,
    t,
    toErrorMessage,
  ]);

  const refreshBackups = useCallback(
    async (targetPath: string) => {
      if (!targetPath.trim()) {
        return;
      }
      const api = getShellManagerApi();
      if (!api) {
        return;
      }
      try {
        const data = await api.listBackups({ targetPath });
        setBackups(data);
        if (selectedBackupPath && !data.some((item) => item.backupPath === selectedBackupPath)) {
          setSelectedBackupPath("");
          setBackupPreviewText("");
        }
      } catch (error) {
        setStatus(t("status.refreshBackupsFailed", { error: toErrorMessage(error) }));
      }
    },
    [getShellManagerApi, selectedBackupPath, t, toErrorMessage],
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
    persistLanguage(language);
    document.documentElement.lang = getLanguageLocale(language);
  }, [language]);

  useEffect(() => {
    const api = getShellManagerApi();
    if (!api) {
      return;
    }

    let disposed = false;
    const init = async () => {
      try {
        const [appInfo, recentLogs] = await Promise.all([
          api.getAppInfo(),
          api.getRecentLogs(),
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
          setStatus(t("status.initFailed", { error: toErrorMessage(error) }));
        }
      }
    };

    void init();
    const unsubscribe = api.onLog((entry) => {
      setLogs((prev) => [...prev.slice(-199), entry]);
    });

    return () => {
      disposed = true;
      unsubscribe();
    };
  }, [getShellManagerApi, t, toErrorMessage]);

  useEffect(() => {
    if (!filePath) {
      return;
    }
    void refreshBackups(filePath);
  }, [filePath, refreshBackups]);

  useEffect(() => {
    void refreshSystemMenuSnapshot();
  }, [refreshSystemMenuSnapshot]);

  useEffect(() => {
    if (!documentModel) {
      setPreviewDocument(null);
      setPreviewLoading(false);
      return;
    }

    const api = getShellManagerApi();
    if (!api) {
      setPreviewDocument(documentModel);
      setPreviewLoading(false);
      return;
    }

    if (!filePath.trim()) {
      setPreviewDocument(documentModel);
      setPreviewLoading(false);
      return;
    }

    let disposed = false;
    setPreviewLoading(true);
    const run = async () => {
      try {
        const resolved = await resolveDocumentWithImports(documentModel, filePath, api);
        if (!disposed) {
          setPreviewDocument(resolved);
        }
      } catch {
        if (!disposed) {
          setPreviewDocument(documentModel);
        }
      } finally {
        if (!disposed) {
          setPreviewLoading(false);
        }
      }
    };

    void run();
    return () => {
      disposed = true;
    };
  }, [documentModel, filePath, getShellManagerApi]);

  useEffect(() => {
    if (previewMenuIds.length === 0) {
      setCollapsedPreviewMenuIds(new Set());
      return;
    }
    const validIds = new Set(previewMenuIds);
    setCollapsedPreviewMenuIds((prev) => {
      const next = new Set<string>();
      for (const id of prev) {
        if (validIds.has(id)) {
          next.add(id);
        }
      }
      return next;
    });
  }, [previewMenuIds]);

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
    const api = getShellManagerApi();
    if (!api) {
      return;
    }
    setBusy(true);
    try {
      const selected = await api.selectTextFile({ defaultPath: filePath || undefined });
      if (!selected) {
        setStatus(t("status.fileSelectionCanceled"));
        return;
      }
      setFilePath(selected.path);
      const data = await api.readTextFile({ path: selected.path });
      applySource(data.content, true);
      await refreshBackups(data.path);
      setStatus(t("status.loaded", { path: data.path }));
    } catch (error) {
      setStatus(t("status.readFailed", { error: toErrorMessage(error) }));
    } finally {
      setBusy(false);
    }
  };

  const handlePrepareSave = () => {
    const result = parseAndValidate(sourceText);
    if (result.parseIssues.length > 0) {
      setStatus(t("status.saveBlockedParse"));
      setParseIssues(result.parseIssues);
      setSyncState("error");
      return;
    }
    if (result.validationIssues.some((issue) => issue.severity === "error")) {
      setStatus(t("status.saveBlockedValidation"));
      setValidationIssues(result.validationIssues);
      return;
    }

    setDiffPreview(createTextDiff(lastSavedText, sourceText));
    setShowDiffPreview(true);
  };

  const handleConfirmSave = async () => {
    const api = getShellManagerApi();
    if (!api) {
      return;
    }
    setBusy(true);
    try {
      const payload = sourceText;
      const data = await api.writeTextFile({
        path: filePath,
        content: payload,
      });
      setLastSavedText(payload);
      setShowDiffPreview(false);
      await refreshBackups(data.path);
      if (data.backupPath) {
        setStatus(
          t("status.savedWithBackup", {
            path: data.path,
            bytes: data.bytes,
            backupPath: data.backupPath,
          }),
        );
      } else {
        setStatus(t("status.saved", { path: data.path, bytes: data.bytes }));
      }
    } catch (error) {
      setStatus(t("status.saveFailed", { error: toErrorMessage(error) }));
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
      setStatus(t("status.modelRefreshed"));
    } else {
      setSyncState("error");
      setStatus(t("status.sourceParseFailed"));
    }
  };

  const handleApplyConfig = async () => {
    const api = getShellManagerApi();
    if (!api) {
      return;
    }
    setReleaseBusy(true);
    try {
      const result = await api.applyConfig({ targetPath: filePath });
      if (result.mode === "manual") {
        setManualApplySteps(result.manualSteps ?? []);
        setStatus(t("status.applyFallbackManual", { message: result.message }));
      } else {
        setManualApplySteps([]);
        setStatus(t("status.applyAutoSucceeded"));
      }
    } catch (error) {
      setStatus(t("status.applyFailed", { error: toErrorMessage(error) }));
    } finally {
      setReleaseBusy(false);
    }
  };

  const handleSelectBackup = async (backupPath: string) => {
    const api = getShellManagerApi();
    if (!api) {
      return;
    }
    setSelectedBackupPath(backupPath);
    try {
      const preview = await api.readTextFile({ path: backupPath });
      setBackupPreviewText(preview.content);
    } catch (error) {
      setStatus(t("status.backupPreviewFailed", { error: toErrorMessage(error) }));
    }
  };

  const handleRestoreBackup = async () => {
    if (!selectedBackupPath) {
      return;
    }
    const api = getShellManagerApi();
    if (!api) {
      return;
    }
    setReleaseBusy(true);
    try {
      await api.restoreBackup({
        targetPath: filePath,
        backupPath: selectedBackupPath,
      });
      const refreshed = await api.readTextFile({ path: filePath });
      applySource(refreshed.content, true);
      await refreshBackups(filePath);
      setStatus(t("status.rollbackSucceeded", { backupPath: selectedBackupPath }));
    } catch (error) {
      setStatus(t("status.rollbackFailed", { error: toErrorMessage(error) }));
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

  const handleAddNode = (kind: AddableNodeKind) => {
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
          <p>{t("app.subtitle", { version: appVersion })}</p>
          {backupRootPath ? <p className="backup-root">{t("app.backupsRoot", { path: backupRootPath })}</p> : null}
        </div>
        <div className="header-tools">
          <label className="language-select" htmlFor="language">
            <span>{t("language.label")}</span>
            <select
              id="language"
              value={language}
              onChange={(event) => setLanguage(event.target.value as Language)}
            >
              <option value="zh">{t("language.zh")}</option>
              <option value="en">{t("language.en")}</option>
            </select>
          </label>
          <div className={dirty ? "status-chip dirty" : "status-chip"}>{status}</div>
        </div>
      </header>

      <section className="top-actions panel">
        <label htmlFor="file-path">{t("label.configFilePath")}</label>
        <input
          id="file-path"
          type="text"
          value={filePath}
          readOnly
          placeholder={t("placeholder.configFilePath")}
        />
        <div className="actions">
          <button type="button" onClick={handleRead} disabled={busy}>
            {t("action.selectAndRead")}
          </button>
          <button type="button" onClick={handlePrepareSave} disabled={busy || isPathEmpty}>
            {t("action.save")}
          </button>
          <button type="button" onClick={handleSyncModelFromSource} disabled={busy}>
            {t("action.refreshModel")}
          </button>
          <button type="button" onClick={handleApplyConfig} disabled={releaseBusy || isPathEmpty}>
            {t("action.apply")}
          </button>
          <button type="button" onClick={() => void refreshBackups(filePath)} disabled={releaseBusy || isPathEmpty}>
            {t("action.refreshBackups")}
          </button>
        </div>
      </section>

      <section className="editor-grid">
        <section className="panel tree-panel">
          <h2>{t("section.menuTree")}</h2>
          <div className="actions compact">
            <button type="button" onClick={() => handleAddNode("menu")} disabled={modelLocked}>
              {t("action.addMenu")}
            </button>
            <button type="button" onClick={() => handleAddNode("item")} disabled={modelLocked}>
              {t("action.addItem")}
            </button>
            <button type="button" onClick={() => handleAddNode("separator")} disabled={modelLocked}>
              {t("action.addSeparator")}
            </button>
            <button type="button" onClick={() => handleAddNode("modify")} disabled={modelLocked}>
              {t("action.addModify")}
            </button>
            <button type="button" onClick={() => handleAddNode("remove")} disabled={modelLocked}>
              {t("action.addRemove")}
            </button>
            <button type="button" onClick={handleDuplicateNode} disabled={!selectedNode || modelLocked}>
              {t("action.copy")}
            </button>
            <button type="button" onClick={handleDeleteNode} disabled={!selectedNode || modelLocked}>
              {t("action.delete")}
            </button>
          </div>
          <div className="actions compact">
            <button type="button" onClick={() => handleMoveNode("up")} disabled={!selectedNode || modelLocked}>
              {t("action.up")}
            </button>
            <button type="button" onClick={() => handleMoveNode("down")} disabled={!selectedNode || modelLocked}>
              {t("action.down")}
            </button>
          </div>
          <p className={modelLocked ? "tree-tip warn" : "tree-tip"}>
            {modelLocked
              ? t("tip.treeLocked")
              : t("tip.treeDrag")}
          </p>
          {documentModel ? (
            documentModel.nodes.length > 0 ? (
              <TreeView
                nodes={documentModel.nodes}
                selectedId={selectedId}
                onSelect={setSelectedId}
                onDropNode={handleDropNode}
                modelLocked={modelLocked}
                t={t}
              />
            ) : (
              <p className="empty-tip">{t("tip.noNodesYet")}</p>
            )
          ) : (
            <p className="empty-tip">{t("tip.loadSourceFirst")}</p>
          )}
        </section>

        <section className="panel attr-panel">
          <h2>{t("section.properties")}</h2>
          <div className="rule-center">
            <p className="rule-title">{t("section.ruleCenter")}</p>
            {ruleNodes.length === 0 ? (
              <p className="empty-tip">{t("tip.noRuleNodes")}</p>
            ) : (
              <div className="rule-list">
                {ruleNodes.map((rule) => (
                  <button
                    key={rule.id}
                    type="button"
                    className={selectedId === rule.id ? "rule-pill active" : "rule-pill"}
                    onClick={() => setSelectedId(rule.id)}
                  >
                    {rule.kind}: {getNodeAttribute(rule, "find") || t("tip.emptyFind")}
                  </button>
                ))}
              </div>
            )}
          </div>

          {!selectedNode ? <p className="empty-tip">{t("tip.selectNode")}</p> : null}
          {selectedNode && selectedNode.kind === "separator" ? (
            <p className="empty-tip">{t("tip.separatorNoProps")}</p>
          ) : null}
          {selectedNode && selectedNode.kind === "import" ? (
            <div className="field-grid">
              <label htmlFor="attr-import-path">{t("field.path")}</label>
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
              <label htmlFor="attr-title">{t("field.title")}</label>
              <input
                id="attr-title"
                value={getNodeAttribute(selectedNode, "title")}
                onChange={(event) => handleNodeAttrChange("title", event.target.value)}
                disabled={modelLocked}
              />
              <label htmlFor="attr-mode">{t("field.mode")}</label>
              <input
                id="attr-mode"
                value={getNodeAttribute(selectedNode, "mode")}
                onChange={(event) => handleNodeAttrChange("mode", event.target.value)}
                disabled={modelLocked}
              />
              <label htmlFor="attr-type">{t("field.type")}</label>
              <input
                id="attr-type"
                value={getNodeAttribute(selectedNode, "type")}
                onChange={(event) => handleNodeAttrChange("type", event.target.value)}
                disabled={modelLocked}
              />
              <label htmlFor="attr-image">{t("field.image")}</label>
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
                <label htmlFor="item-title">{t("field.title")}</label>
                <input
                  id="item-title"
                  value={getNodeAttribute(selectedNode, "title")}
                  onChange={(event) => handleNodeAttrChange("title", event.target.value)}
                  disabled={modelLocked}
                />
                <label htmlFor="item-cmd">{t("field.cmd")}</label>
                <input
                  id="item-cmd"
                  value={getNodeAttribute(selectedNode, "cmd")}
                  onChange={(event) => handleNodeAttrChange("cmd", event.target.value)}
                  disabled={modelLocked}
                />
                <label htmlFor="item-args">{t("field.args")}</label>
                <textarea
                  id="item-args"
                  value={getNodeAttribute(selectedNode, "args")}
                  onChange={(event) => handleNodeAttrChange("args", event.target.value)}
                  disabled={modelLocked}
                />
                <label htmlFor="item-type">{t("field.type")}</label>
                <input
                  id="item-type"
                  value={getNodeAttribute(selectedNode, "type")}
                  onChange={(event) => handleNodeAttrChange("type", event.target.value)}
                  disabled={modelLocked}
                />
                <label htmlFor="item-mode">{t("field.mode")}</label>
                <input
                  id="item-mode"
                  value={getNodeAttribute(selectedNode, "mode")}
                  onChange={(event) => handleNodeAttrChange("mode", event.target.value)}
                  disabled={modelLocked}
                />
                <label htmlFor="item-tip">{t("field.tip")}</label>
                <input
                  id="item-tip"
                  value={getNodeAttribute(selectedNode, "tip")}
                  onChange={(event) => handleNodeAttrChange("tip", event.target.value)}
                  disabled={modelLocked}
                />
              </div>
              <div>
                <p className="variable-title">{t("section.variables")}</p>
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
              <label htmlFor="rule-find">{t("field.find")}</label>
              <input
                id="rule-find"
                value={getNodeAttribute(selectedNode, "find")}
                onChange={(event) => handleNodeAttrChange("find", event.target.value)}
                disabled={modelLocked}
              />
              {selectedNode.kind === "modify" ? (
                <>
                  <label htmlFor="rule-vis">{t("field.vis")}</label>
                  <input
                    id="rule-vis"
                    value={getNodeAttribute(selectedNode, "vis")}
                    onChange={(event) => handleNodeAttrChange("vis", event.target.value)}
                    disabled={modelLocked}
                  />
                  <label htmlFor="rule-position">{t("field.position")}</label>
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
          <h2>{t("section.sourcePreview")}</h2>
          <textarea
            value={sourceText}
            onChange={(event) => {
              setSourceText(event.target.value);
              setSyncState("syncing");
            }}
            placeholder={t("placeholder.sourcePreview")}
          />

          <p className={syncState === "error" ? "sync-state warn" : "sync-state"}>
            {syncState === "syncing" && t("sync.syncing")}
            {syncState === "synced" && t("sync.synced")}
            {syncState === "error" && t("sync.error")}
          </p>

          <div className="issues">
            <h3>{t("section.parseIssues")}</h3>
            {parseIssues.length === 0 ? (
              <p className="empty-tip">{t("tip.noParseIssues")}</p>
            ) : (
              parseIssues.map((issue) => (
                <p key={`${issue.range.start.offset}-${issue.message}`}>
                  {issue.message}{" "}
                  {t("issue.position", {
                    line: issue.range.start.line,
                    column: issue.range.start.column,
                  })}
                </p>
              ))
            )}
            <h3>{t("section.validationIssues")}</h3>
            {validationIssues.length === 0 ? (
              <p className="empty-tip">{t("tip.noValidationIssues")}</p>
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

      <section className="panel runtime-preview-panel">
        <h2>{t("section.runtimePreview")}</h2>
        <div className="preview-controls">
          <label htmlFor="preview-location">{t("preview.location")}</label>
          <select
            id="preview-location"
            value={previewContext.locationType}
            onChange={(event) => handlePreviewLocationChange(event.target.value as PreviewLocationType)}
          >
            <option value="desktop">{t("preview.location.desktop")}</option>
            <option value="file">{t("preview.location.file")}</option>
            <option value="dir">{t("preview.location.dir")}</option>
            <option value="drive">{t("preview.location.drive")}</option>
            <option value="back">{t("preview.location.back")}</option>
            <option value="taskbar">{t("preview.location.taskbar")}</option>
          </select>

          <label htmlFor="preview-selection-count">{t("preview.selectionCount")}</label>
          <input
            id="preview-selection-count"
            type="number"
            min={0}
            max={64}
            value={previewContext.selectionCount}
            onChange={(event) =>
              updatePreviewContext({
                selectionCount: Number.parseInt(event.target.value || "0", 10) || 0,
              })
            }
          />

          <label htmlFor="preview-selection-name">{t("preview.selectionName")}</label>
          <input
            id="preview-selection-name"
            value={previewContext.selectionName}
            onChange={(event) => updatePreviewContext({ selectionName: event.target.value })}
          />

          <label className="preview-checkbox" htmlFor="preview-shift">
            <input
              id="preview-shift"
              type="checkbox"
              checked={previewContext.shiftKey}
              onChange={(event) => updatePreviewContext({ shiftKey: event.target.checked })}
            />
            <span>{t("preview.shiftKey")}</span>
          </label>

          <label className="preview-checkbox" htmlFor="preview-left-button">
            <input
              id="preview-left-button"
              type="checkbox"
              checked={previewContext.leftButton}
              onChange={(event) => updatePreviewContext({ leftButton: event.target.checked })}
            />
            <span>{t("preview.leftButton")}</span>
          </label>

          <label className="preview-checkbox" htmlFor="preview-has-admin">
            <input
              id="preview-has-admin"
              type="checkbox"
              checked={previewContext.hasAdmin}
              onChange={(event) => updatePreviewContext({ hasAdmin: event.target.checked })}
            />
            <span>{t("preview.hasAdmin")}</span>
          </label>

          <label className="preview-checkbox" htmlFor="preview-clipboard">
            <input
              id="preview-clipboard"
              type="checkbox"
              checked={Boolean(previewContext.clipboardHasContent)}
              onChange={(event) => updatePreviewContext({ clipboardHasContent: event.target.checked })}
            />
            <span>{t("preview.clipboardHasContent")}</span>
          </label>
        </div>

        <div className="preview-system-items">
          <div className="preview-system-items-header">
            <label>{t("preview.systemItems.label")}</label>
            <button type="button" onClick={() => void refreshSystemMenuSnapshot()} disabled={systemMenuLoading}>
              {t("preview.systemItems.refresh")}
            </button>
          </div>
          {systemMenuLoading ? <p className="preview-summary">{t("preview.systemItems.loading")}</p> : null}
          {systemMenuEntries.length === 0 ? (
            <p className="preview-hint">{t("preview.systemItems.empty")}</p>
          ) : (
            <SystemMenuSnapshotList
              entries={systemMenuEntries}
              disabledText={t("preview.systemItems.disabled")}
            />
          )}
          <p className="preview-hint">{t("preview.systemItems.hint")}</p>
        </div>

        {runtimePreview ? (
          <>
            <p className="preview-summary">
              {t("preview.ruleStats", {
                active: runtimePreview.ruleStats.activeRules,
                total: runtimePreview.ruleStats.totalRules,
                removed: runtimePreview.ruleStats.removedItems,
                modified: runtimePreview.ruleStats.modifiedItems,
                uncertain: runtimePreview.ruleStats.uncertainRules,
              })}
            </p>
            {previewLoading ? <p className="preview-summary">{t("preview.loadingImports")}</p> : null}
            <section className="preview-final">
              <h3>{t("preview.combinedMenu")}</h3>
              <div className="preview-legend">
                <span className="preview-source-badge source-system">{t("preview.legend.system")}</span>
                <span className="preview-source-badge source-shell">{t("preview.legend.shell")}</span>
              </div>
              <div className="preview-actions">
                <button type="button" onClick={handleExpandAllPreviewMenus} disabled={previewMenuIds.length === 0}>
                  {t("preview.action.expandAll")}
                </button>
                <button
                  type="button"
                  onClick={handleCollapseAllPreviewMenus}
                  disabled={previewMenuIds.length === 0}
                >
                  {t("preview.action.collapseAll")}
                </button>
              </div>
              <PreviewTree
                entries={runtimePreview.combinedEntries}
                emptyText={t("tip.previewNoItems")}
                systemTagText={t("preview.legend.system")}
                shellTagText={t("preview.legend.shell")}
                collapsedIds={collapsedPreviewMenuIds}
                onToggleMenu={handleTogglePreviewMenu}
                expandLabel={t("preview.toggle.expand")}
                collapseLabel={t("preview.toggle.collapse")}
              />
              {runtimePreview.shellEntries.length === 0 ? (
                <p className="preview-hint">{t("tip.previewNoShellItemsInContext")}</p>
              ) : null}
            </section>
            <p className="preview-hint">{t("tip.previewApproximate")}</p>
          </>
        ) : (
          <p className="empty-tip">{t("tip.noPreviewDocument")}</p>
        )}
      </section>

      <section className="release-grid">
        <section className="panel diff-panel">
          <h2>{t("section.diffPreview")}</h2>
          {!showDiffPreview ? (
            <p className="empty-tip">{t("tip.openDiffPreview")}</p>
          ) : null}
          {showDiffPreview && diffPreview ? (
            <>
              <p className="diff-summary">
                {t("diff.summary", {
                  oldLines: diffPreview.oldLineCount,
                  newLines: diffPreview.newLineCount,
                  hasChanges: diffPreview.hasChanges ? t("word.yes") : t("word.no"),
                })}
              </p>
              <div className="diff-list">
                {diffLines.length === 0 ? (
                  <p className="empty-tip">{t("tip.noChangedLines")}</p>
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
                  {t("action.confirmSave")}
                </button>
                <button type="button" onClick={() => setShowDiffPreview(false)} disabled={busy}>
                  {t("action.cancel")}
                </button>
              </div>
            </>
          ) : null}
        </section>

        <section className="panel backup-panel">
          <h2>{t("section.rollbackCenter")}</h2>
          <div className="backup-layout">
            <div className="backup-list">
              {backups.length === 0 ? (
                <p className="empty-tip">{t("tip.noBackupsYet")}</p>
              ) : (
                backups.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className={selectedBackupPath === item.backupPath ? "backup-item active" : "backup-item"}
                    onClick={() => void handleSelectBackup(item.backupPath)}
                  >
                    <span>{item.fileName}</span>
                    <span>{new Date(item.createdAt).toLocaleString(getLanguageLocale(language))}</span>
                  </button>
                ))
              )}
            </div>
            <textarea
              className="backup-preview"
              value={backupPreviewText}
              readOnly
              placeholder={t("placeholder.backupPreview")}
            />
          </div>
          <div className="actions">
            <button type="button" onClick={handleRestoreBackup} disabled={!selectedBackupPath || releaseBusy}>
              {t("action.restoreSelectedBackup")}
            </button>
          </div>
        </section>
      </section>

      {manualApplySteps.length > 0 ? (
        <section className="panel manual-panel">
          <h2>{t("section.manualApplySteps")}</h2>
          {manualApplySteps.map((step) => (
            <p key={step}>{step}</p>
          ))}
        </section>
      ) : null}

      <section className="panel log-panel">
        <h2>{t("section.logs")}</h2>
        <div className="log-list">
          {logs.length === 0 ? (
            <p className="empty-tip">{t("tip.noLogsYet")}</p>
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
