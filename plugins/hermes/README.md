# Open Artifact for Hermes Agent

[中文](README.zh-CN.md)

Slide decks, design canvases, whiteboards, spreadsheets, data dashboards, docs, animated films and design systems as
folders of files that open in one local page where you view, edit and comment, made by
[Hermes Agent](https://github.com/NousResearch/hermes-agent). Ask for one in any Hermes chat (the CLI, or a messaging
platform through the gateway), or type `/open-artifact slides a 6-slide pitch for this repo`.

This is a Hermes plugin written in Python (standard library only). It is a full adapter (L3) that speaks the Harness API
over `open-artifact harness --stdio --harness hermes`, the path for hosts that are not written for Node
([Integrating](../../docs/integrating.md)).

## Install

Hermes Agent with plugin support, Python 3.9 or later, and Node.js 22.18 or later. The `hermes/` folder in the
release's `open-artifact-plugins.zip` carries the Open Artifact runtime (`skills/open-artifact/`), and the plugin runs
it with the `node` on the PATH, so nothing else needs installing. A folder without it (this one, in a source checkout)
runs the `open-artifact` command on the PATH (`npm install -g @open-artifact/cli`). `OPEN_ARTIFACT_CLI` overrides both.

```bash
# 1. The plugin: link the extracted hermes/ folder as ~/.hermes/plugins/open-artifact
ln -s /path/to/open-artifact-plugins/hermes ~/.hermes/plugins/open-artifact
hermes plugins enable open-artifact

# 2. Let it start turns in gateway sessions (comments from the page do that)
hermes config set plugins.entries.open-artifact.allow_gateway_injection true

# 3. The skill, rendered for Hermes's native tools, with the runtime the folder carries
node ~/.hermes/plugins/open-artifact/skills/open-artifact/scripts/open-artifact.mjs skill install --command open-artifact --dir ~/.hermes/skills --harness hermes
```

From a source checkout, link `plugins/hermes` instead and run step 3 as `open-artifact skill install …` with the
same arguments.

A running gateway picks the plugin up when it is enabled; sessions opened before that see the tools from their next
session on. Without step 2 the tools still work, and comments wait for the session's next turn.

## What it gives Hermes

| Part | Does |
| --- | --- |
| Tools `Artifact`, `ArtifactData`, `ArtifactComments` | Registered as Hermes tools (toolset `open_artifact`) with the daemon's own schemas (`schemas.json`, refreshed from `tools.list` when the bridge connects). Each call names the calling Hermes session (its session key) and its folder, so the artifacts it makes belong to that session. A session's first call attaches it; what waited for it comes back in that call's `messages`. |
| Comments and requests from the page | In the gateway they reach the session that owns the artifact right away (`wake.deliver`). Only the owner's own words become a user turn (`ctx.inject_message`, a new turn when the session is idle, queued behind the running one otherwise). A collaborator's comment, a system message (a background task's result) or a message that says no sender is answered `failed`, so it stays in the daemon's inbox; the session's next turn reads it before the model call (`pre_llm_call`) under a line that says it is data, not the person's instructions. |
| Reconnects | The gateway keeps the bridge up and starts it again when it exits; the bridge reconnects to the daemon (starting it when needed) and attaches the sessions again. What a reattach brings for a session the plugin cannot hand on goes back with `inbox.return`; when that is not possible (the bridge is gone, or an older daemon), the plugin keeps it for the session's next tool result or turn. A tool call is never sent twice. Known sessions are kept in `~/.hermes/plugin_data/open-artifact/sessions.json` for 7 days, so a gateway restart attaches them again. |
| Session state | `running` before each model call, `idle` when the session ends. Files the agent's own `write_file` and `patch` tools change are reported (`agent.wrote`), so an open page follows at once. |

Outside the gateway (the classic CLI, a one-shot `hermes chat -q`, cron) nothing is started until a tool is called.
After that the process's bridge takes wakes too; the classic CLI queues the owner's words as your next input.

Hermes has no page view of its own: the agent gives you the page's `view_url`, or `Artifact {action: "open"}` opens it
in the computer's browser.

## Where artifacts go

New artifacts go under your own Open Artifact folder, one folder per project: `~/OpenArtifact/<project>/<slug>`
(`policy.artifacts: "home"`), so a repository stays clean. To keep them in the project instead, run
`open-artifact config set artifactsLocation workspace` in your terminal. See [Settings](../../docs/settings.md).

## The profile

The daemon's profile for Hermes is `packages/daemon/harnesses/hermes.json` (harness `hermes`). Hermes puts
`HERMES_AGENT` in every command its agent runs, so an `open-artifact` command the agent runs is known as Hermes's, and
the commands that are the person's (publishing, sites) refuse to run there.

The tools name a session by its Hermes session key (`HERMES_SESSION_KEY`, which the gateway, the TUI and ACP sessions
set). A classic CLI session has no key, and the tools use its session id instead.

Settings, all optional: `OPEN_ARTIFACT_CLI` (how to run the command line instead of the runtime the folder carries, e.g. `npx @open-artifact/cli`),
`OPEN_ARTIFACT_HERMES_AGENT_NAME` (what the Shell calls the agent, default `Hermes`), `OPEN_ARTIFACT_HERMES_DATA`
(where it keeps its sessions), `OPEN_ARTIFACT_HERMES_DISABLE` (load nothing). To check a session, run
`open-artifact doctor --harness hermes --session <session key or id>`.

## Known limits

- **Use the tools, not the command line.** The agent should make and change artifacts with the three tools. An
  `open-artifact` command it runs in a shell speaks for harness `cli` unless it passes `--harness hermes`; even then
  it names the session only where `HERMES_SESSION_KEY` is set (not in a classic CLI session). The daemon then takes
  it for another owner than the session's tools, and comments on what it made go there instead of into the chat. The
  skill rendered with `--harness hermes` says to use the tools.
- **No resume.** `caps.wake.resume` is `false`: a wake for a session that is no longer live (a finished
  `hermes chat -q`) waits in the inbox until that session calls a tool again.
- **Session keys are chat keys.** In the gateway a session key names a chat (a DM, a thread). A new conversation in the
  same chat (`/new`) keeps the key, so it keeps the chat's artifacts and their comments.
- **No pages in Hermes.** `host.open` is not answered: pages open in the browser, or as a link.

## Test

```bash
node --test plugins/hermes/test/hermes.test.mjs   # part of npm test; skipped, saying so, without python3
```

It checks `schemas.json` against the daemon's tool definitions and the plugin's hello against the shipped profile,
then runs the plugin in a fake Hermes gateway (`test/fake_gateway.py`) against a real daemon in a temporary
`OPEN_ARTIFACT_HOME`: the tools and hooks are registered, an artifact is made, the owner's Ask arrives live as a user
turn, a collaborator's never does, and a wake the host refuses is handed to the next turn as data.
