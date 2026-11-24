import assert from 'node:assert/strict';
import { test } from 'node:test';
import { shellHref, withUiLanguage } from '../src/lib/navigation.ts';

test('opening an artifact and going back to the library keep the preview language', () => {
  assert.equal(shellHref('a/b', '?lang=zh&thread=old'), '/a/a%2Fb?lang=zh');
  assert.equal(withUiLanguage('/', '?lang=zh&panel=share'), '/?lang=zh');
  assert.equal(shellHref('a/b', '?panel=share'), '/a/a%2Fb');
});

test('document duplication keeps destination queries and fragments', () => {
  assert.equal(withUiLanguage('/copy?key=value#slide', '?lang=zh'), '/copy?key=value&lang=zh#slide');
  assert.equal(withUiLanguage('/copy?key=a%20b#slide', '?lang=zh'), '/copy?key=a%20b&lang=zh#slide');
  assert.equal(withUiLanguage('/copy?lang=en#slide', '?lang=zh'), '/copy?lang=en#slide');
});

test('ignores unsupported source languages and leaves external URLs alone', () => {
  assert.equal(withUiLanguage('/copy?key=a%20b#slide', '?lang=zh!'), '/copy?key=a%20b#slide');
  assert.equal(withUiLanguage('/', '?lang=fr'), '/');
  assert.equal(withUiLanguage('https://example.com/copy', '?lang=zh'), 'https://example.com/copy');
});
