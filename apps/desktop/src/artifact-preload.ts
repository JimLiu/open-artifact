import type { ArtifactAppIpc } from './contracts.ts';
import { ipcClient } from './ipc-client.ts';
const invoke = ipcClient<ArtifactAppIpc>();
// The status page of an artifact installed as an app (renderer/artifact-app/) gets this bridge and nothing else; the
// artifact's view gets no preload at all. Every call is checked again in the main process (it must come from this
// window's own page). Nothing here hands out the daemon's address or token.
import type { IpcRendererEvent } from 'electron';
import { contextBridge, ipcRenderer } from 'electron';
import type { ArtifactAppBridge } from './contracts.ts';

const bridge: ArtifactAppBridge = {
  /** What the page draws now (see status.js). */
  state: () => invoke('artifact-app:state')(),
  onState: (listener) => {
    const handler = (_event: IpcRendererEvent, value: import('./types.ts').ArtifactAppState) => listener(value);
    ipcRenderer.on('artifact-app:state', handler);
    return () => ipcRenderer.off('artifact-app:state', handler);
  },
  /** A button of the page's: `retry`, `open-desktop`, `reload`. */
  act: (id) => invoke('artifact-app:act')(String(id)),
  /** The person's answer to the question about unsaved work. */
  answer: (id, yes) => invoke('artifact-app:answer')(String(id), yes === true),
  /** Test mode only (refused otherwise, in the main process). */
  test: {
    command: (name, arg) => invoke('test:command')(String(name), arg ?? null),
    menu: () => invoke('test:menu')(),
    info: () => invoke('test:artifact-app')(),
    saved: (saved) => invoke('test:saved')(saved),
    closeWindow: () => invoke('test:close-window')(),
    quit: (force) => invoke('test:quit')(force === true),
  },
};
contextBridge.exposeInMainWorld('artifactApp', bridge);
