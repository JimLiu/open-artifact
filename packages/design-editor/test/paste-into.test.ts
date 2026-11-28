import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { before, beforeEach, describe, it } from 'node:test';
import type { BoardOp } from '../src/lib/ops.ts';

// The paste's toasts come from the ui package, whose components the test runner can't load: a stub keeps them.
const stub = new URL('./toast-stub.ts', import.meta.url).href;
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === '@open-artifact/ui') return { url: stub, shortCircuit: true };
    return next(specifier, context);
  },
});

let pasteAsLayers: typeof import('../src/services/paste-into.ts').pasteAsLayers;
let templateOf: typeof import('../src/services/agent.ts').templateOf;
let useDocument: typeof import('../src/state/document.ts').useDocument;
let toasts: typeof import('./toast-stub.ts').toasts;

const BOARD = 'a.dc.html';
const SOURCE = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>A</title>
  <script src="./support.js"></script>
</head>
<body>
<x-dc><div class="box" style="width: 200px; height: 100px">x</div></x-dc>
<script type="text/x-dc" data-dc-script data-props='{}'>
class Component extends DCLogic {}
</script>
</body>
</html>
`;

before(async () => {
  (globalThis as { location?: unknown }).location = { pathname: '/project' };
  ({ pasteAsLayers } = await import('../src/services/paste-into.ts'));
  ({ templateOf } = await import('../src/services/agent.ts'));
  ({ useDocument } = await import('../src/state/document.ts'));
  ({ toasts } = await import('./toast-stub.ts'));
});

beforeEach(() => {
  useDocument.getState().load({
    title: 'Paste',
    readOnly: false,
    canvas: { text: JSON.stringify({ boards: { [BOARD]: { x: 0, y: 0, w: 400, h: 300 } }, order: [BOARD] }), hash: '1' },
    boards: { [BOARD]: { text: SOURCE, hash: 'a' } },
  });
  useDocument.setState({ undo: [], redo: [] });
  toasts.length = 0;
});

/** Pastes one copied element into the div, which is not positioned yet, while inserts go through `insert`. */
function pasteWith(insert: (run: () => ReturnType<ReturnType<typeof useDocument.getState>['editBoard']>) => ReturnType<ReturnType<typeof useDocument.getState>['editBoard']>) {
  const editBoard = useDocument.getState().editBoard;
  useDocument.setState({ editBoard: (path: string, op: BoardOp, options?: { coalesce?: string }) => (op.kind === 'insert' ? insert(() => editBoard(path, op, options)) : editBoard(path, op, options)) });
  const model = templateOf(SOURCE);
  const container = [...model.tidOf.keys()].find((element) => element.tag === 'div')!;
  const payload = { kind: 'elements' as const, board: 'b.dc.html', html: ['<p>hi</p>'], boxes: [{ left: 0, top: 0, width: 40, height: 20, computed: {} }] };
  try {
    return pasteAsLayers(payload, BOARD, { model, container, box: { x: 0, y: 0, w: 200, h: 100 }, anchor: true });
  } finally {
    useDocument.setState({ editBoard });
  }
}

describe('pasting into an artboard as layers', () => {
  it('positions the container and inserts the layers as one undo step', () => {
    pasteWith((run) => run());
    const source = useDocument.getState().boards[BOARD]!.source!;
    assert.match(source, /position: relative/);
    assert.match(source, /<p\b/);
    assert.equal(useDocument.getState().undo.length, 1);
    assert.equal(toasts.at(-1)?.title, 'Pasted into a');
  });

  it('takes back the container’s position when the insert changes nothing', () => {
    pasteWith(() => null);
    assert.equal(useDocument.getState().boards[BOARD]!.source, SOURCE);
    assert.equal(useDocument.getState().undo.length, 0);
    assert.equal(toasts.at(-1)?.title, 'Could not paste: nothing changed.');
  });

  it('takes back the container’s position when the insert throws', () => {
    pasteWith(() => {
      throw new Error('broken');
    });
    assert.equal(useDocument.getState().boards[BOARD]!.source, SOURCE);
    assert.equal(useDocument.getState().undo.length, 0);
    assert.equal(toasts.at(-1)?.title, 'Couldn’t paste.');
  });
});
