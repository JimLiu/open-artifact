/**
 * The formats the Export tab lists for a board: the PNG and the board file
 * always (disabled while the board is empty), and while the board has a
 * flowing arrow the animated GIF and the MP4 video (disabled, with the
 * reason, in a browser that cannot encode video).
 */

/** One row of the Export tab, as the Shell reads it. */
export interface BoardExportFormat {
  format: string;
  label: string;
  disabled?: boolean;
  why?: 'other';
  /** Why it is disabled, in plain words (at most 160 characters). */
  disabledReason?: string;
}

/** Whether this browser encodes video: not known until it has been asked. */
export type VideoSupport = 'unknown' | 'yes' | 'no';

/** Why the MP4 row is disabled in a browser without a video encoder. */
export const NO_VIDEO_ENCODER_REASON = 'This browser cannot make videos. Try a recent Chrome, Edge or Safari, or export an animated GIF.';

/** What the Export tab lists for a board in this state. */
export function boardExportFormats(state: { empty: boolean; flows: boolean; video: VideoSupport }): BoardExportFormat[] {
  const disabled = state.empty ? { disabled: true, why: 'other' as const } : {};
  return [
    { format: 'png', label: 'PNG image', ...disabled },
    ...(state.flows
      ? [
          { format: 'gif', label: 'Animated GIF' },
          { format: 'mp4', label: 'MP4 video', ...(state.video === 'no' ? { disabled: true, disabledReason: NO_VIDEO_ENCODER_REASON } : {}) },
        ]
      : []),
    { format: 'json', label: 'Board file', ...disabled },
  ];
}
