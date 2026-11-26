# Open Artifact for OMP

[中文](README.zh-CN.md)

Slide decks, design canvases, whiteboards, spreadsheets, data dashboards, docs, animated films and design systems as
folders of files that open in one local page where you view, edit and comment, made by
[OMP](https://omp.sh). Type `/open-artifact slides a 6-slide pitch for this repo` (or `design …`, `whiteboard …`,
`sheets …`, `data …`, `docs …`, `motion …`, `page …`).

This is an OMP package (`omp-open-artifact`) with one extension. It is a full adapter (L3) over the Harness API, built
on `@open-artifact/harness-kit`, and it carries the Open Artifact runtime (`@open-artifact/cli`).

## Install

OMP (tested with 19.2.1) on Bun 1.4.4 or later, as OMP needs.

```bash
omp plugin install npm:omp-open-artifact
```

Then start a new OMP session.

From a source checkout of this repository, after `npm ci`, `npm run build` and `node scripts/build-skill.mjs` (the
runtime the extension starts):

```bash
omp plugin install ./plugins/omp
```

To try it for one run without installing it, use `omp -e ./plugins/omp`. Upgrade with `omp plugin upgrade`.

## What it gives OMP

| Part | Does |
| --- | --- |
| Tools `Artifact`, `ArtifactData`, `ArtifactComments` | Registered as OMP tools with the daemon's own schemas, `essential` so they stay in the top-level tool list. Each call names the OMP session, so the artifacts it makes belong to that session. A daemon error fails the call, and its text keeps everything the daemon said (a conflict's current files included). Esc stops waiting for a call; nothing else times a call out. |
| Comments and requests from the page | They reach the session that owns the artifact right away. Your own words become a user message: a new turn when OMP is idle, steered into the running turn otherwise. A collaborator's comment or a system message (a background task's result) becomes an `open-artifact` custom message that the model reads and that is never taken for your words; it wakes an idle OMP the same way. What was sent while the session was closed comes when you open it again (`omp --resume`). |
| System prompt | The always-on Open Artifact prompt, added on `before_agent_start` to the system prompt OMP sends. |
| Skill `open-artifact` | Rendered for OMP (native tools, pages in the computer's browser) into this package's `skills/` folder, which OMP scans as an extension package; it is rewritten with the installed types once the daemon answers. `/skill:open-artifact` loads it. |
| Command `/open-artifact <type> <what to make>` | Sends the skill and your request as one user message, with the installed types as completions. OMP sends a message without expanding `/skill:`, so the command carries the skill text itself. |
| Session state | `running` while OMP works and `idle` when it has settled, so pages say whether the agent is busy. A loop stop inside a run (OMP's `willContinue`) stays `running`. Files OMP's own `write` and `edit` tools change are reported (`agent.wrote`), so an open page follows at once. |

OMP has no page view of its own: `Artifact {action: "open"}` opens the page in the computer's browser, and the agent
gives you its `view_url` too.

## Where artifacts go

New artifacts go under your own Open Artifact folder, one folder per project: `~/OpenArtifact/<project>/<slug>`. OMP
lets its agent write there, and the repository stays clean. To keep them in the project instead
(`<session's folder>/artifacts/<slug>`), run `open-artifact config set artifactsLocation workspace` in your terminal,
with `--local` for one project only. See [Settings](../../docs/settings.md).

## How it starts the daemon

An OMP session that never makes an artifact starts nothing. When a daemon already runs at session start, the session
connects and attaches, so comments reach it. Otherwise the first Open Artifact tool call starts the newest compatible
runtime on this computer (this package's `@open-artifact/cli` is one) and connects. A reconnect attaches the session
again. `/new`, `/resume` and `/fork` change the session id in place: the extension detaches the old id and attaches
the new one on the same connection. `/reload` keeps the session.

The daemon's profile for OMP is `packages/daemon/harnesses/omp.json` (harness `omp`). OMP's bash-tool commands carry
`OMP_BASH_SESSION` (the session id), so an `open-artifact` command the agent runs through its bash tool is known as
OMP's, and the commands that are the person's (publishing, sites) refuse to run there. OMP's `eval` `sh()` does not
set it: a command run there is not seen as OMP's.

Set `OMP_OPEN_ARTIFACT_DEBUG=1` to have the extension write what it does to stderr. To check a running session, run
`open-artifact doctor --harness omp --session <id>` (the session id is in `OMP_BASH_SESSION` in a bash-tool command
OMP runs).

## Build and test

There is nothing to build: OMP loads `src/index.ts` as it is. OMP's API is declared in `src/omp.ts`, so the package
depends on no copy of OMP.

```bash
node --test plugins/omp/test/*.test.ts   # against a fake OMP and the kit's fake daemon (part of npm test)
```

The suite checks the four differences from the Pi adapter: the system prompt goes back from `before_agent_start`, the
skill is written where OMP scans extension packages, `/open-artifact` sends the skill text itself, and `agent_end`
(not `agent_settled`) says the session is idle.

A session connected to the daemon rewrites `skills/open-artifact/SKILL.md` with your installed types, which dirties a
checkout. `node scripts/build-skill.mjs` (or the command that generated it) restores the tracked file.
