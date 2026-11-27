/**
 * Edits the server won't take however often they are sent (a locked doc, a tab at its size limit) are dropped at once
 * with the server's reason; an undo or redo whose write is lost halts the page and may restore the tab to what it shows.
 */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { DocProject, DocSessionResponse } from '@open-artifact/runtime/doc-api';
import { droppedNotice, rescueWords, TOO_LARGE_WORDS } from '../src/saving/words.ts';
import { type PageNode, docToPage } from '../src/sync/page.ts';
import { type TabSync, onUndoLost } from '../src/sync/tab-sync.ts';
import { getDocs, useDocs } from '../src/app/store.ts';
import { type MarkStore, markKey } from '../src/saving/left-unsaved.ts';
import { watchLeftUnsaved } from '../src/saving/reload-notice.ts';
import { listenForLostUndo, restoreFromPage, useRescue } from '../src/saving/rescue.ts';
import { type DocServer, type Page, startDocServer, texts } from './harness.ts';

function typeAt(page: PageNode, block: number, offset: number, text: string): void {
  const paragraph = page.content![block]!;
  const runs = paragraph.content ?? (paragraph.content = []);
  const run = runs.find(item => item.type === 'text');
  if (!run) {
    runs.push({ type: 'text', text });
    return;
  }
  const chars = [...run.text!];
  run.text = chars.slice(0, offset).join('') + text + chars.slice(offset).join('');
}

describe('edits the server won’t take', () => {
  let doc: DocServer;
  let project: string;

  const lock = (locked: boolean) =>
    doc.action('update', { call: { ref: { object: 'project', id: project }, payload: { kind: 'patch', patch: [locked ? { op: 'set', path: ['locked'] } : { op: 'delete', path: ['locked'] }] } } });
  const statusOf = (page: Page) => {
    const seen: Array<[string, string | undefined]> = [];
    (page.sync as unknown as { events: { status: (status: string, detail?: string) => void } }).events.status = (status, detail) => seen.push([status, detail]);
    return seen;
  };

  before(async () => {
    doc = await startDocServer('# Notes\n\nThe first line.\n\nThe second line.');
    project = (await doc.post<DocSessionResponse>('_api/doc/session', { client: 'probe' })).project.id;
  });

  after(() => doc.stop());

  it('drops what was typed into a locked doc at once, saying it is locked', async () => {
    const told: Array<[string, string | undefined]> = [];
    const a = await doc.open('page-a', { onUnsaved: (words, reason) => told.push([words, reason])});
    const calls: string[] = [];
    const original = (a.sync as unknown as { transport: { call: (request: { opId: string }) => Promise<unknown> } }).transport;
    const call = original.call.bind(original);
    original.call = request => {
      calls.push(request.opId);
      return call(request);
    };
    assert.equal((await lock(true)).ok, true);
    const page = docToPage(a.sync.shadow);
    typeAt(page, 1, 0, 'Locked out ');
    a.sync.editPage(page);
    await doc.settle(a);
    assert.equal(calls.length, 1, 'refused once, not tried again');
    assert.deepEqual(told, [['Locked out', 'locked']]);
    assert.deepEqual(texts(a.sync.shadow), ['Notes', 'The first line.', 'The second line.']);
    assert.deepEqual(await doc.serverTexts(), ['Notes', 'The first line.', 'The second line.']);
    assert.equal((await lock(false)).ok, true);
    const again = docToPage(a.sync.shadow);
    typeAt(again, 1, 0, 'Back ');
    a.sync.editPage(again);
    await doc.settle(a);
    assert.equal((await doc.serverTexts())[1], 'Back The first line.');
    await a.stop();
  });

  it('words the notices does', () => {
    assert.deepEqual(droppedNotice('big', 'doc_too_large'), TOO_LARGE_WORDS);
    assert.equal(TOO_LARGE_WORDS.title, 'That change is over a size limit, so it wasn’t saved.');
    assert.equal(TOO_LARGE_WORDS.description, 'This document is at its size limit; remove something before adding more.');
    assert.match(droppedNotice('', 'locked').description, /^This document is locked; nobody can edit it until an owner unlocks it\.$/);
    assert.match(droppedNotice('hi').description, /^“hi” couldn’t be saved: the text it went into had changed\.$/);
    assert.equal(rescueWords('asking', true).title, 'Some text isn’t saved');
    assert.equal(rescueWords('restored', true).body, 'Your text is saved again. Reload the page to keep editing.');
    assert.match(rescueWords('refused', true).body, /wasn’t changed\. .* To try again, use “Restore the document…” at the top of the page\.$/);
    assert.doesNotMatch(rescueWords('refused', false).body, /To try again/);
    assert.match(rescueWords('changed_since', true).body, /^Something changed while you were deciding/);
  });

  describe('an undo whose write is lost', () => {
    /** Page A brings back text into a paragraph page B has deleted meanwhile, by an undo: A halts. */
    async function halted(): Promise<{ a: Page; b: Page; shown: string[]; statuses: Array<[string, string | undefined]> }> {
      await doc.action('update', { call: { ref: { object: 'node', id: doc.tab }, payload: { ops: [{ op: 'insert', target: { kind: 'root' }, side: 'end', with: { as: 'markdown', from: { kind: 'inline', content: 'Keep this line.' } } }] } } });
      const a = await doc.open('page-a', { frames: false });
      const b = await doc.open('page-b');
      const statuses = statusOf(a);
      const bPage = docToPage(b.sync.shadow);
      bPage.content!.splice(bPage.content!.length - 1, 1);
      b.sync.editPage(bPage);
      await doc.settle(b);
      const aPage = docToPage(a.sync.shadow);
      typeAt(aPage, aPage.content!.length - 1, 0, 'Undone: ');
      a.sync.editPage(aPage, { undo: true });
      await doc.settle(a);
      return { a, b, shown: texts(a.sync.shadow), statuses };
    }

    it('halts the page, keeping what it shows, and restores the tab to it', async () => {
      const heard: TabSync[] = [];
      const forget = onUndoLost(sync => heard.push(sync));
      const { a, b, shown, statuses } = await halted();
      forget();
      assert.equal(heard[0], a.sync);
      assert.equal(a.sync.needsRescue, true);
      assert.deepEqual(statuses.at(-1), ['stopped', 'reseat_failed']);
      assert.equal(shown.at(-1), 'Undone: Keep this line.');
      assert.notEqual((await doc.serverTexts()).at(-1), 'Undone: Keep this line.');

      assert.equal(await a.sync.rescue(), 'restored');
      assert.equal(a.sync.needsRescue, false);
      assert.deepEqual(await doc.serverTexts(), shown);
      await doc.settle(b);
      assert.deepEqual(texts(b.sync.shadow), shown);
      await Promise.all([a.stop(), b.stop()]);
    });

    it('leaves a mark for the next load of the tab while it is halted, and lets it go once restored', async () => {
      const kept = new Map<string, string>();
      const marks: MarkStore = {
        get length() {
          return kept.size;
        },
        key: index => [...kept.keys()][index] ?? null,
        getItem: key => kept.get(key) ?? null,
        setItem: (key, value) => void kept.set(key, value),
        removeItem: key => void kept.delete(key),
      };
      const project = getDocs().project;
      useDocs.setState({ project: { id: 'doc-1' } as DocProject });
      const stopRescue = listenForLostUndo();
      const stopWatch = watchLeftUnsaved({ marks: () => marks, now: () => 1000, waitMs: 60_000 });
      try {
        const { a, b } = await halted();
        assert.equal(kept.get(markKey('doc-1', a.sync.tab)), '1000');
        assert.equal(await restoreFromPage(), 'restored');
        assert.equal(kept.has(markKey('doc-1', a.sync.tab)), false);
        await Promise.all([a.stop(), b.stop()]);
      } finally {
        stopWatch();
        stopRescue();
        useRescue.setState({ sync: null, state: 'asking' });
        useDocs.setState({ project });
      }
    });

    it('is not restored when the tab changed since', async () => {
      const { a, b } = await halted();
      const bPage = docToPage(b.sync.shadow);
      typeAt(bPage, 0, 0, 'Meanwhile ');
      b.sync.editPage(bPage);
      await doc.settle(b);
      const before = await doc.serverTexts();
      assert.equal(await a.sync.rescue(), 'changed_since');
      assert.deepEqual(await doc.serverTexts(), before);
      assert.equal(a.sync.needsRescue, true);
      await Promise.all([a.stop(), b.stop()]);
    });

    it('is refused, the tab unchanged, while the doc is locked', async () => {
      const { a, b } = await halted();
      const before = await doc.serverTexts();
      assert.equal((await lock(true)).ok, true);
      assert.equal(await a.sync.rescue(), 'refused');
      assert.deepEqual(await doc.serverTexts(), before);
      assert.equal((await lock(false)).ok, true);
      await Promise.all([a.stop(), b.stop()]);
    });

    it('says the restore may not have landed when the server can’t be reached', async () => {
      const { a, b } = await halted();
      (a.sync as unknown as { transport: { call: () => Promise<never> } }).transport.call = () => Promise.reject(new TypeError('fetch failed'));
      assert.equal(await a.sync.rescue(), 'not_seen');
      await Promise.all([a.stop(), b.stop()]);
    });
  });
});
