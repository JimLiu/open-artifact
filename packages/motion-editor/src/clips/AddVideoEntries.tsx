import type { ReactElement } from 'react';
import { Film, Trash2 } from 'lucide-react';
import { ToolButton } from '@open-artifact/editor-kit/react';
import { MenuItem } from '@open-artifact/ui';
import type { SceneMenuContext } from '../timeline/scene-menu.ts';
import { useWorking } from '../stores/working.ts';
import { addVideoAvailable, filmIsBlank, openAddVideo } from './add-video.ts';
import { AddVideoDialog } from './AddVideoDialog.tsx';
import { canRemoveVideo, removeVideo } from './remove-video.ts';
import { useFilmDocuments } from './scene-clip.ts';
import * as words from './words.ts';

/** On the toolbar of a film with nothing in it yet: add a video to start from. The dialog lives here too. */
export function AddVideoToolbar(): ReactElement {
  const documents = useFilmDocuments();
  useWorking((s) => s.readOnlyReason);
  const offer = addVideoAvailable() && filmIsBlank(documents);
  return (
    <>
      {offer ? <ToolButton label={words.ADD_VIDEO} size="lg" icon={<Film />} onClick={() => openAddVideo(null)} /> : null}
      <AddVideoDialog />
    </>
  );
}

/** In a scene's menu: add a video right after this scene. */
export function AddVideoMenuItem({ span }: SceneMenuContext): ReactElement | null {
  if (!addVideoAvailable()) return null;
  return (
    <MenuItem icon={<Film className="size-4" />} onSelect={() => openAddVideo(span.key)}>
      {words.ADD_VIDEO_AFTER}
    </MenuItem>
  );
}

/** In the menu of a scene made from a video added here: take it back out (one undo step puts it back). */
export function RemoveVideoMenuItem({ span }: SceneMenuContext): ReactElement | null {
  const documents = useFilmDocuments();
  useWorking((s) => s.readOnlyReason);
  if (!canRemoveVideo(span.key, documents)) return null;
  const sceneId = span.key;
  return (
    <MenuItem icon={<Trash2 className="size-4" />} onSelect={() => sceneId !== null && removeVideo(sceneId)}>
      {words.REMOVE_VIDEO}
    </MenuItem>
  );
}
