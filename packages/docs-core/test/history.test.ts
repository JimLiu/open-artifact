import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { type DocState, type HistoryIndex, type Writer, recordWrite, startedBlank } from '../src/index.ts';

const blank: DocState = { rev: 1, blocks: [{ id: 'p1', type: 'paragraph' }] } as DocState;
const written = (rev: number, text: string): DocState => ({ rev, blocks: [{ id: `p${rev}`, type: 'paragraph', inline: [{ text }] }] }) as unknown as DocState;
const agent = (call: string): Writer => ({ by: 'agent', user: 'me@example.com', sess: 'cli', call });
const at = (minute: number) => new Date(Date.UTC(2031, 5, 1, 12, minute));

describe('startedBlank', () => {
  it('is true for a tab whose history began with a write to its blank first rev', () => {
    let index: HistoryIndex | null = null;
    index = recordWrite(index, blank, at(0).toISOString(), written(2, 'One'), agent('a'), at(1)).index;
    assert.equal(startedBlank(index), true);
    index = recordWrite(index, written(2, 'One'), at(1).toISOString(), written(3, 'Two'), agent('b'), at(2)).index;
    assert.equal(startedBlank(index), true);
    assert.deepEqual(index.versions.map(version => [version.n, version.rev]), [[1, 2], [2, 3]]);
  });

  it('is false with no history, after content the tab held before its history, and once the first version is dropped', () => {
    assert.equal(startedBlank(null), false);
    assert.equal(startedBlank({ next: 1, versions: [] }), false);
    const held = recordWrite(null, written(1, 'Imported'), at(0).toISOString(), written(2, 'More'), agent('a'), at(1)).index;
    assert.equal(held.versions[0]!.by, 'system');
    assert.equal(startedBlank(held), false);
    const trimmed: HistoryIndex = { next: 9, versions: [{ n: 4, rev: 7, first: '', at: '', by: 'agent', user: 'me@example.com' }] };
    assert.equal(startedBlank(trimmed), false);
  });
});
