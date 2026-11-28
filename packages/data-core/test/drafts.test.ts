import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  applyDraftToContent,
  areDraftDocsEqual,
  composeDashboardDocuments,
  composeDraft,
  createDeleteFieldPatch,
  dashboardContentHash,
  DELETE_FIELD,
  draftHasPage,
  isDraftForArtifact,
  listRemixForms,
  newDraftId,
  parseDashboardContent,
  parseDraftHead,
  pickDraftHead,
  planDraftSave,
  prepareDashboardContent,
  remixFormName,
  remixPrompt,
  remixSelection,
  toDraftHeadRecord,
} from '../src/index.ts';
import type { DraftDocs, RemixDraftHead, UnknownRecord } from '../src/index.ts';

const head = (id: string, by: string, at: number, extra: Partial<RemixDraftHead> = {}): RemixDraftHead => ({
  id, kind: 'remix', form: 'dashboard', by, at, base: '', ...extra,
});

describe('draft heads', () => {
  it('parse a valid head and refuse a bad one', () => {
    assert.deepEqual(parseDraftHead('abc123', { v: 1, kind: 'remix', form: 'visual-short', by: 'u1', at: 5, artifact: 'a1', base: 'h', saved: true }), {
      id: 'abc123', kind: 'remix', form: 'visual-short', by: 'u1', at: 5, artifact: 'a1', base: 'h', saved: true,
    });
    assert.equal((parseDraftHead('abc123', { kind: 'remix', form: 'letter', by: 'u1', at: 5 }) as RemixDraftHead | null)?.form, 'letter');
    assert.equal(parseDraftHead('ABC', { kind: 'remix', form: 'dashboard', by: 'u1', at: 5 }), null);
    assert.equal(parseDraftHead('abc', { kind: 'remix', form: 'poster', by: 'u1', at: 5 }), null);
    assert.equal(parseDraftHead('abc', { kind: 'remix', form: 'dashboard', by: '', at: 5 }), null);
    assert.equal(parseDraftHead('abc', { kind: 'remix', form: 'dashboard', by: 'u', at: 0 }), null);
  });

  it('write a head back as a record', () => {
    assert.deepEqual(toDraftHeadRecord(head('d1', 'u1', 3)), { v: 1, kind: 'remix', form: 'dashboard', by: 'u1', at: 3, base: '' });
  });

  it('pick the viewer\'s newest open draft, else anyone\'s', () => {
    const heads = [head('a', 'u1', 1), head('b', 'u2', 3), head('c', 'u1', 2), head('d', 'u1', 9, { saved: true })];
    assert.equal(pickDraftHead(heads, 'u1')?.id, 'c');
    assert.equal(pickDraftHead(heads, 'u3')?.id, 'b');
    assert.equal(pickDraftHead([], 'u1'), null);
    assert.equal(isDraftForArtifact(head('a', 'u', 1), null), true);
    assert.equal(isDraftForArtifact(head('a', 'u', 1, { artifact: 'x' }), null), false);
  });

  it('make ids of twelve base-36 characters', () => {
    assert.equal(newDraftId(new Uint8Array([0, 35, 36, 71])), '0z0z');
    assert.match(newDraftId(), /^[a-z0-9]{12}$/);
  });
});

describe('remix', () => {
  it('names the formats and words the request', () => {
    assert.deepEqual(listRemixForms().map((form) => form.key), ['dashboard', 'scroll-story', 'visual-short', 'visual-analysis']);
    assert.equal(remixFormName('scroll-story'), 'Scrollyteller');
    assert.equal(remixFormName('other'), 'other');
    assert.equal(
      remixPrompt('visual-short', 'abc'),
      'Make a Visual short draft: write it under drafts/abc and leave the current page as it is. Read reference/remix.md first.',
    );
    const selection = remixSelection('dashboard', 'abc');
    assert.equal(selection.label, 'Remix as a Dashboard');
    assert.equal(selection.writeTo, 'drafts/abc');
    assert.equal(remixSelection('visual-short', 'xyz').writeTo, 'drafts/xyz');
    assert.deepEqual(selection.chip, { about: 'remix', form: 'dashboard' });
    assert.match(selection.text, /The format picked is Dashboard \(dashboard\)\. See reference\/remix\.md\.$/);
  });
});

const base = new Map<string, UnknownRecord>([
  ['dash/meta', { title: 'Sales' }],
  ['dash/params', { region: 'EU' }],
  ['datasets/sales', { title: 'Sales', source: { kind: 'call', connector: 'db', tool: 'run', args: { r: '{{region}}' } } }],
  ['datasets/costs', { title: 'Costs', source: { kind: 'file', url: '/_blob/0123456789abcdef0123456789abcdef', name: 'c.csv' } }],
  ['files/index.html', { text: '<p>old</p>' }],
  ['files/old.js', { text: 'x' }],
]);

describe('records', () => {
  it('compose documents into dashboard content', () => {
    const composed = composeDashboardDocuments(base);
    assert.equal(composed.title, 'Sales');
    const content = parseDashboardContent(composed.content);
    assert.deepEqual(content.datasets.map((dataset) => dataset.id).sort(), ['costs', 'sales']);
    assert.deepEqual(content.files.map((file) => file.name), ['index.html', 'old.js']);
    assert.equal(content.params.region, 'EU');
  });

  it('patch removed fields with the delete marker', () => {
    assert.deepEqual(createDeleteFieldPatch({ a: 1, b: { c: 1, d: 2 } }, { b: { c: 3 } }), { a: DELETE_FIELD, b: { c: 3, d: DELETE_FIELD } });
    assert.equal(createDeleteFieldPatch({ a: 1 }, 'x'), 'x');
  });
});

describe('drafts', () => {
  const docs: DraftDocs = new Map<string, UnknownRecord>([
    ['files/index.html', { text: '<p>new</p>' }],
    ['dash/params', { region: 'US' }],
    ['datasets/sales', { title: 'Sales by week', source: { kind: 'call', connector: 'db', tool: 'run', args: { r: '{{region}}', w: true } } }],
    ['datasets/extra', { title: 'Extra', source: { kind: 'file', url: '/_blob/0123456789abcdef0123456789abcdee', name: 'e.csv' } }],
    ['files/chart.js', { text: 'draw()' }],
    ['dash/meta', { title: 'ignored' }],
  ]);

  it('compose a draft from the documents it may hold', () => {
    const draft = composeDraft(docs);
    assert.equal(draft.setsParams, true);
    assert.equal(draft.params.region, 'US');
    assert.deepEqual(draft.datasets.map((dataset) => dataset.id).sort(), ['extra', 'sales']);
    assert.deepEqual(draft.files.map((file) => file.name), ['chart.js', 'index.html']);
    assert.equal(draftHasPage(docs), true);
    assert.equal(draftHasPage(new Map()), false);
  });

  it('apply a draft over the dashboard', () => {
    const content = prepareDashboardContent(composeDashboardDocuments(base).content);
    const shown = applyDraftToContent(content, composeDraft(docs));
    assert.deepEqual(shown.datasets.map((dataset) => dataset.id), content.datasets.map((dataset) => dataset.id).concat('extra'));
    assert.equal(shown.datasets.find((dataset) => dataset.id === 'sales')?.title, 'Sales by week');
    const sales = shown.datasets.find((dataset) => dataset.id === 'sales')?.source;
    assert.ok(sales?.kind === 'query');
    assert.equal(JSON.parse(sales.args).r, 'US');
    assert.deepEqual(shown.files.map((file) => file.name), ['chart.js', 'index.html']);
  });

  it('keeps every source of a draft over the dashboard when the page prepares it again', () => {
    const content = prepareDashboardContent(composeDashboardDocuments(base).content);
    // A draft of the page alone: the shown content is the dashboard's sources with the draft's page.
    const shown = applyDraftToContent(content, composeDraft(new Map([['files/index.html', { text: '<main>Draft</main>' }]])));
    assert.equal(shown.datasets.length, content.datasets.length);
    assert.equal(prepareDashboardContent(shown), shown);
    assert.equal(parseDashboardContent(shown), shown);
    assert.deepEqual(prepareDashboardContent(shown).datasets.map((dataset) => dataset.id), content.datasets.map((dataset) => dataset.id));
  });

  it('plan a save: datasets, then dash, then files, the entry page last; old files removed', () => {
    const content = prepareDashboardContent(composeDashboardDocuments(base).content);
    const plan = planDraftSave(content.files, docs);
    assert.deepEqual(plan.write.map(([path]) => path), ['datasets/extra', 'datasets/sales', 'dash/params', 'files/chart.js', 'files/index.html']);
    assert.deepEqual(plan.remove, ['files/old.js']);
  });

  it('hash what a draft was made from', () => {
    const content = prepareDashboardContent(composeDashboardDocuments(base).content);
    const hash = dashboardContentHash(content);
    assert.match(hash, /^[0-9a-f]{16}$/);
    assert.equal(dashboardContentHash(prepareDashboardContent(composeDashboardDocuments(new Map(base)).content)), hash);
    const changed = applyDraftToContent(content, composeDraft(docs));
    assert.notEqual(dashboardContentHash(changed), hash);
  });

  it('compare draft documents by value', () => {
    assert.equal(areDraftDocsEqual(new Map([['a', { x: 1, y: 2 }]]), new Map([['a', { y: 2, x: 1 }]])), true);
    assert.equal(areDraftDocsEqual(new Map([['a', { x: 1 }]]), new Map([['a', { x: 2 }]])), false);
  });
});
