// Build 26.9: fails a production frontend build that contains the developer tools (Add Fake Data,
// Reset All Data). Runs after `vite build` (npm run build:app, so also before `tauri build`).
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const MARKERS = ["dev_seed_fake_data", "dev_reset_handoff", "dev_reset_preview", "dev_tools_status", "Add Fake Data", "Reset All Data", "DevSidebarTools"];

export function findDevTools(dist) {
  const found = [];
  const walk = dir => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (/\.(js|html|css)$/.test(entry.name)) {
        const text = readFileSync(path, "utf8");
        for (const marker of MARKERS) if (text.includes(marker)) found.push(`${path}: ${marker}`);
      }
    }
  };
  walk(dist);
  return found;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.dirname, "check-no-dev-tools.mjs")) {
  const dist = resolve(import.meta.dirname, "../dist");
  const found = findDevTools(dist);
  if (found.length) {
    console.error(`Developer tools leaked into the production build:\n${found.join("\n")}`);
    process.exitCode = 1;
  } else {
    console.log("Production build contains no developer tools.");
  }
}
