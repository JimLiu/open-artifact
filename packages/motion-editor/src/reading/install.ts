import { createElement } from 'react';
import { registerPanel } from '../panels/registry.ts';
import { useUi } from '../stores/ui.ts';
import { MORE_GROUP, registerMoreItem } from '../transport/more.ts';
import { startDescribeAloud } from './describe-aloud.ts';
import { DescribeAloudRow, ReadAsTextRow } from './MoreRows.tsx';
import { READ_PANEL } from './panel-id.ts';
import { ReadAsTextPanel } from './ReadAsTextPanel.tsx';
import { startFilmTextReader } from './reader.ts';
import { READ_AS_TEXT } from './words.ts';

/**
 * Read as text closed while the focus was in it: once the panel is gone, the focus goes back to the More button it
 * was opened from (unless something else took it meanwhile).
 */
function focusBackOnClose(): () => void {
  let frame = 0;
  const stop = useUi.subscribe((state, before) => {
    if (before.panel !== READ_PANEL || state.panel === READ_PANEL) return;
    const active = document.activeElement;
    const inPanel = active !== null && active.closest('[data-video-panel]') !== null;
    if (!inPanel && active !== null && active !== document.body) return;
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      const now = document.activeElement;
      if (now !== null && now !== document.body && now.isConnected) return;
      document.querySelector<HTMLElement>('[data-video-more]')?.focus();
    });
  });
  return () => {
    cancelAnimationFrame(frame);
    stop();
  };
}

/** The film as text: the Read as text panel, the background reading of each scene's words, and Describe scenes aloud. */
export function installReading(): () => void {
  const stops = [
    registerPanel({ id: READ_PANEL, label: READ_AS_TEXT, order: 90, fromMenu: true, render: () => createElement(ReadAsTextPanel) }),
    registerMoreItem({ id: 'read-as-text', group: MORE_GROUP.reading, order: 10, render: () => createElement(ReadAsTextRow) }),
    registerMoreItem({ id: 'describe-aloud', group: MORE_GROUP.reading, order: 20, render: () => createElement(DescribeAloudRow) }),
    startFilmTextReader(),
    startDescribeAloud(),
    focusBackOnClose(),
  ];
  return () => {
    for (const stop of stops.reverse()) stop();
  };
}
