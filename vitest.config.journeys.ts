import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  resolve: {
    alias: {
      "@ai-coding-team/db": path.resolve(__dirname, "packages/db/dist"),
      "@ai-coding-team/agents": path.resolve(__dirname, "packages/agents/dist"),
      "@ai-coding-team/types": path.resolve(__dirname, "packages/types/dist"),
      "@ai-coding-team/tools": path.resolve(__dirname, "packages/tools/dist"),
    },
  },
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
