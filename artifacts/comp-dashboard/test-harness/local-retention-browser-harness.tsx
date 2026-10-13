import React from "react";
import { createRoot } from "react-dom/client";
import LocalRetentionWorkspace from "../src/components/practice/local-retention-workspace";

const root = document.getElementById("root");
if (!root) throw new Error("Missing root element.");

createRoot(root).render(
  <React.StrictMode>
    <LocalRetentionWorkspace />
  </React.StrictMode>,
);
