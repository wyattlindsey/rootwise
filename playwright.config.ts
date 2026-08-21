import { defineConfig, devices } from '@playwright/test';

const PORT = 3100;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: `http://127.0.0.1:${String(PORT)}`,
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `npm run build && npm run start -- --port ${String(PORT)}`,
    url: `http://127.0.0.1:${String(PORT)}`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    env: {
      // The whole point of the fake model: the browser suite is deterministic,
      // instant, and free. No key, no network, no flake.
      ROOTWISE_FAKE_MODEL: '1',
      PERENUAL_API_KEY: 'sk-e2e-fixture',
    },
  },
});
