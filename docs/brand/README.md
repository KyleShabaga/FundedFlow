# FundedFlow brand mark

The FundedFlow mark is a swept, forward-leaning F in the design system's `flow` blues. The design canvas
(Design artifact "FundedFlow Logo Concepts") holds the mark, its lockups and the wordmark explorations.

## Files

| File | Use |
| --- | --- |
| `fundedflow-mark.svg` | The mark for dark grounds (`bg-000`, `bg-100`). Gradient `flow` #5b9dff → `flow-fill` #2563eb. |
| `fundedflow-mark-light.svg` | The mark for light grounds. Deeper gradient #2f74e6 → #1a4fb0. |
| `fundedflow-mark-mono.svg` | One colour, `fill="currentColor"`; set the colour with CSS `color`. For single-ink uses. |
| `fundedflow-app-icon.svg` | 1024 px app icon: the mark on a rounded `#121b2f` tile. Master for every raster icon. |
| `fundedflow-app-icon-square.svg` | The same icon without rounded corners, for platforms that mask icons themselves. |
| `png/fundedflow-app-icon-<size>.png` | App icon rasters at 16, 32, 48, 64, 128, 256, 512 and 1024 px. |
| `png/fundedflow-mark.png`, `png/fundedflow-mark-light.png` | Transparent mark rasters, 1060 × 836. |
| `favicon.ico` | 16, 32 and 48 px icon for any web surface. |

The desktop bundle icons in `apps/desktop/src-tauri/icons/` (PNG sizes, `icon.ico`, `icon.icns`) are rendered
from `fundedflow-app-icon.svg`. Regenerate them from that file when the mark changes; with the Tauri CLI
installed, `npx tauri icon docs/brand/png/fundedflow-app-icon-1024.png` produces the full set.

## Using the mark

- Keep clear space around the mark of at least a quarter of its height.
- Minimum size: 16 px for the app icon, 20 px tall for the bare mark.
- Use the dark-ground file on `bg-000` / `bg-100`, the light file on white or `bg-000` light. Don't recolour the
  gradient, rotate, stretch or add effects.
- The wordmark is "FundedFlow" in Space Grotesk 600, set beside the mark with a gap of about a quarter of the
  mark's height. The final wordmark treatment is still being chosen on the design canvas.
