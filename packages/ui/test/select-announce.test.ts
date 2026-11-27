import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createSelectAnnouncer, type AnnounceDocument, type AnnounceTrigger } from '../src/select-announce.ts';

/** A node of the tiny DOM below: it knows its parent. */
interface FakeNode {
  parent: FakeNode | null;
  attrs: Record<string, string>;
  children: FakeNode[];
  textContent: string | null;
  setAttribute(name: string, value: string): void;
  appendChild(child: FakeNode): FakeNode;
  remove(): void;
}

/** A tiny DOM: nodes that know their parent, and a document that hands out spans. */
function fakeDom(lang = 'en') {
  const node = (): FakeNode => {
    const self: FakeNode = {
      parent: null,
      attrs: {},
      children: [],
      textContent: '',
      setAttribute(name, value) {
        self.attrs[name] = value;
      },
      appendChild(child) {
        child.parent = self;
        self.children.push(child);
        return child;
      },
      remove() {
        const parent = self.parent;
        if (parent) parent.children = parent.children.filter((c) => c !== self);
        self.parent = null;
      },
    };
    return self;
  };
  const focusins: (() => void)[] = [];
  const body = node();
  const doc: AnnounceDocument<FakeNode> = {
    createElement: () => node(),
    body,
    documentElement: { lang },
    addEventListener: (_type, listener) => void focusins.push(listener),
  };
  const trigger = (dialog: FakeNode | null = null, disabled = false): AnnounceTrigger<FakeNode> => ({ ownerDocument: doc, closest: () => dialog, matches: () => disabled });
  const regions = (host = body) => host.children;
  return { doc, body, node, trigger, regions, focusin: () => focusins.splice(0).forEach((listener) => listener()) };
}

describe('select announcements', () => {
  it('makes a polite region on focus, says a new value, and goes on blur', () => {
    const dom = fakeDom('de');
    const announcer = createSelectAnnouncer<FakeNode>();
    const trigger = dom.trigger();
    announcer.change('Regular');
    announcer.focus(trigger, 'Regular');
    const [region] = dom.regions();
    assert.equal(region?.attrs['aria-live'], 'polite');
    assert.equal(region?.attrs.lang, 'de');
    assert.match(region?.attrs.style ?? '', /clip:/);
    assert.equal(region?.textContent, '', 'nothing is said on focus alone');
    announcer.change('Bold');
    assert.equal(region?.textContent, 'Bold');
    announcer.blur(trigger);
    assert.equal(dom.regions().length, 0);
  });

  it('says the pick when the focus comes back from the list, and lives in the dialog', () => {
    const dom = fakeDom();
    const dialog = dom.node();
    const announcer = createSelectAnnouncer<FakeNode>();
    const trigger = dom.trigger(dialog);
    announcer.change('A');
    announcer.focus(trigger, 'A');
    announcer.blur(trigger);
    announcer.change('B');
    announcer.focus(trigger, 'B');
    assert.equal(dom.regions().length, 0);
    assert.equal(dom.regions(dialog)[0]?.textContent, 'B');
  });

  it('keeps the region until the next focus when the trigger is disabled as it blurs', () => {
    const dom = fakeDom();
    const announcer = createSelectAnnouncer<FakeNode>();
    announcer.focus(dom.trigger(), 'A');
    announcer.change('B');
    announcer.blur(dom.trigger(null, true));
    assert.equal(dom.regions()[0]?.textContent, 'B');
    dom.focusin();
    assert.equal(dom.regions().length, 0);
  });
});
