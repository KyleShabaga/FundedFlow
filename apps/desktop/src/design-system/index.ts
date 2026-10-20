// FundedFlow design system: tokens, bundled fonts, components and display
// formatting. Import from "../design-system" (or the relative path to this
// folder); see docs/design-system.md.

// Fonts are bundled so the app works offline (no Google Fonts request).
import "@fontsource-variable/inter";
import "@fontsource/space-grotesk/500.css";
import "@fontsource/space-grotesk/600.css";
import "@fontsource/jetbrains-mono/500.css";
import "@fontsource/jetbrains-mono/600.css";

import "./tokens.css";
import "./design-system.css";

export * from "./format";
export * from "./components/primitives";
export * from "./components/rules";
export * from "./components/charts";
export * from "./components/journal";
