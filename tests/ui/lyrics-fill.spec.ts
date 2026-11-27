import { test, expect } from '@playwright/test';
import { ready, openPlayer } from './helpers';

test('smooth lyrics sweep through the words of the current line one after another', async ({ page }) => {
  await ready(page); await openPlayer(page);
  await page.getByTestId('player').getByRole('button', { name: 'Текст песни', exact: true }).click();
  const line = page.locator('.lines button.active');
  await expect(line).toBeVisible();
  await expect(line.locator('.word').first()).toBeVisible();
  const words = await line.locator('.word').count();
  expect(words).toBeGreaterThan(1);
  // Every word has its own sweep, staggered in time, so a wrapped line never lights up at once.
  const delays = await line.locator('.word').evaluateAll(spans => spans.map(span => Number(span.getAnimations()[0]?.effect?.getTiming().delay ?? -1)));
  expect(delays.every(delay => delay >= 0)).toBe(true);
  expect(delays).toEqual([...delays].sort((a, b) => a - b));
  expect(delays.at(-1)!).toBeGreaterThan(delays[0]!);
});

test('choice lists open as a centred dialog', async ({ page }) => {
  await ready(page);
  await page.getByRole('navigation').getByRole('button', { name: 'Настройки', exact: true }).click();
  await page.getByRole('button', { name: 'Чарт по умолчанию', exact: true }).click();
  const dialog = page.getByRole('dialog'); await expect(dialog).toBeVisible();
  const box = (await dialog.boundingBox())!, viewport = page.viewportSize()!;
  expect(Math.abs(box.y + box.height / 2 - viewport.height / 2)).toBeLessThan(viewport.height * .2);
});

test('a late word-timed version keeps the same verse and its visible position', async ({ page }) => {
  await ready(page);
  await page.evaluate(async () => {
    const module = '/src/mock/lyrics.ts';
    const { mockLyrics } = await import(module);
    const lines = Array.from({ length: 24 }, (_, i) => ({ time: i * 4, text: 'Verse ' + i }));
    const first = { trackId: 'track-1', language: 'en', creditKey: 'lyrics.original', lines };
    let calls = 0;
    mockLyrics.getLyrics = () => ++calls === 1 ? Promise.resolve(first) : new Promise(resolve => {
      window.addEventListener('test:upgrade', () => resolve({ ...first, words: true, lines: [
        { time: 0, text: 'Intro' }, ...lines.map(line => ({ ...line, time: line.time + .2, words: [{ time: line.time + .2, text: line.text }] })),
      ] }), { once: true });
    });
  });
  await openPlayer(page);
  await page.getByTestId('player').getByRole('button', { name: 'Текст песни', exact: true }).click();
  const verse = page.getByRole('button', { name: 'Verse 14', exact: true });
  await verse.click();
  await expect(verse).toHaveAttribute('aria-current', 'true');
  const y = () => verse.evaluate(element => element.getBoundingClientRect().top);
  await verse.evaluate(element => Promise.all(element.closest('.lyrics-scroll')!.getAnimations({ subtree: true })
    .filter(animation => animation.playState === 'running').map(animation => animation.finished)));
  const before = await y();
  await page.evaluate(() => dispatchEvent(new Event('test:upgrade')));
  await expect(verse).toHaveAttribute('data-line', '15');
  await expect(verse).toHaveAttribute('aria-current', 'true');
  expect(Math.abs((await y()) - before)).toBeLessThan(2);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(verse.locator('.word')).toHaveCount(0);
});
