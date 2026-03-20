import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  timeout: 300_000,
  // reporter: 'html',
  reporter: [
    ['line'],
    ['html'],
    ['allure-playwright']
  ],
  use: {
    baseURL: process.env.API_BASE_URL ?? 'https://localhost:5199',
    ignoreHTTPSErrors: true,
    extraHTTPHeaders: {
      accept: 'text/plain'
    }
  }
});