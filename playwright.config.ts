/**
 * Playwright smoke tests (docs/qa/test-plan.md §0). Runs against the production build
 * (`vite build` + `vite preview`), on two projects:
 *   desktop: 1280×720, mouse      mobile: 390×844, touch (isMobile + hasTouch)
 *
 * Environment knobs (all optional):
 *   PW_CHROMIUM_PATH  executable to use instead of Playwright's own download
 *   PW_EXTRA_LIBS     extra shared-library dir for that browser (machines without system libs)
 *   PW_BASE_URL       test an already running server instead of starting `vite preview`
 */
import { defineConfig, devices } from '@playwright/test';

const PORT = 4174;
const baseURL = process.env.PW_BASE_URL ?? `http://127.0.0.1:${PORT}/`;
const extraLibs = process.env.PW_EXTRA_LIBS;

// Software WebGL (SwiftShader) so the three.js canvas renders headless without a GPU.
const launchOptions = {
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  ...(process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {}),
  ...(extraLibs
    ? { env: { ...process.env, LD_LIBRARY_PATH: [extraLibs, process.env.LD_LIBRARY_PATH].filter(Boolean).join(':') } }
    : {}),
};

export default defineConfig({
  testDir: 'tests/e2e',
  testMatch: '**/*.spec.ts',
  // Software rendering is slow (~6 fps); tests speed game time up with setTimeScale.
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  outputDir: 'test-results',
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions,
  },
  projects: [
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 720 }, launchOptions },
    },
    {
      name: 'mobile',
      use: {
        browserName: 'chromium',
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 2,
        isMobile: true,
        hasTouch: true,
        launchOptions,
      },
    },
  ],
  ...(process.env.PW_BASE_URL
    ? {}
    : {
        webServer: {
          command: `npx vite build && npx vite preview --host 127.0.0.1 --port ${PORT} --strictPort`,
          url: baseURL,
          timeout: 180_000,
          reuseExistingServer: false,
        },
      }),
});
