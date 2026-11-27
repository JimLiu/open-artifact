/**
 * The deck's "All comments" panel: the shared one (`@open-artifact/editor-kit`, CommentList.tsx), the window's full
 * height at the right. The editor keeps {@link COMMENTS_ROOM} free beside the stage while it is open, so the stage
 * and its corner cards narrow rather than slide under it.
 */

import type { ReactNode } from 'react';
import { ALL_COMMENTS_RIGHT, AllComments } from '@open-artifact/editor-kit/react';
import { useAgent } from '../../services/agent.ts';
import { slidesComments } from '../../services/comments.ts';

/** Where the panel starts: the same gap from the top as from the right. */
const PANEL_TOP = 12;

/** Room the open panel takes at the window's right (its width and its gap to the edge), px. */
export const COMMENTS_ROOM = ALL_COMMENTS_RIGHT - PANEL_TOP;

/** The "All comments" panel, while it is open. */
export function CommentList(): ReactNode {
  const agent = useAgent((s) => s.status);
  return (
    <AllComments
      comments={slidesComments}
      agent={{ available: agent.available, name: agent.name, wakesIdle: agent.wakesIdle }}
      top={PANEL_TOP}
      fill
      hint="Press C or the Comment button, then click the slide where you want to comment."
    />
  );
}
