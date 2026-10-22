## 10. Required-gate register

The status of each gate is based **only** on repository evidence plus the copied owner handoff. Unrun manual gates are kept separate from code defects.

| Gate | Card | Status | Source SHA | Installer EXE SHA-256 | Environment | Evidence | Remaining owner / action |
|---|---|---|---|---|---|---|---|
| Owner-only v1.1 notices (statement 1.0.1-owner-only; privacy 1.0.0-owner-only) | P0-13 / NA-3 | **Not Run** (open implementation) | HEAD ships `0.1.0-draft` | — | — | `legal/privacy-notice.ts:9`, `user-agreement.ts:8`, `legal.test.ts:11-21` | Implement under the card (TEST-003) |
| Release candidate built from the final SHA | NA-2 / P0-06 | **Not Run** | none valid; `7679edc` (historical), `b94fb1b` (14 behind `92e7980`) | `7679edc`: `041983f5…787f` (historical only); `b94fb1b`: none recorded | GH windows-latest | `release-installer.yml`; `build-26.75-evidence.md:104-111` | Dispatch on the final SHA. Record the run ID, `SHA256SUMS.txt` EXE hash (not the artifact ZIP digest), version, toolchain, and expiry of at least 30 days. |
| Clean Windows smoke | NA-2 / NA-5 | **Not Run** | — | — | Clean Win11 VM (preferred over Sandbox: WIN-001), plus Win10 22H2 | `build-26.75-evidence.md:111-143` (blank) | Fix step 4 (TEST-002); add the §8 items |
| Upgrade, reinstall, downgrade and ticked uninstall | NA-5 | **Not Run** | — | — | VM | `build-26.75-evidence.md:17` | Owner (WIN-003, WIN-004) |
| Offline acceptance | NA-2 steps 3–10 | **Not Run** | — | — | VM, network off after install | Checklist | Owner (WIN-005 caveat for the installer) |
| Manual recovery | Build 26.5–26.7 / 10.5 gate 6 | **Not Run** | jsdom and Rust tests only | — | — | `build-26.5-26.7-recovery-reliability.md:187-194`; `build-10-5-closeout.md:65` | Owner, on a disposable profile |
| Manual accessibility (NVDA + WebView2, contrast, 125/150% scaling, 200% zoom, reduced motion, native chooser) | Build 26 §9 / P0-08 | **Not Run** | axe in jsdom (`7709d29`+) | — | — | `build-26-accessibility-journeys.md:227-238` | Owner |
| Window and DPI matrix D1–D11 | P0-08 / NA-5 | **Not Run** | — | — | — | `docs/design/window-support-matrix.md` | Owner (WIN-009) |
| Cohort (real exporter versions) | P0-05 | **Blocked** (owner disposition) | — | — | — | `docs/architecture/p0-04-csv-contracts.md:170` | Owner: accept or waive |
| P0-09 evidence | P0-09 | **Blocked** (unidentified; 0 repo hits) | — | — | — | — | Owner to identify |
| Studies / walkthroughs | P0-10 | **Blocked** (owner disposition) | — | — | — | — | Owner |
| D5 wrappers | D5 | **Blocked** (ambiguous reference) | — | — | — | `window-support-matrix.md:26`; `prop-firm-collector.md:470` | Owner to clarify |
| 0BSD allow-list | — | **Blocked** (owner disposition); 0BSD is allowed and **in use** (tslib) | HEAD | — | — | `scripts/third-party-notices.mjs:38`; `about.toml:27`; `THIRD_PARTY_NOTICES.txt:2078-2083` | Owner: accept or reject |
| NA-7 release notes | NA-7 | **Failed** (draft exists but stale) | — | — | — | `build-26.75-evidence.md:145-166`; `README.md:68-81` | Reconcile triggers, retention, first run, uninstall scope and WebView2 network |
| Advisory dependency audit | — | **Not Run** locally. Per the handoff, CI at `92e7980` was green, but NOT RUN can pass on push. | `92e7980` (handoff) | — | GH | CI 39735646149 (not read) | Read the job summary for the candidate, or run a dispatch with `--fail-on-outage` |
| Notices check (cargo-about) | Build 26.78 | **Passed per the handoff** at `92e7980`, unverified offline. Generator unit tests **Passed** at HEAD (local). | `92e7980` / `aad865f` | — | GH / Linux container | `ci.yml:78-85`; §5 | Re-run on the candidate |
| Rust tests and clippy on Windows | — | **Passed per the handoff** (unverified); **Blocked** locally | `92e7980` | — | GH windows-latest | `ci.yml:67-73` | Read the candidate's CI log |
| Frontend tests (including journeys and axe), typecheck, build | — | **Passed per the handoff** (unverified); **Blocked** locally | `92e7980` | — | GH | `ci.yml:44-55` | Same |
| Repository script tests (dev-scripts, ci-scripts, notices) and domain boundaries | — | **Passed** | `aad865f` (source = `92e7980`) | — | Linux container | §5 | — |
| Real-journal-copy upgrade (owner-approved only) | 10.5 gate | **Not Run** | — | — | — | `build-10-5-closeout.md:66`; `db/upgrade_tests.rs:427-457` | Owner approval; copy first; redact output (TEST-006) |
| `cargo fmt --check` | 10.5 gate 7 | **Failed** historically (`cf3f614`); not in CI | `cf3f614` | — | — | `build-10-5-closeout.md:61` | Owner: drop or schedule |
| Human go/no-go | P0-18 | **Not Run** (owner) | — | — | — | Not in repo | Owner. **Not inferred from any audit verdict.** |

**Candidate evidence required:**

1. The source SHA on `main`, with a green `ci.yml` run on that exact SHA (including a read advisory summary).
2. The release run ID and its `SOURCE_SHA`.
3. A unique version.
4. Toolchain versions.
5. The artifact name and expiry.
6. The EXE SHA-256 from `SHA256SUMS.txt`, re-hashed on the test machine with `Get-FileHash`.
7. The environment: `winver`, WebView2 version, Defender state, VM type.
8. Step results with the tester, the date and screenshots.

## 11. Preliminary release-readiness assessment, limitations and agent coverage

| Dimension | Assessment |
|---|---|
| Functional correctness | Generally sound. P1 items: UI-001, TR-002, UI-003, UI-004. |
| Local data safety | Committed data well protected. Availability gaps: DATA-001 to DATA-004. Archive validation gap: TR-001. |
| Application stability | Panic paths TR-002, TR-003 and DATA-005; WIN-001 can block startup on some layouts |
| Windows compatibility | Unverified on Windows: WIN-001, WIN-002, WIN-009 |
| Installation and first run | Configuration sound. No tested candidate. Legal text is draft. Docs are stale (WIN-003, WIN-005, TEST-002). |
| Security | Small surface. TR-001 (tampered archive) and TR-007 (defence in depth) |
| Performance | UI-008, TR-006 |
| Regression protection | Strong Rust and jsdom suites; packaged, Windows-path and manual coverage absent |

**Preliminary classification: Insufficient Evidence**, with confirmed unmet mandatory gates (candidate, smoke, P0-13/NA-3). **No confirmed P0 code defect.**

**Limits:**

- Linux host.
- No dependency-backed checks ran.
- CI logs and artifacts were not read: no network, and the GitHub tooling was deliberately not used.
- The Notion board was not refreshed.
- Tauri NSIS template behaviour, the WebView2 bootstrapper failure UI, OneDrive reparse reporting and DPI clamping are all unverified.

**Agent coverage:**

- **L1** (Windows and packaging) returned WIN-001 to WIN-012.
- **L2** (tests and evidence) returned TEST-001 to TEST-011 and the gate register.
- **Lead re-verification:**
  - `filesystem.rs:68-108` (WIN-001);
  - `git merge-base` checks showing `1a0d8af` and `c9feb38` are not in `7679edc`;
  - `b94fb1b..92e7980` = 14 commits and 28 files (correcting L2's figure of 18);
  - `build-26.75-evidence.md:133-137` (TEST-002);
  - grep for P0-09, P0-10 and P0-18 (0 hits);
  - the §5 check results.
- **Duplicates merged:** TEST-001 is a duplicate of WIN-007 and WIN-006.
