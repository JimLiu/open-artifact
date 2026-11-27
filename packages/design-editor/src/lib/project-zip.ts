/**
 * The entire project as .zip files, as pure text and arithmetic: which files
 * go in, how they are split into zips a browser can save, what each zip is
 * called, the README in each, and the notices the export shows.
 * services/export.ts reads the files, packs and saves each zip.
 */

/** How large an export can get. */
export interface ZipLimits {
  /** Bytes of files in one zip. */
  partBytes: number;
  /** Entries in one zip, its README included. */
  partEntries: number;
  /** Bytes of files in the whole export (the browser holds all of it at once). */
  totalBytes: number;
}

export const PROJECT_ZIP_LIMITS: ZipLimits = { partBytes: 190 * 1024 * 1024, partEntries: 65000, totalBytes: 1024 * 1024 * 1024 };

/** Why a file over {@link ZipLimits.totalBytes} is left out. */
export const OVER_LIMIT = 'it would take the export past the 1 GB a browser can hold at once';

/** Why a file that could not be read is left out. */
export const UNREADABLE = 'it couldn’t be read';

/** The editor's own data file, never exported. */
const EDITOR_DATA = 'project-data.json';

/** Whether a project path goes into the export: no hidden part (a name starting with a dot), no empty part, not the editor's own data. */
export function keptInProjectZip(path: string): boolean {
  if (path === EDITOR_DATA) return false;
  return path.split('/').every((part) => part !== '' && !part.startsWith('.'));
}

/** A file to pack, by its name in the zip. */
export interface ZipItem {
  name: string;
  size: number;
}

/** A file the export leaves out, and why. */
export interface LeftOut {
  path: string;
  why: string;
}

/** The zips an export makes: each one's file names, in order, and the files left out. */
export interface ZipPlan {
  parts: string[][];
  leftOut: LeftOut[];
}

/**
 * Splits files into zips in their order, each within the part limits with
 * room for its README. A file larger than a part goes into a zip of its own.
 * Files that would take the whole export past its limit are left out.
 */
export function planZipParts(items: readonly ZipItem[], limits: ZipLimits = PROJECT_ZIP_LIMITS): ZipPlan {
  const parts: string[][] = [[]];
  const leftOut: LeftOut[] = [];
  let total = 0;
  let bytes = 0;
  for (const item of items) {
    if (total + item.size > limits.totalBytes) {
      leftOut.push({ path: item.name, why: OVER_LIMIT });
      continue;
    }
    total += item.size;
    const current = parts[parts.length - 1]!;
    if (current.length && (bytes + item.size > limits.partBytes || current.length + 2 > limits.partEntries)) {
      parts.push([item.name]);
      bytes = item.size;
    } else {
      current.push(item.name);
      bytes += item.size;
    }
  }
  return { parts, leftOut };
}

/** A zip's file name: `<base>.zip` alone, `<base>-<part>-of-<parts>.zip` in a set. */
export const zipPartName = (base: string, part: number, parts: number): string => (parts > 1 ? `${base}-${part}-of-${parts}.zip` : `${base}.zip`);

/** The README's name in a zip: `README.md` alone, `README-<part>-of-<parts>.md` in a set. */
export const readmeName = (part: number, parts: number): string => (parts > 1 ? `README-${part}-of-${parts}.md` : 'README.md');

/** What a project README describes. */
export interface ProjectReadme {
  title: string;
  /** This zip, from 1, and how many the export makes. */
  part: number;
  parts: number;
  /** Artboards by page, in page order; empty when the project has none. */
  pages: readonly { name: string; boards: readonly { path: string; title?: string }[] }[];
  /** Other files of the project in the export (`canvas.json` among them). */
  files: readonly string[];
  /** Pages of every artboard, page by page (`index.html`), when the export adds one. */
  index: string | null;
  /** Whether uploads went under `assets/`. */
  assets: boolean;
  /** Folders with a copy of the board runtime (`support.js`). */
  runtimes: readonly string[];
  /** Text files copied as they were, because they aren't UTF-8. */
  notUtf8: readonly string[];
  /** Uploads that could not be read, with the files that use them and, when known, why. */
  missing: readonly { ref: string; usedIn: readonly string[]; why?: string }[];
  /** Files left out so far. */
  leftOut: readonly LeftOut[];
  /** Whether the project's file list was read in full. */
  complete: boolean;
}

const code = (path: string): string => `\`${path}\``;

/** README of one zip of the entire project. */
export function projectReadme(input: ProjectReadme): string {
  const { title, part, parts } = input;
  const lines = [`# ${title} — entire project`, '', 'This project’s pages, files, and uploads as this browser tab had them at export.', 'Anything left out is listed below.', ''];
  if (parts > 1) lines.push(`This is zip ${part} of ${parts}. Unpack all ${parts} into one folder to get the whole project: a page in one zip can need files from another.`, '');
  lines.push(parts > 1 ? `## Contents of all ${parts} zips` : '## Contents', '');
  for (const page of input.pages) {
    lines.push(`### ${page.name}`, '');
    for (const board of page.boards) lines.push(`- ${code(board.path)}${board.title ? ` — ${board.title}` : ''}`);
    lines.push('');
  }
  const others: string[] = [];
  for (const file of input.files) others.push(file === 'canvas.json' ? `- ${code(file)} — the canvas: its pages, where each artboard sits, its notes and shapes` : `- ${code(file)}`);
  if (input.index) others.push(`- ${code(input.index)} — links to every artboard, page by page`);
  if (input.assets) others.push(`- ${code('assets/')} — files uploaded to the design (images, fonts, media)`);
  for (const folder of input.runtimes) others.push(`- ${code(`${folder}support.js`)} — what runs the pages in a browser; not part of the design`);
  if (others.length) {
    if (input.pages.length) lines.push('### Other files', '');
    lines.push(...others, '');
  }
  if (input.notUtf8.length) {
    lines.push('These files aren’t UTF-8, so they were copied unchanged. Any uploads they link to still point to the project, so those images may not show from this folder:', '');
    for (const file of input.notUtf8) lines.push(`- ${code(file)}`);
    lines.push('');
  }
  if (input.missing.length) {
    lines.push('## Missing from this export', '', 'These uploaded files could not be included, so wherever the design uses them they do not load. Exporting again may pick them up.', '');
    for (const item of input.missing) lines.push(`- ${code(item.ref)} (used in ${item.usedIn.map(code).join(', ')})${item.why ? `: ${item.why}` : ''}`);
    lines.push('');
  }
  const runs = input.runtimes.length > 0;
  lines.push(
    '## Viewing',
    '',
    `To view a page, start a local web server in this folder (for example \`python3 -m http.server\`), then open${
      runs
        ? ' an artboard’s `.dc.html` file through it. Opening the file directly may not work, because some browsers block its scripts.'
        : ' a page through it. These are the project’s own files, so a page that relies on the editor may not run from a folder.'
    }`,
    '',
    '## Left out of this export',
    '',
    runs
      ? 'The export never includes hidden files (files whose names start with a dot) or files the editor keeps for its own use.'
      : 'This export leaves out files the editor keeps for its own use. It also leaves out hidden files (files whose names start with a dot), except the ones a page saves for itself.',
    '',
  );
  if (!input.complete) lines.push('Some files may be missing. The editor couldn’t get this project’s full file list, so it may have left out files it hadn’t loaded. Try exporting again. If files are still missing, ask someone with full access to this project to export it.', '');
  if (input.leftOut.some((item) => item.why === OVER_LIMIT)) lines.push('This export is made in your browser, which can’t hold more than 1 GB at once.', '');
  if (part < parts) lines.push('This list may not be complete. The README in the last zip has the full list.', '');
  if (input.leftOut.length) {
    for (const item of input.leftOut) lines.push(`- ${code(item.path)} — ${item.why}`);
    lines.push('');
  }
  if (input.missing.length) lines.push('Uploads that could not be included are listed above, under “Missing from this export.”', '');
  return lines.join('\n');
}

/* --------------------------------- notices --------------------------------- */

export const PREPARING = 'Preparing this project’s .zip…';
export const preparingPart = (part: number, parts: number): string => `Preparing .zip ${part} of ${parts}…`;
export const WAITING = 'Waiting a moment before saving the .zip…';
export const savedSome = (saved: number, parts: number): string => `Saved ${saved} of ${parts} .zip files. Export again to get the whole project.`;
export const savedAll = (parts: number): string => `Saved all ${parts} .zip files of this project.`;
export const INCOMPLETE = 'This export may be missing files because the project’s file list was incomplete. The README in the last .zip says more.';
export const FAILED = 'Couldn’t export this project. Try again.';

/** The notice for files the export left out. */
export function leftOutNotice(count: number, parts: number): string {
  const where = parts > 1 ? 'the last .zip' : 'the .zip';
  return `${count === 1 ? 'This export left out one file.' : `This export left out ${count} files.`} The README in ${where} says which and why.`;
}
