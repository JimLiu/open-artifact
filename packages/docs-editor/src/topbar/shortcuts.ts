/** The keyboard shortcuts sheet's contents: every key the editor answers, and what typing turns into. Pure. */

/** One row: what it does, and the keys (any of which works). */
export interface ShortcutRow {
  label: string;
  /** Where it works, shown muted after the label ("on a list line"). */
  where?: string;
  /** Chords as the editor's keymap writes them ("Mod-Alt-1"), or typed text when `typed`. */
  keys: readonly string[];
  /** The keys are characters typed in the text, not a chord. */
  typed?: boolean;
  /** The keys are the two ends of a range ("⌘⌥1 to ⌘⌥6"), not alternatives. */
  range?: boolean;
}

export interface ShortcutGroup {
  title: string;
  rows: readonly ShortcutRow[];
}

export const SHORTCUT_GROUPS: readonly ShortcutGroup[] = [
  {
    title: 'General',
    rows: [
      { label: 'Keyboard shortcuts', keys: ['Mod-/', '?'] },
      { label: 'Find in document', keys: ['Mod-f'] },
      { label: 'Find and replace', keys: ['Mod-Shift-h'] },
      { label: 'Leave the document for the toolbar', keys: ['Escape'] },
      { label: 'Undo', keys: ['Mod-z'] },
      { label: 'Redo', keys: ['Mod-Shift-z', 'Mod-y'] },
      { label: 'Move between the title and the body', keys: ['Tab', 'Shift-Tab'] },
      { label: 'Resize a panel', where: 'with focus on its edge', keys: ['ArrowLeft', 'ArrowRight'] },
    ],
  },
  {
    title: 'Text',
    rows: [
      { label: 'Bold', keys: ['Mod-b'] },
      { label: 'Italic', keys: ['Mod-i'] },
      { label: 'Underline', keys: ['Mod-u'] },
      { label: 'Strikethrough', keys: ['Mod-Shift-s', 'Mod-Shift-x'] },
      { label: 'Code', keys: ['Mod-e'] },
      { label: 'Link', keys: ['Mod-k'] },
      { label: 'Open the link', where: 'on a link', keys: ['Alt-Enter'] },
      { label: 'Copy link to selection or current paragraph', keys: ['Mod-Alt-l'] },
      { label: 'Open a mentioned tab', where: 'on the mention', keys: ['Alt-Enter'] },
      { label: 'Move to the formatting bar, or the bar of the block the cursor is in', keys: ['F6', 'Mod-F6', 'Alt-F10'] },
      { label: 'Select all', keys: ['Mod-a'] },
    ],
  },
  {
    title: 'Blocks',
    rows: [
      { label: 'Normal text', keys: ['Mod-Alt-0'] },
      ...[1, 2, 3, 4, 5, 6].map(level => ({ label: `Heading ${level}`, keys: [`Mod-Alt-${level}`] })),
      { label: 'Collapse or expand the heading’s section', keys: ['Mod-Alt-Enter'] },
      { label: 'Numbered list', keys: ['Mod-Shift-7'] },
      { label: 'Bulleted list', keys: ['Mod-Shift-8'] },
      { label: 'Checklist', keys: ['Mod-Shift-9'] },
      { label: 'Check or uncheck the item', where: 'on a checklist line', keys: ['Mod-Enter'] },
      { label: 'Quote', keys: ['Mod-Shift-b'] },
      { label: 'Code block', keys: ['Mod-Alt-c'] },
      { label: 'Leave the code block', where: 'in a code block', keys: ['Mod-Enter'] },
      { label: 'Split the code block', where: 'in a code block', keys: ['Mod-Shift-Enter'] },
      { label: 'New line in the same block', keys: ['Shift-Enter'] },
      { label: 'Move into the selected image’s bar', where: 'on a selected image', keys: ['Enter'] },
      { label: 'Delete the placeholder', where: 'on a selected placeholder', keys: ['Backspace'] },
      { label: 'New line below the placeholder', where: 'on a selected placeholder', keys: ['Enter'] },
      { label: 'Indent', where: 'on a list line', keys: ['Tab', 'Mod-]'] },
      { label: 'Outdent', where: 'on a list line', keys: ['Shift-Tab', 'Mod-['] },
      { label: 'Next cell', where: 'in a table cell', keys: ['Tab'] },
      { label: 'Previous cell', where: 'in a table cell', keys: ['Shift-Tab'] },
      { label: 'Repeat the last table insert', where: 'in a table cell', keys: ['Mod-y'] },
      { label: 'Open the cell’s menu', where: 'in a table cell', keys: ['Shift-F10'] },
    ],
  },
  {
    title: 'Insert',
    rows: [
      { label: 'Insert a block — table, code block, checkbox, date…', keys: ['/'], typed: true },
      { label: 'Mention a person, a date or a tab', keys: ['@'], typed: true },
      { label: 'Emoji, by name', keys: [':'], typed: true },
    ],
  },
  {
    title: 'Comments',
    rows: [
      { label: 'Comment on the selection, or open the comment at the cursor', keys: ['Mod-Alt-m'] },
      { label: 'Hide or show comments', keys: ['Alt-Shift-c'] },
      { label: 'Open the comment', where: 'on a comment', keys: ['Enter', 'Space'] },
      { label: 'Close the comment', where: 'in an open comment', keys: ['Escape'] },
      { label: 'Next comment', where: 'on a comment', keys: ['ArrowDown'] },
      { label: 'Previous comment', where: 'on a comment', keys: ['ArrowUp'] },
      { label: 'Post the comment', where: 'in a comment box', keys: ['Enter'] },
      { label: 'New line', where: 'in a comment box', keys: ['Shift-Enter', 'Alt-Enter'] },
      { label: 'Mention someone', where: 'in a comment box', keys: ['@'], typed: true },
      { label: 'Discard the draft or leave the box', where: 'in a comment box', keys: ['Escape'] },
    ],
  },
  {
    title: 'In the tabs panel',
    rows: [
      { label: 'Next or previous row', keys: ['ArrowDown', 'ArrowUp'] },
      { label: 'First or last row', keys: ['Home', 'End'] },
      { label: 'Show or hide the rows under a tab', keys: ['ArrowRight', 'ArrowLeft'] },
      { label: 'Open the tab, or go to the heading', keys: ['Enter', 'Space'] },
      { label: 'Open the tab’s menu', keys: ['Shift-F10'] },
      { label: 'Close the panel', keys: ['Escape'] },
    ],
  },
  {
    title: 'In version history',
    rows: [
      { label: 'Next or previous version', keys: ['ArrowDown', 'ArrowUp'] },
      { label: 'First or last version', keys: ['Home', 'End'] },
      { label: 'Select the version', keys: ['Enter', 'Space'] },
      { label: 'Restore the selected version', keys: ['Enter'] },
      { label: 'Close the version preview', keys: ['Escape'] },
    ],
  },
  {
    title: 'As you type',
    rows: [
      { label: 'Heading 1–6', where: 'at the start of a line', keys: ['# ', '###### '], typed: true, range: true },
      { label: 'Bulleted list', where: 'at the start of a line', keys: ['- ', '* '], typed: true },
      { label: 'Numbered list', where: 'at the start of a line', keys: ['1. '], typed: true },
      { label: 'Checklist', where: 'at the start of a line', keys: ['[ ] ', '[x] '], typed: true },
      { label: 'Quote', where: 'at the start of a line', keys: ['> '], typed: true },
      { label: 'Code block', where: 'at the start of a line', keys: ['``` '], typed: true },
      { label: 'Divider', where: 'on an empty line', keys: ['---', '***'], typed: true },
      { label: 'Bold', keys: ['**words**'], typed: true },
      { label: 'Italic', keys: ['*words*', '_words_'], typed: true },
      { label: 'Strikethrough', keys: ['~~words~~'], typed: true },
      { label: 'Code', keys: ['`words`'], typed: true },
      { label: 'Arrows → ← ↔', keys: ['-->', '<--', '<->'], typed: true },
      { label: 'Emoji', keys: [':name:'], typed: true },
    ],
  },
];

const SHARED_KEYS: Record<string, string> = { Escape: 'Esc', Tab: 'Tab', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Space: 'Space', Home: 'Home', End: 'End' };
const APPLE_KEYS: Record<string, string> = { ...SHARED_KEYS, Mod: '⌘', Alt: '⌥', Shift: '⇧', Ctrl: '⌃', Enter: '↵', Backspace: '⌫' };
const OTHER_KEYS: Record<string, string> = { ...SHARED_KEYS, Mod: 'Ctrl', Alt: 'Alt', Shift: 'Shift', Ctrl: 'Ctrl', Enter: 'Enter', Backspace: 'Backspace' };

/** "Mod-Alt-1" as the platform writes it: "⌘⌥1" on Apple platforms, "Ctrl+Alt+1" elsewhere. */
export function keyLabel(chord: string, apple: boolean): string {
  if (chord.length === 1) return chord.toUpperCase() === chord.toLowerCase() ? chord : chord.toUpperCase();
  const parts = chord.split('-');
  const names = apple ? APPLE_KEYS : OTHER_KEYS;
  const words = parts.map(part => names[part] ?? (part.length === 1 ? part.toUpperCase() : part));
  return words.join(apple ? '' : '+');
}
