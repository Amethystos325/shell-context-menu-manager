import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { BackupService } from "../electron/backup-service.js";

async function run(): Promise<void> {
  const root = await mkdtemp(path.join(os.tmpdir(), "shell-manager-release-smoke-"));
  const backupRoot = path.join(root, "backups");
  const targetDir = path.join(root, "data");
  const targetPath = path.join(targetDir, "shell.nss");

  try {
    await mkdir(targetDir, { recursive: true });
    await writeFile(targetPath, 'item(title=\"A\", cmd=\"a.exe\")\n', "utf-8");

    const service = new BackupService(backupRoot, 3);
    assert.ok(service.isBackupPathAllowed(path.join(backupRoot, "x.bak")));
    assert.equal(service.isBackupPathAllowed(path.join(root, "outside", "x.bak")), false);

    for (let i = 0; i < 5; i += 1) {
      await service.createBackupForTarget(targetPath);
      await writeFile(targetPath, `item(title=\"A${i}\", cmd=\"a.exe\")\n`, "utf-8");
    }

    const backups = await service.listBackups(targetPath);
    assert.ok(backups.length <= 3, `Expected max 3 backups after prune, got ${backups.length}`);
    assert.ok(backups.length > 0, "Expected backups after create.");

    const oldest = backups[backups.length - 1];
    assert.ok(oldest, "Expected at least one backup entry.");

    const beforeRestore = await readFile(targetPath, "utf-8");
    const restoreResult = await service.restoreBackup(targetPath, oldest.backupPath);
    assert.ok(restoreResult.bytes > 0, "Expected restored bytes > 0.");
    const afterRestore = await readFile(targetPath, "utf-8");
    assert.notEqual(beforeRestore, afterRestore, "Restore should change target content.");

    const backupsAfterRestore = await service.listBackups(targetPath);
    assert.ok(backupsAfterRestore.length <= 3, "Backup prune should still hold after restore.");

    console.log("release-smoke: OK");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

void run();
