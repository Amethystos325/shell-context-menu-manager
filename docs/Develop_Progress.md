# Shell UI 管理器（Electron）开发进度跟踪

> 本文件用于配合 `docs/Develop_Plan.md` 执行分阶段开发。  
> 更新原则：每完成一个阶段，必须同步更新“已完成工作”和“下一阶段工作”。

## 1. 总览看板

| 阶段 | 名称 | 状态 | 开始日期 | 完成日期 |
| --- | --- | --- | --- | --- |
| 阶段 0 | 需求冻结与交互定稿 | Done | 2026-02-07 | 2026-02-07 |
| 阶段 1 | 工程底座与安全通道 | Done | 2026-02-07 | 2026-02-07 |
| 阶段 2 | 配置内核（解析、模型、序列化、校验） | In Progress | 2026-02-07 | - |
| 阶段 3 | 可视化编辑器 | Not Started | - | - |
| 阶段 4 | 发布闭环（规则、Diff、备份、回滚、应用） | Not Started | - | - |
| 阶段 5 | 稳定性测试与交付 | Not Started | - | - |

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

- 当前状态：`In Progress`
- 已完成工作：
  - 阶段启动，已完成工程底座对接，可进入配置解析与序列化实现。
- 下一阶段（阶段 3）应完成工作：
  - 实现菜单树编辑与属性面板。
  - 打通源码视图与变量快捷插入。
  - 增加脏状态提示和离开确认。

### 阶段 3：可视化编辑器

- 当前状态：`Not Started`
- 已完成工作：
  - 暂无
- 下一阶段（阶段 4）应完成工作：
  - 实现 `modify/remove` 专用编辑器。
  - 打通保存前 Diff、自动备份和回滚中心。
  - 实现应用配置动作与发布日志链路。

### 阶段 4：发布闭环（规则、Diff、备份、回滚、应用）

- 当前状态：`Not Started`
- 已完成工作：
  - 暂无
- 下一阶段（阶段 5）应完成工作：
  - 完成核心回归测试与异常测试。
  - 输出 Windows 安装包、使用手册、问题清单。

### 阶段 5：稳定性测试与交付

- 当前状态：`Not Started`
- 已完成工作：
  - 暂无
- 下一阶段应完成工作：
  - MVP 迭代规划（超出当前计划范围时新增文档）。
