import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
const version: string = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')).version;
const signed = readFileSync(new URL(`../fixtures/updates/stable-${version}.json`, import.meta.url), 'utf8');

test('update menu checks an authenticated release, rejects tampering in both languages', async ({ page }) => {
  await page.route('**/public/**', route => route.fulfill({ status: 503, body: 'Offline for isolated UI test' }));
  let tamper = false;
  await page.route('https://raw.githubusercontent.com/fiwjfwkfpwekfpo/SoundSense/releases/stable.json', route => route.fulfill({ contentType: 'application/json', body: tamper ? '{"schema":1,"payload":"e30=","signature":"' + '00'.repeat(64) + '"}' : signed, headers: { 'Access-Control-Allow-Origin': '*' } }));
  await page.goto('/');
  await page.getByRole('button', { name: 'Пропустить', exact: true }).click(); await page.getByRole('button', { name: 'Пропустить', exact: true }).click(); await page.getByRole('button', { name: 'Пропустить', exact: true }).click();
  await page.getByRole('navigation').getByRole('button', { name: 'Настройки', exact: true }).click();
  await page.getByRole('button', { name: 'О приложении и обновления', exact: true }).click();
  await page.getByRole('button', { name: 'Проверить обновления', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Установлена актуальная версия', exact: true })).toBeVisible();
  tamper = true; await page.getByRole('button', { name: 'Проверить обновления', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Подпись версии не прошла проверку');
  await expect(page.getByText('Сервер и резервные зеркала')).toHaveCount(0);
  await page.getByRole('button', { name: 'Назад', exact: true }).click();
  await page.getByRole('button', { name: 'Язык', exact: true }).click(); await page.getByRole('option', { name: 'English', exact: true }).click();
  await page.getByRole('button', { name: 'About and updates', exact: true }).click();
  await expect(page.getByRole('heading', { name: `What’s new in ${version}`, exact: true })).toBeVisible();
  await expect(page.getByRole('alert')).toContainText('signature');
});
