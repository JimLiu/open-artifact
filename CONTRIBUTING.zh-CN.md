# 参与 Open Artifact

简体中文 · [English](CONTRIBUTING.md)

谢谢你来帮忙。报 bug、修 bug、改正指南里写错的一行、给你用的 Agent 应用做个插件，都欢迎。Open Artifact 是什么、
怎么安装，见 [README](README.zh-CN.md)；这一页讲怎么改它。

## 准备

需要 **Node.js 22.18 或更新版本**（`package.json` 的 `engines`）。只有改 `crates/` 里的 crate 才需要 Rust（产物已经
提交在仓库里），只有端到端测试需要 Chrome。

```bash
npm ci
npm run build
npm run check
```

按这个顺序跑：有些单元测试要读构建的产物，没构建就跑 `npm run check`，会因为和你的改动无关的原因失败。

[AGENTS.md](AGENTS.md) 列了全部命令（部分构建、`npm run e2e`、桌面应用）和各个目录放什么。
[`docs/references/`](docs/references/) 里的参考文档讲架构、各个类型和构建，改哪一块就看哪一篇。

## 改动的要求

- **文档跟着改动走。** 新增、删除或修改了人或 Agent 能看到的东西，在同一个 PR 里更新文档，英文（`*.md`）和简体中文
  （`*.zh-CN.md`）都要改。哪类改动对应哪些文件，见 [AGENTS.md 里的表](AGENTS.md#documentation-sync-rule-mandatory)。
- **测试跟着改动走。** 改了 `packages/*`，就更新旁边的 `*.test.ts`。改了某个类型，构建后跑它的套件：
  `npm run e2e -- --only <type>`。
- **不要改版本号和 `CHANGELOG.md`。** 所有包和插件共用一个版本号，发版时统一改。

## Pull Request

- 一个 PR 只做一件事，关联它要修的 issue。
- 先说用的人或 Agent 会看到什么变化，再说改了什么。
- 列出你跑了哪些命令、结果是什么。看得见的改动附截图；修 bug 的附修之前和修之后各一张。
- Check 工作流会在每个 PR 上构建并跑 `npm run check`。第一次提 PR 时，要等维护者批准后才会开始跑。

## Windows

用 LF 换行检出仓库（克隆前先 `git config core.autocrlf false`）。有些测试拿生成的文本和磁盘上的文件比对，CRLF 检出
会让它们失败。

## 报告 bug

用 [bug 表单](https://github.com/JimLiu/open-artifact/issues/new/choose)。它会问你用的 Agent 应用和版本、artifact 类型和
复现步骤；`open-artifact doctor --harness <name>` 的输出能帮忙定位大多数安装和配置问题。

## 许可

Open Artifact 采用 Apache-2.0（[LICENSE](LICENSE)、[NOTICE](NOTICE)）。你贡献的内容也按同样的条款授权。
