# 阶段 5：测试报告（当前轮次）

文档日期：2026-02-07

## 1. 自动化结果

执行命令：
1. `npm run typecheck`
2. `npm run lint`
3. `npm run core:smoke`
4. `npm run editor:smoke`
5. `npm run release:smoke`
6. `npm run stage5:hardening`
7. `npm run res:parse-check`
8. `npm run build`
9. `npm run start`（启动烟测）
10. `npm run package:win:dir`
11. `npm run package:win`

结果：
1. 全部通过。
2. 应用可拉起（启动烟测 `RUNNING`）。
3. Windows 打包产物已生成：
   - `release/win-unpacked`
   - `release/Shell Context Menu Manager Setup 0.1.0.exe`
4. 阶段 5 强化脚本通过：
   - `parse-and-validation-guard`
   - `save-and-rollback-stress`（40 次写入 + 20 次回滚）
   - `rollback-missing-backup`
   - `permission-denied-best-effort`
5. 真实 nss 回归脚本通过：
   - `res-parse-check: total=9, parse-pass=9, parse-fail=0`
   - `validation-issue-total=0`

## 2. 已覆盖范围

1. 解析/序列化/校验 round-trip（10 份示例配置）。
2. 树编辑核心能力（增删改排、拖拽、节点路径映射）。
3. 发布闭环核心能力（写入前备份、备份裁剪、回滚恢复）。
4. 应用配置动作自动失败回退逻辑（命令失败时返回手动步骤）。
5. 错误场景稳定性补充覆盖：
   - 备份缺失恢复失败场景。
   - 权限写入失败场景（best-effort）。
   - 连续保存与回滚压力场景。
6. 真实配置兼容性覆盖：
   - `res/*.nss`（含 `settings/theme/imports` 真实结构）解析与语义校验通过。

## 3. 未覆盖项（待补充手工）

1. 文件/文件夹/桌面/背景等真实右键场景行为验证。
2. 文件占用冲突的真实环境回归（当前仅自动化与错误提示验证）。
3. 30 分钟连续编辑 UI 稳定性记录（当前以脚本覆盖为主）。
4. 安装包安装/卸载路径验证（安装后自动更新链路未验证）。
