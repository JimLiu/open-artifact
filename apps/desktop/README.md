# Open Artifact Desktop

An Electron app that shows the local library's artifacts, with no agent attached: one window with a sidebar, a tab bar
and the library page (the home tab), and one sandboxed `WebContentsView` per artifact tab showing its Shell. There is
no server switcher, service status, update banner or settings dialog yet.

- It carries its own Open Artifact runtime (`resources/runtime`, a copy of the built `skills/open-artifact`) and starts
  the daemon with its own executable as Node (`ELECTRON_RUN_AS_NODE=1`), detached, so no Node.js has to be installed
  and the daemon keeps running after the app quits.
- It connects with `createHarness({ harness: 'open-artifact-desktop' })` from `@open-artifact/harness-kit`: no
  session, no wake, `embed: 'view'`. The daemon's token stays in the main process; pages get no Node, no preload and
  no bridge.
- A view may only show the daemon's origin and the page origins the daemon lists (`embed.origins`). Links to the web
  go to the system browser; new windows are denied; another artifact's Shell address opens a tab of its own; the
  daemon's home page goes to the first tab; the Shell's `close` closes the tab.

## The window

The window's page (`renderer/`, a React app bundled into `out/renderer/app.js`) draws the chrome and the home page:

- **Sidebar** (240 px, can be folded; the choice is kept in `<userData>/settings.json`): room for the macOS traffic
  lights, fold, back and forward over the tabs the person went to; New (the new dialog), Search (the library tab with
  its search field focused), Library; Pinned (foldable) and Recent (the 8 most recently changed artifacts that are not
  pinned), each with its type's colored icon. It follows the library's events.
- **Tab bar**: the Library tab first (it cannot be closed), then one tab per artifact (its type's color, title, close,
  a dot while it has unsaved work, reconnecting, stopped and "reload" states), and `+` for the new dialog. It scrolls sideways.
- **Home**: the shared `ArtifactsPage` of `@open-artifact/library-page`, with the page's own search and New buttons
  hidden (the sidebar has them) and its type tiles in two groups: types that start blank and open in their editor
  (`BUILTIN_START.blank`), and types an agent builds (`BUILTIN_START.agent`, made empty, the Shell shows the hand-over
  prompt). Thumbnails are taken by the main process in a hidden offscreen window of their own partition and shown
  through the `oa-thumbnail:` scheme; they are taken only while the window is on screen (or with `--thumbnails` in
  test mode).
- **New dialog**: the two groups (each type with its icon), a title field, Create and open; a failed create says the
  daemon's reason in the dialog, which stays open. With a folder chosen in Settings, the app names the new artifact's
  folder itself, as the daemon would: `<folder>/<slug of the title>`, `-2`, `-3`… past one that exists and is not
  empty (`src/folders.mjs`); without one the daemon decides (`<homeWorkspace>/<artifactsDir>/<slug>`).
- **Service status** (the first of the home page's heading tools, `headingTools`): a dot and the state (running,
  reconnecting, stopped, started elsewhere, failed) with how many apps are connected; it opens the service panel.
- **Service panel**: the daemon this app shares with the agent apps (its version, and whether it is the one the app
  carries; address and process; the profile folder), the apps connected with their sessions, the editors (type
  servers) running with a restart each (`types.restart`), the runtime and its updates, Restart and Stop (each asked
  first, naming the other apps it affects), Start or Connect, the logs folder, and `open-artifact doctor`. Stop is the
  kit's `daemon.stop()`: the app does not start the daemon again by itself, and says that the other apps may; it
  reads `daemon.json` every 1.5 s meanwhile, so when another app starts it again the panel says so and offers to
  connect. `doctor` and the runtime commands run with the app's own executable as Node (`ELECTRON_RUN_AS_NODE=1`)
  and the carried runtime's entry; no `node` needs to be installed.
- **Runtime updates**: the shared update panel at the top of the library (`PageUpdates`): Update and Later, then
  "It takes effect when the service restarts" with Restart now, which asks in the service panel as its Restart does.
  The service panel and Settings show the version running, the last check, a newer one and Check (the command line's
  `runtime status --json --check`). Nothing is offered or checked when updates are off for the computer or the
  person set `bundled`; no changelog link is shown (the runtime carries none).
- **Settings** (the sidebar's Settings at the bottom): General (the look, at once; the language, with "Reopen" when
  it changed), Artifacts (the folder new ones go to, chosen with the system's dialog), Service and updates (the
  service's state and its panel, the runtime and Check, the "check for updates" switch: on is `prompt`, off is
  `bundled`, written by the person-only `runtime policy`; shown read-only under `auto` or the computer's switch),
  Advanced (the profile folder with Show in Finder, the versions).

The page reaches the main process through a small preload bridge (`window.desktop`); every call checks that it came
from the window's own page. The Library API calls (list, update title or pinned, delete, restore, create, thumbnails)
are made by the main process with the daemon's token, which the page never sees; the page gets the library's events
forwarded.

## Look and language

Settings in `<userData>/settings.json`, beside the sidebar's fold state: the look (`theme`: `system`, `light`,
`dark`), the language (`locale`: `system`, `en`, `zh-CN`) and the folder for new artifacts (`artifactsFolder`: empty
for the library's default, else an absolute folder). The settings dialog reads and sets them through
`window.desktop.settings` (`get()`, `set(name, value)`, both answering the settings, what this run uses and
`restartNeeded`; `chooseFolder()` shows the system's folder dialog), and every state the page is sent carries them
(`settings`). A value that is not one of a setting's choices is refused, and one read from the file is the default.
`desktop.relaunch()` opens the app again with the same arguments, for a changed language.

They reach every page the app shows, the artifacts' Shells and their editors' frames too, through Chromium, with no
message to the Shell for it:

- **Look**: `nativeTheme.themeSource`, so `prefers-color-scheme` is the chosen one in every view and frame; the Shell
  is also told it in `host_hello` (it pins `data-theme` on its root and passes it on to the editor). It changes at once,
  in the open views as well.
- **Language**: Chromium's `--lang` (`zh-CN` or `en-US`; none for `system`), which sets `navigator.language`, what the
  Shell and the editors read, and the `Accept-Language` the pages send. It can only be given when the app starts, so a
  changed language takes effect when the app is opened again: until then the settings say `restartNeeded`. The app's
  own words follow the language Chromium runs with (`app.getLocale()`), so they always match the Shell's.

The Sheets editor's own View menu choice of a look (kept in that page's storage) still comes before the app's.

## Setup and build

At the repository root, build the runtime pieces first:

```bash
npm run build && node scripts/build-skill.mjs
```

Then in `apps/desktop`:

```bash
npm run setup    # npm install, then install-electron (Electron 45 downloads its binary only on this step)
npm run build    # copies the runtime into resources/runtime, bundles src/ and renderer/ into out/
```

## Running it in development

A development build (not packaged) always runs on a profile of its own. It refuses to start on the default home
(`~/.agents/open-artifact`) or on port 4800, so it never connects to, stops or replaces your own daemon:

```bash
npx electron . --home /tmp/oa-desktop/oa --port 4890 [--open <artifact id>]
```

`--home` (or `OPEN_ARTIFACT_HOME`) and `--port` (or `OPEN_ARTIFACT_PORT`) are both required. Electron's own folders
(user data, session data, logs, crash dumps) go under `<home>/desktop/`. The daemon started this way keeps running
after the app quits; stop it by the pid in `<home>/daemon.json` once the app is closed (while the app runs, it starts
a daemon again when its daemon goes away).

Test mode (`--test-mode`, with `--devtools-port <n>`) keeps the window hidden, keeps the app out of the Dock, only
logs links that would go to the system browser, and opens DevTools on that port for the tests to drive. Only in test
mode: `--locale en|zh` and `--theme light|dark` set the language and the look, before the settings, and
`--thumbnails` takes thumbnails although the window is never shown.

## Tests

```bash
npm test         # builds, then runs test/*.test.mjs one file at a time
```

- `unit.test.mjs`: the profile guards and test-mode flags, the navigation rules, back and forward over tabs, the
  window's settings file (and the choices of the look and the language), and what the page may ask of the Library API;
  no Electron.
- `no-node.test.mjs`: with no `node` on PATH, Electron as Node starts a detached daemon on a free port and the blank
  Docs, Sheets, Slides and Whiteboard artifacts it creates open with their editors (`test/probe/chain-probe.mjs`).
- `smoke.test.mjs`: the app in test mode: a blank doc in a tab, typing reaches the artifact's folder, no Node or
  bridge in the view, the tab comes back after `open-artifact daemon restart` and after the daemon is stopped (the bar
  says it is reconnecting meanwhile), the daemon outlives the app.
- `navigation.test.mjs`: the navigation guards and the permission handler in the running app, `--open`, and the
  refusal of port 4800 and the default home.
- `home.test.mjs`: the sidebar, the tab bar and the home page in the running app: the list and its live updates,
  opening a card, pin and fold, rename, delete and undo, the new dialog (a blank doc whose typing reaches its folder,
  an empty design with the Shell's prompt, a failed create that says why), back and forward, folding the sidebar,
  search, and that the page never sees the token or reaches the daemon itself.
- `look.test.mjs`: Chinese words and the dark look (`--locale zh --theme dark`), a new artifact's thumbnail taken,
  saved at its version and shown through `oa-thumbnail:` (`--thumbnails`), and the scheme refusing what is not an id.
- `service.test.mjs`: the service panel against the real daemon (version, address, pid, the apps, the editors),
  an editor's restart, `doctor` with no `node` on PATH, Restart (the pid changes, the tab comes back), Stop (it stays
  stopped) and Start, a stop while a second kit harness is connected (it starts the daemon again; the panel says so
  and connects), and that the daemon's token is in no answer, pushed view or error the page gets.
- `update.test.mjs`: runtime updates against a fake registry on `127.0.0.1` serving a newer runtime that runs:
  Check, the offer, Update and Restart now (asked first; the daemon then runs the newer one), a failed check, the
  "check for updates" switch (`bundled` and back), and updates off for the computer (nothing offered, no buttons).
- `settings-dialog.test.mjs`: the settings dialog: the look at once, a changed language with Reopen (only logged),
  the folder for new artifacts and the names made in it, Show in Finder (only logged), the service row; the
  defaults with no switches and no settings file; `--locale` and `--theme` making those controls read-only.
- `stale-tab.test.mjs`: a tab with unsaved work (its folder read-only) is kept as it was across a service restart and
  shows Reload; Reload lets the work go and brings the tab back.
- `settings.test.mjs`: the look and language settings in an artifact's view: `navigator.language`,
  `prefers-color-scheme` and `data-theme` in the Shell page and in its editor's frame, the Shell's words, the look
  switched at once in an open view, a changed language waiting for the app to open again (`restartNeeded`) and then
  taking effect, and test mode's `--locale` and `--theme` coming before the settings.

Every test uses a throwaway profile (`HOME`, `OPEN_ARTIFACT_HOME`, `TMPDIR`) and a free port other than 4800, with a
whitelisted environment (`OPEN_ARTIFACT_RUNTIME_UPDATE=off` and `OPEN_ARTIFACT_REGISTRY` on a closed loopback port
unless a test brings its fake registry; never the computer's policy file), and stops the daemons it started by the
pid in their `daemon.json`. In test mode, opening a folder, Show in Finder, the folder dialog and Reopen are only
logged. Set `OA_DESKTOP_KEEP=1`
to keep the profiles, `OA_DESKTOP_VERBOSE=1` to see the app's log.
