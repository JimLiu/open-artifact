/** Trimming and splitting video scenes on the timeline, adding a video from the toolbar or a scene's menu, and taking one back out. */

import { createElement } from 'react';
import { setSceneEnds } from '../timeline/lanes.ts';
import { registerSceneMenuItem } from '../timeline/scene-menu.ts';
import { registerToolbarItem } from '../transport/slots.ts';
import { closeAddVideo } from './add-video.ts';
import { AddVideoMenuItem, AddVideoToolbar, RemoveVideoMenuItem } from './AddVideoEntries.tsx';
import { SceneEnds } from './TrimHandles.tsx';

/** After the scene's name, length and speed. */
const ADD_VIDEO_MENU_ORDER = 40;
/** Right after it. */
const REMOVE_VIDEO_MENU_ORDER = 41;
/** After the playback controls and anything else added there. */
const ADD_VIDEO_TOOLBAR_ORDER = 90;

export function installClips(): () => void {
  const stops = [
    setSceneEnds((span, context, edge) => createElement(SceneEnds, { span, context, grip: edge })),
    registerToolbarItem({ id: 'add-video', side: 'start', order: ADD_VIDEO_TOOLBAR_ORDER, render: () => createElement(AddVideoToolbar) }),
    registerSceneMenuItem({ id: 'add-video', order: ADD_VIDEO_MENU_ORDER, writes: true, render: (context) => createElement(AddVideoMenuItem, context) }),
    registerSceneMenuItem({ id: 'remove-video', order: REMOVE_VIDEO_MENU_ORDER, writes: true, render: (context) => createElement(RemoveVideoMenuItem, context) }),
  ];
  return () => {
    closeAddVideo();
    for (const stop of stops) stop();
  };
}
