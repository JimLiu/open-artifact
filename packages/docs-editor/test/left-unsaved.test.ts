import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { DocProject } from '@open-artifact/runtime/doc-api';
import { getDocs, useDocs } from '../src/app/store.ts';
import { LEFT_UNSAVED_MAX_AGE_MS, type MarkStore, clearLeft, markKey, markLeft, wasLeft } from '../src/saving/left-unsaved.ts';
import { dismissReloadNotice, useReloadNotice, watchLeftUnsaved } from '../src/saving/reload-notice.ts';

/** A session storage in memory. */
function memory(): MarkStore & { keys(): string[] } {
  const items = new Map<string, string>();
  return {
    get length() {
      return items.size;
    },
    key: index => [...items.keys()][index] ?? null,
    getItem: key => items.get(key) ?? null,
    setItem: (key, value) => void items.set(key, String(value)),
    removeItem: key => void items.delete(key),
    keys: () => [...items.keys()],
  };
}

describe('marks of edits left unsaved', () => {
  const now = Date.UTC(2031, 5, 1, 12);

  it('marks a doc and tab, finds the mark for that tab only, and clears it', () => {
    const store = memory();
    markLeft(store, 'doc-1', 'tab-a', now);
    assert.equal(wasLeft(store, 'doc-1', 'tab-a', now + 1000), true);
    assert.equal(wasLeft(store, 'doc-1', 'tab-b', now + 1000), false);
    assert.equal(wasLeft(store, 'doc-2', 'tab-a', now + 1000), false);
    clearLeft(store, 'doc-1', 'tab-a');
    assert.equal(wasLeft(store, 'doc-1', 'tab-a', now + 1000), false);
  });

  it('lets go of marks older than an hour, and of unreadable ones, and leaves other keys alone', () => {
    const store = memory();
    markLeft(store, 'doc-1', 'old', now - LEFT_UNSAVED_MAX_AGE_MS - 1);
    markLeft(store, 'doc-1', 'new', now - 1000);
    store.setItem(markKey('doc-1', 'junk'), 'not a time');
    store.setItem('something.else', '1');
    assert.equal(wasLeft(store, 'doc-1', 'old', now), false);
    assert.deepEqual(store.keys().sort(), [markKey('doc-1', 'new'), 'something.else'].sort());
    assert.equal(wasLeft(store, 'doc-1', 'new', now), true);
  });

  it('keeps quiet without storage, or with storage that throws', () => {
    assert.equal(wasLeft(null, 'doc-1', 'tab-a', now), false);
    const refusing: MarkStore = {
      length: 0,
      key: () => null,
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
      removeItem: () => {
        throw new Error('blocked');
      },
    };
    assert.doesNotThrow(() => markLeft(refusing, 'doc-1', 'tab-a', now));
    assert.doesNotThrow(() => clearLeft(refusing, 'doc-1', 'tab-a'));
    assert.equal(wasLeft(refusing, 'doc-1', 'tab-a', now), false);
  });

  it('owes the next load of a marked tab a notice, shown once the tab is saved and said once', () => {
    const store = memory();
    markLeft(store, 'doc-1', 'tab-a', now);
    const was = getDocs();
    useDocs.setState({ project: { id: 'doc-1' } as DocProject, activeTab: 'tab-a', saving: { 'tab-a': 'saving' } });
    const stop = watchLeftUnsaved({ marks: () => store, now: () => now + 1000, waitMs: 60_000 });
    try {
      assert.deepEqual(useReloadNotice.getState(), { tab: 'tab-a', shown: false });
      useDocs.setState({ saving: { 'tab-a': 'saved' } });
      assert.deepEqual(useReloadNotice.getState(), { tab: 'tab-a', shown: true });
      assert.equal(wasLeft(store, 'doc-1', 'tab-a', now + 2000), false, 'the mark goes once the notice is shown');
      dismissReloadNotice();
      assert.deepEqual(useReloadNotice.getState(), { tab: null, shown: false });
    } finally {
      stop();
      dismissReloadNotice();
      useDocs.setState({ project: was.project, activeTab: was.activeTab, saving: was.saving });
    }
  });
});
