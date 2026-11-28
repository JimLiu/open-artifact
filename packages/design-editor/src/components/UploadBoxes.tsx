/** Boxes standing in for videos being uploaded onto the canvas (services/videos.ts). */

import { useLiveCamera } from '../services/camera-frame.ts';
import { useVideoUploads } from '../services/videos.ts';

export function UploadBoxes() {
  const boxes = useVideoUploads((s) => s.boxes);
  const camera = useLiveCamera(boxes.length > 0);
  if (!boxes.length) return null;
  return (
    <>
      {boxes.map((box) => (
        <div
          key={box.id}
          data-upload-box=""
          className="pointer-events-none absolute flex items-center justify-center rounded-md border border-dashed border-accent bg-accent/10 text-[12px] text-fg-subtle"
          style={{ left: box.x * camera.zoom + camera.x, top: box.y * camera.zoom + camera.y, width: box.w * camera.zoom, height: box.h * camera.zoom }}
        >
          Uploading…
        </div>
      ))}
    </>
  );
}
