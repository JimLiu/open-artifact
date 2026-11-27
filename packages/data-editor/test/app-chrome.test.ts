import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Dataset } from '@open-artifact/data-core';
import {
  clampPanelWidth,
  nextPanelStop,
  ownPanelWidth,
  PAGE_MIN_WIDTH,
  PANEL_DEFAULT_WIDTH,
  PANEL_MAX_WIDTH,
  PANEL_MIN_WIDTH,
  resizePress,
  shownPanel,
} from '../src/app/panels.ts';
import { MAX_CHROME_ACTIONS, mergeChromeActions, saveNowAction } from '../src/app/shell-actions.ts';
import { ASK_REQUESTS, describeCodeFailure, describeSourceFailures, sourceFailureQuestion } from '../src/app/request-words.ts';
import { workingLineAt, WORKING_FIRST_MS, WORKING_LONG_MS, WORKING_STEP_MS } from '../src/app/working-line.ts';
import { formatAttentionCount, withNote, MAKING_PAGE_TEXT, TAKING_LONGER_TEXT, USUALLY_A_FEW_MINUTES_TEXT, WORKING_TIPS } from '../src/app/words.ts';
import { freshnessTips, unruledFilters } from '../src/app/data-view.ts';

const query = (id: string, title = ''): Dataset => ({ id, title, source: { kind: 'query', connector: 'sales', tool: 'q', args: {} } }) as unknown as Dataset;
const calc = (id: string, title = ''): Dataset => ({ id, title, source: { kind: 'calc' } }) as unknown as Dataset;

describe('panels', () => {
  it('clamps the width between its bounds and clear of the page', () => {
    assert.equal(clampPanelWidth(100), PANEL_MIN_WIDTH);
    assert.equal(clampPanelWidth(5000), PANEL_MAX_WIDTH);
    assert.equal(clampPanelWidth(400.4), 400);
    assert.equal(clampPanelWidth(600, 800), 800 - PAGE_MIN_WIDTH);
    assert.equal(clampPanelWidth(600, 300), PANEL_MIN_WIDTH);
    assert.equal(clampPanelWidth(Number.NaN), PANEL_DEFAULT_WIDTH);
  });

  it('shows History over Design over Sources', () => {
    assert.equal(shownPanel({ sources: false, design: false, history: false }), null);
    assert.equal(shownPanel({ sources: true, design: false, history: false }), 'sources');
    assert.equal(shownPanel({ sources: true, design: true, history: false }), 'design');
    assert.equal(shownPanel({ sources: true, design: true, history: true }), 'history');
  });
});

describe('shell actions', () => {
  it('merges the parts in order, each id once, up to the limit', () => {
    const parts = new Map([
      ['sync', [{ id: 'save_now' }]],
      ['edit', [{ id: 'edit_page', label: 'Edit' }, { id: 'save_now' }]],
    ]);
    assert.deepEqual(mergeChromeActions(parts), [{ id: 'save_now' }, { id: 'edit_page', label: 'Edit' }]);
    const many = new Map([['x', Array.from({ length: 30 }, (_, i) => ({ id: `a${i}` }))]]);
    assert.equal(mergeChromeActions(many).length, MAX_CHROME_ACTIONS);
  });

  it('offers save_now as a retry only while something is unsaved', () => {
    assert.deepEqual(saveNowAction(0), { id: 'save_now', disabled: true });
    assert.deepEqual(saveNowAction(2), { id: 'save_now' });
  });
});

describe('requests to the agent', () => {
  it('asks why one source, several, or a calculation failed', () => {
    assert.equal(sourceFailureQuestion([query('a')]), ASK_REQUESTS.whyLoad);
    assert.equal(sourceFailureQuestion([query('a'), query('b')]), ASK_REQUESTS.whyLoadSeveral);
    assert.equal(sourceFailureQuestion([calc('c')]), ASK_REQUESTS.whyRun);
  });

  it('names the failed sources in the selection', () => {
    const one = describeSourceFailures([query('orders', 'Orders')]);
    assert.equal(one.label, 'Orders');
    assert.deepEqual(one.chip, { about: 'source', name: 'Orders' });
    assert.match(one.text, /source: Orders \(orders\)/);
    const two = describeSourceFailures([query('a'), query('b', 'B')]);
    assert.equal(two.label, '2 sources');
    assert.deepEqual(two.chip, { about: 'sources', count: 2 });
    assert.match(two.text, /source: a \(a\)\nsource: B \(b\)/);
    const one_calc = describeSourceFailures([calc('total', 'Total')]);
    assert.deepEqual(one_calc.chip, { about: 'calc', name: 'Total' });
    assert.match(one_calc.text, /calculation: Total \(total\)/);
  });

  it('names the stopped files when asking to fix the page', () => {
    assert.match(describeCodeFailure(['files/index.html']).text, /stopped in:\nfile: files\/index\.html/);
    assert.match(describeCodeFailure([]).text, /stopped\.$/);
  });
});

describe('the empty page', () => {
  it('says the agent is working first, then cycles its lines', () => {
    assert.deepEqual(workingLineAt(0), { text: null, forMs: WORKING_FIRST_MS });
    assert.equal(workingLineAt(WORKING_FIRST_MS).text, MAKING_PAGE_TEXT);
    assert.equal(workingLineAt(WORKING_FIRST_MS + WORKING_STEP_MS).text, USUALLY_A_FEW_MINUTES_TEXT);
    assert.equal(workingLineAt(WORKING_FIRST_MS + 2 * WORKING_STEP_MS).text, WORKING_TIPS.select);
    assert.equal(workingLineAt(WORKING_FIRST_MS + 2 * WORKING_STEP_MS, true).text, WORKING_TIPS.sources);
    assert.equal(workingLineAt(WORKING_FIRST_MS + 1000).forMs, WORKING_STEP_MS - 1000);
  });

  it('says it takes longer once it has', () => {
    const long = WORKING_LONG_MS + 1;
    const lines = new Set<string>();
    for (let at = long; at < long + 120000; at += 1000) lines.add(workingLineAt(at).text ?? '');
    assert.ok(lines.has(TAKING_LONGER_TEXT));
    assert.ok(!lines.has(USUALLY_A_FEW_MINUTES_TEXT));
  });
});

describe('chrome words', () => {
  it('counts the sources needing attention and adds notes', () => {
    assert.equal(formatAttentionCount(1), 'one source needs attention');
    assert.equal(formatAttentionCount(3), '3 sources need attention');
    assert.equal(withNote('Sources', null), 'Sources');
    assert.equal(withNote('Sources', 'one source needs attention'), 'Sources (one source needs attention)');
  });

  it('words the data freshness', () => {
    assert.deepEqual(freshnessTips(null, false, 0), []);
    const now = Date.UTC(2026, 0, 2, 12);
    assert.match(freshnessTips(now, false, now)[0] ?? '', /^Data as of now \(/);
    const tips = freshnessTips(now - 3_600_000, true, now);
    assert.match(tips[0] ?? '', /^Data as of .+ ago \(/);
    assert.equal(tips[1], 'Some saved numbers are stale.');
  });
});

describe('page check inputs', () => {
  it('lists live query filters with no pinning rule', () => {
    const open = { id: 'orders', title: '', source: { kind: 'query', connector: 'sales', tool: 'q', call: 'q', args: {}, params: ['region'] } } as unknown as Dataset;
    assert.deepEqual(unruledFilters([calc('x')]), []);
    for (const entry of unruledFilters([open])) assert.equal(entry.dataset, 'orders');
  });
});

describe('panel resize handle', () => {
  const stops = { home: 380, max: 720, min: 280, own: null };

  it('steps home, widest, narrowest, the viewer’s own, then home again', () => {
    assert.equal(nextPanelStop(380, stops), 720);
    assert.equal(nextPanelStop(720, stops), 280);
    assert.equal(nextPanelStop(280, stops), 380);
    assert.equal(nextPanelStop(280, { ...stops, own: 500 }), 500);
    assert.equal(nextPanelStop(500, { ...stops, own: 500 }), 380);
    // A width that is no stop starts from home.
    assert.equal(nextPanelStop(431, stops), 380);
    // Stops that meet (a narrow window) count once.
    assert.equal(nextPanelStop(380, { home: 380, max: 380, min: 280, own: null }), 280);
  });

  it('takes a press as a drag past 3px along, a click otherwise unless it wandered across', () => {
    assert.equal(resizePress(0, 0), 'click');
    assert.equal(resizePress(3, 8), 'click');
    assert.equal(resizePress(-4, 0), 'drag');
    assert.equal(resizePress(1, 9), 'none');
  });

  it('keeps a dragged width as the viewer’s own only when it is no other stop', () => {
    assert.equal(ownPanelWidth(500, stops), 500);
    assert.equal(ownPanelWidth(720, stops), null);
    assert.equal(ownPanelWidth(380, stops), null);
  });
});
