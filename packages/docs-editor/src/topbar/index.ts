/** The top bar's controls: Export and More, the keyboard shortcuts sheet, and ⌘/ or ? to open it. */
import { isTextField } from '@open-artifact/editor-kit';
import { isComposingKey } from '@open-artifact/ui/keys';
import { provideAction } from '../app/actions.ts';
import { fillSlot } from '../app/slots.ts';
import { getDocs, setDocs } from '../app/store.ts';
import { ExportMenu } from './ExportMenu.tsx';
import { MoreMenu } from './MoreMenu.tsx';
import { ShortcutsDialog, toggleShortcuts } from './ShortcutsDialog.tsx';

fillSlot('topBar', 'export', ExportMenu, 80);
fillSlot('topBar', 'more', MoreMenu, 90);
fillSlot('overlay', 'shortcuts', ShortcutsDialog);
provideAction('shortcuts', toggleShortcuts);

const inPopup = (target: EventTarget | null) => target instanceof Element && target.closest('[role="dialog"],[role="alertdialog"],[role="menu"],[role="listbox"]') !== null;

// The editor answers ⌘/ while the text has the keyboard; this covers the rest of the page.
window.addEventListener('keydown', event => {
  if (event.defaultPrevented || isComposingKey(event) || event.altKey) return;
  const mod = event.metaKey || event.ctrlKey;
  if (mod && event.key === '/' && !event.shiftKey) {
    event.preventDefault();
    toggleShortcuts();
    return;
  }
  if (!mod && event.key === '?' && !getDocs().shortcuts && !isTextField(event.target) && !inPopup(event.target)) {
    event.preventDefault();
    setDocs({ shortcuts: true });
  }
});
