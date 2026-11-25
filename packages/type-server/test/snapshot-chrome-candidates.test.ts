import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CANDIDATES } from '../src/snapshot.ts';

describe('the Chrome candidate list', () => {
  it('lists a 64-bit and a (x86) Program Files path for every Windows browser it names', () => {
    const windows = CANDIDATES.filter((path) => path.startsWith('C:\\'));
    const nameOf = (path: string) => path.split('\\').pop()!;
    const byExe = new Map<string, string[]>();
    for (const path of windows) {
      const exe = nameOf(path);
      (byExe.get(exe) ?? byExe.set(exe, []).get(exe)!).push(path);
    }
    assert.ok(byExe.size > 0, 'at least one Windows browser is listed');
    for (const [exe, paths] of byExe) {
      assert.ok(paths.some((p) => p.startsWith('C:\\Program Files\\') && !p.includes('(x86)')), `${exe} is missing its 64-bit Program Files path`);
      assert.ok(paths.some((p) => p.startsWith('C:\\Program Files (x86)\\')), `${exe} is missing its (x86) Program Files path`);
    }
  });

  it('has no duplicate paths', () => {
    assert.equal(new Set(CANDIDATES).size, CANDIDATES.length);
  });
});
