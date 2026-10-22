# TASK-027 — Fix (process): release build gated on CI for the same SHA; unique version per candidate

| Field | Value |
|---|---|
| Status | Ready for Approval (r3) |
| Type | Fix |
| Audit priority | P1 |
| Roadmap lane | NA-2 / P0-06 (release) |
| Mandatory gate | Supports ISSUE-040/042 |
| Severity | Medium |
| Confidence | High |
| Canonical issue | ISSUE-022 (see `code-review/remediation-findings-ledger.md`) |
| Original Stage 1 finding IDs | WIN-006, WIN-004, WIN-008, TEST-010; TEST-001 (dup → ISSUE-040) |
| Source card / date | .github/workflows/release-installer.yml; ci.yml; Stage 1 2026-10-22 |
| Wave | W3 |
| Effort / risk | S–M / Low |
| Verification platform | Any OS (CI) |
| Path convention | Paths starting `src-tauri/` are under `apps/desktop/`; `features/`, `lib/`, `journeys/`, `design-system/` are under `apps/desktop/src/` unless written in full |
| Inspected source revision | b01e2b9 (application source identical to 92e7980) |
| Specification revision | r3 (2026-10-22; r2 + Block 4 corrections from 10 §8.2/§8.3) |
| Execution log | `code-review/11-remediation-execution-log.md` — created by the first task executed after approval (template in 08 index §I); every task appends its evidence there |
| Pre-existing changes at spec time | None (clean tree; only code-review/ outputs) |
| Baseline source SHA vs tested SHA | Baseline: 92e7980 (source) / a7310fd (HEAD). Tested source SHA and installer EXE SHA-256: to be recorded at execution. |
| Approval evidence | — (none; requires Kyle's explicit approval of this task ID and specification revision) |

## Purpose / risk
Release workflow runs no tests, tags are not gated on CI, PR path filter omits `apps/desktop/src/**`/`packages/**`/`apps/desktop/THIRD_PARTY_NOTICES.txt`, every build is 0.1.0, toolchain versions are not logged.

## Trigger / reproduction
Building a candidate from an untested SHA; downgrade testing.

## Root cause / evidence
Workflow design; fixed version.

## Expected change scope
`.github/workflows/release-installer.yml` (require a successful `ci.yml` run on the same SHA or run the CI steps in-job; widen PR paths; log rustc/node/npm/@tauri-apps/cli versions to the summary), version fields `apps/desktop/package.json:22` (pinned `"@fundedflow/domain": "0.1.0"`, changes with `packages/domain/package.json:3` if the workspace versions are bumped), `apps/desktop/src-tauri/tauri.conf.json:4`, `apps/desktop/src-tauri/Cargo.toml:3`, root/workspace `package.json` versions as decided in TASK-005. Full version knock-on (all in the same PR): `Cargo.lock`, `package-lock.json`, `npm run notices` (cargo-about 0.9.2; regenerates the notices `appVersion`), `producerVersion` in `packages/domain/test/fixtures/data-controls-wire.json:89` (reviewed diff), and the version assertion `expect(text).toContain("FundedFlow version: 0.1.0")` at `apps/desktop/src/journeys/recovery.journey.test.tsx:66`. WebView2 install mode: if TASK-006 = B or C, set `bundle.windows.webviewInstallMode` (`apps/desktop/src-tauri/tauri.conf.json:49-52`, currently `downloadBootstrapper`, `silent: true`) to `offlineInstaller` (B) or `fixedVersion` with its runtime path (C); if TASK-006 = A, leave it unchanged. Option for the implementer (not mandated): add `"producerVersion"` to the volatile keys in `normalize()` (`apps/desktop/src-tauri/src/data_controls/wire_tests.rs:9-17`, the match arms inside `normalize()` at 4-28) so the wire fixture stops changing on every version bump; if taken, the fixture's `producerVersion` becomes a fixed placeholder in this one reviewed diff (the contract is `z.string()`, `packages/domain/src/contracts/data-controls.ts:39`), and the choice is recorded in the PR. TEST-010 `check:engine-runtimes`: explicitly deferred to V1.1 (not in this card).

## Out of scope
Signing; updater; pinning actions by SHA (optional, V1.1).

## Implementation approach
1. Before branching: create or link the Notion roadmap Triage card for this task (CLAUDE.md plan of record); branch `feat/build-<n>-<slug>` and link the card in the PR. (Notion writes need their own approval; Block 4A.)
2. Implement the CI gate (e.g. `workflow_run`/`needs` or a pre-check using the GitHub API for the SHA) — choose the simplest that works with `contents: read`.
3. Widen PR paths to `apps/desktop/**` and `packages/**`.
4. Add a summary step printing toolchain versions.
5. Apply TASK-005's version scheme; keep the tag-equals-version check; update `recovery.journey.test.tsx:66` and the wire fixture `producerVersion` (or take the `normalize()` option above).
6. Apply TASK-006's outcome to `webviewInstallMode` (B or C only).

## Prerequisites, dependencies and conflicts
- Prerequisites: TASK-005 decided; TASK-006 decided.
- Merge order: after TASK-017 (the last W1 wire-fixture edit; 013 → 015 (option B only) → 016 → 017 → 027 on `data-controls-wire.json`) and before TASK-029 (candidate).
- Likely shared-file conflicts: Version files with TASK-029 (candidate); `packages/domain/test/fixtures/data-controls-wire.json` with TASK-013, 015 (option B), 016, 017.

## Acceptance criteria (pass/fail)
- [ ] Workflow lint/dry run: a PR changing only `apps/desktop/src/**` triggers the installer build (observed in Actions).
- [ ] A dispatch on a SHA without green CI fails with a clear message (observed).
- [ ] Summary shows toolchain versions; SHA256SUMS.txt still contains the EXE hash.
- [ ] Root standard checks and `npm run check:notices` → exit 0 after the version bump; `Cargo.lock`/`package-lock.json` diffs limited to the version fields.
- [ ] `recovery.journey.test.tsx:66` asserts the new version; `npm run test -w @fundedflow/desktop -- src/journeys/recovery.journey.test.tsx` → exit 0.
- [ ] Wire fixture diff limited to `producerVersion` (or, if the `normalize()` option is taken, to `producerVersion` becoming the placeholder plus the `wire_tests.rs` change); `cargo test --offline --locked` → exit 0.
- [ ] If TASK-006 = B or C: `tauri.conf.json` `webviewInstallMode` matches the decision and the installer build in Actions succeeds; if A: `tauri.conf.json:49-52` unchanged.
- [ ] Keep `FUNDEDFLOW_UPDATE_FIXTURES` **unset (not `0`)** for every check; never regenerate fixtures unless this card explicitly names the fixture and its diff is reviewed.

## Verification plan
GitHub Actions observation (owner or approved session with access).

Standard checks (run serially, frontend build before Rust):
- Repository root: `npm run check:boundaries -w @fundedflow/domain` → exit 0
- Repository root: `npm run typecheck` → exit 0
- Repository root: `npm test` → exit 0 (domain + desktop Vitest incl. journeys/axe, test:notices, test:ci-scripts)
- Repository root: `npm run build` → exit 0 (includes the dev-tools dist check)
- Repository root: `npm run check:dist -w @fundedflow/domain` → exit 0
- `apps/desktop/src-tauri`: `cargo test --offline --locked` → exit 0 (after `npm run build`, run serially)
- `apps/desktop/src-tauri`: `cargo clippy --offline --locked --all-targets -- -D warnings` → exit 0

## Safety, rollback and side effects
No user data.

## Definition of done
Code merged through an approved PR on a `feat/build-<n>-<slug>` branch per CLAUDE.md; diff reviewed; new regression tests fail before and pass after the change; every acceptance criterion has recorded evidence (command, directory, exit code); Windows-only criteria have owner/VM evidence. Compiling or passing unrelated tests is not completion.

## Changes in r3
- 10 §8.2 TASK-027 (G13): added `apps/desktop/src/journeys/recovery.journey.test.tsx:66` to the version knock-on, with a criterion.
- 10 §8.2 TASK-027 (G4): added "if TASK-006 = B or C, set `webviewInstallMode` (`tauri.conf.json:49-52`)", step 6 and a criterion; TASK-006 added as a prerequisite.
- 10 §8.2 TASK-027 (G13): added the `producerVersion` `normalize()` change (`wire_tests.rs:9-17`) as an explicit implementer option, not a mandate.
- 10 §8.2 TASK-027 (G4, G13): merge order after TASK-017 and before TASK-029.
- 10 §8.3 fixture rule: fixture line says `FUNDEDFLOW_UPDATE_FIXTURES` unset (not `0`).

## Independent review notes
Independent review r1: CHANGES (applied, 08 §H). Independent re-check r2: CHANGES (applied — see 08 §H, reviewer 2). Remaining re-check items were wording/line-level; no open blocker.
Block 4 review (10 §8.2/§8.3): CHANGES — applied in r3: `recovery.journey.test.tsx:66` knock-on (G13); TASK-006 `webviewInstallMode` scope and prerequisite (G4); `producerVersion` normalize option (G13); merge after 017 and before 029; fixture rule unset (not 0).
Independent review r3 (two reviewers, then a re-check of the blocking fixes, 2026-10-22): READY after the corrections listed in "Changes in r3" were applied.
