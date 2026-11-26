/**
 * A command that runs for as long as the one that started it (`open-artifact watch`, a harness's background monitor)
 * ends by itself once that one is gone. An agent app runs its monitor through a shell (Claude Code: `zsh -c` /
 * `bash -c`, then `node … watch`), and when the app quits, it does not always take the monitor down with it: on Windows a
 * child outlives its parent, and a shell that was killed outright leaves its child running anywhere. Nothing reads such
 * a monitor's stdin (it is the null device), and its stdout fails only when something is written to it, so the monitor
 * looks at the processes themselves: its parent, and, past any shells, the first process that is not a shell (the agent
 * app). When one of them is gone, the monitor exits.
 */

import { execFileSync } from 'node:child_process';

/** A process and the name of its program (no folder, no `.exe`). */
export interface ProcessEntry {
  pid: number;
  name: string;
}

/** Shells (and a login shell's `-zsh`) that only stand between an agent app and the command it runs. */
const SHELLS = new Set(['sh', 'bash', 'zsh', 'dash', 'ksh', 'mksh', 'fish', 'tcsh', 'csh', 'ash', 'busybox', 'cmd', 'powershell', 'pwsh', 'wsl']);

/** A program's bare name: `/bin/zsh` → `zsh`, `C:\\…\\bash.exe` → `bash`, `-zsh` → `zsh`. */
export function programName(command: string): string {
  const base = command.trim().split(/[\\/]/).pop() ?? '';
  return base.replace(/^-/, '').replace(/\.exe$/i, '').toLowerCase();
}

export function isShell(name: string): boolean {
  return SHELLS.has(programName(name));
}

/**
 * The processes whose end ends this one, from a chain of ancestors (the parent first): the parent, then each next
 * ancestor while the one before it is a shell, so the first one that is not a shell (the agent app) is the last.
 */
export function holders(chain: readonly ProcessEntry[], limit = 4): number[] {
  const pids: number[] = [];
  for (const entry of chain.slice(0, limit)) {
    if (!(entry.pid > 1)) break;
    pids.push(entry.pid);
    if (!isShell(entry.name)) break;
  }
  return pids;
}

/** Lines of `<pid> <ppid> <name…>` as a pid → [ppid, name] table. */
export function processTable(text: string): Map<number, [number, string]> {
  const table = new Map<number, [number, string]>();
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*(\d+)\s+(\d+)\s+(.*?)\s*$/.exec(line);
    if (match) table.set(Number(match[1]), [Number(match[2]), match[3]]);
  }
  return table;
}

/** Walks a pid → [ppid, name] table up from `start`, at most `depth` processes. */
export function chainFrom(table: Map<number, [number, string]>, start: number, depth: number): ProcessEntry[] {
  const chain: ProcessEntry[] = [];
  let pid = start;
  for (let i = 0; i < depth && pid > 1; i++) {
    const row = table.get(pid);
    if (!row) {
      chain.push({ pid, name: '' });
      break;
    }
    chain.push({ pid, name: row[1] });
    pid = row[0];
  }
  return chain;
}

/**
 * This process's ancestors with their programs' names, the parent first. One `ps` (one PowerShell on Windows, where
 * there is no `ps`); when that fails, only the parent, unnamed.
 */
export function startedBy(start = process.ppid, depth = 4): ProcessEntry[] {
  if (!(start > 1)) return [];
  try {
    if (process.platform === 'win32') {
      const script =
        `$p=${start}; for($i=0;$i -lt ${depth} -and $p -gt 0;$i++){ ` +
        `$x=Get-CimInstance Win32_Process -Filter "ProcessId=$p" -ErrorAction SilentlyContinue; if(-not $x){break}; ` +
        `"$($x.ProcessId) $($x.ParentProcessId) $($x.Name)"; $p=$x.ParentProcessId }`;
      const text = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
        encoding: 'utf8',
        windowsHide: true,
        timeout: 15000,
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      const chain = chainFrom(processTable(text), start, depth);
      if (chain.length) return chain;
    } else {
      const text = execFileSync('ps', ['-A', '-o', 'pid=,ppid=,comm='], { encoding: 'utf8', timeout: 15000, stdio: ['ignore', 'pipe', 'ignore'] });
      const chain = chainFrom(processTable(text), start, depth);
      if (chain.length) return chain;
    }
  } catch {
    // no ps / PowerShell: the parent alone
  }
  return [{ pid: start, name: '' }];
}

/** Whether a process runs (signal 0 tests it, on Windows too; EPERM means it runs as someone else). */
export function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/**
 * Calls `gone` once the parent or a holder (see `holders`) is no longer there, checked every `everyMs`; on POSIX a
 * parent that went away also shows as a new `process.ppid` (the orphan is handed to init or a subreaper). The timer
 * does not keep the process alive. Returns a function that stops the checks.
 */
export function exitWithHolders(options: { pids?: number[]; everyMs?: number; gone?: () => void } = {}): () => void {
  const parent = process.ppid;
  const pids = options.pids ?? holders(startedBy(parent, 4));
  const gone = options.gone ?? (() => process.exit(0));
  if (!pids.length) return () => undefined;
  const timer = setInterval(() => {
    const orphaned = process.platform !== 'win32' && process.ppid !== parent;
    if (orphaned || pids.some((pid) => !alive(pid))) {
      clearInterval(timer);
      gone();
    }
  }, options.everyMs ?? 2000);
  timer.unref();
  return () => clearInterval(timer);
}
