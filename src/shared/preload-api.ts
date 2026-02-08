import type {
  ApplyConfigInput,
  ApplyConfigOutput,
  AppInfo,
  BackupEntry,
  LogEntry,
  ReadTextFileInput,
  ReadTextFileOutput,
  SelectTextFileInput,
  SelectTextFileOutput,
  SystemMenuSnapshotInput,
  SystemMenuSnapshotOutput,
  RestoreBackupInput,
  RestoreBackupOutput,
  ListBackupsInput,
  WriteTextFileInput,
  WriteTextFileOutput,
} from "./ipc.js";

export interface ShellManagerApi {
  getAppInfo: () => Promise<AppInfo>;
  applyConfig: (input: ApplyConfigInput) => Promise<ApplyConfigOutput>;
  getSystemMenuSnapshot: (input: SystemMenuSnapshotInput) => Promise<SystemMenuSnapshotOutput>;
  selectTextFile: (input?: SelectTextFileInput) => Promise<SelectTextFileOutput | null>;
  readTextFile: (input: ReadTextFileInput) => Promise<ReadTextFileOutput>;
  writeTextFile: (input: WriteTextFileInput) => Promise<WriteTextFileOutput>;
  listBackups: (input: ListBackupsInput) => Promise<BackupEntry[]>;
  restoreBackup: (input: RestoreBackupInput) => Promise<RestoreBackupOutput>;
  getRecentLogs: () => Promise<LogEntry[]>;
  onLog: (listener: (entry: LogEntry) => void) => () => void;
}
