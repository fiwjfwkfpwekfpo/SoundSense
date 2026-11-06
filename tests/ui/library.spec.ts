import { test, expect } from '@playwright/test';
import { ready, goTab } from './helpers';

test('library island separates likes, playlists, history and offline and retains child routes', async ({ page }) => {
  await ready(page);
  await goTab(page, 'Библиотека');
  const nav = page.getByRole('navigation');
  await expect(nav.getByRole('button', { name: 'Мне нравится', exact: true })).toHaveCount(0);
  await expect(nav.getByRole('button', { name: 'Библиотека', exact: true })).toHaveAttribute('aria-current', 'page');
  for (const id of ['liked', 'playlists', 'history', 'downloaded']) await expect(page.getByTestId(`library-${id}`)).toBeVisible();
  await page.screenshot({ path: '/tmp/ss-library-overview.png' });
  await page.getByTestId('library-liked').click();
  await expect(page.getByTestId('virtual-list')).toHaveAttribute('data-total', '2048');
  await page.getByRole('button', { name: 'Назад', exact: true }).click();
  await page.getByTestId('library-playlists').click();
  await expect(page.getByRole('heading', { name: 'Плейлисты', exact: true }).first()).toBeVisible();
  await expect(page.locator('.grid').getByRole('button', { name: /^Мне нравится,/ })).toHaveCount(0);
  await page.getByRole('button', { name: 'Назад', exact: true }).click();
  await page.getByTestId('library-history').click();
  await goTab(page, 'Поиск'); await goTab(page, 'Библиотека');
  await expect(page.getByRole('heading', { name: 'История', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Назад', exact: true }).click();
  await page.getByTestId('library-downloaded').click();
  await expect(page.getByRole('heading', { name: 'Офлайн', exact: true })).toBeVisible();
  const ids = await page.locator('[data-track-id]').evaluateAll(rows => rows.map(row => row.getAttribute('data-track-id')));
  expect(new Set(ids).size).toBe(ids.length);
});
