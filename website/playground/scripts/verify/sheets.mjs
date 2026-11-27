// The sheets demo: its checks (see ../verify.mjs). The showcase is Juniper's spring launch budget: nine line items by
// channel with planned, actual and variance (Budget), sums by channel over named ranges that feed a chart beside the
// table (By channel), a twelve-month subscriber forecast with its own chart (Forecast), and a log of what the agent
// changed (Changes).
import { IN_EDITOR_AT, IN_FRAME, agentRoundTrip, check, cleanRun, clickInEditor, demoUrl, launch, openDemo, replay, shot, sleep, waitTop } from './lib.mjs';

/** The grid cell at an address of the sheet that shows (in the editor frame's document). */
const CELL = (address) => `document.querySelector('[role=gridcell][aria-colindextext="${/^[A-Z]+/.exec(address)[0]}"][aria-rowindextext="${/\d+$/.exec(address)[0]}"]')`;
/** That cell shows `text`. */
const SHOWS = (address, text) => `${CELL(address)}?.textContent.trim() === ${JSON.stringify(text)}`;
/** A cell's value, from the Sheets store itself (an agent read): a formula's answer, a formatted number's number. */
const SHEET_VALUE = (sheet, cell) => `(v => { v = v && typeof v === 'object' && 'value' in v ? v.value : v; return v && typeof v === 'object' && 'number' in v ? v.number : v; })(Object.values(window.__PLAYGROUND__.engines.sheet.agentRead({ kind: 'readCells', sheet: ${JSON.stringify(sheet)}, range: ${JSON.stringify(cell)} }).rows ?? {})[0]?.[0])`;
/** The chart beside the budget, in its own frame: what it draws. */
const CHART = `document.querySelector('svg[role=img][aria-label="Planned and Actual by Channel"]')?.innerHTML`;
/** A fill that is not the sheet's own white (a conditional format's). */
const FILLED = (address) => `(c => !!c && getComputedStyle(c).backgroundColor !== 'rgb(255, 255, 255)')(${CELL(address)})`;

/**
 * What a workbook is made of, from the store: every sheet's cells as they were written (a formula's text, not its
 * answer), its table, rules, dropdowns, protected cells and charts, and the workbook's named ranges. Ids the store
 * makes up as it goes are left out.
 */
const WORKBOOK = `(() => {
  const read = (payload) => window.__PLAYGROUND__.engines.sheet.agentRead(payload);
  const written = (c) => (c && typeof c === 'object' ? ('formula' in c ? c.formula : 'number' in c ? c.number : JSON.stringify(c)) : c);
  const book = read({ kind: 'readSheets' });
  return {
    names: book.namedRanges,
    sheets: book.sheets.map((s) => {
      const cells = read({ kind: 'readCells', sheet: s.name, range: s.filledRange });
      return {
        name: s.name,
        filled: s.filledRange,
        table: s.cellTable ?? null,
        frozen: s.lastFrozenRow ?? null,
        protects: (s.protections ?? []).map((p) => p.protects),
        rules: read({ kind: 'readConditionalFormats', sheet: s.name }).rules,
        formats: JSON.stringify(read({ kind: 'readCellFormats', sheet: s.name, range: s.filledRange }).formats).replace(/ddn_\\w+\\.\\d+/g, 'ddn'),
        dropdowns: (cells.dropdowns ?? []).map((d) => [d.ranges, d.options.map((o) => o.label)]),
        merged: cells.mergedRanges ?? [],
        charts: read({ kind: 'readCharts', sheet: s.name }).charts.map((c) => c.chart),
        cells: Object.fromEntries(Object.entries(cells.rows ?? {}).map(([n, row]) => [n, row.map(written)])),
      };
    }),
  };
})()`;
/** A workbook without what the agent's first answer changes: the venue's actual (Budget!D5) and the Changes log. */
function beforeTheAnswer(book) {
  for (const sheet of book.sheets) {
    if (sheet.name === 'Budget') sheet.cells[5][3] = null;
    if (sheet.name === 'Changes') Object.assign(sheet, { filled: null, cells: null, formats: null });
  }
  return book;
}

export default async function sheets(browser) {
  const started = Date.now();
  const page = await openDemo(browser, 'sheets', 2500, IN_FRAME("document.body.innerText.includes('Launch party venue')"));
  let seeded = null;
  try {
    const store = 'window.__PLAYGROUND__.store';
    console.log(`     the Sheets editor showed the seeded workbook ${Date.now() - started} ms after the page was asked for (settle included)`);
    check('the grid renders the seeded workbook', await page.waitFor(IN_FRAME("['Spring launch budget', 'Line item', 'Launch party venue', 'Tasting cards', 'By channel', 'Forecast', 'Changes'].every(t => document.body.innerText.includes(t))"), 15000));
    check("the editor's engine works the totals out ($38,490 of $40,100)", await page.waitFor(IN_FRAME(`${SHOWS('C12', '$40,100')} && ${SHOWS('D12', '$38,490')} && ${SHOWS('E12', '+$1,610')} && ${SHOWS('G1', '$38,490')}`), 10000));
    check('the store (WebAssembly in the page) agrees, across sheets and named ranges', (await page.evaluate(SHEET_VALUE('Budget', 'D12'))) === 38490 && (await page.evaluate(SHEET_VALUE('By channel', 'C7'))) === 38490 && (await page.evaluate(SHEET_VALUE('By channel', 'B3'))) === 8500 && (await page.evaluate(SHEET_VALUE('Forecast', 'B19'))) === 2283);
    check('the table shows its dropdowns, formats and rules', await page.waitFor(IN_FRAME(`${SHOWS('B5', 'Events')} && ${SHOWS('E4', '-$750')} && ${FILLED('E4')} && !${FILLED('E3')} && ${FILLED('A2')}`), 6000));
    check('the chart beside the table draws', await page.waitFor(`(${CHART})?.includes('<path')`, 10000));
    const drawn = (await page.evaluateAll(CHART)).find(Boolean);
    const wasm = [...page.urls].filter((u) => u.endsWith('.wasm'));
    check("the store and the editor's worker load one engine file (the editor's own)", wasm.length >= 1 && wasm.every((u) => /\/editors\/sheets\/assets\/open_artifact_sheets_bg-[\w-]+\.wasm$/.test(u)), wasm.join(', '));
    // Its own request either way: a hashed chunk of the built site, the bundle itself on the dev server.
    check('the engine module loaded on this demo only (its own chunk)', [...page.urls].some((u) => /\/(?:assets\/sheetHost-[\w-]+|src\/engines\/bundles\/sheetHost)\.js(?:\?.*)?$/.test(u)) && ![...page.urls].some((u) => /docHost/.test(u)));
    check('the agent has not changed anything yet', (await page.evaluate(SHEET_VALUE('Budget', 'D5'))) === 4200 && (await page.evaluate(SHEET_VALUE('Changes', 'A2'))) === 0);
    seeded = await page.evaluate(WORKBOOK);
    await shot(page, '27-sheets-loaded');

    // A real edit in the grid: the welcome emails' actual $950 → $1,000; the page sends it (brokered), and the total,
    // the headline over the chart and the sum on the other sheet follow.
    if (await clickInEditor(page, CELL('D8'))) {
      await page.type('1000');
      await page.press('Enter');
      check('typing in a cell saves through the Sheets store', await page.waitFor(`${SHEET_VALUE('Budget', 'D8')} === 1000`, 8000));
      check('…and the formulas follow: the total is $38,540, on the other sheet too', (await page.waitFor(`${SHEET_VALUE('Budget', 'D12')} === 38540 && ${SHEET_VALUE('By channel', 'C5')} === 2400`, 4000)) && (await page.waitFor(IN_FRAME(`${SHOWS('D12', '$38,540')} && ${SHOWS('G1', '$38,540')}`), 6000)));
      check("the person's edit becomes a version in the artifact's history", await page.waitFor(`${store}.history.list().versions.some(v => v.author.kind === 'person' && v.files.some(f => f.path === 'sheet/edits.jsonl'))`, 6000));
    } else check('found the cell D8 to edit', false);
    await page.press('Escape');

    // Comment on the venue's actual, sent to the agent; it sets Budget!D5 to 5600: the variance turns red, the total,
    // the Events sum and the chart follow, and the change is logged on Changes.
    const target = await page.evaluate(IN_EDITOR_AT(CELL('D5')));
    if (!target) check('found the cell D5 to comment on', false);
    else
      await agentRoundTrip(page, {
        target,
        request: 'The venue’s final invoice came to $5,600. Use that here',
        changed: `${SHEET_VALUE('Budget', 'D5')} === 5600 && ${SHEET_VALUE('Budget', 'D12')} === 39940 && ${SHEET_VALUE('By channel', 'C3')} === 8900 && ${SHEET_VALUE('Changes', 'A2')} === 1`,
        shows: IN_FRAME(`${SHOWS('D5', '$5,600')} && ${SHOWS('D12', '$39,940')}`),
        reply: 'Total spend went from $38,540 to $39,940',
        // The sheets editor reports no working state to the Shell (it says "Sent to Agent" and marks the agent's cells).
        showsWorking: false,
        working: '28-sheets-agent-working',
        done: '29-sheets-agent-done',
      });
    check('the comment is on the cell (D5)', await page.evaluate("window.__PLAYGROUND__.comments.list().some(t => t.label === 'D5' && /^cells:[^/]+\\/row_\\w+\\.4\\/col_\\w+\\.3$/.test(t.anchor))"), await page.evaluate('window.__PLAYGROUND__.comments.list()[0]?.anchor'));
    // Close the card: the recalculated cells show under it.
    await page.press('Escape');
    await sleep(600);
    check('the new total, the red variance and the headline show in the grid', await page.waitFor(IN_FRAME(`(c => !!c && c.getBoundingClientRect().width > 0)(${CELL('D12')}) && ${SHOWS('D12', '$39,940')} && ${SHOWS('E5', '-$600')} && ${FILLED('E5')} && ${SHOWS('G1', '$39,940')}`), 4000));
    check('the chart draws the new sums', await page.waitFor(`(html => !!html && html !== ${JSON.stringify(drawn ?? '')})(${CHART})`, 6000));
    await shot(page, '30-sheets-agent-total');

    // The agent's next turn, whatever is asked: a Contingency line inside the table. The totals, the named ranges and
    // the Events sum take it in.
    await page.evaluate(IN_FRAME("w.openartifact.use('agent').then(a => a.send({ text: 'Keep some room for surprises' }))"));
    check('a second agent turn adds a line to the table (backend: plan total 41,600)', await page.waitFor(`${SHEET_VALUE('Budget', 'A11')} === 'Contingency' && ${SHEET_VALUE('Budget', 'C13')} === 41600 && ${SHEET_VALUE('By channel', 'B3')} === 10000`, 8000));
    check('…the named ranges grew with it', await page.evaluate("window.__PLAYGROUND__.engines.sheet.agentRead({ kind: 'readNamedRanges' }).namedRanges.some(n => n.name === 'Planned' && n.address === 'Budget!C3:C12')"));
    check('…and the grid shows the line and the new total live', await page.waitFor(IN_FRAME(`${SHOWS('A11', 'Contingency')} && ${SHOWS('B11', 'Events')} && ${SHOWS('C13', '$41,600')}`), 8000));
    // The third: $1,000 of plan moves between two lines; one variance turns red, the other green.
    await page.evaluate(IN_FRAME("w.openartifact.use('agent').then(a => a.send({ text: 'Creators are doing the work here' }))"));
    check('a third agent turn moves plan between two lines (backend)', await page.waitFor(`${SHEET_VALUE('Budget', 'C3')} === 8000 && ${SHEET_VALUE('Budget', 'C4')} === 7000 && ${SHEET_VALUE('Budget', 'E3')} === -400 && ${SHEET_VALUE('Budget', 'C13')} === 41600`, 8000));
    check('…and the rules recolor the two variances live', await page.waitFor(IN_FRAME(`${SHOWS('E3', '-$400')} && ${FILLED('E3')} && ${SHOWS('E4', '+$250')} && !${FILLED('E4')}`), 8000));
    check('every turn is logged on the Changes sheet, newest first', (await page.evaluate(SHEET_VALUE('Changes', 'A2'))) === 3 && (await page.evaluate(SHEET_VALUE('Changes', 'B3'))) === '“Keep some room for surprises”' && (await page.evaluate(SHEET_VALUE('Changes', 'A5'))) === 0);
    check('the agent is idle again', await page.waitFor('!window.__PLAYGROUND__.agent.status().busy', 8000));
    await shot(page, '30-sheets-agent-next');
    check("the agent's edit is a revision by the agent in the store's log", await page.evaluate("(() => { const f = window.__PLAYGROUND__.engines.sheet.files(); const lines = new TextDecoder().decode(f['sheet/edits.jsonl']).trim().split('\\n'); return JSON.parse(lines.at(-1)).by === 'agent'; })()"));
    check("…and a version in the artifact's history", await page.waitFor(`${store}.history.list().versions.some(v => v.author.kind === 'agent')`, 4000));
    // The editor's own version history (the Shell's History button) reads the store's versions.
    const historyButton = "document.querySelector('header button[aria-label=\"Version history\"]')";
    if (await page.waitFor(`${historyButton} && !${historyButton}.disabled`, 4000)) {
      await page.evaluate(`${historyButton}.click()`);
      check("the workbook's version history opens from the Shell", await page.waitFor(IN_FRAME("/Version history|Current version|versions/i.test(document.body.innerText)"), 6000));
      await shot(page, '31-sheets-history');
    } else check('the Shell offers version history', false);
    cleanRun(page);
  } finally {
    await page.close();
  }

  await replay('sheets', {
    // The chart is the build's last write, and it draws on the first sheet only once the page is back there.
    built: `(${CHART})?.includes('<path')`,
    changed: `${SHEET_VALUE('Budget', 'D5')} === 5600 && ${SHEET_VALUE('Budget', 'D12')} === 39890 && ${SHEET_VALUE('By channel', 'C3')} === 8900 && ${SHEET_VALUE('Changes', 'A2')} === 1`,
    shows: IN_FRAME(`${SHOWS('D5', '$5,600')} && ${SHOWS('E5', '-$600')} && ${FILLED('E5')} && ${SHOWS('D12', '$39,890')} && ${SHOWS('G1', '$39,890')}`),
  });

  // The replay builds the workbook with the store's own edits, in the page: it must end with the seed's workbook.
  const stage = await launch({ width: 1200, height: 720 });
  try {
    const url = demoUrl('sheets');
    const replayed = await stage.load(`${url}${url.includes('?') ? '&' : '?'}replay=1`, { ready: "window.top === window && !!document.querySelector('.pg-replay')", timeout: 30000, settle: 300 });
    try {
      await replayed.evaluate("document.querySelector('.pg-skip').click()");
      await waitTop(replayed, "document.querySelector('.pg-replay').dataset.state === 'done'", 15000);
      const built = beforeTheAnswer(await replayed.evaluate(WORKBOOK));
      const expected = beforeTheAnswer(seeded ?? { sheets: [] });
      const differs = built.sheets.map((sheet, i) => (JSON.stringify(sheet) === JSON.stringify(expected.sheets[i]) ? null : sheet.name)).filter(Boolean);
      check('the replayed workbook is the seeded one: cells, formulas, formats, rules, tables, charts', built.sheets.length === expected.sheets.length && differs.length === 0, differs.join(', '));
      check('…with the same named ranges', JSON.stringify(built.names) === JSON.stringify(expected.names), JSON.stringify(built.names));
      check('the chart draws in the replayed workbook', await replayed.waitFor(`(${CHART})?.includes('<path')`, 10000));
    } finally {
      await replayed.close();
    }
  } finally {
    await stage.close();
  }
}
