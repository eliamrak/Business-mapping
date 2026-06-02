---
name: Replit port registration
description: Artifact service ports must be registered in .replit [[ports]] or the workflow monitor can't detect them
---

Any port used by an artifact workflow must appear in the `.replit` [[ports]] section. Without this, `restart_workflow` returns `DIDNT_OPEN_A_PORT` and the workflow stays FAILED — even though the server starts correctly and curl works.

**Why:** The Replit workflow monitoring system checks a port registry, not `/proc/net/tcp` directly. Ports not in the registry are invisible to the monitor.

**How to apply:** When a new artifact is created via `createArtifact()`, its allocated port is NOT automatically added to `.replit [[ports]]`. Use `verifyAndReplaceDotReplit` (code_execution callback) to add the entry — direct edits to `.replit` are blocked.

Example fix:
```toml
[[ports]]
localPort = 23894
externalPort = 23894
```

The `externalPort` value matters less than having the entry present.
