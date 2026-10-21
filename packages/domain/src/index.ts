// Copyright (c) 2026 Kyle Shabaga. All rights reserved.
// Proprietary and source-available, not open source. See LICENSE in the repository root.

// Public entry point of @fundedflow/domain. Everything a host may use is
// re-exported here; there are no deep imports. Later builds add their own
// modules beside these (catalogue, rulebook, engine, import) and export them
// from this file. See docs/architecture/packages.md.

export * from "./primitives/money.js";

export * from "./contracts/errors.js";
export * from "./contracts/accounts.js";
export * from "./contracts/account-lifecycle.js";
export * from "./contracts/trades.js";
export * from "./contracts/journal.js";
export * from "./contracts/reviews.js";
export * from "./contracts/daily-reviews.js";
export * from "./contracts/csv-import.js";
export * from "./contracts/settings.js";
export * from "./contracts/ledger.js";
export * from "./contracts/snapshots.js";

export * from "./insights/index.js";

export * from "./catalogue/index.js";
export * from "./rulebook/index.js";

export * from "./ports/journal-repository.js";

export * from "./risk/contracts.js";
export * from "./risk/reconciliation.js";
export * from "./risk/sufficiency.js";
export * from "./contracts/data-controls.js";

export * from "./engine/contracts.js";
export * from "./engine/promotion.js";
export * from "./engine/canonical.js";
export * from "./engine/applicability.js";
export * from "./engine/evaluate.js";
export * from "./engine/snapshot.js";
