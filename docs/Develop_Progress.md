# Shell UI 管理器开发进度（当前版）

## 1. 阶段状态看板

| 阶段 | 状态 | 结果摘要 |
| --- | --- | --- |
| 阶段 0 | Done | MVP 边界与页面流程已冻结。 |
| 阶段 1 | Done | Electron 工程底座、IPC 白名单与日志通道已完成。 |
| 阶段 2 | Done | 解析/序列化/校验/Diff 核心链路已完成。 |
| 阶段 3 | Done | 三栏编辑器、树操作、源码同步已完成。 |
| 阶段 4 | Done | 发布闭环（Diff、备份、回滚、应用）已完成。 |
| 阶段 5 | Done | 稳定性测试、打包链路、用户文档已完成。 |
| 阶段 6 | In Progress | 真实菜单一致性收敛进行中。 |

## 2. 当前基线能力

1. 已形成完整可用链路：配置读取与编辑 -> 校验与 Diff -> 备份写入 -> 回滚恢复 -> 应用配置。
2. 预览链路已切换为真实系统数据：注册表 + COM 探测，渲染不依赖 mock 回退。
3. 阶段 6 回归工具链已形成闭环：
- 结构对比：`stage6:diff`、`stage6:matrix`
- 视觉对比：`stage6:visual-extract`、`stage6:visual-diff`、`stage6:autoplan`
- 实机门禁：`stage6:real-capture`、`stage6:real-regress`
4. 多场景基线已建立：`desktop`、`file`、`dir`、`back`、`drive`、`taskbar`。

## 3. 阶段 6 已完成里程碑

1. 系统菜单采集增强
- 支持更深子菜单层级与禁用态透传。
- 完成多源菜单合并与场景过滤策略。
2. 差异检查增强
- 新增 `disabled-mismatch` 并纳入矩阵回归判定。
- 完成多场景结构差异的稳定执行链路。
3. 视觉回归落地
- 完成截图提取、视觉差异分析、自动策略输出。
- 实现“一键执行 + 明细输出”的回归流程。
4. 实机截图门禁落地
- 支持自动触发右键与菜单窗口捕获。
- 支持严格模式和阈值模式两类回归策略。

## 4. 当前待办（有效执行项）

1. 把视觉回归从单图扩展到多场景批处理，并输出聚合报告。
2. 固化视觉阈值与失败处理规则，降低 OCR 噪声误报。
3. 继续补齐 `CommandStore`/COM 覆盖，优先收敛子菜单和禁用态。
4. 将 `stage6:real-regress` 纳入发布前固定检查清单。

## 5. 回归执行与产物清理

1. 常用执行顺序
- `npm run stage6:matrix`
- `npm run stage6:visual-diff -- --image <image> --baseline <baseline> --sample-path <path>`
- `npm run stage6:real-regress -- --baseline <baseline> --sample-path <path>`
2. 产物管理约定
- `artifacts/` 仅存放临时回归产物。
- 每次回归完成后清理临时截图与日志，避免历史噪声干扰。

## 6. 风险与跟踪点

1. OCR 质量波动可能导致视觉误报，需要阈值与规则共同约束。
2. 第三方菜单项受环境影响较大，需要基线中的可选项机制持续维护。
3. 系统菜单来源差异（注册表/COM）会影响排序与禁用态，需要持续比对和合并策略校准。

## 7. 关联文档

1. 开发计划：`docs/Develop_Plan.md`
2. 阶段 6 差异清单：`docs/Stage6_Diff_Checklist.md`
3. 阶段 6 基线：`docs/Stage6_*_Baseline.json`
4. 阶段 5 测试资料：`docs/Stage5_Test_Cases.md`、`docs/Stage5_Test_Report.md`、`docs/Stage5_Manual_Test_Record.md`
