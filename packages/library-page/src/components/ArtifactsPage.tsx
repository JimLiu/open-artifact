/**
 * The Open Artifact page: an entry in the app's left sidebar that lists every artifact in the open-artifact library,
 * as Artifacts page lists a person's artifacts:
 *
 *   Open Artifact                          [search] [filter] [list/grid] [+]
 *
 *   Make something new
 *   [ Slides ] [ Design ] [ Whiteboard ] …
 *
 *   ┌────────────┐ ┌────────────┐ ┌────────────┐
 *   │ thumbnail  │ │ thumbnail  │ │ thumbnail  │
 *   │▣ Q3 results│ │▣ Landing   │ │▣ Brand kit │
 *   └────────────┘ └────────────┘ └────────────┘
 *
 * The tiles are the types the daemon has installed. A tile starts a session to make one of that type (how is the
 * host's: `PageHost.create`, store.ts). A pointer resting on a tile shows a card with what the type makes and a button
 * that does what the tile does (keyboard focus shows it too).
 *
 * A card opens the artifact's page (the Shell: comments, share, export) where the host shows it (`PageHost.show`). Its
 * thumbnail is a picture of its editor, taken by the host (`PageHost.capture`) again when its files changed. Its menu
 * pins, renames, copies the link, opens the share panel and deletes.
 */
import { type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type ReactNode, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { PageArtifact, TypeTile } from '../library/routes.ts';
import { usePageEnv, useSessionTitle } from '../env.tsx';
import { countByType, DATES, isFiltered, NO_FILTERS, NO_PROJECT, projectChoices, projectName, SHARINGS, SORTS, visibleArtifacts, type Filters, type ProjectChoice } from '../filters.ts';
import { isKey, type Translate } from '../i18n.ts';
import { ArtifactsIcon, BETA, Doodle, Drawn, Icon, ICON, inTypeOrder, svg, TypeIcon, typeStyle } from '../look.tsx';
import { usePage } from '../store.ts';
import { ChangelogFooter, ChangelogView, closeChangelog, useChangelog, WhatsNewPanel } from '../changelog.tsx';
import { UpdatePanel } from '../updates.tsx';
import { ago, useNow } from '../time.ts';

/** A type's name: the page's word for it, else the daemon's title. */
function typeLabel(t: Translate, id: string, title?: string): string {
  const key = `type.${id}`;
  return isKey(key) ? t(key) : title || id;
}

/** What a type makes: the page's words for it, else the daemon's description. */
function typeAbout(t: Translate, id: string, description?: string): string {
  const key = `about.${id}`;
  return isKey(key) ? t(key) : description || '';
}

// ---------- the picture ----------

function Preview({ artifact }: { artifact: PageArtifact }) {
  const { api } = usePageEnv();
  const url = artifact.thumbnail === null ? null : api.thumbnailUrl(artifact.id, artifact.thumbnail);
  const [broken, setBroken] = useState<string | null>(null);
  const shown = url !== null && broken !== url;
  return (
    <span className="oa-preview" data-stack={shown && artifact.type === 'docs'}>
      {shown ? (
        <span className="oa-sheet">
          <img src={url} alt="" draggable={false} onError={() => setBroken(url)} />
        </span>
      ) : (
        <Drawn type={artifact.type} title={artifact.title} />
      )}
    </span>
  );
}

// ---------- menus and dialogs ----------

const ITEMS = '[role^=menuitem]';

/** Up and down move among a menu's items; right and left go in and out of a submenu; Escape closes. */
function menuKeys(event: ReactKeyboardEvent<HTMLElement>, close: () => void): void {
  if (event.key === 'Escape') {
    event.preventDefault();
    event.stopPropagation();
    close();
    return;
  }
  if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
  event.preventDefault();
  event.stopPropagation();
  const items = [...event.currentTarget.querySelectorAll<HTMLElement>(ITEMS)].filter((item) => item.closest('[role=menu]') === event.currentTarget);
  const at = items.indexOf(document.activeElement as HTMLElement);
  items[(at + (event.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length]?.focus();
}

/** A menu that hangs from the button that opened it, right edges together, or above it when there is no room below. */
function Menu({ anchor, label, onClose, onKey, children }: { anchor: HTMLElement; label: string; onClose(): void; onKey?(key: string): boolean; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<CSSProperties>({ visibility: 'hidden' });
  useLayoutEffect(() => {
    const box = anchor.getBoundingClientRect();
    const height = ref.current?.offsetHeight ?? 0;
    const width = ref.current?.offsetWidth ?? 0;
    const right = Math.max(8, window.innerWidth - box.right);
    const fits = box.bottom + 6 + height <= window.innerHeight - 8;
    setPlace({
      right: window.innerWidth - right - width < 8 ? window.innerWidth - width - 8 : right,
      ...(fits ? { top: box.bottom + 6 } : { bottom: Math.max(8, window.innerHeight - box.top + 6) }),
    });
  }, [anchor]);
  // Once it is placed (a hidden element takes no focus), so its keys work however it was opened.
  const placed = place.visibility !== 'hidden';
  useEffect(() => {
    if (placed) ref.current?.querySelector<HTMLElement>(ITEMS)?.focus({ preventScroll: true });
  }, [placed]);
  useEffect(() => {
    const away = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!ref.current?.contains(target) && !anchor.contains(target)) onClose();
    };
    const gone = () => onClose();
    document.addEventListener('pointerdown', away, true);
    window.addEventListener('resize', gone);
    return () => {
      document.removeEventListener('pointerdown', away, true);
      window.removeEventListener('resize', gone);
    };
  }, [anchor, onClose]);
  return (
    <div
      ref={ref}
      className="oa-menu"
      role="menu"
      aria-label={label}
      style={place}
      onKeyDown={(event) => {
        if (onKey && !event.metaKey && !event.ctrlKey && !event.altKey && onKey(event.key.toLowerCase())) {
          event.preventDefault();
          return;
        }
        menuKeys(event, () => {
          onClose();
          anchor.focus();
        });
      }}
    >
      {children}
    </div>
  );
}

function ChoiceItem({ label, on, count, onPick }: { label: string; on: boolean; count?: number; onPick(): void }) {
  return (
    <button type="button" className="oa-menu-item" role="menuitemradio" aria-checked={on} onClick={onPick}>
      <span className="oa-menu-label">{label}</span>
      {count !== undefined && <span className="oa-menu-count">{count}</span>}
      {on && (
        <span className="oa-tick">
          <Icon d={ICON.tick} />
        </span>
      )}
    </button>
  );
}

/** A row of the filter menu with its choices beside it: open while hovered or clicked. */
function SubMenu({ id, label, value, open, setOpen, children }: { id: string; label: string; value: string; open: string | null; setOpen(id: string | null): void; children: ReactNode }) {
  const isOpen = open === id;
  const panel = useRef<HTMLDivElement>(null);
  const [flip, setFlip] = useState(false);
  useLayoutEffect(() => {
    if (isOpen && panel.current) setFlip(panel.current.getBoundingClientRect().right + (flip ? panel.current.offsetWidth : 0) > window.innerWidth - 8);
    // Only when it opens: flipping moves it, which would decide the other way.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);
  return (
    <div className="oa-menu-row" onMouseEnter={() => setOpen(id)}>
      <button
        type="button"
        className="oa-menu-item"
        role="menuitem"
        aria-haspopup="menu"
        aria-expanded={isOpen}
        onClick={() => setOpen(isOpen ? null : id)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowRight' || event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            setOpen(id);
            requestAnimationFrame(() => panel.current?.querySelector<HTMLElement>(ITEMS)?.focus());
          }
        }}
      >
        <span className="oa-menu-label">{label}</span>
        <span className="oa-menu-value">{value}</span>
        <span className="oa-menu-chev">
          <Icon d={ICON.chevron} size={12} />
        </span>
      </button>
      {isOpen && (
        <div
          ref={panel}
          className="oa-submenu"
          role="menu"
          aria-label={label}
          data-flip={flip}
          onKeyDown={(event) => {
            if (event.key === 'ArrowLeft' || event.key === 'Escape') {
              event.preventDefault();
              event.stopPropagation();
              setOpen(null);
              (event.currentTarget.previousElementSibling as HTMLElement | null)?.focus();
              return;
            }
            menuKeys(event, () => setOpen(null));
          }}
        >
          {children}
        </div>
      )}
    </div>
  );
}

function FilterMenu({ anchor, filters, setFilters, types, counts, projects, t, onClose }: {
  anchor: HTMLElement;
  filters: Filters;
  setFilters(next: Filters): void;
  types: readonly { id: string; title: string }[];
  counts: Map<string, number>;
  /** The projects the library has artifacts of; empty: no project menu. */
  projects: readonly ProjectChoice[];
  t: Translate;
  onClose(): void;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const titleOf = (id: string) => typeLabel(t, id, types.find((type) => type.id === id)?.title);
  const typeValue = filters.types.length === 0 ? t('filter.any') : filters.types.length === 1 ? titleOf(filters.types[0]!) : t('filter.some', { count: String(filters.types.length) });
  const projectLabel = (choice: ProjectChoice) => (choice.project === NO_PROJECT ? t('filter.noProject') : choice.label);
  const pickedProject = projects.find((choice) => choice.project === filters.projects[0]);
  const projectValue =
    filters.projects.length === 0 ? t('filter.any') : filters.projects.length === 1 ? (pickedProject ? projectLabel(pickedProject) : projectName(filters.projects[0]!)) : t('filter.some', { count: String(filters.projects.length) });
  return (
    <Menu anchor={anchor} label={t('filter.button')} onClose={onClose}>
      <SubMenu id="sort" label={t('filter.sort')} value={t(`sort.${filters.sort}`)} open={open} setOpen={setOpen}>
        {SORTS.map((sort) => (
          <ChoiceItem key={sort} label={t(`sort.${sort}`)} on={filters.sort === sort} onPick={() => setFilters({ ...filters, sort })} />
        ))}
      </SubMenu>
      <div className="oa-menu-rule" role="separator" />
      <SubMenu id="type" label={t('filter.type')} value={typeValue} open={open} setOpen={setOpen}>
        {types.map(({ id }) => {
          const on = filters.types.includes(id);
          return (
            <button
              key={id}
              type="button"
              className="oa-menu-item"
              role="menuitemcheckbox"
              aria-checked={on}
              onClick={() => setFilters({ ...filters, types: on ? filters.types.filter((x) => x !== id) : [...filters.types, id] })}
            >
              <span className="oa-check" data-on={on}>
                <Icon d={ICON.tick} size={12} />
              </span>
              <span className="oa-menu-label">{titleOf(id)}</span>
              <span className="oa-menu-count">{counts.get(id) ?? 0}</span>
            </button>
          );
        })}
      </SubMenu>
      {projects.length > 0 && (
        <SubMenu id="project" label={t('filter.project')} value={projectValue} open={open} setOpen={setOpen}>
          {projects.map((choice) => {
            const on = filters.projects.includes(choice.project);
            return (
              <button
                key={choice.project || 'none'}
                type="button"
                className="oa-menu-item"
                role="menuitemcheckbox"
                aria-checked={on}
                title={choice.project || undefined}
                data-project={choice.project}
                onClick={() => setFilters({ ...filters, projects: on ? filters.projects.filter((x) => x !== choice.project) : [...filters.projects, choice.project] })}
              >
                <span className="oa-check" data-on={on}>
                  <Icon d={ICON.tick} size={12} />
                </span>
                <span className="oa-menu-label">{projectLabel(choice)}</span>
                <span className="oa-menu-count">{choice.count}</span>
              </button>
            );
          })}
        </SubMenu>
      )}
      <SubMenu id="date" label={t('filter.date')} value={t(`date.${filters.date}`)} open={open} setOpen={setOpen}>
        {DATES.map((date) => (
          <ChoiceItem key={date} label={t(`date.${date}`)} on={filters.date === date} onPick={() => setFilters({ ...filters, date })} />
        ))}
      </SubMenu>
      <SubMenu id="sharing" label={t('filter.sharing')} value={t(`sharing.${filters.sharing}`)} open={open} setOpen={setOpen}>
        {SHARINGS.map((sharing) => (
          <ChoiceItem key={sharing} label={t(`sharing.${sharing}`)} on={filters.sharing === sharing} onPick={() => setFilters({ ...filters, sharing })} />
        ))}
      </SubMenu>
      <div className="oa-menu-rule" role="separator" />
      <div onMouseEnter={() => setOpen(null)}>
        <button type="button" className="oa-menu-item" role="menuitemcheckbox" aria-checked={filters.pinned} onClick={() => setFilters({ ...filters, pinned: !filters.pinned })}>
          <span className="oa-menu-label">{t('filter.pinned')}</span>
          {filters.pinned && (
            <span className="oa-tick">
              <Icon d={ICON.tick} />
            </span>
          )}
        </button>
        {isFiltered(filters) && (
          <button type="button" className="oa-menu-item" role="menuitem" onClick={() => setFilters({ ...NO_FILTERS, sort: filters.sort })}>
            <span className="oa-menu-label">{t('filter.clear')}</span>
          </button>
        )}
      </div>
    </Menu>
  );
}

type Act = 'pin' | 'rename' | 'copy' | 'share' | 'delete';

/** A host's own item in a card's "More" menu (after Share): its words, an optional icon (a 16×16 path), and what it does. */
export interface CardAction {
  id: string;
  label: string;
  icon?: string;
  run(artifact: PageArtifact): void;
}

function ActionsMenu({
  anchor,
  artifact,
  t,
  onClose,
  act,
  extra = [],
  onExtra,
}: {
  anchor: HTMLElement;
  artifact: PageArtifact;
  t: Translate;
  onClose(): void;
  act: (what: Act) => void;
  extra?: readonly CardAction[];
  onExtra?: (action: CardAction) => void;
}) {
  const item = (what: Exclude<Act, 'delete'>, icon: ReactNode | string, label: string, key: string) => (
    <button type="button" className="oa-menu-item" role="menuitem" aria-keyshortcuts={key} onClick={() => act(what)}>
      <Icon d={icon} />
      <span className="oa-menu-label">{label}</span>
      <kbd className="oa-menu-key">{key}</kbd>
    </button>
  );
  return (
    <Menu
      anchor={anchor}
      label={t('action.more')}
      onClose={onClose}
      onKey={(key) => {
        const what = ({ p: 'pin', r: 'rename', c: 'copy', s: 'share' } as const)[key];
        if (what === undefined) return false;
        act(what);
        return true;
      }}
    >
      {item('pin', ICON.pin, t(artifact.pinned ? 'action.unpin' : 'action.pin'), 'P')}
      {item('rename', ICON.rename, t('action.rename'), 'R')}
      {item('copy', ICON.link, t('action.copy'), 'C')}
      {item('share', ICON.share, t('action.share'), 'S')}
      {extra.map((action) => (
        <button key={action.id} type="button" className="oa-menu-item" role="menuitem" data-action={action.id} onClick={() => onExtra?.(action)}>
          <Icon d={action.icon ?? ''} />
          <span className="oa-menu-label">{action.label}</span>
        </button>
      ))}
      <div className="oa-menu-rule" role="separator" />
      <button type="button" className="oa-menu-item" role="menuitem" data-danger="true" onClick={() => act('delete')}>
        <Icon d={ICON.trash} />
        <span className="oa-menu-label">{t('action.delete')}</span>
      </button>
    </Menu>
  );
}

function CreateMenu({ anchor, tiles, canCreate, t, onClose, create }: { anchor: HTMLElement; tiles: readonly TypeTile[]; canCreate: boolean; t: Translate; onClose(): void; create(type?: string): void }) {
  return (
    <Menu anchor={anchor} label={t('create.new')} onClose={onClose}>
      <button type="button" className="oa-menu-item" role="menuitem" disabled={!canCreate} onClick={() => create()}>
        <Icon d={ICON.chat} />
        <span className="oa-menu-label">{t('create.session')}</span>
      </button>
      {tiles.length > 0 && <div className="oa-menu-rule" role="separator" />}
      {tiles.map((tile) => (
        <button key={tile.id} type="button" className="oa-menu-item" role="menuitem" data-type={tile.id} onClick={() => create(tile.id)} style={typeStyle(tile.id)}>
          <span className="oa-menu-glyph">
            <TypeIcon type={tile.id} size={16} />
          </span>
          <span className="oa-menu-label">{typeLabel(t, tile.id, tile.title)}</span>
        </button>
      ))}
    </Menu>
  );
}

function Dialog({ label, onClose, children, wide = false }: { label: string; onClose(): void; children: ReactNode; wide?: boolean }) {
  return (
    <div
      className="oa-scrim"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation();
          onClose();
        }
      }}
    >
      <div className="oa-dialog" role="dialog" aria-modal="true" aria-label={label} {...(wide ? { 'data-wide': 'true' } : {})}>
        {children}
      </div>
    </div>
  );
}

function RenameDialog({ artifact, t, onClose, onSave }: { artifact: PageArtifact; t: Translate; onClose(): void; onSave(title: string): void }) {
  const [title, setTitle] = useState(artifact.title);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);
  const clean = title.trim();
  const ready = clean !== '' && clean !== artifact.title;
  return (
    <Dialog label={t('rename.title')} onClose={onClose}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (ready) onSave(clean);
        }}
      >
        <h2>{t('rename.title')}</h2>
        <input ref={input} value={title} aria-label={t('rename.title')} maxLength={200} onChange={(event) => setTitle(event.target.value)} />
        <div className="oa-dialog-actions">
          <button type="button" className="oa-btn" onClick={onClose}>
            {t('dialog.cancel')}
          </button>
          <button type="submit" className="oa-btn" data-primary="true" disabled={!ready}>
            {t('rename.save')}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

function DeleteDialog({ artifact, t, onClose, onDelete }: { artifact: PageArtifact; t: Translate; onClose(): void; onDelete(): void }) {
  const confirm = useRef<HTMLButtonElement>(null);
  useEffect(() => confirm.current?.focus(), []);
  const title = t('delete.title', { title: artifact.title });
  return (
    <Dialog label={title} onClose={onClose}>
      <h2>{title}</h2>
      <p>{t('delete.moves')}</p>
      <div className="oa-dialog-actions">
        <button type="button" className="oa-btn" onClick={onClose}>
          {t('dialog.cancel')}
        </button>
        <button ref={confirm} type="button" className="oa-btn" data-danger="true" onClick={onDelete}>
          {t('delete.confirm')}
        </button>
      </div>
    </Dialog>
  );
}

function ToastBar() {
  const { t } = usePageEnv();
  const toast = usePage((s) => s.toast);
  const dismiss = usePage((s) => s.dismissToast);
  const undo = usePage((s) => s.undo);
  useEffect(() => {
    if (toast === null) return;
    const timer = setTimeout(dismiss, toast.undo || toast.kind === 'error' ? 10_000 : 4_000);
    return () => clearTimeout(timer);
  }, [toast, dismiss]);
  if (toast === null) return null;
  return (
    <div key={toast.id} className="oa-toast" role={toast.kind === 'error' ? 'alert' : 'status'} data-kind={toast.kind}>
      <Icon d={ICON.info} />
      <span className="oa-toast-text">{toast.message}</span>
      {toast.undo && (
        <button type="button" className="oa-toast-undo" onClick={() => void undo(toast.undo!)}>
          {t('toast.undo')}
        </button>
      )}
      <button type="button" className="oa-toast-close" aria-label={t('toast.close')} onClick={dismiss}>
        <Icon d={ICON.clear} size={14} />
      </button>
    </div>
  );
}

// ---------- the list ----------

interface ItemProps {
  artifact: PageArtifact;
  opening: string | null;
  conversation: string;
  now: number;
  t: Translate;
  onOpen(artifact: PageArtifact): void;
  onPin(artifact: PageArtifact): void;
  menuOpen: boolean;
  onMenu(artifact: PageArtifact, button: HTMLElement): void;
}

/** A card's tooltip: its folder, the project it was made for when its folder is somewhere else, and its conversation. */
const hint = (artifact: PageArtifact, conversation: string) =>
  [artifact.root, artifact.project && !artifact.root.startsWith(artifact.project) ? artifact.project : '', conversation].filter(Boolean).join('\n');

function PinButton({ artifact, t, onPin }: Pick<ItemProps, 'artifact' | 't' | 'onPin'>) {
  const label = t(artifact.pinned ? 'action.unpin' : 'action.pin');
  return (
    <button type="button" className="oa-act" data-on={artifact.pinned} aria-pressed={artifact.pinned} aria-label={label} title={label} onClick={() => onPin(artifact)}>
      {artifact.pinned ? (
        <svg viewBox="0 0 16 16" aria-hidden="true" style={svg(16)}>
          <path d="M9.75 2.25 13.75 6.25M10.75 3.25 7 6.25 4.5 6.5 9.5 11.5 9.75 9 12.75 5.25M7 9l-4 4" fill="currentColor" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ) : (
        <Icon d={ICON.pin} />
      )}
    </button>
  );
}

function MoreButton({ artifact, t, menuOpen, onMenu, extra }: Pick<ItemProps, 'artifact' | 't' | 'menuOpen' | 'onMenu'> & { extra?: string }) {
  return (
    <button type="button" className={`oa-act ${extra ?? ''}`} aria-label={t('action.more')} title={t('action.more')} aria-haspopup="menu" aria-expanded={menuOpen} onClick={(event) => onMenu(artifact, event.currentTarget)}>
      <Icon d={ICON.more} />
    </button>
  );
}

function Card({ artifact, opening, conversation, now, t, onOpen, onPin, menuOpen, onMenu }: ItemProps) {
  const busy = opening === artifact.id;
  return (
    <li className="oa-item" data-menu={menuOpen} style={typeStyle(artifact.type)}>
      <button type="button" className="oa-card" disabled={opening !== null} aria-busy={busy} title={hint(artifact, conversation)} onClick={() => onOpen(artifact)} data-type={artifact.type}>
        <span className="oa-preview-wrap" style={{ display: 'block', position: 'relative', width: '100%' }}>
          <Preview artifact={artifact} />
          {busy && (
            <span className="oa-busy">
              <span className="oa-spinner" />
              {t('card.opening')}
            </span>
          )}
        </span>
        <span className="oa-info">
          <span className="oa-glyph">
            <TypeIcon type={artifact.type} />
          </span>
          <span className="oa-text">
            <span className="oa-name">{artifact.title}</span>
            <span className="oa-meta">
              {artifact.project ? <span className="oa-project" data-project={artifact.project}>{projectName(artifact.project)} · </span> : null}
              {ago(artifact.openedAt, now, t)}
            </span>
          </span>
        </span>
      </button>
      <div className="oa-actions">
        <MoreButton artifact={artifact} t={t} menuOpen={menuOpen} onMenu={onMenu} />
        <PinButton artifact={artifact} t={t} onPin={onPin} />
      </div>
    </li>
  );
}

function Row({ artifact, opening, conversation, now, t, onOpen, onPin, menuOpen, onMenu }: ItemProps) {
  const busy = opening === artifact.id;
  return (
    <li className="oa-item" data-menu={menuOpen} style={typeStyle(artifact.type)}>
      <button type="button" className="oa-row" disabled={opening !== null} aria-busy={busy} title={hint(artifact, conversation)} onClick={() => onOpen(artifact)} data-type={artifact.type}>
        <span className="oa-glyph">{busy ? <span className="oa-spinner" /> : <TypeIcon type={artifact.type} />}</span>
        <span className="oa-name">{artifact.title}</span>
        <span className="oa-meta">
          {busy ? (
            t('card.opening')
          ) : (
            <>
              {artifact.project ? <span className="oa-project" data-project={artifact.project}>{projectName(artifact.project)} · </span> : null}
              {ago(artifact.openedAt, now, t)}
            </>
          )}
        </span>
      </button>
      <div className="oa-row-tools">
        {artifact.shared && (
          <span className="oa-shared" title={t('card.shared')} aria-label={t('card.shared')}>
            <Icon d={ICON.people} />
          </span>
        )}
        <PinButton artifact={artifact} t={t} onPin={onPin} />
        <MoreButton artifact={artifact} t={t} menuOpen={menuOpen} onMenu={onMenu} extra="oa-act-more" />
      </div>
    </li>
  );
}

type Popup = { kind: 'filter'; anchor: HTMLElement } | { kind: 'create'; anchor: HTMLElement } | { kind: 'actions'; anchor: HTMLElement; id: string };

/** How long the pointer rests on a tile before its card shows, and how long the card stays once the pointer has left. */
const PEEK_SHOW_MS = 350;
const PEEK_HIDE_MS = 160;
const PEEK_ABOUT_ID = 'oa-peek-about';

function TilePeek({ tile, anchor, t, onAct, onEnter, onLeave, onClose }: {
  tile: TypeTile;
  anchor: HTMLElement;
  t: Translate;
  onAct(): void;
  onEnter(): void;
  onLeave(): void;
  onClose(): void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<CSSProperties>({ visibility: 'hidden' });
  useLayoutEffect(() => {
    const box = anchor.getBoundingClientRect();
    const width = ref.current?.offsetWidth ?? 0;
    const height = ref.current?.offsetHeight ?? 0;
    const below = box.bottom + 8;
    setPlace({
      left: Math.max(8, Math.min(box.left, window.innerWidth - width - 8)),
      top: below + height <= window.innerHeight - 8 ? below : Math.max(8, box.top - 8 - height),
    });
  }, [anchor]);
  useEffect(() => {
    const gone = () => onClose();
    window.addEventListener('scroll', gone, true);
    window.addEventListener('resize', gone);
    return () => {
      window.removeEventListener('scroll', gone, true);
      window.removeEventListener('resize', gone);
    };
  }, [onClose]);
  const label = typeLabel(t, tile.id, tile.title);
  return (
    <div
      ref={ref}
      className="oa-peek"
      role="group"
      aria-label={label}
      data-testid="open-artifact-peek"
      data-type={tile.id}
      style={{ ...typeStyle(tile.id), ...place }}
      onPointerEnter={onEnter}
      onPointerLeave={onLeave}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          onClose();
          anchor.focus();
        }
      }}
    >
      <div className="oa-peek-title">{label}</div>
      <div className="oa-peek-by">{t('peek.by')}</div>
      <p className="oa-peek-about" id={PEEK_ABOUT_ID}>
        {typeAbout(t, tile.id, tile.description)}
      </p>
      <button type="button" className="oa-peek-act" onClick={onAct}>
        {t('peek.start')}
      </button>
    </div>
  );
}

/** A group of type tiles under a heading of its own ({@link ArtifactsPageProps.tileGroups}). */
export interface TileGroup {
  /** On the group's element as `data-group`, for the host's CSS. */
  id: string;
  /** The group's heading. */
  title: string;
  /** The type ids in the group, in the order the tiles show. Ones that are not installed are left out. */
  types: readonly string[];
}

/** The installed tiles in their groups: what no group names goes at the end of the last one; empty groups are left out. */
function groupTiles(tiles: readonly TypeTile[], groups: readonly TileGroup[]): { group: TileGroup; tiles: TypeTile[] }[] {
  const placed = new Set(groups.flatMap((group) => group.types));
  const rest = tiles.filter((tile) => !placed.has(tile.id));
  return groups
    .map((group, at) => ({
      group,
      tiles: [...group.types.map((id) => tiles.find((tile) => tile.id === id)).filter((tile): tile is TypeTile => tile !== undefined), ...(at === groups.length - 1 ? rest : [])],
    }))
    .filter((entry) => entry.tiles.length > 0);
}

/** Props of {@link ArtifactsPage}. */
export interface ArtifactsPageProps {
  /** The app can start a session from here: the type tiles and the New button. */
  canCreate: boolean;
  /** The search button in the heading (default `true`). Without it the search box shows only when the host asks for it (`focusSearch`) or while there is a query. */
  searchButton?: boolean;
  /** The New button in the heading, with `canCreate` (default `true`). The tiles stay either way. */
  createButton?: boolean;
  /** The type tiles in groups, each under its own heading, instead of one row under "Make something new" (default: one row). */
  tileGroups?: readonly TileGroup[];
  /** The host's look, on the page's root as `data-theme`: `dark` draws the dark one. */
  theme?: 'light' | 'dark';
  /** The host's platform, on the page's root as `data-platform`: `darwin` leaves room for a macOS title bar. */
  platform?: string;
  /** The host's own controls at the start of the heading's tools (e.g. a status button); none by default. */
  headingTools?: ReactNode;
  /** The host's own items in each card's "More" menu, after Share (e.g. a desktop app's Show in Finder); none by default. */
  cardActions?: readonly CardAction[];
}

/** The page. */
export function ArtifactsPage({ canCreate, theme, platform, searchButton = true, createButton = true, tileGroups, headingTools, cardActions }: ArtifactsPageProps) {
  const { t } = usePageEnv();
  const sessionTitle = useSessionTitle();
  const status = usePage((s) => s.status);
  const artifacts = usePage((s) => s.artifacts);
  const types = usePage((s) => s.types);
  const error = usePage((s) => s.error);
  const opening = usePage((s) => s.opening);
  const filters = usePage((s) => s.filters);
  const query = usePage((s) => s.query);
  const layout = usePage((s) => s.layout);
  const dialog = usePage((s) => s.dialog);
  const searchFocus = usePage((s) => s.searchFocus);
  const { reload, watchEvents, watchThumbnails, setFilters, setQuery, setLayout, openDialog, closeDialog, open, create, pin, rename, copyLink, share, remove } = usePage((s) => s);
  // The card of the tile the pointer rests on, and the timer that shows or hides it.
  const [peek, setPeek] = useState<{ id: string; anchor: HTMLElement } | null>(null);
  const peekTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const overPeek = useRef(false);
  const [searching, setSearching] = useState(false);
  const [popup, setPopup] = useState<Popup | null>(null);
  const searchBox = useRef<HTMLInputElement>(null);
  const now = useNow();
  const changelogOpen = useChangelog().open;

  useEffect(() => {
    void reload();
    // The events keep the list current; coming back to the window reads it again in case they could not.
    const again = () => {
      if (document.visibilityState === 'visible') void reload();
    };
    document.addEventListener('visibilitychange', again);
    return () => document.removeEventListener('visibilitychange', again);
  }, [reload]);
  useEffect(() => watchEvents(), [watchEvents]);
  useEffect(() => watchThumbnails(), [watchThumbnails]);

  useEffect(() => {
    if (searching) searchBox.current?.focus();
  }, [searching]);
  // The host's own search entry: the box shows (the effect above focuses it), or takes the keyboard when it shows already.
  useEffect(() => {
    if (searchFocus === 0) return;
    setSearching(true);
    searchBox.current?.focus();
    searchBox.current?.select();
  }, [searchFocus]);

  const counts = useMemo(() => countByType(artifacts), [artifacts]);
  const projects = useMemo(() => projectChoices(artifacts, t('time.locale')), [artifacts, t]);
  
  const tiles = useMemo(() => inTypeOrder(types.map((type) => type.id)).map((id) => types.find((type) => type.id === id)!), [types]);
  // A type shows in the filter when it is installed or something listed is of it.
  const filterTypes = useMemo(
    () =>
      inTypeOrder([...types.map((type) => type.id), ...counts.keys()]).map((id) => ({
        id,
        title: types.find((type) => type.id === id)?.title || artifacts.find((a) => a.type === id)?.typeTitle || id,
      })),
    [types, counts, artifacts],
  );

  const closePeek = useMemo(
    () => () => {
      clearTimeout(peekTimer.current);
      overPeek.current = false;
      setPeek(null);
    },
    [],
  );
  useEffect(() => () => clearTimeout(peekTimer.current), []);
  /** Show a tile's card: after a rest, or at once when a card is up already (moving along the row) or for the keyboard. */
  const showPeek = (id: string, anchor: HTMLElement, at_once = false) => {
    clearTimeout(peekTimer.current);
    peekTimer.current = setTimeout(() => setPeek({ id, anchor }), at_once || peek !== null ? 0 : PEEK_SHOW_MS);
  };
  const hidePeek = () => {
    clearTimeout(peekTimer.current);
    peekTimer.current = setTimeout(() => setPeek(null), PEEK_HIDE_MS);
  };
  /** What a tile, and its card's button, do: start a session that makes one of its type. */
  const tileAct = (id: string) => {
    closePeek();
    create(id);
  };

  const shown = useMemo(
    () => visibleArtifacts(artifacts, { filters, query, now, locale: t('time.locale'), sessionTitle }),
    [artifacts, filters, query, now, t, sessionTitle],
  );

  const closePopup = useMemo(() => () => setPopup(null), []);
  const actionsFor = popup?.kind === 'actions' ? artifacts.find((a) => a.id === popup.id) : undefined;
  const dialogFor = dialog ? artifacts.find((a) => a.id === dialog.id) : undefined;
  const peekTile = peek === null ? undefined : tiles.find((tile) => tile.id === peek.id);

  const itemProps = (artifact: PageArtifact): ItemProps => ({
    artifact,
    opening,
    conversation: sessionTitle(artifact.sessionId),
    now,
    t,
    onOpen: (a) => void open(a),
    onPin: (a) => void pin(a, !a.pinned),
    menuOpen: popup?.kind === 'actions' && popup.id === artifact.id,
    onMenu: (a, anchor) => setPopup((p) => (p?.kind === 'actions' && p.id === a.id ? null : { kind: 'actions', anchor, id: a.id })),
  });

  /** One type tile, in the row or in a group. */
  const tileItem = (tile: TypeTile) => {
    const peeking = peek?.id === tile.id;
    return (
      <li key={tile.id} onPointerEnter={(event) => event.pointerType !== 'touch' && showPeek(tile.id, event.currentTarget.firstElementChild as HTMLElement)} onPointerLeave={hidePeek}>
        <button
          type="button"
          className="oa-tile"
          data-type={tile.id}
          {...(peeking ? { 'data-peek': 'true', 'aria-describedby': PEEK_ABOUT_ID } : {})}
          style={typeStyle(tile.id)}
          onClick={() => tileAct(tile.id)}
          onFocus={(event) => {
            if (event.currentTarget.matches(':focus-visible')) showPeek(tile.id, event.currentTarget, true);
          }}
          onBlur={() => {
            if (!overPeek.current) hidePeek();
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape' && peek !== null) closePeek();
          }}
        >
          <span className="oa-tile-art">
            <Doodle type={tile.id} />
            <TypeIcon type={tile.id} size={42} />
            {BETA.includes(tile.id) && <span className="oa-tile-beta">{t('tile.beta')}</span>}
          </span>
          <span className="oa-tile-label">{typeLabel(t, tile.id, tile.title)}</span>
        </button>
      </li>
    );
  };

  const toggle = (kind: 'filter' | 'create', anchor: HTMLElement) => setPopup((p) => (p?.kind === kind ? null : { kind, anchor }));

  return (
    <section className="oa-page" aria-label={t('title')} data-testid="open-artifact-page" data-theme={theme} data-platform={platform}>
      <div className="oa-scroll">
        <div className="oa-content">
          <div className="oa-heading">
            <h1>{t('title')}</h1>
            <div className="oa-tools">
              {headingTools}
              {searching || query ? (
                <label className="oa-search">
                  <Icon d={ICON.search} size={14} />
                  <input
                    ref={searchBox}
                    type="search"
                    value={query}
                    placeholder={t('search')}
                    aria-label={t('search')}
                    onChange={(e) => setQuery(e.target.value)}
                    onBlur={() => {
                      if (!query) setSearching(false);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Escape') {
                        setQuery('');
                        setSearching(false);
                      }
                    }}
                  />
                  {query && (
                    <button
                      type="button"
                      aria-label={t('search.clear')}
                      onClick={() => {
                        setQuery('');
                        searchBox.current?.focus();
                      }}
                    >
                      <Icon d={ICON.clear} size={12} />
                    </button>
                  )}
                </label>
              ) : searchButton ? (
                <button type="button" className="oa-tool" aria-label={t('search')} title={t('search')} onClick={() => setSearching(true)}>
                  <Icon d={ICON.search} size={18} />
                </button>
              ) : null}
              <button type="button" className="oa-tool" aria-label={t('filter.button')} title={t('filter.button')} aria-haspopup="menu" aria-expanded={popup?.kind === 'filter'} data-active={isFiltered(filters)} onClick={(e) => toggle('filter', e.currentTarget)}>
                <Icon d={ICON.filter} size={18} />
              </button>
              <button
                type="button"
                className="oa-tool"
                aria-label={t(layout === 'grid' ? 'view.list' : 'view.grid')}
                title={t(layout === 'grid' ? 'view.list' : 'view.grid')}
                onClick={() => setLayout(layout === 'grid' ? 'list' : 'grid')}
              >
                <Icon d={layout === 'grid' ? ICON.list : ICON.grid} size={18} />
              </button>
              {canCreate && createButton && (
                <button type="button" className="oa-tool" aria-label={t('create.new')} title={t('create.new')} aria-haspopup="menu" aria-expanded={popup?.kind === 'create'} onClick={(e) => toggle('create', e.currentTarget)}>
                  <Icon d={ICON.plus} size={18} />
                </button>
              )}
            </div>
          </div>
          <UpdatePanel />
          <WhatsNewPanel />
          {canCreate && tiles.length > 0 && (
            <>
              {tileGroups === undefined ? (
                <>
                  <h2 className="oa-section-title">{t('create.heading')}</h2>
                  <ul className="oa-tiles">{tiles.map(tileItem)}</ul>
                </>
              ) : (
                <div className="oa-tile-groups">
                  {groupTiles(tiles, tileGroups).map(({ group, tiles: grouped }) => (
                    <section key={group.id} className="oa-tile-group" data-group={group.id} aria-label={group.title}>
                      <h2 className="oa-section-title">{group.title}</h2>
                      <ul className="oa-tiles">{grouped.map(tileItem)}</ul>
                    </section>
                  ))}
                </div>
              )}
              {peek !== null && peekTile !== undefined && popup === null && (
                <TilePeek
                  tile={peekTile}
                  anchor={peek.anchor}
                  t={t}
                  onAct={() => tileAct(peekTile.id)}
                  onEnter={() => {
                    overPeek.current = true;
                    clearTimeout(peekTimer.current);
                  }}
                  onLeave={() => {
                    overPeek.current = false;
                    hidePeek();
                  }}
                  onClose={closePeek}
                />
              )}
            </>
          )}
          {status === 'loading' && artifacts.length === 0 ? (
            <ul className="oa-grid oa-skeleton" aria-hidden="true">
              {[0, 1, 2].map((i) => (
                <li key={i} className="oa-item">
                  <div className="oa-card">
                    <div className="oa-preview" />
                    <div className="oa-line" />
                  </div>
                </li>
              ))}
            </ul>
          ) : status === 'error' && artifacts.length === 0 ? (
            <div className="oa-empty" role="alert">
              <p>{t('load.error', { message: error })}</p>
              <button type="button" className="oa-retry" onClick={() => void reload()}>
                {t('load.retry')}
              </button>
            </div>
          ) : artifacts.length === 0 ? (
            <div className="oa-empty">
              <ArtifactsIcon size={28} />
              <h2>{t('empty.title')}</h2>
              <p>{t('empty.body')}</p>
            </div>
          ) : shown.length === 0 ? (
            <div className="oa-empty">
              <p>{t('empty.noMatches')}</p>
              {isFiltered(filters) && (
                <button type="button" className="oa-retry" onClick={() => setFilters({ ...NO_FILTERS, sort: filters.sort })}>
                  {t('filter.clear')}
                </button>
              )}
            </div>
          ) : layout === 'grid' ? (
            <ul className="oa-grid">
              {shown.map((artifact) => (
                <Card key={artifact.id} {...itemProps(artifact)} />
              ))}
            </ul>
          ) : (
            <ul className="oa-list">
              {shown.map((artifact) => (
                <Row key={artifact.id} {...itemProps(artifact)} />
              ))}
            </ul>
          )}
          <ChangelogFooter />
        </div>
      </div>
      {popup?.kind === 'filter' && <FilterMenu anchor={popup.anchor} filters={filters} setFilters={(next) => setFilters(next)} types={filterTypes} counts={counts} projects={projects} t={t} onClose={closePopup} />}
      {popup?.kind === 'create' && (
        <CreateMenu
          anchor={popup.anchor}
          tiles={tiles}
          canCreate={canCreate}
          t={t}
          onClose={closePopup}
          create={(type) => {
            setPopup(null);
            create(type);
          }}
        />
      )}
      {popup?.kind === 'actions' && actionsFor && (
        <ActionsMenu
          anchor={popup.anchor}
          artifact={actionsFor}
          t={t}
          onClose={closePopup}
          extra={cardActions}
          onExtra={(action) => {
            setPopup(null);
            action.run(actionsFor);
          }}
          act={(what) => {
            setPopup(null);
            if (what === 'pin') void pin(actionsFor, !actionsFor.pinned);
            else if (what === 'copy') void copyLink(actionsFor);
            else if (what === 'share') void share(actionsFor);
            else openDialog({ kind: what, id: actionsFor.id });
          }}
        />
      )}
      {dialog?.kind === 'rename' && dialogFor && (
        <RenameDialog
          artifact={dialogFor}
          t={t}
          onClose={closeDialog}
          onSave={(title) => {
            closeDialog();
            void rename(dialogFor, title);
          }}
        />
      )}
      {dialog?.kind === 'delete' && dialogFor && (
        <DeleteDialog
          artifact={dialogFor}
          t={t}
          onClose={closeDialog}
          onDelete={() => {
            closeDialog();
            void remove(dialogFor);
          }}
        />
      )}
      {changelogOpen && (
        <Dialog label={t('changelog.title')} onClose={closeChangelog} wide>
          <ChangelogView />
        </Dialog>
      )}
      <ToastBar />
    </section>
  );
}
