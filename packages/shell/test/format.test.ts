import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ago, avatarColor, bytesText, fileNameOf, formatKind, initials } from '../src/lib/format.ts';
import { fill, localeOf, translate } from '../src/lib/i18n.ts';
import { localize, preferredLocale } from '@open-artifact/runtime';

describe('format', () => {
  it('formats sizes', () => {
    assert.equal(bytesText(undefined), '');
    assert.equal(bytesText(512), '512 B');
    assert.equal(bytesText(1536), '1.5 KB');
    assert.equal(bytesText(50 * 1024 * 1024), '50 MB');
  });

  it('formats relative times', () => {
    const now = Date.parse('2026-05-10T12:00:00Z');
    assert.equal(ago(null, now), '');
    assert.equal(ago('nonsense', now), '');
    assert.equal(ago('2026-05-10T11:59:30Z', now, 'en'), translate('en', 'justNow'));
    assert.equal(ago('2026-05-10T11:55:00Z', now, 'en'), '5 minutes ago');
    assert.equal(ago('2026-05-09T12:00:00Z', now, 'en'), 'yesterday');
  });

  it('makes initials and stable colors', () => {
    assert.equal(initials('Ada Lovelace'), 'AL');
    assert.equal(initials('宝玉'), '宝');
    assert.equal(initials(''), '?');
    assert.equal(avatarColor('x'), avatarColor('x'));
  });

  it('picks export icons by label', () => {
    assert.equal(formatKind('PDF document'), 'pdf');
    assert.equal(formatKind('Project folder (.zip)'), 'folder');
    assert.equal(formatKind('PNG image'), 'image');
    assert.equal(formatKind('Standalone HTML'), 'html');
    assert.equal(formatKind('Something else'), 'file');
    assert.equal(formatKind('PNG images (.zip)'), 'image', 'a zip of images is images');
    assert.equal(formatKind('ZIP archive'), 'file');
    assert.equal(formatKind('Word document'), 'document');
    assert.equal(formatKind('Excel'), 'spreadsheet');
    assert.equal(formatKind('CSV'), 'spreadsheet');
  });
});

describe('i18n', () => {
  it('picks Chinese for zh tags only', () => {
    assert.equal(localeOf('zh-CN'), 'zh-CN');
    assert.equal(localeOf('zh-TW'), 'zh-CN');
    assert.equal(localeOf('en-US'), 'en');
    assert.equal(localeOf('zh!'), 'en');
    assert.equal(localeOf(undefined), 'en');
  });

  it('uses the first browser language unless the URL overrides it', () => {
    const browser = { language: 'en-US', languages: ['zh-Hant', 'en-US'] };
    assert.equal(preferredLocale('', browser), 'zh-CN');
    assert.equal(preferredLocale('?lang=en', browser), 'en');
    assert.equal(preferredLocale('?lang=zh', { language: 'en-US', languages: [] }), 'zh-CN');
    assert.equal(preferredLocale('?lang=fr', browser), 'zh-CN');
    assert.equal(preferredLocale('?lang=', browser), 'zh-CN');
    assert.equal(preferredLocale('', { language: 'zh-CN', languages: [] }), 'zh-CN');
    assert.equal(preferredLocale('', { language: 'zh-CN', languages: ['fr-FR', 'zh-CN'] }), 'en');
    assert.equal(localize('Slide', '幻灯片'), 'Slide');
  });

  it('fills placeholders in both languages', () => {
    assert.equal(fill('Hi {name}, {missing}', { name: 'A' }), 'Hi A, {missing}');
    assert.equal(translate('en', 'sendToAgent', { agent: 'Helper' }), 'Send to Helper');
    assert.equal(translate('zh-CN', 'sendToAgent', { agent: 'Helper' }), '发给 Helper');
  });
});

describe('fileNameOf', () => {
  it('reads the download name from Content-Disposition, filename* first', () => {
    assert.equal(fileNameOf(`attachment; filename="My deck.zip"; filename*=UTF-8''%E6%88%91%E7%9A%84.zip`), '我的.zip');
    assert.equal(fileNameOf('attachment; filename="plain.zip"'), 'plain.zip');
    assert.equal(fileNameOf('attachment; filename=bare.zip'), 'bare.zip');
    assert.equal(fileNameOf(`attachment; filename="ok.zip"; filename*=UTF-8''%E0%A4%A`), 'ok.zip');
    assert.equal(fileNameOf(null), '');
    assert.equal(fileNameOf('inline'), '');
  });
});
