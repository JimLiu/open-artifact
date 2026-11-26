/** What a Slides request names, as its `selectionSnapshot` (pure). */

import type { SlidesViewContext } from '@open-artifact/slides-core';
import type { SelectionSnapshot } from '@open-artifact/runtime';
import { selectionSnapshotOf } from '@open-artifact/editor-kit';

/**
 * The selection an "Ask agent" names, as its `selectionSnapshot` (the same choice as its text): the selected elements
 * (or, in the grid, slides), else the slides selected in the rail, else the slide on stage. `elementCount`: how many
 * elements are selected on the slide (the view context labels the last few).
 */
export function slidesSelectionSnapshot(context: SlidesViewContext, elementCount: number): SelectionSnapshot | null {
  const onStage = context.slideId ? `Slide ${context.slideIndex} of ${context.slideCount}` : undefined;
  if (context.selection?.length) {
    const labelled = new Map(context.selection.map((item) => [item.id, item]));
    const slides = context.selection.every((item) => item.kind === 'slide');
    return selectionSnapshotOf({
      kind: slides ? 'slides' : 'elements',
      noun: slides ? 'slide' : 'element',
      count: slides ? (context.selectedCount ?? context.selected.length) : Math.max(elementCount, context.selected.length),
      items: context.selected.map((id) => {
        const known = labelled.get(id);
        return { id, ...(known?.kind ? { kind: known.kind } : {}), ...(known?.label ? { label: known.label } : {}) };
      }),
      ...(!slides && onStage ? { where: onStage } : {}),
    });
  }
  if (context.selectedSlides?.length) {
    return selectionSnapshotOf({ kind: 'slides', noun: 'slide', count: context.selectedCount ?? context.selectedSlides.length, items: context.selectedSlides.map((id) => ({ id })) });
  }
  if (context.slideId && onStage) {
    return selectionSnapshotOf({
      kind: 'slide',
      label: onStage,
      count: 1,
      items: [{ id: context.slideId, kind: 'slide', ...(context.slideTitle ? { label: context.slideTitle } : {}) }],
    });
  }
  return null;
}
