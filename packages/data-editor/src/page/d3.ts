import * as d3Array from 'd3-array';
import * as d3Axis from 'd3-axis';
import * as d3Brush from 'd3-brush';
import * as d3Chord from 'd3-chord';
import * as d3Color from 'd3-color';
import * as d3Contour from 'd3-contour';
import * as d3Delaunay from 'd3-delaunay';
import * as d3Dispatch from 'd3-dispatch';
import * as d3Drag from 'd3-drag';
import * as d3Ease from 'd3-ease';
import * as d3Force from 'd3-force';
import * as d3Format from 'd3-format';
import * as d3Geo from 'd3-geo';
import * as d3Hierarchy from 'd3-hierarchy';
import * as d3Interpolate from 'd3-interpolate';
import * as d3Path from 'd3-path';
import * as d3Quadtree from 'd3-quadtree';
import * as d3Scale from 'd3-scale';
import * as d3ScaleChromatic from 'd3-scale-chromatic';
import * as d3Selection from 'd3-selection';
import * as d3Shape from 'd3-shape';
import * as d3Time from 'd3-time';
import * as d3TimeFormat from 'd3-time-format';
import * as d3Timer from 'd3-timer';
import * as d3Transition from 'd3-transition';
import * as d3Zoom from 'd3-zoom';

type ShippedD3Modules = typeof d3Array &
  typeof d3Axis &
  typeof d3Brush &
  typeof d3Chord &
  typeof d3Color &
  typeof d3Contour &
  typeof d3Delaunay &
  typeof d3Dispatch &
  typeof d3Drag &
  typeof d3Ease &
  typeof d3Force &
  typeof d3Format &
  typeof d3Geo &
  typeof d3Hierarchy &
  typeof d3Interpolate &
  typeof d3Path &
  typeof d3Quadtree &
  typeof d3Scale &
  typeof d3ScaleChromatic &
  typeof d3Selection &
  typeof d3Shape &
  typeof d3Time &
  typeof d3TimeFormat &
  typeof d3Timer &
  typeof d3Transition &
  typeof d3Zoom;

/** The page's `window.d3`: the 26 d3 modules in one namespace, each name overridable by the page. */
export type DashboardD3 = { -readonly [K in keyof ShippedD3Modules]: ShippedD3Modules[K] } & { version: string };

export const D3_VERSION = '7.9.0';

const D3_MODULES: readonly object[] = [
  d3Array,
  d3Axis,
  d3Brush,
  d3Chord,
  d3Color,
  d3Contour,
  d3Delaunay,
  d3Dispatch,
  d3Drag,
  d3Ease,
  d3Force,
  d3Format,
  d3Geo,
  d3Hierarchy,
  d3Interpolate,
  d3Path,
  d3Quadtree,
  d3Scale,
  d3ScaleChromatic,
  d3Selection,
  d3Shape,
  d3Time,
  d3TimeFormat,
  d3Timer,
  d3Transition,
  d3Zoom,
];

declare module 'd3-selection' {
  interface Selection<GElement extends d3Selection.BaseType, Datum, PElement extends d3Selection.BaseType, PDatum> {
    /** Puts `nodes` in place of each element's children. */
    replaceChildren(...nodes: (Node | string)[]): this;
  }
}

/** Selections can swap an element's children in one step, as the DOM's own `replaceChildren` does. */
function addReplaceChildren(): void {
  const proto = d3Selection.selection.prototype as unknown as Record<string, unknown>;
  if (typeof proto['replaceChildren'] === 'function') return;
  Object.defineProperty(proto, 'replaceChildren', {
    value: function replaceChildren(this: d3Selection.Selection<d3Selection.BaseType, unknown, d3Selection.BaseType, unknown>, ...nodes: (Node | string)[]) {
      return this.each(function each(this: d3Selection.BaseType) {
        if (this instanceof Element) this.replaceChildren(...nodes);
      });
    },
    writable: true,
    configurable: true,
  });
}

/** A fresh `d3` namespace: reads go to the modules; assigning a name replaces it in this namespace only. */
export function createMutableD3Namespace(): DashboardD3 {
  addReplaceChildren();
  const namespace: Record<string, unknown> = { version: D3_VERSION };
  const replace = (name: string, value: unknown): void =>
    void Object.defineProperty(namespace, name, { value, writable: true, enumerable: true, configurable: true });
  for (const module of D3_MODULES) {
    const exports = module as Record<string, unknown>;
    for (const name of Object.keys(exports))
      Object.defineProperty(namespace, name, {
        get: () => exports[name],
        set: (value: unknown) => replace(name, value),
        enumerable: true,
        configurable: true,
      });
  }
  return namespace as DashboardD3;
}
