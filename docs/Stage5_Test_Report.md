# 阶段 5：测试报告（当前轮次）

文档日期：2026-02-07

## 1. 自动化结果

执行命令：
1. `npm run typecheck`
2. `npm run lint`
3. `npm run core:smoke`
4. `npm run editor:smoke`
5. `npm run release:smoke`
6. `npm run build`
7. `npm run start`（启动烟测）
8. `npm run package:win:dir`
9. `npm run package:win`

结果：
1. 全部通过。
2. 应用可拉起（启动烟测 `RUNNING`）。
3. Windows 打包产物已生成：
   - `release/win-unpacked`
   - `release/Shell Context Menu Manager Setup 0.1.0.exe`

## 2. 已覆盖范围

1. 解析/序列化/校验 round-trip（10 份示例配置）。
2. 树编辑核心能力（增删改排、拖拽、节点路径映射）。
3. 发布闭环核心能力（写入前备份、备份裁剪、回滚恢复）。
4. 应用配置动作自动失败回退逻辑（命令失败时返回手动步骤）。

## 3. 未覆盖项（待补充手工）

1. 文件/文件夹/桌面/背景等真实右键场景行为验证。
2. 无权限目录和文件占用冲突的真实环境回归。
3. 30 分钟连续编辑稳定性记录。
4. 安装包安装/卸载路径验证（安装后自动更新链路未验证）。
