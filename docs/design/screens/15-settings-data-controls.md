# 15 Settings: your data (export, restore, delete)

Card: [Build 25 — data-control screens](https://app.notion.com/p/3fe1bd4b6bde812fab6de667a70e2e59). Backend: Build 24
([handoff](../../handoffs/build-24-data-controls.md)). Code: `apps/desktop/src/features/data-controls`.

The Settings page (sidebar **Settings**) opens on this page. There is no mockup; it uses design-system parts only.

## Layout

One column, max 960 px, four `FormSection`s:

1. **Your data on this computer**: a `StatList` saying the journal is stored in FundedFlow's app-data folder for the
   Windows user, that there are **no automatic backups**, that backups are **not encrypted**, and the last
   user-initiated export (kind, scope, local time, size). No path is shown.
2. **Export**: `RadioGroup` Full backup (`.ffj.zip`, restorable) vs Trade CSV (not a backup); for CSV a `Select`
   of All accounts or one account (archived ones marked); the plaintext `Checkbox`; one primary button
   "Choose location and export…" that opens the native save dialog. Success shows the file name, size and SHA-256.
3. **Restore from a full backup**: "Choose backup to restore…" opens the native open dialog, then the restore
   dialog.
4. **Delete data permanently**: a bordered danger area with two rows, each with its own button:
   *Delete one trading account* (account `Select` with status and archived state) and *Erase the entire local
   journal*.

The Accounts row and detail menus also offer **Delete permanently…** after **Archive…** (and after **Restore from
archive** for archived accounts). It opens the same deletion dialog.

## Restore dialog

`DestructiveActionDialog` (lg). States:

- *Checking*: loading while Rust inspects the file. The live journal is not touched.
- *Rejected*: error notice with the plain-language reason for the Build 24 code; "Check again"; no replace button.
- *Validated*: verified notice; archive details (created, producer, format, journal version and whether it will be
  upgraded, protection "Not encrypted", screenshots and size, free space needed, archive SHA-256); counts **in the
  archive** beside counts **replaced in this journal**; account count with reset links, a note that status,
  archive state and provider numbers return as saved and newer attempts disappear; warnings. The user types
  `REPLACE ENTIRE JOURNAL` (never prefilled); the button stays disabled until it matches.
- *Installing*: after Rust stages the restore with a safety copy and closes the journal, the page calls the
  runtime retry, which installs it. Not dismissible.
- *Restored* only when the runtime is Ready again; *Didn't finish installing* when it is not (the recovery banner
  takes over; the original and safety copy are kept).

## Deletion dialog

Separate titles, descriptions, buttons and phrases for one account (`DELETE ACCOUNT <account id>`) and the
whole journal (`ERASE ENTIRE JOURNAL`). Account deletion names the account, its ID and current status/archived
state, then shows the native preview: blockers (each explained; no phrase field or delete button while blocked,
"Archive instead" from Accounts), linked attempts by ID and that they are kept, counts of what will be deleted,
attachment count and size, what stays (other attempts, shared data, user-exported files). Whole-journal erasure
adds FundedFlow's recovery copies. `cleanup_pending` shows a warning and "Retry file cleanup".

## Behaviour

- One data operation at a time across Settings and Accounts; every data button is disabled while one runs, and a
  second press is ignored. A status line says what is running. No percentages: Rust reports only the end state.
- Cancelling a file dialog does nothing. Errors never show native text, paths or rows.
- After restore or deletion every cached read is reset.
- Everything is offline; dialogs trap focus, Cancel comes before the action, and nothing is dismissible while it
  runs.

## Gaps (not faked)

- No command returns the local data folder path, so the page describes the location without one.
- The archive manifest has counts and account IDs but no per-account status, so the restore preview cannot list
  which included accounts are failed or archived; it states that they are restored exactly as saved.
- The account deletion preview lists linked attempts by ID only (no name lookup across a pending deletion).
