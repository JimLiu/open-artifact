import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

describe('pasted plain text', async () => {
  const { textParagraphs } = await import('../src/lib/sanitize.ts');
  it('makes paragraphs with line breaks, and no binding of its braces', () => {
    assert.equal(textParagraphs('a\nb\n\n{{x}} <i>'), '<p style="margin: 0">a<br>b</p>\n<p style="margin: 0">{<wbr>{x}} &lt;i&gt;</p>');
  });
  it('keeps a long text’s breaks with pre-line', () => {
    assert.ok(textParagraphs(Array.from({ length: 502 }, (_, n) => n).join('\n')).startsWith('<p style="margin: 0; white-space: pre-line">0\n1\n'));
  });
});
