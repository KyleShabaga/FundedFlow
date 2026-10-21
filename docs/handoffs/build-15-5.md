# Build 15.5 backend handoff

Specification: https://app.notion.com/p/3ff1bd4b6bde81b2aafcfa581430daf8
Base: main cf018ef; schema inspected at v13. No open PRs at audit time.

## Source audit

| Source | Provenance, coverage and corrections | Risk meaning |
|---|---|---|
| Account startingBalance | User-entered, mutable, no historical completeness or effective-time assertion | Configuration, not evidence of a complete opening baseline |
| Closed trades | Rust-derived net realized P&L; original CSV batch/round-trip metadata retained; editable | Historical estimate, missing earlier imports and omitted fees remain possible |
| Trade fees | Explicit or importer default zero; provenance cannot establish actual fee completeness | Never infer complete coverage from stored zero |
| Ledger | User-entered signed account-currency movements; effective instant and Rust trading day | Payout/reset/correction affect bookkeeping; fees are programme costs; neither defines a firm risk floor |
| account_snapshots | Caller-supplied calculated output, engine/hash/time metadata | Not a raw financial observation, not proof of compliance |
| Catalogue phase/path and rulebooks | Existing versioned provenance, effective assignments and append-only phase events | Reuse Build 9/9.5; no duplicated rule schemas |
| Attempt lineage | New account UUID, predecessor/successor, no transferred trades/ledger/snapshots | External broker references may be reused; UUID is the evidence boundary |

## Contract coordination

All new exports are at `@fundedflow/domain` (`src/risk`). Existing account fields, lifecycle, selection and hooks remain unchanged. New repository operations are additive. Build 15 basic onboarding needs no checkpoint or rulebook. Claude can integrate evidence entry/review later, through the existing repository adapter. No new UI or QueryClient.

New financial evidence uses canonical decimal text, exact six-place i64 micro-units, nullable unknown values. Manual confirmation means user-reported, never independent broker/provider verification. Time is explicit; recording timestamps are native-owned. Observation day/timezone/reset settings are frozen on creation and are never reinterpreted by later account edits.

No firm-specific payout/reset/trailing-floor semantics are assumed. Existing ledger balance effects remain bookkeeping semantics only. A source-backed immutable applicable rulebook is required for Build 16 to interpret risk floors. Account-private rules cannot become official compliance.
