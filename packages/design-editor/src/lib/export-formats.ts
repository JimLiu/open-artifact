/**
 * What the Shell's Export tab lists for a design, and which export each
 * entry runs. The page declares these as Chrome `formats`; the Shell draws
 * them and sends `export_format` back with the format and variant.
 *
 * Pure: the bridge passes in what it reads from the stores, so the list
 * and the mapping can be tested without a browser.
 */

import type { ChromeReport } from '@open-artifact/runtime';
import type { Selection } from '../state/view.ts';
import { boardsReached } from './selection.ts';

type ChromeFormat = NonNullable<ChromeReport['formats']>[number];

/** What the Export tab depends on. */
export interface ExportScene {
  /** The selected artboard (`null`: none, or several), with whether each PNG size (1×, 2×) can be captured. */
  artboard: { path: string; png: readonly [boolean, boolean]; preview?: { width: number; fits: readonly [boolean, boolean] } } | null;
  /** The page whose artboards "All artboards" exports. */
  page: string | null;
  /** How many artboards that page has. */
  pageArtboards: number;
  /** How many artboards the whole canvas has. */
  canvasArtboards: number;
}

/** One export run for an Export tab entry. */
export type ExportJob =
  /** `width`: laid out at that screen width, full length. */
  | { kind: 'png'; path: string; scale: 1 | 2; width?: number }
  | { kind: 'pngAll'; page: string | null }
  | { kind: 'jpeg'; path: string; scale: 1 | 2 }
  | { kind: 'pdf'; path: string }
  | { kind: 'pdfAll'; page: string | null }
  | { kind: 'html'; path: string }
  | { kind: 'single'; path: string }
  | { kind: 'figma'; path: string }
  | { kind: 'standalone' | 'figmaPage'; page: string | null }
  | { kind: 'site' };

/** Screen widths a page can be laid out at for "PNG at width" (as the focused view's preview width menu). */
export const SCREEN_WIDTHS: readonly (readonly [number, string])[] = [
  [390, 'Phone'],
  [768, 'Tablet'],
  [1024, 'Tablet, landscape'],
  [1280, 'Laptop'],
  [1440, 'Desktop'],
  [1920, 'Large desktop'],
];

/**
 * The artboard the Export tab exports alone: the one in the focused view,
 * the one selected on the canvas, or the one whose elements are selected.
 * `null` when none or several are selected, or when it left the canvas.
 */
export function selectedArtboard(view: { mode: 'canvas' | 'focused'; focused: string | null; selection: Selection }, boards: Readonly<Record<string, unknown>>): string | null {
  const path =
    view.mode === 'focused'
      ? view.focused
      : view.selection.kind === 'elements'
        ? view.selection.board
        : boardsReached(view.selection).length === 1
          ? boardsReached(view.selection)[0]!
          : null;
  return path && Object.hasOwn(boards, path) ? path : null;
}

/** The formats the Shell lists: each one's variants export the selected artboard, every artboard of its page, or the canvas. */
export function exportFormats(scene: ExportScene): ChromeFormat[] {
  const one = scene.artboard;
  const none = !one;
  const all = scene.pageArtboards === 0;
  const off = (disabled: boolean) => (disabled ? { disabled: true as const } : {});
  return [
    {
      format: 'png',
      label: 'PNG',
      description: 'Artboards as images',
      variants: [
        { id: 'current', label: 'Selected artboard, 1×', ...off(none || !one.png[0]) },
        { id: 'current2x', label: 'Selected artboard, 2×', ...off(none || !one.png[1]) },
        ...(one?.preview ? [
          { id: 'preview', label: `Preview width (${one.preview.width} px), 1×`, ...off(!one.preview.fits[0]) },
          { id: 'preview2x', label: `Preview width (${one.preview.width} px), 2×`, ...off(!one.preview.fits[1]) },
        ] : []),
        ...SCREEN_WIDTHS.map(([width, label]) => ({ id: `w${width}`, label: `At ${width} px (${label}), full length`, ...off(none) })),
        { id: 'all', label: 'All artboards on this page (.zip)', ...off(all) },
      ],
    },
    {
      format: 'jpeg',
      label: 'JPEG',
      description: 'The selected artboard as a photo-sized image',
      variants: [
        { id: 'current', label: 'Selected artboard, 1×', ...off(none || !one.png[0]) },
        { id: 'current2x', label: 'Selected artboard, 2×', ...off(none || !one.png[1]) },
      ],
    },
    {
      format: 'pdf',
      label: 'PDF',
      description: 'One page per artboard at its size; Flow artboards on paper pages. Text is selectable',
      variants: [
        { id: 'current', label: 'Selected artboard', ...off(none) },
        { id: 'all', label: 'All artboards on this page', ...off(all) },
      ],
    },
    {
      format: 'html',
      label: 'HTML',
      description: 'Artboards as web pages',
      variants: [
        { id: 'current', label: 'Selected artboard with its images and code (.zip)', ...off(none) },
        { id: 'single', label: 'Selected artboard as one file that works offline', ...off(none) },
        { id: 'figma', label: 'Selected artboard as one page for Figma’s capture extension', ...off(none) },
        { id: 'standalone', label: 'Standalone web page (all artboards on this page)', ...off(all) },
        { id: 'figmapage', label: 'All artboards on this page for Figma', ...off(all) },
        { id: 'canvas', label: 'The whole canvas with an index and a README (.zip)', ...off(scene.canvasArtboards === 0) },
      ],
    },
  ];
}

/** The export an entry runs, or `null` when the format or variant is not offered or is disabled now. */
export function exportJob(scene: ExportScene, format: string, variant: string | undefined): ExportJob | null {
  const offered = exportFormats(scene).find((f) => f.format === format);
  const entry = offered?.variants?.find((v) => v.id === variant);
  if (!offered || offered.disabled || !entry || entry.disabled) return null;
  const path = scene.artboard?.path ?? null;
  const width = /^png:w(\d+)$/.exec(`${format}:${variant}`);
  if (width) return path ? { kind: 'png', path, scale: 1, width: Number(width[1]) } : null;
  switch (`${format}:${variant}`) {
    case 'png:current':
      return path ? { kind: 'png', path, scale: 1 } : null;
    case 'png:current2x':
      return path ? { kind: 'png', path, scale: 2 } : null;
    case 'png:preview':
    case 'png:preview2x':
      return scene.artboard?.preview ? { kind: 'png', path: scene.artboard.path, scale: variant === 'preview2x' ? 2 : 1, width: scene.artboard.preview.width } : null;
    case 'png:all':
      return { kind: 'pngAll', page: scene.page };
    case 'jpeg:current':
      return path ? { kind: 'jpeg', path, scale: 1 } : null;
    case 'jpeg:current2x':
      return path ? { kind: 'jpeg', path, scale: 2 } : null;
    case 'pdf:current':
      return path ? { kind: 'pdf', path } : null;
    case 'pdf:all':
      return { kind: 'pdfAll', page: scene.page };
    case 'html:current':
      return path ? { kind: 'html', path } : null;
    case 'html:single':
      return path ? { kind: 'single', path } : null;
    case 'html:figma':
      return path ? { kind: 'figma', path } : null;
    case 'html:standalone':
      return { kind: 'standalone', page: scene.page };
    case 'html:figmapage':
      return { kind: 'figmaPage', page: scene.page };
    case 'html:canvas':
      return { kind: 'site' };
    default:
      return null;
  }
}
