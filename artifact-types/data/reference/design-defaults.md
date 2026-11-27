# Design suggestions

These cover what the person didn't specify. Most follow from two facts: readers never saw your conversation, and the numbers change while your words stay.

- Under the title, one sentence says what the numbers say now. Fill it from the data, like every word that depends on the numbers (up, down, who leads).
- Give a headline figure its signed change and comparison period. Color the change by whether it's good, not by its sign. A card says its window ("Last 28 days").
- Most pages need no notes, but define a metric in plain words where it first appears. Longer ones that the person asks for, such as definitions, fit a closed `<details>` at the foot, its `<summary>` saying what's inside.
- A caveat that changes how a figure reads stands beside it or in the takeaway. If you left a source out, name it on the page and say why. Show a lift with its interval, and whether that crosses zero. Draw lines point to point, since a curve suggests values the data lacks.
- `<select class="dash-select">` has the dashboard's look. Its arrow is a background image in the right padding, so style it with `background-color`, not `background` or `padding`.
- Avoid relying on HTML `title` attributes or SVG `<title>` elements as tooltips: they appear sluggishly and do not work on touch devices. Print key values directly so phones and screenshots still show them.
- A screen reader gets nothing from a drawn chart, so its `svg` has `role="img"` and an `aria-label` that says what it shows.
- Numbers and dates are formatted. A date-only string parses as UTC midnight. Without `d3.utcFormat`, a reader west of UTC sees the day before.

Shapes to mix or ignore. Where one contradicts a suggestion above, the shape wins:

- **Visual analysis** — one finding, read top to bottom: a sentence around one number, then charts, each under a heading that says what it shows.
- **Scroll story** — also scrollyteller, story or narrative: a finding told as the reader scrolls. Short chapters stand beside one chart that stays in view and changes with them. An `IntersectionObserver` needs `root: document` here, or its `rootMargin` is ignored. Include print styles for its chapters (see "Printing").
- **Letter** — an update written to its readers: each number inside its sentence, `[brackets]` for what only the person can say, and no tiles, headline figure or filters. Its column is `data-read`, with the `lang` of its words.
- **Tool** — a page people work in rather than read: a tracker, a checklist, a calculator. Its controls and their entries lead, with any total they make next to them. Before the first entry it says how to make one. Rows go in the store only when a person enters them, never on their behalf.

If the person picked a shape, in the questions before a first build, on the empty page (the view context's `form`, or the format an import request names) or in a Remix, build only that shape, not a mix. `visual-analysis` means Visual analysis and `scroll-story` means Scroll story. For `visual-short`, read `reference/visual-short.md` first. Their message can still ask for another shape, but the word "dashboard" doesn't. `dashboard` is only the default, so a message asking for another shape, such as a story or deep dive, gets that shape. Many readers have no voice that reads aloud, so say nothing of listening, and don't offer it, unless the person asks. Read `reference/read-aloud.md` before a page or your reply speaks of it.

### Look

The dashboard sets plain text defaults and an outer gutter, so don't pad your outer wrapper. `#dash-root { --dash-gutter: 0 }` runs it edge to edge. The page also appears in a narrow pane beside a chat, and narrows when Sources opens ("Fit" below). `position: fixed` scrolls with the page, so make a tooltip `absolute` inside a `relative` box.

These tokens follow the reader's theme, so a page needs no dark-mode rule. Only these are guaranteed; a name you guess can silently resolve to nothing.

- Color: `var(--color-fg)`, `--color-fg-muted`, `--color-bg`, `--color-panel`, `--color-border-line`, `--color-ok`, `--color-warn`, `--color-bad`.
- Text: `var(--font-sans)`, `--font-mono` for code, and `--font-serif` at weight 400 for big numbers and the page title. Sizes are `--dash-font-size-` plus `caption`, `body`, `heading` or `title`, with `--dash-font-weight-medium`. `font-variant-numeric: tabular-nums` keeps numbers lined up.
- Space: `--dash-gap-` and `--dash-pad-` plus `xs`, `sm`, `md`, `lg` or `xl`, with `--dash-radius` for corners.
- Cards: `--color-panel` with a 1px `--color-border-line` border, `--dash-radius` and `--dash-pad-lg`.
- Charts: bars, lines and dots take `dash.colors` in order, `dash.colors[0]` where there is one series, so a look or a design system reaches them. They are `var(--…)` strings, which `d3.color()` can't parse, so set them as styles. `--dash-chart-muted` is for context, `--dash-chart-critical` for a value past its limit, and `--dash-chart-grid`, `--dash-chart-axis` and `--dash-chart-reference` for the lines behind a chart. The grid and axis colors are too faint for words, so tick labels are `--dash-text-secondary` at caption size: CSS on an axis's `text` sets that over the size and font that d3.axis puts on its group.
- Tooltips: `--dash-surface-popover`, `--dash-border`, `--dash-shadow-popover`, `--dash-text-secondary`.
- Put motion inside `@media (prefers-reduced-motion: no-preference)`, or the same `matchMedia` test in a script, so people who turned motion off get none. Use `--dash-dur-slow` and `--dash-ease-out`. Drawing code reruns on every data or width change, so play entry motion once, on the first draw with rows.

A page written for the dashboards on claude.ai works as it is: the dashboard sets their names to these tokens, so they follow the theme and the look too. `--cds-` plus the `--dash-` name stands for it (`--cds-page-bg`, `--cds-text-primary`, `--cds-gap-md`, `--cds-pad-lg`, `--cds-radius`, `--cds-font-size-body`, …), as do `--cds-chart-categorical-1` to `-8` for `--dash-chart-1` to `-8`, `--cds-chart-status-critical` for `--dash-chart-critical`, and `--font-anthropic-sans`, `-serif` and `-mono` for the three fonts. Any other `--cds-*` name is no token here, and check reports it. Write the names above in a page of your own.

### Fit

The data, not you, decides how long each label and number is, and the page runs from full width down to about 400px.

- Shorten a long number to fit its place (`1.2M`, with `d3.format(".2~s")`, or `Intl.NumberFormat` with `notation: "compact"`), and give the whole value in its tooltip.
- Text in an `<svg>` never wraps. A label longer than its room runs into its neighbour or off the edge, so measure it, then shorten it, break it into `<tspan>` lines yourself, or set it in HTML.
- Size a chart's margins by measuring its longest tick and end label (`getComputedTextLength()`, 0 until the chart is attached), never by estimating.
- The number of ticks follows the width (`axis.ticks(Math.max(2, width / 80))`, say), and end labels move apart, so no two labels meet when the chart narrows.
- One element wider than the pane makes the whole page slide sideways. An `<svg>` with a fixed `width` does it, so give it `width="100%"` and a `viewBox`, or size it from `clientWidth`. A table that can't narrow goes in a wrapper with `overflow-x: auto`, so only it scrolls.

### States

The type shows readers sign-in and load errors and how to fix them, so a connector's message stays off the page. For your CSS, it sets `data-dash-source-state="loading|refreshing|error|stale|empty"` on marks and `data-dash-state="loading|error"` on `#dash-root`. A source whose connector isn't set up, refused its credentials or waits on the reader's permission is stamped `error` but has status `"connect"`, so go by the status. While a source re-runs, its marks keep their last values, so fade the `refreshing` ones, or old numbers sit beside a new filter: `[data-dash-source-state=refreshing] { opacity: .5; }`. A source that failed with rows still up from an earlier load is `stale`: its marks keep those rows, so fade them too, and `#dash-root` says `error`. Anything that waits on data gets the class `dash-skeleton` while it loads, since a page full of `—` reads as broken. It draws a placeholder over the element and hides its contents. It fills a box with nothing in it, not even a space, and one that holds only text, a `—` too, gets a short bar. Only your script removes it, when data arrives or the load fails: once the status isn't `"loading"`, or it stays for good.

A chart's box with no `min-height` is at most a line tall until its data arrives, so the page jumps as each one does. Where the status is `"error"`, say so where that chart or figure stands, with a quiet "Failed to load": the type's own notice tells the reader that sources failed, never which part of the page they feed. `"connect"` and `"declined"` are no failures: the dashboard offers the fix, or says the connector is off, by itself.

### Tables

Mark a data table once at the top instead of on every cell: put `data-source` and `data-row-key="<column>"` (or `"a,b"` for composite keys) on `<table>`, plus `data-field` on each column header (`<th>`). A header column populated by a calculation names that calculation in its own `data-source` and uses matching row keys. Cells are matched using the key column's displayed text or `data-key` on `<tr>` (percent-encoded and comma-joined for composite keys); mismatched columns or ambiguous keys stay unmarked without error.

### Handing over

This part isn't a suggestion, since the person learns it only from you. Tell them, in a line each, what they can do next: ask you for any chart or control by name, such as a flow diagram, a date filter or a click that filters the whole page, and fields whose entries the dashboard keeps; download a source's rows as CSV from Sources; and, as an editor, edit a live query's request in Sources, test it, save it and restore one they saved earlier, or edit or replace an attached file there. Then what to know about their data: each live query runs when the dashboard is opened, refreshed or filtered, unless a recent enough answer stands, in their own page on their computer, with the access they gave that connector in their open-artifact connectors; people they share it with see attached files and shared saved rows, not live queries' numbers. Any reader with access to the dashboard can view attached files and shared saved rows regardless of their own connector access.

Say once where the numbers could come from next. A file that isn't `fixed` is often an export from a system that one of their connectors reaches, and could come from it live. If no connector does, name the source that would and the MCP server they could add to their open-artifact connectors for it. Rows you wrote yourself, whether sample, estimated or recalled, go in a file whose `title` starts with "Sample" and whose `description` says how you made them. Say which numbers those are, because the person may pass them on as real.

### Printing

Share → Export → PDF saves a PDF file of `#dash-root` in light mode with your `@media print` styles active; Share → Export → Print… (and the browser's own Print) opens the print dialog with the same styles. Page scripts cannot trigger `window.print()` themselves. Vertically scrollable containers expand automatically, and a footer line underneath notes the data freshness timestamp. Use `break-before: page` when tabs or story chapters belong on separate sheets (`@page` and `break-after` are not used here). In the PDF file a card (a bordered, shadowed or filled box up to about 60% of a sheet tall) stays on one sheet, and so does anything with `break-inside: avoid`; a taller card is cut between its lines. Any content hidden behind tabs, scroll steps, fade-ins, or horizontal scroll wrappers will be omitted unless your print styles lay it out visibly. Listen to `beforeprint` on `window` to prepare static views before printing (and `afterprint` to restore interactive state); either event may fire more than once.

The PDF file is drawn from a static copy of the page: your scripts do not run in it, and it is taken as soon as your `beforeprint` listeners return, so prepare the page in the listener itself, not in a timer or a later frame. The copy is as wide as the dashboard shows at that moment (at least one sheet wide; a wide dashboard goes on a sheet turned on its side), so a chart your script sized in pixels fits as it does on screen. `@media screen` rules and `prefers-color-scheme: dark` do not apply to it, and animations stand at their end.

### Links

On a page with tabs or sections, `dash.setLink("usage")` as the reader moves to `#usage` keeps that place in the link they copy. The page's code goes there when it opens, by `location.hash`, once the element exists.
