# Aggregate-Only Historical Verification

Verification files only. No application/runtime changes, migration, import, mapping save or deployment required. Run in the existing authorized production environment; never download source rows or credentials to another machine.

## Before And After The Fifth Approval

Run `historical-approval-preservation.sql` in the established production SQL viewer before saving the fifth approval, and again afterward. It is one aggregate-only SELECT. Require `scope_ready=true`, first-four count 4, the same `first_four_full_event_fingerprint`, original-four historical bindings 0, and after-save count/distinct revisions 5 with fifth historical binding 1. An after-only fingerprint is not proof against an absent baseline. Preserve the existing full-event/source fingerprints separately.

## Combined-Reader Aggregate Replay

The wrapper reuses the existing `readOnlyInput` connection path: repeatable-read READ ONLY transaction, explicit read-only setting verified, bounded full input without truncation, SELECTs only, awaited ROLLBACK even on failure. Raw rows remain in process memory in production. Only explicit numbers, dates, booleans, fixed basis strings and anonymous ordinal slots leave the process. Client keys, provider names, source IDs/hashes, approvals/notes and account scope do not appear in the output. Errors expose no database or source details.

Use the existing process's configured database and exact practice scope, without printing their values. `EMC_PRACTICE_ID` must resolve to the same effective scoped identity the existing app uses; no cross-scope/default guessing. Fetch the diagnostic commit and its existing reviewed runtime ancestry so `046a8e7` is available for the source guard. Copy/cherry-pick only the verification-file commit into the working production checkout; do not deploy or alter runtime files for this check.

```sh
AUDIT_AS_OF=2026-10-16 AUDIT_WINDOW_START=2025-07-01 AUDIT_WINDOW_END=2026-10-12 node verification/historical-production-audit.mjs --ack-existing-db-read-only
```

Output includes all 16 selected monthly windows (quiet proved months zero, otherwise unknown), whole-practice reported charges, accepted-charge/duplicate counts, anonymous contributions for the three exact registered historical labels, source input/reference/admitted counts, late-cancellation counts, five-approval binding/applied/stale counts, current-team coverage cutoff, and separate October 10/11/12 and October 8-12 windows. Provider slots sort by normalized exact registry label: for this confirmed three-person registry, Jordan, Sara, Sarah. No provider labels are printed.

After the authorized normal-UI saves, expect six retained sources (three per kind), the latest input sizes 4823/3681, 47 new subtype rows, three historical identities, five stored approvals, no stale approval cases, no unknown providers or unconfirmed source rows, and current-team through-date October 7. These are gates to check, not values fabricated or forced by this diagnostic. October 8-12 report-date fees can be known while operating-period completeness remains false; October 8-21 is not completed. October 2026 is explicitly a partial selected calendar month. No extrapolation, cash, pay, expense or profit certification is performed.

This is same-reader reconciliation replay, independently reviewed/tested against synthetic arithmetic, not an independent real-report financial audit. Compare its aggregates to the rendered UI and approved source/reference inventory. A reported mismatch remains a blocker, never a reason to adjust stored facts to match an expected answer.

## Local Evidence

`node --test verification/historical-production-audit.test.mjs` passes four controls covering independent monthly/contribution arithmetic, five pinned approvals, cross-export deduplication, October cutoff, frozen/unknown/stale withholding, no input mutation, scope/metadata privacy and CLI error privacy. Disposable PostgreSQL verification also passed first-four fingerprint equality across a synthetic fifth append and multi-scope withholding. No production data was read locally.
