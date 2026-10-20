// Loads the built package the way any host does, by name through its
// "exports" map, in a plain Node process (no bundler, no aliases), and checks
// that the emitted JavaScript and declarations are present.

import { existsSync } from "node:fs";
import { createRequire } from "node:module";

const domain = await import("@fundedflow/domain");
const expected = ["toMicros", "microsToDecimal", "canonicalDecimal", "accountSchema", "tradeSchema", "csvPreviewSchema"];
const missing = expected.filter((name) => !(name in domain));
if (missing.length) throw new Error(`@fundedflow/domain is missing exports: ${missing.join(", ")}`);

const entry = createRequire(import.meta.url).resolve("@fundedflow/domain");
const types = entry.replace(/\.js$/, ".d.ts");
if (!existsSync(types)) throw new Error(`no declarations next to ${entry}`);

if (domain.toMicros("-0.0000025") !== -3n) throw new Error("compiled toMicros disagrees with the fixtures");
console.log(`@fundedflow/domain dist OK (${Object.keys(domain).length} exports)`);
