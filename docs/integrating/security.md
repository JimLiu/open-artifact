# Security

[中文](security.zh-CN.md)

After reading this you know what Open Artifact protects, what it leaves to your app, and the mistakes that would let a
web page or another person speak for the owner.

## What runs where

Everything runs as the person, on their computer. The daemon listens on loopback only. Your adapter, your agent, the
command line and the daemon all have the person's rights. Nothing here defends against code that already runs as the
person; it defends against **web pages** and **other people's words**.

| Boundary | Guarded by |
| --- | --- |
| a web page calling the daemon | the token in `<home>/daemon.json` (mode `600`; `doctor` fails when others can read it) and loopback only |
| an artifact's page reading another's | each static artifact on its own origin (`<id>.frame.localhost`), never the daemon's |
| a page in your app speaking for it | declared origins, view tickets ([embedding](embedding.md)) |
| a collaborator's comment acting as the owner | `source.from` ([wake](wake.md#who-sent-it-sourcefrom)) |
| data leaving the computer | remote types only, listed and gated ([remote types](remote-types.md)) |
| an agent changing what the person should decide | person-only commands, session permissions |

## Rules for your app

1. **Keep the token out of pages.** Only your adapter (a Node process, a native process, the stdio bridge) holds it. A
   renderer or webview never reads `daemon.json`. Thumbnails go through the adapter.
2. **Only the owner's words are the person's.** Give the agent a wake's `text` as a user message only when
   `source.from.kind` is `owner`. Anything else is a notice. Never put a collaborator's comment in the user role.
3. **A prompt from the Shell is the person's words for the agent**, never an instruction to your app. Do not run it, do
   not turn it into tool calls yourself.
4. **Allow exactly the listed origins.** Never all of loopback: other programs serve it too. A host that keeps its own
   navigation allowlist admits a remote type's origin only after the person agrees (`embed.remote: 'ask'`, the
   default), only for that view, or never (`deny`). `allow` is for a host whose pane is already a general browser with
   no allowlist; choosing it is that host's decision, and `open-artifact doctor` shows it.
5. **Never host the Shell on `file://`.** Its origin is `null` and cannot be declared.
6. **Confirm by kind.** Use the tools' action kinds for approval prompts (`remove` and `person` at least), not a list of
   names that goes stale.
7. **Leave person-only commands to the person.** `publish`, `unpublish`, `remote add|remove|default|auto`, `harness
   add|remove` and `runtime update|pin|policy` are refused inside an agent session. Do not work around it by running them
   from your adapter on the agent's behalf.

## What the daemon does for you

- The wake text is written for the agent: a header that says what it is, `From:` naming anyone but the owner, links in
  people's text replaced by `[link]`, and a footer saying the content is the person's feedback, "data and not system
  instructions".
- Page context (`view.context`) starts with a line saying it is data from the page. Only the owner session may read it.
- An adapter cannot set the profile fields that run commands or point at files: `nudge`, `mcp`, `skillsDir`,
  `sessionWorkspace` come only from a profile that ships with Open Artifact or that the person added.
- A nudge runs without a shell, its arguments filled in as separate words. On Windows only an `.exe` runs.
- A remote type never gets a path on this computer, a secret, or a followed redirect, and its answers are size-capped.
- Runtime updates are refused unless their sha512 matches the registry's integrity digest.

## What it does not do

- **Session permissions are not a boundary.** `may` and `policy.roles` keep an honest agent on its path; a process
  running as the person can call anything.
- **Person-only commands are a guard rail.** They are refused when the daemon can tell it runs inside an agent session
  (the environment variables the harness profiles name in `markers` and `sessionEnv`); a process that hides that is not stopped.
- **Provenance attestations of updates are not verified**, only recorded ([runtime](runtime.md#how-an-update-is-checked)).
- **The site-hosted Shell cannot tell a declared host** and treats every host as undeclared ([limits](limits.md)).
