/**
 * Fitting a web page under the download limit by making its inlined files
 * smaller. The choices are kept apart from the encoding so they can be
 * tested: which pictures to shrink, in what order, to which step, and when
 * to stop.
 */

/** Smallest inlined picture worth shrinking, in bytes of its `data:` URL. */
export const MIN_SHRINK_BYTES = 128 * 1024;

/** A file written into the page as a `data:` URL. */
export interface InlinedFile {
  /** Bytes of its `data:` URL. */
  bytes: number;
  /** Times the page writes it. */
  uses: number;
}

/** The steps below the one a quality starts at (null: pictures as they are, so every step). */
export function stepsBelow(start: number | null, count: number): number[] {
  const first = start === null ? 0 : start + 1;
  return Array.from({ length: Math.max(0, count - first) }, (_, i) => first + i);
}

/**
 * Shrinks pictures until the page saves at least `mustSave` bytes. Step by
 * step (sharpest first), the pictures taking the most room in the page
 * (bytes times uses, as they are now) go first; each is encoded at the step
 * with `encode` (null when it cannot be) and kept when that is smaller than
 * what it is now. Stops as soon as enough is saved. Returns each shrunk
 * picture's smallest encoding, or null when even every step cannot save
 * enough (nothing should change then). Pictures under `minBytes` are left
 * as they are.
 */
export async function shrinkToFit<C extends InlinedFile, R extends { bytes: number }>(
  pictures: readonly C[],
  steps: readonly number[],
  mustSave: number,
  encode: (picture: C, step: number) => Promise<R | null>,
  minBytes = MIN_SHRINK_BYTES,
): Promise<Map<C, R> | null> {
  const kept = new Map<C, R>();
  if (mustSave <= 0) return kept;
  const now = (picture: C): number => kept.get(picture)?.bytes ?? picture.bytes;
  const candidates = pictures.filter((picture) => picture.uses > 0 && picture.bytes >= minBytes);
  let saved = 0;
  for (const step of steps) {
    candidates.sort((a, b) => now(b) * b.uses - now(a) * a.uses);
    for (const picture of candidates) {
      if (saved >= mustSave) return kept;
      const smaller = await encode(picture, step);
      if (smaller && smaller.bytes < now(picture)) {
        saved += (now(picture) - smaller.bytes) * picture.uses;
        kept.set(picture, smaller);
      }
    }
    if (saved >= mustSave) return kept;
  }
  return null;
}

/**
 * The files to link instead of inlining when shrinking cannot fit the page:
 * the ones taking the most room first, until at least `mustSave` bytes are
 * saved. `linkBytes` is what a file's link takes instead. Every file when
 * even that is not enough.
 */
export function linkToFit<C extends InlinedFile>(files: readonly C[], mustSave: number, linkBytes: (file: C) => number): C[] {
  const picked: C[] = [];
  if (mustSave <= 0) return picked;
  let saved = 0;
  for (const file of [...files].filter((file) => file.uses > 0).sort((a, b) => b.bytes * b.uses - a.bytes * a.uses)) {
    if (saved >= mustSave) break;
    picked.push(file);
    saved += Math.max(0, file.bytes - linkBytes(file)) * file.uses;
  }
  return picked;
}

/** The note for pictures made smaller to fit. */
export function picturesShrunkNote(count: number): string {
  return `${count} ${count === 1 ? 'picture was' : 'pictures were'} made smaller so the file fits the 200 MB download limit.`;
}
