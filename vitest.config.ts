import { defineConfig } from "vitest/config";
import * as path from "path";

export default defineConfig({
  resolve: {
    alias: {
      "@shared/server": path.resolve(__dirname, "src/shared/server"),
      "@engine/server": path.resolve(__dirname, "src/engine/server"),
      "@games/fps/server": path.resolve(__dirname, "src/games/fps/server"),
    },
  },
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.test.ts"],
    testTimeout: 10000,
    fileParallelism: false,
    pool: "forks",
    poolOptions: {
      forks: {
        singleFork: true,
        execArgv: ["--max-old-space-size=4096"],
      },
    },
    // Visibility only (QA-22) — no thresholds yet. Run via `npm run test:coverage`;
    // the client/lobby blind spots the audit found become measurable.
    coverage: {
      provider: "v8",
      reporter: ["text-summary", "lcov"],
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts", "src/**/__tests__/**", "src/cli/**", "src/tools/**"],
      reportsDirectory: "coverage",
    },
  },
});
