/**
 * Opens a native modal dialog. The browser keeps focus inside it, handles Escape, and returns focus when it closes.
 * `closedby="any"` dismisses a click on the backdrop where that attribute exists; the pointer check is the same
 * dismiss where it does not (Safari). A press that starts inside and ends outside does not close it.
 */
export function bindModal(dialog: HTMLDialogElement, { onClose, canClose }: { onClose(): void; canClose?(): boolean }) {
  dialog.setAttribute('closedby', 'any');
  if (!dialog.open) dialog.showModal();
  const allow = () => canClose?.() !== false;
  let pressedOutside = false;
  const outside = (event: PointerEvent) => {
    const box = dialog.getBoundingClientRect();
    return event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom;
  };
  const onPointerDown = (event: PointerEvent) => {
    pressedOutside = outside(event);
  };
  const onPointerUp = (event: PointerEvent) => {
    const dismiss = pressedOutside && outside(event);
    pressedOutside = false;
    if (dismiss && allow()) dialog.close();
  };
  // Safari has no closedBy. Elsewhere the attribute already dismisses the backdrop.
  const fallback = !('closedBy' in HTMLDialogElement.prototype);
  if (fallback) {
    dialog.addEventListener('pointerdown', onPointerDown);
    dialog.addEventListener('pointerup', onPointerUp);
  }
  const onCancel = (event: Event) => {
    if (!allow()) event.preventDefault();
  };
  const onDialogClose = () => onClose();
  dialog.addEventListener('cancel', onCancel);
  dialog.addEventListener('close', onDialogClose);
  return () => {
    if (fallback) {
      dialog.removeEventListener('pointerdown', onPointerDown);
      dialog.removeEventListener('pointerup', onPointerUp);
    }
    dialog.removeEventListener('cancel', onCancel);
    dialog.removeEventListener('close', onDialogClose);
    if (dialog.open) dialog.close();
  };
}
