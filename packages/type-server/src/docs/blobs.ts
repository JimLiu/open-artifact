/**
 * A doc's images on disk. They are the artifact's uploads: `<artifact>/_blobs/<id>.<ext>`, the id the first 32 hex
 * digits of the bytes' SHA-256 (as ArtifactStore names its uploads), the extension from the picture's own header. A
 * `media` atom names one as `blob/<id>`.
 */
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { BLOB_ID, blobRef, imageInfo } from '@open-artifact/docs-core';
import { WorkspaceDirectory } from '@open-artifact/protocol/workspace-files';
import { extensionOf } from '../http.ts';
import { sha256 } from '../store.ts';

export const BLOBS_DIR = '_blobs';

export const blobIdOf = (bytes: Uint8Array): string => sha256(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)).slice(0, 32);

/** The stored file of a blob id, whatever its extension; null when there is none. */
function blobFile(files: WorkspaceDirectory, id: string): string | null {
  if (!BLOB_ID.test(id)) return null;
  let names: string[];
  try {
    names = fs.readdirSync(files.resolve(BLOBS_DIR));
  } catch {
    return null;
  }
  const name = names.find((entry) => entry.startsWith(`${id}.`) && !entry.endsWith('.tmp'));
  return name ? files.resolve(path.join(BLOBS_DIR, name)) : null;
}

/** Stores the bytes once (the same bytes are the same blob) and answers their `blob/<id>`. */
export function putDocBlob(artifactRoot: string, bytes: Uint8Array): string {
  const id = blobIdOf(bytes);
  const files = new WorkspaceDirectory(artifactRoot);
  if (blobFile(files, id)) return blobRef(id);
  const mime = imageInfo(bytes)?.mime ?? 'application/octet-stream';
  const file = files.resolve(path.join(BLOBS_DIR, `${id}.${extensionOf(mime)}`), false);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${randomBytes(8).toString('hex')}.tmp`;
  fs.writeFileSync(temporary, bytes, { flag: 'wx' });
  fs.renameSync(temporary, file);
  return blobRef(id);
}

/** The bytes of `blob/<id>` (or a bare id); null when the artifact holds none. */
export function readDocBlob(artifactRoot: string, ref: string): Buffer | null {
  try {
    const file = blobFile(new WorkspaceDirectory(artifactRoot), ref.replace(/^blob\//, ''));
    return file ? fs.readFileSync(file) : null;
  } catch {
    return null;
  }
}
