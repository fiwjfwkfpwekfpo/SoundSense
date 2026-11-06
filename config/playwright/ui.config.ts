import { defineConfig } from '@playwright/test';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
export const projectRoot = fileURLToPath(new URL('../../', import.meta.url));
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || ['/usr/bin/thorium-browser', '/usr/bin/chromium', '/usr/bin/google-chrome'].find(path => existsSync(path));
export default defineConfig({
  testDir: '../../tests/ui', outputDir: '../../artifacts/tests/ui', fullyParallel: false, workers: 1, timeout: 30000,
  expect: { timeout: 5000 }, reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:5173', viewport: { width: 412, height: 915 },
    deviceScaleFactor: 2, isMobile: true, hasTouch: true,
    launchOptions: { executablePath, args: ['--no-sandbox'] }, trace: 'retain-on-failure',
  },
  projects: [
    { name: 'beta', testIgnore: 'updates.spec.ts' },
    { name: 'stable-updates', testMatch: 'updates.spec.ts', use: { baseURL: 'http://127.0.0.1:5174' } },
  ],
  webServer: [
    { command: 'npm run dev:beta', cwd: projectRoot, url: 'http://127.0.0.1:5173', reuseExistingServer: !process.env.CI },
    { command: 'npm run dev:stable -- --port 5174', cwd: projectRoot, url: 'http://127.0.0.1:5174', reuseExistingServer: !process.env.CI },
  ],
});
