/**
 * The publishing guard of the command line (`agent-session.ts`): which variables mark an agent's session, which of the
 * person's decisions are refused there and with what sentence, the one override (`remotes.<name>.agentMayPublish`),
 * and what `open-artifact publish` does about a dashboard's data with and without a terminal.
 */

import './helpers.ts';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { agentSessionOf, agentVariables, dataChoice, dataLeftOut, personOnlyRefusal, saidYes, type PersonAct } from '../src/agent-session.ts';

const SHIPPED = [resolve(import.meta.dirname, '..', 'harnesses')];

test('each harness profile that names a session variable marks an agent session, and so do the app markers', () => {
  const variables = agentVariables(SHIPPED);
  // The shipped profiles' sessionEnv.
  assert.equal(variables.get('CLAUDE_CODE_SESSION_ID'), 'claude-code');
  assert.equal(variables.get('CODEX_THREAD_ID'), 'codex');
  assert.equal(variables.get('ANTIGRAVITY_CONVERSATION_ID'), 'antigravity');
  // The markers the apps set besides.
  assert.equal(variables.get('CLAUDECODE'), 'claude-code');
  assert.equal(variables.get('ANTIGRAVITY_AGENT'), 'antigravity');

  assert.deepEqual(agentSessionOf({ CLAUDECODE: '1', CLAUDE_CODE_SESSION_ID: 'abc' }, SHIPPED), { harness: 'claude-code', variable: 'CLAUDECODE', session: 'abc' });
  assert.deepEqual(agentSessionOf({ CLAUDECODE: '1' }, SHIPPED), { harness: 'claude-code', variable: 'CLAUDECODE', session: null });
  assert.deepEqual(agentSessionOf({ CODEX_THREAD_ID: 't-1' }, SHIPPED), { harness: 'codex', variable: 'CODEX_THREAD_ID', session: 't-1' });
  assert.deepEqual(agentSessionOf({ ANTIGRAVITY_CONVERSATION_ID: 'c-1' }, SHIPPED), { harness: 'antigravity', variable: 'ANTIGRAVITY_CONVERSATION_ID', session: 'c-1' });
  // A person's terminal: none of them (an empty value counts as unset; OPEN_ARTIFACT_HARNESS alone is not one).
  assert.equal(agentSessionOf({ HOME: '/home/ada', PATH: '/usr/bin', CLAUDECODE: '', OPEN_ARTIFACT_HARNESS: 'cli' }, SHIPPED), null);
});

test('inside an agent session every one of the person\'s decisions is refused, with the sentence to act on', () => {
  const agent = agentSessionOf({ CODEX_THREAD_ID: 't-1' }, SHIPPED);
  const acts: PersonAct[] = ['publish', 'unpublish', 'data', 'remote-add', 'remote-remove', 'remote-default', 'remote-auto'];
  for (const act of acts) {
    const refusal = personOnlyRefusal(act, agent, { remote: 'work', settings: {}, command: 'open-artifact something' });
    assert.ok(refusal, act);
    assert.match(refusal, /is the person's decision, and this command runs inside an agent session \(codex: CODEX_THREAD_ID is set\), so it was not done\./);
    assert.match(refusal, /\nAsk the person to .+, or to run `open-artifact something` in their own terminal\.$/);
    // The override is never advertised to the agent.
    assert.doesNotMatch(refusal, /agentMayPublish|settings/);
  }
  // A person's own terminal: nothing is refused.
  for (const act of acts) assert.equal(personOnlyRefusal(act, null, { remote: 'work', settings: {}, command: 'x' }), null);
});

test('remotes.<name>.agentMayPublish lets publish and unpublish on that remote through, and nothing else', () => {
  const agent = agentSessionOf({ CLAUDECODE: '1' }, SHIPPED);
  const settings = { remotes: { work: { agentMayPublish: true } } };
  assert.equal(personOnlyRefusal('publish', agent, { remote: 'work', settings, command: 'x' }), null);
  assert.equal(personOnlyRefusal('unpublish', agent, { remote: 'work', settings, command: 'x' }), null);
  assert.ok(personOnlyRefusal('publish', agent, { remote: 'other', settings, command: 'x' }));
  assert.ok(personOnlyRefusal('publish', agent, { remote: null, settings, command: 'x' }), 'no remote to go to: refused');
  for (const act of ['data', 'remote-add', 'remote-remove', 'remote-default', 'remote-auto'] as const) {
    assert.ok(personOnlyRefusal(act, agent, { remote: 'work', settings, command: 'x' }), act);
  }
});

test('a dashboard\'s data: asked at a terminal, left out without one, never confirmed by an agent session', () => {
  const agent = agentSessionOf({ CLAUDECODE: '1' }, SHIPPED);
  assert.equal(dataChoice({ live: false, confirmed: false, agent: null, interactive: true }), 'none');
  assert.equal(dataChoice({ live: true, confirmed: true, agent: null, interactive: false }), 'none');
  assert.equal(dataChoice({ live: true, confirmed: false, agent: null, interactive: true }), 'ask');
  assert.equal(dataChoice({ live: true, confirmed: false, agent: null, interactive: false }), 'no-terminal');
  assert.equal(dataChoice({ live: true, confirmed: false, agent, interactive: true }), 'agent');
  for (const yes of ['y', 'Y', 'yes', ' YES ']) assert.equal(saidYes(yes), true, yes);
  for (const no of ['', 'n', 'no', 'yep', 'sure']) assert.equal(saidYes(no), false, no);
  assert.match(dataLeftOut('art_1', 'no-terminal'), /Share panel \("Publish its data"\) or with `open-artifact publish art_1` in their own terminal, which asks\.$/);
  assert.match(dataLeftOut('art_1', 'agent'), /An agent session never publishes a dashboard's data\.$/);
});
