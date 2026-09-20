---
name: API server dev build
description: The api-server dev script runs esbuild first; stale dist causes missing routes with silent 404s
---

The api-server `dev` script is: `export NODE_ENV=development && pnpm run build && pnpm run start`

It compiles with esbuild (build.mjs) then runs the dist. If the dist is stale or missing route files, the server starts but all non-health endpoints return 404 with 0ms response time (route never registered).

**Why:** esbuild bundles everything into dist/index.mjs. If the build step was skipped or failed silently in a previous run, the old bundle doesn't include new routes.

**How to apply:** When routes are missing (404 with 0ms), run `pnpm --filter @workspace/api-server run build` manually, verify route strings appear in dist/index.mjs with grep, then `restart_workflow`.
