// Pi: the real `pi` command (on PATH) loading the extension in plugins/pi (`pi -e plugins/pi`), against a real daemon
// (`open-artifact daemon run`, from source) in a temporary OPEN_ARTIFACT_HOME. The model is a scripted local endpoint
// (OpenAI chat completions, streamed) named in a models.json of a temporary Pi agent folder (PI_CODING_AGENT_DIR), so
// nothing reaches the network, and the person's own Pi settings, sessions and sign-ins are not read.
//
//  (a) Print mode (`pi -p`): the model is offered Artifact, ArtifactData and ArtifactComments with the daemon's own
//      schemas and has the Open Artifact prompt section in its system prompt; it calls Artifact {action: "list"}, the
//      call reaches the daemon as the Pi session (the daemon lists harness `pi` with that session attached while the
//      call runs), and the daemon's answer comes back as the tool result. The skill is written for Pi.
//  (b) A daemon error: Artifact {action: "read"} of an artifact that does not exist comes back to the model as a
//      failed tool result with the daemon's code. (Arguments the schema refuses never reach the daemon: Pi checks
//      them against the daemon's schemas first.)
//  (c) RPC mode (`pi --mode rpc`, kept running): `open-artifact doctor --harness pi --session <id> --json`, the
//      conformance script, passes every step; its wake (a request from the page, the owner's words) starts a Pi turn
//      whose last message is a user message with the doctor's text.
//
// Skipped, saying why, when `pi` is not on PATH or Node.js is older than Pi needs (22.19).
//
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createServer } from 'node:http';
import { createServer as createNetServer } from 'node:net';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { api, readDaemon } from '@open-artifact/harness-kit';
import { TOOL_DEFINITIONS } from '@open-artifact/protocol';
import { until } from './lib/http.mjs';
import { removeTmp, repoRoot, tmpDir } from './lib/target.mjs';

const T = { timeout: 180000 };
const CLI = path.join(repoRoot, 'packages', 'daemon', 'src', 'bin', 'open-artifact.ts');
// OA_E2E_PI_EXTENSION points the suite at another copy, such as the staged npm package installed in a folder.
const EXTENSION = process.env.OA_E2E_PI_EXTENSION ? path.resolve(process.env.OA_E2E_PI_EXTENSION) : path.join(repoRoot, 'plugins', 'pi');
const WAKE_TEXT = 'open-artifact doctor is checking';

/** Why this suite cannot run here, or false. */
function skipReason() {
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major < 22 || (major === 22 && minor < 19)) return `Pi needs Node.js 22.19 or later (this is ${process.versions.node})`;
  const found = spawnSync('pi', ['--version'], { encoding: 'utf8' });
  if (found.error || found.status !== 0) return 'no pi command on PATH (npm install -g @earendil-works/pi-coding-agent)';
  return false;
}
const skip = skipReason();
if (skip) console.log(`# pi: skipped: ${skip}`);

const sleep = ms => new Promise(r => setTimeout(r, ms));

function freePort() {
  return new Promise((resolve, reject) => {
    const server = createNetServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

async function stop(child) {
  if (!child || child.exitCode !== null) return;
  const exited = new Promise(resolve => child.once('exit', resolve));
  child.kill('SIGTERM');
  await Promise.race([exited, sleep(5000)]);
  if (child.exitCode === null) child.kill('SIGKILL');
}

/** Runs a command to its end; resolves with its exit code and output. */
function run(command, args, { env, cwd, timeout = 150000 }) {
  return new Promise(resolve => {
    const child = spawn(command, args, { env, cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => (stdout += chunk));
    child.stderr.on('data', chunk => (stderr += chunk));
    const timer = setTimeout(() => child.kill('SIGKILL'), timeout);
    child.on('close', code => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

/** A message's text, whether its content is a string or a list of parts. */
const textOf = content => (typeof content === 'string' ? content : Array.isArray(content) ? content.map(p => p?.text ?? '').join('') : '');

/**
 * The scripted model: an OpenAI chat completions endpoint at `/v1/chat/completions`. `reply(body)` answers each
 * request with `{ tool, args }` (one tool call) or `{ text }`. Every request body is kept in `requests`.
 */
async function scriptedModel(reply) {
  const requests = [];
  const server = createServer(async (req, res) => {
    if (req.method !== 'POST' || !req.url.endsWith('/chat/completions')) return void res.writeHead(404).end();
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw);
    requests.push(body);
    let answer;
    try {
      answer = await reply(body);
    } catch (error) {
      answer = { text: `script error: ${error.message}` };
    }
    const message = answer.tool
      ? { role: 'assistant', content: null, tool_calls: [{ index: 0, id: `call_${requests.length}`, type: 'function', function: { name: answer.tool, arguments: JSON.stringify(answer.args ?? {}) } }] }
      : { role: 'assistant', content: answer.text };
    const finish = answer.tool ? 'tool_calls' : 'stop';
    const usage = { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 };
    if (!body.stream) {
      res.writeHead(200, { 'content-type': 'application/json' });
      return void res.end(JSON.stringify({ id: 'cmpl', object: 'chat.completion', created: 0, model: body.model, choices: [{ index: 0, message, finish_reason: finish }], usage }));
    }
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
    const send = data => res.write(`data: ${JSON.stringify({ id: 'cmpl', object: 'chat.completion.chunk', created: 0, model: body.model, ...data })}\n\n`);
    send({ choices: [{ index: 0, delta: message, finish_reason: null }] });
    send({ choices: [{ index: 0, delta: {}, finish_reason: finish }] });
    send({ choices: [], usage });
    res.end('data: [DONE]\n\n');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { server, url: `http://127.0.0.1:${server.address().port}/v1`, requests };
}

/** The last message of a request, and the tool results in it. */
const lastOf = body => body.messages.at(-1);
const toolResults = body => body.messages.filter(m => m.role === 'tool');
const systemOf = body => body.messages.filter(m => m.role === 'system' || m.role === 'developer').map(m => textOf(m.content)).join('\n');

describe('pi: the extension in the real pi against a real daemon', { skip }, () => {
  const ctx = {};

  before(async () => {
    const root = tmpDir('pi');
    ctx.root = root;
    ctx.home = path.join(root, 'home');
    ctx.agentDir = path.join(root, 'pi-agent');
    ctx.workspace = path.join(root, 'work');
    const builtin = path.join(root, 'builtin');
    const types = path.join(root, 'types');
    for (const dir of [ctx.agentDir, ctx.workspace, builtin, types]) fs.mkdirSync(dir, { recursive: true });
    // A local type the conformance script can make its test artifact of.
    const note = path.join(types, 'note');
    fs.mkdirSync(note);
    fs.writeFileSync(path.join(note, 'artifact-type.json'), JSON.stringify({ name: 'Note', description: 'A one-page note as a local HTML file.', when: 'The person wants a short note.' }));
    fs.writeFileSync(path.join(note, 'index.html'), '<!doctype html><meta charset="utf-8"><title>note</title><h1>A note</h1>\n');

    // The model's script: each case says what its prompt asks for.
    ctx.seen = [];
    ctx.model = await scriptedModel(async body => {
      const last = lastOf(body);
      if (last.role === 'tool') {
        // While the call's turn runs: what the daemon says about this harness's sessions.
        ctx.seen.push(await api(ctx.state, 'harnesses'));
        return { text: `tool said: ${textOf(last.content).slice(0, 2000)}` };
      }
      const asked = textOf(last.content);
      if (asked.includes('LIST')) return { tool: 'Artifact', args: { action: 'list' } };
      if (asked.includes('BAD')) return { tool: 'Artifact', args: { action: 'read', url: 'open-artifact://artifact/no-such-artifact' } };
      return { text: 'Got it.' };
    });
    fs.writeFileSync(
      path.join(ctx.agentDir, 'models.json'),
      JSON.stringify({
        providers: {
          scripted: {
            baseUrl: ctx.model.url,
            api: 'openai-completions',
            apiKey: 'test-key',
            models: [{ id: 'scripted-model', name: 'Scripted', contextWindow: 128000, maxTokens: 4096, input: ['text'], reasoning: false }],
          },
        },
      }),
    );

    ctx.env = {
      ...process.env,
      OPEN_ARTIFACT_HOME: ctx.home,
      OPEN_ARTIFACT_USER_TYPES: types,
      OPEN_ARTIFACT_BUILTIN_TYPES: builtin,
      OPEN_ARTIFACT_BROWSER: 'none',
      OPEN_ARTIFACT_IDLE_MS: '0',
      OPEN_ARTIFACT_WAKE_MERGE_MS: '20',
      PI_CODING_AGENT_DIR: ctx.agentDir,
      PI_OFFLINE: '1',
      PI_SKIP_VERSION_CHECK: '1',
    };
    for (const name of ['OPEN_ARTIFACT_EXTRA_TYPES', 'OPEN_ARTIFACT_SHELL_DIR', 'OPEN_ARTIFACT_HOME_DIR', 'OPEN_ARTIFACT_REMOTE', 'OPEN_ARTIFACT_REMOTE_TOKEN', 'OPEN_ARTIFACT_HARNESS', 'OPEN_ARTIFACT_SESSION']) delete ctx.env[name];
    // The extension connects to this daemon; with none running a tool call would start this one too.
    ctx.env.OPEN_ARTIFACT_DAEMON_BIN = CLI;
    ctx.daemonLog = '';
    ctx.daemon = spawn(process.execPath, [CLI, 'daemon', 'run', '--port', String(await freePort())], { env: ctx.env, cwd: ctx.workspace, stdio: ['ignore', 'pipe', 'pipe'] });
    ctx.daemon.stdout.on('data', chunk => (ctx.daemonLog += chunk));
    ctx.daemon.stderr.on('data', chunk => (ctx.daemonLog += chunk));
    process.on('exit', () => ctx.daemon.exitCode === null && ctx.daemon.kill('SIGKILL'));
    assert.ok(await until(() => fs.existsSync(path.join(ctx.home, 'daemon.json')), 30000), `the daemon did not start:\n${ctx.daemonLog}`);
    ctx.state = await readDaemon(ctx.home);
    assert.ok(ctx.state, 'daemon.json names no live daemon');
  });

  after(async () => {
    await stop(ctx.rpc);
    await stop(ctx.daemon);
    await new Promise(resolve => ctx.model?.server.close(resolve));
    removeTmp?.();
  });

  const pi = (args, options = {}) => run('pi', ['--offline', '--provider', 'scripted', '--model', 'scripted-model', '-e', EXTENSION, ...args], { env: ctx.env, cwd: ctx.workspace, ...options });

  it('(a) offers the tools and the prompt, and a call reaches the daemon as the Pi session', T, async () => {
    const from = ctx.model.requests.length;
    const result = await pi(['-p', 'LIST my artifacts']);
    assert.equal(result.code, 0, `pi failed:\n${result.stdout}\n${result.stderr}`);
    const requests = ctx.model.requests.slice(from);
    assert.ok(requests.length >= 2, `the model was asked ${requests.length} time(s)`);

    const first = requests[0];
    for (const definition of TOOL_DEFINITIONS) {
      const tool = (first.tools ?? []).find(t => t.function?.name === definition.name);
      assert.ok(tool, `the model is not offered ${definition.name}`);
      assert.deepEqual(Object.keys(tool.function.parameters.properties ?? {}).sort(), Object.keys(definition.inputSchema.properties ?? {}).sort());
    }
    assert.match(systemOf(first), /<open_artifact>[\s\S]*<\/open_artifact>/);

    const results = toolResults(requests.at(-1));
    assert.equal(results.length, 1);
    assert.match(textOf(results[0].content), /"artifacts"|"items"|\[/);
    assert.match(result.stdout, /tool said:/);

    // While the call ran, the daemon had harness pi with a session in this folder.
    const listing = ctx.seen.at(-1);
    assert.ok(listing.adapters.some(a => a.harness === 'pi'), `no pi adapter: ${JSON.stringify(listing.adapters)}`);
    const session = listing.sessions.find(s => s.harness === 'pi' && s.workspace === ctx.workspace);
    assert.ok(session, `no pi session for ${ctx.workspace}: ${JSON.stringify(listing.sessions)}`);
    assert.equal(session.status === 'running' || session.status === 'idle', true);

    const skill = path.join(ctx.home, 'skills', 'pi', 'open-artifact', 'SKILL.md');
    assert.ok(fs.existsSync(skill), 'the skill was not written for Pi');
    assert.match(fs.readFileSync(skill, 'utf8'), /^name: open-artifact$/m);
  });

  it('(b) a daemon error comes back to the model as a failed call', T, async () => {
    const from = ctx.model.requests.length;
    const result = await pi(['-p', 'BAD call']);
    assert.equal(result.code, 0, `pi failed:\n${result.stdout}\n${result.stderr}`);
    const requests = ctx.model.requests.slice(from);
    const [failed] = toolResults(requests.at(-1));
    assert.ok(failed, 'no tool result came back');
    assert.match(textOf(failed.content), /"code": "not_found"/);
  });

  it('(c) the conformance script passes against pi in RPC mode, and its wake starts a turn', T, async () => {
    ctx.rpcLog = '';
    ctx.rpc = spawn('pi', ['--offline', '--provider', 'scripted', '--model', 'scripted-model', '-e', EXTENSION, '--mode', 'rpc'], { env: ctx.env, cwd: ctx.workspace, stdio: ['pipe', 'pipe', 'pipe'] });
    ctx.rpc.stdout.on('data', chunk => (ctx.rpcLog += chunk));
    ctx.rpc.stderr.on('data', chunk => (ctx.rpcLog += chunk));

    // The session attaches at start: a daemon runs.
    let session = null;
    const attached = await until(async () => {
      const listing = await api(ctx.state, 'harnesses');
      const live = listing.sessions.filter(s => s.harness === 'pi' && s.live);
      session = live.at(-1) ?? null;
      return !!session;
    }, 30000, 200);
    assert.ok(attached, `pi did not attach a live session:\n${ctx.rpcLog}`);

    const from = ctx.model.requests.length;
    const doctor = await run(process.execPath, [CLI, 'doctor', '--harness', 'pi', '--session', session.session, '--json'], { env: ctx.env, cwd: ctx.workspace });
    const report = JSON.parse(doctor.stdout);
    const steps = report.findings.filter(f => f.id.startsWith('conformance.'));
    for (const f of steps.filter(f => f.status !== 'ok')) console.log(`# pi: ${f.id} ${f.status}: ${f.message}${f.fix ? ` (${f.fix})` : ''}`);
    const failed = steps.filter(f => f.status === 'fail');
    assert.deepEqual(failed, [], `conformance failed:\n${JSON.stringify(steps, null, 2)}\n${ctx.rpcLog}`);
    const wake = steps.find(f => f.id === 'conformance.wake');
    assert.equal(wake.status, 'ok', JSON.stringify(wake));
    for (const step of ['session', 'tools', 'commands']) assert.equal(steps.find(f => f.id === `conformance.${step}`)?.status, 'ok', `${step}: ${JSON.stringify(steps)}`);

    // The wake started a turn: the doctor's words, as the person's.
    assert.ok(await until(() => ctx.model.requests.slice(from).some(body => lastOf(body).role === 'user' && textOf(lastOf(body).content).includes(WAKE_TEXT)), 30000), 'the wake did not reach the model as a user message');
  });
});
