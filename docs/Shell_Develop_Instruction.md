# Nilesoft Shell 开发指导说明

本文面向需要开发和维护 Nilesoft Shell 右键菜单配置的开发者。  
项目 GitHub 仓库地址：`https://github.com/moudey/Shell/tree/main`。

## 1. 工作原理与总体思路

Nilesoft Shell 通过扩展方式接管资源管理器右键菜单渲染流程。触发右键时，典型处理链路如下：

1. 读取 `shell.nss` 及其 `import` 的配置文件。
2. 枚举当前对象（文件、文件夹、桌面、背景等）的系统菜单项。
3. 按规则执行 `modify` / `remove`。
4. 插入自定义 `menu` / `item` / `separator`。
5. 渲染统一风格菜单并响应点击命令。

建议把它当作“声明式菜单引擎”：通过文本配置控制菜单结构、显示条件和执行命令。

## 2. 环境准备与安装

## 2.1 安装方式

1. 官方安装包或便携版。
2. 包管理器安装（如 `winget` / `scoop` / `choco`）。

## 2.2 注册扩展

首次安装后需要管理员权限注册扩展，常见方式：

```bash
shell -register -restart
```

如果菜单未出现，优先检查是否已成功注册。

## 2.3 生效与热重载

修改配置后可通过 `Ctrl + 右键` 强制刷新菜单配置，无需重启系统。

## 3. 配置文件组织建议

主配置通常为 `shell.nss`，建议采用“主文件 + 分片文件”结构：

```nss
import "imports/modify.nss"
import "imports/new.nss"
import "imports/theme.nss"
import "imports/images.nss"
```

推荐目录组织：

```text
shell.nss
imports/
  modify.nss        # 系统项调整
  new.nss           # 新增菜单项
  images.nss        # 图标常量
  theme.nss         # 样式主题
```

实践建议：

1. 每次改动前备份。
2. 每次只改一小段并立即验证。
3. 配置文件纳入 Git 版本管理。

## 4. 菜单语法核心

## 4.1 `item`：命令项

```nss
item(
  title="使用记事本打开",
  cmd="notepad.exe",
  args="\"@sel.path\"",
  type="file"
)
```

常见属性：`title`、`cmd`、`args`、`type`、`mode`、`image`、`tip`。

## 4.2 `menu`：子菜单

```nss
menu(title="图片操作", mode="multiple", image="\uE158") {
  item(title="压缩为ZIP", cmd="zip.exe", args="\"@sel.path\"")
  separator
  item(title="转换为PNG", cmd="convert.exe", args="\"@sel.path\" \"@sel.dir\\@sel.file.title.png\"")
}
```

可多层嵌套，适合分组复杂功能。

## 4.3 `separator`：分隔线

```nss
item(title="选项A", cmd="...")
separator
item(title="选项B", cmd="...")
```

## 4.4 `modify`：修改系统菜单项

```nss
modify(find="WinRAR", image=image.glyph("\uE1A4", #22A7F2))
modify(find="通过QQ发送到|使用火绒安全进行杀毒", vis=hidden)
```

适用于改名、改图标、移动分组、调整位置、隐藏项等。

## 4.5 `remove`：移除系统菜单项

```nss
remove(find="Edit with Photos")
```

用于清理冗余菜单项，保持菜单简洁。

## 5. 变量与参数使用

高频变量：

1. `@sel.path`：当前选中项完整路径。
2. `@sel.file.name`：文件名（含扩展名）。
3. `@sel.file.title`：文件名（不含扩展名）。
4. `@sel.file.ext`：扩展名。
5. `@sel.dir`：所在目录。
6. `sel.count`：选中项数量。

示例：调用 PowerShell 压缩当前选择的文件：

```nss
item(
  title="压缩为ZIP",
  cmd="powershell.exe",
  args="-Command \"Compress-Archive -Path @sel.path -DestinationPath @sel.dir\\archive.zip\""
)
```

条件表达式常用于 `where` / `mode` / `type`，用于控制显示时机。

## 6. 图标与资源管理

图标来源通常有三类：

1. Glyph 字符（如 `\uE756`）。
2. 本地文件（`.ico` / `.png` / `.bmp` / `.svg`）。
3. 内置图标常量（如 `icon.share`）。

示例：

```nss
item(title="PowerShell Here", image="\uE756", cmd="powershell.exe", args="-NoExit -Command Set-Location @sel.dir")
menu(title="发送到", image=icon.share) {
  item(title="压缩并邮件", cmd="C:\\Program Files\\ZipSend\\ZipSend.exe", args="@sel.path")
}
```

注意事项：

1. 路径字符串用引号。
2. 反斜杠转义保持一致。
3. 图标路径失效时菜单可能显示空白占位。

## 7. 调试与排错流程

出现问题时建议按以下顺序排查：

1. 语法检查：括号、引号、逗号、关键字拼写。
2. 条件检查：`type` / `mode` / `where` 是否匹配当前右键上下文。
3. 命令检查：将 `cmd + args` 复制到终端独立执行。
4. 分段回滚：恢复到最近可用版本，再逐段加回改动。
5. 冲突检查：关闭其他右键菜单增强工具，避免扩展冲突。
6. 注册检查：必要时重新执行 `shell -register -restart`。

## 8. 推荐开发流程

1. 明确目标：要新增菜单、整理菜单还是清理垃圾项。
2. 先 `remove` 清理，再 `modify` 整理，最后 `menu/item` 增强。
3. 每次只提交一个可验证改动。
4. 每改一次执行一次热重载并验证真实点击行为。
5. 配置评审重点看“可读性、可维护性、冲突风险”。

## 9. 最小可用模板

```nss
// shell.nss
import "imports/modify.nss"
import "imports/new.nss"

// imports/modify.nss
remove(find="Edit with Photos")
modify(find="WinRAR", image=image.glyph("\uE1A4", #22A7F2))

// imports/new.nss
menu(title="开发工具", image=icon.code) {
  item(title="VSCode 打开", cmd="Code.exe", args="\"@sel.path\"")
  item(title="PowerShell Here", cmd="powershell.exe", args="-NoExit -Command Set-Location @sel.dir")
}
```

## 10. 发布前检查清单

1. 文件/文件夹/空白处/桌面/任务栏场景均验证过。
2. 单选、多选场景均验证过。
3. 关键命令都可执行且参数正确。
4. 无明显重复项、无失效图标、无条件误匹配。
5. 已保留可回滚的配置版本。

---

如需进一步扩展，建议下一步补充“团队统一命名规范（菜单名、分组名、图标名）”和“按业务模块拆分 nss 文件”的工程化约定。
