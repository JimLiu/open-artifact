# Contributing to Open Artifact

[简体中文](CONTRIBUTING.zh-CN.md) · English

Thanks for helping. Bug reports, fixes, a wrong line in a guide and a plugin for the agent app you use are all welcome.
What Open Artifact is and how to install it is in the [README](README.md); this page is about changing it.

## Set up

You need **Node.js 22.18 or later** (`engines` in `package.json`). Rust is only needed when you change a crate in
`crates/` (its output is committed), and Chrome only for the end-to-end tests.

```bash
npm ci
npm run build
npm run check
```

Run them in this order: some unit tests read what the build wrote, so `npm run check` before a build fails for
reasons that have nothing to do with your change.

[AGENTS.md](AGENTS.md) lists every command (partial builds, `npm run e2e`, the desktop app) and what lives where. The
references in [`docs/references/`](docs/references/) explain the architecture, the artifact types and the build; open
the one for the part you are changing.

## Making a change

- **Docs go with the change.** Anything a person or an agent can see that you add, remove or change is documented in
  the same pull request, in English (`*.md`) and Simplified Chinese (`*.zh-CN.md`). The
  [table in AGENTS.md](AGENTS.md#documentation-sync-rule-mandatory) says which files a kind of change touches.
- **Tests go with the change.** A change in `packages/*` updates the `*.test.ts` next to it. A change to a type runs its
  suite after a build: `npm run e2e -- --only <type>`.
- **Leave versions and `CHANGELOG.md` alone.** All packages and plugins share one version, raised at release time.

## Pull requests

- One change per pull request, with the issue it fixes linked.
- Say what changes for the person or agent using it, then what you changed.
- List the commands you ran and what they reported. A change people can see comes with a screenshot; a fix, with one
  before and one after.
- The Check workflow builds and runs `npm run check` on every pull request. On a first pull request it starts once a
  maintainer approves it.

## Windows

Check the repository out with LF line endings (`git config core.autocrlf false` before cloning). Some tests compare
generated text with files on disk, and a CRLF checkout fails them.

## Reporting a bug

Use the [bug form](https://github.com/JimLiu/open-artifact/issues/new/choose). It asks for the agent app and its
version, the artifact type and the steps; the output of `open-artifact doctor --harness <name>` helps place most setup
problems.

## License

Open Artifact is Apache-2.0 ([LICENSE](LICENSE), [NOTICE](NOTICE)). What you contribute is licensed the same way.
