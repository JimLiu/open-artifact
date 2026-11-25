// The window's own page (renderer/) gets this bridge and nothing else; artifact views get no preload at all.
// Every call is checked again in the main process: it must come from this window's own page, and its arguments are
// checked there too. Nothing here hands out the daemon's address or token: the library calls are answered in the main
// process with them.
const { contextBridge, ipcRenderer } = require('electron');

const listen = (channel) => (listener) => {
  const handler = (_event, value) => listener(value);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.off(channel, handler);
};

contextBridge.exposeInMainWorld('desktop', {
  /** Opens an artifact in a tab: an id or an `open-artifact://artifact/<id>` link. */
  open: (ref) => ipcRenderer.invoke('desktop:open', String(ref)),
  select: (id) => ipcRenderer.invoke('desktop:select', String(id)),
  close: (id) => ipcRenderer.invoke('desktop:close', String(id)),
  reload: (id) => ipcRenderer.invoke('desktop:reload', String(id)),
  /** Back and forward over the tabs the person went to. */
  back: () => ipcRenderer.invoke('desktop:back'),
  forward: () => ipcRenderer.invoke('desktop:forward'),
  /** Collapses (true) or opens (false) the sidebar; kept in the app's settings. */
  setSidebarCollapsed: (collapsed) => ipcRenderer.invoke('desktop:sidebar', collapsed === true),
  /** The page draws over the artifact views (a dialog is open), or stops. */
  setOverlay: (on) => ipcRenderer.invoke('desktop:overlay', on === true),
  /** Keyboard focus back to this page. */
  focus: () => ipcRenderer.invoke('desktop:focus'),
  /** The tabs, the connection, back and forward, the sidebar and the look, now and on every change. */
  state: () => ipcRenderer.invoke('desktop:state'),
  onState: listen('desktop:state'),
  /** The library, for the home page: each call answers `{ ok, value }` or `{ ok: false, error }`. */
  library: {
    list: () => ipcRenderer.invoke('library:list'),
    update: (id, patch) => ipcRenderer.invoke('library:update', String(id), { ...patch }),
    remove: (id) => ipcRenderer.invoke('library:remove', String(id)),
    restore: (trash) => ipcRenderer.invoke('library:restore', String(trash)),
    create: (type, title) => ipcRenderer.invoke('library:create', { type: String(type), title: String(title ?? '') }),
    capture: (id, type) => ipcRenderer.invoke('library:capture', String(id), String(type)),
    saveThumbnail: (id, version, jpeg) => ipcRenderer.invoke('library:save-thumbnail', String(id), String(version), jpeg),
    copy: (text) => ipcRenderer.invoke('library:copy', String(text)),
    /** The library changed (or the connection went or came back). */
    onEvent: listen('desktop:library'),
  },
});
