import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { translate, type MessageKey } from '../src/lib/i18n.ts';

test('the English and Chinese dictionaries have the same keys and placeholders', () => {
  const source = readFileSync(new URL('../src/lib/i18n.ts', import.meta.url), 'utf8');
  const keys = (dictionary: string) => [...dictionary.matchAll(/^  (\w+):/gm)].map((match) => match[1]);
  const en = keys(source.match(/^const EN = \{\r?\n([\s\S]*?)^\}/m)![1]!);
  const zh = keys(source.match(/^const ZH: .* = \{\r?\n([\s\S]*?)^\}/m)![1]!);
  assert.ok(en.length > 0);
  assert.equal(new Set(en).size, en.length);
  assert.deepEqual(zh.sort(), en.sort());
  const placeholders = (message: string) => [...message.matchAll(/\{\w+\}/g)].map((match) => match[0]).sort();
  for (const key of en as MessageKey[]) {
    assert.deepEqual(placeholders(translate('zh-CN', key)), placeholders(translate('en', key)), key);
  }
});
