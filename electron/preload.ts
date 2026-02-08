import { contextBridge, ipcRenderer } from "electron";
import { AppError, ERROR_CODES } from "../src/shared/error-codes.js";
import {
  IPC_CHANNELS,
  type AppInfo,
  type ApplyConfigOutput,
  type BackupEntry,
  type IpcResult,
  type LogEntry,
  type ReadTextFileOutput,
  type SelectTextFileInput,
  type SelectTextFileOutput,
  type SystemMenuSnapshotInput,
  type SystemMenuSnapshotOutput,
  type RestoreBackupOutput,
  type WriteTextFileOutput,
} from "../src/shared/ipc.js";
import type { ShellManagerApi } from "../src/shared/preload-api.js";

function assertNonEmptyString(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new AppError(ERROR_CODES.IPC_BAD_REQUEST, `${fieldName} must be a non-empty string.`);
  }

  return value.trim();
}

function unwrapIpcResult<T>(result: IpcResult<T>): T {
  if (result.ok) {
    return result.data;
  }

  throw new AppError(result.error.code, result.error.message, result.error.details);
}

const api: ShellManagerApi = {
  async getAppInfo() {
    const result = (await ipcRenderer.invoke(IPC_CHANNELS.APP_GET_INFO)) as IpcResult<AppInfo>;
    return unwrapIpcResult(result);
  },
  async applyConfig(input) {
    const targetPath = assertNonEmptyString(input.targetPath, "targetPath");
    const result = (await ipcRenderer.invoke(IPC_CHANNELS.APP_APPLY_CONFIG, {
      ...input,
      targetPath,
    })) as IpcResult<ApplyConfigOutput>;
    return unwrapIpcResult(result);
  },
  async getSystemMenuSnapshot(input) {
    const payload: SystemMenuSnapshotInput = {
      locationType: input.locationType,
      shiftKey: Boolean(input.shiftKey),
      samplePath: typeof input.samplePath === "string" ? input.samplePath : undefined,
    };
    const result = (await ipcRenderer.invoke(
      IPC_CHANNELS.SYSTEM_MENU_GET_SNAPSHOT,
      payload,
    )) as IpcResult<SystemMenuSnapshotOutput>;
    return unwrapIpcResult(result);
  },
  async selectTextFile(input = {}) {
    const payload: SelectTextFileInput = {};
    if ("defaultPath" in input && input.defaultPath !== undefined) {
      payload.defaultPath = assertNonEmptyString(input.defaultPath, "defaultPath");
    }
    const result = (await ipcRenderer.invoke(
      IPC_CHANNELS.FILE_SELECT_TEXT,
      payload,
    )) as IpcResult<SelectTextFileOutput | null>;
    return unwrapIpcResult(result);
  },
  async readTextFile(input) {
    const path = assertNonEmptyString(input.path, "path");
    const createIfMissing =
      input.createIfMissing === undefined ? undefined : Boolean(input.createIfMissing);
    const result = (await ipcRenderer.invoke(IPC_CHANNELS.FILE_READ_TEXT, {
      ...input,
      path,
      createIfMissing,
    })) as IpcResult<ReadTextFileOutput>;
    return unwrapIpcResult(result);
  },
  async writeTextFile(input) {
    const path = assertNonEmptyString(input.path, "path");
    if (typeof input.content !== "string") {
      throw new AppError(ERROR_CODES.IPC_BAD_REQUEST, "content must be a string.");
    }
    const result = (await ipcRenderer.invoke(IPC_CHANNELS.FILE_WRITE_TEXT, {
      ...input,
      path,
    })) as IpcResult<WriteTextFileOutput>;
    return unwrapIpcResult(result);
  },
  async listBackups(input) {
    const targetPath = assertNonEmptyString(input.targetPath, "targetPath");
    const result = (await ipcRenderer.invoke(IPC_CHANNELS.BACKUP_LIST, {
      ...input,
      targetPath,
    })) as IpcResult<{ backups: BackupEntry[] }>;
    return unwrapIpcResult(result).backups;
  },
  async restoreBackup(input) {
    const targetPath = assertNonEmptyString(input.targetPath, "targetPath");
    const backupPath = assertNonEmptyString(input.backupPath, "backupPath");
    const result = (await ipcRenderer.invoke(IPC_CHANNELS.BACKUP_RESTORE, {
      ...input,
      targetPath,
      backupPath,
    })) as IpcResult<RestoreBackupOutput>;
    return unwrapIpcResult(result);
  },
  async getRecentLogs() {
    const result = (await ipcRenderer.invoke(IPC_CHANNELS.LOG_GET_RECENT)) as IpcResult<LogEntry[]>;
    return unwrapIpcResult(result);
  },
  onLog(listener) {
    const wrappedListener = (_event: Electron.IpcRendererEvent, entry: LogEntry) => {
      listener(entry);
    };

    ipcRenderer.on(IPC_CHANNELS.LOG_PUSH, wrappedListener);
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.LOG_PUSH, wrappedListener);
    };
  },
};

contextBridge.exposeInMainWorld("shellManager", api);
