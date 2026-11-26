/** The keys that move a handle along a line: the arrows a step either way, Home and End to either limit. */
export type SliderKey = { readonly step: 1 | -1 } | { readonly to: 'min' | 'max' };

const SLIDER_KEYS = new Map<string, SliderKey>([
  ['ArrowRight', { step: 1 }],
  ['ArrowUp', { step: 1 }],
  ['ArrowLeft', { step: -1 }],
  ['ArrowDown', { step: -1 }],
  ['Home', { to: 'min' }],
  ['End', { to: 'max' }],
]);

/** What a key does to a handle, or `null` when the handle leaves the key alone. */
export const sliderKey = (key: string): SliderKey | null => SLIDER_KEYS.get(key) ?? null;
