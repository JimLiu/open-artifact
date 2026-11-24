/**
 * The deck's "All comments" panel: the shared one (`@open-artifact/editor-kit`, CommentList.tsx), under the stage's
 * corner cards at the top right.
 */

import { localize } from '@open-artifact/runtime';
import type { ReactNode } from 'react';
import { AllComments } from '@open-artifact/editor-kit/react';
import { useAgent } from '../../services/agent.ts';
import { slidesComments } from '../../services/comments.ts';

/** Where the panel starts: under the corner cards (12px from the top, 40px tall, 12px gap). */
const PANEL_TOP = 64;

/** The "All comments" panel, while it is open. */
export function CommentList(): ReactNode {
  const agent = useAgent((s) => s.status);
  return (
    <AllComments
      comments={slidesComments}
      agent={{ available: agent.available, name: agent.name, wakesIdle: agent.wakesIdle }}
      top={PANEL_TOP}
      hint={localize('Press C, then click the slide where you want to comment.', '按 C 键，再点击幻灯片上要评论的位置。')}
    />
  );
}
