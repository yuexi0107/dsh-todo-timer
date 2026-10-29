# dsh-todo-timer

给 DeepSeek Harness 的任务面板（todo 面板）加上**状态计数 + 每项序号 + 每项计时 + 顶部总耗时**：

- 标题行固定显示 `任务  X 已完成 · X 进行中 · X 待处理  总耗时 XXX`，**三个计数始终显示（含 0）**
- 任务行按 `1.`、`2.`、`3.` … 连续编号，右侧显示该项耗时
- **只有“运行中”（in_progress）的任务计时**：右侧实时跳动 `45s` → `2m 05s` → `1h 03m 05s`
- **同一次 `todo/write` 中首次标记为进行中的多个任务共用该写入时刻作为起点**；后续加入的运行项从加入时起算
- **排队（待处理 pending）的任务不计时**，不显示任何时间
- **已完成**的任务定格显示它**实际运行时长**（`startedAt → completedAt`）；从未观察到运行过的完成项显示 `0s`
- **顶部标题行显示“总耗时 X”**：从**当前清单第一个任务开始运行**那一刻起算（不是清单创建时间），运行中实时跳；全部完成后定格
- **仅当前清单内冻结**：同一清单内被省略的已完成项仍保留显示，耗时不变；清单被整体替换或清空后旧项消失，总耗时重新起算
- `turn/start` 不会让面板消失：宿主投影保留当前清单，官方 `todos` 变 `null` 时面板仍从 `todoTimer` 渲染
- 面板**折叠时标题行计数与总耗时照样显示/跳动**
- 时间戳来自会话事件日志（`todo/write` 事件的墙钟时间），**重启应用、重开会话都能恢复**，不依赖任何被修改的官方文件

## 0.3.0 变更

- 标题行三个计数始终显示（0 也显示），不再省略零项。
- 任务行增加连续序号 `1.`、`2.`、`3.` …。
- 从未观察到运行的完成项显示 `0s`；全完成且从未运行的总耗时显示 `0s`。
- 同一清单内被省略的已完成项保留在面板中；零重叠新清单/空清单会丢弃旧项并重置总耗时。
- 面板优先从宿主 `todoTimer.items` 渲染，`todos` 仅作旧宿主回退；`turn/start` 不再隐藏面板。
- 宿主投影 `stateVersion` 升到 8。

## 原理

一个纯插件（bundle），两半：

| 半区 | 做什么 |
|---|---|
| 宿主 `lib/index.js` | 注册独立投影 `todoTimer`：折叠 `todo/write` 事件，按内容继承每项 `startedAt`/`completedAt`，同一清单内保留被省略的已完成项，并维护列表级 `firstStartedAt`（首个进入运行态的时刻，续列表继承、新列表重算）。不触碰官方 `todos` 投影 |
| 浏览器 `lib/client.js` | 向 `conversation.input.dock` 注册同 id（`todo`）面板条目。插件注册晚于内置花名册，按 DSH 官方文档的 `shadows-shipped-ui` 模式**遮蔽**官方任务面板，优先从 `todoTimer.items` 渲染带计数、序号、计时与顶部总耗时的版本 |

`firstStartedAt` 是总耗时锚点：旧版宿主半没有该字段时，客户端自动回退到“所有项最早的 `startedAt`”，因此新旧宿主都能用。

## 安装（其他账号 / 其他设备）

方式一 · 插件页直接装（无需市场）：侧边栏 **插件 → 安装**，填

```
git+https://github.com/yuexi0107/dsh-todo-timer.git#<commit-sha>
```

方式二 · 市场索引：在 **发现** 页添加索引 URL（本仓库任意静态托管地址，如
`https://raw.githubusercontent.com/yuexi0107/dsh-todo-timer/main/market-index.json`），
搜索 `dsh-todo-timer` 安装。

安装后重启应用生效。插件页可随时停用/删除；停用即恢复官方任务面板。

## 卸载

插件页删除 `dsh-todo-timer`，或从 profile 的 `bundles` 移除后重启。零残留——本插件从不修改安装目录。

## 兼容

DSH `>=0.2.0-rc`（Web / Desktop 界面）。官方任务面板行为完全保留（默认折叠、点击标题展开），仅新增计数/序号/计时显示；若宿主投影缺失（异常场景），面板自动退化为无计时样式。

## 开发

```
lib/index.js      宿主半（投影 fold，纯函数 foldTodoTimer 可单测）
lib/client.js     浏览器半（window.__ModuleLoader__.load，手写免构建）
cordis.patch.yml  bundle 行（一行 insert）
test.mjs          fold 单元测试 + client 语法检查
test-render.mjs   组件级测试：轻量 React 运行时驱动真实 client.js，含真实会话回放
dump-writes.mjs   读取真实会话日志并回放 fold（排查用）
replay.mjs        真实会话日志回放（排查用）
```

```
node test.mjs && node test-render.mjs
```

MIT
