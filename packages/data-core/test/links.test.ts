import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  checkDataProject,
  getLinkHost,
  getReportedCalculationStatus,
  getStoppedCalculationStatus,
  parseCertificationTime,
  parseDataset,
  parseHttpsLink,
  parseResultCertification,
  parseResultMetadata,
  withResultMetadata,
} from '../src/index.ts';

const SOURCE = { kind: 'call', connector: 'db', tool: 'run', args: {} };

describe('dataset links', () => {
  it('keeps an https address with a host', () => {
    assert.equal(parseHttpsLink('https://docs.example.com/sheet/1?tab=2#a'), 'https://docs.example.com/sheet/1?tab=2#a');
    assert.equal(parseHttpsLink('https://example.com'), 'https://example.com/');
    assert.equal(parseDataset('a', { title: 'A', source: SOURCE, link: 'https://example.com/t' })?.link, 'https://example.com/t');
    assert.equal(getLinkHost('https://docs.example.com/sheet/1'), 'docs.example.com');
  });

  it('drops any other address', () => {
    for (const link of [
      'http://example.com/t',
      'https://example.com/{{region}}',
      'https://',
      'https://example.com./t',
      'https://user:secret@example.com/t',
      'https://user@example.com/t',
      'javascript:alert(1)',
      '/relative',
      '',
      42,
      null,
    ])
      assert.equal(parseHttpsLink(link), undefined, String(link));
    const dataset = parseDataset('a', { title: 'A', source: SOURCE, link: 'http://example.com/t' });
    assert.ok(dataset !== null);
    assert.equal(Object.hasOwn(dataset, 'link'), false);
    assert.equal(getLinkHost('http://example.com'), '');
  });

  it('warns about a link the page ignores', () => {
    const findings = checkDataProject(
      new Map([
        ['dash/meta', JSON.stringify({ title: 'Sales' })],
        ['datasets/kept', JSON.stringify({ title: 'Kept', source: SOURCE, link: 'https://example.com/t' })],
        ['datasets/dropped', JSON.stringify({ title: 'Dropped', source: SOURCE, link: 'https://me:pw@example.com/t' })],
        ['datasets/stored', JSON.stringify({ title: 'Stored', source: { kind: 'store', path: 'data/notes' }, link: 'http://x.com' })],
        ['files/index.html', JSON.stringify({ text: '<b data-source="kept dropped stored"></b>' })],
      ]),
      { connectors: new Set(['db']) },
    );
    const message =
      'link is the https address of its sheet, file or table (https://…, no user name or password); the page ignores any other.';
    const warned = findings.filter((finding) => finding.message === message).map((finding) => [finding.file, finding.level]);
    assert.deepEqual(warned.sort(), [
      ['db/datasets/dropped.json', 'warning'],
      ['db/datasets/stored.json', 'warning'],
    ]);
  });
});

describe('certified answers', () => {
  it('reads the tool’s certified entry out of meta', () => {
    const meta = [
      { label: 'SQL', value: 'select 1', type: 'code', lang: 'sql' },
      { type: 'certified', by: 'Data​ team\nfinance', at: '2026-03-04T09:30:00Z', url: 'https://catalog.example.com/m/7' },
    ];
    assert.deepEqual(parseResultMetadata(meta), [{ label: 'SQL', value: 'select 1', type: 'code', lang: 'sql' }]);
    assert.deepEqual(parseResultCertification(meta), {
      by: 'Data team finance',
      at: Date.parse('2026-03-04T09:30:00Z'),
      url: 'https://catalog.example.com/m/7',
    });
    const table = withResultMetadata({ columns: ['n'], rows: [{ n: 1 }] }, meta);
    assert.deepEqual(table.meta, [{ label: 'SQL', value: 'select 1', type: 'code', lang: 'sql' }]);
    assert.equal(table.certified?.by, 'Data team finance');
  });

  it('keeps a certified entry with no fields, and leaves out what it can’t keep', () => {
    const table = withResultMetadata({ columns: [], rows: [] }, [{ type: 'certified' }]);
    assert.deepEqual(table.certified, {});
    assert.equal(table.meta, undefined);
    assert.deepEqual(
      parseResultCertification([{ type: 'certified', by: 7, at: 'March 4', url: 'http://catalog.example.com' }]),
      {},
    );
    assert.equal(parseResultCertification([{ type: 'text', label: 'a', value: 'b' }]), undefined);
    assert.equal(parseResultCertification('certified'), undefined);
    assert.equal(parseResultCertification([{ type: 'certified', by: 'x'.repeat(200) }])?.by?.length, 80);
  });

  it('reads a bare date at its noon', () => {
    assert.equal(parseCertificationTime('2026-03-04'), new Date(2026, 2, 4, 12, 0).getTime());
    assert.equal(parseCertificationTime('2026-03-04T08:00:00Z'), Date.parse('2026-03-04T08:00:00Z'));
    assert.equal(parseCertificationTime('2026-13-40'), undefined);
    assert.equal(parseCertificationTime('04/03/2026'), undefined);
    assert.equal(parseCertificationTime(undefined), undefined);
  });
});

describe('calculation status', () => {
  it('is connect or declined only when nothing else stopped it', () => {
    assert.equal(getStoppedCalculationStatus(['connect']), 'connect');
    assert.equal(getStoppedCalculationStatus(['declined']), 'declined');
    assert.equal(getStoppedCalculationStatus(['declined', 'connect']), 'connect');
    assert.equal(getStoppedCalculationStatus(['connect', 'error']), 'error');
    assert.equal(getStoppedCalculationStatus(['missing']), 'error');
    assert.equal(getStoppedCalculationStatus([]), 'error');
  });

  it('reports connect and declined to the agent as error', () => {
    assert.equal(getReportedCalculationStatus('ok'), 'ok');
    assert.equal(getReportedCalculationStatus('loading'), 'loading');
    assert.equal(getReportedCalculationStatus('connect'), 'error');
    assert.equal(getReportedCalculationStatus('declined'), 'error');
    assert.equal(getReportedCalculationStatus('error'), 'error');
  });
});
