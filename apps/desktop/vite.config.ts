import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import ts from "typescript";
// @ts-expect-error type error without @types/node package
import process from "node:process";
const host = process.env.TAURI_DEV_HOST;

/**
 * Rebuilds @fundedflow/domain into packages/domain/dist while the dev server
 * runs, so edits there reach the app (Vite serves the linked package's dist
 * and reloads on change). Runs in-process, so it stops with the server.
 * `npm run dev` builds the package once before Vite starts.
 */
function domainWatch(): Plugin {
  return {
    name: "fundedflow:domain-watch",
    apply: "serve",
    configureServer(server) {
      const config = ts.sys.resolvePath(`${server.config.root}/../../packages/domain/tsconfig.build.json`);
      const report = (d: ts.Diagnostic) =>
        server.config.logger.info(`[domain] ${ts.flattenDiagnosticMessageText(d.messageText, "\n")}`);
      const watcher = ts.createWatchProgram(
        ts.createWatchCompilerHost(config, {}, ts.sys, ts.createEmitAndSemanticDiagnosticsBuilderProgram, report, report),
      );
      server.httpServer?.once("close", () => watcher.close());
    },
  };
}

// https://vite.dev/config/
export default defineConfig(() => ({
  plugins: [react(), domainWatch()],

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
