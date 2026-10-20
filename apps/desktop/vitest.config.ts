// Unit tests run without the dev-server plugins in vite.config.ts (the
// domain watcher would keep the process alive).
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { include: ["src/**/*.test.ts", "src/**/*.test.tsx"] },
});
