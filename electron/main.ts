import { constants as fsConstants } from "node:fs";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, ipcMain } from "electron";
import { AppError, ERROR_CODES, type ErrorCode } from "../src/shared/error-codes.js";
import {
  IPC_CHANNELS,
  type AppInfo,
  type IpcErrorShape,
  type IpcResult,
  type ReadTextFileInput,
  type ReadTextFileOutput,
  type WriteTextFileInput,
  type WriteTextFileOutput,
} from "../src/shared/ipc.js";
import { Logger } from "./logger.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const isDev = Boolean(process.env.VITE_DEV_SERVER_URL);
const MAX_TEXT_FILE_SIZE_BYTES = 1024 * 1024;

let mainWindow: BrowserWindow | null = null;
let logger: Logger | null = null;

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

  const absolutePath = path.resolve(trimmed);
  if (!path.isAbsolute(absolutePath)) {
    throw new AppError(ERROR_CODES.VALIDATION, "Path must be absolute.");
  }

  return absolutePath;
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
    width: 1280,
    height: 840,
    minWidth: 1080,
    minHeight: 700,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  window.once("ready-to-show", () => {
    window.show();
  });

  if (isDev) {
    void window.loadURL(process.env.VITE_DEV_SERVER_URL as string);
  } else {
    void window.loadFile(path.join(__dirname, "../dist/index.html"));
  }

  return window;
}

function getDefaultTestFilePath(): string {
  return path.join(app.getPath("userData"), "test-data", "ipc-test.txt");
}

function createAppInfo(): AppInfo {
  return {
    appName: app.getName(),
    appVersion: app.getVersion(),
    defaultTestFilePath: getDefaultTestFilePath(),
  };
}

function registerIpcHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.APP_GET_INFO, (): IpcResult<AppInfo> => {
    const info = createAppInfo();
    logger?.log("info", "App info requested by renderer.");
    return ok(info);
  });

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

        await mkdir(path.dirname(filePath), { recursive: true });
        await writeFile(filePath, content, "utf-8");

        const bytes = Buffer.byteLength(content, "utf-8");
        logger?.log("info", `Write file succeeded: ${filePath} (${bytes} bytes)`);
        return ok({ path: filePath, bytes });
      } catch (error) {
        const ipcError = toIpcError(error, ERROR_CODES.WRITE_FAIL);
        logger?.log("error", `Write file failed: ${ipcError.code} ${ipcError.message}`);
        return fail(ipcError);
      }
    },
  );

  ipcMain.handle(IPC_CHANNELS.LOG_GET_RECENT, (): IpcResult<ReturnType<Logger["getRecent"]>> => {
    return ok(logger?.getRecent() ?? []);
  });
}

app.whenReady().then(() => {
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
