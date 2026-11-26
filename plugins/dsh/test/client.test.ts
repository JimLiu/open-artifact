/**
 * The browser half's pure parts: the chat cards' reading of a wake message, the Shell views, and the plugin's own words
 * (the page's are `@open-artifact/library-page`'s).
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { WAKE_SOURCE_KIND } from '@open-artifact/protocol';
import { cardData, isShellMessage, isWakeEvent, selectionOf, threadUrl } from '../src/client/cards.ts';
import { MAX_VIEWS, ShellViews } from '../src/client/host-open.ts';
import { promptFor } from '../src/client/page-host.ts';
import { dshEn, dshTranslator, dshZh, en, zh } from '../src/client/words.ts';

describe('cards', () => {
  const event = {
    type: 'user/message',
    seq: 3,
    surfaceOp: 'append',
    data: {
      source: {
        kind: WAKE_SOURCE_KIND,
        title: 'Landing page',
        artifactId: 'a1',
        viewUrl: 'http://127.0.0.1:4100/a/a1/',
        threads: [{ id: 't1', where: 'Hero', text: 'Bigger' }, { where: 'no id' }],
        requests: [{ id: 'r1', label: 'Fix', text: 'Fix it' }, { id: 'r2', label: 'Empty' }],
      },
    },
  };

  it('claims only wake messages as they are added', () => {
    assert.equal(isWakeEvent(event), true);
    assert.equal(isWakeEvent({ ...event, surfaceOp: 'replace' }), false);
    assert.equal(isWakeEvent({ ...event, data: { source: { kind: 'other' } } }), false);
  });

  it('reads the threads and requests that can be drawn', () => {
    const data = cardData(event);
    assert.equal(data.title, 'Landing page');
    assert.deepEqual(data.threads, [{ id: 't1', where: 'Hero', text: 'Bigger' }]);
    assert.deepEqual(data.requests, [{ id: 'r1', label: 'Fix', text: 'Fix it', selection: null }]);
    assert.equal(data.seq, 3);
    assert.equal(typeof isShellMessage(data.requests[0]!), 'boolean');
  });

  it("says who sent it when it is not the owner, and reads a task's result", () => {
    assert.equal(cardData(event).from, null);
    assert.equal(cardData(event).task, null);
    const from = cardData({ ...event, data: { source: { ...event.data!.source, from: { kind: 'collaborator', name: 'Ana', role: 'commenter' } } } });
    assert.deepEqual(from.from, { name: 'Ana', role: 'commenter' });
    assert.equal(cardData({ ...event, data: { source: { from: { kind: 'owner' } } } }).from, null);
    const task = cardData({ ...event, data: { source: { title: 'Deck', from: { kind: 'system' }, task: { id: 'k1', action: 'export', ok: false } } } });
    assert.deepEqual(task.task, { action: 'export', ok: false });
    assert.deepEqual(task.threads, []);
  });

  describe("a request's words and selection (wake.request.parts)", () => {
    const agentText = 'Change this title to "Results"\n\n<<<UNTRUSTED-DATA-1f2e>>>\nSelected: Title (text) on Slide 2\n<<<END-UNTRUSTED-DATA-1f2e>>>';
    const snapshot = {
      kind: 'elements',
      label: '3 selected elements',
      count: 3,
      items: [{ id: 'title', kind: 'text', label: 'Q3 results' }, { id: 'logo' }, null],
      where: 'Slide 2 of 8',
    };
    const wake = (from: unknown, requests: unknown[]) => ({ ...event, data: { source: { ...event.data!.source, from, requests } } });
    const request = { id: 'r1', label: 'Send to agent', text: agentText, userText: 'Change this title to "Results"', selectionSnapshot: snapshot };

    it("shows the owner's own words, not the request as the agent reads it, with a chip of the selection", () => {
      const [card] = cardData(wake({ kind: 'owner' }, [request])).requests;
      assert.equal(card!.text, 'Change this title to "Results"');
      assert.ok(!card!.text.includes('UNTRUSTED-DATA'));
      assert.deepEqual(card!.selection, { label: '3 selected elements', where: 'Slide 2 of 8', items: ['Q3 results · text', 'logo'], more: 1, text: '' });
    });

    it("never shows a collaborator's userText as words: their card shows the request's text", () => {
      const [card] = cardData(wake({ kind: 'collaborator', name: 'Ana', role: 'editor' }, [request])).requests;
      assert.equal(card!.text, agentText);
      assert.equal(card!.selection?.label, '3 selected elements', 'the chip is drawn either way');
      // A wake that says nothing of who sent it is not taken as the owner's either.
      assert.equal(cardData(wake(undefined, [request])).requests[0]!.text, agentText);
    });

    it('falls back to the text without words, and draws no chip for a snapshot without a label', () => {
      const requests = [
        { id: 'r1', label: 'Fix', text: 'Fix the errors' },
        { id: 'r2', label: 'Send', text: 'x\n\n<selected/>', userText: '   ', selectionSnapshot: { kind: 'elements', count: 2 } },
        { id: 'ask_1', text: 'Hello\nthere', userText: 'Hello\nthere' },
        { id: 'r3', label: 'Text', text: 'Tighten', userText: 'Tighten', selectionSnapshot: { kind: 'text', label: 'Selected text', count: 1, text: 'A long\nparagraph' } },
        'not a request',
      ];
      const cards = cardData(wake({ kind: 'owner' }, requests)).requests;
      assert.deepEqual(
        cards.map((card) => [card.id, card.text, card.selection]),
        [
          ['r1', 'Fix the errors', null],
          ['r2', 'x\n\n<selected/>', null],
          ['ask_1', 'Hello\nthere', null],
          ['r3', 'Tighten', { label: 'Selected text', where: '', items: [], more: 0, text: 'A long\nparagraph' }],
        ],
      );
      assert.equal(isShellMessage(cards[2]!), true);
    });

    it('reads a snapshot without a usable count by its items', () => {
      assert.deepEqual(selectionOf({ label: 'Cells', count: 'many', items: [{ id: 'B2' }] }), { label: 'Cells', where: '', items: ['B2'], more: 0, text: '' });
      assert.equal(selectionOf(null), null);
      assert.equal(selectionOf('3 selected'), null);
    });
  });

  it('links a thread by its comment', () => {
    assert.equal(threadUrl('http://127.0.0.1:4100/a/a1/?x=1', 't1'), 'http://127.0.0.1:4100/a/a1/?x=1&comment=t1');
    assert.equal(threadUrl('not a url', 't1'), 'not a url');
  });
});

describe('ShellViews', () => {
  const request = (view: string) => ({ id: `r-${view}`, session: 's1', url: `http://127.0.0.1:4100/a/a1/?oa_view=${view}`, title: 'Deck', view, agentName: 'DSH' });

  it("answers a view's Shell through the route and turns what it says into the app's calls", async () => {
    const sent: Array<[string, unknown]> = [];
    const calls: unknown[][] = [];
    const ctx = {
      get: (name: string) =>
        name === 'uiWorkspace'
          ? { openSession: (id: string) => calls.push(['open', id]), startSession: (...args: unknown[]) => calls.push(['start', ...args]) }
          : undefined,
    };
    const views = new ShellViews(ctx as never, async (view, command) => void sent.push([view, command]));
    views.add(request('v1'));
    views.add(request('v1'));
    assert.equal(views.size, 1);
    // The host's answer goes out at once: the Shell may have said hello before the tab was there.
    assert.equal(sent.length, 1);
    assert.equal(sent[0]![0], 'v1');
    assert.equal((sent[0]![1] as { openArtifact: string }).openArtifact, 'host_hello');
    assert.deepEqual((sent[0]![1] as { caps: unknown }).caps, { sessions: true, toolbar: true });
    assert.equal((sent[0]![1] as { agentName: string }).agentName, 'DSH');

    views.event({ view: 'v1', session: 's1', event: { openArtifact: 'new_session', prompt: 'Tighten it', artifact: 'open-artifact://artifact/a1' } as never });
    views.event({ view: 'v1', session: 's1', event: { openArtifact: 'open_session', session: null, harness: 'dsh' } as never });
    views.event({ view: 'v1', session: 's1', event: { openArtifact: 'comment_summon', text: 'Bigger' } as never });
    // Another view's messages are not this one's.
    views.event({ view: 'v2', session: 's1', event: { openArtifact: 'new_session', prompt: 'x', artifact: 'open-artifact://artifact/a1' } as never });
    assert.deepEqual(calls, [
      ['start', undefined, { prompt: 'Tighten it', whenDraftExists: 'append' }],
      ['open', 's1'],
      ['open', 's1'],
    ]);
  });

  it('keeps at most MAX_VIEWS views, letting the oldest go', () => {
    const views = new ShellViews({ get: () => undefined } as never, async () => undefined);
    for (let i = 0; i <= MAX_VIEWS; i++) views.add(request(`v${i}`));
    assert.equal(views.size, MAX_VIEWS);
    views.clear();
    assert.equal(views.size, 0);
  });
});

describe('words', () => {
  it("has every key of the plugin's own in both languages, registered with the page's", () => {
    assert.deepEqual(Object.keys(dshEn).sort(), Object.keys(dshZh).sort());
    for (const [key, text] of Object.entries(dshEn)) assert.ok(text.length > 0, key);
    assert.deepEqual(Object.keys(en).sort(), Object.keys(zh).sort());
    assert.ok(en['card.comment'] && en['card.opening'] && en.panel);
  });

  it('falls back to English when the host has no words for a key, and fills placeholders', () => {
    const t = dshTranslator((key) => (key === 'card.view' ? '查看' : key));
    assert.equal(t('card.view'), '查看');
    assert.equal(t('card.more'), dshEn['card.more']);
    assert.equal(dshTranslator(undefined)('prompt.generic', { type: 'Design' }), dshEn['prompt.generic'].replace('{type}', 'Design'));
  });

  it("starts a new session's input with the skill word, the type and its sentence", () => {
    const t = dshTranslator(undefined);
    assert.ok(dshEn['prompt.motion'] && dshZh['prompt.motion']);
    assert.equal(promptFor('motion', 'Motion', t), `/open-artifact motion ${dshEn['prompt.motion']}`);
    assert.equal(promptFor('poster', 'Poster', t), `/open-artifact poster ${dshEn['prompt.generic'].replace('{type}', 'Poster')}`);
  });
});
