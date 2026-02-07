export type Language = "zh" | "en";

const LANGUAGE_STORAGE_KEY = "shell-manager.language";
const DEFAULT_LANGUAGE: Language = "zh";

const EN_MESSAGES = {
  "error.unknown": "Unknown error.",
  "language.label": "Language",
  "language.zh": "Chinese",
  "language.en": "English",
  "app.subtitle": "Stage 5 Stabilization In Progress | Version {version}",
  "app.backupsRoot": "Backups: {path}",
  "status.ready": "Ready",
  "status.preloadApiUnavailable": "Electron preload API is unavailable.",
  "status.refreshBackupsFailed": "Refresh backups failed: {error}",
  "status.initFailed": "Init failed: {error}",
  "status.loaded": "Loaded: {path}",
  "status.readFailed": "Read failed: {error}",
  "status.saveBlockedParse": "Save blocked: parse errors exist.",
  "status.saveBlockedValidation": "Save blocked: validation errors exist.",
  "status.saved": "Saved: {path} ({bytes} bytes)",
  "status.savedWithBackup": "Saved: {path} ({bytes} bytes), backup={backupPath}",
  "status.saveFailed": "Save failed: {error}",
  "status.modelRefreshed": "Model refreshed from source.",
  "status.sourceParseFailed": "Source parse failed. Please fix parse issues first.",
  "status.applyAutoSucceeded": "Configuration applied.",
  "status.applyFallbackManual": "Apply fallback to manual: {message}",
  "status.applyFailed": "Apply failed: {error}",
  "status.backupPreviewFailed": "Backup preview failed: {error}",
  "status.rollbackSucceeded": "Rollback succeeded from {backupPath}",
  "status.rollbackFailed": "Rollback failed: {error}",
  "label.configFilePath": "Config File Path",
  "placeholder.configFilePath": "C:\\path\\to\\shell.nss",
  "action.read": "Read",
  "action.save": "Save",
  "action.refreshModel": "Refresh Model",
  "action.apply": "Apply",
  "action.refreshBackups": "Refresh Backups",
  "section.menuTree": "Menu Tree",
  "action.addMenu": "+Menu",
  "action.addItem": "+Item",
  "action.addSeparator": "+Sep",
  "action.addModify": "+Modify",
  "action.addRemove": "+Remove",
  "action.copy": "Copy",
  "action.delete": "Delete",
  "action.up": "Up",
  "action.down": "Down",
  "tip.treeLocked": "Source contains parse errors. Fix source or refresh model to unlock tree editing.",
  "tip.treeDrag": "Drag node labels to reorder. Drop inside a menu to append as child.",
  "tip.noNodesYet": "No nodes yet. Add one from above.",
  "tip.loadSourceFirst": "Load source and refresh model to start editing.",
  "section.properties": "Properties",
  "section.ruleCenter": "Rule Center (modify/remove)",
  "tip.noRuleNodes": "No rule nodes yet.",
  "tip.emptyFind": "(empty find)",
  "tip.selectNode": "Select a node to edit attributes.",
  "tip.separatorNoProps": "Separator has no editable properties.",
  "field.path": "Path",
  "field.title": "title",
  "field.mode": "mode",
  "field.type": "type",
  "field.image": "image",
  "field.cmd": "cmd",
  "field.args": "args",
  "field.tip": "tip",
  "field.find": "find",
  "field.vis": "vis",
  "field.position": "position",
  "section.variables": "Variables",
  "section.sourcePreview": "Source Preview",
  "placeholder.sourcePreview": "Source text will be shown here.",
  "sync.syncing": "Synchronizing source to model...",
  "sync.synced": "Source and model are synchronized.",
  "sync.error": "Parse errors detected. Tree/property editing is temporarily locked.",
  "section.parseIssues": "Parse Issues",
  "tip.noParseIssues": "No parse issues.",
  "issue.position": "(line {line}, col {column})",
  "section.validationIssues": "Validation Issues",
  "tip.noValidationIssues": "No validation issues.",
  "section.diffPreview": "Diff Preview",
  "tip.openDiffPreview": "Click Save to open diff preview before write.",
  "diff.summary": "old lines: {oldLines}, new lines: {newLines}, changes: {hasChanges}",
  "word.yes": "yes",
  "word.no": "no",
  "tip.noChangedLines": "No changed lines.",
  "action.confirmSave": "Confirm Save",
  "action.cancel": "Cancel",
  "section.rollbackCenter": "Rollback Center",
  "tip.noBackupsYet": "No backups yet.",
  "placeholder.backupPreview": "Select a backup to preview content.",
  "action.restoreSelectedBackup": "Restore Selected Backup",
  "section.manualApplySteps": "Manual Apply Steps",
  "section.logs": "Logs",
  "tip.noLogsYet": "No logs yet.",
  "node.separator": "separator",
  "node.import": "import",
} as const;

export type MessageKey = keyof typeof EN_MESSAGES;
export type TranslationParams = Record<string, string | number>;

const ZH_MESSAGES: Record<MessageKey, string> = {
  "error.unknown": "未知错误。",
  "language.label": "语言",
  "language.zh": "中文",
  "language.en": "英文",
  "app.subtitle": "阶段 5 稳定性收尾中 | 版本 {version}",
  "app.backupsRoot": "备份目录：{path}",
  "status.ready": "就绪",
  "status.preloadApiUnavailable": "Electron preload API 不可用。",
  "status.refreshBackupsFailed": "刷新备份失败：{error}",
  "status.initFailed": "初始化失败：{error}",
  "status.loaded": "已加载：{path}",
  "status.readFailed": "读取失败：{error}",
  "status.saveBlockedParse": "保存已阻断：存在语法错误。",
  "status.saveBlockedValidation": "保存已阻断：存在校验错误。",
  "status.saved": "已保存：{path}（{bytes} 字节）",
  "status.savedWithBackup": "已保存：{path}（{bytes} 字节），备份={backupPath}",
  "status.saveFailed": "保存失败：{error}",
  "status.modelRefreshed": "模型已从源码刷新。",
  "status.sourceParseFailed": "源码解析失败，请先修复语法问题。",
  "status.applyAutoSucceeded": "配置已应用。",
  "status.applyFallbackManual": "应用自动流程失败，转手动：{message}",
  "status.applyFailed": "应用失败：{error}",
  "status.backupPreviewFailed": "备份预览失败：{error}",
  "status.rollbackSucceeded": "回滚成功：{backupPath}",
  "status.rollbackFailed": "回滚失败：{error}",
  "label.configFilePath": "配置文件路径",
  "placeholder.configFilePath": "C:\\路径\\shell.nss",
  "action.read": "读取",
  "action.save": "保存",
  "action.refreshModel": "刷新模型",
  "action.apply": "应用",
  "action.refreshBackups": "刷新备份",
  "section.menuTree": "菜单树",
  "action.addMenu": "+菜单",
  "action.addItem": "+项目",
  "action.addSeparator": "+分隔",
  "action.addModify": "+修改规则",
  "action.addRemove": "+移除规则",
  "action.copy": "复制",
  "action.delete": "删除",
  "action.up": "上移",
  "action.down": "下移",
  "tip.treeLocked": "源码存在语法错误，请修复或刷新模型后再编辑树和属性。",
  "tip.treeDrag": "可拖拽节点重排；拖入 menu 可作为子节点。",
  "tip.noNodesYet": "当前没有节点，请先新增。",
  "tip.loadSourceFirst": "请先加载源码并刷新模型。",
  "section.properties": "属性面板",
  "section.ruleCenter": "规则中心（modify/remove）",
  "tip.noRuleNodes": "暂无规则节点。",
  "tip.emptyFind": "（空 find）",
  "tip.selectNode": "请选择一个节点编辑属性。",
  "tip.separatorNoProps": "separator 无可编辑属性。",
  "field.path": "路径",
  "field.title": "title",
  "field.mode": "mode",
  "field.type": "type",
  "field.image": "image",
  "field.cmd": "cmd",
  "field.args": "args",
  "field.tip": "tip",
  "field.find": "find",
  "field.vis": "vis",
  "field.position": "position",
  "section.variables": "变量",
  "section.sourcePreview": "源码预览",
  "placeholder.sourcePreview": "源码会显示在这里。",
  "sync.syncing": "正在把源码同步到模型...",
  "sync.synced": "源码与模型已同步。",
  "sync.error": "检测到语法错误，树/属性编辑已临时锁定。",
  "section.parseIssues": "语法问题",
  "tip.noParseIssues": "无语法问题。",
  "issue.position": "（第 {line} 行，第 {column} 列）",
  "section.validationIssues": "校验问题",
  "tip.noValidationIssues": "无校验问题。",
  "section.diffPreview": "Diff 预览",
  "tip.openDiffPreview": "点击保存可先查看写入前 Diff。",
  "diff.summary": "旧行数：{oldLines}，新行数：{newLines}，存在改动：{hasChanges}",
  "word.yes": "是",
  "word.no": "否",
  "tip.noChangedLines": "没有改动行。",
  "action.confirmSave": "确认保存",
  "action.cancel": "取消",
  "section.rollbackCenter": "回滚中心",
  "tip.noBackupsYet": "暂无备份。",
  "placeholder.backupPreview": "选择一个备份以预览内容。",
  "action.restoreSelectedBackup": "恢复所选备份",
  "section.manualApplySteps": "手动应用步骤",
  "section.logs": "日志",
  "tip.noLogsYet": "暂无日志。",
  "node.separator": "分隔符",
  "node.import": "导入",
};

const MESSAGES: Record<Language, Record<MessageKey, string>> = {
  en: EN_MESSAGES,
  zh: ZH_MESSAGES,
};

const LANGUAGE_LOCALE: Record<Language, string> = {
  en: "en-US",
  zh: "zh-CN",
};

export function isLanguage(value: string): value is Language {
  return value === "zh" || value === "en";
}

export function getInitialLanguage(): Language {
  if (typeof window === "undefined") {
    return DEFAULT_LANGUAGE;
  }
  const stored = window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
  if (stored && isLanguage(stored)) {
    return stored;
  }
  return navigator.language.toLowerCase().startsWith("zh") ? "zh" : "en";
}

export function persistLanguage(language: Language): void {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
}

export function getLanguageLocale(language: Language): string {
  return LANGUAGE_LOCALE[language];
}

export function translate(
  language: Language,
  key: MessageKey,
  params: TranslationParams = {},
): string {
  const template = MESSAGES[language][key] ?? MESSAGES.en[key];
  return template.replace(/\{([A-Za-z0-9_]+)\}/g, (full, token: string) => {
    if (!(token in params)) {
      return full;
    }
    return String(params[token]);
  });
}
