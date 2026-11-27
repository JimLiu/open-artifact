/** Pieces shared by the section views. */

import { MoreHorizontal, Pencil, Plus, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { TOKEN_NAME, addEntry, cleanName, familyEntries, freeTokenName, removeEntry, renameEntry, type RawEntry } from '@open-artifact/design-system-core';
import { Button, Dialog, Menu, MenuItem, IconButton, TextInput, cn, toast, isComposingKey } from '@open-artifact/ui';
import { useFiles } from '../state/files.ts';
import { useModel } from '../state/model.ts';
import { anchorId, useView, type Focus } from '../state/view.ts';
import { editTokens } from '../services/edit.ts';
import { serializeAnchor } from '../lib/comment-anchors.ts';

/** True when the viewer may edit. */
export function useEditable(): boolean {
  const readOnly = useFiles((s) => s.readOnly);
  const tokensError = useModel().tokensError;
  return !readOnly && !tokensError;
}

/** A section's title, description and actions. */
export function PageHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex items-end gap-4">
      <div className="min-w-0 flex-1">
        <h1 className="text-[22px] font-semibold tracking-tight text-fg">{title}</h1>
        {description ? <div className="mt-1 text-[13px] text-fg-muted">{description}</div> : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  );
}

/** Notes from reading tokens.json (dropped values and the like). */
export function TokenNotes({ filter }: { filter?: (message: string) => boolean }) {
  const { tokenNotes, tokensError } = useModel();
  const notes = tokenNotes.filter((note) => !filter || filter(note.message));
  if (!tokensError && !notes.length) return null;
  return (
    <div className="mb-6 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-[12px] text-fg">
      {tokensError ? <p>{tokensError}</p> : null}
      {notes.slice(0, 8).map((note, index) => (
        <p key={index}>{note.message}</p>
      ))}
      {notes.length > 8 ? <p className="text-fg-muted">…and {notes.length - 8} more.</p> : null}
    </div>
  );
}

/**
 * Text that becomes an input on click (usage notes, samples). Commits on
 * Enter or blur; Escape cancels. Shift+Enter adds a line in multiline mode.
 */
export function InlineText({
  value,
  onCommit,
  placeholder,
  readOnly,
  multiline = false,
  className,
}: {
  value: string;
  onCommit(value: string): void;
  placeholder: string;
  readOnly: boolean;
  multiline?: boolean;
  className?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (!editing) setDraft(value);
  }, [value, editing]);
  useEffect(() => {
    const element = ref.current;
    if (!editing || !element) return;
    element.style.height = 'auto';
    element.style.height = `${element.scrollHeight}px`;
  }, [draft, editing]);

  if (!editing) {
    return (
      <button
        type="button"
        disabled={readOnly}
        onClick={() => {
          setEditing(true);
          requestAnimationFrame(() => ref.current?.focus());
        }}
        className={cn(
          'block w-full rounded px-1 -mx-1 text-left text-[12px] leading-snug disabled:cursor-default',
          !readOnly && 'hover:bg-hover',
          value ? 'text-fg-muted' : 'italic text-fg-subtle',
          className,
        )}
      >
        {value || (readOnly ? '' : placeholder)}
      </button>
    );
  }
  const commit = (): void => {
    setEditing(false);
    if (draft.trim() !== value) onCommit(draft.trim());
  };
  return (
    <textarea
      ref={ref}
      rows={1}
      value={draft}
      onChange={(event) => setDraft(multiline ? event.target.value : event.target.value.replace(/\n/g, ' '))}
      onBlur={commit}
      onKeyDown={(event) => {
        if (isComposingKey(event.nativeEvent)) return;
        if (event.key === 'Escape') {
          setDraft(value);
          setEditing(false);
        } else if (event.key === 'Enter' && !(multiline && event.shiftKey)) {
          event.preventDefault();
          commit();
        }
      }}
      className={cn('-mx-1 block w-[calc(100%+0.5rem)] resize-none overflow-hidden rounded border border-accent bg-surface px-1 text-[12px] leading-snug text-fg outline-none', className)}
    />
  );
}

/** Scrolls to and highlights the anchor the view asks for, once rendered. */
export function useAnchor(): void {
  const anchor = useView((s) => s.anchor);
  useEffect(() => {
    if (!anchor) return;
    const frame = requestAnimationFrame(() => {
      const element = document.getElementById(anchor);
      if (element) {
        element.scrollIntoView({ block: anchor.startsWith('ds-page-') ? 'start' : 'center' });
        if (!anchor.startsWith('ds-page-')) element.animate([{ boxShadow: '0 0 0 3px var(--color-accent, #3b82f6)' }, { boxShadow: '0 0 0 0 transparent' }], { duration: 1400, easing: 'ease-out' });
      }
      useView.getState().clearAnchor();
    });
    return () => cancelAnimationFrame(frame);
  }, [anchor]);
}

/**
 * Props for focusable rows: click focuses the item for "Send to agent"; in
 * comment mode it opens the item's comments (with a composer), and the row
 * under the pointer is outlined.
 */
export function useFocusProps(focus: Focus) {
  const current = useView((s) => s.focus);
  const active = current?.kind === focus.kind && current.name === focus.name && current.family === focus.family;
  return {
    'data-focused': active || undefined,
    'data-comment-item': serializeAnchor(focus),
    onClick: () => useView.getState().setFocus(focus),
  };
}

/** Rename and delete for a token of a list family. */
export function TokenMenu({ family, name }: { family: string; name: string }) {
  const editable = useEditable();
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(name);
  if (!editable) return null;
  const rename = (): void => {
    const clean = cleanName(draft);
    if (!clean || !TOKEN_NAME.test(clean)) {
      toast.add({ title: 'Token names use letters, digits, - _ and .' });
      return;
    }
    editTokens((raw) => {
      if (clean !== name && Object.keys(raw).some((key) => familyEntries(raw, key).some((entry) => cleanName(entry.name) === clean))) {
        toast.add({ title: `${clean} already exists` });
        return raw;
      }
      return renameEntry(raw, family, name, clean);
    });
    setRenaming(false);
  };
  return (
    <>
      <Menu trigger={<IconButton size="sm" label={`${name} options`} icon={<MoreHorizontal className="size-3.5" />} />} align="end">
        <MenuItem
          icon={<Pencil className="size-3.5" />}
          onSelect={() => {
            setDraft(name);
            setRenaming(true);
          }}
        >
          Rename
        </MenuItem>
        <MenuItem danger icon={<Trash2 className="size-3.5" />} onSelect={() => editTokens((raw) => removeEntry(raw, family, name))}>
          Delete
        </MenuItem>
      </Menu>
      <Dialog
        open={renaming}
        onOpenChange={setRenaming}
        title={`Rename ${name}`}
        description={family === 'color' || family === 'shadow' ? 'Aliases that point at it follow the new name. Designs that use the old variable need updating.' : 'Designs that use the old variable need updating.'}
        footer={
          <>
            <Button onClick={() => setRenaming(false)}>Cancel</Button>
            <Button variant="primary" onClick={rename}>
              Rename
            </Button>
          </>
        }
      >
        <TextInput autoFocus value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && !isComposingKey(event.nativeEvent) && rename()} />
      </Dialog>
    </>
  );
}

/** "Add token" for a list family. */
export function AddTokenButton({ family, stem, entry }: { family: string; stem: string; entry: Omit<RawEntry, 'name'> }) {
  const editable = useEditable();
  const { raw } = useModel();
  if (!editable) return null;
  return (
    <Button
      icon={<Plus className="size-3.5" />}
      onClick={() => {
        const name = freeTokenName(raw, family, stem);
        editTokens((current) => addEntry(current, family, { name, ...entry }));
        useView.getState().setFocus({ kind: 'token', family, name });
        useView.getState().go(useView.getState().section, anchorId('token', name));
      }}
    >
      Add token
    </Button>
  );
}

/** A menu opened at a pointer position (a right-click menu). */
export function ContextMenu({ at, onClose, children }: { at: { x: number; y: number } | null; onClose(): void; children: ReactNode }) {
  if (!at) return null;
  return (
    <Menu
      open
      onOpenChange={(open) => !open && onClose()}
      align="start"
      trigger={<span aria-hidden="true" className="pointer-events-none fixed size-px" style={{ left: at.x, top: at.y }} />}
    >
      {children}
    </Menu>
  );
}

/** Formats a byte count. */
export function formatSize(bytes: number | undefined): string {
  if (bytes === undefined) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
