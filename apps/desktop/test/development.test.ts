import assert from 'node:assert/strict';
import test from 'node:test';
import { desktopPage, rendererUrl } from '../src/development.ts';
import { pageUrlOf } from '../src/page-url.ts';

test('the Vite renderer is explicit, loopback only, and ignored by packaged apps', () => {
  const dev = 'http://127.0.0.1:5173/dev.html';
  assert.equal(rendererUrl(dev, false), dev);
  assert.equal(rendererUrl(undefined, false), null);
  assert.equal(rendererUrl(dev, true), null);
  assert.equal(rendererUrl('invalid', true), null);
  for (const url of ['https://example.com/dev.html', 'http://localhost:5173/dev.html', 'http://127.0.0.1/dev.html', 'http://127.0.0.1:5173/other.html', `${dev}?a`, `${dev}#a`, 'http://user@127.0.0.1:5173/dev.html'])
    assert.throws(() => rendererUrl(url, false), /OA_DESKTOP_RENDERER_URL/, url);
});

test('IPC accepts only the selected page, including the exact development path', () => {
  const file = '/tmp/计划 #2 50%?.app/out/renderer/index.html';
  const production = desktopPage(file, null);
  assert.equal(production.url, pageUrlOf(file));
  assert.ok(production.matches(production.url));
  const development = desktopPage(file, 'http://127.0.0.1:5173/dev.html');
  assert.ok(development.matches(development.url));
  for (const url of [production.url, 'http://127.0.0.1:5173/', 'http://127.0.0.1:5173/other.html', 'http://127.0.0.1:5174/dev.html', `${development.url}?a`, `${development.url}#a`, null])
    assert.equal(development.matches(url), false, String(url));
  assert.equal(production.matches(development.url), false);
});
