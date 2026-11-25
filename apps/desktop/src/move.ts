import { errorInfo } from './errors.ts';
import type { Log } from './types.ts';
/**
 * Move To…: an artifact's folder moves into another folder, and the library is told where it went
 * (`artifacts.relocate`: the daemon only updates its record, the folder is the app's to move).
 *
 * The order keeps the folder whole whatever fails:
 * 1. the folder to move into must exist, and hold nothing of the artifact's folder's name (`<name> (2)` then);
 * 2. the folder is renamed there (on another volume, copied, then the old one removed once the copy is whole);
 * 3. the daemon is told; when it refuses, the folder is put back where it was, and the error is the daemon's.
 *
 * The caller closes the artifact's tab first (its page writes into the old folder) and opens it again after.
 */
import { cpSync, existsSync, renameSync, rmSync, statSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, resolve, sep } from 'node:path';

/** Where `root` goes when moved into `into`: `into/<name>`, or `into/<name> (2)`… when that is taken. */
export function moveTarget(root: string, into: string) {
  const name = basename(root);
  let target = join(into, name);
  for (let n = 2; existsSync(target); n++) target = join(into, `${name} (${n})`);
  return target;
}

/** Renames `from` to `to`; across volumes, copies (links kept as they are) then removes `from`. */
export function moveFolder(from: string, to: string) {
  try {
    renameSync(from, to);
  } catch (error) {
    if (errorInfo(error).code !== 'EXDEV') throw error;
    cpSync(from, to, { recursive: true, verbatimSymlinks: true, errorOnExist: true, force: false });
    rmSync(from, { recursive: true, force: true });
  }
}

/**
 * Moves artifact `id`'s folder into `into` (an absolute folder that exists). `library`: the client (`record`,
 * `relocate`). Answers `{ from, to }`; throws with the reason, the folder back where it was.
 */
export async function moveArtifact({
  library,
  id,
  into,
  log = () => {},
}: {
  library: { record(id: string): Promise<{ root?: string } | null>; relocate(id: string, folder: string): Promise<unknown> };
  id: string;
  into: string;
  log?: Log;
}) {
  if (typeof into !== 'string' || !isAbsolute(into)) throw new Error('not an absolute folder');
  const folder = resolve(into);
  let isDir = false;
  try {
    isDir = statSync(folder).isDirectory();
  } catch {
    // Not there.
  }
  if (!isDir) throw new Error(`not a folder: ${folder}`);
  const record = await library.record(id);
  const from = typeof record?.root === 'string' ? resolve(record.root) : null;
  if (!from || !existsSync(from)) throw new Error(`the artifact's folder is not there: ${from ?? '?'}`);
  if (dirname(from) === folder) return { from, to: from, moved: false };
  if (folder === from || folder.startsWith(from + sep)) throw new Error('a folder cannot be moved into itself');
  const to = moveTarget(from, folder);
  moveFolder(from, to);
  log(`move ${id}: ${from} to ${to}`);
  try {
    await library.relocate(id, to);
  } catch (error) {
    log(`move ${id}: the library refused (${errorInfo(error).message ?? error}); putting the folder back`);
    try {
      moveFolder(to, from);
    } catch (back) {
      log(`move ${id}: could not put it back: ${errorInfo(back).message ?? back}`);
    }
    throw error;
  }
  return { from, to, moved: true };
}
