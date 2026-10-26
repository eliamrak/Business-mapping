# Attrition primary-value correction

Diagnosis at bf4714b: Overview always bound its primary PercentageKpi to the full-window percentage. Missing full-window coverage correctly produced a dash there, while independently supported monthly averages were secondary text. This was an incomplete presentation branch, not evidence that monthly endings were missing or a percentage could be inferred.

The main circles now show average client endings per covered mature month. They are unscaled count displays with accessible units, not percentage meters. Both periods retain their mature-window labels and disclose the number of covered mature months. Unknown monthly history has a concise unknown state; recorded zero remains zero. A full-window ended total and percentage appear only with verified full-window coverage; no total is derived from a rounded monthly average. Percentage goals, when supported, remain secondary percentage text rather than a marker on a count ring.

No calculation, 90-day rule, filter, source record or persisted setting changed. Regression tests retain full/partial/missing/zero coverage, clinician identity and independent monthly/full-window cases. Synthetic render tests put screenshot-shaped 13 and 7.6 directly into the primary count circles without fabricated percentages or ended totals.

Validation: 1,274 full tests passed; dashboard TypeScript and production build passed. Synthetic full-app browser run passed with 31 full-page captures and focused attrition desktop/mobile captures. Actual output pixels inspected; the full-app synthetic cohort yields 0.3 and 0.2 monthly endings, while the separate component tests cover 13 and 7.6. No live-count reconciliation claim. Source screenshot observations were independently relayed by parent/publisher.

Evidence: /tmp/practice-attrition-primary (consumer-local, not assumed shared), report.json and attrition-desktop.png / attrition-mobile.png. No live browser, API writes or deployment. This commit is separate from the subsequent universal glass styling task.
