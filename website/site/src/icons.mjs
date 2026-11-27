// Inline SVG icons. The mark and the type icons follow packages/library-page/src/look.tsx exactly
// (ArtifactsIcon, TypeIcon); "page" has no icon there, so it gets a browser-window line icon in the same style.

export const MARK_PATHS =
  '<path d="M15 9V6a3 3 0 0 0-3-3H6a3 3 0 0 0-3 3v6a3 3 0 0 0 3 3h3"/><rect x="9" y="9" width="12" height="12" rx="3"/><circle cx="15" cy="15" r="2" fill="currentColor" stroke="none"/>';

export const mark = (size = 24, cls = '') =>
  `<svg class="${cls}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${MARK_PATHS}</svg>`;

/** The favicon: the mark in brand blue, lighter in dark mode. */
export const FAVICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><style>.s{stroke:#2f5bb7}.f{fill:#2f5bb7}@media (prefers-color-scheme:dark){.s{stroke:#7ea3ec}.f{fill:#7ea3ec}}</style><path class="s" d="M15 9V6a3 3 0 0 0-3-3H6a3 3 0 0 0-3 3v6a3 3 0 0 0 3 3h3"/><rect class="s" x="9" y="9" width="12" height="12" rx="3"/><circle class="f" cx="15" cy="15" r="2"/></svg>\n`;

const P = 'stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"';

const TYPE_BODIES = {
  docs: `<path d="M6 2.25h5.6c.4 0 .78.16 1.06.44l3.65 3.65c.28.28.44.66.44 1.06v7.85A2.75 2.75 0 0 1 14 18H6a2.750 2.75 0 0 1-2.75-2.75V5A2.75 2.75 0 0 1 6 2.25Z" ${P}/><path d="M12 2.4v2.85a2 2 0 0 0 2 2h2.6" ${P}/>`,
  slides: `<path d="M1.25 2.75h17.5M2.75 2.75v8.75A2.25 2.25 0 0 0 5 13.75h10a2.25 2.25 0 0 0 2.25-2.25V2.75M10 13.75l-3 4M10 13.75l3 4" ${P}/>`,
  sheets: `<rect x="2.25" y="2.25" width="15.5" height="15.5" rx="3" ${P}/><path d="M2.25 7.5h15.5M2.25 12.5h15.5M7 2.25v15.5" ${P}/>`,
  design: `<path d="M10 2.25c-4.75 0-8.5 3.3-8.5 7.6 0 4.5 3.55 8.15 8.2 8.15 3.1 0 5.55-1.25 5.55-3.4 0-1.25-1.15-1.75-1.15-2.8 0-1.2 1.05-1.6 2.25-2.2 1.3-.65 2.15-1.5 2.15-3C18.5 3.95 14.6 2.25 10 2.25Z" ${P}/><circle cx="8" cy="6.6" r="1.35" fill="currentColor"/><circle cx="12.4" cy="6.9" r="1.35" fill="currentColor"/><circle cx="5.2" cy="10.3" r="1.35" fill="currentColor"/>`,
  'design-system': `<rect x="2.25" y="2.25" width="6.75" height="6.75" rx="1.75" ${P}/><circle cx="14.4" cy="5.6" r="3.4" ${P}/><circle cx="5.6" cy="14.4" r="3.4" ${P}/><rect x="11" y="11" width="6.75" height="6.75" rx="1.75" ${P}/>`,
  data: `<path d="M1.75 16.25V11.5c0-.97.78-1.75 1.75-1.75H7V4c0-.97.78-1.75 1.75-1.75h2c.97 0 1.75.78 1.75 1.75v2.25h3.75c.97 0 1.75.78 1.75 1.75v8.25c0 .97-.78 1.75-1.75 1.75H3.5c-.97 0-1.75-.78-1.75-1.75Z" ${P}/><path d="M7 9.75V18M12.5 6.25V18" ${P}/>`,
  whiteboard: `<path d="M11.52 8.25A5 5 0 1 0 8.25 11.52" ${P}/><rect x="8.25" y="8.25" width="10" height="10" rx="2.25" ${P}/>`,
  motion: `<path d="M3.75 6.6h2M1.5 10H5M3.75 13.4h2" ${P}/><circle cx="13.75" cy="10" r="4.75" ${P}/>`,
  page: `<rect x="2.25" y="3" width="15.5" height="14" rx="2.75" ${P}/><path d="M2.25 7h15.5M8 10.25 6.25 12 8 13.75M12 10.25 13.75 12 12 13.75" ${P}/>`,
};

export const typeIcon = (type, size = 20) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 20 20" fill="none" aria-hidden="true">${TYPE_BODIES[type] || TYPE_BODIES.page}</svg>`;

const ui = (d, size = 16, extra = '') =>
  `<svg width="${size}" height="${size}" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" ${extra}>${d}</svg>`;

export const icon = {
  arrow: (s) => ui('<path d="M3 8h10M9 4l4 4-4 4"/>', s),
  replay: (s) => ui('<path d="M2.8 8a5.2 5.2 0 1 0 1.6-3.75M2.5 2.5v2.75h2.75"/>', s),
  external: (s) => ui('<path d="M9.5 2.5h4v4M13.5 2.5 7.5 8.5M12 9.5V13a.5.5 0 0 1-.5.5h-8A.5.5 0 0 1 3 13V5a.5.5 0 0 1 .5-.5H7"/>', s),
  copy: (s) => ui('<rect x="5.5" y="5.5" width="8" height="8" rx="1.5"/><path d="M10.5 5.5V3.5a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2"/>', s),
  tick: (s) => ui('<path d="m3 8.5 3.25 3.25L13 4.75"/>', s),
  play: (s) => ui('<path d="M5 3.5v9l7-4.5-7-4.5Z" fill="currentColor"/>', s),
  globe: (s) => ui('<circle cx="8" cy="8" r="5.75"/><path d="M2.25 8h11.5M8 2.25c1.6 1.6 2.4 3.5 2.4 5.75S9.6 12.15 8 13.75C6.4 12.15 5.6 10.25 5.6 8S6.4 3.85 8 2.25Z"/>', s),
  menu: (s) => ui('<path d="M2.5 4.5h11M2.5 8h11M2.5 11.5h11"/>', s),
  close: (s) => ui('<path d="m4 4 8 8m0-8-8 8"/>', s),
  folder: (s) => ui('<path d="M2 4.5A1.5 1.5 0 0 1 3.5 3h2.6l1.5 1.5h4.9A1.5 1.5 0 0 1 14 6v5.5a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 11.5v-7Z"/>', s),
  file: (s) => ui('<path d="M4 2.5h5l3 3v8a.5.5 0 0 1-.5.5h-7.5a.5.5 0 0 1-.5-.5v-10.5a.5.5 0 0 1 .5-.5Z"/>', s),
  chat: (s) => ui('<path d="M3 3.5h10a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H8.2L5.4 13.8a.3.3 0 0 1-.5-.23V11.5H3a1 1 0 0 1-1-1v-6a1 1 0 0 1 1-1Z"/>', s),
  lock: (s) => ui('<rect x="3" y="7" width="10" height="6.5" rx="1.5"/><path d="M5.25 7V5a2.75 2.75 0 0 1 5.5 0v2"/>', s),
  export: (s) => ui('<path d="M8 2.5v7.5M5 5.25 8 2.5l3 2.75M3.5 8.5v4a1 1 0 0 0 1 1h7a1 1 0 0 0 1-1v-4"/>', s),
  plug: (s) => ui('<path d="M6 2.5v3M10 2.5v3M4.5 5.5h7v2.5a3.5 3.5 0 0 1-7 0V5.5ZM8 11.5v2"/>', s),
  palette: (s) => ui('<circle cx="5" cy="5" r="2"/><circle cx="11" cy="5" r="2"/><circle cx="5" cy="11" r="2"/><rect x="9" y="9" width="4" height="4" rx="1"/>', s),
  server: (s) => ui('<rect x="2.5" y="2.5" width="11" height="4.5" rx="1.2"/><rect x="2.5" y="9" width="11" height="4.5" rx="1.2"/><path d="M5 4.75h.01M5 11.25h.01"/>', s),
  puzzle: (s) => ui('<path d="M6 2.75a1.25 1.25 0 0 1 2.5 0V4h3a.5.5 0 0 1 .5.5v3h-1.25a1.25 1.25 0 0 0 0 2.5H12v3a.5.5 0 0 1-.5.5h-3v-1.25a1.25 1.25 0 0 0-2.5 0V13.5H3a.5.5 0 0 1-.5-.5v-3h1.25a1.25 1.25 0 0 0 0-2.5H2.5v-3A.5.5 0 0 1 3 4h3V2.75Z"/>', s),
  robot: (s) => ui('<rect x="3" y="5" width="10" height="8" rx="2"/><path d="M8 5V2.75M6 9h.01M10 9h.01M1.5 8.5v2M14.5 8.5v2"/>', s),
  book: (s) => ui('<path d="M3 3.5A1.5 1.5 0 0 1 4.5 2H13v10H4.5A1.5 1.5 0 0 0 3 13.5v-10ZM3 13.5A1.5 1.5 0 0 0 4.5 15H13v-3"/>', s),
};

export const GITHUB_ICON = (s = 16) =>
  `<svg width="${s}" height="${s}" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8Z"/></svg>`;
