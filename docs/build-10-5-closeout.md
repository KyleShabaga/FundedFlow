# Build 10.5 audit, remediation and closeout

## Decision and authoritative baseline

**Incomplete, with specifically identified blockers.** Ten reproduced backend/domain defects are fixed. Retained import-attempt boundary integration, full rulebook rendering acceptance, real-journal-copy migration, packaged Windows workflow evidence and human sign-off remain open. Proposed cross-build handoffs are not recorded as accepted scope removal.

- Initial fetched main: `4a462d0963f1b7b3ad45349ba23ee22964b7679f`, schema 18.
- Latest main fetched and integrated during this audit: `cb156b7a79a555416dc2330153769ac3c7138c84` (Build 23, PR #51), schema 18. Its [CI 39554055200](https://github.com/KyleShabaga/FundedFlow/actions/runs/39554055200) passed.
- Reviewed implementation commit on the remote audit branch: [`cf3f6147fad33c2f675837100cb46c38f6da7ffb`](https://github.com/KyleShabaga/FundedFlow/commit/cf3f6147fad33c2f675837100cb46c38f6da7ffb); this contains the tested remediation plus the integrated main. Documentation-only follow-ups do not change that implementation.
- Resulting schema: **20**, with additive `0019_rulebook_binding_provider.sql` and `0020_source_fact_immutability.sql`. No applied migration was edited.
- Branch: `feat/build-10-5-deep-audit-closeout`. [Draft PR #50](https://github.com/KyleShabaga/FundedFlow/pull/50), not merged.
- Requirements: [10.5](https://app.notion.com/p/3ff1bd4b6bde813fb689dca50eaed208), [8.75](https://app.notion.com/p/3ff1bd4b6bde810ba2d3d61788df9b47), [9](https://app.notion.com/p/3fe1bd4b6bde815d8997da8faf64e295), [9.5](https://app.notion.com/p/3ff1bd4b6bde8164a8fbd2cd94245d55), [10](https://app.notion.com/p/3fe1bd4b6bde81468fbedda9a3b3e4d3).
- [53-row acceptance matrix](build-10-5-acceptance-matrix.md): exact source wording, implementation, storage, interface, named tests, result, status, owner and next action. The matrix retains broad/manual criteria as partial where automated evidence proves only a subset.

## PR integration and existing capability inventory

| PRs | Observed status | Delivered scope |
|---|---|---|
| #19, #20 | Merged | Legacy migration mapping/fixtures; reusable immutable rulebooks, applicability, conversion, assignments |
| #26, #27, #28, #29 | Merged | Attempt reset/archive/restore; ledger/settings/snapshots/catalogue commands; immutable offer selections; review fixes |
| #38, #39, #40 | Merged | Accounts UI, sourced financial evidence/reconciliation and integration |
| #41 | Merged | CSV wizard, account targeting and existing confirmation path |
| #42, #44 | Merged | Build 16 engine and Build 19 editor/integration; earlier Notion “draft, not on main” claims are historical |
| #45–49, #51 | Merged | Later journal/Today/daily review/collector/Insights changes present on the integrated baseline; no duplicate implementation here |
| #43 | Open, unmerged when inspected | Build 24 portable archive/restore/permanent deletion; not part of this baseline |

The offline architecture remains desktop → domain port → Tauri → Rust → SQLite. Existing commands/adapters expose catalogue authoring/review, immutable sources/offers, account links and append-only phase events; reusable rulebooks and assignments; settings, auditable ledger corrections and nullable immutable risk snapshots. No duplicate repository, financial evaluator, cloud journal, broker sync or telemetry was introduced. Product UI implementation is unchanged relative to integrated main.

## Reproduced findings and remediation

Rust paths below are relative to `apps/desktop/src-tauri/src/`.

| ID / priority | Reproduction and consequence | Smallest correction | Regression evidence |
|---|---|---|---|
| F1 / P0 recovery | After v3→v4 commits and step 5 fails, retry replaced the original v3 backup with a v4 copy. The original recovery point disappeared. | `db/mod.rs::open_file` copies an existing backup to a unique `.previous-<uuid>.bak`, flushes it, then replaces the stable backup path. Preservation failure aborts migration. | `db/upgrade_tests.rs::retrying_a_partial_upgrade_preserves_the_original_pre_upgrade_backup` failed before the fix, passes after; exact old bytes/rows retained. `failure_to_preserve_an_existing_backup_prevents_any_migration` proves failure safety. |
| F2 / P1 | Updating an archived account committed name/provider/status edits, then returned NotFound. | `store/accounts.rs::update` excludes archived rows before related writes. | `store/attempt_tests.rs::archived_account_edits_leave_identity_status_and_history_unchanged`: failed before, passes after; identity, trades, status history and firm creation remain unchanged. |
| F3 / P1 | Deleting an archived trade succeeded, cleared journal links and wrote correction history. | `store/trades.rs::delete_with` checks owner writability inside the transaction. | `archived_trade_deletion_preserves_the_trade_journal_link_and_correction_history`: failed before, passes after; restore re-enables normal deletion. |
| F4 / P1 | Deleting an archived journal entry removed its note and tag links. | `store/journal.rs::delete` checks the owning account first, preserving the public signature. | `archived_journal_deletion_preserves_the_entry_and_tags_until_restore`: failed before, passes after. |
| F5 / P1 | A private rulebook draft remained editable after its account was archived. Create, publish, discard and conflict paths also lacked an owner archive guard. | `store/rulebooks.rs` checks private owners in all six authoring paths before durable writes. | `db/rulebook_editor_tests.rs::archived_private_rulebooks_reject_all_authoring_without_changing_history`: reproduced update before fix; now checks every operation against an unchanged whole-database dump and permits publication after restore. |
| F6 / P1 | A snapshot for account B accepted account A's private rulebook version. | `store/snapshots.rs::save` validates private ownership and unknown version IDs in its transaction. Catalogue versions remain reusable. | `store/build10_tests.rs::snapshots_cannot_use_another_accounts_private_rulebook`: failed before, passes after; B has no snapshot while A can save its own. |
| F7 / P2 | Zod accepted `1.0000000000000000000000000001` as a consistency share because Number rounded it to one; Rust rejected it. | `packages/domain/src/rulebook/rules.ts::shareOfOne` compares canonical decimal text exactly. No new arithmetic implementation or dependency. | `test/rulebook/rulebook.test.ts` failed before, passes after; Rust `rulebook.rs::tests::parameters_are_checked_against_their_rule_type` pins exact edges. Existing engine regression now expects canonical input rejection rather than passing invalid data through the parser. |
| F8 / P1 | `getApplicable` returned resolved for an explicitly bound archived version. | `store/rulebooks.rs::applicable` requires active version/book and matching provider; invalid bindings remain visible as unverified. | `db/rulebook_tests.rs::an_archived_bound_version_is_not_resolved_as_applicable`: failed before, passes after. |
| F9 / P1 | Phase/path binding updates accepted a catalogue rulebook belonging to another provider. | Forward migration 19 adds INSERT/UPDATE guards; applicability reads fail closed for existing mismatches; assignment refuses an unverified foreign binding. | `phase_and_path_bindings_refuse_another_providers_rulebook`: failed before, passes after, including insert/update paths. `migration_19_retains_old_bindings_but_never_resolves_a_foreign_provider` and `failed_migration_19_rolls_back_its_triggers_and_version` cover preserved historical rows, backup, reopen, assignment refusal and atomic DDL rollback. |
| F10 / P1 | The existing source test only validated creation; SQL could rewrite captured URL/time facts beneath historical claims. | Forward migration 20 freezes captured identity/content/date/hash facts while allowing independent reviewer/verification metadata. Referenced-source deletion remains FK-restricted. | `store/build9_tests.rs::captured_source_facts_are_immutable_even_when_written_through_sql` failed before the guard; after it, URL/time edits are refused, facts stay unchanged and review-state update still works. `source_guard_migration_failure_keeps_the_prior_schema_and_facts` covers rollback at v19. |

Additional lifecycle coverage: `same_day_resets_across_the_dst_overlap_keep_distinct_instants_and_attempts` distinguishes both occurrences of 01:30 across the November DST overlap, preserves separate UUID attempts with a reused broker number, and rejects a timestamp missing its offset without adding status history. This proves storage/time normalization, not full import-window acknowledgement.

## Verification ledger

Windows/MSVC stable Rust and Node 24 were used. Commands ran from the repository root, except Cargo commands from `apps/desktop/src-tauri`.

| Gate | Final observed result |
|---|---|
| `npm ci` | **PASS**, 156 packages installed, 159 audited, zero reported vulnerabilities. Initial sandbox symlink failures and one locked native-module retry were superseded by a successful clean install after the packaging process exited. Lockfile unchanged. |
| `npm run check` | **PASS**, domain boundary and plain-Node package import; 282 exports |
| `npm run typecheck` | **PASS**, domain and desktop |
| `npm test` | **PASS**, 487 domain + 545 desktop tests, 15 + 43 files, after clean install |
| `npm run build` | **PASS**; existing >500 kB chunk warning remains, not a failed build |
| `cargo test` | **PASS**, 259 passed, 0 failed, 2 ignored; binary/doc targets each 0 tests |
| `cargo clippy --all-targets -- -D warnings` | **PASS** |
| `cargo fmt --check` | **FAIL**, baseline-wide formatting differences; first is unchanged `src/catalogue.rs:39`. Reproduced on a pristine file from initial main. Broad reformatting was not mixed into these fixes. This gate remains open. |
| `git diff --check` | **PASS** |
| Targeted database suite | **PASS**, 69 passed, 1 ignored; includes legacy, populated upgrades, migration 19 and recovery |
| Native Windows package | **PASS**, NSIS installer built using workspace-local tools cache; final artifact/checksum recorded below |
| Packaged interactive Windows workflow | **NOT EXECUTED** |
| Real-journal-copy upgrade | **NOT EXECUTED**, no explicitly approved journal copy provided |
| Human acceptance | **PENDING** |

The two ignored Rust entries are `upgrade_copy_of_a_real_journal` (requires explicit approval) and `csv_import::tests::regressions::preview_exit_worker` (an internal subprocess worker invoked by its parent test). They are not hidden successful tests.

Failure investigation preserved: the sandbox run had 254 pass / 3 failures / 2 ignored on the integrated code before the final source-fact guard. The three failures were file rename/screenshot Access Denied errors; all reproduced on clean initial main (runtime retry test 0/1; journal review group 11/13). With permitted native verification access, the complete suite passed 257/257. The reported historical Linux legacy-rulebook SQLite I/O failures did **not** reproduce on this Windows host. Linux was not executed in this audit.

One post-integration desktop run timed out at 5 seconds in “your published account rules are confirmed by you and evaluate for real once assigned”; a full rerun passed, and the clean-install full run passed again without changing test timeout or assertions. Earlier missing Insights exports came from the temporary copied dependency fallback's stale domain build; refreshed/copied artifacts and ultimately the successful clean install removed that environment issue. Neither failure was suppressed.

## Migration and historical-integrity evidence

- Disposable populated v3/v4 SQLite fixtures upgrade through the current registry, preserve original trade/import/journal/provenance rows, keep the documented trading-day correction, and reopen idempotently.
- v7 reviewed catalogue records remain frozen after migration 8. Populated v8 legacy rulebooks convert account-privately with stable IDs, source/verification state, assignment intervals and snapshot references; re-running conversion changes nothing.
- v10 lifecycle migration, v12 snapshot FK repair, v13→14 financial evidence, and v14→15→16 nullable snapshots/audit-log recovery remain covered. Existing v17→18 daily-review preservation now asserts `latest_version()` rather than hard-coding the final schema.
- New v18→current populated test applies migrations 19–20, retains every original row, records a schema-18 backup, refuses foreign-provider assignment and reopens with the same unverified historical binding. Migration-20 failure keeps v19 and the source facts intact.
- Failure tests prove per-step transaction/version rollback, migration-19 trigger rollback, failed catalogue/import/reset writes, backup-preservation failure safety, and retained original recovery bytes across partial-upgrade retry.
- Restoring a pre-upgrade backup recovers the old journal and upgrades again. Newer-schema journals are rejected before persistent journal-mode changes.
- No real user journal, balances, provider rules, historical verification state or external event was fabricated or modified.

## Documentation reconciliation

Corrected `docs/data-model.md`: catalogue schema-only/no-command contradiction; phase/path integrity; nullable snapshot state; backup retention; migration/schema 19. Corrected `docs/architecture/packages.md`: production catalogue IPC and current bigint/rational engine dependency policy. Added a current reconciliation note to the historical Build 15.5 handoff; resolved its Build 16 “not implemented” interpretation without deleting delivery history. Updated Build 16's old share-validator warning to the actual fix, and linked this evidence from README.

The source cards' older baseline sections remain history. PR #20/#28 pending/open statements and #42/#44 draft dependencies are superseded by current merge evidence. “Done” is not inferred from merge or CI.

## Remaining acceptance gates and proposed owners

1. **Build 18 / 15 integration:** exact same-day/intraday/account-local reset-window assessment and durable acknowledgement. Existing `assessImportTarget` is connected, but UTC date slicing/strict date comparisons miss some ambiguous windows. Native commit has no acknowledgement token. The full proposed contract is in the matrix. No parallel UI was introduced.
2. **Build 9 / 15 scope decision:** production links support `evaluation_reset`; a new `phase_successor` write operation is absent, with `parent_account_id` retained as legacy metadata. Confirm the retained criterion or an explicit accepted transfer; do not call the broader requirement complete.
3. **Build 19:** complete rendered state/provenance/effective-date matrix and packaged/human acceptance. The merged editor is reused; component mocks do not replace native IPC.
4. **Build 16 integration:** frozen input calculation and snapshot save are implemented, but trade/import plus engine snapshot is not one native transaction. Concurrent-current-result/revision promotion remains a named integration gate, not a fabricated guarantee.
5. **Build 24/25:** PR #43 owns portable full-journal archive/restore and permanent deletion.
6. **10.5/manual:** packaged WebView2 startup/restart, catalogue/phase/offer and rulebook reads, reset/archive/restore conflicts, CSV attempt targeting and recovery. Use an isolated synthetic journal first. An explicitly approved disposable real-journal copy and human reviewer sign-off remain required.
7. **Repository maintenance:** baseline formatting normalization remains an open `cargo fmt --check` gate.

No source card was moved to Done by this audit. Build 8.75 was reopened to Reviewing because F1 reproduced loss of its original pre-upgrade recovery point on main, invalidating part of its recovery acceptance. Its correction is pending PR review/merge. Builds 9/9.5/10 remain Reviewing and 10.5 remains In development while retained gates are open. Earlier reviews were preserved.

## Commits, durable continuation and delivery

Remote logical commits: `02dcd0b` baseline; `ddf34a1` archived history fixes; `2c00b78` backup/private ownership/exact-share fixes; `9419b5f` latest-main integration and provider/applicability guards. `cf3f614` adds migration 20 and source-fact regressions. Local logical commits additionally include `bd282da`, `992e994`, `99165b7`, `aaafb47`, `349b2cb` and `9f82afc` and `c8d65cd`. Equivalent local/remote SHAs differ because the sandbox initially blocked Git credential-helper execution; the connector preserved tested content and commit ancestry. Use the remote PR branch for continuation.

Next work starts at the seven gates above; do not repeat the baseline investigation or rebuild merged catalogue/rulebook/engine features. No PR merge is authorized.

## Final package and Notion observations

The final Windows x64 NSIS installer was successfully rebuilt with migration 20. Size: 4,804,346 bytes. SHA-256: `C46B8E0C035E23D8AF3808D471E1327043E73C6788B7F840B7ED272EB1A413F9`. It was not installed or launched. Command:

```powershell
npm run tauri -- build --bundles nsis --config <workspace>/work/tauri-tools.json
```

The temporary config contains only `{"bundle":{"useLocalToolsDir":true}}`, keeping build-tool downloads in `target/.tauri`. Default-cache extraction initially failed with Access Denied; sandboxed NSIS execution then failed with DLL relocation error 623. A permitted build outside those restrictions succeeded. No product identifier/data-directory override or product UI change was introduced.

Notion content writes and read-back checks succeeded on Build 10.5, 8.75, 9, 9.5 and 10. Build 8.75 is Reviewing with the recovery regression and PR link; 9/9.5/10 remain Reviewing, 10.5 remains In development. Evidence is pinned to the implementation SHA and links this matrix/report. Earlier reviews were preserved. Builds 15/15.5/16/19 were read for ownership; no unrelated source-card rewrite or notification was sent.

GitHub Windows CI [39556795787](https://github.com/KyleShabaga/FundedFlow/actions/runs/39556795787) passed at `9419b5f` before the final source-fact guard. Final implementation CI [39557853325](https://github.com/KyleShabaga/FundedFlow/actions/runs/39557853325) **passed** at `cf3f6147fad33c2f675837100cb46c38f6da7ffb`; local final-code functional verification also passed as recorded above. This does not close formatting, manual or retained integration criteria.
