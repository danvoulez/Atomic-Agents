import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Run tests sequentially to avoid database conflicts
    sequence: {
      concurrent: false,
    },
    // Don't run test files in parallel
    fileParallelism: false,
    // Pool configuration
    pool: "forks",
    // Slower timeout for database and integration tests
    testTimeout: 60000,
    // Hook timeout for setup/teardown
    hookTimeout: 60000,
    // Environment
    globals: true,
    // Include test files
    include: ["testing/user-journeys/**/*.test.ts"],
  },
});
