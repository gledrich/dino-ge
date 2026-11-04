import { defineConfig, devices } from '@playwright/test';

const url = 'http://127.0.0.1:17343';
export default defineConfig({
  testDir: './e2e',
  projects: [
    { name: 'chromium', use: devices['Desktop Chrome'] },
    { name: 'firefox', use: devices['Desktop Firefox'] },
    { name: 'webkit', use: devices['Desktop Safari'] },
  ],
  use: { baseURL: url },
  webServer: {
    command: 'node server.js',
    env: { PORT: '17343' },
    cwd: './',
    url,
    reuseExistingServer: false,
  },
});
