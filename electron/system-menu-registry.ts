import { spawn } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type {
  PreviewLocationType,
  SystemMenuEntry,
  SystemMenuSnapshotOutput,
} from "../src/shared/ipc.js";

interface RegistryRoots {
  shell: string[];
  shellex: string[];
}

interface RegBlock {
  path: string;
  values: Map<string, string>;
}

interface RuntimeProbeEntry {
  Title?: string;
  Submenu?: boolean;
  Children?: RuntimeProbeEntry[];
}

interface CommandStoreTemplate {
  keyName: string;
  fallbackTitle: string;
  submenu: boolean;
  children?: CommandStoreTemplate[];
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DESKTOP_NAMESPACE = "::{B4BFCC3A-DB2C-424C-B029-7FE99A87C641}";
const COMMAND_STORE_ROOT = "HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Explorer\\CommandStore\\shell";
const COMMAND_STORE_DESKTOP_KEYS: CommandStoreTemplate[] = [
  { keyName: "Windows.View.OptionsGallery", fallbackTitle: "View", submenu: true },
  {
    keyName: "Windows.SortByColumn",
    fallbackTitle: "Sort by",
    submenu: true,
    children: [
      { keyName: "Windows.SortAscending", fallbackTitle: "Ascending", submenu: false },
      { keyName: "Windows.SortDescending", fallbackTitle: "Descending", submenu: false },
      { keyName: "Windows.SortGroupsAscending", fallbackTitle: "Groups Ascending", submenu: false },
      { keyName: "Windows.SortGroupsDescending", fallbackTitle: "Groups Descending", submenu: false },
    ],
  },
  { keyName: "Windows.paste", fallbackTitle: "Paste", submenu: false },
  { keyName: "Windows.Refresh", fallbackTitle: "Refresh", submenu: false },
];

const REGISTRY_ROOTS: Record<PreviewLocationType, RegistryRoots> = {
  desktop: {
    shell: ["HKEY_CLASSES_ROOT\\DesktopBackground\\Shell"],
    shellex: ["HKEY_CLASSES_ROOT\\DesktopBackground\\Shellex\\ContextMenuHandlers"],
  },
  file: {
    shell: ["HKEY_CLASSES_ROOT\\*\\shell", "HKEY_CLASSES_ROOT\\AllFileSystemObjects\\shell"],
    shellex: [
      "HKEY_CLASSES_ROOT\\*\\shellex\\ContextMenuHandlers",
      "HKEY_CLASSES_ROOT\\AllFileSystemObjects\\shellex\\ContextMenuHandlers",
    ],
  },
  dir: {
    shell: ["HKEY_CLASSES_ROOT\\Directory\\shell", "HKEY_CLASSES_ROOT\\Folder\\shell"],
    shellex: [
      "HKEY_CLASSES_ROOT\\Directory\\shellex\\ContextMenuHandlers",
      "HKEY_CLASSES_ROOT\\Folder\\shellex\\ContextMenuHandlers",
    ],
  },
  drive: {
    shell: ["HKEY_CLASSES_ROOT\\Drive\\shell"],
    shellex: ["HKEY_CLASSES_ROOT\\Drive\\shellex\\ContextMenuHandlers"],
  },
  back: {
    shell: ["HKEY_CLASSES_ROOT\\Directory\\Background\\shell"],
    shellex: ["HKEY_CLASSES_ROOT\\Directory\\Background\\shellex\\ContextMenuHandlers"],
  },
  taskbar: {
    shell: [],
    shellex: [],
  },
};

function getPowerShellPath(): string {
  return process.env.windir
    ? path.join(process.env.windir, "System32", "WindowsPowerShell", "v1.0", "powershell.exe")
    : "powershell.exe";
}

function getProbeScriptPath(): string | null {
  const candidates = [
    path.join(__dirname, "scripts", "context-menu-probe.ps1"),
    path.resolve(process.cwd(), "electron", "scripts", "context-menu-probe.ps1"),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

function runRegQuery(keyPath: string, recursive = true): Promise<string> {
  return new Promise((resolve) => {
    const regExecutable = process.env.windir
      ? `${process.env.windir}\\System32\\reg.exe`
      : "reg.exe";
    const args = ["query", keyPath];
    if (recursive) {
      args.push("/s");
    }

    const child = spawn(regExecutable, args, {
      windowsHide: true,
      shell: false,
    });

    let output = "";

    child.stdout.on("data", (chunk) => {
      output += chunk.toString();
    });

    child.stderr.on("data", () => {
      // Ignore stderr and fallback to empty output for missing keys.
    });

    child.on("error", () => {
      resolve("");
    });

    child.on("close", (code) => {
      if (code !== 0) {
        resolve("");
        return;
      }
      resolve(output);
    });
  });
}

function runPowerShell(command: string): Promise<string> {
  return new Promise((resolve) => {
    const child = spawn(getPowerShellPath(), ["-NoProfile", "-Command", command], {
      windowsHide: true,
      shell: false,
    });
    let output = "";
    child.stdout.on("data", (chunk) => {
      output += chunk.toString();
    });
    child.stderr.on("data", () => {
      // Ignore stderr and return empty string on failure.
    });
    child.on("error", () => {
      resolve("");
    });
    child.on("close", (code) => {
      if (code !== 0) {
        resolve("");
        return;
      }
      resolve(output.trim());
    });
  });
}

function toNormalizedPath(input: string): string {
  return input.replaceAll("/", "\\").trim();
}

function looksLikeAbsoluteWindowsPath(input: string): boolean {
  return /^[a-zA-Z]:\\/.test(input) || input.startsWith("\\\\");
}

function isExistingFile(filePath: string): boolean {
  try {
    return statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function isExistingDirectory(dirPath: string): boolean {
  try {
    return statSync(dirPath).isDirectory();
  } catch {
    return false;
  }
}

function resolveProbeTarget(locationType: PreviewLocationType, samplePath: string): { mode: "background" | "item"; targetPath: string } | null {
  const normalizedSample = toNormalizedPath(samplePath);
  const hasSamplePath = normalizedSample.length > 0 && looksLikeAbsoluteWindowsPath(normalizedSample);

  if (locationType === "desktop") {
    return { mode: "background", targetPath: DESKTOP_NAMESPACE };
  }
  if (locationType === "taskbar") {
    return null;
  }
  if (locationType === "back") {
    if (hasSamplePath && isExistingDirectory(normalizedSample)) {
      return { mode: "background", targetPath: normalizedSample };
    }
    return { mode: "background", targetPath: process.cwd() };
  }
  if (locationType === "file") {
    if (hasSamplePath && isExistingFile(normalizedSample)) {
      return { mode: "item", targetPath: normalizedSample };
    }
    const fallbackFile = path.join(process.cwd(), "package.json");
    if (existsSync(fallbackFile)) {
      return { mode: "item", targetPath: fallbackFile };
    }
    return null;
  }
  if (locationType === "dir") {
    if (hasSamplePath && isExistingDirectory(normalizedSample)) {
      return { mode: "item", targetPath: normalizedSample };
    }
    return { mode: "item", targetPath: process.cwd() };
  }
  if (locationType === "drive") {
    if (hasSamplePath && isExistingDirectory(normalizedSample)) {
      return { mode: "item", targetPath: normalizedSample };
    }
    const systemDrive = process.env.SystemDrive ? `${process.env.SystemDrive}\\` : "C:\\";
    return { mode: "item", targetPath: systemDrive };
  }
  return null;
}

async function runRuntimeProbe(
  locationType: PreviewLocationType,
  shiftKey: boolean,
  samplePath: string,
): Promise<SystemMenuEntry[]> {
  const target = resolveProbeTarget(locationType, samplePath);
  if (!target) {
    return [];
  }

  const scriptPath = getProbeScriptPath();
  if (!scriptPath) {
    return [];
  }

  return new Promise((resolve) => {
    const args = [
      "-NoProfile",
      "-STA",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      scriptPath,
      "-Mode",
      target.mode,
      "-TargetPath",
      target.targetPath,
    ];
    if (shiftKey) {
      args.push("-Shift");
    }

    const child = spawn(getPowerShellPath(), args, {
      windowsHide: true,
      shell: false,
    });

    let stdout = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", () => {
      // Ignore stderr and fallback to registry-only entries.
    });

    child.on("error", () => {
      resolve([]);
    });

    child.on("close", (code) => {
      if (code !== 0 || !stdout.trim()) {
        resolve([]);
        return;
      }
      try {
        const parsed = JSON.parse(stdout) as RuntimeProbeEntry | RuntimeProbeEntry[];
        const list = Array.isArray(parsed) ? parsed : [parsed];
        const entries = mapRuntimeProbeEntries(list, target.mode, target.targetPath, "root");
        resolve(entries);
      } catch {
        resolve([]);
      }
    });
  });
}

function parseRegQueryOutput(raw: string): RegBlock[] {
  const blocks: RegBlock[] = [];
  let current: RegBlock | null = null;
  const lines = raw.split(/\r?\n/);

  for (const line of lines) {
    const trimmedEnd = line.trimEnd();
    if (!trimmedEnd) {
      continue;
    }

    if (/^HKEY_/i.test(trimmedEnd)) {
      current = {
        path: trimmedEnd,
        values: new Map<string, string>(),
      };
      blocks.push(current);
      continue;
    }

    if (!current) {
      continue;
    }

    const match = line.match(/^\s{4}(.+?)\s{2,}REG_[A-Z0-9_]+\s*(.*)$/i);
    if (!match) {
      continue;
    }
    const name = match[1].trim().toLowerCase();
    const value = match[2].trim();
    current.values.set(name, value);
  }

  return blocks;
}

function toBlockIndex(blocks: RegBlock[]): Map<string, RegBlock> {
  const index = new Map<string, RegBlock>();
  for (const block of blocks) {
    index.set(block.path.toLowerCase(), block);
  }
  return index;
}

function collectDirectChildKeys(blocks: RegBlock[], rootPath: string): string[] {
  const rootLower = rootPath.toLowerCase();
  const prefix = `${rootLower}\\`;
  const childMap = new Map<string, string>();

  for (const block of blocks) {
    const keyLower = block.path.toLowerCase();
    if (!keyLower.startsWith(prefix)) {
      continue;
    }
    const relative = block.path.slice(rootPath.length + 1);
    if (!relative) {
      continue;
    }
    const firstSegment = relative.split("\\")[0];
    if (!firstSegment) {
      continue;
    }
    const directPath = `${rootPath}\\${firstSegment}`;
    const directKey = directPath.toLowerCase();
    if (!childMap.has(directKey)) {
      childMap.set(directKey, directPath);
    }
  }

  return [...childMap.values()];
}

function normalizeRegistryTitle(raw: string, fallback: string): string {
  const trimmed = raw.trim().replace(/^"(.*)"$/, "$1");
  const cleanFallback = fallback.trim();
  if (!trimmed) {
    return cleanFallback;
  }
  if (trimmed === "-") {
    return "";
  }
  if (trimmed.startsWith("@")) {
    return cleanFallback;
  }
  return trimmed.replace(/&(?=\S)/g, "").trim();
}

const indirectStringCache = new Map<string, string>();

function escapePowerShellSingleQuoted(value: string): string {
  return value.replace(/'/g, "''");
}

async function resolveIndirectTitle(raw: string, fallback: string): Promise<string> {
  const token = raw.trim();
  if (!token.startsWith("@")) {
    return normalizeRegistryTitle(token, fallback);
  }

  const cached = indirectStringCache.get(token);
  if (cached !== undefined) {
    return cached || fallback;
  }

  const escapedToken = escapePowerShellSingleQuoted(token);
  const command = [
    "$sig='[System.Runtime.InteropServices.DllImport(\"shlwapi.dll\", CharSet=System.Runtime.InteropServices.CharSet.Unicode)] public static extern int SHLoadIndirectString(string pszSource, System.Text.StringBuilder pszOutBuf, int cchOutBuf, System.IntPtr pvReserved);'",
    "Add-Type -MemberDefinition $sig -Name IndirectNative -Namespace ShellCtx -ErrorAction SilentlyContinue | Out-Null",
    "$sb=New-Object System.Text.StringBuilder 512",
    `$r=[ShellCtx.IndirectNative]::SHLoadIndirectString('${escapedToken}',$sb,$sb.Capacity,[IntPtr]::Zero)`,
    "if($r -eq 0){$sb.ToString().Trim()}",
  ].join("; ");

  const resolved = (await runPowerShell(command)).trim();
  indirectStringCache.set(token, resolved);
  return normalizeRegistryTitle(resolved || fallback, fallback);
}

function normalizeCommandStoreTitle(keyName: string, resolvedTitle: string, fallback: string): string {
  const resolved = resolvedTitle.trim();
  const lower = resolved.toLowerCase();
  if (keyName === "Windows.View.OptionsGallery" && (lower === "options" || lower === "option")) {
    return fallback;
  }
  return resolved || fallback;
}

function normalizeDesktopEntryTitle(entry: SystemMenuEntry): SystemMenuEntry | null {
  const tail = getKeyTail(entry.registryKey);
  const tailLower = tail.toLowerCase();
  let title = entry.title.trim();
  let submenu = entry.submenu;

  if (entry.source === "runtime-com" && title.toLowerCase() === "open in terminal") {
    title = "Terminal";
    submenu = true;
  }

  if (title.toLowerCase() === "display") {
    title = "Display settings";
  }

  if (tailLower === "nvappdesktopcontext") {
    title = "NVIDIA App";
  }
  if (tailLower === "nvcpldesktopcontext") {
    title = "NVIDIA Control Panel";
  }

  const normalized = title.toLowerCase();
  if (
    normalized === "properties" ||
    normalized === "give access to" ||
    normalized === "nilesoft.shell" ||
    normalized === "slideshowcontextmenu" ||
    normalized.startsWith(".spotlight") ||
    normalized === "editstickers"
  ) {
    return null;
  }

  const children = (entry.children ?? [])
    .map(normalizeDesktopEntryTitle)
    .filter((item): item is SystemMenuEntry => Boolean(item));

  return {
    ...entry,
    title,
    submenu: submenu || children.length > 0,
    children,
  };
}

function getRegValue(block: RegBlock | undefined, key: string): string {
  if (!block) {
    return "";
  }
  return block.values.get(key.toLowerCase())?.trim() ?? "";
}

function getKeyTail(regPath: string): string {
  const parts = regPath.split("\\");
  return parts[parts.length - 1] ?? regPath;
}

function isClsid(value: string): boolean {
  return /^\{[0-9a-f-]{36}\}$/i.test(value.trim());
}

async function resolveClsidTitle(clsid: string): Promise<string> {
  const keyPath = `HKEY_CLASSES_ROOT\\CLSID\\${clsid}`;
  const output = await runRegQuery(keyPath, false);
  if (!output) {
    return clsid;
  }
  const blocks = parseRegQueryOutput(output);
  const root = blocks.find((block) => block.path.toLowerCase() === keyPath.toLowerCase());
  const defaultValue = getRegValue(root, "(default)");
  if (!defaultValue || defaultValue.startsWith("@")) {
    return clsid;
  }
  return defaultValue;
}

function hasSubmenu(verbPath: string, block: RegBlock | undefined, blocks: RegBlock[]): boolean {
  if (getRegValue(block, "subcommands")) {
    return true;
  }

  const shellPrefix = `${verbPath.toLowerCase()}\\shell`;
  return blocks.some((candidate) => {
    const value = candidate.path.toLowerCase();
    return value === shellPrefix || value.startsWith(`${shellPrefix}\\`);
  });
}

async function readShellEntries(rootPath: string, shiftKey: boolean): Promise<SystemMenuEntry[]> {
  const raw = await runRegQuery(rootPath, true);
  if (!raw) {
    return [];
  }
  const blocks = parseRegQueryOutput(raw);
  const blockIndex = toBlockIndex(blocks);
  const childKeys = collectDirectChildKeys(blocks, rootPath);
  const entries: SystemMenuEntry[] = [];

  for (const childPath of childKeys) {
    const block = blockIndex.get(childPath.toLowerCase());
    if (!block) {
      continue;
    }

    if (getRegValue(block, "legacydisable")) {
      continue;
    }
    if (getRegValue(block, "programmaticaccessonly")) {
      continue;
    }

    const extended = Boolean(getRegValue(block, "extended"));
    if (extended && !shiftKey) {
      continue;
    }

    const keyTail = getKeyTail(childPath);
    const rawTitle = getRegValue(block, "muiverb") || getRegValue(block, "(default)") || keyTail;
    const title = normalizeRegistryTitle(rawTitle, keyTail);
    if (!title) {
      continue;
    }

    entries.push({
      title,
      submenu: hasSubmenu(childPath, block, blocks),
      source: "shell",
      registryKey: childPath,
    });
  }

  return entries;
}

async function readShellexEntries(rootPath: string, shiftKey: boolean): Promise<SystemMenuEntry[]> {
  const raw = await runRegQuery(rootPath, true);
  if (!raw) {
    return [];
  }
  const blocks = parseRegQueryOutput(raw);
  const blockIndex = toBlockIndex(blocks);
  const childKeys = collectDirectChildKeys(blocks, rootPath);
  const entries: SystemMenuEntry[] = [];

  for (const childPath of childKeys) {
    const block = blockIndex.get(childPath.toLowerCase());
    if (!block) {
      continue;
    }

    if (getRegValue(block, "legacydisable")) {
      continue;
    }

    const extended = Boolean(getRegValue(block, "extended"));
    if (extended && !shiftKey) {
      continue;
    }

    const keyTail = getKeyTail(childPath);
    const defaultValue = getRegValue(block, "(default)");
    const resolvedTitle = isClsid(defaultValue)
      ? await resolveClsidTitle(defaultValue)
      : defaultValue || keyTail;
    const title = normalizeRegistryTitle(resolvedTitle, keyTail);
    if (!title) {
      continue;
    }

    entries.push({
      title,
      submenu: false,
      source: "shellex",
      registryKey: childPath,
    });
  }

  return entries;
}

async function readCommandStoreDesktopEntries(): Promise<SystemMenuEntry[]> {
  const resolveTemplate = async (
    template: CommandStoreTemplate,
    rootPrefix = COMMAND_STORE_ROOT,
  ): Promise<SystemMenuEntry | null> => {
    const keyPath = `${rootPrefix}\\${template.keyName}`;
    const output = await runRegQuery(keyPath, false);
    if (!output) {
      return null;
    }
    const blocks = parseRegQueryOutput(output);
    const root = blocks.find((block) => block.path.toLowerCase() === keyPath.toLowerCase());
    const muiVerb = getRegValue(root, "muiverb");
    const resolvedTitle = normalizeCommandStoreTitle(
      template.keyName,
      await resolveIndirectTitle(muiVerb || template.fallbackTitle, template.fallbackTitle),
      template.fallbackTitle,
    );
    if (!resolvedTitle.trim()) {
      return null;
    }
    const children: SystemMenuEntry[] = [];
    if (template.children && template.children.length > 0) {
      for (const childTemplate of template.children) {
        const child = await resolveTemplate(childTemplate);
        if (child) {
          children.push(child);
        }
      }
    }
    const dedupedChildren: SystemMenuEntry[] = [];
    const childSeen = new Set<string>();
    for (const child of children) {
      const key = child.title.trim().toLowerCase();
      if (!key || childSeen.has(key)) {
        continue;
      }
      childSeen.add(key);
      dedupedChildren.push(child);
    }
    return {
      title: resolvedTitle,
      submenu: template.submenu || dedupedChildren.length > 0,
      source: "shell",
      registryKey: keyPath,
      children: dedupedChildren,
    };
  };

  const entries: SystemMenuEntry[] = [];
  for (const template of COMMAND_STORE_DESKTOP_KEYS) {
    const entry = await resolveTemplate(template);
    if (entry) {
      entries.push(entry);
    }
  }
  return entries;
}

async function readDesktopExtraNvidiaEntries(shiftKey: boolean): Promise<SystemMenuEntry[]> {
  const entries = await readShellexEntries(
    "HKEY_CLASSES_ROOT\\Directory\\Background\\shellex\\ContextMenuHandlers",
    shiftKey,
  );
  return entries.filter((entry) => {
    const tail = getKeyTail(entry.registryKey).toLowerCase();
    return tail === "nvappdesktopcontext" || tail === "nvcpldesktopcontext";
  });
}

function dedupeEntries(entries: SystemMenuEntry[]): SystemMenuEntry[] {
  const seen = new Set<string>();
  const out: SystemMenuEntry[] = [];
  for (const entry of entries) {
    const key = entry.title.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(entry);
  }
  return out;
}

function mapRuntimeProbeEntries(
  entries: RuntimeProbeEntry[] | undefined,
  mode: "background" | "item",
  targetPath: string,
  parentKey: string,
): SystemMenuEntry[] {
  if (!entries || entries.length === 0) {
    return [];
  }

  const output: SystemMenuEntry[] = [];
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    const title = String(entry?.Title ?? "").trim();
    if (!title) {
      continue;
    }
    const key = `${parentKey}/${index}`;
    const children = mapRuntimeProbeEntries(entry?.Children, mode, targetPath, key);
    output.push({
      title,
      submenu: Boolean(entry?.Submenu) || children.length > 0,
      source: "runtime-com",
      registryKey: `runtime-com:${mode}:${targetPath}:${key}`,
      children,
    });
  }
  return output;
}

export async function readSystemMenuSnapshot(
  locationType: PreviewLocationType,
  shiftKey: boolean,
  samplePath = "",
): Promise<SystemMenuSnapshotOutput> {
  const roots = REGISTRY_ROOTS[locationType];
  if (!roots) {
    return { locationType, entries: [] };
  }

  const runtimeEntries = await runRuntimeProbe(locationType, shiftKey, samplePath);
  const shellEntryGroups = await Promise.all(roots.shell.map((root) => readShellEntries(root, shiftKey)));
  const shellexEntryGroups = await Promise.all(roots.shellex.map((root) => readShellexEntries(root, shiftKey)));
  const commandStoreEntries =
    locationType === "desktop" || locationType === "back" ? await readCommandStoreDesktopEntries() : [];
  const desktopExtraEntries = locationType === "desktop" ? await readDesktopExtraNvidiaEntries(shiftKey) : [];
  const merged = dedupeEntries([
    ...runtimeEntries,
    ...commandStoreEntries,
    ...desktopExtraEntries,
    ...shellEntryGroups.flat(),
    ...shellexEntryGroups.flat(),
  ]);
  const normalized =
    locationType === "desktop"
      ? merged.map(normalizeDesktopEntryTitle).filter((item): item is SystemMenuEntry => Boolean(item))
      : merged;
  return {
    locationType,
    entries: normalized,
  };
}
