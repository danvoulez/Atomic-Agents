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
    // Slower timeout for database tests
    testTimeout: 30000,
    // Hook timeout for setup/teardown
    hookTimeout: 30000,
  },
});

