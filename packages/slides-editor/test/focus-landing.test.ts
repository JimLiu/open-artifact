import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { placeLandingCandidates, rowLandingCandidates, type ControlKind, type LandingNode } from '../src/lib/focus-landing.ts';

interface Fake extends LandingNode<Fake> {
  name: string;
  tag: string;
  parentElement: Fake | null;
  children: Fake[];
}

/** `tag:name`, with children. */
function el(spec: string, ...children: Fake[]): Fake {
  const [tag, name = tag] = spec.split(':') as [string, string?];
  const node: Fake = { tag, name, parentElement: null, children };
  for (const child of children) child.parentElement = node;
  return node;
}

function find(root: Fake, name: string): Fake {
  if (root.name === name) return root;
  for (const child of root.children) {
    const hit = find(child, name);
    if (hit) return hit;
  }
  return null as unknown as Fake;
}

const names = (list: readonly Fake[]): string[] => list.map((n) => n.name);

const rowRules = (root: Fake) => ({
  root,
  isRow: (n: Fake) => n.tag === 'row',
  // Reset and remove buttons are never landed on.
  controlKind: (n: Fake): ControlKind => (n.tag === 'button' && !/^(Reset|Remove)/.test(n.name) ? 'control' : n.tag === 'input' ? 'field' : null),
});

// A panel: a Size section of four rows, and an Effects section with a "+" and three shadow rows.
const panel = el(
  'panel',
  el('tabs', el('button:Properties tab')),
  el(
    'section:size',
    el('header', el('h3')),
    el(
      'list:size rows',
      el('row:width', el('input:Width'), el('button:Reset width')),
      el('row:height', el('input:Height'), el('button:Fit height'), el('button:Reset height')),
      el('row:min', el('input:Min'), el('button:Remove min')),
      el('row:max', el('input:Max'), el('button:Remove max')),
    ),
  ),
  el(
    'section:effects',
    el('header', el('h3'), el('button:Add to Effects')),
    el(
      'list:effect rows',
      el('row:shadow 1', el('button:Shadow 1'), el('button:Remove shadow 1')),
      el('row:shadow 2', el('button:Shadow 2'), el('button:Remove shadow 2')),
      el('row:shadow 3', el('button:Shadow 3'), el('button:Remove shadow 3')),
    ),
  ),
);

describe('the controls a removed property row hands the focus to', () => {
  it('starts with the rest of its own row, in case only the pressed control went', () => {
    const got = names(rowLandingCandidates(find(panel, 'Reset height'), rowRules(panel), false));
    assert.deepEqual(got.slice(0, 2), ['Height', 'Fit height']);
  });

  it('takes one control per row, a button before a field, the rows before it nearest first', () => {
    const got = names(rowLandingCandidates(find(panel, 'Remove shadow 2'), rowRules(panel), false));
    assert.deepEqual(got, ['Shadow 2', 'Shadow 1', 'Shadow 3', 'Add to Effects', 'Fit height', 'Properties tab']);
  });

  it('lets a key press land on a field, but only as the first row it finds', () => {
    const byKey = names(rowLandingCandidates(find(panel, 'Remove max'), rowRules(panel), true));
    assert.deepEqual(byKey, ['Max', 'Min', 'Fit height', 'Shadow 1', 'Shadow 2', 'Shadow 3', 'Properties tab']);
    const byPointer = names(rowLandingCandidates(find(panel, 'Remove max'), rowRules(panel), false));
    assert.deepEqual(byPointer.slice(0, 2), ['Max', 'Fit height']);
  });

  it('never offers the pressed control, a reset or a remove button', () => {
    const pressed = find(panel, 'Remove shadow 1');
    const got = rowLandingCandidates(pressed, rowRules(panel), true);
    assert.ok(!got.includes(pressed));
    assert.ok(!names(got).some((name) => /^(Reset|Remove)/.test(name)));
  });

  it('searches around a pressed control outside any row too', () => {
    const got = names(rowLandingCandidates(find(panel, 'Add to Effects'), rowRules(panel), false));
    assert.deepEqual(got.slice(0, 2), ['Shadow 1', 'Shadow 2']);
    assert.deepEqual(rowLandingCandidates(panel, rowRules(panel), false), []);
  });
});

describe('the place a dismissed banner hands the focus to', () => {
  // body > app > [rail(nav), column > [banner > actions > Dismiss, banner, main > h2]]
  const page = el(
    'body',
    el(
      'div:app',
      el('nav:rail', el('h2:Slides')),
      el('div:column', el('div:recovery', el('span:text'), el('span:actions', el('button:Restore'), el('button:Dismiss'))), el('div:kept', el('span:kept text')), el('main:main', el('h2:Stage heading'))),
    ),
  );
  const isPlace = (n: Fake): boolean => ['h2', 'main', 'nav'].includes(n.tag);

  it('takes the landmark beside the banner before anything further off', () => {
    const got = names(placeLandingCandidates(find(page, 'Dismiss'), { root: page, isPlace }));
    assert.deepEqual(got, ['main', 'rail']);
  });

  it('takes the nearest heading before it, then after it, then the enclosing group', () => {
    const section = el(
      'body',
      el('section:group', el('h3:Earlier'), el('h3:Title'), el('p', el('button:Dismiss')), el('div', el('h3:Next'), el('h3:Later'))),
    );
    const got = names(placeLandingCandidates(find(section, 'Dismiss'), { root: section, isPlace: (n) => n.tag === 'h3' || n.tag === 'section' }));
    assert.deepEqual(got, ['Title', 'Earlier', 'Next', 'group']);
  });

  it('finds nothing on a bare page', () => {
    const bare = el('body', el('div', el('button:Dismiss')));
    assert.deepEqual(placeLandingCandidates(find(bare, 'Dismiss'), { root: bare, isPlace: () => false }), []);
  });
});
