// Node modules with no browser meaning (child_process, net, http, dns, worker_threads, readline, module): importing is
// fine, calling anything throws, naming it. Only Node-only extras (Chrome PDF printing, LAN sharing, MCP connectors)
// reach these, and the capabilities turn those off as hosted mode does.
const unavailable = (name) => () => {
  throw Object.assign(new Error(`${name} is not available in the browser playground`), { code: 'ENOSYS' });
};
const proxy = new Proxy({}, { get: (_t, key) => (key === '__esModule' ? false : key === 'default' ? proxy : unavailable(String(key))) });
export default proxy;
export const spawn = unavailable('child_process.spawn');
export const execFile = unavailable('child_process.execFile');
export const exec = unavailable('child_process.exec');
export const createServer = unavailable('createServer');
export const request = unavailable('request');
export const get = unavailable('get');
export const connect = unavailable('connect');
export const createConnection = unavailable('createConnection');
export const lookup = unavailable('dns.lookup');
export const createInterface = unavailable('readline.createInterface');
export const createRequire = () => Object.assign(unavailable('require'), { resolve: unavailable('require.resolve') });
export class Worker {
  constructor() {
    unavailable('worker_threads.Worker')();
  }
}
export const isMainThread = true;
export const parentPort = null;
export const workerData = null;
export class Server {}
export class Socket {}
export class IncomingMessage {}
export class ServerResponse {}
export const STATUS_CODES = {};
export const isIP = () => 0;
