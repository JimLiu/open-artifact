import { ipcRenderer } from 'electron';

/** The one cast at Electron's untyped transport boundary; callers share the main process channel contract. */
export function ipcClient<Calls extends { [K in keyof Calls]: (...args: never[]) => Promise<unknown> }>() {
  return <K extends keyof Calls & string>(channel: K): Calls[K] => {
    const invoke: (...args: never[]) => Promise<unknown> = (...args: unknown[]): Promise<unknown> => ipcRenderer.invoke(channel, ...args);
    return invoke as Calls[K];
  };
}
