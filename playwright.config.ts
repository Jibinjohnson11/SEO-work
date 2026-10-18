import { defineConfig, devices } from "@playwright/test"

// End-to-end tests (e2e/). Two kinds:
//   @readonly  safe against any running LinkOps, including one configured for production: they only
//              load pages and read endpoints (npm run e2e:readonly)
//   @writes    create users, clients, submissions and files. They run ONLY against a separate
//              staging Supabase project and refuse anything else (see e2e/support/target.ts)
//
// E2E_BASE_URL points at the app under test (default http://localhost:3000).
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: [["list"]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
})
