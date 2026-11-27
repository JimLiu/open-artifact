/**
 * A wheel turned over a focused `<input type="number">` steps its value (in
 * browsers other than Safari), and the browser also slides the text sideways
 * inside the box, so the number seems to jump. {@link holdNumberTextOnWheel}
 * puts the text back where it was on the next frame. While it waits, the input
 * carries {@link NUMBER_WHEELING_ATTR}, which hides the spin buttons (their
 * width is what the text slides by).
 */

/** Set on a number input from a wheel turn until the frame after it. */
export const NUMBER_WHEELING_ATTR = 'data-ui-wheeling';

/** The parts of an input the wheel fix uses (an `HTMLInputElement` has them). */
export interface WheelNumberInput {
  type: string;
  scrollLeft: number;
  matches(selector: string): boolean;
  hasAttribute(name: string): boolean;
  setAttribute(name: string, value: string): void;
  removeAttribute(name: string): void;
  ownerDocument: { defaultView: { requestAnimationFrame(run: () => void): unknown; navigator: { vendor: string } } | null };
}

/** True in Safari and other WebKit browsers made by Apple: a wheel there does not step a number input. */
function wheelLeavesNumbers(view: { navigator: { vendor: string } }): boolean {
  return /Apple Computer/.test(view.navigator.vendor);
}

/** Call from a number input's wheel handler: keeps its text from sliding sideways while the wheel steps the value. */
export function holdNumberTextOnWheel(input: WheelNumberInput): void {
  const view = input.ownerDocument.defaultView;
  if (!view || input.type !== 'number' || wheelLeavesNumbers(view) || !input.matches(':focus') || input.hasAttribute(NUMBER_WHEELING_ATTR)) return;
  const was = input.scrollLeft;
  input.setAttribute(NUMBER_WHEELING_ATTR, '');
  const slid = was - input.scrollLeft;
  view.requestAnimationFrame(() => {
    input.removeAttribute(NUMBER_WHEELING_ATTR);
    input.scrollLeft += slid;
  });
}
