import { test, expect } from '@playwright/test';
test.skip(process.env.SS_NETWORK_TEST !== '1', 'Opt-in live public-service check');
test('live SoundCloud chart/search/full stream and Spotify chart', async ({ page }) => {
  test.setTimeout(90000);
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    localStorage.setItem('ss_settings_v1', JSON.stringify({ onboardingDone: true }));
    const OriginalAudio = window.Audio; (window as any).__media = [];
    window.Audio = function(src?: string) { const media = new OriginalAudio(src); (window as any).__media.push(media); return media; } as unknown as typeof Audio;
  });
  await page.goto('/'); const charts = page.getByTestId('charts');
  await expect(charts.locator('[data-track-id]')).toHaveCount(5, { timeout: 25000 });
  await page.screenshot({ path: 'docs/screens/live/charts-soundcloud.png' });
  await charts.getByRole('button', { name: 'Spotify', exact: true }).click(); await expect(charts.locator('[data-track-id]')).toHaveCount(5, { timeout: 20000 });
  expect(await charts.locator('[data-track-id]').first().getAttribute('data-track-id')).toMatch(/^spotify-/);
  await page.screenshot({ path: 'docs/screens/live/charts-spotify.png' });
  await page.getByRole('navigation').getByRole('button', { name: 'Поиск', exact: true }).click();
  await page.getByRole('textbox', { name: 'Поиск музыки', exact: true }).fill('lofi');
  await expect(page.locator('[data-track-id]').first()).toBeVisible({ timeout: 20000 });
  await page.locator('[data-track-id]').first().locator('.track-main').click();
  await expect.poll(() => page.evaluate(() => (window as any).__media.some((media: HTMLAudioElement) => !media.paused && media.currentTime > 1)), { timeout: 25000 }).toBe(true);
  const result = await page.evaluate(() => (window as any).__media.filter((media: HTMLAudioElement) => !media.paused).map((media: HTMLAudioElement) => ({ duration: media.duration, position: media.currentTime })));
  expect(result[0].duration).toBeGreaterThan(60);
  await page.screenshot({ path: 'docs/screens/live/search-soundcloud-playing.png' });
  expect(errors).toEqual([]);
});
