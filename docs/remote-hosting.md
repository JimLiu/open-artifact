# Remote HTTPS artifact hosting

The daemon's private loopback API is not a public web server. Do not point an
unauthenticated reverse proxy at it: loopback callers are trusted owners.

## Configure from DeepSeek Harness

Open **Settings -> Artifact Hosting**. Configure:

- **Public Shell HTTPS origin**, for example `https://artifacts.example.com`.
- **Isolated frame origin template**, for example
  `https://{artifactId}.frames.example.com`.
- **Gateway listen address**, a concrete non-loopback interface reachable by the
  TLS proxy (for example its Docker bridge gateway).
- **Gateway port**, default `4801`.

Save applies the shared daemon settings immediately. All harnesses and artifact
types use the same configuration. Settings survive daemon and DSH restarts.
Clear both origins to return to local-only access. An occupied listener fails
without replacing the active configuration.

The gateway uses public DNS-safe `art-...` labels for internal `art_...` IDs.
Provision DNS and certificates for `*.frames.example.com`; it covers editor,
read-only nested content (`content-art-...`) and guest (`guest-art-...`) origins.
Keep Shell and frame namespaces distinct, preferably on the same site so browser
third-party-cookie policies do not interfere with editor capabilities.

## TLS proxy

Terminate TLS at your existing reverse proxy and send these hostnames to the
configured gateway interface and port. Preserve the original **Host** and
**Origin**. Do not rewrite an arbitrary Origin to make writes work. Forward
WebSocket upgrades and server-sent event streams, disable response caching, and
avoid logging capability URLs. Do not expose the private daemon, Harness API,
MCP endpoint, Type API, or type-server control ports separately.

The daemon's recorded URL and process bearer token remain private loopback
control details. The gateway owns browser authentication and validates public
origins before forwarding to an allowlisted local artifact server.

## Owner and guest links

An owner URL authenticates the browser with a Secure, HttpOnly, host-only cookie,
then redirects to the artifact without the capability in its address. The owner
link is persistent across restarts and grants owner access to this local library:
keep it private, never share it with collaborators.

Use the existing Share panel for collaborators. Public guest links have their
own isolated host and retain native editor/commenter/viewer roles. Guests never
receive owner cookies or the daemon bearer; link reset and disabling sharing are
enforced by the native artifact server. Types without native sharing support do
not gain guest sharing just by enabling HTTPS.

Nested frame-host types use three origins: trusted Shell, artifact broker, and
read-only artifact content. Their private open RPC receives explicit hosted
origins; public query strings cannot grant trusted origins. Artifact content
cannot access the Shell cookie or the broker's control endpoints.

The listener starts with the daemon and artifacts mount lazily from the durable
library, so a saved owner URL works after restart even when backend type ports
or mount tokens change. Hosted mode disables idle daemon exit. A service manager
should start the daemon before the DSH host when links must remain available
independently of open conversations.

## Migrating baoyu-design installations

`dsh-open-artifact` replaces the old `dsh-claude-*` integration; it does not import
its catalog or preserve old capability URL formats automatically.

```sh
node scripts/migrate-legacy-baoyu.mjs --catalog /path/to/.dsh/baoyu-design/artifacts --out /path/to/new-copies
node scripts/migrate-legacy-baoyu.mjs --apply --catalog /path/to/.dsh/baoyu-design/artifacts --out /path/to/new-copies
```

The default is a write-free preview. Apply copies supported content into new
roots, relocates old blob directories byte-for-byte, preserves legacy metadata
in a manifest, refuses collisions/symlinks, and never modifies original roots or
sharing keys. Adopt the copied roots using their manifest `type_url` and title,
then verify rendering, editing, assets and exports before replacing the old
installation. Old links require a one-time re-share with the new URLs.

Motion is not a built-in type in this release. The migration utility refuses to
silently treat it as Data or discard it. Install a compatible custom type before
migrating Motion, or preserve its source and exports in the rollback archive.
Docs/Sheets layout relocation and Data live connectors require additional
compatibility checks; the manifest reports those limitations.

## Verification

```sh
npm run check
node scripts/migrate-legacy-baoyu.test.mjs
```

Gateway tests cover owner authentication, isolated cookies, private-route refusal,
strict Origin validation, HTTP/SSE/WebSocket transport, nested content isolation,
real native guest roles and revocation, and persisted owner URLs after restart.
Browser checks additionally verify actual rendering and edits; fetching an HTML
shell successfully is not sufficient evidence that the editor works.
