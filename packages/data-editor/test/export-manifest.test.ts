import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Dataset, DatasetSource } from '@open-artifact/data-core';
import {
  buildDashboardExportManifest,
  collectExportSourceDependencies,
  dashboardJsonText,
  exportDatasetProvenance,
  exportFilename,
  exportJsonReplacer,
  replaceLoneSurrogates,
} from '../src/export/manifest.ts';
import { dashboardChromeFormats } from '../src/export/formats.ts';

const dataset = (id: string, source: DatasetSource, extra: Partial<Dataset> = {}): Dataset => ({
  id,
  title: '',
  description: '',
  source,
  updated: null,
  schedule: '',
  staleAfterHours: null,
  ...extra,
});

const calc = (inputs: string[]): DatasetSource => ({ kind: 'calc', inputs, description: '', status: 'ok', result: null, error: '', at: 0 });

const sales = dataset('sales', {
  kind: 'query',
  connector: 'warehouse',
  tool: 'lookup',
  args: '{"region":"{{region}}","limit":10}',
});
const targets = dataset('targets', { kind: 'file', url: 'https://x.test/t.csv', name: 'targets.csv', format: 'csv' }, { title: 'Targets', updated: { at: 0, by: 'a' } });
const share = dataset('share', calc(['sales', 'base']));
const base = dataset('base', calc(['targets']));

describe('export manifest', () => {
  it('says where each source comes from', () => {
    assert.deepEqual(exportDatasetProvenance(sales), {
      kind: 'query',
      connector: 'warehouse',
      tool: 'lookup',
      arguments: { region: '{{region}}', limit: 10 },
      inputs: ['region'],
    });
    assert.deepEqual(exportDatasetProvenance(targets), { kind: 'file', file: 'targets.csv' });
    assert.deepEqual(exportDatasetProvenance(share), { kind: 'calc' });
    assert.deepEqual(exportDatasetProvenance(dataset('odd', { kind: 'unsupported', rawKind: 'x' })), { kind: 'unsupported' });
  });

  it('lists the sources with their times and the filters their queries use', () => {
    const manifest = buildDashboardExportManifest(
      'Sales',
      Date.UTC(2026, 0, 2),
      [
        [sales, Date.UTC(2026, 0, 1)],
        [targets, null],
      ],
      { region: 'West' },
    );
    assert.equal(manifest.version, 1);
    assert.equal(manifest.exported_at, '2026-01-02T00:00:00.000Z');
    assert.deepEqual(manifest.inputs, [{ name: 'region', label: 'Region', value: 'West' }]);
    assert.deepEqual(
      manifest.sources.map((source) => [source.id, source.title, source.as_of]),
      [
        ['sales', 'sales', '2026-01-01T00:00:00.000Z'],
        ['targets', 'Targets', null],
      ],
    );
  });

  it('gives a filter with no value null', () => {
    assert.deepEqual(buildDashboardExportManifest('S', 0, [[sales, null]], {}).inputs, [{ name: 'region', label: 'Region', value: null }]);
  });

  it('takes in every source a marked calculation reads', () => {
    const listed = [sales, targets, share, base];
    assert.deepEqual([...collectExportSourceDependencies(['share'], listed)].sort(), ['base', 'sales', 'share', 'targets']);
    assert.deepEqual([...collectExportSourceDependencies(['targets'], listed)], ['targets']);
  });

  it('writes the manifest of the used sources the copy shows, with the copy', () => {
    const text = dashboardJsonText(
      {
        title: 'Sales',
        listed: [sales, targets, share, base],
        used: [sales, targets],
        run: () => ({ status: 'idle' }) as never,
        params: {},
      },
      ['targets'],
      '<html></html>',
      0,
    );
    const parsed = JSON.parse(text) as { sources: { id: string }[]; html: string; title: string };
    assert.deepEqual(
      parsed.sources.map((source) => source.id),
      ['targets'],
    );
    assert.equal(parsed.html, '<html></html>');
    assert.equal(parsed.title, 'Sales');
  });

  it('mends lone surrogates in strings and keys', () => {
    assert.equal(replaceLoneSurrogates('a\uD800b\uDC00c😀'), 'a�b�c😀');
    assert.equal(JSON.stringify({ ['k\uD800']: 'v\uDC00' }, exportJsonReplacer), '{"k�":"v�"}');
  });

  it('names the file after the title', () => {
    assert.equal(exportFilename('Q3: Sales / West?', 'json'), 'Q3 Sales West.json');
    assert.equal(exportFilename('..hidden', 'html'), 'hidden.html');
    assert.equal(exportFilename(' \u0000 ', 'html'), 'Dashboard.html');
    assert.equal(exportFilename('x'.repeat(300), 'pdf'), `${'x'.repeat(120)}.pdf`);
  });

  it('lists the formats for the Shell, disabled with a reason until the page can be exported', () => {
    const ready = dashboardChromeFormats({ ready: true });
    assert.ok(ready.some((format) => format.format === 'pdf' && format.more === undefined && format.disabled === undefined));
    assert.ok(ready.some((format) => format.format === 'print' && format.more === true && format.disabled === undefined));
    const waiting = dashboardChromeFormats({ ready: false, why: 'other', reason: 'Wait.' });
    assert.ok(waiting.every((format) => format.disabled === true && format.why === 'other' && format.disabledReason === 'Wait.'));
    assert.ok(dashboardChromeFormats({ ready: false, why: 'older_version' }).every((format) => format.why === 'older_version' && format.disabledReason === undefined));
  });
});
