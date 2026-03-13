import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/__tests__/**/*.test.ts"],
  },
  benchmark: {
    include: ["src/**/__benchmarks__/**/*.bench.ts"],
  },
});
