/**
 * The OMP extension against a fake OMP (the part of its extension API the extension uses, `src/omp.ts`) and the kit's
 * fake daemon: tools, wakes by who sent them, the inbox, the prompt, the skill, the command, session state and
 * writes. The real OMP was checked by hand: OMP 19.2.1 lists the tools, adds the prompt, takes `/open-artifact` and
 * reaches the daemon as the OMP session.
 */
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, it } from 'node:test';
import { startFakeDaemon, type FakeDaemon } from '@open-artifact/harness-kit/testing';
import { localSkill } from '@open-artifact/harness-kit';
import { AGENT_PROMPT, TOOL_DEFINITIONS, type HelloParams, type ToolCallResult } from '@open-artifact/protocol';
import { renderedSkillFile } from '@open-artifact/protocol';
import { absolutePath, defaultSkillsDir, openArtifact, PROFILE, withPrompt } from '../src/extension.ts';
import type { OmpAgentEndEvent, OmpCommand, OmpContext, OmpCustomMessage, OmpExtensionAPI, OmpTool } from '../src/omp.ts';

const SESSION = 'omp-session-1';

/** A fake OMP: records what the extension registers and sends, and plays OMP's events. */
function fakeOmp(cwd: string) {
  const tools = new Map<string, OmpTool>();
  const commands = new Map<string, OmpCommand>();
  const handlers = new Map<string, Array<(event: unknown, ctx: OmpContext) => unknown>>();
  const messages: Array<{ message: OmpCustomMessage; options: unknown }> = [];
  const prompts: Array<{ text: string; options: unknown }> = [];
  let idle = true;
  let sessionId = SESSION;
  let failPrompts = false;
  /** OMP settles a send from idle only when the turn it started ends: this one never ends. */
  let hangPrompts = false;
  const ctx: OmpContext = {
    cwd,
    mode: 'print',
    hasUI: false,
    sessionManager: { getSessionId: () => sessionId },
    isIdle: () => idle,
  };
  const api = {
    registerTool: (tool: OmpTool) => tools.set(tool.name, tool),
    registerCommand: (name: string, command: OmpCommand) => commands.set(name, command),
    sendMessage: (message: OmpCustomMessage, options?: unknown) => messages.push({ message, options }),
    sendUserMessage: (text: string, options?: unknown) => {
      prompts.push({ text, options });
      if (hangPrompts) return new Promise<void>(() => undefined);
      return failPrompts ? Promise.reject(new Error('dropped')) : Promise.resolve();
    },
    on: (event: string, handler: (event: unknown, ctx: OmpContext) => unknown) => handlers.set(event, [...(handlers.get(event) ?? []), handler]),
  } as unknown as OmpExtensionAPI;
  return {
    api,
    ctx,
    tools,
    commands,
    messages,
    prompts,
    setIdle: (value: boolean) => {
      idle = value;
    },
    setSessionId: (value: string) => {
      sessionId = value;
    },
    setFailPrompts: (value: boolean) => {
      failPrompts = value;
    },
    setHangPrompts: (value: boolean) => {
      hangPrompts = value;
    },
    async emit(event: string, payload: unknown = {}): Promise<unknown[]> {
      const answers = [];
      for (const handler of handlers.get(event) ?? []) answers.push(await handler(payload, ctx));
      return answers;
    },
  };
}

const until = async (check: () => boolean, what: string, ms = 3000): Promise<void> => {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((done) => setTimeout(done, 10));
  }
};

let cleanup: Array<() => unknown> = [];
afterEach(async () => {
  for (const step of cleanup.reverse()) await step();
  cleanup = [];
});

/** A fake daemon and a fake OMP with the extension loaded, its session started and attached. */
async function started(options: Parameters<typeof startFakeDaemon>[0] = {}, beforeStart?: (daemon: FakeDaemon) => void) {
  const daemon = await startFakeDaemon(options);
  cleanup.push(() => daemon.close());
  const cwd = mkdtempSync(join(tmpdir(), 'oa-omp-cwd-'));
  cleanup.push(() => rmSync(cwd, { recursive: true, force: true }));
  const skillsDir = mkdtempSync(join(tmpdir(), 'oa-omp-skills-'));
  cleanup.push(() => rmSync(skillsDir, { recursive: true, force: true }));
  const omp = fakeOmp(cwd);
  openArtifact({ home: daemon.home, runtime: null, skillsDir, refusalWindowMs: 50 })(omp.api);
  cleanup.push(() => omp.emit('session_shutdown', { reason: 'quit' }));
  beforeStart?.(daemon);
  await omp.emit('session_start', { reason: 'startup' });
  await daemon.waitFor('session.attach');
  return { daemon, omp, cwd, skillsDir };
}

const callTool = (omp: ReturnType<typeof fakeOmp>, name: string, args: Record<string, unknown>, signal?: AbortSignal) =>
  omp.tools.get(name)!.execute('call-1', args, signal, undefined, omp.ctx);

describe('omp-open-artifact', () => {
  it('registers the three tools as essential, with the daemon’s schemas, and the command, before any daemon', () => {
    const omp = fakeOmp(tmpdir());
    openArtifact({ home: mkdtempSync(join(tmpdir(), 'oa-omp-home-')), runtime: null, skillsDir: mkdtempSync(join(tmpdir(), 'oa-omp-skills-')) })(omp.api);
    assert.deepEqual([...omp.tools.keys()], TOOL_DEFINITIONS.map((d) => d.name));
    for (const definition of TOOL_DEFINITIONS) {
      assert.deepEqual(omp.tools.get(definition.name)!.parameters, definition.inputSchema);
      assert.equal(omp.tools.get(definition.name)!.loadMode, 'essential');
    }
    assert.ok(omp.commands.has('open-artifact'));
  });

  it('does not start a daemon at session start when none runs', async () => {
    const home = mkdtempSync(join(tmpdir(), 'oa-omp-home-'));
    cleanup.push(() => rmSync(home, { recursive: true, force: true }));
    const omp = fakeOmp(tmpdir());
    openArtifact({ home, runtime: null, skillsDir: mkdtempSync(join(tmpdir(), 'oa-omp-skills-')) })(omp.api);
    await omp.emit('session_start', { reason: 'startup' });
    await new Promise((done) => setTimeout(done, 100));
    assert.equal(existsSync(join(home, 'daemon.json')), false);
    await omp.emit('session_shutdown', { reason: 'quit' });
  });

  it('connects as harness omp and attaches the session when a daemon runs', async () => {
    const { daemon, cwd } = await started();
    const hello = daemon.hellos[0] as HelloParams;
    assert.equal(hello.harness, 'omp');
    assert.equal(hello.caps?.tools, 'native');
    assert.deepEqual(hello.caps?.wake, { resume: true });
    // The daemon's own profile, sent too, so an older daemon without harnesses/omp.json knows OMP the same way.
    const shipped = JSON.parse(readFileSync(new URL('../../../packages/daemon/harnesses/omp.json', import.meta.url), 'utf8'));
    for (const [key, value] of Object.entries(PROFILE)) assert.deepEqual(shipped[key], value, key);
    assert.equal(shipped.agentName, 'OMP');
    assert.deepEqual(shipped.caps, { tools: 'native', commands: { names: ['open-artifact'] }, wake: { resume: true } });
    assert.deepEqual(hello.profile && { ...hello.profile, caps: undefined, agentName: undefined, commands: undefined }, { ...PROFILE, caps: undefined, agentName: undefined, commands: undefined });
    const attach = [...daemon.sessions.values()][0];
    assert.equal(attach.session, SESSION);
    assert.equal(attach.workspace, cwd);
    assert.equal(attach.status, 'idle');
    assert.equal(attach.pid, process.pid);
  });

  it('calls a tool for its session and answers the daemon’s result', async () => {
    const result: ToolCallResult = { url: 'open-artifact://artifact/a1', view_url: 'http://x/a/a1', messages: ['[Artifact comment sent to agent] hi'] };
    const { daemon, omp, cwd } = await started({ onToolCall: () => result });
    const answer = await callTool(omp, 'Artifact', { action: 'list' });
    const call = daemon.calls.find((c) => c.method === 'tools.call')!;
    assert.deepEqual(call.params, { name: 'Artifact', arguments: { action: 'list' }, caller: { session: SESSION, workspace: cwd } });
    assert.deepEqual(answer.details, result);
    assert.equal(answer.content.length, 2);
    assert.match(answer.content[0].text, /"url": "open-artifact:\/\/artifact\/a1"/);
    assert.equal(answer.content[1].text, '[Artifact comment sent to agent] hi');
  });

  it('fails the call when the daemon answers an error, keeping all it said', async () => {
    const { omp } = await started({
      onToolCall: () => ({ error: { code: 'conflict', message: 'The file changed.', fix: 'Read it again.' }, current: { 'index.md': 'new' } }),
    });
    await assert.rejects(callTool(omp, 'Artifact', { action: 'write' }), (error: Error) => {
      assert.match(error.message, /"code": "conflict"/);
      assert.match(error.message, /Read it again\./);
      assert.match(error.message, /"index\.md": "new"/);
      return true;
    });
  });

  it('waits for a slow call with no deadline of its own, and stops waiting on Esc', async () => {
    let finish!: (result: ToolCallResult) => void;
    const { omp } = await started({ onToolCall: () => new Promise<ToolCallResult>((done) => (finish = done)) });
    const abort = new AbortController();
    const call = callTool(omp, 'Artifact', { action: 'export' }, abort.signal);
    await new Promise((done) => setTimeout(done, 50));
    abort.abort();
    await assert.rejects(call, /Cancelled/);
    finish({ ok: true });

    const slow = callTool(omp, 'Artifact', { action: 'export' });
    await new Promise((done) => setTimeout(done, 50));
    finish({ ok: true });
    assert.deepEqual((await slow).details, { ok: true });
  });

  it('gives the owner’s comment as a user message: a new turn when idle, steered into a running one', async () => {
    const { daemon, omp } = await started();
    const source = { reason: 'comment', from: { kind: 'owner' } } as never;
    assert.deepEqual(await daemon.wake({ session: SESSION, text: '[Artifact comment sent to agent] bigger title', source }), { status: 'resumed' });
    assert.deepEqual(omp.prompts.at(-1), { text: '[Artifact comment sent to agent] bigger title', options: undefined });

    omp.setIdle(false);
    assert.deepEqual(await daemon.wake({ session: SESSION, text: 'second', source }), { status: 'delivered' });
    assert.deepEqual(omp.prompts.at(-1), { text: 'second', options: { deliverAs: 'steer' } });
    assert.equal(omp.messages.length, 0);
  });

  it('gives a collaborator’s comment to the model as a custom message, never as the person’s words', async () => {
    const { daemon, omp } = await started();
    const source = { reason: 'comment', from: { kind: 'collaborator', name: 'Ana', role: 'editor' } } as never;
    assert.deepEqual(await daemon.wake({ session: SESSION, text: 'Ana: move the chart', source }), { status: 'resumed' });
    assert.equal(omp.prompts.length, 0);
    const { message, options } = omp.messages[0];
    assert.equal(message.customType, 'open-artifact');
    assert.equal(message.content, 'Ana: move the chart');
    assert.equal(message.display, true);
    assert.deepEqual(options, { triggerTurn: true, deliverAs: 'followUp' });

    omp.setIdle(false);
    assert.deepEqual(await daemon.wake({ session: SESSION, text: 'system note', source: { reason: 'notice', from: { kind: 'system' } } as never }), { status: 'delivered' });
    assert.deepEqual(omp.messages[1].options, { triggerTurn: true, deliverAs: 'steer' });
  });

  it('answers failed when OMP drops the owner’s message, so the daemon keeps it in the inbox', async () => {
    const { daemon, omp } = await started();
    const source = { reason: 'comment', from: { kind: 'owner' } } as never;
    omp.setFailPrompts(true);
    assert.deepEqual(await daemon.wake({ session: SESSION, text: 'lost', source }), { status: 'failed' });
    omp.setFailPrompts(false);
    assert.deepEqual(await daemon.wake({ session: SESSION, text: 'again', source }), { status: 'resumed' });
  });

  it('answers a wake that starts a turn without waiting for the turn to end', async () => {
    const { daemon, omp } = await started();
    omp.setHangPrompts(true);
    const source = { reason: 'comment', from: { kind: 'owner' } } as never;
    const start = Date.now();
    assert.deepEqual(await daemon.wake({ session: SESSION, text: 'a long job', source }), { status: 'resumed' });
    assert.ok(Date.now() - start < 2000, `answered after ${Date.now() - start} ms`);
    assert.equal(omp.prompts.at(-1)?.text, 'a long job');
  });

  it('detaches the old session and attaches the new one after /new or /resume', async () => {
    const { daemon, omp, cwd } = await started();
    omp.setSessionId('omp-session-2');
    await omp.emit('session_switch', { reason: 'new', previousSessionFile: undefined });
    const detached = await daemon.waitFor('session.detach');
    assert.deepEqual(detached.params, { session: SESSION, workspace: cwd });
    await until(() => [...daemon.sessions.values()].some((s) => s.session === 'omp-session-2'), 'the new session');
    const attached = [...daemon.sessions.values()].find((s) => s.session === 'omp-session-2')!;
    assert.equal(attached.workspace, cwd);
    assert.equal(attached.status, 'idle');

    const source = { reason: 'comment', from: { kind: 'owner' } } as never;
    assert.deepEqual(await daemon.wake({ session: 'omp-session-2', text: 'new', source }), { status: 'resumed' });
    assert.deepEqual(await daemon.wake({ session: SESSION, text: 'old', source }), { status: 'failed' });
  });

  it('refuses a wake for another session, and every wake once the session ended', async () => {
    const { daemon, omp } = await started();
    assert.deepEqual(await daemon.wake({ session: 'someone-else', text: 'x' }), { status: 'failed' });
    assert.equal(omp.prompts.length + omp.messages.length, 0);
    await omp.emit('session_shutdown', { reason: 'quit' });
    await until(() => !daemon.connected, 'the connection to close');
  });

  it('hands what waited in the inbox to the session when it attaches', async () => {
    const { omp } = await started({}, (daemon) => daemon.queueInbox(SESSION, { kind: 'wake', text: 'while you were away', source: { reason: 'comment', from: { kind: 'owner' } } as never }));
    await until(() => omp.prompts.length === 1, 'the inbox message');
    assert.equal(omp.prompts[0].text, 'while you were away');
  });

  it('puts back in the daemon what the session could not take on attach, for its next tool call', async () => {
    const { daemon } = await started({}, (d) => d.queueInbox(SESSION, { kind: 'note', text: 'Just a note' }));
    const returned = (await daemon.waitFor('inbox.return')).params as { session: string; messages: Array<{ text: string }> };
    assert.deepEqual([returned.session, returned.messages.map((m) => m.text)], [SESSION, ['Just a note']]);
  });

  it('adds the always-on prompt to the system prompt OMP builds', async () => {
    const { omp } = await started();
    const [answer] = (await omp.emit('before_agent_start', { reason: 'prompt', prompt: 'hi', systemPrompt: ['base'] })) as Array<{ systemPrompt: string[] } | undefined>;
    assert.deepEqual(answer?.systemPrompt.slice(0, 1), ['base']);
    assert.match(answer?.systemPrompt.at(-1) ?? '', /<open_artifact>[\s\S]*<\/open_artifact>/);
    assert.equal(answer?.systemPrompt.at(-1), AGENT_PROMPT);

    // A revived turn carries the block already: it is replaced, never repeated.
    const [again] = (await omp.emit('before_agent_start', { reason: 'revive', prompt: '', systemPrompt: ['base', '<open_artifact>\nold\n</open_artifact>', 'tail'] })) as Array<{ systemPrompt: string[] } | undefined>;
    assert.deepEqual(again?.systemPrompt, ['base', 'tail', AGENT_PROMPT]);
    assert.deepEqual(withPrompt(withPrompt(['base'], AGENT_PROMPT), AGENT_PROMPT), ['base', AGENT_PROMPT]);
  });

  it('says when the agent runs and settles, and keeps a loop stop inside a run as running', async () => {
    const { daemon, omp } = await started();
    await omp.emit('agent_start');
    assert.deepEqual((await daemon.waitFor('session.status')).params, { session: SESSION, workspace: omp.ctx.cwd, status: 'running' });
    await omp.emit('agent_end', { willContinue: true, messages: [] } as OmpAgentEndEvent);
    assert.equal(daemon.calls.filter((c) => c.method === 'session.status').length, 1);
    await omp.emit('agent_end', { messages: [] } as OmpAgentEndEvent);
    assert.deepEqual((await daemon.waitFor('session.status')).params, { session: SESSION, workspace: omp.ctx.cwd, status: 'idle' });
  });

  it('reports the files OMP’s own write and edit tools wrote, not failed ones or other tools', async () => {
    const { daemon, omp, cwd } = await started();
    await omp.emit('tool_result', { toolName: 'read', input: { path: 'a.md' }, isError: false });
    await omp.emit('tool_result', { toolName: 'write', input: { path: 'b.md' }, isError: true });
    await omp.emit('tool_result', { toolName: 'edit', input: { path: '@deck/slides.md' }, isError: false });
    const wrote = await daemon.waitFor('agent.wrote');
    assert.deepEqual(wrote.params, { paths: [join(cwd, 'deck', 'slides.md')], caller: { session: SESSION, workspace: cwd } });
    assert.equal(daemon.calls.filter((c) => c.method === 'agent.wrote').length, 1);
  });

  it('ships the skill a fresh install has before any daemon answers', () => {
    const shipped = readFileSync(new URL('../skills/open-artifact/SKILL.md', import.meta.url), 'utf8');
    const rendered = renderedSkillFile(localSkill({ command: 'open-artifact', agentName: 'OMP', tools: 'native', opens: 'system' }));
    // The version and etag move with every release; `scripts/build-skill.mjs` rewrites them. The text is the contract.
    const withoutStamp = (text: string) => text.replace(/^generated-by:.*$/m, '').replace(/^etag:.*$/m, '');
    assert.equal(withoutStamp(shipped), withoutStamp(rendered));
  });

  it('writes the skill for OMP where its extension packages are scanned', async () => {
    const { omp, skillsDir } = await started();
    await until(() => existsSync(join(skillsDir, 'open-artifact', 'SKILL.md')), 'the skill');
    const skill = readFileSync(join(skillsDir, 'open-artifact', 'SKILL.md'), 'utf8');
    assert.match(skill, /^name: open-artifact$/m);
    assert.match(skill, /Send to OMP/);
    assert.match(skill, /generated-by: open-artifact/);
  });

  it('runs /open-artifact as the skill and the request, with the installed types as completions', async () => {
    const { daemon, omp } = await started();
    await daemon.waitFor('commands.list');
    const command = omp.commands.get('open-artifact')!;
    await until(() => !!command.getArgumentCompletions?.(''), 'the commands');
    assert.deepEqual(command.getArgumentCompletions!('sl'), [{ value: 'slides ', label: 'slides', description: 'Slides' }]);
    assert.equal(command.getArgumentCompletions!('zz'), null);

    await command.handler(' slides a pitch deck ', omp.ctx);
    const sent = omp.prompts.at(-1)!;
    assert.match(sent.text, /^# Make an artifact: `\/open-artifact <type> <what to make>`/);
    assert.match(sent.text, /\n\nslides a pitch deck$/);
    assert.doesNotMatch(sent.text, /^\/skill:/);
    assert.equal(sent.options, undefined);

    omp.setIdle(false);
    await command.handler('', omp.ctx);
    assert.deepEqual(omp.prompts.at(-1)!.options, { deliverAs: 'followUp' });

    // The command is done once the message is sent, not when the turn it starts ends.
    omp.setIdle(true);
    omp.setHangPrompts(true);
    await command.handler('slides another', omp.ctx);
    assert.match(omp.prompts.at(-1)!.text, /\n\nslides another$/);
  });
});

describe('defaultSkillsDir', () => {
  it('is the package’s skills folder when installed, and nowhere in a source checkout', () => {
    const root = mkdtempSync(join(tmpdir(), 'oa-omp-layout-'));
    cleanup.push(() => rmSync(root, { recursive: true, force: true }));
    const installed = join(root, 'node_modules', 'omp-open-artifact');
    mkdirSync(join(installed, 'src'), { recursive: true });
    assert.equal(defaultSkillsDir(pathToFileURL(join(installed, 'src', 'extension.ts')).href), join(installed, 'skills'));

    const checkout = join(root, 'repo');
    mkdirSync(join(checkout, 'scripts'), { recursive: true });
    writeFileSync(join(checkout, 'scripts', 'build-skill.mjs'), '');
    mkdirSync(join(checkout, 'plugins', 'omp', 'src'), { recursive: true });
    assert.equal(defaultSkillsDir(pathToFileURL(join(checkout, 'plugins', 'omp', 'src', 'extension.ts')).href), null);
  });
});

describe('absolutePath', () => {
  it('reads paths the way OMP’s file tools do', () => {
    assert.equal(absolutePath('a/b.md', '/w'), '/w/a/b.md');
    assert.equal(absolutePath('@a.md', '/w'), '/w/a.md');
    assert.equal(absolutePath('/abs/c.md', '/w'), '/abs/c.md');
    assert.match(absolutePath('~/d.md', '/w'), /\/d\.md$/);
  });
});
