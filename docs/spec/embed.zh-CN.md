# Embed 参考

[English](embed.md)

本页列出作品的 Shell（或首页）与显示它的应用之间的消息，以及 `@open-artifact/harness-kit/embed` 的 API。类型在 `packages/protocol/src/shell.ts`（`HostToShell`、`ShellToHost`、`HomeToHost`）。要知道怎么用它们，读[在你的界面里显示页面](../integrating/embedding.zh-CN.md)。

## 通道

| 方式 | 消息怎么传递 |
| --- | --- |
| 框架 | 在你的页面和 Shell 的 iframe 之间用 `window.postMessage`。Shell 把 `shell_hello` 发给 `*`；之后的每条消息都只发给宿主的源。 |
| 顶层视图 | 经由 daemon。以 `?oa_view=<ticket>` 加载的 Shell 认领票据；它说的话以 `shell.event` 到达你的适配器；你用 `shell.command` 回答。源无法声明的宿主（`file://` 页面）可以在自己的 iframe 里加载带票据的地址：这个 Shell 同样经由 daemon 通信，不向父框架打招呼，也不听父框架的消息。 |

每条消息都是一个对象，用键 `openArtifact` 给出它的名字。宿主协议版本：`1`（`HOST_PROTOCOL`）。文本字段截断到 8000 个字符（`MAX_HOST_TEXT`）。

## 宿主 → Shell

| 消息 | 字段 | |
| --- | --- | --- |
| `host_hello` | `caps`（`sessions?`、`toolbar?`、`artifacts?`、`switcher?`）、`agentName?`、`harness?`、`protocol?`、`theme?`（`scheme`、`accent?`）、`destinations?`（`id`、`label`；最多 8 个）、`library?`（`harness?`、`workspace?`） | 对 `shell_hello` 或 `home_hello` 的回答；主题变化时再发一次。省略 `theme` 即清除钉死的方案与 accent |
| `goto` | `hash` | 显示这个位置；Shell 用 `place` 回答 |

`caps.sessions`：你能新建和打开会话。`caps.toolbar`：你画自己的工具栏，所以 Shell 隐藏它的关闭按钮。`caps.switcher`：你的应用自己列出和切换作品，所以 Shell 的标题菜单里没有“Switch artifact”（连同“All artifacts”）。`caps.artifacts`（仅首页）：点击作品发送 `open_artifact`，而不是跳转。`library`（仅首页）：只列出该 harness 的作品（按所属会话的 harness），或该目录的作品：所属会话在这个目录里工作，作品的文件夹在它之下，或者作品是为包含这个目录、或位于这个目录之内的项目创建的（所以放在用户 Open Artifact 文件夹里的作品，仍然列在它的项目下）。

带上 `theme` 时，它是 `scheme`（`light` 或 `dark`）和可选的 `accent`（`#rrggbb`）。Shell 把该方案钉在根上的 `data-theme`，并钉上 accent 变量（`--open-artifact-accent`、`--open-artifact-accent-fg`、`--open-artifact-accent-soft`），再在 `chrome_hello` 里带上同一个 `theme`，页面也照样钉住。省略 `theme` 即清除 Shell 和页面上的这处钉死。页面仍然支持 light 和 dark；清除不会把 `color-scheme` 写成只支持 light。

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
| `saved` | `state`（`saved`、`saving`、`unsaved`、`reconnecting`、`readonly` 或 `null`）、`leaveLosesWork` | |

`place` 在 `shell_ready` 之后、位置每次变化时、以及作为对 `goto` 的回答发送。`saved` 在 `host_hello` 之后、页面的保存状态或 `leaveLosesWork` 每次变化时发送；页面还没报告、或正在加载另一个页面时 `state` 是 `null`。`leaveLosesWork: true` 表示现在关闭会丢失工作：关闭视图前先问人。旧版 Shell 不发 `saved`。

## 首页 → 宿主

| 消息 | 字段 |
| --- | --- |
| `home_hello` | —（加载时发给 `*`） |
| `home_ready` | — |
| `open_artifact` | `url`、`id`、`title`、`type` |
| `open_session`、`new_session` | 与 Shell 发的相同 |

## 作品页面 → Shell：初始视图与保存

页面通过 `@open-artifact/runtime` 的 `connectShell()` 连接调用 `report(...)`，发送 `ChromeReport`（chrome 协议 1）。这些报告在作品页面与 Shell 之间传递，与上面的宿主消息分开。

- `ready: false` 让 Shell 在初始视图上保留加载遮罩。在框架加载前发送，视图恢复后再发送 `ready: true`。省略 `ready` 也会显示页面。文档一旦显示，后续的 `false` 报告不能再次遮住它；即使页面始终没有就绪，Shell 也会在 `CHROME_READY_TIMEOUT_MS`（10 秒）后移除遮罩。
- `saved: 'saving'` 包括仍在等待防抖写入的编辑。Shell 只在持续 500 毫秒后显示“Saving…”。保存失败才使用 `saved: 'unsaved'`；没有保存状态可报告时省略 `saved`。
- `shellArtifactId()` 和 `ShellConnection.artifactId` 读取框架页面 URL 中稳定的 `open_artifact_id`；不在 Shell 内或没有 id 时返回 `null`。用它作为页面记忆状态的键，避免使用每次刷新都会更换令牌的云端页面路径；它不是授权凭据。

## 谁是已声明宿主

Shell 读取 `GET /api/open-artifact.embed`（`hosts`：已连接适配器在 `caps.open.origins` 里声明的源），并判断发送 `host_hello` 的源：

| 判定 | 条件 | 效果 |
| --- | --- | --- |
| declared（已声明） | 某个已连接适配器声明了这个源，或 Shell 运行在用票据打开的视图里（顶层或框架内） | 全部可用 |
| refused（拒绝） | 当前生效的名单里有别的源，没有这个 | `host_hello` 不被接受。这个源已经装上的宿主会被清掉（首页上，它的资料库过滤也一起去掉） |
| undeclared（未声明） | 还没有任何一次成功读到的名单：没有适配器声明源，或到目前为止每次读取都失败了 | `prompt` 和 `text` 为空；没有 `open_external`、`saved_file` 和目的地 |

当前生效的名单是上一份成功读到的名单。第一次成功之前的读取失败，仍然是未声明（云端宿主，或类型服务器自己的 Shell，读不到 daemon 的名单）。有过一次成功之后，失败的刷新按那份名单判定：它不会变成未声明，也不会放行被拒绝的源、从而放大信任。更早的回答不能覆盖更新的成功名单。拒绝会清掉这个源已经写下的宿主，包括早先一次失败读取先接受下来的那个。`shell_hello` 仍然发给 `*`。`goto` 仍然只认当前宿主的源。

## 视图票据

| 规则 | 值 |
| --- | --- |
| URL 参数 | `oa_view` |
| 使用 | 一次，由签发它的连接使用 |
| 未认领则过期 | 2 分钟 |
| 重新加载的 Shell 可回来的时限 | 30 秒 |
| Shell 连接前排队的命令 | 32 条 |
| 每个适配器连接的视图数 | 64 个 |
| `shell.event` 的顺序 | 与 Shell 说出的顺序一致：一次发一条，daemon 收下上一条后才发下一条 |

适配器连接结束时票据随之结束。

## `embedArtifact(target, options)`

`target` 是一个 iframe（框架方式）或一个传输对象 `{ send(command), onEvent(listener) }`（用票据打开的视图，你的 iframe 显示它时也一样）。

| 选项 | |
| --- | --- |
| `url` | `viewUrl`（框架）或 `embed_url`（视图）；与 iframe 当前的 `src` 不同时设为它 |
| `agentName`、`harness`、`toolbar`、`switcher`、`theme`、`destinations` | `host_hello` 里说的内容 |
| `onReady(info)` | `info`：`artifact`、`id`、`title`、`type`、`version`、`protocol` |
| `onOpenSession({ session, harness, artifact })` | 设置 `caps.sessions` |
| `onNewSession({ prompt, artifact })` | 设置 `caps.sessions` |
| `onCommentSent({ text })` | |
| `onPlace({ artifact, hash })` | |
| `onClose()` | |
| `onOpenExternal(url)` | 默认：`window.open` |
| `onSavedFile(path)` | |
| `onSaved({ state, leaveLosesWork })` | `saved` 消息 |
| `capture()`、`saveThumbnail(jpeg, artifact)` | 缩略图：就绪 2 秒后一次，之后位置变化时最多每分钟一次 |
| `onError(error)` | 某个回调或缩略图失败 |
| `window` | 监听的窗口 |

返回 `{ artifact, place, ready, saved, goto(hash), setTheme(theme | null), url(), destroy() }`。`setTheme(null)` 发送不带 `theme` 的 `host_hello`，并清除钉死的方案与 accent。`url()` 是带最后位置、不带票据的 Shell 地址。

## `embedLibrary(iframe, options)`

选项：`url`、`harness`、`workspace`、`agentName`、`theme`、`onOpenArtifact(artifact)`（设置 `caps.artifacts`）、`onOpenSession({ session, harness })`、`onNewSession({ prompt, artifact })`、`onReady()`、`onError`、`window`。返回 `{ setTheme(theme | null), destroy() }`。`setTheme(null)` 同样清除钉死的方案与 accent。

## 远程页面

`remotePolicyOf`、`remoteGate` 以及类型 `RemotePagePolicy`、`AllowRemote` 从 kit 的主入口导出，给自己把关远程页面的应用用（[远程类型](../integrating/remote-types.zh-CN.md#显示远程页面)）。
