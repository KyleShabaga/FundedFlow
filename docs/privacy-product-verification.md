# Privacy and product documents: verification and owner decision

Status: owner-approved document content; no independent legal review or release approval recorded. Documents retain draft distribution status pending the remaining release checks. Revision 0.2.1-draft, 2026-10-22. PR #107 was open and unmerged when inspected. Work continues its existing branch; MIT distribution permissions do not themselves approve a release.

## Evidence map

| Statement | Implementation inspected |
|---|---|
| Per-user SQLite and separate acceptance | `apps/desktop/src-tauri/src/lib.rs` setup; `legal.rs`; `db/mod.rs` |
| Plain files and screenshot copies | `store/attachments.rs` write_new/add; `data_controls/archive.rs` snapshot/export |
| Export staging and restore safety retention | `data_controls/archive.rs` export/inspect_to; `restore.rs` prepare/recover |
| Account versus journal deletion, pending cleanup | `data_controls/deletion.rs` preview/delete/recover_cleanup |
| Migration copies retained | `db/mod.rs` backup_path/open and migration backup preservation |
| Separate WebView preferences and kept edits | `AppShell.tsx`; `rulebooks/components/unsaved.ts`; `journal/components/ReviewCard.tsx`; `daily-reviews/components/DailyReviewPage.tsx` |
| No desktop upload/updater/telemetry configured | Rust `lib.rs` plugin/command registration, Cargo manifest, production CSP and capabilities; frontend network-call search. This is source inspection, not packet capture or an OS/runtime guarantee. |
| WebView2 bootstrap download | `src-tauri/tauri.conf.json` downloadBootstrapper |
| No custom uninstall data purge configured | same bundle configuration; no custom NSIS hooks. Packaged uninstall retention still needs a Windows smoke check. |
| Collector network and logs | `tools/prop-firm-collector/src/fundedflow_collector/net/`, `render/browser.py`, `logging_setup.py`, capture/storage modules |
| MIT and third-party notices | root LICENSE, legal/index.ts raw LICENSE import, ThirdPartyNotices component, installer resources |

GitHub support text describes public service use and voluntary disclosure, not app collection. GitHub's own policy governs GitHub processing: https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement . Maintainer-specific download visibility must not be confused with GitHub's server-side access logs.

## Acknowledgment flow — authorized 2026-10-22

The owner explicitly authorized “License and product information”, “Acknowledge and continue” and “Close” on 2026-10-22. Implemented in this revision. The record indicates notice acknowledgment, not an additional MIT permission condition. Stable IDs and serialized schema remain compatible; both documents are bumped to 0.2.1-draft and require a fresh acknowledgment.

## P0-13 replacement — adopted by owner 2026-10-22

The owner selected “Adopt the proposed criteria” in response to the exact criteria presented in this chat:

“Replace the requirement for counsel sign-off with the following release criteria: documented factual verification against the release source and packaged Windows behavior; passing relevant document, acceptance, Settings, accessibility and repository checks; explicit owner approval of identified document versions, release commit and distribution scope; and a recorded list of unresolved factual and legal risks and their disposition. Independent legal review is optional and must never be represented as completed unless actually obtained. Owner approval is not legal review or certification. A release remains blocked until the owner records these approvals and resolves or expressly accepts each remaining risk.”

This explicit decision replaces the original counsel-sign-off requirement. It is policy approval only: it does not approve document content or a release. Independent review remains optional; no such review is recorded.

## Document content approval — recorded 2026-10-22

The owner reviewed the documents supplied in this chat and explicitly stated: “I have review the documents and i appove them”. This records approval of the following exact bundled content at source commit `d3e263f`, unchanged in `c290d1c`:

| Document | Approved version | SHA-256 document digest |
|---|---|---|
| Privacy notice | `0.2.1-draft` | `8b83157f3e1075a64fb631e39616c37e5b70cc3c70e54f473c05ec9d0db1c392` |
| License and product information | `0.2.1-draft` | `96894603aff89db92b60b307f85693756d0e540f03851c2d39568a441c68911a` |

This is owner content approval, not lawyer review, certification, approval to merge, or authorization to publish a release. The approved document bytes, versions, digests and draft flags are unchanged by this approval record. Statements in their preparation-status paragraphs describe the submitted revision; this dated decision records the subsequent owner approval. Distribution status remains draft until the remaining release criteria are met. A future finalized revision must update its status wording, version and digest consistently and identify any substantive changes for approval.

Remaining owner decision: approve a named release commit and distribution scope after required verification and the disposition of remaining risks. Release approval is NOT recorded.

Contact decision recorded in this chat: owner selected public GitHub Issues. No private address or separate business identity has been invented.

## Remaining uncertainty and release checks

No claim of lawyer review, compliance certification or elimination of liability. Applicability and sufficiency of privacy disclosures, enforceability of disclaimers, mandatory local consumer/privacy rules and third-party rights remain legal uncertainties. No target market or governing jurisdiction was established. The text intentionally imposes no invented jurisdiction or age threshold.

Optional routes include a university legal clinic, pro bono small-business/open-source program, or a limited-scope affordable document review if available; eligibility and availability require checking. These are optional paths alongside an explicit owner risk decision, not prerequisites silently imposed here.

The open GitHub issues endpoint returned only PR #107 on 2026-10-22. The branch already contains recovery-copy preservation and deletion cleanup logic; no outstanding issue fix is represented as implemented. Source search did not identify a quarantine mechanism in the current restore code: retained safety/candidate attachment copies are disclosed instead. WebView kept edits are outside erasure; this limitation is disclosed, not fixed. Failures can retain staging bytes. No forensic-erasure claim is made.

Before distribution, smoke-test the actual packaged Windows installer (with/without WebView2), old acceptance record prompt, Settings documents, restore/cleanup interruption, whole-journal erasure and uninstall retention. Source and jsdom verification do not establish packaged behavior. Record results and owner decision here before changing draft status.

## Verification results for 0.2.1-draft

Application source commit: `d3e263f` (owner-authorized acknowledgment flow). Subsequent report-only changes do not alter the bundled application.

| Check | Result |
|---|---|
| Full domain suite | PASS: 557 tests in 17 files |
| Full desktop suite, including document digests, acknowledgment/first-run, Settings and accessibility | PASS: 1,218 tests in 85 files |
| Focused legal/data-control/first-run/Settings/accessibility rerun | PASS: 77 tests in 5 files |
| Third-party-notice tests | PASS: 10 tests |
| CI audit-guard tests | PASS: 8 tests |
| Rust tests outside filesystem confinement, reduced debug-symbol build | PASS: 388 passed, 0 failed, 2 ignored |
| Clippy, all targets, warnings denied | PASS |
| Typecheck, production build, domain boundaries/dist | PASS |
| Generated third-party-notice check | PASS; inventory unchanged |

The full test command was rerun sequentially and exited successfully. Earlier frontend attempts overlapped builds that clean the shared domain output, causing missing-package errors and invalidating those attempts. They are not evidence of product regressions or baseline defects. The earlier confined Rust attempt had filesystem access failures; the successful unconfined rerun needed no Rust source changes. An initial Clippy attempt exhausted disk; generated build files were cleared and Clippy subsequently passed with reduced debug symbols. No tests or checks were weakened to obtain these results.

Warnings: jsdom emits an unimplemented canvas getContext warning during axe checks; the tests pass. The production build emits a chunk-size warning. Two Rust tests remain ignored as in the repository configuration; they are not counted as passes.

## Packaged release verification still required

CI and the Windows installer workflow for `d3e263f` were running when this report was prepared. Dependency audit had passed; a completed full CI or installer result is not inferred from local passes. This repository builds unsigned test installers as artifacts without publishing a release.

Use a disposable Windows environment or separate test user so these checks cannot alter an existing journal or installation. Record artifact filename, source SHA, SHA-256, OS/WebView2 version and observations:

1. Install on a machine with WebView2; verify bundled LICENSE and THIRD_PARTY_NOTICES.txt match the source and Settings. Separately test a clean machine without WebView2 and observe the Microsoft bootstrap download. Do not remove the user's runtime to simulate that case.
2. First launch: draft status, two current notices, keyboard focus and disclosure order, Close, and Acknowledge and continue. Verify that closing writes no acknowledgment; the background journal runtime can still create/migrate its local database.
3. Upgrade using a copied old acceptance record: both changed documents are named and re-prompted. Acknowledgment stores the same stable IDs and acceptedAt schema; reopening skips the prompt. Settings shows the correct versions, dates and acknowledgment time.
4. With synthetic data only, export and restore; verify plaintext content and retained safety copies. Interrupt a restore/cleanup operation and verify recovery or cleanup-pending messaging without claiming deletion has finished.
5. Delete one synthetic account; verify recovery copies remain. Erase the synthetic whole journal; verify managed copies are removed on completion and external exports, acceptance/acknowledgment file and WebView stores remain outside that operation.
6. Uninstall the test installation and inventory the remaining app data, WebView data and external exports. Record each available uninstall option rather than assuming that uninstall erases data. Reinstall and confirm whether the retained acknowledgment still suppresses the prompt.

The Windows computer-use helper is available, but no FundedFlow window was running during inspection. No packaged runtime, uninstall, missing-WebView2 or interrupted-operation smoke check is claimed as completed. Those checks and explicit owner approval of the release commit/scope remain release blockers under the adopted P0-13 criteria. No release is authorized by this report.
