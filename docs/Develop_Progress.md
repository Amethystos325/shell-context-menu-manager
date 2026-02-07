# Shell UI 管理器（Electron）开发进度跟踪

> 本文件用于配合 `docs/Develop_Plan.md` 执行分阶段开发。  
> 更新原则：每完成一个阶段，必须同步更新“已完成工作”和“下一阶段工作”。

## 1. 总览看板

| 阶段 | 名称 | 状态 | 开始日期 | 完成日期 |
| --- | --- | --- | --- | --- |
| 阶段 0 | 需求冻结与交互定稿 | Done | 2026-02-07 | 2026-02-07 |
| 阶段 1 | 工程底座与安全通道 | Done | 2026-02-07 | 2026-02-07 |
| 阶段 2 | 配置内核（解析、模型、序列化、校验） | Done | 2026-02-07 | 2026-02-07 |
| 阶段 3 | 可视化编辑器 | Done | 2026-02-07 | 2026-02-07 |
| 阶段 4 | 发布闭环（规则、Diff、备份、回滚、应用） | Done | 2026-02-07 | 2026-02-07 |
| 阶段 5 | 稳定性测试与交付 | In Progress | 2026-02-07 | - |

状态取值约定：
1. `Not Started`：未开始。
2. `In Progress`：进行中。
3. `Blocked`：被阻塞。
4. `Done`：已完成并通过阶段验收。

## 2. 阶段更新记录

### 阶段 0：需求冻结与交互定稿

- 当前状态：`Done`
- 已完成工作：
  - 输出 MVP 功能冻结清单：`docs/Phase0_Feature_Freeze.md`。
  - 输出页面流程与低保真页面结构：`docs/Phase0_Page_Flow.md`。
  - 明确关键主流程与错误场景落点，作为阶段 1 开发输入。
- 下一阶段（阶段 1）应完成工作：
  - 初始化 `Electron + TypeScript + Vite + React/Vue` 工程（Node.js v22）。
  - 完成 `main/preload/renderer` 职责拆分。
  - 完成 IPC 白名单与参数校验基础框架。
  - 打通日志模块与错误码规范。

### 阶段 1：工程底座与安全通道

- 当前状态：`Done`
- 已完成工作：
  - 初始化 `Electron + TypeScript + Vite + React` 工程，Node 版本基线为 `v22.18.0`。
  - 完成 `main/preload/renderer` 三层拆分：
    - `electron/main.ts`
    - `electron/preload.ts`
    - `src/*` 渲染层页面
  - 完成 IPC 白名单通道定义与结果结构：
    - `app:get-info`
    - `file:read-text`
    - `file:write-text`
    - `log:get-recent`
    - `log:push`
  - 完成 IPC 输入校验与错误码规范（`E_VALIDATION`、`E_PERMISSION`、`E_WRITE_FAIL` 等）。
  - 完成基础日志模块（主进程文件日志 + 渲染层日志面板实时展示）。
  - 完成工程验证：
    - `npm run typecheck`
    - `npm run lint`
    - `npm run build`
    - `npm run start` 启动烟测通过。
- 下一阶段（阶段 2）应完成工作：
  - 设计统一领域模型并实现最小解析器。
  - 实现模型序列化和基础校验器。
  - 实现文本 Diff 数据结构。

### 阶段 2：配置内核（解析、模型、序列化、校验）

- 当前状态：`Done`
- 已完成工作：
  - 设计并实现统一领域模型：`src/core/types.ts`。
  - 实现最小语法子集解析器：`src/core/parser.ts`，支持：
    - `menu/item/separator`
    - `modify/remove`
    - `import`（字符串和裸路径识别）
    - 行注释/块注释、行列定位、语法错误抛出
  - 实现模型序列化器：`src/core/serializer.ts`。
  - 实现校验器：`src/core/validator.ts`，覆盖：
    - 必填校验（`item.title/cmd`、`menu.title`、`modify/remove.find`）
    - 字段合法性校验（`type`、`mode`）
  - 实现文本 Diff 数据结构：`src/core/diff.ts`。
  - 实现统一工作流入口：`src/core/workflow.ts`（`parseAndValidate`、`roundTrip`）。
  - 建立内部测试入口：`scripts/core-smoke.ts` + `samples/configs/*.nss`（10 份样例）。
  - 完成验收验证：
    - `npm run core:smoke` 通过（含读-改-写-再读一致场景）
    - `npm run typecheck` 通过
    - `npm run build` 通过
- 下一阶段（阶段 3）应完成工作：
  - 实现菜单树编辑与属性面板。
  - 打通源码视图与变量快捷插入。
  - 增加脏状态提示和离开确认。

### 阶段 3：可视化编辑器

- 当前状态：`Done`
- 已完成工作：
  - 完成三栏编辑器基础布局（树/属性/源码预览）并接入主页面：
    - `src/App.tsx`
    - `src/App.css`
  - 完成菜单树基础操作：
    - 新增节点（`menu/item/separator`）
    - 删除节点
    - 复制节点
    - 上下移动排序
  - 完成按节点类型的属性面板动态渲染：
    - `menu` 属性
    - `item` 属性（含 `args`）
    - `modify/remove` 基础属性
  - 完成源码预览区与模型联动（模型改动实时序列化到源码）。
  - 完成变量快捷插入（`@sel.path` 等）并写入 `item.args`。
  - 完成脏状态提示与窗口关闭前确认（`beforeunload`）。
  - 编辑器基础工具函数已抽离：`src/editor/document-utils.ts`。
  - 完成菜单树拖拽排序（支持拖拽到节点前后，或拖入 `menu` 作为子节点）。
  - 完成源码与模型双向同步细化：
    - 源码输入自动解析并回填模型（带防抖）。
    - 解析失败时锁定树/属性编辑，避免状态冲突。
    - 解析恢复后自动解锁并按节点路径恢复选中态。
  - 完成 import 节点属性安全编辑（不再使用文本正则替换）。
  - 补充阶段 3 稳定性 smoke 脚本：`scripts/editor-smoke.ts`。
  - 完成阶段 3 当前回归验证：
    - `npm run typecheck`
    - `npm run lint`
    - `npm run core:smoke`
    - `npm run editor:smoke`
    - `npm run build`
    - `npm run start` 启动烟测
- 当前阶段剩余工作：
  - 无（已进入阶段 4）。
- 下一阶段（阶段 4）应完成工作：
  - 实现 `modify/remove` 专用编辑器。
  - 打通保存前 Diff、自动备份和回滚中心。
  - 实现应用配置动作与发布日志链路。

### 阶段 4：发布闭环（规则、Diff、备份、回滚、应用）

- 当前状态：`Done`
- 已完成工作：
  - 完成 `modify/remove` 列表化编辑入口（Rule Center）：`src/App.tsx`。
  - 完成保存前 Diff 预览并支持确认/取消写入：`src/App.tsx`。
  - 完成自动备份策略（写入前自动备份，按时间序保留最近 N 份）：`electron/backup-service.ts`、`electron/main.ts`。
  - 完成回滚中心（备份列表 + 预览 + 恢复）：`src/App.tsx`、`electron/main.ts`。
  - 完成应用配置动作：
    - 自动尝试执行 `shell -register -restart`
    - 自动失败时提供手动步骤指引
    - 对应实现：`electron/main.ts`、`src/App.tsx`
  - 完成发布链路 IPC 扩展：
    - `app:apply-config`
    - `backup:list`
    - `backup:restore`
    - 对应定义：`src/shared/ipc.ts`、`src/shared/preload-api.ts`、`electron/preload.ts`
  - 完成阶段 4 专项 smoke：
    - `scripts/release-smoke.ts`
    - `npm run release:smoke` 通过
- 下一阶段（阶段 5）应完成工作：
  - 完成核心回归测试与异常测试。
  - 输出 Windows 安装包、使用手册、问题清单。

### 阶段 5：稳定性测试与交付

- 当前状态：`In Progress`
- 已完成工作：
  - 已具备自动 smoke 套件基础：
    - `npm run core:smoke`
    - `npm run editor:smoke`
    - `npm run release:smoke`
  - 补充阶段 5 文档产出：
    - 测试用例清单：`docs/Stage5_Test_Cases.md`
    - 测试报告：`docs/Stage5_Test_Report.md`
    - 手工测试记录模板：`docs/Stage5_Manual_Test_Record.md`
    - 使用手册：`docs/User_Manual.md`
    - 已知问题：`docs/Known_Issues.md`
  - 完成 Windows 打包链路验证：
    - `npm run package:win:dir`
    - `npm run package:win`
    - 产物：`release/win-unpacked`、`release/Shell Context Menu Manager Setup 0.1.0.exe`
  - 补充阶段 5 强化测试脚本：`scripts/stage5-hardening.ts`
    - 40 次连续写入 + 20 次连续回滚压力验证
    - 备份缺失恢复失败验证（ENOENT）
    - 权限写入失败验证（best-effort）
    - 对应命令：`npm run stage5:hardening`
  - 改进异常错误提示映射：`electron/main.ts`
    - 文件占用错误返回明确重试指引
    - 备份缺失回滚返回明确错误信息
  - 完成 preload API 稳定性修复：
    - `electron/main.ts` 调整窗口 preload 运行配置
    - `src/App.tsx` 增加 API 安全访问封装，避免 `window.shellManager` 空值崩溃
    - `src/types/global.d.ts` 将 `shellManager` 声明为可选类型
  - 完成解析器与校验器语义升级：
    - `src/core/parser.ts` 支持真实 nss 常见语法（空格分隔属性、复杂表达式、未知块/声明容错）
    - `src/core/types.ts`、`src/core/serializer.ts` 增加 `raw` 节点与扩展 import 结构支持
    - `src/core/validator.ts` 从 MVP 枚举校验升级为官方语义友好校验
  - 完成真实配置回归脚本与样例集：
    - 新增 `scripts/res-parse-check.ts`
    - 新增命令 `npm run res:parse-check`
    - 回归样例目录：`res/*.nss`
    - 结果：`9/9` 文件解析通过，校验问题 `0`
- 下一阶段应完成工作：
  - 增补真实右键场景手工回归记录（文件/文件夹/桌面/多选）。
  - 补全文件占用冲突手工测试记录（结合可重试路径）。
  - 补充安装包安装/覆盖安装/卸载手工验证记录。
  - 工程化收尾（签名、图标、发行元数据）。
