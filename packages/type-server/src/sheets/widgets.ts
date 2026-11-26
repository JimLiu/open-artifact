/**
 * A Sheet's chart widgets: the code each chart draws with, a file each in `<sheet>/widgets/`:
 *
 *   widgets/<id>.json   {id, code, pub, published, errors, at}: the code last sent (`code`), how many times code was
 *                       published (`pub`), the code the chart draws with (`published`, null before the first), and
 *                       what keeps `code` from being published (`errors`, [] when it was)
 *
 * Code the rules find fault with (chartCodeErrors) is staged with errors: it is kept, and the chart goes on drawing
 * with the code published before. Code with no fault is published: `pub` counts up, and the page asks for the
 * widget's projection again and draws with it.
 */

import { randomBytes, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { WorkspaceDirectory } from '@open-artifact/protocol/workspace-files';
import { type ChartCodeError, chartCodeErrors, chartModule } from '@open-artifact/sheets-core';

export const WIDGETS_DIR = 'widgets';
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export interface Widget {
  id: string;
  code: string;
  pub: number;
  published: string | null;
  errors: ChartCodeError[];
  at: string;
}

/** What the page's chart frame runs, or why there is none. */
export type WidgetProjection = { kind: 'bundle'; module: string } | { kind: 'notAWidget' | 'unpublished' | 'compileFailed' };

const isCodeError = (value: unknown): value is ChartCodeError =>
  typeof value === 'object' && value !== null && typeof (value as ChartCodeError).line === 'number' && typeof (value as ChartCodeError).column === 'number' && typeof (value as ChartCodeError).message === 'string';

/** The widgets in `<dir>`, a file each. */
export class WidgetStore {
  readonly dir: string;
  private readonly files: WorkspaceDirectory | undefined;
  /** Each widget's projection, by the pub it was made at. */
  private readonly modules = new Map<string, { pub: number; module: string }>();

  constructor(sheetDir: string, files?: WorkspaceDirectory) {
    this.dir = path.resolve(sheetDir, WIDGETS_DIR);
    this.files = files;
  }

  private file(id: string, followLeaf = true): string {
    const requested = path.join(this.dir, `${id}.json`);
    return this.files?.resolve(requested, followLeaf) ?? requested;
  }

  static isId(id: unknown): id is string {
    return typeof id === 'string' && ID.test(id);
  }

  get(id: unknown): Widget | null {
    if (!WidgetStore.isId(id)) return null;
    let value: unknown;
    try {
      value = JSON.parse(fs.readFileSync(this.file(id), 'utf8'));
    } catch {
      return null;
    }
    if (typeof value !== 'object' || value === null) return null;
    const stored = value as Partial<Record<keyof Widget, unknown>>;
    if (stored.id !== id || typeof stored.code !== 'string' || !Number.isInteger(stored.pub)) return null;
    return {
      id,
      code: stored.code,
      pub: stored.pub as number,
      published: typeof stored.published === 'string' ? stored.published : null,
      errors: Array.isArray(stored.errors) ? stored.errors.filter(isCodeError) : [],
      at: typeof stored.at === 'string' ? stored.at : new Date(0).toISOString(),
    };
  }

  /** Every widget of the Sheet. */
  list(): Widget[] {
    let names: string[];
    try {
      names = fs.readdirSync(this.files?.resolve(this.dir) ?? this.dir);
    } catch {
      return [];
    }
    return names.sort().flatMap((name) => {
      const widget = name.endsWith('.json') ? this.get(name.slice(0, -5)) : null;
      return widget ? [widget] : [];
    });
  }

  /** A new widget with this code: published, or staged with errors. */
  create(code: string): Widget {
    const errors = chartCodeErrors(code);
    const widget: Widget = { id: randomUUID(), code, pub: errors.length ? 0 : 1, published: errors.length ? null : code, errors, at: new Date().toISOString() };
    this.write(widget);
    return widget;
  }

  /** New code for a widget: published (pub counts up), or staged with errors (what is published stays). */
  draft(widget: Widget, code: string): Widget {
    const errors = chartCodeErrors(code);
    const at = new Date().toISOString();
    const next: Widget = errors.length ? { ...widget, code, errors, at } : { ...widget, code, pub: widget.pub + 1, published: code, errors: [], at };
    this.write(next);
    return next;
  }

  delete(id: string): boolean {
    this.modules.delete(id);
    if (!WidgetStore.isId(id)) return false;
    try {
      fs.rmSync(this.file(id, false));
      return true;
    } catch {
      return false;
    }
  }

  /** The module the page's chart frame runs for a widget's published code. */
  projection(id: unknown): WidgetProjection {
    const widget = this.get(id);
    if (!widget) return { kind: 'notAWidget' };
    if (widget.published === null) return { kind: 'unpublished' };
    const known = this.modules.get(widget.id);
    if (known?.pub === widget.pub) return { kind: 'bundle', module: known.module };
    let module: string;
    try {
      module = chartModule(widget.published);
    } catch {
      return { kind: 'compileFailed' };
    }
    this.modules.set(widget.id, { pub: widget.pub, module });
    return { kind: 'bundle', module };
  }

  private write(widget: Widget): void {
    const file = this.file(widget.id, false);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const temporary = `${file}.${randomBytes(8).toString('hex')}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify(widget, null, 2)}\n`, { flag: 'wx' });
    fs.renameSync(temporary, file);
  }
}
