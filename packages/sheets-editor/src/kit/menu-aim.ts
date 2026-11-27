/**
 * Aiming at a submenu that a press opened: while the pointer heads from the row toward the
 * submenu, the other rows of the menu stop taking the pointer, so crossing them on the way
 * does not move the highlight or open another submenu.
 */

export interface AimRect {
  left: number;
  right: number;
  top: number;
  bottom: number;
  width: number;
  height: number;
}

export type AimDecision = 'release' | 'wait' | 'rest';

type ExitSide = 'left' | 'right' | 'top' | 'bottom';

const AIM_BUFFER = 0.5;
/** Pointer speed, in px per ms, below which it counts as resting. */
const AIM_REST_SPEED = 0.1;
const AIM_REST_DELAY_MS = 40;

/** A pointer that makes this many moves on a row is aiming from it, not just passing. */
export const SUBMENU_AIM_MIN_MOVES = 3;
/** Moves further apart than this start a new run. */
export const SUBMENU_AIM_MOVE_GAP_MS = 100;

const ROW_SELECTOR = '[role^="menuitem"]';

/** Which side of the row the submenu sits on, or null when they overlap. */
function exitSide(row: AimRect, submenu: AimRect): ExitSide | null {
  if (submenu.left >= row.right - 1) return 'right';
  if (submenu.right <= row.left + 1) return 'left';
  if (submenu.top >= row.bottom - 1) return 'bottom';
  if (submenu.bottom <= row.top + 1) return 'top';
  return null;
}

function edgeCrosses(x: number, y: number, x1: number, y1: number, x2: number, y2: number): boolean {
  return y1 >= y !== y2 >= y && x <= ((x2 - x1) * (y - y1)) / (y2 - y1) + x1;
}

function pointInQuad(x: number, y: number, quad: readonly number[]): boolean {
  const [x1 = 0, y1 = 0, x2 = 0, y2 = 0, x3 = 0, y3 = 0, x4 = 0, y4 = 0] = quad;
  return (
    [
      edgeCrosses(x, y, x1, y1, x2, y2),
      edgeCrosses(x, y, x2, y2, x3, y3),
      edgeCrosses(x, y, x3, y3, x4, y4),
      edgeCrosses(x, y, x4, y4, x1, y1),
    ].filter(Boolean).length %
      2 ===
    1
  );
}

function pointInRect(x: number, y: number, x1: number, y1: number, x2: number, y2: number): boolean {
  return x >= Math.min(x1, x2) && x <= Math.max(x1, x2) && y >= Math.min(y1, y2) && y <= Math.max(y1, y2);
}

/**
 * Where a pointer that left the row at (`leftX`, `leftY`) and is now at (`x`, `y`) stands:
 * `wait` in the gap between row and submenu, `rest` inside the triangle toward the submenu,
 * `release` anywhere else.
 */
export function aimDecision(leftX: number, leftY: number, x: number, y: number, row: AimRect, submenu: AimRect): AimDecision {
  const side = exitSide(row, submenu);
  if (side === null) return 'release';
  if (
    (side === 'top' && leftY >= row.bottom - 1) ||
    (side === 'bottom' && leftY <= row.top + 1) ||
    (side === 'left' && leftX >= row.right - 1) ||
    (side === 'right' && leftX <= row.left + 1)
  )
    return 'release';
  const submenuWider = submenu.width > row.width;
  const submenuTaller = submenu.height > row.height;
  const left = (submenuWider ? row : submenu).left;
  const right = (submenuWider ? row : submenu).right;
  const top = (submenuTaller ? row : submenu).top;
  const bottom = (submenuTaller ? row : submenu).bottom;
  const inGap =
    side === 'top'
      ? pointInRect(x, y, left, row.top + 1, right, submenu.bottom - 1)
      : side === 'bottom'
        ? pointInRect(x, y, left, submenu.top + 1, right, row.bottom - 1)
        : side === 'left'
          ? pointInRect(x, y, submenu.right - 1, bottom, row.left + 1, top)
          : pointInRect(x, y, row.right - 1, bottom, submenu.left + 1, top);
  if (inGap) return 'wait';
  const pastMiddleX = leftX > submenu.right - submenu.width / 2;
  const pastMiddleY = leftY > submenu.bottom - submenu.height / 2;
  let quad: number[];
  if (side === 'top' || side === 'bottom') {
    const spread = submenuWider ? AIM_BUFFER / 2 : AIM_BUFFER * 4;
    const startA = submenuWider || pastMiddleX ? leftX + spread : leftX - spread;
    const startB = submenuWider ? leftX - spread : pastMiddleX ? leftX + spread : leftX - spread;
    const nearEdge = side === 'top' ? submenu.bottom - AIM_BUFFER : submenu.top + AIM_BUFFER;
    const farEdge = side === 'top' ? submenu.top : submenu.bottom;
    const startY = side === 'top' ? leftY + AIM_BUFFER + 1 : leftY - AIM_BUFFER;
    const leftEdge = pastMiddleX || submenuWider ? nearEdge : farEdge;
    const rightEdge = pastMiddleX ? (submenuWider ? nearEdge : farEdge) : nearEdge;
    quad = [startA, startY, startB, startY, submenu.left, leftEdge, submenu.right, rightEdge];
  } else {
    const spread = submenuTaller ? AIM_BUFFER / 2 : AIM_BUFFER * 4;
    const startA = submenuTaller || pastMiddleY ? leftY + spread : leftY - spread;
    const startB = submenuTaller ? leftY - spread : pastMiddleY ? leftY + spread : leftY - spread;
    const nearEdge = side === 'left' ? submenu.right - AIM_BUFFER : submenu.left + AIM_BUFFER;
    const farEdge = side === 'left' ? submenu.left : submenu.right;
    const startX = side === 'left' ? leftX + AIM_BUFFER + 1 : leftX - AIM_BUFFER;
    const topEdge = pastMiddleY || submenuTaller ? nearEdge : farEdge;
    const bottomEdge = pastMiddleY ? (submenuTaller ? nearEdge : farEdge) : nearEdge;
    quad =
      side === 'left'
        ? [topEdge, submenu.top, bottomEdge, submenu.bottom, startX, startA, startX, startB]
        : [startX, startA, startX, startB, topEdge, submenu.top, bottomEdge, submenu.bottom];
  }
  return pointInQuad(x, y, quad) ? 'rest' : 'release';
}

/** A row whose center sits inside the held row's box is covered by it, so it keeps taking the pointer. */
export function rectCenterInside(rect: AimRect, bounds: AimRect): boolean {
  const centerX = rect.left + rect.width / 2;
  const centerY = rect.top + rect.height / 2;
  return centerX > bounds.left && centerX < bounds.right && centerY > bounds.top && centerY < bounds.bottom;
}

/**
 * How many moves to count for this pointer move toward the row's total: moves within
 * `SUBMENU_AIM_MOVE_GAP_MS` of each other add up into one run.
 */
export function countAimMoves(run: { moves: number; lastAt: number }, firstAt: number, at: number, count: number): number {
  run.moves = firstAt - run.lastAt > SUBMENU_AIM_MOVE_GAP_MS ? count : run.moves + count;
  run.lastAt = at;
  return run.moves;
}

/** A click that came from a pointer press (detail 0 is a keyboard or virtual click). */
export function isPointerClick(event: Event | undefined): boolean {
  return event !== undefined && event.type === 'click' && 'detail' in event && event.detail !== 0;
}

/** Whether an open change of an already open submenu should be dropped rather than act. */
export function dropsSubmenuOpenChange(
  next: boolean,
  details: { reason: string; event: Event | undefined },
  { open, pressHidden, clickOpened }: { open: boolean; pressHidden: boolean; clickOpened: boolean },
): boolean {
  if (!next) return false;
  if (details.event?.type === 'mousedown' && pressHidden) return true;
  return open && (isPointerClick(details.event) || (details.reason === 'trigger-hover' && clickOpened));
}

export const isMouseOrPen = (event: { pointerType: string }): boolean => event.pointerType === 'mouse' || event.pointerType === 'pen';

export interface MenuAim {
  /** Starts (or refreshes) the aim from `row`, blocking the menu's other rows. */
  hold(row: HTMLElement): void;
  /** The pointer left `row`: keeps the aim while it heads for the submenu. */
  leave(event: PointerEvent, row: HTMLElement): void;
  release(): void;
}

const menuAims = new WeakMap<Element, MenuAim>();

export function createMenuAim(now?: () => number): MenuAim {
  let menu: Element | null = null;
  let heldRow: HTMLElement | null = null;
  let blocked: HTMLElement[] = [];
  let stopTracking: (() => void) | null = null;
  let stopPressWatch: (() => void) | null = null;
  const stopTrack = (): void => {
    stopTracking?.();
    stopTracking = null;
  };
  const block = (scope: Element, row: HTMLElement): void => {
    const heldRect = row.getBoundingClientRect();
    const rows = Array.from(scope.querySelectorAll<HTMLElement>(ROW_SELECTOR)).filter(
      (other) => !other.contains(row) && !row.contains(other) && !rectCenterInside(other.getBoundingClientRect(), heldRect),
    );
    const next = new Set(rows);
    for (const other of blocked) if (!next.has(other)) other.style.removeProperty('pointer-events');
    blocked = rows;
    for (const other of blocked) other.style.pointerEvents = 'none';
  };
  const release = (): void => {
    stopTrack();
    stopPressWatch?.();
    stopPressWatch = null;
    if (menu && menuAims.get(menu) === aim) {
      menuAims.delete(menu);
      for (const other of blocked) other.style.removeProperty('pointer-events');
    }
    menu = null;
    heldRow = null;
    blocked = [];
  };
  const aim: MenuAim = {
    hold(row) {
      stopTrack();
      if (heldRow === row && menu) {
        block(menu, row);
        return;
      }
      release();
      const scope = row.parentElement?.closest('[role="menu"]');
      if (!scope) return;
      menuAims.get(scope)?.release();
      menuAims.set(scope, aim);
      menu = scope;
      heldRow = row;
      block(scope, row);
      const doc = row.ownerDocument;
      const onPress = (event: PointerEvent): void => {
        if (!(event.target instanceof Node && row.contains(event.target))) release();
      };
      doc.addEventListener('pointerdown', onPress, true);
      stopPressWatch = () => doc.removeEventListener('pointerdown', onPress, true);
    },
    leave(event, row) {
      stopTrack();
      if (heldRow !== row) return;
      const controls = row.getAttribute('aria-controls');
      const submenu = controls ? row.ownerDocument.getElementById(controls) : null;
      const related = event.relatedTarget;
      if (!submenu || !row.hasAttribute('data-popup-open') || !isMouseOrPen(event) || (related instanceof Node && submenu.contains(related))) {
        release();
        return;
      }
      const { clientX: leftX, clientY: leftY } = event;
      const doc = row.ownerDocument;
      const view = doc.defaultView ?? window;
      const clock = now ?? (() => view.performance.now());
      let last: { x: number; y: number; time: number } | null = null;
      let restTimer: number | undefined;
      const slowedDown = (x: number, y: number): boolean => {
        const time = clock();
        const slow = last !== null && time > last.time && (x - last.x) ** 2 + (y - last.y) ** 2 < ((time - last.time) * AIM_REST_SPEED) ** 2;
        last = { x, y, time };
        return slow;
      };
      const decide = (x: number, y: number, first: boolean): void => {
        view.clearTimeout(restTimer);
        const decision = aimDecision(leftX, leftY, x, y, row.getBoundingClientRect(), submenu.getBoundingClientRect());
        if (decision === 'release' || (decision === 'rest' && !first && slowedDown(x, y))) release();
        else if (decision === 'rest') restTimer = view.setTimeout(release, AIM_REST_DELAY_MS);
      };
      const onMove = (move: PointerEvent): void => {
        if (!isMouseOrPen(move)) return;
        const target = move.target instanceof Node ? move.target : null;
        if (target && submenu.contains(target)) release();
        else if (target && row.contains(target)) stopTrack();
        else decide(move.clientX, move.clientY, false);
      };
      doc.addEventListener('pointermove', onMove);
      stopTracking = () => {
        view.clearTimeout(restTimer);
        doc.removeEventListener('pointermove', onMove);
      };
      decide(leftX, leftY, true);
    },
    release,
  };
  return aim;
}
