import { constants as fsConstants } from "node:fs";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, dialog, ipcMain } from "electron";
import { BackupService } from "./backup-service.js";
import { Logger } from "./logger.js";
import { AppError, ERROR_CODES, type ErrorCode } from "../src/shared/error-codes.js";
import {
  IPC_CHANNELS,
  type AppInfo,
  type ApplyConfigInput,
  type ApplyConfigOutput,
  type IpcErrorShape,
  type IpcResult,
  type ListBackupsInput,
  type ListBackupsOutput,
  type ReadTextFileInput,
  type ReadTextFileOutput,
  type SelectTextFileInput,
  type SelectTextFileOutput,
  type RestoreBackupInput,
  type RestoreBackupOutput,
  type WriteTextFileInput,
  type WriteTextFileOutput,
} from "../src/shared/ipc.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const isDev = Boolean(process.env.VITE_DEV_SERVER_URL);
const MAX_TEXT_FILE_SIZE_BYTES = 1024 * 1024;
const BACKUP_KEEP_COUNT = 10;

let mainWindow: BrowserWindow | null = null;
let logger: Logger | null = null;
let backupService: BackupService | null = null;

function ok<T>(data: T): IpcResult<T> {
  return { ok: true, data };
}

function fail<T>(error: IpcErrorShape): IpcResult<T> {
  return { ok: false, error };
}

function assertObject(value: unknown): asserts value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) {
    throw new AppError(ERROR_CODES.IPC_BAD_REQUEST, "Invalid IPC payload.");
  }
}

function validateTextPath(rawPath: unknown): string {
  if (typeof rawPath !== "string") {
    throw new AppError(ERROR_CODES.IPC_BAD_REQUEST, "Path must be a string.");
  }

  const trimmed = rawPath.trim();
  if (!trimmed) {
    throw new AppError(ERROR_CODES.VALIDATION, "Path cannot be empty.");
  }

  if (!path.isAbsolute(trimmed)) {
    throw new AppError(ERROR_CODES.VALIDATION, "Path must be absolute.");
  }

  return path.normalize(trimmed);
}

function validateTextContent(rawContent: unknown): string {
  if (typeof rawContent !== "string") {
    throw new AppError(ERROR_CODES.IPC_BAD_REQUEST, "Content must be a string.");
  }

  const bytes = Buffer.byteLength(rawContent, "utf-8");
  if (bytes > MAX_TEXT_FILE_SIZE_BYTES) {
    throw new AppError(
      ERROR_CODES.VALIDATION,
      `File content exceeds limit (${MAX_TEXT_FILE_SIZE_BYTES} bytes).`,
    );
  }

  return rawContent;
}

function validateBackupPath(rawPath: unknown): string {
  const backupPath = validateTextPath(rawPath);
  if (!backupService) {
    throw new AppError(ERROR_CODES.BACKUP_FAIL, "Backup service is unavailable.");
  }
  if (!backupService.isBackupPathAllowed(backupPath)) {
    throw new AppError(ERROR_CODES.VALIDATION, "Backup path is out of allowed directory.");
  }
  return backupPath;
}

function toIpcError(error: unknown, fallbackCode: ErrorCode): IpcErrorShape {
  if (error instanceof AppError) {
    return {
      code: error.code,
      message: error.message,
      details: error.details,
    };
  }

  if (error instanceof Error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "EACCES" || code === "EPERM") {
      return {
        code: ERROR_CODES.PERMISSION,
        message: "Permission denied.",
        details: error.message,
      };
    }
    if (code === "EBUSY" || code === "ETXTBSY" || code === "EAGAIN") {
      return {
        code: fallbackCode,
        message: "Target file is in use. Close related process and retry.",
        details: error.message,
      };
    }
    if (code === "ENOENT" && fallbackCode === ERROR_CODES.ROLLBACK_FAIL) {
      return {
        code: ERROR_CODES.ROLLBACK_FAIL,
        message: "Backup file does not exist.",
        details: error.message,
      };
    }
    return {
      code: fallbackCode,
      message: error.message,
    };
  }

  return {
    code: fallbackCode,
    message: "Unknown error.",
  };
}

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1360,
    height: 900,
    minWidth: 1080,
    minHeight: 700,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  window.once("ready-to-show", () => {
    window.show();
  });

  if (isDev) {
    void window.loadURL(process.env.VITE_DEV_SERVER_URL as string);
  } else {
    void window.loadFile(path.join(__dirname, "../../dist/index.html"));
  }

  return window;
}

function getDefaultTestFilePath(): string {
  return path.join(app.getPath("userData"), "test-data", "ipc-test.txt");
}

function getBackupRootPath(): string {
  return path.join(app.getPath("userData"), "backups");
}

function createAppInfo(): AppInfo {
  return {
    appName: app.getName(),
    appVersion: app.getVersion(),
    defaultTestFilePath: getDefaultTestFilePath(),
    backupRootPath: getBackupRootPath(),
  };
}

function runCommand(
  command: string,
  args: string[],
  timeoutMs: number,
): Promise<{ success: boolean; output: string; exitCode: number | null }> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      windowsHide: true,
      shell: false,
    });

    let output = "";
    let finished = false;

    const done = (success: boolean, exitCode: number | null) => {
      if (finished) {
        return;
      }
      finished = true;
      resolve({
        success,
        output: output.trim(),
        exitCode,
      });
    };

    const timer = setTimeout(() => {
      child.kill();
      done(false, null);
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      output += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      output += chunk.toString();
    });

    child.on("error", (error) => {
      output += `\n${error.message}`;
      clearTimeout(timer);
      done(false, null);
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      done(code === 0, code);
    });
  });
}

function getApplyManualSteps(targetPath: string): string[] {
  return [
    "1. 确认 Nilesoft Shell 已安装且扩展已注册。",
    "2. 打开终端（建议管理员权限），执行：shell -register -restart",
    `3. 手动验证目标配置文件：${targetPath}`,
    "4. 若命令不可用，请使用 Ctrl + 右键执行刷新并重新验证菜单效果。",
  ];
}

async function handleApplyConfig(input: ApplyConfigInput): Promise<ApplyConfigOutput> {
  assertObject(input);
  const targetPath = validateTextPath(input.targetPath);
  const commandTried = "shell -register -restart";

  const commandResult = await runCommand("shell", ["-register", "-restart"], 8000);
  if (commandResult.success) {
    logger?.log("info", `Apply config succeeded automatically for ${targetPath}`);
    return {
      mode: "auto",
      commandTried,
      success: true,
      message: "配置已自动应用。",
    };
  }

  logger?.log("warn", `Apply config auto step failed; fallback to manual for ${targetPath}`);
  return {
    mode: "manual",
    commandTried,
    success: false,
    message:
      commandResult.output ||
      `自动应用失败（exit=${commandResult.exitCode ?? "timeout"}），请按手动步骤操作。`,
    manualSteps: getApplyManualSteps(targetPath),
  };
}

function registerIpcHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.APP_GET_INFO, (): IpcResult<AppInfo> => {
    const info = createAppInfo();
    logger?.log("info", "App info requested by renderer.");
    return ok(info);
  });

  ipcMain.handle(
    IPC_CHANNELS.FILE_SELECT_TEXT,
    async (_, input: SelectTextFileInput): Promise<IpcResult<SelectTextFileOutput | null>> => {
      try {
        assertObject(input);
        const defaultPath = typeof input.defaultPath === "string" ? input.defaultPath.trim() : "";
        const selected = await dialog.showOpenDialog({
          title: "Select shell config file",
          defaultPath: defaultPath || undefined,
          properties: ["openFile"],
          filters: [
            { name: "NSS Config", extensions: ["nss"] },
            { name: "Text Files", extensions: ["txt"] },
            { name: "All Files", extensions: ["*"] },
          ],
        });

        if (selected.canceled || selected.filePaths.length === 0) {
          return ok(null);
        }

        const filePath = path.normalize(selected.filePaths[0]);
        logger?.log("info", `Select file succeeded: ${filePath}`);
        return ok({ path: filePath });
      } catch (error) {
        const ipcError = toIpcError(error, ERROR_CODES.READ_FAIL);
        logger?.log("error", `Select file failed: ${ipcError.code} ${ipcError.message}`);
        return fail(ipcError);
      }
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.FILE_READ_TEXT,
    async (_, input: ReadTextFileInput): Promise<IpcResult<ReadTextFileOutput>> => {
      try {
        assertObject(input);
        const filePath = validateTextPath(input.path);

        try {
          await access(filePath, fsConstants.R_OK);
        } catch (error) {
          const code = (error as NodeJS.ErrnoException).code;
          if (code === "ENOENT") {
            await mkdir(path.dirname(filePath), { recursive: true });
            await writeFile(filePath, "", "utf-8");
          } else {
            throw error;
          }
        }

        const content = await readFile(filePath, "utf-8");
        logger?.log("info", `Read file succeeded: ${filePath}`);
        return ok({ path: filePath, content });
      } catch (error) {
        const ipcError = toIpcError(error, ERROR_CODES.READ_FAIL);
        logger?.log("error", `Read file failed: ${ipcError.code} ${ipcError.message}`);
        return fail(ipcError);
      }
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.FILE_WRITE_TEXT,
    async (_, input: WriteTextFileInput): Promise<IpcResult<WriteTextFileOutput>> => {
      try {
        assertObject(input);
        const filePath = validateTextPath(input.path);
        const content = validateTextContent(input.content);

        const backupEntry = await backupService?.createBackupForTarget(filePath);
        await mkdir(path.dirname(filePath), { recursive: true });
        await writeFile(filePath, content, "utf-8");

        const bytes = Buffer.byteLength(content, "utf-8");
        logger?.log(
          "info",
          `Write file succeeded: ${filePath} (${bytes} bytes)${
            backupEntry ? `; backup=${backupEntry.backupPath}` : ""
          }`,
        );
        return ok({ path: filePath, bytes, backupPath: backupEntry?.backupPath });
      } catch (error) {
        const ipcError = toIpcError(error, ERROR_CODES.WRITE_FAIL);
        logger?.log("error", `Write file failed: ${ipcError.code} ${ipcError.message}`);
        return fail(ipcError);
      }
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.BACKUP_LIST,
    async (_, input: ListBackupsInput): Promise<IpcResult<ListBackupsOutput>> => {
      try {
        assertObject(input);
        const targetPath = validateTextPath(input.targetPath);
        if (!backupService) {
          throw new AppError(ERROR_CODES.BACKUP_FAIL, "Backup service unavailable.");
        }
        const backups = await backupService.listBackups(targetPath);
        return ok({ targetPath, backups });
      } catch (error) {
        const ipcError = toIpcError(error, ERROR_CODES.BACKUP_FAIL);
        logger?.log("error", `List backup failed: ${ipcError.code} ${ipcError.message}`);
        return fail(ipcError);
      }
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.BACKUP_RESTORE,
    async (_, input: RestoreBackupInput): Promise<IpcResult<RestoreBackupOutput>> => {
      try {
        assertObject(input);
        const targetPath = validateTextPath(input.targetPath);
        const backupPath = validateBackupPath(input.backupPath);
        if (!backupService) {
          throw new AppError(ERROR_CODES.ROLLBACK_FAIL, "Backup service unavailable.");
        }

        await access(backupPath, fsConstants.F_OK | fsConstants.R_OK);
        const restored = await backupService.restoreBackup(targetPath, backupPath);
        logger?.log("info", `Rollback succeeded: ${backupPath} -> ${targetPath}`);
        return ok({
          targetPath,
          backupPath,
          bytes: restored.bytes,
          createdBackupPath: restored.createdBackupPath,
        });
      } catch (error) {
        const ipcError = toIpcError(error, ERROR_CODES.ROLLBACK_FAIL);
        logger?.log("error", `Rollback failed: ${ipcError.code} ${ipcError.message}`);
        return fail(ipcError);
      }
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.APP_APPLY_CONFIG,
    async (_, input: ApplyConfigInput): Promise<IpcResult<ApplyConfigOutput>> => {
      try {
        const result = await handleApplyConfig(input);
        return ok(result);
      } catch (error) {
        const ipcError = toIpcError(error, ERROR_CODES.APPLY_FAIL);
        logger?.log("error", `Apply config failed: ${ipcError.code} ${ipcError.message}`);
        return fail(ipcError);
      }
    },
  );

  ipcMain.handle(IPC_CHANNELS.LOG_GET_RECENT, (): IpcResult<ReturnType<Logger["getRecent"]>> => {
    return ok(logger?.getRecent() ?? []);
  });
}

app.whenReady().then(() => {
  backupService = new BackupService(getBackupRootPath(), BACKUP_KEEP_COUNT);
  logger = new Logger(path.join(app.getPath("userData"), "logs"));
  mainWindow = createWindow();

  const unsubscribe = logger.subscribe((entry) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(IPC_CHANNELS.LOG_PUSH, entry);
    }
  });

  registerIpcHandlers();
  logger.log("info", "Application initialized.");

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createWindow();
    }
  });

  app.on("before-quit", () => {
    unsubscribe();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
