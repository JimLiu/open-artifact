/**
 * Adds the Theme tab (Palette and Font) beside Properties for films made of scenes. Returns a function that takes it
 * away.
 */

import { createElement } from 'react';
import runtime from 'virtual:motion-stage-runtime';
import { filmEngine } from '../engine/engine-context.ts';
import { registerPanel } from '../panels/registry.ts';
import { TOOLBAR_ORDER } from '../transport/slots.ts';
import { watchFontFallbacks } from './font-fallbacks.ts';
import { watchPalettePicks } from './palette-actions.ts';
import { startPreviewStage } from './probe-runner.ts';
import { reportMissingFonts, resetStyle } from './store.ts';
import { STYLE_PANEL_ID, showsStyle } from './style-ids.ts';
import { StylePanel } from './StylePanel.tsx';
import { THEME_LABEL } from './words.ts';

export { takeAllFontsBack } from './font-actions.ts';
export { takeAllPaletteBack } from './palette-actions.ts';
export type { TakeBack } from './record-io.ts';

export function installStyle(): () => void {
  const stops = [
    startPreviewStage(runtime),
    watchPalettePicks(),
    watchFontFallbacks(),
    filmEngine()?.onFilmLoad((load) => reportMissingFonts(load.missingFonts)) ?? (() => undefined),
    registerPanel({
      id: STYLE_PANEL_ID,
      label: THEME_LABEL,
      keepMounted: true,
      order: TOOLBAR_ORDER.style,
      when: showsStyle,
      render: () => createElement(StylePanel),
    }),
  ];
  return () => {
    for (const stop of stops.reverse()) stop();
    resetStyle();
  };
}
