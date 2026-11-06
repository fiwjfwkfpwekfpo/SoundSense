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
