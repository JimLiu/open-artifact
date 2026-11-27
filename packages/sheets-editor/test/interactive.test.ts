import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  createInteractiveWrites,
  interactiveCellWrite,
  parseInteractiveFrameReply,
  MAX_INTERACTIVE_INDEX,
  MAX_INTERACTIVE_WRITES,
  type InteractiveWritesHost,
} from '../src/charts/interactive-frame-talk.ts';
import { cellsAskedFor, cellsToReset, inputsWithWritesAwaited, placeOfCell, rowsOfSource, type ControlsOfInteractive } from '../src/interactive-frame/cells.ts';
import type { PageToInteractive } from '../src/interactive-frame/messages.ts';
import type { ChartInputs } from '../src/chart-frame/messages.ts';
import { composeFrameDocument } from '../chart-frame-page.ts';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { chartModule } from '@open-artifact/sheets-core';
import { Cell, componentOfCode, handedToCode, ToldContext } from '../src/interactive-frame/code.ts';
import { propsOfInteractive } from '../src/interactive-frame/elements.ts';

const inputs: ChartInputs = {
  rate: [[{ value: 0.05, text: '5%' }]],
  table: [
    [
      { value: 'a', text: 'a' },
      { value: 1, text: '1' },
    ],
  ],
};

describe('what an interactive frame tells the page', () => {
  it('takes writes of plain values in reach, and nothing else', () => {
    assert.deepEqual(parseInteractiveFrameReply({ kind: 'write', cells: [['rate', 0, 0, 0.1]], nth: 1, press: 3 }), {
      kind: 'write',
      cells: [['rate', 0, 0, 0.1]],
      nth: 1,
      press: 3,
    });
    assert.equal(parseInteractiveFrameReply({ kind: 'write', cells: [['rate', MAX_INTERACTIVE_INDEX, 0, 1]], nth: 1, press: 1 }), null);
    assert.equal(parseInteractiveFrameReply({ kind: 'write', cells: [['rate', 0, 0, { x: 1 }]], nth: 1, press: 1 }), null);
    assert.equal(parseInteractiveFrameReply({ kind: 'write', cells: [['rate', 0, 0, Number.NaN]], nth: 1, press: 1 }), null);
    assert.equal(parseInteractiveFrameReply({ kind: 'write', cells: [['rate', 0, 0, 1]], press: 1 }), null);
    assert.equal(parseInteractiveFrameReply({ kind: 'write', cells: [['rate', 0, 0, 1]], nth: 1 }), null);
    const many = Array.from({ length: MAX_INTERACTIVE_WRITES + 1 }, (_, row): [string, number, number, number] => ['rate', row, 0, 1]);
    assert.equal(parseInteractiveFrameReply({ kind: 'write', cells: many, nth: 1, press: 1 }), null);
  });

  it('knows the keys it may hand back, and falls back on what a chart frame says', () => {
    assert.deepEqual(parseInteractiveFrameReply({ kind: 'keyForPage', key: 'nextPart' }), { kind: 'keyForPage', key: 'nextPart' });
    assert.deepEqual(parseInteractiveFrameReply({ kind: 'keyForPage', key: 'undo' }), { kind: 'keyForPage', key: 'undo' });
    assert.equal(parseInteractiveFrameReply({ kind: 'keyForPage', key: 'Tab' }), null);
    assert.deepEqual(parseInteractiveFrameReply({ kind: 'cellsOffered', extra: 1 }), { kind: 'cellsOffered' });
    assert.deepEqual(parseInteractiveFrameReply({ kind: 'cellShown', input: 'rate', row: 0, column: 2 }), {
      kind: 'cellShown',
      input: 'rate',
      row: 0,
      column: 2,
    });
    assert.equal(parseInteractiveFrameReply({ kind: 'cellShown', input: 'rate', row: -1, column: 0 }), null);
    assert.deepEqual(parseInteractiveFrameReply({ kind: 'pressed', at: 5 }), { kind: 'pressed', at: 5 });
    assert.deepEqual(parseInteractiveFrameReply({ kind: 'drawn' }), { kind: 'drawn' });
    assert.equal(parseInteractiveFrameReply({ kind: 'whatever' }), null);
  });

  it('writes each kind of value as the sheet takes it', () => {
    assert.deepEqual(interactiveCellWrite(['rate', 0, 1, true]), { input: 'rate', row: 0, column: 1, value: { kind: 'boolean', value: true } });
    assert.deepEqual(interactiveCellWrite(['rate', 0, 0, null]), { input: 'rate', row: 0, column: 0, value: null });
    assert.deepEqual(interactiveCellWrite(['rate', 0, 0, 'x']).value, { kind: 'text', value: 'x' });
  });
});

describe('the writes of an interactive', () => {
  function writesWithHost() {
    const told: PageToInteractive[] = [];
    const written: unknown[][] = [];
    const presses: number[] = [];
    const timers: (() => void)[] = [];
    let whenWritten: (() => void) | null = null;
    const host: InteractiveWritesHost = {
      tellFrame: (message) => told.push(message),
      write: (cells, press, then) => {
        written.push(cells);
        presses.push(press);
        whenWritten = then;
      },
      later: (act) => void timers.push(act),
    };
    return { writes: createInteractiveWrites(inputs, host), told, written, presses, timers, answer: () => whenWritten?.() };
  }

  it('writes one batch at a time, the last value of a cell winning, and tells the frame what was answered', () => {
    const { writes, told, written, timers, answer } = writesWithHost();
    writes.write([['rate', 0, 0, 1]], 1);
    writes.write([['rate', 0, 0, 2]], 2);
    writes.write([['rate', 0, 0, 3]], 3);
    assert.equal(written.length, 1);
    answer();
    assert.deepEqual(told.at(-1), { kind: 'inputsChanged', inputs, answered: 1 });
    for (const timer of timers.splice(0)) timer();
    assert.equal(written.length, 2);
    assert.deepEqual(written[1], [{ input: 'rate', row: 0, column: 0, value: { kind: 'number', value: 3 } }]);
  });

  it('answers a write turned down without writing', () => {
    const { writes, told, written } = writesWithHost();
    writes.write([], 4);
    assert.equal(written.length, 0);
    assert.deepEqual(told.at(-1), { kind: 'inputsChanged', inputs, answered: 4 });
  });

  it('keeps a held write until it is let go, or turns it down after a while', () => {
    const { writes, written } = writesWithHost();
    writes.hold([['rate', 0, 0, 7]], 1);
    assert.equal(written.length, 0);
    writes.release();
    assert.equal(written.length, 1);
    const later = writesWithHost();
    later.writes.hold([['rate', 0, 0, 7]], 1);
    for (const timer of later.timers.splice(0)) timer();
    assert.equal(later.written.length, 0);
    assert.deepEqual(later.told.at(-1), { kind: 'inputsChanged', inputs, answered: 1 });
  });

  it('writes with the press that made a write, and acts after every write asked for is answered', () => {
    const { writes, presses, timers, answer } = writesWithHost();
    const done: string[] = [];
    writes.afterWrites(() => done.push('at once'));
    writes.write([['rate', 0, 0, 1]], 1, 5);
    writes.afterWrites(() => done.push('after'));
    assert.deepEqual(done, ['at once']);
    answer();
    assert.deepEqual(done, ['at once', 'after']);
    assert.deepEqual(presses, [5]);
    for (const timer of timers.splice(0)) timer();
    writes.hold([['rate', 0, 0, 2]], 2, 6);
    writes.release();
    assert.deepEqual(presses, [5, 6]);
  });

  it('tells the frame nothing once it has ended', () => {
    const { writes, told } = writesWithHost();
    writes.end();
    writes.inputsAre(inputs);
    assert.equal(told.length, 0);
  });
});

describe('what the code of an interactive reads and writes', () => {
  const controls: ControlsOfInteractive = { canWrite: true, setCells: () => {}, resetCells: () => {}, showCell: () => {} };
  const told = { inputs, controls, size: { width: 300, height: 200 } };

  it('reads an input as rows, the controls from their source, and the size', () => {
    const adapter = { kind: 'cells' };
    assert.deepEqual(rowsOfSource('rate', { kind: 'ref', ref: 'input/rate', adapter }, told), inputs.rate);
    assert.deepEqual(rowsOfSource('interactive', { kind: 'data', data: [] }, told), [controls]);
    assert.deepEqual(rowsOfSource('chartSize', { kind: 'data', data: [{}] }, told), [{ width: 300, height: 200 }]);
    assert.throws(() => rowsOfSource('x', { kind: 'ref', ref: 'input/none', adapter }, told), { fault: 'inputMissing' });
  });

  it('knows where each cell it gives the code sits, so <Cell> can offer to show it', () => {
    const adapter = { kind: 'cells' };
    const [[, amount]] = rowsOfSource('table', { kind: 'ref', ref: 'input/table', adapter }, told) as unknown[][];
    assert.deepEqual(placeOfCell(amount), { kind: 'cellShown', input: 'table', row: 0, column: 1 });
    assert.equal(rowsOfSource('table', { kind: 'ref', ref: 'input/table', adapter }, told)[0], rowsOfSource('table', { kind: 'ref', ref: 'input/table', adapter }, told)[0]);
    assert.equal(placeOfCell(inputs.table?.[0]?.[1]), undefined);
    assert.match(renderToStaticMarkup(React.createElement(Cell, { of: amount })), /^<button type="button" class="interactive-cell"[^>]*>1<\/button>$/);
    assert.equal(renderToStaticMarkup(React.createElement(Cell, { of: { text: 'x' } })), '<span>x</span>');
  });

  it('asks for a value or rows of values from an input’s top left, passing over names that are no input', () => {
    assert.deepEqual(cellsAskedFor({ rate: 0.1, nowhere: 1, table: [['b', 2]] }, inputs), [
      ['rate', 0, 0, 0.1],
      ['table', 0, 0, 'b'],
      ['table', 0, 1, 2],
    ]);
    assert.throws(() => cellsAskedFor({ rate: { no: 1 } }, inputs), TypeError);
    assert.throws(() => cellsAskedFor([1], inputs), TypeError);
  });

  it('shows the writes awaited over the inputs', () => {
    const shown = inputsWithWritesAwaited(inputs, [{ nth: 1, cells: [['rate', 1, 1, true]] }]);
    assert.deepEqual(shown.rate, [
      [{ value: 0.05, text: '5%' }, { value: null, text: '' }],
      [{ value: null, text: '' }, { value: true, text: 'TRUE' }],
    ]);
    assert.equal(shown.table, inputs.table);
  });

  it('resets the cells asked for that hold other than their defaults, by input or by cell', () => {
    const withDefaults: ChartInputs = {
      rate: [[{ value: 0.2, text: '20%', default: 0.05, isChanged: true }, { value: 3, text: '3', default: 3, isChanged: false }]],
      table: [[{ value: 'b', text: 'b', default: null, isChanged: true }, { value: 1, text: '1' }]],
    };
    assert.deepEqual(cellsToReset('rate', withDefaults), [['rate', 0, 0, 0.05]]);
    assert.deepEqual(cellsToReset(['rate', 'table'], withDefaults), [
      ['rate', 0, 0, 0.05],
      ['table', 0, 0, null],
    ]);
    const adapter = { kind: 'cells' };
    const [[given]] = rowsOfSource('table', { kind: 'ref', ref: 'input/table', adapter }, { ...told, inputs: withDefaults }) as unknown[][];
    assert.deepEqual(cellsToReset(given, withDefaults), [['table', 0, 0, null]]);
    assert.deepEqual(cellsToReset('nowhere', withDefaults), []);
  });

  it('keeps a cell’s default under a write awaited, and whether the write changes it', () => {
    const withDefault: ChartInputs = { rate: [[{ value: 0.05, text: '5%', default: 0.05, isChanged: false }]] };
    assert.deepEqual(inputsWithWritesAwaited(withDefault, [{ nth: 1, cells: [['rate', 0, 0, 0.2]] }]).rate, [[{ value: 0.2, text: '0.2', default: 0.05, isChanged: true }]]);
    assert.deepEqual(inputsWithWritesAwaited(withDefault, [{ nth: 1, cells: [['rate', 0, 0, 0.05]] }]).rate, [[{ value: 0.05, text: '0.05', default: 0.05, isChanged: false }]]);
  });
});

describe('the interactive frame document', () => {
  it('starts no worker and draws in its own element', () => {
    const page = composeFrameDocument({ script: 'go()', style: 'a{}', title: 'Interactive sheet', rootId: 'interactive' });
    assert.match(page, /worker-src 'none'/);
    assert.ok(!page.includes('script-of-worker'));
    assert.ok(page.includes('<div id="interactive"></div>'));
    assert.equal([...page.matchAll(/<script/g)].length, 1);
  });
});

/** The example of an interactive panel the agent is shown, as it stands in its guide. */
const ORDER_PLANNER = `export default () => <sheet.Visualize data-component='order-planner' sources={{quantity:{kind:'ref', ref:'input/quantity', adapter:{kind:'cells'}}, total:{kind:'ref', ref:'input/total', adapter:{kind:'cells'}}, interactive:{kind:'data', data:[]}}}>{({quantity, total, interactive}) => { const panel = interactive.at(0); const held = quantity.at(0)?.at(0); const n = typeof held?.value === 'number' ? held.value : 0; const live = panel?.canWrite === true; return <div role='group' aria-label='Order planner'><p>Quantity: {held?.text ?? ''}</p><button disabled={!live || n <= 0} onClick={() => panel.setCells({quantity: n - 1})}>One less</button><button disabled={!live} onClick={() => panel.setCells({quantity: n + 1})}>One more</button><p>Total: {total.at(0)?.at(0)?.text ?? ''}</p></div>; }}</sheet.Visualize>;`;

const Stub = (): null => null;
const handed = () => handedToCode({ Tooltip: Stub, Button: Stub, Menu: { Root: Stub }, Popover: { Root: Stub } });

async function componentOf(code: string): Promise<React.ComponentType | string> {
  const module = (await import(`data:text/javascript;base64,${Buffer.from(chartModule(code)).toString('base64')}`)) as { init: unknown };
  return componentOfCode(module.init, handed());
}

function drawPanel(Code: React.ComponentType, canWrite: boolean, setCells: (cells: unknown) => void = () => {}): string {
  const planner: ChartInputs = { quantity: [[{ value: 3, text: '3' }]], total: [[{ value: 36, text: '$36.00' }]] };
  return renderToStaticMarkup(
    React.createElement(ToldContext.Provider, { value: { inputs: planner, controls: { canWrite, setCells, resetCells: () => {}, showCell: () => {} }, size: { width: 400, height: 300 } } }, React.createElement(Code)),
  );
}

describe('the code of an interactive panel', () => {
  it('draws the example in the agent’s guide, its buttons live only while the person may write', async () => {
    const Code = await componentOf(ORDER_PLANNER);
    assert.ok(typeof Code === 'function');
    const live = drawPanel(Code, true);
    assert.match(live, /<div role="group" aria-label="Order planner"><p>Quantity: 3<\/p><button>One less<\/button><button>One more<\/button><p>Total: \$36.00<\/p><\/div>/);
    assert.equal([...drawPanel(Code, false).matchAll(/disabled=""/g)].length, 2);
  });

  it('takes a component of the code’s own, and turns away what links or embeds', async () => {
    const Own = await componentOf(`const Row = ({label}) => <label>{label}<input type='range' min={0} max={10} /></label>; export default () => <sheet.Visualize sources={{interactive:{kind:'data', data:[]}}}>{() => <div><Row label='Rate' /></div>}</sheet.Visualize>;`);
    assert.ok(typeof Own === 'function');
    assert.match(drawPanel(Own, true), /<label>Rate<input type="range" min="0" max="10"\/><\/label>/);
    const Linked = await componentOf(`export default () => <sheet.Visualize sources={{}}>{() => <iframe />}</sheet.Visualize>;`);
    assert.ok(typeof Linked === 'function');
    assert.throws(() => drawPanel(Linked, true), { fault: 'notDrawnInSheets' });
  });

  it('leaves out the properties that would load or link, whatever their spelling', () => {
    assert.deepEqual(propsOfInteractive('image', { href: 'x', 'xlink:href': 'y', xlinkHref: 'z', width: 2 }), { width: 2 });
    assert.deepEqual(propsOfInteractive('div', { srcset: 'x', 'data-component': 'p' }), { 'data-component': 'p' });
    assert.deepEqual(propsOfInteractive('button', { type: 'submit' }), { type: 'button' });
    assert.throws(() => propsOfInteractive('input', { type: 'file' }), { fault: 'notDrawnInSheets' });
  });
});
