# 15 Settings: your data (export, restore, delete)

Card: [Build 25 — data-control screens](https://app.notion.com/p/3fe1bd4b6bde812fab6de667a70e2e59). Backend: Build 24
([handoff](../../handoffs/build-24-data-controls.md)). Code: `apps/desktop/src/features/data-controls`.

The Settings page (sidebar **Settings**) opens on this page. Mockups: [`mockups/p0/`](../mockups/p0/) boards 3A–3E
(P0 design, Build 25.1; see the section at the end). It uses design-system parts only.

## Layout

One column, max 960 px. (NA-3 removed the static local-only notice that opened the
page; its wording now lives once, in the **Privacy & legal** section.) Five `FormSection`s:

1. **Your data on this computer**: a `StatList` saying the journal is stored in FundedFlow's app-data folder for the
   Windows user; that the only automatic copy is the one FundedFlow saves in the same folder **before upgrading the
   journal's format**, which is not a substitute for exporting a full backup; that backups are **not encrypted**; and
   the last user-initiated export (kind, scope, local time, size). No path is shown.
2. **Export**: `RadioGroup` Full backup (`.ffj.zip`, restorable) vs Trade CSV (not a backup); for CSV a `Select`
   of All accounts or one account (archived ones marked); the plaintext `Checkbox`; one primary button
   "Choose location and export…" that opens the native save dialog. Success shows the file name, size and SHA-256.
   P0-D20: one column (max 820 px) in this order: the two formats as `RadioGroup cards` (side by side when each has
   280 px, else stacked), the CSV account choice, the acknowledgement in its own inset box, then the button with its
   error or success notice directly beneath it.
3. **Restore from a full backup**: "Choose backup to restore…" opens the native open dialog, then the restore
   dialog.
4. **Delete data permanently**: a bordered danger area with two rows, each with its own button:
   *Delete one trading account* (account `Select` with status and archived state) and *Erase the entire local
   journal*.
5. **Privacy & legal** (NA-3, [16 First run](16-first-run.md)): the privacy summary, a draft notice while the documents
   are drafts, a `StatList` of each document's version and date and when this install accepted them, each document
   in a `Disclosure` (`DocumentView`), and the licence summary with third-party notices (Build 26.78, see
   [16 First run → Licence and third-party notices](16-first-run.md#licence-and-third-party-notices)).

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

### Accepted V1 limitations (P0-17, 2026-10-21)

- No data-folder path; the page describes the location without one.
- No pre-export size estimate.
- No per-account restore status; the archive manifest has counts and account IDs only, so the preview states
  that accounts are restored exactly as saved without listing which are failed or archived.
- No export history; only the last export is stored and shown.

The UI must not fabricate any of these facts.

Other retained gap:

- The account deletion preview lists linked attempts by ID only (no name lookup across a pending deletion).

## P0 design (Build 25.1)

Boards in [`mockups/p0/`](../mockups/p0/). They redraw the page Build 25 ships and give Settings room to grow; no
command is added.

| Board | Shows | States on the board |
|---|---|---|
| 3A–B `Settings` | Section navigation, local-only notice, Your data on this computer, Export, Restore, Delete data, reserved section | No export yet, exporting (every data action disabled), saved (name, size, SHA-256), failed |
| 3C `SettingsRestore` | Restore dialog | Checking, rejected (newer version, damaged, not a backup, no space), validated with typed phrase, installing, restored, didn't finish (recovery banner takes over) |
| 3D `SettingsDelete` | Archive vs delete vs erase comparison, deletion dialog | Preview loading, delete account, blocked (archive instead), erase journal, cleanup pending, deleted |
| 3E `NarrowSettings` | 720 px window | Section links become a scrolling row; option cards stack; dialogs full width |

### Decisions
- **Expandable structure.** A left section list (220 px): *Your data* (On this computer, Export, Restore, Delete
  data), *App* (Appearance, Notifications: shown dimmed with a "Planned" badge and `aria-disabled`, linking to a
  dashed "Reserved for later preferences" note; they are design concepts, not settings), *Development builds*
  (Developer tools). New preferences become new groups; nothing else on the page moves.
- **Export kind** is two option cards. Full backup says it is "the only file Restore accepts"; Trade CSV says, in bold,
  "It can't be restored and isn't a backup." The account select appears only for CSV. The export button stays
  disabled (with its reason) until the "not encrypted" box is ticked.
- **Export history**: only the last export is shown, because only the last export is stored. A history list is a
  limitation accepted for V1; see the P0-17 list above.
- **Danger zone**: one loss-outlined area with two rows, each naming its scope. Destructive buttons are loss outlines,
  never filled red, and they open dialogs; nothing destructive happens on the page.
- **Archive vs delete vs erase** have different titles, button words and phrases (see the comparison on 3D). Archive is
  offered first in Accounts menus; deletion is last; erase is only in Settings.
- **Typed confirmation**: the phrase is shown in a mono chip, the field is never prefilled, the button is disabled until
  it matches exactly, a mismatch says "This doesn't match yet.", and Cancel holds the initial focus.
- **Restore** shows the archive facts and a two-column count table (in the archive · replaced in this journal), the
  "come back exactly as archived" note and the three "Before you replace" bullets, then the phrase. While installing,
  the dialog can't be dismissed and shows no percentage.

### Keyboard and narrow windows
- Section links are in-page anchors; the current section carries `aria-current`. Dialogs trap focus; Escape closes
  except while running.
- Mockup proposal (section list as a scrolling row in narrow windows); any breakpoint follows
  [window-support.md](../window-support.md) (P0-D29). Settings content is capped at 960 px and starts on the content
  frame's left edge.

### Changes proposed for the built screen (UI only)
1. Settings section navigation and the reserved "App" group.
2. Option cards for export kind (RadioGroup cards layout).
3. The archive / delete / erase comparison as help text on the deletion section.

### Gaps (unchanged)
See **Accepted V1 limitations (P0-17, 2026-10-21)** above for the folder path, pre-export size estimate,
per-account restore status and export history; these are accepted V1 limits.
