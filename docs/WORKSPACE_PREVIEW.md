# Practice Workspace Preview

Local route: /workspace. This is an additive UI preview, not a deployment or
replacement for the existing compensation, session, and hub routes.

## Organization

- My Practice: existing clinician records and pay structures, sessions,
  marketing, rooms, budgets, money flow, and a small estimated summary.
- Routine updates belong to these sections. There is no standalone updates
  destination in the primary navigation.
- Sandbox: the same sections operating on an isolated working copy. Multiple
  edits can be layered across sections, with a shared forecast comparison.
- Goals: named, dated snapshots saved from Sandbox without approving events or
  rewriting My Practice. Each snapshot retains its own team and forecast range.
- Clinician card session counts are desired weekly sessions. Summary projections
  can start from recent recorded sessions, the combined desired sessions, or a
  custom weekly pace.
- Selecting a saved goal adds a pace view for sessions, revenue, or profit. It
  shows recorded-versus-goal variance, the monthly increase needed to stay on
  time, and a revised finish date when the recent trend supports one.

## Data Boundaries

Clinicians use the original API and calculation helper. The workspace retains
existing supplementary settings, budgets, and operational records.
Historical session edits use the existing revision-checked, audited endpoint.
Session details must still reconcile when a completed count is corrected.

Saved goals use the existing proposal record with a versioned baseline payload
(`practice-goal-v1`). They are not event approvals. Snapshot context omits
presenter tokens and API metadata, and omits other saved goals to prevent
recursive growth. Existing proposals and numeric targets remain untouched.
Sandbox copies live in memory until saved; leaving the page warns about edits.

## Verification

- Unit coverage: isolated layered edits, goal round trips, nonrecursive saves,
  stripped access tokens, rejected malformed snapshots, separate time horizons.
- Existing compensation parity coverage remains part of the full test suite.
- Local browser checks: navigation, inline session writes, sandbox changes,
  goal save/reload/reopen, preserved practice values, desktop and phone layout.
- Advanced editors and original routes remain available. This pass does not
  claim to redesign every advanced form or replace the old approval workflow.

## Before Deployment

This checkout predates the five Replit Clerk commits currently on origin/main.
Integrate the new route into the authenticated upstream App without replacing
Clerk. No authentication, production data, dependency, or database schema
changes are part of this preview. Publishing requires a separate approval and
an authenticated integration test.
