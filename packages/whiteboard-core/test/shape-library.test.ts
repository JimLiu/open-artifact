import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { composeBoard, decomposeBoard, BOARD_META_PATH } from '../src/codec.ts';
import { checkBoardDocuments } from '../src/check.ts';
import { decodeSvgDataUrl, isAllowedImageSource } from '../src/image-source.ts';
import { unknownSvgParts } from '../src/drawn-svg/vetting.ts';
import { normalizeElement, parseBoardContent } from '../src/normalize.ts';
import { shareUnchangedContent } from '../src/sync/live-board.ts';
import {
  BOARD_SHAPES_PATH,
  MAX_BOARD_SHAPE_LIBRARIES,
  MAX_SHAPE_SVG_CHARS,
  PLACED_SHAPE_SIZE,
  SHAPE_LIBRARY_LIMITS,
  cleanShapeOutline,
  cleanShapeSvg,
  normalizeBoardShapeLibraries,
  placeLibraryShape,
  readShapeLibrary,
  refuseShapeLibrary,
  serializeShapeLibrary,
  shapeLibrariesToRecord,
  shapeLibraryFromSvgFiles,
  shapeMatchesQuery,
  shapeNamesOfLibraryText,
} from '../src/shape-library/index.ts';

const NS = 'http://www.w3.org/2000/svg';
const SQUARE = `<svg xmlns="${NS}" viewBox="0 0 24 24"><rect x="2" y="2" width="20" height="20" fill="none" stroke="currentColor"/></svg>`;

function library(shapes: unknown[], extra: Record<string, unknown> = {}): string {
  return JSON.stringify({ format: 'open-artifact-shapes', version: 1, name: 'Test', shapes, ...extra });
}

function cleaned(svg: string, name = 'Shape'): string {
  const result = cleanShapeSvg(svg, name);
  assert.ok(result.ok, result.ok ? '' : result.reason);
  return result.svg;
}

function refusal(svg: string): string {
  const result = cleanShapeSvg(svg, 'Shape');
  assert.equal(result.ok, false, 'expected the drawing to be refused');
  return result.ok ? '' : result.reason;
}

describe('shape library files', () => {
  it('reads a library and cleans every shape', () => {
    const read = readShapeLibrary(library([{ name: 'Square', tags: ['box', 'Box', ' frame '], svg: SQUARE }], { source: 'https://example.com/set', license: 'CC0' }));
    assert.ok(read.ok);
    assert.equal(read.library.name, 'Test');
    assert.equal(read.library.source, 'https://example.com/set');
    assert.equal(read.library.license, 'CC0');
    assert.deepEqual(read.leftOut, []);
    const [shape] = read.library.shapes;
    assert.equal(shape?.name, 'Square');
    assert.deepEqual(shape?.tags, ['box', 'frame']);
    assert.equal(shape?.w, 24);
    assert.equal(shape?.h, 24);
    assert.equal(unknownSvgParts(shape!.svg).length, 0);
    // Reading the cleaned library again gives the same library.
    const again = readShapeLibrary(serializeShapeLibrary(read.library));
    assert.ok(again.ok);
    assert.deepEqual(again.library, read.library);
  });

  it('refuses the wrong format or version, and text that is not JSON', () => {
    for (const text of ['not json', '[]', JSON.stringify({ format: 'something-else', version: 1, shapes: [] }), JSON.stringify({ format: 'open-artifact-shapes', version: 2, shapes: [] })]) {
      const read = readShapeLibrary(text);
      assert.equal(read.ok, false, text);
    }
    const noShapes = readShapeLibrary(JSON.stringify({ format: 'open-artifact-shapes', version: 1, name: 'x' }));
    assert.equal(noShapes.ok, false);
  });

  it('refuses a library over 4 MB', () => {
    const huge = library([{ name: 'Big', svg: SQUARE, pad: 'x'.repeat(SHAPE_LIBRARY_LIMITS.bytes) }]);
    const read = readShapeLibrary(huge);
    assert.equal(read.ok, false);
    assert.match(read.ok ? '' : read.reason, /larger than 4 MB/);
  });

  it('leaves out from the end the shapes that would make the stored file larger than 4 MB, so it reads back', () => {
    // Each drawing stays under the input limits, but 500 of them cleaned come to well over 4 MB.
    const busy = `<svg xmlns="${NS}" viewBox="0 0 100 100"><path d="${Array.from({ length: 1100 }, (_, index) => `M${index % 97} ${index % 89}h1`).join('')}"/></svg>`;
    const read = shapeLibraryFromSvgFiles(Array.from({ length: 500 }, (_, index) => ({ fileName: `s${index}.svg`, text: busy })), 'Busy');
    assert.ok(read.library.shapes.length > 0 && read.library.shapes.length < 500);
    assert.equal(read.library.shapes.length + read.overLimit, 500);
    assert.deepEqual(read.leftOut, []);
    const stored = serializeShapeLibrary(read.library);
    assert.ok(new TextEncoder().encode(stored).length <= SHAPE_LIBRARY_LIMITS.bytes);
    const again = readShapeLibrary(stored);
    assert.ok(again.ok, again.ok ? '' : again.reason);
    assert.equal(again.library.shapes.length, read.library.shapes.length);
  });

  it('names a loose SVG file too large to read as too large', () => {
    const read = shapeLibraryFromSvgFiles([{ fileName: 'huge.svg', text: '', tooLarge: 500_000 }, { fileName: 'ok.svg', text: SQUARE }], 'Mine');
    assert.deepEqual(read.leftOut, [{ name: 'huge', reason: 'is too large to read (500k characters)' }]);
    assert.equal(read.library.shapes.length, 1);
  });

  it('reads at most 500 shapes and counts the rest', () => {
    const read = readShapeLibrary(library(Array.from({ length: 501 }, (_, index) => ({ name: `S${index}`, svg: SQUARE }))));
    assert.ok(read.ok);
    assert.equal(read.library.shapes.length, 500);
    assert.equal(read.overLimit, 1);
  });

  it('cleans names and tags, and falls back for bad ones', () => {
    const read = readShapeLibrary(
      library([
        { name: `  A\u0000B\nC‮  ${'x'.repeat(200)}`, svg: SQUARE, tags: Array.from({ length: 20 }, (_, index) => `tag${index}${'y'.repeat(60)}`) },
        { name: 42, svg: SQUARE },
        { name: '   ', svg: SQUARE },
      ], { name: '\u0007' }),
      'From file',
    );
    assert.ok(read.ok);
    assert.equal(read.library.name, 'From file');
    const [first, second, third] = read.library.shapes;
    assert.ok(first!.name.startsWith('A B C x'));
    assert.equal(Array.from(first!.name).length, SHAPE_LIBRARY_LIMITS.name);
    assert.equal(first!.tags?.length, SHAPE_LIBRARY_LIMITS.tags);
    assert.ok(first!.tags!.every((tag) => tag.length <= SHAPE_LIBRARY_LIMITS.tag));
    assert.equal(second!.name, 'Shape 2');
    assert.equal(third!.name, 'Shape 3');
  });

  it('keeps only an https source and a short license', () => {
    for (const source of ['http://example.com', 'javascript:alert(1)', 'https://exa mple.com', `https://example.com/${'a'.repeat(600)}`, 7]) {
      const read = readShapeLibrary(library([], { source }));
      assert.ok(read.ok);
      assert.equal(read.library.source, undefined, String(source));
    }
    const read = readShapeLibrary(library([], { license: 'L'.repeat(500) }));
    assert.ok(read.ok);
    assert.equal(read.library.license?.length, SHAPE_LIBRARY_LIMITS.license);
  });

  it('uses w and h from the file when sane, else the viewBox', () => {
    const read = readShapeLibrary(library([
      { name: 'Wide', w: 96, h: 48, svg: SQUARE },
      { name: 'Bad', w: -1, h: 'x', svg: `<svg xmlns="${NS}" viewBox="0 0 30 10"><rect width="30" height="10"/></svg>` },
      { name: 'Infinite', w: 1e400, h: 0, svg: SQUARE },
    ]));
    assert.ok(read.ok);
    assert.deepEqual(read.library.shapes.map((shape) => [shape.w, shape.h]), [[96, 48], [30, 10], [24, 24]]);
  });

  it('keeps the drawing’s proportions when the file gives only w or only h', () => {
    const wide = `<svg xmlns="${NS}" viewBox="0 0 30 10"><rect width="30" height="10"/></svg>`;
    const read = readShapeLibrary(library([
      { name: 'W', w: 48, svg: SQUARE },
      { name: 'H', h: 20, svg: wide },
      { name: 'W wide', w: 60, h: 'x', svg: wide },
    ]));
    assert.ok(read.ok);
    assert.deepEqual(read.library.shapes.map((shape) => [shape.w, shape.h]), [[48, 48], [60, 20], [60, 20]]);
  });

  it('drops a bad outline and keeps the shape', () => {
    const read = readShapeLibrary(library([
      { name: 'Good', svg: SQUARE, outline: 'M0 0 L10 0 C10 5 5 10 0 10 Z' },
      { name: 'Arc', svg: SQUARE, outline: 'M0 0 A5 5 0 0 1 10 10' },
      { name: 'Script', svg: SQUARE, outline: 'M0 0 <script>' },
      { name: 'Long', svg: SQUARE, outline: 'M0 0' + ' L1 1'.repeat(600) },
      { name: 'Object', svg: SQUARE, outline: { d: 'M0 0' } },
    ]));
    assert.ok(read.ok);
    assert.equal(read.library.shapes.length, 5);
    assert.deepEqual(read.library.shapes.map((shape) => shape.outline), ['M0 0 L10 0 C10 5 5 10 0 10 Z', undefined, undefined, undefined, undefined]);
    assert.equal(cleanShapeOutline('L1 1'), undefined);
  });

  it('leaves out shapes that are not drawings, with names and reasons', () => {
    const read = readShapeLibrary(library([
      { name: 'Fine', svg: SQUARE },
      { name: 'Words', svg: `<svg xmlns="${NS}" viewBox="0 0 10 10"><text>Hi</text></svg>` },
      { name: 'None' },
      'nonsense',
    ]));
    assert.ok(read.ok);
    assert.deepEqual(read.library.shapes.map((shape) => shape.name), ['Fine']);
    assert.deepEqual(read.leftOut.map((shape) => shape.name), ['Words', 'None', 'Shape 4']);
    assert.match(read.leftOut[0]!.reason, /<text>/);
  });

  it('makes a library from loose SVG files named after the files', () => {
    const read = shapeLibraryFromSvgFiles([
      { fileName: 'icons/Load Balancer.svg', text: SQUARE },
      { fileName: 'bad.SVG', text: '<svg' },
    ], 'My icons');
    assert.equal(read.library.name, 'My icons');
    assert.deepEqual(read.library.shapes.map((shape) => shape.name), ['Load Balancer']);
    assert.deepEqual(read.leftOut.map((shape) => shape.name), ['bad']);
  });

  it('finds shapes by name and tags', () => {
    const shape = { name: 'Message queue', tags: ['async', 'broker'] };
    assert.ok(shapeMatchesQuery(shape, 'queue'));
    assert.ok(shapeMatchesQuery(shape, 'BROKER msg'.split(' ')[0]!));
    assert.ok(shapeMatchesQuery(shape, 'message async'));
    assert.ok(!shapeMatchesQuery(shape, 'database'));
    assert.ok(shapeMatchesQuery(shape, '  '));
  });

  it('lists shape names without cleaning drawings', () => {
    assert.deepEqual(shapeNamesOfLibraryText(library([{ name: 'A', svg: 'whatever' }, {}])), { name: 'Test', shapes: ['A', 'Shape 2'] });
    assert.equal(shapeNamesOfLibraryText('{}'), undefined);
  });
});

describe('cleaning shape drawings', () => {
  it('turns stylesheet classes into presentation attributes and drops the stylesheet', () => {
    const svg = cleaned(
      `<svg xmlns="${NS}" viewBox="0 0 10 10"><defs><style>.a{fill:#ff0000;stroke:blue}.a, .b { stroke-width: 2 !important } rect { opacity: .5 } #x:hover{fill:green} @media print { .a { fill: black } }</style></defs>` +
        `<rect class="a" width="10" height="10"/><circle class="b c" cx="5" cy="5" r="2"/></svg>`,
    );
    assert.doesNotMatch(svg, /<style|class=|<defs/);
    assert.match(svg, /<rect[^>]*fill="#ff0000"/);
    assert.match(svg, /<rect[^>]*stroke="blue"/);
    assert.match(svg, /<rect[^>]*stroke-width="2"/);
    assert.match(svg, /<rect[^>]*opacity=".5"/);
    assert.match(svg, /<circle[^>]*stroke-width="2"/);
    assert.doesNotMatch(svg, /green|black/);
  });

  it('keeps the first rule after @charset, @import and @namespace', () => {
    const svg = cleaned(
      `<svg xmlns="${NS}" viewBox="0 0 10 10"><style>@charset "UTF-8"; @import url(x.css); @namespace svg url(${NS}); .a{fill:#ff0000}</style><rect class="a" width="10" height="10"/></svg>`,
    );
    assert.match(svg, /<rect[^>]*fill="#ff0000"/);
    assert.doesNotMatch(svg, /x\.css|charset/);
  });

  it('turns style attributes into presentation attributes, over the stylesheet and attributes', () => {
    const svg = cleaned(
      `<svg xmlns="${NS}" viewBox="0 0 10 10"><style>.k { fill: red }</style><path class="k" fill="blue" style="fill: green; font-family: Arial; stroke : black" d="M0 0L10 10"/></svg>`,
    );
    assert.match(svg, /fill="green"/);
    assert.match(svg, /stroke="black"/);
    assert.doesNotMatch(svg, /style=|font-family|red|blue/);
  });

  it('removes the declaration, doctype, comments, metadata and editor namespaces', () => {
    const svg = cleaned(
      `<?xml version="1.0" encoding="UTF-8" standalone="no"?>\n<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">\n` +
        `<!-- Made in an editor --><svg xmlns="${NS}" xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" xmlns:sodipodi="http://sodipodi.sourceforge.net/DTD/sodipodi-0.dtd" xmlns:sketch="http://www.bohemiancoding.com/sketch/ns" ` +
        `width="48px" height="48px" viewBox="0 0 48 48" version="1.1" inkscape:version="1.2" sodipodi:docname="x.svg" xml:space="preserve">` +
        `<metadata><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"/></metadata><sodipodi:namedview id="nv" pagecolor="#fff"/><title>Old title</title><desc>Created with a tool.</desc>` +
        `<g id="Page-1" sketch:type="MSPage" inkscape:label="Layer"><path id="p" d="M1 1L47 47" stroke="#000" inkscape:connector-curvature="0"/></g></svg>`,
      'Arrow',
    );
    assert.doesNotMatch(svg, /<\?xml|DOCTYPE|<!--|metadata|namedview|inkscape|sodipodi|sketch|xml:space|xmlns:xlink|version=|Old title|Created with|width=|height=|id=/);
    assert.ok(svg.startsWith(`<svg xmlns="${NS}" viewBox="0 0 48 48"><title>Arrow</title>`), svg);
  });

  it('adds a missing viewBox from width and height, and the namespace', () => {
    const svg = cleaned(`<svg width="32" height="16"><rect width="32" height="16"/></svg>`);
    assert.ok(svg.startsWith(`<svg xmlns="${NS}" viewBox="0 0 32 16">`), svg);
    assert.equal(cleanShapeSvg(svg, 'Shape').ok && (cleanShapeSvg(svg, 'Shape') as { w: number }).w, 32);
    assert.match(refusal(`<svg xmlns="${NS}"><rect width="3" height="3"/></svg>`), /no size/);
    assert.match(refusal(`<svg xmlns="${NS}" width="100%" height="100%"><rect width="3" height="3"/></svg>`), /no size/);
  });

  it('rounds long decimals and keeps arc flags', () => {
    const svg = cleaned(`<svg xmlns="${NS}" viewBox="0 0 24 24"><path d="M1.23456 2.34567L3.999 4.5.25"/><path d="M0 0a1 1 0 01.5 2"/><circle cx="12.0001" cy="0.333333" r="5"/></svg>`);
    assert.match(svg, /d="M1.23 2.35L4 4.5 .25"/);
    assert.match(svg, /d="M0 0a1 1 0 01.5 2"/);
    assert.match(svg, /cx="12" cy=".33"/);
  });

  it('drops ids nothing points at and keeps gradient references', () => {
    const svg = cleaned(
      `<svg xmlns="${NS}" viewBox="0 0 10 10"><defs><linearGradient id="g"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#000"/></linearGradient></defs><rect id="unused" width="10" height="10" fill="url(#g)"/></svg>`,
    );
    assert.match(svg, /id="g"/);
    assert.doesNotMatch(svg, /unused/);
    assert.equal(unknownSvgParts(svg).length, 0);
  });

  it('accepts gradients within budget, with xlink references made plain', () => {
    const svg = cleaned(
      `<svg xmlns="${NS}" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 10 10"><defs><linearGradient id="a"><stop offset="0" stop-color="red"/><stop offset="1" stop-color="blue"/></linearGradient>` +
        `<radialGradient id="b" xlink:href="#a" cx="5" cy="5" r="5" gradientUnits="userSpaceOnUse"/></defs><circle cx="5" cy="5" r="5" fill="url(#b)"/></svg>`,
    );
    assert.match(svg, /<radialGradient id="b"[^>]* href="#a"|<radialGradient href="#a"[^>]*id="b"|href="#a"/);
    assert.doesNotMatch(svg, /xlink/);
  });

  it('removes a clip path that covers the whole drawing', () => {
    const svg = cleaned(
      `<svg xmlns="${NS}" viewBox="0 0 24 24"><g clip-path="url(#clip0)"><path d="M2 2h20v20H2z"/></g><defs><clipPath id="clip0"><rect width="24" height="24" fill="white"/></clipPath></defs></svg>`,
    );
    assert.doesNotMatch(svg, /clip/);
    // A clip path that really clips is refused, not dropped.
    assert.match(refusal(`<svg xmlns="${NS}" viewBox="0 0 24 24"><g clip-path="url(#c)"><path d="M2 2h20v20H2z"/></g><clipPath id="c"><circle r="5"/></clipPath></svg>`), /clipPath|clip-path/);
  });

  it('names the drawing with an escaped title', () => {
    const svg = cleaned(SQUARE, 'A <b> & "c"');
    assert.match(svg, /<title>A &lt;b&gt; &amp; "c"<\/title>/);
    assert.equal(unknownSvgParts(svg).length, 0);
    const twice = cleaned(svg, 'Other');
    assert.equal((twice.match(/<title>/g) ?? []).length, 1);
    assert.match(twice, /<title>Other<\/title>/);
  });

  it('refuses text, scripts, event handlers, pictures and links', () => {
    assert.match(refusal(`<svg xmlns="${NS}" viewBox="0 0 10 10"><text x="1" y="5">Hi</text></svg>`), /<text>.*outlines/);
    assert.match(refusal(`<svg xmlns="${NS}" viewBox="0 0 10 10"><script>alert(1)</script><rect width="1" height="1"/></svg>`), /<script>/);
    assert.match(refusal(`<svg xmlns="${NS}" viewBox="0 0 10 10" onload="alert(1)"><rect width="1" height="1"/></svg>`), /uses/);
    assert.match(refusal(`<svg xmlns="${NS}" viewBox="0 0 10 10"><image href="https://example.com/a.png" width="10" height="10"/></svg>`), /<image>/);
    assert.match(refusal(`<svg xmlns="${NS}" viewBox="0 0 10 10"><a href="https://example.com"><rect width="1" height="1"/></a></svg>`), /<a>/);
    assert.match(refusal(`<svg xmlns="${NS}" viewBox="0 0 10 10"><rect width="1" height="1" fill="url(https://example.com/x)"/></svg>`), /uses/);
    assert.match(refusal(`<svg xmlns="${NS}" viewBox="0 0 10 10"><rect width="1" height="1" style="fill: url(https://example.com/x)"/></svg>`), /uses/);
  });

  it('refuses oversized drawings and things that are not SVG', () => {
    const path = `<path d="${'M1 1L2 2'.repeat(2500)}"/>`;
    assert.match(refusal(`<svg xmlns="${NS}" viewBox="0 0 10 10">${path}</svg>`), new RegExp(`at most ${MAX_SHAPE_SVG_CHARS.toLocaleString('en-US')}`));
    assert.match(refusal('<svg'), /well-formed/);
    assert.match(refusal('<html/>'), /not an SVG/);
    assert.match(refusal(''), /no drawing/);
    assert.match(refusal(`<!DOCTYPE svg [<!ENTITY x "boom">]><svg xmlns="${NS}" viewBox="0 0 1 1"><title>&x;</title></svg>`), /well-formed/);
  });

  it('leaves out a drawing nested too deep to read, and reads the rest of its library', () => {
    const deep = `<svg xmlns="${NS}" viewBox="0 0 10 10">${'<g>'.repeat(50_000)}<rect width="1" height="1"/>${'</g>'.repeat(50_000)}</svg>`;
    assert.match(refusal(deep), /not a drawing the board can read/);
    const read = readShapeLibrary(library([{ name: 'Deep', svg: deep }, { name: 'Fine', svg: SQUARE }]));
    assert.ok(read.ok);
    assert.deepEqual(read.library.shapes.map((shape) => shape.name), ['Fine']);
    assert.deepEqual(read.leftOut.map((shape) => shape.name), ['Deep']);
  });
});

describe('the board list of shape libraries', () => {
  const entry = (id: string, at: number, extra: Record<string, unknown> = {}): Record<string, unknown> => ({ id, name: `Lib ${id}`, file: `/_blob/${'a'.repeat(31)}${id.slice(-1)}`, count: 3, at, ...extra });

  it('normalizes entries and keeps at most eight, oldest first', () => {
    const raw = [
      ...Array.from({ length: 10 }, (_, index) => entry(`l${index}`, 100 - index)),
      entry('l1', 1),
      { id: 'bad id!', name: 'x', file: '/_blob/' + 'b'.repeat(32), at: 1 },
      { id: 'nofile', name: 'x', file: 'https://example.com/lib.json', at: 1 },
      { id: 'noname', name: ' ', file: '/_blob/' + 'b'.repeat(32), at: 1 },
      'junk',
    ];
    const libraries = normalizeBoardShapeLibraries(raw);
    assert.equal(libraries.length, MAX_BOARD_SHAPE_LIBRARIES);
    assert.deepEqual(libraries.map((library) => library.id), ['l9', 'l8', 'l7', 'l6', 'l5', 'l4', 'l3', 'l2']);
    const [one] = normalizeBoardShapeLibraries([entry('x', 5, { file: '_blob/' + 'c'.repeat(32), count: 9999, source: 'http://x', license: '  MIT  ' })]);
    assert.equal(one?.file, '/_blob/' + 'c'.repeat(32));
    assert.equal(one?.count, 500);
    assert.equal(one?.source, undefined);
    assert.equal(one?.license, 'MIT');
  });

  it('refuses a ninth library and a duplicate', () => {
    const eight = normalizeBoardShapeLibraries(Array.from({ length: 8 }, (_, index) => entry(`l${index}`, index)));
    assert.match(refuseShapeLibrary(eight, 'new') ?? '', /up to 8/);
    assert.match(refuseShapeLibrary(eight.slice(0, 2), 'l1') ?? '', /already/);
    assert.equal(refuseShapeLibrary(eight.slice(0, 2), 'new'), undefined);
  });

  it('is stored in board/shapes and composed back', () => {
    const shapes = normalizeBoardShapeLibraries([entry('one', 2, { source: 'https://example.com' }), entry('two', 1)]);
    const documents = decomposeBoard({ title: 'B', content: { elements: [], shapes } });
    assert.deepEqual(documents.get(BOARD_SHAPES_PATH), shapeLibrariesToRecord(shapes));
    const content = parseBoardContent(composeBoard(documents).content);
    assert.deepEqual(content.shapes, shapes);
    // A board without the list keeps the stored document.
    const kept = decomposeBoard({ title: 'B', content: { elements: [] } }, documents);
    assert.equal(kept.get(BOARD_SHAPES_PATH), documents.get(BOARD_SHAPES_PATH));
    // No document, no list.
    const bare = new Map([[BOARD_META_PATH, { v: 1, title: 'B', order: [] }]]);
    assert.equal(parseBoardContent(composeBoard(bare).content).shapes, undefined);
  });

  it('keeps unchanged lists by identity', () => {
    const shapes = normalizeBoardShapeLibraries([entry('one', 1)]);
    const previous = { elements: [], shapes };
    assert.equal(shareUnchangedContent(previous, { elements: [], shapes: normalizeBoardShapeLibraries([entry('one', 1)]) }), previous);
    assert.notEqual(shareUnchangedContent(previous, { elements: [], shapes: [] }), previous);
  });

  it('is checked: known path, bad entries and too many reported', () => {
    const meta = { v: 1, title: 'B', order: [] };
    const fine = checkBoardDocuments(new Map<string, any>([[BOARD_META_PATH, meta], [BOARD_SHAPES_PATH, shapeLibrariesToRecord(normalizeBoardShapeLibraries([entry('one', 1)]))]]));
    assert.deepEqual(fine.filter((finding) => finding.path === BOARD_SHAPES_PATH), []);
    const libs: Record<string, unknown> = Object.fromEntries(Array.from({ length: 9 }, (_, index) => [`l${index}`, { ...entry(`l${index}`, index), id: undefined }]));
    libs.broken = { name: 'x', file: 'nope' };
    const bad = checkBoardDocuments(new Map<string, any>([[BOARD_META_PATH, meta], [BOARD_SHAPES_PATH, { libs }]]));
    const messages = bad.filter((finding) => finding.path === BOARD_SHAPES_PATH).map((finding) => finding.message);
    assert.equal(messages.length, 2, messages.join('\n'));
    assert.ok(messages.some((message) => message.includes('"broken"')));
    assert.ok(messages.some((message) => message.includes('at most 8')));
    const wrong = checkBoardDocuments(new Map<string, any>([[BOARD_META_PATH, meta], [BOARD_SHAPES_PATH, { libs: [] }]]));
    assert.equal(wrong.filter((finding) => finding.path === BOARD_SHAPES_PATH).length, 1);
  });
});

describe('placing a library shape', () => {
  it('makes an unframed picture and a centered name label in one new group', () => {
    let next = 0;
    const read = readShapeLibrary(library([{ name: 'Wide thing', w: 200, h: 100, svg: SQUARE }]));
    assert.ok(read.ok);
    const { image, label, group } = placeLibraryShape(read.library.shapes[0]!, { x: 100, y: 50 }, () => `id${next++}`);
    assert.equal(group, 'id0');
    assert.deepEqual([image.w, image.h], [PLACED_SHAPE_SIZE, PLACED_SHAPE_SIZE / 2]);
    assert.deepEqual([image.x, image.y], [60, 30]);
    assert.equal(image.style, 'plain');
    assert.ok(isAllowedImageSource(image.src));
    assert.equal(decodeSvgDataUrl(image.src), read.library.shapes[0]!.svg);
    assert.deepEqual(image.groups, [group]);
    assert.deepEqual(label.groups, [group]);
    assert.equal(label.text, '');
    assert.equal(label.placeholder, 'Wide thing');
    assert.equal(label.textAlign, 'center');
    assert.equal(label.x + (label.wrap ?? 0) / 2, 100);
    assert.ok(label.y > image.y + image.h);
    // Both survive normalization as they are.
    assert.deepEqual(normalizeElement(image, new Set()), image);
    assert.deepEqual(normalizeElement(label, new Set()), label);
  });

  it('keeps the aspect ratio of tall shapes', () => {
    const { image } = placeLibraryShape({ name: 'Tall', w: 10, h: 40, svg: SQUARE }, { x: 0, y: 0 });
    assert.deepEqual([image.w, image.h], [20, 80]);
  });

  it('places a picture that check accepts without an author', () => {
    const { image, label } = placeLibraryShape({ name: 'Square', w: 24, h: 24, svg: cleaned(SQUARE, 'Square') }, { x: 0, y: 0 });
    const documents = decomposeBoard({ title: 'B', content: { elements: [image, label] } });
    const findings = checkBoardDocuments(documents);
    assert.deepEqual(findings.filter((finding) => finding.level !== 'info'), []);
  });
});
