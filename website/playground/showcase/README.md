# The playground's showcase artifacts

One folder per demo: the artifact a visitor finds at `/playground/<demo>/`, made to show what its type is good at.
Each is a real artifact folder in its type's own format (`artifact-types/<type>/SKILL.md` and `reference/` say what
that is), read by `scripts/make-seeds.mjs` into `src/seeds/generated/<demo>.json`.

All nine tell one story, so the home page's stage reads as one workspace: **Juniper Coffee**, a small subscription
roaster getting its spring launch ready (a new app and a new seasonal blend, "First Light").

| Demo | What it is |
| --- | --- |
| `design` | The Juniper app's launch screens and a landing hero, as artboards on one canvas |
| `slides` | The spring launch deck |
| `whiteboard` | The launch week plan, as a board |
| `docs` | The spring launch brief |
| `sheets` | The launch budget workbook |
| `data` | The subscriptions dashboard |
| `motion` | The launch teaser film |
| `design-system` | Juniper's design system |
| `page` | A brew guide: a small interactive page |

The brand, for every demo: ink `#1d1b16`, cream `#f7f2e8`, fog `#e7e2d6`, forest `#20402f`, moss `#5b7f5e`,
terracotta `#c2562b` (the accent), honey `#e3a53c`. Display type is a serif (`'Iowan Old Style', 'Palatino Linotype',
Georgia, serif`), everything else the system sans. No web fonts, no pictures from the network: the checks fail on any
request to another host. Artifact content is in English.

## A demo's files

| File | What it holds |
| --- | --- |
| `showcase/<demo>/…` | The artifact folder |
| `demos/<demo>.demo.json` | The demo: `id`, `type`, `typeTitle`, `title`, `source` (the folder, from the repo root), optional `prefix`, `add`, `omit` (see `scripts/make-seeds.mjs`), the simulated agent's script (`agent`) and the replay (`replay`) |
| `scripts/verify/<demo>.mjs` | The demo's browser checks |
| `src/replay/types/<demo>.ts` | Only when the replay needs it: the demo's hooks (`ReplayHooks` in `src/replay/replay.ts`): where the comment goes when only the built artifact can say, when the editor is up, and what the page does while the build's steps land (a long doc follows the writing) |

Three demos are written by a generator, which is where to change them: `docs/make.mjs` and `sheets/make.mjs` run the
replay's own edits through the real engine, so the plain demo and the replayed one end with the same document, and
write both the artifact folder and the demo file; `data/_src/build.mjs` writes the dashboard's folder and demo file
from its page sources. Run the generator, then `make-seeds.mjs`. The other demo files hold copies of the artifact's
files where the agent rewrites one (a slide, an artboard, the page): change the artifact and the copy together.

`src/seeds/manifest.ts` documents every field of `agent` (`AgentScript`, `AgentEdit`) and `replay` (`ReplayScript`).

```bash
node website/playground/scripts/make-seeds.mjs <demo>          # after any change to the folder or the demo file
ONLY=<demo> node website/playground/scripts/verify.mjs         # against the dev server on http://127.0.0.1:5190/
```

Screenshots land in `website/playground/.spike-shots/` (`replay-<demo>-1-building.png` … `-5-skipped.png` from the
replay; the others are named by the demo's checks). Look at them: a check that passes says nothing about how it looks.

## The simulated agent

`agent.responses` are the agent's turns in order, then over again. Each has a `reply` (a string, or `{en, zh}`) and
`edits` applied through the store's own write paths, so the editor shows them live as an agent's edit.

- The first response answers the replay's comment, and is also the first answer on the plain demo. It must make a
  change anyone can see at a glance.
- Write at least two more for whatever the visitor asks next: visible changes that make sense whatever was asked, with
  `{{request}}` quoting it in the reply.

## The replay

`/playground/<demo>/?replay=1` plays the session of an agent asked for this artifact, beside the real page:

1. The person's `prompt` types itself: `/open-artifact <type> …`, the words someone would really type.
2. The agent's tool calls build the artifact: the `steps`. The artifact starts as the seed without everything the steps
   `take` (and with `start` in place of the seed's own files); each step lands its part. A type whose artifact lives in
   an engine (docs, sheets) starts from skeleton files in `start` and is built by `edits` (`doc-ops`, `sheet-edits`).
3. The agent says what it `made`.
4. The `comment` is drawn over the page (a pointer goes to `at`, a card types the text), then left as a real thread
   and sent to the agent, whose first response changes the artifact.

What makes a good one:

- The build shows the artifact growing, in four to eight steps, the way an agent would write it: structure first, then
  the parts, a `check` at the end. Not one write. 5 to 9 seconds in all (`ms` per step).
- Every `say` is a tool call as a session shows it: `Write project/screens/Home.dc.html`, `ArtifactData · write 12
  elements`, `Artifact · call check`.
- Every intermediate state must be one the editor shows without errors (an order list never names what is not there
  yet: `order` keeps it in step).
- The comment asks for something a person would ask, on the thing `at` points at, and the answer is visible from where
  the page stands (no scrolling, no other tab).
- `comment.anchor`, `label`, `detail` and `location` are the real ones the editor makes for that spot: leave the
  comment once through the page's own comment UI and read `window.__PLAYGROUND__.comments.list()`.
- `prompt`, `made`, `comment.text` and the replies are in both languages.
- It must look right in the home page's stage: the page area beside the session is about 850 × 600. The replay check
  runs at 1200 × 720.
- A skip must end in the same artifact: the replay check runs it both ways.
