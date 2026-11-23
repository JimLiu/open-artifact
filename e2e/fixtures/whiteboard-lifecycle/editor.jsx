import { StrictMode, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { TooltipProvider, Toaster } from '@open-artifact/ui';
import { createLocalProvider, installRuntime } from '@open-artifact/runtime';
import { App } from '../../../packages/whiteboard-editor/src/App.tsx';
import { changeBoard, useBoard } from '../../../packages/whiteboard-editor/src/state/board.ts';
import { useCamera } from '../../../packages/whiteboard-editor/src/state/camera.ts';
import { useAgent } from '../../../packages/whiteboard-editor/src/services/agent.ts';
import { liveBoard, savedCopyCache } from '../../../packages/whiteboard-editor/src/services/sync.ts';
import { startBoard } from '../../../packages/whiteboard-editor/src/services/boot.ts';
import { requestDrawingLook, startDrawingLooks } from '../../../packages/whiteboard-editor/src/services/drawing-looks.ts';
import { useDrawingLooks } from '../../../packages/whiteboard-editor/src/state/drawing-looks.ts';
import '../../../packages/whiteboard-editor/src/styles.css';

// The frame fixture supplies a host runtime. Standalone mounts use the editor's normal session entry point.
if (window.parent !== window) installRuntime(createLocalProvider());
let root;
const mounts = [];
function BoardTitle() {
  const title = useBoard(state => state.board.title);
  useEffect(() => { mounts.push('mount'); return () => mounts.push('unmount'); }, []);
  return <input aria-label="Board title" value={title}
    onChange={event => changeBoard(board => ({ ...board, title: event.target.value }))} />;
}
function mount() {
  root = createRoot(document.querySelector('#board-mount'));
  root.render(<StrictMode><TooltipProvider><App /><BoardTitle /><Toaster /></TooltipProvider></StrictMode>);
}
window.fixture = {
  mount, mounts, unmount: () => root.unmount(), board: useBoard, camera: useCamera, agent: useAgent, liveBoard,
  savedCopyCache, startBoard, requestDrawingLook, startDrawingLooks, looks: useDrawingLooks,
};
