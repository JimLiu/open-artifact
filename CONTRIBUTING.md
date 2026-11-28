# Contributing to Open Artifact

[简体中文](CONTRIBUTING.zh-CN.md) · English

Open Artifact is Apache-2.0 and contributions of every size are welcome: an artifact type that misbehaves on your
computer, a wrong line in a guide, or a plugin for the agent app you use.

## What this project is

Open Artifact lets any coding agent make things you can open, edit and comment on, instead of files you have to read.
An artifact is a plain folder on disk; a local daemon serves it and one page frame opens it in a real editor. It runs
on your machine, with no account, no upload and no particular model or vendor.

Nine types ship today — `slides`, `design`, `design-system`, `whiteboard`, `sheets`, `data`, `docs`, `motion` and a
free HTML `page` — with a plugin for each of eleven agent apps (`claude-code`, `codex`, `cursor`, `copilot`,
`antigravity`, `zcode`, `dsh`, `pi`, `omp`, `hermes`, `chatgpt`). Any other agent can carry the skill in
`skills/open-artifact/` by itself, and `apps/desktop/` is the Electron app for macOS.

## Prerequisites

- **Node.js 22.18+** — the range `package.json` declares in `engines`.
- **Rust only when you change a crate** in `crates/`: `cargo`, the `wasm32-unknown-unknown` target, `wasm-bindgen` and
  `wasm-opt`. Their output is committed under `packages/wasm-*/generated/`, so an ordinary change needs no Rust at all.
- **Chrome only for the end-to-end tests** (`npm run e2e`, and Motion `stills`), found in its usual places or named by
  `E2E_CHROME`.

## Set up

```bash
npm ci
npm run build
npm run check
```

Run them in that order. `npm run build` writes `dist/server/` (the CLI, `support.js` and the editors), `dist/daemon/`
(the Shell and the frame-host) and the built `artifact-types/<type>/scripts/`; a few tests read those directly —
`packages/host-cloudflare/test/` serves its editors from `dist/server` — so without a build they fail for a reason
that has nothing to do with your change. An `npm run check` on a built tree is the number we ask for in a pull request.

## Everyday commands

| Command | For |
| --- | --- |
| `npm run build` | Everything above, in one go. |
| `npm run build -- --only <part>` | One part while iterating: `cli`, `support`, `editors`, `types`, `shell`, `frame` or `dsh`. |
| `npm run typecheck` | `tsc` across the workspace, no tests. |
| `npm test` | The unit tests (`node --test`) on their own. |
| `npm run check` | `typecheck` plus `npm test` — the whole gate, and the number to report in a PR. |
| `npm run e2e` | The end-to-end suites against the built types; `--only <suite>` for some, `--no-browser` to skip Chrome. |
| `node scripts/build-wasm.mjs` | Rebuilds the Rust crates into `packages/wasm-*/generated/`; only for changes in `crates/`. |

`npm run test:sea` (the single executable) needs an official Node 25.5+ and is not part of `npm test`; the desktop app
builds and checks from its own folder — see `docs/references/build-test-release.md`.

## Where things live

| Path | What it holds |
| --- | --- |
| `artifact-types/<type>/` | One self-contained skill per type: `SKILL.md`, an `artifact-type.json` manifest, and a `reference/` folder of guides (`page` keeps its references under `artifact-type/`). Built `scripts/` are generated. |
| `packages/` | The platform — `daemon`, `shell`, `protocol`, `runtime`, `type-server`, `harness-kit`, the `host*` packages — with a `<type>-core` / `<type>-editor` pair for each type that has an editor, plus the shared UI, canvas and export kits. |
| `plugins/<app>/` | The plugin for one agent app: its README, hooks, monitors and assets. The harness profiles they run on are in `packages/daemon/harnesses/`. |
| `skills/open-artifact/` | The one `/open-artifact` skill, for agents no plugin covers. `SKILL.md` there is generated — never edit it by hand. |
| `docs/` | Bilingual user and agent guides: `docs/types/<type>.md` and `.zh-CN.md`, `docs/integrating*`, and the contributor references in `docs/references/`. |
| `examples/` | Runnable agent-app integrations (`harness-node`, `harness-electron`, `harness-stdio`) and host plugins. |
| `e2e/` | End-to-end suites that drive the built types over the CLI and Chrome DevTools Protocol. |

Start with `docs/references/architecture.md` and `docs/references/artifact-types.md` for how the pieces fit, and open the
topic you are touching rather than reading all of them.

## Documentation is part of the change

Whenever you add, remove or change something a person or an agent can see, update its documentation **in the same
pull request**, in English (`*.md`) and Simplified Chinese (`*.zh-CN.md`). The table in
[`AGENTS.md`](AGENTS.md#documentation-sync-rule-mandatory) says which files a given kind of change touches;
[`docs/references/docs-maintenance.md`](docs/references/docs-maintenance.md) has the full checklist and the writing
conventions. A PR whose code and docs disagree is not ready.

## Commits and pull requests

- One thing per commit. Write the subject as an English imperative — `Fix …`, `Add …` — and use the body for the why
  when it is not obvious from the diff.
- We tend to prefix pull request titles with a scope: `fix(design): …`, `feat(dsh): …`, `docs: …`. It is a habit, not
  a rule.
- Every pull request body needs a **Verification** section: the commands you ran and their real numbers, for example
  `` `npm run check` 5005 tests: 5004 pass, 1 skipped ``. "Should work" is not a verification. Changes to a page need a
  screenshot.
- Reference the issue you are fixing, and keep the diff to what the change needs — an unrelated reformat costs a review
  round.

## Version numbers and CHANGELOG belong to a release

Do not raise versions or edit `CHANGELOG.md` in a pull request, however big it is. Every `@open-artifact/*` package,
every plugin manifest and the marketplace manifests share one version, and they are raised together at release time by
the maintainer. The flow is in [`README.md`](README.md#releasing), with the details in
`docs/references/build-test-release.md`.

## Tests

- Changing `packages/*` — add or update the `*.test.ts` next to it and run `npm test` (or `npm run check` for the whole
  gate).
- Changing a type — the suite for it is `e2e/<type>.test.mjs`; run `npm run e2e -- --only <type>` after a build. Without
  Chrome in the way, `--no-browser` still covers the CLI and file side.
- `npm test` points `OPEN_ARTIFACT_HOME_WORKSPACE` at a temporary folder through `scripts/test-env.mjs`, so a test never
  writes into your own `~/OpenArtifact`. Run a single file with the same preload
  (`node --import ./scripts/test-env.mjs --test <file>`).
- Changes to `apps/desktop/` are checked from that folder (`npm run check` there); it is not part of the root `npm test`.

## Platform notes

- Development and verification happen mainly on macOS, and the desktop app is macOS-only for packaging and signing
  (`apps/desktop/RELEASING.md`).
- On Windows or Linux, `npm run check` can hit failures that have nothing to do with your change. Say so in the PR body,
  name the test, and leave the assertion alone — an unrelated test loosened to get green is worse than a known failure.
- On Windows, check the repository out with LF endings (`git config core.autocrlf false`). Parts of the suite compare
  generated text with a file on disk — `packages/protocol/test/skill.test.ts` is one — so a CRLF checkout fails them over
  nothing but `\r\n`. If a few `bin/` entry points show as modified while `git diff` is empty, that is the build having
  written LF; `git checkout -- <path>` clears it.

## Getting help

Open an [issue](https://github.com/JimLiu/open-artifact/issues) — the templates ask for your client, its version and
`open-artifact doctor --harness <name>`, which is usually enough to place a problem. For "how do I…" questions the
bilingual guides in [`docs/`](docs/README.md) answer most of them.

## License

Apache-2.0 — see [`LICENSE`](LICENSE). Copyright and attribution are in [`NOTICE`](NOTICE). By contributing you agree
that your work is licensed under the same terms.
