# @open-artifact/library-page

The Open Artifact library page as a React component: the list of artifacts (grid or list, search, filters by type
and date), new artifacts from the type tiles, rename, pin, copy link, delete with undo, thumbnails, an update panel,
"What's new" and the changelog. Two hosts mount it: the DSH plugin (`plugins/dsh`) in DSH's sidebar, bundled into
its `lib/client.js`, and Open Artifact Desktop (`apps/desktop`) as its home tab, bundled into the window's page. The
package is private: hosts in this repository bundle it.

The page knows nothing of the app around it. A host gives it its routes, its app and its words through the interfaces
below, maps the page's `--oa-page-*` tokens onto its own design tokens, and sets two attributes on the page's root.

## Entries

| Import | What it has | DOM / React |
| --- | --- | --- |
| `@open-artifact/library-page` | `ArtifactsPage` (and its `TileGroup`), `TypeIcon`, `EnvProvider`, `StoreProvider`, `createPageStore`, the update panel, the changelog views, the words, the CSS, and everything below | React (a peer dependency, `>=19`) |
| `@open-artifact/library-page/library` | What a host's server needs too: the route answers' shapes (`PageArtifact`, `ArtifactList`, `OpenAnswer`, `DeleteAnswer`, `TypeTile`), the Library API answers in those shapes (`pageView`, `artifactList`, `openAnswer`, `deleteAnswer`, `typeTiles`, `thumbnailStamp`), `isNewer`, `latestOf`, the changelog parser (`parseChangelog`, `releasesBetween`, …) and `captureRecipe` | neither |
| `@open-artifact/library-page/styles` | `PAGE_CSS`, `UPDATE_CSS`, `injectStyles` | DOM only |
| `@open-artifact/library-page/words` | The page's words in Chinese and English (`zh`, `en`), `translator`, `fill`, `isKey` | neither |

The package ships TypeScript source (`src/`); a host bundles it. React and `react/jsx-runtime` are imported, not
bundled in: the host's bundler decides where they come from.

## Mounting it

```tsx
import { ArtifactsPage, createPageStore, EnvProvider, StoreProvider, translator, PAGE_CSS, UPDATE_CSS, injectStyles } from '@open-artifact/library-page';

injectStyles('my-app/page.css', MY_TOKEN_CSS + PAGE_CSS + UPDATE_CSS);
const t = translator(myLocaleLookup); // undefined: the page's own Chinese/English words
const store = createPageStore({ api, host, t });

<EnvProvider env={{ t, api, sessions, updates, changelog }}>
  <StoreProvider store={store}>
    <ArtifactsPage canCreate={host.canCreate()} theme="dark" platform="darwin" />
  </StoreProvider>
</EnvProvider>
```

## What the host implements

| Interface | Where it goes | What it is |
| --- | --- | --- |
| `PageApi` | `createPageStore({ api })`, `PageEnv.api` | The host's routes as functions: `list`, `open`, `preview`, `update` (title, pinned), `remove`, `restore`, `saveThumbnail`, `thumbnailUrl`, and `events` (library events; null where there are none). The answers are the `./library` shapes; a host's server makes them from the daemon's Library API with `artifactList`, `openAnswer`, `deleteAnswer` and `pageView`. |
| `PageHost` | `createPageStore({ host })` | The app: `canCreate`, `create(type?)` (start a session, empty or to make one of `type`; the host decides what it says to the agent), `away`, `pendingWindow`, `show(answer, pending)` (show an opened artifact), `copy`, `visible`, and optionally `capture` (take a thumbnail of a page) and `storage` (where the layout choice is kept). |
| `Translate` | `createPageStore({ t })`, `PageEnv.t` | The page's words. `translator(lookup)` wraps the host's locale lookup and falls back to the page's own words for a key it does not know. |
| `ExternalStore<SessionsSnapshot>` | `PageEnv.sessions` | The host's conversation list (`ids`, `byId[id].title`), for the session titles a card and the search show. `EMPTY_SESSIONS` is none. |
| `PageUpdates` | `PageEnv.updates`, optional | An update offer and its run: an `ExternalStore<UpdateState>` plus `start`, `later`, `close`, `reopen` and the panel's words `t`, and optionally `restart()`: a host that can finish an update itself (a runtime that takes effect when a service restarts) gives it, and the finished panel of a `restart: true` state then has a primary button with the word `restart` beside Close. Without `restart` the panel only says what to do (`done.restart`), as before. Without `updates` the page draws no update panel. |
| `ChangelogReader` | `PageEnv.changelog`, optional | `(upcoming) => Promise<ChangelogAnswer \| null>`: the release notes, for "What's new", the offer's notes and the changelog. Without it the page shows none. |

`ArtifactsPage` takes these props:

| Prop | Default | What it does |
| --- | --- | --- |
| `canCreate` | (required) | The app can start something from here: the type tiles and the New button. |
| `theme` | light | `dark` draws the dark look (see the root attributes). |
| `platform` | none | `darwin` leaves room for a macOS title bar. |
| `searchButton` | `true` | The search button in the heading. With `false` the search box shows only after the host calls the store's `focusSearch()`, or while there is a query. |
| `createButton` | `true` | The New button in the heading (with `canCreate`). The type tiles stay either way. |
| `tileGroups` | one row | `TileGroup[]` (`{ id, title, types }`): the type tiles in groups, each under its own heading, in the order `types` lists; a group's element carries `data-group="<id>"`. A type no group names goes at the end of the last group; a group with no installed type is left out. |
| `headingTools` | none | A node the host puts first among the heading's tools (before filter and layout), such as a status button of its own. |
| `cardActions` | none | The host's own items in each card's More menu, after Share: `{ id, label, icon?, run(artifact) }` (a desktop app's Show in Finder and Move To…). |

The store's `focusSearch()` (in `PageActions`) asks the page to show its search box and put the keyboard in it; each
call counts up `searchFocus` in `PageState`, so the page focuses it again even when the box is already showing.
`TypeIcon` is the type glyph the page draws on cards and menus, for a host that lists artifacts around the page.

## Tokens

`PAGE_CSS` and `UPDATE_CSS` read these custom properties and define none of them. The host declares them, as its own
design tokens, on `.oa-page`, and on `.oa-btn` and `.oau-tag` too when it draws the update button or tag outside the
page: a `var()` in a custom property is read where the property is declared.

| Token | What it is | DSH maps it to |
| --- | --- | --- |
| `--oa-page-text-primary` | Text | `--dsw-alias-label-primary` |
| `--oa-page-text-secondary` | Secondary text, icons | `--dsw-alias-label-secondary` |
| `--oa-page-text-tertiary` | Section titles, meta | `--dsw-alias-label-tertiary` |
| `--oa-page-text-caption` | Placeholders, disabled | `--dsw-alias-label-caption` |
| `--oa-page-bg` | The page's background | `--dsw-alias-bg-base` |
| `--oa-page-hover-bg` | Hover, quiet buttons | `--dsw-alias-interactive-bg-hover` |
| `--oa-page-accent` | Primary buttons, focus, selection | `--dsw-alias-state-business-primary` |
| `--oa-page-danger` | Errors, delete | `--dsw-alias-state-error-primary` |
| `--oa-page-border-strong` | Checkboxes, strong lines | `--dsw-alias-border-l1` |
| `--oa-page-border` | Cards, fields | `--dsw-alias-border-l2` |
| `--oa-page-border-floating` | Menus, dialogs, badges (falls back to `rgba(0,0,0,.16)`) | `--dsw-alias-border-l4` |
| `--oa-page-skeleton-bg` | Loading placeholders (falls back to `--oa-page-hover-bg`) | `--dsw-alias-bg-skeleton` |
| `--oa-page-focus-ring-width` | Focus ring width (falls back to `2px`) | `--dsw-focus-ring-width` |
| `--oa-page-focus-ring-color` | Focus ring color (falls back to `--oa-page-accent`) | `--dsw-focus-ring-color` |
| `--oa-page-top-clearance` | Room a macOS title bar takes, with `data-platform="darwin"` (falls back to `0px`) | `--dsh-frame-top-clearance` |

DSH's mapping is `PAGE_TOKENS` in `plugins/dsh/src/client/styles.ts`; a test there checks it maps every token the
page reads.

## Root attributes

`ArtifactsPage` writes these on its root, `section.oa-page`, from its props:

| Attribute | Prop | Effect |
| --- | --- | --- |
| `data-theme="dark"` | `theme` | The dark look of the type tiles and the type glyphs (cards and menus). Anything else is the light one. |
| `data-platform="darwin"` | `platform` | Adds `--oa-page-top-clearance` above the heading, for a macOS window's title bar. |

Every class starts with `oa-` (the page) or `oau-` (the update panel), so the CSS reaches nothing around the page.
The layout choice is kept under the `open-artifact.view` key of `PageHost.storage`.

## Test

```bash
node --test packages/library-page/test/*.test.ts   # part of npm test
```
