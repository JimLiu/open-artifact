#!/usr/bin/env node
// Makes the sheets showcase: Juniper Coffee's spring launch budget, a workbook of four sheets.
//
// The workbook is written here once, as the edits an agent sends (`demo.replay.steps`: the title and headers, the
// rows, the formulas and rules, the other sheets, the charts), and this script runs them through the real Sheets store
// (the type's CLI, artifact-types/sheets/scripts/cli.mjs) over a new Sheet with one blank sheet (`START`). It writes:
//
//   showcase/sheets/sheet/…    the workbook those edits end with: the plain demo's seed
//   demos/sheets.demo.json     the demo: the same edits as its replay's steps (so a replay ends with the same
//                              workbook), the simulated agent's responses and the replay's comment
//
//   node website/playground/showcase/sheets/make.mjs && node website/playground/scripts/make-seeds.mjs sheets
//   node website/playground/showcase/sheets/make.mjs --dry     # build and check only, write nothing
//
// It also runs the store's check on the result and tries the agent's responses twice over on a copy, so a turn that
// comes round again is never refused as changing nothing. This file is not part of the artifact (the demo `omit`s it).
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..', '..', '..');
const CLI = path.join(REPO, 'artifact-types/sheets/scripts/cli.mjs');
const OUT = HERE;
const DEMO = path.join(REPO, 'website/playground/demos/sheets.demo.json');
const dry = process.argv.includes('--dry');
/** Where the workbook is built before it is put in place. */
const WORK = fs.mkdtempSync(path.join(os.tmpdir(), 'sheets-showcase-'));

// ================================================= the demo =================================================

// ---- the skeleton: a new Sheet with one blank sheet (fixed, so the first sheet's ids never change) ----
export const SHEET_ID = 'sht_njgjwknije.0';
export const ROW = (n) => `row_njgjwknije.${n - 1}`; // row number → id
export const COL = (letter) => `col_njgjwknije.${letter.charCodeAt(0) - 65}`;
export const TITLE = 'Spring launch budget';
export const START = {
  'sheet/sheet.json': `${JSON.stringify({ id: 'ebb4372e-103f-415d-a220-a7b321e9b234', createdAt: '2026-11-27T08:27:41.025Z', title: TITLE }, null, 2)}\n`,
  'sheet/edits.jsonl':
    '{"revision":1,"v":17,"base":0,"ops":[{"kind":"insertSheet","sheetId":"sht_njgjwknije.0","name":"Sheet1","after":null},{"kind":"insertRows","sheetId":"sht_njgjwknije.0","after":null,"rows":{"base":"row_njgjwknije","first":0,"count":1000}},{"kind":"insertColumns","sheetId":"sht_njgjwknije.0","after":null,"columns":{"base":"col_njgjwknije","first":0,"count":26}}],"by":"agent","at":"2026-11-27T08:27:41.062Z"}\n',
};

// ---- the charts' widgets (fixed ids; the code is the type's own stock programs, see below) ----
export const WIDGETS = {
  bars: { id: '5b7f5e20-4f2f-4c25-8a3c-c2562b000001', kind: 'horizontalBar' },
  line: { id: '5b7f5e20-4f2f-4c25-8a3c-c2562b000002', kind: 'line' },
};

// ---- colors ----
const rgb = (hex) => ({ kind: 'rgb', hex });
const std = (hue, shade) => ({ kind: 'standard', hue, shade });
const FOREST = rgb('#20402f');
const MOSS = rgb('#5b7f5e');
const WHITE = rgb('#ffffff');
const NONE = { kind: 'none' };
const thin = { kind: 'line', style: 'thin', color: NONE };

const MONEY = { numberFormat: { pattern: '$#,##0' } };
const SIGNED = { numberFormat: { pattern: '+$#,##0;-$#,##0;$0' } };
const header = (sheet, range, numbers) => [
  { kind: 'formatCells', sheet, ranges: [range], format: { fillColor: FOREST, font: { color: WHITE } } },
  { kind: 'formatCells', sheet, ranges: [numbers], format: { alignment: { horizontal: 'right' } } },
];
/** The list of rules a sheet with no rules yet reads as. */
const NO_RULES = '4f53cda18c2baa0c';
const overAndUnder = (cells) => [
  { cells, effect: { kind: 'formatWhere', allOf: [{ tested: { kind: 'theCellItself' }, condition: { kind: 'numberIs', comparison: 'lessThan', operand: { kind: 'number', number: 0 } } }], format: { fillColor: std('red', 100), font: { color: std('red', 800) } } } },
  { cells, effect: { kind: 'formatWhere', allOf: [{ tested: { kind: 'theCellItself' }, condition: { kind: 'numberIs', comparison: 'greaterThan', operand: { kind: 'number', number: 0 } } }], format: { font: { color: std('green', 800) } } } },
];

// ---- Budget ----
const ITEMS = [
  ['Paid social ads', 'Paid', 9000, 8400],
  ['Creator partnerships', 'Paid', 6000, 6750],
  ['Launch party venue', 'Events', 5000, 4200],
  ['Café pop-ups', 'Events', 3500, 3300],
  ['Launch film', 'Content', 7500, 7900],
  ['Welcome email series', 'Email', 1200, 950],
  ['Referral rewards', 'Email', 2000, 1400],
  ['Sample kits', 'Sampling', 4800, 4350],
  ['Tasting cards', 'Sampling', 1100, 1240],
];
const FIRST = 3;
const LAST = FIRST + ITEMS.length - 1; // 11
const TOTAL = LAST + 1; // 12
const CHANNELS = [
  ['Paid', std('blue', 200)],
  ['Events', std('orange', 200)],
  ['Content', std('purple', 200)],
  ['Email', std('teal', 200)],
  ['Sampling', std('green', 200)],
];

const budgetHead = [
  { kind: 'renameSheet', sheet: 'Sheet1', name: 'Budget' },
  { kind: 'writeCells', sheet: 'Budget', topLeft: 'A1', rows: [['Spring launch budget']] },
  { kind: 'writeCells', sheet: 'Budget', topLeft: 'A2', rows: [['Line item', 'Channel', 'Planned', 'Actual', 'Variance']] },
  { kind: 'mergeCells', sheet: 'Budget', ranges: ['A1:E1'] },
  { kind: 'formatCells', sheet: 'Budget', ranges: ['A1:E1'], format: { font: { bold: true, size: 14, color: FOREST } } },
  ...header('Budget', 'A2:E2', 'C2:E2'),
  { kind: 'setCellTable', sheet: 'Budget', cellTable: { columns: 'A:E', headerRows: '2', footerRows: null } },
  { kind: 'setColumnWidths', sheet: 'Budget', columns: 'A', widthInPixels: 152 },
  { kind: 'setColumnWidths', sheet: 'Budget', columns: 'B', widthInPixels: 92 },
  { kind: 'setColumnWidths', sheet: 'Budget', columns: 'C:E', widthInPixels: 74 },
  { kind: 'setColumnWidths', sheet: 'Budget', columns: 'F', widthInPixels: 24 },
  { kind: 'setColumnWidths', sheet: 'Budget', columns: 'G', widthInPixels: 88 },
];

const budgetRows = [
  { kind: 'writeCells', sheet: 'Budget', topLeft: `A${FIRST}`, rows: ITEMS },
  { kind: 'makeDropdown', sheet: 'Budget', range: `B${FIRST}:B${LAST}`, options: CHANNELS.map(([label, color]) => ({ label, color })) },
  { kind: 'formatCells', sheet: 'Budget', ranges: [`C${FIRST}:D${TOTAL}`], format: MONEY },
];

const budgetSums = [
  { kind: 'writeCells', sheet: 'Budget', topLeft: `E${FIRST}`, rows: ITEMS.map((_, i) => [`=C${FIRST + i}-D${FIRST + i}`]) },
  { kind: 'writeCells', sheet: 'Budget', topLeft: `A${TOTAL}`, rows: [['Total', null, `=SUM(C${FIRST}:C${LAST})`, `=SUM(D${FIRST}:D${LAST})`, `=C${TOTAL}-D${TOTAL}`]] },
  { kind: 'formatCells', sheet: 'Budget', ranges: [`E${FIRST}:E${TOTAL}`], format: SIGNED },
  { kind: 'formatCells', sheet: 'Budget', ranges: [`A${TOTAL}:E${TOTAL}`], format: { font: { bold: true } } },
  { kind: 'setBorders', sheet: 'Budget', range: `A${TOTAL}:E${TOTAL}`, edges: 'top', border: thin },
  { kind: 'setCellTable', sheet: 'Budget', cellTable: { columns: 'A:E', headerRows: '2', footerRows: String(TOTAL) } },
  { kind: 'saveNamedRange', name: 'Channels', sheet: 'Budget', range: `B${FIRST}:B${LAST}` },
  { kind: 'saveNamedRange', name: 'Planned', sheet: 'Budget', range: `C${FIRST}:C${LAST}` },
  { kind: 'saveNamedRange', name: 'Actual', sheet: 'Budget', range: `D${FIRST}:D${LAST}` },
  // The headline over the chart: text, worked out from the totals.
  { kind: 'writeCells', sheet: 'Budget', topLeft: 'G1', rows: [[`=TEXT(D${TOTAL},"$#,##0")`, `="spent of "&TEXT(C${TOTAL},"$#,##0")&" planned · "&TEXT(D${TOTAL}/C${TOTAL},"0%")`]] },
  { kind: 'formatCells', sheet: 'Budget', ranges: ['G1'], format: { font: { bold: true, size: 14, color: FOREST } } },
  { kind: 'formatCells', sheet: 'Budget', ranges: ['H1'], format: { font: { color: MOSS }, alignment: { vertical: 'center' } } },
];
const budgetRules = [{ kind: 'replaceConditionalFormats', sheet: 'Budget', inPlaceOf: NO_RULES, rules: overAndUnder([`E${FIRST}:E${TOTAL}`]) }];

// ---- By channel ----
const SIGNED_OFF = ['Paid', 'Email', 'Sampling'];
const byChannel = [
  { kind: 'addSheet', name: 'By channel' },
  { kind: 'writeCells', sheet: 'By channel', topLeft: 'A1', rows: [
    ['Channel', 'Planned', 'Actual', 'Variance', 'Used', 'Signed off'],
    ...CHANNELS.map(([label], i) => [label, `=SUMIF(Channels,A${i + 2},Planned)`, `=SUMIF(Channels,A${i + 2},Actual)`, `=B${i + 2}-C${i + 2}`, `=C${i + 2}/B${i + 2}`, SIGNED_OFF.includes(label)]),
    ['Total', '=SUM(B2:B6)', '=SUM(C2:C6)', '=B7-C7', '=C7/B7', null],
  ] },
  ...header('By channel', 'A1:F1', 'B1:E1'),
  { kind: 'formatCells', sheet: 'By channel', ranges: ['F1'], format: { alignment: { horizontal: 'center' } } },
  { kind: 'formatCells', sheet: 'By channel', ranges: ['F2:F6'], format: { cellControl: { kind: 'checkbox' } } },
  { kind: 'saveProtection', sheet: 'By channel', range: 'B2:E7' },
  { kind: 'formatCells', sheet: 'By channel', ranges: ['B2:C7'], format: MONEY },
  { kind: 'formatCells', sheet: 'By channel', ranges: ['D2:D7'], format: SIGNED },
  { kind: 'formatCells', sheet: 'By channel', ranges: ['E2:E7'], format: { numberFormat: { pattern: '0%' } } },
  { kind: 'formatCells', sheet: 'By channel', ranges: ['A7:E7'], format: { font: { bold: true } } },
  { kind: 'setBorders', sheet: 'By channel', range: 'A7:F7', edges: 'top', border: thin },
  { kind: 'setCellTable', sheet: 'By channel', cellTable: { columns: 'A:F', headerRows: '1', footerRows: '7' } },
  { kind: 'setColumnWidths', sheet: 'By channel', columns: 'A', widthInPixels: 120 },
  { kind: 'setColumnWidths', sheet: 'By channel', columns: 'B:F', widthInPixels: 88 },
];
const byChannelRules = [
  { kind: 'replaceConditionalFormats', sheet: 'By channel', inPlaceOf: NO_RULES, rules: [
    ...overAndUnder(['D2:D7']),
    { cells: ['E2:E6'], effect: { kind: 'colorScale', lowest: { anchor: { kind: 'smallestNumber' }, color: NONE }, middle: null, highest: { anchor: { kind: 'largestNumber' }, color: std('orange', 200) } } },
  ] },
];

// ---- Forecast ----
const MONTHS = ['Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec', 'Jan', 'Feb'];
const F0 = 8; // the first month's row
const FN = F0 + MONTHS.length - 1; // 19
const forecast = [
  { kind: 'addSheet', name: 'Forecast' },
  { kind: 'writeCells', sheet: 'Forecast', topLeft: 'A1', rows: [
    ['Subscribers at launch', 1200],
    ['Monthly growth', 0.09],
    ['Monthly churn', 0.035],
    ['Price per month', 18],
  ] },
  { kind: 'saveNamedRange', name: 'LaunchSubscribers', sheet: 'Forecast', range: 'B1' },
  { kind: 'saveNamedRange', name: 'Growth', sheet: 'Forecast', range: 'B2' },
  { kind: 'saveNamedRange', name: 'Churn', sheet: 'Forecast', range: 'B3' },
  { kind: 'saveNamedRange', name: 'Price', sheet: 'Forecast', range: 'B4' },
  { kind: 'writeCells', sheet: 'Forecast', topLeft: 'A5', rows: [['Launch cost per new subscriber', `=Budget!D${TOTAL}/SUM(C${F0}:C${FN})`]] },
  { kind: 'writeCells', sheet: 'Forecast', topLeft: 'A7', rows: [
    ['Month', 'Subscribers', 'New', 'Churned', 'MRR'],
    ...MONTHS.map((month, i) => {
      const r = F0 + i;
      const before = i === 0 ? 'LaunchSubscribers' : `B${r - 1}`;
      return [month, `=${before}+C${r}-D${r}`, `=ROUND(${before}*Growth,0)`, `=ROUND(${before}*Churn,0)`, `=B${r}*Price`];
    }),
  ] },
  ...header('Forecast', 'A7:E7', 'B7:E7'),
  { kind: 'formatCells', sheet: 'Forecast', ranges: ['B1:B4'], format: { fillColor: std('yellow', 100) } },
  { kind: 'formatCells', sheet: 'Forecast', ranges: ['B1', `B${F0}:D${FN}`], format: { numberFormat: { pattern: '#,##0' } } },
  { kind: 'formatCells', sheet: 'Forecast', ranges: ['B2'], format: { numberFormat: { pattern: '0%' } } },
  { kind: 'formatCells', sheet: 'Forecast', ranges: ['B3'], format: { numberFormat: { pattern: '0.0%' } } },
  { kind: 'formatCells', sheet: 'Forecast', ranges: ['B4', `E${F0}:E${FN}`], format: MONEY },
  { kind: 'formatCells', sheet: 'Forecast', ranges: ['B5'], format: { numberFormat: { pattern: '$#,##0.00' }, font: { bold: true } } },
  { kind: 'setDefaultValues', sheet: 'Forecast', range: 'B1', defaultValue: 1200, limits: { minimum: 0, maximum: null } },
  { kind: 'setDefaultValues', sheet: 'Forecast', range: 'B2', defaultValue: 0.09, limits: { minimum: 0, maximum: 0.5 } },
  { kind: 'setDefaultValues', sheet: 'Forecast', range: 'B3', defaultValue: 0.035, limits: { minimum: 0, maximum: 0.5 } },
  { kind: 'setDefaultValues', sheet: 'Forecast', range: 'B4', defaultValue: 18, limits: { minimum: 1, maximum: 100 } },
  { kind: 'setCellTable', sheet: 'Forecast', cellTable: { columns: 'A:E', headerRows: '7', footerRows: null } },
  { kind: 'setColumnWidths', sheet: 'Forecast', columns: 'A', widthInPixels: 208 },
  { kind: 'setColumnWidths', sheet: 'Forecast', columns: 'B:E', widthInPixels: 88 },
  { kind: 'setColumnWidths', sheet: 'Forecast', columns: 'F', widthInPixels: 28 },
];

// ---- Changes: what the agent changed, newest first ----
const changes = [
  { kind: 'addSheet', name: 'Changes' },
  { kind: 'writeCells', sheet: 'Changes', topLeft: 'A1', rows: [
    ['#', 'Asked', 'Changed'],
    [0, 'A launch budget by channel, with a chart and a subscriber forecast', 'Built Budget, By channel and Forecast'],
  ] },
  { kind: 'formatCells', sheet: 'Changes', ranges: ['A1:C1'], format: { fillColor: FOREST, font: { color: WHITE } } },
  { kind: 'formatCells', sheet: 'Changes', ranges: ['B2:C40'], format: { alignment: { wrap: true } } },
  { kind: 'setCellTable', sheet: 'Changes', cellTable: { columns: 'A:C', headerRows: '1', footerRows: null } },
  { kind: 'setSheetSettings', sheet: 'Changes', settings: { lastFrozenRow: 1 } },
  { kind: 'setColumnWidths', sheet: 'Changes', columns: 'A', widthInPixels: 44 },
  { kind: 'setColumnWidths', sheet: 'Changes', columns: 'B:C', widthInPixels: 340 },
];

// ---- the charts ----
const charts = [
  { kind: 'addChart', chart: {
    name: 'Planned and actual by channel', caption: 'Planned and actual spend for each launch channel, summed on the By channel sheet',
    widget: WIDGETS.bars.id, inputs: [{ name: 'rows', cells: { sheet: 'By channel', range: 'A1:C6' } }],
    sheet: 'Budget', topLeft: 'G2', widthInPixels: 324, heightInPixels: 308,
  } },
  { kind: 'addChart', chart: {
    name: 'Subscribers by month', caption: 'Forecast subscribers for the twelve months after launch',
    widget: WIDGETS.line.id, inputs: [{ name: 'rows', cells: { sheet: 'Forecast', range: `A7:B${FN + 24}` } }],
    sheet: 'Forecast', topLeft: 'G1', widthInPixels: 480, heightInPixels: 300,
  } },
];

// ---- the agent's turns ----
/** A line on Changes for this turn, under the header: always a change, so no turn is refused for changing nothing. */
const logged = (what) => [
  { kind: 'insertRows', sheet: 'Changes', besideRow: 1, side: 'below', count: 1 },
  { kind: 'writeCells', sheet: 'Changes', topLeft: 'A2', rows: [['{{n}}', '“{{request}}”', what]] },
];
const VENUE = FIRST + 2; // row 5
const responses = [
  {
    reply: {
      en: `Done. Launch party venue (Budget!D${VENUE}) is now $5,600: $600 over plan, so its variance turned red and Events passed its plan in the chart. Total spend went from {{was}} to {{now}}.`,
      zh: `改好了。发布派对场地（Budget!D${VENUE}）的实际支出现在是 $5,600，比计划多 $600，所以差额变红，图表里 Events 也超过了计划。总支出从 {{was}} 变成 {{now}}。`,
    },
    edits: [{
      kind: 'sheet-edits',
      edits: [...logged(`Budget!D${VENUE}: Launch party venue actual is $5,600`), { kind: 'writeCells', sheet: 'Budget', topLeft: `D${VENUE}`, rows: [[5600]] }],
      watch: { sheet: 'Budget', cell: 'G1' },
    }],
  },
  {
    reply: {
      en: 'Here’s my pass at “{{request}}”: a new Contingency line on Budget, $1,500 planned under Events and nothing spent yet. The totals, the sums by channel and the chart all picked it up, and it’s logged on the Changes sheet.',
      zh: '针对“{{request}}”，我先这样处理：在 Budget 里加了一行 Contingency（应急预留），归在 Events 下，计划 $1,500，暂未支出。合计、按渠道汇总和图表都已跟着更新，Changes 工作表里也记了一笔。',
    },
    edits: [{
      kind: 'sheet-edits',
      edits: [
        ...logged('Budget: a Contingency line, $1,500 planned under Events'),
        { kind: 'insertRows', sheet: 'Budget', besideRow: LAST, side: 'above', count: 1 },
        { kind: 'writeCells', sheet: 'Budget', topLeft: `A${LAST}`, rows: [['Contingency', 'Events', 1500, 0, `=C${LAST}-D${LAST}`]] },
      ],
    }],
  },
  {
    reply: {
      en: 'For “{{request}}” I moved $1,000 of plan from Paid social ads to Creator partnerships. The total plan stays put, but Paid social ads is now over plan (red) and Creator partnerships is back under (green).',
      zh: '针对“{{request}}”，我把 $1,000 的计划额度从 Paid social ads 挪到了 Creator partnerships。计划总额不变，但 Paid social ads 现在超出计划（红色），Creator partnerships 回到了计划之内（绿色）。',
    },
    edits: [{
      kind: 'sheet-edits',
      edits: [...logged('Budget!C3:C4: $1,000 of plan moved from Paid social ads to Creator partnerships'), { kind: 'writeCells', sheet: 'Budget', topLeft: 'C3', rows: [[8000], [7000]] }],
    }],
  },
];

const step = (say, ms, ...edits) => ({ say, ms, ...(edits.length ? { edits: edits.map((list) => ({ kind: 'sheet-edits', edits: list })) } : {}) });

export const demo = {
  id: 'sheets',
  type: 'sheets',
  typeTitle: 'Sheets',
  title: TITLE,
  source: 'website/playground/showcase/sheets',
  omit: ['make.mjs'],
  agent: { name: 'Agent', thinkMs: 2500, responses },
  replay: {
    prompt: {
      en: '/open-artifact sheets Juniper’s spring launch budget: line items by channel, planned vs actual, a chart, and a 12-month subscriber forecast',
      zh: '/open-artifact sheets Juniper 春季发布的预算表：按渠道列出各项的计划与实际支出，配一张图表，再加 12 个月的订阅预测',
    },
    start: START,
    steps: [
      step('Read the sheets type’s guide', 500),
      step('ArtifactData · update Budget: title, headers, table', 800, budgetHead),
      step('ArtifactData · update Budget: 9 line items, channel dropdowns', 1000, budgetRows),
      step('ArtifactData · update Budget: variance, totals, named ranges, rules', 1100, budgetSums, budgetRules),
      step('ArtifactData · update By channel: SUMIF over the named ranges', 1000, byChannel, byChannelRules),
      step('ArtifactData · update Forecast: assumptions, 12 months, defaults and limits', 1000, forecast),
      step('ArtifactData · batch 2 charts, and a Changes log', 1000, changes, charts),
      step('Artifact · call check', 600),
    ],
    made: {
      en: 'The launch budget is ready: 9 line items with variance and totals on Budget, sums by channel that feed the chart, and a 12-month subscriber forecast. Comment on any cell you want changed.',
      zh: '发布预算做好了：Budget 里有 9 个项目，带差额和合计；按渠道的汇总驱动那张图表；还有 12 个月的订阅预测。想改哪个单元格，直接在上面评论。',
    },
    comment: {
      text: {
        en: 'The venue’s final invoice came to $5,600. Use that here',
        zh: '场地的最终账单是 $5,600，这里按这个数改',
      },
      anchor: `cells:${SHEET_ID}/${ROW(VENUE)}/${COL('D')}`,
      label: `D${VENUE}`,
      detail: 'The cells are on sheetNumber 1, where 1 is the first of the sheets that readSheets lists, as the sheets stood when the comment was begun. The numbers in the ids of the path are not positions.',
      // Where D5 is in a 1200 × 720 window; src/replay/types/sheets.ts finds the cell itself at any size.
      at: [0.46, 0.42],
    },
  },
};

// ================================================= the build =================================================

const cli = (...args) => {
  try {
    return execFileSync(process.execPath, [CLI, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (error) {
    throw new Error(`${args.slice(0, 2).join(' ')}: ${error.stderr || error.message}`);
  }
};
const json = (...args) => JSON.parse(cli(...args));
const fresh = (name) => {
  const dir = path.join(WORK, name);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
};
let payloads = 0;
const update = (root, edits) => {
  const base = json('info', root).revision;
  const file = path.join(WORK, `payload-${payloads++}.json`);
  fs.writeFileSync(file, JSON.stringify({ kind: 'applyEdits', base, edits }));
  try {
    return json('update', root, file);
  } finally {
    fs.rmSync(file);
  }
};

// 1. The widgets: the type's stock chart programs, checked by the store itself, then kept under fixed ids.
const stock = (await import(pathToFileURL(path.join(REPO, 'packages/sheets-core/src/agent/stock-charts.ts')).href)).STOCK_CHART_PROGRAMS;
const probe = fresh('probe');
const widgets = {};
for (const [name, { id, kind, code = stock[kind] }] of Object.entries(WIDGETS)) {
  const file = path.join(probe, `${name}.jsx`);
  fs.writeFileSync(file, code);
  const made = json('widget', probe, 'create', file);
  if (made.outcome !== 'published') throw new Error(`widget ${name}: ${JSON.stringify(made)}`);
  widgets[id] = { id, code, pub: 1, published: code, errors: [], at: '2026-11-27T08:30:00.000Z' };
}

// 2. The workbook: the skeleton, then each step's edits.
const stage = fresh('stage');
for (const [rel, text] of Object.entries(demo.replay.start)) {
  fs.mkdirSync(path.dirname(path.join(stage, rel)), { recursive: true });
  fs.writeFileSync(path.join(stage, rel), text);
}
fs.mkdirSync(path.join(stage, 'sheet/widgets'), { recursive: true });
for (const widget of Object.values(widgets)) fs.writeFileSync(path.join(stage, 'sheet/widgets', `${widget.id}.json`), `${JSON.stringify(widget, null, 2)}\n`);
for (const step of demo.replay.steps) {
  for (const edit of step.edits ?? []) {
    if (edit.kind !== 'sheet-edits') throw new Error(`a step of kind ${edit.kind}`);
    const answer = update(stage, edit.edits);
    console.log(`${step.say} → ${JSON.stringify(answer)}`);
    if (answer.changedNothing) throw new Error('an edit of a step changes nothing');
  }
}
console.log(cli('check', stage).trim());
const sheets = json('read', stage);
console.log(JSON.stringify(sheets.sheets.map((s) => [s.name, s.filledRange, s.chartCount ?? 0])), JSON.stringify(sheets.namedRanges));
const show = (sheet, range) => {
  const read = json('read', stage, JSON.stringify({ kind: 'readCells', sheet, range }));
  for (const [n, row] of Object.entries(read.rows)) {
    console.log(`  ${sheet}!${n}: ${row.map((c) => (c && typeof c === 'object' ? (c.value && typeof c.value === 'object' ? c.value.shown ?? JSON.stringify(c.value) : c.value ?? c.shown ?? JSON.stringify(c)) : c)).join(' | ')}`);
  }
  if (read.columnsTooNarrowForTheirNumbers) console.log(`  TOO NARROW: ${JSON.stringify(read.columnsTooNarrowForTheirNumbers)}`);
};
show('Budget', 'A1:H14');
show('By channel', 'A1:E7');
show('Forecast', 'A1:E19');
show('Changes', 'A1:C3');

// 3. The agent's turns, on a copy: two rounds.
const trial = fresh('trial');
fs.cpSync(stage, trial, { recursive: true });
const fill = (value, vars) => {
  if (typeof value === 'string') return value.replace(/\{\{(\w+)\}\}/g, (all, name) => vars[name] ?? all);
  if (Array.isArray(value)) return value.map((item) => fill(item, vars));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, fill(v, vars)]));
  return value;
};
const text = (root, sheet, cell) => {
  const v = Object.values(json('read', root, JSON.stringify({ kind: 'readCells', sheet, range: cell })).rows ?? {})[0]?.[0];
  const value = v && typeof v === 'object' && 'value' in v ? v.value : v;
  return typeof value === 'number' ? value.toLocaleString('en-US') : String(value);
};
for (let turn = 1; turn <= 2 * demo.agent.responses.length; turn++) {
  const response = demo.agent.responses[(turn - 1) % demo.agent.responses.length];
  const vars = { n: String(turn), request: `Request number ${turn}` };
  for (const edit of response.edits) {
    const filled = fill(edit, vars);
    if (filled.watch) vars.was = text(trial, filled.watch.sheet, filled.watch.cell);
    update(trial, filled.edits);
    if (filled.watch) vars.now = text(trial, filled.watch.sheet, filled.watch.cell);
  }
  console.log(`turn ${turn}: ${fill(response.reply.en, vars)}`);
}
console.log(cli('check', trial).trim());

// 4. Out.
if (!dry) {
  fs.writeFileSync(DEMO, `${JSON.stringify(demo, null, 2)}\n`);
  fs.rmSync(path.join(OUT, 'sheet'), { recursive: true, force: true });
  fs.mkdirSync(path.join(OUT, 'sheet/widgets'), { recursive: true });
  for (const rel of ['sheet/sheet.json', 'sheet/edits.jsonl']) fs.copyFileSync(path.join(stage, rel), path.join(OUT, rel));
  for (const name of fs.readdirSync(path.join(stage, 'sheet/widgets'))) fs.copyFileSync(path.join(stage, 'sheet/widgets', name), path.join(OUT, 'sheet/widgets', name));
  console.log(`wrote ${path.relative(REPO, DEMO)} and ${path.relative(REPO, OUT)}/sheet/`);
}
fs.rmSync(WORK, { recursive: true, force: true });
