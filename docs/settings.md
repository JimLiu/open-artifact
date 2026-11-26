# Settings, and where artifacts are kept

[中文](settings.zh-CN.md)

An artifact is a folder on your disk. This page says where a new one goes, how you choose, and where Open Artifact
keeps its settings: one file of your own, and an optional file in a project.

## Where a new artifact goes

When the agent's call names no folder, Open Artifact picks one and names it from the title:

| Location | Folder | What it means |
| --- | --- | --- |
| `home` | `~/OpenArtifact/<project>/<slug>` | Under your **Open Artifact folder**, one folder per project. Nothing lands in the repository, so `git status` stays clean, and the artifacts outlive a deleted checkout or worktree. |
| `workspace` | `<session's folder>/artifacts/<slug>` | In the folder the agent works in. The artifacts sit beside the code and can be committed with it. |

Which one applies, when nothing is set:

| The session's app | Default | Why |
| --- | --- | --- |
| Claude Code, Codex, Cursor, GitHub Copilot, Antigravity, ZCode, DeepSeek Harness | `workspace` | In their usual modes the ones that were measured ask before, or refuse, a write outside the working folder ([below](#let-your-app-write-to-the-open-artifact-folder)); the others are kept the same until they are measured. |
| ChatGPT on the web (`open-artifact chatgpt`) | `workspace` | The connector tells its artifacts apart by their path. |
| Pi, the `open-artifact` command line, any app without a profile | `home` | Nothing stops the write. |
| An app that starts the daemon with `OPEN_ARTIFACT_WORKSPACE_FOLDERS_ONLY=1` | `workspace`, always | A confined daemon keeps every folder in the workspace; no setting or call changes that. |

When an app's default puts artifacts in a Git checkout and Open Artifact has to make the `artifacts/` folder, it also
writes `artifacts/.gitignore` (one line, `*`), so the artifacts stay out of `git status`. Delete that file to track
them. A folder that was already there, or one that you, the project or the call chose, gets no `.gitignore`: there the
artifacts are meant to be seen by git.

Artifacts you make on the home page (no session) go to `~/OpenArtifact/artifacts/<slug>`, as before.

### The Open Artifact folder

```text
~/OpenArtifact/
├── artifacts/                     made on the home page
│   └── reading-list/
├── shop/                          the project ~/code/shop
│   ├── .open-artifact-project.json
│   ├── launch-plan/
│   └── q3-review/
└── app-3f9c/                      a second project whose folder is also called "app"
```

- **A project** is the Git checkout the session works in (its top folder), whichever folder inside it the agent
  started in. Every worktree of a repository is the same project. A folder in no checkout is its own project. A folder
  with a project settings file ([below](#the-projects-file)) is a project too, which is how a package of a monorepo
  gets its own.
- A project's folder is named after the project's folder. `.open-artifact-project.json` says which project it holds;
  when two projects have the same name, the second gets a few digits of a hash of its path (`app-3f9c`), the same ones
  every time.
- The folder itself is `homeWorkspace` in your settings (`open-artifact config set homeWorkspace ~/Documents/Artifacts`).

"This project's artifacts" (what `Artifact {action: "list"}` shows a session, and what `quickstart` offers to reuse) are
the ones made for the project, wherever their folders are, plus any whose folder is inside the session's folder.

### Choosing

| You want | Do |
| --- | --- |
| One artifact somewhere else | Tell the agent: "put it in the project" or "put it in my Open Artifact folder". It passes `location: "workspace"` or `location: "home"`. Name an exact path and it passes `folder`. |
| Everything in your Open Artifact folder | `open-artifact config set artifactsLocation home`, and [let your app write there](#let-your-app-write-to-the-open-artifact-folder). |
| Everything in the workspace, visible to git | `open-artifact config set artifactsLocation workspace` |
| One project differently, for you only | In the project: `open-artifact config set artifactsLocation home --local` |
| One project the same way for everyone | In the project: `open-artifact config set artifactsLocation workspace --project`, then commit `.agents/open-artifact/settings.json` |
| Back to the default | `open-artifact config unset artifactsLocation` (with `--local` or `--project` for those) |

Nothing that exists moves: a setting decides where the **next** artifact goes, and every artifact made before stays
where it is and stays in its project's list.

## Let your app write to the Open Artifact folder

An agent writes an artifact's files with its own file tools. Most agent apps limit those to the working folder, which
is why their default is `workspace`. To use `home` with such an app, add the Open Artifact folder to the folders it may
write:

| App | Setting | Measured |
| --- | --- | --- |
| Claude Code | `claude --add-dir ~/OpenArtifact`, or `"permissions": {"additionalDirectories": ["/Users/you/OpenArtifact"]}` in its settings | 2.1.318: with it, `acceptEdits` writes there without asking. `auto` needs nothing. |
| Codex | `codex --add-dir ~/OpenArtifact`, or `sandbox_workspace_write.writable_roots = ["/Users/you/OpenArtifact"]` in `config.toml` | 0.171.0-alpha: without it, `workspace-write` refuses the write. |
| GitHub Copilot CLI | `copilot --add-dir ~/OpenArtifact` | 1.0.114: without it, the write waits for your approval. |
| Cursor CLI | None found: `--add-dir` does not lift it. `--force` allows every write. | 2026.11.13 |
| Pi | Nothing to set. | 1.6.1 |

These were measured on macOS, in each app's headless mode. Not measured: Antigravity, ZCode, DeepSeek Harness, the
apps' interactive prompts, the Cursor editor, the Claude desktop app, Windows and Linux. Open Artifact never changes
another app's permission settings for you.

When an artifact's folder is outside the agent's working folder, the create result says so. An agent that cannot
write there can still fill the artifact: `Artifact {action: "publish", url, files: {...}}` has the daemon write the
files.

## The settings files

### Your file

`~/.agents/open-artifact/settings.json` (`$OPEN_ARTIFACT_HOME/settings.json` when that is set) holds your settings for
every app and project on this computer. Only what you changed is in it. The keys about where artifacts go:

| Key | Default | Means |
| --- | --- | --- |
| `artifactsLocation` | unset | `home` or `workspace`. Unset: the app's default, as in the table above. |
| `artifactsDir` | `artifacts` | The folder's name under a workspace, and for home-page artifacts under the Open Artifact folder. |
| `homeWorkspace` | `~/OpenArtifact` | Your Open Artifact folder. `OPEN_ARTIFACT_HOME_WORKSPACE` sets it when the file does not. |
| `projects` | unset | Your own settings for single projects, by the project's folder: `{"~/code/shop": {"artifactsLocation": "home"}}`. Written by `config set --local`. An `artifactsDir` here is relative to the project's folder. |

Its other keys (types, trusted projects, sites, the port, the runtime) have commands of their own: see
[Making your own artifact types](custom-types.md), [Connecting your computers and agents](connecting-agents.md) and
[Runtime and updates](integrating/runtime.md). An install preset (`preset.json`) is a different thing: it gives a
computer its site at install time and sets nothing on this page.

### The project's file

`<project>/.agents/open-artifact/settings.json`, beside the project's types (`.agents/artifact-types/`). Commit it, and
everyone who works in the repository gets the same answer. It may set two keys:

| Key | Means |
| --- | --- |
| `artifactsLocation` | `home` or `workspace`, for sessions in this project. |
| `artifactsDir` | Where the project keeps its artifacts: a path relative to the folder the file is in, and inside it (`docs/artifacts`). |

```json
{ "artifactsLocation": "workspace", "artifactsDir": "docs/artifacts" }
```

Every other key in that file is ignored. A repository is something anyone may have written: it does not get to trust
itself, move your Open Artifact folder, add a site or turn publishing on. `open-artifact config list` names the keys it
ignored.

Open Artifact looks for the file from the session's folder upward to the top of the Git checkout, and uses the nearest
one. It does not look above the checkout, nor in a folder with no checkout around it other than the session's own, and
it never takes your own settings file for a project's. (A project's **types** are still looked for in the session's
folder only: see [custom types](custom-types.md).)

### Which wins

Highest first:

1. The call: `folder` (an exact path), then `location`.
2. A confined daemon (`OPEN_ARTIFACT_WORKSPACE_FOLDERS_ONLY=1`): the workspace.
3. Your entry for the project (`projects`, `config set --local`).
4. The project's file.
5. Your `artifactsLocation`.
6. The app's default (its harness profile's `policy.artifacts`).
7. `home`.

## `open-artifact config`

```bash
open-artifact config                          # what is in effect here, as JSON: each value and who set it
open-artifact config get artifactsLocation    # one value
open-artifact config set artifactsLocation home             # in your settings.json
open-artifact config set artifactsLocation home --local     # yours, for this project only
open-artifact config set artifactsDir docs/artifacts --project   # in this project's settings file
open-artifact config unset artifactsLocation [--local | --project]
```

- **Keys:** `artifactsLocation`, `artifactsDir`, `homeWorkspace`, `serverPort`. `--project` and `--local` take the first
  two.
- **Which project:** the one the current folder is in; `--workspace <dir>` names another. `--harness <name>` makes
  `list` and `get` answer for that app's sessions (`--harness claude-code`).
- `list` gives each value a `source`: `local` (you, for this project), `project` (its file), `user` (you),
  `environment`, `harness` (the app's default) or `default`. `project.ignored` lists the keys of the project's file
  that are not used.
- `set` and `unset` go through the daemon, so it uses the change at once. After editing a file by hand, restart it:
  `open-artifact daemon restart`.
- **Only you change settings.** Inside an agent's session `config set` and `config unset` are refused, as trusting a
  project or publishing is; `list` and `get` work anywhere. `--project` removes the file when nothing is left in it.

## Check it: `open-artifact doctor`

```bash
open-artifact doctor --harness claude-code      # in the project; --workspace <dir> names another folder
```

Among its checks, four are about this page:

| Check | Says |
| --- | --- |
| `home-workspace` | Your Open Artifact folder, and whether it can be written (not made yet is fine). Fails when it cannot. |
| `artifacts-location` | Where a session of that app in this folder keeps new artifacts, and who chose it. When that is your Open Artifact folder and the app keeps its agent to the working folder (Claude Code, Codex, Copilot CLI, Cursor), a warning with the setting to add. For Claude Code and Codex doctor reads the app's own settings (`~/.claude/settings.json` and the project's `.claude/settings*.json`; `~/.codex/config.toml`) and says ok when they already allow the folder; it cannot see a `--add-dir` given on the command line. |
| `project-settings` | The project's settings file and what it sets; a warning naming the keys that are not used, or a file that is not a JSON object; and your own entry for the project. |
| `settings-projects` | A warning for entries of `projects` in your settings whose folder is gone, or that are not named by an absolute path. |

doctor only reads: it changes neither your settings nor another app's.

## For agents

- Do not make up a folder. Leave `folder` out: the daemon chooses it and names it from the title.
- The person asks for the project ("in the repo", "commit it with the code"): `location: "workspace"`. For their Open
  Artifact folder: `location: "home"`. For an exact path: `folder`. A workspace-confined app refuses `location: "home"`
  (`not_granted`).
- The create result's `root` is where the files go. When it is outside your working folder the result's `notes` say
  so: tell the person where the folder is, and if your app does not let you write there, send the files with
  `Artifact {action: "publish", url, files}`.
- Never run `open-artifact config set` yourself, and do not edit either settings file to change where artifacts go.
  Tell the person the command.
