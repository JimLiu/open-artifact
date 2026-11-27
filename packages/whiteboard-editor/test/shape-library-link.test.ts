import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readShapeLibrary, SHAPE_LIBRARY_LIMITS, type ShapeLibraryRead } from '@open-artifact/whiteboard-core';
import { checkLibraryLink, linkFileName, readCapped, withLinkSource } from '../src/services/shape-library-link.ts';

const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/></svg>';

function read(source?: string): ShapeLibraryRead {
  const result = readShapeLibrary(JSON.stringify({ format: 'open-artifact-shapes', version: 1, name: 'Lib', ...(source ? { source } : {}), shapes: [{ name: 'Dot', svg }] }), 'Lib');
  assert.ok(result.ok);
  return result;
}

describe('links to shape libraries', () => {
  it('takes only https:// links, before anything is fetched', () => {
    assert.deepEqual(checkLibraryLink('  '), { ok: false, reason: 'Paste a link to a shape library.' });
    assert.deepEqual(checkLibraryLink('icons.zip'), { ok: false, reason: 'This is not a link.' });
    for (const link of ['http://example.org/a.zip', 'file:///etc/passwd', 'javascript:alert(1)', 'data:application/zip,PK', 'ftp://example.org/a.zip']) {
      assert.deepEqual(checkLibraryLink(link), { ok: false, reason: 'Only https:// links can be added.' }, link);
    }
    assert.equal(checkLibraryLink('https://user:secret@example.org/a.zip').ok, false);
    const ok = checkLibraryLink(' https://example.org/packs/Cloud%20icons.zip?v=2 ');
    assert.ok(ok.ok && ok.url.host === 'example.org');
  });

  it('names what it fetched after the last part of the path, else the site', () => {
    assert.equal(linkFileName(new URL('https://example.org/packs/Cloud%20icons.zip?v=2')), 'Cloud icons.zip');
    assert.equal(linkFileName(new URL('https://example.org/lib/network.xml/')), 'network.xml');
    assert.equal(linkFileName(new URL('https://example.org/')), 'example.org');
    assert.equal(linkFileName(new URL('https://example.org/bad%E0%A4%A')), 'bad%E0%A4%A');
  });

  it('records the link as the source unless the library names its own, or the link is too long', () => {
    const url = new URL('https://example.org/packs/lib.shapes.json');
    assert.equal(withLinkSource(read(), url).library.source, url.href);
    assert.equal(withLinkSource(read('https://example.com/home'), url).library.source, 'https://example.com/home');
    const long = new URL(`https://example.org/${'a'.repeat(SHAPE_LIBRARY_LIMITS.source)}`);
    assert.equal(withLinkSource(read(), long).library.source, undefined);
  });

  it('reads a body in pieces and stops once it passes the cap, whatever the server claims', async () => {
    const body = (sizes: number[]) =>
      new ReadableStream<Uint8Array>({
        start(controller) {
          for (const size of sizes) controller.enqueue(new Uint8Array(size).fill(65));
          controller.close();
        },
      });
    const bytes = await readCapped(body([3, 4]), 10);
    assert.ok(bytes instanceof Uint8Array && bytes.length === 7);
    assert.equal(await readCapped(body([6, 6]), 10), 'too_large');
    assert.equal(((await readCapped(null, 10)) as Uint8Array).length, 0);
  });
});
