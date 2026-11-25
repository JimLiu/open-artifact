# Open Artifact Desktop

An Electron app that shows the local library's artifacts, with no agent attached: one window with a sidebar, a tab bar
and the library page (the home tab), and one sandboxed `WebContentsView` per artifact tab showing its Shell. There is
no server switcher, service status, update banner or settings yet.

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
  a dot while it has unsaved work, reconnecting and "reload" states), and `+` for the new dialog. It scrolls sideways.
- **Home**: the shared `ArtifactsPage` of `@open-artifact/library-page`, with the page's own search and New buttons
  hidden (the sidebar has them) and its type tiles in two groups: types that start blank and open in their editor
  (`BUILTIN_START.blank`), and types an agent builds (`BUILTIN_START.agent`, made empty, the Shell shows the hand-over
  prompt). Thumbnails are taken by the main process in a hidden offscreen window of their own partition and shown
  through the `oa-thumbnail:` scheme; they are taken only while the window is on screen (or with `--thumbnails` in
  test mode).
- **New dialog**: the two groups, a title field, Create and open; a failed create says the daemon's reason in the
  dialog, which stays open.

The page reaches the main process through a small preload bridge (`window.desktop`); every call checks that it came
from the window's own page. The Library API calls (list, update title or pinned, delete, restore, create, thumbnails)
are made by the main process with the daemon's token, which the page never sees; the page gets the library's events
forwarded. The look follows the system (`nativeTheme`, light or dark), the words follow the system language (Chinese
or English).

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
mode: `--locale en|zh` and `--theme light|dark` set the language and the look instead of the system's, and
`--thumbnails` takes thumbnails although the window is never shown.

## Tests

```bash
npm test         # builds, then runs test/*.test.mjs one file at a time
```

- `unit.test.mjs`: the profile guards and test-mode flags, the navigation rules, back and forward over tabs, the
  window's settings file, and what the page may ask of the Library API; no Electron.
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

Every test uses a throwaway profile (`HOME`, `OPEN_ARTIFACT_HOME`, `TMPDIR`) and a free port other than 4800, with a
whitelisted environment, and stops the daemons it started by the pid in their `daemon.json`. Set `OA_DESKTOP_KEEP=1`
to keep the profiles, `OA_DESKTOP_VERBOSE=1` to see the app's log.
