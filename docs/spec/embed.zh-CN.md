# Embed 参考

[English](embed.md)

本页列出作品的 Shell（或首页）与显示它的应用之间的消息，以及 `@open-artifact/harness-kit/embed` 的 API。类型在 `packages/protocol/src/shell.ts`（`HostToShell`、`ShellToHost`、`HomeToHost`）。要知道怎么用它们，读[在你的界面里显示页面](../integrating/embedding.zh-CN.md)。

## 通道

| 方式 | 消息怎么传递 |
| --- | --- |
| 框架 | 在你的页面和 Shell 的 iframe 之间用 `window.postMessage`。Shell 把 `shell_hello` 发给 `*`；之后的每条消息都只发给宿主的源。 |
| 顶层视图 | 经由 daemon。以 `?oa_view=<ticket>` 加载的 Shell 认领票据；它说的话以 `shell.event` 到达你的适配器；你用 `shell.command` 回答。 |

每条消息都是一个对象，用键 `openArtifact` 给出它的名字。宿主协议版本：`1`（`HOST_PROTOCOL`）。文本字段截断到 8000 个字符（`MAX_HOST_TEXT`）。

## 宿主 → Shell

| 消息 | 字段 | |
| --- | --- | --- |
| `host_hello` | `caps`（`sessions?`、`toolbar?`、`artifacts?`）、`agentName?`、`harness?`、`protocol?`、`theme?`（`scheme`、`accent?`）、`destinations?`（`id`、`label`；最多 8 个）、`library?`（`harness?`、`workspace?`） | 对 `shell_hello` 或 `home_hello` 的回答；主题变化时再发一次 |
| `goto` | `hash` | 显示这个位置；Shell 用 `place` 回答 |

`caps.sessions`：你能新建和打开会话。`caps.toolbar`：你画自己的工具栏，所以 Shell 隐藏它的关闭按钮。`caps.artifacts`（仅首页）：点击作品发送 `open_artifact`，而不是跳转。`library`（仅首页）：只列出该 harness 或该目录的作品。

## Shell → 宿主

| 消息 | 字段 | 仅限已声明宿主 |
| --- | --- | --- |
| `shell_hello` | `version`、`protocol`、`artifact`、`id`、`title`、`type` | |
| `shell_ready` | `artifact` | |
| `new_session` | `prompt`、`artifact` | 对未声明宿主 `prompt` 为空 |
| `open_session` | `session`（或 `null`）、`harness` | |
| `close` | — | |
| `place` | `artifact`、`hash` | |
| `comment_summon` | `text` | 对未声明宿主 `text` 为空 |
| `open_external` | `url`（只限 `http(s)`） | 是 |
| `saved_file` | `path`（绝对路径） | 是 |

`place` 在 `shell_ready` 之后、位置每次变化时、以及作为对 `goto` 的回答发送。

## 首页 → 宿主

| 消息 | 字段 |
| --- | --- |
| `home_hello` | —（加载时发给 `*`） |
| `home_ready` | — |
| `open_artifact` | `url`、`id`、`title`、`type` |
| `open_session`、`new_session` | 与 Shell 发的相同 |

## 谁是已声明宿主

Shell 读取 `GET /api/open-artifact.embed`（`hosts`：已连接适配器在 `caps.open.origins` 里声明的源），并判断发送 `host_hello` 的源：

| 判定 | 条件 | 效果 |
| --- | --- | --- |
| declared（已声明） | 某个已连接适配器声明了这个源，或 Shell 运行在用票据打开的顶层视图里 | 全部可用 |
| refused（拒绝） | 适配器声明了源，但不是这个 | `host_hello` 被忽略 |
| undeclared（未声明） | 没有适配器声明任何源，或读不到列表 | `prompt` 和 `text` 为空；没有 `open_external`、`saved_file` 和目的地 |

## 视图票据

| 规则 | 值 |
| --- | --- |
| URL 参数 | `oa_view` |
| 使用 | 一次，由签发它的连接使用 |
| 未认领则过期 | 2 分钟 |
| 重新加载的 Shell 可回来的时限 | 30 秒 |
| Shell 连接前排队的命令 | 32 条 |
| 每个适配器连接的视图数 | 64 个 |

适配器连接结束时票据随之结束。

## `embedArtifact(target, options)`

`target` 是一个 iframe（框架方式）或一个传输对象 `{ send(command), onEvent(listener) }`（顶层视图）。

| 选项 | |
| --- | --- |
| `url` | `viewUrl`（框架）或 `embed_url`（视图）；与 iframe 当前的 `src` 不同时设为它 |
| `agentName`、`harness`、`toolbar`、`theme`、`destinations` | `host_hello` 里说的内容 |
| `onReady(info)` | `info`：`artifact`、`id`、`title`、`type`、`version`、`protocol` |
| `onOpenSession({ session, harness, artifact })` | 设置 `caps.sessions` |
| `onNewSession({ prompt, artifact })` | 设置 `caps.sessions` |
| `onCommentSent({ text })` | |
| `onPlace({ artifact, hash })` | |
| `onClose()` | |
| `onOpenExternal(url)` | 默认：`window.open` |
| `onSavedFile(path)` | |
| `capture()`、`saveThumbnail(jpeg, artifact)` | 缩略图：就绪 2 秒后一次，之后位置变化时最多每分钟一次 |
| `onError(error)` | 某个回调或缩略图失败 |
| `window` | 监听的窗口 |

返回 `{ artifact, place, ready, goto(hash), setTheme(theme), url(), destroy() }`。`url()` 是带最后位置、不带票据的 Shell 地址。

## `embedLibrary(iframe, options)`

选项：`url`、`harness`、`workspace`、`agentName`、`theme`、`onOpenArtifact(artifact)`（设置 `caps.artifacts`）、`onOpenSession({ session, harness })`、`onNewSession({ prompt, artifact })`、`onReady()`、`onError`、`window`。返回 `{ setTheme(theme), destroy() }`。

## 远程页面

`remotePolicyOf`、`remoteGate` 以及类型 `RemotePagePolicy`、`AllowRemote` 从 kit 的主入口导出，给自己把关远程页面的应用用（[远程类型](../integrating/remote-types.zh-CN.md#显示远程页面)）。
