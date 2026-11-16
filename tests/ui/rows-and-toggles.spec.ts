import { test, expect } from '@playwright/test';
import { ready, openPlayer, goTab } from './helpers';
test('preset chips scroll with the mouse wheel and by dragging, and a drag does not press a chip', async ({ page }) => {
  await ready(page); await openPlayer(page);
  await page.getByTestId('player').getByRole('button', { name: 'Звук', exact: true }).click();
  const row = page.locator('.presets'), box = (await row.boundingBox())!;
  expect(await row.evaluate(node => node.scrollWidth > node.clientWidth)).toBe(true);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.wheel(0, 240);
  await expect.poll(() => row.evaluate(node => node.scrollLeft)).toBeGreaterThan(100);
  const before = await row.evaluate(node => node.scrollLeft), active = await row.locator('.chip.active').count();
  await page.mouse.down(); await page.mouse.move(box.x + box.width / 2 + 90, box.y + box.height / 2, { steps: 5 }); await page.mouse.up();
  expect(await row.evaluate(node => node.scrollLeft)).toBeLessThan(before - 50);
  expect(await row.locator('.chip.active').count()).toBe(active);
});
test('collapsing the player after the lyrics leaves the player, and active toggles use the accent colour', async ({ page }) => {
  await ready(page); await openPlayer(page); const player = page.getByTestId('player');
  const shuffle = player.getByRole('button', { name: 'Перемешивание', exact: true }), colour = () => shuffle.evaluate(node => getComputedStyle(node).color);
  const off = await colour(); await shuffle.click(); await expect(shuffle).toHaveAttribute('aria-pressed', 'true'); expect(await colour()).not.toBe(off);
  await player.getByRole('button', { name: 'Текст песни', exact: true }).click(); await expect(page.getByRole('heading', { name: 'Текст песни' })).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new Event('app:back'))); await expect(page.getByTestId('player')).toBeVisible();
  await page.getByTestId('player').getByRole('button', { name: 'Свернуть плеер' }).click();
  await expect(page.getByTestId('player')).toHaveCount(0); await expect(page.getByRole('navigation')).toBeVisible();
});
test('the playlist shuffle button shows whether this list plays shuffled', async ({ page }) => {
  await ready(page); await goTab(page, 'Мне нравится');
  const button = page.locator('main').getByRole('button', { name: 'Перемешать', exact: true });
  await expect(button).toHaveAttribute('aria-pressed', 'false'); const off = await button.evaluate(node => getComputedStyle(node).color);
  await button.click(); await expect(button).toHaveAttribute('aria-pressed', 'true');
  expect(await button.evaluate(node => getComputedStyle(node).color)).not.toBe(off);
  await button.click(); await expect(button).toHaveAttribute('aria-pressed', 'false');
});
