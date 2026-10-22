# Insights closed-trade P&L chart width: before/after

`EquityCurve` (design system) reserved 64/640 = 10 % of its width as a label gutter, even with no floor or target
labels, so the Insights closed-trade P&L line stopped short of its card and the gap grew with the frame. After, the
plot spans the card; the floor/target labels (gallery and account charts) keep a fixed 64 px gutter only when shown.

Captured in the in-app browser (CSS viewports, 1× DPR, dark theme, scaled to 800 px wide) from a temporary harness
that renders the real `AppFrame`, `ContentFrame`, `ChartPanel` and `EquityCurve` with 59 synthetic points; the native
dev app was not used because another session held its fixed dev port. Before = `main` `773f522`; after = this branch.

Measured right edges in CSS px (top chart: line end vs. the chart's content edge):

| Viewport | Before: line … edge | After: line … edge | Labelled chart after: line … edge (gutter) |
|---|---|---|---|
| 1024 | 894 … 960 (66 short) | 960 … 960 | 896 … 960 (64) |
| 1440 | 1262 … 1368 (106 short) | 1368 … 1368 | 1304 … 1368 (64) |
| 1920 (frame at its 1600 px cap) | 1694 … 1848 (154 short) | 1848 … 1848 | 1784 … 1848 (64) |
