/**
 * ZCode sessions live inside the desktop app, where nothing outside them — the daemon included — can start a
 * turn, and ZCode has no declarative monitors; this extension therefore holds the daemon's harness
 * connection itself, so page messages reach an idle session the moment they are sent.
 */

import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

const RETRY_MS = [1000, 2000, 4000, 8000];

/** The activation generation: each `activate` takes the next number for its loops and callbacks, and `deactivate`
 * moves the count past them — a loop asleep in its backoff when the next activation began fails its
 * `run === mine` check instead of running beside the new one: two loops, two sockets, every session attached
 * twice. */
let run = 0;
let grantAsked = false;
let refused = false;
let held = false;
const attached = new Map();
const waiting = new Map();
let socket = null;
let rpcId = 1;
let listing = null;

function daemonFile() {
  const named = process.env.OPEN_ARTIFACT_HOME;
  const home = named ? resolve(named.replace(/^~(?=$|[/\\])/, homedir())) : join(homedir(), '.agents', 'open-artifact');
  return join(home, 'daemon.json');
}

function readDaemon() {
  try {
    const state = JSON.parse(readFileSync(daemonFile(), 'utf8'));
    return state && typeof state.url === 'string' && state.url ? state : null;
  } catch {
    return null; // no daemon yet, or its state file is being rewritten
  }
}

async function granted(ctx) {
  if (!grantAsked) {
    grantAsked = true;
    const ok = (await ctx.grants.request().catch(() => null))?.granted;
    ctx.log.info(`sessions.write: ${ok ? 'granted' : 'not granted'}`);
    if (ok) return true;
  }
  refuse(ctx);
  return false;
}

/** Takes the daemon connection down and keeps it down for this activation; presence must not lie while ungranted. */
function refuse(ctx) {
  if (refused) return;
  refused = true;
  ctx.log.warn('sessions.write does not stand: no daemon connection for this activation');
  try {
    socket?.close();
  } catch {
    /* already closed */
  }
}

/**
 * One message off the connection. Most are the daemon's answers to this side's calls, matched by `id`; the rest
 * are the daemon's own calls, and the only one it makes to a connection claiming wake caps and no others is
 * `wake.deliver`. Anything else, were it ever sent, goes unanswered, and the daemon's own call timeout then parks
 * the message — the designed fallback.
 */
function reply(ctx, text) {
  let message;
  try {
    message = JSON.parse(text);
  } catch {
    return;
  }
  if (message?.method) {
    if (message.method === 'wake.deliver' && message.id !== undefined) void wake(ctx, message.id, message.params ?? {});
    return;
  }
  if (message?.id === undefined) return;
  const waiter = waiting.get(String(message.id));
  if (!waiter) return;
  waiting.delete(String(message.id));
  if (message.error) waiter.reject(new Error(message.error.message));
  else waiter.resolve(message.result);
}

function call(method, params) {
  const id = `e${rpcId++}`;
  return new Promise((resolve, reject) => {
    if (socket?.readyState !== WebSocket.OPEN) {
      reject(new Error('disconnected'));
      return;
    }
    waiting.set(id, { resolve, reject });
    socket.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }));
  });
}

function answer(id, result) {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ jsonrpc: '2.0', id, result }));
}

/**
 * Delivers one message to a session — its text verbatim as the turn prompt, the same text the hooks would inject,
 * so nothing the daemon sends is rewritten on the way. An idle session starts a turn at once and a busy one queues
 * it; `not-granted` goes through `granted`, whose refusal takes the connection down. A session that refuses the
 * prompt does not throw: the call resolves with its `admission`, and only `accepted` took the text — anything else
 * it may resolve with (`rejected`, an answer that cannot be read) answers `failed`, never `ok`, for the daemon
 * parks a message it is told failed, while one acked away is lost. Answers `ok` only there, `gone` when the
 * session is no more (`forbidden`: its list entry is already on its way out), and `failed` otherwise — the caller
 * then hands the message back to the daemon, which parks it for the hooks and `wait`.
 */
async function deliver(ctx, session, item) {
  for (let retry = false; ; retry = true) {
    try {
      const result = await ctx.sessions.sendToSession({ sessionId: session, prompt: item.text });
      if (result?.admission === 'accepted') {
        ctx.log.info(`delivered ${item.artifactId} to ${session}: ${result?.delivery ?? 'unknown'}`);
        return 'ok';
      }
      ctx.log.warn(`could not deliver ${item.artifactId} to ${session}: ${result?.admission ?? 'unknown'}`);
      return 'failed';
    } catch (error) {
      const code = error?.code ?? 'unknown';
      if (code === 'forbidden') return 'gone';
      if (code !== 'not-granted' || retry || !(await granted(ctx))) {
        ctx.log.warn(`could not deliver ${item.artifactId} to ${session}: ${code}`);
        return 'failed';
      }
    }
  }
}

async function wake(ctx, id, params) {
  const outcome = await deliver(ctx, params.session, params);
  if (outcome === 'gone') await detach(ctx, params.session);
  answer(id, { status: outcome === 'ok' ? 'delivered' : 'failed' });
}

/** Attaches a session, delivering what the attach drained from its inbox; a call that cannot go out (the
 * connection changing under it) is dropped — the reconnect attaches every session again. A drained item has no
 * ack back — the daemon kept no copy — so one the session cannot take is logged with its text, the record to
 * recover it by. */
async function attach(ctx, params) {
  try {
    const result = await call('session.attach', params);
    for (const item of result.inbox) {
      if ((await deliver(ctx, params.session, item)) !== 'ok')
        ctx.log.error(`a message drained from ${params.session}'s inbox was not delivered (${item.artifactId}): ${item.text}`);
    }
  } catch {
  }
}

async function detach(ctx, session) {
  attached.delete(session);
  await call('session.detach', { session }).catch(() => undefined);
}

async function hold(ctx, mine) {
  let misses = 0;
  let up = false;
  let ever = false;
  while (run === mine && !refused) {
    try {
      const state = readDaemon();
      if (!state) throw new Error('no daemon');
      const ws = new WebSocket(`${state.url.replace(/^http/, 'ws')}/__harness`, ['open-artifact-harness']);
      socket = ws;
      await new Promise((open, failed) => {
        ws.addEventListener('open', () => open(), { once: true });
        ws.addEventListener('error', () => failed(new Error('could not connect')), { once: true });
      });
      ws.addEventListener('message', (event) => reply(ctx, String(event.data)));
      ws.addEventListener('close', () => {
        if (run !== mine) return; // a later activation owns the connection's globals now
        socket = null;
        for (const waiter of waiting.values()) waiter.reject(new Error('disconnected'));
        waiting.clear();
      });
      // Wake caps are what make the daemon route a session's messages here live instead of parking them.
      await call('hello', { harness: 'zcode', token: state.token, caps: { wake: {} } });
      misses = 0;
      if (!up) {
        up = true;
        ever = true;
        ctx.log.info('attached to the daemon');
      }
      for (const params of attached.values()) await attach(ctx, params);
      await new Promise((closed) => ws.addEventListener('close', () => closed(), { once: true }));
      throw new Error('connection lost');
    } catch (error) {
      socket = null;
      if (run !== mine || refused) return;
      if (up) {
        up = false;
        ctx.log.warn(`lost the daemon (${error?.message ?? error}); re-attaching`);
      } else if (!ever) {
        ctx.log.info(`could not attach to the daemon (${error?.message ?? error}); retrying`);
      }
      await new Promise((done) => {
        const timer = setTimeout(done, RETRY_MS[Math.min(misses, RETRY_MS.length - 1)]);
        timer.unref?.();
      });
      misses += 1;
    }
  }
}

/**
 * Records one session of the app's list — attached when it is new, its status restated when it moved
 * (`needs_attention` and `unknown` read as idle: the daemon knows only idle and running).
 */
function upsert(ctx, row) {
  const params = {
    session: row.session.sessionId,
    workspace: row.session.workspacePath,
    title: row.title,
    status: row.status === 'running' ? 'running' : 'idle',
  };
  const was = attached.get(params.session);
  attached.set(params.session, params);
  if (socket?.readyState !== WebSocket.OPEN) return;
  if (!was) void attach(ctx, params);
  else if (was.status !== params.status)
    void call('session.status', { session: params.session, status: params.status }).catch(() => undefined);
}

/**
 * The app's session list, snapshot first and deltas after — the one source of what to attach. A session that
 * appears is attached (an attach arrives with what waited in its inbox), one that leaves is detached. The first
 * event also starts the connection: the list cannot be read without `sessions.write`, so its arrival is the grant
 * standing — the connection never opens on spec.
 */
function listed(ctx, mine, event) {
  if (!held) {
    held = true;
    void hold(ctx, mine);
  }
  if (event?.kind === 'snapshot') {
    const known = new Set(event.sessions.map((row) => row.session.sessionId));
    for (const session of [...attached.keys()]) if (!known.has(session)) void detach(ctx, session);
    for (const row of event.sessions) upsert(ctx, row);
    return;
  }
  if (event?.kind === 'delta') {
    for (const ref of event.removed) void detach(ctx, ref.sessionId);
    for (const row of event.upserted) upsert(ctx, row);
  }
}

function watch(ctx, mine) {
  listing = ctx.sessions.onDidChangeList(
    (event) => listed(ctx, mine, event),
    (error) => void listFailed(ctx, mine, error),
  );
}

/**
 * The session list could not be kept. Only a missing grant gets a second chance: a fresh install's list cannot so
 * much as start without `sessions.write` — and with no list there is no connection, so `deliver`'s grant path, the
 * dialog's other door, never runs — so the dialog is offered here, once per activation, and the list starts over
 * when the grant lands; one that will not stand refuses the connection inside `granted`. Anything else just ends
 * the list.
 */
async function listFailed(ctx, mine, error) {
  if (error?.code !== 'not-granted') {
    ctx.log.warn(`session list: ${error?.code ?? 'unknown'}`);
    return;
  }
  // The dialog can outlast its activation, so the restart re-proves `mine` once the ask has answered.
  if (run !== mine || !(await granted(ctx)) || run !== mine) return;
  watch(ctx, mine);
}

/** Returns at once: activation must finish far inside ZCode's timeout. */
export function activate(ctx) {
  const mine = ++run;
  grantAsked = false;
  refused = false;
  held = false;
  attached.clear();
  watch(ctx, mine);
}

export function deactivate() {
  run += 1;
  listing?.dispose();
  listing = null;
  try {
    socket?.close();
  } catch {
    /* already closed */
  }
  socket = null;
  for (const waiter of waiting.values()) waiter.reject(new Error('disconnected'));
  waiting.clear();
}
