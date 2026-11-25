# Open Artifact for Pi

[English](README.md)

让 [Pi](https://pi.dev) 做幻灯片、设计画布、白板、电子表格、数据看板、文档、动画短片和设计系统：每件作品是一个文件夹，在同一个本地页面里查看、编辑和评论。输入 `/open-artifact slides 为这个仓库做一份 6 页的路演稿`（或 `design …`、`whiteboard …`、`sheets …`、`data …`、`docs …`、`motion …`、`page …`）。

这是一个 Pi 包（`pi-open-artifact`），里面只有一个扩展。它基于 `@open-artifact/harness-kit`，是 Harness API 上的完整适配器（L3），并自带 Open Artifact 运行时（`@open-artifact/cli`）。

## 安装

需要 Pi（已用 1.6.1 测试）和 Pi 要求的 Node.js 22.19 及以上。

```bash
pi install npm:pi-open-artifact
```

在本仓库的源码目录里，先运行 `npm ci`、`npm run build` 和 `node scripts/build-skill.mjs`（构建扩展要启动的运行时），再：

```bash
pi install ./plugins/pi
```

只想试一次、不安装，用 `pi -e ./plugins/pi`。升级用 `pi update --extensions`。

## 给 Pi 带来什么

| 部分 | 作用 |
| --- | --- |
| 工具 `Artifact`、`ArtifactData`、`ArtifactComments` | 以 daemon 自己的参数 schema 注册为 Pi 工具。每次调用都带上 Pi 的会话，做出的作品归这个会话。daemon 返回错误时调用失败，错误文本保留 daemon 说的全部内容（冲突时包括文件的当前内容）。按 Esc 停止等待；除此之外调用不设超时。 |
| 页面上的评论和请求 | 立刻送到拥有该作品的会话。你本人的话作为用户消息：Pi 空闲时开始新一轮，正在工作时插入当前这一轮。协作者的评论或系统消息（后台任务的结果）作为 `open-artifact` 自定义消息交给模型，不会被当作你说的话；Pi 空闲时同样会被唤醒。会话关闭期间发来的消息，在你重新打开它（`pi --resume`）时送达。 |
| 系统提示词 | 常驻的 Open Artifact 提示词，作为 Pi 系统提示词里单独的 `<open_artifact>` 一节。 |
| Skill `open-artifact` | 按 Pi 的方式渲染（原生工具、页面在电脑的浏览器里打开），写到 `~/.open-artifact/skills/pi/`，启动时交给 Pi。用 `/skill:open-artifact` 加载。 |
| 命令 `/open-artifact <类型> <要做什么>` | 带着你的要求运行这个 skill，并把已安装的类型作为补全。 |
| 会话状态 | Pi 工作时为 `running`，结束后为 `idle`，页面据此显示 agent 是否在忙。Pi 自己的 `write` 和 `edit` 工具改动的文件会上报（`agent.wrote`），打开着的页面立刻跟上。 |

Pi 没有自己的页面视图：`Artifact {action: "open"}` 在电脑的浏览器里打开页面，agent 也会把 `view_url` 给你。

## 它怎样启动 daemon

从不做作品的 Pi 会话什么也不启动。会话开始时如果已有 daemon 在运行，会话就连上并 attach，评论能送到它。否则，第一次调用 Open Artifact 工具时，启动这台电脑上最新的兼容运行时（本包的 `@open-artifact/cli` 是其中之一）并连接。重连后会话会再次 attach。`/new`、`/resume`、`/fork` 和 `/reload` 会关闭旧会话的连接，新会话自己建立连接。

daemon 里 Pi 的 profile 是 `packages/daemon/harnesses/pi.json`（harness 名 `pi`）。Pi 执行的 shell 命令带有 `PI_CODING_AGENT` 和 `PI_SESSION_ID`，所以 agent 运行的 `open-artifact` 命令会被识别为 Pi 的，属于本人的命令（发布、站点）在那里会拒绝运行。

设置 `PI_OPEN_ARTIFACT_DEBUG=1`，扩展会把它做的事写到 stderr。要检查一个正在运行的会话，运行 `open-artifact doctor --harness pi --session <id>`（会话 id 见 Pi 的 `/session`）。

## 构建和测试

不需要构建：Pi 直接加载 `src/index.ts`。Pi 的 API 在 `src/pi.ts` 里声明，所以这个包不依赖 Pi 的任何副本。

```bash
node --test plugins/pi/test/*.test.ts   # 用假的 Pi 和 kit 的假 daemon 测试（包含在 npm test 里）
npm run e2e -- --only pi --no-browser   # 真实的 pi、真实的 daemon，加一个脚本化的本地模型
```

e2e 测试需要 `PATH` 上有 `pi`；它使用临时的 Pi agent 目录，不会读取你自己的 Pi 设置和登录信息。见 [e2e/README.md](../../e2e/README.md)。
