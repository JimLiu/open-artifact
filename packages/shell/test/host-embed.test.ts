/**
 * The Shell's side of embedding: which `host_hello` is taken (declared origin, another one, none declared), what an
 * undeclared host is sent, destinations capped, the accent's variables, and the home page's host and library filter.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { HOST_ACCENT_VARS, MAX_HOST_DESTINATIONS, MAX_HOST_TEXT, accentVars as protocolAccentVars, hostThemePatch, type ArtifactView } from '@open-artifact/protocol';
import { beginHostOriginRead, emptyHostOriginLedger, hostAfterHello, settleHostOriginRead, type HostHelloDecision, type HostOriginLedger } from '../src/lib/host-hello.ts';
import { accentVars, destinationRequest, hostOf, hostVerdict, offersSwitch, savedMessage, toHostMessage } from '../src/shell/model.ts';
import { forHost, homeHostOf } from '../src/home/model.ts';

const hello = (extra: Record<string, unknown> = {}) => ({ openArtifact: 'host_hello', caps: { sessions: true, toolbar: true }, agentName: 'Helper', ...extra });

describe('host handshake', () => {
  it('takes a declared origin, refuses another while any is declared, and takes any parent while none is', () => {
    assert.equal(hostVerdict('app://host', ['app://host', 'https://app.example.com']), 'declared');
    assert.equal(hostVerdict('https://evil.example', ['app://host']), 'refused');
    assert.equal(hostVerdict('null', ['app://host']), 'refused');
    assert.equal(hostVerdict('https://evil.example', []), 'undeclared');
    assert.equal(hostVerdict('https://evil.example', null), 'undeclared', 'a list that could not be read declares nothing');
  });

  it('reduces host_hello to its fields; destinations only for a declared host, at most MAX_HOST_DESTINATIONS', () => {
    const destinations = Array.from({ length: MAX_HOST_DESTINATIONS + 3 }, (_, i) => ({ id: `d${i}`, label: `Place ${i}`, run: 'x' }));
    const declared = hostOf(hello({ destinations, theme: { scheme: 'dark', accent: '#ff8800' }, extra: 'dropped' }), 'app://host', true)!;
    assert.equal(declared.declared, true);
    assert.equal(declared.via, 'frame');
    assert.equal(declared.destinations.length, MAX_HOST_DESTINATIONS);
    assert.deepEqual(declared.destinations[0], { id: 'd0', label: 'Place 0' });
    assert.deepEqual(declared.theme, { scheme: 'dark', accent: '#ff8800' });
    assert.deepEqual(declared.caps, { sessions: true, toolbar: true });
    const undeclared = hostOf(hello({ destinations }), 'https://evil.example', false)!;
    assert.deepEqual(undeclared.destinations, [], 'an undeclared host offers no destinations');
    assert.equal(hostOf({ openArtifact: 'goto', hash: '#x' }, 'app://host', true), null);
    assert.equal(hostOf('host_hello', 'app://host', true), null);
  });

  it('sends an undeclared host no prompt or comment text, links or saved files', () => {
    const undeclared = hostOf(hello(), 'https://evil.example', false)!;
    const declared = hostOf(hello(), 'app://host', true)!;
    const prompt = { openArtifact: 'new_session' as const, prompt: 'Fix slide 3', artifact: 'open-artifact://artifact/a' };
    assert.deepEqual(toHostMessage(undeclared, prompt), { ...prompt, prompt: '' });
    assert.deepEqual(toHostMessage(declared, prompt), prompt);
    assert.deepEqual(toHostMessage(undeclared, { openArtifact: 'comment_summon', text: 'secret' }), { openArtifact: 'comment_summon', text: '' });
    assert.equal(toHostMessage(undeclared, { openArtifact: 'open_external', url: 'https://example.com' }), null);
    assert.equal(toHostMessage(undeclared, { openArtifact: 'saved_file', path: '/Users/me/Downloads/a.pdf' }), null);
    assert.deepEqual(toHostMessage(declared, { openArtifact: 'saved_file', path: '/Users/me/Downloads/a.pdf' }), { openArtifact: 'saved_file', path: '/Users/me/Downloads/a.pdf' });
    assert.deepEqual(toHostMessage(undeclared, { openArtifact: 'place', artifact: 'x', hash: '#2' }), { openArtifact: 'place', artifact: 'x', hash: '#2' });
  });

  it('saved: the page\'s save state and leaveLosesWork, to every host, declared or not', () => {
    assert.deepEqual(savedMessage({}), { openArtifact: 'saved', state: null, leaveLosesWork: false }, 'nothing reported yet');
    assert.deepEqual(savedMessage({ saved: 'saving', leaveLosesWork: true }), { openArtifact: 'saved', state: 'saving', leaveLosesWork: true });
    const undeclared = hostOf(hello(), 'https://evil.example', false)!;
    const message = savedMessage({ saved: 'unsaved', leaveLosesWork: true });
    assert.deepEqual(toHostMessage(undeclared, message), message);
  });

  it('switcher: a host with its own way between artifacts hides Switch artifact; others keep it', () => {
    const switching = hostOf(hello({ caps: { toolbar: true, switcher: true } }), 'app://host', true)!;
    assert.deepEqual(switching.caps, { toolbar: true, switcher: true });
    assert.equal(offersSwitch(switching), false);
    assert.equal(offersSwitch(hostOf(hello(), 'app://host', true)), true, 'a host that does not say it: as before');
    assert.equal(offersSwitch(hostOf(hello({ caps: { switcher: 'yes' } }), 'app://host', true)), true, 'only true');
    assert.equal(offersSwitch(null), true, 'no host: as before');
  });

  it('a top-level view host is the adapter itself: declared', () => {
    const view = hostOf(hello({ destinations: [{ id: 'drive', label: 'Drive' }] }), 'view', true, 'view')!;
    assert.equal(view.via, 'view');
    assert.equal(view.destinations.length, 1);
  });

  it('names the destination in the page request as quoted data', () => {
    const text = destinationRequest({ id: 'drive', label: 'Google Drive' }, 'Q3 deck');
    assert.match(text, /"Google Drive" \(destination id: drive\)/);
    assert.match(text, /"Q3 deck"/);
  });

  it("sets the accent's variables for #rrggbb only", () => {
    assert.deepEqual(accentVars(null), {});
    assert.deepEqual(accentVars('red'), {});
    assert.deepEqual(accentVars('#FFEE00'), { '--open-artifact-accent': '#ffee00', '--open-artifact-accent-fg': '#0b1220', '--open-artifact-accent-soft': '#ffee001f' });
    assert.equal(accentVars('#1d4ed8')['--open-artifact-accent-fg'], '#ffffff');
  });

  it('cuts long texts in messages it reads', () => {
    const host = hostOf(hello({ agentName: 'x'.repeat(MAX_HOST_TEXT) }), 'app://host', true)!;
    assert.ok(host.agentName!.length <= 80);
  });

  it('re-exports the one accent implementation', () => {
    assert.equal(accentVars, protocolAccentVars);
  });
});

describe('declared-host list races', () => {
  const evil = 'https://evil.example';
  const good = 'app://host';

  /** Applies one settled read the way the Shell and the home page do. `library` stands for the home filter. */
  function step(
    ledger: HostOriginLedger,
    origin: string,
    hosts: readonly string[] | null,
    host: { origin: string; library?: { harness: string } } | null,
    read = beginHostOriginRead(ledger),
  ): { ledger: HostOriginLedger; host: typeof host; decision: HostHelloDecision; accepted: boolean } {
    const settled = settleHostOriginRead(read.ledger, read.read, origin, hosts);
    let accepted = false;
    const next = hostAfterHello(host, origin, settled.decision, () => {
      accepted = true;
      return { origin, library: { harness: 'myagent' } };
    });
    return { ledger: settled.ledger, host: next, decision: settled.decision, accepted };
  }

  it('takes a first failed read as undeclared, then a refusal clears that host and its library filter', () => {
    let ledger = emptyHostOriginLedger();
    let host: { origin: string; library?: { harness: string } } | null = null;
    const failed = step(ledger, evil, null, host);
    ledger = failed.ledger;
    host = failed.host;
    assert.deepEqual(failed.decision, { action: 'accept', verdict: 'undeclared' });
    assert.equal(failed.accepted, true);
    assert.deepEqual(host?.library, { harness: 'myagent' });
    assert.equal(ledger.lastGoodHosts, null);

    const refused = step(ledger, evil, [good], host);
    assert.equal(refused.decision.action, 'refuse');
    assert.equal(refused.accepted, false, 'a refusal does not acceptHost');
    assert.equal(refused.host, null, 'the host the failed read wrote is cleared, and its library filter with it');
    assert.deepEqual(refused.ledger.lastGoodHosts, [good]);
  });

  it('does not accept a failed read once a refusal is on record', () => {
    let ledger = emptyHostOriginLedger();
    const refused = step(ledger, evil, [good], { origin: evil, library: { harness: 'myagent' } });
    ledger = refused.ledger;
    assert.equal(refused.host, null, 'the refusal clears the host this origin already wrote');
    const again = step(ledger, evil, null, refused.host);
    assert.equal(again.decision.action, 'refuse');
    assert.equal(again.accepted, false, 'a later failure does not acceptHost');
    assert.equal(again.host, null);
    assert.deepEqual(again.ledger.lastGoodHosts, [good], 'the failure does not wipe the list');
  });

  it('keeps a declared host when a later read fails', () => {
    let ledger = emptyHostOriginLedger();
    const declared = step(ledger, good, [good], null);
    ledger = declared.ledger;
    assert.deepEqual(declared.decision, { action: 'accept', verdict: 'declared' });
    const failed = step(ledger, good, null, declared.host);
    assert.deepEqual(failed.decision, { action: 'accept', verdict: 'declared' });
    assert.equal(failed.accepted, true);
    assert.equal(failed.host?.origin, good);
    assert.deepEqual(failed.ledger.lastGoodHosts, [good]);
  });

  it('drops an older successful read that arrives after a newer one', () => {
    let ledger = emptyHostOriginLedger();
    const first = beginHostOriginRead(ledger);
    ledger = first.ledger;
    const second = beginHostOriginRead(ledger);
    ledger = second.ledger;
    const newer = settleHostOriginRead(ledger, second.read, 'https://new.example', ['https://new.example']);
    ledger = newer.ledger;
    assert.deepEqual(newer.decision, { action: 'accept', verdict: 'declared' });
    const older = settleHostOriginRead(ledger, first.read, 'https://new.example', ['https://old.example']);
    assert.equal(older.decision.action, 'discard');
    assert.deepEqual(older.ledger.lastGoodHosts, ['https://new.example']);
    const host = hostAfterHello({ origin: 'https://new.example' }, 'https://new.example', older.decision, () => {
      throw new Error('acceptHost');
    });
    assert.equal(host?.origin, 'https://new.example');
  });

  it('still applies an older success when a newer read failed and accepted first', () => {
    let ledger = emptyHostOriginLedger();
    const first = beginHostOriginRead(ledger);
    ledger = first.ledger;
    const second = beginHostOriginRead(ledger);
    ledger = second.ledger;
    const failed = settleHostOriginRead(ledger, second.read, evil, null);
    ledger = failed.ledger;
    assert.deepEqual(failed.decision, { action: 'accept', verdict: 'undeclared' });
    let host = hostAfterHello(null, evil, failed.decision, () => ({ origin: evil }));
    const late = settleHostOriginRead(ledger, first.read, evil, [good]);
    assert.equal(late.decision.action, 'refuse');
    assert.deepEqual(late.ledger.lastGoodHosts, [good]);
    host = hostAfterHello(host, evil, late.decision, () => {
      throw new Error('acceptHost');
    });
    assert.equal(host, null);
  });

  it('a refusal does not clear a different origin', () => {
    const current = { origin: good };
    const next = hostAfterHello(current, evil, { action: 'refuse' }, () => {
      throw new Error('acceptHost');
    });
    assert.equal(next, current);
  });
});

describe('host theme clear list', () => {
  it('names the three accent properties when the theme or the accent is missing', () => {
    assert.deepEqual([...HOST_ACCENT_VARS], ['--open-artifact-accent', '--open-artifact-accent-fg', '--open-artifact-accent-soft']);
    const cleared = hostThemePatch(null);
    assert.equal(cleared.scheme, null);
    assert.deepEqual(cleared.set, {});
    assert.deepEqual(cleared.remove, [...HOST_ACCENT_VARS]);
    const missing = hostThemePatch({ scheme: 'dark' });
    assert.equal(missing.scheme, 'dark');
    assert.deepEqual(missing.set, {}, 'a missing accent is not an empty object the caller may ignore');
    assert.deepEqual(missing.remove, [...HOST_ACCENT_VARS]);
    const invalid = hostThemePatch({ scheme: 'light', accent: 'red' });
    assert.deepEqual(invalid.remove, [...HOST_ACCENT_VARS]);
    assert.equal(hostThemePatch({ accent: '#112233' }).scheme, null, 'a missing scheme clears the pin');
    assert.equal(hostThemePatch({ scheme: 'light' }).scheme, 'light');
    assert.equal(hostThemePatch({ scheme: 'dark' }).scheme, 'dark');
    const painted = hostThemePatch({ scheme: 'dark', accent: '#FFEE00' });
    assert.deepEqual(painted.remove, []);
    assert.deepEqual(painted.set, accentVars('#FFEE00'));
  });
});

describe('home page host', () => {
  const art = (id: string, harness: string | null, workspace: string | null, root = `/tmp/${id}`): ArtifactView =>
    ({ id, url: `open-artifact://artifact/${id}`, title: id, type: 'slides', root, owner: harness ? { harness, session: 's', workspace, live: true, status: 'idle' } : null }) as unknown as ArtifactView;

  it('reads host_hello with its library filter and artifacts cap', () => {
    const host = homeHostOf({ openArtifact: 'host_hello', caps: { artifacts: true, sessions: true }, harness: 'myagent', library: { harness: 'myagent', workspace: '/w/proj', bad: 1 } }, 'app://host', true)!;
    assert.deepEqual(host, { origin: 'app://host', caps: { sessions: true, artifacts: true }, harness: 'myagent', agentName: null, declared: true, library: { harness: 'myagent', workspace: '/w/proj' } });
  });

  it('lists only the harness and workspace the host asked for', () => {
    const list = [art('a', 'myagent', '/w/proj'), art('b', 'myagent', '/w/other'), art('c', 'codex', '/w/proj'), art('d', 'myagent', null, '/w/proj/deck'), art('e', null, null)];
    assert.deepEqual(forHost(list, null).map((a) => a.id), ['a', 'b', 'c', 'd', 'e']);
    assert.deepEqual(forHost(list, { harness: 'myagent' }).map((a) => a.id), ['a', 'b', 'd']);
    assert.deepEqual(forHost(list, { workspace: '/w/proj/' }).map((a) => a.id), ['a', 'c', 'd']);
    assert.deepEqual(forHost(list, { harness: 'myagent', workspace: '/w/proj' }).map((a) => a.id), ['a', 'd']);
    assert.deepEqual(forHost([art('f', 'myagent', '/w/project')], { workspace: '/w/proj' }), [], 'a sibling folder with the same prefix is not under it');
  });

  it('lists the artifacts made for the workspace\'s project, wherever their folders are', () => {
    // Kept in the Open Artifact folder, with the session that made them gone.
    const made = (id: string, project: string | null): ArtifactView => ({ ...art(id, null, null, `/home/me/OpenArtifact/x/${id}`), project }) as ArtifactView;
    const list = [made('a', '/w/proj'), made('b', '/w/proj/packages/app'), made('c', '/w'), made('d', '/w/project'), made('e', null)];
    assert.deepEqual(forHost(list, { workspace: '/w/proj' }).map((a) => a.id), ['a', 'b', 'c'], 'its own project, a project under it, the project it is a folder of');
    assert.deepEqual(forHost(list, { workspace: '/w/proj/packages/app/' }).map((a) => a.id), ['a', 'b', 'c']);
    assert.deepEqual(forHost(list, { harness: 'myagent', workspace: '/w/proj' }), [], 'the harness is still asked of the owner');
  });
});
