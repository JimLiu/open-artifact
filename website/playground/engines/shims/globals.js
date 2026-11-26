// Injected into every module of the bundles (esbuild `inject`): the Node globals the type server's modules use as free
// identifiers. `Buffer` is the `buffer` package's; `process` is a stand-in with what the host and stores read; the timer
// functions hand back handles with `unref()`/`ref()` (Node's), since the stores call `setInterval(...).unref()`.
import { Buffer } from 'buffer';

const proc = globalThis.process ?? {
  env: {},
  platform: 'browser',
  version: 'v22.18.0',
  versions: { node: '22.18.0' },
  argv: [],
  pid: 1,
  cwd: () => '/',
  nextTick: (fn, ...args) => queueMicrotask(() => fn(...args)),
  hrtime: Object.assign(() => [0, 0], { bigint: () => BigInt(Math.round(performance.now() * 1e6)) }),
  memoryUsage: () => ({ rss: 0, heapTotal: 0, heapUsed: 0, external: 0 }),
  emitWarning: () => undefined,
  on: () => proc,
  off: () => proc,
  once: () => proc,
  stdout: { write: (s) => (console.log(String(s).replace(/\n$/, '')), true) },
  stderr: { write: (s) => (console.warn(String(s).replace(/\n$/, '')), true) },
};
if (!globalThis.process) globalThis.process = proc;

const native = {
  setTimeout: globalThis.setTimeout.bind(globalThis),
  setInterval: globalThis.setInterval.bind(globalThis),
  clearTimeout: globalThis.clearTimeout.bind(globalThis),
  clearInterval: globalThis.clearInterval.bind(globalThis),
};

class Handle {
  constructor(id) {
    this.id = id;
  }
  unref() {
    return this;
  }
  ref() {
    return this;
  }
  hasRef() {
    return true;
  }
  refresh() {
    return this;
  }
  [Symbol.toPrimitive]() {
    return this.id;
  }
}
const idOf = (handle) => (handle instanceof Handle ? handle.id : handle);

const _setTimeout = (fn, ms, ...args) => new Handle(native.setTimeout(fn, ms, ...args));
const _setInterval = (fn, ms, ...args) => new Handle(native.setInterval(fn, ms, ...args));
const _clearTimeout = (handle) => native.clearTimeout(idOf(handle));
const _clearInterval = (handle) => native.clearInterval(idOf(handle));
const _setImmediate = (fn, ...args) => new Handle(native.setTimeout(fn, 0, ...args));

export { Buffer, proc as process, _setTimeout as setTimeout, _setInterval as setInterval, _clearTimeout as clearTimeout, _clearInterval as clearInterval, _setImmediate as setImmediate, _clearTimeout as clearImmediate };
