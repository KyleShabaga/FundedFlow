# Privacy and product documents: verification and owner decision

Status: complete editorial drafts, unreviewed; owner content/release approval NOT recorded. Revision 0.2.1-draft, 2026-10-22. PR #107 was open and unmerged when inspected. Work continues its existing branch; MIT distribution permissions do not themselves approve a release.

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

Remaining owner decision: approve the identified document revision and a named release commit/distribution scope after required verification, or request changes. Recommendation: retain draft status and withhold release approval until packaged checks and CI results are recorded. Owner content/release approval is NOT recorded.

Contact decision recorded in this chat: owner selected public GitHub Issues. No private address or separate business identity has been invented.

## Remaining uncertainty and release checks

No claim of lawyer review, compliance certification or elimination of liability. Applicability and sufficiency of privacy disclosures, enforceability of disclaimers, mandatory local consumer/privacy rules and third-party rights remain legal uncertainties. No target market or governing jurisdiction was established. The text intentionally imposes no invented jurisdiction or age threshold.

Optional routes include a university legal clinic, pro bono small-business/open-source program, or a limited-scope affordable document review if available; eligibility and availability require checking. These are optional paths alongside an explicit owner risk decision, not prerequisites silently imposed here.

The open GitHub issues endpoint returned only PR #107 on 2026-10-22. The branch already contains recovery-copy preservation and deletion cleanup logic; no outstanding issue fix is represented as implemented. Source search did not identify a quarantine mechanism in the current restore code: retained safety/candidate attachment copies are disclosed instead. WebView kept edits are outside erasure; this limitation is disclosed, not fixed. Failures can retain staging bytes. No forensic-erasure claim is made.

Before distribution, smoke-test the actual packaged Windows installer (with/without WebView2), old acceptance record prompt, Settings documents, restore/cleanup interruption, whole-journal erasure and uninstall retention. Source and jsdom verification do not establish packaged behavior. Record results and owner decision here before changing draft status.

## Verification results for this revision

- PASS: 77 tests across bundled legal documents, third-party legal UI, data controls, first-run/Settings journey and axe accessibility (5 files).
- PASS: 557 domain tests (17 files); typecheck; production build; domain boundary/dist checks; third-party notice generation check; notice tests (6); CI audit-guard tests (8); diff whitespace check.
- The initial full desktop run completed with 1215 passing and 3 failures, all obsolete wording/version assertions affected by this change. Those assertions were updated and all affected suites now pass. A later complete desktop run stalled and was stopped; a final whole-suite pass is not claimed.
- Rust test attempt: 359 passed, 29 failed, 2 ignored. Failures include Access denied in unchanged attachment filesystem code; environment confinement is a possible cause, not a demonstrated baseline result. No Rust source changed. Clippy compilation explicitly failed with Windows error 112 (disk full). A subsequent frontend build also encountered ENOSPC; generated Rust target files were removed, then build/typecheck/check were rerun successfully. Rust checks still require a clean CI run; no baseline exemption is claimed.
- jsdom emits its known unimplemented canvas getContext warning during axe checks; focused tests still pass. Production build emits a chunk-size warning.
- Packaged installer/runtime, uninstall and interrupted-cleanup smoke checks remain unperformed. No distribution approval is recorded.

## Authorized follow-up verification (2026-10-22)

The owner adopted the revised P0-13 criteria and authorized acknowledgment wording in this chat. Both documents are now 0.2.1-draft, with new digests. The existing schema and IDs are intentionally retained. All 77 focused document, acknowledgment, Settings, data-control and accessibility tests pass after this change. Rust tests rerun outside filesystem confinement with debug symbols disabled: 388 passed, 0 failed, 2 ignored. This resolves the earlier confined Rust test failures for this source revision; no Rust source fix was needed. Clippy and broader test/packaged checks are recorded below as results become available.
