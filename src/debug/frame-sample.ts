/** Observe one transition, then write one bounded record. No per-frame persistence or bridge calls. */
export function sampleTransition(duration: number, report: (value: { frames: number; p95: number; max: number; over50ms: number; elapsedMs: number; cancelled: boolean; backgrounded: boolean }) => void): () => void {
  const intervals: number[] = [];
  const start = performance.now(); let previous = start, frame = 0, finished = false;
  let backgrounded = document.hidden;
  const visibility = () => { if (document.hidden) backgrounded = true; };
  document.addEventListener('visibilitychange', visibility);
  function finish(cancelled = false) {
    if (finished) return; finished = true; cancelAnimationFrame(frame);
    document.removeEventListener('visibilitychange', visibility);
    if (!intervals.length) return;
    intervals.sort((a, b) => a - b);
    report({ frames: intervals.length, p95: Math.round(intervals[Math.floor(intervals.length * .95)]!), max: Math.round(intervals.at(-1)!), over50ms: intervals.filter(value => value > 50).length, elapsedMs: Math.round(performance.now() - start), cancelled, backgrounded });
  }
  function tick(now: number) { intervals.push(now - previous); previous = now; if (now - start < duration) frame = requestAnimationFrame(tick); else finish(); }
  frame = requestAnimationFrame(tick);
  return () => finish(true);
}
