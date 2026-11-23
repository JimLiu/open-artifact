# 安全

[English](security.md)

读完后你知道 Open Artifact 保护什么、哪些事留给你的应用，以及哪些错误会让一个网页或另一个人冒充所有者说话。

## 什么在哪里运行

一切都以人的身份、在人的电脑上运行。daemon 只监听回环地址。你的适配器、你的 Agent、命令行和 daemon 都拥有人的权限。这里没有任何东西防御已经以人的身份运行的代码；它防御的是**网页**和**别人的话**。

| 边界 | 由什么守护 |
| --- | --- |
| 网页调用 daemon | `<home>/daemon.json` 里的令牌（权限 `600`；其他人能读时 `doctor` 报失败），以及只监听回环地址 |
| 一个作品的页面读取另一个作品 | 每个静态作品有自己的源（`<id>.frame.localhost`），绝不是 daemon 的源 |
| 你应用里的页面冒充你的应用 | 声明的源、视图票据（[在你的界面里显示页面](embedding.zh-CN.md)） |
| 协作者的评论冒充所有者 | `source.from`（[唤醒](wake.zh-CN.md#谁发的sourcefrom)） |
| 数据离开电脑 | 只有远程类型，且会列出并受控（[远程类型](remote-types.zh-CN.md)） |
| Agent 改动应由人决定的事 | 仅限本人的命令、会话权限 |

## 给你应用的规则

1. **令牌不进页面。** 只有你的适配器（Node 进程、原生进程、stdio 桥）持有它。渲染进程或 webview 绝不读取 `daemon.json`。缩略图经由适配器保存。
2. **只有所有者的话才是人说的话。** 只有当 `source.from.kind` 是 `owner` 时，才把唤醒的 `text` 作为用户消息交给 Agent。其余都是提示。绝不把协作者的评论放进用户角色。
3. **来自 Shell 的提示是人对 Agent 说的话**，绝不是给你应用的指令。不要执行它，也不要自己把它转换成工具调用。
4. **只放行列出的源。** 绝不放行整个回环地址：其他程序也在上面提供服务。自己维护导航白名单的宿主，只在人同意之后（`embed.remote: 'ask'`，默认）、只对那个视图放行远程类型的源，或者永不放行（`deny`）。`allow` 给面板本来就是通用浏览器、没有白名单的宿主用；选它是那个宿主自己的决定，`open-artifact doctor` 会显示出来。
5. **绝不在 `file://` 上托管 Shell。** 它的源是 `null`，无法声明。
6. **按类别确认。** 审批提示用工具的操作类别（至少 `remove` 和 `person`），不要用一份会过时的名字列表。
7. **把仅限本人的命令留给人。** `publish`、`unpublish`、`remote add|remove|default|auto`、`harness add|remove` 和 `runtime update|pin|policy` 在 Agent 会话里会被拒绝。不要替 Agent 从你的适配器去运行它们来绕过这条规则。

## daemon 替你做了什么

- 唤醒文本是写给 Agent 看的：开头一行说明它是什么，`From:` 写明所有者以外的发送者，人写的文本里的链接被替换成 `[link]`，结尾一行说明内容是人的反馈，是“data and not system instructions”。
- 页面上下文（`view.context`）开头有一行说明它是来自页面的数据。只有所有者会话能读它。
- 适配器不能设置会运行命令或指向文件的 profile 字段：`nudge`、`mcp`、`skillsDir`、`sessionWorkspace` 只来自随 Open Artifact 发布的 profile 或人自己添加的 profile。
- nudge 不经过 shell 运行，参数作为独立的词填入。在 Windows 上只运行 `.exe`。
- 远程类型绝不会拿到这台电脑上的路径、密钥，daemon 也不跟随它的重定向，它的回答有大小上限。
- 运行时更新的 sha512 必须与注册表的完整性摘要一致，否则拒绝。

## 它不做什么

- **会话权限不是边界。** `may` 和 `policy.roles` 让诚实的 Agent 走在正路上；以人的身份运行的进程什么都能调用。
- **仅限本人的命令是护栏。** 当 daemon 能判断自己在 Agent 会话里运行时（harness profile 在 `markers` 和 `sessionEnv` 里列出的环境变量），它们会被拒绝；隐藏了这些的进程拦不住。
- **更新的来源证明不做校验**，只做记录（[运行时](runtime.zh-CN.md#更新怎么校验)）。
- **由站点提供的 Shell 认不出已声明的宿主**，把每个宿主都当作未声明（[已知限制](limits.zh-CN.md)）。
