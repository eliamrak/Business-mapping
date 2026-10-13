import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import LocalRetentionWorkspace, {
  useLocalRetentionWorkspaceState,
} from "../src/components/practice/local-retention-workspace";
import "../src/index.css";

function NavigationHarness() {
  const [section, setSection] = useState<"sessions" | "retention">("retention");
  const localRetentionState = useLocalRetentionWorkspaceState();

  return (
    <main className="practice-theme" data-appearance="light">
      <nav className="pw-sections" aria-label="Practice sections">
        <button
          aria-current={section === "sessions" ? "page" : undefined}
          onClick={() => setSection("sessions")}
        >
          Sessions
        </button>
        <button
          aria-current={section === "retention" ? "page" : undefined}
          onClick={() => setSection("retention")}
        >
          Retention
        </button>
      </nav>
      {section === "sessions" ? (
        <section aria-label="Sessions placeholder">
          <h2>Sessions</h2>
          <p>Navigation placeholder for retention state regression.</p>
        </section>
      ) : (
        <LocalRetentionWorkspace workspaceState={localRetentionState} />
      )}
    </main>
  );
}

const root = document.getElementById("root");
if (!root) throw new Error("Root element missing");

createRoot(root).render(
  <React.StrictMode>
    <NavigationHarness />
  </React.StrictMode>,
);
