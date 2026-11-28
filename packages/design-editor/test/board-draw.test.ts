import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { elementChildren, parseTemplate, type HtmlElement } from '@open-artifact/dc';
import {
  CLICK_SIZES,
  cornersOf,
  drawContainer,
  lineHtml,
  notLoadedMessage,
  parseCorners,
  pencilHtml,
  placedHtml,
  placementOps,
  radiusCss,
  radiusKey,
} from '../src/lib/board-draw.ts';
import { boardSnapTargets } from '../src/lib/draw-snap.ts';

const styleOf = (html: string): string => /style="([^"]*)"/.exec(html)?.[1] ?? '';

/** Every element of a template, by its id. */
function byId(html: string): Record<string, HtmlElement> {
  const found: Record<string, HtmlElement> = {};
  const walk = (nodes: readonly HtmlElement[]): void => {
    for (const element of nodes) {
      const id = element.attrs.find((a) => a.name === 'id')?.value;
      if (id) found[id] = element;
      walk(elementChildren(element));
    }
  };
  walk(elementChildren(parseTemplate(html).nodes));
  return found;
}

describe('elements drawn inside an artboard', () => {
  it('a clicked rectangle is 120 by 120, grey, with the remembered radius, placed absolutely', () => {
    const html = placedHtml('rect', { x: 10, y: 20, ...CLICK_SIZES.rect }, { radius: [12, 12, 12, 12] });
    assert.equal(
      styleOf(html),
      'box-sizing: border-box; display: flex; flex-direction: column; background-color: #b6b0a7; border-radius: 12px; position: absolute; left: 10px; top: 20px; width: 120px; height: 120px',
    );
    assert.match(html, /^<div style="[^"]*"><\/div>$/);
  });

  it('a rectangle takes 8px corners when none were set, and four corners when they differ', () => {
    assert.match(styleOf(placedHtml('rect', { x: 0, y: 0, w: 1, h: 1 })), /background-color: #b6b0a7; border-radius: 8px;/);
    assert.equal(radiusCss([1, 2, 3, 4]), 'border-top-left-radius: 1px; border-top-right-radius: 2px; border-bottom-right-radius: 3px; border-bottom-left-radius: 4px');
  });

  it('a dragged size replaces the template size, so the style names each property once', () => {
    const style = styleOf(placedHtml('rect', { x: 5, y: 6, w: 200, h: 50 }));
    assert.match(style, /position: absolute; left: 5px; top: 6px; width: 200px; height: 50px$/);
    assert.doesNotMatch(style, /120px/);
    const names = style.split(';').map((d) => d.split(':')[0]!.trim());
    assert.equal(new Set(names).size, names.length);
  });

  it('an oval is fully rounded and centres its content', () => {
    const style = styleOf(placedHtml('oval', { x: 0, y: 0, ...CLICK_SIZES.oval }));
    assert.match(style, /align-items: center; justify-content: center; background-color: #b6b0a7; border-radius: 50%; position: absolute; left: 0px; top: 0px; width: 96px; height: 96px$/);
  });

  it('a frame has padding, a gap, a white fill and a soft shadow, sized only by the drag', () => {
    assert.equal(
      styleOf(placedHtml('frame', { x: 1, y: 2, w: 0, h: 0 })),
      'box-sizing: border-box; display: flex; flex-direction: column; gap: 12px; padding: 16px; background-color: #ffffff; border-radius: 2px; box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08); position: absolute; left: 1px; top: 2px',
    );
  });

  it('text starts with words to replace, in the artboard’s text font', () => {
    const html = placedHtml('text', { x: 3, y: 4, ...CLICK_SIZES.text }, { font: '"Inter", sans-serif' });
    assert.equal(html, `<div style="font-size: 16px; line-height: 1; font-family: 'Inter', sans-serif; position: absolute; left: 3px; top: 4px">Your text here</div>`);
    assert.doesNotMatch(placedHtml('text', { x: 0, y: 0, w: 0, h: 0 }), /font-family/);
  });

  it('a clicked line is a 160px rightward line in a box 8px tall', () => {
    const html = placedHtml('line', { x: 40, y: 50, ...CLICK_SIZES.line });
    assert.match(html, /^<svg width="160" height="8" viewBox="0 0 160 8" preserveAspectRatio="none" style="position: absolute; left: 40px; top: 46px; width: 160px; height: 8px; overflow: visible; fill: none; stroke: #8a8378; stroke-width: 4; stroke-linecap: round; stroke-linejoin: round">/);
    assert.match(html, /<path d="M 0 4 L 160 4"><\/path><\/svg>$/);
  });

  it('a line follows the way it was drawn', () => {
    assert.match(lineHtml('line', { x: 0, y: 0, w: 30, h: 40 }, { x: -1, y: 1 }, () => 'a'), /d="M 30 0 L 0 40"/);
  });

  it('an arrow has a head marker and its line stops 8px short of the tip', () => {
    const html = lineHtml('arrow', { x: 0, y: 0, w: 100, h: 0 }, { x: 1, y: 1 }, () => 'arrow-head-3');
    assert.match(html, /<defs><marker id="arrow-head-3" orient="auto" markerWidth="5" markerHeight="5" refX="2" refY="2" overflow="visible"><path d="M0 0 L4 2 L0 4 Z" fill="#8a8378" stroke="none"><\/path><\/marker><\/defs>/);
    assert.match(html, /<path d="M 0 4 L 92 4" marker-end="url\(#arrow-head-3\)"><\/path>/);
    // A line shorter than the pull keeps half a pixel.
    assert.match(lineHtml('arrow', { x: 0, y: 0, w: 4, h: 0 }, { x: 1, y: 1 }, () => 'a'), /L 2.5 4"/);
  });

  it('a Pencil stroke is a positioned svg with the Pencil’s width and dashes', () => {
    const html = pencilHtml({ x: 100, y: 100, points: [[0, 0], [10, -5], [20, 10]] }, { width: 3, dash: 'dashed' });
    assert.ok(html);
    assert.match(html, /^<svg width="20" height="15" viewBox="0 0 20 15" preserveAspectRatio="none" style="position: absolute; left: 100px; top: 95px; width: 20px; height: 15px; overflow: visible; fill: none; stroke: #2b2b2b; stroke-width: 3; stroke-dasharray: 9 7.5; stroke-linecap: round; stroke-linejoin: round">/);
    assert.match(html, /<path d="M0 5 L10 0 L20 15" vector-effect="non-scaling-stroke"><\/path><\/svg>$/);
  });

  it('a Pencil stroke wider or taller than 8000px is refused', () => {
    assert.equal(pencilHtml({ x: 0, y: 0, points: [[0, 0], [8001, 10]] }, { width: 3, dash: 'solid' }), null);
    assert.ok(pencilHtml({ x: 0, y: 0, points: [[0, 0], [8000, 10]] }, { width: 3, dash: 'solid' }));
  });

  it('names what could not be added when the artboard did not load', () => {
    assert.equal(notLoadedMessage('rect'), 'That artboard didn’t load — pick another one to add a rectangle.');
    assert.equal(notLoadedMessage('pen'), 'That artboard didn’t load — pick another one to add a path.');
  });
});

describe('where a drawing goes inside an edited artboard', () => {
  const els = byId(`<div id="root"><p id="para"><span id="word">x</span></p><img id="pic"><svg id="icon"><path id="shape"></path></svg><table id="t"><tbody id="tb"><tr id="row"><td id="cell"></td></tr></tbody></table><section id="card"></section></div>`);

  it('goes into the element under the pointer when it can hold one', () => {
    assert.equal(drawContainer(els.card!, 'div'), els.card);
    assert.equal(drawContainer(els.cell!, 'div'), els.cell);
  });

  it('climbs out of svg drawings and elements that hold nothing', () => {
    assert.equal(drawContainer(els.shape!, 'div'), els.root);
    assert.equal(drawContainer(els.pic!, 'div'), els.root);
  });

  it('climbs out of locked elements', () => {
    assert.equal(drawContainer(els.word!, 'svg', (element) => element === els.para), els.root);
  });

  it('keeps blocks out of paragraphs, but lets a drawn svg in', () => {
    assert.equal(drawContainer(els.word!, 'div'), els.root);
    assert.equal(drawContainer(els.word!, 'svg'), els.word);
  });

  it('keeps table parts holding only their own rows and cells', () => {
    assert.equal(drawContainer(els.row!, 'div'), els.root);
    assert.equal(drawContainer(null, 'div'), null);
  });

  it('a static container is made relative in the same step as the insert', () => {
    const container = { tid: 4, path: [0, 1] };
    assert.deepEqual(placementOps(container, true, '<div></div>'), [
      { kind: 'style', targets: [container], patch: { position: 'relative' } },
      { kind: 'insert', target: container, position: 'last-child', html: '<div></div>' },
    ]);
    assert.deepEqual(placementOps(container, false, '<i></i>'), [{ kind: 'insert', target: container, position: 'last-child', html: '<i></i>' }]);
    assert.deepEqual(placementOps(null, true, '<i></i>'), [{ kind: 'insert', target: null, position: 'last-child', html: '<i></i>' }]);
  });
});

describe('snapping inside an artboard', () => {
  it('snaps to its top-level boxes within it and to its own six lines', () => {
    const board = { x: 100, y: 100, w: 400, h: 300 };
    const targets = boardSnapTargets(board, [{ x: 120, y: 130, w: 100, h: 40 }, { x: 450, y: 380, w: 200, h: 100 }]);
    assert.deepEqual(targets.xs.map((l) => l.at).sort((a, b) => a - b), [100, 120, 170, 220, 300, 450, 500]);
    assert.deepEqual(targets.ys.map((l) => l.at).sort((a, b) => a - b), [100, 130, 150, 170, 250, 380, 400]);
  });
});

describe('the remembered radius', () => {
  it('reads one to four px lengths, and nothing else', () => {
    assert.deepEqual(cornersOf('12px'), [12, 12, 12, 12]);
    assert.deepEqual(cornersOf('4px 8px'), [4, 8, 4, 8]);
    assert.deepEqual(cornersOf(['1px', '2', '3px', '4.567px']), [1, 2, 3, 4.57]);
    assert.equal(cornersOf('50%'), null);
    assert.equal(cornersOf('1rem'), null);
  });

  it('keeps four lengths in storage, ignoring anything else there', () => {
    assert.deepEqual(parseCorners('[1,2,3,4]'), [1, 2, 3, 4]);
    assert.equal(parseCorners('[1,2]'), null);
    assert.equal(parseCorners('nope'), null);
    assert.equal(parseCorners(null), null);
  });

  it('is kept per document', () => {
    assert.equal(radiusKey('/a/b/index.html'), 'mc-design/rect-radius/a/b');
    assert.equal(radiusKey('/a/b/'), 'mc-design/rect-radius/a/b');
    assert.equal(radiusKey('/'), 'mc-design/rect-radius/');
  });
});
