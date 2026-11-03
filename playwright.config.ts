import { defineConfig } from "@playwright/test";

const port = 4173;

export default defineConfig({
  testDir: "tests",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: "line",
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: "off",
    locale: "ko-KR",
  },
  webServer: {
    command: `npm run preview -- --host 127.0.0.1 --port ${port} --strictPort`,
    url: `http://127.0.0.1:${port}/app/`,
    reuseExistingServer: false,
    timeout: 60_000,
  },
  projects: [
    {
      name: "wide",
      use: { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, colorScheme: "light" },
    },
    {
      name: "wide-dark",
      use: { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, colorScheme: "dark" },
    },
    {
      name: "phone",
      use: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, colorScheme: "light", hasTouch: true, isMobile: true },
    },
  ],
});
