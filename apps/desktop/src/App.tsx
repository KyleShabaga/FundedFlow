import { useState } from "react";

import "./App.css";
import { DataModelPanel } from "./components/DataModelPanel";
import { RuntimeGate } from "./components/RuntimeGate";
import { DesignSystemGallery } from "./design-system/DesignSystemGallery";

type View = "data" | "design";

function App() {
  const [view, setView] = useState<View>("data");
  return (
    <>
      <nav className="app-views" aria-label="Developer views">
        <button type="button" aria-pressed={view === "data"} onClick={() => setView("data")}>
          Data model
        </button>
        <button type="button" aria-pressed={view === "design"} onClick={() => setView("design")}>
          Design system
        </button>
      </nav>
      {view === "design" ? (
        <DesignSystemGallery />
      ) : (
        <main className="container">
          <h1>FundedFlow</h1>
          <RuntimeGate>
            <DataModelPanel />
          </RuntimeGate>
        </main>
      )}
    </>
  );
}

export default App;
