// Public entry point of @fundedflow/domain. Everything a host may use is
// re-exported here; there are no deep imports. Later builds add their own
// modules beside these (catalogue, rulebook, engine, import) and export them
// from this file. See docs/architecture/packages.md.

export * from "./primitives/money.js";

export * from "./contracts/errors.js";
export * from "./contracts/accounts.js";
export * from "./contracts/trades.js";
export * from "./contracts/journal.js";
export * from "./contracts/csv-import.js";

export * from "./ports/journal-repository.js";
