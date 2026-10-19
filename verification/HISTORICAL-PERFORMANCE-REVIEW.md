# Historical Performance Review Fixes

The two independent-review reproductions from `/tmp/recovered-history-review.mts`
are permanent tests in `artifacts/comp-dashboard/src/lib/historical-performance.test.ts`.
Both failed before the fix and passed afterward.

## Separate Calendar, Follow-up, and Coverage

- `calendarSnapshots` supplies original report dates before canonical service-period
  admission. It anchors the three complete calendar months or trailing year and
  cannot supply visits, retention successes, consultation conversions, or coverage.
- `window.asOf` is true `today`. Known excluded follow-up through that date can
  block an absence inference even after the last admitted service period.
- `snapshots` and `consultSnapshots` remain the admitted performance evidence.
  Existing report coverage and maturity checks remain in force. The displayed
  ending observation cutoff comes from the admitted activity calculation.
- The page passes original local source snapshots in the existing historical hook.
  No selected pay/activity dates participate in historical range selection.

## Reproductions

1. An original report through September 30, 2026 admits canonical periods only
   through September 23. The historical quarter stays July 1-September 30;
   the year stays October 1, 2025-September 30, 2026. Neither becomes June-August.
2. Coverage admitted through October 7 excludes a known October 10 return.
   With true today October 19, that excluded follow-up suppresses the false June
   ending in both practice and clinician results. Its affected month is excluded
   from the verified monthly denominator. The return does not become an admitted
   positive visit or extend maturity: the ending cutoff remains July 9.
   Evidence dated October 20 remains future evidence and does not suppress it.

The original temporary review script intentionally asserts the old bugs and is
left unchanged. Run the corrected permanent reproductions with:

```sh
node --test artifacts/comp-dashboard/src/lib/historical-performance.test.ts
```

## Re-review: Selected Team Calendar Scope

The page now supplies `calendarScope` in the historical hook: the full identity
roster, selected team ID, and existing import declarations. Original report
ownership is resolved with the same `resolveImportedProvider` function used by
source admission, including confirmed scoped crosswalks and ambiguity rejection.
Reports qualify through a resolved row provider or explicit `coverageClinicians`;
quiet covered sources are preserved. Their original date bounds remain unchanged.

Permanent regressions verify that adding an unrelated team's October 14 report
does not change the selected team's August 31 anchor or June-August window.
They also cover quiet sources, scoped aliases, and ambiguous copied identities.
Calendar evidence still cannot add visits, conversion credit, or verified coverage.
Page edits for this fix are confined to the historical hook and its dependencies.
