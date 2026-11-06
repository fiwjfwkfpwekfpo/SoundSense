import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
const lightFixture = JSON.parse(readFileSync(new URL('../fixtures/light-colors.json', import.meta.url), 'utf8'));
import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';
export async function goTab(page: Page, name: string) {
  if (!await page.getByRole('navigation').isVisible()) {
    const collapse = page.getByRole('button', { name: 'Свернуть плеер', exact: true });
    if (await collapse.isVisible()) await collapse.click();
    else { const back = page.getByRole('button', { name: 'Назад', exact: true }).first(); if (await back.isVisible()) await back.click(); }
  }
  await page.getByRole('navigation').getByRole('button', { name: name === 'Мне нравится' ? 'Библиотека' : name, exact: true }).click();
  if (name === 'Мне нравится') {
    const card = page.getByTestId('library-liked');
    if (!await card.isVisible()) { await page.locator('main').evaluate(element => element.scrollTop = 0); await page.getByRole('navigation').getByRole('button', { name: 'Библиотека', exact: true }).click(); }
    await card.click();
  }
}
export async function openPlayer(page: Page) {
  await page.getByTestId('mini-player').getByRole('button', { name: 'Открыть плеер' }).click();
  await expect(page.getByTestId('player')).toBeVisible();
  await page.getByTestId('player').getByRole('button', { name: 'Свернуть плеер' }).click({ trial: true });
}
export async function ready(page: Page) {
  await page.addInitScript(() => {
    if (!localStorage.getItem('ss_settings_v1')) localStorage.setItem('ss_settings_v1', JSON.stringify({ onboardingDone: true }));
    document.addEventListener('DOMContentLoaded', () => {
      document.documentElement.style.setProperty('--inset-top', '48px');
      document.documentElement.style.setProperty('--inset-bottom', '24px');
      document.documentElement.style.setProperty('--inset-left', '0px');
      document.documentElement.style.setProperty('--inset-right', '0px');
    });
  });
  await page.goto('/?demo=1'); await expect(page.getByRole('heading', { name: 'Главная', exact: true })).toBeVisible();
  await page.waitForFunction(() => parseFloat(getComputedStyle(document.querySelector('.device')!).getPropertyValue('--dock-height')) > 0);
  await page.getByTestId('mini-player').click({ trial: true });
}
export async function choose(page: Page, label: string, option: string) {
  await page.getByRole('button', { name: label, exact: true }).click();
  await page.getByRole('option', { name: option, exact: true }).click();
  await expect(page.getByRole('listbox', { name: label, exact: true })).toHaveCount(0);
}
export async function chooseAppearance(page: Page, axis: string, preset: string) {
  await page.getByRole('button', { name: axis, exact: true }).click();
  const back = page.getByRole('button', { name: 'К пресетам', exact: true }); if (await back.isVisible()) await back.click();
  if (preset === 'Светлая фикстура') { await page.getByRole('option', { name: 'Свой', exact: true }).click(); await page.getByRole('textbox', { name: 'JSON пакета' }).fill(JSON.stringify(lightFixture)); }
  else await page.getByRole('option', { name: preset, exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Закрыть', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
}

export async function actualApp(page: Page, large = false) {
  await page.route('**/public/sc-api/**', route => route.fulfill({ status: 503, body: '{}' }));
  await page.addInitScript(({ large }) => {
    localStorage.setItem('ss_settings_v1', JSON.stringify({ onboardingDone: true, fontSize: large ? 130 : 100 }));
    const OriginalAudio = window.Audio;
    (window as any).__media = [];
    window.Audio = function(src?: string) { const media = new OriginalAudio(src); (window as any).__media.push(media); return media; } as unknown as typeof Audio;
    document.addEventListener('DOMContentLoaded', () => { document.documentElement.style.setProperty('--inset-top', '48px'); document.documentElement.style.setProperty('--inset-bottom', '24px'); });
  }, { large });
  await page.goto('/'); await expect(page.getByRole('heading', { name: 'Главная', exact: true })).toBeVisible();
}
export async function importFiles(page: Page, paths = ['one.mp3', 'two.flac', 'broken.mp3']) {
  await page.getByRole('button', { name: 'Импорт музыки', exact: true }).click();
  await page.getByRole('button', { name: 'Файлы', exact: true }).click();
  const chooserPromise = page.waitForEvent('filechooser'); await page.getByRole('button', { name: 'Выбрать треки', exact: true }).click();
  await (await chooserPromise).setFiles(paths.map(path => resolve('tests/fixtures/audio', path)));
  await expect(page.getByTestId('local-preview')).toBeVisible();
}
