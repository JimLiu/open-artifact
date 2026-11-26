# Open Artifact for OMP

[English](README.md)

让 [OMP](https://omp.sh) 做幻灯片、设计画布、白板、电子表格、数据看板、文档、动画短片和设计系统：每件作品是一个文件夹，在同一个本地页面里查看、编辑和评论。输入 `/open-artifact slides 为这个仓库做一份 6 页的路演稿`（或 `design …`、`whiteboard …`、`sheets …`、`data …`、`docs …`、`motion …`、`page …`）。

这是一个 OMP 包（`omp-open-artifact`），里面只有一个扩展。它基于 `@open-artifact/harness-kit`，是 Harness API 上的完整适配器（L3），并自带 Open Artifact 运行时（`@open-artifact/cli`）。

## 安装

需要 OMP（已用 19.2.1 测试）和 OMP 要求的 Bun 1.4.4 及以上。

```bash
omp plugin install npm:omp-open-artifact
```

然后开一个新的 OMP 会话。

在本仓库的源码目录里，先运行 `npm ci`、`npm run build` 和 `node scripts/build-skill.mjs`（构建扩展要启动的运行时），再：

```bash
omp plugin install ./plugins/omp
```

只想试一次、不安装，用 `omp -e ./plugins/omp`。升级用 `omp plugin upgrade`。

## 给 OMP 带来什么

| 部分 | 作用 |
| --- | --- |
| 工具 `Artifact`、`ArtifactData`、`ArtifactComments` | 以 daemon 自己的参数 schema 注册为 OMP 工具，并设为 `essential`，让它们留在顶层工具列表里。每次调用都带上 OMP 的会话，做出的作品归这个会话。daemon 返回错误时调用失败，错误文本保留 daemon 说的全部内容（冲突时包括文件的当前内容）。按 Esc 停止等待；除此之外调用不设超时。 |
| 页面上的评论和请求 | 立刻送到拥有该作品的会话。你本人的话作为用户消息：OMP 空闲时开始新一轮，正在工作时插入当前这一轮。协作者的评论或系统消息（后台任务的结果）作为 `open-artifact` 自定义消息交给模型，不会被当作你说的话；OMP 空闲时同样会被唤醒。会话关闭期间发来的消息，在你重新打开它（`omp --resume`）时送达。 |
| 系统提示词 | 常驻的 Open Artifact 提示词，在 `before_agent_start` 时加进 OMP 发给模型的系统提示词。 |
| Skill `open-artifact` | 按 OMP 的方式渲染（原生工具、页面在电脑的浏览器里打开），写到本包的 `skills/` 文件夹——OMP 会扫描扩展包的这一目录；daemon 连上后再按已安装的类型重写。用 `/skill:open-artifact` 加载。 |
| 命令 `/open-artifact <类型> <要做什么>` | 把 skill 和你的要求作为一条用户消息发出去，并把已安装的类型作为补全。OMP 发送消息时不会展开 `/skill:`，所以命令自己带上 skill 文本。 |
| 会话状态 | OMP 工作时为 `running`，结束后为 `idle`，页面据此显示 agent 是否在忙。一轮中暂时的停顿（OMP 的 `willContinue`）仍然是 `running`。OMP 自己的 `write` 和 `edit` 工具改动的文件会上报（`agent.wrote`），打开着的页面立刻跟上。 |

OMP 没有自己的页面视图：`Artifact {action: "open"}` 在电脑的浏览器里打开页面，agent 也会把 `view_url` 给你。

## 作品放在哪里

新作品放在你自己的 Open Artifact 文件夹里，一个项目一个文件夹：`~/OpenArtifact/<项目>/<slug>`。OMP 允许它的 agent 写这里，仓库保持干净。想放回项目里（`<会话所在文件夹>/artifacts/<slug>`），在终端运行 `open-artifact config set artifactsLocation workspace`，只对当前项目生效加 `--local`。见 [设置](../../docs/settings.zh-CN.md)。

## 它怎样启动 daemon

从不做作品的 OMP 会话什么也不启动。会话开始时如果已有 daemon 在运行，会话就连上并 attach，评论能送到它。否则，第一次调用 Open Artifact 工具时，启动这台电脑上最新的兼容运行时（本包的 `@open-artifact/cli` 是其中之一）并连接。重连后会话会再次 attach。`/new`、`/resume` 和 `/fork` 会原地更换会话 id：扩展在同一条连接上 detach 旧会话、attach 新会话。`/reload` 不换会话。

daemon 里 OMP 的 profile 是 `packages/daemon/harnesses/omp.json`（harness 名 `omp`）。OMP 的 bash 工具命令带有 `OMP_BASH_SESSION`（会话 id），所以 agent 通过 bash 工具运行的 `open-artifact` 命令会被识别为 OMP 的，属于本人的命令（发布、站点）在那里会拒绝运行。OMP 的 `eval` `sh()` 不带这个变量：在那里运行的命令不会被识别为 OMP 的。

设置 `OMP_OPEN_ARTIFACT_DEBUG=1`，扩展会把它做的事写到 stderr。要检查一个正在运行的会话，运行 `open-artifact doctor --harness omp --session <id>`（会话 id 见 OMP bash 工具命令里的 `OMP_BASH_SESSION`）。

## 构建和测试

不需要构建：OMP 直接加载 `src/index.ts`。OMP 的 API 在 `src/omp.ts` 里声明，所以这个包不依赖 OMP 的任何副本。

```bash
node --test plugins/omp/test/*.test.ts   # 用假的 OMP 和 kit 的假 daemon 测试（包含在 npm test 里）
```

测试覆盖了与 Pi 适配器的四处差异：系统提示词从 `before_agent_start` 返回；skill 写到 OMP 扫描扩展包的位置；`/open-artifact` 自己发送 skill 文本；用 `agent_end`（而不是 `agent_settled`）表示会话空闲。

连上 daemon 的会话会把 `skills/open-artifact/SKILL.md` 按已安装的类型重写，在源码目录里会让该文件变脏；
运行 `node scripts/build-skill.mjs`（或当初生成它的命令）可还原仓库里的版本。
