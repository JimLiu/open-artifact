const seconds = (value: number): string => String(Math.round(value * 10) / 10);

// Trimming and splitting a video scene.
export const TRIM = 'Trim';
export const SPLIT = 'Split';
export const START = 'Start';
export const END = 'End';
export const SECONDS_UNIT = 's';
export const trimStartOf = (name: string, number: number): string => `Start of ${name}, scene ${number}`;
export const trimEndOf = (name: string, number: number): string => `End of ${name}, scene ${number}`;
export const intoVideo = (second: number): string => `${seconds(second)} seconds into the video`;
export const tipSeconds = (second: number): string => `${seconds(second)} s`;
export const DRAG_TO_TRIM = 'Drag, or press the arrow keys, to trim the scene';
export const TRIMMED_STAYS = 'Trimmed parts stay in the video file.';
export const TRIM_NOTE = 'Trimmed parts stay in the video file. Anyone who can open this animation, or a copy of it, can download that file.';
export const trimStartField = 'Start in the video';
export const trimEndField = 'End in the video';
export const sceneTrimmed = (number: number): string => `Scene ${number} trimmed`;
export const TRIM_STALE = 'This scene was edited after that trim, so nothing changed. You can drag its ends to trim it again.';
export const SPLIT_STALE = 'This scene was edited after that split, so nothing changed.';
export const UNDO_WHILE_WORKING = (agent: string): string => `Undo is off while ${agent} is working.`;
export const REDO_WHILE_WORKING = (agent: string): string => `Redo is off while ${agent} is working.`;
export const TRIM_TOO_LONG = 'That would take the animation past its longest length.';
export const TRIM_PAST_END = 'The video ends before that.';
export const NOT_WRITTEN = 'Couldn’t save that change. Try again.';
export const SPLIT_AT_PLAYHEAD = 'Split at playhead';
export const SPLIT_HINT = 'Cuts this scene in two at the playhead. You can also press S when a trim handle has focus.';
export const SPLIT_DONE = 'Scene split in two';
export const SPLIT_PLACE = 'Put the playhead in this scene, at least half a second from either end.';
export const SPLIT_WAIT = 'Still updating the animation. Try again in a moment.';
export const SPLIT_LOOKS = 'This scene has colors, sizes, or text styles you set yourself, so it can’t be split.';
export const SPLIT_BARE = 'This scene shows more than its video, so it can’t be split.';
export const SPLIT_OTHER = 'This scene can’t be split.';

// Adding a video from a file.
export const ADD_VIDEO = 'Add video';
export const ADD_VIDEO_AFTER = 'Add video after this scene';
export const ADD = 'Add';
export const CANCEL = 'Cancel';
export const DONE = 'Done';
export const CHOOSE_FILE = 'Choose a video file';
export const DROP_HERE = 'Drop a video here, or choose a file.';
export const READING = 'Reading the video…';
export const PREPARING = 'Preparing the video…';
export const SAVING = 'Saving…';
export const PLAY_PART = 'Play the part';
export const PAUSE_PART = 'Pause';
export const PART_START = 'Start of the part';
export const PART_END = 'End of the part';
export const PART_STRIP = 'The video, with the part to add';
export const partNote = (part: number, total: number, longest: number): string =>
  `This part is ${seconds(part)} s of the video’s ${seconds(total)} s. Only this part is stored, and it can be up to ${seconds(longest)} s long.`;
export const RIGHTS_NOTE = 'Only add video you have the rights to.';
export const addedAs = (scene: number): string => `Added as scene ${scene}.`;
export const addedToBlank = (agent: string): string => `Your video is in. Ask ${agent} to make an animation around it, or add more.`;
export const videoAddedAs = (scene: number): string => `Video added as scene ${scene}`;
export const askFit = (agent: string): string => `Ask ${agent} to fit it in`;
export const ADD_VIDEO_STALE = 'The animation changed after that video was added, so nothing changed.';
export const NOT_A_VIDEO = 'That file isn’t a video this page can read. Try an MP4 or a MOV.';
export const CANT_READ = 'This browser can’t read that video. You can convert it to MP4 or try another browser.';
export const CANT_PREPARE = 'This browser can’t prepare videos for an animation. Try another browser.';
export const TOO_LONG_TO_STORE = 'That part is too long to store. Pick a shorter part.';
export const COULDNT_ADD = 'Couldn’t add the video. Try again.';
export const AGENT_WORKING = (agent: string): string => `You can add a video once ${agent} has finished.`;
export const NO_ROOM_FILES = 'This animation has as many files as it can hold, so no video can be added.';
export const NO_ROOM_SCENES = 'This animation has as many scenes as it can hold, so no video can be added.';
export const NO_ROOM_LENGTH = 'This animation is as long as it can be, so no video can be added.';
export const NO_ROOM_VIDEOS = 'This animation has as many added videos as it can hold.';
export const NOT_SCENES = 'Videos can be added only to an animation made of scenes.';

// Taking an added video back out.
export const REMOVE_VIDEO = 'Remove video';
export const VIDEO_REMOVED = 'Video removed';
export const NO_ROOM_TO_PUT_BACK = 'This animation has no room left for that video, so it can’t go back in. Make room, then undo again.';
export const REMOVE_STALE = 'That scene changed since, so nothing changed.';
export const REMOVE_WHILE_ADDING = 'A video is still being added. Try again once it’s in.';
