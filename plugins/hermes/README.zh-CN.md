# Open Artifact for Hermes Agent

[English](README.md)

让 [Hermes Agent](https://github.com/NousResearch/hermes-agent) 做幻灯片、设计画布、白板、电子表格、数据看板、文档、动画短片和设计系统：每件作品是一个文件夹，在同一个本地页面里查看、编辑和评论。在任何 Hermes 对话里（命令行，或经 gateway 接入的聊天平台）直接提要求，或者输入 `/open-artifact slides 为这个仓库做一份 6 页的路演稿`。

这是一个用 Python 写的 Hermes 插件（只用标准库）。它通过 `open-artifact harness --stdio --harness hermes` 说 Harness API，是完整适配器（L3）；这是非 Node 宿主接入的官方路径（见[集成指南](../../docs/integrating.zh-CN.md)）。

## 安装

需要支持插件的 Hermes Agent、Python 3.9 及以上，以及 Open Artifact 命令行（`open-artifact`，用 `npm install -g @open-artifact/cli` 安装；也可以用 `OPEN_ARTIFACT_CLI` 指定别的运行方式）。

```bash
# 1. 插件：把这个文件夹复制或链接为 ~/.hermes/plugins/open-artifact
ln -s "$PWD/plugins/hermes" ~/.hermes/plugins/open-artifact
hermes plugins enable open-artifact

# 2. 允许它在 gateway 会话里发起新一轮（页面上的评论要用到）
hermes config set plugins.entries.open-artifact.allow_gateway_injection true

# 3. 按 Hermes 原生工具渲染的 skill
open-artifact skill install --command open-artifact --dir ~/.hermes/skills --harness hermes
```

正在运行的 gateway 在插件启用时就会加载它；启用前已经开着的会话，从下一个会话起才看到这些工具。不做第 2 步，工具照样能用，评论会等到会话的下一轮。

## 给 Hermes 带来什么

| 部分 | 作用 |
| --- | --- |
| 工具 `Artifact`、`ArtifactData`、`ArtifactComments` | 以 daemon 自己的 schema（`schemas.json`，桥接连上时用 `tools.list` 刷新）注册为 Hermes 工具（工具集 `open_artifact`）。每次调用都带上调用它的 Hermes 会话（会话 key）和会话目录，做出的作品归这个会话。会话第一次调用时 attach；之前等着它的消息随这次调用的 `messages` 一起返回。 |
| 页面上的评论和请求 | 在 gateway 里立刻送到拥有该作品的会话（`wake.deliver`）。只有作品主人本人的话会成为用户消息（`ctx.inject_message`：会话空闲时开始新一轮，正在工作时排在当前这一轮之后）。协作者的评论、系统消息（后台任务的结果）或没写明发送者的消息一律回答 `failed`，留在 daemon 的收件箱里；会话下一轮在调用模型前（`pre_llm_call`）读到它们，前面有一行说明这是数据、不是用户本人的指令。 |
| 重连 | gateway 会保持桥接进程运行，退出后重新启动；桥接会自己重连 daemon（需要时启动它），并重新 attach 各会话。重新 attach 时带来的、插件交不出去的消息，用 `inbox.return` 放回去。已知会话记在 `~/.hermes/plugin_data/open-artifact/sessions.json`，保留 7 天，gateway 重启后会重新 attach。 |
| 会话状态 | 每次调用模型前为 `running`，会话结束时为 `idle`。agent 自己的 `write_file` 和 `patch` 工具改动的文件会上报（`agent.wrote`），打开着的页面立刻跟上。 |

在 gateway 之外（经典 CLI、一次性的 `hermes chat -q`、cron），调用工具之前什么也不启动。调用之后，这个进程的桥接也会接收唤醒；经典 CLI 会把作品主人的话排成你的下一条输入。

Hermes 没有自己的页面视图：agent 会把页面的 `view_url` 给你，或者用 `Artifact {action: "open"}` 在电脑的浏览器里打开。

## 作品放在哪里

新作品放在你自己的 Open Artifact 文件夹下，每个项目一个文件夹：`~/OpenArtifact/<项目>/<slug>`（`policy.artifacts: "home"`），仓库保持干净。想放进项目里，在你自己的终端运行 `open-artifact config set artifactsLocation workspace`。见[设置](../../docs/settings.zh-CN.md)。

## Profile

daemon 给 Hermes 用的 profile 是 `packages/daemon/harnesses/hermes.json`（harness 名 `hermes`）。Hermes 在 agent 运行的每条命令里设置 `HERMES_AGENT`，所以 agent 运行的 `open-artifact` 命令会被认出是 Hermes 的，属于用户本人的命令（发布、站点）在那里会拒绝运行。

工具用 Hermes 的会话 key（`HERMES_SESSION_KEY`，gateway、TUI 和 ACP 会话会设置）标识会话。经典 CLI 会话没有 key，工具改用它的会话 id。

可选设置：`OPEN_ARTIFACT_CLI`（怎样运行命令行，例如 `npx @open-artifact/cli`）、`OPEN_ARTIFACT_HERMES_AGENT_NAME`（Shell 里怎么称呼这个 agent，默认 `Hermes`）、`OPEN_ARTIFACT_HERMES_DATA`（会话记录放在哪里）、`OPEN_ARTIFACT_HERMES_DISABLE`（什么也不加载）。检查一个会话：`open-artifact doctor --harness hermes --session <会话 key 或 id>`。

## 已知限制

- **用工具，不用命令行。** agent 应当用这三个工具做作品、改作品。它在 shell 里运行的 `open-artifact` 命令，不加 `--harness hermes` 时以 harness `cli` 的身份说话；加了也只有在设置了 `HERMES_SESSION_KEY` 的地方（经典 CLI 会话没有）才能指明会话。daemon 会把它当成和会话工具不同的另一个主人，那份作品的评论就会送到那边，而不是这个对话。用 `--harness hermes` 渲染的 skill 会让 agent 使用工具。
- **不能恢复会话。** `caps.wake.resume` 是 `false`：发给已经不在线的会话（例如已结束的 `hermes chat -q`）的唤醒，会在收件箱里等到那个会话再次调用工具。
- **会话 key 就是对话 key。** 在 gateway 里，会话 key 对应一个对话（一个私聊、一个子区）。同一个对话里开新会话（`/new`）key 不变，所以这个对话的作品和评论都还归它。
- **Hermes 里不显示页面。** 不回答 `host.open`：页面在浏览器里打开，或者以链接给出。

## 测试

```bash
node --test plugins/hermes/test/hermes.test.mjs   # npm test 的一部分；没有 python3 时会跳过并说明
```

它先核对 `schemas.json` 与 daemon 的工具定义一致、插件的 hello 与随包 profile 一致，再在一个假的 Hermes gateway（`test/fake_gateway.py`）里对着临时 `OPEN_ARTIFACT_HOME` 中的真实 daemon 运行插件：注册工具和 hook、做出一份作品、作品主人的 Ask 实时成为用户消息、协作者的话不会成为用户消息、宿主拒收的唤醒在下一轮作为数据交给会话。
