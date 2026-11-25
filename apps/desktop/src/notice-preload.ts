// The "saved" notice's page (renderer/notice/) gets this bridge and nothing else: it is sent what to draw, and sends
// back Show in Finder (a notice's id: the main process knows the file), Close and hover. Every call is checked again
// in the main process (it must come from the notice's own page).
import type { IpcRendererEvent } from 'electron';
import { contextBridge, ipcRenderer } from 'electron';
import type { NoticeBridge } from './contracts.ts';

const bridge: NoticeBridge = {
  onShow: (listener) => {
    ipcRenderer.on('notice:show', (_event: IpcRendererEvent, notice: import('./types.ts').NoticeData | null) => listener(notice));
  },
  ready: () => ipcRenderer.send('notice:ready'),
  reveal: (id) => ipcRenderer.send('notice:reveal', String(id)),
  dismiss: () => ipcRenderer.send('notice:dismiss'),
  hover: (on) => ipcRenderer.send('notice:hover', on === true),
};
contextBridge.exposeInMainWorld('notice', bridge);
