/**
 * Point editing of an svg `<path>` inside an artboard: its `d` read as runs
 * of bezier nodes (the ones canvas paths are edited with), written back, and
 * whether a path can be edited this way at all.
 *
 * Nodes are in the path's own coordinates; `PathMatrix` takes them to the
 * artboard's pixels (the path's screen matrix inside the artboard page).
 */

import type { BezierNode } from './bezier.ts';

/** One subpath: its nodes, and whether it closes back to the first. */
export interface PathRun {
  nodes: BezierNode[];
  closed: boolean;
}

/** An affine matrix `[a, b, c, d, e, f]`: x' = a·x + c·y + e, y' = b·x + d·y + f. */
export type PathMatrix = readonly [number, number, number, number, number, number];

export const PATH_EDIT_UNSUPPORTED = 'This path can’t be edited point by point. Ask the agent to reshape it.';
export const PATH_EDIT_REPEATED = 'This path repeats in a list, so its points can’t be edited here. Ask the agent to reshape it.';
export const PATH_EDIT_SCRIPTED = 'A script sets this path’s shape, so edits to its points wouldn’t last. Ask the agent to reshape it.';

/** Why a path's points can't be edited from the canvas. */
export type PathRefusal = 'bad' | 'far' | 'long' | 'small';

export const PATH_REFUSALS: Record<PathRefusal, string> = {
  bad: 'This path’s data can’t be read, so it can’t be edited point by point. Ask the agent to reshape it.',
  far: 'This path reaches too far outside its artboard to edit point by point. Move it inside first.',
  long: 'This path has too many points to edit one by one.',
  small: 'Zoom in to edit this path point by point.',
};

/** How far past its artboard (in its pixels) a path's points may reach. */
export const PATH_REACH = 256;
/** The longest path data edited point by point. */
export const MAX_PATH_DATA = 24_000;
/** The smallest a path may show on screen (its larger side, in screen pixels) to be edited. */
export const MIN_PATH_PIXELS = 32;

const TOKEN = /([MmLlHhVvCcSsQqTtAaZz])|([-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)/g;
const ARGS: Record<string, number> = { m: 2, l: 2, h: 1, v: 1, c: 6, s: 4, q: 4, t: 2, a: 7, z: 0 };

/** The path data `d` as runs of nodes; `null` when it can't be read that way (arcs among them). */
export function parsePathData(d: string): PathRun[] | null {
  if (d.replace(TOKEN, '').replace(/[\s,]/g, '') !== '') return null;
  const tokens = [...d.matchAll(TOKEN)].map((match): string | number => (match[2] !== undefined ? Number(match[2]) : match[1]!));
  const runs: PathRun[] = [];
  let run = null as PathRun | null;
  let x = 0, y = 0, startX = 0, startY = 0;
  // The last control point, for the smooth commands that reflect it.
  let cubicControl: [number, number] | null = null;
  let quadControl: [number, number] | null = null;
  let command = '';
  let i = 0;

  const last = (): BezierNode => run!.nodes[run!.nodes.length - 1]!;
  const begin = (): void => {
    run = { nodes: [{ x, y }], closed: false };
    runs.push(run);
  };
  const lineTo = (nx: number, ny: number): void => {
    run!.nodes.push({ x: nx, y: ny });
    x = nx;
    y = ny;
  };
  const curveTo = (x1: number, y1: number, x2: number, y2: number, nx: number, ny: number): void => {
    const from = last();
    from.out = [x1 - from.x, y1 - from.y];
    run!.nodes.push({ x: nx, y: ny, in: [x2 - nx, y2 - ny] });
    x = nx;
    y = ny;
  };

  while (i < tokens.length) {
    const token = tokens[i]!;
    if (typeof token === 'string') {
      command = token;
      i++;
      if (command === 'z' || command === 'Z') {
        if (!run) return null;
        close(run);
        x = startX;
        y = startY;
        run = null;
        cubicControl = quadControl = null;
        continue;
      }
    } else if (!command || command === 'z' || command === 'Z') {
      return null;
    }
    const lower = command.toLowerCase();
    const count = ARGS[lower]!;
    if (lower === 'a') return null;
    const n = tokens.slice(i, i + count).filter((arg): arg is number => typeof arg === 'number' && Number.isFinite(arg));
    if (n.length < count) return null;
    i += count;
    const relative = command === lower;
    const ox = relative ? x : 0, oy = relative ? y : 0;

    if (lower === 'm') {
      x = ox + n[0]!;
      y = oy + n[1]!;
      startX = x;
      startY = y;
      begin();
      cubicControl = quadControl = null;
      // Pairs after a move are lines.
      command = relative ? 'l' : 'L';
      continue;
    }
    if (!run) {
      // A command after a close starts a new run where the last one began.
      x = startX;
      y = startY;
      begin();
    }
    if (lower === 'l' || lower === 'h' || lower === 'v') {
      const nx = lower === 'v' ? x : ox + n[0]!;
      const ny = lower === 'h' ? y : lower === 'v' ? oy + n[0]! : oy + n[1]!;
      lineTo(nx, ny);
      cubicControl = quadControl = null;
    } else if (lower === 'c') {
      curveTo(ox + n[0]!, oy + n[1]!, ox + n[2]!, oy + n[3]!, ox + n[4]!, oy + n[5]!);
      cubicControl = [ox + n[2]!, oy + n[3]!];
      quadControl = null;
    } else if (lower === 's') {
      const [x1, y1] = cubicControl ? [2 * x - cubicControl[0], 2 * y - cubicControl[1]] : [x, y];
      curveTo(x1, y1, ox + n[0]!, oy + n[1]!, ox + n[2]!, oy + n[3]!);
      cubicControl = [ox + n[0]!, oy + n[1]!];
      quadControl = null;
    } else if (lower === 'q' || lower === 't') {
      const reflected: [number, number] = quadControl ? [2 * x - quadControl[0], 2 * y - quadControl[1]] : [x, y];
      const [qx, qy]: [number, number] = lower === 'q' ? [ox + n[0]!, oy + n[1]!] : reflected;
      const [nx, ny]: [number, number] = lower === 'q' ? [ox + n[2]!, oy + n[3]!] : [ox + n[0]!, oy + n[1]!];
      curveTo(x + (2 / 3) * (qx - x), y + (2 / 3) * (qy - y), nx + (2 / 3) * (qx - nx), ny + (2 / 3) * (qy - ny), nx, ny);
      quadControl = [qx, qy];
      cubicControl = null;
    }
  }
  if (!runs.length || runs.some((r) => r.nodes.length < 2)) return null;
  return runs;
}

/** Closes a run; a last node back on the first merges into it. */
function close(run: PathRun): void {
  run.closed = true;
  const first = run.nodes[0]!;
  const end = run.nodes[run.nodes.length - 1]!;
  if (run.nodes.length > 1 && Math.abs(end.x - first.x) < 1e-9 && Math.abs(end.y - first.y) < 1e-9) {
    run.nodes.pop();
    if (end.in) first.in = end.in;
    else delete first.in;
  }
}

const number = (n: number): string => String(Math.round(n * 100) / 100 || 0);

/** Path data for `runs`, numbers to two decimals. */
export function pathDataOf(runs: readonly PathRun[]): string {
  return runs
    .map(({ nodes, closed }) => {
      if (!nodes.length) return '';
      let d = `M${number(nodes[0]!.x)} ${number(nodes[0]!.y)}`;
      const count = closed ? nodes.length : nodes.length - 1;
      for (let i = 0; i < count; i++) {
        const a = nodes[i]!;
        const b = nodes[(i + 1) % nodes.length]!;
        if (!a.out && !b.in) {
          // The closing line is the close itself.
          if (!(closed && i === nodes.length - 1)) d += `L${number(b.x)} ${number(b.y)}`;
          continue;
        }
        const ax = a.x + (a.out?.[0] ?? 0), ay = a.y + (a.out?.[1] ?? 0);
        const bx = b.x + (b.in?.[0] ?? 0), by = b.y + (b.in?.[1] ?? 0);
        d += `C${number(ax)} ${number(ay)} ${number(bx)} ${number(by)} ${number(b.x)} ${number(b.y)}`;
      }
      return closed ? `${d}Z` : d;
    })
    .join(' ');
}

/** A point through a matrix. */
export function applyMatrix(m: PathMatrix, x: number, y: number): { x: number; y: number } {
  return { x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] };
}

/** Takes a move in the matrix's output back to the path's own coordinates; `null` when the matrix flattens. */
export function inverseMove(m: PathMatrix): ((dx: number, dy: number) => [number, number]) | null {
  const det = m[0] * m[3] - m[1] * m[2];
  if (!det || !Number.isFinite(det)) return null;
  return (dx, dy) => [(m[3] * dx - m[2] * dy) / det, (-m[1] * dx + m[0] * dy) / det];
}

/** The bounds of every anchor and handle of `runs`, through `m`. */
export function controlBounds(runs: readonly PathRun[], m: PathMatrix): { x0: number; y0: number; x1: number; y1: number } {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const add = (x: number, y: number) => {
    const p = applyMatrix(m, x, y);
    x0 = Math.min(x0, p.x);
    y0 = Math.min(y0, p.y);
    x1 = Math.max(x1, p.x);
    y1 = Math.max(y1, p.y);
  };
  for (const { nodes } of runs) {
    for (const node of nodes) {
      add(node.x, node.y);
      if (node.in) add(node.x + node.in[0], node.y + node.in[1]);
      if (node.out) add(node.x + node.out[0], node.y + node.out[1]);
    }
  }
  return { x0, y0, x1, y1 };
}

/**
 * The runs to edit for a path with data `d` drawn through `m` in an
 * artboard `board` big, shown at `zoom`; or why it can't be edited.
 */
export function pathPoints(d: string, m: PathMatrix, board: { w: number; h: number }, zoom: number): PathRun[] | PathRefusal {
  if (d.length > MAX_PATH_DATA) return 'long';
  const runs = parsePathData(d);
  if (!runs || !inverseMove(m)) return 'bad';
  const bounds = controlBounds(runs, m);
  if (!Object.values(bounds).every(Number.isFinite)) return 'bad';
  const reach = PATH_REACH + 0.5;
  if (bounds.x0 < -reach || bounds.y0 < -reach || bounds.x1 > board.w + reach || bounds.y1 > board.h + reach) return 'far';
  if (pathDataOf(runs).length > MAX_PATH_DATA) return 'long';
  if (Math.max(bounds.x1 - bounds.x0, bounds.y1 - bounds.y0) * zoom < MIN_PATH_PIXELS) return 'small';
  return runs;
}
