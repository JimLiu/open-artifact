/**
 * A connected table's refresh, as the page waits for it: the server hands the call to the agent and answers at once;
 * the refresh is done when the table's snapshot changes, and refused when the server or the agent says why, or when
 * the agent stops without sending rows.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { SheetFrame, SheetSendRequest, SheetSendResponse } from '@open-artifact/runtime/sheet-api';
import { createTableRefreshes, ROWS_AFTER_AGENT_STOPPED_MS, type TableNow, type TableRefreshAnswer, type TableRefreshAsked } from '../src/tables/connected-table-host.ts';

const SHEET = 'sht_aaaaaaaaaa.0';
const DIGEST = 'digest-1';

function memoryStorage(): Storage {
  const kept = new Map<string, string>();
  return {
    get length() {
      return kept.size;
    },
    clear: () => kept.clear(),
    getItem: (key) => kept.get(key) ?? null,
    key: (i) => [...kept.keys()][i] ?? null,
    removeItem: (key) => void kept.delete(key),
    setItem: (key, value) => void kept.set(key, value),
  };
}

/** Timers that run only when the test moves the clock. */
function clock() {
  let now = 0;
  const timers = new Map<number, { at: number; callback: () => void }>();
  let next = 1;
  return {
    setTimer: (callback: () => void, ms: number) => {
      timers.set(next, { at: now + ms, callback });
      return next++;
    },
    clearTimer: (timer: unknown) => void timers.delete(timer as number),
    advance(ms: number) {
      const until = now + ms;
      for (;;) {
        const due = [...timers].filter(([, t]) => t.at <= until).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        timers.delete(due[0]);
        now = due[1].at;
        due[1].callback();
      }
      now = until;
    },
  };
}

function setUp(answer: SheetSendResponse = { kind: 'refreshAsked' }) {
  const table: TableNow = { snapshotId: 'snap-1', callDigest: DIGEST };
  const sent: SheetSendRequest[] = [];
  const time = clock();
  const storage = memoryStorage();
  const refreshes = createTableRefreshes({
    sheet: () => ({
      send: async (request: SheetSendRequest) => {
        sent.push(request);
        return answer;
      },
    }),
    tableNow: (sheetId) => (sheetId === SHEET ? table : null),
    findStorage: () => storage,
    ...time,
  });
  const asked: TableRefreshAsked = { sheetId: SHEET, call: { title: 'All customers', connector: 'Shop', tool: 'list', argumentsAsJson: '{}', followUp: null, transform: { kind: 'code', source: '' } }, callDigest: DIGEST, viewerId: 'p1', isConfirmedNow: true };
  return { table, sent, time, refreshes, asked };
}

/** What a promise has settled to so far, or 'pending'. */
async function stateOf(promise: Promise<TableRefreshAnswer>): Promise<TableRefreshAnswer | 'pending'> {
  return Promise.race([promise, new Promise<'pending'>((resolve) => setImmediate(() => resolve('pending')))]);
}

test('a call nobody confirmed yet is shown first', async () => {
  const { refreshes, asked, sent } = setUp();
  assert.deepEqual(await refreshes.refresh({ ...asked, isConfirmedNow: false }), { kind: 'toBeConfirmed', isMarkedReadOnly: false });
  assert.equal(sent.length, 0);
});

test('asks the server, then is refreshed when the snapshot changes', async () => {
  const { refreshes, asked, sent, table, time } = setUp();
  const answer = refreshes.refresh(asked);
  assert.equal(await stateOf(answer), 'pending');
  assert.deepEqual(sent, [{ kind: 'refreshConnectedTable', sheetId: SHEET, callDigest: DIGEST }]);
  table.snapshotId = 'snap-2';
  time.advance(1_000);
  assert.deepEqual(await answer, { kind: 'refreshed' });
  // Once confirmed, the same call is not shown again.
  const again = refreshes.refresh({ ...asked, isConfirmedNow: false });
  assert.equal(await stateOf(again), 'pending');
});

test("the agent's reason ends the wait, and what the tool said goes with toolError", async () => {
  const { refreshes, asked } = setUp();
  const answer = refreshes.refresh(asked);
  await stateOf(answer);
  const frame: SheetFrame = { phase: 'tableRefresh', sheetId: SHEET, callDigest: DIGEST, outcome: { state: 'refused', why: 'toolError', toolSaid: 'Rate limited' } };
  refreshes.heard(frame);
  assert.deepEqual(await answer, { kind: 'refused', why: 'toolError', toolSaid: 'Rate limited' });
});

test('the agent stopping without rows is noRowInTime, a little later', async () => {
  const { refreshes, asked, time } = setUp();
  const answer = refreshes.refresh(asked);
  await stateOf(answer);
  refreshes.agentStatusChanged({ available: true, busy: true, name: 'Agent' });
  refreshes.agentStatusChanged({ available: true, busy: false, name: 'Agent' });
  time.advance(ROWS_AFTER_AGENT_STOPPED_MS - 1_000);
  assert.equal(await stateOf(answer), 'pending');
  time.advance(1_000);
  assert.deepEqual(await answer, { kind: 'refused', why: 'noRowInTime' });
});

test('a changed call and the server refusing end the wait', async () => {
  const changed = setUp();
  const answer = changed.refreshes.refresh(changed.asked);
  await stateOf(answer);
  changed.table.callDigest = 'digest-2';
  changed.time.advance(1_000);
  assert.deepEqual(await answer, { kind: 'refused', why: 'callChanged' });

  const notOwner = setUp({ kind: 'refused', refusal: 'notOwner' });
  assert.deepEqual(await notOwner.refreshes.refresh(notOwner.asked), { kind: 'refused', why: 'notAllowed' });
  const notListening = setUp({ kind: 'refused', refusal: 'agentNotListening' });
  assert.deepEqual(await notListening.refreshes.refresh(notListening.asked), { kind: 'refused', why: 'notServed' });
});
