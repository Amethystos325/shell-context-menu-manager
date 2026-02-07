import { constants as fsConstants } from "node:fs";
import { access, copyFile, mkdir, readdir, stat, unlink } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import type { BackupEntry } from "../src/shared/ipc.js";

const FILE_NAME_SAFE_RE = /[^A-Za-z0-9._-]/g;

function nowTimestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function sanitizeFileName(fileName: string): string {
  const base = fileName.replace(FILE_NAME_SAFE_RE, "_");
  return base || "config";
}

function buildBackupId(targetPath: string): string {
  return createHash("sha256").update(targetPath.toLowerCase()).digest("hex").slice(0, 16);
}

export class BackupService {
  private readonly rootDir: string;
  private readonly keepCount: number;

  constructor(rootDir: string, keepCount: number) {
    this.rootDir = rootDir;
    this.keepCount = keepCount;
  }

  public getRootDir(): string {
    return this.rootDir;
  }

  public isBackupPathAllowed(backupPath: string): boolean {
    const root = path.resolve(this.rootDir);
    const resolved = path.resolve(backupPath);
    return resolved === root || resolved.startsWith(`${root}${path.sep}`);
  }

  public async createBackupForTarget(
    targetPath: string,
    options: { skipPrune?: boolean } = {},
  ): Promise<BackupEntry | null> {
    try {
      await access(targetPath, fsConstants.F_OK | fsConstants.R_OK);
    } catch {
      return null;
    }

    const bucketDir = this.getBucketDir(targetPath);
    await mkdir(bucketDir, { recursive: true });

    const backupFileName = `${nowTimestamp()}__${sanitizeFileName(path.basename(targetPath))}.bak`;
    const backupPath = path.join(bucketDir, backupFileName);
    await copyFile(targetPath, backupPath);

    if (!options.skipPrune) {
      await this.pruneBucket(bucketDir);
    }
    return this.toBackupEntry(backupPath);
  }

  public async listBackups(targetPath: string): Promise<BackupEntry[]> {
    const bucketDir = this.getBucketDir(targetPath);
    try {
      await access(bucketDir, fsConstants.F_OK | fsConstants.R_OK);
    } catch {
      return [];
    }

    const entries = await readdir(bucketDir, { withFileTypes: true });
    const files = entries.filter((entry) => entry.isFile() && entry.name.endsWith(".bak"));

    const backups = await Promise.all(
      files.map(async (entry) => this.toBackupEntry(path.join(bucketDir, entry.name))),
    );

    backups.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    return backups;
  }

  public async restoreBackup(targetPath: string, backupPath: string): Promise<{
    bytes: number;
    createdBackupPath?: string;
  }> {
    const currentBackup = await this.createBackupForTarget(targetPath, { skipPrune: true });
    await mkdir(path.dirname(targetPath), { recursive: true });
    await copyFile(backupPath, targetPath);
    await this.pruneBucket(this.getBucketDir(targetPath));
    const targetStat = await stat(targetPath);
    return {
      bytes: targetStat.size,
      createdBackupPath: currentBackup?.backupPath,
    };
  }

  private getBucketDir(targetPath: string): string {
    return path.join(this.rootDir, buildBackupId(targetPath));
  }

  private async toBackupEntry(backupPath: string): Promise<BackupEntry> {
    const info = await stat(backupPath);
    return {
      id: createHash("sha1").update(backupPath).digest("hex").slice(0, 12),
      backupPath,
      fileName: path.basename(backupPath),
      size: info.size,
      createdAt: info.mtime.toISOString(),
    };
  }

  private async pruneBucket(bucketDir: string): Promise<void> {
    const entries = await readdir(bucketDir, { withFileTypes: true });
    const files = entries.filter((entry) => entry.isFile() && entry.name.endsWith(".bak"));
    if (files.length <= this.keepCount) {
      return;
    }

    const detail = await Promise.all(
      files.map(async (entry) => {
        const fullPath = path.join(bucketDir, entry.name);
        const info = await stat(fullPath);
        return {
          fullPath,
          mtimeMs: info.mtimeMs,
        };
      }),
    );

    detail.sort((a, b) => b.mtimeMs - a.mtimeMs);
    const toDelete = detail.slice(this.keepCount);
    await Promise.all(toDelete.map((item) => unlink(item.fullPath)));
  }
}
