/** Puts Export on the toolbar. */

import { createElement } from 'react';
import { TOOLBAR_ORDER, registerToolbarItem } from '../transport/slots.ts';
import { ExportButton } from './ExportButton.tsx';
import { closeExport } from './run.ts';
import { watchScore } from './score-file.ts';

export function installExport(): () => void {
  const stops = [
    registerToolbarItem({ id: 'export', side: 'end', order: TOOLBAR_ORDER.export, render: () => createElement(ExportButton) }),
    watchScore(),
  ];
  return () => {
    closeExport();
    for (const stop of stops) stop();
  };
}
