import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DASHBOARD_EXPORT_FORMATS, dashboardChromeFormats } from '../src/export/formats.ts';
import { paperForLocale, pdfPageLayout } from '../src/export/pdf.ts';
import { printMediaQuery } from '../src/export/print-media.ts';

describe('media queries as they evaluate on paper', () => {
  it('leaves queries about other things alone', () => {
    for (const query of ['', 'all', '(min-width: 40rem)', '(hover: hover)', '(pointer: coarse), (hover: none)', 'speech']) assert.equal(printMediaQuery(query), null, query);
  });

  it('turns print on', () => {
    assert.equal(printMediaQuery('print'), 'all');
    assert.equal(printMediaQuery('PRINT'), 'all');
    assert.equal(printMediaQuery('only print'), 'all');
    assert.equal(printMediaQuery('print and (min-width: 600px)'), 'all and (min-width: 600px)');
    assert.equal(printMediaQuery('not print'), 'not all');
    assert.equal(printMediaQuery('not print and (orientation: landscape)'), 'not all and (orientation: landscape)');
  });

  it('turns screen off, whatever its features say', () => {
    assert.equal(printMediaQuery('screen'), 'not all');
    assert.equal(printMediaQuery('only screen and (max-width: 640px)'), 'not all');
    assert.equal(printMediaQuery('not screen'), 'all');
    assert.equal(printMediaQuery('not screen and (color)'), 'all');
  });

  it('rewrites each query of a list on its own', () => {
    assert.equal(printMediaQuery('screen, print'), 'not all, all');
    assert.equal(printMediaQuery('print, (min-width: 900px)'), 'all, (min-width: 900px)');
    assert.equal(printMediaQuery('screen and (min-width: calc(1px, 2px)), print'), 'not all, all');
  });

  it('prints in the light colour scheme', () => {
    assert.equal(printMediaQuery('(prefers-color-scheme: dark)'), '(max-width:0px)');
    assert.equal(printMediaQuery('(prefers-color-scheme:light)'), '(min-width:0px)');
    assert.equal(printMediaQuery('screen and (prefers-color-scheme: dark)'), 'not all');
    assert.equal(printMediaQuery('print and (prefers-color-scheme: dark)'), 'all and (max-width:0px)');
  });

  it('does not mistake a longer word for a media type', () => {
    assert.equal(printMediaQuery('(min-width: 1px) and (prefers-reduced-motion: no-preference)'), null);
    assert.equal(printMediaQuery('printer'), null);
  });
});

describe('the PDF’s sheets', () => {
  it('picks the paper a reader prints on from their locale', () => {
    assert.equal(paperForLocale('en-US'), 'letter');
    assert.equal(paperForLocale('en'), 'letter');
    assert.equal(paperForLocale('fr-CA'), 'letter');
    assert.equal(paperForLocale('en-GB'), 'a4');
    assert.equal(paperForLocale('zh-CN'), 'a4');
    assert.equal(paperForLocale('de'), 'a4');
    assert.equal(paperForLocale(undefined), 'a4');
    assert.equal(paperForLocale('not a locale'), 'a4');
  });

  it('lays a narrow dashboard out one paper wide, upright', () => {
    for (const shown of [0, 380, 816, Number.NaN]) {
      assert.deepEqual(pdfPageLayout(shown, 'letter'), { width: 816, height: 1056, pointWidth: 612, pointHeight: 792, landscape: false }, String(shown));
    }
    assert.deepEqual(pdfPageLayout(600, 'a4'), { width: 794, height: 1123, pointWidth: 595.5, pointHeight: 842.25, landscape: false });
  });

  it('keeps a wider dashboard’s own width, on a sheet of the same shape', () => {
    // A little wider than the paper: still upright, scaled to fit.
    assert.deepEqual(pdfPageLayout(900, 'letter'), { width: 900, height: 1165, pointWidth: 612, pointHeight: 792, landscape: false });
    // A desktop window: the sheet turns on its side.
    assert.deepEqual(pdfPageLayout(1199.2, 'letter'), { width: 1200, height: 927, pointWidth: 792, pointHeight: 612, landscape: true });
    assert.equal(pdfPageLayout(1200, 'a4').landscape, true);
  });

  it('stops at two sheets wide', () => {
    assert.deepEqual(pdfPageLayout(4000, 'letter'), { width: 2112, height: 1632, pointWidth: 792, pointHeight: 612, landscape: true });
  });
});

describe('the dashboard’s export formats', () => {
  it('offers the PDF as a file and Print… as the row that opens a dialog', () => {
    assert.deepEqual([...DASHBOARD_EXPORT_FORMATS], ['pdf', 'print', 'html', 'json']);
    const formats = dashboardChromeFormats({ ready: true });
    assert.equal(formats.find((format) => format.format === 'pdf')?.more, undefined);
    assert.equal(formats.find((format) => format.format === 'print')?.more, true);
    assert.equal(formats.find((format) => format.format === 'print')?.label, 'Print…');
    assert.deepEqual(dashboardChromeFormats({ ready: true }, ['pdf', 'print']).map((format) => format.format), ['pdf', 'print']);
  });
});
