# 阶段 6：真实菜单一致性差异清单

文档日期：2026-02-08

## 1. 基线与执行方式

1. 桌面场景基线：`docs/Stage6_Desktop_Baseline.json`
2. 当前默认对比模式：`combined`（系统快照 + `res/shell.nss` 及其 imports 合并结果）
3. 核心期望项：`expected`
4. 允许存在但不计入差异的环境项：`optional`
5. 对比命令：`npm run stage6:diff`
6. 可选参数：
   - `npm run stage6:diff -- --shift`
   - `npm run stage6:diff -- --baseline docs/Stage6_Desktop_Baseline.json`
   - `npm run stage6:diff -- --sample-path "C:\\Users\\Public\\Desktop"`

## 2. 对比维度

1. `missing`：`expected` 中存在、当前结果缺失的项。
2. `extra`：当前结果新增、且不在 `expected/optional/ignored` 内的项。
3. `order-mismatch`：仅针对 `expected` 项做相对顺序对比（忽略 optional 插入项）。
4. `submenu-mismatch`：关键项子菜单状态不一致。

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
