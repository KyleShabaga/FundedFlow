# P0-04: CSV byte and duration wire contracts, and the V1 normalization deferral

Card: [P0-04 Resolve portable CSV normalizer and wire-contract acceptance](https://app.notion.com/p/4001bd4b6bde81a8b3c9e124d6ab188f).
Source cards: [Build 17](https://app.notion.com/p/3fe1bd4b6bde810da797e8277b9011c9),
[Align CSV UTF-8 byte and duration wire limits](https://app.notion.com/p/3ff1bd4b6bde81c7b748de494ff1e090),
Build 8.5 and Build 16. Branch `fix/p0-04-csv-contracts`.

- Starting SHA: `86989481c4d50954f9654e3b7e0623d800ad8100` (main; P0-01/P0-03 in PR #56 and P0-02 in PR #58 are merged).
  No open branch or PR overlapped this work. The P0-04 identity contract from PR #56 (`fills2` version 2,
  ASCII-only fill IDs, `test_csvimport/identity/fill-pair-v2.json`) is kept unchanged.
- Tested SHA: `de867d03e30fe05ac9658ddc0f269dcacccaba3b` (all code and tests; full local suites). `b3df6fc` then changes
  only the duration-wire tests: the fixture comparison now ignores CRLF line endings, which Windows CI checked
  out. The wire limit tests, clippy and typecheck were rerun on it, including against a CRLF copy of the fixture.
  Later commits change documentation only.

Evidence classes: **native** (Rust tests on in-memory and file-backed SQLite), **domain** (Vitest, plain Node),
**jsdom** (Vitest over desktop modules). Nothing here is packaged-app, manual or real-exporter acceptance.

## 1. Requirement-to-code matrix

| Requirement (card or source card) | State before this branch | Evidence | This branch |
|---|---|---|---|
| Identity and version contract (`fills2` v2, ASCII fill IDs, portable vectors) | Satisfied by PR #56 | `identity_tests.rs`, `fill-pair-v2.json`, `p0-01-p0-03.md` §1 | Unchanged |
| ASCII/BOM/multibyte/supplementary byte limits agree | **Gap.** Rust caps UTF-8 bytes of the submitted string; the shared schema used `.max()` on UTF-16 units and accepted e.g. 10,485,761 bytes of `é` (confirmed by running the base schema) | `parse.rs` (`content.len() > MAX_CSV_BYTES` before the BOM is stripped); `csvImportRequestSchema.content` | Fixed (§2) |
| The desktop reader measures what it submits | **Gap.** `readCsvFile` checked `file.size`, which includes a BOM that `TextDecoder` removes, so it refused files whose submitted text Rust would accept | `wizard-state.ts` | Fixed (§2) |
| Unsupported encodings are refused, not guessed | Satisfied in production: strict `TextDecoder("utf-8", { fatal: true })` | `wizard-state.ts`; existing wizard test | Kept; regression tests added for UTF-16 LE/BE, Latin-1 and truncated sequences |
| Duration boundaries agree and preserve exact values | **Gap.** Rust serialized `durationSeconds` as a JSON number up to 2^63 − 1; JavaScript rounds above 2^53 − 1 before Zod sees it. Affects the import preview **and** stored trades (trade DTO, risk-engine inputs) | `TradePreview`, `RoundTripSource`, `tradePreviewSchema`, `tradeSchema` | Fixed (§3) |
| Invalid acknowledgement never replayed | Satisfied: request validation runs before the write call and throws a definite `validation` error; commit re-derives everything from the file | `imports.ts` (`validateInput` before `writeOperation`), `tauri-repository.ts` (`validate`) | Unchanged; new failures are definite validation failures |
| Native commit stays authoritative | Satisfied | Build 17 native suites | Unchanged |
| Real implementations agree on normalized rows, finances, findings, timestamps, identity and versions | **Open.** No TypeScript normalizer exists; the Build 17 golden file is a Rust baseline plus DTO checks, not algorithm parity. Now recorded as a V1 deferral | `build17-csv.test.ts`, `build-17-csv-backend.md` | **Deferred past V1 by owner decision** (§4); Rust stays the only normalizer |

## 2. Byte limit and BOM policy

**Rule.** The cap is inclusive: the UTF-8 byte length of the `content` string **as submitted** must be at most
10,485,760 (`MAX_CSV_BYTES`). It doesn't count characters or UTF-16 code units. A leading U+FEFF in the submitted
string counts as its 3 bytes; Rust measures before stripping it. The message is the same on both sides:
"The file is larger than 10 MB."

| Boundary | BOM | Measured |
|---|---|---|
| Desktop file reader (`readCsvFile`) | Strict UTF-8 decoding removes a leading BOM; it is not submitted | Refuses unread if `file.size > cap + 3`; otherwise measures the decoded text with `utf8ByteLength` |
| Shared schema (`csvImportRequestSchema.content`) | Counted if present in the string | `utf8ByteLength(content)`; also refuses unpaired surrogates, which have no UTF-8 encoding |
| IPC (JSON) | Carried as is | A lone `\uD800` escape fails to decode into a Rust `String`; tested natively |
| Rust `parse` | Counted, then stripped before parsing | `content.len()` (UTF-8 bytes) |

`utf8ByteLength` is portable: a loop over UTF-16 code units, with no `Buffer` or `TextEncoder` dependency.

**Encodings.** Only UTF-8 is supported. The production reader refuses anything that isn't valid UTF-8 as
"couldn't be read as text (UTF-8)": UTF-16 with or without a BOM, legacy code pages and truncated sequences. A
file whose bytes happen to be valid UTF-8 is read as UTF-8. No parity is claimed for other source encodings.
The developer panel (`CsvImportSection`, built only in development) still uses `File.text()`.

**Evidence.** `test_csvimport/limits/byte-limit-v1.json` holds 13 vectors: empty; ASCII; BOM + ASCII; 2-, 3- and
4-byte text; and mixed BOM + header + multibyte + supplementary text, each exactly at the cap and one byte over.
Each vector gives UTF-8 bytes and UTF-16 units worked out independently of either implementation.
- Rust (`wire_limit_tests::byte_limit_vectors_match_the_shared_specification`) builds each string, checks both
  counts and runs the real `parse`.
- TypeScript (`csv-wire-limits.test.ts`) checks the same counts and the schema decision and message.
- The desktop reader tests (`wizard-state.test.ts`) cover real `File`s with and without a BOM at the cap and over
  it, and the refused encodings.
- The existing native preview/commit cap tests (Build 17) still pass.

## 3. Duration precision and compatibility

**Rule.** `durationSeconds` is whole seconds from 0 to 2^63 − 1 (SQLite's signed `INTEGER`; the column also requires
≥ 0). Each value has exactly one wire form:

- an integer JSON number for 0 to 2^53 − 1 (`Number.MAX_SAFE_INTEGER`);
- a decimal string of digits, with no sign or leading zero, for 2^53 to 2^63 − 1.

Anything else is rejected: a number above 2^53 − 1, a string for a safe value, a non-canonical string, or a value
out of range. Rust: `domain::duration_wire` (serialize and deserialize). TypeScript: `durationSecondsSchema` and
`durationSecondsValue` (returns a `bigint`).

**Where.** The rule covers the import preview (`TradePreview.durationSeconds`) and stored round trips
(`Trade.roundTrip.durationSeconds`: `list_trades`, trade detail, reviews and risk-engine inputs). Archives already
write integers as strings. Normalization is unchanged:
- invalid, negative and fractional durations stay row errors, and so do values above 2^63 − 1 or above u64;
- the row keeps its raw cells, and other rows still import;
- preview and commit classify each row the same way.

**Why this form.** Each alternative was checked against the code:

| Option | Consequence |
|---|---|
| Safe-integer cap (refuse > 2^53 − 1) | Restricts values Rust accepts and stores today, which is a compatibility change needing owner approval. Values already stored above the cap would still be unrepresentable on read. Not chosen |
| Decimal string for every value | Changes `roundTrip` in every paired-fill trade. Those trades are part of P0-02's frozen risk inputs and fingerprints, so every current result for an account with such imports would read "records changed" after upgrade, and EOD inputs hashes would change. Not chosen |
| **Number when safe, string above (chosen)** | Every value that fits a safe integer serializes byte-for-byte as before. No fixture, stored snapshot, fingerprint or golden file changes. Values above 2^53 − 1, which JavaScript previously rounded, now arrive exactly. It also fixes a P0-02 interaction: before, such a value made the engine's frozen inputs differ from native forever, so that account could never promote a result |

**Versioning.** Producer and consumers ship in one desktop build, and no persisted JSON carried the old form
above 2^53 − 1. So there is no stored-data migration and no new version field. The rule is documented here and in
`docs/data-model.md`. The new wire fixtures carry `fixtureVersion: 1`. Stored values are not rewritten.

**Display.** Hold time (`holdTime`) counts with `BigInt`, so even 2^63 − 1 seconds is shown exactly.

**Evidence.**
- `wire_limit_tests::duration_wire_is_exact_and_preview_and_commit_classify_the_same_rows` previews and commits
  one file and checks every row's preview JSON, committed row record, stored trade and the SQLite value. Cells:
  `0sec`, `32sec`, 2^53 − 1, 2^53, 2^53 + 1, 2^63 − 1 in unit form and clock form (`2562047788015215:30:07`),
  2^63, 2^64, `-5sec` and `1.5sec`. It writes the native JSON text to `apps/desktop/src/test/fixtures/csv-duration-wire.json`.
- `csv-duration-wire.test.ts` reads that **text** and parses it as the IPC bridge does. It checks every value
  against expectations written independently in the test, and checks that no JSON number in the file is outside
  the safe range.
- `duration_wire_refuses_non_canonical_or_out_of_range_input` (Rust) and `csv-wire-limits.test.ts` (TypeScript)
  reject the same non-canonical and out-of-range forms.

## 4. Portable normalization for V1: deferred (option A)

**Decision (owner, 2026-10-21): option A.** Rust stays the only CSV normalizer for V1. Portable extraction and
Rust↔TypeScript algorithm parity move to a tracked post-V1 card, [Extract the CSV normalizer to `packages/domain`
with Rust↔TypeScript parity](https://app.notion.com/p/4001bd4b6bde81159e97f9cd4e29e401) (Stage 2, Build 35.5, a prerequisite of Build 36 cloud CSV import). This is the explicit
"Rust authoritative for V1" record that Build 17 asks for. P0-04's parity criterion is met by this deferral, not by
a second implementation; no TypeScript normalizer exists or is claimed.

What stays true for V1:
- Rust owns parsing, detection, normalization, findings, identity keys, trading day, instruments, P&L and time
  zones (§5). The desktop submits validated text and shows results; nothing routes through TypeScript logic.
- The shared contracts already settled here stay shared: the UTF-8 byte cap (§2), `durationSeconds` (§3) and the
  `fills2` identity vectors (PR #56).

What the post-V1 card inherits as its parity corpus (Rust-generated or independently specified, never retyped):
- `test_csvimport/build17/normalization-v1.json` (golden preview, `dedupKeys` and normalized batch; `golden_tests.rs`);
- `test_csvimport/identity/fill-pair-v2.json`;
- `test_csvimport/limits/byte-limit-v1.json`;
- `apps/desktop/src/test/fixtures/csv-duration-wire.json` (`wire_limit_tests`, `csv-duration-wire.test.ts`).

What the post-V1 card must still settle before porting:
- CSV parsing and header/format/date detection (Rust `parse.rs`, `detect.rs`, `values.rs`);
- row normalization and findings (`normalize.rs`), including stable finding codes (`FieldIssue` has none today)
  and a normalizer version;
- identity keys (`dedup.rs`), producing `fills2` exactly and leaving legacy `fills:` lookup to the repository;
- trading-day assignment, instrument resolution and realized P&L (`domain.rs`; the domain package has money
  primitives only);
- IANA time-zone resolution with DST gap and overlap rejection. In JavaScript that means `Intl`, whose ICU time-zone
  data can differ from `chrono-tz`; the card must pin or compare tz-data versions.

Options considered:

| Option | What it means | Outcome |
|---|---|---|
| **A. Record a V1 deferral** | Rust stays the only normalizer for V1; extraction and parity move to a post-V1 card | **Chosen.** No V1 behaviour risk; matches Build 17's "Rust authoritative until migrated". Cost moves to Stage 2 |
| B. Implement the portable normalizer for V1 | Port parse/detect/values/normalize/identity plus trading day, instruments and P&L to `packages/domain` with dual-run parity | Rejected for V1: about 1,600 lines of Rust plus economics and time zones, real tz-data divergence risk, and V1 still commits through Rust, so no V1 user value |
| C. Port a reduced subset now | Parity on pieces with no time-zone dependency | Rejected for V1: partial value and two owners of import logic until the rest is ported |

## 5. Native ownership (unchanged)

Rust owns parsing, normalization, dedup, SQLite lookup (including legacy `fills:` reconciliation), preview target
assessment, transactions, batch history and commit authority. The desktop passes validated text and displays
results. No preview, commit or replay behaviour changed. Migrations are unchanged; schema version 21.

## 6. Verification (tested SHA `de867d0`)

| Check | Result |
|---|---|
| `npm run typecheck`, `npm run build`, `npm run check` | pass |
| `npm test` | pass: domain 533, desktop 832 |
| `cargo clippy --locked --all-targets -- -D warnings` | pass |
| `cargo test --locked` | 330 passed, 2 ignored, 4 failed: the `db::legacy_rulebook_tests` failures, reproduced unchanged on untouched main `8698948` (3 passed, the same 4 failed) |
| CSV native suite (`cargo test --lib csv_import`) | 69 passed, 1 ignored (the subprocess worker run by its parent) |
| `git diff --check` | clean with `core.whitespace=cr-at-eol` (several Rust files are CRLF on the base) |
| Red-first | `c224c19` adds the shared vectors and the domain tests; on that commit 36 of 37 fail, and the base schema accepts 10,485,761 bytes of `é` |

Formatting is reported separately. The crate is not rustfmt-formatted on the base. The new test file is
rustfmt-clean, and the touched files have the same number of rustfmt differences as on the base (domain.rs 19,
trades.rs 20, csv_import/mod.rs and tests.rs 0).

## 7. Remaining gates

- Normalization: deferred past V1 (§4), tracked by the [post-V1 extraction card](https://app.notion.com/p/4001bd4b6bde81159e97f9cd4e29e401) and recorded on Build 17 and P0-04.
- P0-05 source cohort: synthetic fixtures don't certify any real exporter version.
- Windows CI on the PR, plus packaged Tauri and manual import acceptance on an isolated profile.
- Import, account and Today UX changes belong to PR 4.
