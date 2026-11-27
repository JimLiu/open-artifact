import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { pasteRoute, type PasteContext } from '../src/lib/paste-route.ts';

const at = (ctx: Partial<PasteContext>): PasteContext => ({ media: null, hasText: true, focus: 'none', target: 'none', panelFocus: false, selectionInFocus: false, popupOpen: false, ...ctx });

describe('paste route', () => {
  it('gives words to the field being typed in, else to the canvas', () => {
    assert.deepEqual(pasteRoute(at({ focus: 'input', target: 'input' })), { to: 'control' });
    assert.deepEqual(pasteRoute(at({ focus: 'text', target: 'text' })), { to: 'control' });
    // Text selected on a label somewhere does not keep the canvas from the paste.
    assert.deepEqual(pasteRoute(at({})), { to: 'canvas' });
    // Selected in a properties control that has the focus: that control.
    assert.deepEqual(pasteRoute(at({ panelFocus: true, selectionInFocus: true })), { to: 'control' });
    assert.deepEqual(pasteRoute(at({ panelFocus: true })), { to: 'canvas' });
  });

  it('leaves a paste with a menu or popup open to it', () => {
    assert.deepEqual(pasteRoute(at({ popupOpen: true })), { to: 'control' });
  });

  it('refuses a picture while a popup is open or a text box has the focus', () => {
    assert.deepEqual(pasteRoute(at({ media: 'image', popupOpen: true })), { to: 'none', message: 'The image wasn’t pasted. Close the open menu or popup, then paste again.' });
    assert.deepEqual(pasteRoute(at({ media: 'video', focus: 'text', target: 'text' })), { to: 'none', message: 'The video wasn’t pasted. Click the design, then paste again.' });
    // A one-line field: the picture goes to the canvas unless there are words for the field.
    assert.deepEqual(pasteRoute(at({ media: 'image', focus: 'input', hasText: false })), { to: 'canvas' });
    assert.deepEqual(pasteRoute(at({ media: 'image', focus: 'input', hasText: true })), { to: 'control' });
    assert.deepEqual(pasteRoute(at({ media: 'image' })), { to: 'canvas' });
  });
});
