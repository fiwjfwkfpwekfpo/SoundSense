/*
 * Horizontal rows (preset chips, source chips, playlist strips) hide their scrollbar. A finger
 * scrolls them natively; with a mouse they follow the wheel and can be dragged.
 */
const ROWS = '.chips, .presets, .playlist-strip, [data-hscroll]';
const row = (target: EventTarget | null): HTMLElement | null => { const element = target instanceof Element ? target.closest<HTMLElement>(ROWS) : null; return element && element.scrollWidth > element.clientWidth + 1 ? element : null; };
export function bindHorizontalScroll(root: HTMLElement | Document = document): () => void {
  let drag: { element: HTMLElement; x: number; left: number; moved: boolean; pointer: number } | null = null, suppress = false;
  const wheel = (event: WheelEvent) => {
    const element = row(event.target); if (!element || event.ctrlKey) return;
    const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY, before = element.scrollLeft;
    element.scrollLeft += event.deltaMode === 1 ? delta * 32 : delta;
    // At the end of the row the page scrolls as usual.
    if (element.scrollLeft !== before) event.preventDefault();
  };
  const down = (event: PointerEvent) => { if (event.pointerType !== 'mouse' || event.button !== 0) return; const element = row(event.target); if (element) drag = { element, x: event.clientX, left: element.scrollLeft, moved: false, pointer: event.pointerId }; };
  const move = (event: PointerEvent) => {
    if (!drag || event.pointerId !== drag.pointer) return;
    const dx = event.clientX - drag.x; if (!drag.moved && Math.abs(dx) < 6) return;
    drag.moved = true; drag.element.scrollLeft = drag.left - dx; event.preventDefault();
  };
  const up = (event: PointerEvent) => { if (!drag || event.pointerId !== drag.pointer) return; suppress = drag.moved; drag = null; if (suppress) setTimeout(() => { suppress = false; }, 0); };
  // The click that ends a drag must not press the chip under the pointer.
  const click = (event: MouseEvent) => { if (suppress) { suppress = false; event.preventDefault(); event.stopPropagation(); } };
  const target = root as HTMLElement;
  target.addEventListener('wheel', wheel, { passive: false }); target.addEventListener('pointerdown', down); window.addEventListener('pointermove', move); window.addEventListener('pointerup', up); window.addEventListener('pointercancel', up); target.addEventListener('click', click, true);
  return () => { target.removeEventListener('wheel', wheel); target.removeEventListener('pointerdown', down); window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up); target.removeEventListener('click', click, true); };
}
