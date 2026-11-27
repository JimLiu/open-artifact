/**
 * What going to an element of the board shows (`services/navigation.ts`):
 *
 * - {@link JumpFlash}: a ring around the element the view arrived at,
 *   fading out after a moment, so the eye finds it;
 * - {@link JumpBack}: a small pill above the tool bar while there is a view
 *   to return to. Back glides there; × forgets it and stays.
 */

import { ArrowLeft, X } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { boardToScreen } from '../lib/camera.ts';
import { clearJumpBack, contentBounds, JUMP_FLASH_MS, jumpBack } from '../services/navigation.ts';
import { useBoard } from '../state/board.ts';
import { useCamera } from '../state/camera.ts';
import { useJump } from '../state/jump.ts';
import { useMeasures } from '../state/measures.ts';
import { Card, ChromeButton, Tip } from './chrome.tsx';

/** Room between the element and its ring, screen pixels. */
const FLASH_GAP_PX = 6;

/** The ring around the element the view just went to (screen-space overlay). */
export function JumpFlash() {
  const flash = useJump((state) => state.flash);
  const element = useBoard((state) => (flash === null ? undefined : state.byId.get(flash.id)));
  const camera = useCamera((state) => state.camera);
  const measures = useMeasures((state) => state.measures);
  const ring = useRef<HTMLDivElement>(null);
  const serial = flash?.serial;
  useEffect(() => {
    if (serial === undefined) return;
    ring.current?.animate?.([{ opacity: 0 }, { opacity: 1, offset: 0.12 }, { opacity: 1, offset: 0.65 }, { opacity: 0 }], { duration: JUMP_FLASH_MS, easing: 'ease-out', fill: 'forwards' });
  }, [serial]);
  const box = element === undefined ? undefined : contentBounds([element], measures);
  if (flash === null || box === undefined) return null;
  const from = boardToScreen(camera, { x: box.x, y: box.y });
  const to = boardToScreen(camera, { x: box.x + box.w, y: box.y + box.h });
  return (
    <div
      ref={ring}
      aria-hidden="true"
      data-wb-jump-flash={flash.id}
      className="pointer-events-none absolute rounded-[10px]"
      style={{
        left: from.x - FLASH_GAP_PX,
        top: from.y - FLASH_GAP_PX,
        width: to.x - from.x + 2 * FLASH_GAP_PX,
        height: to.y - from.y + 2 * FLASH_GAP_PX,
        border: '2px solid var(--color-chrome-accent)',
        boxShadow: '0 0 0 4px color-mix(in srgb, var(--color-chrome-accent) 22%, transparent)',
      }}
    />
  );
}

/** Back to the view the viewer went from, while there is one. */
export function JumpBack() {
  const count = useJump((state) => state.back.length);
  if (count === 0) return null;
  return (
    <Card role="group" aria-label="Back to the earlier view" data-wb-jump-back="" className="wb-jump-back">
      <Tip label="Back to where you were" side="top">
        <ChromeButton size="lg" className="gap-1.5 px-2.5" onClick={() => jumpBack()}>
          <ArrowLeft aria-hidden="true" />
          Back
        </ChromeButton>
      </Tip>
      <Tip label="Stay here" side="top">
        <ChromeButton size="lg" square aria-label="Stay here" onClick={() => clearJumpBack()}>
          <X aria-hidden="true" />
        </ChromeButton>
      </Tip>
    </Card>
  );
}
