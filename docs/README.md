# Open Artifact guides

[中文](README.zh-CN.md)

Guides for putting artifacts on a **site** (a server that gives them a web address that works when your computer is
off) and for connecting your computers and agents to it.

| Guide | Read it when |
| --- | --- |
| [Putting artifacts on a site](hosting.md) | You want to know how a site works and which kind to run. Start here. |
| [A site on your home or office network](hosting-lan.md) | Everyone is on one network; no domain, plain http. Includes systemd, launchd and Docker set-ups. |
| [A site on your own server, with a domain](hosting-server.md) | A VPS or EC2 with Docker Compose and Caddy, sign-in providers, AWS CloudFormation, backups. |
| [A site on Cloudflare](hosting-cloudflare.md) | No server to look after: a Worker, D1 and Durable Objects. |
| [Connecting your computers and agents](connecting-agents.md) | Connecting a computer, publishing, publishing by itself, install-time presets per agent app, remote MCP, dashboards' data. |
| [Plugins](plugins.md) | People should sign in with your company's login, permissions should come from your own service or a table, an action must be refused by policy, or other systems must hear what happens. Using plugins on Node and Cloudflare, five worked examples, and writing one. |

Each guide works for a person reading it and for an agent doing it on someone's behalf: the steps are numbered, each
with the exact command, the output to expect, a check and what to do if it fails, and each guide starts with the
questions an agent must ask rather than guess. What was run while writing a guide, and what was not, is said at the
step.

More detail for operators: [packages/host/README.md](../packages/host/README.md) (every setting of the Node site),
[deploy/cloudflare/README.md](../deploy/cloudflare/README.md) (the Worker's internals, limits and costs),
[deploy/aws/README.md](../deploy/aws/README.md), [plugins/README.md](../plugins/README.md) (each agent app).
