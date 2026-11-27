import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { checkDcFile, parseTemplate, readStateStyle, stateOfAttribute, stateStyleSheet } from '../src/index.ts';

const board = (attrs: string) => `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>States</title>
  <script src="./support.js"></script>
</head>
<body>
<x-dc>
<button ${attrs}>Go</button>
</x-dc>
<script type="text/x-dc" data-dc-script data-props='{}'>
class Component extends DCLogic {
  renderVals() { return {}; }
}
</script>
</body>
</html>
`;

describe('state styles', () => {
  it('names the states it takes', () => {
    assert.equal(stateOfAttribute('style-hover'), 'hover');
    assert.equal(stateOfAttribute('style-focus-visible'), 'focus-visible');
    assert.equal(stateOfAttribute('style-active'), 'active');
    assert.equal(stateOfAttribute('style-visited'), null);
    assert.equal(stateOfAttribute('style'), null);
  });

  it('writes the declarations again as one rule per state, each important', () => {
    const sheet = stateStyleSheet({ hover: 'background: #eee; color: red', 'focus-visible': 'outline: revert; outline-offset: revert' });
    assert.ok(sheet);
    assert.match(sheet.css, new RegExp(`^\\[data-dc-state="${sheet.key}"\\]:hover \\{ background: #eee !important; color: red !important \\}$`, 'm'));
    assert.match(sheet.css, /:focus-visible \{ outline: revert !important; outline-offset: revert !important \}/);
    assert.equal(stateStyleSheet({ hover: '' }), null);
  });

  it('never lets a value close the rule or load from outside', () => {
    assert.equal(stateStyleSheet({ hover: 'color: red } body { display: none' }), null);
    assert.equal(stateStyleSheet({ hover: 'color: red</style><script>' }), null);
    const remote = stateStyleSheet({ hover: 'background: url(https://example.com/a.png); color: red' });
    assert.ok(remote && !remote.css.includes('example.com') && remote.css.includes('color: red'));
    assert.ok(readStateStyle('width: expression(alert(1))').problems.length);
    assert.deepEqual(readStateStyle('box-shadow: 0 0 0 calc(2px + 0px + 2px) #fff').problems, []);
  });

  it('check takes state styles and reports what is not a declaration', () => {
    const errors = (attrs: string) => checkDcFile('Main.dc.html', board(attrs)).filter((d) => d.level === 'error').map((d) => d.message);
    assert.deepEqual(errors('style-hover="background: #eee"'), []);
    assert.ok(errors('style-hover="} body { color: red"').some((m) => m.includes('style-hover')));
    assert.ok(checkDcFile('Main.dc.html', board('style-visited="color: red"')).some((d) => d.level === 'warning' && d.message.includes('style-visited')));
  });

  it('renders a state style as a rule for the element, not as an attribute', async () => {
    const { renderToStaticMarkup } = await import('react-dom/server');
    const { renderTemplate } = await import('../src/render.ts');
    const model = parseTemplate('<button style="color: blue" style-hover="color: {{ hot }}">Go</button>');
    const html = renderToStaticMarkup(renderTemplate(model, { hot: 'red' }, { importComponent: () => null, globalComponent: () => null, head: null, stamp: false, streaming: false }) as never);
    assert.ok(!/styleHover|style-hover/.test(html), html);
    const key = /data-dc-state="([^"]+)"/.exec(html)?.[1];
    assert.ok(key, html);
    assert.ok(html.includes(`[data-dc-state="${key}"]:hover { color: red !important }`), html);
  });
});
