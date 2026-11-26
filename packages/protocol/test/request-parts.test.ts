/**
 * What the person typed and selected on a request (`wake.request.parts`): `userText` is kept only when `text` starts
 * with it, a snapshot is shaped and clamped to its limits, and `wakeMessage` puts both on `source.requests[]` without
 * changing the agent's text.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SELECTION_SNAPSHOT_LIMITS, normalizeSelectionSnapshot, normalizeUserText, wakeMessage, withRequestParts } from '../src/index.ts';

const bytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value), 'utf8');

test('userText: kept, line breaks and all, only when text starts with it', () => {
  assert.equal(normalizeUserText('Warmer\nplease', 'Warmer\nplease\n\n<selected>…</selected>'), 'Warmer\nplease');
  assert.equal(normalizeUserText('  Warmer  ', '\n Warmer and bigger'), 'Warmer', 'trimmed, and text’s leading spaces ignored');
  assert.equal(normalizeUserText('Warmer', 'The page says: Warmer'), undefined, 'inside text, not at its start');
  assert.equal(normalizeUserText('Cooler', 'Warmer'), undefined);
  assert.equal(normalizeUserText('   ', 'x'), undefined);
  assert.equal(normalizeUserText(42, '42'), undefined);
  assert.equal(normalizeUserText('Hi\u0000there', 'Hithere'), 'Hithere', 'control characters are taken out first');
});

test('selectionSnapshot: needs kind, label and a count of at least 1', () => {
  assert.equal(normalizeSelectionSnapshot(null), undefined);
  assert.equal(normalizeSelectionSnapshot({ kind: 'elements', label: 'x', count: 0 }), undefined);
  assert.equal(normalizeSelectionSnapshot({ kind: '', label: 'x', count: 1 }), undefined);
  assert.equal(normalizeSelectionSnapshot({ kind: 'elements', label: '', count: 1 }), undefined);
  assert.deepEqual(
    normalizeSelectionSnapshot({ kind: 'elements', label: '2 selected elements', count: 2, items: [{ id: 'a', kind: 'text', label: 'Hi', extra: 1 }, { id: '' }, 'no'], where: 'Page "Home"', other: true }),
    { kind: 'elements', label: '2 selected elements', count: 2, items: [{ id: 'a', kind: 'text', label: 'Hi' }], where: 'Page "Home"' },
  );
});

test('selectionSnapshot: each field clamped, and the whole within 4096 bytes (text goes first, then items)', () => {
  const long = (n: number) => 'é'.repeat(n);
  const items = Array.from({ length: 40 }, (_, i) => ({ id: `id-${i}-${'x'.repeat(200)}`, kind: long(80), label: long(200) }));
  const snapshot = normalizeSelectionSnapshot({ kind: long(100), label: long(500), count: 40, items, where: long(500), text: long(5000) })!;
  assert.ok(snapshot.kind.length <= SELECTION_SNAPSHOT_LIMITS.kind);
  assert.ok(snapshot.label.length <= SELECTION_SNAPSHOT_LIMITS.label);
  assert.ok((snapshot.where ?? '').length <= SELECTION_SNAPSHOT_LIMITS.where);
  assert.ok((snapshot.items ?? []).length <= SELECTION_SNAPSHOT_LIMITS.items);
  for (const item of snapshot.items ?? []) {
    assert.ok(item.id.length <= SELECTION_SNAPSHOT_LIMITS.itemId);
    assert.ok((item.label ?? '').length <= SELECTION_SNAPSHOT_LIMITS.itemLabel);
  }
  assert.equal(snapshot.count, 40, 'count still says how many');
  assert.ok(bytes(snapshot) <= SELECTION_SNAPSHOT_LIMITS.bytes, `${bytes(snapshot)} bytes`);
  assert.equal(snapshot.text, undefined, 'the text is the first thing left out');
});

test('withRequestParts: keeps what holds and drops what does not', () => {
  assert.deepEqual(withRequestParts({ id: 'r', text: 'Hi\n\nmore', userText: 'Hi', selectionSnapshot: { kind: 'cells', label: 'A1:B2', count: 1 } }), {
    id: 'r',
    text: 'Hi\n\nmore',
    userText: 'Hi',
    selectionSnapshot: { kind: 'cells', label: 'A1:B2', count: 1 },
  });
  assert.deepEqual(withRequestParts({ id: 'r', text: 'Hi', userText: 'Bye', selectionSnapshot: 'no' }), { id: 'r', text: 'Hi' });
});

test('wakeMessage: both parts on source.requests, the agent’s text the same with or without them', () => {
  const artifact = { id: 'art_0abcdefghi1234', title: 'Deck', root: '/w/deck' };
  const snapshot = { kind: 'slides', label: '2 selected slides', count: 2, items: [{ id: 's1' }, { id: 's2' }] };
  const parts = wakeMessage(
    artifact,
    [],
    [
      { id: 'r1', label: 'Send to agent', text: 'Swap them\nplease', userText: 'Swap them\nplease', selectionSnapshot: snapshot },
      { id: 'r2', text: 'Fix the errors' },
    ],
    { viewUrl: 'v' },
  );
  const plain = wakeMessage(artifact, [], [{ id: 'r1', label: 'Send to agent', text: 'Swap them\nplease' }, { id: 'r2', text: 'Fix the errors' }], { viewUrl: 'v' });
  assert.equal(parts.text, plain.text);
  assert.deepEqual(parts.source.requests[0], { id: 'r1', label: 'Send to agent', text: 'Swap them\nplease', userText: 'Swap them\nplease', selectionSnapshot: snapshot });
  assert.deepEqual(Object.keys(parts.source.requests[1]!).sort(), ['id', 'label', 'text']);
});
