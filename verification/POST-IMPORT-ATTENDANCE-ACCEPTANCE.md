# Post-Import Attendance Acceptance

Verification-only artifact on `codex/attendance-money-acceptance`. Synthetic evidence only, not production certification. No runtime, UI, navigation, circle visuals, business records, source imports, or fee approvals are changed.

## Reproduce

Run from the repository root with its installed workspace dependencies and Node 24:

```sh
node --test verification/post-import-attendance-acceptance.test.mjs
node --test artifacts/api-server/test/practice-import-declarations.test.mjs
```

The focused test imports the runtime calculation functions directly and uses invented, in-memory sources. It does not access production, a database, a browser, real data, or the converter. Calculations assert input immutability. The API suite uses the real declarations route with a synthetic mock database.

Local verification on October 16, 2026: all seven focused synthetic tests and all 20 declarations API tests passed (27 total, zero failures). No production-count certification is implied.

## Acceptance Cases

| Control | Expected evidence |
| --- | --- |
| Six providers, one treatment per day; three frozen source-set members with Aug 27-Oct 12 proof; as of Oct 16 | Admission through Oct 7; 252 admitted visits across 42 source days per provider; selected Sep 17-Oct 16 yields 126 visits / 21 shared admitted days = 42 visits/week. Each provider yields 21 / 21 = 7/week. |
| Partial selected left boundary inside admitted Sep 10-23 canonical period | Exact daily facts for Sep 17-23 contribute seven days. The rest of that source period is outside the selection. |
| Manual 14-visit Sep 10-23 aggregate for each provider, followed by Sep 24-Oct 7 aggregate | Crossing aggregate withheld without proration; 84 visits / 14 days = 42/week. |
| Observed Oct 8-12 visits inside unfinished Oct 8-21 canonical period | No admitted visits or denominator days from that period; a tail-only query returns unknown, not zero. |
| PHONE, numeric code `4`, documentation code `2` | Exactly one treatment visit. Also checked with billing-linked legacy attendance lacking codes, including a stale consultation flag on code `4`. |
| 47 billed late cancellations | 47 cancellations preserve `late_cancelled`; zero attended visits; $2,350 remains separate billing evidence. |
| Overlapping exports, changed row hashes, case/whitespace provider variants | Repeated encounter counts once; two distinct encounters total two visits in either source order. |
| Admitted Show/Cancelled conflict on Sep 25 for provider 1 | Sep 24-Oct 7 withheld only for provider 1; other providers retain proof. Practice selection uses seven common days and 42 visits. Affected provider-period is unknown, not zero. Both source orders checked. |

The 21-day denominator is shared calendar coverage, not 6 x 21 provider-days and not the full 30-day selection. Admission of the complete canonical source period happens before exact daily facts are clipped to the selected dates. Frozen source-set admission does not rewrite individual member proofs.

## Real-Data Gate Still Open

The current real selected-30-day `144 / 21` is UI-reported and unverified. The synthetic `126 / 21` is an invented control, not an expected replacement for the real number. Real current-six and Whole Practice imported treatment counts, denominator days, and source/status reconciliation still require an independently reviewed cloud read-only SQL result without identifiers. Billing SQL totals alone do not certify attendance.

The later reviewed `post-import-attendance-reconciliation.sql` now supplies that independent production check; see `POST-IMPORT-ATTENDANCE-SQL.md` for its gates and exact window. The original `historical-production-reconciliation.sql` still disclaims clinical attendance-count certification. The three billing-only former providers must not be inferred to have zero attendance or complete attendance coverage. No actual production attendance result has been observed by this local task.

## Separate Reachability Correction

The earlier arbitrary-alias P1 is withdrawn. A domain-schema fixture mapped `Alias One` and `Alias Two` to the same `Synthetic 1` clinician and exposed duplicate/conflict inconsistencies only through direct injection. This is an unreachable domain/API contract inconsistency under the supported declarations PUT, not an accepted production regression or a request to implement aliases.

`artifacts/api-server/src/routes/practiceImports.ts` rejects a mapping unless normalized `sourceLabel` equals normalized target `label` (line 529 at the audited source), before persistence. The actual route's synthetic harness returned 400, no saved declaration, and zero audit writes for that two-alias fixture; a case/whitespace-only control returned 200. The declarations API suite includes alias rejection. The focused attendance tests use exact mappings and already-supported case/whitespace normalization only.
