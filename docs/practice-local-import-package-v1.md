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

Billing rows are charged-fee facts only. They do not imply attendance and are not treated as cash collected.

## Billing-Code Minutes

`billingCodeMinutes` may be omitted. When present, it must be an object whose keys are non-empty billing-code strings and whose values are numbers from `1` through `1440`.

## Merge Semantics

The Practice app validates the entire package before changing local state. Exact duplicate packages are ignored. Partly duplicate packages are blocked. Overlapping package ranges require explicit user review before replacing whole overlapping local snapshots.
