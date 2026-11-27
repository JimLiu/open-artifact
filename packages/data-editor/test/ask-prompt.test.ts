import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ElementSelection } from '../src/page/selection.ts';
import { ASK_PILL_GAP, ASK_PILL_MARGIN, positionSelectionPill, settleWordsTop } from '../src/ask/place.ts';
import {
  ASK_SENT,
  ASK_TITLE,
  NOT_LISTENING,
  sendFailedText,
  buildAskRequest,
  buildCopiedPrompt,
  buildSelectionPrompt,
  describeActiveFilters,
  describePickChip,
  formatSourceAddress,
  summarizeCellAddressRange,
  toRequestSelection,
} from '../src/ask/prompt.ts';

const heading: ElementSelection = { kind: 'Heading', text: 'Signups', title: 'Signups', under: '', hook: '#signups', tab: '', source: null };
const context = { filters: [], sourceTitle: (id: string) => (id === 'sales' ? 'Sales' : '') };

describe('ask prompt', () => {
  it('describes a heading with its label', () => {
    const prompt = buildSelectionPrompt(heading, context);
    assert.equal(prompt.text, 'From the dashboard’s page:\nkind: Heading\ntitle: Signups\nin the page’s files: #signups\ntext: Signups');
    const selection = toRequestSelection(prompt);
    assert.equal(selection.label, 'Heading · “Signups”');
    assert.match(selection.label, /Signups/);
  });

  it('names the filters, tab and source', () => {
    const cell: ElementSelection = {
      kind: 'Value',
      text: '42',
      title: '',
      under: 'Revenue',
      hook: '',
      tab: 'Q3',
      source: { source: 'sales', field: 'sales__revenue', row: 3 },
    };
    const filters = describeActiveFilters(['region', 'year'], { region: ['EU', 'US'] });
    const prompt = buildSelectionPrompt(cell, { ...context, filters });
    assert.match(prompt.text, /^filters: region = EU, US, year = none$/m);
    assert.match(prompt.text, /^source: Sales · revenue · row 3 \(sales\)$/m);
    assert.equal(describePickChip(prompt.chip), 'Value · “42” · Q3 · region = EU, US · year = none · from Sales · revenue · row 3');
  });

  it('summarizes a run of cells', () => {
    const cells = [1, 2, 3].flatMap((row) => ['a', 'b'].map((field) => ({ source: 's', field, row })));
    assert.equal(summarizeCellAddressRange(cells), 'columns a, b · rows 1 to 3 (3 rows, in the order shown)');
    assert.equal(summarizeCellAddressRange([{ source: 's', field: 'a', row: 1 }]), null);
    assert.equal(formatSourceAddress({ source: 's', field: 'x', where: [{ column: 'id', value: 'u1' }] }), 'x · id = u1');
  });

  it('sends the person’s words, with the selection as data', () => {
    const selection = toRequestSelection(buildSelectionPrompt(heading, context));
    const request = buildAskRequest('  Make it bigger \n', selection);
    assert.equal(request.title, ASK_TITLE);
    assert.equal(request.text, 'Make it bigger');
    assert.deepEqual(request.context, { request: 'Make it bigger', label: selection.label, selection });
    // For the app showing the request: the words as typed, and the chip of the part asked about.
    assert.equal(request.userText, 'Make it bigger');
    assert.deepEqual(request.selectionSnapshot, { kind: 'pick', label: selection.label, count: 1, text: selection.text });
    assert.match(buildCopiedPrompt(selection), /Signups/);
    assert.equal(ASK_SENT, 'Sent to the agent.');
    assert.equal(NOT_LISTENING, 'The agent isn’t listening to this dashboard. Ask it to wait for requests here, then try again.');
  });

  it('a failed send says how it failed, not that no agent listens', () => {
    assert.equal(sendFailedText('Agent request failed (500).'), 'Could not reach the agent. Agent request failed (500).');
    assert.equal(sendFailedText(), 'Could not reach the agent. Try again, or copy your request into the conversation.');
    assert.notEqual(sendFailedText(), NOT_LISTENING);
  });
});

describe('selection pill placement', () => {
  const room = { left: 0, top: 0, width: 800, height: 600 };

  it('sits above selected text, centred on it', () => {
    const place = positionSelectionPill({ anchor: { left: 100, top: 200, width: 100 }, under: 230, room, words: { text: 'x', top: 200 } }, 120, 36);
    assert.deepEqual(place, { left: 90, top: 200 - 36 - ASK_PILL_GAP, placed: 'above' });
  });

  it('goes below near the top, and below a picked piece when it fits', () => {
    assert.equal(positionSelectionPill({ anchor: { left: 100, top: 20, width: 100 }, under: 50, room, words: { text: 'x', top: 20 } }, 120, 36).placed, 'below');
    assert.equal(positionSelectionPill({ anchor: { left: 100, top: 200, width: 100 }, under: 300, room, words: null }, 120, 36).placed, 'below');
  });

  it('keeps the side it took for the same selection while that side fits', () => {
    const anchor = { left: 100, top: 200, width: 100 };
    assert.equal(positionSelectionPill({ anchor, under: 230, room, words: { text: 'x', top: 200 } }, 120, 36, 'below').placed, 'below');
    assert.equal(positionSelectionPill({ anchor, under: 300, room, words: null }, 120, 36, 'above').placed, 'above');
    // Below has no room: it goes above after all.
    assert.equal(positionSelectionPill({ anchor, under: 590, room, words: { text: 'x', top: 200 } }, 120, 36, 'below').placed, 'above');
  });

  it('stays inside the room', () => {
    const place = positionSelectionPill({ anchor: { left: 780, top: 200, width: 10 }, under: 230, room, words: { text: 'x', top: 200 } }, 120, 36);
    assert.equal(place.left, 800 - ASK_PILL_MARGIN - 120);
  });

  it('holds the pill still while the selection grows, and lets go when it jumps', () => {
    assert.deepEqual(settleWordsTop({ text: 'ab', top: 100 }, { text: 'ab', top: 140 }), { text: 'ab', top: 100 });
    assert.deepEqual(settleWordsTop({ text: 'ab', top: 100 }, { text: 'abc', top: 140 }), { text: 'abc', top: 140 });
    assert.equal(settleWordsTop({ text: 'ab', top: 100 }, { text: 'ab', top: 260 }), null);
  });
});
