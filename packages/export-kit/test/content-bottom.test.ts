import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { colorDistance, contentBottom, countsAsContent, MIN_FILL_CONTRAST, MIN_FILLED_HEIGHT, paintOver, parseColor, type ElementLook } from '../src/content-bottom.ts';

const WHITE = [255, 255, 255, 1] as const;

const look = (overrides: Partial<ElementLook> = {}): ElementLook => ({
  tag: 'div',
  backgroundImage: 'none',
  borderBottomStyle: 'none',
  borderBottomWidth: 0,
  outline: false,
  ownText: false,
  height: 100,
  fill: [0, 0, 0, 0],
  behind: WHITE,
  ...overrides,
});

describe('colours', () => {
  it('reads computed colours', () => {
    assert.deepEqual(parseColor('rgb(10, 20, 30)'), [10, 20, 30, 1]);
    assert.deepEqual(parseColor('rgba(10, 20, 30, 0.5)'), [10, 20, 30, 0.5]);
    assert.deepEqual(parseColor('rgb(10 20 30 / 25%)'), [10, 20, 30, 0.25]);
    assert.deepEqual(parseColor('transparent'), [0, 0, 0, 0]);
    assert.equal(parseColor('color(display-p3 1 0 0)'), null);
  });

  it('paints a see-through fill over what is behind', () => {
    assert.deepEqual(paintOver([0, 0, 0, 0.5], WHITE), [127.5, 127.5, 127.5, 1]);
    assert.equal(colorDistance([250, 250, 250, 1], WHITE), 15);
  });
});

describe('what counts as content', () => {
  it('counts pictures, controls and rules even when empty', () => {
    for (const tag of ['img', 'svg', 'canvas', 'video', 'picture', 'input', 'button', 'textarea', 'select', 'iframe', 'hr']) assert.equal(countsAsContent(look({ tag })), true, tag);
    assert.equal(countsAsContent(look()), false, 'an empty box');
  });

  it('counts text, background pictures, a bottom border and a drawn outline', () => {
    assert.equal(countsAsContent(look({ ownText: true })), true);
    assert.equal(countsAsContent(look({ backgroundImage: 'linear-gradient(red, blue)' })), true);
    assert.equal(countsAsContent(look({ borderBottomStyle: 'solid', borderBottomWidth: 1 })), true);
    assert.equal(countsAsContent(look({ borderBottomStyle: 'solid', borderBottomWidth: 0 })), false);
    assert.equal(countsAsContent(look({ borderBottomStyle: 'hidden', borderBottomWidth: 2 })), false);
    assert.equal(countsAsContent(look({ outline: true })), true);
  });

  it('counts a fill only when tall enough and different enough from what is behind', () => {
    assert.equal(countsAsContent(look({ fill: [20, 20, 20, 1] })), true);
    assert.equal(countsAsContent(look({ fill: [20, 20, 20, 1], height: MIN_FILLED_HEIGHT - 1 })), false, 'a thin filled strip');
    assert.equal(countsAsContent(look({ fill: [250, 250, 250, 1] })), false, 'near-white on white');
    const edge = 255 - MIN_FILL_CONTRAST / 3;
    assert.equal(countsAsContent(look({ fill: [edge, edge, edge, 1] })), false, 'exactly at the threshold');
    assert.equal(countsAsContent(look({ fill: [0, 0, 0, 0.02] })), false, 'a faint tint');
    assert.equal(countsAsContent(look({ fill: [255, 255, 255, 1], behind: [20, 20, 20, 1] })), true, 'a white card on a dark page');
  });
});

/* A page as `contentBottom` reads it: computed styles, boxes and children, nothing else. */
interface FakeBox {
  tag: string;
  top: number;
  bottom: number;
  width?: number;
  style?: Record<string, string>;
  children?: FakeBox[];
}

const BASE_STYLE: Record<string, string> = {
  display: 'block', position: 'static', opacity: '1', visibility: 'visible', overflowY: 'visible',
  backgroundColor: 'rgba(0, 0, 0, 0)', backgroundImage: 'none', borderBottomStyle: 'none', borderBottomWidth: '0px',
  outlineStyle: 'none', outlineWidth: '0px', outlineOffset: '0px', outlineColor: 'rgb(0, 0, 0)',
};

function fakePage(bodyBox: Omit<FakeBox, 'tag'>, viewport = 800): Document {
  const all: unknown[] = [];
  const styles = new Map<unknown, Record<string, string>>();
  const make = (box: FakeBox): unknown => {
    const element = {
      localName: box.tag,
      childNodes: [],
      children: (box.children ?? []).map(make),
      getBoundingClientRect: () => ({ top: box.top, bottom: box.bottom, width: box.width ?? 100, height: box.bottom - box.top }),
    };
    styles.set(element, { ...BASE_STYLE, ...box.style });
    all.push(element);
    return element;
  };
  const body = make({ tag: 'body', ...bodyBox }) as { getBoundingClientRect(): { bottom: number } };
  const root = { localName: 'html', clientHeight: viewport, scrollHeight: body.getBoundingClientRect().bottom, getElementsByTagName: () => all };
  styles.set(root, { ...BASE_STYLE });
  return {
    documentElement: root,
    body,
    defaultView: { innerHeight: viewport, getComputedStyle: (element: unknown) => styles.get(element) },
    createRange: () => ({ selectNodeContents() {}, getBoundingClientRect: () => ({ bottom: 0, height: 0 }) }),
  } as unknown as Document;
}

describe('where a page’s content ends', () => {
  it('reaches an outline drawn around an otherwise empty box, and past it by the outline', () => {
    const doc = fakePage({
      top: 0, bottom: 1080,
      children: [
        { tag: 'img', top: 0, bottom: 200 },
        { tag: 'div', top: 300, bottom: 340, style: { outlineStyle: 'solid', outlineWidth: '2px', outlineOffset: '4px' } },
        { tag: 'div', top: 500, bottom: 900 },
      ],
    });
    assert.equal(contentBottom(doc), 346);
  });

  it('is the viewport’s height when the body clips its overflow', () => {
    const doc = fakePage({ top: 0, bottom: 3000, style: { overflowY: 'hidden' }, children: [{ tag: 'img', top: 0, bottom: 200 }] }, 720);
    assert.equal(contentBottom(doc), 720);
  });
});
