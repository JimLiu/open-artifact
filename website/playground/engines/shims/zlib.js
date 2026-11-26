// `node:zlib` for the browser bundles, from fflate: the sync and callback forms the zip writer/reader, the .xlsx export
// and the PDF importer use.
import { Buffer } from 'buffer';
import { deflateSync as fDeflateRaw, inflateSync as fInflateRaw, zlibSync, unzlibSync, gzipSync as fGzip, gunzipSync as fGunzip } from 'fflate';

const bytes = (data) => (typeof data === 'string' ? Buffer.from(data) : new Uint8Array(data.buffer ?? data, data.byteOffset ?? 0, data.byteLength ?? data.length));
const level = (options) => (options?.level === undefined || options.level < 0 ? 6 : Math.min(9, options.level));
function bounded(out, options) {
  if (options?.maxOutputLength !== undefined && out.length > options.maxOutputLength) throw new RangeError('Memory limit exceeded');
  return Buffer.from(out.buffer, out.byteOffset, out.byteLength);
}

export const deflateRawSync = (data, options) => bounded(fDeflateRaw(bytes(data), { level: level(options) }));
export const inflateRawSync = (data, options) => bounded(fInflateRaw(bytes(data)), options);
export const deflateSync = (data, options) => bounded(zlibSync(bytes(data), { level: level(options) }));
export const inflateSync = (data, options) => bounded(unzlibSync(bytes(data)), options);
export const gzipSync = (data, options) => bounded(fGzip(bytes(data), { level: level(options) }));
export const gunzipSync = (data, options) => bounded(fGunzip(bytes(data)), options);

const callbackOf = (sync) => (data, options, callback) => {
  if (typeof options === 'function') [options, callback] = [undefined, options];
  queueMicrotask(() => {
    let out;
    try {
      out = sync(data, options);
    } catch (error) {
      callback(error);
      return;
    }
    callback(null, out);
  });
};
export const deflateRaw = callbackOf(deflateRawSync);
export const inflateRaw = callbackOf(inflateRawSync);
export const deflate = callbackOf(deflateSync);
export const inflate = callbackOf(inflateSync);
export const gzip = callbackOf(gzipSync);
export const gunzip = callbackOf(gunzipSync);
export const constants = { Z_NO_FLUSH: 0, Z_FINISH: 4, Z_BEST_COMPRESSION: 9, Z_DEFAULT_COMPRESSION: -1 };
export default { deflateRawSync, inflateRawSync, deflateSync, inflateSync, gzipSync, gunzipSync, deflateRaw, inflateRaw, deflate, inflate, gzip, gunzip, constants };
