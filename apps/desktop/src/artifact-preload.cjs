// The status page of an artifact installed as an app (renderer/artifact-app/) gets this bridge and nothing else; the
// artifact's view gets no preload at all. Every call is checked again in the main process (it must come from this
// window's own page). Nothing here hands out the daemon's address or token.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('artifactApp', {
  /** What the page draws now (see status.js). */
  state: () => ipcRenderer.invoke('artifact-app:state'),
  onState: (listener) => {
    const handler = (_event, value) => listener(value);
    ipcRenderer.on('artifact-app:state', handler);
    return () => ipcRenderer.off('artifact-app:state', handler);
  },
  /** A button of the page's: `retry`, `open-desktop`, `reload`. */
  act: (id) => ipcRenderer.invoke('artifact-app:act', String(id)),
  /** The person's answer to the question about unsaved work. */
  answer: (id, yes) => ipcRenderer.invoke('artifact-app:answer', String(id), yes === true),
  /** Test mode only (refused otherwise, in the main process). */
  test: {
    command: (name, arg) => ipcRenderer.invoke('test:command', String(name), arg ?? null),
    menu: () => ipcRenderer.invoke('test:menu'),
    info: () => ipcRenderer.invoke('test:artifact-app'),
    saved: (saved) => ipcRenderer.invoke('test:saved', saved),
    closeWindow: () => ipcRenderer.invoke('test:close-window'),
    quit: (force) => ipcRenderer.invoke('test:quit', force === true),
  },
});
