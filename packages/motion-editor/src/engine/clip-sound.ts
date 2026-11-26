/**
 * The video clips' own sound. The stage says, when it is ready, which clips sound and where on the play clock; their
 * files are decoded here and every sound input given to the player from then on carries the footage with it.
 */

import { loadFootage, type FilmSoundInput, type Footage } from '@open-artifact/motion-audio';
import type { ReadyMessage } from './stage-controller.ts';
import type { SoundLoad } from './sound.ts';

/**
 * Wraps `give` so the inputs it passes on carry the clips' footage: the input given last is given again once the
 * footage is decoded, and each one after it carries it too. A film whose clips are silent passes inputs as they are.
 */
export function withClipSound(give: (input: FilmSoundInput) => void, ready: ReadyMessage, load: SoundLoad): (input: FilmSoundInput) => void {
  const uses = ready.clips ?? [];
  if (uses.length === 0) return give;
  let last: FilmSoundInput | null = null;
  let footage: Footage | null = null;
  const bytesOf = async (name: string): Promise<ArrayBuffer | null> => {
    const asset = load.assets.find((each) => each.name === name);
    return asset === undefined ? null : load.bytes(asset.ref);
  };
  loadFootage(uses, bytesOf, { isCurrent: load.isCurrent })
    .then((found) => {
      if (found === null || !load.isCurrent()) return;
      footage = found;
      if (last !== null) give({ ...last, footage });
    })
    .catch((error: unknown) => console.warn('video: the clips\' sound could not be prepared', error));
  return (input) => {
    last = input;
    give(footage === null ? input : { ...input, footage });
  };
}
