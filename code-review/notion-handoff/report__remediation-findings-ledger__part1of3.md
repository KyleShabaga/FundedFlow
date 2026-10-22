| Field | Value |
|---|---|
| Date | 2026-10-22 |
| HEAD | `bba845b` on `claude/practical-turing-wmii06`. The application source is identical to `92e7980`. |
| Inputs | Stage 1 reports `00`–`05` and `coverage-matrix.md` at `bba845b` |
| Companion | `06-stage2-evidence-reconciliation.md`, which holds the method, provenance, changes, contradictions and count reconciliation |
| Status | **Complete** |

## How to read this ledger

**Canonical IDs.** Each `ISSUE-nnn` is a stable canonical issue. On reruns, reuse these IDs and do not renumber.

**Original finding IDs.** Every Stage 1 finding ID appears exactly once as the canonical owner of an entry. Where Stage 1 named one finding as a duplicate of another, the ID appears again marked "dup→"; the counts in 06 §6 cover only the canonical owner.

**Consolidation IDs.** The `F-nn` / `O-01` consolidation IDs from report 05 are listed in each row for traceability.

**Source card and roadmap lane.** These come from the Stage 1 reconciliation register and the Final Push snapshot (2026-10-22). Where the snapshot assigns no card, the source card is the "Stage 1 audit" report and its date, and the roadmap lane is **Unassigned (owner)**. Audit severity and roadmap lane are separate fields.

**Verification status.** This is the status after the Block 1 recheck at `bba845b`:

| Status | Meaning |
|---|---|
| **C** | Confirmed |
| **PC** | Partially Confirmed. The proven subclaim and the unsupported part are given in "Trigger and impact" or "Needed verification". |
| **U** | Unverified |
| **AR** | Already Resolved |
| **NA** | Not Applicable |

**Abbreviations.** Paths under `src-tauri/` are relative to `apps/desktop/src-tauri/src/` unless written in full. `desktop/` means `apps/desktop/src/`.

