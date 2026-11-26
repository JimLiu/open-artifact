/** The home page's pure logic: ordering, what can be created, owner badges. No DOM. */

import { builtinStartOf, hostToShellOf, NO_PROJECT, type ArtifactView, type HostLibraryFilter, type ProjectChoice, type TypeView } from '@open-artifact/protocol';
import type { HomeHost } from './host.ts';
import type { BadgeState } from '../components/OwnerBadge.tsx';

/**
 * Roots whose frame types (the types people make) the home page offers "New" for. A project's types are made from a
 * session in that project: the home page creates in its own workspace. A server type in these roots (a copy of a
 * built-in, say) is not offered.
 */
const CREATABLE_SCOPES: readonly string[] = ['user', 'extra'];

/** The ids "New" offered in any root before the built-ins were grouped (it began with Design, then Page). */
const LEGACY_CREATABLE: readonly string[] = ['design', 'page'];

/** When an artifact's content last changed, for ordering. */
export function contentTime(a: Pick<ArtifactView, 'contentAt' | 'updatedAt' | 'createdAt'>): number {
  return Date.parse(a.contentAt || a.updatedAt || a.createdAt || '') || 0;
}

/**
 * The artifacts a host asked for (`host_hello`'s `library`): its harness's sessions', its workspace's (the owner
 * session works there, the artifact's folder is under it, or it was made for a project the workspace is in or holds);
 * all of them without a filter.
 */
export function forHost(list: readonly ArtifactView[], filter: HostLibraryFilter | null | undefined): ArtifactView[] {
  if (!filter || (!filter.harness && !filter.workspace)) return [...list];
  const trim = (path: string): string => path.replace(/[\\/]+$/, '');
  const inside = (path: string, folder: string): boolean => path === folder || path.startsWith(`${folder}/`) || path.startsWith(`${folder}\\`);
  const workspace = filter.workspace ? trim(filter.workspace) : null;
  const under = (path: string | null | undefined): boolean => !!workspace && !!path && inside(trim(path), workspace);
  // Kept in the person's Open Artifact folder, an artifact is its project's still: the workspace may be a folder of it.
  const ofProject = (project: string | null | undefined): boolean => !!workspace && !!project && (inside(trim(project), workspace) || inside(workspace, trim(project)));
  return list.filter(
    (a) => (!filter.harness || a.owner?.harness === filter.harness) && (!workspace || under(a.owner?.workspace) || under(a.root) || ofProject(a.project)),
  );
}

/**
 * The project the list shows: the one picked, while the list still has artifacts of it; otherwise all (`null`).
 * `choices` are {@link projectChoices}'s.
 */
export function shownProject(choices: readonly ProjectChoice[], picked: string | null): string | null {
  return picked !== null && choices.some((choice) => choice.project === picked) ? picked : null;
}

/** The artifacts of one project ({@link NO_PROJECT}: those of none); all of them for `null`. */
export function inProject(list: readonly ArtifactView[], project: string | null): ArtifactView[] {
  return project === null ? [...list] : list.filter((a) => (a.project || NO_PROJECT) === project);
}

/** Pinned first, then the most recently changed. */
export function sortArtifacts(list: readonly ArtifactView[]): ArtifactView[] {
  return [...list].sort((a, b) => Number(b.pinned) - Number(a.pinned) || contentTime(b) - contentTime(a));
}

/** A type runs here and is not overridden by another of the same id. */
export function isUsable(type: TypeView): boolean {
  return type.enabled && type.runnable && !type.shadowedBy;
}

/**
 * How "New" makes an artifact of a type: `blank` opens it in its editor at once (`artifacts.create` with `blank: true`),
 * `agent` makes it as before for an agent to build (empty with the hand-over prompt, or a Page's page), `custom` (a type people made) as it always did.
 * The built-ins' groups are {@link BUILTIN_START}'s (protocol), which the Shell reads too.
 */
export type CreateGroup = 'blank' | 'agent' | 'custom';

/** The group "New" puts a type in, or `null` when the home page does not offer it. */
export function createGroupOf(type: TypeView): CreateGroup | null {
  if (!isUsable(type) || type.trusted === false) return null;
  if (type.scope === 'builtin') return builtinStartOf(type.id);
  // Offered before the groups, in any root: a Design or Page of that id stays as it was.
  if (LEGACY_CREATABLE.includes(type.id)) return 'agent';
  return CREATABLE_SCOPES.includes(type.scope) && type.runtime === 'frame' ? 'custom' : null;
}

/** The home page offers "New" for this type. */
export function isCreatable(type: TypeView): boolean {
  return createGroupOf(type) !== null;
}

/** The types "New" offers, by group, each in the order given. */
export function createGroups(types: readonly TypeView[]): Record<CreateGroup, TypeView[]> {
  const out: Record<CreateGroup, TypeView[]> = { blank: [], agent: [], custom: [] };
  for (const type of types) {
    const group = createGroupOf(type);
    if (group) out[group].push(type);
  }
  return out;
}

/** The type "New artifact" creates (Design first), or `null` when none is installed and usable. */
export function defaultCreatable(types: readonly TypeView[]): TypeView | null {
  return types.find((type) => type.id === 'design' && isCreatable(type)) ?? types.find(isCreatable) ?? null;
}

/** The badge state of an artifact's owner session. */
export function ownerBadge(owner: ArtifactView['owner']): BadgeState {
  if (!owner) return 'none';
  if (!owner.live) return 'offline';
  return owner.status === 'running' ? 'working' : 'idle';
}

/** Replaces one artifact in a list (after rename or pin), keeping the order. */
export function replaceArtifact(list: readonly ArtifactView[], next: ArtifactView): ArtifactView[] {
  return list.map((a) => (a.id === next.id ? next : a));
}

/** Removes one artifact from a list. */
export function withoutArtifact(list: readonly ArtifactView[], id: string): ArtifactView[] {
  return list.filter((a) => a.id !== id);
}

/** The host a `host_hello` makes; `null` for anything else (pure, for tests). */
export function homeHostOf(message: unknown, origin: string, declared: boolean): HomeHost | null {
  const hello = hostToShellOf(message);
  if (!hello || hello.openArtifact !== 'host_hello') return null;
  return { origin, caps: hello.caps, harness: hello.harness ?? null, agentName: hello.agentName ?? null, declared, library: hello.library ?? null };
}
