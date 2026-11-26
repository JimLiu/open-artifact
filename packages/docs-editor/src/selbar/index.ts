/** The selection toolbar and the link box: drawn over the text, answering Mod-k, Alt-Enter and Mod-Alt-l. */
import { Link } from 'lucide-react';
import { provideAction } from '../app/actions.ts';
import { provideSelectionAction } from '../app/selection-actions.ts';
import { fillSlot } from '../app/slots.ts';
import { addEditorExtension } from '../editor/DocEditor.tsx';
import { useEditor } from '../editor/format.ts';
import { LinkPopover } from './LinkPopover.tsx';
import { closeLink, handleLinkClick, openLinkAtCursor, startLinkEdit } from './links.ts';
import { followAddressOnce } from './navigate.ts';
import { copyPlaceLink } from './place-link.ts';
import { washPlugin } from './place-wash.ts';
import './place-wash.css';
import { SelectionToolbar } from './SelectionToolbar.tsx';
import { watchPlugin } from './watch.ts';

addEditorExtension({ plugins: () => [watchPlugin({ onLinkClick: handleLinkClick }), washPlugin()] });

fillSlot('layer', 'selection-toolbar', SelectionToolbar, 10);
fillSlot('layer', 'link-box', LinkPopover, 11);

provideAction('link', startLinkEdit);
provideAction('openLink', openLinkAtCursor);
provideAction('copyPlaceLink', copyPlaceLink);

provideSelectionAction('copyLink', {
  label: 'Copy link to selection',
  shortcut: 'Mod-Alt-l',
  icon: Link,
  available: () => !!useEditor.getState().tab,
  run: () => void copyPlaceLink(),
});

// A box open on one tab's text closes when another tab is shown.
useEditor.subscribe((state, before) => {
  if (state.view !== before.view) closeLink();
});

followAddressOnce();
