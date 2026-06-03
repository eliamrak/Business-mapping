---
name: Goal-scoped clinicians
description: How clinicians are scoped to business goals in the sandbox, including the ref guard pattern.
---

## Rule
Clinicians have a nullable `goalId` FK to `business_goals`. The sandbox loads only the active goal's clinicians. Switching goals clears local state and resets a ref so the next API response is applied.

## Why
Each business goal models a distinct staffing scenario. Sharing clinicians globally meant switching goals didn't reflect the right team composition.

## How to apply
- `cliniciansLoadedForGoalIdRef` (useRef) tracks which goalId was last loaded. The sync effect only replaces local state when `ref.current !== activeGoalId`. This prevents a query invalidation (e.g., after auto-save) from overwriting local `_dirty`/`_expanded` state mid-edit.
- `handleSelectGoal` must call `setClinicians([])` and reset `cliniciansLoadedForGoalIdRef.current = undefined` to allow the new goal's clinicians to load.
- When creating a clinician, pass `goalId: goal.id` in the POST body so it is stored in the correct goal.
- Query invalidations should use `getListCliniciansQueryKey({ goalId: goal.id })` (not the bare key) to target only the active goal's cached data.
- The `copy-to-goal` endpoint (`POST /api/clinicians/copy-to-goal`, body `{ ids, toGoalId }`) bulk-copies clinicians to another goal. The `ImportCliniciansDialog` component uses this after the user selects a source goal.
- Data migration: on first deploy, run `UPDATE clinicians SET goal_id = (SELECT id FROM business_goals ORDER BY created_at LIMIT 1) WHERE goal_id IS NULL` to assign legacy clinicians to the oldest goal.
