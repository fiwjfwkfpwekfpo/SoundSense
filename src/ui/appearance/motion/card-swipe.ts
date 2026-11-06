import { tick } from 'svelte';
const running = new WeakMap<HTMLElement, () => void>();
export function cancelCardSwap(node: HTMLElement): void { running.get(node)?.(); }
/** Animate the complete card. The old pixels continue from the release position. */
export async function swapCard(node: HTMLElement, direction: 1 | -1, offset: number, change: () => boolean): Promise<void> {
  cancelCardSwap(node);
  const width = node.offsetWidth;
  const duration = Math.min(240, parseFloat(document.documentElement.style.getPropertyValue('--motion-player-duration')) || 0);
  if (!duration) { node.style.transform = ''; change(); return; }
  const previous = node.cloneNode(true) as HTMLElement;
  previous.setAttribute('aria-hidden', 'true'); previous.setAttribute('inert', ''); previous.removeAttribute('data-testid');
  previous.querySelectorAll('[data-testid]').forEach(element => element.removeAttribute('data-testid'));
  previous.classList.add('mini-outgoing');
  previous.style.cssText = `position:absolute;inset:0;width:100%;height:100%;pointer-events:none;transform:translateX(${offset}px);`;
  node.parentElement?.append(previous);
  const outgoing = previous.animate([{ transform: `translateX(${offset}px)`, opacity: 1 }, { transform: `translateX(${-direction * width}px)`, opacity: .35 }], { duration, easing: 'cubic-bezier(.16,1,.3,1)', fill: 'forwards' });
  let incoming: Animation | undefined;
  const cleanup = () => { outgoing.cancel(); incoming?.cancel(); previous.remove(); if (running.get(node) === cleanup) { running.delete(node); node.style.transform = ''; } };
  running.set(node, cleanup);
  node.style.transform = `translateX(${direction * width}px)`;
  const changed = change();
  await tick();
  if (running.get(node) !== cleanup) return;
  if (!changed) { outgoing.cancel(); previous.remove(); node.style.transform = `translateX(${offset}px)`; }
  incoming = node.animate([{ transform: `translateX(${changed ? direction * width : offset}px)`, opacity: changed ? .35 : 1 }, { transform: 'translateX(0)', opacity: 1 }], { duration, easing: 'cubic-bezier(.16,1,.3,1)' });
  node.style.transform = '';
  try { await incoming.finished; } catch { /* A newer swipe replaces this animation. */ }
  cleanup();
}
