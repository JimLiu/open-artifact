# Design

[中文](design.zh-CN.md) · [All artifact types](../artifact-types.md)

**Design** is an infinite WebGL2-accelerated canvas of live `.dc.html` artboards (Design Components) saved as local files. Use it for UI screens, web and landing page explorations, multi-option comparisons, clickable prototypes, diagrams, posters, flyers, and print layouts.

> **When NOT to use Design:** Don't use it for slide decks (use [Slides](slides.md)) or freeform team sticky-note brainstorming (use [Whiteboard](whiteboard.md)).

## Key features

- **Infinite multi-page canvas**: Place multiple artboards side by side, organize them across up to 40 pages, add section titles, sticky notes, shapes, arrows, and freehand annotations.
- **Live `.dc.html` artboards & interactive prototypes**: Artboards render real HTML/CSS/JS; interactive artboards (`is_interactive: true`) get a **Play** mode for click-through prototypes and live controls.
- **Responsive viewport testing**: Preview artboards full-window in Fill/Fit mode at Phone (`390`), Tablet (`768`), `1024`, `1280`, `1440`, or `1920` widths, and capture full-page screenshots at any width (1× or 2×).
- **Direct visual editing & tweaks**: Retype copy inline, move/resize frames, adjust colors and text styles, and compare variations side by side.
- **Design System integration**: Install a [Design System](design-system.md) to bind brand tokens to the editor's pickers and mount real UI components from the system's bundle (`window.<Ns>`).
- **Print & pagination support**: Configure Letter or A4 paper and flow pagination (`print: "flow"`) for multi-page print PDFs.
- **Rich exports**:
  - **PNG / JPEG** (single artboards or responsive full-page captures at 1×/2×)
  - **PDF** (fixed frames or paginated print flow)
  - **HTML** — Standalone web page, **Figma capture HTML** (open in Chrome and capture with Figma's Chrome extension), or **Entire project (.zip)** (every project file with `canvas.json`, uploads, runtime, index, and README; hidden dot-files stay out, a large project is split into numbered zips, and the README lists anything left out). The one-file HTML embeds stylesheets an artboard pulls in with `@import`, and a full-window page exported with a lot of empty frame below its content gets a notice saying how much.

## How to use (for users)

### Create a design canvas
```text
/open-artifact design three landing page options for a specialty coffee roaster
/open-artifact design mobile onboarding flow (4 screens) with interactive Play mode
/open-artifact design an A4 conference poster using our brand design system
```

### Edit, preview & export
- **Pan, zoom & edit**: Navigate the infinite canvas, move frames, click text to edit directly, or switch pages in the sidebar.
  Artboard titles and their buttons keep their size while you zoom. Double-click a title, or right-click a selected artboard and choose **Rename**, to rename it: **Enter** saves, **Escape** cancels. When the title is off screen, the canvas first slides it into view without changing the zoom.
- **Toolbar at the top or bottom**: Choose **Move toolbar to bottom** (or **Move toolbar to top**) in the artifact's title menu, or turn **Toolbar at top** on or off in the zoom menu. The choice is kept in this browser.
- **Move around the canvas**: Scroll or swipe with two fingers to pan, and **⌘ + scroll** (Ctrl + scroll) or pinch to zoom at the pointer. Drag with the **right** or **middle** mouse button, or hold **Space** and drag, to pan; a right-button drag leaves the selection alone and opens no menu, while a right-click without moving still opens the menu. **⌘0** / **⇧1** fit the canvas, **⇧2** zooms to the selection.
- **Lock and arrange**: Press **⌘L** (Ctrl+L) to lock an artboard, note or element so it can't be moved, resized or deleted by accident; unlock it the same way or from the layers list. Reorder pages with **Move up / Move down** or by dragging them in the page list, and restack with **⌘]** / **⌘[** (one step; selected elements that aren't side by side each step past their own neighbour; a locked one in the selection stops the step) and **]** / **[** or **⌥⌘]** / **⌥⌘[** (to the front or back); artboards restack the same way. A locked note or artboard is skipped by Delete; only an all-locked selection refuses. Ungrouping a group that holds a locked element works: the element stays locked, where it was.
- **Select, copy and align**: Shift-click or drag a marquee across artboards, notes and elements to select them together (**N selected**) and move them as one undo step. Hold **Alt** while dragging to drop a copy instead (press or release Alt mid-drag to switch, **Esc** cancels); hold **⌘** (Ctrl) while drawing to turn snapping off. With elements selected, **⌥A** / **⌥H** / **⌥D** align left, horizontal centers or right and **⌥W** / **⌥V** / **⌥S** align top, vertical centers or bottom (several elements line up with each other, one with its parent). **⌥⌘C** / **⌥⌘V** copy one thing's style and paste it onto others.
- **Between canvas and artboards**: Paste onto a selected artboard to place copied notes or layers inside it as positioned layers. Drag a note or a piece onto an artboard (it lights up) to add it at that spot in the layout, or hold **Ctrl** to keep it exactly where you drop it. Drag an element off an artboard onto bare canvas and it becomes a frameless piece of its own (hold **Alt** to make a copied piece and leave the element); drag it onto another artboard (Alt copies it there), or its row in the layers list onto another artboard's row, to move that element there. A locked element stays in its artboard; locked layers inside a moved element stay locked, and copies are never locked. Double-click a path in an artboard to edit its points.
- **Draw inside an artboard**: Press with **Text**, **Rectangle**, **Oval**, **Line**, **Arrow** or the **Pencil** on an artboard and the drawing is written into its page as a positioned element (a grey placeholder fill or stroke), selected and ready to restyle. A click gives a default size, **Shift** keeps a square or a 45° line, and the press snaps to the edges and center lines of the artboard and of its top-level blocks (**⌘** / Ctrl turns that off). While one of its elements is selected, a drawing goes into the block under the pointer instead (made `position: relative` when it needs to be), and the **Artboard** tool adds a frame there rather than a new artboard. New text opens for typing with *Your text here* selected; left empty, it goes away. One **⌘Z** takes back each drawing.
- **Several files at once**: With elements of different artboards selected (notes and artboards may be in the selection too), **⌘C** copies and **⌘X** cuts the elements, as one undo step; notes and artboards are not copied, and after a cut they stay selected. **⌘V** puts each element back into its own artboard. A cut with a locked element in it is refused. **⇧X** swaps fill and stroke and **X** removes the fill across all of them, one undo step each. The Properties panel shows the rows every member has, with **Mixed** where values differ (hover for *Mixed across the selection*); Position is off once notes or artboards are in the selection. With several artboards selected, typing `+4` or `-2` in a number field changes each artboard from its own value, and guides are editable only when they match.
- **Layers list from the keyboard**: The list is one tab stop. **↑** / **↓**, **Home** / **End** move between rows and ring the layer on the canvas; **→** / **←** open or close a row (or step into or out of it); **Enter** or **Space** selects (**⇧** / **⌘ Space** adds); **F2** renames, and **Enter** or **Esc** returns to the row. When grouping, ungrouping or dragging a row to another parent leaves a layer placed by position, it stays where it was and keeps the look it had from its old container; layers that keep flowing move as they are.
- **Shape styles**: Rectangles and ovals take a fill, a border placed **Inside**, **Center** or **Outside** the edge, corner radius and opacity from the Properties panel; a new rectangle, on the canvas or in an artboard, keeps the last radius you set in this file. Image notes take a border, corner radius, shadow, filters and how the picture fits its box.
- **Note strips**: A selected sticky or title has a strip with **Text style** (Sticky or Title, a size from Small to Huge, or a size of your own in px), **Ink**, **Bold** and **Italic**; a sticky also has **Fill color** for its paper. A rectangle or oval has **Fill color**, a line, arrow or drawing has **Stroke** and **Line style** (solid, dashed or dotted), and a link card has **Open**. While you type in a sticky its strip stays: **Bold** and **Italic** mark the selected words (or the word at the caret) in its Markdown, **List** makes the selected lines a bulleted or numbered list, and **Esc** finishes typing. A video note's bar always has **Properties**, which opens the panel on its Properties tab. In a read-only view (a viewer's or a commenter's link) notes, elements and selections show no bars.
- **Crop and video**: Double-click an image note (or press **Crop** on its bar) to crop it: drag an edge to trim, drag the picture to move it, ⌘/Ctrl + scroll or **+**/**−** to zoom, arrow keys to nudge; **Enter** or **Esc** keeps the crop and **⌘Z** while cropping drops it. Drop or paste a video (.mp4, .webm or .mov, up to 20 MB, four at a time) on the canvas for a video note: it shows a cover frame and plays when you click it, at most four at once. In **Properties → Media** you can replace the video with another one, set or reset its cover image, scrub through it, and turn **Autoplay**, **Loop** and **Sound** on or off. A video dropped into an artboard becomes a `<video>` in its page. Where you can edit, the bar of a selected note or element has **Comment**, which starts a comment on it; a note's bar also has **Lock** for shapes, pictures, videos and link cards.
- **Element styles**: The Properties panel sets a grid's **Columns** / **Rows** as a count of equal tracks (or any track list), an item's span and min/max size, a border's style, colour and width (one width, or each side), and text as a solid colour or a **Gradient** painted through the letters. A border can sit **Center** or **Outside** the edge; where a child touches that edge the box keeps its place, and buttons and links get a focus ring outside it. **⌥⌘V** onto an artboard sets its page background (and, from another artboard, its corner radius); when the artboard's root element covers the page and has a background of its own, that background is the one read and written. Double-clicking words of a component instance that can’t be retyped says whether a prop of the instance or the component itself sets them.
- **Test prototypes**: Click the **Play** button in the toolbar to run interactive artboards and test responsive screen widths.
- **Collaborate with your agent**: Pin comments directly onto an artboard and click **Send to agent**.
- **Live updates**: Files your agent writes appear on the canvas in place. If the connection drops, what changed meanwhile is merged once it is back, without moving the canvas or losing the selection or an Ask draft.
- **Fix errors**: An artboard that fails to run shows a notice underneath it with **Ask agent to fix**, and **N errors** at the top right lists every artboard with errors on the page and asks the agent to fix them all. Close a notice with **×**; the warning mark it leaves next to the artboard's name brings it back. If the agent can't be reached, the list keeps the request for you to copy into its conversation.
- **Deep links**: Append `#artboard-<name>`, `#play-<name>`, or `#page-<id>` to the artifact URL to jump straight to a board or page.
- **Export**: Use **Share → Export** for PNG, JPEG, PDF, Figma-ready HTML, or the entire project as a ZIP.

### Using a Gemini model?

On a Gemini model (in [Antigravity](../../plugins/antigravity/README.md) or another app), pair Design with Google's [`gemini-frontend-design`](https://github.com/google-gemini/demolab/blob/main/skills/gemini-frontend-design/SKILL.md) skill: it guides visual direction, color, typography, layout and motion, while the Design skill covers how the canvas is written. Open Artifact does not ship it; install it from [`google-gemini/demolab`](https://github.com/google-gemini/demolab) as that repository's README describes (for one skill: `npx skills add google-gemini/demolab --skill gemini-frontend-design`). Without it, the agent mentions the link once before it starts a design, so you can install it first, and goes on without it unless you say otherwise.

## How to use (for agents)

- **Type ID**: `design` (`type_url: "open-artifact://type/design"`)
- **Storage model**: Project files under `<root>/project/`:
  - `project/canvas.json` — index (`v: 3`, `createdOnFiles`, `title`, `launch`, `pages`, `boards`, `order`, `notes`, `designSystems`).
  - `project/<path>.dc.html` — one Design Component file per artboard (`Main.dc.html` as entry; frame `w`/`h` between 40 and 8000 px).
  - `project/ds/<folder>/` — copied design system `tokens.json`, `tokens.css`, component bundles, fonts, and assets.
- **Limits**: Up to 512 files and 256 MB total per canvas; `canvas.json` under 1 MiB.

### Workflow & commands

| Task | Under daemon (MCP tools) | Standalone CLI (`artifact-types/design/scripts/cli.mjs`) |
| --- | --- | --- |
| Create | `Artifact {action: "publish", type_url: "open-artifact://type/design", title, open: "after_first_write"}` | `open-artifact open <root> --type design --title "<title>" --json` |
| Write artboards | Write `<root>/project/canvas.json` and `*.dc.html` with file tools (or `Artifact publish` with `if_match`) | Write directly under `<root>/project/` |
| Upload assets | `Artifact {action: "call", url, name: "upload", args: {file: "<abs path>"}}` | `open-artifact upload <root> <file>...` |
| Validate | `Artifact {action: "call", url, name: "check"}` | `open-artifact check <root>` |
| Inspect selection | `Artifact {action: "call", url, name: "context"}` | `open-artifact context <root>` |

### Key rules for agents
1. Check for an existing `design-system` first. If using one with a component bundle (`window.<Ns>`), mount its real components rather than hand-coding look-alikes, and copy its files under `project/ds/<folder>/`.
2. Write `project/canvas.json` and the first artboard first, show the page, then write subsequent artboards **one per turn** in `order` so the user watches each artboard appear cleanly.
3. Upload images, fonts, and external assets via `upload` (`/_blob/<id>`); never embed `data:` URIs or bare filenames.
4. Run `check` after finishing and fix all errors (missing `support.js`, unmatched `$preview` dimensions, broken `/_blob/` URLs, or stale installed design systems).
5. On a Gemini model, use the `gemini-frontend-design` skill for the look when it is loaded; the Design skill's rules still decide how files are written, how images get in and what is checked. When it is not loaded, mention its link once before designing (as one of your questions when you are asking any; otherwise say it and build without waiting) and never install it unasked.

For full `.dc.html` syntax, layout, shader, and print references, read [artifact-types/design/SKILL.md](../../artifact-types/design/SKILL.md) and `artifact-types/design/reference/`.
