# Open Artifact 指南

[English](README.md)

这些指南讲怎么把作品放到**站点**上（站点是一台服务器，给作品一个网址，你的电脑关机也能打开），以及怎么把你的电脑和
Agent 连到站点。

| 指南 | 什么时候看 |
| --- | --- |
| [把作品放到站点上](hosting.zh-CN.md) | 想先弄清站点怎么工作、该选哪一种。从这里开始。 |
| [家里或办公室内网的站点](hosting-lan.zh-CN.md) | 大家都在同一个网络里；不要域名，走 http。含 systemd、launchd 和 Docker 的配置。 |
| [带域名的自有服务器站点](hosting-server.zh-CN.md) | VPS 或 EC2，用 Docker Compose 加 Caddy；登录方式、AWS CloudFormation、备份。 |
| [Cloudflare 上的站点](hosting-cloudflare.zh-CN.md) | 不想自己维护服务器：一个 Worker，加 D1 和 Durable Objects。 |
| [连接你的电脑和 Agent](connecting-agents.zh-CN.md) | 连接电脑、发布、自动发布新建的作品、各个 Agent 应用的预设、远程 MCP、仪表盘的数据。 |
| [插件](plugins.zh-CN.md) | 想让大家用公司账号登录，权限来自你自己的服务或一张表，按规定拒绝某些操作，或者让别的系统知道发生了什么。在 Node 和 Cloudflare 上使用插件、五个实际演练的例子，以及怎么写插件。 |

每篇指南同时写给两种读者：人可以读懂，替人操作的 Agent 也知道该执行什么。步骤都有编号，每一步给出确切的命令、应该看到
的输出、检查方法和出错时怎么办；每篇开头列出 Agent 必须问人、不能自己猜的问题。写指南时哪些命令实际运行过、哪些没有，
都在对应的步骤里注明。

给运维的更多细节（英文）：[packages/host/README.md](../packages/host/README.md)（Node 站点的全部设置）、
[deploy/cloudflare/README.md](../deploy/cloudflare/README.md)（Worker 的内部结构、限制和费用）、
[deploy/aws/README.md](../deploy/aws/README.md)、[plugins/README.md](../plugins/README.md)（各个 Agent 应用）。
