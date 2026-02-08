# 阶段 6：真实菜单一致性差异清单

文档日期：2026-02-08

## 1. 基线与执行方式

1. 桌面场景基线：`docs/Stage6_Desktop_Baseline.json`
2. 对比命令：`npm run stage6:diff`
3. 可选参数：
   - `npm run stage6:diff -- --shift`
   - `npm run stage6:diff -- --baseline docs/Stage6_Desktop_Baseline.json`
   - `npm run stage6:diff -- --sample-path "C:\\Users\\Public\\Desktop"`

## 2. 对比维度

1. `missing`：基线中存在、当前快照缺失的项。
2. `extra`：当前快照新增、基线未覆盖的项。
3. `order-mismatch`：同名项顺序偏移（按顶层菜单序号对比）。
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
