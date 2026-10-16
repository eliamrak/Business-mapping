# Paired Converter Candidate

This directory retains the offline parser and synthetic tests from the established macOS Practice Converter, with the owner-confirmed legacy-code and late-cancellation changes paired with this Practice branch. The installed application and original source project are unchanged.

Run `python3 -m unittest discover -s Tests` here. Run `node --test artifacts/comp-dashboard/src/lib/legacy-service-codes.test.ts` at the repository root for synthetic CSV-to-converter-to-Practice validation and calculations. `node verification/run-isolated-api-tests.mjs` additionally verifies durable import/reload against a new disposable local database.

Codes remain verbatim. Defaults: `1` intake75 minutes, `30001` coaching60, `30002` coaching90, `30003` intensive consultation25, `4` paid phone treatment30. `2` is documentation: charges remain billed revenue but never visits or attended time. No historical rate (including $135) replaces an actual row fee. Missing fees remain errors. Numeric `4` is not literal `PHONE`; confirmed numeric semantics take precedence over a generic Phone title or old consultation metadata.

Late cancellation exports canonical `cancelled` plus optional `cancellationSubtype: "late_cancelled"`. Practice validates that subtype only with cancelled status and preserves it in stored snapshots/backups. Ordinary cancellation, no-show and clinician cancellation remain distinct. Original input files are read-only. The package remains version1 with a validated additive optional field; strict older importers reject that new field rather than silently discard it. Do not install this converter ahead of the paired reviewed Practice runtime. Backout preserves source files/mappings and stored JSON; older readers may need the newer reader to review such snapshots. No raw-source rewrite or automatic migration is included.

The original native Swift UI/bundled interpreter is not modified or redistributed here. App installation, signing and rendered native retry remain separate release checks. This candidate is not a deployed update, and the owner's reported rejection remains unreproduced without its exact sanitized error evidence.
