/**
 * `open-artifact://` links and what a start asks to open.
 *
 * The only link the app takes is `open-artifact://artifact/<id>`, with an id `idArg` accepts (`library.ts`); any
 * other form (another host, a path or query after the id, a Shell address, a type link) is refused: the caller logs
 * it and does nothing. Links come from three places: a start's arguments, macOS's `open-url` event (which may come
 * before the app is ready), and a second start's arguments, which the single-instance lock hands to the app running.
 *
 * The app never registers itself for the scheme: not in a development or test run (no `setAsDefaultProtocolClient`,
 * no `lsregister`), and a package declares it in its `Info.plist` only when asked (`scripts/info-plist.ts`).
 *
 * Pure functions: the tests check them without Electron.
 */
import { idArg } from './library.ts';

/** The scheme. */
export const SCHEME = 'open-artifact';
/** The longest link looked at. */
const LINK_MAX = 300;

/** The artifact id of `open-artifact://artifact/<id>`, or null for anything else. */
export function linkedArtifact(url: unknown) {
  if (typeof url !== 'string' || url.length > LINK_MAX) return null;
  const match = /^open-artifact:\/\/artifact\/([^/?#\s]+)$/i.exec(url);
  if (!match) return null;
  try {
    return idArg(match[1]);
  } catch {
    return null;
  }
}

/** Whether an argument is meant as a link of the scheme (to be taken or refused). */
export const isLink = (value: unknown) => typeof value === 'string' && value.toLowerCase().startsWith(`${SCHEME}:`);

/**
 * What a start's arguments ask to open, in order: each `--open <ref>` (an id, a link, a Shell address; a link is
 * checked as `linkedArtifact` checks it) and each bare `open-artifact:` argument. `refused`: the links that are not of
 * the one accepted form.
 */
export function opensOf(argv: readonly string[] | undefined) {
  const list = Array.isArray(argv) ? argv.filter((arg: unknown): arg is string => typeof arg === 'string') : [];
  const refs: string[] = [];
  const refused: string[] = [];
  const take = (value: string) => {
    if (!isLink(value)) return refs.push(value);
    const id = linkedArtifact(value);
    if (id) refs.push(id);
    else refused.push(value);
  };
  const opens = new Set();
  for (let i = 0; i < list.length; i++) {
    if (list[i] === '--open' && i + 1 < list.length) {
      opens.add(i + 1);
      i++;
    }
  }
  for (let i = 0; i < list.length; i++) {
    const arg = list[i];
    if (opens.has(i)) take(arg);
    else if (arg.startsWith('--open=')) take(arg.slice('--open='.length));
    else if (isLink(arg)) take(arg);
  }
  return { refs, refused };
}
