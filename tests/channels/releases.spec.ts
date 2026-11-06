import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { actualApp, goTab, importFiles } from '../ui/helpers';

test('one package: the channel picked in Settings decides diagnostics and the update manifest', async ({ page, request }, info) => {
  const channel = info.project.name, beta = channel === 'beta';
  const metadata = await (await request.get('/release.json')).json();
  expect(metadata).toMatchObject({ channel, debugTools: true, appId: 'app.soundsense' });
  await page.route('https://**/*', route => route.fulfill({ status: 503, body: 'Offline for isolated release test' }));
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await actualApp(page);
  await importFiles(page, ['one.mp3', 'two.flac']);
  await page.getByRole('button', { name: 'Добавить треки · 2', exact: true }).click();
  await page.getByTestId('import-result').getByRole('button', { name: 'Открыть результат', exact: true }).click();
  await page.getByRole('button', { name: 'Воспроизвести: Тест локального импорта — длинное название трека, SoundSense Test', exact: true }).click();
  await page.getByTestId('mini-player').getByRole('button', { name: 'Открыть плеер', exact: true }).click();
  await page.getByTestId('player').getByRole('button', { name: 'Следующий трек', exact: true }).click();
  await expect(page.getByTestId('player')).toContainText('Local FLAC test');
  await page.getByTestId('player').getByRole('button', { name: 'Пауза', exact: true }).click();
  await goTab(page, 'Настройки');
  await expect(page.getByRole('button', { name: 'Диагностика и журнал', exact: true })).toHaveCount(beta ? 1 : 0);
  await expect(page.locator('footer')).toContainText(channel);
  if (beta) {
    await page.getByRole('button', { name: 'Диагностика и журнал', exact: true }).click();
    await page.getByRole('button', { name: 'Начать запись', exact: true }).click();
    await expect(page.locator('.rec-pill')).toBeVisible();
    await page.locator('.rec-pill').getByRole('button').click();
    await expect(page.locator('.rec-pill')).toHaveCount(0);
    await page.getByRole('button', { name: 'Диагностика и журнал', exact: true }).click();
    const downloaded = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Сохранить журнал', exact: true }).click();
    const file = await downloaded;
    const data = JSON.parse(await readFile((await file.path())!, 'utf8'));
    expect(data.entries.some((entry: { scope: string; event: string }) => entry.scope === 'profile' && entry.event === 'summary')).toBe(true);
    await page.getByRole('button', { name: 'Назад', exact: true }).first().click();
  } else {
    await page.waitForTimeout(2300);
    expect(await page.evaluate(() => localStorage.getItem('ss_diagnostics_v1'))).toBeNull();
  }
  await goTab(page, 'Настройки');
  await page.getByRole('button', { name: 'О приложении и обновления', exact: true }).click();
  await expect(page.getByText(`Канал: ${channel}`, { exact: true })).toBeVisible();
  await expect(page.getByText('Сервер и резервные зеркала')).toHaveCount(0);
  if (!beta) {
    // Switching to beta in Settings reloads into the beta channel with the debug tools.
    await goTab(page, 'Настройки');
    await page.getByTestId('release-channel').getByRole('button').first().click();
    await page.getByRole('option', { name: 'Бета' }).or(page.getByRole('button', { name: 'Бета', exact: true })).first().click();
    await page.waitForLoadState('load');
    await goTab(page, 'Настройки');
    await expect(page.getByRole('button', { name: 'Диагностика и журнал', exact: true })).toHaveCount(1);
    await expect(page.locator('footer')).toContainText('beta');
  }
  expect(errors).toEqual([]);
});
