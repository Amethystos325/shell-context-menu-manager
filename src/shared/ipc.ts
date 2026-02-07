import type { ErrorCode } from "./error-codes.js";

export const IPC_CHANNELS = {
  APP_GET_INFO: "app:get-info",
  APP_APPLY_CONFIG: "app:apply-config",
  FILE_SELECT_TEXT: "file:select-text",
  FILE_READ_TEXT: "file:read-text",
  FILE_WRITE_TEXT: "file:write-text",
  BACKUP_LIST: "backup:list",
  BACKUP_RESTORE: "backup:restore",
  LOG_GET_RECENT: "log:get-recent",
  LOG_PUSH: "log:push",
} as const;

export const LOG_LEVELS = ["debug", "info", "warn", "error"] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

export interface AppInfo {
  appName: string;
  appVersion: string;
  defaultTestFilePath: string;
  backupRootPath: string;
}

export interface ReadTextFileInput {
  path: string;
}

export interface ReadTextFileOutput {
  path: string;
  content: string;
}

export interface SelectTextFileInput {
  defaultPath?: string;
}

export interface SelectTextFileOutput {
  path: string;
}

export interface WriteTextFileInput {
  path: string;
  content: string;
}

export interface WriteTextFileOutput {
  path: string;
  bytes: number;
  backupPath?: string;
}

export interface BackupEntry {
  id: string;
  backupPath: string;
  fileName: string;
  size: number;
  createdAt: string;
}

export interface ListBackupsInput {
  targetPath: string;
}

export interface ListBackupsOutput {
  targetPath: string;
  backups: BackupEntry[];
}

export interface RestoreBackupInput {
  targetPath: string;
  backupPath: string;
}

export interface RestoreBackupOutput {
  targetPath: string;
  backupPath: string;
  bytes: number;
  createdBackupPath?: string;
}

export interface ApplyConfigInput {
  targetPath: string;
}

export interface ApplyConfigOutput {
  mode: "auto" | "manual";
  commandTried: string;
  success: boolean;
  message: string;
  manualSteps?: string[];
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
