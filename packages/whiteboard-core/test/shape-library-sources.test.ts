import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';
import {
  MX_RASTER_REASON,
  MX_UNREADABLE_REASON,
  SHAPE_LIBRARY_LIMITS,
  UNKNOWN_LIBRARY_FILE_REASON,
  ZIP_PACK_LIMITS,
  inflateRawLimited,
  readMxLibrary,
  readShapeLibraryBytes,
  readZipDirectory,
  readZipShapeLibrary,
  sniffLibraryBytes,
  svgOfGraph,
  zipEntryShapeName,
  zipPackName,
  type ShapeLibraryRead,
  type ShapeLibraryRefusal,
} from '../src/index.ts';

const svg = (inner = '<circle cx="12" cy="12" r="9"/>') => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor">${inner}</svg>`;
const utf8 = (text: string) => new TextEncoder().encode(text);

/** One file of a test zip. */
interface ZipFile {
  name: string;
  data: Uint8Array | string;
  /** 0 stored, 8 deflated (default), or anything else. */
  method?: number;
  flags?: number;
  /** Writes 0xFFFFFFFF as the stated compressed size, as zip64 does. */
  zip64?: boolean;
}

/** A small zip writer for the tests (no CRCs: the reader does not check them). */
function zip(files: readonly ZipFile[]): Uint8Array {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const file of files) {
    const raw = typeof file.data === 'string' ? Buffer.from(file.data) : Buffer.from(file.data);
    const method = file.method ?? 8;
    const body = method === 8 ? deflateRawSync(raw) : raw;
    const name = Buffer.from(file.name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE((file.flags ?? 0) | 0x800, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26);
    locals.push(local, name, body);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE((file.flags ?? 0) | 0x800, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(file.zip64 ? 0xffffffff : body.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);
    offset += 30 + name.length + body.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...locals, directory, end]));
}

function library<Read extends ShapeLibraryRead>(read: Read | ShapeLibraryRefusal): Read {
  assert.ok(read.ok, read.ok ? '' : read.reason);
  return read;
}

describe('telling library files apart by content', () => {
  it('knows a zip, a draw.io library, a JSON library and an SVG whatever they are called', () => {
    assert.equal(sniffLibraryBytes(zip([{ name: 'a.svg', data: svg() }])), 'zip');
    assert.equal(sniffLibraryBytes(utf8('\uFEFF \n <mxlibrary>[]</mxlibrary>')), 'mxlibrary');
    assert.equal(sniffLibraryBytes(utf8('  {"format":"open-artifact-shapes"}')), 'json');
    assert.equal(sniffLibraryBytes(utf8('<?xml version="1.0"?>\n<!-- made by hand -->\n<!DOCTYPE svg>\n' + svg())), 'svg');
    assert.equal(sniffLibraryBytes(utf8('<html><body>Not found</body></html>')), 'unknown');
    assert.equal(sniffLibraryBytes(utf8('{ not json')), 'unknown');
    assert.equal(sniffLibraryBytes(utf8('<mxGraphModel/>')), 'unknown');
  });

  it('refuses a file of no known kind, naming every kind it takes', async () => {
    const read = await readShapeLibraryBytes(utf8('hello'), 'notes.txt');
    assert.deepEqual(read, { ok: false, reason: UNKNOWN_LIBRARY_FILE_REASON });
    assert.match(UNKNOWN_LIBRARY_FILE_REASON, /\.shapes\.json.*\.zip.*draw\.io.*SVG/);
  });

  it('reads one SVG as a library named after the file', async () => {
    const read = library(await readShapeLibraryBytes(utf8(svg()), 'router.svg'));
    assert.equal(read.library.name, 'router');
    assert.deepEqual(read.library.shapes.map((shape) => shape.name), ['router']);
  });
});

describe('zip packs', () => {
  it('makes a shape of each SVG file, its folders (nearest first) as tags, and skips the rest silently', async () => {
    const bytes = zip([
      { name: 'icons/', data: '' , method: 0 },
      { name: 'icons/network/Router.svg', data: svg() },
      { name: 'icons/Database.SVG', data: svg('<rect width="20" height="20"/>'), method: 0 },
      { name: '__MACOSX/icons/._Router.svg', data: 'junk' },
      { name: 'icons/.hidden.svg', data: svg() },
      { name: '.git/x.svg', data: svg() },
      { name: 'README.md', data: '# icons' },
      { name: 'icons/logo.png', data: new Uint8Array([137, 80, 78, 71]) },
    ]);
    const read = library(await readShapeLibraryBytes(bytes, 'Cloud icons.zip'));
    assert.equal(read.kind, 'zip');
    assert.equal(read.library.name, 'Cloud icons');
    assert.deepEqual(read.library.shapes.map((shape) => [shape.name, shape.tags]), [
      ['Router', ['network', 'icons']],
      ['Database', ['icons']],
    ]);
    assert.deepEqual(read.leftOut, []);
    assert.equal(read.overLimit, 0);
  });

  it('turns path-like and hostile names into plain text', () => {
    assert.deepEqual(zipEntryShapeName('../../etc/<img src=x onerror=alert(1)>.svg'), { name: '<img src=x onerror=alert(1)>', tags: ['etc'] });
    // A slash always separates folders, even inside what looks like markup.
    assert.deepEqual(zipEntryShapeName('<b>evil</b>.svg'), { name: 'b>', tags: ['<b>evil<'] });
    assert.deepEqual(zipEntryShapeName('C:\\Windows\\..\\icon.svg'), { name: 'icon', tags: ['Windows', 'C:'] });
    assert.deepEqual(zipEntryShapeName('/abs/./x\u0000y.svg'), { name: 'x y', tags: ['abs'] });
    assert.equal(zipEntryShapeName('a/b/'), undefined);
    assert.deepEqual(zipEntryShapeName('1/2/3/4/5/6/7/8/9/10/deep.svg')?.tags, ['10', '9', '8', '7', '6', '5', '4', '3'].slice(0, SHAPE_LIBRARY_LIMITS.tags));
    assert.equal(zipPackName('https/path/My pack.ZIP'), 'My pack');
  });

  it('stops inflating an entry at its cap, so a tiny entry that unpacks huge is left out as too large', async () => {
    const bomb = svg(`<!--${' '.repeat(40 * 1024 * 1024)}-->`);
    const bytes = zip([{ name: 'bomb.svg', data: bomb }, { name: 'ok.svg', data: svg() }]);
    assert.ok(bytes.length < 200_000, 'the zip itself is small');
    let largest = 0;
    const read = library(
      await readZipShapeLibrary(bytes, 'pack', async (data, max) => {
        const out = await inflateRawLimited(data, max);
        largest = Math.max(largest, max);
        return out;
      }),
    );
    assert.equal(largest, ZIP_PACK_LIMITS.entryBytes);
    assert.deepEqual(read.leftOut, [{ name: 'bomb', reason: 'is too large (over 400,000 bytes)' }]);
    assert.deepEqual(read.library.shapes.map((shape) => shape.name), ['ok']);
  });

  it('inflates at most the limit it is given', async () => {
    const data = new Uint8Array(deflateRawSync(Buffer.alloc(1_000_000)));
    assert.deepEqual(await inflateRawLimited(data, 1000), { ok: false, reason: 'too_large' });
    const fits = await inflateRawLimited(data, 1_000_000);
    assert.ok(fits.ok && fits.bytes.length === 1_000_000);
    assert.deepEqual(await inflateRawLimited(new Uint8Array([1, 2, 3, 4, 5]), 100), { ok: false, reason: 'damaged' });
  });

  it('stops reading once the pack has unpacked 16 MB, leaving the rest out', async () => {
    const big = svg(`<!--${'x'.repeat(390_000)}-->`);
    const files = Array.from({ length: 45 }, (_, n) => ({ name: `big-${n}.svg`, data: big }));
    const read = library(await readZipShapeLibrary(zip(files), 'big'));
    const tooMuch = read.leftOut.filter((shape) => shape.reason.includes('more than 16 MB'));
    assert.ok(read.library.shapes.length >= 40 && read.library.shapes.length < 45, `${read.library.shapes.length} read`);
    assert.equal(read.library.shapes.length + tooMuch.length, 45);
  });

  it('reads at most 500 drawings and counts the rest', async () => {
    const files = Array.from({ length: 503 }, (_, n) => ({ name: `s${n}.svg`, data: svg(), method: 0 }));
    const read = library(await readZipShapeLibrary(zip(files), 'many'));
    assert.equal(read.library.shapes.length, 500);
    assert.equal(read.overLimit, 3);
  });

  it('leaves out encrypted, zip64 and oddly compressed entries with a reason', async () => {
    const read = library(
      await readZipShapeLibrary(
        zip([
          { name: 'locked.svg', data: svg(), flags: 1 },
          { name: 'huge.svg', data: svg(), zip64: true },
          { name: 'odd.svg', data: svg(), method: 12 },
          { name: 'fine.svg', data: svg() },
        ]),
        'mixed',
      ),
    );
    assert.deepEqual(read.leftOut, [
      { name: 'locked', reason: 'is encrypted' },
      { name: 'huge', reason: 'is stored as zip64, which boards cannot read' },
      { name: 'odd', reason: 'is compressed in a way boards cannot read' },
    ]);
    assert.deepEqual(read.library.shapes.map((shape) => shape.name), ['fine']);
  });

  it('refuses a zip over 4 MB, a damaged one, and drawings that fail cleaning are left out as usual', async () => {
    const large = new Uint8Array(SHAPE_LIBRARY_LIMITS.bytes + 1);
    large.set([0x50, 0x4b, 3, 4]);
    assert.match((await readZipShapeLibrary(large, 'x') as ShapeLibraryRefusal).reason, /larger than 4 MB/);
    assert.equal(readZipDirectory(new Uint8Array([0x50, 0x4b, 3, 4, 0, 0])).ok, false);
    const read = library(await readZipShapeLibrary(zip([{ name: 'bad.svg', data: svg('<script>alert(1)</script>') }]), 'x'));
    assert.match(read.leftOut[0]!.reason, /uses <script>/);
  });
});

describe('draw.io libraries', () => {
  const base64 = (text: string) => Buffer.from(text).toString('base64');
  const cell = (style: string) =>
    `<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/><mxCell id="2" value="" style="${style}" vertex="1" parent="1"><mxGeometry width="30" height="20" as="geometry"/></mxCell></root></mxGraphModel>`;
  const compressed = (xml: string) => deflateRawSync(Buffer.from(encodeURIComponent(xml))).toString('base64');
  const imageStyle = `shape=image;verticalLabelPosition=bottom;aspect=fixed;image=data:image/svg+xml,${base64(svg('<rect width="24" height="16"/>'))};`;

  it('takes SVG pictures (data entries, and single picture cells in plain or compressed xml) and leaves out the rest', async () => {
    const entries = [
      { data: `data:image/svg+xml;base64,${base64(svg())}`, w: 40, h: 40, title: 'Disk' },
      { data: `data:image/svg+xml,${encodeURIComponent(svg())}`, w: 40, h: 40 },
      { data: 'data:image/png;base64,iVBORw0KGgo=', w: 40, h: 40, title: 'Photo' },
      { xml: cell(imageStyle), w: 30, h: 20, title: 'Plain cell' },
      { xml: compressed(cell(imageStyle)), title: 'Packed cell' },
      { xml: compressed(cell('shape=mxgraph.aws4.lambda;fillColor=#F78E04;')), title: 'Stencil' },
      { xml: cell('shape=image;image=data:image/png,iVBORw0KGgo=;'), title: 'Raster cell' },
      { xml: cell(imageStyle).replace('</root>', '<mxCell id="3" vertex="1" parent="1" style="ellipse"/></root>'), title: 'Two cells' },
      { title: 'Empty' },
    ];
    const text = `<mxlibrary>${JSON.stringify(entries)}</mxlibrary>`;
    const read = library(await readShapeLibraryBytes(utf8(text), 'Network.drawio'));
    assert.equal(read.kind, 'mxlibrary');
    assert.equal(read.library.name, 'Network');
    assert.deepEqual(read.library.shapes.map((shape) => [shape.name, shape.w, shape.h]), [
      ['Disk', 40, 40],
      ['Shape 2', 40, 40],
      ['Plain cell', 30, 20],
      ['Packed cell', 30, 20],
    ]);
    assert.deepEqual(read.leftOut, [
      { name: 'Photo', reason: MX_RASTER_REASON },
      { name: 'Stencil', reason: MX_UNREADABLE_REASON },
      { name: 'Raster cell', reason: MX_RASTER_REASON },
      { name: 'Two cells', reason: MX_UNREADABLE_REASON },
      { name: 'Empty', reason: 'is not a shape' },
    ]);
  });

  it('reads a list written with XML entities and refuses one that is not JSON', async () => {
    const entities = `<mxlibrary>[{&quot;data&quot;:&quot;data:image/svg+xml;base64,${base64(svg())}&quot;,&quot;title&quot;:&quot;A&quot;}]</mxlibrary>`;
    assert.equal(library(await readMxLibrary(entities, 'x')).library.shapes.length, 1);
    assert.equal((await readMxLibrary('<mxlibrary>nope</mxlibrary>', 'x')).ok, false);
  });

  it('reads the list as draw.io saves it: <, > and & as entities, quotes left as they are', async () => {
    const escape = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const text = `<mxlibrary>${escape(JSON.stringify([{ xml: cell(imageStyle), w: 30, h: 20, title: 'R&D box' }]))}</mxlibrary>`;
    assert.match(text, /"xml":"&lt;mxGraphModel&gt;/);
    const read = library(await readMxLibrary(text, 'x'));
    assert.deepEqual(read.library.shapes.map((shape) => shape.name), ['R&D box']);
    assert.deepEqual(read.leftOut, []);
  });

  it('stops unpacking compressed graphs once the library has unpacked 16 MB in all', async () => {
    let asked = 0;
    const inflate = async (_bytes: Uint8Array, max: number) => {
      asked++;
      return { ok: true as const, bytes: new Uint8Array(Math.min(max, 400_000)) };
    };
    const entries = Array.from({ length: 60 }, (_, i) => ({ xml: compressed(cell(imageStyle)), title: `S${i}` }));
    const read = library(await readMxLibrary(`<mxlibrary>${JSON.stringify(entries)}</mxlibrary>`, 'x', inflate));
    assert.equal(read.leftOut.length, 60);
    assert.ok(asked < 60, `inflating stopped at the budget: ${asked}`);
  });

  it('never takes a graph cell that is not an SVG picture', () => {
    assert.deepEqual(svgOfGraph('<mxGraphModel><root/></mxGraphModel>'), { reason: MX_UNREADABLE_REASON });
    assert.deepEqual(svgOfGraph('not xml'), { reason: MX_UNREADABLE_REASON });
    assert.deepEqual(svgOfGraph(cell('image;image=https://example.org/a.svg')), { reason: MX_UNREADABLE_REASON });
  });
});
