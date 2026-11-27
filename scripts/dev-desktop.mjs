#!/usr/bin/env node
/** Root Desktop launcher: fresh local runtime, Vite React Refresh, and supervised Electron restarts. */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolveProfile } from '../apps/desktop/src/profile.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const APP = join(ROOT, 'apps/desktop');
const log = (line) => console.log(`[desktop:dev] ${line}`);

export function developmentProfile(argv = []) {
  for (const name of ['home', 'port']) {
    const at = argv.lastIndexOf(`--${name}`);
    if (at >= 0 && (!argv[at + 1] || argv[at + 1].startsWith('--'))) throw new Error(`--${name} needs a value`);
  }
  const args = ['--home', join(ROOT, '.desktop-dev'), '--port', '4890', ...argv];
  const profile = resolveProfile({ argv: args, env: {} });
  if (profile.problems.length) throw new Error(profile.problems.join('\n'));
  return { ...profile, args };
}

/** Generated files, tests and unrelated docs never trigger rebuild loops. Renderer imports are watched by Vite. */
export function changeKind(path) {
  path = path.split(sep).join('/');
  if (/(^|\/)(node_modules|out|dist|resources|vendor|test|tests|\.git)(\/|$)/.test(path) || /\.test\.[^.]+$/.test(path)) return null;
  if (/^apps\/desktop\/(src\/|scripts\/|build\.ts$|renderer\/(notice|artifact-app)\/|renderer\/src\/words\.ts$)/.test(path)) return 'desktop';
  if (/^packages\/library-page\/src\/library\//.test(path)) return 'desktop';
  if (/^packages\/(ui|library-page)\/src\//.test(path)) return null;
  if (/^packages\/[^/]+\/(src\/|bin\/|generated\/|package\.json$|vite[^/]*\.[cm]?ts$|[^/]+\.html$)/.test(path)) return 'runtime';
  if (/^artifact-types\/[^/]+\/(?!scripts\/)/.test(path)) return 'runtime';
  if (/^skills\/open-artifact\/reference\//.test(path) || /^scripts\/(build|build-skill|vendor-types)\.mjs$/.test(path)) return 'runtime';
  return null;
}

export function lockProfile(home) {
  const file = join(home, 'desktop/dev-runner.json');
  mkdirSync(dirname(file), { recursive: true });
  if (existsSync(file)) {
    const { pid } = JSON.parse(readFileSync(file, 'utf8'));
    let alive = true;
    try { process.kill(pid, 0); } catch (error) { if (error.code === 'ESRCH') alive = false; }
    if (alive) throw new Error(`Desktop development is already running for ${home} (pid ${pid}).`);
    rmSync(file);
  }
  const contents = `${JSON.stringify({ pid: process.pid })}\n`;
  writeFileSync(file, contents, { flag: 'wx' });
  return () => {
    if (existsSync(file) && readFileSync(file, 'utf8') === contents) rmSync(file);
  };
}

/** Keep an older checkout local even if this development profile once downloaded a newer runtime. */
export function pinDevelopmentRuntime(home, version) {
  const file = join(home, 'settings.json');
  const settings = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
  settings.runtime = { ...settings.runtime, pin: version };
  const temporary = `${file}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(settings, null, 2)}\n`);
  renameSync(temporary, file);
}

export async function runDesktop(argv) {
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log('Usage: npm run desktop -- [--home <dir>] [--port <n>] [Electron app options]\n\nDefaults: <repo>/.desktop-dev, port 4890. React/CSS updates in place; main/preload/runtime changes rebuild and restart.');
    return;
  }
  const profile = developmentProfile(argv);
  const unlock = lockProfile(profile.home);
  const abort = new AbortController();
  let complete;
  const finished = new Promise((done) => { complete = done; });
  const finish = (code = 0) => { complete(code); abort.abort(); };
  let vite;
  let electron;
  let stopDaemon;
  let worker = Promise.resolve();
  let pending = null;
  let runtimeDirty = true;
  let timer;
  let stopping = false;

  function run(command, args, cwd = ROOT, extraEnv = {}) {
    abort.signal.throwIfAborted();
    return new Promise((done, fail) => {
      // A group of its own lets cleanup stop Vite builds spawned by build.mjs as well.
      const child = spawn(command, args, { cwd, env: { ...process.env, ...extraEnv }, stdio: 'inherit', detached: process.platform !== 'win32' });
      const cancel = () => {
        if (!child.pid) return;
        try {
          if (process.platform === 'win32') child.kill();
          else process.kill(-child.pid, 'SIGTERM');
        } catch (error) { if (error.code !== 'ESRCH') log(error.message); }
      };
      abort.signal.addEventListener('abort', cancel, { once: true });
      const clean = () => abort.signal.removeEventListener('abort', cancel);
      child.once('error', (error) => { clean(); fail(error); });
      child.once('exit', (code, signal) => {
        clean();
        if (code === 0) done();
        else fail(new Error(`${command} ${args.join(' ')} exited ${code ?? signal}`));
      });
    });
  }
  // Vite sets NODE_ENV=development in the runner. Artifact/Shell builds must still bundle production React.
  const node = (file, cwd = ROOT) => run(process.execPath, [file], cwd, { NODE_ENV: 'production' });

  function launch() {
    abort.signal.throwIfAborted();
    const binary = createRequire(join(APP, 'package.json'))('electron');
    const env = { ...process.env, OA_DESKTOP_RENDERER_URL: `${vite.resolvedUrls.local[0]}dev.html`, OPEN_ARTIFACT_RUNTIME_UPDATE: 'off' };
    // Parent agent/plugin runtime paths must not override this checkout's bundled runtime.
    for (const name of Object.keys(env)) if (name.startsWith('OPEN_ARTIFACT_') && /_(BIN|DIR|URL)$/.test(name)) delete env[name];
    delete env.OPEN_ARTIFACT_BUILTIN_TYPES;
    delete env.OPEN_ARTIFACT_HARNESS_PROFILES;
    delete env.ELECTRON_RUN_AS_NODE;
    const child = spawn(binary, [APP, ...profile.args], { env, stdio: ['inherit', 'inherit', 'inherit', 'ipc'] });
    const instance = { child, expected: false, ended: false, quitting: null, exited: null, ready: null };
    instance.exited = new Promise((done) => {
      const ended = (code) => {
        instance.ended = true;
        done();
        if (!instance.expected) finish(code ?? 1);
      };
      child.once('exit', ended);
      child.once('error', (error) => { log(`Electron: ${error.message}`); ended(1); });
    });
    instance.ready = new Promise((done, fail) => {
      const timeout = setTimeout(() => { clean(); fail(new Error('Electron did not become ready in 60 seconds')); }, 60_000);
      const message = (value) => { if (value?.type === 'desktop:dev:ready') { clean(); done(); } };
      const exited = () => { clean(); fail(new Error('Electron exited before it was ready')); };
      const clean = () => { clearTimeout(timeout); child.off('message', message); child.off('exit', exited); child.off('error', exited); };
      child.on('message', message);
      child.once('exit', exited);
      child.once('error', exited);
    });
    electron = instance;
    return instance.ready;
  }

  async function quit(instance) {
    if (!instance || instance.ended) return true;
    await instance.ready;
    return instance.quitting ??= new Promise((done, fail) => {
      const child = instance.child;
      const clean = () => { child.off('exit', exited); child.off('message', message); instance.quitting = null; };
      const exited = () => { clean(); done(true); };
      const message = (value) => { if (value?.type === 'desktop:dev:cancelled') { clean(); done(false); } };
      child.once('exit', exited);
      child.on('message', message);
      child.send({ type: 'desktop:dev:quit' }, (error) => { if (error) { clean(); fail(error); } });
    });
  }

  async function stop() {
    if (stopping || abort.signal.aborted) return;
    stopping = true;
    try {
      if (await quit(electron)) finish();
      else log('Quit cancelled; development continues.');
    } catch (error) {
      log(error.message);
      finish(1);
    } finally { stopping = false; }
  }
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);

  async function rebuild(kind) {
    if (kind === 'runtime') runtimeDirty = true;
    kind = runtimeDirty ? 'runtime' : kind;
    log(`Building ${kind === 'runtime' ? 'the local runtime and Desktop' : 'Desktop'}…`);
    if (kind === 'runtime') {
      await node('scripts/build.mjs');
      await node('scripts/build-skill.mjs');
    }
    await node('build.ts', APP);
    if (electron) {
      electron.expected = true;
      if (!(await quit(electron))) {
        electron.expected = false;
        log('Restart cancelled; save your work and edit again to retry.');
        return;
      }
      electron = null;
    }
    if (kind === 'runtime') {
      await stopDaemon({ home: profile.home });
      await node('scripts/build-runtime.ts', APP);
      pinDevelopmentRuntime(profile.home, JSON.parse(readFileSync(join(ROOT, 'packages/daemon/package.json'), 'utf8')).version);
      runtimeDirty = false;
    }
    await launch();
    log('Ready. React/CSS: hot update; main/preload: restart; runtime: rebuild and restart. Ctrl+C to stop.');
  }

  async function drain() {
    while (pending && !abort.signal.aborted) {
      const kind = pending;
      pending = null;
      try { await rebuild(kind); }
      catch (error) { if (!abort.signal.aborted) log(`${error.message}\nFix the error and save again to retry.`); }
    }
  }

  try {
    const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    if (['vite', 'esbuild', '@vitejs/plugin-react', '@tailwindcss/vite'].some((name) => !existsSync(join(ROOT, 'node_modules', name, 'package.json')))) {
      log('Installing workspace dependencies…');
      await run(npm, ['ci', '--include=dev']);
    }
    if (['electron', 'react', 'react-dom', 'esbuild'].some((name) => !existsSync(join(APP, 'node_modules', name, 'package.json')))) {
      log('Installing Desktop dependencies…');
      await run(npm, ['ci', '--include=dev'], APP);
    }
    const electronPackage = createRequire(join(APP, 'package.json')).resolve('electron/package.json');
    const electronDir = dirname(electronPackage);
    const binaryFile = join(electronDir, 'path.txt');
    if (!existsSync(binaryFile) || !existsSync(join(electronDir, 'dist', readFileSync(binaryFile, 'utf8').trim()))) {
      log('Downloading Electron…');
      await node('node_modules/electron/install.js', APP);
    }
    ({ stopDaemon } = await import('../packages/harness-kit/src/daemon.ts'));
    process.env.NODE_ENV = 'development';
    const { createServer } = await import('vite');
    const { default: config } = await import('../apps/desktop/vite.config.ts');
    vite = await createServer({ ...config, configFile: false });
    await vite.listen();
    log(`Profile: ${profile.home}; daemon port: ${profile.port}; renderer: ${vite.resolvedUrls.local[0]}dev.html`);
    let initialized = false;
    vite.watcher.add(['packages', 'artifact-types', 'scripts', 'apps/desktop/src', 'apps/desktop/scripts', 'apps/desktop/build.ts', 'skills/open-artifact/reference'].map((path) => join(ROOT, path)));
    vite.watcher.on('all', (event, file) => {
      if (!['add', 'change', 'unlink'].includes(event) || abort.signal.aborted) return;
      const path = relative(ROOT, file);
      const kind = changeKind(path);
      if (!kind) return;
      log(`Changed ${path}`);
      pending = pending === 'runtime' || kind === 'runtime' ? 'runtime' : 'desktop';
      clearTimeout(timer);
      if (initialized) timer = setTimeout(() => { worker = worker.then(drain); }, 250);
    });
    await rebuild('runtime');
    initialized = true;
    if (pending) worker = worker.then(drain);
    process.exitCode = await finished;
  } catch (error) {
    if (abort.signal.aborted) process.exitCode = await finished;
    else { log(error.stack ?? error.message); process.exitCode = 1; }
  } finally {
    abort.abort();
    clearTimeout(timer);
    process.off('SIGINT', stop);
    process.off('SIGTERM', stop);
    try {
      await worker;
      if (electron && !electron.ended) {
        electron.expected = true;
        // Normal shutdown already got consent. A startup failure may precede the IPC listener.
        electron.child.kill('SIGKILL');
        await electron.exited;
      }
      await vite?.close();
      await stopDaemon?.({ home: profile.home });
    } finally {
      unlock();
    }
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) await runDesktop(process.argv.slice(2));
