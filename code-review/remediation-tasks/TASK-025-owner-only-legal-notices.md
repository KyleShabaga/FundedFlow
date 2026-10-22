# TASK-025 — Gate work: integrate owner-only v1.1 legal notices (statement 1.0.1-owner-only; privacy 1.0.0-owner-only)

| Field | Value |
|---|---|
| Status | Proposed |
| Type | Fix |
| Audit priority | Gate work (mandatory) |
| Roadmap lane | P0-13 / NA-3 (V1, open) |
| Mandatory gate | Yes — ISSUE-039 |
| Severity | N/A |
| Confidence | High |
| Canonical issue | ISSUE-039 (see `code-review/remediation-findings-ledger.md`) |
| Original Stage 1 finding IDs | TEST-003; TR-014 (summary wording) |
| Source card / date | Final Push V1 — https://app.notion.com/p/4001bd4b6bde8044ab04f75d167950cd (P0-13/NA-3; owner-only legal and privacy package v1.1) |
| Wave | W3 |
| Effort / risk | S–M / Low |
| Verification platform | Any OS (+ packaged check in TASK-030) |
| Path convention | Paths starting `src-tauri/` are under `apps/desktop/`; `features/`, `lib/`, `journeys/`, `design-system/` are under `apps/desktop/src/` unless written in full |
| Inspected source revision | a7310fd (application source identical to 92e7980) |
| Specification revision | r1 (2026-10-22) |
| Pre-existing changes at spec time | None (clean tree; only code-review/ outputs) |
| Baseline source SHA vs tested SHA | Baseline: 92e7980 (source) / a7310fd (HEAD). Tested source SHA and installer EXE SHA-256: to be recorded at execution. |
| Approval evidence | — (none; requires Kyle's explicit approval of this task ID and specification revision) |

## Purpose / risk
Source ships `0.1.0-draft` documents and tests assert draft state; the first-run gate must present the owner-only v1.1 package.

## Trigger / reproduction
N/A (mandatory gate).

## Root cause / evidence
Not yet integrated.

## Expected change scope
`apps/desktop/src/legal/user-agreement.ts` (becomes the owner-use statement 1.0.1-owner-only; decide whether id `user-agreement` stays — keeping it avoids journey/record churn), `privacy-notice.ts` (1.0.0-owner-only), `legal/index.ts` (`PRIVACY_SUMMARY` wording incl. installer/WebView2 network accuracy), `legal/legal.test.ts` (draft assertions → final-state assertions; new digests), `journeys/first-run.journey.test.tsx:45,61-62,148`, draft-banner components `features/legal/components/LegalGate.tsx:33,63-65`, `PrivacyLegalSection.tsx:23-25`, `LegalDocuments.tsx:8-16` (dormant when draft=false), `docs/design/screens/16-first-run.md:7-8`. Rust `legal.rs` needs no change.

## Out of scope
Counsel review/external-user agreements (V2); third-party notices regeneration.

## Implementation approach
1. Obtain the exact v1.1 texts from Kyle (owner-only package page) — do not paraphrase.
2. Replace texts, versions, `draft:false`, titles; run `npm test` once to obtain new digests printed by `legal.test.ts:6-9`; copy them into the documents.
3. Rewrite `legal.test.ts` draft assertions to final-state assertions (version pattern, no '(draft)', ids).
4. Update first-run journey expectations and the spec; agree `PRIVACY_SUMMARY` text with TASK-026.

## Prerequisites, dependencies and conflicts
- Prerequisites: TASK-001 (0BSD), TASK-006 (wording basis), v1.1 text supplied by Kyle.
- Likely shared-file conflicts: `legal/index.ts` with TASK-026 wording.

## Acceptance criteria (pass/fail)
- [ ] `npm run test -w @fundedflow/desktop -- src/legal src/journeys/first-run.journey.test.tsx` → exit 0.
- [ ] Document versions equal `1.0.1-owner-only` and `1.0.0-owner-only`; digests match the texts (test).
- [ ] Full root checks → exit 0.
- [ ] Packaged first-run shows the v1.1 texts (verified in TASK-030).
- [ ] Keep `FUNDEDFLOW_UPDATE_FIXTURES` unset for every check; never regenerate fixtures unless this card explicitly names the fixture and its diff is reviewed.

## Verification plan
Existing acceptance records re-prompt by design (`coversCurrent`).

Standard checks (run serially, frontend build before Rust):
- Repository root: `npm run check:boundaries -w @fundedflow/domain` → exit 0
- Repository root: `npm run typecheck` → exit 0
- Repository root: `npm test` → exit 0 (domain + desktop Vitest incl. journeys/axe, test:notices, test:ci-scripts)
- Repository root: `npm run build` → exit 0 (includes the dev-tools dist check)
- Repository root: `npm run check:dist -w @fundedflow/domain` → exit 0
- `apps/desktop/src-tauri`: `cargo test --offline --locked` → exit 0 (after `npm run build`, run serially)
- `apps/desktop/src-tauri`: `cargo clippy --offline --locked --all-targets -- -D warnings` → exit 0

## Safety, rollback and side effects
No journal data touched; `legal-acceptance.json` format unchanged.

## Definition of done
Code merged through an approved PR on a `feat/build-<n>-<slug>` branch per CLAUDE.md; diff reviewed; new regression tests fail before and pass after the change; every acceptance criterion has recorded evidence (command, directory, exit code); Windows-only criteria have owner/VM evidence. Compiling or passing unrelated tests is not completion.
