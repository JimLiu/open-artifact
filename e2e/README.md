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

`e2e/sea/sea.test.mjs` is not one of these suites: `npm run test:sea` builds the single executable and runs it with no `node` on `PATH` (the daemon, a static and a server type's artifact, `harness --stdio` and `doctor`). It needs an official Node.js build of 25.5 or later (`OPEN_ARTIFACT_SEA_NODE`), and `npm run build` and `node scripts/build-skill.mjs` first; otherwise it is skipped and says why.

Chrome is found in its usual places, or set `E2E_CHROME` to its path. `E2E_HEADFUL=1` shows the window. Nothing has to be installed: the tests use `node:test`, and Chrome is driven over the DevTools protocol with Node's own WebSocket.

Each test file runs its own server, with its own `OPEN_ARTIFACT_TYPE_SERVER_HOME` and `HOME`. It never meets the server you use yourself, or another test file's server.

`run.mjs` points `OPEN_ARTIFACT_HOME_WORKSPACE` at a temporary folder (unless you set it): an artifact a suite makes without naming a folder, from a session of an app without a profile, goes under the person's Open Artifact folder, and that must never be your real `~/OpenArtifact`.

When Chrome stops a frame's renderer (Chrome shows the frame as gone and the page around it carries on), the harness says so: the page gets a `renderer crashed: <frame>` problem, and a `waitFor` that times out or an `inFrame` that finds no framed page fails with that line, not with a plain timeout. Nothing is retried. Chrome keeps the crash's minidump in its own Crashpad folder (`~/Library/Application Support/Google/Chrome/Crashpad/completed` on a Mac).

The harness asks its questions (`waitFor`, `evaluateAll`, `load`'s `ready`) in a tab's page and frames only, never in a worker: workers are attached so their errors and exits are seen, and that is all. Chrome 157 stops the renderer when `location` is read in a module worker whose script has not all arrived, and the suites' questions start with `location.hostname…`. That was the `renderer crashed: iframe …/whiteboard/…` the Cloudflare suites showed on about one first load in four (the whiteboard starts its `whiteboard-looks` worker while the test waits for the board). `browser-lib.test.mjs` holds the case.

`cloudflare.test.mjs` seeds its rooms from fixture folders in `test-artifacts/` and compares a room's files with the folder's. Both sides leave out what git does not keep there: the folder's `.gitignore` and the machine-local state it names (`_agent/`, `history/`, `.artifact*`, `.sharing.json`, `*.log`, `*.tmp`, `.DS_Store`), which opening a fixture on your computer leaves behind. A local run so seeds what CI seeds (`packages/host-cloudflare/test/room-node.test.ts` does the same).

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
  - Send to agent with two elements selected (a click, then a Shift-click on the artboard) and two lines typed: the request in `_agent/done` has `userText` with the line break, its `text` starts with it, and its `selectionSnapshot` says `2 selected elements` with both items (and no `where`: the fixture canvas names no page), though Escape clears the selection right after Send;
  - Send to agent with 2,667 CJK characters (8,001 bytes of UTF-8) is not sent: the page says "That’s too long to send.", the composer stays open with the draft, and nothing is queued;
  - a comment in the Shell's comment layer: the box stops at 4,096 characters (its `maxLength`); 1,366 CJK characters (4,098 bytes of UTF-8) are not sent, the page says "That comment is too long." and the draft stays; a short comment is then saved to `comments.json` and listed in the comments panel (as the owner and as a commenter by link);
  - a board that throws shows its error, and "Ask agent to fix" sends it (`wait` receives the title and the error);
  - "1 error" at the top right lists the artboards with errors and its "Ask agent to fix" sends them all; closing an artboard's error notice leaves a mark in its name strip that brings it back;
  - a pasted image is uploaded and becomes an image note in `canvas.json`;
  - PNG and PDF exports draw an artboard in the web font its own `@font-face` loads, a Flow artboard's paper pages too;
  - with WebGL, live artboards stay visible throughout zoom gestures, and the overview stays stable around 30 % until zoom reaches 32 %;
  - in WebGL and DOM, artboard titles, controls, and size labels keep their CSS dimensions as the board and its grid move through each zoom frame, and the title still selects, moves and renames the board;
  - zoomed out below 30 %, an artboard shows a snapshot at its own size and in its web font, and zooming back in shows the same frame without booting it again;
  - a snapshot of an artboard set in a big CJK web font carries a subset of the font that still draws the artboard's ideographs;
  - Pages → Add page writes the page to `canvas.json`;
  - a right-button drag that starts on an element of the artboard pans the canvas by the distance dragged, keeps the selection where it was, and opens no menu; a right-click without travel still opens the menu;
  - an unreadable `canvas.json` shows the banner, and the file is left unchanged.

**Design system only** (`design-system.test.mjs`)

- `check` refuses a namespace that is not a JavaScript identifier, and a `design-system.json` that is not valid JSON.
- `generate` writes `tokens.css`, and on a second run says the files are up to date.
- `upload --group` prints the record and its `indexPath`. Once written into the index, the record passes `check`. A group name with a slash is refused.
- `list` finds the design system.
- In Chrome:
  - the overview shows the README, and opening the page writes the generated files;
  - an empty system's Welcome page offers "From code", and its request reaches `wait`;
  - an image dropped on an asset group is uploaded into `design-system.json`;
  - in Add color group, the Enter that picks an input method candidate (key code 229, `isComposing` false, as Safari sends it) adds nothing and leaves the dialog open; a plain Enter then adds the group. Before, the name field read only `isComposing`, and on Chrome did not check at all.

**Slides: asking about a selection** (`slides.test.mjs`, on the shared deck's third slide, with `wait` running)

- A click on the heading and a Shift-click on the list select two elements; the Ask field says it asks about the selection. A request typed there and sent with Enter reaches `wait`, and in `_agent/done` it has `userText`, a `text` that starts with it, and a `selectionSnapshot` of `2 selected elements` on `Slide 3 of 3`, though Escape clears the selection right after Send.
- The Ask takes as many UTF-8 bytes as the Shell's (8,000, `MAX_ASK_BYTES`): 2,667 CJK characters (8,001 bytes, far under 8,000 characters) sent with Enter are not sent, the page says "That’s too long to send." and the words stay in the field. Words of exactly 8,000 bytes then reach `wait` whole: in `_agent/done` the request's `userText` is all of them, and its `text` starts with them and ends with the fenced selected element's closing marker (the type server keeps room for what follows the words). Before, the field stopped at 4,000 characters, a failed send cleared it, and the type server cut a request's `text` at 8,000 characters.

**Slides: polygon clipping** (`slides.test.mjs`, on the shared deck's second slide)

- `deck.css` gives a `--cut` token to a `clip-path:polygon(…)` with `calc(100% - var(--cut))`; the presenter shows the photo with that clip.
- The editable PowerPoint export draws two plain panels of different widths as custom shapes with the same 12px cut, a triangle and a concave arrow as custom shapes with their exact vertices, the clipped photo as a cropped picture cut to the polygon, and a clipped panel holding text as one picture (its text is not exported as text).

**Slides: links from the Shell** (`slides.test.mjs`, a deck the daemon opens in the real Shell)

- Copy link to slide (⌘⌥L) copies an invite link (`/s/…`) at the network address with the slide, not the `127.0.0.1`
  page (`/a/…`), and the note says the deck is shared on the network now.
- The title menu's Copy link and the Export tab's Copy link copy that same link, word for word.

**Slides: a refused drawing** (`slides.test.mjs`, a one-slide deck of its own, Chrome only)

- The slide's `<svg>` holds `<style><img src="x" onerror="…"></style>`: in an svg a `<style>` holds markup and `<img>` leaves the svg for HTML, so a check that reads `<style>` as text sees no handler. `check` fails with `<svg> holds <img>`; in Chrome the slide is held ("This slide's file has errors"), no element carries `onerror`, the handler never ran, and every drawn svg (stage and rail) is empty. Before the fix for PR #36, a held slide still drew the drawing's source, and this one ran its handler.

**Slides: an empty deck** (`slides.test.mjs`, a deck of its own with an empty `order`, Chrome only)

- The empty state is one line ("This presentation has no slides yet. Add one…") centred on the whole stage, within 2px; the top-left Add slide / View card is not shown, so its Add slide is the only one. Before, the empty state hugged the stage's left edge under that card.
- Its Add slide opens the "New slide" layout picker with Blank focused, and `deck.json` still has no slides; picking Title adds one slide to the rail and saves it with the Title layout's text. Before, Add slide added a blank slide at once.

**Slides: where the controls sit** (`slides.test.mjs`, the two-slide inline-style deck, Chrome only)

- View heads the rail; the top-right row has Add slide right before Present, and no other Add slide is on the page.
- The bottom-right card holds the pager and the zoom, right of the insert toolbar and within 16px of the stage's right and bottom edges. It reads `1 / 2` with Previous slide unavailable; Next slide shows the second slide (`2 / 2`) and Previous slide comes back.
- Video is a button of its own beside Image or video: its menu has Upload video… and Embed a video link…, which opens the video link dialog. On a deck without slides the waiting insert tools are Text, Image or video, Video, Table and Shapes.

**Slides: who else is here** (`slides.test.mjs`, the two-slide inline-style deck in two tabs, Chrome only)

- With a second viewer on the deck, the "People here and following" button shows at the top-right, level with the row of Add slide and Present, and neither it nor anything around it up to that row has a background or a shadow: it is a plain button on the stage, not a floating card.

**Slides: a narrow window and the Comment button** (`slides.test.mjs`, the two-slide inline-style deck in its Shell, Chrome only)

- At 1400px the rail shows and the pager card sits beside the toolbar. The toolbar's Comment button turns comment mode on (pressed) and opens All comments; the stage ends where the panel's reserved room starts, and the properties panel is not shown under it. Comment again closes both.
- At 900px the rail hides, View moves over the stage, and the toolbar ends left of the pager card. At 640px the pager card goes above the toolbar (`data-open-artifact-corner="above"`) without overlapping it.
- View › Slide thumbnails shows the rail in the narrow window; back at 1400px the rail shows and the card is beside the toolbar again.

**Slides: videos** (`slides.test.mjs`, a deck of its own with an uploaded clip recorded in the browser and a YouTube video with an uploaded still, Chrome only)

- In the editor a round play sign covers the clip on the stage, and a larger one each video in the rail.
- Presenting the clip: it starts with its slide, with no play button over it; moving over it shows the bar at its bottom-left with Restart, Pause and Unmute. A click on the clip pauses it without turning the slide and brings up the play button, which plays it again; Unmute turns the sound on.
- Presenting the YouTube video: its still and a play button show and no player loads until the button is pressed; then one player frame loads in the presentation with `autoplay=1` and `referrerpolicy="strict-origin-when-cross-origin"` (YouTube refuses an embed with no Referer), and the slide stays. The frame is emptied as it is added, so the test needs no network.

**Slides: page numbers of slides that arrive** (`slides.test.mjs`, a source deck of its own, Chrome only)

- The deck's sheet numbers its pages (`section { counter-increment: page }`, `.folio::after { content: "Page " counter(page) }`). Its `deck.json` lists four slides and only the first is written when the editor opens it.
- The second slide is written to disk: the rail shows it as Page 2. The fourth is written before the third: it is Page 3, the third page among the slides there are. The third is written: it is Page 3 and the fourth becomes Page 4, on the stage too. Before the fix, every slide that arrived in the open page showed Page 1.
- The first slide's file is deleted: the others become Pages 1 to 3. A second tab that loads the deck whole shows the same numbers, and the slide files and `deck.json` are as they were written.

**Slides: page numbers after a move or a delete in the editor** (`slides.test.mjs`, a three-slide source deck of its own with the same sheet, Chrome only)

- The third slide's title is retyped on the stage and saved into its own markup. Move up in its rail menu makes it Page 2 and the slide it passed Page 3, in the rail and on the stage; `deck.json` gets the new order and no slide file changes. Before the fix, each slide kept the number it was read with until the page was reloaded.
- ⌘Z takes the move back (numbers and `deck.json`), and a second ⌘Z the retyped title, with no warning that someone else changed the slide; the file is the one first written, not a flat copy.
- Delete in the first slide's rail menu makes the others Pages 1 and 2 and removes its file. Once that save has come back, ⌘Z brings the slide and the numbers back, and the other two files are as written.

**Sheets** (`sheets.test.mjs`)

- `read` on a folder with no Sheet is refused; a first `update` makes the Sheet (one blank `Sheet1`) and applies its edits.
- `read` gives values, and formulas with what they work out to; `formatCells` reads back through `readCellFormats`.
- `writeCells` takes formulas with many words of their own (Chinese or English texts in quotes), and more than 50 different ones in one edit: the page shows such formulas to the person before pasting them (`toBeShownFirst`), but an agent's write shows nothing first.
- A stale `base`, an unknown edit and an unknown key are refused as JSON on stderr, and the revision stays.
- `check` passes the Sheet. `export` writes an Excel file, and `--csv --sheet` the shown values of one sheet.
- `open` serves the page and reuses the address. In Chrome, the grid shows the sheet, and an `update` sent while it is open reaches the formula bar at once.
- `comments` lists no threads on a new Sheet; `stop` stops the server.

**Docs: writing in a second tab** (`docs.test.mjs`, one case, Chrome only)

- A doc with two tabs is opened on the first. Three characters are typed there, one at a time, and each reaches the disk (`export --tab`). The second tab is chosen from the tab list in the page bar, and four characters are typed at the end of its line: each reaches the disk, and 400 ms later the editor still shows it. Before the fix for issue #25, every tab's sync counted its calls from 1 under the page's one session, so the second tab's first three writes went out under the first tab's opIds; the server answered them as replays, landed nothing, and the page read the tab back over the typing.

**Docs: name fields and the input method's Enter** (`docs.test.mjs`, the "keeps the daemon library, editor title and tab links in sync" case, Chrome only)

- In Rename (the doc's own Document name field, in the docs frame) and Duplicate (the Shell's Name of the copy), an Enter with key code 229 and `isComposing` false, the way Safari sends the Enter that picks a candidate, neither renames nor copies, and the field keeps the focus; a plain Enter then does. Before, these fields read only `isComposing`, so on Safari picking a Chinese or Japanese candidate also submitted the name.

**Docs: a link the page may not open** (`docs.test.mjs`, one case, Chrome only)

- An agent's `update` writes `[the bad one](javascript:…)` and `[the good one](https://example.com/a)`; the stored doc keeps both addresses (`read --markdown`). The editor draws the first as an `<a>` with no `href` and the second with its address, and no link on the page starts with `javascript`. Before the fix for PR #36, the editor and its read-only views (a version, a deleted tab) drew any stored address as the link's `href`.

**Docs: Ask Agent's words and line** (`docs.test.mjs`, the first case of the "Ask Agent as a comment on an agent chip" group, Chrome only)

- With `wait` running, `@` → Ask Agent at the end of "The ferry leaves at nine." puts the agent chip in, and "Say when the last ferry leaves" plus Enter posts the `@Agent` thread on it. The request in `_agent/done` has `userText` "Say when the last ferry leaves", its `text` starts with those words and then "(The person wrote this in the comment thread on "@Agent" …", and its `selectionSnapshot` is `{kind: 'line', label: 'The ferry leaves at nine.', count: 1, items: [{id: <the line's block>, kind: 'block'}], text: …}`: the line without the chip, and no `where` in a one-tab doc.
- An Ask is a comment, so it takes what a comment takes (4,096 bytes of UTF-8, `@Agent ` included): 1,364 CJK characters at "Bikes ride free." are refused with "That comment is too long.", the draft stays in the prompt, and no chip or thread is added. Before, the words were cut to 4,000 characters without a word.

**Docs: wide tables** (`docs.test.mjs`, two cases in the "wide tables and folded sections" group, Chrome only)

- A tall 16-column table docks a scrollbar at the foot of the window, from its wrapper's left edge; the bar and the table scroll together, and at the right end the table is no longer cut off on its right.
- A 26-column table starts at the text's left edge, and its wrapper reaches to 24 px from the page's left edge. Scrolled by the width of the space left of the text, it is drawn there (a cell is under a point 40 px from the page's edge) and is cut off on both sides (`data-clip="left right"`, with the left edge drawn); at its right end only on the left. An 8-column table wider than the text that fits the room beside it starts at the text and does not scroll. Before the fix for issue #26, the wrapper stopped 48 px left of the text, so a scrolled table was cut off there and the space left of the centred text stayed empty.

**Data: claude.ai token names** (`data.test.mjs`, a check case each way and one case in Chrome)

- A page whose CSS writes the names of the dashboards on claude.ai (`--cds-pad-lg`, `--cds-gap-md`, `--cds-radius`, `--font-anthropic-serif`, `--cds-chart-status-critical`) passes `check`; a claude.ai name with nothing behind it here (`--cds-text-accent`) fails it with an error saying only the names in `reference/design-defaults.md` are set.
- In Chrome, the fixture dashboard opens under a `dash/look` with its own light colors and 4px corners. In light and in dark mode, every claude.ai name computes to the value of the token it stands for, and a probe drawn with the claude.ai names draws as its twin drawn with the tokens: 16px padding, the look's corners, the serif font, the critical chart color and the popover surface, which is the look's card in light and the dark theme's own in dark. Before, most of those names were set nowhere and fell back to nothing.

**Data: printing** (`data.test.mjs`, one case, Chrome only)

- The fixture dashboard, opened by `open`, is laid out for print (`Emulation.setEmulatedMedia`) and sent `beforeprint`, as Print… and the browser's Print both mark the dashboard's path. The dashboard prints at its full length with its title, the data note prints under it, and nothing of the editor around it shows; `afterprint` clears the marks. Before the fix for issue #24, the sheet held only the data note.

**Data: the PDF file** (`data.test.mjs`, one case, Chrome only)

- The fixture dashboard is framed by a stand-in Shell page, as `open --shell` serves it. Its report lists `pdf`, `print`, `html` and `json`; only `print` says it opens something first.
- The Signups tab is opened (a bar chart drawn by script at the dashboard's width), and the page is given a print rule of its own that sends the note under the chart to a new sheet, with a screen rule that says the opposite.
- `export_format pdf` answers `started` then `done` and saves `Sales and signups.pdf` into the test's own Downloads folder, with no print dialog. The file is a PDF of three US Letter sheets on their side (the print rule applied, the screen one did not; a box that scrolls on screen is printed whole, its 60 rows running onto the third sheet; the dashboard is wider than the paper), and the first sheet's picture is the dashboard's width at two pixels a CSS pixel, mostly light, with ink on it.
- Afterwards the live page holds neither the export's hidden frame nor a print mark, and reads as it did before.

**Data: a calculation that reads the filters** (`data.test.mjs`, one case, Chrome only)

- The fixture dashboard gets two calcs over the signups file, which no filter reloads: one whose `fn` calls `dash.params()` and returns the region with the row count, one that only counts. Each is drawn once and has run once.
- The page calls `dash.setParams({region: "South"})`: the first calc shows `South:6` and has run twice, the second still shows 6 and has run once. The page's Clear filters button takes the first back to `all:6` on its third run. Before the fix, `dash.params()` did not go through the calculations, so the first calc kept `all:6` whatever the filter.

**Cloud host** (`host.test.mjs`, Chrome only)

- The real host (`packages/host`) on a free port, with its own data folder and an imported whiteboard. The app is on `localhost`, and each artifact is on its own `*.content.localhost` origin.
- The owner opens the printed sign-in address. The fragment fills the key, a click signs in, and the home page lists the artifact by its own title. Opening it frames the page on the content origin, and its session says owner.
- In Share, general access set to "Anyone with the link" shows the commenter link, which is on.
- A second Chrome with nothing in it opens the link, types a name and joins. Its page may comment (200) but not edit (403).
- The owner resets the commenter link. The guest's page loses access, and the old address says the link does not work.
- A real daemon (`open-artifact daemon run`, with its own home and port) is linked with `open-artifact remote add`; the owner approves the code in Chrome. A local whiteboard folder is published with `open-artifact publish <folder>`, and the cloud page draws it.
- On the cloud page, the owner comments with "Send to <agent>" on. `open-artifact wait` in the agent's session gets the comment.
- A file written in the local folder shows on the open cloud page without a reload. The daemon's folder watcher pushes it (the periodic rescan is off), the host's type server sees an outside change, and the page hears it over its event stream.

**A whiteboard reloads on a slow cloud host** (`host-refresh.test.mjs`, Chrome only)

- The same host with an imported whiteboard, behind a small proxy that holds `_api/db` and `_api/session` requests for 800 ms. Every load gets a new page token in its path (`/whiteboard/v1.<token>/`).
- On first open and on reload, the Shell's cover is never lifted while the board is empty or under its "Opening the board…" veil, and the Share button stays where it first showed.
- The owner zooms out with ctrl + wheel. Two reloads open at that zoom. Storage then holds one camera (`wb-camera:artifact:<id>`) and one saved copy (`wb-copy:…`). A whole-board copy and a camera that an older page filed under its own token (`wb-saved-copy:/whiteboard/v1.…`) are gone.
- Dragging an element with the real mouse while writes are slow never shows "Couldn't save". "Saving…" shows, then goes once the write lands.
- The owner drags an element and at once picks Refresh in the artifact options. The page's own address is held for 2.5 s and writes for 0.4 s, so the old page hears its move was saved and reports it before the new page comes. The cover stays until the new page's board shows: never over the old page's report, never on the new page's veil.
- With `_api/db` held past the Shell's cap, the cover goes about `CHROME_READY_TIMEOUT_MS` (10 s) after the reload. A page that reports `ready: false` cannot keep it up for longer.

**The Shell over a static page** (`shell-frame.test.mjs`, Chrome only)

- A real daemon, started in the test's own process from source in a temporary home, with a user type `linked`: a static page of two files (`index.html`, `two.html`) that link to each other.
- Following the link inside the page, with the real mouse, both ways: the new page shows and the Shell never covers it (a static page never reports, so nothing would lift a cover before `FRAME_READY_FALLBACK_MS`).
- Refresh in the artifact options covers the page, and the cover goes on the page's `load`, well before the 1.5 s fallback.

**Making an artifact without an agent** (`home-new.test.mjs`, Chrome only)

- A real daemon, started in the test's own process from source in a temporary home, and no agent session.
- The home page's **New** lists Docs under "Start right away" and Design under "Make with an agent"; choosing Docs, a title and Create opens the Shell on the doc's editor, not the empty state, and the doc has `doc/doc.json` and no owner.
- An empty whiteboard opens on the empty state with its hand-over prompt; **Start blank** opens its editor. An empty design shows no **Start blank**.
- A Design System made blank opens on its welcome page; **Start by hand** brings its Colors section into view.
- A blank doc no session owns: with no session online, its Ask pane offers the take-over prompt; a message sent from it waits in the unowned inbox, and a session that adopts the doc later gets it in that call's result, once.
- With a session online (a polling session attached in the test), the Ask pane lists it; **Hand over** makes it the doc's owner, and it gets what was sent at once.

**The MCP App view in a host on a public address** (`mcp-app.test.mjs`, Chrome only)

- A real daemon, started in the test's own process from source in a temporary home, with a user type `linked`: one static page. The test reads the view resource (`ui://open-artifact/view.html`) and calls `ShowArtifact` over the daemon's `/mcp`, as an MCP Apps client does.
- A stand-in MCP Apps host: a page on 127.0.0.1 that Chrome is told is public (`--ip-address-space-overrides`), as Codex keeps its apps on a web address. It frames the view from a second such origin with the CSP of the view's `_meta.ui.csp` (or, with `?csp=codex`, the two CSPs of a Codex card: its sandbox's `frame-src 'self' https: data: blob:`, and the app's with every frame domain that is not https left out), answers `ui/initialize`, sends ShowArtifact's result as `ui/notifications/tool-result`, and answers `ui/open-link` in one of four ways (opens it, `isError`, never answers, offers no `openLinks`). It grants the page the Chrome permission for each network permission the view declares in `_meta["openai/ui"].permissions`, or denies it (Chrome DevTools `Browser.setPermission`).
- The view declares `loopbackNetwork`, and with it granted the static page shows inside the Shell inside the view; the view's notice stays hidden past its wait for the Shell's `shell_hello`.
- With it denied, Chrome blocks the frame (Local Network Access), and the view says the page did not show, naming its address, with Retry, Open in browser and the address to copy. Open in browser sends `ui/open-link` with `view_url`; the host opens it, so the notice does not say the page may not have opened. Once the permission is granted, Retry shows the page and the notice goes.
- When the host answers `ui/open-link` with `isError`, offers no `openLinks`, or never answers, Open in browser shows `view_url` to copy: at once on the host's answer, after the view's 3 s wait when none comes. Close hides it, and the page stays.
- With a Codex card's CSP, the view hears the refusal (`securitypolicyviolation`) and says so before its 4 s wait for `shell_hello` ends: the app does not let the page's address show in the conversation, with Open in browser and the address to copy, no Retry, and the browser's own error page hidden. Open in browser sends `ui/open-link`, and the notice stays as it was after the wait.

**Cloud host on a LAN, set up in advance** (`host-auto.test.mjs`, Chrome only)

- The real host on plain http under made-up private names: the app at `http://oa.lan:<port>`, each artifact at `http://<id>.oa-content.lan:<port>`. Without `OA_ALLOW_HTTP` and without a signing key: a private name is allowed both. Nothing resolves `.lan` here, so the daemon gets a `dns.lookup` preload (via `NODE_OPTIONS`) and Chrome `--host-resolver-rules`, both mapping `*.lan` to 127.0.0.1; the names are what decide whether http is allowed.
- `open-artifact-host link-token --user <email>` prints the Link token once, with the `OPEN_ARTIFACT_REMOTE` to set.
- A real daemon starts with only `OPEN_ARTIFACT_REMOTE`, `OPEN_ARTIFACT_REMOTE_TOKEN` and `OPEN_ARTIFACT_PUBLISH=auto`. With no `remote add` and no browser, `remote list` shows the remote named after the host, signed in as the person, as the default. `remote status` says the connection is plain http and that publishing is automatic.
- An artifact created through the CLI's Artifact tool is answered with its local `view_url` and a note that it is being published by itself. A later `read` gives its web address on the LAN name. The token is not in the daemon's log.
- In Chrome, the owner signs in with the printed key and opens that web address: the Shell frames the page on its `*.oa-content.lan` origin, and it draws.

**Harness compatibility** (`harness-compat.test.mjs`; the Chrome cases are skipped, and say so, with `--no-browser`)

- A real daemon (`open-artifact daemon run` from source, in a temporary `OPEN_ARTIFACT_HOME`) with two user types: `note`, a static page, and `farstub`, a URL type at `http://0.0.0.0:<port>/far/{id}`. It counts as remote because 0.0.0.0 is not a loopback name, but a stub on this computer answers it.
- Two hosts are built in-process from the reference host's modules (`examples/harness-node`: `connectHarness`, `ScriptedAgent`, `wakeHandler`, `registerTools`):
  - `compat-frame` frames the Shell from host page origin A, with `embed.remote: deny`, rules, a `policy.roles` entry and a profile `title` (`Compat Frame`);
  - `compat-view` shows top-level views, with `embed.remote: allow`.
- (a) `open-artifact doctor --harness compat-frame --session compat-1 --json`, run as its own process, passes every conformance step in order. Each step's verdict is `ok`, and what needs a person or a browser is `n/a`. The host gets exactly one `host.open` and one wake from the owner, and doctor removes its test artifact. The remote-type check finds the stub answering and warns that `compat-frame` denies it, naming the fallback. The stub is never sent a token.
- (d) `host.open` for a `farstub` artifact carries `remote` `{type, origins}` to the allow host. The deny host's `open` is never called, and the artifact is not reported as shown.
- (e) A host says in `hello` the runtime the DSH plugin declares (`runtimeOf()` of `plugins/dsh`, the built plugin folder). The daemon records it in `runtimes.json` with `update: bundled`, logs nothing as "not recorded", and `open-artifact runtime status --json` lists the folder as a registered runtime of that harness. Skipped, and says so, when `plugins/dsh` is not built.
- (c) Without a browser, a top-level view's `host.open` carries a ticket and `embed_url` (`/a/<id>?oa_view=<ticket>`). The ticket is claimed from Node as the Shell would claim it, and a second claim gets 404. `shell.command` comes down the stream, and a posted event reaches the adapter as `shell.event`.
- (c) In Chrome, the Shell loaded at `embed_url` claims the ticket, says `shell_hello` through the daemon, and takes the ticket out of the address bar. A `host_hello` sent with `shell.command` gets `shell_ready` back as `shell.event`, and a second claim gets 404.
- (c) In Chrome, a page on an undeclared origin frames `embed_url`. The framed Shell still talks through the daemon: `shell_hello` and `shell_ready` reach the adapter, and the parent page hears nothing.
- (b) In Chrome, a host page on each of two 127.0.0.1 ports frames the Shell and answers `shell_hello` with `host_hello`. The Ask goes through the real mouse and keys.
  - On origin A, which is declared, a draft one byte over 8,000 bytes of UTF-8 (`MAX_ASK_BYTES`; it ends in an emoji) stays in the Ask pane, marked invalid, with Send off. With the last character removed it is sent: the Shell says `shell_ready`, and the Ask sends `comment_summon` with the whole text and wakes the owner session with the same text. That wake's request has the same text as `userText` and no `selectionSnapshot`, and `requestBubbles` (examples/harness-node) shows it as the owner's message. The Ask pane names the owner session by the profile title (`Compat Frame`), never by the id `compat-frame`.
  - On origin A again, the page sends `host_hello` with a dark theme and the accent `#ffee00`: the Shell's root gets `data-theme="dark"` and the three accent properties, the text colour `#0b1220` included. Then the Shell's next read of the declared list fails, and the page sends a light theme without an accent. The Shell's root is light, the accent the dark theme set is gone, and the Ask's `comment_summon` still carries the text: a failed refresh does not make the declared host undeclared. (Before the fix, the old accent stayed, and the host lost its texts.)
  - On origin B while A is declared, the page hears nothing after `shell_hello`, even though the Ask is sent and wakes the session.
  - On origin B once `compat-frame` has gone and no origin is declared at all, the page is taken (`shell_ready`), but `comment_summon` comes with empty text.
- The same cases against the two previous minor versions of `@open-artifact/harness-kit` from npm have a place at the end of the file. That place is skipped, and says why: the kit is not published yet. To run it, install each version into a temporary folder and build the hosts with its `createHarness`.

**Pi** (`pi.test.mjs`, no browser; skipped, and says why, when `pi` is not on `PATH` or Node.js is older than 22.19)

- The real `pi` command loads the extension from `plugins/pi` (`pi -e plugins/pi`) against a real daemon (`open-artifact daemon run` from source, in a temporary `OPEN_ARTIFACT_HOME`, with a `note` user type). The model is a scripted local endpoint (OpenAI chat completions, streamed) named in the `models.json` of a temporary Pi agent folder (`PI_CODING_AGENT_DIR`, with `PI_OFFLINE=1`). Nothing reaches the network, and your own Pi settings, sessions and sign-ins are not read.
- (a) Print mode (`pi -p`): the model is offered Artifact, ArtifactData and ArtifactComments with the daemon's parameters, and its system prompt has the `<open_artifact>` section. Its `Artifact {action: "list"}` call reaches the daemon: while the call runs, the daemon lists a `pi` adapter with a session in the test folder. The daemon's answer comes back as the tool result. The skill is written to `<home>/skills/pi/open-artifact/SKILL.md`.
- (b) `Artifact {action: "read"}` of an artifact that does not exist comes back to the model as a failed tool result with the daemon's `not_found`. Arguments the schema refuses never reach the daemon, because Pi checks them against the daemon's schemas first.
- (c) RPC mode (`pi --mode rpc`, kept running): the session attaches at start, since a daemon runs. `open-artifact doctor --harness pi --session <id> --json` passes every conformance step, and `session`, `tools`, `commands` and `wake` are `ok`. The doctor's wake (a request from the page, in the owner's words) starts a Pi turn whose last message is a user message with the doctor's text. The suite prints each step that is not `ok`.
- The collaborator's and the system's wakes (a custom message, never a user message), Esc during a call, the status, `agent.wrote` and the command are covered by the unit tests in `plugins/pi/test/`.
- `OA_E2E_PI_EXTENSION=<folder>` runs the suite against another copy of the extension, such as the staged `dist/npm/pi-open-artifact` packed and installed with npm, to check the package as Pi users get it.

**Type servers in worker threads** (`node-threads.test.mjs`, no browser)

- A real daemon (`open-artifact daemon run` from source, in a temporary `OPEN_ARTIFACT_HOME` on a free port) with `OPEN_ARTIFACT_NODE_CHILDREN=threads`, the mode an Electron app with its `RunAsNode` fuse off ends up in. Its built-in types are copies of `slides` and `docs`; a host connects with `createHarness`.
- (a) `/__open-artifact/health` reports `nodeChildren` `{mode: threads, reason: env}`; `open-artifact doctor --json` has the `node-children` check saying worker threads; the daemon log says the mode once.
- (b) Slides: create, open (the server is ready in a thread: `(thread N)` in the log, no pid), publish a slide, the `view_url` answers 200 and `check` works.
- (c) Docs: created through the `create` call and read back.
- (d) A type change (the manifest touched, `builtin/.changed` written) stops the docs server through its `SIGTERM` handler (`--- exit 0` in its log); the next call starts a new thread.
- (e) `SIGTERM` to the daemon: it waits for its threads and exits 0, `daemon.log` has `daemon <version> stopped (SIGTERM)` once, every server log ends with `--- exit 0`, `daemon.json` and the lock are gone, the ports refuse connections and no process is left.
- Not covered here: a real Electron utility process (it was checked by hand, see `docs/integrating/runtime.md` and `examples/harness-electron/README.md`, the stop on quit included) and the other six built-in types in threads.

**Where new artifacts go** (`artifacts-location.test.mjs`; (i) in Chrome)

- A real daemon (`open-artifact daemon run` from source) with a temporary `HOME` and `OPEN_ARTIFACT_HOME` and no settings, real Git checkouts (`git init`, `git worktree add`), and the `open-artifact` command line run in them as an agent's session would (`artifact '{…}'`) and as the person would (`config set`). `note` is a static user type, so nothing has to be built. Skipped when `git` is not installed.
- (a) With nothing set, a session of an app without a profile makes the artifact under the person's Open Artifact folder, `~/OpenArtifact/<project>/<slug>`, from a folder deep in the checkout: the project's folder carries `.open-artifact-project.json`, the result says the files are outside the working folder, `git status` is clean, and the session lists it again.
- (b) A session of an app whose profile keeps artifacts in the workspace (`--harness claude-code`) makes it in the checkout's `artifacts/<slug>`; the daemon writes `artifacts/.gitignore`, so `git status` stays clean. An `artifacts/` folder that was already there gets no `.gitignore`.
- (c) `location: "workspace"` and `location: "home"` move one artifact either way (a workspace asked for is not hidden from git); `folder` still wins; an unknown `location` is `invalid_argument`.
- (d) `open-artifact config set artifactsLocation home` comes before the app's default, `workspace` leaves git to show the folder, and `config unset` gives the default back. Run inside an agent's session (`CLAUDECODE`), `config set` is refused and nothing is saved.
- (e) `config set … --project` writes `.agents/open-artifact/settings.json` at the top of the checkout from a folder deep in it; its `artifactsDir` is used; `trustedProjects`, `homeWorkspace` and `cloud` in that file are listed as ignored and change nothing. `config set … --local` comes before the file without touching it, and `config unset … --local` leaves the person's file empty.
- (f) A linked worktree is the same project: both make their artifacts in the same folder under the Open Artifact folder, a new session in the worktree lists both, and a session in another checkout lists none.
- (g) Two checkouts with the same folder name get two folders (`app`, `app-<4 hex digits>`), each stable for its project, and neither session lists the other's artifacts.
- (h) `open-artifact doctor --json --harness claude-code` in a checkout: `artifacts-location` says the workspace and that it is the app's default; after `config set artifactsLocation home --local` it is a warning that names `claude --add-dir <the Open Artifact folder>`, which goes away once `~/.claude/settings.json` lists the folder under `permissions.additionalDirectories`; `--harness pi` needs nothing. A project file with `trustedProjects` makes `project-settings` a warning naming the key, and nothing fails.
- (i) In Chrome (skipped without it or without the built home page), the daemon's home page: every card of a session's artifact names its project by the folder's name; the row of projects above the list tells two projects of one name apart by the folder each is in and says how many artifacts each has; picking one shows that project's artifacts only (kept in the Open Artifact folder, outside the checkout), and **All** brings the rest back.

**Workspace confinement** (`workspace-confinement.test.mjs`, no browser)

- A real daemon (`open-artifact daemon run` from source, in a temporary `OPEN_ARTIFACT_HOME`) started with `OPEN_ARTIFACT_WORKSPACE_FOLDERS_ONLY=1`, as a sandboxed agent host runs it. The built-in `docs` and `whiteboard` run from the built tree; `note` is a static user type, so the daemon serves its folder itself. Next to the workspace sits an `outside` folder with a secret file.
- (a) A `folder` outside the workspace (absolute, or `..`) and a caller with no workspace are refused with `not_granted`, and nothing is made; `folder: "inside"` makes the artifact at the workspace's real path.
- (b) Links in an artifact folder that lead out (a folder link and a file link): a publish through them writes nothing outside, a `read` returns nothing from outside, and the static page's `/_root/` answers 404 for them while it serves the artifact's own `index.html`.
- (c) Action arguments: upload's `file`, docs `import`'s `file` (a path or a `file:` URL) and `export`'s `out` outside the workspace, or through a link in the workspace that leads out, are refused with `not_granted` before the type's server sees them, and no file is written; the same calls with files in the workspace work.
- (d) ArtifactData: `file_path` and `out_file` outside the workspace (absolute, or `..`) are refused and nothing is written or imported; `out_file: "out/n1.json"` lands in the workspace. A `set` with a stale `if_match` answers `conflict` with `executionStatus: "not_executed"`, and the document is as it was.
- (e) An artifact made at the workspace's top (`folder: "."`) is listed for another session in that workspace; a session in another workspace sees nothing of it under `mine` or `all`.
- (f) The workspace moved away and a new folder made at its path, with a planted `index.html`: `read`, `publish` and `call` answer `not_granted`, the planted file is not overwritten, the static page answers 404 and the zip is refused.

**A picture on a whiteboard, uploaded by an agent** (`agent-upload.test.mjs`, no browser)

- A real daemon (`open-artifact daemon run` from source, in a temporary `OPEN_ARTIFACT_HOME`) runs the built whiteboard; the agent's every step is a tool call, as the board's skill gives it.
- (a) `Artifact {action: "publish", url, file_path, asset: true}` (no `files`) answers `invalid_argument`, its `fix` names `Artifact {action: "call", url, name: "upload", args: {file: "<absolute path>"}}`, and nothing lands in the board's folder.
- (b) `call upload` with a PNG's absolute path keeps its bytes in `_blobs/<id>.png` and returns `/_blob/<id>`; an `image` element with that `src` passes `check`, and reading it back gives the same `src`.

**A reconnect hands back what the host did not take** (`reattach-inbox.test.mjs`, no browser)

- A real daemon (`open-artifact daemon run` from source, in a temporary `OPEN_ARTIFACT_HOME` on a free port) with a static `note` type, and a host connected through `createHarness` whose `wake` turns every request down (as Cindy does for a collaborator's comment). Requests are sent as the Shell's Ask sends them (`artifacts.ask`). Between cases the daemon is stopped and started again on the same port, and the kit attaches the session again by itself.
- (a) A request sent while the host turns it down waits in the inbox. After the restart the kit's re-attach takes it, `wake` turns it down again, and the kit puts it back (`inbox.return`; the daemon log says so). The session's next tool call has it in `messages`, and the call after that does not.
- (b) After another restart, `ArtifactComments wait` answers with the request that was put back at once; a request sent during a second wait is taken by that wait (`via: "wait"`).
- (c) What was put back is on disk: the daemon restarted again before any tool call still has it, and the next call has it once.

**watch ends with the app that started it** (`watch-exit.test.mjs`, no browser; skipped on Windows)

- An app (a small Node script) starts `sh -c "node open-artifact.ts watch --harness claude-code"` the way Claude Code runs its monitor, with stdin the null device and no daemon (watch waits for one).
- (a) While the app and its shell run, watch keeps running.
- (b) The shell is killed outright: watch exits.
- (c) The app is killed and its shell stays (as a monitor does on Windows): watch exits, and the shell ends after it.

**Saving while a person edits** (`shell-save.test.mjs`, Chrome only)

- A real daemon from source in a temporary `OPEN_ARTIFACT_HOME` on a free port, once with `OPEN_ARTIFACT_NODE_CHILDREN=threads` and once with `process`; a host connects with `createHarness` and opens the artifacts in the Shell.
- Slides: the title of a slide is retyped at a person's pace. The Shell's save state (`header [data-shell-save-state]`), sampled all the while, is never `unsaved` ("Couldn't save — retry"), and the slide's file holds the new title.
- Whiteboard: an element is dragged with the real mouse and a note is added from the canvas menu ("Add a note here"). The save state is never `unsaved`, and the store on disk changes.
- Whiteboard through a Shell older than `db.listing` (one left open while the daemon was upgraded): a script added before the Shell's own refuses every `db.listing` call from the page as `invalid` ("unknown method"), as the 0.14.2 broker did. The board still shows (the page asked for `listing` and fell back to `list`), a dragged element reaches the store on disk, and the save state settles.
- The type servers' logs (`<home>/logs/servers/`) hold no error, no refused request and no 4xx or 5xx.

**Whiteboard: an Ask over the limit** (`whiteboard.test.mjs`, one case, Chrome only, with `wait` running)

- "Ask …" in the toolbar opens the Ask panel. 2,667 CJK characters (8,001 bytes of UTF-8, the Shell's `MAX_ASK_BYTES` and one more) sent with Enter are not sent: the page says "That’s too long to send.", the panel stays open with the draft, and nothing is queued. Before, the panel took 20,000 characters, cut longer ones without a word, and closed with the draft gone before the send's answer came.

**The whiteboard in a narrow pane** (`whiteboard.test.mjs`, one case, Chrome only)

- In a 660 px wide view the board opens fitted whole, below 60%, with every element in view. "Zoom out" in the zoom menu is enabled and zooms out, ctrl + wheel zooms out and back in, and "Fit the board" fits it whole again.

**A whiteboard that missed events** (`whiteboard.test.mjs`, one case, Chrome only)

- A board of its own. The page's event stream (a WebSocket, wrapped before the page's scripts run) is closed, and its reconnects are sent to a port nobody listens on. Meanwhile the agent edits one element's file and deletes another's, and the page still shows the old board.
- Once reconnects are let through, the page shows the edit and drops the deleted element with no reload: the stream's first event says where the store stands, and the page reads the board again because it missed something.

**Moving the view with the right button** (`slides.test.mjs` and `whiteboard.test.mjs`, Chrome only)

- Slides: on the shared deck, ctrl + wheel over the slide zooms the stage once the slide has loaded. Before, the stage's wheel listener was set up while the slide was still loading, so it never was.
- Slides: zoomed in until the slide is wider than the stage, a right-button drag that starts on another element scrolls the stage by the distance dragged, keeps the selection, and opens no menu; a right-click without travel still opens the element's menu. In the Canvas view, a right-button drag moves the camera with the pointer and opens no menu.
- Whiteboard: with one shape selected, a right-button drag that starts on another shape moves the camera with the pointer, keeps the selection, and opens no menu; a right-click without travel then selects the shape under the pointer and opens its menu.

**The Chrome harness itself** (`browser-lib.test.mjs`, Chrome only)

- A page of its own on a local server starts a module worker; the server sends the start of the worker's script and holds the rest. While it is held, the suites' usual question (`location.hostname…`) is asked forty times: only the page answers, no renderer crashes and no problem is recorded. Once the script arrives the worker runs, and is still not asked.

**Exports on a cloud host** (`host-exports.test.mjs`, Chrome only)

- The same host, with one sample of each of the 8 types imported. The owner signs in and opens each.
- Every export the page offers is started with the real mouse (the Export tab, Motion's Export dialog, the design system's Download button) and must arrive as a browser download (`Browser.setDownloadBehavior`) with the right name, size and first bytes: `%PDF`, PNG, `PK` with the Office parts for .pptx/.docx/.xlsx, `ftyp` for MP4, `GIF8`, HTML, JSON. The host never renders.
- A Docs PDF opens the print view and calls its `print()` (stubbed before the click), with a toast that says to choose "Save as PDF"; no file is downloaded. Data's Print… prints the dashboard the same way, while its PDF is a file the page makes and downloads like the others. A viewer the owner does not let export gets neither.
- MP4 is skipped, and said so, where this Chrome has no H.264 encoder.
- With "Viewers can download and export" off, a viewer who joined by link is refused with a readable message and gets no file; turned on, the same export downloads.
- A to-do case: a Docs file keeps the doc's name (it needs the type server to expose `content-disposition` to the Shell).

**The page type** (`page.test.mjs`, Chrome only)

- A daemon in the test's process creates a `page` declaring `db` and `network`: it shows its empty state until the agent writes `index.html` (`fixtures/page/`), then renders it, votes into `db/votes/` on disk, and the artifact takes the page's `<title>`.
- Snapshots and their documents are frozen; `network.origins()` is `[]` for the built-in page; a module import of the database subscribes and writes.
- `snapshot` draws a PNG at the size and scheme asked, by a read-only viewer: the page's write on load is refused, `db/` is unchanged and the open view does not reload. `_agent/` is not among the artifact's files.
- `room` declared later: the open view reloads and says `connected()` true with itself as the one peer, without waiting for a change; a second view sees both, and the first view sees the second. (The shell opened its event stream before the page connected, and only the stream's hello carried this, so a view alone said `false` and `[]` for as long as it stayed open.)
- With the declaration cleared (`{}`), the page reloads and `use('db')` is `null`.

**Kinds of page** (`page-kinds.test.mjs`, Chrome only)

- A daemon in the test's process makes six pages the way an agent does (`Artifact` publish with the capabilities each declares, then the files from `fixtures/page-kinds/`), each opened in the Shell.
- Multi-file: a stylesheet, a module that imports another module, an SVG image and a JSON file fetched beside the page all load, with no problems in the page.
- Checklist (`db`): two items typed and added and the first ticked with the real mouse and keyboard reach `db`, and `ArtifactData` `list` reads them as the person left them. An item the agent `set`s and an edit it `update`s show in the open page; an `update` with a stale `if_match` is refused as `conflict`.
- Files (`assets`, `downloads`): an uploaded SVG is stored under `_blobs/` with its bytes and drawn from its `url`; `list()` gives it with `usage`, the same bytes again are the same asset, the page's Export button downloads a JSON file the browser saves, and `delete` takes it off the list, the page and the disk.
- Feedback (`comments`): a thread the page places and sends reaches `ArtifactComments` `read` with its anchor and the agent's status, in `comments.json`; the agent's reply reaches the page as the agent's.
- Self-edit (nothing declared): `artifact.publish` of a file beside the page writes it and keeps the view running; `ifMatch` with an old sha256 is refused as `conflict`. Then the page publishes itself (`outerHTML` with a new heading): it is not refused as stale after its own file writes, its answer is not an error, both open views reload with the new heading, and `index.html` is the page as written, without the runtime served in its `<head>`. (Before the fix, the view kept the version it loaded with, so its own file writes made its next publish a `conflict`; the reload that a page publish starts rejected that publish's own pending call; and the boot script and runtime tag were written into the file and ran twice on every later load.)
- Capabilities: `mcp`, `sample`, `tts` and `paste` give a namespace whose calls reject with their codes (`server_not_connected`, `tools_unavailable`, `capability_disabled`); an unknown name and an undeclared `db` give `null`; `artifact` and `self` are the same; `user.me()` is the owner, with no email. In two views, a message on the `team` sub-room reaches only that sub-room, and one on the room itself only the room.

**A page artifact on a cloud host** (`host-page.test.mjs`, Chrome only)

- A daemon linked to a Node host publishes a synthetic poll `page` (database, comments, who is viewing) and a second page. The owner's page runs on a page host of its own (`<id>--<opaque>`), with no page token in its address; its logo loads; a vote, a comment and a note reach the computer's folder, and a database file written there shows on the page.
- With a `Host` header: the page host answers no API, a page host made up for the other artifact is refused, and the page cannot reach the shell's API.
- Shared by link as viewer, then commenter, then editor: each role can do what it may and no more, on the same page host while it keeps access. Once the guest is removed, their page host is refused and the owner's still answers.

**A person's own type on a cloud host** (`host-types.test.mjs`, Chrome only)

- Two daemons on a Node host: the owner's (an admin, linked in Chrome) and a member's (a token from `open-artifact-host link-token`). The type is synthetic (`fixtures/site-type/team-poll`).
- Publishing an artifact of a type the site lacks is refused, naming the type, `types publish` and `--with-type`; `types publish` inside an agent session is refused; `types publish` keeps the package under the site's data folder, then the artifact publishes.
- The artifact runs on a page host with no page token in its address, which answers no API; viewer, commenter and editor by share links can do what the type's db rules let them.
- A new version reaches the open page and the old version's files go; `types unpublish` delists it (the artifact still opens, a new one is refused); `publish --with-type` sends a fresh type first.
- `OA_TYPES_PUBLISH`, the host restarted each time: `admins` refuses the member, `members` lets them publish, `off` refuses the admin while what is published keeps opening.

**A connected site's types on the local home page** (`host-site-types.test.mjs`, Chrome only)

- Three daemons on a Node host that holds the synthetic `team-poll`: its publisher's, a member's, and a third whose own type has the same id.
- The member's Types tab shows the site's section with the type, its publisher and a link to its page; Install opens the consent dialog on the page's address, nothing is installed before the confirm, and the row then says installed.
- After the publisher publishes 1.1.0 the member's row offers the update; the third home's row is a clash and installs under another id; the publisher's own home shows the type as published from this computer.
