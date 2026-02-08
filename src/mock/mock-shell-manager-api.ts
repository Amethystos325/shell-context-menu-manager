import type {
  AppInfo,
  ApplyConfigOutput,
  BackupEntry,
  LogEntry,
  ReadTextFileInput,
  ReadTextFileOutput,
  RestoreBackupInput,
  RestoreBackupOutput,
  SelectTextFileInput,
  SelectTextFileOutput,
  SystemMenuSnapshotInput,
  SystemMenuSnapshotOutput,
  WriteTextFileInput,
  WriteTextFileOutput,
} from "../shared/ipc.js";
import type { ShellManagerApi } from "../shared/preload-api.js";

const MOCK_ROOT = "C:\\mock-shell-context-menu-manager";
const MOCK_RES_ROOT = `${MOCK_ROOT}\\res`;
const MOCK_BACKUP_ROOT = `${MOCK_ROOT}\\backups`;
const DEFAULT_CONFIG_FILE = `${MOCK_RES_ROOT}\\shell.nss`;
const MAX_BACKUPS_PER_FILE = 10;

const rawResFiles = import.meta.glob("/res/**/*.nss", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

interface FileEntry {
  path: string;
  content: string;
}

interface BackupEntryWithContent extends BackupEntry {
  content: string;
  targetPath: string;
}

function nowIso(): string {
  return new Date().toISOString();
}

function newId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeWindowsPath(filePath: string): string {
  const normalized = filePath.replaceAll("/", "\\").trim();
  if (!normalized) {
    return normalized;
  }

  let prefix = "";
  let rest = normalized;
  if (/^[a-zA-Z]:\\/.test(rest)) {
    prefix = `${rest.slice(0, 1).toUpperCase()}:`;
    rest = rest.slice(2);
  } else if (rest.startsWith("\\\\")) {
    prefix = "\\\\";
    rest = rest.slice(2);
  }

  const stack: string[] = [];
  for (const part of rest.split("\\")) {
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

function toPathKey(filePath: string): string {
  return normalizeWindowsPath(filePath).toLowerCase();
}

function toMockAbsolutePath(filePath: string): string {
  const normalized = normalizeWindowsPath(filePath);
  if (/^[a-zA-Z]:\\/.test(normalized) || normalized.startsWith("\\\\")) {
    return normalized;
  }
  if (normalized.startsWith("\\res\\")) {
    return normalizeWindowsPath(`${MOCK_ROOT}${normalized}`);
  }
  if (normalized.startsWith("res\\")) {
    return normalizeWindowsPath(`${MOCK_ROOT}\\${normalized}`);
  }
  return normalizeWindowsPath(`${MOCK_ROOT}\\${normalized}`);
}

function createInitialFileStore(): Map<string, FileEntry> {
  const files = new Map<string, FileEntry>();
  for (const [vitePath, content] of Object.entries(rawResFiles)) {
    const normalizedVitePath = vitePath.replaceAll("/", "\\");
    const marker = "\\res\\";
    const markerIndex = normalizedVitePath.toLowerCase().indexOf(marker);
    if (markerIndex < 0) {
      continue;
    }
    const relative = normalizedVitePath.slice(markerIndex + marker.length);
    const fullPath = normalizeWindowsPath(`${MOCK_RES_ROOT}\\${relative}`);
    files.set(toPathKey(fullPath), { path: fullPath, content: String(content) });
  }

  if (!files.has(toPathKey(DEFAULT_CONFIG_FILE))) {
    files.set(toPathKey(DEFAULT_CONFIG_FILE), {
      path: DEFAULT_CONFIG_FILE,
      content: "",
    });
  }

  return files;
}

function buildMissingPathError(path: string): Error {
  return new Error(`File not found in mock workspace: ${path}`);
}

export function isMockPreloadApiEnabled(): boolean {
  return import.meta.env.DEV;
}

let mockApiSingleton: ShellManagerApi | null = null;

export function getMockShellManagerApi(): ShellManagerApi {
  if (mockApiSingleton) {
    return mockApiSingleton;
  }

  const fileStore = createInitialFileStore();
  const backupStore = new Map<string, BackupEntryWithContent>();
  const backupsByTarget = new Map<string, BackupEntryWithContent[]>();
  const logs: LogEntry[] = [];
  const logListeners = new Set<(entry: LogEntry) => void>();

  const pushLog = (level: LogEntry["level"], message: string) => {
    const entry: LogEntry = {
      id: newId("log"),
      level,
      message,
      time: nowIso(),
    };
    logs.push(entry);
    if (logs.length > 200) {
      logs.splice(0, logs.length - 200);
    }
    for (const listener of logListeners) {
      listener(entry);
    }
  };

  const readEntry = (rawPath: string): FileEntry | undefined => {
    const resolved = toMockAbsolutePath(rawPath);
    return fileStore.get(toPathKey(resolved));
  };

  const ensureEntry = (rawPath: string): FileEntry => {
    const existing = readEntry(rawPath);
    if (existing) {
      return existing;
    }
    const path = toMockAbsolutePath(rawPath);
    const created: FileEntry = { path, content: "" };
    fileStore.set(toPathKey(path), created);
    return created;
  };

  const listTargetBackups = (targetPath: string): BackupEntryWithContent[] => {
    return backupsByTarget.get(toPathKey(targetPath)) ?? [];
  };

  const api: ShellManagerApi = {
    async getAppInfo(): Promise<AppInfo> {
      return {
        appName: "Shell Context Menu Manager (Mock)",
        appVersion: "dev-mock",
        defaultTestFilePath: DEFAULT_CONFIG_FILE,
        backupRootPath: MOCK_BACKUP_ROOT,
      };
    },

    async applyConfig(): Promise<ApplyConfigOutput> {
      pushLog("info", "Mock apply executed.");
      return {
        mode: "auto",
        commandTried: "mock-apply",
        success: true,
        message: "Mock apply succeeded.",
      };
    },

    async getSystemMenuSnapshot(input: SystemMenuSnapshotInput): Promise<SystemMenuSnapshotOutput> {
      return {
        locationType: input.locationType,
        entries: [],
      };
    },

    async selectTextFile(input: SelectTextFileInput = {}): Promise<SelectTextFileOutput | null> {
      const defaultPath = input.defaultPath
        ? toMockAbsolutePath(input.defaultPath)
        : DEFAULT_CONFIG_FILE;

      const exists = Boolean(readEntry(defaultPath));
      if (exists) {
        return { path: defaultPath };
      }

      const first = [...fileStore.values()][0];
      return first ? { path: first.path } : { path: defaultPath };
    },

    async readTextFile(input: ReadTextFileInput): Promise<ReadTextFileOutput> {
      const existing = readEntry(input.path);
      if (!existing) {
        if (input.createIfMissing === false) {
          throw buildMissingPathError(toMockAbsolutePath(input.path));
        }
        const created = ensureEntry(input.path);
        pushLog("info", `Mock read created file: ${created.path}`);
        return { path: created.path, content: created.content };
      }
      return { path: existing.path, content: existing.content };
    },

    async writeTextFile(input: WriteTextFileInput): Promise<WriteTextFileOutput> {
      const target = ensureEntry(input.path);
      const previousContent = target.content;
      let backupPath: string | undefined;

      if (previousContent.length > 0) {
        backupPath = normalizeWindowsPath(
          `${MOCK_BACKUP_ROOT}\\${new Date().toISOString().replaceAll(":", "-")}__${newId("backup")}.bak`,
        );
        const backup: BackupEntryWithContent = {
          id: newId("backup"),
          backupPath,
          fileName: backupPath.split("\\").pop() ?? "backup.bak",
          size: previousContent.length,
          createdAt: nowIso(),
          content: previousContent,
          targetPath: target.path,
        };
        backupStore.set(toPathKey(backupPath), backup);
        const list = backupsByTarget.get(toPathKey(target.path)) ?? [];
        list.unshift(backup);
        if (list.length > MAX_BACKUPS_PER_FILE) {
          const removed = list.splice(MAX_BACKUPS_PER_FILE);
          for (const entry of removed) {
            backupStore.delete(toPathKey(entry.backupPath));
          }
        }
        backupsByTarget.set(toPathKey(target.path), list);
      }

      target.content = input.content;
      fileStore.set(toPathKey(target.path), target);
      pushLog("info", `Mock write succeeded: ${target.path}`);

      return {
        path: target.path,
        bytes: input.content.length,
        backupPath,
      };
    },

    async listBackups(input): Promise<BackupEntry[]> {
      return listTargetBackups(input.targetPath).map((entry) => ({
        id: entry.id,
        backupPath: entry.backupPath,
        fileName: entry.fileName,
        size: entry.size,
        createdAt: entry.createdAt,
      }));
    },

    async restoreBackup(input: RestoreBackupInput): Promise<RestoreBackupOutput> {
      const backup = backupStore.get(toPathKey(input.backupPath));
      if (!backup) {
        throw new Error(`Backup not found in mock workspace: ${input.backupPath}`);
      }

      const target = ensureEntry(input.targetPath);
      const previousContent = target.content;
      let createdBackupPath: string | undefined;

      if (previousContent.length > 0) {
        createdBackupPath = normalizeWindowsPath(
          `${MOCK_BACKUP_ROOT}\\${new Date().toISOString().replaceAll(":", "-")}__${newId("rollback")}.bak`,
        );
        const rollbackBackup: BackupEntryWithContent = {
          id: newId("backup"),
          backupPath: createdBackupPath,
          fileName: createdBackupPath.split("\\").pop() ?? "backup.bak",
          size: previousContent.length,
          createdAt: nowIso(),
          content: previousContent,
          targetPath: target.path,
        };
        backupStore.set(toPathKey(createdBackupPath), rollbackBackup);
        const list = backupsByTarget.get(toPathKey(target.path)) ?? [];
        list.unshift(rollbackBackup);
        backupsByTarget.set(toPathKey(target.path), list.slice(0, MAX_BACKUPS_PER_FILE));
      }

      target.content = backup.content;
      fileStore.set(toPathKey(target.path), target);
      pushLog("info", `Mock restore succeeded: ${backup.backupPath} -> ${target.path}`);

      return {
        targetPath: target.path,
        backupPath: backup.backupPath,
        bytes: backup.content.length,
        createdBackupPath,
      };
    },

    async getRecentLogs(): Promise<LogEntry[]> {
      return [...logs];
    },

    onLog(listener) {
      logListeners.add(listener);
      return () => {
        logListeners.delete(listener);
      };
    },
  };

  mockApiSingleton = api;
  return api;
}
