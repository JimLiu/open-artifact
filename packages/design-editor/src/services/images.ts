import { escapeAttribute } from '@open-artifact/dc';
import { toast } from '@open-artifact/ui';
import { addNote, edit } from './commands.ts';
import { useDocument } from '../state/document.ts';
import { session } from './session.ts';
import { isLockedObject } from '@open-artifact/design-core';
import { refuseLocked } from './locks.ts';

/** Uploads dropped or pasted images and places them on the canvas or inside the target artboard. */
export async function placeImages(files: readonly File[], at: { x: number; y: number }, board?: string): Promise<void> {
  const { assets } = session();
  if (!assets) {
    toast.add({ title: 'Images cannot be added here', description: 'This host does not accept uploads.' });
    return;
  }
  // Nothing is dropped into a locked artboard.
  if (board && isLockedObject(useDocument.getState().canvas.boards[board])) {
    refuseLocked();
    return;
  }
  let offset = 0;
  for (const file of files) {
    if (!file.type.startsWith('image/')) continue;
    try {
      const record = await assets.upload(file, { name: file.name });
      const size = await imageSize(file);
      const scale = Math.min(1, 480 / Math.max(size.width, size.height));
      const w = Math.round(size.width * scale), h = Math.round(size.height * scale);
      const entry = board && useDocument.getState().canvas.boards[board];
      if (board && entry) {
        const x = Math.round(at.x + offset - entry.x), y = Math.round(at.y + offset - entry.y);
        const html = `<img src="${escapeAttribute(record.url)}" alt="${escapeAttribute(file.name)}" style="position:absolute;left:${x}px;top:${y}px;width:${w}px;height:${h}px;object-fit:contain">`;
        edit(board, { kind: 'insert', target: null, position: 'last-child', html }, { selectCreated: true });
      } else {
        addNote('image', { x: at.x + offset, y: at.y + offset }, { src: record.url, alt: file.name, w, h });
      }
      offset += 24;
    } catch (error) {
      toast.add({ title: `Could not upload ${file.name}`, description: error instanceof Error ? error.message : String(error) });
    }
  }
}

/** Natural size of an image file. */
function imageSize(file: Blob): Promise<{ width: number; height: number }> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      resolve({ width: image.naturalWidth || 320, height: image.naturalHeight || 240 });
      URL.revokeObjectURL(url);
    };
    image.onerror = () => {
      resolve({ width: 320, height: 240 });
      URL.revokeObjectURL(url);
    };
    image.src = url;
  });
}
