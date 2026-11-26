# 设置，以及作品存在哪里

[English](settings.md)

一个作品就是磁盘上的一个文件夹。这一页讲新作品放在哪、怎么选，以及 Open Artifact 的设置存在哪：一份你自己的文件，
加上项目里可选的一份。

## 新作品放在哪

agent 的调用没有指定文件夹时，Open Artifact 自己选一个，并按标题起名：

| 位置 | 文件夹 | 含义 |
| --- | --- | --- |
| `home` | `~/OpenArtifact/<项目>/<slug>` | 放在你的 **Open Artifact 文件夹**下，每个项目一个文件夹。仓库里什么都不多，`git status` 保持干净；检出目录或 worktree 删了，作品还在。 |
| `workspace` | `<会话的文件夹>/artifacts/<slug>` | 放在 agent 工作的文件夹里。作品和代码在一起，可以一起提交。 |

什么都没设置时，用哪个：

| 会话所在的应用 | 默认 | 原因 |
| --- | --- | --- |
| Claude Code、Codex、Cursor、GitHub Copilot、Antigravity、ZCode、DeepSeek Harness | `workspace` | 实测过的几个在常用模式下，往工作文件夹之外写文件要先确认，或者直接被拒（见[下文](#让你的应用能写-open-artifact-文件夹)）；其余几个在实测之前保持一致。 |
| 网页版 ChatGPT（`open-artifact chatgpt`） | `workspace` | 这个连接器按路径区分自己的作品。 |
| Pi、`open-artifact` 命令行、没有 profile 的应用 | `home` | 没有东西拦着写。 |
| 用 `OPEN_ARTIFACT_WORKSPACE_FOLDERS_ONLY=1` 启动 daemon 的应用 | 始终 `workspace` | 受限的 daemon 把所有文件夹都留在工作区里，任何设置和调用都改不了。 |

如果是应用的默认值让作品落进了 Git 检出目录，而且 `artifacts/` 这个文件夹是 Open Artifact 这次新建的，它会同时
写一个 `artifacts/.gitignore`（只有一行 `*`），这样作品不会出现在 `git status` 里。想让 Git 跟踪它们，删掉这个文件
就行。文件夹原本就在，或者位置是你、项目或这次调用选的，就不写 `.gitignore`：那种情况下作品本来就是要给 Git 看的。

你在主页上做的作品（没有会话）仍然放在 `~/OpenArtifact/artifacts/<slug>`，和以前一样。

### Open Artifact 文件夹

```text
~/OpenArtifact/
├── artifacts/                     在主页上做的
│   └── reading-list/
├── shop/                          项目 ~/code/shop
│   ├── .open-artifact-project.json
│   ├── launch-plan/
│   └── q3-review/
└── app-3f9c/                      第二个文件夹名也叫 "app" 的项目
```

- **项目**指会话所在的 Git 检出目录（它的顶层文件夹），不管 agent 是在里面哪一级启动的。同一个仓库的所有 worktree
  是同一个项目。不在任何检出目录里的文件夹，自己就是一个项目。带有项目设置文件（见[下文](#项目的文件)）的文件夹
  也是一个项目，monorepo 里的某个包可以这样单独算。
- 项目在这里的文件夹按项目文件夹的名字起名。`.open-artifact-project.json` 记着它装的是哪个项目；两个项目重名时，
  第二个会加上路径哈希的几位（`app-3f9c`），每次都是同样的几位。
- 这个文件夹本身就是设置里的 `homeWorkspace`（`open-artifact config set homeWorkspace ~/Documents/Artifacts`）。

“这个项目的作品”（`Artifact {action: "list"}` 给会话看的，以及 `quickstart` 建议复用的）指为这个项目做的作品，不管
文件夹在哪，再加上文件夹位于会话文件夹之内的作品。

你自己也能按项目看。在首页（`open-artifact open`），每张卡片会写出作品所属的项目（鼠标停上去显示完整的文件夹），
作品属于不止一个项目时，列表上方多出一行用来筛选：**全部**、每个项目和它的作品数，以及**不属于项目**（在首页
创建的，或者在记录项目之前创建的）。两个同名的项目用各自所在的文件夹区分（`app (work)`、`app (play)`）。在
Open Artifact Desktop 里，作品库在每个标题下写出项目，筛选菜单多了**项目**子菜单，搜索能按项目路径找，鼠标停在
侧边栏的某一行上也会显示项目。

### 怎么选

| 你想要 | 做法 |
| --- | --- |
| 某一个作品放到别处 | 告诉 agent：“放到项目里”或“放到我的 Open Artifact 文件夹”。它会传 `location: "workspace"` 或 `location: "home"`。给出确切路径时，它传 `folder`。 |
| 全部放进 Open Artifact 文件夹 | `open-artifact config set artifactsLocation home`，并且[让你的应用能写那里](#让你的应用能写-open-artifact-文件夹)。 |
| 全部放在工作区，Git 能看到 | `open-artifact config set artifactsLocation workspace` |
| 某个项目不一样，只对你自己 | 在项目里：`open-artifact config set artifactsLocation home --local` |
| 某个项目对所有人都一样 | 在项目里：`open-artifact config set artifactsLocation workspace --project`，然后提交 `.agents/open-artifact/settings.json` |
| 恢复默认 | `open-artifact config unset artifactsLocation`（上面两种分别加 `--local` 或 `--project`） |

已有的东西都不会动：设置只决定**下一个**作品放哪，之前做的作品留在原处，也仍然在它所属项目的列表里。

## 让你的应用能写 Open Artifact 文件夹

agent 用自己的文件工具写作品的文件。多数 agent 应用只让这些工具写工作文件夹，所以它们的默认值是 `workspace`。
要在这类应用里用 `home`，把 Open Artifact 文件夹加进它可以写的文件夹：

| 应用 | 设置 | 实测 |
| --- | --- | --- |
| Claude Code | `claude --add-dir ~/OpenArtifact`，或在它的设置里写 `"permissions": {"additionalDirectories": ["/Users/you/OpenArtifact"]}` | 2.1.318：加了之后，`acceptEdits` 模式不用确认就能写。`auto` 模式什么都不用加。 |
| Codex | `codex --add-dir ~/OpenArtifact`，或在 `config.toml` 里写 `sandbox_workspace_write.writable_roots = ["/Users/you/OpenArtifact"]` | 0.171.0-alpha：不加的话，`workspace-write` 拒绝写入。 |
| GitHub Copilot CLI | `copilot --add-dir ~/OpenArtifact` | 1.0.114：不加的话，写入要等你批准。 |
| Cursor CLI | 没找到：`--add-dir` 不起作用。`--force` 放开所有写入。 | 2026.11.13 |
| Pi | 不用设置。 | 1.6.1 |

以上是在 macOS 上、用各应用的无界面模式测的。没有测：Antigravity、ZCode、DeepSeek Harness、各应用交互界面里的
确认弹窗、Cursor 编辑器、Claude 桌面应用、Windows 和 Linux。Open Artifact 不会替你改别的应用的权限设置。

作品的文件夹在 agent 的工作文件夹之外时，新建的结果里会说明。写不进去的 agent 仍然可以填内容：
`Artifact {action: "publish", url, files: {...}}` 让 daemon 代写这些文件。

## 设置文件

### 你的文件

`~/.agents/open-artifact/settings.json`（设置了 `$OPEN_ARTIFACT_HOME` 时是 `$OPEN_ARTIFACT_HOME/settings.json`）保存你在
这台电脑上对所有应用和项目的设置。里面只有你改过的内容。和作品位置有关的键：

| 键 | 默认 | 含义 |
| --- | --- | --- |
| `artifactsLocation` | 不设 | `home` 或 `workspace`。不设：用应用的默认值，见上表。 |
| `artifactsDir` | `artifacts` | 工作区下那个文件夹的名字；主页上做的作品在 Open Artifact 文件夹下也用它。 |
| `homeWorkspace` | `~/OpenArtifact` | 你的 Open Artifact 文件夹。文件里没设时，`OPEN_ARTIFACT_HOME_WORKSPACE` 可以指定它。 |
| `projects` | 不设 | 你对单个项目的设置，按项目文件夹：`{"~/code/shop": {"artifactsLocation": "home"}}`。由 `config set --local` 写入。这里的 `artifactsDir` 相对于项目的文件夹。 |

其余的键（类型、信任的项目、站点、端口、运行时）各有自己的命令，见[自己做作品类型](custom-types.zh-CN.md)、
[连接你的电脑和 Agent](connecting-agents.zh-CN.md) 和[运行时与更新](integrating/runtime.zh-CN.md)。安装预设
（`preset.json`）是另一回事：它在安装时给电脑指定站点，不设置这一页里的任何东西。

### 项目的文件

`<项目>/.agents/open-artifact/settings.json`，和项目的类型（`.agents/artifact-types/`）在一起。把它提交进仓库，在这个
仓库里工作的每个人得到同样的结果。它可以设两个键：

| 键 | 含义 |
| --- | --- |
| `artifactsLocation` | `home` 或 `workspace`，对这个项目里的会话生效。 |
| `artifactsDir` | 项目把作品放在哪：相对于这个文件所在文件夹的路径，而且必须在它里面（`docs/artifacts`）。 |

```json
{ "artifactsLocation": "workspace", "artifactsDir": "docs/artifacts" }
```

这个文件里其他的键一律忽略。仓库可能是任何人写的：它不能让自己被信任，不能挪走你的 Open Artifact 文件夹，不能
添加站点，也不能打开发布。`open-artifact config list` 会列出被忽略的键。

Open Artifact 从会话的文件夹往上找这个文件，找到 Git 检出目录的顶层为止，用最近的那一份。它不会找到检出目录
之外；周围没有检出目录时，只看会话自己的文件夹；它也绝不会把你自己的设置文件当成项目的。（项目的**类型**仍然
只在会话的文件夹里找，见[自定义类型](custom-types.zh-CN.md)。）

### 谁说了算

从高到低：

1. 调用：`folder`（确切路径），其次 `location`。
2. 受限的 daemon（`OPEN_ARTIFACT_WORKSPACE_FOLDERS_ONLY=1`）：工作区。
3. 你对这个项目的设置（`projects`，`config set --local`）。
4. 项目的文件。
5. 你的 `artifactsLocation`。
6. 应用的默认值（它的 harness profile 里的 `policy.artifacts`）。
7. `home`。

## `open-artifact config`

```bash
open-artifact config                          # 这里实际生效的设置（JSON）：每个值，以及是谁设的
open-artifact config get artifactsLocation    # 一个值
open-artifact config set artifactsLocation home             # 写进你的 settings.json
open-artifact config set artifactsLocation home --local     # 只对你、只对这个项目
open-artifact config set artifactsDir docs/artifacts --project   # 写进这个项目的设置文件
open-artifact config unset artifactsLocation [--local | --project]
```

- **键：**`artifactsLocation`、`artifactsDir`、`homeWorkspace`、`serverPort`。`--project` 和 `--local` 只接受前两个。
- **哪个项目：**当前文件夹所在的项目；`--workspace <dir>` 指定另一个。`--harness <name>` 让 `list` 和 `get` 按那个
  应用的会话来回答（`--harness claude-code`）。
- `list` 给每个值一个 `source`：`local`（你，对这个项目）、`project`（项目的文件）、`user`（你）、`environment`、
  `harness`（应用的默认值）或 `default`。`project.ignored` 列出项目文件里没被采用的键。
- `set` 和 `unset` 经过 daemon，所以改动立刻生效。手动改了文件之后，重启它：`open-artifact daemon restart`。
- **只有你能改设置。**在 agent 的会话里，`config set` 和 `config unset` 会被拒绝，和信任项目、发布一样；`list` 和
  `get` 在哪都能用。`--project` 在文件里什么都不剩时会把文件删掉。

## 检查：`open-artifact doctor`

```bash
open-artifact doctor --harness claude-code      # 在项目里运行；--workspace <dir> 指定另一个文件夹
```

它的检查里有四项和这一页有关：

| 检查 | 说明 |
| --- | --- |
| `home-workspace` | 你的 Open Artifact 文件夹，以及它能不能写（还没建出来不算问题）。不能写时失败。 |
| `artifacts-location` | 这个应用在这个文件夹里的会话把新作品放在哪，是谁选的。位置是你的 Open Artifact 文件夹、而这个应用只让 agent 写工作文件夹时（Claude Code、Codex、Copilot CLI、Cursor），给出警告和要加的设置。对 Claude Code 和 Codex，doctor 会读应用自己的设置（`~/.claude/settings.json` 和项目里的 `.claude/settings*.json`；`~/.codex/config.toml`），里面已经放行这个文件夹就报 ok；命令行上给的 `--add-dir` 它看不到。 |
| `project-settings` | 项目的设置文件和它设了什么；有没被采用的键，或者文件不是 JSON 对象时给出警告；还有你对这个项目自己的设置。 |
| `settings-projects` | 你的设置里 `projects` 的条目，文件夹已经不在了，或者不是用绝对路径命名的，给出警告。 |

doctor 只读取：它不改你的设置，也不改别的应用的设置。

## 给 agent

- 不要自己编文件夹。不传 `folder`：daemon 来选，并按标题起名。
- 人要求放在项目里（“放仓库里”“和代码一起提交”）：`location: "workspace"`。要放进他们的 Open Artifact 文件夹：
  `location: "home"`。给了确切路径：`folder`。工作区受限的应用会拒绝 `location: "home"`（`not_granted`）。
- 新建结果里的 `root` 就是写文件的地方。它在你的工作文件夹之外时，结果的 `notes` 会说明：告诉人文件夹在哪；如果
  你的应用不让你往那里写，用 `Artifact {action: "publish", url, files}` 发送文件。
- 不要自己运行 `open-artifact config set`，也不要为了改作品位置去编辑任何一份设置文件。把命令告诉人。
