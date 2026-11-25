// A page's open tabs share one writing session (GitHub issue #25): each tab's sync must name its calls apart from the
// others', or the server answers a second tab's first writes as replays of the first tab's and lands none of them.
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { DocCallAnswer } from '@open-artifact/runtime/doc-api';
import { docToPage } from '../src/sync/page.ts';
import type { DocTransport } from '../src/sync/tab-sync.ts';
import { type DocServer, type Page, startDocServer, texts } from './harness.ts';

/** Adds `text` at the end of the tab's last paragraph and hands the page to the sync. */
function typeAtEnd(page: Page, text: string): void {
  const node = docToPage(page.sync.shadow);
  const last = node.content!.at(-1)!;
  (last.content ??= []).push({ type: 'text', text });
  page.sync.editPage(node);
}

describe('the tabs of one page', () => {
  let doc: DocServer;
  const opIds: string[] = [];
  const answers: Array<DocCallAnswer & { replayed?: boolean }> = [];
  const watch = (base: DocTransport): DocTransport => ({
    ...base,
    call: async request => {
      opIds.push(request.opId);
      const answer = await base.call(request);
      answers.push(answer);
      return answer;
    },
  });

  before(async () => {
    doc = await startDocServer('Alpha', ['Bravo']);
  });

  after(() => doc.stop());

  it('land the second tab’s first writes after writes in the first tab, under opIds of their own', async () => {
    const [first, second] = doc.tabs;
    const a = await doc.open('page', { tab: first!.tab, transport: watch });
    for (const key of ['1', '2', '3']) {
      typeAtEnd(a, key);
      await doc.settle(a);
    }
    const b = await doc.open('page', { tab: second!.tab, alongside: a, transport: watch });
    assert.equal(b.session, a.session);
    for (const key of ['x', 'y', 'z']) {
      typeAtEnd(b, key);
      await doc.settle(a, b);
    }

    assert.deepEqual(await doc.textsOf(first!.tab), ['Alpha123']);
    assert.deepEqual(await doc.textsOf(second!.tab), ['Bravoxyz']);
    assert.deepEqual(texts(b.sync.shadow), ['Bravoxyz']);
    assert.equal(new Set(opIds).size, opIds.length, `every call has an opId of its own: ${opIds.join(' ')}`);
    assert.ok(opIds.length >= 6, opIds.join(' '));
    assert.ok(answers.every(answer => answer.verdict === 'allow' && !answer.replayed), JSON.stringify(answers));
    await Promise.all([b.stop(), a.stop()]);
  });

  it('a tab opened again under the same session does not reuse its earlier sync’s opIds', async () => {
    const [first, second] = doc.tabs;
    opIds.length = 0;
    const a = await doc.open('again', { tab: first!.tab, transport: watch });
    const once = await doc.open('again', { tab: second!.tab, alongside: a, transport: watch });
    typeAtEnd(once, '!');
    await doc.settle(a, once);
    await once.stop();
    const twice = await doc.open('again', { tab: second!.tab, alongside: a, transport: watch });
    typeAtEnd(twice, '?');
    await doc.settle(a, twice);
    assert.deepEqual(await doc.textsOf(second!.tab), ['Bravoxyz!?']);
    assert.equal(new Set(opIds).size, opIds.length, opIds.join(' '));
    await Promise.all([twice.stop(), a.stop()]);
  });
});
