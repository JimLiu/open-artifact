# Open Artifact Desktop (skeleton)

An Electron app that shows the local library's artifacts in tabs, with no agent attached. This is the skeleton: one
window, a tab bar, one sandboxed `WebContentsView` per artifact showing its Shell. There is no home page, sidebar,
settings or service panel yet.

- It carries its own Open Artifact runtime (`resources/runtime`, a copy of the built `skills/open-artifact`) and starts
  the daemon with its own executable as Node (`ELECTRON_RUN_AS_NODE=1`), detached, so no Node.js has to be installed
  and the daemon keeps running after the app quits.
- It connects with `createHarness({ harness: 'open-artifact-desktop' })` from `@open-artifact/harness-kit`: no
  session, no wake, `embed: 'view'`. The daemon's token stays in the main process; pages get no Node, no preload and
  no bridge.
- A view may only show the daemon's origin and the page origins the daemon lists (`embed.origins`). Links to the web
  go to the system browser; new windows are denied; another artifact's Shell address opens a tab of its own; the
  daemon's home page goes to the first tab; the Shell's `close` closes the tab.

## Setup and build

At the repository root, build the runtime pieces first:

```bash
npm run build && node scripts/build-skill.mjs
```

Then in `apps/desktop`:

```bash
npm run setup    # npm install, then install-electron (Electron 45 downloads its binary only on this step)
npm run build    # copies the runtime into resources/runtime, bundles src/ into out/
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
logs links that would go to the system browser, and opens DevTools on that port for the tests to drive.

## Tests

```bash
npm test         # builds, then runs test/*.test.mjs one file at a time
```

- `unit.test.mjs`: the profile guards and the navigation rules, no Electron.
- `no-node.test.mjs`: with no `node` on PATH, Electron as Node starts a detached daemon on a free port and the blank
  Docs, Sheets, Slides and Whiteboard artifacts it creates open with their editors (`test/probe/chain-probe.mjs`).
- `smoke.test.mjs`: the app in test mode: a blank doc in a tab, typing reaches the artifact's folder, no Node or
  bridge in the view, the tab comes back after `open-artifact daemon restart` and after the daemon is stopped (the bar
  says it is reconnecting meanwhile), the daemon outlives the app.
- `navigation.test.mjs`: the navigation guards and the permission handler in the running app, `--open`, and the
  refusal of port 4800 and the default home.

Every test uses a throwaway profile (`HOME`, `OPEN_ARTIFACT_HOME`, `TMPDIR`) and a free port other than 4800, with a
whitelisted environment, and stops the daemons it started by the pid in their `daemon.json`. Set `OA_DESKTOP_KEEP=1`
to keep the profiles, `OA_DESKTOP_VERBOSE=1` to see the app's log.
