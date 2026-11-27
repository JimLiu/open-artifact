/**
 * Where the keyboard focus goes when the control that was just pressed takes
 * itself away (a reset or remove button whose row disappears, a banner's
 * Dismiss): somewhere near it, never back to the top of the page.
 *
 * The search runs on the page as it was at the press; after the press, the
 * first candidate still on the page gets the focus.
 */

/** The parts of a DOM element the searches walk. */
export interface LandingNode<T> {
  readonly parentElement: T | null;
  readonly children: ArrayLike<T>;
}

/** What a row search counts: a control (a button, a switch), a field (typed into), or neither. */
export type ControlKind = 'control' | 'field' | null;

/** How a panel of rows is read. */
export interface RowRules<T> {
  /** Where the search stops: the panel. */
  root: T;
  isRow(el: T): boolean;
  controlKind(el: T): ControlKind;
}

/** How the page around a dismissed thing is read. */
export interface PlaceRules<T> {
  /** Where the search stops. */
  root: T;
  /** A heading, a labelled group or a landmark. */
  isPlace(el: T): boolean;
}

/** The nearest of `el` and its ancestors (up to `root`) that passes `test`. */
function closestUpTo<T extends LandingNode<T>>(el: T, root: T, test: (el: T) => boolean): T | null {
  for (let at: T | null = el; at; at = at.parentElement) {
    if (test(at)) return at;
    if (at === root) return null;
  }
  return null;
}

/** The controls in `el` (itself included), in page order, not looking inside a control. */
function controlsIn<T extends LandingNode<T>>(el: T, rules: RowRules<T>, out: T[] = []): T[] {
  if (rules.controlKind(el)) out.push(el);
  else for (const child of Array.from(el.children)) controlsIn(child, rules, out);
  return out;
}

/**
 * The controls to land on when `pressed` goes away, alone or with its row.
 *
 * - The rest of its own row comes first: when only the control went (a reset
 *   whose value is now unset), the row is still there.
 * - Then one control per row, a button before a field, from the rows nearest
 *   it outward: at each level up, the rows inside that level, the ones before
 *   it nearest first, then the ones after, then the first loose button there.
 * - A field counts only for the first of those, and only when `fields` (a key
 *   press): a field further off, or under a pointer, would take the keys the
 *   person meant for the stage.
 */
export function rowLandingCandidates<T extends LandingNode<T>>(pressed: T, rules: RowRules<T>, fields: boolean): T[] {
  const row = closestUpTo(pressed, rules.root, rules.isRow);
  const from = row ?? pressed;
  if (from === rules.root) return [];
  const out: T[] = [];
  const seen = new Set<T>([pressed]);
  const add = (control: T | undefined): void => {
    if (control === undefined || seen.has(control)) return;
    seen.add(control);
    out.push(control);
  };
  if (row) for (const control of controlsIn(row, rules)) add(control);
  const own = out.length;
  const pick = (other: T): T | undefined => {
    const controls = controlsIn(other, rules);
    const button = controls.find((c) => rules.controlKind(c) === 'control');
    return button ?? (fields && out.length === own ? controls.find((c) => rules.controlKind(c) === 'field') : undefined);
  };
  for (let parent = from.parentElement; parent; parent = parent === rules.root ? null : parent.parentElement) {
    const before: T[] = [];
    const after: T[] = [];
    let passed = false;
    let loose: T | undefined;
    const walk = (el: T): void => {
      if (el === from) {
        passed = true;
        return;
      }
      if (rules.isRow(el)) {
        (passed ? after : before).push(el);
        return;
      }
      const kind = rules.controlKind(el);
      if (kind === 'control' && loose === undefined) loose = el;
      if (kind) return;
      for (const child of Array.from(el.children)) walk(child);
    };
    for (const child of Array.from(parent.children)) walk(child);
    for (const other of [...before.reverse(), ...after]) add(pick(other));
    add(loose);
  }
  return out;
}

/**
 * The places to land on when `pressed` goes away with what holds it: a
 * heading, labelled group or landmark before it, then one after it, then an
 * enclosing one, one level out at a time.
 */
export function placeLandingCandidates<T extends LandingNode<T>>(pressed: T, rules: PlaceRules<T>): T[] {
  const out: T[] = [];
  const find = (el: T, last: boolean): T | null => {
    if (rules.isPlace(el)) return el;
    const children = Array.from(el.children);
    if (last) children.reverse();
    for (const child of children) {
      const hit = find(child, last);
      if (hit) return hit;
    }
    return null;
  };
  for (let at: T = pressed; at !== rules.root && at.parentElement; at = at.parentElement) {
    const parent: T = at.parentElement;
    const all = Array.from(parent.children);
    const index = all.indexOf(at);
    for (const before of all.slice(0, index).reverse()) {
      const hit = find(before, true);
      if (hit) out.push(hit);
    }
    for (const after of all.slice(index + 1)) {
      const hit = find(after, false);
      if (hit) out.push(hit);
    }
    if (parent !== rules.root && rules.isPlace(parent)) out.push(parent);
  }
  return [...new Set(out)];
}

/* ------------------------------ on the page ------------------------------ */

const CONTROL = 'button, a[href], [role="button"], [role="switch"], [role="checkbox"], [role="radio"], [role="combobox"], [role="slider"], [role="tab"]';
const FIELD = 'input, textarea, select, [contenteditable="true"]';
const PLACE = 'h1, h2, h3, h4, h5, h6, [role="heading"], main, nav, aside, [role="main"], [role="navigation"], [role="complementary"], [role="region"][aria-label], [role="group"][aria-label], section[aria-label], fieldset';

/** Marks a properties row for the search. */
export const ROW_ATTRIBUTE = 'data-open-artifact-row';
/** A row's reset or remove button: never landed on, since a second press would reset or remove the next row too. */
export const NO_LANDING_ATTRIBUTE = 'data-open-artifact-no-landing';

/** Props marking a properties row, and a button never landed on. */
export const ROW_MARK = { [ROW_ATTRIBUTE]: '' } as const;
export const NO_LANDING_MARK = { [NO_LANDING_ATTRIBUTE]: '' } as const;

/** True when `el` is on the page, shown, and can take the focus. */
function canLand(el: HTMLElement): boolean {
  if (!el.isConnected || el.closest('[inert], [hidden], [aria-hidden="true"]')) return false;
  if ((el as HTMLButtonElement).disabled || el.getAttribute('aria-disabled') === 'true') return false;
  return el.getClientRects().length > 0;
}

/** Focuses `el`; one that takes no focus of its own borrows a `tabindex` until it loses it. */
function land(el: HTMLElement): boolean {
  if (!el.matches(`${CONTROL}, ${FIELD}, [tabindex]`)) {
    el.setAttribute('tabindex', '-1');
    el.addEventListener('blur', () => el.removeAttribute('tabindex'), { once: true });
    el.focus({ preventScroll: true });
  } else {
    el.focus();
  }
  return el.ownerDocument.activeElement === el;
}

/** How long a press is watched for its control to go (state settles in a frame or two). */
const WATCH_MS = 400;

/**
 * After a press of `pressed`, waits for it to leave the page; when it has
 * and the focus fell to the page itself, focuses the first of `candidates`
 * that is still there. A key held down for the press does not repeat onto
 * the control focused in its place.
 */
export function landFocusAfter(pressed: HTMLElement, candidates: readonly HTMLElement[], byKeyboard: boolean): void {
  const doc = pressed.ownerDocument;
  const view = doc.defaultView;
  if (!view || candidates.length === 0) return;
  const until = view.performance.now() + WATCH_MS;
  const check = (): void => {
    if (canLand(pressed)) {
      if (view.performance.now() < until) view.requestAnimationFrame(check);
      return;
    }
    const active = doc.activeElement;
    if (active && active !== doc.body && active !== doc.documentElement) return;
    const target = candidates.find(canLand);
    if (!target || !land(target) || !byKeyboard) return;
    const swallow = (event: KeyboardEvent): void => {
      if (!event.repeat) return;
      event.preventDefault();
      event.stopPropagation();
    };
    view.addEventListener('keydown', swallow, true);
    view.addEventListener('keyup', () => view.removeEventListener('keydown', swallow, true), { capture: true, once: true });
  };
  view.requestAnimationFrame(check);
}

/** The pressed control a click landed on, inside `within`. */
function pressedControl(event: MouseEvent, within: Element): HTMLElement | null {
  const target = event.target instanceof Element ? event.target.closest<HTMLElement>(CONTROL) : null;
  return target && within.contains(target) ? target : null;
}

/** A click on a control in a properties row: if the row goes, the focus moves to the nearest row's control. */
export function landAfterRowPress(event: MouseEvent, panel: HTMLElement): void {
  const pressed = pressedControl(event, panel);
  if (!pressed) return;
  const byKeyboard = event.detail === 0;
  const candidates = rowLandingCandidates<Element>(
    pressed,
    {
      root: panel,
      isRow: (el) => el.hasAttribute(ROW_ATTRIBUTE),
      controlKind: (el) => (el.hasAttribute(NO_LANDING_ATTRIBUTE) || el.matches(':disabled, [tabindex="-1"]') ? null : el.matches(CONTROL) ? 'control' : el.matches(FIELD) ? 'field' : null),
    },
    byKeyboard,
  );
  landFocusAfter(pressed, candidates as HTMLElement[], byKeyboard);
}

/** When `pressed` goes away with what holds it, the focus moves to a heading or landmark nearby. */
export function landAfterDismiss(pressed: HTMLElement, byKeyboard: boolean): void {
  const candidates = placeLandingCandidates<Element>(pressed, { root: pressed.ownerDocument.body, isPlace: (el) => el.matches(PLACE) });
  landFocusAfter(pressed, candidates as HTMLElement[], byKeyboard);
}

/** A click on a control that may take itself away (a Dismiss): the focus moves to a heading or landmark nearby. */
export function landAfterDismissPress(event: MouseEvent, within: HTMLElement): void {
  const pressed = pressedControl(event, within);
  if (pressed) landAfterDismiss(pressed, event.detail === 0);
}
