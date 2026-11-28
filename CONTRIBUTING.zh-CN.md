# 为 Open Artifact 贡献代码

简体中文 · [English](CONTRIBUTING.md)

Open Artifact 采用 Apache-2.0 协议，欢迎任何规模的贡献：在你这台机器上出问题的某个 artifact 类型、某份指南里写错的一行，
或者为你常用的 Agent App 补一个插件。

## 这个项目是什么

Open Artifact 让任意编码 Agent 做出来的东西是你可以打开、编辑、评论的，而不是一堆需要你自己去读的文件。一个 artifact
就是磁盘上一个普通文件夹；本地 daemon 把它服务出来，同一个页面框架把它开在真正的编辑器里。全部跑在你自己机器上：
没有账号、不上传、也不绑定任何模型或厂商。

目前有九种类型——`slides`、`design`、`design-system`、`whiteboard`、`sheets`、`data`、`docs`、`motion`，以及一个自由的
HTML `page`——外加十一个 Agent App 的插件（`claude-code`、`codex`、`cursor`、`copilot`、`antigravity`、`zcode`、
`dsh`、`pi`、`omp`、`hermes`、`chatgpt`）。其它任何 Agent 可以单独使用 `skills/open-artifact/` 里的技能，
`apps/desktop/` 则是 macOS 上的 Electron 桌面端。

## 环境要求

- **Node.js 22.18+**——即 `package.json` 里 `engines` 声明的那条范围。
- **只有在改 `crates/` 下的 crate 时才需要 Rust**：`cargo`、`wasm32-unknown-unknown` target、`wasm-bindgen` 和
  `wasm-opt`。它们的产物已提交在 `packages/wasm-*/generated/`，所以普通改动完全用不到 Rust。
- **只有端到端测试需要 Chrome**（`npm run e2e` 以及 Motion 的 `stills`），它会去常装位置找，也可以用 `E2E_CHROME` 指定。

## 准备工作

```bash
npm ci
npm run build
npm run check
```

顺序不要颠倒。`npm run build` 会写出 `dist/server/`（CLI、`support.js` 和各编辑器）、`dist/daemon/`（Shell 与
frame-host），以及构建后的 `artifact-types/<type>/scripts/`；有少数测试会直接读这些产物——比如
`packages/host-cloudflare/test/` 就从 `dist/server` 提供编辑器——没有构建它们会以一个跟你改动无关的原因失败。
在已构建的树上跑出的 `npm run check` 数字，才是我们在 PR 里要的那个数字。

## 日常命令

| 命令 | 用途 |
| --- | --- |
| `npm run build` | 一次构建上面全部产物。 |
| `npm run build -- --only <part>` | 迭代时只构建一部分：`cli`、`support`、`editors`、`types`、`shell`、`frame` 或 `dsh`。 |
| `npm run typecheck` | 全工作区的 `tsc` 类型检查，不跑测试。 |
| `npm test` | 单独跑单元测试（`node --test`）。 |
| `npm run check` | `typecheck` 加 `npm test`——完整的一道门，也是 PR 里要报的数字。 |
| `npm run e2e` | 针对构建后类型的端到端套件；`--only <suite>` 只跑部分，`--no-browser` 跳过 Chrome。 |
| `node scripts/build-wasm.mjs` | 把 `crates/` 的 Rust 重新编译到 `packages/wasm-*/generated/`；只在改 crate 时需要。 |

`npm run test:sea`（单可执行文件）需要官方的 Node 25.5+，不属于 `npm test`；桌面端在自己的目录下构建和自检——详见
`docs/references/build-test-release.md`。

## 代码放在哪

| 路径 | 内容 |
| --- | --- |
| `artifact-types/<type>/` | 每种类型一个自包含技能：`SKILL.md`、`artifact-type.json` 清单，以及 `reference/` 下的分主题指南（`page` 的参考文档在 `artifact-type/` 下）。`scripts/` 是构建产物。 |
| `packages/` | 平台本体——`daemon`、`shell`、`protocol`、`runtime`、`type-server`、`harness-kit` 与各 `host*` 包——外加每个有编辑器的类型一对 `<type>-core` / `<type>-editor`，以及共用的 UI、画布与导出套件。 |
| `plugins/<app>/` | 单个 Agent App 的插件：README、hooks、monitors 与资源。它们运行的 harness profile 在 `packages/daemon/harnesses/`。 |
| `skills/open-artifact/` | 唯一的 `/open-artifact` 技能，给没有被任何插件覆盖的 Agent。其中的 `SKILL.md` 是生成的——不要手改。 |
| `docs/` | 双语用户与 Agent 指南：`docs/types/<type>.md` 与 `.zh-CN.md`、`docs/integrating*`，以及 `docs/references/` 下给贡献者的参考。 |
| `examples/` | 可直接运行的 Agent App 集成（`harness-node`、`harness-electron`、`harness-stdio`）与 host 插件。 |
| `e2e/` | 端到端套件，通过 CLI 与 Chrome DevTools Protocol 驱动构建后的类型。 |

想弄清各块怎么拼起来，先看 `docs/references/architecture.md` 与 `docs/references/artifact-types.md`；其余按需打开你真正
要动的那一篇，不必全读。

## 文档属于改动的一部分

只要你新增、删除或修改了人能看见、Agent 能看见的东西，就必须在**同一个 PR**里更新它的文档，而且英文（`*.md`）与
简体中文（`*.zh-CN.md`）都要更新。[`AGENTS.md`](AGENTS.md#documentation-sync-rule-mandatory) 里的对照表说明某类改动
会牵动哪些文件；[`docs/references/docs-maintenance.md`](docs/references/docs-maintenance.md) 有完整清单与写作规范。
代码和文档对不上的 PR 不算就绪。

## 提交与 Pull Request

- 一个提交只做一件事。标题用英文祈使句——`Fix …`、`Add …`——当原因从 diff 里看不出来时，写进正文。
- 我们习惯给 PR 标题加作用域前缀：`fix(design): …`、`feat(dsh): …`、`docs: …`。这是习惯，不是规定。
- 每个 PR 正文必须有 **Verification** 一节：你跑了哪些命令、真实的数字是多少，例如
  `` `npm run check` 5005 tests: 5004 pass, 1 skipped ``。“应该没问题”不算验证。改动涉及页面的，附截图。
- 关联你要修的 issue；diff 只包含这次改动需要的东西——顺手重排无关代码会多花一轮 review。

## 版本号与 CHANGELOG 属于发版

无论 PR 多大，都不要在 PR 里抬版本号或改 `CHANGELOG.md`。每个 `@open-artifact/*` 包、每个插件清单和各 marketplace 清单
共用同一个版本，发版时由维护者一起改。流程见 [`README.md`](README.md#releasing)，细节见
`docs/references/build-test-release.md`。

## 测试

- 改 `packages/*`——在它旁边新增或更新对应的 `*.test.ts`，跑 `npm test`（要过完整的一道门就跑 `npm run check`）。
- 改某个类型——对应的套件是 `e2e/<type>.test.mjs`，构建后跑 `npm run e2e -- --only <type>`。不想让 Chrome 掺和时，
  `--no-browser` 仍然覆盖 CLI 与文件侧。
- `npm test` 通过 `scripts/test-env.mjs` 把 `OPEN_ARTIFACT_HOME_WORKSPACE` 指到临时目录，所以测试永远不会写进你自己的
  `~/OpenArtifact`。单独跑一个文件时带上同样的预加载：`node --import ./scripts/test-env.mjs --test <file>`。
- 改 `apps/desktop/` 在该目录下自检（那里的 `npm run check`），它不包含在根目录的 `npm test` 里。

## 平台说明

- 开发和验证主要在 macOS 上进行；桌面端的打包与签名只支持 macOS（`apps/desktop/RELEASING.md`）。
- 在 Windows 或 Linux 上跑 `npm run check`，可能撞上跟你改动无关的失败。请在 PR 正文里说明、点出是哪条测试，并且
  不要动那个断言——为了让检查变绿而放松一条无关测试，比一个已知失败更糟。
- 在 Windows 上请用 LF 检出（`git config core.autocrlf false`）。测试套件里有一部分是拿文件内容与生成的文本比对——
  `packages/protocol/test/skill.test.ts` 就是一例——CRLF 检出让它们仅因为 `\r\n` 就失败。若少数 `bin/` 入口显示为已修改而
  `git diff` 为空，那是构建写入了 LF，`git checkout -- <path>` 即可清掉。

## 获取帮助

开一个 [issue](https://github.com/JimLiu/open-artifact/issues)——模板会问你的客户端、版本和
`open-artifact doctor --harness <name>` 的输出，这些通常够定位问题。“我该怎么做……”这类问题，[`docs/`](docs/README.md)
里的双语指南大多已经回答。

## 许可证

Apache-2.0——见 [`LICENSE`](LICENSE)。版权与署名见 [`NOTICE`](NOTICE)。提交贡献即表示你同意以相同条款授权你的工作。
