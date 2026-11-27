import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { answerExportScope, askExportScope, scopeBusy } from '../src/topbar/export-scope.ts';
import { getTopBar } from '../src/topbar/store.ts';

describe('asking which tabs an export takes', () => {
  it('shows the question until it is answered, and answers a second ask at once with nothing', async () => {
    const asked = askExportScope('pdf', 'a4');
    assert.deepEqual(getTopBar().askingScope, { format: 'pdf', paper: 'a4' });
    assert.equal(scopeBusy(), true);
    assert.equal(await askExportScope('docx'), null, 'a second question while one is open');
    answerExportScope('doc');
    assert.equal(await asked, 'doc');
    assert.equal(getTopBar().askingScope, null);
    assert.equal(scopeBusy(), false);
  });

  it('gives nothing when the dialog closes', async () => {
    const asked = askExportScope('docx');
    answerExportScope(null);
    assert.equal(await asked, null);
    assert.equal(getTopBar().askingScope, null);
  });
});
