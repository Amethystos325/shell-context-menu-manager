import type { ErrorCode } from "./error-codes.js";

export const IPC_CHANNELS = {
  APP_GET_INFO: "app:get-info",
  FILE_READ_TEXT: "file:read-text",
  FILE_WRITE_TEXT: "file:write-text",
  LOG_GET_RECENT: "log:get-recent",
  LOG_PUSH: "log:push",
} as const;

export const LOG_LEVELS = ["debug", "info", "warn", "error"] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

export interface AppInfo {
  appName: string;
  appVersion: string;
  defaultTestFilePath: string;
}

export interface ReadTextFileInput {
  path: string;
}

export interface ReadTextFileOutput {
  path: string;
  content: string;
}

export interface WriteTextFileInput {
  path: string;
  content: string;
}

export interface WriteTextFileOutput {
  path: string;
  bytes: number;
}

export interface LogEntry {
  id: string;
  level: LogLevel;
  message: string;
  time: string;
}

export interface IpcErrorShape {
  code: ErrorCode;
  message: string;
  details?: string;
}

export type IpcResult<T> = { ok: true; data: T } | { ok: false; error: IpcErrorShape };
