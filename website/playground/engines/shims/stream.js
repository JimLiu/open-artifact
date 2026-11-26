// `node:stream`: the in-memory fs's stream classes extend these; nothing the doc or sheet capability reaches streams.
import { EventEmitter } from 'events';
export class Stream extends EventEmitter {}
export class Readable extends Stream {
  static from() {
    throw new Error('stream shim: Readable.from is not available in the browser bundle');
  }
}
export class Writable extends Stream {}
export class Duplex extends Readable {}
export class Transform extends Duplex {}
export class PassThrough extends Transform {}
export const pipeline = () => {
  throw new Error('stream shim: pipeline is not available in the browser bundle');
};
export const finished = pipeline;
export default { Stream, Readable, Writable, Duplex, Transform, PassThrough, pipeline, finished };
