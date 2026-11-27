# Whiteboard

[中文](whiteboard.zh-CN.md) · [All artifact types](../artifact-types.md)

**Whiteboard** is a shared, infinite canvas stored as small live-synced JSON documents where you and your agent think visually together. Use it for brainstorms, sprint retros, flowcharts, system architecture diagrams, mind maps, user journey maps, and collaborative workshops.

> **When NOT to use Whiteboard:** Don't use it for pixel-exact UI screens or print pieces (use [Design](design.md)), slide decks (use [Slides](slides.md)), or long-form specs (use [Docs](docs.md)).

## Key features

- **Rich visual primitives**: Sticky notes, shapes, labeled sections, free text, smart routing arrows/connectors (powered by Rust/WASM geometry), hand-drawn pen ink, uploaded images/SVGs, tables, stickers (great for dot-voting), timers, link cards, and **live working HTML embeds** (mini prototypes, calculators, interactive charts).
- **Real-time multiplayer collaboration**: Live cursors, presence avatars, shared editing, and built-in workshop timers when shared on a LAN or hosted site.
- **Spatial AI teammate**: The agent understands what you have selected or anchored a comment to, rearranges/tidies layouts cleanly, extends existing sections without duplicating them, and shifts neighboring items to prevent overlap.
- **Comments & "Send to agent"**: Pin comment threads to specific elements or areas and send them straight to your agent.
- **Exports & archives**: Export the board as **PNG** from **Share → Export** (or as an **animated GIF** or **MP4 video** when it has flowing arrows), or archive the entire board (documents, uploads, comments, history) as a portable `.zip`.

## How to use (for users)

### Create a whiteboard
```text
/open-artifact whiteboard a sprint retro board with What Went Well, Friction, and Action Items
/open-artifact whiteboard an architecture diagram of our event-driven payment pipeline
/open-artifact whiteboard a mind map of Q4 growth experiments
```

Or start with no agent: on the home page, click **New artifact**, pick **Whiteboard**, and name it. A blank board opens in its editor and you add notes yourself (right-click the board, **Add a note here**). A board made empty some other way opens on its empty state; its **Start blank** opens the same editor. What you **Send to agent** waits until a session takes the board.

### Collaborate & export
- **Draw & rearrange**: Drag stickies, group ideas into sections, draw arrows or ink sketches, drop stickers to vote, and start a countdown timer.
- **Move around the board**: Scroll or swipe with two fingers to pan, and **⌘ + scroll** (Ctrl + scroll) or pinch to zoom at the pointer. Drag with the **right** or **middle** mouse button, hold **Space** and drag, or use the **Hand** tool to pan; a right-button drag leaves the selection alone and opens no menu, while a right-click without moving still opens the menu.
- **Jump to a section**: Open the zoom menu at the top right and pick a section under **Go to section**; the view glides to it, title included, at up to 100%. Sections without a title are not listed.
- **Link to things on the board**: Right-click an element and pick **Copy link to item**, then paste it onto the board as a link card, onto a picture, or into a text link; in a text link field you can also pick a section from the list. Clicking such a link takes the view to the element and rings it briefly; **Back** at the bottom returns to where you were. A card whose element was removed turns grey. A copied link opened in a browser opens the board at that element.
- **Flowing arrows**: Select an arrow, open **Line** and pick **Flowing**: its dashes keep travelling towards the head, to show where something moves (requests, data, money). **Dashed** stills it again. To keep lines still on your own screen, turn off **Animate lines** in the zoom menu; they also stay still when your system asks for reduced motion.
- **Ask your agent in context**: Select a cluster of stickies or pin a comment (e.g. *"cluster these by theme and summarize top 3 risks"*), then click **Send to agent**.
- **Export**: Open **Share → Export** to download a PNG image, or, on a board with flowing arrows, an **Animated GIF** of them that loops (half a second, ten frames, framed like the PNG) or an **MP4 video** (six silent seconds, longest edge 1920 pixels). A browser that cannot make videos shows the MP4 row greyed out, with the reason.
- **Shape libraries**: Add sets of icons to the board and place them from **Shapes → Library**; see [Shape libraries](#shape-libraries).

## Shape libraries

A shape library is a set of drawings, such as icons for servers, databases, queues or people, that you add to a board
once and then place as often as you like. Libraries live with the board: everyone who opens it sees the same ones, and
they move with its folder and its `.zip` archive. A **Board file** exported from **Share → Export** carries the shapes
you placed, not the libraries. None come with Open Artifact; icon sets are usually published by the tools, services and design
systems you already draw, by icon collections under an open licence, or drawn by your own team.

- **Add one**: in the toolbar, open **Shapes**, then **Library** (the last button, after Table). Click **Add library… →
  From a file…** and pick a library file, or one or many `.svg` files (they become one library called "My shapes").
  You can also drop the files on the panel. A board holds up to 8 libraries. These files can be added (the panel tells
  them apart by what is in them, not by their names):
  - a `.shapes.json` library (below);
  - a `.zip` of SVG files: one library named after the zip, one shape per `.svg` named after its file, and the folders
    it sits in become its tags, so a search for a folder name finds its shapes. Other files in the zip, `__MACOSX/` and
    hidden files are skipped. A zip may be up to 4 MB; at most 500 drawings are read, each up to 400,000 bytes
    unpacked and 16 MB in all; encrypted and zip64 entries are left out;
  - a draw.io library (`.xml` or `.drawio`, the kind that starts with `<mxlibrary>`): entries that are SVG pictures
    are added with their titles and sizes. Entries drawn with draw.io's own shapes, and raster pictures (PNG, JPEG),
    cannot be read; the panel says how many were left out and why.
- **Add from a link**: **Add library… → From a link…** takes an `https://` link to any of the files above. The page
  reads it, then asks before adding: it shows the site, the library's name and how many shapes it adds and leaves out,
  and nothing is stored until you click **Add**. The link is kept as the library's source unless the file names its
  own. The page fetches the link itself, directly from your browser, with no cookies and no referrer; nothing goes
  through Open Artifact. That only works when the site lets other pages read the file (many file hosts do not) and
  when the board's host lets pages fetch other sites: a self-hosted Open Artifact site keeps pages from doing that
  unless it runs with `OA_PAGE_NETWORK=https` (see [Hosting](../hosting.md)), and **From a link…** then says it cannot be used there.
  When a link cannot be read, download the file and add it with **From a file…**.
- **Place a shape**: search by name or tag, click a shape, then click the board. It lands as a picture without a frame,
  with an empty label under it that shows the shape's name until you type your own. Arrows attach to it like to any
  picture. An `.svg` dropped on the board itself (not on the panel) still goes in as an ordinary picture.
- **Remove one**: open the library's **⋯** menu (it also shows the source and the licence) and choose **Remove from
  this board**. Shapes you already placed stay, because each placed shape carries its own drawing.

A `.shapes.json` file looks like this (`source`, `license`, `tags`, `w` and `h` are optional):

```json
{
  "format": "open-artifact-shapes",
  "version": 1,
  "name": "Cloud basics",
  "source": "https://example.org/cloud-basics",
  "license": "CC0-1.0",
  "shapes": [
    {
      "name": "Database",
      "tags": ["storage", "sql"],
      "w": 48, "h": 48,
      "svg": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 48 48\" fill=\"none\" stroke=\"currentColor\"><ellipse cx=\"24\" cy=\"11\" rx=\"14\" ry=\"5\"/><path d=\"M10 11v26c0 3 6 5 14 5s14-2 14-5V11\"/></svg>"
    }
  ]
}
```

Drawings that use `currentColor` follow the board's ink, so they read well in light and dark themes.

**What gets left out, and why.** Every shape is cleaned when it is added, and the panel then says how many shapes were
added and names each one left out with the reason. A shape is left out when its drawing uses something a board drawing
cannot have: text (turn it into outlines first), scripts, embedded or linked images, `<use>` references, clip paths
other than one around the whole drawing, or anything outside plain SVG shapes, groups and gradients. A drawing with no
size, or over 16,000 characters once cleaned, is left out too. A file over 4 MB is refused; past 500 shapes the rest
are not read. These limits keep every placed shape small, self-contained and safe to show to everyone on the board.

## How to use (for agents)

- **Type ID**: `whiteboard` (`type_url: "open-artifact://type/whiteboard"`)
- **Storage model**: Live JSON document store under `<root>/db/`:
  - `db/board/meta.json` — board title and element stacking order.
  - `db/elements/<id>.json` — one JSON document per board element (sticky, shape, section, text, arrow, ink, image, table, sticker, timer, link card, embed).
  - `db/board/shapes.json` — the shape libraries people added (each library's file is an upload, `_blobs/<id>.json`); `context` lists them as `shapeLibraries`.

### Workflow & commands

| Task | Under daemon (MCP tools) | Standalone CLI (`artifact-types/whiteboard/scripts/cli.mjs`) |
| --- | --- | --- |
| Create | `Artifact {action: "publish", type_url: "open-artifact://type/whiteboard", title, open: "after_first_write"}` | `open-artifact open <root> --type whiteboard --title "<title>" --json` |
| Read board | `ArtifactData {action: "list", url, collection: "elements"}` / `get` `board/meta` | `open-artifact read-db <root> [elements \| board/meta]` |
| Write / batch | `ArtifactData {action: "batch", url, writes: [...]}` (`set`/`update`/`delete`; a `set` over an existing document, and a `delete`, take `if_match`) | `open-artifact write-db <root> '<writes>'` (supports `{"$file":"..."}`) |
| Upload images | `Artifact {action: "call", url, name: "upload", args: {file: "<abs path>"}}` (returns the `/_blob/<id>` url for an image's `src`) | `open-artifact upload <root> <file>...` |
| Validate | `Artifact {action: "call", url, name: "check"}` | `open-artifact check <root>` |
| Inspect view/selection | `Artifact {action: "call", url, name: "context"}` | `open-artifact context <root>` |

### Key rules for agents
1. Match the spatial form to the idea (loop for cycles, lanes for handoffs, tree for breakdowns, matrix for comparisons)—avoid generic grids of identical boxes.
2. Target roughly `1500×750` for a new board so text opens at a readable zoom level, keeping clear spacing (24 px between neighbors, 64 px for arrows, 144 px for labeled arrows).
3. Respect human edits on existing boards: read fresh before writing, extend in place rather than building duplicate copies beside existing clusters, and shift neighbors/stickers together when resizing.
4. Use `ArtifactData` `batch` (up to 500 writes per batch) so updates apply atomically; use `{"__delete__": true}` inside `update` to remove fields.
5. Make an arrow flow with `"dash": true, "flow": true` only when something moving along it is the point; it counts as one of the board's marks, so say what it means in a key or label (`check` warns about a `flow` without `dash`).
6. Link to elements of the same board with `#element=<id>` (a link card, a picture's `href`, or `[label](#element=<id>)` in text) for an index or a path through a large board; fix or remove the links when deleting their target (`check` warns).
7. When the board has shape libraries (`context` → `shapeLibraries`) and one of their shapes fits, place it as a plain `image` with its name in a `text` under it instead of drawing your own; never write `board/shapes` or library files by hand.

For full element schemas, drawing craft, and ideation guidance, read [artifact-types/whiteboard/SKILL.md](../../artifact-types/whiteboard/SKILL.md) and `artifact-types/whiteboard/reference/`.
