/**
 * Small chores on an artifact folder from the CLI:
 *
 * - `delete-asset <dir> <blob>`: removes an upload (`_blobs/<id>.<ext>`)
 *   that nothing in the artifact names any more;
 * - the `.gitignore` that `open` writes into a folder that has none, so a
 *   folder kept in git leaves this machine's state out.
 */

import { existsSync, type Dirent } from 'node:fs';
import { readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { basename, join, relative, resolve, sep } from 'node:path';
import { WorkspaceDirectory } from '@open-artifact/protocol/workspace-files';
import { ArtifactStore } from './store.ts';

/** Files larger than this are not searched for references (uploads are never referenced from them). */
const MAX_SEARCHED_BYTES = 16 * 1024 * 1024;
/** Folders under the artifact root searched for references to an upload. */
const SEARCHED = ['project', 'db'];
/** Files at the root searched too. */
const SEARCHED_FILES = ['comments.json', '.artifact.json'];

/** The upload id given as `/_blob/<id>`, `_blob/<id>` or the bare id. */
export function blobIdOf(given: string | undefined): string | null {
  const text = String(given ?? '').trim();
  const match = /^(?:\/?_blob\/)?([0-9a-f]{32})(?:\.[A-Za-z0-9]+)?$/.exec(text);
  return match ? match[1]! : null;
}

/** Artifact-relative paths of the files that name `id`. */
export async function referencesTo(root: string, id: string): Promise<string[]> {
  root = resolve(root);
  const directory = new WorkspaceDirectory(root);
  const users: string[] = [];
  const needle = Buffer.from(id);
  const visit = async (file: string): Promise<void> => {
    const info = await stat(directory.resolve(file)).catch(() => null);
    if (!info?.isFile() || info.size > MAX_SEARCHED_BYTES) return;
    const bytes = await readFile(directory.resolve(file)).catch(() => null);
    if (bytes?.includes(needle)) users.push(relative(root, file).split(sep).join('/'));
  };
  const walk = async (dir: string): Promise<void> => {
    let entries: Dirent[];
    try {
      entries = await readdir(directory.resolve(dir), { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name === 'node_modules' || entry.name === '.git') continue;
      const file = join(dir, entry.name);
      if (entry.isDirectory()) await walk(file);
      else if (entry.isFile()) await visit(file);
    }
  };
  for (const dir of SEARCHED) await walk(join(root, dir));
  for (const name of SEARCHED_FILES) await visit(join(root, name));
  return users.sort();
}

/** Why `delete-asset` refused, with a code. */
export class AssetError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

/**
 * Removes an upload nothing names: every file of `project/`, the document
 * store (`db/`) and `comments.json` is searched for its id first. Throws
 * {@link AssetError} (`INVALID_ASSET`, `NOT_FOUND`, `IN_USE`) and removes
 * nothing when it may not go.
 */
export async function deleteAsset(root: string, given: string | undefined): Promise<{ deleted: string; file: string }> {
  const id = blobIdOf(given);
  if (!id) throw new AssetError('INVALID_ASSET', 'Give the upload as its url (/_blob/<id>) or its id (32 hex digits).');
  const blob = await new ArtifactStore(root).findBlob(id);
  if (!blob) throw new AssetError('NOT_FOUND', `No upload ${id} in ${join(root, '_blobs')}.`);
  const users = await referencesTo(root, id);
  if (users.length) throw new AssetError('IN_USE', `/_blob/${id} is still named by ${users.join(', ')}; change or delete those first. Nothing was removed.`);
  if (basename(blob.file) === id) await rm(blob.file + '.json', { force: true });
  await rm(blob.file, { force: true });
  return { deleted: `/_blob/${id}`, file: blob.file };
}

/** What `open` writes as a new artifact folder's `.gitignore`. */
export const ARTIFACT_GITIGNORE = `# Open Artifact: this machine's state, not the artifact.
_agent/
history/
.artifact*
.sharing.json
*.log
*.tmp
.DS_Store
`;

/**
 * Writes {@link ARTIFACT_GITIGNORE} into the folder when it has no
 * `.gitignore`; an existing one is never touched. Returns whether it wrote.
 */
export async function ensureGitignore(root: string): Promise<boolean> {
  if (!existsSync(root)) return false;
  try {
    const file = new WorkspaceDirectory(root).resolve('.gitignore', false);
    await writeFile(file, ARTIFACT_GITIGNORE, { flag: 'wx' });
    return true;
  } catch {
    return false;
  }
}
