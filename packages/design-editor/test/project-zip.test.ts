import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  keptInProjectZip,
  leftOutNotice,
  OVER_LIMIT,
  planZipParts,
  PROJECT_ZIP_LIMITS,
  projectReadme,
  readmeName,
  zipPartName,
  type ProjectReadme,
} from '../src/lib/project-zip.ts';

const readme = (over: Partial<ProjectReadme> = {}): string =>
  projectReadme({
    title: 'Shop',
    part: 1,
    parts: 1,
    pages: [{ name: 'Web', boards: [{ path: 'Home.dc.html', title: 'Home' }, { path: 'Cart.dc.html' }] }],
    files: ['canvas.json', 'styles.css'],
    index: 'index.html',
    assets: true,
    runtimes: [''],
    notUtf8: [],
    missing: [],
    leftOut: [],
    complete: true,
    ...over,
  });

describe('which project files go into the zip', () => {
  it('leaves out hidden paths, empty parts and the editor’s own data', () => {
    for (const path of ['.git/x', 'a/.git/x', 'a//b', '.foo', 'a/', 'project-data.json']) assert.equal(keptInProjectZip(path), false, path);
    for (const path of ['canvas.json', 'Home.dc.html', 'ds/x/tokens.css', 'a.b/c.png', 'img/5x.png']) assert.equal(keptInProjectZip(path), true, path);
  });
});

describe('splitting a project into zips', () => {
  const limits = { partBytes: 100, partEntries: 4, totalBytes: 250 };

  it('keeps a small project in one zip with plain names', () => {
    assert.deepEqual(planZipParts([{ name: 'a', size: 10 }, { name: 'b', size: 20 }], limits), { parts: [['a', 'b']], leftOut: [] });
    assert.equal(zipPartName('Shop', 1, 1), 'Shop.zip');
    assert.equal(readmeName(1, 1), 'README.md');
  });

  it('starts a new zip at the byte or entry limit, leaving room for the README', () => {
    assert.deepEqual(planZipParts([{ name: 'a', size: 60 }, { name: 'b', size: 60 }, { name: 'c', size: 30 }], limits).parts, [['a'], ['b', 'c']]);
    assert.deepEqual(planZipParts(['a', 'b', 'c', 'd'].map((name) => ({ name, size: 1 })), limits).parts, [['a', 'b', 'c'], ['d']]);
    assert.deepEqual(planZipParts([{ name: 'big', size: 150 }, { name: 'a', size: 1 }], limits).parts, [['big'], ['a']], 'a file larger than a zip goes alone');
    assert.equal(zipPartName('Shop', 2, 3), 'Shop-2-of-3.zip');
    assert.equal(readmeName(2, 3), 'README-2-of-3.md');
  });

  it('leaves out files past the whole export’s limit and keeps going', () => {
    const plan = planZipParts([{ name: 'a', size: 100 }, { name: 'b', size: 100 }, { name: 'c', size: 100 }, { name: 'd', size: 50 }], limits);
    assert.deepEqual(plan.parts, [['a'], ['b'], ['d']]);
    assert.deepEqual(plan.leftOut, [{ path: 'c', why: OVER_LIMIT }]);
    assert.equal(OVER_LIMIT, 'it would take the export past the 1 GB a browser can hold at once');
  });

  it('holds 190 MB and 65,000 entries a zip, 1 GB in all', () => {
    assert.deepEqual(PROJECT_ZIP_LIMITS, { partBytes: 190 * 1024 * 1024, partEntries: 65000, totalBytes: 1024 * 1024 * 1024 });
  });
});

describe('the project README', () => {
  it('lists pages, their artboards and the other files', () => {
    const text = readme();
    assert.match(text, /^# Shop — entire project\n\nThis project’s pages, files, and uploads as this browser tab had them at export\.\nAnything left out is listed below\.\n\n## Contents\n\n### Web\n\n- `Home\.dc\.html` — Home\n- `Cart\.dc\.html`\n\n### Other files\n\n/);
    assert.ok(text.includes('- `canvas.json` — the canvas: its pages, where each artboard sits, its notes and shapes'));
    assert.ok(text.includes('- `styles.css`\n'));
    assert.ok(text.includes('- `assets/` — files uploaded to the design (images, fonts, media)'));
    assert.ok(text.includes('- `support.js` — what runs the pages in a browser; not part of the design'));
    assert.ok(text.includes('then open an artboard’s `.dc.html` file through it. Opening the file directly may not work, because some browsers block its scripts.'));
    assert.ok(text.includes('## Left out of this export\n\nThe export never includes hidden files (files whose names start with a dot) or files the editor keeps for its own use.'));
    assert.ok(!text.includes('zip 1 of'));
  });

  it('lists the files without a heading when there are no artboards', () => {
    const text = readme({ pages: [], index: null, assets: false, runtimes: [] });
    assert.ok(text.includes('## Contents\n\n- `canvas.json`'));
    assert.ok(!text.includes('### Other files'));
    assert.ok(text.includes('then open a page through it. These are the project’s own files, so a page that relies on the editor may not run from a folder.'));
    assert.ok(text.includes('This export leaves out files the editor keeps for its own use. It also leaves out hidden files'));
  });

  it('says which zip of a set it is, and that the last one has the full list', () => {
    const first = readme({ part: 1, parts: 3 });
    assert.ok(first.includes('This is zip 1 of 3. Unpack all 3 into one folder to get the whole project: a page in one zip can need files from another.'));
    assert.ok(first.includes('## Contents of all 3 zips'));
    assert.ok(first.includes('This list may not be complete. The README in the last zip has the full list.'));
    assert.ok(!readme({ part: 3, parts: 3 }).includes('This list may not be complete.'));
  });

  it('explains what is left out, an incomplete file list, files that aren’t UTF-8 and missing uploads', () => {
    const text = readme({
      leftOut: [{ path: 'video.mp4', why: OVER_LIMIT }, { path: 'gone.png', why: 'it couldn’t be read' }],
      complete: false,
      notUtf8: ['legacy.css'],
      missing: [{ ref: '/_blob/x', usedIn: ['Home.dc.html'] }],
    });
    assert.ok(text.includes('These files aren’t UTF-8, so they were copied unchanged.'));
    assert.ok(text.includes('- `legacy.css`'));
    assert.ok(text.includes('Some files may be missing. The editor couldn’t get this project’s full file list'));
    assert.ok(text.includes('This export is made in your browser, which can’t hold more than 1 GB at once.'));
    assert.ok(text.includes('- `video.mp4` — it would take the export past the 1 GB a browser can hold at once\n- `gone.png` — it couldn’t be read'));
    assert.ok(text.includes('## Missing from this export'));
    assert.ok(text.trimEnd().endsWith('Uploads that could not be included are listed above, under “Missing from this export.”'));
    assert.ok(text.indexOf('## Missing from this export') < text.indexOf('## Viewing'));
  });
});

describe('the project export’s notices', () => {
  it('counts what was left out and points at the README', () => {
    assert.equal(leftOutNotice(1, 1), 'This export left out one file. The README in the .zip says which and why.');
    assert.equal(leftOutNotice(3, 1), 'This export left out 3 files. The README in the .zip says which and why.');
    assert.equal(leftOutNotice(2, 4), 'This export left out 2 files. The README in the last .zip says which and why.');
  });
});
