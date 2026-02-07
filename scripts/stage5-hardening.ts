import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { chmod, mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { BackupService } from "../electron/backup-service.js";
import { parseAndValidate } from "../src/core/index.js";

class SkipCaseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SkipCaseError";
  }
}

interface CaseResult {
  name: string;
  status: "PASS" | "SKIP";
  details: string;
}

async function runCase(name: string, fn: () => Promise<string | void>): Promise<CaseResult> {
  try {
    const details = (await fn()) ?? "";
    return {
      name,
      status: "PASS",
      details,
    };
  } catch (error) {
    if (error instanceof SkipCaseError) {
      return {
        name,
        status: "SKIP",
        details: error.message,
      };
    }
    throw error;
  }
}

async function run(): Promise<void> {
  const root = await mkdtemp(path.join(os.tmpdir(), "shell-manager-stage5-hardening-"));
  const targetDir = path.join(root, "data");
  const targetPath = path.join(targetDir, "shell.nss");
  const backupRoot = path.join(root, "backups");
  const service = new BackupService(backupRoot, 10);
  const results: CaseResult[] = [];

  try {
    await mkdir(targetDir, { recursive: true });
    await writeFile(targetPath, 'item(title="Seed", cmd="seed.exe")\n', "utf-8");

    results.push(
      await runCase("parse-and-validation-guard", async () => {
        const parseFailed = parseAndValidate('item(title="Bad", cmd="x"');
        assert.ok(parseFailed.parseIssues.length > 0, "Expected parse errors for invalid syntax.");

        const validationFailed = parseAndValidate('item(title="Missing cmd")');
        assert.equal(validationFailed.parseIssues.length, 0, "Unexpected parse issue in validation case.");
        assert.ok(
          validationFailed.validationIssues.some((issue) => issue.code === "E_REQUIRED"),
          "Expected E_REQUIRED validation issue.",
        );

        return "invalid syntax and required-field checks are blocked as expected";
      }),
    );

    results.push(
      await runCase("save-and-rollback-stress", async () => {
        for (let i = 0; i < 40; i += 1) {
          await service.createBackupForTarget(targetPath);
          await writeFile(targetPath, `item(title="Stress-${i}", cmd="run-${i}.exe")\n`, "utf-8");
        }

        const backupsAfterWrites = await service.listBackups(targetPath);
        assert.ok(backupsAfterWrites.length > 0, "Expected backups after stress writes.");
        assert.ok(
          backupsAfterWrites.length <= 10,
          `Expected backup count <= keepCount (10), got ${backupsAfterWrites.length}.`,
        );

        for (let i = 0; i < 20; i += 1) {
          const backups = await service.listBackups(targetPath);
          assert.ok(backups.length > 0, "Expected backups before restore loop.");
          const candidate = backups[i % backups.length];
          const restored = await service.restoreBackup(targetPath, candidate.backupPath);
          assert.ok(restored.bytes > 0, "Expected restored bytes > 0 in stress loop.");
        }

        const backupsAfterRestore = await service.listBackups(targetPath);
        assert.ok(
          backupsAfterRestore.length <= 10,
          `Expected backup count <= keepCount (10) after restore loop, got ${backupsAfterRestore.length}.`,
        );

        return "40 writes + 20 restores completed with backup prune policy preserved";
      }),
    );

    results.push(
      await runCase("rollback-missing-backup", async () => {
        const missingPath = path.join(root, "missing", "not-found.bak");
        let failed = false;
        try {
          await service.restoreBackup(targetPath, missingPath);
        } catch (error) {
          failed = true;
          const code = (error as NodeJS.ErrnoException).code;
          assert.equal(code, "ENOENT", `Expected ENOENT for missing backup, got ${code ?? "unknown"}.`);
        }
        assert.ok(failed, "Expected restore to fail when backup file is missing.");
        return "missing backup restore fails deterministically";
      }),
    );

    results.push(
      await runCase("permission-denied-best-effort", async () => {
        const readOnlyDir = path.join(root, "read-only");
        const readOnlyFile = path.join(readOnlyDir, "blocked.nss");
        await mkdir(readOnlyDir, { recursive: true });
        await writeFile(readOnlyFile, 'item(title="RO", cmd="ro.exe")\n', "utf-8");

        let denied = false;
        try {
          await chmod(readOnlyFile, 0o444);
          await writeFile(readOnlyFile, 'item(title="Mutated", cmd="mutated.exe")\n', "utf-8");
        } catch (error) {
          const code = (error as NodeJS.ErrnoException).code;
          if (code === "EACCES" || code === "EPERM" || code === "EROFS") {
            denied = true;
          } else {
            throw error;
          }
        } finally {
          await chmod(readOnlyFile, 0o666).catch(() => undefined);
        }

        if (!denied) {
          throw new SkipCaseError("platform did not return permission error for chmod-based write test");
        }

        return "permission-denied path validated";
      }),
    );

    const passCount = results.filter((item) => item.status === "PASS").length;
    const skipCount = results.filter((item) => item.status === "SKIP").length;
    for (const result of results) {
      const line = `${result.status} ${result.name}${result.details ? `: ${result.details}` : ""}`;
      console.log(line);
    }
    console.log(`stage5-hardening: OK (pass=${passCount}, skip=${skipCount})`);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

void run();
