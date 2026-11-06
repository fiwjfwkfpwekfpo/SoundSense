import { test, expect } from '@playwright/test';
import { ready, openPlayer } from './helpers';
test('swiping the mini player animates the complete card and an upward swipe opens the player', async ({ page }) => {
  await ready(page); const mini = page.getByTestId('mini-player');
  const title = await mini.locator('strong').textContent(), box = (await mini.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + 30); await page.mouse.down(); await page.mouse.move(box.x + box.width / 2 - 110, box.y + 30, { steps: 6 }); await page.mouse.up();
  await expect(page.locator('.mini-outgoing')).toHaveCount(1);
  expect(await page.locator('.mini-outgoing button').count()).toBe(4);
  await expect(mini.locator('strong')).not.toHaveText(title!);
  await expect(page.locator('.mini-outgoing')).toHaveCount(0);
  await page.mouse.move(box.x + 85, box.y + 35); await page.mouse.down(); await page.mouse.move(box.x + 85, box.y - 40, { steps: 6 }); await page.mouse.up();
  await expect(page.getByTestId('player')).toBeVisible(); await expect(page.getByRole('navigation')).toHaveCount(0);
});
test('released player artwork keeps its swipe position without snapping to the center', async ({ page }) => {
  await ready(page); await openPlayer(page); const art = page.getByTestId('track-artwork'), box = (await art.boundingBox())!;
  await art.evaluate(node => { const observer = new MutationObserver(() => { const outgoing = node.querySelector('.outgoing'); if (outgoing) { (window as any).__releaseX = outgoing.getBoundingClientRect().x; observer.disconnect(); } }); observer.observe(node, { childList: true }); });
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down(); await page.mouse.move(box.x + box.width / 2 - 100, box.y + box.height / 2, { steps: 8 });
  const before = (await art.locator('.current').boundingBox())!; await page.mouse.up();
  await expect.poll(() => page.evaluate(() => (window as any).__releaseX)).not.toBeUndefined();
  const after = await page.evaluate(() => (window as any).__releaseX as number);
  expect(Math.abs(after - before.x)).toBeLessThan(35);
  await expect(art.locator('.outgoing')).toHaveCount(0); await expect(page.getByRole('navigation')).toHaveCount(0);
});
