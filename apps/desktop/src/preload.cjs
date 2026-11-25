// The window's own bar (renderer/) gets this bridge and nothing else; artifact views get no preload at all.
// Every call is checked again in the main process: it must come from this window's own page.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktop', {
  /** Opens an artifact in a tab: an id or an `open-artifact://artifact/<id>` link. */
  open: (ref) => ipcRenderer.invoke('desktop:open', String(ref)),
  select: (id) => ipcRenderer.invoke('desktop:select', String(id)),
  close: (id) => ipcRenderer.invoke('desktop:close', String(id)),
  reload: (id) => ipcRenderer.invoke('desktop:reload', String(id)),
  /** The tabs and the connection, now and on every change. */
  state: () => ipcRenderer.invoke('desktop:state'),
  onState: (listener) => {
    const handler = (_event, state) => listener(state);
    ipcRenderer.on('desktop:state', handler);
    return () => ipcRenderer.off('desktop:state', handler);
  },
});
