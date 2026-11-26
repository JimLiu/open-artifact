# Embed reference

[中文](embed.zh-CN.md)

This page lists the messages between an artifact's Shell (or the home page) and the app that shows it, and the API of
`@open-artifact/harness-kit/embed`. The types are in `packages/protocol/src/shell.ts` (`HostToShell`, `ShellToHost`,
`HomeToHost`). For how to use them, read [Showing pages in your UI](../integrating/embedding.md).

## Channels

| Mode | How messages travel |
| --- | --- |
| Frame | `window.postMessage` between your page and the Shell's iframe. The Shell sends `shell_hello` to `*`; every later message goes to the host's origin only. |
| Top-level view | Through the daemon. The Shell, loaded with `?oa_view=<ticket>`, claims the ticket; what it says reaches your adapter as `shell.event`; you answer with `shell.command`. A host whose origin cannot be declared (a `file://` page) may load the ticketed address in its own iframe: that Shell also talks through the daemon, and neither greets nor hears its parent frame. |

Every message is an object with the key `openArtifact` naming it. Host protocol version: `1` (`HOST_PROTOCOL`). Text
fields are cut to 8000 characters (`MAX_HOST_TEXT`).

## Host → Shell

| Message | Fields | |
| --- | --- | --- |
| `host_hello` | `caps` (`sessions?`, `toolbar?`, `artifacts?`, `switcher?`), `agentName?`, `harness?`, `protocol?`, `theme?` (`scheme`, `accent?`), `destinations?` (`id`, `label`; at most 8), `library?` (`harness?`, `workspace?`) | the answer to `shell_hello` or `home_hello`; send it again when the theme changes. Omit `theme` to clear a pinned scheme and accent |
| `goto` | `hash` | show this place; the Shell answers with `place` |

`caps.sessions`: you can start and open sessions. `caps.toolbar`: you draw your own toolbar, so the Shell hides its
close button. `caps.switcher`: your app lists and switches artifacts itself, so the Shell's title menu has no
"Switch artifact" (with "All artifacts"). `caps.artifacts` (home page only): a click on an artifact sends `open_artifact` instead of navigating.
`library` (home page only): list only that harness's artifacts (by the owner session's harness), or that folder's: the
owner session works in it, the artifact's folder is under it, or the artifact was made for a project the folder is in
or holds (so an artifact kept in the person's Open Artifact folder is still listed for its project).

`theme`, when present, is `scheme` (`light` or `dark`) and an optional `accent` (`#rrggbb`). The Shell pins that
scheme (`data-theme` on the root) and the accent properties (`--open-artifact-accent`, `--open-artifact-accent-fg`,
`--open-artifact-accent-soft`), and passes the same `theme` on `chrome_hello` so the page pins them too. Omit `theme`
to clear that pin on the Shell and the page. The page still supports light and dark; clearing does not force
`color-scheme: light`.

## Shell → host

| Message | Fields | Declared host only |
| --- | --- | --- |
| `shell_hello` | `version`, `protocol`, `artifact`, `id`, `title`, `type` | |
| `shell_ready` | `artifact` | |
| `new_session` | `prompt`, `artifact` | `prompt` is empty to an undeclared host |
| `open_session` | `session` (or `null`), `harness` | |
| `close` | — | |
| `place` | `artifact`, `hash` | |
| `comment_summon` | `text` | `text` is empty to an undeclared host |
| `open_external` | `url` (`http(s)` only) | yes |
| `saved_file` | `path` (absolute) | yes |
| `saved` | `state` (`saved`, `saving`, `unsaved`, `reconnecting`, `readonly`, or `null`), `leaveLosesWork` | |

`place` comes after `shell_ready`, whenever the place changes, and in answer to `goto`. `saved` comes after
`host_hello` and whenever the page's save state or `leaveLosesWork` changes; `state` is `null` before the page reports
one and while another page loads. `leaveLosesWork: true` means closing now loses work: ask before you close the view.
An older Shell sends no `saved`.

## Home page → host

| Message | Fields |
| --- | --- |
| `home_hello` | — (sent to `*` on load) |
| `home_ready` | — |
| `open_artifact` | `url`, `id`, `title`, `type` |
| `open_session`, `new_session` | as from the Shell |

## Artifact page → Shell: initial view and saving

The page's `connectShell()` connection from `@open-artifact/runtime` sends `ChromeReport` with
`report(...)` (chrome protocol 1). These reports are between the artifact page and the Shell, separately from the
host messages above.

- `ready: false` keeps the Shell's loading cover over the initial view. Send it before the frame loads, then
  `ready: true` once the view is restored. Omitting `ready` also shows the page. Once a document is shown, later
  `false` reports cannot cover it again; the Shell lifts the cover after `CHROME_READY_TIMEOUT_MS` (10 seconds)
  even if the page never becomes ready.
- `saved: 'saving'` includes edits waiting for a debounced write. The Shell shows “Saving…” only after 500 ms.
  Use `saved: 'unsaved'` for a failed save, and leave `saved` out when there is no save state to report.
- `shellArtifactId()` and `ShellConnection.artifactId` read the stable `open_artifact_id` from the framed page's
  URL, or return `null` outside the Shell or without an id. Use it to key remembered page state instead of a
  cloud-host page path whose token changes on each reload; it is not an authorization credential.

## Who is a declared host

The Shell reads `GET /api/open-artifact.embed` (`hosts`: the origins connected adapters declared in
`caps.open.origins`) and judges the origin that sent `host_hello`:

| Verdict | When | Effect |
| --- | --- | --- |
| declared | a connected adapter declared the origin, or the Shell runs in a view opened with a ticket (top-level or framed) | everything |
| refused | the list that applies names other origins, not this one | `host_hello` is not taken. A host this origin already installed is cleared (on the home page, its library filter goes too) |
| undeclared | no list has been read successfully yet: no adapter declared an origin, or every read so far failed | empty `prompt` and `text`; no `open_external`, `saved_file` or destinations |

The list that applies is the last one read successfully. A failed read before that first success is still undeclared
(a cloud host, or a type server's own Shell, cannot read the daemon's list). After a success, a failed refresh is
judged by that list: it does not become undeclared, and it does not widen trust by letting a refused origin through.
An older answer does not override a newer successful list. A refusal clears a host the same origin already wrote,
including one an earlier failed read had accepted. `shell_hello` is still sent to `*`. `goto` is still taken only
from the current host's origin.

## View tickets

| Rule | Value |
| --- | --- |
| URL parameter | `oa_view` |
| Use | once, by the connection it was issued to |
| Unclaimed after | 2 minutes |
| A Shell that reloads may come back within | 30 seconds |
| Commands queued before the Shell connects | 32 |
| Views per adapter connection | 64 |
| `shell.event` order | as the Shell said them: it sends one at a time, the next once the daemon took the last |

A ticket ends with its adapter connection.

## `embedArtifact(target, options)`

`target` is an iframe (frame mode) or a transport `{ send(command), onEvent(listener) }` (a view opened with a ticket, also when your iframe shows it).

| Option | |
| --- | --- |
| `url` | `viewUrl` (frame) or `embed_url` (view); set as the iframe's `src` when it differs |
| `agentName`, `harness`, `toolbar`, `switcher`, `theme`, `destinations` | what `host_hello` says |
| `onReady(info)` | `info`: `artifact`, `id`, `title`, `type`, `version`, `protocol` |
| `onOpenSession({ session, harness, artifact })` | sets `caps.sessions` |
| `onNewSession({ prompt, artifact })` | sets `caps.sessions` |
| `onCommentSent({ text })` | |
| `onPlace({ artifact, hash })` | |
| `onClose()` | |
| `onOpenExternal(url)` | default: `window.open` |
| `onSavedFile(path)` | |
| `onSaved({ state, leaveLosesWork })` | the `saved` message |
| `capture()`, `saveThumbnail(jpeg, artifact)` | thumbnails: 2 s after ready, then after a place change at most once a minute |
| `onError(error)` | a callback or a thumbnail failed |
| `window` | the window to listen on |

Returns `{ artifact, place, ready, saved, goto(hash), setTheme(theme | null), url(), destroy() }`. `setTheme(null)` sends
`host_hello` without `theme` and clears the pinned scheme and accent. `url()` is the Shell's address with the last
place and without a ticket.

## `embedLibrary(iframe, options)`

Options: `url`, `harness`, `workspace`, `agentName`, `theme`, `onOpenArtifact(artifact)` (sets `caps.artifacts`),
`onOpenSession({ session, harness })`, `onNewSession({ prompt, artifact })`, `onReady()`, `onError`, `window`. Returns
`{ setTheme(theme | null), destroy() }`. `setTheme(null)` clears the pinned scheme and accent the same way.

## Remote pages

`remotePolicyOf`, `remoteGate` and the types `RemotePagePolicy`, `AllowRemote` are exported from the kit's main entry
for apps that gate remote pages themselves ([remote types](../integrating/remote-types.md#showing-a-remote-page)).
