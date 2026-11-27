/**
 * The Library panel: the board's shape libraries, searchable by name and
 * tag, one collapsible section per library. A click (or Enter) on a shape
 * arms the Library tool with it; the next click on the board places it.
 *
 * Shapes show as pictures (`<img>` of a data URL, themed for the color
 * scheme), never as markup in the page. Each library has a menu with its
 * source, its licence and "Remove from this board". The footer adds
 * libraries from files (a `.shapes.json` library, a zip of SVG files, a
 * draw.io library, or SVG files), which can also be dropped on the panel,
 * or from a link (`LibraryLinkForm.tsx`); afterwards the panel says what was added
 * and which shapes were left out, and why.
 *
 * Loaded on first open (`ui/Toolbar.tsx`).
 */

import { ChevronRight, Ellipsis, Plus, Search } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent } from 'react';
import { drawnImagePen, drawnImageSrcForPen } from '../export/drawn-svg.ts';
import { shapeMatchesQuery, svgToBase64DataUrl, type BoardShapeLibrary, type LibraryShape } from '@open-artifact/whiteboard-core';
import { cn, isComposingKey } from '@open-artifact/ui';
import { dragHasFiles } from '../services/drop.ts';
import { hasRoomForLibrary, importShapeFiles, loadShapeLibrary, removeShapeLibrary, type LibraryImport, type LoadedLibrary } from '../services/shape-libraries.ts';
import { useBoard } from '../state/board.ts';
import { useColorScheme } from '../state/theme.ts';
import { Tip } from './chrome.tsx';
import { LibraryLinkForm } from './LibraryLinkForm.tsx';

/** Where people read how shape libraries work. */
export const SHAPE_LIBRARY_DOCS_URL = 'https://github.com/JimLiu/open-artifact/blob/main/docs/types/whiteboard.md#shape-libraries';

/** Files the "From a file…" picker accepts. */
const LIBRARY_ACCEPT = '.json,.svg,.zip,.xml,.drawio,application/json,image/svg+xml,application/zip,application/x-zip-compressed,application/xml,text/xml';

/** Columns of each shape grid (arrow keys move by this much vertically). */
const COLUMNS = 6;

const NO_LIBRARIES: readonly BoardShapeLibrary[] = [];

/** Sections people folded, kept while the page is open. */
const folded = new Set<string>();

/** Props of {@link ShapeLibraryPanel}. */
export interface ShapeLibraryPanelProps {
  /** A shape was picked (by click or keyboard). */
  onPick(shape: LibraryShape): void;
}

/** Each listed library's file, as it loads. */
function useLoadedLibraries(libraries: readonly BoardShapeLibrary[]): Map<string, LoadedLibrary> {
  const [loaded, setLoaded] = useState(() => new Map<string, LoadedLibrary>());
  useEffect(() => {
    let live = true;
    for (const entry of libraries) {
      void loadShapeLibrary(entry).then((result) => {
        if (!live) return;
        setLoaded((previous) => (previous.get(entry.file) === result ? previous : new Map(previous).set(entry.file, result)));
      });
    }
    return () => {
      live = false;
    };
  }, [libraries]);
  return loaded;
}

/** The Library panel. */
export function ShapeLibraryPanel({ onPick }: ShapeLibraryPanelProps) {
  const libraries = useBoard((state) => state.board.content.shapes) ?? NO_LIBRARIES;
  const loaded = useLoadedLibraries(libraries);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(() => new Set(libraries.map((library) => library.id).filter((id) => !folded.has(id))));
  const [menuFor, setMenuFor] = useState<string | undefined>(undefined);
  const [adding, setAdding] = useState(false);
  const [linking, setLinking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<LibraryImport[] | undefined>(undefined);
  const [dropOver, setDropOver] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const trimmed = query.trim();
  const searching = trimmed !== '';

  // A library added while the panel is open starts unfolded.
  useEffect(() => {
    setOpen((previous) => {
      const missing = libraries.filter((library) => !previous.has(library.id) && !folded.has(library.id));
      return missing.length === 0 ? previous : new Set([...previous, ...missing.map((library) => library.id)]);
    });
  }, [libraries]);

  const add = async (files: File[]) => {
    if (files.length === 0 || busy) return;
    setBusy(true);
    setAdding(false);
    try {
      setReport(await importShapeFiles(files));
    } finally {
      setBusy(false);
    }
  };

  const toggle = (id: string) => {
    setOpen((previous) => {
      const next = new Set(previous);
      if (next.has(id)) {
        next.delete(id);
        folded.add(id);
      } else {
        next.add(id);
        folded.delete(id);
      }
      return next;
    });
  };

  const onGridKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const deltas: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -COLUMNS, ArrowDown: COLUMNS };
    const delta = deltas[event.key];
    if (delta === undefined) return;
    const cells = [...(listRef.current?.querySelectorAll<HTMLButtonElement>('[data-library-cell]') ?? [])];
    const at = cells.indexOf(document.activeElement as HTMLButtonElement);
    if (at < 0) return;
    event.preventDefault();
    cells[Math.max(0, Math.min(cells.length - 1, at + delta))]?.focus();
  };

  const onDragOver = (event: DragEvent<HTMLDivElement>) => {
    if (!dragHasFiles([...event.dataTransfer.types])) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    setDropOver(true);
  };
  const onDragLeave = (event: DragEvent<HTMLDivElement>) => {
    if (!(event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget))) setDropOver(false);
  };
  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    setDropOver(false);
    if (!dragHasFiles([...event.dataTransfer.types])) return;
    // Files dropped here become a library, not pictures on the board.
    event.preventDefault();
    event.stopPropagation();
    void add([...event.dataTransfer.files]);
  };

  const sections = libraries.map((entry) => {
    const result = loaded.get(entry.file);
    const shapes = result?.ok ? result.library.shapes : [];
    return { entry, result, shapes: searching ? shapes.filter((shape) => shapeMatchesQuery(shape, trimmed)) : shapes };
  });
  const nothing = searching && sections.every((section) => section.shapes.length === 0);
  const room = hasRoomForLibrary(libraries);

  return (
    <div
      className={cn('flex w-[min(320px,calc(100vw-24px))] flex-col gap-2 rounded-[10px] p-0.5', dropOver && 'ring-2 ring-chrome-accent')}
      data-wb-library-panel=""
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {libraries.length > 0 ? (
        <label className="flex h-8 min-w-0 items-center gap-1.5 rounded-[8px] bg-chrome-hover px-2 text-chrome-muted focus-within:ring-2 focus-within:ring-chrome-accent">
          <Search className="size-4 shrink-0" aria-hidden="true" />
          <input
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              if (listRef.current) listRef.current.scrollTop = 0;
            }}
            onKeyDown={(event) => {
              if (isComposingKey(event.nativeEvent)) return;
              if (event.key === 'Escape' && query !== '') {
                event.preventDefault();
                event.stopPropagation();
                setQuery('');
              } else if (event.key === 'ArrowDown') {
                event.preventDefault();
                listRef.current?.querySelector<HTMLButtonElement>('[data-library-cell]')?.focus();
              }
            }}
            role="searchbox"
            placeholder="Search shapes"
            aria-label="Search shapes"
            maxLength={40}
            className="min-w-0 flex-1 bg-transparent text-[14px] text-chrome-fg outline-none placeholder:text-chrome-muted"
          />
        </label>
      ) : null}
      <div ref={listRef} onKeyDown={onGridKeyDown} className="max-h-[min(340px,calc(100vh-200px))] overflow-y-auto overscroll-contain">
        {libraries.length === 0 ? (
          <div className="flex flex-col gap-1.5 px-2 py-2 text-[13px] text-chrome-muted">
            <p>A shape library is a set of drawings, such as icons for servers, databases or people, kept with this board. Add one from a file or a link, then click a shape and click the board to place it.</p>
            <a href={SHAPE_LIBRARY_DOCS_URL} target="_blank" rel="noopener noreferrer" className="text-chrome-accent underline-offset-2 hover:underline">
              How shape libraries work
            </a>
          </div>
        ) : null}
        {nothing ? <p role="status" className="px-2 py-1 text-[13px] text-chrome-muted">No matching shapes</p> : null}
        {sections.map(({ entry, result, shapes }) => {
          if (searching && shapes.length === 0) return null;
          const expanded = searching || open.has(entry.id);
          return (
            <div key={entry.id} role="group" aria-label={`Library: ${entry.name}`} data-library-id={entry.id}>
              <div className="sticky top-0 z-[1] flex items-center gap-0.5 bg-chrome">
                <button
                  type="button"
                  aria-expanded={expanded}
                  onClick={() => toggle(entry.id)}
                  disabled={searching}
                  className="flex h-7 min-w-0 flex-1 items-center gap-1 rounded-[6px] px-1 text-left text-[12px] text-chrome-muted outline-none hover:bg-chrome-hover focus-visible:ring-2 focus-visible:ring-chrome-accent"
                >
                  <ChevronRight className={cn('size-3.5 shrink-0 transition-transform', expanded && 'rotate-90')} aria-hidden="true" />
                  <span className="truncate">{entry.name}</span>
                  <span className="shrink-0 tabular-nums">· {result?.ok ? result.library.shapes.length : entry.count}</span>
                </button>
                <Tip label="Library menu" side="top">
                  <button
                    type="button"
                    aria-label={`${entry.name}: library menu`}
                    aria-expanded={menuFor === entry.id}
                    onClick={() => setMenuFor(menuFor === entry.id ? undefined : entry.id)}
                    className="grid size-7 shrink-0 place-items-center rounded-[6px] text-chrome-muted outline-none hover:bg-chrome-hover focus-visible:ring-2 focus-visible:ring-chrome-accent"
                  >
                    <Ellipsis className="size-4" aria-hidden="true" />
                  </button>
                </Tip>
              </div>
              {menuFor === entry.id ? <LibraryMenu entry={entry} onDone={() => setMenuFor(undefined)} /> : null}
              {expanded ? (
                result === undefined ? (
                  <p className="px-2 py-1 text-[13px] text-chrome-muted">Loading…</p>
                ) : !result.ok ? (
                  <p className="px-2 py-1 text-[13px] text-chrome-muted">This library cannot be shown. {result.reason}</p>
                ) : (
                  <div className="grid grid-cols-6 gap-0.5 pb-1">
                    {shapes.map((shape, index) => (
                      <ShapeCell key={`${index}:${shape.name}`} shape={shape} onPick={onPick} />
                    ))}
                  </div>
                )
              ) : null}
            </div>
          );
        })}
      </div>
      {report ? <ImportReport results={report} onDismiss={() => setReport(undefined)} /> : null}
      <div className="flex flex-col gap-0.5 border-t border-chrome-line pt-1">
        <input
          ref={fileInput}
          type="file"
          accept={LIBRARY_ACCEPT}
          multiple
          hidden
          aria-hidden="true"
          data-wb-library-file=""
          onChange={(event) => {
            const files = [...(event.target.files ?? [])];
            event.target.value = '';
            void add(files);
          }}
        />
        <button
          type="button"
          aria-expanded={adding}
          disabled={busy || !room}
          onClick={() => {
            setAdding(!adding);
            setLinking(false);
          }}
          className="flex h-8 items-center gap-1.5 rounded-[8px] px-2 text-[13px] text-chrome-fg outline-none hover:bg-chrome-hover focus-visible:ring-2 focus-visible:ring-chrome-accent disabled:text-chrome-muted"
        >
          <Plus className="size-4" aria-hidden="true" />
          {busy ? 'Adding…' : room ? 'Add library…' : 'This board has the most libraries it can hold'}
        </button>
        {adding ? (
          <button
            type="button"
            onClick={() => fileInput.current?.click()}
            className="ml-6 flex h-8 items-center rounded-[8px] px-2 text-[13px] text-chrome-fg outline-none hover:bg-chrome-hover focus-visible:ring-2 focus-visible:ring-chrome-accent"
          >
            From a file…
          </button>
        ) : null}
        {adding ? (
          <button
            type="button"
            aria-expanded={linking}
            onClick={() => setLinking(!linking)}
            className="ml-6 flex h-8 items-center rounded-[8px] px-2 text-[13px] text-chrome-fg outline-none hover:bg-chrome-hover focus-visible:ring-2 focus-visible:ring-chrome-accent"
          >
            From a link…
          </button>
        ) : null}
        {adding && linking ? (
          <LibraryLinkForm
            onResult={setReport}
            onClose={() => {
              setLinking(false);
              setAdding(false);
            }}
          />
        ) : null}
      </div>
    </div>
  );
}

/** A library's source, licence and "Remove from this board". */
function LibraryMenu({ entry, onDone }: { entry: BoardShapeLibrary; onDone(): void }) {
  return (
    <div role="group" aria-label={`${entry.name}: details`} className="mx-1 mb-1 flex flex-col gap-1 rounded-[8px] bg-chrome-hover px-2 py-1.5 text-[12px] text-chrome-muted">
      <p className="break-words">
        Source:{' '}
        {entry.source ? (
          <a href={entry.source} target="_blank" rel="noopener noreferrer" className="text-chrome-accent underline-offset-2 hover:underline">
            {entry.source}
          </a>
        ) : (
          'not given'
        )}
      </p>
      <p className="break-words">Licence: {entry.license ?? 'not given'}</p>
      <button
        type="button"
        onClick={() => {
          removeShapeLibrary(entry.id);
          onDone();
        }}
        className="self-start rounded-[6px] px-1.5 py-0.5 text-[13px] text-chrome-fg outline-none hover:bg-chrome focus-visible:ring-2 focus-visible:ring-chrome-accent"
      >
        Remove from this board
      </button>
    </div>
  );
}

/** What the last import did: shapes added, and each left out with why. */
function ImportReport({ results, onDismiss }: { results: readonly LibraryImport[]; onDismiss(): void }) {
  return (
    <div role="status" data-wb-library-report="" className="flex flex-col gap-1 rounded-[8px] bg-chrome-hover px-2 py-1.5 text-[12px] text-chrome-fg">
      {results.map((result, index) => {
        const leftOut = result.leftOut;
        const over = result.ok ? result.overLimit : 0;
        return (
          <div key={index}>
            <p>
              {result.ok
                ? `Added “${result.name}”: ${result.added} ${result.added === 1 ? 'shape' : 'shapes'}${leftOut.length + over > 0 ? `, ${leftOut.length + over} left out.` : '.'}`
                : `“${result.name}” was not added. ${result.reason}`}
            </p>
            {leftOut.length > 0 ? (
              <ul className="ml-3 list-disc text-chrome-muted">
                {leftOut.slice(0, 8).map((shape, at) => (
                  <li key={at}>
                    {shape.name}: {shape.reason}
                  </li>
                ))}
                {leftOut.length > 8 ? <li>and {leftOut.length - 8} more</li> : null}
              </ul>
            ) : null}
            {over > 0 ? <p className="text-chrome-muted">{over} more past the 500-shape limit.</p> : null}
          </div>
        );
      })}
      <button type="button" onClick={onDismiss} className="self-end rounded-[6px] px-1.5 text-chrome-muted outline-none hover:text-chrome-fg focus-visible:ring-2 focus-visible:ring-chrome-accent">
        Dismiss
      </button>
    </div>
  );
}

/** One shape button: a picture of the shape; its name is the tooltip. */
function ShapeCell({ shape, onPick }: { shape: LibraryShape; onPick(shape: LibraryShape): void }) {
  const scheme = useColorScheme();
  const src = useMemo(() => drawnImageSrcForPen(svgToBase64DataUrl(shape.svg), drawnImagePen(scheme)), [shape, scheme]);
  return (
    <Tip label={shape.name} side="top">
      <button
        type="button"
        data-library-cell=""
        aria-label={`Pick shape: ${shape.name}`}
        onClick={() => onPick(shape)}
        className="grid aspect-square place-items-center rounded-[8px] outline-none transition-transform hover:bg-chrome-hover focus-visible:ring-2 focus-visible:ring-chrome-accent active:scale-95"
      >
        <img src={src} alt="" draggable={false} className="size-8 object-contain" />
      </button>
    </Tip>
  );
}
