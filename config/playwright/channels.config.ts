import { defineConfig } from '@playwright/test';
import base, { projectRoot } from './ui.config';

export default defineConfig({
  ...base,
  testDir: '../../tests/channels', outputDir: '../../artifacts/tests/channels',
  use: { ...base.use, trace: 'retain-on-failure' },
  projects: [
    { name: 'stable', use: { baseURL: 'http://127.0.0.1:4174' } },
    { name: 'beta', use: { baseURL: 'http://127.0.0.1:4175' } },
  ],
  webServer: [
    { command: 'npm run preview -- --port 4174', cwd: projectRoot, url: 'http://127.0.0.1:4174', reuseExistingServer: false },
    { command: 'npm run preview:beta -- --port 4175', cwd: projectRoot, url: 'http://127.0.0.1:4175', reuseExistingServer: false },
  ],
});
