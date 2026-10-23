import { defineConfig } from "vitest/config";
import path from "node:path";
// Server and engine tests run in node; files under tests/components opt into jsdom (a pretend browser) with a docblock.
export default defineConfig({
  resolve: { alias: { "@shared": path.resolve(__dirname, "src/shared") } },
  test: { include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"], environment: "node", testTimeout: 20000 },
});
