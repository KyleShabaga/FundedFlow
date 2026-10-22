# P0-D07 before/after screenshots

Captured in the in-app browser pane at a 1280 × 800 CSS viewport (emulated, `devicePixelRatio` 1, saved downscaled to
800 × 500). The pane ran the real app (routes, providers, design system, the Import Wizard and Quick import pages) on
the frontend test store (`src/test/app-store.ts`, one synthetic account "Eval A") in place of the Tauri bridge, the
same seam the journey tests use. It was not the native WebView2 build, and Windows DPI scaling other than 100% was
not tested here. Before = `main` at `773f522`; after = `feat/p0-d07-import-wizard-nav`. The focus ring on the page
title is the shell's existing focus-after-navigation behaviour, in both.

| File | Shows |
|---|---|
| `before-accounts-1280-{dark,light}.jpg` | Sidebar ends at Accounts; header Import is text-only (ghost) and opens a menu |
| `after-accounts-1280-{dark,light}.jpg` | Import Wizard below Accounts; Quick Import as a bordered secondary button with a lightning icon |
| `after-accounts-1280-light-collapsed.jpg` | Icon rail: Import Wizard keeps its icon slot below Accounts |
| `after-import-wizard-1280-dark.jpg` | `/import`: Import Wizard is the active item; the wizard is unchanged |
| `after-quick-import-1280-dark.jpg` | `/import/quick`: no sidebar item is active; Quick import is unchanged |
| `after-today-1280-dark-quick-import-focus.jpg` | Keyboard focus (Tab from the account selector) on Quick Import |
