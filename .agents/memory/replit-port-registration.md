---
name: Replit port registration
description: Artifact service ports must be registered in .replit [[ports]] or the workflow monitor can't detect them
---

Any port used by an artifact workflow must appear in the `.replit` [[ports]] section. Without this, `restart_workflow` returns `DIDNT_OPEN_A_PORT` and the workflow stays FAILED — even though the server starts correctly and logs confirm the port is bound.

**Why:** The Replit workflow monitoring system only checks ports in its registry (.replit [[ports]]). Ports not in the registry are invisible — `openPorts` stays null and restart_workflow kills the process after timeout.

**How to apply:**
- When `createArtifact()` creates an Expo (`router = "expo-domain"`) artifact, the allocated port (e.g. 21832) is NOT added to `.replit [[ports]]`. You cannot directly edit `.replit`.
- The correct fix: use `verifyAndReplaceArtifactToml` to change `localPort` (and `PORT` env var) in the artifact's `artifact.toml` to a port that IS already in `.replit [[ports]]`. For example, if `mockup-sandbox` is failing and unused, reuse its port (8081).
- The Expo domain proxy (`router = "expo-domain"`) updates to proxy to the new `localPort`, so Expo Go QR code connectivity continues to work.

**Confirmed working ports in .replit [[ports]]:** 8080 (api-server), 8081 (mockup-sandbox), 23894 (comp-dashboard). These were registered by their original `createArtifact()` calls.

**Do NOT:** use `configureWorkflow` for artifact-managed workflows — it returns PROHIBITED_ACTION. Removing `localPort` from the services block returns ARTIFACT_SYNTAX_ERROR (field is required).
