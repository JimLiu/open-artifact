# Open Artifact for Antigravity

For Google Antigravity (the `agy` CLI and the Antigravity app). Slide decks, design canvases, whiteboards, spreadsheets, data dashboards, docs, animated films and design systems as
folders of files that open in one local page where you view, edit and comment: `/open-artifact slides …`,
`design …`, `whiteboard …`, `sheets …`, `data …`, `docs …`, `motion …` or `page …`. Needs Node.js 22.18+.

## Install

Download `open-artifact-plugins.zip` from [GitHub Releases](https://github.com/JimLiu/open-artifact/releases),
extract it and install the `antigravity/` folder.

```bash
agy plugin install "/path/to/open-artifact-plugins/antigravity"
```

For a manual install, copy that folder to `~/.gemini/config/plugins/open-artifact/`. Restart Antigravity to load
the MCP server. Antigravity asks you to allow each Open Artifact tool call until you choose to always allow it.

## Upgrade

Install the `antigravity/` folder from the new ZIP with the same command. For a manual install, replace the entire
`~/.gemini/config/plugins/open-artifact/` folder, retaining the installed folder name `open-artifact`. Restart
Antigravity and start a new conversation.

## Where artifacts go

New artifacts go in the folder Antigravity works in: `artifacts/<slug>`. In a Git checkout the daemon adds
`artifacts/.gitignore` when it makes that folder, so they stay out of `git status` (delete the file to track them).

To keep them under your own Open Artifact folder instead (`~/OpenArtifact/<project>/<slug>`), run
`open-artifact config set artifactsLocation home` in your terminal. Whether Antigravity lets its agent write outside the
working folder was not measured; when it does not, the agent sends the files through the daemon. See
[Settings](../../docs/settings.md).

## What it adds

- `mcp_config.json`: the `Artifact`, `ArtifactData` and `ArtifactComments` tools (stdio, through the local daemon),
  namespaced by Antigravity as `open-artifact_open-artifact`;
- `skills/open-artifact/`: the skill, carrying the daemon;
- `hooks.json`: `SessionStart`, `PreInvocation` and `Stop`.

## Recommended with Gemini models: `gemini-frontend-design`

For design work (`/open-artifact design …`: screens, landing pages, mockups) on a Gemini model, pair this plugin with
Google's [`gemini-frontend-design`](https://github.com/google-gemini/demolab/blob/main/skills/gemini-frontend-design/SKILL.md)
skill. It guides the model's visual direction, color, typography, layout and motion; the Design type's own skill
covers how a canvas and its artboards are written. Open Artifact does not ship it: it lives in Google's
[`google-gemini/demolab`](https://github.com/google-gemini/demolab) repository (Apache-2.0), so install it from
there, following that repository's README:

```bash
agy plugin install https://github.com/google-gemini/demolab
```

```bash
npx skills add google-gemini/demolab --skill gemini-frontend-design
```

The first installs the whole demolab plugin in Antigravity, the second only this skill. Once it is installed the
agent uses both together; where they differ on the canvas's files or on checking the result, the Design type's
rules apply. Without it everything still works: the agent mentions the link once before it starts a design, so you
can install it first, and goes on without it unless you say otherwise.

## Publish to a server

The plugin has no setting for it. Put the site in `~/.agents/open-artifact/preset.json`
(`{ "OPEN_ARTIFACT_REMOTE": "https://artifacts.example.com" }`), or link one yourself with
`open-artifact remote add <name> <https://host>`. See [the plugins README](../README.md#use-a-server-instead-of-this-computer).

## Send to agent

Comments sent from the page reach the agent at session start, before its next model call (`PreInvocation`, so also
in the middle of a turn), or, when they arrive as it finishes, by keeping it going (`Stop` with
`decision: "continue"`). The hooks add them as system messages.

While the conversation is idle, the daemon starts a turn in it with the app's own command line
(`agentapi send-message <conversation> <text>`, found at `~/.gemini/antigravity/bin/agentapi`, or set
`OPEN_ARTIFACT_ANTIGRAVITY_AGENTAPI`), pointed at the running app by its hub file in
`~/.gemini/antigravity/daemon/`; that turn's hooks then hand over the comments. When the app is not running, the
comments wait for the conversation's next turn.
