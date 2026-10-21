# FundedFlow brand mark

The FundedFlow mark is a swept, forward-leaning F in the design system's `flow` blues. The design canvas
(Design artifact "FundedFlow Logo Concepts") holds the mark, its lockups and the wordmark explorations.

## Files

| File | Use |
| --- | --- |
| `fundedflow-logo.svg` | Full logo (mark + "FundedFlow") for dark grounds: "Funded" in `ink` #e9eef8, "Flow" in `flow` #5b9dff. |
| `fundedflow-logo-light.svg` | Full logo for light grounds: "Funded" in #0d1526, "Flow" in #1a5fd0. |
| `fundedflow-logo-mono.svg` | Full logo in one colour (`currentColor`). |
| `png/fundedflow-logo[-light]-<width>.png` | Full logo rasters, 1280 and 2560 px wide, transparent. |
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

Inside the app, use the design-system components instead of these files: `BrandMark` and `BrandLogo` in
`apps/desktop/src/design-system/components/brand.tsx` draw the same outline and take the gradient from the
`brand-mark-start`/`brand-mark-end` tokens, so they follow the theme (see `docs/design-system.md`).

## Using the mark

- Keep clear space around the mark of at least a quarter of its height.
- Minimum size: 16 px for the app icon, 20 px tall for the bare mark.
- Use the dark-ground file on `bg-000` / `bg-100`, the light file on white or `bg-000` light. Don't recolour the
  gradient, rotate, stretch or add effects.
- The wordmark is "FundedFlow" in Space Grotesk 600 with −0.5 px tracking at 42 px, "Flow" in the `flow` blue.
  The mark is 52/42 of the type size tall, centred on the cap height, with a 14/42 gap. In the logo SVGs the
  letters are outlines, so they render the same without the font installed. Prefer the SVGs; use the PNGs only
  where SVG is not accepted.
