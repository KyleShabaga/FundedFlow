# TASK-027 — Fix (process): release build gated on CI for the same SHA; unique version per candidate

| Field | Value |
|---|---|
| Status | Proposed |
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
| Inspected source revision | a7310fd (application source identical to 92e7980) |
| Specification revision | r1 (2026-10-22) |
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
`.github/workflows/release-installer.yml` (require a successful `ci.yml` run on the same SHA or run the CI steps in-job; widen PR paths; log rustc/node/npm/@tauri-apps/cli versions to the summary), version fields `apps/desktop/src-tauri/tauri.conf.json:4`, `apps/desktop/src-tauri/Cargo.toml:3`, root/workspace `package.json` versions as decided in TASK-005; third-party summary `appVersion` regenerated only if the notices task scope allows (record).

## Out of scope
Signing; updater; pinning actions by SHA (optional, V1.1).

## Implementation approach
1. Implement the CI gate (e.g. `workflow_run`/`needs` or a pre-check using the GitHub API for the SHA) — choose the simplest that works with `contents: read`.
2. Widen PR paths to `apps/desktop/**` and `packages/**`.
3. Add a summary step printing toolchain versions.
4. Apply TASK-005's version scheme; keep the tag-equals-version check.

## Prerequisites, dependencies and conflicts
- Prerequisites: TASK-005.
- Likely shared-file conflicts: Version files with TASK-029 (candidate).

## Acceptance criteria (pass/fail)
- [ ] Workflow lint/dry run: a PR changing only `apps/desktop/src/**` triggers the installer build (observed in Actions).
- [ ] A dispatch on a SHA without green CI fails with a clear message (observed).
- [ ] Summary shows toolchain versions; SHA256SUMS.txt still contains the EXE hash.
- [ ] Keep `FUNDEDFLOW_UPDATE_FIXTURES` unset for every check; never regenerate fixtures unless this card explicitly names the fixture and its diff is reviewed.

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
