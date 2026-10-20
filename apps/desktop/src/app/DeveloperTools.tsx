import { useState } from "react";
import { Link } from "react-router-dom";

import { DataModelPanel } from "../components/DataModelPanel";
import { RuntimeGate } from "../components/RuntimeGate";
import { Button } from "../design-system";
import { DesignSystemGallery } from "../design-system/DesignSystemGallery";

/** Development-only tooling; never loaded by the production root. */
export default function DeveloperTools() {
  const [view, setView] = useState<"data" | "design">("design");
  return (
    <section aria-label="Developer tools">
      <h2>Developer tools</h2>
      <Link to="/">Return to app</Link>
      <nav className="ds-row" aria-label="Developer views">
        <Button aria-pressed={view === "design"} onClick={() => setView("design")}>Design system</Button>
        <Button aria-pressed={view === "data"} onClick={() => setView("data")}>Data model</Button>
      </nav>
      {view === "design" ? <DesignSystemGallery /> : <RuntimeGate showStatus={false}><DataModelPanel /></RuntimeGate>}
    </section>
  );
}
