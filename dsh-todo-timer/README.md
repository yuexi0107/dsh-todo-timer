# dsh-todo-timer

给 DeepSeek Harness 的任务面板（todo 面板）加上**每项计时 + 顶部总耗时**：

- **只有“运行中”（in_progress）的任务计时**：右侧实时跳动 `45s` → `2m 05s` → `1h 03m 05s`
- **多个任务同时运行**时，它们共用同一个墙钟**一起跳**（各自从进入运行态的时刻起算）
- **排队（待处理 pending）的任务不计时**，不显示任何时间
- **已完成**的任务定格显示它**实际运行时长**（`startedAt → completedAt`）；从未观察到运行过的完成项不显示时间，不拿排队时间凑数
- **顶部标题行显示“总耗时 X”**：从**第一个任务开始运行**那一刻起算（不是清单创建时间），运行中实时跳；全部完成后定格
- 面板**折叠时顶部总耗时照样跳**（因为它在标题行上）
- 时间戳来自会话事件日志（`todo/write` 事件的墙钟时间），**重启应用、重开会话都能恢复**，不依赖任何被修改的官方文件

## 原理

一个纯插件（bundle），两半：

| 半区 | 做什么 |
|---|---|
| 宿主 `lib/index.js` | 注册独立投影 `todoTimer`：折叠 `todo/write` 事件，按内容继承每项 `startedAt`/`completedAt`，并维护列表级 `firstStartedAt`（首个进入运行态的时刻，续列表继承、新列表重算）。不触碰官方 `todos` 投影 |
| 浏览器 `lib/client.js` | 向 `conversation.input.dock` 注册同 id（`todo`）面板条目。插件注册晚于内置花名册，按 DSH 官方文档的 `shadows-shipped-ui` 模式**遮蔽**官方任务面板，渲染带计时与顶部总耗时的版本 |

`firstStartedAt` 是总耗时锚点：旧版宿主半没有该字段时，客户端自动回退到“所有项最早的 `startedAt`”，因此新旧宿主都能用。

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
test-render.mjs   组件级测试：轻量 React 运行时驱动真实 client.js，含真实会话回放
dump-writes.mjs   读取真实会话日志并回放 fold（排查用）
```

```
node test.mjs && node test-render.mjs
```

MIT
