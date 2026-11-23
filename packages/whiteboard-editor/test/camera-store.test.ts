import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { MIN_COMPACT_ZOOM } from '../src/lib/camera.ts';
import { useCamera } from '../src/state/camera.ts';

/** The board point in the middle of the viewport. */
function middle(): { x: number; y: number } {
  const { camera, width, height } = useCamera.getState();
  return { x: camera.x + width / 2 / camera.zoom, y: camera.y + height / 2 / camera.zoom };
}

describe('the camera when the viewport is measured', () => {
  beforeEach(() => {
    useCamera.setState({ camera: { x: 0, y: 0, zoom: 1 }, width: 1, height: 1, compact: false });
  });

  it('keeps a camera the layout allows as it is', () => {
    useCamera.getState().setCamera({ x: 120, y: -40, zoom: 0.3 });
    useCamera.getState().setViewport(1280, 800, false);
    assert.deepEqual(useCamera.getState().camera, { x: 120, y: -40, zoom: 0.3 });
  });

  it('zooms a camera below the compact minimum in about the middle of the viewport', () => {
    // A camera kept from a wide window, restored before the narrow one was measured.
    useCamera.getState().setViewport(1280, 800, false);
    useCamera.getState().setCamera({ x: 120, y: -40, zoom: 0.3 });
    useCamera.getState().setViewport(600, 800, false);
    const before = { x: 120 + 600 / 2 / 0.3, y: -40 + 800 / 2 / 0.3 };
    const { camera, compact } = useCamera.getState();
    assert.equal(compact, true);
    assert.equal(camera.zoom, MIN_COMPACT_ZOOM);
    const after = middle();
    assert.ok(Math.abs(after.x - before.x) < 1e-6 && Math.abs(after.y - before.y) < 1e-6, `${JSON.stringify(after)} is not ${JSON.stringify(before)}`);
  });

  it('does the same on a coarse pointer', () => {
    useCamera.getState().setCamera({ x: 0, y: 0, zoom: 0.2 });
    useCamera.getState().setViewport(1280, 800, true);
    assert.equal(useCamera.getState().camera.zoom, MIN_COMPACT_ZOOM);
    const after = middle();
    assert.ok(Math.abs(after.x - 1280 / 2 / 0.2) < 1e-6 && Math.abs(after.y - 800 / 2 / 0.2) < 1e-6);
  });
});
