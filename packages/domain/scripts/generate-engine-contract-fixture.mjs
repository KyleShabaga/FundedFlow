// Generates deterministic TS engine payloads for native persistence/wire tests.
// The financial expected-value assertions live independently in the scenario tests.
import { build } from "vite";
import { pathToFileURL, fileURLToPath } from "node:url";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
const root = fileURLToPath(new URL("../../..", import.meta.url));
const dir = mkdtempSync(join(tmpdir(), "fundedflow-engine-fixture-"));
await build({
  configFile: false,
  logLevel: "silent",
  build: {
    lib: {
      entry: resolve(root, "packages/domain/test/engine/fixtures.ts"),
      formats: ["es"],
      fileName: () => "fixtures.mjs",
    },
    outDir: dir,
    emptyOutDir: true,
  },
  resolve: { conditions: ["node"] },
});
const { inputs, policy, trade } = await import(
  pathToFileURL(join(dir, "fixtures.mjs"))
);
const { calculateRiskSnapshot, evaluateAccountRisk } = await import(
  pathToFileURL(resolve(root, "packages/domain/dist/index.js"))
);
const cases = [];
for (const name of ["known", "unknown", "micro"]) {
  const input = inputs();
  if (name === "unknown") {
    input.coverage.closedTrades = "missing";
    input.coverage.fees = "missing";
  }
  if (name === "micro") input.trades = [trade("0.000001")];
  const p = policy(input);
  cases.push({
    name,
    input,
    policy: p,
    result: evaluateAccountRisk(input, p),
    snapshot: calculateRiskSnapshot(input, p, true),
  });
}
writeFileSync(
  resolve(root, "packages/domain/test/fixtures/engine-contract.json"),
  JSON.stringify(cases, null, 2) + "\n",
);
console.log(
  `Generated ${cases.length} engine payloads for native and cross-runtime contract verification`,
);
