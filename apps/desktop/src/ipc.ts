import type { IpcMainInvokeEvent } from 'electron';
import { ipcMain } from 'electron';
import { errorInfo } from './errors.ts';
import type { MaybePromise, Reply } from './types.ts';

/** Electron receives untrusted values. Callbacks retain their argument checks after the sender check. */
export function ipcHandlers<Calls extends { [K in keyof Calls]: (...args: never[]) => unknown }>(
  mine: (event: IpcMainInvokeEvent) => boolean,
  log: (line: string) => void,
) {
  type Args<K extends keyof Calls> = Parameters<Calls[K]>;
  type Value<K extends keyof Calls> = Awaited<ReturnType<Calls[K]>>;
  const handle = <K extends keyof Calls & string>(channel: K, run: (...args: Args<K>) => MaybePromise<Value<K>>) => {
    ipcMain.handle(channel, (event, ...args: unknown[]) => {
      if (!mine(event)) {
        log(`refused ${channel} from ${event.senderFrame?.url ?? '?'}`);
        throw new Error('not allowed');
      }
      return run(...(args as Args<K>));
    });
  };
  const answer = <K extends keyof Calls & string>(channel: K, run: (...args: Args<K>) => MaybePromise<Value<K> extends Reply<infer T> ? T : never>) => {
    handle(channel, async (...args): Promise<Value<K>> => {
      try {
        return { ok: true, value: await run(...args) } as Value<K>;
      } catch (error) {
        log(`${channel}: ${errorInfo(error).message}`);
        return { ok: false, error: errorInfo(error).message } as Value<K>;
      }
    });
  };
  return { handle, answer };
}
