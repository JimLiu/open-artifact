/** Path resolution for local, already-authorized workspace files. */
import { randomBytes } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { OpenArtifactError } from './errors.ts';

function includesPath(root: string, target: string): boolean {
  const path = relative(root, target);
  return path !== '..' && !path.startsWith('..' + sep) && !isAbsolute(path);
}

const forbidden = () => new OpenArtifactError('not_granted', 'File is outside the authorized workspace.', { status: 403 });

export interface WorkspaceDirectoryIdentity {
  root: string;
  device: string;
  inode: string;
}

export class WorkspaceDirectory {
  readonly root: string;
  private readonly givenRoot: string;
  private readonly device: bigint;
  private readonly inode: bigint;

  constructor(root: string, identity?: WorkspaceDirectoryIdentity) {
    this.givenRoot = resolve(root);
    this.root = realpathSync(this.givenRoot);
    const stat = statSync(this.root, { bigint: true });
    if (!stat.isDirectory()) throw forbidden();
    this.device = stat.dev;
    this.inode = stat.ino;
    if (identity && (
      identity.root !== this.root ||
      identity.device !== this.device.toString() ||
      identity.inode !== this.inode.toString()
    )) throw forbidden();
  }

  get identity(): WorkspaceDirectoryIdentity {
    return { root: this.root, device: this.device.toString(), inode: this.inode.toString() };
  }

  /** Read optional metadata from a checked file. */
  readJson<T>(input: string, fallback: T): T {
    try {
      return JSON.parse(readFileSync(this.resolve(input), 'utf8')) as T;
    } catch {
      return fallback;
    }
  }

  /** Atomically replace a metadata entry inside this directory. */
  writeJson(input: string, value: unknown, mode?: number): void {
    const file = this.resolve(input, false);
    const tmp = `${file}.${randomBytes(8).toString('hex')}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx', ...(mode === undefined ? {} : { mode }) });
    try {
      renameSync(tmp, file);
    } catch (error) {
      try { unlinkSync(tmp); } catch { /* Preserve the original error. */ }
      throw error;
    }
  }

  /**
   * Check both the directory identity and the path. New files inherit the nearest existing parent's boundary. A path
   * spelled through a link to the workspace (macOS's `/var` for `/private/var`) is judged by where it really leads.
   */
  resolve(input: string, followLeaf = true): string {
    const directory = lstatSync(this.root, { bigint: true });
    if (!directory.isDirectory() || directory.dev !== this.device || directory.ino !== this.inode) throw forbidden();
    const path = resolve(this.givenRoot, input);
    const target = includesPath(this.givenRoot, path) ? resolve(this.root, relative(this.givenRoot, path)) : path;
    // Outside the workspace as spelled: only its real path may still bring it in; no other error says what is there.
    const outside = !includesPath(this.root, target);

    const tail: string[] = [];
    let ancestor = target;
    if (!followLeaf && target !== this.root) {
      tail.push(basename(target));
      ancestor = dirname(target);
    }
    let real: string;
    try {
      for (;;) {
        try {
          lstatSync(ancestor);
          break;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT' || ancestor === this.root || dirname(ancestor) === ancestor) throw error;
          tail.unshift(basename(ancestor));
          ancestor = dirname(ancestor);
        }
      }
      real = realpathSync(ancestor);
    } catch (error) {
      if (outside) throw forbidden();
      throw error;
    }

    const actual = join(real, ...tail);
    if (!includesPath(this.root, actual)) throw forbidden();
    return actual;
  }
}

/** Bind a recorded artifact to the real folder in its originally authorized workspace. */
export function artifactDirectory({ root, workspaceDirectory }: { root: string; workspaceDirectory?: WorkspaceDirectoryIdentity }): WorkspaceDirectory {
  const workspace = workspaceDirectory ? new WorkspaceDirectory(workspaceDirectory.root, workspaceDirectory) : undefined;
  return new WorkspaceDirectory(workspace?.resolve(root) ?? root);
}

export const SHARING_FILE = '.sharing.json';

/** The existing sharing record, used by the editor, the CLI and the daemon. */
export function readSharingState(files: WorkspaceDirectory): Record<string, unknown> | null {
  return files.readJson<Record<string, unknown> | null>(SHARING_FILE, null);
}
