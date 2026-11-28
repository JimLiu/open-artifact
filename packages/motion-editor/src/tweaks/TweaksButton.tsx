import type { ReactElement } from 'react';
import { Settings2 } from 'lucide-react';
import { ToolButton } from '@open-artifact/editor-kit/react';
import { togglePanel, usePanels } from '../panels/registry.ts';
import { usePopupSide } from '../transport/placement.ts';
import { useUi } from '../stores/ui.ts';
import { HIDE_PANEL, PROPERTIES, SHOW_PANEL } from './words.ts';

/** The toolbar's panel toggle: opens the side panel (Properties, and Theme for films of scenes) on the tab last used, or closes it. */
export function TweaksButton(): ReactElement {
  const open = useUi((s) => s.panel);
  const fromMenu = usePanels((s) => s.panels.some((entry) => entry.id === open && entry.fromMenu === true));
  const pressed = open !== null && !fromMenu;
  return <ToolButton label={PROPERTIES} tip={pressed ? HIDE_PANEL : SHOW_PANEL} shortcut="Mod+\" size="lg" tipSide={usePopupSide()} pressed={pressed} icon={<Settings2 />} onClick={() => togglePanel()} />;
}
