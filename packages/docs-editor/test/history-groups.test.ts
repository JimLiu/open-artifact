import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { MAX_VERSIONS } from '@open-artifact/docs-core';
import type { DocVersion } from '@open-artifact/runtime/doc-api';
import { learnNames } from '../src/app/people.ts';
import { compareBase, dayKey, dayLabel, editsLabel, foldVersions, restoredLabel, sectionByDay, versionBefore, whoOf } from '../src/history/groups.ts';

const at = (day: number, hour: number, minute = 0) => new Date(2026, 10, day, hour, minute).toISOString();

const person = (rev: number, user: string, when: string): DocVersion => ({ rev, by: 'human', user, at: when });
const agent = (rev: number, when: string): DocVersion => ({ rev, by: 'agent', at: when });

const shape = (versions: DocVersion[]) => foldVersions(versions, dayKey).map(row => `${row.kind}:${row.versions.map(version => version.rev).join(',')}`);

describe('history rows', () => {
  it('keeps the newest version as the current row, alone', () => {
    assert.deepEqual(shape([person(9, 'ana', at(18, 10, 5)), person(8, 'ana', at(18, 10)), person(7, 'ana', at(18, 9))]), ['current:9', 'group:8,7']);
  });

  it('folds consecutive versions by the same author, newest first', () => {
    const versions = [
      agent(12, at(18, 12)),
      person(11, 'ana', at(18, 11, 30)),
      person(10, 'ana', at(18, 11)),
      person(9, 'ana', at(18, 10)),
      agent(8, at(18, 9, 30)),
      agent(7, at(18, 9)),
      person(6, 'ben', at(18, 8)),
      person(5, 'ana', at(18, 7)),
    ];
    assert.deepEqual(shape(versions), ['current:12', 'group:11,10,9', 'group:8,7', 'single:6', 'single:5']);
  });

  it('breaks a run at a restore, which stands alone', () => {
    const versions = [
      person(9, 'ana', at(18, 12)),
      person(8, 'ana', at(18, 11)),
      { ...person(7, 'ana', at(18, 10)), restoredFrom: 3 },
      person(6, 'ana', at(18, 9)),
      person(5, 'ana', at(18, 8)),
    ];
    assert.deepEqual(shape(versions), ['current:9', 'single:8', 'restore:7', 'group:6,5']);
  });

  it('breaks a run at the day', () => {
    const versions = [agent(4, at(18, 9)), person(3, 'ana', at(18, 8)), person(2, 'ana', at(17, 20)), person(1, 'ana', at(17, 19))];
    const rows = foldVersions(versions, dayKey);
    assert.deepEqual(shape(versions), ['current:4', 'single:3', 'group:2,1']);
    assert.deepEqual(
      sectionByDay(rows).map(section => section.rows.map(row => row.versions[0]!.rev)),
      [[4, 3], [2]],
    );
  });

  it('tells people apart, and the agent from auto-save', () => {
    const versions = [person(5, 'ana', at(18, 12)), person(4, 'ana', at(18, 11)), person(3, 'ben', at(18, 10)), { rev: 2, by: 'system', at: at(18, 9) } as DocVersion, { rev: 1, by: 'system', at: at(18, 8) } as DocVersion];
    assert.deepEqual(shape(versions), ['current:5', 'single:4', 'single:3', 'group:2,1']);
  });

  it('keys a folded row by its oldest version, so newer versions joining keep it', () => {
    const before = foldVersions([person(5, 'ana', at(18, 12)), agent(4, at(18, 11)), agent(3, at(18, 10))], dayKey);
    const after = foldVersions([person(7, 'ana', at(18, 13)), agent(6, at(18, 12, 30)), person(5, 'ana', at(18, 12)), agent(4, at(18, 11)), agent(3, at(18, 10))], dayKey);
    assert.equal(before[1]!.key, after[3]!.key);
  });

  it('compares a version with the one before it', () => {
    const versions = [person(3, 'ana', at(18, 12)), person(2, 'ana', at(18, 11)), person(1, 'ana', at(18, 10))];
    assert.equal(versionBefore(versions, 3)?.rev, 2);
    assert.equal(versionBefore(versions, 1), null);
  });

  it('compares the oldest version with the tab as first saved when it came after rev 1', () => {
    const versions = [agent(4, at(18, 11)), agent(2, at(18, 10))];
    assert.equal(compareBase(versions, 4), 2);
    assert.equal(compareBase(versions, 2), 1);
    assert.equal(compareBase([person(1, 'ana', at(18, 10))], 1), null);
    assert.equal(compareBase(versions, 3), null, 'a rev the list does not hold');
    const kept: DocVersion = { rev: 3, by: 'system', at: at(18, 9) };
    assert.equal(compareBase([agent(5, at(18, 11)), kept], 3), null, 'a tab that had text before its history began');
    const full = Array.from({ length: MAX_VERSIONS }, (_, index) => agent(MAX_VERSIONS + 10 - index, at(18, 10)));
    assert.equal(compareBase(full, full.at(-1)!.rev), null, 'older versions were let go');
  });
});

describe('history words', () => {
  it('names who made a version', () => {
    const me = { id: 'ana@example.com', name: 'Ana' };
    assert.equal(whoOf(person(1, 'ana@example.com', at(18, 1)), me), 'Ana');
    assert.equal(whoOf(person(1, 'ben@example.com', at(18, 1)), me), 'ben@example.com');
    assert.equal(whoOf({ ...person(1, 'g_7f3a', at(18, 1)), name: 'Ben' }, me), 'Ben');
    assert.equal(whoOf(person(1, 'g_7f3a', at(18, 1)), me), 'Someone');
    learnNames({ g_9c1d: 'Cleo' });
    assert.equal(whoOf(person(1, 'g_9c1d', at(18, 1)), me), 'Cleo');
    assert.equal(whoOf(agent(1, at(18, 1)), me), 'Agent');
    assert.equal(whoOf({ rev: 1, by: 'system', at: at(18, 1) }, me), 'auto-save');
    assert.equal(editsLabel(3, 'Agent'), '3 edits by Agent');
  });

  it('labels days relative to today', () => {
    const now = new Date(2026, 10, 18, 15);
    assert.equal(dayLabel(at(18, 9), now), 'Today');
    assert.equal(dayLabel(at(17, 23), now), 'Yesterday');
    assert.equal(dayLabel(at(14, 9), now), new Date(2026, 10, 14).toLocaleDateString(undefined, { weekday: 'long' }));
    assert.equal(dayLabel(new Date(2026, 1, 3).toISOString(), now), new Date(2026, 1, 3).toLocaleDateString(undefined, { month: 'long', day: 'numeric' }));
    assert.match(dayLabel(new Date(2024, 1, 3).toISOString(), now), /2024/);
  });

  it('says what a restore brought back', () => {
    const now = new Date(2026, 10, 18, 15);
    const versions = [{ ...person(5, 'ana', at(18, 12)), restoredFrom: 2 }, person(2, 'ana', at(18, 9)), person(1, 'ana', at(18, 8))];
    assert.match(restoredLabel(versions[0]!, versions, now)!, /^Restored from Today at /);
    assert.equal(restoredLabel({ ...versions[0]!, restoredFrom: 99 }, versions, now), 'Restored from rev 99');
    assert.equal(restoredLabel(versions[1]!, versions, now), null);
  });
});
