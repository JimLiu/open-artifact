# 在 Pi 中使用 Open Artifact

此扩展将一个 Pi 会话连接到 Open Artifact。作品所有者从页面发出的请求和评论会送到创建该作品的会话。其他人的评论只显示为通知，不会启动新回合。

## 试用

安装 Pi 和 `open-artifact` CLI，并将两条命令放到 `PATH` 中。在 Pi 中加载[独立的 Open Artifact 技能](../../README.md#2-as-a-skill-for-any-other-agent)，然后用此示例启动 Pi：

```sh
pi -e ./examples/harness-pi/extension.ts
```

在 Pi 中运行 `/open-artifact-connect`，然后请 Pi 使用 Open Artifact 技能创建文档。扩展注册 `Artifact`、`ArtifactData` 和 `ArtifactComments`，并将 Pi 会话作为调用方。打开作品链接，从 **Ask** 面板发送请求或在评论中留言。

Pi 在自己的对话中显示回答。Pi 可以直接回复页面上的评论，但此示例不向 Ask 面板发送回答。Pi 关闭时，Open Artifact 会将请求排队。恢复同一个 Pi 会话并再次运行 `/open-artifact-connect` 即可收到这些请求。

## 测试

```sh
node --test examples/harness-pi/harness-pi.test.mjs
```

测试使用独立的 Open Artifact 主目录，通过 RPC 驱动真实的 Pi 进程。它通过守护进程发送 Ask 请求，并检查 Pi 收到的输入，不会调用模型或打开浏览器。
