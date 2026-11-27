export const isGridOrGridPopupTrigger = (element: Element): boolean =>
  element.getAttribute('role') === 'grid' || element.getAttribute('data-is-waiting') !== null;
