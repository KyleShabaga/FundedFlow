## 9. Recommended corrections, missing tests and verification limits

**Recommended order:**

1. TR-001 and TR-002 (P1, one-line fixes plus tests).
2. TR-006 and TR-009.
3. TR-003, TR-004 (`catch_unwind` in `with`/`with_controls`), TR-007 and TR-008.
4. P3 hardening: TR-010 to TR-018.
5. Owner decisions: TR-014 wording, TR-020 fixtures.
6. The collector item TR-019 is secondary.

**Missing tests:**

| Missing test | For |
|---|---|
| Archives containing `sqlitex`-style names | TR-001 |
| Extreme planned prices and trade prices | TR-002, TR-003 |
| An injected panic in a command | TR-004 |
| Visible-only screenshot reads | TR-006 |
| Path validator | TR-007 |
| String-rejection classification | TR-008 |
| `created` after `prepare_restore` | TR-009 |
| Freshness `unavailable` | TR-010 |
| Arg-key ↔ parameter binding, and the output fixtures listed | TR-011 |
| Binary dev-name check in the release workflow | TR-012 |
| Exact-capability assertion | TR-013 |
| Non-ASCII stored timestamp | TR-015 |
| Archive with many central-directory entries | TR-016 |

**Commands executed** (read-only, from the repository root or `apps/desktop/src-tauri`):

- `git branch --show-current`, `git rev-parse HEAD`, `git status --porcelain -uall`, `git diff --stat 92e7980 HEAD -- . ':!code-review'` → exit 0, clean, no source diff.
- `echo ${FUNDEDFLOW_UPDATE_FIXTURES-unset}` → `unset`.
- `ls ~/.cargo/registry node_modules` → absent.
- `sed -n` / `grep -n` reads of `restore.rs`, `archive.rs`, `reviews.rs`, `domain.rs`, `runtime.rs`, `lib/data/runtime.ts` → exit 0.
- Lane 1 ran two scratchpad Python scripts that read repository files only. No repository writes.

**Skipped:** `cargo test`, `cargo clippy` and `npm test`. There are no offline dependencies, and fetching them would need the network. No disposable-data experiments.

**Limits:**
- Linux only. No WebView2 or Windows path semantics, so UNC/ADS behaviour and the Tauri panic→invoke behaviour (TR-004) are unverified.
- The `core:default` expansion is not checked against the generated schema (TR-013).
- Whether `reqwest` is compiled for the target is unverified.
- Collector Playwright behaviour is unverified (TR-019).

## 10. Reconciliation register (Phase 3 delta) and agent coverage

| Prior item | Phase 3 result |
|---|---|
| R-01 blocking async | TR-005 (canonical DATA-007) |
| R-08 webview paths | TR-007 |
| R-10 panics | Audited; TR-002, TR-003, TR-015 real; listed sites safe |
| R-14 bypass paths | TR-010; data controls TR-018 |
| R-19 CSVs | TR-020 (owner) |
| R-22, R-21 CI | Phase 5 |
| R-23 privacy wording | TR-014 (Phase 5 owns packaging) |
| R-27 debug gating | Correct; hardening TR-012 |
| P0-02 risk promotion (Final Push V1) | Promotion is an IMMEDIATE transaction with a source-fingerprint check. Rust validates payload consistency, not the computation; Phase 4 UI-002 covers this. Partially Confirmed. |
| P0-13 / NA-3 | Legal persistence and commands are sound. Draft text is still present. Open (implementation not authorized). |
| Open baseline gates | Unchanged; Phase 5 register |

**Categories:**

| Category | Items |
|---|---|
| Confirmed defects | TR-001, -002, -003, -009, -015; mechanisms of -006, -008, -010, -018 |
| Defence in depth / hardening | TR-007, -012, -013, -016, -017 |
| Hypotheses | TR-004, -016, -019 |
| Owner decisions | TR-014 wording, TR-020 |
| Escalation | TR-001 is a security-relevant integrity issue. It is flagged for Phase 6 verification but needs a tampered archive, so it is not a P0. |

**Lead verification:**

| Finding | What the lead read |
|---|---|
| TR-001 | `archive.rs:201-208, 465-487` and `restore.rs:60-140` |
| TR-002 / TR-003 | `reviews.rs:225-252, 500-532, 625-640`; `domain.rs:135-147, 400-415` |
| TR-007 | `data_controls/mod.rs:113-153` |
| TR-009 | `runtime.rs:225-239` vs `lib/data/runtime.ts:48, 62` |
| TR-010 | `freshness.ts:1-21` |
| Capabilities / CSP | `tauri.conf.json` and capabilities, read in Phase 1 |

There were no unresolved conflicts between lanes. Duplicates were merged:

| Lane IDs | Became |
|---|---|
| REL-04 + SEC-001 | TR-007 |
| REL-07 + IPC-006 | TR-005 |
| REL-10 + REL-09 | TR-017 |
| SEC-004 | TR-014 |
| IPC-007 | TR-018 |
