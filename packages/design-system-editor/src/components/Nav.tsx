/**
 * The left navigation and search. Search runs over tokens, text styles,
 * components, brand-book sections, assets and files; picking a result
 * opens its section and scrolls to it.
 */

import { Blocks, BookOpen, Circle, Files, Image, Layers, Palette, Ruler, Search, Square, Type, X } from 'lucide-react';
import { useMemo, useRef, useState, type ReactNode } from 'react';
import { familyTitle } from '@open-artifact/design-system-core';
import { cn, isComposingKey } from '@open-artifact/ui';
import { useModel, type SystemModel } from '../state/model.ts';
import { anchorId, useView, type Focus, type SectionId } from '../state/view.ts';
import { MOD } from '@open-artifact/editor-kit';

interface NavItem {
  id: SectionId;
  label: string;
  icon: ReactNode;
  count?: number;
}

/** The sections the system has (plus the ones always shown). */
function navItems(model: SystemModel): NavItem[] {
  const { tokens } = model;
  const items: NavItem[] = [
    { id: 'overview', label: 'Overview', icon: <BookOpen className="size-4" /> },
    { id: 'colors', label: 'Colors', icon: <Palette className="size-4" />, count: tokens.colors.length },
    { id: 'typography', label: 'Typography', icon: <Type className="size-4" />, count: tokens.groups.reduce((n, g) => n + g.styles.length, 0) },
    { id: 'spacing', label: 'Spacing', icon: <Ruler className="size-4" />, count: tokens.spacing.length },
    { id: 'radius', label: 'Corner radius', icon: <Square className="size-4" />, count: tokens.radius.length },
    { id: 'shadow', label: 'Shadows', icon: <Layers className="size-4" />, count: tokens.shadows.length },
  ];
  for (const family of tokens.extras) items.push({ id: `family:${family.key}`, label: family.title, icon: <Circle className="size-4" />, count: family.tokens.length });
  items.push(
    { id: 'components', label: 'Components', icon: <Blocks className="size-4" />, count: model.components.length },
    { id: 'assets', label: 'Assets', icon: <Image className="size-4" />, count: model.assets.reduce((n, g) => n + g.items.length, 0) },
    { id: 'files', label: 'Files', icon: <Files className="size-4" />, count: model.files.size + model.uploads.size },
  );
  return items;
}

/** A search hit. */
interface Hit {
  section: SectionId;
  anchor: string;
  label: string;
  detail: string;
  focus: Focus | null;
}

/** Searches the system. */
function search(model: SystemModel, query: string): Hit[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const hits: Hit[] = [];
  const match = (...texts: (string | undefined)[]): boolean => texts.some((text) => text?.toLowerCase().includes(q));
  const { tokens } = model;
  for (const color of tokens.colors) {
    if (match(color.name, color.usage, ...Object.values(color.declared)))
      hits.push({ section: 'colors', anchor: anchorId('token', color.name), label: color.name, detail: 'Color', focus: { kind: 'token', family: 'color', name: color.name } });
  }
  for (const group of tokens.groups) {
    for (const style of group.styles) {
      if (match(style.name, style.usage, group.name))
        hits.push({ section: 'typography', anchor: anchorId('style', style.name), label: style.name, detail: `Text style · ${group.name}`, focus: { kind: 'style', name: style.name } });
    }
  }
  const plain: [SectionId, string, { name: string; value?: string; usage?: string }[]][] = [
    ['spacing', 'spacing', tokens.spacing],
    ['radius', 'radius', tokens.radius],
    ['shadow', 'shadow', tokens.shadows],
    ...tokens.extras.map((family) => [`family:${family.key}` as SectionId, family.key, family.tokens] as [SectionId, string, { name: string; usage?: string }[]]),
  ];
  for (const [section, family, list] of plain) {
    for (const token of list) {
      if (match(token.name, token.usage, token.value))
        hits.push({ section, anchor: anchorId('token', token.name), label: token.name, detail: familyTitle(family), focus: { kind: 'token', family, name: token.name } });
    }
  }
  for (const component of model.components) {
    if (match(component.name, component.group, component.summary))
      hits.push({ section: 'components', anchor: anchorId('component', component.name), label: component.name, detail: component.group ?? 'Component', focus: { kind: 'component', name: component.name } });
  }
  for (const section of [model.readme, ...model.sections]) {
    if (!section) continue;
    const text = model.files.get(section.path) ?? '';
    if (match(section.title, text))
      hits.push({ section: 'overview', anchor: anchorId('section', section.path), label: section.title, detail: section.path, focus: { kind: 'section', name: section.path } });
  }
  for (const group of model.assets) {
    for (const item of group.items) {
      if (match(item.name, group.name))
        hits.push({ section: 'assets', anchor: anchorId('asset', `${item.group}/${item.name}`), label: item.name, detail: `Asset · ${group.name}`, focus: { kind: 'asset', name: `${item.group}/${item.name}` } });
    }
  }
  for (const path of [...model.files.keys(), ...model.uploads.keys()]) {
    if (match(path)) hits.push({ section: 'files', anchor: '', label: path.split('/').pop()!, detail: path, focus: { kind: 'file', name: path } });
  }
  return hits.slice(0, 80);
}

export function Nav() {
  const model = useModel();
  const section = useView((s) => s.section);
  const query = useView((s) => s.search);
  const { go, setSearch, setFocus, openFile } = useView.getState();
  const items = useMemo(() => navItems(model), [model]);
  const hits = useMemo(() => search(model, query), [model, query]);

  const [expanded, setExpanded] = useState(false);
  const results = useRef<HTMLDivElement>(null);
  const listId = 'ds-nav-items';
  const close = () => setExpanded(false);

  return (
    <nav aria-label="Sections" className="relative z-20 flex shrink-0 flex-col border-b border-line bg-surface md:w-60 md:border-r md:border-b-0">
      <div className="flex items-center">
        <button className="ml-2 rounded border border-line px-2 py-1 text-sm md:hidden" aria-controls={listId} aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>Sections</button>
        <div className="relative flex-1 p-2">
        <Search className="pointer-events-none absolute left-4 top-1/2 size-3.5 -translate-y-1/2 text-fg-subtle" />
        <input
          data-search
          value={query}
          onChange={(event) => { setSearch(event.target.value); setExpanded(true); }}
          onKeyDown={(event) => {
            if (isComposingKey(event.nativeEvent)) return;
            if (event.key === 'Escape') { setSearch(''); close(); }
            if (query && hits.length && (event.key === 'ArrowDown' || event.key === 'Enter')) {
              event.preventDefault();
              const first = results.current?.querySelector('button');
              if (event.key === 'Enter') first?.click();
              else first?.focus();
            }
          }}
          placeholder={`Search  ${MOD}K`}
          aria-label="Search the design system"
          className="h-8 w-full rounded-control border border-line bg-surface-2 pl-7 pr-7 text-[13px] text-fg outline-none placeholder:text-fg-subtle focus:border-accent"
        />
        {query ? (
          <button type="button" aria-label="Clear search" onClick={() => setSearch('')} className="absolute right-4 top-1/2 -translate-y-1/2 text-fg-subtle hover:text-fg">
            <X className="size-3.5" />
          </button>
        ) : null}
      </div>
      </div>
      <div id={listId} ref={results}
        onKeyDown={(event) => {
          const buttons = Array.from(results.current?.querySelectorAll('button') ?? []);
          const i = buttons.indexOf(event.target as HTMLButtonElement);
          if (i < 0) return;
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            buttons[(i + (event.key === 'ArrowDown' ? 1 : buttons.length - 1)) % buttons.length]?.focus();
          } else if (event.key === 'Escape') {
            close();
            setSearch('');
            document.querySelector<HTMLInputElement>('[data-search]')?.focus();
          }
        }}
        className={cn('min-h-0 overflow-y-auto bg-surface px-2 pb-3 md:static md:block md:flex-1',
          expanded ? 'absolute inset-x-0 top-full max-h-[60vh] border-b border-line md:max-h-none md:border-0' : 'hidden')}>
        {query.trim() ? (
          hits.length ? (
            <ul className="flex flex-col gap-px">
              {hits.map((hit, index) => (
                <li key={`${hit.section}:${hit.anchor}:${index}`}>
                  <button
                    type="button"
                    onClick={() => {
                      if (hit.section === 'files' && hit.focus) openFile(hit.focus.name);
                      else go(hit.section, hit.anchor);
                      setFocus(hit.focus);
                      close();
                    }}
                    className="flex w-full flex-col rounded-md px-2 py-1.5 text-left hover:bg-hover"
                  >
                    <span className="truncate text-[13px] text-fg">{hit.label}</span>
                    <span className="truncate text-[11px] text-fg-subtle">{hit.detail}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-2 py-4 text-[12px] text-fg-subtle">Nothing matches “{query}”.</p>
          )
        ) : (
          <ul className="flex flex-col gap-px">
            {items.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => { go(item.id); close(); }}
                  aria-current={section === item.id ? 'page' : undefined}
                  className={cn(
                    'flex h-8 w-full items-center gap-2 rounded-md px-2 text-[13px] text-fg-muted hover:bg-hover hover:text-fg',
                    section === item.id && 'bg-hover font-medium text-fg',
                  )}
                >
                  <span className="text-fg-subtle">{item.icon}</span>
                  <span className="flex-1 truncate text-left">{item.label}</span>
                  {item.id === 'files' && item.count ? <span className="text-[11px] tabular-nums text-fg-subtle">{item.count}</span> : null}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </nav>
  );
}
