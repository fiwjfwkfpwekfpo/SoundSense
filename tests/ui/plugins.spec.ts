import { expect, test } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { strToU8, zipSync } from 'fflate';
import { projectRoot } from '../../config/playwright/ui.config';
import { actualApp, goTab } from './helpers';

async function openPlugins(page: import('@playwright/test').Page) {
  await actualApp(page);
  await goTab(page, 'Настройки');
  await page.getByRole('button', { name: /^Плагины/ }).click();
}

/** A real module Worker in Chromium: the sandbox loads the plugin and the app answers its requests. */
test('installs the example plugin, runs it in the sandbox and turns it off', async ({ page }) => {
  const file = execFileSync(process.execPath, ['scripts/pack-plugin.mjs', 'plugins/src/play-counter', 'artifacts/tests/plugins'], { cwd: projectRoot, encoding: 'utf8' }).trim();
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await openPlugins(page);
  await page.locator('input[type=file]').setInputFiles(`${projectRoot}/${file}`);
  const card = page.locator('[data-plugin="app.soundsense.example.play-counter"]');
  await expect(card).toContainText('выключен');
  await expect(card).toContainText('Видеть, какой трек играет');
  await card.getByRole('switch').click();
  await expect(card).toContainText('работает', { timeout: 10_000 });
  // Its own screen, drawn by the app; a toggle on it goes back to the plugin and comes back changed.
  await card.getByRole('button', { name: 'Открыть', exact: true }).click();
  const screen = page.locator('[data-plugin-screen="app.soundsense.example.play-counter"]');
  await expect(screen.getByRole('heading', { name: 'Счётчик прослушиваний' })).toBeVisible();
  await expect(screen).toContainText('Пока пусто');
  const toggle = screen.getByRole('switch', { name: /Сообщать/ });
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  await page.getByRole('button', { name: 'Назад', exact: true }).first().click();
  await card.getByRole('switch').click();
  await expect(card).toContainText('выключен');
  expect(errors).toEqual([]);
});

test('the plugin worker has no direct network, storage or remote code', async ({ page }) => {
  mkdirSync(`${projectRoot}/artifacts/tests/plugins`, { recursive: true });
  const path = `${projectRoot}/artifacts/tests/plugins/probe.ssplugin`;
  writeFileSync(path, zipSync({
    'manifest.json': strToU8(JSON.stringify({ id: 'dev.test.probe', name: 'Probe', version: '1.0.0', apiVersion: '1.0', permissions: ['notify'] })),
    'main.js': strToU8(`export async function activate(api) {
      let remote = 'loaded'; try { await import('https://cdn.jsdelivr.net/npm/left-pad@1.3.0/+esm'); } catch { remote = 'blocked'; }
      let net = 'denied'; try { await api.net.fetch('https://example.com/'); net = 'allowed'; } catch {}
      await api.ui.toast([typeof fetch, typeof XMLHttpRequest, typeof WebSocket, typeof indexedDB, typeof importScripts, remote, net].join(' '));
    }`),
  }));
  await openPlugins(page);
  await page.locator('input[type=file]').setInputFiles(path);
  await page.locator('[data-plugin="dev.test.probe"]').getByRole('switch').click();
  await expect(page.getByRole('status').filter({ hasText: 'Probe:' })).toHaveText('Probe: undefined undefined undefined undefined undefined blocked denied', { timeout: 10_000 });
});
