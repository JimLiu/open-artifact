/**
 * Starting the daemon in an Electron utility process, for an app whose `RunAsNode` fuse is off.
 *
 * With that fuse off, the app's executable no longer runs scripts under `ELECTRON_RUN_AS_NODE=1`, so the kit's own
 * start cannot work. The kit then hands the start to the app (`createHarness({ daemon: { spawn } })`): it still picks
 * the runtime, waits for the daemon, checks its version and tries the next runtime when one does not start.
 *
 * - `process.argv` in a utility process is `[<Electron Helper>, bin, ...args]`, the shape the daemon reads, so `bin`
 *   is forked as it is, without a wrapper script.
 * - `OPEN_ARTIFACT_NODE_CHILDREN=threads` says explicitly that type servers run in worker threads of the daemon. A daemon
 *   in a utility process chooses threads anyway (its executable must not be started as Node); an app with the fuse on
 *   that wants child processes passes `process` instead.
 * - The process is returned so the kit leaves a runtime that ended at once without waiting for its timeout.
 * - A utility process ends with the app: the daemon stops when the app quits, and the next app to connect starts it.
 */
import { createWriteStream } from 'node:fs';
import { utilityProcess } from 'electron';

/** `daemon.spawn` for `createHarness`: forks the daemon in a utility process and appends its output to the log file. */
export function spawnDaemonInUtilityProcess({ bin, args, env, logFile }) {
  const child = utilityProcess.fork(bin, args, {
    env: { ...env, OPEN_ARTIFACT_NODE_CHILDREN: 'threads' },
    stdio: 'pipe',
    serviceName: 'Open Artifact',
  });
  const log = createWriteStream(logFile, { flags: 'a' });
  child.stdout?.pipe(log);
  child.stderr?.pipe(log);
  child.once('exit', () => log.end());
  return child;
}
