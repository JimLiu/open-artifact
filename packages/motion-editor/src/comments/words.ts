export const WHOLE_ANIMATION = 'The whole animation';
export const YOU = 'You';
export const COMMENTS_HINT = 'Click the picture to comment on that moment. R marks a stretch, Enter comments on it.';
export const RANGE_TOO_SHORT = 'That stretch is too short to comment on, so the comment is on this moment.';
export const rangeFrom = (time: string): string => `Stretch from ${time}: Enter to comment on it`;
export const LEAVE_COMMENT_MODE = 'Leave comment mode';
export const MARK_STRETCH = 'Mark the start of a stretch to comment on';
export const COMMENT_HERE = 'Comment on this moment (or the marked stretch)';
export const TOGGLE_COMMENT_MODE = 'Comment mode';
export const COMMENTS_ON_TIMELINE = 'Comments';
export const commentNumberAt = (number: number, time: string, scene: string, resolved: boolean): string =>
  `Comment ${number} at ${time}${scene.trim() === '' ? '' : `, ${scene}`}${resolved ? ', resolved' : ''}`;
export const commentOnStretch = (number: number, start: string, end: string, resolved: boolean): string =>
  `Comment ${number} on ${start}–${end}${resolved ? ', resolved' : ''}`;
export const plusCount = (count: number): string => `+${count}`;
export const moreCommentsNear = (count: number, time: string): string => (count === 1 ? `+1 comment near ${time}` : `+${count} comments near ${time}`);
export const firstCommentsNear = (time: string): string => `Back to the first comments near ${time}`;
