# Shell Context Menu Manager 使用手册（MVP）

## 1. 启动与准备

1. 安装 Node.js `v22.x`。
2. 在项目目录执行 `npm install`。
3. 开发模式执行 `npm run dev`，构建运行执行 `npm run build && npm run start`。

## 2. 基本流程

1. 点击顶部 `Select & Read`（中文界面为“选择并读取”）。
2. 在弹窗中选择目标配置文件并读取。
3. 在左侧树与中间属性面板编辑节点。
4. 在 `实时预览（所见即所得 v1）` 面板选择场景（桌面/文件/文件夹等），观察“合并后的最终菜单预览”是否符合预期。
5. 点击 `Save` 打开 Diff 预览。
6. 在 Diff 面板点击 `Confirm Save` 执行写入（会自动备份）。
7. 点击 `Apply` 尝试应用配置。

## 3. 回滚流程

1. 在 `Rollback Center` 选择一个备份版本。
2. 右侧预览备份内容。
3. 点击 `Restore Selected Backup` 执行恢复。
4. 恢复后可再次 `Apply` 并验证效果。

## 4. 常见问题排查

1. 保存被阻断：
   - 检查 `Parse Issues` 与 `Validation Issues`。
2. 树和属性不可编辑：
   - 说明源码存在语法错误，先修复源码或执行 `Refresh Model`。
3. 自动应用失败：
   - 按页面 `Manual Apply Steps` 执行手动刷新命令。
4. 回滚失败：
   - 检查备份文件是否存在、路径是否可读写、是否有权限问题。
