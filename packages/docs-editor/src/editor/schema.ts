/**
 * The editor's schema. Its JSON is the page form of a tab (sync/page.ts): node and mark names, and attrs, are the
 * model's, every block carries its id as `bid`, and a suggestion is a block's `suggestId` / `suggestOp` or the
 * `suggestIns` / `suggestDel` mark.
 */
import { type DOMOutputSpec, type Mark, type Node as PMNode, type NodeSpec, type MarkSpec, Schema } from 'prosemirror-model';
import { isAllowedHref, normalizeHref } from '../selbar/link-url.ts';
import { MEDIA_ATTRS } from '../sync/page.ts';

const blockAttrs = { bid: { default: null }, suggestId: { default: null }, suggestOp: { default: null } };

/** The DOM attrs every block writes: its id, and the suggestion it belongs to. */
function blockDom(node: PMNode, extra: Record<string, string | null | undefined> = {}): Record<string, string> {
  const out: Record<string, string> = {};
  if (node.attrs.bid) out['data-bid'] = node.attrs.bid;
  if (node.attrs.suggestId) {
    out['data-suggest-id'] = node.attrs.suggestId;
    out['data-suggest-op'] = node.attrs.suggestOp ?? 'ins';
  }
  for (const [key, value] of Object.entries(extra)) if (value !== null && value !== undefined) out[key] = value;
  return out;
}

const HEADINGS = [1, 2, 3, 4, 5, 6] as const;

export const TEXT_COLORS = ['red', 'yellow', 'green', 'teal', 'purple'] as const;
export type TextColor = (typeof TEXT_COLORS)[number];

const nodes: Record<string, NodeSpec> = {
  doc: { content: 'block+' },
  paragraph: {
    group: 'block',
    content: 'inline*',
    attrs: { ...blockAttrs, heading: { default: null } },
    parseDOM: [
      { tag: 'p' },
      ...HEADINGS.map(level => ({ tag: `h${level}`, attrs: { heading: level } })),
    ],
    toDOM: (node): DOMOutputSpec => {
      const level = node.attrs.heading as number | null;
      return [level ? `h${level}` : 'p', blockDom(node), 0];
    },
  },
  codeBlock: {
    group: 'block',
    content: 'text*',
    marks: 'suggestIns suggestDel',
    code: true,
    defining: true,
    attrs: { ...blockAttrs, language: { default: null } },
    parseDOM: [
      {
        tag: 'pre',
        preserveWhitespace: 'full',
        getAttrs: dom => {
          const code = dom.querySelector('code');
          const language = (dom.getAttribute('data-language') ?? /language-([\w+-]+)/.exec(code?.className ?? '')?.[1]) || null;
          return { language };
        },
      },
    ],
    toDOM: (node): DOMOutputSpec => ['pre', blockDom(node, { 'data-language': node.attrs.language }), ['code', 0]],
  },
  list: {
    group: 'block',
    content: 'listItem+',
    attrs: { ...blockAttrs, kind: { default: 'bullet' }, start: { default: null }, numbering: { default: null } },
    parseDOM: [
      { tag: 'ul[data-kind="check"]', priority: 60, attrs: { kind: 'check' } },
      { tag: 'ul', getAttrs: dom => ({ kind: dom.querySelector(':scope > li > input[type=checkbox]') ? 'check' : 'bullet' }) },
      { tag: 'ol', getAttrs: dom => ({ kind: 'ordered', start: dom.hasAttribute('start') ? Number(dom.getAttribute('start')) || 1 : null }) },
    ],
    toDOM: (node): DOMOutputSpec => {
      const kind = node.attrs.kind as string;
      if (kind === 'ordered') return ['ol', blockDom(node, { 'data-kind': kind, start: node.attrs.start && node.attrs.start !== 1 ? String(node.attrs.start) : null }), 0];
      return ['ul', blockDom(node, { 'data-kind': kind }), 0];
    },
  },
  listItem: {
    content: 'paragraph block*',
    defining: true,
    attrs: { ...blockAttrs, checked: { default: null } },
    parseDOM: [
      {
        tag: 'li',
        getAttrs: dom => {
          const box = dom.querySelector(':scope > input[type=checkbox]') as HTMLInputElement | null;
          const marked = dom.getAttribute('data-checked');
          return { checked: marked !== null ? marked === 'true' : box ? box.checked : null };
        },
      },
    ],
    toDOM: (node): DOMOutputSpec => ['li', blockDom(node, { 'data-checked': node.attrs.checked === null ? null : String(node.attrs.checked) }), 0],
  },
  blockquote: {
    group: 'block',
    content: 'block+',
    defining: true,
    attrs: blockAttrs,
    parseDOM: [{ tag: 'blockquote' }],
    toDOM: (node): DOMOutputSpec => ['blockquote', blockDom(node), 0],
  },
  table: {
    group: 'block',
    content: 'tableRow+',
    tableRole: 'table',
    isolating: true,
    attrs: blockAttrs,
    parseDOM: [{ tag: 'table' }],
    toDOM: (node): DOMOutputSpec => ['table', blockDom(node), ['tbody', 0]],
  },
  tableRow: {
    content: 'cell+',
    tableRole: 'row',
    attrs: blockAttrs,
    parseDOM: [{ tag: 'tr' }],
    toDOM: (node): DOMOutputSpec => ['tr', blockDom(node), 0],
  },
  cell: {
    content: '(paragraph | list)+',
    tableRole: 'cell',
    isolating: true,
    attrs: {
      ...blockAttrs,
      header: { default: false },
      colspan: { default: 1 },
      rowspan: { default: 1 },
      colwidth: { default: null },
      align: { default: null },
      background: { default: null },
    },
    parseDOM: [
      { tag: 'td', getAttrs: dom => cellAttrs(dom, false) },
      { tag: 'th', getAttrs: dom => cellAttrs(dom, true) },
    ],
    toDOM: (node): DOMOutputSpec => {
      const attrs = blockDom(node, {
        colspan: node.attrs.colspan !== 1 ? String(node.attrs.colspan) : null,
        rowspan: node.attrs.rowspan !== 1 ? String(node.attrs.rowspan) : null,
        'data-colwidth': Array.isArray(node.attrs.colwidth) ? node.attrs.colwidth.join(',') : null,
        'data-align': node.attrs.align,
        'data-background': node.attrs.background,
      });
      return [node.attrs.header ? 'th' : 'td', attrs, 0];
    },
  },
  horizontalRule: {
    group: 'block',
    attrs: blockAttrs,
    parseDOM: [{ tag: 'hr' }],
    toDOM: (node): DOMOutputSpec => ['hr', blockDom(node)],
  },
  pending: {
    group: 'block',
    atom: true,
    selectable: true,
    attrs: { ...blockAttrs, intent: { default: '' } },
    toDOM: (node): DOMOutputSpec => ['div', blockDom(node, { class: 'doc-pending', 'data-intent': node.attrs.intent })],
  },
  embed: {
    group: 'block',
    atom: true,
    selectable: true,
    attrs: { ...blockAttrs, data: { default: {} } },
    toDOM: (node): DOMOutputSpec => ['div', blockDom(node, { class: 'doc-embed' })],
  },
  text: { group: 'inline' },
  hardBreak: {
    group: 'inline',
    inline: true,
    selectable: false,
    parseDOM: [{ tag: 'br' }],
    toDOM: (): DOMOutputSpec => ['br'],
  },
  mention: {
    group: 'inline',
    inline: true,
    atom: true,
    attrs: { principal: { default: null }, ref: { default: null }, label: { default: null }, name: { default: null }, email: { default: null } },
    parseDOM: [
      {
        tag: 'span[data-mention]',
        getAttrs: dom => ({
          principal: dom.getAttribute('data-principal'),
          ref: dom.getAttribute('data-ref'),
          label: dom.getAttribute('data-label'),
          name: dom.getAttribute('data-name'),
          email: dom.getAttribute('data-email'),
        }),
      },
    ],
    toDOM: (node): DOMOutputSpec => [
      'span',
      dataAttrs({ mention: '', principal: node.attrs.principal, ref: node.attrs.ref, label: node.attrs.label, name: node.attrs.name, email: node.attrs.email }),
      `@${node.attrs.label ?? node.attrs.name ?? node.attrs.ref ?? ''}`,
    ],
  },
  date: {
    group: 'inline',
    inline: true,
    atom: true,
    attrs: { ts: { default: null } },
    parseDOM: [{ tag: 'time[data-date]', getAttrs: dom => ({ ts: dom.getAttribute('datetime') }) }],
    toDOM: (node): DOMOutputSpec => ['time', { 'data-date': '', datetime: node.attrs.ts ?? '' }, String(node.attrs.ts ?? '')],
  },
  dropdown: {
    group: 'inline',
    inline: true,
    atom: true,
    attrs: { enum: { default: '' }, index: { default: null } },
    parseDOM: [{ tag: 'span[data-dropdown]', getAttrs: dom => ({ enum: dom.getAttribute('data-enum') ?? '', index: numberOr(dom.getAttribute('data-index')) }) }],
    toDOM: (node): DOMOutputSpec => ['span', dataAttrs({ dropdown: '', enum: node.attrs.enum, index: node.attrs.index === null ? null : String(node.attrs.index) })],
  },
  media: {
    group: 'inline',
    inline: true,
    atom: true,
    draggable: true,
    attrs: Object.fromEntries(MEDIA_ATTRS.map(key => [key, { default: null }])),
    parseDOM: [
      {
        tag: 'img[src]',
        getAttrs: dom => {
          const src = dom.getAttribute('src') ?? '';
          const blob = /^blob\/[A-Za-z0-9_-]{1,64}$/.test(dom.getAttribute('data-blob') ?? '') ? dom.getAttribute('data-blob') : null;
          return { blob, src: blob ? null : src, alt: dom.getAttribute('alt') || null };
        },
      },
    ],
    toDOM: (node): DOMOutputSpec => ['img', { src: node.attrs.src ?? '', alt: node.attrs.alt ?? '', 'data-blob': node.attrs.blob ?? '' }],
  },
};

function cellAttrs(dom: HTMLElement, header: boolean): Record<string, unknown> {
  const widths = dom.getAttribute('data-colwidth');
  const colwidth = widths && /^\d+(,\d+)*$/.test(widths) ? widths.split(',').map(Number) : null;
  return {
    header,
    colspan: Number(dom.getAttribute('colspan') ?? 1) || 1,
    rowspan: Number(dom.getAttribute('rowspan') ?? 1) || 1,
    colwidth,
    align: dom.getAttribute('data-align') ?? (dom.style.textAlign || null),
    background: dom.getAttribute('data-background'),
  };
}

const numberOr = (value: string | null) => (value === null || value === '' || Number.isNaN(Number(value)) ? null : Number(value));

function dataAttrs(values: Record<string, string | null | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(values)) if (value !== null && value !== undefined) out[`data-${key}`] = value;
  return out;
}

const marks: Record<string, MarkSpec> = {
  bold: {
    parseDOM: [
      { tag: 'strong' },
      { tag: 'b', getAttrs: dom => (dom.style.fontWeight !== 'normal' ? null : false) },
      { style: 'font-weight', getAttrs: value => (/^(bold(er)?|[6-9]\d{2,})$/.test(value) ? null : false) },
    ],
    toDOM: () => ['strong', 0],
  },
  italic: {
    parseDOM: [{ tag: 'i' }, { tag: 'em' }, { style: 'font-style=italic' }],
    toDOM: () => ['em', 0],
  },
  strike: {
    parseDOM: [{ tag: 's' }, { tag: 'del' }, { tag: 'strike' }, { style: 'text-decoration=line-through' }],
    toDOM: () => ['s', 0],
  },
  code: {
    parseDOM: [{ tag: 'code' }],
    toDOM: () => ['code', 0],
  },
  underline: {
    parseDOM: [{ tag: 'u' }, { style: 'text-decoration=underline' }],
    toDOM: () => ['u', 0],
  },
  highlight: {
    attrs: { color: { default: null } },
    parseDOM: [{ tag: 'mark', getAttrs: dom => ({ color: dom.getAttribute('data-color') || null }) }],
    toDOM: (mark: Mark) => ['mark', mark.attrs.color ? { 'data-color': mark.attrs.color } : {}, 0],
  },
  link: {
    attrs: { href: {} },
    inclusive: false,
    // A pasted or dropped link keeps only an address a link may open; one stored with anything else is drawn
    // without its href, so a read-only page (a version, a deleted tab) can't follow it.
    parseDOM: [{
      tag: 'a[href]',
      getAttrs: dom => {
        const href = normalizeHref(dom.getAttribute('href') ?? '');
        return href && isAllowedHref(href) ? { href } : false;
      },
    }],
    toDOM: (mark: Mark) => ['a', { ...(isAllowedHref(mark.attrs.href) ? { href: mark.attrs.href } : {}), rel: 'noopener noreferrer nofollow' }, 0],
  },
  textColor: {
    attrs: { color: {} },
    parseDOM: [
      {
        tag: 'span[data-text-color]',
        getAttrs: dom => {
          const color = dom.getAttribute('data-text-color');
          return color && (TEXT_COLORS as readonly string[]).includes(color) ? { color } : false;
        },
      },
    ],
    toDOM: (mark: Mark) => ['span', { 'data-text-color': mark.attrs.color }, 0],
  },
  suggestIns: {
    attrs: { suggestId: {} },
    inclusive: true,
    excludes: 'suggestDel',
    toDOM: (mark: Mark) => ['ins', { class: 'doc-suggest doc-suggest-ins', 'data-suggest-id': mark.attrs.suggestId }, 0],
  },
  suggestDel: {
    attrs: { suggestId: {} },
    inclusive: false,
    excludes: 'suggestIns',
    toDOM: (mark: Mark) => ['del', { class: 'doc-suggest doc-suggest-del', 'data-suggest-id': mark.attrs.suggestId }, 0],
  },
};

export const schema = new Schema({ nodes, marks });

export type NodeName = keyof typeof nodes;
export type MarkName = keyof typeof marks;
