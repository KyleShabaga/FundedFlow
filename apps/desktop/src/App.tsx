import "./App.css";
import { DataModelPanel } from "./components/DataModelPanel";
import { RuntimeGate } from "./components/RuntimeGate";

function App() {
  return (
    <main className="container">
      <h1>FundedFlow</h1>
      <RuntimeGate>
        <DataModelPanel />
      </RuntimeGate>
    </main>
  );
}

export default App;
