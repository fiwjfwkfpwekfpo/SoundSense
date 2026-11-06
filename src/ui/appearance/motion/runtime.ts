import type { TransitionConfig } from 'svelte/transition';
import type { Easing, MotionGroup, MotionParameters } from '../schema';

export interface MotionOptions { group: MotionGroup; key?: unknown; enabled?: boolean; effect?: string; duration?: number }
interface RuntimeMotion { effect: string; duration: number; easing: string; progress: 'smooth' | 'stepped' }
const curves = {
  standard: [.2, .7, .2, 1], emphasized: [.16, 1, .3, 1], spring: [.34, 1.56, .64, 1],
} as const;

export function easingToCss(easing: Easing): string {
  if (Array.isArray(easing)) return `cubic-bezier(${easing.join(',')})`;
  if (easing === 'linear' || /^steps\((?:[2-9]|1[0-2])\)$/.test(easing)) return easing;
  return `cubic-bezier(${curves[easing as keyof typeof curves]?.join(',') ?? curves.standard.join(',')})`;
}

export function effectiveMotion(group: MotionGroup, parameters: MotionParameters, options: { speed: number; lowPower: boolean; off?: boolean }): MotionParameters {
  const speed = Number.isFinite(options.speed) ? Math.max(.5, Math.min(2, options.speed)) : 1;
  return { ...parameters, effect: options.lowPower && ['blur', 'goo'].includes(parameters.effect) ? parameters.effect === 'goo' ? 'stack' : 'fade' : parameters.effect,
    duration: options.off || parameters.effect === 'none' && group !== 'waveform' ? 0 : parameters.duration / speed };
}

function cubicBezier(points: readonly number[]): (t: number) => number {
  const [x1, y1, x2, y2] = points;
  const coordinate = (t: number, a: number, b: number) => 3 * (1 - t) ** 2 * t * a + 3 * (1 - t) * t ** 2 * b + t ** 3;
  return value => {
    if (value <= 0 || value >= 1) return value;
    let low = 0; let high = 1; let t = value;
    for (let i = 0; i < 15; i++) {
      const x = coordinate(t, x1!, x2!);
      if (Math.abs(x - value) < .00001) break;
      if (x < value) low = t; else high = t;
      t = (low + high) / 2;
    }
    return coordinate(t, y1!, y2!);
  };
}

function easingFunction(css: string): (t: number) => number {
  const steps = /^steps\((\d+)(?:,\s*(?:end|jump-end))?\)$/.exec(css);
  if (steps) return t => t === 1 ? 1 : Math.floor(t * Number(steps[1])) / Number(steps[1]);
  const bezier = /^cubic-bezier\(([^)]+)\)$/.exec(css);
  if (bezier) return cubicBezier(bezier[1]!.split(',').map(Number));
  return t => t;
}

function readMotion(node: Element, group: MotionGroup, effect?: string): RuntimeMotion {
  // The loader writes resolved motion tokens inline. Reading them directly avoids
  // synchronous style/layout flushes while a new title and artwork are mounting.
  const root = document.documentElement;
  const style = (node.closest(`[style*="--motion-${group}-duration"]`) as HTMLElement | null)?.style ?? root.style;
  const duration = style.getPropertyValue(`--motion-${group}-duration`).trim() || root.style.getPropertyValue(`--motion-${group}-duration`).trim();
  const owner = node.closest(`[data-motion-${group}]`) ?? document.documentElement;
  let selected = effect ?? owner.getAttribute(`data-motion-${group}`) ?? 'none';
  if (selected === 'blur' && navigator.hardwareConcurrency > 0 && navigator.hardwareConcurrency <= 4) selected = 'fade';
  return {
    effect: selected,
    duration: selected === 'none' && group !== 'waveform' ? 0 : Math.max(0, parseFloat(duration) * (duration.endsWith('ms') ? 1 : 1000) || 0),
    easing: style.getPropertyValue(`--motion-${group}-easing`).trim() || root.style.getPropertyValue(`--motion-${group}-easing`).trim() || 'linear',
    progress: (node.closest('[data-motion-waveform-progress]') ?? document.documentElement).getAttribute('data-motion-waveform-progress') === 'stepped' ? 'stepped' : 'smooth',
  };
}

let lastMiniRect: DOMRect | undefined;
let shell: { element: Element; rect: DOMRect } | undefined;
/** The full-screen player fills the app shell; its rectangle is tracked off the critical path. */
function shellRect(node: Element): DOMRect {
  const element = node.closest('.device') ?? document.documentElement;
  if (shell?.element !== element) {
    const current = shell = { element, rect: element.getBoundingClientRect() };
    new ResizeObserver(() => { current.rect = element.getBoundingClientRect(); }).observe(element);
  }
  return shell.rect;
}
let miniParts: { art?: DOMRect; text?: DOMRect; progress?: DOMRect } = {};
/** Keep the mini-player origin even while its dock is removed by navigation. */
export function rememberMiniPlayer(node: HTMLElement) {
  const remember = () => { const rect = node.getBoundingClientRect(); if (rect.width && rect.height) { lastMiniRect = rect; miniParts = { art: node.querySelector('.art')?.getBoundingClientRect(), text: node.querySelector('.text')?.getBoundingClientRect(), progress: node.querySelector('.progress')?.getBoundingClientRect() }; } };
  remember(); node.addEventListener('pointerdown', remember, { capture: true, passive: true });
  node.addEventListener('click', remember, { capture: true });
  const observer = new ResizeObserver(remember); observer.observe(node);
  return { destroy() { remember(); observer.disconnect(); node.removeEventListener('pointerdown', remember, true); node.removeEventListener('click', remember, true); } };
}

/** Actual artwork, title and wave travel between their own mini/full rectangles. */
function sharedElements(player: HTMLElement, direction: 'in' | 'out') {
  const layer = document.createElement('div'); layer.setAttribute('aria-hidden', 'true'); layer.className = 'shared-flight';
  layer.style.cssText = 'position:fixed;inset:0;z-index:100;pointer-events:none;';
  const pairs: { clone: HTMLElement; target: HTMLElement; from: DOMRect; to: DOMRect; opacity: string }[] = [];
  for (const [selector, from] of [['.art-stack', miniParts.art], ['.track-info', miniParts.text], ['.waveform', miniParts.progress]] as const) {
    const target = player.querySelector<HTMLElement>(selector); if (!target || !from?.width) continue;
    const to = target.getBoundingClientRect(); if (!to.width || !to.height) continue;
    const clone = target.cloneNode(true) as HTMLElement;
    clone.removeAttribute('data-testid'); clone.querySelectorAll('[data-testid]').forEach(node => node.removeAttribute('data-testid'));
    clone.style.cssText = `position:absolute;left:${to.left}px;top:${to.top}px;width:${to.width}px;height:${to.height}px;transform-origin:0 0;margin:0;pointer-events:none;`;
    layer.append(clone); pairs.push({ clone, target, from, to, opacity: target.style.opacity }); target.style.opacity = '0';
    if (selector === '.waveform') {
      const sourceCanvases = target.querySelectorAll('canvas'), clones = clone.querySelectorAll('canvas');
      sourceCanvases.forEach((canvas, index) => { const copy = clones[index]; if (copy) { copy.width = canvas.width; copy.height = canvas.height; copy.getContext('2d')?.drawImage(canvas, 0, 0); } });
    }
  }
  player.ownerDocument.body.append(layer); let removed = false;
  const cleanup = () => { if (removed) return; removed = true; pairs.forEach(pair => pair.target.style.opacity = pair.opacity); layer.remove(); };
  const timeout = setTimeout(cleanup, 2200);
  return { update(t: number) {
    if (removed) return;
    for (const { clone, from, to } of pairs) clone.style.transform = `translate(${(from.left - to.left) * (1 - t)}px,${(from.top - to.top) * (1 - t)}px) scale(${from.width / to.width + (1 - from.width / to.width) * t},${from.height / to.height + (1 - from.height / to.height) * t})`;
    if (direction === 'in' ? t >= 1 : t <= 0) { clearTimeout(timeout); cleanup(); }
  } };
}

export function generalEffect(effect: string): boolean {
  const selected = document.documentElement.dataset.motionGeneral;
  return selected === 'fluid' || selected === effect;
}

export function flyToMini(node: HTMLElement) {
  if (!generalEffect('listen-flight')) return;
  const from = node.getBoundingClientRect(), to = document.querySelector('[data-testid="mini-player"]')?.getBoundingClientRect();
  if (!to) return;
  const clone = node.cloneNode(true) as HTMLElement; clone.setAttribute('aria-hidden', 'true'); clone.className = 'listen-flight';
  clone.style.cssText = `position:fixed;left:${from.left}px;top:${from.top}px;width:${from.width}px;height:${from.height}px;z-index:100;pointer-events:none;background:var(--color-accent);color:var(--color-on-accent);border-radius:var(--radius-full);display:grid;place-items:center;transform-origin:0 0;`;
  document.body.append(clone);
  const duration = readMotion(node, 'general').duration;
  const animation = clone.animate([{ transform: 'none', opacity: 1 }, { transform: `translate(${to.left - from.left}px,${to.top - from.top}px) scale(${to.width / from.width},${to.height / from.height})`, opacity: 0 }], { duration, easing: 'cubic-bezier(.2,.7,.2,1)' });
  void animation.finished.finally(() => clone.remove());
}

export function miniDrop(node: HTMLElement) {
  const selected = readMotion(node, 'player');
  if (!['shared', 'drop'].includes(selected.effect) || !selected.duration) return;
  const animation = node.animate([{ transform: 'translateY(55px) scale(.25,.5)', borderRadius: 'var(--radius-full)', opacity: 0 }, { transform: 'translateY(-8px) scale(.97,1.06)', offset: .7, opacity: 1 }, { transform: 'none', opacity: 1 }], { duration: selected.duration, easing: 'cubic-bezier(.2,.7,.2,1)' });
  return { destroy() { animation.cancel(); } };
}

export function cascade(node: HTMLElement) {
  if (!generalEffect('cascade')) return;
  const virtualPosition = node.parentElement?.style.transform.match(/translateY\(([\d.]+)/)?.[1];
  const order = virtualPosition !== undefined ? Number(virtualPosition) / (parseFloat(document.documentElement.style.getPropertyValue('--track-height')) || 68) : [...node.parentElement?.children ?? []].filter(element => element.classList.contains('swipe-row')).indexOf(node);
  // Virtualized rows mounted later while scrolling must appear immediately.
  if (order > 9) return;
  const selected = readMotion(node, 'general');
  const animation = node.animate([{ transform: 'translateY(18px)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: selected.duration, delay: order * 24, fill: 'backwards', easing: selected.easing });
  return { destroy() { animation.cancel(); } };
}

export function playPause(node: SVGPathElement, playing: boolean) {
  const a = [[7,4],[13.5,8],[13.5,16],[7,20],[13.5,8],[20,12],[20,12],[13.5,16]], b = [[6,5],[10,5],[10,19],[6,19],[14,5],[18,5],[18,19],[14,19]];
  let current = (playing ? b : a).map(point => [...point]), cancel = () => {};
  const render = (points: number[][]) => node.setAttribute('d', `M${points[0]}L${points[1]}L${points[2]}L${points[3]}ZM${points[4]}L${points[5]}L${points[6]}L${points[7]}Z`);
  render(current);
  return { update(next: boolean) { cancel(); const target = next ? b : a; const from = current;
    const duration = readMotion(node, 'general').duration;
    if (!generalEffect('play-morph') || !duration) { current = target.map(point => [...point]); render(current); return; }
    cancel = tween(duration, 'cubic-bezier(.34,1.56,.64,1)', value => { current = from.map((point, i) => point.map((n, j) => n + (target[i]![j]! - n) * value)); render(current); });
  }, destroy() { cancel(); } };
}

function effectCss(node: Element, group: MotionGroup, effect: string): (t: number) => string {
  // Computed style is read only by effects that compose with an existing transform:
  // reading it for every transition forced a style pass of each freshly mounted node.
  const baseOf = () => { const transform = (node as HTMLElement).style?.transform || getComputedStyle(node).transform; return transform === 'none' ? '' : transform; };
  if (effect === 'fluid') effect = node.hasAttribute('data-route') ? node.getAttribute('data-route-kind') === 'tab' ? 'tab-circle' : 'depth' : 'fade';
  if (effect === 'tab-circle') {
    // Inline values: getComputedStyle here forces a full style pass of the freshly mounted screen.
    const style = (node as HTMLElement).style, x = style?.getPropertyValue('--route-x').trim() || '50%', y = style?.getPropertyValue('--route-y').trim() || '100%';
    return t => `clip-path:circle(${Math.max(0, t) * 160}% at ${x} ${y});opacity:1`;
  }
  if (effect === 'depth') return t => `transform:translateX(${(1 - t) * 16}%) scale(${.94 + .06 * t});opacity:${Math.max(0, t)}`;
  if (effect === 'crt') return t => `transform:scale(${t < .5 ? Math.max(.001, t * 2) : 1},${t < .5 ? .008 : .008 + (t - .5) * 1.984});opacity:${t > .01 ? 1 : 0}`;
  if (effect === 'drop') return t => `transform-origin:bottom;transform:translateY(${(1 - t) * 60}px) scale(${.25 + .75 * t},${.5 + .5 * t});opacity:${Math.max(0, t)}`;
  if (effect === 'stack') return t => `transform:translateX(${(1 - t) * 25}%) rotate(${(1 - t) * 8}deg) scale(${.92 + .08 * t});opacity:${Math.max(0, t)}`;
  if (effect === 'goo') return t => `clip-path:polygon(0 0,100% 0,100% ${t * 100}%,75% ${Math.min(100, t * 130)}%,50% ${t * 100}%,25% ${Math.min(100, t * 140)}%,0 ${t * 100}%);opacity:1`;
  if (effect === 'morph') return t => `transform:scaleY(${.8 + .2 * t});opacity:${Math.max(0, t)}`;
  if (group === 'player' && effect === 'expand') {
    // Cached rectangles: reading layout of the just-inserted player would force a full synchronous layout.
    const from = lastMiniRect ?? document.querySelector('[data-testid="mini-player"]')?.getBoundingClientRect();
    const to = shellRect(node);
    if (from?.width && to.width && to.height) {
      const dx = from.x + from.width / 2 - to.x - to.width / 2;
      const dy = from.y + from.height / 2 - to.y - to.height / 2;
      const sx = from.width / to.width; const sy = from.height / to.height;
      const base = baseOf(); return t => `transform-origin:center;transform:translate3d(${dx * (1 - t)}px,${dy * (1 - t)}px,0) scale(${sx + (1 - sx) * t},${sy + (1 - sy) * t}) ${base};opacity:${.25 + .75 * t}`;
    }
  }
  if (effect === 'slide-up' && group === 'player') { const base = baseOf(); return t => `transform:translate3d(0,${(1 - t) * 100}%,0) ${base};opacity:${.4 + .6 * t}`; }
  if (effect === 'slide-up' || effect === 'slide') { const base = baseOf(); return t => `transform:translate3d(${group === 'cover' ? (1 - t) * 12 : 0}%,${group === 'cover' ? 0 : (1 - t) * 14}px,0) ${base};opacity:${Math.max(0, t)}`; }
  if (effect === 'scale') { const base = baseOf(); return t => `transform:scale(${.94 + .06 * t}) ${base};opacity:${Math.max(0, t)}`; }
  if (effect === 'zoom') { const base = baseOf(); return t => `transform:scale(${1.09 - .09 * t}) ${base};opacity:${Math.max(0, t)}`; }
  if (effect === 'blur') return t => `filter:blur(${Math.max(0, (1 - t) * 6)}px);opacity:${Math.max(0, t)}`;
  if (effect === 'grow') { const base = baseOf(); return t => `transform-origin:center;transform:scaleY(${Math.max(.001, t)}) ${base};opacity:${Math.max(0, t)}`; }
  if (effect === 'sweep') { const base = baseOf(); return t => `transform-origin:left;transform:scaleX(${Math.max(.001, t)}) ${base};opacity:${Math.max(0, t)}`; }
  return t => `opacity:${Math.max(0, t)}`;
}

/** One transition implementation for all components, including their outros. */
export function motionTransition(node: Element, options: MotionOptions): (context?: { direction: 'in' | 'out' }) => TransitionConfig {
  // Svelte calls this deferred configuration with the actual direction. The
  // third argument of a bidirectional transition itself is always "both".
  return context => buildTransition(node, options, context ?? { direction: 'in' });
}

const transitionAria = new WeakMap<Element, string | null>();
function buildTransition(node: Element, options: MotionOptions, context: { direction: 'in' | 'out' }): TransitionConfig {
  if (options.enabled === false) return { duration: 0 };
  const selected = readMotion(node, options.group, options.effect);
  if (selected.duration && options.duration !== undefined) selected.duration = options.duration;
  if (selected.effect === 'none' || !selected.duration) return { duration: 0 };
  if (!transitionAria.has(node)) transitionAria.set(node, node.getAttribute('aria-hidden'));
  if (context.direction === 'out') { node.setAttribute('aria-hidden', 'true'); node.setAttribute('inert', ''); node.setAttribute('data-motion-exiting', ''); }
  else {
    const original = transitionAria.get(node); if (original === null) node.removeAttribute('aria-hidden'); else if (original) node.setAttribute('aria-hidden', original);
    node.removeAttribute('inert'); node.removeAttribute('data-motion-exiting');
  }
  const outgoing = context.direction === 'out' && (options.group === 'title' || options.group === 'cover' || node.hasAttribute('data-route'));
  const position = outgoing ? 'position:absolute;top:0;left:0;width:100%;pointer-events:none;' : '';
  if (selected.effect === 'shared' && options.group === 'player' && node instanceof HTMLElement) {
    const cleanup = sharedElements(node, context.direction);
    return { duration: selected.duration, easing: easingFunction(selected.easing), tick(t) { cleanup.update(t); }, css: t => `opacity:${.3 + .7 * t}` };
  }
  if (['split-flap', 'decipher'].includes(selected.effect)) {
    const text = node.querySelector<HTMLElement>('[data-title-text]');
    const canonical = text?.dataset.title ?? text?.textContent ?? '';
    return { duration: selected.duration, easing: t => t, tick(t) {
      if (!text) return;
      text.textContent = [...canonical].map((letter, index) => t >= 1 || t > (index + 1) / Math.max(1, canonical.length) ? letter : selected.effect === 'split-flap' ? 'АБВГДЕЖЗ0123456789'[(index + Math.floor(t * 38)) % 17] : '▓▒░#%'[(index + Math.floor(t * 32)) % 5]).join('');
      text.style.transform = selected.effect === 'split-flap' && t < 1 ? `perspective(250px) rotateX(${(1 - (t * 12 % 1)) * 35}deg)` : '';
    }, css: t => position + `opacity:${Math.min(1, t * 4)}` };
  }
  if (selected.effect === 'typewriter' && node instanceof HTMLElement) {
    const content = node.querySelector<HTMLElement>(':scope > [data-motion-content]');
    if (content) {
      const count = Math.max(2, [...(content.textContent ?? '')].length);
      const before = { transform: node.style.transform, opacity: node.style.opacity, overflow: node.style.overflow, origin: node.style.transformOrigin,
        innerTransform: content.style.transform, innerOrigin: content.style.transformOrigin };
      return { duration: selected.duration, easing: easingFunction(selected.easing),
        tick(t) {
          const progress = Math.max(0, Math.min(1, Math.ceil(t * count) / count));
          node.style.overflow = 'hidden'; node.style.transformOrigin = 'left'; content.style.transformOrigin = 'left';
          node.style.opacity = progress ? '1' : '0';
          node.style.transform = `scaleX(${Math.max(.00001, progress)})`;
          content.style.transform = `scaleX(${1 / Math.max(.00001, progress)})`;
          if (t >= 1) { node.style.transform = before.transform; node.style.opacity = before.opacity; node.style.overflow = before.overflow; node.style.transformOrigin = before.origin; content.style.transform = before.innerTransform; content.style.transformOrigin = before.innerOrigin; }
        }, css: () => position };
    }
  }
  const css = effectCss(node, options.group, selected.effect);
  return { duration: selected.duration, easing: easingFunction(selected.easing), css: t => position + css(t) };
}

function tween(duration: number, easing: string, update: (value: number) => void, finish: () => void = () => {}): () => void {
  let frame = 0; let start: number | undefined; const curve = easingFunction(easing);
  const next = (now: number) => {
    start ??= now;
    const fraction = Math.min(1, (now - start) / duration);
    update(curve(fraction));
    if (fraction < 1) frame = requestAnimationFrame(next); else finish();
  };
  frame = requestAnimationFrame(next);
  return () => cancelAnimationFrame(frame);
}

/** Replay the actual selected effect on a settings sample. Returns a cleanup. */
function createPreview(node: HTMLElement, group: MotionGroup, effect?: string): () => void {
  const selected = readMotion(node, group, effect);
  node.dataset.motionGroup = group;
  if (selected.effect === 'none' || !selected.duration) return () => {};
  if (selected.effect === 'fill') {
    const overlay = document.createElement('span'); const content = document.createElement('span');
    overlay.className = 'motion-fill'; content.className = 'motion-fill-content';
    overlay.setAttribute('aria-hidden', 'true'); content.textContent = node.textContent;
    overlay.append(content); node.append(overlay);
    const cancel = tween(selected.duration, selected.easing, value => {
      const fraction = Math.max(.00001, Math.min(1, value));
      overlay.style.transform = `scaleX(${fraction})`; content.style.transform = `scaleX(${1 / fraction})`;
    });
    return () => { cancel(); overlay.remove(); };
  }
  if (selected.effect === 'typewriter') {
    let content = node.querySelector<HTMLElement>(':scope > [data-motion-content]');
    const temporary = !content;
    if (!content) { content = document.createElement('span'); content.className = 'motion-content'; while (node.firstChild) content.append(node.firstChild); node.append(content); }
    const inner = content; const old = { transform: node.style.transform, overflow: node.style.overflow, opacity: node.style.opacity, origin: node.style.transformOrigin, inner: inner.style.transform, innerOrigin: inner.style.transformOrigin };
    const count = Math.max(2, [...(node.textContent ?? '')].length);
    const restore = () => { node.style.transform = old.transform; node.style.overflow = old.overflow; node.style.opacity = old.opacity; node.style.transformOrigin = old.origin; inner.style.transform = old.inner; inner.style.transformOrigin = old.innerOrigin; if (temporary && inner.parentNode === node) { while (inner.firstChild) node.insertBefore(inner.firstChild, inner); inner.remove(); } };
    const cancel = tween(selected.duration, selected.easing, value => {
      const fraction = Math.max(.00001, Math.min(1, Math.ceil(value * count) / count));
      node.style.overflow = 'hidden'; node.style.transformOrigin = 'left'; inner.style.transformOrigin = 'left';
      node.style.opacity = value <= 0 ? '0' : '1'; node.style.transform = `scaleX(${fraction})`; inner.style.transform = `scaleX(${1 / fraction})`;
    }, restore);
    return () => { cancel(); restore(); };
  }
  if (typeof node.animate !== 'function') return () => {};
  const css = effectCss(node, group, selected.effect);
  const frame = (value: number) => Object.fromEntries(css(value).split(';').filter(Boolean).map(declaration => {
    const at = declaration.indexOf(':'); return [declaration.slice(0, at).replace(/-([a-z])/g, (_match, c: string) => c.toUpperCase()), declaration.slice(at + 1)];
  }));
  const animation = node.animate([frame(0), frame(1)], { duration: selected.duration, easing: selected.easing });
  return () => animation.cancel();
}

const previews = new WeakMap<HTMLElement, () => void>();
export function runPreview(node: HTMLElement, group: MotionGroup, effect?: string): () => void {
  previews.get(node)?.();
  const cleanup = createPreview(node, group, effect);
  let done = false;
  const cancel = () => { if (done) return; done = true; cleanup(); if (previews.get(node) === cancel) previews.delete(node); };
  previews.set(node, cancel);
  return cancel;
}

export function motion(node: HTMLElement, initial: MotionOptions) {
  let options = initial; let cancel: () => void = () => {}; let destroyed = false;
  const play = () => { cancel(); if (!destroyed && options.enabled !== false) cancel = runPreview(node, options.group, options.effect); };
  node.dataset.motionGroup = options.group;
  queueMicrotask(play);
  return {
    update(next: MotionOptions) {
      const changed = next.group !== options.group || next.key !== options.key || next.enabled !== options.enabled || next.effect !== options.effect;
      options = next; node.dataset.motionGroup = next.group;
      if (changed) { if (next.enabled === false) cancel(); else play(); }
    }, destroy() { destroyed = true; cancel(); },
  };
}

/** Reveal an already drawn canvas using transforms; redraw is never tied to RAF. */
export function waveformProgress(node: HTMLElement, initial: { position: number; instant?: boolean; steps?: number }) {
  const content = node.firstElementChild as HTMLElement | null;
  let current = Math.max(0, Math.min(1, initial.position));
  // Motion settings change on appearance events, not on every media clock tick.
  // Reading inherited CSS here on each update forces a full style flush during palette transitions.
  let selected = readMotion(node, 'waveform');
  const refresh = () => { selected = readMotion(node, 'waveform'); };
  window.addEventListener('app:appearance', refresh);
  function render(value: number) {
    current = value; const fraction = Math.max(.00001, value);
    node.style.transform = `scaleX(${fraction})`; node.style.opacity = value > 0 ? '1' : '0';
    if (content) content.style.transform = `scaleX(${1 / fraction})`;
  }
  function update(options: { position: number; instant?: boolean; steps?: number }) {
    const count = Math.max(2, Math.min(120, options.steps ?? 64));
    const value = Math.max(0, Math.min(1, options.position));
    const target = selected.progress === 'stepped' && !options.instant ? Math.floor(value * count) / count : value;
    if (options.instant || !selected.duration || selected.progress === 'stepped' || Math.abs(target - current) > .08) { render(target); return; }
    render(target);
  }
  render(current); update(initial);
  return { update, destroy() { window.removeEventListener('app:appearance', refresh); } };
}
