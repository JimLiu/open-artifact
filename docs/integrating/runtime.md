# Runtime and updates

[中文](runtime.zh-CN.md)

After reading this you can ship Open Artifact inside your app, know which copy starts the daemon when several apps carry
one, and choose how it updates.

## What the runtime is

The runtime is the content of the npm package `@open-artifact/cli`: `scripts/open-artifact.mjs` (the command line and
the daemon), and `vendor/` with the Shell, the type server and the built-in types. One daemon runs per Open Artifact
home (`~/.agents/open-artifact`, or `OPEN_ARTIFACT_HOME`), shared by every app on the computer.

## Carrying one

Ship the runtime folder with your app and name it when you connect:

```js
const oa = await createHarness({
  harness: 'my-agent',
  runtime: { dir: '/Applications/MyAgent.app/Contents/Resources/open-artifact', version: '0.14.0', update: 'prompt' },
});
```

`hello` registers it with the daemon (kept in `<home>/runtimes.json`), and the daemon copies the newest runtime a host
brought into the shared folder `<home>/runtime/<version>/`, so uninstalling your app does not take the computer back to
an older daemon. A registered folder that is gone is skipped.

The examples find the runtime they carry with `hostRuntime()` in
[`examples/harness-node/harness.mjs`](../../examples/harness-node/harness.mjs): the installed `@open-artifact/cli`
package, or in this repository the built skill, read for its version. It returns nothing when
`OPEN_ARTIFACT_DAEMON_BIN` is set, and throws when it finds no runtime.

With no `runtime`, the kit chooses among the runtimes other apps registered and the shared ones.
`OPEN_ARTIFACT_DAEMON_BIN` (an `open-artifact` entry file) skips the choice. When there is nothing to start it throws `no_daemon`, fix line: `Set OPEN_ARTIFACT_DAEMON_BIN to the open-artifact entry, or pass bin (createHarness:
runtime.dir).`

## Which one starts

When no daemon runs, the kit starts the **newest** runtime among your own, the registered ones and the shared ones, whose
Harness API versions meet yours, within the person's pin (`open-artifact runtime pin ^0.14`) when one is set. A tie goes
to your own. A running daemon older than your own runtime is replaced.

The kit starts it as `<your Node or Electron> <runtime>/scripts/open-artifact.mjs daemon run`, detached, with
`ELECTRON_RUN_AS_NODE=1`, so an Electron app needs no separate Node. Its output goes to `<home>/logs/daemon.out`; a
start that fails throws `daemon_failed` naming that file.

## Updates

| Policy | What the daemon does |
| --- | --- |
| `prompt` (default) | checks the registry at most once a day and tells subscribed adapters (`runtime/update` event); downloads nothing until someone says yes |
| `auto` | also downloads in the background |
| `bundled` | never checks; uses the runtimes on this computer |

Which policy is in effect, first match wins:

1. **The machine.** `OPEN_ARTIFACT_RUNTIME_UPDATE=off`, or a machine policy file with `{"runtimeUpdate": "off"}`
   (`$OPEN_ARTIFACT_MACHINE_POLICY`, else `/Library/Application Support/Open Artifact/policy.json`,
   `/etc/open-artifact/policy.json`, `%ProgramData%\Open Artifact\policy.json`) switches checks and updates off.
2. **The person.** `settings.json` `runtime.update`, set with `open-artifact runtime policy auto|prompt|bundled`
   (`default` removes it).
3. **The adapters.** The most conservative `update` of the registered runtimes; an adapter that says `bundled` abstains
   unless every one says `bundled`.
4. `prompt`.

`open-artifact runtime policy` with no word prints the policy and where it comes from.

### Saying yes from your app

```js
oa.on('event', (event) => {
  if (event.type === 'runtime/update' && event.available) offerUpdate(event.available);
});
// when the person agrees:
const { installed, pending, message } = await oa.runtime.update();   // or update('0.14.2')
const status = await oa.runtime.status();
```

`oa.runtime.status()` answers what `open-artifact runtime status --json` prints: the running version, the one that
would start, every runtime here, the policy and its source, the pin, the registry, the last check and a pending switch.
`oa.runtime.update(version?)` installs the newest compatible runtime, or that version; it is refused with `not_granted`
when the person chose `bundled` or the machine switched updates off. Both throw `unsupported` (fix line: `Update the
Open Artifact runtime this computer runs.`) when the daemon does not list the feature `runtime.update`.

### How an update is checked

- The source is `@open-artifact/cli` on the npm registry: `$OPEN_ARTIFACT_REGISTRY`, else `settings.json`
  `runtime.registry`, else the usual npm configuration, else `registry.npmjs.org`. Plain `http` only for a loopback
  registry.
- The check sends no credentials, no cookies and nothing about the person or their artifacts. It picks the newest
  version that is not a pre-release, not deprecated, within the pin, runs on this Node, and speaks the Harness API of
  every adapter seen lately.
- The tarball is refused unless its sha512 matches the registry's `dist.integrity`. The registry's provenance
  attestation is recorded and shown by `runtime status`, **not verified**.
- A tarball may be 256 MiB, unpacked 1 GiB. Three shared runtimes are kept.
- The daemon switches to the new runtime once it is idle (no open page, no tool call or long action running), or at the
  next start. Updates are logged to `<home>/logs/daemon.log`.

## Commands

| Command | Does |
| --- | --- |
| `open-artifact runtime status [--json] [--check]` | the runtimes here and which one starts; `--check` asks the registry now |
| `open-artifact runtime update [--version <x.y.z>]` | installs the newest compatible runtime, or that version |
| `open-artifact runtime pin <range> \| --clear` | keeps the runtime within a range |
| `open-artifact runtime policy [auto\|prompt\|bundled\|default] [--json]` | prints or sets the person's policy |

`update`, `pin` and `policy` are the person's decisions: run inside an agent's session they are refused.

## Artifacts from a newer release

Two apps may carry different runtimes, and a person may open on an older one an artifact a newer type release wrote.
The tools then treat it as read-only ([tools](tools.md#artifacts-written-by-a-newer-release)).

## A single executable

For an app with neither Node nor Electron, `open-artifact-<platform>-<arch>` (`.exe` on Windows) is Node with the
runtime inside. It has the same command line as `open-artifact`, so your app ships it and runs
`open-artifact-darwin-arm64 harness --stdio --harness my-agent` ([other languages](non-node.md)).

On first use it unpacks the runtime into the shared folder `<home>/runtime/<version>/`, checked by sha512 as an update
is, and runs it from there. That folder is an ordinary shared runtime: a newer one on the computer may still start
instead, run by the executable's Node. The daemon and the type servers it starts run on the executable too, so the
computer needs no `node`.

The commands the daemon gives an agent (in the skill text and in tool answers) start with the executable's path instead
of `node`, quoted when it has spaces or shell characters (on Windows that is always, because of the backslashes), and `open-artifact doctor` says `Node.js <version> (inside the single-file
executable <path>)`. Two limits:

- In PowerShell a quoted program path must be called with `&` (`& "C:\Program Files\My Agent\open-artifact-win32-x64.exe" …`).
  The daemon's text does not add the `&`, so an agent running such a command in PowerShell has to.
- The executable has been built and tested on macOS arm64 only. Other platforms build with the same script but are
  untested.

It is not published yet: build it yourself for each platform you ship, on that platform.

```text
npm run build
node scripts/build-skill.mjs
node scripts/build.mjs --only sea      # dist/sea/open-artifact-<platform>-<arch>
```

The Node that builds it is the one inside it: an official nodejs.org build of Node 25.5 or later (`--node <path>` or
`OPEN_ARTIFACT_SEA_NODE` to choose one). A Node built without single executable support, such as Homebrew's, cannot
be used. On macOS the result is signed ad hoc; sign it with your own identity before you ship it.
