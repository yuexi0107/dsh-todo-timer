# dsh-todo-timer

给 DeepSeek Harness 的任务面板（todo 面板）加上**每项计时**：

- **进行中**的任务项右侧实时跳动：`45s` → `2m 05s` → `1h 03m 05s`（不足 60 秒只显示秒，超过进位到分、小时）
- **已完成**的任务项定格显示该项耗时
- 全部完成时，标题行显示整张清单的**总耗时**（`5 已完成 · 总耗时 12m 34s`）
- 时间戳来自会话事件日志（`todo/write` 事件的墙钟时间），**重启应用、重开会话都能恢复**，不依赖任何被修改的官方文件

## 原理

一个纯插件（bundle），两半：

| 半区 | 做什么 |
|---|---|
| 宿主 `lib/index.js` | 注册独立投影 `todoTimer`：折叠 `todo/write` 事件，按内容继承每项 `startedAt`/`completedAt`，列表级 `createdAt`/`completedAt`。不触碰官方 `todos` 投影 |
| 浏览器 `lib/client.js` | 向 `conversation.input.dock` 注册同 id（`todo`）面板条目。插件注册晚于内置花名册，按 DSH 官方文档的 `shadows-shipped-ui` 模式**遮蔽**官方任务面板，渲染带计时的版本 |

## 安装（其他账号 / 其他设备）

方式一 · 插件页直接装（无需市场）：侧边栏 **插件 → 安装**，填

```
git+https://github.com/<OWNER>/dsh-todo-timer.git#<commit-sha>
```

方式二 · 市场索引：在 **发现** 页添加索引 URL（本仓库任意静态托管地址，如
`https://raw.githubusercontent.com/<OWNER>/dsh-todo-timer/main/market-index.json`），
搜索 `dsh-todo-timer` 安装。

安装后重启应用生效。插件页可随时停用/删除；停用即恢复官方任务面板。

## 卸载

插件页删除 `dsh-todo-timer`，或从 profile 的 `bundles` 移除后重启。零残留——本插件从不修改安装目录。

## 兼容

DSH `>=0.2.0-rc`（Web / Desktop 界面）。官方任务面板行为完全保留（默认折叠、点击标题展开），仅新增计时显示；若宿主投影缺失（异常场景），面板自动退化为无计时样式。

## 开发

```
lib/index.js      宿主半（投影 fold，纯函数 foldTodoTimer 可单测）
lib/client.js     浏览器半（window.__ModuleLoader__.load，手写免构建）
cordis.patch.yml  bundle 行（一行 insert）
test.mjs          fold 单元测试 + client 语法检查
```

MIT
