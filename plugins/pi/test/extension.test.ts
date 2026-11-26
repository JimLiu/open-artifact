/**
 * The Pi extension against a fake Pi (the part of its extension API the extension uses, `src/pi.ts`) and the kit's
 * fake daemon: tools, wakes by who sent them, the inbox, the prompt, the skill, the command, session state and
 * writes. `e2e/pi.test.mjs` loads it in the real `pi`.
 */
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, it } from 'node:test';
import { startFakeDaemon, type FakeDaemon } from '@open-artifact/harness-kit/testing';
import { AGENT_PROMPT, TOOL_DEFINITIONS, type HelloParams, type ToolCallResult } from '@open-artifact/protocol';
import { absolutePath, openArtifact, PROFILE, promptSection, PROMPT_SECTION } from '../src/extension.ts';
import type { PiCommand, PiContext, PiCustomMessage, PiExtensionAPI, PiTool } from '../src/pi.ts';

const SESSION = 'pi-session-1';

/** A fake Pi: records what the extension registers and sends, and plays Pi's events. */
function fakePi(cwd: string) {
  const tools = new Map<string, PiTool>();
  const commands = new Map<string, PiCommand>();
  const handlers = new Map<string, Array<(event: unknown, ctx: PiContext) => unknown>>();
  const messages: Array<{ message: PiCustomMessage; options: unknown }> = [];
  const prompts: Array<{ text: string; options: unknown }> = [];
  let idle = true;
  const ctx: PiContext = {
    cwd,
    mode: 'print',
    hasUI: false,
    sessionManager: { getSessionId: () => SESSION },
    isIdle: () => idle,
    ui: { notify: () => undefined },
  };
  const api = {
    registerTool: (tool: PiTool) => tools.set(tool.name, tool),
    registerCommand: (name: string, command: PiCommand) => commands.set(name, command),
    sendMessage: (message: PiCustomMessage, options?: unknown) => messages.push({ message, options }),
    sendUserMessage: (text: string, options?: unknown) => prompts.push({ text, options }),
    on: (event: string, handler: (event: unknown, ctx: PiContext) => unknown) => handlers.set(event, [...(handlers.get(event) ?? []), handler]),
  } as unknown as PiExtensionAPI;
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

/** A fake daemon and a fake Pi with the extension loaded, its session started and attached. */
async function started(options: Parameters<typeof startFakeDaemon>[0] = {}, beforeStart?: (daemon: FakeDaemon) => void) {
  const daemon = await startFakeDaemon(options);
  cleanup.push(() => daemon.close());
  const cwd = mkdtempSync(join(tmpdir(), 'oa-pi-cwd-'));
  cleanup.push(() => rmSync(cwd, { recursive: true, force: true }));
  const pi = fakePi(cwd);
  openArtifact({ home: daemon.home, runtime: null })(pi.api);
  cleanup.push(() => pi.emit('session_shutdown', { reason: 'quit' }));
  beforeStart?.(daemon);
  await pi.emit('session_start', { reason: 'startup' });
  await daemon.waitFor('session.attach');
  return { daemon, pi, cwd };
}

const callTool = (pi: ReturnType<typeof fakePi>, name: string, args: Record<string, unknown>, signal?: AbortSignal) =>
  pi.tools.get(name)!.execute('call-1', args, signal, undefined, pi.ctx);

describe('pi-open-artifact', () => {
  it('registers the three tools with the daemon’s schemas, and the command, before any daemon', () => {
    const pi = fakePi(tmpdir());
    openArtifact({ home: mkdtempSync(join(tmpdir(), 'oa-pi-home-')), runtime: null })(pi.api);
    assert.deepEqual([...pi.tools.keys()], TOOL_DEFINITIONS.map((d) => d.name));
    for (const definition of TOOL_DEFINITIONS) assert.deepEqual(pi.tools.get(definition.name)!.parameters, definition.inputSchema);
    assert.ok(pi.commands.has('open-artifact'));
  });

  it('does not start a daemon at session start when none runs', async () => {
    const home = mkdtempSync(join(tmpdir(), 'oa-pi-home-'));
    cleanup.push(() => rmSync(home, { recursive: true, force: true }));
    const pi = fakePi(tmpdir());
    openArtifact({ home, runtime: null })(pi.api);
    await pi.emit('session_start', { reason: 'startup' });
    await new Promise((done) => setTimeout(done, 100));
    assert.equal(existsSync(join(home, 'daemon.json')), false);
    await pi.emit('session_shutdown', { reason: 'quit' });
  });

  it('connects as harness pi and attaches the session when a daemon runs', async () => {
    const { daemon, cwd } = await started();
    const hello = daemon.hellos[0] as HelloParams;
    assert.equal(hello.harness, 'pi');
    assert.equal(hello.caps?.tools, 'native');
    assert.deepEqual(hello.caps?.wake, { resume: true });
    // The daemon's own profile, sent too, so an older daemon without harnesses/pi.json knows Pi the same way.
    const shipped = JSON.parse(readFileSync(new URL('../../../packages/daemon/harnesses/pi.json', import.meta.url), 'utf8'));
    for (const [key, value] of Object.entries(PROFILE)) assert.deepEqual(shipped[key], value, key);
    assert.deepEqual(hello.profile && { ...hello.profile, caps: undefined, agentName: undefined, commands: undefined }, { ...PROFILE, caps: undefined, agentName: undefined, commands: undefined });
    const attach = [...daemon.sessions.values()][0];
    assert.equal(attach.session, SESSION);
    assert.equal(attach.workspace, cwd);
    assert.equal(attach.status, 'idle');
    assert.equal(attach.pid, process.pid);
  });

  it('calls a tool for its session and answers the daemon’s result', async () => {
    const result: ToolCallResult = { url: 'open-artifact://artifact/a1', view_url: 'http://x/a/a1', messages: ['[Artifact comment sent to agent] hi'] };
    const { daemon, pi, cwd } = await started({ onToolCall: () => result });
    const answer = await callTool(pi, 'Artifact', { action: 'list' });
    const call = daemon.calls.find((c) => c.method === 'tools.call')!;
    assert.deepEqual(call.params, { name: 'Artifact', arguments: { action: 'list' }, caller: { session: SESSION, workspace: cwd } });
    assert.deepEqual(answer.details, result);
    assert.equal(answer.content.length, 2);
    assert.match(answer.content[0].text, /"url": "open-artifact:\/\/artifact\/a1"/);
    assert.equal(answer.content[1].text, '[Artifact comment sent to agent] hi');
  });

  it('fails the call when the daemon answers an error, keeping all it said', async () => {
    const { pi } = await started({
      onToolCall: () => ({ error: { code: 'conflict', message: 'The file changed.', fix: 'Read it again.' }, current: { 'index.md': 'new' } }),
    });
    await assert.rejects(callTool(pi, 'Artifact', { action: 'write' }), (error: Error) => {
      assert.match(error.message, /"code": "conflict"/);
      assert.match(error.message, /Read it again\./);
      assert.match(error.message, /"index\.md": "new"/);
      return true;
    });
  });

  it('waits for a slow call with no deadline of its own, and stops waiting on Esc', async () => {
    let finish!: (result: ToolCallResult) => void;
    const { pi } = await started({ onToolCall: () => new Promise<ToolCallResult>((done) => (finish = done)) });
    const abort = new AbortController();
    const call = callTool(pi, 'Artifact', { action: 'export' }, abort.signal);
    await new Promise((done) => setTimeout(done, 50));
    abort.abort();
    await assert.rejects(call, /Cancelled/);
    finish({ ok: true });

    const slow = callTool(pi, 'Artifact', { action: 'export' });
    await new Promise((done) => setTimeout(done, 50));
    finish({ ok: true });
    assert.deepEqual((await slow).details, { ok: true });
  });

  it('gives the owner’s comment as a user message: a new turn when idle, steered into a running one', async () => {
    const { daemon, pi } = await started();
    const source = { reason: 'comment', from: { kind: 'owner' } } as never;
    assert.deepEqual(await daemon.wake({ session: SESSION, text: '[Artifact comment sent to agent] bigger title', source }), { status: 'resumed' });
    assert.deepEqual(pi.prompts.at(-1), { text: '[Artifact comment sent to agent] bigger title', options: undefined });

    pi.setIdle(false);
    assert.deepEqual(await daemon.wake({ session: SESSION, text: 'second', source }), { status: 'delivered' });
    assert.deepEqual(pi.prompts.at(-1), { text: 'second', options: { deliverAs: 'steer' } });
    assert.equal(pi.messages.length, 0);
  });

  it('gives a collaborator’s comment to the model as a custom message, never as the person’s words', async () => {
    const { daemon, pi } = await started();
    const source = { reason: 'comment', from: { kind: 'collaborator', name: 'Ana', role: 'editor' } } as never;
    assert.deepEqual(await daemon.wake({ session: SESSION, text: 'Ana: move the chart', source }), { status: 'resumed' });
    assert.equal(pi.prompts.length, 0);
    const { message, options } = pi.messages[0];
    assert.equal(message.customType, 'open-artifact');
    assert.equal(message.content, 'Ana: move the chart');
    assert.equal(message.display, true);
    assert.deepEqual(options, { triggerTurn: true, deliverAs: 'followUp' });

    pi.setIdle(false);
    assert.deepEqual(await daemon.wake({ session: SESSION, text: 'system note', source: { reason: 'notice', from: { kind: 'system' } } as never }), { status: 'delivered' });
    assert.deepEqual(pi.messages[1].options, { triggerTurn: true, deliverAs: 'steer' });
  });

  it('refuses a wake for another session, and every wake once the session ended', async () => {
    const { daemon, pi } = await started();
    assert.deepEqual(await daemon.wake({ session: 'someone-else', text: 'x' }), { status: 'failed' });
    assert.equal(pi.prompts.length + pi.messages.length, 0);
    await pi.emit('session_shutdown', { reason: 'new' });
    await until(() => !daemon.connected, 'the connection to close');
  });

  it('hands what waited in the inbox to the session when it attaches', async () => {
    const { pi } = await started({}, (daemon) => daemon.queueInbox(SESSION, { kind: 'wake', text: 'while you were away', source: { reason: 'comment', from: { kind: 'owner' } } as never }));
    await until(() => pi.prompts.length === 1, 'the inbox message');
    assert.equal(pi.prompts[0].text, 'while you were away');
  });

  it('puts back in the daemon what the session could not take on attach, for its next tool call', async () => {
    const { daemon } = await started({}, (d) => d.queueInbox(SESSION, { kind: 'note', text: 'Just a note' }));
    const returned = (await daemon.waitFor('inbox.return')).params as { session: string; messages: Array<{ text: string }> };
    assert.deepEqual([returned.session, returned.messages.map((m) => m.text)], [SESSION, ['Just a note']]);
  });

  it('adds the always-on prompt as its own system prompt section', async () => {
    const { pi } = await started();
    const event = { systemPromptOptions: { sections: { other: 'kept' } as Record<string, string> } };
    await pi.emit('before_agent_start', event);
    assert.equal(event.systemPromptOptions.sections.other, 'kept');
    assert.equal(event.systemPromptOptions.sections[PROMPT_SECTION], promptSection(AGENT_PROMPT));
    assert.doesNotMatch(event.systemPromptOptions.sections[PROMPT_SECTION], /<\/?open_artifact>/);
  });

  it('says when the agent runs and settles', async () => {
    const { daemon, pi } = await started();
    await pi.emit('agent_start');
    assert.deepEqual((await daemon.waitFor('session.status')).params, { session: SESSION, workspace: pi.ctx.cwd, status: 'running' });
    await pi.emit('agent_settled');
    assert.deepEqual((await daemon.waitFor('session.status')).params, { session: SESSION, workspace: pi.ctx.cwd, status: 'idle' });
  });

  it('does not log the last idle that Pi’s exit cuts off as an error', async () => {
    const daemon = await startFakeDaemon();
    cleanup.push(() => daemon.close());
    const lines: string[] = [];
    const pi = fakePi(tmpdir());
    openArtifact({ home: daemon.home, runtime: null, log: (line) => lines.push(line) })(pi.api);
    await pi.emit('session_start', { reason: 'startup' });
    await daemon.waitFor('session.attach');
    await pi.emit('agent_settled');
    await pi.emit('session_shutdown', { reason: 'quit' });
    await new Promise((done) => setTimeout(done, 100));
    assert.deepEqual(lines.filter((line) => line.startsWith('open-artifact status')), []);
  });

  it('reports the files Pi’s own write and edit tools wrote, not failed ones or other tools', async () => {
    const { daemon, pi, cwd } = await started();
    await pi.emit('tool_result', { toolName: 'read', input: { path: 'a.md' }, isError: false });
    await pi.emit('tool_result', { toolName: 'write', input: { path: 'b.md' }, isError: true });
    await pi.emit('tool_result', { toolName: 'edit', input: { path: '@deck/slides.md' }, isError: false });
    const wrote = await daemon.waitFor('agent.wrote');
    assert.deepEqual(wrote.params, { paths: [join(cwd, 'deck', 'slides.md')], caller: { session: SESSION, workspace: cwd } });
    assert.equal(daemon.calls.filter((c) => c.method === 'agent.wrote').length, 1);
  });

  it('writes the skill for Pi and gives its folder to Pi', async () => {
    const { daemon, pi } = await started();
    const [resources] = (await pi.emit('resources_discover', { cwd: pi.ctx.cwd, reason: 'startup' })) as Array<{ skillPaths: string[] }>;
    assert.deepEqual(resources.skillPaths, [join(daemon.home, 'skills', 'pi')]);
    const skill = readFileSync(join(daemon.home, 'skills', 'pi', 'open-artifact', 'SKILL.md'), 'utf8');
    assert.match(skill, /^name: open-artifact$/m);
  });

  it('runs /open-artifact as the skill, with the installed types as completions', async () => {
    const { daemon, pi } = await started();
    await daemon.waitFor('commands.list');
    const command = pi.commands.get('open-artifact')!;
    await until(() => !!command.getArgumentCompletions?.(''), 'the commands');
    assert.deepEqual(await command.getArgumentCompletions!('sl'), [{ value: 'slides ', label: 'slides', description: 'Slides' }]);
    assert.equal(await command.getArgumentCompletions!('zz'), null);

    await command.handler(' slides a pitch deck ', pi.ctx);
    assert.deepEqual(pi.prompts.at(-1), { text: '/skill:open-artifact slides a pitch deck', options: { expandPromptTemplates: true } });
    pi.setIdle(false);
    await command.handler('', pi.ctx);
    assert.deepEqual(pi.prompts.at(-1), { text: '/skill:open-artifact', options: { expandPromptTemplates: true, deliverAs: 'followUp' } });
  });
});

describe('absolutePath', () => {
  it('reads paths the way Pi’s file tools do', () => {
    assert.equal(absolutePath('a/b.md', '/w'), '/w/a/b.md');
    assert.equal(absolutePath('@a.md', '/w'), '/w/a.md');
    assert.equal(absolutePath('/abs/c.md', '/w'), '/abs/c.md');
    assert.match(absolutePath('~/d.md', '/w'), /\/d\.md$/);
  });
});
