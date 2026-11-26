import type { ClipSoundUse } from '@open-artifact/motion-core';
import { loadFootage } from '@open-artifact/motion-audio';
import type { Footage } from '@open-artifact/motion-audio';
import { OFFLINE_DATA_ID, fromBase64, readOfflineData } from '@open-artifact/motion-stage';

/** The standalone page's video files by name: the bytes written into the page, or those of an inline `data:` address. */
function videoFiles(): Map<string, { bytes?: ArrayBuffer; url?: string }> {
  const files = new Map<string, { bytes?: ArrayBuffer; url?: string }>();
  const text = document.getElementById(OFFLINE_DATA_ID)?.textContent ?? null;
  const film = text === null ? null : readOfflineData(text);
  if (film === null || typeof film === 'string') return files;
  for (const asset of film.assets) if (asset.mime.startsWith('video/')) files.set(asset.name, asset);
  return files;
}

function inlineBytes(file: { bytes?: ArrayBuffer; url?: string }): ArrayBuffer | null {
  if (file.bytes !== undefined) return file.bytes;
  const url = file.url ?? '';
  const comma = url.indexOf(',');
  if (!url.startsWith('data:') || comma < 0 || !url.slice(0, comma).endsWith(';base64')) return null;
  try {
    return fromBase64(url.slice(comma + 1));
  } catch {
    return null;
  }
}

/** The clips' footage from the files written into the page; null when no clip sounds. */
export async function standaloneFootage(uses: readonly ClipSoundUse[]): Promise<Footage | null> {
  if (uses.length === 0) return null;
  const files = videoFiles();
  return loadFootage(uses, async (name) => {
    const file = files.get(name);
    return file === undefined ? null : inlineBytes(file);
  });
}
