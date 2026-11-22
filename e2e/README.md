# End-to-end tests

These tests drive the built artifact types (`artifact-types/design`, `artifact-types/design-system`) the way an agent and a person use them. The agent runs `node scripts/cli.mjs …`, and the person works in the editor page in Chrome. Each type folder is copied to a temporary folder first, outside this repository, so nothing resolves from its `node_modules`.

```bash
npm run build
```

```bash
npm run e2e
```

Options:

| Option | What it does |
| --- | --- |
| `--only design,design-system` | Run some suites only (file names in `e2e/` without `.test.mjs`). |
| `--no-browser` | Skip the Chrome checks (`E2E_BROWSER=0`). |
| `--keep` | Keep the temporary folders and print their paths (`E2E_KEEP=1`). |
| `--dir <path>` | Test another copy of `artifact-types/` (`E2E_DIR`). |

Chrome is found in its usual places, or set `E2E_CHROME` to its path. `E2E_HEADFUL=1` shows the window. Nothing has to be installed: the tests use `node:test`, and Chrome is driven over the DevTools protocol with Node's own WebSocket.

Each test file runs its own server, with its own `OPEN_ARTIFACT_TYPE_SERVER_HOME` and `HOME`. It never meets the server you use yourself, or another test file's server.

When Chrome stops a frame's renderer (Chrome shows the frame as gone and the page around it carries on), the harness says so: the page gets a `renderer crashed: <frame>` problem, and a `waitFor` that times out or an `inFrame` that finds no framed page fails with that line, not with a plain timeout. Nothing is retried. Chrome keeps the crash's minidump in its own Crashpad folder (`~/Library/Application Support/Google/Chrome/Crashpad/completed` on a Mac).

## What is covered

`lib/editor.mjs` holds the path both types share. Each `*.test.mjs` file adds what only its type has.

**Shared, for both types**

- `--help`; an unknown command fails.
- `check`: a good artifact passes. A broken one fails, in text and in `--json`. A folder that is no artifact is named as such.
- `open`:
  - starts the server (`server.json`, live pid);
  - run again, reuses the server and the address;
  - scaffolds an empty folder (`--type`, `--title`), and the result passes `check`.
- The page and every file it names load. The session names the owner. `support.js` is served beside the project files. A token-only URL is redirected (308) to the URL with the trailing slash.
- Access:
  - a made-up token returns 404, and so does the token under the other type;
  - a request for another Host returns 403 (DNS rebinding);
  - `localhost` is allowed.
- Saving:
  - a save with `ifMatch` reaches the disk, and `_api/file` / `_api/files` report the new hash;
  - a stale `ifMatch` returns 409 `conflict` and writes nothing from the batch;
  - creating over an existing file is a conflict;
  - a save without `ifMatch` overwrites.
- Writes from another origin (`Origin`, `Sec-Fetch-Site: cross-site`) are refused. So are paths outside `project/`, `..`, and hidden files.
- Agent channel:
  - a request from the page waits in `_agent/inbox`, and `wait` hands it over and moves it to `done/`;
  - with `wait` running, the request is `delivered`;
  - a staged request is labelled as staged;
  - an empty request is refused;
  - control characters are removed;
  - `wait --timeout` exits 2 quietly;
  - `context` exits 2 before any page has written a view context.
- `upload` stores the file under `_blobs/`, and the server returns the same bytes at `/_blob/<id>`. The page's own upload of the same bytes gives the same URL.
- `status` lists the server and the open artifacts.
- `serve` (foreground, for a daemon):
  - prints the ready line;
  - `/__open-artifact/health` requires the secret;
  - `/__open-artifact/open` and `/__open-artifact/actions/check` work;
  - the server ends with its process.
- In the Open Artifact Shell (`open --shell`), the framed page:
  - sends `chrome_report`;
  - answers `chrome_hello`, `chrome_cmd exports` and `files_changed`;
  - reports a waiting agent.
- In Chrome:
  - the page opens with no errors and requests no host outside this computer;
  - it writes the view context that `context` prints;
  - a change on disk shows in the open page;
  - the session reports an agent while `wait` runs, and stops reporting it when `wait` ends.
- A second folder joins the same server at its own address, and a save through one address lands only in that address's folder. Eight editor tabs open on one server all still reach it, and each is counted as an open page. Each page's event stream is a WebSocket, so it does not use up Chrome's six HTTP connections per host. A folder of the other type joins the same server too, and `status` lists them all.
- `stop` ends the server and removes `server.json`. Run again, it says that no server is running.

**Design only** (`design.test.mjs`)

- `check` names the missing `support.js` line, and flags a board that `canvas.json` does not place.
- `list` finds design systems under the given folders, and returns none when there are none.
- In Chrome:
  - Send to agent: the composer's request reaches `wait`;
  - a board that throws shows its error, and "Ask agent to fix" sends it (`wait` receives the title and the error);
  - a pasted image is uploaded and becomes an image note in `canvas.json`;
  - PNG and PDF exports draw an artboard in the web font its own `@font-face` loads, a Flow artboard's paper pages too;
  - zoomed out below 30 %, an artboard shows a snapshot at its own size and in its web font, and zooming back in shows the same frame without booting it again;
  - a snapshot of an artboard set in a big CJK web font carries a subset of the font that still draws the artboard's ideographs;
  - Pages → Add page writes the page to `canvas.json`;
  - an unreadable `canvas.json` shows the banner, and the file is left unchanged.

**Design system only** (`design-system.test.mjs`)

- `check` refuses a namespace that is not a JavaScript identifier, and a `design-system.json` that is not valid JSON.
- `generate` writes `tokens.css`, and on a second run says the files are up to date.
- `upload --group` prints the record and its `indexPath`. Once written into the index, the record passes `check`. A group name with a slash is refused.
- `list` finds the design system.
- In Chrome:
  - the overview shows the README, and opening the page writes the generated files;
  - an empty system's Welcome page offers "From code", and its request reaches `wait`;
  - an image dropped on an asset group is uploaded into `design-system.json`.

**Sheets** (`sheets.test.mjs`)

- `read` on a folder with no Sheet is refused; a first `update` makes the Sheet (one blank `Sheet1`) and applies its edits.
- `read` gives values, and formulas with what they work out to; `formatCells` reads back through `readCellFormats`.
- A stale `base`, an unknown edit and an unknown key are refused as JSON on stderr, and the revision stays.
- `check` passes the Sheet. `export` writes an Excel file, and `--csv --sheet` the shown values of one sheet.
- `open` serves the page and reuses the address. In Chrome, the grid shows the sheet, and an `update` sent while it is open reaches the formula bar at once.
- `comments` lists no threads on a new Sheet; `stop` stops the server.

**Cloud host** (`host.test.mjs`, Chrome only)

- The real host (`packages/host`) on a free port, with its own data folder and an imported whiteboard. The app is on `localhost`, and each artifact is on its own `*.content.localhost` origin.
- The owner opens the printed sign-in address. The fragment fills the key, a click signs in, and the home page lists the artifact by its own title. Opening it frames the page on the content origin, and its session says owner.
- In Share, general access set to "Anyone with the link" shows the commenter link, which is on.
- A second Chrome with nothing in it opens the link, types a name and joins. Its page may comment (200) but not edit (403).
- The owner resets the commenter link. The guest's page loses access, and the old address says the link does not work.
- A real daemon (`open-artifact daemon run`, with its own home and port) is linked with `open-artifact remote add`; the owner approves the code in Chrome. A local whiteboard folder is published with `open-artifact publish <folder>`, and the cloud page draws it.
- On the cloud page, the owner comments with "Send to <agent>" on. `open-artifact wait` in the agent's session gets the comment.
- A file written in the local folder shows on the open cloud page without a reload. The daemon's folder watcher pushes it (the periodic rescan is off), the host's type server sees an outside change, and the page hears it over its event stream.

**Cloud host on a LAN, set up in advance** (`host-auto.test.mjs`, Chrome only)

- The real host on plain http under made-up private names: the app at `http://oa.lan:<port>`, each artifact at `http://<id>.oa-content.lan:<port>`. Without `OA_ALLOW_HTTP` and without a signing key: a private name is allowed both. Nothing resolves `.lan` here, so the daemon gets a `dns.lookup` preload (via `NODE_OPTIONS`) and Chrome `--host-resolver-rules`, both mapping `*.lan` to 127.0.0.1; the names are what decide whether http is allowed.
- `open-artifact-host link-token --user <email>` prints the Link token once, with the `OPEN_ARTIFACT_REMOTE` to set.
- A real daemon starts with only `OPEN_ARTIFACT_REMOTE`, `OPEN_ARTIFACT_REMOTE_TOKEN` and `OPEN_ARTIFACT_PUBLISH=auto`. With no `remote add` and no browser, `remote list` shows the remote named after the host, signed in as the person, as the default. `remote status` says the connection is plain http and that publishing is automatic.
- An artifact created through the CLI's Artifact tool is answered with its local `view_url` and a note that it is being published by itself. A later `read` gives its web address on the LAN name. The token is not in the daemon's log.
- In Chrome, the owner signs in with the printed key and opens that web address: the Shell frames the page on its `*.oa-content.lan` origin, and it draws.

**Exports on a cloud host** (`host-exports.test.mjs`, Chrome only)

- The same host, with one sample of each of the 8 types imported. The owner signs in and opens each.
- Every export the page offers is started with the real mouse (the Export tab, Motion's Export dialog, the design system's Download button) and must arrive as a browser download (`Browser.setDownloadBehavior`) with the right name, size and first bytes: `%PDF`, PNG, `PK` with the Office parts for .pptx/.docx/.xlsx, `ftyp` for MP4, `GIF8`, HTML, JSON. The host never renders.
- A Docs PDF opens the print view and calls its `print()` (stubbed before the click), with a toast that says to choose "Save as PDF"; no file is downloaded. A Data PDF prints the dashboard the same way.
- MP4 is skipped, and said so, where this Chrome has no H.264 encoder.
- With "Viewers can download and export" off, a viewer who joined by link is refused with a readable message and gets no file; turned on, the same export downloads.
- A to-do case: a Docs file keeps the doc's name (it needs the type server to expose `content-disposition` to the Shell).
