// `node:util`: what the modules in the graph use (promisify, the TextEncoder/Decoder, inspect for messages).
export function promisify(fn) {
  return (...args) => new Promise((resolve, reject) => fn(...args, (error, value) => (error ? reject(error) : resolve(value))));
}
export const inspect = (value) => {
  try {
    return typeof value === 'string' ? value : JSON.stringify(value);
  } catch {
    return String(value);
  }
};
export const format = (...args) => args.map(inspect).join(' ');
export const isDeepStrictEqual = (a, b) => JSON.stringify(a) === JSON.stringify(b);
export const types = { isUint8Array: (v) => v instanceof Uint8Array, isDate: (v) => v instanceof Date, isRegExp: (v) => v instanceof RegExp };
export const deprecate = (fn) => fn;
export const inherits = (ctor, superCtor) => {
  Object.setPrototypeOf(ctor.prototype, superCtor.prototype);
  Object.setPrototypeOf(ctor, superCtor);
};
export { TextEncoder, TextDecoder };
const { TextEncoder, TextDecoder } = globalThis;
export default { promisify, inspect, format, isDeepStrictEqual, types, deprecate, inherits, TextEncoder, TextDecoder };
