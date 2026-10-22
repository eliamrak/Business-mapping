# Quarterly recurring Budget support

Base: `46bffcf3dffd39733f62625a26896d65201533b8`.
Expected publisher: `7de1bdc8a843e75fd8b65ebb86a8f43dc5830a5d`,
tree `781a3e5c40ba6b1ebeedd5f40af34f566530e2b1`.

## Scope and semantics

- Add quarterly to the shared Budget schema and all four existing cadence selectors:
  generic record editor, Money Budget, the existing scenario list, and older Money flow.
- Amount means cost per calendar quarter. Accrual follows the existing calendar-day
  convention: one whole quarter accrues one amount; effective dates clip active days.
  A $900 Q1 2026 cost accrues January $310, February $280, March $310 (90 days).
  This is deliberately not a forced flat $300 monthly split or an immediate payment.
- Planned billing repeats every three calendar months from First bill reference,
  falling back to the record's effective start. Derive each due date from the original
  anchor, clamping only that occurrence: Jan31 -> Apr30 -> Jul31. Billing day metadata
  does not override the reference/start day for quarterly dates. Billing reference
  and billing day do not change calendar-quarter accrual.
- A quarterly-only collapsed disclosure names the Budget item, explains accrual and
  shows planned dates for the next 12 calendar months. The Money disclosure is outside
  the horizontally scrolling table and fits narrow viewports. The year-9999 display
  window is capped at the last supported date. No recorded payments are asserted.
- Existing Budget IDs, amounts, dates, categories and all seven old cadence branches
  are preserved. Nothing is converted, relabeled, seeded or migrated automatically.
  Taxes and processing assumptions, clinical metrics and visual proposals are unchanged.

## Existing-input equality

`node verification/quarterly-legacy-parity.mjs` imports a frozen Git archive of the exact
base and compares it with the candidate using identical synthetic inputs:

- 189 exact schema/serialization comparisons.
- 2,646 exact direct accrual comparisons.
- 2,646 exact month-partitioned range comparisons.
- 14 entire forecast objects, 14 category reports and 14 observed reports exactly equal.
- All seven old cadences; zero/nonzero amounts; varied active dates, archives, bill
  reference/day metadata, leap dates and cross-month/year queries; nonzero clinician
  sessions/revenue plus dated amount events. Input objects remain unchanged.

Final retained parity receipt: `/var/folders/v1/nrrw04y90g3b9s27scm3_f1r0000gn/T/practice-quarterly-parity-pa1UPi/results.json`.
No production reads/writes or business figures are used. This is exact old-input
equality, not certification of all real account data.

## Verification and independent review

Canonical pure regression command:

```sh
node --test lib/practice/test/*.test.ts artifacts/comp-dashboard/src/lib/*.test.ts verification/profit-first-planning-input.test.mjs
```

Focused quarterly coverage includes schema/workspace JSON roundtrip, quarterly sums,
daily/monthly partitions, effective-date clipping, leap-year and year-end boundaries,
anchor clamping, selected-month Money costs, marketing counted once, zero, unchanged
source records, ignored old scenario overrides, and empty financial-actual collections.
Final canonical run: 1,143 passed, zero failures/skips; `/tmp/practice-quarterly-tests.log`.
Includes 15 quarterly domain cases and 6 new Money planning cases, including dated
amount changes and planning-only launch/pause segments. Domain build, dashboard/API
typechecks, web and API builds pass; existing nonfatal Vite warnings remain.

Independent code/numeric review verified 1,500 comparisons against a separate daily
accrual oracle and 1,200 comparisons against independent daily billing enumeration.
It caught a missing fourth selector and a year-9999 UI horizon defect; both were repaired.
The shared engine's upper-year probes and the corrected display window pass. Final
review found no remaining source/numeric blockers and inspected the actual1280/320
schedule captures. Existing second-walkthrough browser regression:26/26 pass,
`/tmp/practice-oct21-live-call-mmEEVT/second-results.json`.

New browser harness: `node verification/october22-quarterly-budget-acceptance.mjs`.
Six checks pass: existing-record quarterly edit, mocked save/reload preserving every
unrelated field/ID, selected-month $310/$280 accrual, generic editor representation
without an unrelated write, and expanded disclosure at1280/390/320.
Receipt: `/tmp/practice-oct21-live-call-K47YXS/quarterly-results.json`.
Only mocked loopback `/api/hub` writes occur; imports/context are unchanged, no financial
actuals are created, and external requests/browser errors are empty.

The first renderer found the disclosure offscreen inside the existing wide table.
That failed result is retained at `/tmp/practice-oct21-live-call-HhKrxu`; placement was
repaired rather than relaxing its viewport checks. Existing Budget table horizontal
scrolling remains unchanged; no claim that every old table cell fits320px is made.

## Preserving release and backout

Use `verification/integrate-quarterly-budget.py` with the exact candidate/tree/patch
hash supplied in the handoff. It pins publisher identity, checks all affected Git and
working preimages, verifies the patch and complete staged tree, and creates a rollback
reference. Run canonical tests, domain build, dashboard/API typechecks and both artifact
builds; commit normally on the publisher. Preserve all publisher history, memory,
`.replit`, artifact contracts, injected public build configuration and all data.
Keep copy-development-database OFF. No SQL migration, seed or production record write
is required. Parent coordinates one publication and read-only postrelease acceptance.

The new reader is backward-compatible with all old records. An old reader is not
forward-compatible with a newly saved quarterly enum. Before any quarterly records
are saved, the old source reference is an ordinary source backout. After owner use,
retain quarterly schema/reader/calculation compatibility in any backout or forward-fix;
never downgrade, delete or convert business records merely to fit the old schema.

Live checks should verify source/assets/health, Quarterly choices in existing editors,
unchanged current estimates/import metadata, and planned-versus-recorded labeling.
Do not save a synthetic Budget or alter a real expense to demonstrate production
persistence. Native Mac/Safari/VoiceOver and owner acceptance remain separate limits.

Default public-input build (production injection may change JS):
JS `index-CnIO40RL.js`, SHA256 `abb386dc634598b36f6d9ec95dd4e28009017c4c5b91b5de9cc2ae6be460c227`;
CSS `index-t1gAwZoA.css`, SHA256 `26f0f7e629a238f2e7d7e8aa7f553955cb67113143ac29d6311c841047bd119d`.
The preserving helper's syntax, synthetic preserving-apply and wrong-hash/no-write
controls pass. Actual publisher preimages are checked only on the publisher, not
claimed from this local checkout.
