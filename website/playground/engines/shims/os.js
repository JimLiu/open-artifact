// `node:os`: a browser has no computer of its own to describe.
export const EOL = '\n';
export const tmpdir = () => '/tmp';
export const homedir = () => '/home/web';
export const platform = () => 'browser';
export const type = () => 'Browser';
export const arch = () => 'wasm';
export const release = () => '0';
export const hostname = () => 'localhost';
export const cpus = () => [];
export const totalmem = () => 0;
export const freemem = () => 0;
export const networkInterfaces = () => ({});
export const userInfo = () => ({ username: 'web', homedir: homedir(), shell: null, uid: -1, gid: -1 });
export default { EOL, tmpdir, homedir, platform, type, arch, release, hostname, cpus, totalmem, freemem, networkInterfaces, userInfo };
