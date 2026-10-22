# P0-D12 before/after screenshots

Native Windows debug build (`tauri dev` on the isolated test journal, WebView2) with the synthetic UI Smoke preset
(`dev-test-journal.mjs seed --preset ui_smoke --seed 2609 --anchor 2026-10-20`), dark theme, Journal → Library →
Tags. Before = main `773f522`; after = `feat/p0-d12-tag-library-pills`. The window was sized so the WebView client
area equals each width; 100% scaling (`devicePixelRatio` 1). Menu and dialogs were driven with the keyboard
(Enter, arrows, Escape, Tab).

| File | Shows |
|---|---|
| `before-tags-1280.jpg` | Rename and Archive links on every tag row |
| `after-tags-1280.jpg`, `after-tags-860.jpg` | One pill per tag with "Used in n reviews" / "Not used yet" and its menu button; long names wrap inside the pill |
| `after-tags-menu-1280.jpg` | The menu opened from the keyboard: Rename…, Archive… |
| `after-tags-rename-1280.jpg` | The existing rename dialog, opened from the menu |
| `after-tags-archive-confirm-1280.jpg` | The archive confirmation, saying what it affects (focus on Cancel) |
| `after-tags-archived-shown-1280.jpg` | After archiving a test tag with "Show archived": the dashed pill with its Archived badge (it was then restored from its menu) |

Checked by hand on this build: Escape on the menu, Escape in Rename and Save in Rename each return focus to the
tag's menu button; after an archive hides the tag, focus goes to the first remaining tag in that category. Other
display scaling factors were not tested here.
