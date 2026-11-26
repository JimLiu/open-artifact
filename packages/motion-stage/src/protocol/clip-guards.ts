import { MAX_SOUNDING_CLIPS } from '@open-artifact/motion-core';
import type { ClipSoundUse } from '@open-artifact/motion-core';

const isFinite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

/** A clip's sound as 'ready' reports it, within what any film may ask: a level 0–1, times and rates finite and above 0 where they must be. */
export function isClipSoundUse(value: unknown): value is ClipSoundUse {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const use = value as Record<string, unknown>;
  return (
    typeof use['name'] === 'string' &&
    typeof use['loop'] === 'boolean' &&
    isFinite(use['level']) &&
    use['level'] > 0 &&
    use['level'] <= 1 &&
    isFinite(use['at']) &&
    isFinite(use['dur']) &&
    use['dur'] > 0 &&
    isFinite(use['second']) &&
    use['second'] >= 0 &&
    isFinite(use['rate']) &&
    use['rate'] > 0
  );
}

/** The clips that sound: absent, or a list of at most a film's share of each scene part's uses. */
export const isClipSoundList = (value: unknown): value is ClipSoundUse[] =>
  Array.isArray(value) && value.length <= MAX_SOUNDING_CLIPS * 32 && value.every(isClipSoundUse);
