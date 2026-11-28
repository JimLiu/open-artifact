import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { escapeTemplateBraces, scanCss } from '../src/lib/css-scan.ts';
import { IMPORT_DEPTH, inlineCss, notCssWarning, unclosedWarning, unhoistableWarning, type CssSources } from '../src/lib/css-inline.ts';

const kinds = (css: string) => scanCss(css).pieces.map((piece) => piece.kind);

function sources(files: Record<string, Uint8Array | string>, uploads: Record<string, string> = {}): CssSources {
  const map = new Map(Object.entries(files));
  const dataUrls = new Map([...map].filter(([, data]) => typeof data !== 'string').map(([name]) => [name, `data:bin,${name}`]));
  return { files: map, dataUrls, uploads: new Map(Object.entries(uploads)), textUrl: (name) => `data:text,${name}` };
}

function run(css: string, files: Record<string, Uint8Array | string>, uploads?: Record<string, string>, from = 'main.css') {
  const warnings = new Set<string>();
  return { css: inlineCss(css, from, sources(files, uploads), warnings), warnings: [...warnings] };
}

describe('reading a stylesheet', () => {
  it('finds comments, strings, url() and @import, covering all of the text', () => {
    const css = '/* url(a.png) */ .a { content: "url(b.png)"; background: url( c.png ) } @import "d.css" screen;';
    const { pieces, unclosed } = scanCss(css);
    assert.equal(unclosed, false);
    assert.equal(pieces.map((piece) => css.slice(piece.start, piece.end)).join(''), css);
    assert.deepEqual(kinds(css), ['comment', 'text', 'string', 'text', 'url', 'text', 'import']);
    const url = pieces.find((piece) => piece.kind === 'url');
    assert.ok(url?.kind === 'url' && url.target === 'c.png' && url.quote === '');
    const rule = pieces.find((piece) => piece.kind === 'import');
    assert.ok(rule?.kind === 'import' && rule.target === 'd.css' && rule.condition === 'screen');
  });

  it('reads quoted url() and leaves escaped ones unread', () => {
    const quoted = scanCss("x{a:url('a b.png')}").pieces.find((piece) => piece.kind === 'url');
    assert.ok(quoted?.kind === 'url' && quoted.target === 'a b.png' && quoted.quote === "'");
    const escaped = scanCss('x{a:url("a\\".png")}').pieces.find((piece) => piece.kind === 'url');
    assert.ok(escaped?.kind === 'url' && escaped.target === null);
    const spaced = scanCss('x{a:url(a b.png)}').pieces.find((piece) => piece.kind === 'url');
    assert.ok(spaced?.kind === 'url' && spaced.target === null);
  });

  it('takes @import only when white space alone stands before its address', () => {
    assert.deepEqual(kinds('@import url(a.css) layer(base) supports(display: grid) print;'), ['import']);
    assert.deepEqual(kinds('@import\n  "a.css";'), ['import']);
    assert.ok(!kinds('@import /* x */ "a.css";').includes('import'));
    assert.ok(!kinds('@importx "a.css";').includes('import'));
  });

  it('knows a file that stops inside a string, comment or url(', () => {
    assert.equal(scanCss('.a { content: "open').unclosed, true);
    assert.equal(scanCss('.a {} /* open').unclosed, true);
    assert.equal(scanCss('.a { background: url(a.png').unclosed, true);
    assert.equal(scanCss('.a { content: "line\nbreak }').unclosed, false, 'a line break ends a string');
  });

  it('keeps doubled braces out of the text', () => {
    assert.equal(escapeTemplateBraces('.a{{color:red}}'), '.a{ {color:red} }');
    assert.equal(escapeTemplateBraces('.a{content:"{{x}}"}'), '.a{content:"{\\7b x}\\7d "}');
    assert.equal(escapeTemplateBraces('.a { color: red }'), '.a { color: red }');
  });
});

describe('inlining a stylesheet', () => {
  it('turns url() to project files and uploads into data URLs, keeping the quotes', () => {
    const { css } = run('.a{background:url("img/a.png")} .b{background:url(/_blob/up1)} .c{background:url(https://x.test/a.png)}', { 'img/a.png': new Uint8Array([1]) }, { '/_blob/up1': 'data:image/png;base64,AA' });
    assert.equal(css, '.a{background:url("data:bin,img/a.png")} .b{background:url(data:image/png;base64,AA)} .c{background:url(https://x.test/a.png)}');
  });

  it('resolves addresses from the stylesheet’s own folder and keeps the fragment, escaped', () => {
    const { css } = run('.a{mask:url(../icons.svg#a"b)}', { 'icons.svg': new Uint8Array([1]) }, {}, 'css/main.css');
    assert.equal(css, '.a{mask:url(../icons.svg#a"b)}', 'a stray quote leaves it unread');
    const kept = run(".a{mask:url('../icons.svg#a(b)')}", { 'icons.svg': new Uint8Array([1]) }, {}, 'css/main.css');
    assert.equal(kept.css, ".a{mask:url('data:bin,icons.svg#a%28b%29')}");
  });

  it('writes an import in place, inside its layer, supports and media blocks', () => {
    const { css, warnings } = run('@import url("b.css") layer(base) supports(display: grid) screen and (min-width: 600px);\n.a{}', { 'b.css': '.b{}' });
    assert.equal(css, '/**/@layer base {\n@supports (display: grid) {\n@media screen and (min-width: 600px) {\n.b{}\n}\n}\n}/**/\n.a{}');
    assert.deepEqual(warnings, []);
    assert.equal(run('@import "b.css" layer;', { 'b.css': '.b{}' }).css, '/**/@layer {\n.b{}\n}/**/');
    assert.equal(run('@import "b.css";', { 'b.css': '@charset "utf-8";\n.b{}' }).css, '/**/.b{}/**/');
  });

  it('follows imports of imports from their own folders, and leaves a loop alone', () => {
    const { css } = run('@import "css/b.css";', { 'css/b.css': '@import "c.css"; .b{background:url(../img.png)}', 'css/c.css': '@import "b.css"; .c{}', 'img.png': new Uint8Array([1]) });
    assert.equal(css, '@import "b.css";\n/**//**/ .c{}/**/ .b{background:url(data:bin,img.png)}/**/', 'the import that closes the loop stays an import, moved to the top');
  });

  it(`stops after ${IMPORT_DEPTH} levels`, () => {
    const files: Record<string, string> = {};
    for (let i = 1; i <= IMPORT_DEPTH + 1; i++) files[`s${i}.css`] = `@import "s${i + 1}.css"; .s${i}{}`;
    files[`s${IMPORT_DEPTH + 2}.css`] = '.deepest{}';
    const { css } = run('@import "s1.css";', files);
    assert.ok(css.includes(`.s${IMPORT_DEPTH}{}`));
    assert.ok(css.includes(`@import "s${IMPORT_DEPTH + 1}.css";`), 'the 11th level stays an import');
    assert.ok(!css.includes('.deepest'));
  });

  it('warns about imports that are not stylesheets or are cut off, once each', () => {
    const { css, warnings } = run('@import "data.json"; @import "data.json"; @import "cut.css"; @import "gone.css"; @import "https://x.test/a.css";', { 'data.json': '{}', 'cut.css': '.a { content: "open' });
    assert.equal(css, '@import "data.json"; @import "data.json"; @import "cut.css"; @import "gone.css"; @import "https://x.test/a.css";');
    assert.deepEqual(warnings, [notCssWarning('data.json'), unclosedWarning('cut.css')]);
    assert.equal(warnings[0], 'stylesheet import not embedded (data.json): it is not a CSS file');
    assert.equal(warnings[1], 'stylesheet import not embedded (cut.css): the file ends inside an unclosed string, comment or url( — close it and export again');
  });

  it('moves imports that stay above the stylesheets written in place, where a browser still reads them', () => {
    const fonts = '@import url(https://fonts.test/css?family=A);';
    const { css, warnings } = run(`@import "local.css";\n${fonts}\n.a{}`, { 'local.css': '.l{}' });
    assert.equal(css, `${fonts}\n/**/.l{}/**/\n\n.a{}`);
    assert.deepEqual(warnings, []);
    assert.equal(run(`@charset "utf-8";\n${fonts}\n@import "local.css";`, { 'local.css': '.l{}' }).css, `@charset "utf-8";\n${fonts}\n/**/.l{}/**/`, 'imports already on top stay where they are');
  });

  it('carries the conditions of the stylesheet an import came from into the moved import', () => {
    const nested = run('@import "a.css" layer(base) supports(display: grid) screen;\n.x{}', { 'a.css': '@import url(https://x.test/f.css) layer(fonts) supports(gap: 1px);\n.a{}' });
    assert.equal(nested.css, '@import url(https://x.test/f.css) layer(base.fonts) supports((display: grid) and (gap: 1px)) screen;\n/**/@layer base {\n@supports (display: grid) {\n@media screen {\n\n.a{}\n}\n}\n}/**/\n.x{}');
    assert.deepEqual(nested.warnings, []);
    assert.equal(run('@import "a.css";', { 'a.css': '@import "https://x.test/f.css" print; .a{}' }).css, '@import "https://x.test/f.css" print;\n/**/ .a{}/**/', 'without conditions around it, the rule is moved as written');
  });

  it('leaves out, with a warning, an import whose conditions one @import cannot carry', () => {
    const { css, warnings } = run('@import "a.css" print;', { 'a.css': '@import url(https://x.test/f.css) screen; .a{}' });
    assert.equal(css, '/**/@media print {\n .a{}\n}/**/');
    assert.deepEqual(warnings, [unhoistableWarning('https://x.test/f.css')]);
    assert.deepEqual(run('@import "a.css" layer;', { 'a.css': '@import url(https://x.test/f.css) layer(x); .a{}' }).warnings, [unhoistableWarning('https://x.test/f.css')], 'a named layer inside an anonymous one has no name');
  });

  it('embeds an uploaded stylesheet and escapes template braces in what it brings in', () => {
    const upload = `data:text/css;base64,${btoa('.u{{}}')}`;
    assert.equal(run('@import url(/_blob/s1);', {}, { '/_blob/s1': upload }).css, '/**/.u{ {} }/**/');
    assert.deepEqual(run('@import url(/_blob/p1);', {}, { '/_blob/p1': 'data:image/png;base64,AA' }).warnings, [notCssWarning('/_blob/p1')]);
  });
});
