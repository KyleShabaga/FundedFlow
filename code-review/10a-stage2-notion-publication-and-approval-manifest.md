# FundedFlow: Stage 2 Block 4A, Notion publication and approval manifest

| Field | Value |
|---|---|
| Date | 2026-10-22 |
| Repository and branch | `KyleShabaga/FundedFlow`, `claude/practical-turing-wmii06` |
| Input revision | `b01e2b91cf5d5314a22ea7416f908ff7587431e3` (reports 00–10, ledger, coverage matrix, 36 cards at spec r2). Application source is identical to `92e7980`. |
| Publication status | **Complete** after the Block 3 rerun (2026-10-22). It was Partial at first publication, when 18 cards still carried Block 4 corrections. Those cards are now at spec r3, independently reviewed (commit `9470f99`), and their board cards are updated. |
| Human approvals recorded | **None.** No card is Approved, Rejected or Deferred. No gate is Passed. |

## 1. Notion objects

| Object | URL / ID |
|---|---|
| Parent page (Code Review Stage 2) | https://app.notion.com/p/3ff1bd4b6bde805c8770fc90b34bf554 |
| Handoff page "Stage 2 Audit and Remediation Handoff" | https://app.notion.com/p/4011bd4b6bde819c86abc666dfedc288 |
| Database "Stage 2 Remediation Approval" | https://app.notion.com/p/ee596d87b7f449fca6a8b6f63f227aa1 |
| Data source | `collection://d1bf9816-03f0-409d-a88d-a08c9dc4d095` |
| Source Reports page (13 byte-exact attachments) | https://app.notion.com/p/4011bd4b6bde813ebb91d369fa872e75 |
| Readable copies | 00 (3 parts), 08 (2 parts), 09, 10. Full URLs are in `notion-handoff/urls.json`. |
| Task cards | 36 pages; URLs in `notion-handoff/urls.json` (`cards`). |

### 1.1 Views

| View | Type | Configuration | ID |
|---|---|---|---|
| Approval Board | board | Grouped by Approval (status, by option, empty groups shown); sorted by Task ID | `view://4011bd4b-6bde-8161-b9e0-000c2f2d4a39` |
| All Tasks | table | Sorted by Task ID | `view://4011bd4b-6bde-81db-a76c-000c3ab71a45` |
| Proposed First Wave | table | Proposed First Batch = true | `view://4011bd4b-6bde-8182-a533-000c03baf8f1` |
| Blocked / Needs Decision | table | Needs Owner Decision = true OR Spec Readiness = Needs Block 3 correction (r3) OR Execution Status = Blocked | `view://4011bd4b-6bde-8102-b258-000c4182ffc3` |

### 1.2 Schema

- **Identity and provenance:** Name (title), Task ID, Stable Key, Finding IDs, Canonical Issues, Source Card, Specification Revision, Evidence Revision.
- **Approval:**
  - Approval (status): Pending Review [default], Changes Requested, Approved, Rejected, Deferred.
  - Spec Readiness: Ready for Approval (r2), Needs Block 3 correction (r3).
  - Approval Scope.
- **Classification:** Type, Priority, Audit Priority (verbatim), Severity, Roadmap Lane, Wave.
- **State:** Execution Status, Finding Verification, Release Blocking, Gate State.
- **Human decision fields (blank):** Approved Specification Revision, Approved By (people), Approved At (date), Decision Notes.
- **Planning details:** Effort, Risk, Verification Platform, Proposed First Batch (checkbox), Needs Owner Decision (checkbox).
- **Relations:** Dependencies (self-relation), with dual property Blocks.

## 2. Counts (published properties)

| Dimension | Values |
|---|---|
| Cards | 36 (TASK-001…036) |
| Type | Code Fix 15, Owner Decision 9, Verification-Test 8, Documentation 4 |
| Priority | P0 0, P1 22, P2 2, Gate 12 |
| Wave | W0-D 8, W0-Doc 1, W0-M 2, W1a 1, W1b 2, W1c 3, W1d 1, W1-opt 1, W2a 2, W2b 2, W2c 1, W3a 3, W3b 1, W3c/W5 1, W4 1, W5 4, W6 2 |
| Approval | Pending Review 18, Changes Requested 18 (set by Block 4 agent review, not by Kyle), Approved/Rejected/Deferred 0 |
| Spec Readiness | Ready (r2) 18, Needs r3 18 |
| Release Blocking | Yes 29, Conditional 1, No 6 |
| Gate State | Not Run 12, N/A 24, Passed 0 |
| Execution Status | Not Started 36 |
| Dependency relations | Set on 22 cards |
| Proposed First Batch | 012, 019, 020, 022 |
| Needs Owner Decision | 001, 002, 003, 005, 006, 007, 008, 009, 025, 036 |

Coverage: 58 canonical issues and 84 finding IDs are each mapped to a task, a deferral or an exclusion in 08 §C. The known index gaps are in 10 §8.1.

## 3. Source reports published

The 13 source reports are listed below. Each was attached byte-exact and verified by its byte count and SHA-256. The SHA-256 values are in `notion-handoff/reports_manifest.json` and on the handoff page.

| Report | Readable Notion copy |
|---|---|
| 00 | Yes (3 parts) |
| 01, 02, 03, 04, 05, coverage matrix, 06, ledger, 07 | Attachment only |
| 08 | Yes (2 parts) |
| 09 | Yes |
| 10 | Yes |

## 4. Agent coverage

| Agent | Scope | Result |
|---|---|---|
| Secrets / PII scan (independent) | All payloads before publication | No redactions needed. The only optional note was that the GitHub slug is present. |
| Notion QA (independent, read-only) | Schema, views, 36 rows, properties vs local, sampled card bodies, handoff page, no auto-approval | All 8 checks passed (§6) |

## 5. Omissions and deviations

- Readable Notion copies were made for 00, 08, 09 and 10 only. The other nine reports are full byte-exact attachments and have no readable copy.
- A local file upload through the shell was blocked by the environment and not retried. Attachments were created from commit-pinned raw repository URLs, and their byte lengths were confirmed.
- The handoff page links the database by mention. The database itself is a child of the Code Review Stage 2 page.
- 09 counts "Verification 7" and "Test 1" separately. The board merges them into one type, Verification-Test (8).
- Nothing was deleted, archived, shared publicly or changed in permissions. No roadmap cards were edited.

## 6. Verification results

An independent, read-only QA agent checked the publication on 2026-10-22. All eight checks passed:

| # | Check | Result |
|---|---|---|
| 1 | Schema: Approval status has 5 options, default Pending Review; the human-decision fields exist; Dependencies and Blocks hold 55 matching links each way | PASS |
| 2 | Views: the 4 views match their configuration, and the board shows empty groups. Notion also keeps its automatic "Default view". | PASS |
| 3 | Rows: exactly 36, TASK-001…036, no duplicates | PASS |
| 4 | No auto-approval: 0 cards Approved, Rejected or Deferred; Approved By, Approved At and Approved Specification Revision empty on all 36; 0 gates Passed; Changes Requested only on the 18 expected cards, each noting "NOT by Kyle" | PASS |
| 5 | Properties and dependencies match `cards_properties.json` on all 36 rows | PASS |
| 6 | Card bodies: 6 sampled (012, 022, 029, 007, 036, 017) match the local r2 spec; each has the PROPOSAL callout and a blank human-decision table | PASS |
| 7 | Handoff page: all sections present; its 13 SHA-256 values and byte counts match; the Source Reports page has 13 attachments | PASS |
| 8 | Secrets and personal data: none found | PASS |

Three cosmetic issues do not block anything:
- Notion turned some file names into links, for example `CLAUDE.md` became a link to `http://CLAUDE.md`. The visible text is correct.
- On the Source Reports page, part 3 of report 00 appears below the attachments section.
- The Source Reports page labels the Stage 1 phases 1–6, but the reports are numbered 00–05.

## 7. Blockers and resume point

- **Blocker for a complete approval package:** a Block 3 rerun to spec r3 for TASK-007, 008, 011, 013, 015, 016, 017, 018, 021, 023, 027–034, plus the 08 index corrections in 10 §8.1, each with independent review.
- **Updating the board after r3:**
  - replace each corrected card's body;
  - set Spec Readiness to Ready (r3) and update the Specification Revision;
  - return Approval to Pending Review, which only Claude may do for a Changes Requested card that it set, with a note.
- **Then:** Kyle approves cards on the board (handoff page §8). Block 5 starts only from Approved cards and separately approved enabling actions.

## 8. Block 3 rerun update (spec r3)

The update was made on 2026-10-22. The repository side is in commits `6961900` to `9470f99`: 18 cards at r3 and the 08 index corrections, with the review record in 08 §H "r3 record".

**Notion schema:** the option "Ready for Approval (r3)" was added to Spec Readiness.

**Notion cards** (007, 008, 011, 013, 015–018, 021, 023, 027–034):
- the body was replaced with the r3 card (`notion-handoff/card__TASK-*.md`);
- Spec Readiness was set to "Ready for Approval (r3)";
- Specification Revision was set to `r3 · sha256 <prefix>`, with Evidence Revision and Approval Scope updated;
- Approval was returned to Pending Review by Claude, with a note in Decision Notes saying it was not done by Kyle;
- Dependencies were extended: 027 +006, 028 +011, 029 +008.

**Handoff page:**
- the status is now Complete;
- the approval state and counts show Pending Review 36, with r2 18 and r3 18;
- §6 now lists the resolved corrections and the r3 choices Kyle should confirm.

**Not done:**
- The §8.3 nits on the r2 cards (009, 010, 012, 022, 024, 026, 035) were not applied, so their r2 approval revisions stay stable.
- The Source Reports attachment of 08 remains the r2 version (295c89f). The current index is in the repository.

**Approvals recorded:** none.

**Board state observed after the update** (2026-10-22, about 18:45 UTC; read-only query):
- **10 cards Approved by Kyle**, recorded on the board through a separate session, with Kyle's words in Decision Notes:
  - TASK-001 to 006, 009 and 010 at r2;
  - TASK-007 and 008 at r3. Their approved SHA-256 values equal the committed r3 files (`4f7fab80…`, `3bf6b468…`), so those two card files must not change.
- **Follow-up cards** TASK-037 to 040 were created in that session as r1 drafts (Pending Review). TASK-040 is the `cargo fmt` task that TASK-029 waits on.
- **Claude** recorded no approval and changed none.


## 9. Currency pass and approvals (2026-10-22, later)

**Currency pass:**
- 10 pending cards were updated for the approved decisions: 013 r4, 014 r3, 017 r4, 025 r3, 027 r4, 028 r4, 029 r4, 031 r4, 034 r4 and 036 r3.
- Repository specs were written for TASK-037 to 040 (r1).
- TASK-041 (r1) was split from TASK-037 after a review found value-only copies of real export rows in tests, fixtures and mockups.
- Two independent reviewers plus a re-check returned READY.
- A privacy scan of `code-review/` found no real export values.
- The board was updated and the TASK-041 page created: https://app.notion.com/p/4011bd4b6bde81f6877ae85e49be27bf

**Approvals by Kyle** (recorded on the board through his separate session):
- 25 cards are approved: 001–022 except 023, plus 024, 025 and 026.
- Every approved SHA-256 equals the committed card file (checked by script). **These 25 card files must not be edited.**
- Owner amendments (009, 016, 017, 021) are recorded only in the board's Decision Notes.

**Still Pending Review:** 023, 027–041.

## 10. Approved-task audit fixes (2026-10-22 to 23)

**Source.** A separate audit session reviewed the 25 approved cards. Its report is `code-review/stage2-approved-task-audit-2026-10-22.md` on branch `claude/zen-albattani-bg7wk3`, commit `d3c8c60`.

**Kyle's decisions in this session:**
- Revised approved cards go back to Pending Review.
- TASK-009 fees: a V1 migration, delivered by a new task.
- TASK-007 D5: accept the shared classes and close it.
- TASK-024: widen the scope and fix the wording.

**Cards revised and moved back to Pending Review (13):** 004 r3, 007 r4, 009 r3, 014 r4, 015 r4, 016 r4, 017 r5, 018 r4, 021 r4, 022 r4, 024 r4, 025 r4, 026 r4. Their Notion-only owner amendments (016, 017, 021) are now folded into the card text.

**Pending cards aligned:** 028 r5, 029 r6, 030 r4, 031 r5, 036 r4.

**New cards:**
- TASK-042: fees-recorded flag migration.
- TASK-043: B2-1 rollback fix.
- TASK-044: retention disclosure.

**Review.** Three independent reviewers plus a re-check: all READY.

**Board changes:**
- 18 pages updated and 3 pages created.
- The 13 cards above were set to Pending Review. Approved By, Approved At and Approved Specification Revision are kept as history.
- Dependencies: 025 → [001, 006]; 026 → [006, 027].
- New Spec Readiness options r5 and r6.

**Still Approved on the board (12):** 001, 002, 003, 005, 006, 008, 010, 011, 012, 013, 019, 020. Their hashes are unchanged.

**Not done:**
- Merging `code-review/` to main: this needs a PR, which Kyle has not asked for.
- Roadmap Triage cards proposed by the cards (TASK-022 account-switch remount, TASK-009 dedup docs and network-path enforcement, TASK-018 out-of-scope paths).
- Runbook 10 §9 and 09 waves are historical and not updated. The 08 index is current.

## 11. Board review and approvals (2026-10-22)

**Board review.** Every Pending Review and Deferred card was re-checked against main `92e7980`, which is still the evidence revision. All 44 card hashes matched their committed specs. Each card has a review comment on the board.

**Revisions (commits `db48258`, `a210808`; payloads `2be38ad`).** 23 cards were revised to fold in the review:
- 004 r4, 009 r4, 014 r5, 015 r5, 016 r5, 017 r6, 018 r5, 021 r5, 022 r5, 024 r5, 025 r5, 027 r6, 028 r6, 029 r7, 031 r6, 034 r5, 035 r4, 037 r2, 039 r2, 040 r3, 041 r2, 042 r2, 044 r2.
- The 08 index, 09 waves and 10 runbook were synced to match.

Two independent reviewers re-checked the revisions, and their blocking items were applied. The board pages were republished with the new bodies, properties and a comment each. A new Spec Readiness option, r7, was added.

**Approved by Kyle** in the board-review session, quoted exactly:
> Approve TASK-004 r4, TASK-014 r5, TASK-015 r5, TASK-016 r5, TASK-017 r6, TASK-018 r5, TASK-022 r5, TASK-024 r5, TASK-025 r5, TASK-026 r4, TASK-027 r6, TASK-028 r6, TASK-030 r4, TASK-031 r6, TASK-032 r3, TASK-033 r3, TASK-034 r5, TASK-035 r4, TASK-036 r4, TASK-037 r2, TASK-038 r1, TASK-043 r1, TASK-044 r2.

On the board, each of these 23 cards has:
- Approval set to Approved;
- Approved Specification Revision set to the full SHA-256 of the committed spec;
- Approved By and Approved At (2026-10-22) filled in;
- an Approval Scope;
- the quote above appended to its Decision Notes.

**These 23 card files must not be edited.**

**Approved in total (35):** 001, 002, 003, 004, 005, 006, 008, 010, 011, 012, 013, 014, 015, 016, 017, 018, 019, 020, 022, 024, 025, 026, 027, 028, 030, 031, 032, 033, 034, 035, 036, 037, 038, 043, 044.

**Still Pending Review (8)**, each waiting on an owner answer or acknowledgement:
- 007 r4 (D5 and the real-export import condition)
- 009 r4 (confirm decision 1)
- 021 r5 (Q1)
- 029 r7 (acknowledge the TASK-023 route)
- 039 r2 (Git-history disposition)
- 040 r3 (PR #107)
- 041 r2 (ruling A or B)
- 042 r2 (TASK-009 r4 plus four rules)

**Deferred:** 023 r3. TASK-011(a) must also record Alt+F4; this is an execution note, and 011 is unchanged.
