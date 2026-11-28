import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import test from 'node:test';
import { isShellOf, library } from './lib/app.ts';
import { connectCdp, type Cdp } from './lib/cdp.ts';
import { APP, alive, cleanEnv, daemonState, freePort, leftovers, makeProfile, RUNTIME, sleep, stopDaemon, until } from './lib/env.ts';

test('root launcher: React/CSS hot updates, guarded Electron restarts, fresh same-version runtime and cleanup', { timeout: 480_000 }, async () => {
  const repo = resolve(APP, '../..');
  const profile = makeProfile('oa-desktop-dev-');
  const port = await freePort();
  const debug = await freePort();
  const fixture = mkdtempSync(join(APP, 'renderer/.dev-hot-'));
  const mainProbe = join(APP, 'src', `.dev-watch-${process.pid}.ts`);
  const typeProbe = join(repo, 'artifact-types/docs/reference', `.dev-watch-${process.pid}.md`);
  // Create before Vite starts, so initial file-add events cannot race the first hot update.
  const probe = (label: string) => `import { useState } from 'react';
export function Probe() { const [count, setCount] = useState(0); return <button id="hot-probe" onClick={() => setCount(count + 1)}>${label}: {count}</button>; }`;
  writeFileSync(join(fixture, 'Probe.tsx'), probe('Before'));
  writeFileSync(join(fixture, 'probe.css'), '#hot-probe { color: rgb(10, 20, 30); }');
  writeFileSync(join(fixture, 'boot.tsx'), `import { createRoot } from 'react-dom/client'; import { Probe } from './Probe.tsx'; import './probe.css';
const root = document.createElement('div'); document.body.append(root); createRoot(root).render(<Probe />);`);
  const logs: string[] = [];
  const child = spawn(process.execPath, [join(repo, 'scripts/dev-desktop.mjs'), '--home', profile.oaHome, '--port', String(port), '--test-mode', '--devtools-port', String(debug), '--locale', 'en'], {
    cwd: repo,
    env: cleanEnv(profile, port, { OPEN_ARTIFACT_BUILTIN_TYPES: '/not-this-checkout', OPEN_ARTIFACT_DAEMON_BIN: '/not-this-checkout' }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (data: Buffer) => logs.push(String(data)));
  child.stderr.on('data', (data: Buffer) => logs.push(String(data)));
  const connection: { current: Cdp | null } = { current: null };
  const readyCount = () => (logs.join('').match(/\[desktop:dev\] Ready\./g) ?? []).length;
  // Native macOS CI takes over two minutes to build all editors before the launcher is ready.
  const waitReady = async (count: number) => assert.ok(await until(() => readyCount() >= count, 180_000), logs.join('').slice(-8000));
  const connect = async () => {
    connection.current?.close();
    const cdp = connection.current = await connectCdp(debug);
    const target = await cdp.waitTarget((t) => t.type === 'page' && t.url.endsWith('/dev.html'));
    return cdp.attach(target.targetId);
  };
  try {
    await waitReady(1);
    let page = await connect();
    assert.ok(await page.waitFor('!!document.querySelector("#root button")'));
    const initialDaemon = daemonState(profile);
    assert.ok(initialDaemon);
    assert.equal(new URL(initialDaemon.url).port, String(port));
    const version = JSON.parse(readFileSync(join(repo, 'packages/daemon/package.json'), 'utf8')).version;
    assert.equal(JSON.parse(readFileSync(join(profile.oaHome, 'settings.json'), 'utf8')).runtime.pin, version);

    // A real component module tests Fast Refresh without editing any existing source file.
    await page.evaluate(`import(${JSON.stringify(`/${basename(fixture)}/boot.tsx`)}).then(() => true)`);
    assert.ok(await page.waitFor('document.getElementById("hot-probe")?.textContent === "Before: 0"'));
    await page.evaluate('document.getElementById("hot-probe").click()');
    assert.ok(await page.waitFor('document.getElementById("hot-probe")?.textContent === "Before: 1"'));
    writeFileSync(join(fixture, 'Probe.tsx'), probe('After'));
    assert.ok(await page.waitFor('document.getElementById("hot-probe")?.textContent === "After: 1"'), 'Fast Refresh lost component state');
    writeFileSync(join(fixture, 'probe.css'), '#hot-probe { color: rgb(40, 50, 60); }');
    assert.ok(await page.waitFor('getComputedStyle(document.getElementById("hot-probe")).color === "rgb(40, 50, 60)"'));
    assert.equal(readyCount(), 1, 'renderer changes restarted Electron');
    assert.equal(daemonState(profile)?.pid, initialDaemon.pid);

    // Main-process changes ask before discarding unsaved artifact work; Cancel keeps this instance.
    const doc = await library(initialDaemon, 'artifacts.create', { type: 'docs', blank: true, title: 'Dev restart guard', folder: join(profile.artifacts, 'guard') });
    assert.ok(doc.id);
    assert.deepEqual(await page.evaluate(`desktop.open(${JSON.stringify(doc.id)})`), { ok: true, id: doc.id });
    const tabReady = await page.waitFor(`desktop.state().then(s => s.tabs.find(t => t.id === ${JSON.stringify(doc.id)})?.status === 'ready')`, 30_000);
    assert.ok(tabReady, JSON.stringify({ state: await page.evaluate('desktop.state()'), targets: await connection.current?.targets() }));
    // As in the unsaved-work tests, let the editor's initial saved reports settle before overriding them.
    const docTarget = await connection.current!.waitTarget(isShellOf(doc.id));
    const docPage = await connection.current!.attach(docTarget.targetId);
    await docPage.send('Page.enable');
    assert.ok(await docPage.waitInFrame((url) => /\/docs\/[0-9a-f]+\//.test(url), "!!document.querySelector('.doc-text p')", 30_000), 'the doc editor did not draw');
    assert.ok(await page.waitFor(`desktop.state().then(s => s.tabs.find(t => t.id === ${JSON.stringify(doc.id)})?.saved === 'saved')`, 30_000), 'the doc did not report its initial saved state');
    await sleep(500);
    await page.evaluate(`desktop.test.saved(${JSON.stringify(doc.id)}, {state:'unsaved', leaveLosesWork:true})`);
    writeFileSync(mainProbe, 'export {};\n');
    assert.ok(await page.waitFor('desktop.state().then(s => s.ask?.kind === "quit")', 20_000));
    await page.evaluate('desktop.state().then(s => desktop.answer(s.ask.id, false))');
    assert.ok(await until(() => logs.join('').includes('Restart cancelled'), 5000));
    assert.equal(readyCount(), 1);
    await page.evaluate(`desktop.test.saved(${JSON.stringify(doc.id)}, {state:'saved', leaveLosesWork:false})`);
    writeFileSync(mainProbe, 'export {}; // restart now\n');
    await waitReady(2);
    page = await connect();
    assert.ok(await page.waitFor('!!document.querySelector("#root button")'));
    assert.equal(daemonState(profile)?.pid, initialDaemon.pid, 'a main-only change needlessly replaced the daemon');

    // Vendored artifact-type inputs must reach the carried runtime, replacing a daemon at the same version.
    writeFileSync(typeProbe, 'Latest local runtime fixture\n');
    await waitReady(3);
    const updated = daemonState(profile);
    assert.ok(updated);
    assert.notEqual(updated.pid, initialDaemon.pid);
    assert.equal(updated.version, initialDaemon.version);
    assert.equal(readFileSync(join(RUNTIME, 'vendor/artifact-types/docs/reference', basename(typeProbe)), 'utf8'), 'Latest local runtime fixture\n');

    child.kill('SIGINT');
    assert.ok(await until(() => child.exitCode !== null, 20_000), 'launcher did not exit');
    assert.equal(child.exitCode, 0);
    assert.ok(await until(() => !alive(updated.pid), 10_000), 'development daemon was left running');
    assert.equal(existsSync(join(profile.oaHome, 'desktop/dev-runner.json')), false);
    assert.deepEqual(leftovers(profile), []);
  } catch (error) {
    throw new Error(`${error instanceof Error ? error.stack : error}\n${logs.join('').slice(-8000)}`);
  } finally {
    // Force only this test's app to quit if an assertion failed while the save guard was showing.
    if (child.exitCode === null && child.signalCode === null) {
      try {
        const page = await connect();
        await page.evaluate('desktop.test.quit(true)');
      } catch { child.kill('SIGINT'); }
      await until(() => child.exitCode !== null || child.signalCode !== null, 15_000);
    }
    connection.current?.close();
    await stopDaemon(profile);
    rmSync(fixture, { recursive: true, force: true });
    rmSync(mainProbe, { force: true });
    rmSync(typeProbe, { force: true });
    // Later plugin and desktop packaging must not carry the runtime fixture the test built.
    for (const runtime of [join(repo, 'skills/open-artifact'), join(repo, 'plugins/dsh'), RUNTIME])
      rmSync(join(runtime, 'vendor/artifact-types/docs/reference', basename(typeProbe)), { force: true });
    rmSync(profile.root, { recursive: true, force: true });
  }
});
