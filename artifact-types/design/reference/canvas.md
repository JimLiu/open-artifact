# canvas.json, pages, notes and design systems

`project/canvas.json` is the canvas: which artboards exist, where they sit,
on which page, plus notes and installed design systems. The page edits it
too (people drag, resize, add pages and notes), so read it again before
each change and change only what you mean to.

```json
{
  "v": 3,
  "createdOnFiles": { "v": 1, "at": "2026-11-14T10:00:00Z" },
  "title": "Checkout",
  "launch": { "view": "canvas", "page": "flow" },
  "pages": [
    { "id": "flow", "name": "Flow" },
    { "id": "parts", "name": "Components" }
  ],
  "boards": {
    "Cart.dc.html": { "x": 0, "y": 120, "w": 390, "h": 844, "title": "Cart", "page": "flow" },
    "Pay.dc.html": { "x": 490, "y": 120, "w": 390, "h": 844, "title": "Payment", "page": "flow", "is_interactive": true },
    "parts/Card.dc.html": { "x": 0, "y": 0, "w": 360, "h": 220, "page": "parts" }
  },
  "order": ["Cart.dc.html", "Pay.dc.html", "parts/Card.dc.html"],
  "notes": {
    "t1": { "kind": "title1", "x": 0, "y": 0, "text": "Checkout flow", "maxW": 880 },
    "n1": { "x": 980, "y": 120, "text": "Apple Pay only on iOS.", "color": "orange" }
  },
  "designSystems": []
}
```

## Top level

- `v` is 3. `createdOnFiles` marks a canvas made on files; `open-artifact open` writes
  it for a new folder.
- `title` names the design.
- `launch` is what opens first: `{"view": "canvas", "page": "<id>"}` or
  `{"view": "focused", "file": "<board path>"}` (one artboard full size,
  for a prototype).
- `pages`: at most 40, `id` matching `[A-Za-z0-9_-]{1,40}`. With no pages,
  everything is on one canvas. A board or note without `page` is on the
  first page.
- `order` lists every board exactly once, back to front: a later board
  paints over an earlier one where they overlap. The arrow keys in the
  focused view follow it; export goes by position on the canvas.

## Boards

The key is the artboard path under `project/`. Fields:

| Field | Meaning |
|---|---|
| `x`, `y` | Top-left on the canvas, px. |
| `w`, `h` | Size, 40–8000 px. Match the artboard's `$preview`. |
| `title` | Label above the frame; defaults to the file's `<title>`. |
| `page` | Page id. |
| `is_interactive` | It has working controls: the frame gets a Play button that hands clicks to the artboard. |
| `expand: "fill"` | The artboard fills the window in the focused view instead of keeping its size. |
| `print: "flow"`, `paper: "letter" \| "a4"` | Marks a document-like artboard for paginated printing. Share → Export → PDF in the frame shell paginates the artboard at the chosen paper width. |
| `frameless` | Drawn without a frame, name or white page: a piece (below). Set by the page; leave it. |
| `locked` | `true`: the person locked the frame in the editor, so it can't be moved, resized or deleted there until they unlock it (that removes the key). Leave it. |
| `radius` | Corner radius of the frame, px: a phone or tablet screen (about 40 for a phone). Leave it off a PAGE, print or poster. |
| `guides` | Up to 6 layout guides: `{ "kind": "columns" \| "rows" \| "grid", "count": 12, "gutter": 24, "margin": 32 }`. |

Keep boards on one page apart: lay them out on a grid with 80–120 px
gaps; leave at least 223 px above a row that has a title note.

A **piece** is an element someone dragged out of an artboard onto bare
canvas: the editor writes it as a small artboard file of its own
(`Piece.dc.html`, `Piece-2.dc.html`, …) sized to the element, with
`frameless: true`, the element's tag as `title`, and the page it was
dropped on. It is an ordinary `.dc.html` otherwise: edit its file like any
artboard, keep its entry. Dragged onto an artboard again, a piece (like a
note) becomes part of that artboard and its file goes away.

## Notes

Keyed by id (`[A-Za-z0-9_-]{1,40}`), as many as you need while the whole index stays under 1 MiB. Every note has `x` and `y`. Stickies and titles also have `text`.

- `kind: "title1"` is a title over SEVERAL artboards, never over one (a frame's name strip already
  shows its `title` or file name): one bold 72 px line. Set `maxW` to its row's width (`maxH` if it is
  tight): longer text shrinks to fit. Put it at least 223 px above its row, clear of the name strips,
  with nothing over it.
- No `kind` is a sticky: set `w`; it grows to 4/3 of `w` tall (keep that space clear), taller on empty
  canvas, then scrolls.
- Both take `size` (px, or `s m l xl xxl`), `bold`, `italic`, `page`, and `color` (sticky: `fill`)
  from `gray red orange green teal blue purple pink`.
- `rect`, `oval`, `pen`, `line`, `arrow` and `image` are what people draw on the canvas: leave them.
  Their look can sit in `css` (below).
- Drawn inside an artboard, the same tools write into its page instead: an absolutely positioned `div`
  or `svg` with a grey placeholder fill (`#b6b0a7`) or stroke (`#8a8378`, the Pencil `#2b2b2b`), and text
  starting as *Your text here*. They are the person's too: keep where they sit; restyle them when asked.
- `locked: true` on any note is the person's lock from the editor: it can't be moved, resized or deleted
  there until they unlock it, which removes the key. Leave it; copies made in the editor come unlocked.
- `groups` lists the groups a note belongs to, innermost first (ids like `g1`, at most 8 levels): people
  group notes with ⌘G and selecting one then selects its whole group. Keep the list when you move or
  restyle a note; drop an id from it only to take the note out of that group. Two or more notes make a
  group; a lone id means nothing.
- `kind: "link"` is a card that opens another artifact: `{"kind":"link","x":0,"y":680,"href":"<its link>","title":"Spring menu deck"}`,
  640 × 112 px; `title` is its name (left out, the card shows the bare link). When you make something else (a deck, a document) from
  artboards, add one under what it was made from: 120 px below that artboard, left edges level, on bare
  canvas, never right of the rightmost artboard; one per artifact. No link to give: no card; say in
  your reply where it is.

Use notes sparingly: a title per group, a sticky for a decision the person should see. Rationale and
options go in your reply, never on the canvas.

### A note's `css`

A drawn note keeps its look in `css`, an object of style keys to string values. Only these keys are kept:

| Keys | Values |
|---|---|
| `background`, `background-color` | A colour or gradient. |
| `opacity` | `0`–`1` (more is read as `1`) or a percentage. |
| `border-style` | `none`, `solid`, `dashed`, `dotted` or `double`. |
| `border-color`, `border-width`, `border-top-width`, `border-right-width`, `border-bottom-width`, `border-left-width` | A colour; a length. |
| `border-position` | `center` or `outside`; left out, the border sits inside the box as usual. |
| `border-radius`, `border-top-left-radius`, `border-top-right-radius`, `border-bottom-right-radius`, `border-bottom-left-radius` | A length. |
| `box-shadow`, `filter`, `backdrop-filter` | A shadow; filter functions. |
| `object-fit` (`fill`, `contain`, `cover`, `none`, `scale-down`), `object-position` | How an image note's picture sits in its box. |
| `stroke`, `stroke-width`, `stroke-dasharray` | A line's colour (no `none`, no gradient); its width in px; one to four whole numbers of at most three digits, space-separated. |

Values are plain: letters, digits, spaces and `# % ( ) , . / + -`, with no `;`, braces, quotes or colons. The only
functions are colours (`rgb()`, `hsl()`, `oklch()`, `color-mix()`, …), gradients and filter functions: no `url()`,
`var()` or `calc()`. Anything else is dropped when the canvas is read, and `check` names it.

An `image` note takes the same look: its picture fills the box (`object-fit` defaults to `fill`), corners square and no
border until given; a width without a style is solid, and `background-color` shows behind a transparent picture.
A border at `center` or `outside` with a style, one width on all four sides and one colour is drawn as an outline;
any other border stays inside the box. An older
`css.fill` on a `rect` or `oval` moves to the note's `fill`. A dashed or dotted `pen` stroke is also written as
`stroke-dasharray` for whoever reads the file (the editor draws from `dash`).

## Pages

Put alternatives or separate flows on their own pages, components the
screens import on a "Components" page. When you add a page, add boards with
its `page` id; when someone asks for "a new page", they usually mean a
canvas page, not a new artboard.

## Using a design system

Installing a system (its files under `project/ds/<folder>/`, its record in `designSystems`) and mounting
its components: `design-systems.md`.

## Checking

`open-artifact check <dir>` reports: a missing or invalid `canvas.json`, a wrong `v`,
bad page or note ids, boards whose file is missing, sizes out of range,
unknown pages, boards missing from `order` (or listed twice), artboard files
not on the canvas, a `launch` that names nothing, a
`locked` on a board or note that is not `true` or `false`, and installed
systems without `tokens.json`. A note's `css` that is not an object, or a key
in it a note drops, is a warning: `Note "<id>" css "<key>" is ignored: …`.
