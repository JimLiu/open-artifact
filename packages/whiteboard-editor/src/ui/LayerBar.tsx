/**
 * The controls of a drawing's layers: the Layers menu of a selected
 * drawing, the layer bar shown while one layer is picked (its name opens
 * the same menu; bring forward, send backward, hide), and the layer rows
 * the context menu reuses. See `services/drawing-layers.ts`.
 */

import { useMemo, type ReactNode } from 'react';
import { BringToFront, ChevronDown, EyeOff, Layers, SendToBack } from 'lucide-react';
import { drawingLayerAlone, svgToBase64DataUrl, type DrawingLayer, type LayerBox } from '@open-artifact/whiteboard-core';
import { drawnImagePen, drawnImageSrcForPen, type DrawnPen } from '../export/drawn-svg.ts';
import { LAYER_MESSAGES, layerLabel, layerNameLabel } from '../lib/layer-picking.ts';
import { chooseLayer, layerActionRefusals, runLayerAction, type LayeredDrawing, type LayerAction, type PickedDrawingLayer } from '../services/drawing-layers.ts';
import { useColorScheme } from '../state/theme.ts';
import { ChromeButton, ChromeDivider, ChromeMenu, ChromeMenuItem, ToolButton, type ChromeSide } from './chrome.tsx';

const THUMB_PX = 16;

/** One layer drawn alone, its drawn part fitted into a 16px square. */
function LayerThumb({ src, size, box }: { src: string; size: readonly [number, number]; box: LayerBox }) {
  const [left, top, right, bottom] = box;
  const scale = THUMB_PX / Math.max(right - left, bottom - top, 1e-6);
  const width = (right - left) * scale;
  const height = (bottom - top) * scale;
  return (
    <span aria-hidden="true" className="relative block size-4">
      <span className="absolute overflow-hidden" style={{ left: (THUMB_PX - width) / 2, top: (THUMB_PX - height) / 2, width, height }}>
        <img src={src} alt="" draggable={false} className="absolute max-w-none" style={{ left: -left * scale, top: -top * scale, width: size[0] * scale, height: size[1] * scale }} />
      </span>
    </span>
  );
}

function thumbFor(drawing: LayeredDrawing, layer: DrawingLayer, pen: DrawnPen): ReactNode {
  const shape = drawing.shapes.layers.find((item) => item.n === layer.n);
  const alone = shape === undefined ? undefined : drawingLayerAlone(drawing.svg, layer);
  if (shape === undefined || alone === undefined) return undefined;
  const [left, top, right, bottom] = shape.box;
  const [wl, wt, wr, wb] = drawing.window;
  const box: LayerBox = [Math.max(left, wl), Math.max(top, wt), Math.min(right, wr), Math.min(bottom, wb)];
  if (box[2] <= box[0] || box[3] <= box[1]) return undefined;
  return <LayerThumb src={drawnImageSrcForPen(svgToBase64DataUrl(alone), pen)} size={drawing.shapes.size} box={box} />;
}

/**
 * Menu rows for layers, as given (the caller orders them): each with a
 * thumbnail, the picked one checked; a hidden one is dimmed with an eye
 * and offers to show it.
 */
export function LayerRows({ drawing, layers, picked, why }: { drawing: LayeredDrawing; layers: readonly DrawingLayer[]; picked: number | undefined; why: string | undefined }): ReactNode {
  const pen = drawnImagePen(useColorScheme());
  return layers.map((layer) => (
    <ChromeMenuItem
      key={`${String(layer.n)}:${layer.id}`}
      checked={layer.n === picked}
      icon={layer.hidden ? <EyeOff aria-hidden="true" /> : thumbFor(drawing, layer, pen)}
      disabled={why !== undefined}
      {...(why !== undefined ? { title: why } : {})}
      {...(layer.hidden ? { shortcut: LAYER_MESSAGES.show } : {})}
      onSelect={() => chooseLayer(layer, drawing.element)}
    >
      <span dir="auto" className={layer.hidden ? 'text-chrome-muted' : undefined}>
        {layerLabel(layer.name)}
      </span>
    </ChromeMenuItem>
  ));
}

/** The Layers button of a selected drawing with layers: a menu of its layers, front first. */
export function LayersMenuButton({ drawing, side, why }: { drawing: LayeredDrawing; side: ChromeSide; why: string | undefined }): ReactNode {
  if (why !== undefined) return <ToolButton label={LAYER_MESSAGES.layers} tip={why} tipSide={side} icon={<Layers aria-hidden="true" />} disabled data-wb-layers="" />;
  return (
    <ChromeMenu
      side={side}
      align="center"
      tip={{ label: LAYER_MESSAGES.layers, side }}
      className="min-w-52"
      trigger={
        <ChromeButton square size="xl" aria-label={LAYER_MESSAGES.layers} data-wb-layers="">
          <Layers aria-hidden="true" />
        </ChromeButton>
      }
    >
      <div role="group" aria-label={LAYER_MESSAGES.list}>
        <LayerRows drawing={drawing} layers={drawing.listed.toReversed()} picked={undefined} why={undefined} />
      </div>
    </ChromeMenu>
  );
}

/** The bar's controls while one layer is picked. */
export function LayerToolbar({ picked, side }: { picked: PickedDrawingLayer; side: ChromeSide }): ReactNode {
  const refusals = useMemo(() => layerActionRefusals(picked), [picked]);
  const name = layerLabel(picked.layer.name);
  const action = (kind: Extract<LayerAction, 'forward' | 'backward' | 'hide'>, icon: ReactNode) => (
    <ToolButton
      key={kind}
      label={LAYER_MESSAGES[kind]}
      tip={refusals[kind] ?? LAYER_MESSAGES[kind]}
      tipSide={side}
      icon={icon}
      disabled={refusals[kind] !== undefined}
      data-wb-layer-action={kind}
      onClick={() => runLayerAction(kind)}
    />
  );
  return (
    <>
      <ChromeMenu
        side={side}
        align="start"
        tip={{ label: layerNameLabel(picked.layer.name), side }}
        className="min-w-52"
        trigger={
          <ChromeButton size="xl" aria-label={layerNameLabel(picked.layer.name)} data-wb-layer-name="" className="px-2">
            <span dir="auto" className="inline-block w-24 truncate text-start">
              {name}
            </span>
            <ChevronDown aria-hidden="true" className="!size-4 text-chrome-muted" />
          </ChromeButton>
        }
      >
        <div role="group" aria-label={LAYER_MESSAGES.list}>
          <LayerRows drawing={picked.drawing} layers={picked.drawing.listed.toReversed()} picked={picked.layer.n} why={undefined} />
        </div>
      </ChromeMenu>
      <ChromeDivider />
      {action('forward', <BringToFront aria-hidden="true" />)}
      {action('backward', <SendToBack aria-hidden="true" />)}
      {action('hide', <EyeOff aria-hidden="true" />)}
    </>
  );
}
