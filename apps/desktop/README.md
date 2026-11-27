# Open Artifact Desktop

An Electron app that shows the local library's artifacts, with no agent attached: one window with a sidebar, a tab bar
and the library page (the home tab), and one sandboxed `WebContentsView` per artifact tab showing its Shell, with a
switcher for the Open Artifact sites (servers) the daemon knows.

- It carries its own Open Artifact runtime (`resources/runtime`, a copy of the built `skills/open-artifact`) and starts
  the daemon with its own executable as Node (`ELECTRON_RUN_AS_NODE=1`), detached, so no Node.js has to be installed
  and the daemon keeps running after the app quits.
- It connects with `createHarness({ harness: 'open-artifact-desktop' })` from `@open-artifact/harness-kit`: no
  session, no wake, `embed: 'view'`. The daemon's token stays in the main process; pages get no Node, no preload and
  no bridge.
- A view may only show the daemon's origin and the page origins the daemon lists (`embed.origins`); its frames are
  checked again at each server redirect, so an allowed address cannot redirect a frame elsewhere. Links to the web
  go to the system browser (only http(s), without a user name or password; the log keeps the origin and the path);
  new windows are denied; another artifact's Shell address opens a tab of its own; the
  daemon's home page goes to the first tab; the Shell's `close` closes the tab (asked first when its work is not
  saved, as the bar's close is).
- One app per profile: Electron's single-instance lock, on the userData folder (`<home>/desktop/user-data` in a
  development or test run, so two homes run side by side). A second start in the same home hands its arguments to the
  app running (`--open <id>` and `open-artifact://` links open there; the window comes to the front, only logged in
  test mode) and exits 0.
- `open-artifact://artifact/<id>` is the only link the app takes (`src/links.ts`, the id checked as every id is):
  from a start's arguments, from macOS's `open-url` (which may come before `ready`; it is queued) and from a second
  start's arguments. Any other form is refused and logged, and nothing opens. The app never registers itself for the
  scheme: a development or test run calls no `setAsDefaultProtocolClient` and no `lsregister`, and a package declares
  it in its `Info.plist` only when packaged with `OA_DESKTOP_URL_SCHEME=1` (see Packaging).

## The window

The window's page (`renderer/`, a React app bundled into `out/renderer/app.js`) draws the chrome and the home page:

- **Sidebar** (240 px, can be folded; the choice is kept in `<userData>/settings.json`): room for the macOS traffic
  lights, fold, back and forward over the tabs the person went to; New (the new dialog), Search (the library tab with
  its search field focused), Library; Pinned (foldable) and Recent (the 8 most recently changed artifacts that are not
  pinned), each with its type's colored icon; pointing at a row shows its title and, on a second line, the project it
  was made for. It follows the library's events.
- **Tab bar** (`TabStrip` of `packages/ui`): the Library tab first (it cannot be closed or moved), then one tab per artifact (its type's icon in the
  type's color, title, close, a dot in place of × while it has unsaved work, reconnecting, stopped, "reload", "saving…"
  while a close waits for the save, and "folder not found" states), and `+`. `+` opens a menu: New, one line per
  installed type (a pick makes it at once, with no name, and opens it in a tab; ⌘N still opens the new dialog), then
  the artifacts made for the same project as the tab in front that are not open (with none, the ones opened last; six
  at most). Tabs are dragged to
  change their order (`desktop.move`; the main process keeps it, so ⌘⇧[ / ⌘⇧] follow it); ⌘⇧← / ⌘⇧→ (Ctrl+Shift
  elsewhere) moves the focused tab. A middle click, Delete or Backspace closes a tab. Tabs that do not fit go into the
  list behind ▾ (each with its type, a click brings it into the row next to the last tab shown, × or Delete closes it).
  A tab's right-click menu has Install as App…, Close Tab, Close Other Tabs, Close Tabs to the Right and Close All Tabs
  (each close asks about unsaved work as ⌘W does). The view of the tab in front is hidden while a menu is open.
- **Unsaved work** (built on what each tab's Shell says of its saving: `saved` and `unsaved`): closing a tab (its ×,
  ⌘W, File ▸ Close Tab, the Shell's own `close`) with work not saved waits up to 3 s for the save, the tab saying
  "saving…"; saved, it closes; not saved, the window's page asks "<title> has changes that are not saved" with Close
  anyway and Cancel (Return and Escape cancel). Quitting (⌘Q, the window's close) waits the same way for every such
  tab, then names them and asks with Quit anyway and Cancel. Reload of a tab kept as it was (`stale`) with unsaved
  work asks first; the service panel's Restart and Stop questions name the tabs with unsaved work. A tab whose Shell
  never said anything of its saving (`saved` null) is never asked about. The question is drawn by the window's page
  (the service panel's look, `Confirm`), with the artifact's view hidden while it shows (the overlay). While the
  overlay is up the window's page has the keyboard focus (the tab in front gets it back after), and Close Tab, Reload
  and Move To… are off: they would act on a tab the person cannot see.
- **A folder that is gone**: the library still lists an artifact whose folder was moved, renamed or deleted outside
  the app (the Library API's `folderMissing`). Its tab loads no Shell; it shows "The folder of this artifact cannot be
  found", the folder the library had, Relocate… (the system's folder dialog, then `artifacts.relocate`; the tab opens
  from the new place, and a folder that is not the artifact's shows the daemon's answer as it is) and Remove from
  Library (the library's delete: the record goes, with Undo; no file is touched).
- **Home**: the shared `ArtifactsPage` of `@open-artifact/library-page`, with the page's own search and New buttons
  hidden (the sidebar has them) and its type tiles in two groups: types that start blank and open in their editor
  (`BUILTIN_START.blank`), and types an agent builds (`BUILTIN_START.agent`, made empty, the Shell shows the hand-over
  prompt). Thumbnails are taken by the main process in a hidden offscreen window of their own partition and shown
  through the `oa-thumbnail:` scheme; they are taken only while the window is on screen (or with `--thumbnails` in
  test mode). Each artifact says the project it was made for under its title (the daemon's `ArtifactView.project`, see
  [where artifacts go](../../docs/settings.md)); the filter menu's Project submenu narrows the list to one or more
  projects, and the search finds a project by its path.
- **New dialog**: the two groups (each type with its icon), a title field, Create and open; a failed create says the
  daemon's reason in the dialog, which stays open. With a folder chosen in Settings, the app names the new artifact's
  folder itself, as the daemon would: `<folder>/<slug of the title>`, `-2`, `-3`… past one that exists and is not
  empty (`src/folders.ts`); without one the daemon decides (`<homeWorkspace>/<artifactsDir>/<slug>`).
- **Service status** (the first of the home page's heading tools, `headingTools`): a dot and the state (running,
  reconnecting, stopped, started elsewhere, failed) with how many apps are connected; it opens the service panel.
- **Servers switcher** (next to the service status; `src/servers.ts`, `renderer/src/ServerSwitcher.tsx`): "This
  Mac" and each site of the daemon's `remotes` with its name, address, signed-in account and whether it can be
  reached. Everything is the daemon's (`remotes`, `cloud.settings`); the app keeps no copy, and reads them again every
  3 s while connected (there is no daemon event), when the panel opens and when a site's page fails, so changes made
  with `open-artifact remote …` show within seconds.
  - **Add**: the address and a name (suggested from the host name; letters, digits, `-` and `_`). Only `https://` is
    taken as it is; a plain `http://` address is asked about first and then sent as `--insecure-http` would be
    (`insecureHttp`). The app calls `remotes.add` with `browse: false` and waits with `remotes.add.wait`, showing the
    site's code, a waiting state, Open the approval page (the system browser) and Cancel (`remotes.add.cancel`).
  - **Choose**: sets only the default (`cloud.settings {default}`); nothing is published. "This Mac" is a state,
    not a choice: automatic publishing off (new artifacts stay here), whatever the default is. The button shows it then,
    and the default server's name once automatic publishing is on. With one site, that site is the default.
  - **Automatic publishing**: the switch "New artifacts go up to “<name>” automatically" (agents' new artifacts too) beside the button and
    in the panel is `cloud.settings {publish}`, off by default. The first time a server becomes the default the app
    asks once (`autoPublishAsked` in the app's settings).
  - **Remove** (`remotes.remove`, asked first; forcing offered when the site still holds artifacts). **Open server
    home** opens the site's own page in a tab.
  - **Presets**: a preset site that is not the default and a preset problem are shown. What the daemon does not say
    (the preset's publish policy, a preset address the person removed) is not shown.
  - **Sites' pages**: a published artifact's tab (the daemon's redirect to its site) and a site's home page open in a
    partition of their own (`persist:open-artifact-servers`: no preload, no daemon channel, never the token). Only
    the `remotes` origins are shown at the top level; any other address (a third-party sign-in too) goes to the system
    browser. Such a tab has no saved state and no place, its title is the library's, and it closes without asking.
    When the site cannot be reached, the same tab shows the working copy here, editable; it stays local until
    reloaded. The site's own sign-in is needed once in that partition.
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
  Advanced (the profile folder with Show in Finder, the versions). Artifacts also has "Open agents' artifacts in this
  app" (the daemon's `desktop.settings {openInDesktop}`, off by default): when an agent app that shows no pages itself
  opens an artifact, the page opens in a tab here instead of the browser (the app started with the
  `open-artifact://artifact/<id>` link when it is not running; that start has unit tests only, no run on a real
  machine). Service and updates shows the default server, with the switcher.

- **Menu bar** (`src/menu.ts`, built again when the language, the types or the tab in front change): the app menu
  (About, Settings… `⌘,`, Services, Hide, Quit); File (New ▸ each type in the new dialog's two groups, New… `⌘N`,
  Open Folder… `⌘O` adds a folder that holds an artifact (`artifacts.add`), Import… `⇧⌘O` a `.zip` of one
  (`artifacts.import`), Show in Finder `⌥⌘R`, Move To…, Close Tab `⌘W`); Edit (the standard items, sent to the tab in
  front, or to the window's page while a dialog is over it); View (Reload Tab `⌘R`, Toggle Sidebar `⌃⌘S`, Actual
  Size, Zoom In and Out, Enter Full Screen `⌃⌘F`); Window (the standard items, Previous and Next Tab `⇧⌘[` `⇧⌘]`);
  Help (the logs folder, Run doctor in the service panel). Its labels follow the app's language. The items for an
  artifact are greyed out while the Library tab is in front, the ones that need the service while it is not
  connected. Every item is a named command of the main process.
- **Show in Finder and Move To…**: also in a card's More menu (`cardActions` of the library page) and in a sidebar
  row's right-click menu. Move To… asks for a folder, closes the artifact's tab once its work is saved, moves the
  folder there (`<name> (2)` when the name is taken; across volumes, copied then removed), tells the daemon
  (`artifacts.relocate`) and opens the tab again; when the daemon refuses, the folder is put back.
- **Downloads** (`src/downloads.ts`, `src/notice.ts`): what an artifact's view saves goes to `~/Downloads` with no
  dialog: an editor's export (the Shell's `saved_file`, written by the type server) and the view's own downloads (the
  folder's zip, a page's `blob:` file; ` (2)`, ` (3)`… when the name is taken). A download from anywhere the views may
  not show is cancelled and logged. A notice at the window's bottom right names the file and the folder, with Show in
  Finder; it goes after a few seconds (not while the pointer is on it). The same notice says how Move To…, Import… and
  Open Folder… went while an artifact's tab is in front (the home page's toast says it while the library is).

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

## Desktop application updates

Signed macOS Apple Silicon releases check `JimLiu/open-artifact` on GitHub 15 seconds after launch and every 6 hours.
Only newer stable `desktop-v*` releases with a ZIP and `desktop-updates-darwin-arm64.json` qualify; npm's Latest,
drafts and prereleases are ignored. Settings → Desktop application updates and the app menu offer manual checks,
release notes, download and Restart and Update. When an update is available, an Update button appears at the bottom
of the sidebar, to the right of Settings. It is absent when there is no update. Clicking it starts the download and
opens an update window with real byte progress, percentage, transferred/total MB, release notes and Cancel Download.
Closing the window keeps a download running; after verification it offers Restart and Update.

Automatic checks default on (`appAutoCheck`); automatic downloads default off (`appAutoDownload`). Both are saved
in `<userData>/settings.json`, separately from runtime updates. Chromium downloads the ZIP with progress and verifies
its size and SHA-256; a private loopback handoff lets Electron's native updater verify it again and check code signing,
then install on normal quit or an explicit restart. Restart uses the existing unsaved-work guard;
canceling keeps the update ready. Development, local ad hoc and test builds never check or install. See the bilingual
[release and update guide](RELEASING.md) / [签名、发布与更新指南](RELEASING.zh-CN.md).

## Setup and build

At the repository root, build the runtime pieces first:

```bash
npm run build && node scripts/build-skill.mjs
```

Then in `apps/desktop`:

```bash
npm run setup    # npm install, then install-electron (Electron 45 downloads its binary only on this step)
npm run typecheck # strict types for sources, pages, scripts and all tests
npm run build    # copies the runtime into resources/runtime, bundles src/ and renderer/ into out/
```

TypeScript development and validation: [English](DEVELOPMENT.md) · [简体中文](DEVELOPMENT.zh-CN.md).

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
logs links that would go to the system browser, and opens DevTools on that port for the tests to drive; it also turns off
Chromium's backgrounding of hidden windows, so the pages of a window never shown keep their animation frames and
timers. Only in test
mode: `--locale en|zh` and `--theme light|dark` set the language and the look, before the settings, and
`--thumbnails` takes thumbnails although the window is never shown, and `--offline` refuses every request a page of
the app makes past this computer (the window's, the views', the thumbnails'), logged as `offline: blocked …`.

## Artifacts installed as apps

An artifact can be installed as a macOS app of its own (`src/installed-apps.ts`, `src/installed-apps-macos.ts`).
**Install as App…** is in a card's More menu (through the library page's `cardActions`), a sidebar row's right-click
menu, a tab's right-click menu and the File menu (for the tab in front). Each opens one dialog
(`renderer/src/InstallAppDialog.tsx`), which asks `desktop.apps.state(id)` when it opens and shows:

- **unavailable**: why (a development run, an artifact of a site, the artifact or its folder missing). A development
  build shows the entries, but the dialog says only the packaged Open Artifact can install;
- **available**: the name and the install folder; where the package cannot be cloned, the room a copy takes and a box
  to say yes to it (`allowCopy`); a name taken meanwhile, a clash or an error in words;
- **installing** / **busy** (another call works on it: asked again every second);
- **installed**: Open, Show in Finder, Uninstall… (asked first), and Update when the desktop app changed since;
- **needsRepair**: why; Repair when its place holds its own package or nothing, Remove Record always (only Remove
  Record when its place holds something else).

The bridge: `desktop.apps.state(id)`, `install(id, { confirmedName, allowCopy })`, `open(id, installId)`,
`reveal(id, installId)`, `uninstall(id, installId)`, `refresh(id, installId, { allowCopy })`,
`repair(id, installId, { allowCopy })` and `forget(id, installId)`.

- **The package**: an APFS clone (`cp -Rc`) of the packaged desktop app in
  `~/Applications/Open Artifact Apps/<title>.app`, the title as it is (Chinese, `#`, `?`, `%` included; `/` and `:`
  become `-`, tabs and line breaks spaces, other control characters are dropped). Only `CFBundleDisplayName`, `CFBundleIdentifier` (`dev.openartifact.app.<installId>`) and the icon
  (`AppIcon.icns`, one per type from `Contents/Resources/app-icons/`) change, and `CFBundleURLTypes` is removed;
  `CFBundleName`, `CFBundleExecutable` and the helpers stay the desktop app's. The menu bar's bold name stays
  "Open Artifact"; the Finder shows the artifact's name; what the Dock and ⌘Tab show has not been checked. It gets
  `Contents/Resources/artifact-app.json` (home, artifact, install id, the desktop app's version) and is signed ad hoc
  on the outer package only, then checked with `codesign --verify --strict`. Where the folder is not on the same APFS
  volume as the desktop app, the answer is `needsCopy`; `allowCopy` copies it with `ditto`. Two artifacts of one title
  get `<title>` and `<title> (2)`.
- **The records**: `<home>/desktop/apps/<installId>.json`, written atomically, one operation per artifact at a time;
  phases `installing`, `installed`, `uninstalling` and `refreshing`. The steps are checked again at every start
  (`reconcileAll`): a finished one is committed, an unfinished one cleaned up or put back, anything else answers
  `needsRepair`. Every path written is checked to be inside the install folder, inside `HOME`, and a package is touched
  only when its `artifact-app.json` names the record's install id.
- **Renamed or moved in the Finder**: renamed inside the install folder, the package is claimed (the record's
  `bundlePath` and `displayName` follow it) by the desktop app's next check and by the app's own start. Moved out of
  the folder, it is not: the record answers `needsRepair` (`missing`, repairable), and the app's own page says where it
  belongs (move it back, or install it again) with a button that opens the artifact in the desktop app. Moved back, it
  is installed again, with the same install id.
- **Uninstall**: the record says `uninstalling` (with the time it was asked); a running app (its pid in
  `<home>/desktop/apps/<installId>/running.json`) sees it within a second and quits as ⌘Q would (unsaved work asked
  about). After 15 s without it quitting, the record is put back and the person is asked to close the app. Then the
  package goes to the Trash (`shell.trashItem`), its preferences are forgotten (`defaults delete <bundle id>` clears
  its keys; then its file `<bundle id>.plist` in `<CFFIXED_USER_HOME, else the account's home>/Library/Preferences`
  is removed, for a bundle id of the app's own form only), and the record and the app's own folder are removed.
  Remove Record forgets the preferences the same way. A package that is not the record's is left where it is. Installed
  again, an artifact gets a new install id, so an old uninstall never touches the new app.
- **Refresh and repair** (one rebuild): a new package is built beside the old one (`<installId>.app` in
  `<home>/desktop/apps/`), with the same install id, bundle id and name, then swapped in (`refreshing`, the old one kept
  as `<installId>.old.app` until the swap is committed). Only while the app does not run. After the desktop app's
  check at start, the apps made by another version are refreshed; the dialog's Update does it for one; Repair rebuilds
  one that needs repair when its place holds its own package or nothing. The check at start also points the records at
  the desktop app where it is now (`templatePath`).
- **The daemon running from an app's package** (`src/daemon-host.ts`): an app that started the home's daemon with its
  own executable or runtime writes `<home>/desktop/daemon-host.json` (`{ pid, startedAt, exe, bin, bundlePath,
  installId }`; it counts only while `daemon.json` names that pid and it is alive). With it, the daemon's runtime
  folder in `<home>/runtimes.json` and the daemon's own `runtime.status`, the desktop app knows when the daemon lives
  inside a package. Before an uninstall, refresh or repair moves or removes that package, the daemon is restarted from
  the desktop app's own runtime (the service panel's restart; never while a tab holds unsaved work) and checked again;
  when it still runs from there, nothing is moved, the record stays as it was, and the answer says `daemonInUse` (the
  dialog says so in words). The refresh after the check at start never restarts the shared daemon: such an app is left
  (`daemon-in-use`) for the dialog's Update. At start, the desktop app and the app (after it connects, before its
  artifact opens) restart a daemon that lives in an installed app's package that is gone (renamed, moved or
  removed: a file its marker names, or a path of it inside the install folder); a daemon whose files are gone anywhere
  else is left to itself.
- **The app**: `src/start.ts` reads `artifact-app.json` first; with it, `src/artifact-app.ts` runs one window for one
  artifact (`src/artifact-window.ts`, its views made as tabs make theirs by `src/artifact-view.ts`), with the
  standard title bar, its own Electron folder (`<home>/desktop/apps/<installId>/`, one instance), the desktop app's
  look and language, and a short menu (File: Show in Finder, Close). The daemon is started with a desktop app's
  executable and runtime: the record's `templatePath`, else another record's, else `/Applications/Open Artifact.app`
  or `~/Applications/Open Artifact.app` (never these two in test mode), the first with a runtime it can use; the app's
  own only when none is found. Links to the desktop app go to the first of those. Links to other
  artifacts, "All artifacts" and Duplicate go to the desktop app. An agent's open is never shown here (the daemon gives
  those to the desktop app only). Without its record, moved out of its folder, or with the artifact gone from the
  library, it shows why on its own page (`renderer/artifact-app/`). Its pages are checked by `src/page-url.ts`
  (`pathToFileURL`), so a name with `#`, `?` or `%` works.
- In test mode, opening a package (`open`) is only logged (an install answers `launch: 'skipped'`), and the Trash is
  not used: the package (checked to be the record's, inside the install folder) is removed and that is logged.
  `defaults delete` of the exact bundle id runs in test mode too; the preferences file is removed in test mode only
  when its folder is inside the test's own `HOME` (and that `HOME` is not the account's), else it is left and that is
  logged. macOS writes it in the account's own `~/Library/Preferences` whatever `HOME` or `CFFIXED_USER_HOME` say, so
  a test run leaves an empty `<bundle id>.plist` there for each generated app it started.

## Packaging

```bash
npm run package        # npm run build, then scripts/package.ts
npm run package:release # Developer ID signed, notarized ZIP / DMG; requires signing credentials
npm run test:packaged  # the packaged app's checks (test/packaged/); package first
```

`scripts/package.ts` makes `dist/Open Artifact-darwin-arm64/Open Artifact.app` (`dist/` is ignored by git): macOS
arm64, a folder signed ad hoc on this computer
(`codesign --force --deep --sign -`, the package only). It carries `out/` (the main process, the preloads, the
pages) in `Contents/Resources/app.asar` (Electron checks it against `ElectronAsarIntegrity` in `Info.plist`) and the
runtime in `Contents/Resources/runtime`, and the icons of installed artifact apps in
`Contents/Resources/app-icons/`. The app icon (the Open Artifact mark on the brand blue: the back square light blue, the front one white, the
dot amber) and the type icons (still placeholders) are drawn by `scripts/placeholder-icon.ts`; `node build.ts` also
writes the app icon as `out/icon.png`, which a development run puts in the Dock. The
stable bundle id is `dev.openartifact.desktop`. Electron's fuses are left as they are: `RunAsNode` stays
on, the daemon and the type servers run on the app's own executable. No URL scheme is declared by default, and
nothing is installed or registered. `OA_DESKTOP_URL_SCHEME=1 npm run package` declares `open-artifact://` in the
package's `Info.plist` (`CFBundleURLTypes`, from `scripts/info-plist.ts`); macOS then sends such links to the app once
it has been run from where it is installed. Nothing is registered by the app or the script either way. Electron's zip
comes from `@electron/get`'s cache when it is there.

`npm run package:release` signs nested code inside out with Developer ID, hardened runtime and a secure timestamp,
notarizes and staples the app and DMG, verifies the extracted ZIP and Gatekeeper, and writes ZIP / DMG, SHA-256 files
and a public report plus the static updater feed to `dist/release/`. Missing credentials or failed Apple checks stop the release. GitHub Actions
supports credential validation, candidate builds and publication from `desktop-v<version>` tags, independently of npm
releases. The desktop version follows the bundled runtime. See the signing, backup, secrets and release guide:
[English](RELEASING.md) · [简体中文](RELEASING.zh-CN.md).

The packaged app started with no arguments uses your own home and port, as it will for the person. Start it for a
test only through the test code (`launchApp(…, { binary })`), which always passes `--home`, a port other than 4800,
`--test-mode` and a throwaway `HOME`; a test-mode run of the package is guarded like a development one.

## Tests

```bash
npm run check    # strict typecheck, then builds and runs development tests
npm test         # builds, then runs test/*.test.ts one file at a time
```

- `unit.test.ts`: the profile guards and test-mode flags, the navigation rules, back and forward over tabs, the
  window's settings file (and the choices of the look and the language), what the page may ask of the Library API,
  the links the app takes (`open-artifact://artifact/<id>` only) and the arguments that ask to open, what a package
  adds to its `Info.plist` (nothing, or the URL type with `OA_DESKTOP_URL_SCHEME=1`), that no source registers the
  scheme, the sites' navigation rules and the servers switcher's model against a fake daemon; no Electron.
- `no-node.test.ts`: with no `node` on PATH, Electron as Node starts a detached daemon on a free port and the blank
  Docs, Sheets, Slides and Whiteboard artifacts it creates open with their editors (`test/probe/chain-probe.ts`).
- `smoke.test.ts`: the app in test mode: a blank doc in a tab, typing reaches the artifact's folder, no Node or
  bridge in the view, the tab comes back after `open-artifact daemon restart` and after the daemon is stopped (the bar
  says it is reconnecting meanwhile), the daemon outlives the app.
- `navigation.test.ts`: the navigation guards and the permission handler in the running app, `--open`, and the
  refusal of port 4800 and the default home.
- `home.test.ts`: the sidebar, the tab bar and the home page in the running app: the list and its live updates,
  opening a card, pin and fold, rename, delete and undo, the new dialog (a blank doc whose typing reaches its folder,
  an empty design with the Shell's prompt, a failed create that says why), back and forward, folding the sidebar,
  search, that the page never sees the token or reaches the daemon itself, and that artifacts two agent sessions made
  (kept in the Open Artifact folder) say their project under the title and in the sidebar row's tooltip, with the
  filter menu's Project submenu narrowing the library to one project or two.
- `look.test.ts`: Chinese words and the dark look (`--locale zh --theme dark`), a new artifact's thumbnail taken,
  saved at its version and shown through `oa-thumbnail:` (`--thumbnails`), and the scheme refusing what is not an id.
- `service.test.ts`: the service panel against the real daemon (version, address, pid, the apps, the editors),
  an editor's restart, `doctor` with no `node` on PATH, Restart (the pid changes, the tab comes back), Stop (it stays
  stopped) and Start, a stop while a second kit harness is connected (it starts the daemon again; the panel says so
  and connects), and that the daemon's token is in no answer, pushed view or error the page gets.
- `update.test.ts`: runtime updates against a fake registry on `127.0.0.1` serving a newer runtime that runs:
  Check, the offer, Update and Restart now (asked first; the daemon then runs the newer one), a failed check, the
  "check for updates" switch (`bundled` and back), and updates off for the computer (nothing offered, no buttons).
- `settings-dialog.test.ts`: the settings dialog: the look at once, a changed language with Reopen (only logged),
  the folder for new artifacts and the names made in it, Show in Finder (only logged), the service row; the
  defaults with no switches and no settings file; `--locale` and `--theme` making those controls read-only.
- `stale-tab.test.ts`: a tab with unsaved work (its folder read-only) is kept as it was across a service restart
  (whose question names it) and shows Reload; Reload asks first: Cancel keeps the tab, Reload lets the work go and
  brings it back.
- `unsaved.test.ts`: a tab's close waits for the save (saved in time: it closes, no question), else asks: Cancel and
  Escape keep it, Close anyway closes it, through the ×, Close Tab and `desktop.close`; a tab with no saved state
  closes at once; a real unsaved edit (a read-only folder) is asked about; the quit and the window's close wait, name
  every tab with unsaved work, and Cancel keeps the app while Quit anyway quits it. The saved states are set by the
  test (`desktop.test.saved`), so nothing waits on timing.
- `instance.test.ts`: a second start in the same home exits 0 at once and its `--open` and link open in the first;
  links of other forms are refused (a second start's, `open-url`'s, the `open-url` command's, a start's arguments);
  two homes run side by side; a link as a start's argument opens.
- `relocate.test.ts`: an artifact whose folder was moved: its tab says so with the old path and loads no Shell;
  Relocate… to a wrong folder shows the daemon's answer, to the right one opens it; Remove from Library forgets it and
  leaves the folder. The folder dialog is never shown (`desktop.test.pickNext`).
- `acceptance.test.ts`: beside a fake agent app (harness-kit's `createHarness`): Open Folder… on the folder of an
  agent's artifact gives one owned by nobody; an agent's artifact edited in the app keeps its owner; an agent's
  `update` to a doc open in the app shows in its tab without a reload.
- `settings.test.ts`: the look and language settings in an artifact's view: `navigator.language`,
  `prefers-color-scheme` and `data-theme` in the Shell page and in its editor's frame, the Shell's words, the look
  switched at once in an open view, a changed language waiting for the app to open again (`restartNeeded`) and then
  taking effect, and test mode's `--locale` and `--theme` coming before the settings.
- `downloads.test.ts`: a Docs export (Markdown) and a Sheets export (CSV, twice: ` (2)`), the folder's zip twice and
  a page's `blob:` file twice, each in the throwaway HOME's Downloads with no dialog and named in the notice (its Show
  in Finder and Close); a download from another loopback server cancelled.
- `menu.test.ts`: the menu bar's structure, shortcuts and greyed-out items, and each command by name: New by type,
  the Edit items, previous and next tab, Close Tab, Reload, the sidebar, zoom, Show in Finder, Move To… (the folder
  moved, the artifact opening from there), Open Folder…, Import…, the logs, doctor, About, Settings, and the card's
  and the sidebar row's menus.
- `offline.test.ts`: with `--offline`, and the daemon and the type servers sent to a proxy of the test's that
  refuses everything: Docs, Sheets, Slides and Whiteboard each made new, edited, quit, opened again with the edit,
  and exported once; the daemon and at least one type server are checked to run with the proxy variables
  (`HTTP_PROXY`, `HTTPS_PROXY`, `NODE_USE_ENV_PROXY=1`); Slides is also exported as PowerPoint with its current fonts,
  whose outcome is reported, not asserted; what was refused is listed (`OA_DESKTOP_OFFLINE_REPORT=<file>` writes it as
  JSON).
- `servers.test.ts`: against two real sites (`packages/host`, `test/lib/host.ts`) on loopback ports, data in the
  profile, approved through the site's own forms (no browser): adding from the switcher (an `http://` address asked
  first, the code, the wait); Settings naming the default server and opening the switcher; choosing sets only the
  default; automatic publishing on (the app's and an agent's new
  artifacts go up and open there) and off; changes made on the command line (default, automatic publishing) shown;
  a site that stops (the tab shows the editable working copy); a site's home tab in the servers' partition (no
  preload, no token, no ticket) that closes without asking; removing asked first.
- `open-in-app.test.ts`: a fake agent app (harness-kit, no `open` of its own): with "Open agents' artifacts in this
  app" off, its `Artifact open` opens no tab; turned on in Settings, it opens a tab here and the browser is not used
  (`opened_in: "desktop"`); the setting refused from an agent's session.
- `packaged/packaged.test.ts` (`npm run test:packaged`, not in `npm test`): the packaged app uses the throwaway
  folders when given them; with no `node` on PATH the four types open and the daemon and the type servers run the
  package's executable; an edit kept across quitting; doctor; a copy of the package in another folder starts; the
  default package's `Info.plist` declares no URL scheme.
- `installed-apps.test.ts` (in `npm test`): the installer with a fake package and signing: names, records, the steps
  cut at each point and put right at the next start, the path guards, clashes, `needsCopy`; renamed and moved
  packages; uninstall (not running, running, given up after the timeout, a Trash that fails); refresh and repair cut at
  each step; a package that is not the record's never moved; the daemon running from a package (restarted first, or
  refused with `daemonInUse` and nothing moved; skipped by the refresh at start; a stale `daemon-host.json` ignored);
  the preferences file's removal and its test-mode guard.
- `install-app-ui.test.ts`: a development run: the four ways in open the dialog, which says only the packaged app
  installs; nothing written to the install folder.
- `packaged/installed-apps.test.ts` (`npm run test:packaged`): installed through the bridge (signature, bundle id,
  name, manifest, record; `df -k` shows a clone); two artifacts of one title; a cold start with no `node` and no
  daemon (the daemon runs the desktop app's executable, an edit is saved and the desktop app shows it); one instance,
  and side by side with the desktop app; an agent's open never shown in it; a broken manifest, a removed record, an
  artifact removed from the library. Its apps are started only through `launchArtifactApp` (their executable,
  `--test-mode`, a port other than 4800), and the preferences macOS keeps for them are forgotten after the run
  (`defaults delete` of their exact bundle ids clears the keys; macOS still leaves an empty `<bundle id>.plist` in the
  account's `~/Library/Preferences`, which a test never removes).
- `packaged/installed-apps-names.test.ts`: a title with Chinese, `#`, `?` and `%`: installed, a cold start, the
  unsaved question's Yes, the "needs repair" page's button.
- `packaged/installed-apps-manage.test.ts`: the dialog state by state (installing held at a step, busy, Update,
  Repair, Remove Record only); the desktop app moved (the app's own executable runs the daemon); "Open in App" off;
  renamed and moved out in the Finder; refresh at start; uninstall running (quits by itself), with unsaved work kept
  (given up after the timeout) and not running, its preferences file removed (a planted one: that desktop app runs
  with `CFFIXED_USER_HOME` set to the test's `HOME`); installed again with a new install id.
- `packaged/installed-apps-daemon.test.ts`: the daemon started by an app's own package (no desktop app), then: the
  package renamed and the app started again, its Update, another app's uninstall, and its own uninstall (refused first
  while a tab holds unsaved work). Each time the artifact opens, the daemon's log never says "is not installed", and
  the daemon has a new pid when the package it ran from moved (the same pid for the other app's uninstall).

Every test uses a throwaway profile (`HOME`, `OPEN_ARTIFACT_HOME`, `TMPDIR`) and a free port other than 4800, with a
whitelisted environment (`OPEN_ARTIFACT_BROWSER=none`, `OPEN_ARTIFACT_DESKTOP_LAUNCH=off`,
`OPEN_ARTIFACT_RUNTIME_UPDATE=off` and `OPEN_ARTIFACT_REGISTRY` on a closed loopback port
unless a test brings its fake registry; never the computer's policy file), and stops the daemons it started by the
pid in their `daemon.json`. In test mode, opening a folder, Show in Finder, the folder and file dialogs, Reopen,
About and full screen are only logged (a test gives Open Folder…, Import… and Move To… their path, and
`desktop.test.pickNext(path)` the next pick of a page's button such as Relocate…). Test mode only, in the bridge:
`desktop.test.saved(id, saved)` sets what a tab's Shell said of its saving, `openUrl(url)` is macOS's `open-url`,
`quit(force)` is ⌘Q (`force`: without asking, for a test's cleanup) and `closeWindow()` the window's close button. Set `OA_DESKTOP_KEEP=1`
to keep the profiles, `OA_DESKTOP_VERBOSE=1` to see the app's log.
