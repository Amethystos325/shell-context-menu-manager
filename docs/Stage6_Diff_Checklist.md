# 阶段 6：真实菜单一致性差异清单

文档日期：2026-02-08

## 1. 基线与执行方式

1. 桌面场景基线：`docs/Stage6_Desktop_Baseline.json`
2. 文件场景基线：`docs/Stage6_File_Baseline.json`
3. 文件夹场景基线：`docs/Stage6_Dir_Baseline.json`
4. 空白处场景基线：`docs/Stage6_Back_Baseline.json`
5. 磁盘场景基线：`docs/Stage6_Drive_Baseline.json`
6. 任务栏场景基线：`docs/Stage6_Taskbar_Baseline.json`
7. 当前默认对比模式：`combined`（系统快照 + `res/shell.nss` 及其 imports 合并结果）
8. 核心期望项：`expected`
9. 允许存在但不计入差异的环境项：`optional`、`optionalPatterns`、`ignoredPatterns`
10. 单场景命令：`npm run stage6:diff`
11. 多场景命令：`npm run stage6:matrix`
12. 可选参数：
   - `npm run stage6:diff -- --shift`
   - `npm run stage6:diff -- --baseline docs/Stage6_Desktop_Baseline.json`
   - `npm run stage6:diff -- --sample-path "C:\\Users\\Public\\Desktop"`
13. 截图提取与视觉对比：
   - `npm run stage6:visual-extract -- --image res/desktop.png`
   - `npm run stage6:visual-diff -- --image res/desktop.png --baseline docs/Stage6_Desktop_Baseline.json --sample-path "C:\\Users\\Public\\Desktop"`
14. 自动策略与回归：
   - `npm run stage6:autoplan -- --image res/desktop.png --baseline docs/Stage6_Desktop_Baseline.json --sample-path "C:\\Users\\Public\\Desktop"`
   - `npm run stage6:regress -- --image res/desktop.png --baseline docs/Stage6_Desktop_Baseline.json --sample-path "C:\\Users\\Public\\Desktop"`

## 2. 对比维度

1. `missing`：`expected` 中存在、当前结果缺失的项。
2. `extra`：当前结果新增、且不在 `expected/optional/ignored/optionalPatterns/ignoredPatterns` 内的项。
3. `order-mismatch`：仅针对 `expected` 项做相对顺序对比（忽略 optional 插入项）。
4. `submenu-mismatch`：关键项子菜单状态不一致。
5. `disabled-mismatch`：关键项禁用状态（disabled）不一致。

## 3. 本轮迭代说明（2026-02-08）

1. 已新增可复现脚本：`scripts/stage6-diff.ts`。
2. 已将快照链路扩展为：
   - COM 读取支持禁用态（disabled）与 2 层子菜单。
   - shell 注册表节点支持解析 `SubCommands` 并回溯 `CommandStore`。
   - 多源合并从“同名去重”升级为“同名合并 + 子菜单合并”。
3. 本文档作为阶段 6 每轮迭代的固定更新入口，后续每次执行脚本后补充差异结果。

## 4. 首轮脚本输出（2026-02-08）

执行命令：`npm run stage6:diff`

结果：
1. `expected=12`, `actual=12`
2. `missing(3)`：`Terminal`、`File manage`、`Go To`
3. `extra(3)`：`Open Git Bash here`、`Open Folder as IntelliJ IDEA Community Edition Project`、`Open Folder as WebStorm Project`
4. `order-mismatch(7)`：`View/Sort by/Refresh/Paste/NVIDIA App/NVIDIA Control Panel/New`
5. `submenu-mismatch(0)`：无

下一轮收敛重点：
1. 合并排序策略按桌面场景做更强约束，降低核心项序号偏移。
2. 补齐 `Terminal` / `File manage` / `Go To` 的稳定读取路径（注册表或 COM 探测结果命名差异归一）。

## 5. 第二轮脚本输出（2026-02-08）

执行命令：`npm run stage6:diff`

结果：
1. `mode=combined`, `expected=12`, `actual=16`
2. `missing(0)`：无
3. `extra(0)`：无（环境项已纳入 `optional`）
4. `order-mismatch(0)`：无
5. `submenu-mismatch(0)`：无

本轮收敛动作：
1. `stage6-diff` 升级为 combined 对比（读取 `res/shell.nss` + imports）。
2. 增加 `optional` 基线机制，避免环境插件菜单造成噪音偏差。
3. 系统快照新增桌面排序归一策略，降低上下文抖动导致的顺序波动。

## 6. 第三轮脚本输出（2026-02-08）

执行命令：`npm run stage6:matrix`

结果：
1. `desktop-combined`: `missing=0`、`extra=0`、`order-mismatch=0`、`submenu-mismatch=0`
2. `file-combined`: `missing=0`、`extra=0`、`order-mismatch=0`、`submenu-mismatch=0`
3. `dir-combined`: `missing=0`、`extra=0`、`order-mismatch=0`、`submenu-mismatch=0`
4. `back-combined`: `missing=0`、`extra=0`、`order-mismatch=0`、`submenu-mismatch=0`

本轮收敛动作：
1. 为 `file/dir/back` 新增独立基线并纳入阶段 6 对比体系。
2. `stage6-diff` 支持 `optionalPatterns/ignoredPatterns`，降低插件与本地语言差异噪音。
3. 新增 `stage6:matrix` 批量执行脚本，形成多场景一键回归入口。

## 7. 第四轮脚本输出（2026-02-08）

执行命令：`npm run stage6:matrix`

结果：
1. `desktop-combined`: `missing=0`、`extra=0`、`order-mismatch=0`、`submenu-mismatch=0`
2. `file-combined`: `missing=0`、`extra=0`、`order-mismatch=0`、`submenu-mismatch=0`
3. `dir-combined`: `missing=0`、`extra=0`、`order-mismatch=0`、`submenu-mismatch=0`
4. `back-combined`: `missing=0`、`extra=0`、`order-mismatch=0`、`submenu-mismatch=0`
5. `drive-combined`: `missing=0`、`extra=0`、`order-mismatch=0`、`submenu-mismatch=0`
6. `taskbar-combined`: `missing=0`、`extra=0`、`order-mismatch=0`、`submenu-mismatch=0`

本轮收敛动作：
1. 新增 `drive/taskbar` 两个场景基线，形成 6 场景覆盖。
2. `stage6:matrix` 扩展为 6 场景批量回归，作为阶段 6 默认验收入口。

## 8. 第五轮脚本输出（2026-02-08）

执行命令：
1. `npm run stage6:diff -- --baseline docs/Stage6_Desktop_Baseline.json --sample-path "C:\\Users\\Public\\Desktop"`
2. `npm run stage6:matrix`

结果：
1. 新增维度：`disabled-mismatch`
2. `desktop/file/dir/back/drive/taskbar` 六场景结构差异均为 0：
   - `missing=0`
   - `extra=0`
   - `order-mismatch=0`
   - `submenu-mismatch=0`
   - `disabled-mismatch=0`

本轮收敛动作：
1. `stage6-diff` 增加 `disabled-mismatch` 对比维度。
2. `stage6-matrix` 同步纳入 `disabled-mismatch` 通过条件。
3. 桌面/空白处快照来源过滤增强，避免注册表噪音项干扰核心对比结果。

## 9. 第六至第七轮脚本输出（2026-02-08）

执行命令：
1. `npm run stage6:visual-extract -- --image res/desktop.png`
2. `npm run stage6:visual-diff -- --image res/desktop.png --baseline docs/Stage6_Desktop_Baseline.json --sample-path "C:\\Users\\Public\\Desktop"`
3. `npm run stage6:autoplan -- --image res/desktop.png --baseline docs/Stage6_Desktop_Baseline.json --sample-path "C:\\Users\\Public\\Desktop"`
4. `npm run stage6:regress -- --image res/desktop.png --baseline docs/Stage6_Desktop_Baseline.json --sample-path "C:\\Users\\Public\\Desktop"`

结果：
1. 视觉对比（`res/desktop.png`）：
   - `missing=0`
   - `extra=0`
   - `order-mismatch=0`
   - `submenu-mismatch=0`
   - `disabled-mismatch=0`
2. 自动策略输出：
   - `score=100`
   - 当前策略判定：`Stable`
3. 一键回归（`stage6:regress`）：
   - `stage6:matrix`、`stage6:visual-diff`、`stage6:autoplan`、`preview:smoke`、`typecheck`、`lint` 全通过（`OK`）。

本轮收敛动作：
1. 新增视觉提取、视觉对比、自动策略、一键回归四个脚本，形成阶段 6 闭环。
2. 视觉提取升级为“文本 OCR + 像素启发式”混合策略，补充 `submenu/disabled/separator` 判定信号。
3. 将 `stage6:regress` 作为阶段 6 当前推荐验收入口。
