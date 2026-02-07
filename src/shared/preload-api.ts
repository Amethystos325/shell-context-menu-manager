import type {
  AppInfo,
  LogEntry,
  ReadTextFileInput,
  ReadTextFileOutput,
  WriteTextFileInput,
  WriteTextFileOutput,
} from "./ipc.js";

export interface ShellManagerApi {
  getAppInfo: () => Promise<AppInfo>;
  readTextFile: (input: ReadTextFileInput) => Promise<ReadTextFileOutput>;
  writeTextFile: (input: WriteTextFileInput) => Promise<WriteTextFileOutput>;
  getRecentLogs: () => Promise<LogEntry[]>;
  onLog: (listener: (entry: LogEntry) => void) => () => void;
}
