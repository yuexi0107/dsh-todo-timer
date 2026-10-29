# awesome-dsh-plugin 提交说明

目标仓库：<https://github.com/awesome-dsh-plugin/awesome-dsh-plugin>

## 前置条件

- 插件仓库已公开，且**创建满 24 小时**（registry 的 CI 会检查仓库年龄）。
- 仓库已添加 `dsh-plugin` topic。
- `package.json` 已声明 `dsh.bundle`（本插件已满足）。
- 仓库内有真实可运行代码（不是占位/README-only）。

## 提交步骤

1. Fork / clone `awesome-dsh-plugin/awesome-dsh-plugin`。
2. 只新增一个文件：`data/plugins/<owner>__dsh-todo-timer.yml`。
   内容使用 `release/awesome-entry.yml`，把 `GITHUB_OWNER` 替换为真实 GitHub 用户名。
3. 提交并推送到自己的 fork，然后向 `main` 开 PR。
4. PR 只包含这一个新增文件；不要手工编辑两个 README（它们由 CI 生成）。
5. 按 `contributing.md` 的要求，PR 描述里写清楚插件实际行为，不夸大。

## 审核要点

- CI 检查 `dsh.bundle`、仓库年龄、文件格式、README 生成。
- 维护者会对照代码检查描述是否准确；通常一天内处理。
- 合并后 dshmarket / awesome-dsh-plugin 站点会自动收录，无需再操作本仓库。

## 图标

条目里的 `icon` 必须是 GitHub 托管的 PNG/JPG/JPEG/WebP（SVG 会被拒绝）。
本仓库的 `assets/icon-180.png` 由 `icon.svg` 生成，发布前确认该文件已提交。
