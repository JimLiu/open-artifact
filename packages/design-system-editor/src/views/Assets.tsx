/**
 * Assets: logos, icons, imagery and other brand files in groups. Tiles can
 * be uploaded, dragged into a new order, renamed (double-click) and
 * removed; a group's README is its note.
 */

import { Copy, Download, FileIcon, Info, Pencil, Plus, Trash2, Upload, X } from 'lucide-react';
import { useEffect, useRef, useState, type DragEvent, type MouseEvent } from 'react';
import { assetGroupKey, type AssetItem, type TileSize } from '@open-artifact/design-system-core';
import { Button, ConfirmDialog, Dialog, IconButton, MenuItem, MenuSeparator, TextInput, cn, toast } from '@open-artifact/ui';
import { create } from 'zustand';
import { useFiles } from '../state/files.ts';
import { useModel } from '../state/model.ts';
import { anchorId, useView } from '../state/view.ts';
import { projectUrl } from '../lib/color.ts';
import { ASSET_CHECKER, assetInkBackground } from '../lib/ink-bg.ts';
import { addAssetGroup, editIndex, editText, relocateAssets, removeAsset, renameAsset, reorderAssets, uploadAssets } from '../services/edit.ts';
import { droppedBrandFiles } from '../lib/drop-files.ts';
import { copyText, downloadUrl } from '../services/downloads.ts';
import { CommentBadge } from '../components/Comments.tsx';
import { ContextMenu, InlineText, PageHeader, formatSize, useFocusProps } from './common.tsx';

/** Which tile is being renamed and which is shown in the details pane (`group/name` keys). */
const useAssetUi = create<{ renaming: string | null; details: string | null; removing: AssetItem | null }>()(() => ({ renaming: null, details: null, removing: null }));

const itemKey = (item: AssetItem): string => `${item.group}/${item.name}`;

/** Tile widths per size. */
const TILE: Record<TileSize, number> = { xl: 320, l: 240, m: 176, s: 128, xs: 96 };

/** Previewable images. */
const VIDEO = /\.(mp4|webm|mov|ogv)$/i;
const IMAGE = /\.(png|jpe?g|gif|webp|avif|svg|ico|bmp)$/i;

/** Where an asset's bytes are served. */
function assetUrl(item: AssetItem): string | null {
  if (item.blob) return new URL(`/_blob/${encodeURIComponent(item.blob)}`, location.href).href;
  return item.path ? projectUrl(item.path) : null;
}

/** The contrasting field for an image, or the checker until that field is known. */
function useAssetBackdrop(url: string | null, image: boolean): string {
  const [background, setBackground] = useState(ASSET_CHECKER);
  useEffect(() => {
    if (!url || !image) {
      setBackground(ASSET_CHECKER);
      return;
    }
    let live = true;
    void assetInkBackground(url).then((next) => {
      if (live) setBackground(next);
    });
    return () => {
      live = false;
    };
  }, [url, image]);
  return background;
}

function isImage(item: AssetItem): boolean {
  return (item.type ?? '').startsWith('image/') || IMAGE.test(item.name);
}

interface TileProps {
  item: AssetItem;
  width: number;
  editable: boolean;
  dragging: boolean;
  selected: boolean;
  onSelect(event: MouseEvent): void;
  onDragStart(): void;
  onDragEnter(): void;
  onDragEnd(): void;
  onDelete(): void;
}

/** The context menu and details actions of an asset. */
function AssetActions({ item, editable }: { item: AssetItem; editable: boolean }) {
  const url = assetUrl(item);
  return (
    <>
      <MenuItem icon={<Info className="size-3.5" />} onSelect={() => useAssetUi.setState({ details: itemKey(item) })}>
        Details
      </MenuItem>
      {url ? (
        <>
          <MenuItem icon={<Download className="size-3.5" />} onSelect={() => void downloadUrl(url, item.name.split('/').pop() ?? item.name)}>
            Download
          </MenuItem>
          <MenuItem icon={<Copy className="size-3.5" />} onSelect={() => void copyText(url, 'the URL')}>
            Copy URL
          </MenuItem>
        </>
      ) : null}
      {item.path ? (
        <MenuItem icon={<Copy className="size-3.5" />} onSelect={() => void copyText(item.path!, 'the path')}>
          Copy path
        </MenuItem>
      ) : null}
      {editable ? (
        <>
          <MenuSeparator />
          <MenuItem icon={<Pencil className="size-3.5" />} onSelect={() => useAssetUi.setState({ renaming: itemKey(item) })}>
            Rename
          </MenuItem>
          <MenuItem icon={<Trash2 className="size-3.5" />} danger onSelect={() => useAssetUi.setState({ removing: item })}>
            Remove
          </MenuItem>
        </>
      ) : null}
    </>
  );
}

function Tile({ item, width, editable, dragging, selected, onSelect, onDragStart, onDragEnter, onDragEnd, onDelete }: TileProps) {
  const focus = useFocusProps({ kind: 'asset', name: itemKey(item) });
  const renaming = useAssetUi((s) => s.renaming === itemKey(item));
  const setRenaming = (on: boolean): void => useAssetUi.setState({ renaming: on ? itemKey(item) : null });
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const url = assetUrl(item);
  const backdrop = useAssetBackdrop(url, Boolean(url && isImage(item)));
  const size = item.size ?? useFiles.getState().listing[item.path ?? '']?.size;
  return (
    <figure
      id={anchorId('asset', itemKey(item))}
      {...focus}
      onClick={(event) => {
        if (event.target instanceof Element && event.target.closest('button, input, select')) return;
        if (editable) onSelect(event);
        if (!event.metaKey && !event.ctrlKey && !event.shiftKey) focus.onClick();
      }}
      onDoubleClick={() => useAssetUi.setState({ details: itemKey(item) })}
      onContextMenu={(event) => {
        event.preventDefault();
        setMenu({ x: event.clientX, y: event.clientY });
      }}
      draggable={editable && !renaming}
      onDragStart={(event) => {
        event.dataTransfer.effectAllowed = 'move';
        onDragStart();
      }}
      onDragEnter={onDragEnter}
      onDragOver={(event) => event.preventDefault()}
      onDragEnd={onDragEnd}
      className={cn(
        'group relative flex flex-col overflow-hidden rounded-lg border border-line bg-surface data-[focused]:border-accent data-[focused]:ring-2 data-[focused]:ring-accent/30',
        selected && 'border-accent ring-2 ring-accent/30',
        dragging && 'opacity-40',
      )}
      style={{ width }}
    >
      <div className="flex items-center justify-center bg-surface-2" style={{ height: width * 0.75, background: backdrop }}>
        {url && isImage(item) ? <img src={url} alt={item.name} draggable={false} className="max-h-full max-w-full object-contain p-3" /> : url && VIDEO.test(item.name) ? <video src={url} muted preload="metadata" className="max-h-full max-w-full" /> : <FileIcon className="size-8 text-fg-subtle" />}
      </div>
      <figcaption className="flex items-center gap-1 border-t border-line px-2 py-1.5">
        <div className="min-w-0 flex-1">
          {renaming ? (
            <TextInput
              autoFocus
              defaultValue={item.name}
              // Select the name without its extension, as file managers do.
              onFocus={(event) => {
                const dot = event.target.value.lastIndexOf('.');
                event.target.setSelectionRange(0, dot > 0 ? dot : event.target.value.length);
              }}
              className="h-6 text-[12px]"
              onBlur={(event) => {
                setRenaming(false);
                void renameAsset(item, event.target.value);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') event.currentTarget.blur();
                if (event.key === 'Escape') setRenaming(false);
              }}
            />
          ) : (
            <div
              className="truncate text-[12px] text-fg"
              title={editable ? `${item.name} (double-click to rename)` : item.name}
              onDoubleClick={(event) => {
                if (!editable) return;
                event.stopPropagation();
                setRenaming(true);
              }}
            >
              {item.name}
            </div>
          )}
          <div className="truncate text-[11px] text-fg-subtle">{formatSize(size)}</div>
        </div>
        <CommentBadge focus={{ kind: 'asset', name: itemKey(item) }} />
        {editable ? (
          <IconButton label={`Remove ${item.name}`} size="sm" className="opacity-0 group-hover:opacity-100" onClick={onDelete} icon={<Trash2 className="size-3.5" />} />
        ) : null}
      </figcaption>
      <ContextMenu at={menu} onClose={() => setMenu(null)}>
        <AssetActions item={item} editable={editable} />
      </ContextMenu>
    </figure>
  );
}

function Group({ name, tile, items, editable }: { name: string; tile: TileSize; items: AssetItem[]; editable: boolean }) {
  const key = name;
  const { index, assets } = useModel();
  const [selected, setSelected] = useState<string[]>([]);
  const last = useRef<string | null>(null);
  const [action, setAction] = useState<'rename' | 'remove' | null>(null);
  const [newName, setNewName] = useState(name);
  const [working, setWorking] = useState(false);
  const chosen = selected.filter((name) => items.some((item) => item.name === name));
  const move = async (to: string | null, names?: readonly string[]) => {
    setWorking(true);
    try {
      if (await relocateAssets(name, to, names)) {
        setAction(null);
        setSelected([]);
      }
    } finally {
      setWorking(false);
    }
  };
  const notePath = `assets/${key}/README.md`;
  const note = useFiles((s) => s.texts[notePath]);
  const input = useRef<HTMLInputElement>(null);
  const [order, setOrder] = useState<string[] | null>(null);
  const [dragged, setDragged] = useState<string | null>(null);
  const [dropping, setDropping] = useState(false);

  // While dragging, tiles show in the provisional order.
  const shown = order ? order.map((n) => items.find((item) => item.name === n)!).filter(Boolean) : items;

  const dropFiles = (event: DragEvent): void => {
    setDropping(false);
    if (!event.dataTransfer.files.length || !editable) return;
    event.preventDefault();
    void droppedBrandFiles(event.dataTransfer).then((files) => uploadAssets(key, files, true)).catch(() => toast.add({ title: 'Could not read these files' }));
  };

  return (
    <section
      id={anchorId('section', `assets/${key}`)}
      className={cn('mb-10 rounded-lg', dropping && 'outline-2 outline-dashed outline-accent')}
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes('Files') && editable) {
          event.preventDefault();
          setDropping(true);
        }
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropping(false);
      }}
      onDrop={dropFiles}
    >
      <div className="group mb-2 flex items-center gap-2">
        <h2 className="flex flex-1 items-center gap-2 text-[15px] font-semibold text-fg">
          {name} <span className="font-normal text-fg-subtle">{items.length}</span>
          <CommentBadge focus={{ kind: 'section', name: `assets/${key}` }} />
        </h2>
        {editable ? (
          <>
            <input
              ref={input}
              type="file"
              multiple
              hidden
              onChange={(event) => {
                if (event.target.files?.length) void uploadAssets(key, [...event.target.files]);
                event.target.value = '';
              }}
            />
            <select aria-label={`Tile size for ${name}`} value={tile} className="rounded border border-line bg-surface px-1 text-xs"
              onChange={(event) => {
                const size = event.target.value as TileSize;
                const groupKey = assetGroupKey(index.assetGroups, name);
                editIndex((raw) => {
                  const groups = (raw.assetGroups ?? {}) as typeof index.assetGroups;
                  return { ...raw, assetGroups: { ...groups, [groupKey]: { ...(groups[groupKey] ?? { name, order: [], files: {} }), tile: size } } };
                });
              }}>
              {Object.keys(TILE).reverse().map((size) => <option key={size} value={size}>{size.toUpperCase()}</option>)}
            </select>
            <IconButton size="sm" label={`Rename group ${name}`} icon={<Pencil className="size-3.5" />} onClick={() => { setNewName(name); setAction('rename'); }} />
            <IconButton size="sm" label={`Remove group ${name}`} icon={<Trash2 className="size-3.5" />} onClick={() => setAction('remove')} />
            <Button size="sm" icon={<Upload className="size-3.5" />} onClick={() => input.current?.click()}>
              Upload
            </Button>
          </>
        ) : null}
      </div>
      <div className="mb-3 max-w-2xl">
        <InlineText
          value={typeof note === 'string' ? note.trim() : ''}
          placeholder="Add a note: when to use these…"
          readOnly={!editable}
          multiline
          onCommit={(text) => editText(notePath, text.trim() ? `${text.trim()}\n` : null)}
        />
      </div>
      {editable && chosen.length > 0 && <div className="mb-3 flex items-center gap-2 text-xs">
        <span>{chosen.length} selected</span>
        <select aria-label="Move selected files to group" disabled={working} value="" className="rounded border border-line bg-surface p-1"
          onChange={(event) => { if (event.target.value) void move(event.target.value, chosen); }}>
          <option value="">Move to group…</option>
          {assets.filter((entry) => entry.name !== name).map((entry) => <option key={entry.name}>{entry.name}</option>)}
        </select>
        <Button size="sm" onClick={() => setSelected([])}>Clear selection</Button>
      </div>}
      <Dialog open={action === 'rename'} onOpenChange={(open) => { if (!open) setAction(null); }} title="Rename asset group"
        footer={<Button variant="primary" disabled={working || !newName.trim() || newName === name} onClick={() => void move(newName)}>Rename</Button>}>
        <TextInput autoFocus aria-label="Group name" value={newName} onChange={(event) => setNewName(event.target.value)}
          onKeyDown={(event) => { if (event.key === 'Enter' && !working) void move(newName); }} />
      </Dialog>
      <ConfirmDialog open={action === 'remove'} onOpenChange={(open) => { if (!open) setAction(null); }} title={`Remove group ${name}?`}
        description="The group's files move to archived/ and its upload records are removed." confirmLabel="Remove group" danger onConfirm={() => { if (!working) void move(null); }} />
      {shown.length ? (
        <div className="flex flex-wrap gap-3">
          {shown.map((item) => (
            <Tile
              key={item.name}
              item={item}
              width={TILE[tile]}
              editable={editable}
              dragging={dragged === item.name}
              selected={chosen.includes(item.name)}
              onSelect={(event) => {
                if (event.shiftKey && last.current !== null) {
                  const start = shown.findIndex((other) => other.name === last.current);
                  const end = shown.indexOf(item);
                  if (start >= 0) setSelected(shown.slice(Math.min(start, end), Math.max(start, end) + 1).map((other) => other.name));
                } else if (event.ctrlKey || event.metaKey) {
                  setSelected(chosen.includes(item.name) ? chosen.filter((name) => name !== item.name) : [...chosen, item.name]);
                } else {
                  setSelected([item.name]);
                }
                last.current = item.name;
              }}
              onDragStart={() => {
                setDragged(item.name);
                setOrder(items.map((i) => i.name));
              }}
              onDragEnter={() => {
                if (!dragged || dragged === item.name || !order) return;
                const next = order.filter((n) => n !== dragged);
                next.splice(next.indexOf(item.name) + (order.indexOf(dragged) < order.indexOf(item.name) ? 1 : 0), 0, dragged);
                setOrder(next);
              }}
              onDragEnd={() => {
                if (order && order.join('\n') !== items.map((i) => i.name).join('\n')) reorderAssets(key, order);
                setDragged(null);
                setOrder(null);
              }}
              onDelete={() => useAssetUi.setState({ removing: item })}
            />
          ))}
        </div>
      ) : (
        <p className="rounded-lg border border-dashed border-line p-6 text-center text-[13px] text-fg-subtle">{editable ? 'Drop files here or use Upload.' : 'Empty.'}</p>
      )}
    </section>
  );
}

function NewGroup() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const create = (): void => {
    if (addAssetGroup(name)) {
      setOpen(false);
      setName('');
    }
  };
  return (
    <>
      <Button icon={<Plus className="size-3.5" />} onClick={() => setOpen(true)}>
        New group
      </Button>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title="New asset group"
        description="A folder under assets/, such as Logos, Icons or Photography."
        footer={
          <>
            <Button onClick={() => setOpen(false)}>Cancel</Button>
            <Button variant="primary" onClick={create} disabled={!name.trim()}>
              Create
            </Button>
          </>
        }
      >
        <TextInput autoFocus placeholder="Name" value={name} onChange={(event) => setName(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && create()} />
      </Dialog>
    </>
  );
}

/** The details of one asset: a larger preview, its facts and actions. */
function AssetDetails({ item, editable }: { item: AssetItem; editable: boolean }) {
  const url = assetUrl(item);
  const backdrop = useAssetBackdrop(url, Boolean(url && isImage(item)));
  const [dimensions, setDimensions] = useState<{ w: number; h: number } | null>(null);
  const size = item.size ?? useFiles.getState().listing[item.path ?? '']?.size;
  useEffect(() => setDimensions(null), [url]);
  const fact = (label: string, value: string | null | undefined) =>
    value ? (
      <div className="grid grid-cols-[72px_minmax(0,1fr)] gap-2">
        <dt className="text-fg-subtle">{label}</dt>
        <dd className="truncate font-mono text-fg" title={value}>
          {value}
        </dd>
      </div>
    ) : null;
  return (
    <aside className="sticky top-4 flex w-64 shrink-0 flex-col gap-3 self-start rounded-lg border border-line bg-surface p-3" aria-label={`Details of ${item.name}`}>
      <div className="flex items-center gap-1">
        <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-fg">{item.name}</span>
        <CommentBadge focus={{ kind: 'asset', name: itemKey(item) }} className="opacity-100" />
        <IconButton size="sm" label="Close details" icon={<X className="size-3.5" />} onClick={() => useAssetUi.setState({ details: null })} />
      </div>
      <div className="flex h-40 items-center justify-center rounded-md" style={{ background: backdrop }}>
        {url && isImage(item) ? (
          <img src={url} alt={item.name} className="max-h-full max-w-full object-contain p-2" onLoad={(event) => setDimensions({ w: event.currentTarget.naturalWidth, h: event.currentTarget.naturalHeight })} />
        ) : url && VIDEO.test(item.name) ? (
          <video src={url} controls preload="metadata" className="max-h-full max-w-full" />
        ) : (
          <FileIcon className="size-10 text-fg-subtle" />
        )}
      </div>
      <dl className="flex flex-col gap-1 text-[11px]">
        {fact('Group', item.group)}
        {fact('Path', item.path ?? null)}
        {fact('Type', item.type ?? item.name.split('.').pop()?.toUpperCase())}
        {fact('Size', formatSize(size))}
        {fact('Pixels', dimensions ? `${dimensions.w} × ${dimensions.h}` : null)}
        {fact('Upload', item.blob ?? null)}
      </dl>
      <div className="flex flex-wrap gap-1.5">
        {url ? (
          <>
            <Button size="sm" icon={<Download className="size-3.5" />} onClick={() => void downloadUrl(url, item.name.split('/').pop() ?? item.name)}>
              Download
            </Button>
            <Button size="sm" icon={<Copy className="size-3.5" />} onClick={() => void copyText(url, 'the URL')}>
              Copy URL
            </Button>
          </>
        ) : null}
        {editable ? (
          <>
            <Button size="sm" icon={<Pencil className="size-3.5" />} onClick={() => useAssetUi.setState({ renaming: itemKey(item) })}>
              Rename
            </Button>
            <Button size="sm" variant="ghost" icon={<Trash2 className="size-3.5" />} onClick={() => useAssetUi.setState({ removing: item })}>
              Remove
            </Button>
          </>
        ) : null}
      </div>
    </aside>
  );
}

export function Assets() {
  const { assets } = useModel();
  const editable = !useFiles((s) => s.readOnly);
  const details = useAssetUi((s) => s.details);
  const removing = useAssetUi((s) => s.removing);
  const focus = useView((s) => s.focus);
  const count = assets.reduce((n, group) => n + group.items.length, 0);
  // The details pane follows the focused tile once open.
  const wanted = details && focus?.kind === 'asset' ? focus.name : details;
  const shown = wanted ? assets.flatMap((group) => group.items).find((item) => itemKey(item) === wanted) : undefined;
  return (
    <div className="flex gap-6">
      <div className="min-w-0 flex-1">
        <PageHeader title="Assets" description={`${count} files in ${assets.length} groups.`} actions={editable ? <NewGroup /> : null} />
        {assets.length ? (
          assets.map((group) => <Group key={group.items[0]?.group ?? group.name} name={group.name} tile={group.tile} items={group.items} editable={editable} />)
        ) : (
          <p className="text-[13px] text-fg-subtle">No assets yet. {editable ? 'Make a group, then upload logos, icons or imagery.' : ''}</p>
        )}
      </div>
      {shown ? <AssetDetails item={shown} editable={editable} /> : null}
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => !open && useAssetUi.setState({ removing: null })}
        title={`Remove ${removing?.name ?? ''}?`}
        description={removing?.path ? 'The file moves to archived/ in the project.' : 'The upload leaves this design system.'}
        confirmLabel="Remove"
        danger
        onConfirm={() => {
          if (removing) void removeAsset(removing);
          useAssetUi.setState({ removing: null, details: null });
        }}
      />
    </div>
  );
}
