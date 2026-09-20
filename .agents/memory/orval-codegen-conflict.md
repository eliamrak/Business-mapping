---
name: Orval codegen re-export conflict
description: Why api-zod/src/index.ts must not re-export the generated types barrel.
---

## Rule
`lib/api-zod/src/index.ts` must only export from `./generated/api`, never from `./generated/types`.

## Why
Orval v8 in `split` mode generates both:
1. `generated/api.ts` — Zod schema consts (e.g. `export const CopyClinicianToGoalBody = zod.object(...)`)
2. `generated/types/*.ts` — TypeScript types with the same name (e.g. `export type CopyClinicianToGoalBody = {...}`)

Re-exporting both with `export *` causes TS2308 ("already exported a member named X"). Even `export type *` does not resolve it in TS 5.x. The Zod const schemas are sufficient — downstream consumers only use the Zod schemas from this package (e.g. `health.ts` imports `HealthCheckResponse`).

## How to apply
After every Orval codegen run that adds a new request-body type, verify `lib/api-zod/src/index.ts` is still just `export * from "./generated/api";`. If the types barrel was re-added, remove it.
