// `node:url`: file URLs for the paths of the in-memory file system (always POSIX).
export const URL = globalThis.URL;
export const URLSearchParams = globalThis.URLSearchParams;
export function fileURLToPath(url) {
  const at = typeof url === 'string' ? new URL(url) : url;
  if (at.protocol !== 'file:') throw new TypeError('The URL must be of scheme file');
  return decodeURIComponent(at.pathname);
}
export function pathToFileURL(path) {
  return new URL(`file://${encodeURI(path.startsWith('/') ? path : `/${path}`).replace(/[?#]/g, encodeURIComponent)}`);
}
export default { URL, URLSearchParams, fileURLToPath, pathToFileURL };
