import type { ChartFrameFault } from '../charts/frame-messages.ts';

/** One cell of a chart's input, as the page reads it from the sheet. */
export interface ChartCell {
  value: number | string | boolean | null;
  text: string;
  /** A cell an interactive writes, with a default a reset gives it: that default. */
  default?: number | string | boolean | null;
  /** With `default`: whether the cell holds another value. */
  isChanged?: boolean;
}

export type ChartRow = readonly ChartCell[];

/** A chart's inputs by name: the rows of the cells each one covers. */
export type ChartInputs = Readonly<Record<string, readonly ChartRow[]>>;

export interface ChartSize {
  width: number;
  height: number;
}

/** How the page looks, so a chart's colors and words match it. */
export interface ChartLook {
  theme: 'light' | 'dark' | null;
  viewerFont: string | null;
}

export interface PointAt {
  x: number;
  y: number;
}

/** What the page tells a chart frame over its port. */
export type PageToFrame =
  | { kind: 'draw'; artifact: string; inputs: ChartInputs; look: ChartLook }
  | { kind: 'inputsChanged'; inputs: ChartInputs }
  | { kind: 'lookChanged'; look: ChartLook }
  | { kind: 'pointerAt'; at: PointAt | null }
  | { kind: 'pressedAt'; at: PointAt }
  | { kind: 'leave' };

/** What a chart frame answers the page. */
export type FrameToPage = { kind: 'drawn' } | { kind: 'failed'; fault: ChartFrameFault };

/** The faults the chart's worker can report; the frame adds the rest. */
export type WorkerFault = Extract<ChartFrameFault, 'notAModule' | 'threw' | 'inputMissing' | 'tooManyRows' | 'notDrawnInSheets'>;

export const WORKER_FAULTS: ReadonlySet<string> = new Set<WorkerFault>(['notAModule', 'threw', 'inputMissing', 'tooManyRows', 'notDrawnInSheets']);

export const isWorkerFault = (fault: unknown): fault is WorkerFault => typeof fault === 'string' && WORKER_FAULTS.has(fault);

/** What the frame tells the chart's worker. */
export type FrameToWorker =
  | { kind: 'code'; artifact: string }
  | { kind: 'inputs'; inputs: ChartInputs }
  | { kind: 'size'; size: ChartSize }
  | { kind: 'pressed'; drawing: number; handler: number }
  | { kind: 'shown' }
  | { kind: 'stillThere'; nth: number };

/** A drawn element as the worker sends it: a tag, its attributes, and the number of its click handler. */
export interface DrawnElement {
  tag: string;
  key: string | null;
  attributes: Record<string, string | number | boolean>;
  onClick: number | null;
  children: DrawnNode[];
}

export type DrawnNode = string | number | null | DrawnElement | DrawnNode[];

/** What the chart's worker tells the frame, each as JSON. */
export type WorkerToFrame =
  | { kind: 'ready' }
  | { kind: 'here'; nth: number }
  | { kind: 'drawing'; drawing: number; heard: number; tree: DrawnNode }
  | { kind: 'failed'; fault: WorkerFault };

/** The element names the worker's tree and the frame agree on. */
export const FRAGMENT_TAG = 'Fragment';
export const TOOLTIP_TAG = 'Tooltip';
export const VISUALIZE_TAG = 'Visualize';

/** The id of the inert script that holds the worker's code. */
export const WORKER_SCRIPT_ID = 'script-of-worker';
