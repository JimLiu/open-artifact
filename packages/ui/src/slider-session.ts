/**
 * The parts of {@link SliderInput}'s drag and reading that need no DOM:
 * which event ends a drag, the PageUp / PageDown step, and the text a
 * screen reader hears for the value.
 */

/** PageUp / PageDown (and Shift with an arrow) move ten steps. */
export function largeStepOf(step: number): number {
  return step * 10;
}

/** The events that can end a drag; the window hears them all. */
export const DRAG_ENDS = ['pointerup', 'pointercancel', 'touchend', 'touchcancel', 'blur'] as const;

/** What {@link endsDrag} reads of an event. */
export interface DragEndEvent {
  type: string;
  pointerId?: number;
}

/**
 * Whether `event` ends the drag the pointer `pointerId` started: a pointer
 * release or cancel only of that pointer, a touch end or cancel and the
 * window losing focus always.
 */
export function endsDrag(event: DragEndEvent, pointerId: number | null): boolean {
  if (event.type === 'pointerup' || event.type === 'pointercancel') return pointerId === null || event.pointerId === undefined || event.pointerId === pointerId;
  return (DRAG_ENDS as readonly string[]).includes(event.type);
}

/** How the slider's value reads out. */
export interface SliderReading {
  /** The selection holds different values: it reads "Mixed". */
  mixed?: boolean;
  /** "%": the value is a percentage, read in the language's percent format. */
  unit?: string;
  /** The language to read numbers in; the page's when not given. */
  locale?: string;
}

/** The text a screen reader hears for `value`, or null to let the slider read the number itself. */
export function sliderValueText(value: number, { mixed, unit, locale }: SliderReading = {}): string | null {
  if (mixed) return 'Mixed';
  if (unit === '%') return new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 2 }).format(value / 100);
  return null;
}
