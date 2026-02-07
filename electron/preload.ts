import { contextBridge, ipcRenderer } from "electron";
import { AppError, ERROR_CODES } from "../src/shared/error-codes.js";
import {
  IPC_CHANNELS,
  type AppInfo,
  type IpcResult,
  type LogEntry,
  type ReadTextFileOutput,
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
  async readTextFile(input) {
    const path = assertNonEmptyString(input.path, "path");
    const result = (await ipcRenderer.invoke(IPC_CHANNELS.FILE_READ_TEXT, {
      ...input,
      path,
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
