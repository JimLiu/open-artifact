/**
 * An Open Artifact site for a test: `packages/host` (the self-hosted server) on a free loopback port, its data in the
 * throwaway profile, signed in with an owner key made here. Nothing outside this computer: it listens on 127.0.0.1
 * only, and is stopped by the handle (the pid) this file keeps. A device sign-in (`remotes.add`) is approved as the
 * person would on the site's page, without a browser: the owner-key sign-in, then the approval form.
 */
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { APP, NO_NODE_PATH, alive, freePort, sleep, until } from './env.mjs';

const HOST_MAIN = resolve(APP, '..', '..', 'packages', 'host', 'src', 'node', 'main.ts');

/** Starts a site named `name` (its data in `profile.tmp/host-<name>`); `{ origin, pid, key, stop(), approve(code) }`. */
export async function startHost(profile, name) {
  const port = await freePort();
  // `localhost`, not 127.0.0.1: the content origin is `<id>.content.localhost`, and loopback http is allowed then.
  const origin = `http://localhost:${port}`;
  const key = `owner-${name}-${randomBytes(12).toString('hex')}`;
  const data = join(profile.tmp, `host-${name}`);
  mkdirSync(data, { recursive: true });
  const child = spawn(process.execPath, [HOST_MAIN, 'serve'], {
    env: {
      PATH: NO_NODE_PATH,
      HOME: profile.home,
      TMPDIR: profile.tmp,
      OA_DATA_DIR: data,
      OA_PORT: String(port),
      OA_BIND: '127.0.0.1',
      OA_APP_ORIGIN: origin,
      OA_CONTENT_ORIGIN: `http://{id}.content.localhost:${port}`,
      OA_OWNER_KEY: key,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  child.stdout.on('data', (chunk) => (log += chunk));
  child.stderr.on('data', (chunk) => (log += chunk));
  let exited = null;
  child.on('exit', (code, signal) => (exited = { code, signal }));
  const up = await until(() => /listening on http/.test(log) || exited, 60_000, 200);
  if (!up || exited) {
    if (alive(child.pid)) child.kill('SIGKILL');
    throw new Error(`the site ${name} did not start (${JSON.stringify(exited)}):\n${log.slice(-2000)}`);
  }
  let cookie = '';
  const host = {
    name,
    origin,
    port,
    key,
    pid: child.pid,
    get log() {
      return log;
    },
    get exited() {
      return exited;
    },
    /** The owner's session cookie on the site (signed in once). */
    async signIn() {
      if (cookie) return cookie;
      const signed = await fetch(`${origin}/auth/owner-key`, {
        method: 'POST',
        redirect: 'manual',
        headers: { 'content-type': 'application/x-www-form-urlencoded', origin },
        body: `key=${encodeURIComponent(key)}`,
      });
      cookie = (signed.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ');
      if (!cookie) throw new Error(`no session from ${origin} (${signed.status})`);
      return cookie;
    },
    /** Approves a device sign-in's code on the site, as the person's click on its page would. */
    async approve(userCode) {
      const session = await host.signIn();
      const answer = await fetch(`${origin}/link/device`, {
        method: 'POST',
        redirect: 'manual',
        headers: { 'content-type': 'application/x-www-form-urlencoded', origin, cookie: session },
        body: `user_code=${encodeURIComponent(userCode)}&decision=approve`,
      });
      if (answer.status >= 400) throw new Error(`approving ${userCode} on ${origin}: ${answer.status}`);
      return answer.status;
    },
    /** Stops the site (its pid, SIGTERM then SIGKILL). */
    async stop() {
      if (exited || !alive(child.pid)) return;
      child.kill('SIGTERM');
      await until(() => exited, 5000);
      if (!exited && alive(child.pid)) {
        child.kill('SIGKILL');
        await until(() => exited, 5000);
      }
      await sleep(50);
    },
  };
  return host;
}
