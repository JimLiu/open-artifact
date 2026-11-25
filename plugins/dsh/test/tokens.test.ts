/**
 * The page's CSS (`@open-artifact/library-page`) reads neutral tokens (`--oa-page-*`); the plugin says which of the
 * app's tokens each one is (src/client/styles.ts). Every token the page reads has to be there, or it draws without it.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { PAGE_CSS, UPDATE_CSS } from '@open-artifact/library-page/styles';
import { PAGE_TOKENS, TOKEN_CSS } from '../src/client/styles.ts';

/** The `--oa-page-*` tokens a CSS text reads. */
const read = (css: string) => new Set([...css.matchAll(/var\((--oa-page-[a-z0-9-]+)/g)].map((m) => m[1]!));

describe('page tokens', () => {
  it('maps every token the page reads, and none it does not', () => {
    const used = read(PAGE_CSS + UPDATE_CSS);
    assert.ok(used.size > 0);
    const mapped = new Set(Object.keys(PAGE_TOKENS));
    assert.deepEqual([...used].filter((name) => !mapped.has(name)), [], 'tokens the page reads that the plugin does not map');
    assert.deepEqual([...mapped].filter((name) => !used.has(name)), [], 'tokens the plugin maps that the page never reads');
  });

  it("maps each one onto the app's own tokens, on the page and on the classes drawn outside it", () => {
    for (const [name, value] of Object.entries(PAGE_TOKENS)) {
      assert.match(value, /^var\(--ds[wh]-/, name);
      assert.ok(TOKEN_CSS.includes(`${name}:${value}`), name);
    }
    assert.match(TOKEN_CSS, /^\s*\.oa-page,\.oa-btn,\.oau-tag\{/);
  });

  it("keeps the page's CSS free of the app's tokens and selectors", () => {
    assert.doesNotMatch(PAGE_CSS + UPDATE_CSS, /--dsw-|--dsh-|data-ds-dark-theme/);
  });
});
