# Open Artifact for Pi

[中文](README.zh-CN.md)

Slide decks, design canvases, whiteboards, spreadsheets, data dashboards, docs, animated films and design systems as
folders of files that open in one local page where you view, edit and comment, made by
[Pi](https://pi.dev). Type `/open-artifact slides a 6-slide pitch for this repo` (or `design …`, `whiteboard …`,
`sheets …`, `data …`, `docs …`, `motion …`, `page …`).

This is a Pi package (`pi-open-artifact`) with one extension. It is a full adapter (L3) over the Harness API, built on
`@open-artifact/harness-kit`, and it carries the Open Artifact runtime (`@open-artifact/cli`).

## Install

Pi (tested with 1.6.1) on Node.js 22.19 or later, as Pi needs.

```bash
pi install npm:pi-open-artifact
```

From a source checkout of this repository, after `npm ci`, `npm run build` and `node scripts/build-skill.mjs` (the
runtime the extension starts):

```bash
pi install ./plugins/pi
```

To try it for one run without installing it, use `pi -e ./plugins/pi`. Upgrade with `pi update --extensions`.

## What it gives Pi

| Part | Does |
| --- | --- |
| Tools `Artifact`, `ArtifactData`, `ArtifactComments` | Registered as Pi tools with the daemon's own schemas. Each call names the Pi session, so the artifacts it makes belong to that session. A daemon error fails the call, and its text keeps everything the daemon said (a conflict's current files included). Esc stops waiting for a call; nothing else times a call out. |
| Comments and requests from the page | They reach the session that owns the artifact right away. Your own words become a user message: a new turn when Pi is idle, steered into the running turn otherwise. A collaborator's comment or a system message (a background task's result) becomes an `open-artifact` custom message that the model reads and that is never taken for your words; it wakes an idle Pi the same way. What was sent while the session was closed comes when you open it again (`pi --resume`). |
| System prompt | The always-on Open Artifact prompt, as its own `<open_artifact>` section of Pi's system prompt. |
| Skill `open-artifact` | Rendered for Pi (native tools, pages in the computer's browser) into `~/.open-artifact/skills/pi/` and given to Pi on start. `/skill:open-artifact` loads it. |
| Command `/open-artifact <type> <what to make>` | Runs the skill with your request, with the installed types as completions. |
| Session state | `running` while Pi works and `idle` when it has settled, so pages say whether the agent is busy. Files Pi's own `write` and `edit` tools change are reported (`agent.wrote`), so an open page follows at once. |

Pi has no page view of its own: `Artifact {action: "open"}` opens the page in the computer's browser, and the agent
gives you its `view_url` too.

## How it starts the daemon

A Pi session that never makes an artifact starts nothing. When a daemon already runs at session start, the session
connects and attaches, so comments reach it. Otherwise the first Open Artifact tool call starts the newest compatible
runtime on this computer (this package's `@open-artifact/cli` is one) and connects. A reconnect attaches the session
again. `/new`, `/resume`, `/fork` and `/reload` close the old session's connection, and the new session makes its own.

The daemon's profile for Pi is `packages/daemon/harnesses/pi.json` (harness `pi`). Pi's shell commands carry
`PI_CODING_AGENT` and `PI_SESSION_ID`, so an `open-artifact` command the agent runs is known as Pi's, and the commands
that are the person's (publishing, sites) refuse to run there.

Set `PI_OPEN_ARTIFACT_DEBUG=1` to have the extension write what it does to stderr. To check a running session, run
`open-artifact doctor --harness pi --session <id>` (the session id is Pi's `/session`).

## Build and test

There is nothing to build: Pi loads `src/index.ts` as it is. Pi's API is declared in `src/pi.ts`, so the package
depends on no copy of Pi.

```bash
node --test plugins/pi/test/*.test.ts   # against a fake Pi and the kit's fake daemon (part of npm test)
npm run e2e -- --only pi --no-browser   # the real pi against a real daemon, with a scripted local model
```

The e2e suite needs `pi` on `PATH`; it uses a temporary Pi agent folder, so your own Pi settings and sign-ins are not
read. See [e2e/README.md](../../e2e/README.md).
