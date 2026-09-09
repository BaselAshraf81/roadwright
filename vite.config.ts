// Imported from vitest/config rather than vite, because the `test` block is
// vitest's extension of the config type and vite's own defineConfig rejects it.
import { defineConfig } from "vitest/config";

// Deployed at baselashraf.com/roadwright, so asset URLs must be relative to that
// path rather than to the domain root.
export default defineConfig({
  base: "/roadwright/",
  build: {
    target: "es2022",
    sourcemap: true,
  },
  test: {
    globals: true,
    include: ["tests/**/*.test.ts"],
  },
});
