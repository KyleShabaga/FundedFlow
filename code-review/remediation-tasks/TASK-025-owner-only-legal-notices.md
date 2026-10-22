# TASK-025 — Gate work: integrate owner-only v1.1 legal notices (statement 1.0.1-owner-only; privacy 1.0.0-owner-only)

| Field | Value |
|---|---|
| Status | Ready for Approval (r3) |
| Type | Fix |
| Audit priority | Gate work (mandatory) |
| Roadmap lane | P0-13 / NA-3 (V1, open) |
| Mandatory gate | Yes — ISSUE-039 |
| Severity | N/A |
| Confidence | High |
| Canonical issue | ISSUE-039 (see `code-review/remediation-findings-ledger.md`) |
| Original Stage 1 finding IDs | TEST-003; TR-014 (linked; canonical ISSUE-023) |
| Source card / date | Final Push V1 — https://app.notion.com/p/4001bd4b6bde8044ab04f75d167950cd (P0-13/NA-3; owner-only legal and privacy package v1.1) |
| Wave | W3 |
| Effort / risk | S–M / Low |
| Verification platform | Any OS (+ packaged check in TASK-030) |
| Path convention | Paths starting `src-tauri/` are under `apps/desktop/`; `features/`, `lib/`, `journeys/`, `design-system/` are under `apps/desktop/src/` unless written in full |
| Inspected source revision | a7310fd (application source identical to 92e7980) |
| Specification revision | r3 (2026-10-22; r2 + currency update for approved decisions) |
| Execution log | `code-review/11-remediation-execution-log.md` — created by the first task executed after approval (template in 08 index §I); every task appends its evidence there |
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
1. Before branching: create or link the Notion roadmap Triage card for this task (CLAUDE.md plan of record); branch `feat/build-<n>-<slug>` and link the card in the PR. (Notion writes need their own approval; Block 4A.)
2. Obtain the exact v1.1 texts from Kyle (owner-only package page) — do not paraphrase. Record Kyle's decision on keeping the `user-agreement` id.
3. Update the version regex in `legal.test.ts:15` (`^\d+\.\d+\.\d+(-[0-9a-z.]+)?$` rejects `1.0.1-owner-only` because of the hyphenated suffix — it must accept `[0-9a-z.-]`).
4. Replace texts, versions, `draft:false`, titles; run `npm run test -w @fundedflow/desktop -- src/legal` (expected to fail first) and copy the new digests from its failure message into the documents.
5. Rewrite `legal.test.ts` draft assertions to final-state assertions (version pattern, no '(draft)', ids).
6. Update first-run journey expectations and the spec; apply the `PRIVACY_SUMMARY` text agreed in TASK-026.

## Prerequisites, dependencies and conflicts
- Prerequisites: TASK-001 decided — Option A, approved 2026-10-22 on the Notion approval board (keep 0BSD; no dependency change or notice regeneration, so nothing here is blocked by it); TASK-006 decided — Option A, approved 2026-10-22 on the Notion approval board (wording basis: the installer needs internet only when WebView2 is missing, the installed app works offline); TASK-026 (wording); v1.1 text supplied by Kyle (open); owner decision whether the `user-agreement` id stays (open).
- Likely shared-file conflicts: `legal/index.ts` with TASK-026 wording.

## Acceptance criteria (pass/fail)
- [ ] `npm run test -w @fundedflow/desktop -- src/legal src/journeys/first-run.journey.test.tsx` → exit 0.
- [ ] Document versions equal `1.0.1-owner-only` and `1.0.0-owner-only`; digests match the texts (test).
- [ ] Full root checks → exit 0.
- [ ] Packaged first-run shows the v1.1 texts (verified in TASK-030).
- [ ] Keep `FUNDEDFLOW_UPDATE_FIXTURES` **unset (not `0`)** for every check; never regenerate fixtures unless this card explicitly names the fixture and its diff is reviewed.

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

## Changes in r3
- TASK-001 approved as Option A (keep 0BSD; no notice regeneration): prerequisite now records the decision and that no follow-up blocks this card (TASK-001's Option B follow-up branch no longer applies); consistent with "third-party notices regeneration" being out of scope.
- TASK-006 approved as Option A (keep `downloadBootstrapper`): prerequisite now states the decided wording basis for `PRIVACY_SUMMARY`, matching TASK-026 r3 step 2.
- The two remaining prerequisites (Kyle's v1.1 texts; the `user-agreement` id decision) are marked open; they are not decided here.
- Fixture rule: unset (not `0`) (10 §8.3; independent review nit).

## Independent review notes
Independent review r1: CHANGES (applied, 08 §H). Independent re-check r2: READY.
Independent review (currency pass, 2026-10-22): two reviewers plus a re-check of the blocking fixes; READY at r3.
