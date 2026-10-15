# Projected Operating Profit Reconciliation

Base: deployed `a1c2bb4ddc12394ee27c2bd0021abdc013c6307c`.

## Cause and Corrected Display

Parent's read-only live breakdown: same October revenue $32,857 and 194.3 sessions, but bridge operating profit $1,468 versus detailed Money flow $2,673. Bridge clinician cost $19,944; detail $11,240 other clinicians plus Erin $7,500 = $18,740. Other displayed costs match: employer $686, support $786, overhead $6,557, marketing $2,322, processing $1,093, separate owner payroll $0, reconciliation adjustment $0.

The bridge expenses compensation earned over October's 31 service days. The detail used checks paid in October, whose two contractor pay periods cover September 24-October 21 (28 service days). Approximately $12,444 earned other-clinician cost times 28/31 equals $11,240 paid. This explains the $1,204-$1,205 displayed profit difference within independent rounding. Erin's $7,500 fixed salary is included once in both calculations; it is not the duplicate.

The corrected detail uses the same forecast's earned compensation and operating costs as the bridge. With the unchanged live inputs, expected rounded display is **both operating profits $1,468**, both total clinician costs **$19,944**, with **$7,500 Erin salary plus approximately $12,444 other earned compensation**. The approximately $18,740 scheduled-check total is retained separately as timing information, not deducted as the service month's earned expense. These are expected live display values based on the parent's supplied breakdown, not a new production read or a cent-level reconstruction from rounded values.

## Scope

- Full-month projected flow reuses engine volume, revenue, earned compensation/burden/staff, overhead, dated income and processing fees. Capacity/growth/collection timing therefore cannot silently put the two profit views on different bases.
- Paycheck timing remains available in collapsed source details, including prior-month service days. Default nonprojection/pay-period behavior is unchanged.
- Family projection labels distinguish earned pay from scheduled checks and cash received. Owner clinical revenue is included once, fixed salary once, tax/distributions remain after operating profit. No target, source record or stored configuration is changed.

## Verification and Release

- 520 domain tests and 5 DB-free API tests pass; library/dashboard/API typechecks and dashboard/API builds pass. Existing build sourcemap/chunk warnings remain nonblocking.
- Independent Newton read-only review: no remaining scoped blockers. October 16 salary-start control gives $3,870.97 earned gross versus $3,750 scheduled checks, with correctly distinct labels and $2,994.19 estimated earned net.
- Added reconciliation controls cover check counts across calendar months, capacity, growth, collection timing, owner revenue, salary counted once, distributions after profit, and input immutability.
- Main 49-capture desktop/mobile harness passes. Aggregate-shaped read-only desktop/mobile render also asserts identical bridge/detail operating profits. Synthetic fixture; zero mutation requests or browser errors.
- No production access/writes, schema changes, migration or publication by this author. Parent must independently review the frozen commit and publish/verify in the existing environment. Rollback is code-only to a1c2bb4, with no business-data restoration needed. Full authenticated PostgreSQL suite is unavailable locally and is not claimed.
