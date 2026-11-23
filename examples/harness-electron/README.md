# Electron host example

An Electron agent app on `@open-artifact/harness-kit`: a chat column on the left, the artifact's page on the right in a
top-level `WebContentsView`.

> **Not run in this change.** Electron is not a dependency of this repository, and this example was written and
> bundled (`node build.mjs`) but never started in Electron. Everything that is not Electron comes from
> [`../harness-node`](../harness-node), whose test runs it against a real daemon; the Electron parts (`src/main.mjs`,
> `src/pane.mjs`, `src/preload.cjs`, `renderer/`) are unchecked.

## Run

Electron is not installed by the workspace; bring your own:

```bash
cd examples/harness-electron
node build.mjs                 # bundles src/main.mjs into out/main.mjs, with the kit inlined
npx electron@latest .          # or an Electron you have installed
```

Like `harness-node`, it connects through `connectHarness`, so it carries the runtime `hostRuntime()` finds: the
installed `@open-artifact/cli`, or the repository's built `skills/open-artifact` (run `npm run build` and
`node scripts/build-plugins.mjs` at the root first). A shipped app passes the runtime folder it carries inside its
bundle ([runtime](../../docs/integrating/runtime.md)).

Type `make My first note` to have the scripted agent create an artifact; it opens on the right. Comment on it or use
**Ask**, and the message arrives in the chat as the owner's turn. A card per artifact appears under the transcript.

## Files

| File | What it does |
| --- | --- |
| `src/main.mjs` | The app: connects with `connectHarness` (view mode, `embed.remote: 'ask'` with a dialog), attaches the session, registers tools, installs the skill, follows cards, runs the scripted turns, and adds page context to each typed message. |
| `src/pane.mjs` | `ArtifactPane`: one `WebContentsView` per artifact, driven by `embedArtifact` with a transport through the daemon (`shellCommand` / `on('shell')`). |
| `src/preload.cjs` | The chat window's only bridge (artifact pages get none). |
| `renderer/` | The chat column: transcript, cards, input with the command menu. |
| `build.mjs` | esbuild bundle of the main process, `electron` external. |

## The checklist for showing pages

`src/pane.mjs` follows each item:

- **Allowlist.** A view may load only the origins `embedOrigins()` lists, updated on every `embed/origins` event
  (`OriginAllowlist` in `harness-node/allowlist.mjs`). It never opens all of loopback. Remote origins get in only after
  the person agreed in the `allowRemote` dialog; a no is not remembered, so the next open of that page asks again.
- **Isolation.** Pages run with `sandbox`, `contextIsolation`, no Node, no preload, and their own storage partition
  (`persist:open-artifact-pages`).
- **Subframes and clipboard.** `blob:` and `about:srcdoc` subframes are allowed. The only permission granted is
  `clipboard-sanitized-write`, and only to allowed origins.
- **Links out.** New windows and navigations outside the allowlist open in the system browser (`shell.openExternal`);
  the view never navigates away.
- **Hidden, not destroyed.** Switching artifacts hides views; reopening one shows it again with its state.
- **Places.** `onPlace` is stored (`PlaceMemory`, in the app's user data) and sent back with `goto` on reopen.
- **Theme.** `nativeTheme` changes send `host_hello` again through `setTheme`.
- **Thumbnails.** `capturePage().toJPEG()` is passed as `capture`, and the kit saves it with `saveThumbnail`.
