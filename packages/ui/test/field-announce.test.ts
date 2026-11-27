import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { announceFromField, prepareFieldAnnounce, type FieldAnnounceTarget } from '../src/field-announce.ts';

/** A span of the tiny DOM below. */
interface FakeSpan {
  attrs: Record<string, string>;
  textContent: string | null;
  setAttribute(name: string, value: string): void;
  remove(): void;
}

/** A host that keeps what is appended to it. */
const host = () => ({ children: [] as FakeSpan[], appendChild(node: FakeSpan) { this.children.push(node); } });

/** A field in `dialog` (or straight in the body), in a document whose language is `lang`. */
function fakeField(dialog: ReturnType<typeof host> | null, body = host(), lang = 'en') {
  const field: FieldAnnounceTarget<FakeSpan> = {
    ownerDocument: {
      createElement: () => {
        const span: FakeSpan = { attrs: {}, textContent: '', setAttribute: (name, value) => { span.attrs[name] = value; }, remove() {} };
        return span;
      },
      body,
      documentElement: { lang },
    },
    closest: () => dialog,
  };
  return { field, body };
}

describe('a number field saying what it did', () => {
  it('speaks into one quiet region in the page body, made when a field takes the focus', () => {
    const { field, body } = fakeField(null);
    prepareFieldAnnounce(field);
    assert.equal(body.children.length, 1);
    const region = body.children[0]!;
    assert.equal(region.attrs['aria-live'], 'polite');
    assert.equal(region.attrs['aria-atomic'], 'true');
    assert.equal(region.attrs.lang, 'en');
    announceFromField(field, 'Changed to 1. Rows can’t go lower.');
    assert.equal(region.textContent, 'Changed to 1. Rows can’t go lower.');
    const other = fakeField(null, body).field;
    announceFromField(other, 'Minus sign ignored. Rows doesn’t take negative numbers.');
    assert.equal(body.children.length, 1, 'fields in one host share its region');
  });

  it('speaks inside the dialog it is in, since a modal dialog hides the page', () => {
    const dialog = host();
    const { field, body } = fakeField(dialog);
    announceFromField(field, 'Changed to 99. Columns can’t go higher.');
    assert.equal(body.children.length, 0);
    assert.equal(dialog.children[0]!.textContent, 'Changed to 99. Columns can’t go higher.');
  });

  it('says the same message again, and nothing for an empty one', () => {
    const { field, body } = fakeField(null);
    announceFromField(field, 'Changed to 0. Blur can’t go lower.');
    const region = body.children[0]!;
    announceFromField(field, 'Changed to 0. Blur can’t go lower.');
    assert.equal(region.textContent, 'Changed to 0. Blur can’t go lower. ');
    announceFromField(field, 'Changed to 0. Blur can’t go lower.');
    assert.equal(region.textContent, 'Changed to 0. Blur can’t go lower.');
    announceFromField(field, '');
    assert.equal(region.textContent, 'Changed to 0. Blur can’t go lower.');
  });
});
