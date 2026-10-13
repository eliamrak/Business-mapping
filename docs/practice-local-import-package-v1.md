# Practice Local Import Package v1

The macOS converter exports one JSON file for the Practice app. The package keeps client identity de-identified and preserves readable clinician and room grouping.

Golden fixture: [`practice-local-import-package-v1.golden.json`](./practice-local-import-package-v1.golden.json)

## Top-Level Object

Allowed fields only:

- `format`: exactly `emc-practice-local-import-package`
- `version`: exactly `1`
- `packageId`: non-empty string, stable for the sanitized package contents
- `exportedAt`: valid timestamp string
- `collections`: object with exactly `attendance` and `billing`
- `billingCodeMinutes`: optional object of billing code to default minutes

Unknown fields are rejected so names, source paths, original headers, and crosswalks cannot leak into the package.

## Attendance Collection

Allowed fields only:

- `coverageStart`: valid `YYYY-MM-DD`
- `coverageEnd`: valid `YYYY-MM-DD`
- `rowCount`: integer from `1` to `1000000`
- `rows`: non-empty array

`coverageStart` and `coverageEnd` must equal the minimum and maximum `serviceDate` values in `rows`.

Attendance row allowed fields only:

- `clientId`: required non-empty de-identified stable client ID
- `clinician`: required non-empty readable clinician label from the report
- `serviceDate`: valid `YYYY-MM-DD`
- `location`: `null` or non-empty readable room/location label from the report
- `status`: exactly one of `show`, `cancelled`, `no show`, `clinician cancelled`
- `billingCode`: optional `null` or non-empty string when explicitly available
- `visitKind`: optional; exactly `consultation` only when explicitly evidenced by Phone billing code, title, or status

## Billing Collection

Allowed fields only:

- `coverageStart`: valid `YYYY-MM-DD`
- `coverageEnd`: valid `YYYY-MM-DD`
- `rowCount`: integer from `1` to `1000000`
- `rows`: non-empty array

`coverageStart` and `coverageEnd` must equal the minimum and maximum `serviceDate` values in `rows`.

Billing row allowed fields only:

- `clientId`: required non-empty de-identified stable client ID
- `clinician`: required non-empty readable clinician label from the report
- `serviceDate`: valid `YYYY-MM-DD`
- `totalFeeCharged`: finite non-negative number
- `billingCode`: `null` or non-empty string
- `visitKind`: optional; exactly `consultation` only when explicitly evidenced by Phone billing code, title, or status

Billing rows are charged-fee facts only. They do not imply attendance and are not treated as cash collected.

Raw appointment title text and appointment time must not be serialized. Source titles can contain client names or sensitive notes, and time is not needed for the Practice v1 treatment/consultation distinction. Converters may use those fields locally to derive `visitKind`, then discard them before export.

## Billing-Code Minutes

`billingCodeMinutes` may be omitted. When present, it must be an object whose keys are non-empty billing-code strings and whose values are numbers from `1` through `1440`.

## Merge Semantics

The Practice app validates the entire package before changing local state. Exact duplicate package content is ignored even if `exportedAt` differs. A changed package under the same `packageId` is rejected. Exact duplicate attendance or billing snapshots from a new package are skipped so later backfills can add the missing counterpart without double-counting previously imported facts. Overlapping non-duplicate package ranges require explicit user review before replacing whole overlapping local snapshots.

Practice derives visit reconciliation from the accumulated separate fact tables. Phone/consultation evidence is preserved as raw facts but excluded from treatment starts, treatment visits, retention, inactivity resets, and billed treatment counts. Practice recognizes consultation evidence only from exact normalized billing code `Phone` or explicit `visitKind: "consultation"` supplied by the converter from exact source evidence; Practice does not fuzzy-match raw titles. Attendance rows without explicit consultation metadata are excluded only when their same de-identified `clientId`, normalized clinician label, and `serviceDate` group has Phone/consultation billing rows and no treatment billing rows. Mixed Phone plus treatment-code groups preserve treatment evidence. Missing counterpart rows remain incomplete data, not zero-fee visits or cancellations. Multiple same-day treatment rows for the same client and clinician remain reviewable unless the Practice app has an explicit same-day visit override.
