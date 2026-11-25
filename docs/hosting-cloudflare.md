# A site on Cloudflare

[中文](hosting-cloudflare.zh-CN.md)

**At the end** you will have an Open Artifact site running on Cloudflare: the app at
`https://open-artifact.<your-subdomain>.workers.dev`, each artifact at `https://art-….example.com`, with no server of
your own to look after. Your agents publish to it; people sign in and open what is shared with them.

**Before you start** you need:

- a Cloudflare account, and the right to add Workers, D1 and DNS records to it;
- **one zone (a domain on Cloudflare) that is otherwise unused**, for the artifacts, for example `example.com`. Every
  host under it will be sent to the Worker;
- Node 22.18 or later and git on your computer, to build and deploy;
- a payment method if you choose Workers Paid (see [Costs](#costs)).

What it is: one Worker. The catalog (accounts, sessions, sharing, the Link) is in a D1 database; each artifact lives in
its own Durable Object (a small server with its own SQLite storage); one more Durable Object, the site hub, carries
live events. Static files (the editors, the Shell) are Worker assets.

> **If you are an agent doing this for someone**
>
> - Ask, never guess: which Cloudflare account (a login can reach several); which zone is for the artifacts and
>   whether anything else uses it; whether the app stays on `workers.dev` or goes on the same zone
>   ([One domain for both](#one-domain-for-both): weaker, the person's decision); the Worker and database name; who may sign up; whether artifacts may be public;
>   whether a dashboard's data may be published; Workers Free or Paid.
> - Only the person can: run `wrangler login` (a browser sign-in), add the wildcard DNS record if your token cannot
>   write DNS, open the sign-in page with the owner key, approve a computer, choose a paid plan.
> - Never print a secret. Generate `OA_SIGNING_KEYS` and `OA_OWNER_KEY` into files with mode 600 and pipe them to
>   `wrangler secret put`; tell the person the owner key's file path.
> - Ask before `d1 create`, `deploy`, `delete` or anything billed. Never deploy `wrangler.rooms.jsonc` (a test Worker
>   that lets anyone in).
> - Check each step before the next. After two failures of the same step, stop and report.

**What was run for this guide.** Locally, here: the build, `wrangler deploy --dry-run`, the Worker under `wrangler dev`
(health, sign-in, the admin API, the missing-secret error), and every config message quoted. On Cloudflare: the steps
were followed on **2026-11-22 against a real account** (one zone, the app on `workers.dev`), and the facts below
marked "seen on 2026-11-22" come from that deployment. The commands that talk to Cloudflare were not run again for
this guide, so their exact output is not quoted; the names in it are placeholders (`<your-subdomain>`, `example.com`,
`<account-id>`, `<database-id>`). Not tried on that deployment, nor anywhere else: `wrangler rollback`, `d1 export`,
an upgrade (deploying a newer version over the site), Cloudflare Access, Workers Free, costs, a removal, and the
one-zone layout with the app on a Custom Domain ([One domain for both](#one-domain-for-both), run only under
`wrangler dev`).

## The layout

| | Address | How it gets there |
| --- | --- | --- |
| App origin | `https://open-artifact.<your-subdomain>.workers.dev` | The Worker's own `workers.dev` address. |
| Content origin | `https://{id}.example.com` | A wildcard **route** `*.example.com/*` to the Worker, and a proxied wildcard DNS record. |

Why this layout: the two origins must be different registrable sites ([hosting.md](hosting.md#two-web-origins)), and
most people have one domain. `workers.dev` is a different site from `example.com`, so one zone is enough. Cloudflare's
free Universal SSL covers first-level names such as `art-….example.com`; a deeper name like
`{id}.content.example.com` would need a paid certificate.

If you have a second zone, the app can be a Custom Domain there instead (`artifacts.example.net`) with
`"workers_dev": false`. Not run here or on 2026-11-22. With only the one zone and no wish to use `workers.dev`, see
[One domain for both](#one-domain-for-both).

## Steps

### 1. Build

At the root of a checkout:

```bash
git clone https://github.com/JimLiu/open-artifact.git && cd open-artifact
```

```bash
npm ci && npm run build
```

```bash
cd deploy/cloudflare && npm ci && npm run build
```

**Expect** (the last lines; run here):

```
build: dist/site/worker.js 4.2 MB from 458 files; built-ins left to workerd: ./sheets.wasm node:buffer …
build: dist/rooms/worker.js 3.4 MB from 386 files; …
build: host plugins from plugins.mjs
build: sheets.wasm 7.8 MB; 8 types (data, design, design-system, docs, motion, sheets, slides, whiteboard); version 0.16.0
```

`deploy/cloudflare` has its own `package.json` (wrangler 4.166.0, esbuild); it is not part of the root install.

**Check:**

```bash
./node_modules/.bin/wrangler --version
```

prints `4.166.0`.

**If it fails:** the root `npm run build` must have run first (the Worker carries the editors and the Shell).

### 2. Sign in to Cloudflare and pick the account

```bash
./node_modules/.bin/wrangler login
```

The person approves in the browser. Then:

```bash
./node_modules/.bin/wrangler whoami
```

**Expect:** the email, and a table of the accounts this login can reach, with their ids.

If there is more than one account, wrangler cannot choose in a script (it stops to ask, or fails). Ask the person which
one, then:

```bash
export CLOUDFLARE_ACCOUNT_ID=<account-id>
```

Keep it set for every later command in this terminal. Seen on 2026-11-22: the login had two accounts, and
`CLOUDFLARE_ACCOUNT_ID` was needed.

**Without a browser** (CI, or an agent on a machine where nobody can approve `wrangler login`): wrangler uses an
account API token instead, from `CLOUDFLARE_API_TOKEN` together with `CLOUDFLARE_ACCOUNT_ID`. The person creates it in
the dashboard (**Account API tokens > Create Token**, starting from the **Edit Cloudflare Workers** template) and keeps
it in a file of mode 600 or the CI's secret store, never in the repository. From Cloudflare's "Authorization" pages
(read 2026-11-22): creating the Worker the first time needs the Workers **Admin** role (later deploys need **Editor**
for that Worker); the routes and the Custom Domain need *Zone > Workers Routes > Write* on the zone; `d1 create`,
`d1 list` and `d1 export` need D1 permissions on the account (a Workers role does not cover D1); the wildcard record of
step 8 needs DNS write on the zone. **Not run:** the guide was followed with `wrangler login` only, so which exact
set is enough was not checked.

### 3. Create the D1 database

Ask first: this creates a resource on the account.

```bash
./node_modules/.bin/wrangler d1 create open-artifact
```

**Expect:** a success message and a configuration snippet with the new `database_id`. Seen on 2026-11-22: the snippet
names the binding `open_artifact`. **The Worker wants the binding `DB`.** Copy only the `database_id` into the next
step; do not paste the snippet.

The name matters too: `database_name` in step 4 must be the name given here (`open-artifact`), and the `d1` commands
later in this guide (`d1 export`, `d1 delete`) name the database the same way. If you choose another name, change it in
all three places.

**Check:**

```bash
./node_modules/.bin/wrangler d1 list
```

lists `open-artifact`.

Not run here (it needs the account).

### 4. Write your own config file

Your account id, database id and domain do not belong in the repository's `wrangler.jsonc`. Copy it to
`wrangler.local.jsonc` (this name is in `deploy/cloudflare/.gitignore`, so git never sees it):

```bash
cp wrangler.jsonc wrangler.local.jsonc
```

Then change these parts of `wrangler.local.jsonc` and leave the rest as it is:

```jsonc
{
  "name": "open-artifact",
  "account_id": "<account-id>",
  // ... main, compatibility_date, flags, assets, durable_objects, migrations, triggers: unchanged ...
  "d1_databases": [{ "binding": "DB", "database_name": "open-artifact", "database_id": "<database-id>" }],
  "workers_dev": true,
  "routes": [{ "pattern": "*.example.com/*", "zone_name": "example.com" }],
  "vars": {
    "OA_APP_ORIGIN": "https://open-artifact.<your-subdomain>.workers.dev",
    "OA_CONTENT_ORIGIN": "https://{id}.example.com"
  }
}
```

You may not know `<your-subdomain>` yet: it is shown after the first deploy (step 6). Leave the placeholder for now.

The other settings (`OA_SIGNUP`, `OA_OWNERS`, `OA_PUBLIC_ACCESS`, `OA_LINK_MAX_ROLE`, `OA_TRASH_DAYS`, …) go in
`vars` with the same meanings as on Node ([hosting-server.md](hosting-server.md#decide)). `OA_AUTH` holds client
secrets: set it as a secret (step 7), not in `vars`. `OA_ALLOW_HTTP` is refused on Cloudflare.

**Check:**

```bash
./node_modules/.bin/wrangler deploy --dry-run -c wrangler.local.jsonc --outdir "$(mktemp -d)"
```

**Expect** (run here with the committed file, `-c wrangler.jsonc` in the same command; yours shows your database and
origins):

```
Attaching additional modules:
│ sheets.wasm      │ compiled-wasm │ 7995.03 KiB │
✨ Read 291 files from the assets directory …/deploy/cloudflare/dist/assets
Total Upload: 12321.77 KiB / gzip: 3886.45 KiB
Your Worker has access to the following bindings:
env.ROOMS (ArtifactObject)                                        Durable Object
env.HUB (SiteHubObject)                                           Durable Object
env.DB (open-artifact)                                            D1 Database
env.ASSETS                                                        Assets
env.OA_APP_ORIGIN ("http://localhost:8787")                       Environment Variable
env.OA_CONTENT_ORIGIN ("http://{id}.content.localhost:8787")      Environment Variable

--dry-run: exiting now.
```

Exactly one additional module (`sheets.wasm`) and a binding named `env.DB`. Nothing is uploaded.

**If it fails:** a JSON error names the line; `env.open_artifact` instead of `env.DB` means the snippet from step 3 was
pasted.

### 5. Check the zone is unused

The route `*.example.com/*` sends **every** host under the zone to the Worker. Ask the person whether anything else
runs on the zone. If something does, use another zone, or add a route for that host with no Worker in the dashboard
(**Workers Routes**); the most specific route wins. Seen on 2026-11-22: the zone was unused.

### 6. First deploy

Ask first.

```bash
./node_modules/.bin/wrangler deploy -c wrangler.local.jsonc
```

**Expect:** the upload (about 12 MiB, as the dry run says; startup 43 ms was seen on 2026-11-22), the bindings, the route
`*.example.com/*`, and the Worker's address `https://open-artifact.<your-subdomain>.workers.dev`. The Durable Object
classes are created by the `v1` migration on this first deploy. Note the address.

Why two deploys: the `workers.dev` address is only known after the first, and the secrets (next step) can only be put
once the Worker exists (both seen on 2026-11-22). Until the secrets are in (step 7) the Worker answers every request,
`/__open-artifact/health` included, with a 500 that names the first thing missing. With no secrets at all (run here
under `wrangler dev`):

```
Open Artifact is not configured: OA_SIGNING_KEYS: is required: one or more random secrets of at least 32 characters, comma-separated (the first signs).
```

With the signing key but no owner key:

```
Open Artifact is not configured: OA_OWNER_KEY: is required while the owner-key sign-in is on (OA_AUTH lists owner-key, the default): a Worker cannot print a generated key. Set a random secret of at least 24 characters with `wrangler secret put OA_OWNER_KEY` (locally: in .dev.vars).
```

Now put the real address in `OA_APP_ORIGIN` in `wrangler.local.jsonc`.

### 7. Set the secrets

Generate them into files only you can read, then pipe them in. Nothing is printed.

```bash
umask 077 && mkdir -p ~/.config/open-artifact
```

```bash
openssl rand -base64 48 | tr -d '\n' > ~/.config/open-artifact/signing-key.txt
```

```bash
openssl rand -base64 32 | tr -d '\n=+/' > ~/.config/open-artifact/owner-key.txt
```

```bash
./node_modules/.bin/wrangler secret put OA_SIGNING_KEYS -c wrangler.local.jsonc < ~/.config/open-artifact/signing-key.txt
```

```bash
./node_modules/.bin/wrangler secret put OA_OWNER_KEY -c wrangler.local.jsonc < ~/.config/open-artifact/owner-key.txt
```

**Check:**

```bash
./node_modules/.bin/wrangler secret list -c wrangler.local.jsonc
```

lists `OA_SIGNING_KEYS` and `OA_OWNER_KEY` (names only).

**If it fails:** "the Worker does not exist" means step 6 did not finish. The signing key must be 32 characters or more,
the owner key 24 or more. The `openssl` commands were run here; `secret put` was used on 2026-11-22.

Keep `owner-key.txt`: it is how the owner signs in. Tell the person its path.

### 8. Add the wildcard DNS record

On the zone, a record that makes every name resolve to Cloudflare. The address is never contacted, because the route
answers first:

| Type | Name | Content | Proxy |
| --- | --- | --- | --- |
| `AAAA` | `*` | `100::` | Proxied (orange cloud) |

If your wrangler login or API token can only read the zone (seen on 2026-11-22: `zone (read)`, no DNS write), the person
adds it in the dashboard: **DNS > Records > Add record**.

**Check:**

```bash
dig +short anything.example.com
```

**Expect:** Cloudflare addresses (not `100::`).

### 9. Second deploy

```bash
./node_modules/.bin/wrangler deploy -c wrangler.local.jsonc
```

**Check:**

```bash
curl -s https://open-artifact.<your-subdomain>.workers.dev/__open-artifact/health
```

**Expect:** `{"openArtifact":1,"version":"0.16.0"}`. Also:

| Request | Answer |
| --- | --- |
| `https://open-artifact.<your-subdomain>.workers.dev/` | 303 to `/auth/sign-in?return_to=%2F` |
| a name that is not an artifact's, such as `https://www.example.com/` or `https://art-test.example.com/` (`test` is not an artifact id) | 421, `www.example.com is not this site's app host nor an artifact's: Open Artifact does not answer it.` |
| a well-formed artifact name with no artifact behind it, `https://art-0000000000.example.com/` | 404, `Not found.` |
| `/__open-artifact/health` on any of those names | 200 |

The answers in the table were seen here under `wrangler dev` (app `http://localhost:8797`, artifacts
`http://{id}.content.localhost:8797`: `www.localhost:8797` and `art-test.content.localhost:8797` answered 421,
`art-0000000000.content.localhost:8797` 404). On the 2026-11-22 deployment the health and the 303 were seen; the 421
for other names came later and was not seen on Cloudflare. The catalog's tables are made on the first request; there
is no migration step.

**If it fails:** a 500 with `Open Artifact is not configured: …` names the setting. A content host that does not
resolve: step 8. A certificate error on a content host: the name is deeper than one level under the zone.

### 10. Sign in as the owner

The person opens `https://open-artifact.<your-subdomain>.workers.dev/auth/sign-in` and enters the owner key from
`owner-key.txt` (or opens the same address with `#key=<owner key>` at the end). Whoever signs in with it is a site
admin.

**The site's log.** A Worker writes no log file. `./node_modules/.bin/wrangler tail -c wrangler.local.jsonc` streams
each request and what the Worker logged (a plugin that failed, a configuration error) while it runs; the dashboard has
the same under the Worker's **Logs**. **Not run:** neither was used here or on 2026-11-22. The audit log (who did
what, and each `plugin.failed`) is in the catalog: a signed-in site admin reads it at
`/api/open-artifact.admin.audit` ([plugins.md](plugins.md#seeing-what-runs)).

### 11. Connect your computers

Follow [connecting-agents.md](connecting-agents.md#connect-a-computer-to-a-site) with the `workers.dev` address. To
set a computer up without a browser approval, use the admin API below. Seen on 2026-11-22: `remote add` by browser
approval, `publish`, the page with its frame from `art-….example.com`, local edits appearing on the open page about 4 s
later, share links, a guest joining, and a request from the page's Ask pane reaching the computer.

**Publishing is the person's.** An agent cannot do this step for them. Run from an agent's session (Claude Code,
Codex, Antigravity, or any agent app whose session variables are set), `open-artifact publish` and `remote add`
stop with, for example:

```
open-artifact: Publishing an artifact to a site is the person's decision, and this command runs inside an agent session (claude-code: CLAUDECODE is set), so it was not done.
Ask the person to publish it from the artifact’s Share panel, or to run `open-artifact publish art_0mwrnigw79b6e26beae1fac85 --remote work` in their own terminal.
```

(run here). The person can let agents publish to one site (`agentMayPublish`, see
[connecting-agents.md](connecting-agents.md#the-default-site-and-publishing-by-itself)). And `publish` run without a
terminal (a script, CI, a pipe) puts a dashboard up **without its rows**, because the question it asks needs someone
to answer it:

```
Its live data was not published: the page there shows no figures until the person publishes the data, from the dashboard's Share panel ("Publish its data") or with `open-artifact publish art_…` in their own terminal, which asks.
```

## One domain for both

The app on a **Custom Domain** of the same zone, `https://app.example.com`, and the artifacts on the wildcard route
`https://{id}.example.com`, with `OA_CONTENT_SAME_SITE=true`. It removes the `workers.dev` address, and it puts the
artifacts on the app's own domain, which is weaker: read [One domain for both](hosting.md#one-domain-for-both) with
the person first. It is their decision.

**Run only under `wrangler dev`** (below). It was not deployed: how Cloudflare routes the two on a real zone is taken
from Cloudflare's documentation, not seen.

How the requests reach the Worker, from Cloudflare's "Routes" page (Workers > Configuration > Routing, read
2026-11-22): a route and a Custom Domain may name the same host, and then "Routes … take precedence if configured on the
same hostname"; among routes, the most specific pattern wins; a route pattern may not have a wildcard inside a label
(`art-*.example.com` is not valid), so `*.example.com/*` is the pattern, and it matches every subdomain. So requests to
`app.example.com` run the Worker through the route. That is the same Worker, so nothing changes; the Custom Domain is
there for its DNS record and its certificate. Universal SSL covers `app.example.com` and `art-….example.com` (one level
under the zone).

In `wrangler.local.jsonc`, instead of the step 4 values:

```jsonc
"workers_dev": false,
"routes": [
  { "pattern": "app.example.com", "custom_domain": true },
  { "pattern": "*.example.com/*", "zone_name": "example.com" }
],
"vars": {
  "OA_APP_ORIGIN": "https://app.example.com",
  "OA_CONTENT_ORIGIN": "https://{id}.example.com",
  "OA_CONTENT_SAME_SITE": "true"
}
```

and the `AAAA * 100::` record of step 8. The app's address is known before the first deploy, so there is no
placeholder to replace after it; the other steps are the same.

Every other name of the zone also reaches the Worker, and in this mode it answers them with a 421 (`www.example.com …
is not this site's app host nor an artifact's`). The static files under `/_open-artifact/` are served on any routed
name (they are public). To keep another service on the zone, give it its own DNS record and add a route for that host
with no Worker in the dashboard (**Workers Routes**): a route with no Worker takes those requests away from the wildcard.

**Expect**, under `wrangler dev` with `OA_APP_ORIGIN=http://app.oa.localhost:<port>`,
`OA_CONTENT_ORIGIN=http://{id}.oa.localhost:<port>` and `OA_CONTENT_SAME_SITE=true` (run here):

| Request | Answer |
| --- | --- |
| `app.oa.localhost/` | 303 to `/auth/sign-in?return_to=%2F`, with `Cross-Origin-Resource-Policy: same-origin` and `Origin-Agent-Cluster: ?1` |
| `app.oa.localhost/api/open-artifact.auth.me` with `oa_session` sent twice | 200, signed out, and 10 `Set-Cookie` lines deleting the copies |
| `art-….oa.localhost/_open-artifact/support.js` | 200, `Origin-Agent-Cluster: ?1` |
| `www.oa.localhost/` | 421 |
| `www.oa.localhost/__open-artifact/health` | 200 |

**Check**, once deployed:

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://www.example.com/
```

**Expect:** `421` (if `www` has no other service).

**If it fails:** the 500 `Open Artifact is not configured: OA_CONTENT_ORIGIN: must be a different site … With only one
domain, OA_CONTENT_SAME_SITE=true allows it …` means the variable is missing from `vars`. A 421 on `app.example.com`
means `OA_APP_ORIGIN` does not match it exactly. A certificate error on the app: the Custom Domain was not added
(`wrangler deploy` adds it from `routes`).

## Link tokens on Cloudflare

A Worker has no command line next to its catalog, so `open-artifact-host link-token` is an API on the app origin,
for a signed-in site admin. In the browser console on the site, signed in:

```js
await (await fetch('/api/open-artifact.admin.link-tokens', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ user: 'ada@example.com', label: 'Ada laptop' }) })).json();
```

**Expect** (run here under `wrangler dev`, token left out):

```
{"id":"agt_SUJBbO8G2k5wMbl-zfD1Dw","user":"ada@example.com","remote":"http://localhost:8787","token":"<shown once>"}
```

Give the computer `remote` as `OPEN_ARTIFACT_REMOTE` and `token` as `OPEN_ARTIFACT_REMOTE_TOKEN`
([presets](connecting-agents.md#set-computers-up-in-advance)). Revoke:

```js
await (await fetch('/api/open-artifact.admin.link-tokens.revoke', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: 'agt_…' }) })).json();
```

**Expect:** `{"revoked":"agt_…"}` (run here). Without a session the API answers 401
`{"code":"unauthorized","message":"Sign in first.",…}`; it also refuses Bearer tokens and requests from other sites.

## Sign-in providers and Cloudflare Access

Providers work as on Node ([hosting-server.md](hosting-server.md#sign-in-providers)), with the callback on the app
origin: `https://open-artifact.<your-subdomain>.workers.dev/auth/<id>/callback`. Put `OA_AUTH` in with
`wrangler secret put OA_AUTH`, since it holds client secrets.

**Cloudflare Access** can sign people in instead: `{"kind":"cloudflare-access","teamDomain":"https://<team>.cloudflareaccess.com","aud":"<application AUD tag>"}`
in `OA_AUTH`. The site checks the `Cf-Access-Jwt-Assertion` on every request (signature, issuer, audience, expiry).
Paths that programs call with their own tokens must **bypass** Access: `/api/open-artifact.link.*`, `/mcp`,
`/.well-known/oauth-*`, `/oauth/token`, `/oauth/register`, `/oauth/revoke`; the content hosts need no Access
application. `deploy/cloudflare/README.md` ("Cloudflare Access") has the full table and two layouts. **Not run** here
or on 2026-11-22: only the token check's unit tests ran.

## Costs

Not measured on a bill. From Cloudflare's pricing pages as read on 2026-11-22 (USD; check the pages):

- **Workers Paid, $5 a month minimum,** is the realistic plan: it includes 10 million requests and 30 million CPU-ms.
  Workers Free allows 10 ms of CPU per request, which opening and importing artifacts will often pass.
- **Durable Objects:** an object is billed for time in memory. An artifact's object leaves memory about a minute after
  its last page closes (`OA_ROOM_IDLE_CLOSE_MS`, default 60000). **What keeps a room awake:** an open tab of that
  artifact, and nothing else. The one poll: while an artifact of a published type has pages open, its object reads
  that type's catalog row from D1 every 30 seconds ([Published types](#published-types)), one D1 query each time. **What keeps the site hub awake:** any open Shell tab, and every
  connected computer (it holds the computer's event stream). A computer left on and connected keeps the hub in memory
  all the time.
- **D1:** rows read and written. Local counts: the home page 3 queries, the artifact list 10 queries whatever its
  length.

## Limits

| | Cloudflare | Node |
| --- | --- | --- |
| Upload (`.zip`) | 32 MiB | 100 MiB |
| A Link push | 32 MiB, one file up to 16 MiB | 100 MiB, one file up to 64 MiB |
| Storage per artifact | 10 GB (Paid), 1 GB (Free) | the disk |
| Catalog | D1: 10 GB (Paid), 500 MB (Free) | the disk |
| A published type's package (`.oatype`) | 16 MiB | the package limits (64 MiB unpacked) |

## Page artifacts

A `page` artifact (a free HTML page an agent wrote, [Page](types/page.md)) runs on the Worker as it does on a Node site
([Page artifacts](hosting.md#page-artifacts)): the artifact's content host frames the inner shell
(`art-<id>.example.com/page/<page token>/`), and each person sees the page on a page host of their own,
`art-<id>--<24 characters>.example.com`, which serves its files and nothing else. Both run in the artifact's Durable
Object, next to its files and database.

- **Routes and DNS need nothing new.** A page host is one more name under the content origin's wildcard: the route
  `*.example.com/*` sends it to the Worker, the `AAAA * 100::` record of step 8 resolves it, and Universal SSL covers
  it (it is one level under the zone). With a deeper content origin (`{id}.content.example.com`), page hosts are as
  deep, and need the same paid certificate.
- The Worker sends a page host to the artifact's object with no cookie, and the object checks the part after `--`
  against the person's access now: it stops working when they lose access and when everyone is signed out.
- **`OA_PAGE_NETWORK`** (a `vars` entry): `self` (default), a page reaches only its own origin; `https`, it may also
  fetch any https origin. Another value stops the site with a configuration error naming it.
- **One domain for both** (`OA_CONTENT_SAME_SITE=true`): the site runs no pages. `link.hello` does not say
  `features.pages`, publishing a page is refused with `unsupported`, and a page host gets the 421 of a stray name.
- **A snapshot address of a page is not supported**: the site refuses it (403), as the Node site does. Share the page
  instead.
- The frame's own scripts are kept as Worker assets at `/_open-artifact/frame/<hash>/`, a new path each build. The
  object reads them from there once per isolate and serves them to the page itself, uncached, as the Node site does.
- An open page holds a WebSocket to its object, and the object takes it with `accept()` (no hibernation), so the
  object stays in memory while the page is open, like any open tab of an artifact ([Costs](#costs)); it closes about
  a minute after the last one goes (`OA_ROOM_IDLE_CLOSE_MS`).

**Run here** only under `wrangler dev` (`e2e/cloudflare-page.test.mjs`, page hosts on `*.content.localhost`): a page
published from a computer, opened by the owner and by a person who joined by the viewer link and was then made a
commenter, writes from the page reaching the computer's folder and a local edit reaching the open page, `link.hello`
saying `features.pages`, a capabilities change over remote MCP reaching the computer's `.artifact.json`, and an
uploaded page zip. Not deployed.

## Published types

The site keeps the types people publish to it (`open-artifact types publish`, see
[Publish to a site](custom-types.md#publish-to-a-site)) and runs the artifacts made with them, as a Node site does
([Published types](hosting.md#published-types)): the same checks on a package (one folder, plain files, the per-file and
file-count limits, a literal declaration, no `entry`, not a page type), the same rules on who owns an id, and the same
refusals when an artifact comes in by Link import or upload (`type_missing`, `type_mismatch`, and `not_granted` for a
new artifact of a delisted type). Export, duplicate, trash and the title (the manifest's `titleFrom`) work as for any
artifact, and an agent on the site's MCP is told that the type's text is its publisher's.

- **`OA_TYPES_PUBLISH`** (a `vars` entry): `admins` (default), `members` or `off`, as on Node; another value stops
  the site with a configuration error naming it. With one domain for both (`OA_CONTENT_SAME_SITE=true`) it is always
  `off`. `link.hello` says `features.types` and `typesPublish`, so a computer knows before it sends a package.
- **Where they are kept: in D1 only.** No object storage is needed or used. The catalog row is in the `types` table,
  as on Node. The package as published is in `type_package_chunks`, 768 KiB of the package per row (1 MiB as base64
  text, about half of D1's 2,000,000-byte row limit), with a head row in `type_packages` (its sha256, size, number of
  chunks and whether it is complete). The two tables are made on the first publish; there is no migration step. A new
  version is written whole under its own version and marked complete before the catalog row moves to it, and the old
  version's rows are deleted after that: a publish that fails half way leaves the previous version served, and the
  next try replaces what it left. D1 Time Travel restores them with the rest of the catalog.
- **16 MiB per package** (the `.oatype` file). A larger one is refused with `too_large` (413), naming the limit and
  that a Node site takes more, before the body is read whole. Inside it the limits are the Node site's: at most 2000
  files, 16 MiB per file, 64 MiB unpacked.
- **Type pages, the Types tab and the site's MCP**, while the site runs pages (never with `OA_CONTENT_SAME_SITE=true`,
  where it keeps no published types): as on a Node site ([A type's page on a site](custom-types.md#a-types-page-on-a-site)),
  each type has its page at `/t/<id>` (its publisher, its SKILL.md drawn as text, the install command, and who sees it
  for its publisher or a site admin to change), the home page has a Types tab, and the app's API has the site type
  routes (`/api/open-artifact.types`, `.type`, `.types.package`, `.types.update`, `.types.unpublish`). Who sees a type
  is the Node site's rule: `private` answers someone else as an unknown id does, `site` lists it to every member, `link`
  shows it to anyone with the address (signed out too, where the site allows public access, without naming a publisher
  whose name is an email address); signed out, anything else is sent to sign in. The site's MCP lists the published
  types a person may list (with the notice that their text is the publisher's), makes artifacts of them, and refuses
  a delisted one. A new artifact's folder is made by its object: `.artifact.json` with `type`, `id`, `title`,
  `release: null`, `typeUid` and `typeSource` (`<app origin>/t/<id>`) and nothing else, the marker a Node site writes.
- **Where its SKILL.md is kept.** In the `type_skills` table (`uid`, `version`, `skill`), made on first use like the
  package tables: the file the manifest's `skill` names (else `SKILL.md`), at most 256 KiB, written in the same batch
  that marks the version complete, and deleted with the version's rows. The type page and an MCP create read that one
  row, never the package. For a version stored before the table existed, the first view (or MCP create) reads it from
  the package once and keeps it.
- **What a download costs.** The package route (`GET /api/open-artifact.types.package?id=`, also what
  `types install https://<site>/t/<id>` fetches from a computer with no remote of the site, and what someone signed
  out may fetch for a `link` type) streams the package: `HEAD` answers from the head row (the size, with no chunk read);
  `GET` reads 4 chunks (3 MiB) per D1 query while the body is sent, hashes them as they pass, and holds the last chunk
  back until the sha256 matches the catalog's, so a package whose rows do not match ends in an error, never in a whole
  wrong file. The length is sent as `Content-Length` (a `FixedLengthStream`). For 16 MiB: 6 chunk queries, 9 D1
  statements in all signed out (`HEAD`: 3), far inside D1's 50 queries per Worker invocation on Free (1000 on Paid);
  in Node the memory it keeps was about 3 MiB at most, against about 34 MiB when the package is put together first
  (about 50 MiB and 120 MiB allocated without a collection). Cloudflare does not limit the size of a response body, and
  a Worker that is still streaming one stays active. A download by a signed-in computer (`types install` through its
  remote, the Link's `types.archive`) still puts the package together, as an object's first copy does.
- **How an artifact's object reads them.** The first time an artifact of the type opens, its object reads the package
  from D1 once, checks its sha256 and the package again, and copies `index.html`, `artifact-type.json` and the
  `artifact-type/` files into its own SQLite (rows of at most 1 MiB), under the fingerprint `<uid>@<version>:<sha>`.
  It serves the type's files from there, `no-cache` with an ETag that changes with every version, and the next start
  of the object needs no D1 read. The previous version's copy is deleted when a new one is copied.
- **How fast a new version reaches open pages.** The publish tells the site hub, the hub tells each artifact object
  that has the type open, and the object copies the new version, sets the new Content-Security-Policy and has its open
  pages load the frame again (the data stays). Under `wrangler dev` an open page showed the new version about 0.1 s
  after `types publish` returned. If the hub has left memory since the object registered (it then forgets which
  objects run which type), an object with open pages still checks the catalog row every 30 seconds, and any request to
  it more than 2 seconds after the last check checks again: **at worst about 30 seconds**, plus the copy. A new page
  opened elsewhere sees a new version within 5 seconds (how long a Worker isolate keeps a type's row).
- **Delisted and removed.** `types unpublish` of a type that artifacts use delists it: their objects keep running it,
  open pages are not reloaded, and a new artifact of it is refused. Unpublishing a type no artifact uses removes it:
  an object that still had it open closes it (its pages' connections end), nothing of it opens again, and its D1 rows
  are deleted.
- **What a type can do**: nothing runs on the server. Its page runs on each person's page host in a sandboxed frame,
  under a Content-Security-Policy made from its manifest's `openArtifact.network` list (`OA_PAGE_NETWORK` does not
  widen it).
- **CPU and memory, measured locally in Node (not on Cloudflare):** for a 16 MiB package of 16 files that do not
  compress, the checks took about 10 ms of CPU, keeping it (every file inflated once to check it, then written in 6 D1
  batches of 4 rows) about 50 ms with about 16 MiB more memory, reading it back whole (an object's first copy, the
  Link's `types.archive`) about 30 ms with a peak of about 53 MiB, and an object's first copy about 40 ms. A small package that unpacks to 64 MiB took about 190 ms to keep.
  That is far inside Workers Paid (30 s of CPU by default) and 128 MB per isolate, but **past Workers Free's 10 ms per
  request**: on Free, publishing a type and the first open of its artifacts can be stopped for CPU except for very
  small types.
- **Names in the library.** The library may show a published type's id instead of its name until the Worker isolate
  has read its row (the site's MCP reads the rows again for each call).

**Run here** only under `wrangler dev` (`e2e/cloudflare-types.test.mjs`, with the synthetic type
`e2e/fixtures/site-type/team-poll`): a type published from a computer, an artifact of it published and opened by the
owner and by a person who joined by the viewer link, version 1.1.0 reaching both open pages and the old version's rows
leaving D1, and unpublishing it while the artifact uses it; then a second type's page for its publisher, for a second
account per visibility and signed out, the Types tab, its 4 MiB package streamed with its length (`HEAD` and `GET`),
the site's MCP listing it with the notice, making an artifact of it that opens and refusing the delisted one, and
`types install <site>/t/<id>` from a second home with no remote. Not deployed.

## Not supported here

- `open-artifact-host` commands: `link-token` is the admin API above; backup is D1 Time Travel plus each artifact's
  export.
- A built-in type added after the build: those are built in; rebuild and deploy to add one. A type of a person's
  own is published to the running site instead ([Published types](#published-types)).
- Pictures and PDFs on the site: made on people's computers, as on every site.
- A dashboard's live connectors: its figures come from the owner's computer as of the last refresh (every 6 hours by
  default), once the owner confirmed its data may be published.
- `OA_ALLOW_HTTP`, and plain http except `localhost` under `wrangler dev`.
- A snapshot address of a page artifact, and pages at all in [one domain for both](#one-domain-for-both) mode.

## Updates

```bash
git pull && npm ci && npm run build && cd deploy/cloudflare && npm ci && npm run build
```

```bash
./node_modules/.bin/wrangler deploy -c wrangler.local.jsonc
```

The catalog migrates on the first request after the deploy. A code-only change can be undone with
`wrangler rollback`. Neither an upgrade nor a rollback was run, here or on the 2026-11-22 deployment.

## Export and backup

- The catalog: D1 Time Travel restores any minute of the last 30 days (Paid) or 7 (Free). A copy you keep:
  `./node_modules/.bin/wrangler d1 export open-artifact --remote --output=catalog.sql -c wrangler.local.jsonc`.
  Not run, here or on the 2026-11-22 deployment.
- Artifacts: there is no account-wide export of Durable Object storage. Each artifact's owner downloads it from the
  Shell ("Whole folder (.zip)" in Export); a connected computer's working copy is a full copy. Restore by uploading the
  zip on the home page, or publishing again.

## Removing everything

Ask first; this deletes every artifact on the site for good. Not run here or on 2026-11-22 (that deployment was kept).

```bash
./node_modules/.bin/wrangler delete -c wrangler.local.jsonc
```

```bash
./node_modules/.bin/wrangler d1 delete open-artifact
```

Then the person deletes the `AAAA *` record on the zone, and you delete the secret files in `~/.config/open-artifact/`.

## Try it locally first

No account needed (run here):

```bash
cp .dev.vars.example .dev.vars
```

Set `OA_SIGNING_KEYS` and `OA_OWNER_KEY` in `.dev.vars` (it is git-ignored), then:

```bash
PORT=8797 PERSIST_TO=/tmp/oa-cf-state npm run dev -- --ip 127.0.0.1
```

`npm run dev` runs `dev.sh`: it **builds the Worker again every time** (`node build.mjs`, a few seconds; the root
`npm run build` is not rerun, so rebuild the root yourself after changing an editor or the Shell), then starts
`wrangler dev` with the app on `http://localhost:$PORT` (default 8787), the artifacts on
`http://{id}.content.localhost:$PORT`, and the state in `PERSIST_TO` (default `./.state`). Anything after `--` goes to
`wrangler dev`. To keep the secrets somewhere other than `.dev.vars`, give a file of the same `NAME=value` lines:

```bash
PORT=8797 PERSIST_TO=/tmp/oa-cf-state npm run dev -- --ip 127.0.0.1 --env-file ~/.config/open-artifact/dev.env
```

**Expect:** `Using secrets defined in …/dev.env` (or `.dev.vars`), the bindings, then
`[wrangler:info] Ready on http://127.0.0.1:8797` (both forms run here). `curl -s http://localhost:8797/__open-artifact/health`
answers `{"openArtifact":1,"version":"0.16.0"}`; sign in at `http://localhost:8797/auth/sign-in` with the owner key.
Artifacts are at `http://{id}.content.localhost:8797`. Stop it with Ctrl-C; delete the `PERSIST_TO` folder to start
over.

**If it fails:** a 500 `Open Artifact is not configured: OA_SIGNING_KEYS: is required …` on every request, the health
check included, means wrangler read no secrets: no `.dev.vars` in `deploy/cloudflare`, or a wrong `--env-file` path.
`curl` with a Host that cannot be a name (`-H 'Host: a b'`) gets a 500 `Internal Server Error` from `wrangler dev`
itself, before the Worker; on Cloudflare such a request never reaches it, and on Node it gets a 400.
