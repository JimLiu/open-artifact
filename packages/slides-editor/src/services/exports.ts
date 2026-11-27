/**
 * Exports: PDF, PowerPoint, a self-contained HTML presentation, or one
 * slide as a PNG.
 *
 * Every export works from the slides as they are in this tab (unsaved
 * edits included): hidden slides are skipped, slides whose file has errors
 * are skipped with a note, and what a format cannot carry over is reported
 * back as export notes. A PDF that would pass the download limit is made
 * again at a lower picture quality; a web page shrinks its largest
 * pictures until it fits. The file is saved
 * through the host's downloads capability when it fits, else as an
 * ordinary browser download.
 */

import { mayExportHere } from '@open-artifact/editor-kit';
import { displayTitle } from '@open-artifact/slides-core';
import { deckOrder, useDeck } from '../state/deck.ts';
import type { CaptureContext } from './capture.ts';
import { AssetCache } from './export/assets.ts';
import { fitWithinLimit, type QualityStep, type StepTry } from './export/budget.ts';
import { exportFileName, saveExport, slideFileName } from './export/files.ts';
import { deckFontCss, deckText } from './export/fonts.ts';
import { exportHtml } from './export/html.ts';
import type { ExportJob, ExportSlide } from './export/job.ts';
import { ExportNotes } from './export/notes.ts';
import { exportPdf, PDF_LADDER, PDF_STEPS } from './export/pdf.ts';
import { exportPng } from './export/png.ts';
import { exportPicturePptx } from './export/picture-pptx.ts';
import { exportPptx, type PptxFonts } from './export/pptx.ts';
import { maybeSession, resolveSrc } from './session.ts';

export type ExportFormat = 'pdf' | 'pptx' | 'html' | 'png';
export type PdfQuality = 'good' | 'better' | 'best';
/** HTML picture quality: best keeps files as they are; better and good shrink large pictures. */
export type HtmlQuality = 'good' | 'better' | 'best';

/** What to export. */
export type ExportRequest =
  | { format: 'pdf'; quality: PdfQuality; notes: boolean }
  /** `pictures`: every slide as one picture (fonts then do not matter). */
  | { format: 'pptx'; fonts: PptxFonts; pictures?: boolean }
  | { format: 'html'; quality: HtmlQuality }
  | { format: 'png'; slideId: string };

/** A finished export. */
export interface ExportResult {
  /** The file name written. */
  name: string;
  /** What the export could not carry over, as sentences. */
  notes: string[];
  /** Where the host saved the file, when it says. */
  savedTo?: string;
}

/** Most bytes of fonts drawn into slide pictures. */
const PICTURE_FONT_BYTES = 32 * 1024 * 1024;

let busy = false;

/** True while an export runs (only one runs at a time). */
export function exportBusy(): boolean {
  return busy;
}

/** The note of an export made while the agent was still writing the deck. */
export function writingNote(written: number, planned: number): string {
  return `The deck was still being written: only ${written} of ${planned} planned slides were included.`;
}

/** The deck's title for file names and documents. */
function deckTitle(): string {
  const state = useDeck.getState();
  if (state.index.title.trim()) return displayTitle(state.index);
  return state.title.trim() || displayTitle(state.index);
}

/** Numbers (in the deck) of the slides an export leaves out because their files have errors. */
export function heldSlideNumbers(state: Parameters<typeof deckOrder>[0]): number[] {
  const out: number[] = [];
  deckOrder(state).forEach((id, i) => {
    if (state.slides[id]?.held) out.push(i + 1);
  });
  return out;
}

/** The slides a request covers, with notes for what is left out. */
function selectSlides(request: ExportRequest, notes: ExportNotes): ExportSlide[] {
  const state = useDeck.getState();
  const order = deckOrder(state);
  if (request.format === 'png') {
    const at = order.indexOf(request.slideId);
    const entry = state.slides[request.slideId];
    if (at < 0 || !entry) throw new Error('That slide is no longer in the deck.');
    if (entry.held) throw new Error('This slide has errors, so it cannot be exported. Fix the file first.');
    return [{ slide: entry.slide, number: at + 1 }];
  }
  const out: ExportSlide[] = [];
  order.forEach((id, i) => {
    const entry = state.slides[id];
    if (!entry) return;
    if (entry.held) notes.add('held', i + 1);
    else if (entry.slide.hidden) notes.add('hidden', i + 1);
    else out.push({ slide: entry.slide, number: i + 1 });
  });
  return out;
}

/** The picture qualities a request can step down through, and the step it starts at (null: pictures as they are). */
interface QualityPlan {
  ladder: readonly QualityStep[];
  start: number | null;
}

/** The quality plan of a request; null for formats not made again at a lower quality. */
function qualityPlan(request: ExportRequest): QualityPlan | null {
  if (request.format === 'pdf') return { ladder: PDF_LADDER, start: PDF_STEPS.indexOf(request.quality) };
  return null;
}

/** Writes the file a request asks for; `at` is the try within its quality plan. */
async function render(request: ExportRequest, job: ExportJob, at: StepTry): Promise<Blob> {
  switch (request.format) {
    case 'pdf':
      return exportPdf(job, { quality: at.step === null ? request.quality : (PDF_STEPS[at.step] ?? request.quality), notes: request.notes, canStepDown: at.canStepDown, steppedDown: at.steppedDown });
    case 'pptx':
      return request.pictures ? exportPicturePptx(job) : exportPptx(job, { fonts: request.fonts });
    case 'html':
      return exportHtml(job, { quality: request.quality });
    case 'png':
      return exportPng(job);
  }
}

/**
 * Runs an export and saves the file. `progress` hears how many slides are
 * done. Rejects with a readable error (nothing to export, a file too large,
 * the host refusing it, another export running).
 */
export async function runExport(request: ExportRequest, progress?: (done: number, total: number) => void, options: { writing?: { written: number; planned: number } } = {}): Promise<ExportResult> {
  const current = maybeSession();
  if (!current || !mayExportHere(current.viewer.role, current.downloads)) throw new Error('Only the owner can download the deck.');
  if (busy) throw new Error('Another export is still running.');
  const state = useDeck.getState();
  if (state.status !== 'ready') throw new Error('The deck has not finished loading.');
  busy = true;
  try {
    let notes = new ExportNotes();
    // Each try starts from fresh notes: one given up on must not leave its notes behind.
    const freshNotes = (): ExportSlide[] => {
      notes = new ExportNotes();
      if (options.writing) notes.text(writingNote(options.writing.written, options.writing.planned));
      return selectSlides(request, notes);
    };
    const slides = freshNotes();
    if (slides.length === 0) throw new Error('There are no slides to export: every slide is hidden or has errors.');
    const title = deckTitle();
    const assets = new AssetCache(resolveSrc);
    const faces = state.index.faces;
    let current: number | undefined;
    const capture: CaptureContext = {
      resolveSrc,
      assets,
      faces,
      fontCss: '',
      onFallback: () => notes.add('rasterFallback', current),
      onMissingEmbed: () => notes.add('embedPdf', current),
      onMissingPicture: () => notes.add('picture', current),
      onLateFonts: (families) => families.forEach((family) => notes.family('fontLate', family)),
    };
    let fontsMissing = false;
    if (request.format !== 'html') {
      // Slide pictures cannot load fonts from the network: inline them.
      const bundle = await deckFontCss(faces, { text: deckText(slides.map((entry) => entry.slide)), assets, maxBytes: PICTURE_FONT_BYTES });
      capture.fontCss = bundle.css;
      // Editable PowerPoint names its fonts instead of drawing them; pictures of slides need them.
      fontsMissing = bundle.missing.length > 0 && (request.format !== 'pptx' || request.pictures === true);
    }
    const total = slides.length;
    const plan = qualityPlan(request);
    const attempt = (at: StepTry): Promise<Blob> => {
      if (fontsMissing) notes.add('fontsMissing');
      progress?.(0, total);
      const job: ExportJob = {
        title,
        slides,
        capture,
        notes,
        begin: (number) => {
          current = number;
        },
        progress: (done) => progress?.(Math.min(done, total), total),
      };
      return render(request, job, at);
    };
    const blob = plan ? await fitWithinLimit(plan.ladder, plan.start, attempt, freshNotes) : await attempt({ step: null, canStepDown: false, steppedDown: false });
    const name = request.format === 'png' ? slideFileName(title, slides[0]!.number, 'png') : exportFileName(title, request.format);
    const saved = await saveExport(name, blob, maybeSession()?.downloads ?? null);
    return { name, notes: notes.list(), savedTo: saved.savedTo };
  } catch (error) {
    if (error instanceof Error && error.message) throw error;
    throw new Error(`The export failed: ${String(error)}`);
  } finally {
    busy = false;
  }
}
