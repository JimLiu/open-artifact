/**
 * The files a Sheet takes in and gives out: an .xlsx file chosen with "Import from Excel", kept in `<sheet>/imports/`
 * for the agent, and the parts of an .xlsx export zipped in memory.
 */

import fs from 'node:fs';
import path from 'node:path';
import { deflateRawSync } from 'node:zlib';
import type { WorkspaceDirectory } from '@open-artifact/protocol/workspace-files';
import type { XlsxPart } from '@open-artifact/sheets-core';
import { crc32 } from '../archive.ts';

/** The folder, in the Sheet's, that holds the files people chose to import. */
export const IMPORTS_DIR = 'imports';
/** The largest file taken. */
export const MAX_IMPORT_BYTES = 50 * 1024 * 1024;
const MAX_NAME = 120;

/**
 * The name to keep a file under, from what the page calls it: its last path segment, with no control characters and
 * no leading dots, cut to 120 characters. Null unless it is an .xlsx file.
 */
export function importFileName(given: string): string | null {
  // eslint-disable-next-line no-control-regex
  const name = (given.split(/[\\/]/).at(-1) ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim();
  const ext = /\.xlsx$/i.exec(name)?.[0];
  if (!ext) return null;
  const stem = name.slice(0, -ext.length).replace(/^[.\s]+/, '').trim().slice(0, MAX_NAME - ext.length) || 'import';
  return `${stem}${ext}`;
}

/** Whether these bytes can be an .xlsx file: a zip, which starts with a local file header. */
export const looksLikeXlsx = (bytes: Uint8Array): boolean => bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;

/**
 * Keeps the file in `<sheet>/imports/`, under `name` or, when that is taken, `name-2`, `name-3`…; never over a file
 * that is there. Answers its path from the Sheet's folder (`imports/Budget.xlsx`).
 */
export function saveImport(sheetDir: string, name: string, bytes: Uint8Array, files?: WorkspaceDirectory): string {
  const requested = path.resolve(sheetDir, IMPORTS_DIR);
  const dir = files?.resolve(requested) ?? requested;
  fs.mkdirSync(dir, { recursive: true });
  const ext = path.extname(name);
  const stem = name.slice(0, name.length - ext.length);
  for (let n = 1; n < 1000; n++) {
    const file = n === 1 ? name : `${stem}-${n}${ext}`;
    try {
      const target = path.join(dir, file);
      fs.writeFileSync(files?.resolve(target, false) ?? target, bytes, { flag: 'wx' });
      return `${IMPORTS_DIR}/${file}`;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
  }
  throw new Error(`${IMPORTS_DIR}/ has no free name for ${name}`);
}

/** The parts of an .xlsx file as one zip, deflated, in memory (plain zip: the parts are far below its limits). */
export function zipXlsxParts(parts: readonly XlsxPart[]): Uint8Array {
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  // 1980-01-01 00:00: the same bytes for the same workbook.
  const [time, date] = [0, (0 << 9) | (1 << 5) | 1];
  for (const part of parts) {
    const name = encoder.encode(part.path);
    const data = encoder.encode(part.xml);
    const deflated = deflateRawSync(data);
    const crc = crc32(data);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, 0x0800, true);
    local.setUint16(8, 8, true);
    local.setUint16(10, time, true);
    local.setUint16(12, date, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, deflated.length, true);
    local.setUint32(22, data.length, true);
    local.setUint16(26, name.length, true);
    local.setUint16(28, 0, true);
    const entry = new DataView(new ArrayBuffer(46));
    entry.setUint32(0, 0x02014b50, true);
    entry.setUint16(4, 20, true);
    entry.setUint16(6, 20, true);
    entry.setUint16(8, 0x0800, true);
    entry.setUint16(10, 8, true);
    entry.setUint16(12, time, true);
    entry.setUint16(14, date, true);
    entry.setUint32(16, crc, true);
    entry.setUint32(20, deflated.length, true);
    entry.setUint32(24, data.length, true);
    entry.setUint16(28, name.length, true);
    entry.setUint32(42, offset, true);
    chunks.push(new Uint8Array(local.buffer), name, deflated);
    central.push(new Uint8Array(entry.buffer), name);
    offset += 30 + name.length + deflated.length;
  }
  const centralSize = central.reduce((n, c) => n + c.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, parts.length, true);
  end.setUint16(10, parts.length, true);
  end.setUint32(12, centralSize, true);
  end.setUint32(16, offset, true);
  const all = [...chunks, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(all.reduce((n, c) => n + c.length, 0));
  let at = 0;
  for (const chunk of all) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
}
