import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { fitShownPageRecord, showingOf, writeToOf } from '../src/page/shown-page.ts';

describe('what the page tells the agent it shows', () => {
  it('names a draft and an earlier version, and nothing for the dashboard', () => {
    assert.equal(showingOf({ mode: 'live' }), null);
    assert.equal(showingOf({ mode: 'draft', draftId: 'abc' }), 'drafts/abc');
    assert.equal(showingOf({ mode: 'version', version: 7 }), 'history/7');
    assert.equal(showingOf({ mode: 'draft' }), null);
    assert.equal(showingOf({ mode: 'version' }), null);
  });

  it('writes changes to the draft shown, never to an earlier version', () => {
    assert.equal(writeToOf({ mode: 'draft', draftId: 'abc' }), 'drafts/abc');
    assert.equal(writeToOf({ mode: 'version', version: 7 }), null);
    assert.equal(writeToOf({ mode: 'live' }), null);
  });

  it('keeps showing on the shown page record, after at', () => {
    const base = { v: 1 as const, at: '2026-01-01T00:00:00.000Z', showing: 'drafts/abc', width: 900, filters: {} };
    const record = fitShownPageRecord('<p>x</p>', base);
    assert.deepEqual(Object.keys(record), ['v', 'at', 'showing', 'width', 'filters', 'html']);
    assert.equal(record.showing, 'drafts/abc');
  });
});
