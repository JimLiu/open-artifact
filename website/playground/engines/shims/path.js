// `node:path`: path-browserify (POSIX), with `win32` standing in as POSIX too. docs/chrome.ts lists Windows install
// folders with `path.win32.join` when it loads; path-browserify leaves `win32` null, which throws at import.
import posix from 'path-browserify';

const path = { ...posix, posix: null, win32: null };
path.posix = path;
path.win32 = path;
export default path;
export const { resolve, normalize, isAbsolute, join, relative, toNamespacedPath, dirname, basename, extname, format, parse, sep, delimiter } = path;
export const win32 = path;
export { path as posix };
