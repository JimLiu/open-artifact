/** A host theme pinned on a root (the Shell's and the page's `<html>`): `pinHostTheme`. */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { HOST_ACCENT_VARS, pinHostTheme, type HostThemeRoot } from '../src/shell.ts';

function fakeRoot(): HostThemeRoot & { props: Map<string, string> } {
  const props = new Map<string, string>();
  return {
    props,
    dataset: {},
    style: { setProperty: (name, value) => void props.set(name, value), removeProperty: (name) => void props.delete(name) },
  };
}

describe('pinHostTheme', () => {
  it('sets data-theme and all three accent properties, the text colour included', () => {
    const root = fakeRoot();
    pinHostTheme(root, { scheme: 'dark', accent: '#FFEE00' });
    assert.equal(root.dataset.theme, 'dark');
    assert.deepEqual(Object.fromEntries(root.props), { '--open-artifact-accent': '#ffee00', '--open-artifact-accent-fg': '#0b1220', '--open-artifact-accent-soft': '#ffee001f' });
  });

  it('takes back the accent it set when a later theme has none, and keeps the scheme', () => {
    const root = fakeRoot();
    pinHostTheme(root, { scheme: 'dark', accent: '#1d4ed8' });
    pinHostTheme(root, { scheme: 'light' });
    assert.equal(root.dataset.theme, 'light');
    for (const name of HOST_ACCENT_VARS) assert.equal(root.props.has(name), false, name);
    pinHostTheme(root, { scheme: 'light', accent: 'red' });
    assert.equal(root.props.size, 0, 'an accent that is not #rrggbb sets nothing');
  });

  it("never removes an accent the page set itself, and a missing or unknown theme changes nothing", () => {
    const root = fakeRoot();
    root.dataset.theme = 'dark';
    root.props.set('--open-artifact-accent', '#123456');
    pinHostTheme(root, { scheme: 'light' });
    assert.equal(root.props.get('--open-artifact-accent'), '#123456', 'not pinned by a host theme, so not taken back');
    pinHostTheme(root, undefined);
    pinHostTheme(root, { scheme: 'system', accent: '#ffffff' });
    assert.equal(root.dataset.theme, 'light');
    assert.equal(root.props.get('--open-artifact-accent'), '#123456');
  });
});
