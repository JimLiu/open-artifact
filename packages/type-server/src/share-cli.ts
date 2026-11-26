/**
 * `share <dir>` and `open <dir> --lan`: LAN sharing from the command line,
 * the same calls the Shell's Share panel makes through the daemon
 * (`/__open-artifact/share`, see `sharing.ts`).
 *
 *     share <dir>                         open it to the local network; print a link per role
 *     share <dir> --off                   stop sharing (guests keep their place for next time)
 *     share <dir> --enable R / --disable R    turn role links on or off (R: editor, commenter, viewer, a comma list, or all)
 *     share <dir> --reset R               give the roles new links: the old ones stop working, their guests are out
 *     share <dir> --role <guest>=R,…      give someone who joined another role (<guest>: an id it prints)
 *     share <dir> --remove <guest>,…      remove people who joined
 *
 * The link options leave it shared or not as it was; only `share <dir>`
 * alone opens it to the network.
 */

import { isTailnet } from '@open-artifact/server-sdk/lan';
import { WorkspaceDirectory } from '@open-artifact/protocol/workspace-files';
import { GUEST_ROLES, SharingFile, isGuestRole, type ShareChange, type ShareViewFull } from './sharing.ts';
import type { ShareRole } from '@open-artifact/protocol';

/** What the share commands need of the CLI. */
export interface ShareCliDeps {
  /** Opens the artifact on the running (or a newly started) server; answers its id. */
  open(root: string, port?: number): Promise<{ id: string }>;
  /** `GET` (no body) or `POST` the server's `/__open-artifact/share`. */
  share(id: string, change?: ShareChange): Promise<ShareViewFull>;
  /** A usage error. */
  fail(message: string): never;
}

type Flags = Map<string, string | true>;

function roles(flags: Flags, name: string, fail: ShareCliDeps['fail']): ShareRole[] {
  const given = flags.get(name);
  if (given === undefined) return [];
  if (given === true || given === 'all') return [...GUEST_ROLES];
  const list = given.split(',').map((r) => r.trim());
  for (const role of list) if (!isGuestRole(role)) fail(`--${name}: editor, commenter, viewer, a comma list of them, or all (got ${role}).`);
  return list as ShareRole[];
}

/** The change the flags ask for, and whether it turns sharing on or off. */
export function shareChangeOf(flags: Flags, fail: ShareCliDeps['fail']): ShareChange {
  const change: ShareChange = {};
  const links: Partial<Record<ShareRole, boolean>> = {};
  for (const role of roles(flags, 'enable', fail)) links[role] = true;
  for (const role of roles(flags, 'disable', fail)) links[role] = false;
  if (Object.keys(links).length) change.links = links;
  const reset = roles(flags, 'reset', fail);
  if (reset.length) change.reset = reset;
  const guests: Record<string, ShareRole | null> = {};
  const role = flags.get('role');
  if (role !== undefined) {
    for (const pair of String(role).split(',')) {
      const [guest = '', to = ''] = pair.split('=').map((part) => part.trim());
      if (!guest || !isGuestRole(to)) fail(`--role: <guest id>=editor|commenter|viewer, comma separated (got ${pair}).`);
      guests[guest] = to;
    }
  }
  const remove = flags.get('remove');
  if (remove !== undefined) {
    if (remove === true) fail('--remove: the guest ids to remove, comma separated.');
    for (const guest of remove.split(',').map((g) => g.trim()).filter(Boolean)) guests[guest] = null;
  }
  if (Object.keys(guests).length) change.guests = guests;
  if (flags.has('off')) change.lan = false;
  else if (!Object.keys(change).length) change.lan = true;
  return change;
}

/** The port the links were given out with, so a server started for them gets it back. */
export function sharedPort(root: string): number | undefined {
  try {
    return SharingFile.read(new WorkspaceDirectory(root)).port;
  } catch {
    return undefined;
  }
}

/** Lines for a person to read. */
export function formatShare(view: ShareViewFull): string {
  const lines: string[] = [];
  const local = (view.addresses ?? []).filter((a) => !isTailnet(a));
  if (view.lan) {
    lines.push(view.addresses?.length ? `Shared on the local network at ${view.addresses.join(', ')} (port ${view.port}).` : 'Shared, but this computer has no local network address right now.');
  } else {
    lines.push('Not shared on the network: only this computer opens it. `share <dir>` with no options shares it.');
  }
  for (const role of GUEST_ROLES) {
    const link = view.links[role];
    if (link) lines.push(`  ${role.padEnd(10)} ${link.on ? (view.lan ? link.url : 'on') : 'off'}`);
  }
  if (view.tailnet) lines.push(`Tailscale (${view.tailnet.address}): the same links for people on your tailnet:`, ...Object.entries(view.tailnet.links).map(([role, url]) => `  ${role.padEnd(10)} ${url}`));
  if (view.guests.length) {
    lines.push('Joined:');
    for (const g of view.guests) lines.push(`  ${g.id}  ${g.name} (${g.role}${g.active ? '' : ', link off'}${g.online ? ', online' : ''})`);
  }
  if (view.lan) {
    lines.push(
      'Editors edit, commenters comment, viewers look; whoever opens a link types a name. Only the owner (this computer) sends to the agent.',
      'Plain http: others on the network can read what passes, and a link is the permission. Send each only to whom it is meant for; --reset a role whose link went further.',
    );
    if (local.length > 1) lines.push('This computer is on more than one network: if a link does not open, give the same link with another of the addresses.');
    lines.push('Stop: share <dir> --off');
  }
  return lines.join('\n');
}

/** `share <dir> …`: prints the sharing state after the change. */
export async function cmdShare(root: string, flags: Flags, deps: ShareCliDeps): Promise<number> {
  const change = shareChangeOf(flags, deps.fail);
  const { id } = await deps.open(root, sharedPort(root));
  const view = await deps.share(id, change);
  console.log(flags.has('json') ? JSON.stringify(view, null, 2) : formatShare(view));
  return 0;
}
