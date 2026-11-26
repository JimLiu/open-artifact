/**
 * Seams later parts of the page plug into the timeline: extra lanes under the scene strip (the voiceover lane),
 * handles on a scene card's edges (recut's edge drag) and on both its ends (a video scene's trim). All are drawn in
 * strip pixels.
 */

import type { ReactNode } from 'react';
import { create } from 'zustand';
import type { PartSpan } from './timeline-math.ts';

export interface LaneContext {
  /** The film's length as played, and the strip's width in pixels. */
  total: number;
  width: number;
  spans: readonly PartSpan[];
}

export interface TimelineLane {
  id: string;
  order: number;
  /** The lane's height in pixels. */
  height: number;
  render: (context: LaneContext) => ReactNode;
}

/** Draws on a scene card's edges (e.g. a drag handle that retimes the scene); `null` draws nothing. */
export type SceneEdgeRenderer = (span: PartSpan, context: LaneContext) => ReactNode;

/** Draws a scene card's ends in place of the edge (e.g. a video scene's trim handles); given what the edge draws, to keep it. */
export type SceneEndsRenderer = (span: PartSpan, context: LaneContext, edge: ReactNode) => ReactNode;

interface SeamsState {
  lanes: readonly TimelineLane[];
  sceneEdge: SceneEdgeRenderer | null;
  sceneEnds: SceneEndsRenderer | null;
}

export const useTimelineSeams = create<SeamsState>()(() => ({ lanes: [], sceneEdge: null, sceneEnds: null }));

export function registerTimelineLane(lane: TimelineLane): () => void {
  useTimelineSeams.setState((state) => ({ lanes: [...state.lanes.filter((known) => known.id !== lane.id), lane].sort((a, b) => a.order - b.order) }));
  return () => useTimelineSeams.setState((state) => ({ lanes: state.lanes.filter((known) => known !== lane) }));
}

export function setSceneEdge(renderer: SceneEdgeRenderer | null): () => void {
  useTimelineSeams.setState({ sceneEdge: renderer });
  return () => {
    if (useTimelineSeams.getState().sceneEdge === renderer) useTimelineSeams.setState({ sceneEdge: null });
  };
}

export function setSceneEnds(renderer: SceneEndsRenderer | null): () => void {
  useTimelineSeams.setState({ sceneEnds: renderer });
  return () => {
    if (useTimelineSeams.getState().sceneEnds === renderer) useTimelineSeams.setState({ sceneEnds: null });
  };
}
