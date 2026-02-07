import { mkdirSync } from "node:fs";
import { appendFile } from "node:fs/promises";
import path from "node:path";
import type { LogEntry, LogLevel } from "../src/shared/ipc.js";

const MAX_LOG_ENTRIES = 300;

export class Logger {
  private readonly filePath: string;
  private readonly listeners = new Set<(entry: LogEntry) => void>();
  private readonly entries: LogEntry[] = [];

  constructor(logDir: string) {
    mkdirSync(logDir, { recursive: true });
    this.filePath = path.join(logDir, "app.log");
  }

  public subscribe(listener: (entry: LogEntry) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  public getRecent(): LogEntry[] {
    return [...this.entries];
  }

  public log(level: LogLevel, message: string): void {
    const entry: LogEntry = {
      id: `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
      level,
      message,
      time: new Date().toISOString(),
    };

    this.entries.push(entry);
    if (this.entries.length > MAX_LOG_ENTRIES) {
      this.entries.shift();
    }

    for (const listener of this.listeners) {
      listener(entry);
    }

    const line = `[${entry.time}] [${entry.level.toUpperCase()}] ${entry.message}\n`;
    void appendFile(this.filePath, line, "utf-8");
  }
}
