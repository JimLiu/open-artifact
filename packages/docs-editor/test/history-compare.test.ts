import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Block, DocState, Inline, Marks } from '@open-artifact/docs-core';
import type { DocSuggestion, DocVersion } from '@open-artifact/runtime/doc-api';
import { type Comparison, attrsSummary, compareVersions, diffSequences, hasChanges, marksSummary, shortLink, stepChange, textSummary } from '../src/history/compare.ts';
import { againstLabel, changesLabel, compareStatus, compareTarget, isFirstSaved } from '../src/history/compare-target.ts';
import { previewDocOf } from '../src/history/preview-doc.ts';
import { afterCopy, copyMembers, copyName, safeTabName } from '../src/history/copy.ts';
import { learnNames } from '../src/app/people.ts';
import { discardSentence, restoreNote } from '../src/history/restore-note.ts';
import type { Preview } from '../src/history/store.ts';

let next = 0;
const chars = (text: string, sess = 'a', marks?: Marks): Inline[] => Array.from(text).map(ch => ({ id: `${sess}.${++next}`, ch, ...(marks ? { marks } : {}) }));
const para = (id: string, text: string | Inline[], attrs?: Record<string, unknown>): Block => ({ id, type: 'paragraph', ...(attrs ? { attrs } : {}), inline: typeof text === 'string' ? chars(text) : text });
const doc = (...blocks: Block[]): DocState => ({ rev: 1, blocks });

const BLOCK_SIGN = { ins: '+ ', del: '- ', chg: '* ', move: '> ', moved: '~ ', fmt: '' } as const;
const INLINE_SIGN = { ins: '+', del: '-', fmt: '=' } as const;

/** The compared doc as text: added words in [+…], dropped ones in [-…], reformatted in [=…], whole blocks prefixed. */
function shown(compared: Comparison): string[] {
  const look = (id: string | undefined) => (id ? compared.parts[id]?.look : undefined);
  const line = (block: Block): string => {
    const own = look(block.suggest?.id);
    const prefix = own ? BLOCK_SIGN[own] : '';
    if (block.children) return prefix + block.children.map(line).join(' | ');
    let out = '';
    let open: string | null = null;
    for (const item of block.inline ?? []) {
      const part = look(item.suggest?.id);
      const sign = part && part in INLINE_SIGN && !(own === 'ins' || own === 'del') ? INLINE_SIGN[part as keyof typeof INLINE_SIGN] : null;
      if (sign !== open) {
        if (open) out += ']';
        if (sign) out += `[${sign}`;
        open = sign;
      }
      out += 'ch' in item ? item.ch : '*';
    }
    if (open) out += ']';
    return prefix + out;
  };
  return compared.blocks.map(line);
}

const summaries = (compared: Comparison) => compared.changes.map(change => `${change.kind}: ${change.summary}`);

describe('comparing versions', () => {
  it('marks the words added and dropped inside a kept block, as one change', () => {
    const compared = compareVersions(doc(para('p1', 'The quick fox')), doc(para('p1', 'The slow brown fox')));
    assert.deepEqual(shown(compared), ['The [-quick][+slow brown] fox']);
    assert.deepEqual(summaries(compared), ['replace: Text replaced']);
  });

  it('compares whole words, and gives each change its own id', () => {
    const compared = compareVersions(doc(para('p1', 'Ship on Friday at noon')), doc(para('p1', 'Ship Monday at noon sharp')));
    assert.deepEqual(shown(compared), ['Ship [-on Friday ][+Monday ]at noon[+ sharp]']);
    assert.deepEqual(summaries(compared), ['replace: Text replaced', 'ins: Text added']);
    const ids = compared.changes.map(change => change.id);
    assert.equal(new Set(ids).size, ids.length);
  });

  it('marks blocks added and dropped, in place, worded by their kind', () => {
    const before = doc(para('p1', 'one'), { id: 'hr', type: 'horizontalRule' }, para('p3', 'three'));
    const after = doc(para('p1', 'one'), para('p3', 'three'), para('p4', 'four', { heading: 2 }));
    const compared = compareVersions(before, after);
    assert.deepEqual(shown(compared), ['one', '- ', 'three', '+ four']);
    assert.deepEqual(summaries(compared), ['del: Divider deleted', 'ins: Heading 2 added']);
  });

  it('reads a paragraph written over whole (new ids) as its changed words', () => {
    const compared = compareVersions(doc(para('p1', 'keep'), para('p2', 'Ship on Friday')), doc(para('p1', 'keep'), para('n9', 'Ship on Monday')));
    assert.deepEqual(shown(compared), ['keep', 'Ship on [-Friday][+Monday]']);
  });

  it('names a table of contents added or dropped', () => {
    const contents: Block = { id: 'toc', type: 'codeBlock', attrs: { language: 'toc' }, inline: [] };
    assert.deepEqual(summaries(compareVersions(doc(para('p1', 'one')), doc(para('p1', 'one'), contents))), ['ins: Table of contents added']);
    assert.deepEqual(summaries(compareVersions(doc(para('p1', 'one'), contents), doc(para('p1', 'one')))), ['del: Table of contents deleted']);
  });

  it('shows an unrelated paragraph put in place of another as one dropped and one added', () => {
    const compared = compareVersions(doc(para('p1', 'keep'), para('p2', 'Budget review')), doc(para('p1', 'keep'), para('n9', 'Lunch at noon')));
    assert.deepEqual(shown(compared), ['keep', '- Budget review', '+ Lunch at noon']);
    assert.deepEqual(summaries(compared), ['del: Paragraph deleted', 'ins: Paragraph added']);
  });

  it('compares inside kept containers', () => {
    const item = (id: string, text: string): Block => ({ id, type: 'listItem', children: [para(`${id}p`, text)] });
    const before = doc({ id: 'l', type: 'list', attrs: { kind: 'bullet' }, children: [item('i1', 'a'), item('i2', 'b')] });
    const after = doc({ id: 'l', type: 'list', attrs: { kind: 'bullet' }, children: [item('i1', 'a'), item('i3', 'c'), item('i2', 'b!')] });
    const compared = compareVersions(before, after);
    assert.deepEqual(shown(compared), ['a | + + c | b[+!]']);
    assert.deepEqual(summaries(compared), ['ins: List item added', 'ins: Text added']);
  });

  it('marks formatting-only changes as formatting, not as words dropped and added', () => {
    const before = doc(para('p1', [...chars('make '), ...chars('this'), ...chars(' bold')]));
    const after = doc(para('p1', [...chars('make '), ...chars('this', 'a', { bold: true }), ...chars(' bold')]));
    const compared = compareVersions(before, after);
    assert.deepEqual(shown(compared), ['make [=this] bold']);
    assert.deepEqual(summaries(compared), ['fmt: Bold added']);
  });

  it('words a block whose kind or settings changed', () => {
    const before = doc(para('p1', 'Title'), { id: 'l', type: 'list', attrs: { kind: 'bullet' }, children: [{ id: 'i', type: 'listItem', children: [para('ip', 'x')] }] });
    const after = doc(para('p1', 'Title', { heading: 1 }), { id: 'l', type: 'list', attrs: { kind: 'ordered' }, children: [{ id: 'i', type: 'listItem', children: [para('ip', 'x')] }] });
    const compared = compareVersions(before, after);
    assert.deepEqual(shown(compared), ['* Title', '* x']);
    assert.deepEqual(summaries(compared), ['chg: Paragraph → Heading 1', 'chg: Bulleted list → Numbered list']);
  });

  it('draws a moved block where it went, with a note where it was, as one change', () => {
    const before = doc(para('a', 'alpha'), para('b', 'beta'), para('c', 'gamma'));
    const after = doc(para('b', 'beta'), para('c', 'gamma'), para('a', 'alpha!'));
    const compared = compareVersions(before, after);
    assert.deepEqual(shown(compared), ['~ Moved ↓', 'beta', 'gamma', '> alpha[+!]']);
    assert.deepEqual(summaries(compared), ['move: Moved; Text added']);
    const [move] = compared.changes;
    assert.ok(Object.values(compared.parts).every(part => part.change === move!.id));
  });

  it('says when nothing changed', () => {
    const blocks = [para('p1', 'same')];
    assert.equal(hasChanges(compareVersions(doc(...blocks), doc(...blocks))), false);
    assert.equal(hasChanges(compareVersions(doc(...blocks), doc(para('p1', 'same!')))), true);
  });

  it('finds the longest common run', () => {
    const ops = diffSequences([...'abcdef'], [...'abxdeyf']).map(step => step.op[0]).join('');
    assert.equal(ops, 'ssdissis');
  });
});

describe('words for changes', () => {
  it('words text and inline items', () => {
    assert.equal(textSummary('ins', chars('hi')), 'Text added');
    assert.equal(textSummary('del', [{ id: 'm', atom: 'mention', attrs: { user: 'x' } }]), 'Mention deleted');
    assert.equal(textSummary('replace', [{ id: 'm', atom: 'media' }, { id: 'n', atom: 'media' }]), 'Image replaced');
    assert.equal(textSummary('ins', [{ id: 'm', atom: 'media' }, { id: 'n', atom: 'date' }]), 'Content added');
  });

  it('words formatting', () => {
    assert.equal(marksSummary(undefined, { bold: true, italic: true }), 'Bold added, Italic added');
    assert.equal(marksSummary({ strike: true }, undefined), 'Strikethrough removed');
    assert.equal(marksSummary(undefined, { highlight: '' }), 'Yellow highlight added');
    assert.equal(marksSummary({ highlight: 'yellow' }, { highlight: 'green' }), 'Highlight yellow → green');
    assert.equal(marksSummary(undefined, { textColor: 'red' }), 'Red text color added');
    assert.equal(marksSummary(undefined, { link: 'https://example.com/a?b=1' }), 'Link added: https://example.com/a');
    assert.equal(marksSummary({ link: 'https://a.com' }, { link: 'https://b.com' }), 'Link changed: https://a.com → https://b.com');
    assert.equal(marksSummary({ bold: true }, { bold: true }), null);
    assert.equal(shortLink('mailto:me@example.com'), 'mailto:me@example.com');
  });

  it('words block settings', () => {
    assert.equal(attrsSummary({ type: 'codeBlock' }, { type: 'codeBlock', attrs: { language: 'js' } }), 'Code language: plain → js');
    assert.equal(attrsSummary({ type: 'codeBlock', attrs: { language: 'js' } }, { type: 'codeBlock', attrs: { language: 'toc' } }), 'Code block → Table of contents');
    assert.equal(attrsSummary({ type: 'codeBlock', attrs: { language: 'toc' } }, { type: 'codeBlock' }), 'Table of contents → Code block');
    assert.equal(attrsSummary({ type: 'listItem', attrs: { checked: false } }, { type: 'listItem', attrs: { checked: true } }), 'Checked');
    assert.equal(attrsSummary({ type: 'cell', attrs: { colspan: 1 } }, { type: 'cell', attrs: { colspan: 2, header: true } }), 'Made header cell; Merged cells');
    assert.equal(attrsSummary({ type: 'embed', attrs: { src: 'a' } }, { type: 'embed', attrs: { src: 'b' } }), 'Embed changed');
    assert.equal(attrsSummary({ type: 'paragraph', attrs: {} }, { type: 'paragraph' }), null);
  });
});

describe('stepping through changes', () => {
  it('goes to the first change first, and wraps at either end', () => {
    assert.equal(stepChange(-1, 3, 1), 0);
    assert.equal(stepChange(2, 3, 1), 0);
    assert.equal(stepChange(-1, 3, -1), 2);
    assert.equal(stepChange(0, 3, -1), 2);
    assert.equal(stepChange(1, 3, -1), 0);
    assert.equal(stepChange(-1, 0, 1), -1);
  });

  it('counts the changes since or in the version', () => {
    assert.equal(changesLabel(1, 'previous'), '1 change in this version');
    assert.equal(changesLabel(4, 'current'), '4 changes since this version');
    assert.equal(changesLabel(2, 'restored'), '2 changes in this version');
  });
});

describe('what a preview is compared with', () => {
  const versions: DocVersion[] = [
    { rev: 9, by: 'human', user: 'u', at: '2026-11-18T10:00:00Z' },
    { rev: 7, by: 'human', user: 'u', at: '2026-11-18T09:00:00Z', restoredFrom: 3 },
    { rev: 5, by: 'agent', at: '2026-11-18T08:00:00Z' },
  ];
  const preview = (rev: number, base: number | null, current = false): Preview => ({ tab: 't', rev, base, at: '', current, count: 1, row: `r${rev}` });

  it('compares with the previous version, the current one, or the version a restore brought back', () => {
    assert.deepEqual(compareTarget(preview(5, null), versions, 'previous', 'previous'), { against: 'previous', before: null, after: 5, restore: false, restoredFrom: null, firstSaved: false });
    assert.deepEqual(compareTarget(preview(5, null), versions, 'current', 'previous'), { against: 'current', before: 5, after: 9, restore: false, restoredFrom: null, firstSaved: false });
    assert.deepEqual(compareTarget(preview(7, 5), versions, 'current', 'restored'), { against: 'restored', before: 3, after: 7, restore: true, restoredFrom: 3, firstSaved: false });
    assert.equal(compareTarget(preview(9, 7, true), versions, 'current', 'previous').against, 'previous');
  });

  it('says where the comparison stands', () => {
    const target = compareTarget(preview(7, 5), versions, 'previous', 'restored');
    assert.equal(compareStatus(target, { kind: 'shown', count: 0 }), 'Identical to the restored version');
    assert.equal(compareStatus(compareTarget(preview(5, 3), versions, 'current', 'previous'), { kind: 'shown', count: 0 }), 'Identical to the current version');
    assert.equal(compareStatus(compareTarget(preview(5, 3), versions, 'previous', 'previous'), { kind: 'shown', count: 0 }), 'No changes');
    assert.equal(compareStatus(target, { kind: 'none' }), 'Nothing earlier to compare');
    assert.equal(compareStatus(target, { kind: 'failed' }), 'Couldn’t compare');
    assert.equal(compareStatus(compareTarget(preview(7, 5), versions, 'previous', 'previous'), { kind: 'shown', count: 2 }), 'Compared with the version before the restore');
    assert.equal(compareStatus(target, { kind: 'off' }), null);
  });

  it('compares the oldest version of a tab that started blank with the tab as first saved', () => {
    const oldest = compareTarget(preview(5, 1), versions, 'previous', 'previous');
    assert.deepEqual(oldest, { against: 'previous', before: 1, after: 5, restore: false, restoredFrom: null, firstSaved: true });
    assert.equal(compareStatus(oldest, { kind: 'shown', count: 2 }), 'Compared with the tab as first saved');
    assert.equal(compareStatus(oldest, { kind: 'shown', count: 0 }), 'No changes');
    assert.equal(againstLabel(oldest), 'vs first saved version');
    assert.equal(againstLabel(compareTarget(preview(5, 1), versions, 'current', 'previous')), 'vs current version');
    // A version kept at rev 1 is an ordinary previous version.
    const kept: DocVersion[] = [...versions, { rev: 1, by: 'system', at: '2026-11-18T07:00:00Z' }];
    assert.equal(compareTarget(preview(5, 1), kept, 'previous', 'previous').firstSaved, false);
    assert.equal(isFirstSaved(versions, 1), true);
    assert.equal(isFirstSaved(kept, 1), false);
    assert.equal(isFirstSaved(versions, 5), false);
  });
});

describe('drawing a compared version', () => {
  it('turns the change marks into ranges with their change ids, and leaves no suggestion behind', () => {
    const compared = compareVersions(doc(para('p1', 'The quick fox'), para('p2', 'gone')), doc(para('p1', 'The slow fox')));
    const { doc: drawn, changes } = previewDocOf(compared);
    assert.equal(drawn.textContent, 'The quickslow foxgone');
    assert.deepEqual(
      changes.map(change => [change.look, change.block, drawn.textBetween(change.from, change.to)]),
      [
        ['del', false, 'quick'],
        ['ins', false, 'slow'],
        ['del', true, 'gone'],
        ['del', false, 'gone'],
      ],
    );
    const [replaced, deleted] = compared.changes;
    assert.deepEqual(
      changes.map(change => change.change),
      [replaced!.id, replaced!.id, deleted!.id, deleted!.id],
    );
    let leftovers = 0;
    drawn.descendants(node => {
      if (node.attrs.suggestId || node.marks.some(mark => mark.type.name.startsWith('suggest'))) leftovers++;
    });
    assert.equal(leftovers, 0);
  });

  it('keeps a version’s own suggestions, and draws formatting changes with their summary', () => {
    const own: Inline[] = chars('kept').map(item => ({ ...item, suggest: { id: 's1', op: 'ins' } }));
    const compared = compareVersions(doc(para('p1', [...own, ...chars(' x')])), doc(para('p1', [...own, ...chars(' x', 'a', { italic: true })])));
    const { doc: drawn, changes } = previewDocOf(compared);
    assert.deepEqual(
      changes.map(change => [change.look, change.summary, drawn.textBetween(change.from, change.to)]),
      [['fmt', 'Italic added', ' x']],
    );
    let real = 0;
    drawn.descendants(node => {
      if (node.marks.some(mark => mark.attrs.suggestId === 's1')) real++;
    });
    assert.equal(real, 1);
  });
});

describe('restoring a version', () => {
  const suggestion = (id: string, by: string, extra: Partial<DocSuggestion> = {}): DocSuggestion => ({ id, by, at: '', mine: false, asOf: '', ...extra });
  const holding = (...ids: string[]) => doc(para('p1', ids.flatMap(id => chars('w').map(item => ({ ...item, suggest: { id, op: 'ins' as const } })))));

  it('says which open suggestions it discards, and by whom', () => {
    assert.equal(discardSentence(1, [], 0), 'Restoring will discard 1 open suggestion.');
    assert.equal(discardSentence(5, ['you', 'Agent'], 2), 'Restoring will discard 5 open suggestions, by you, Agent and 2 others.');
    const ana = { name: 'Ana' };
    const open = [suggestion('a', 'u_ana', ana), suggestion('b', 'me', { mine: true }), suggestion('c', 'agent', { via: 'agent' }), suggestion('d', 'u_bo', { name: 'Bo' }), suggestion('k', 'u_ana', ana)];
    assert.equal(restoreNote(open, holding('k')), 'Restoring will discard 4 open suggestions, by you, Ana and 2 others. 1 more will stay open as it stood in this version; anything added to it since is discarded.');
  });

  it('names people by name, never by their id', () => {
    assert.equal(restoreNote([suggestion('a', 'u_7f3a')], holding()), 'Restoring will discard 1 open suggestion.');
    learnNames({ u_7f3a: 'Dee' });
    assert.equal(restoreNote([suggestion('a', 'u_7f3a')], holding()), 'Restoring will discard 1 open suggestion, by Dee.');
  });

  it('names no one when it can’t tell who laid one', () => {
    assert.equal(restoreNote([suggestion('a', ''), suggestion('b', 'bo')], holding()), 'Restoring will discard 2 open suggestions.');
  });

  it('says when suggestions decided since come back', () => {
    assert.equal(restoreNote([], holding('old')), 'Suggestions that were pending in this version come back as pending, even if they were accepted or rejected since.');
    assert.equal(restoreNote([], holding()), null);
    assert.match(restoreNote([suggestion('a', 'ana')], null)!, /come back as pending/);
  });
});

describe('copying a version', () => {
  it('names the copy for its tab and time, as a tab name the doc takes', () => {
    assert.match(copyName('Plan', new Date(2026, 10, 18, 15, 4).toISOString(), 'en-US'), /^Plan \(version of Nov 18, 2026, 3:04\sPM\)$/);
    assert.equal(safeTabName(' a/b\tc '), 'a-b c');
    assert.equal(safeTabName('   '), 'Copy');
  });

  it('sends the blocks without their ids', () => {
    const members = copyMembers('Plan (copy)', doc(para('p1', 'Hello')));
    assert.equal(members.length, 2);
    assert.equal(JSON.stringify(members).includes('"bid"'), false);
    assert.equal(JSON.stringify(members).includes('p1'), false);
  });
});

describe('after a version is copied', () => {
  const from = { tab: 't', rev: 5, row: 'r5', count: 1 };

  it('opens the copy when its version is still shown', () => {
    assert.deepEqual(afterCopy(from, { tab: 't', rev: 5, row: 'r5' }), { open: true, title: 'Copy opened in a new tab' });
    assert.deepEqual(afterCopy({ ...from, row: 'g3', count: 3 }, { tab: 't', rev: 5, row: 'g3' }), { open: true, title: 'Opened a copy of the newest of 3 versions' });
  });

  it('only says it is made once the person went on to something else', () => {
    assert.deepEqual(afterCopy(from, null), { open: false, title: 'Copy created' });
    assert.deepEqual(afterCopy(from, { tab: 't', rev: 7, row: 'r7' }), { open: false, title: 'Copy created' });
    assert.deepEqual(afterCopy(from, { tab: 'u', rev: 5, row: 'r5' }), { open: false, title: 'Copy created' });
    assert.deepEqual(afterCopy({ ...from, row: 'g3', count: 3 }, { tab: 't', rev: 5, row: 'r5' }), { open: false, title: 'Copied the newest of 3 versions' });
  });
});
