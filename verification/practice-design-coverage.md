# Practice App Sequence 20 Coverage Checklist

Reference inspected:

- Library file: `libfile_af318b5d0cd08191b6c0d9c7735053f3`
- Filename: `practice-tabs.html`
- Local path: `/Users/eliam/Documents/Codex/2026-10-14/task-2/library-materialized/practice-tabs.html`
- SHA-256: `4f0de5d32c38cf8e441d28947a021e921714a9d12330948f5ae56462e8d38a81`

Production rule:

- The approved preview uses synthetic/example values. Those values are reference-only and must not be written into production records, defaults, or migrations.

## Required Before Release

- [x] Shared reporting period controls across Overview, Sessions, Team, Money, Growth, Rooms, and Goals, including custom dates.
- [x] Contributor controls reset to Whole Practice on top-level tab changes; Compare remains explicit and includes Whole Practice last.
- [x] Shared metric visual language: actual/recorded fill, green goal marker, benchmark marker, and red real capacity limiter where applicable.
- [x] Sessions contains dedicated Sessions, Retention, and Attrition views with common controls and marker visuals.
- [x] Retention uses treatment attendance only, three-session initial retention, 28-day initial gaps, pending exclusions, and mature observations.
- [x] Attrition is lower-is-better clients/month, uses mature 90-day ending windows, and removes later-return endings.
- [x] Consult conversion uses imported PHONE/consultation journeys, one calendar-month window, pending exclusions, actual closer attribution, internal-referrer protection, deduped practice conversion, and explicit missing/conflicting attribution.
- [x] Money includes approved bridge/goal-track/client-flow visual system with recorded vs projected labels.
- [x] Overhead includes a monthly-average graph over completed recorded periods, with shared/custom period controls visible in Money.
- [x] Funds include dated balances, projected contribution text, and separate total-balance goals.
- [x] Long Term Goals presents real modeled alternatives ranked by impact/fit, each with focus KPIs, disclosed assumptions, optional timeline via existing saved scenario dates, manual adoption persistence, and review/update behavior as new data arrives.
- [x] Goal achieved alert fires only after one completed biweekly reporting period, and the goal remains active until changed.
- [x] Growth and Rooms use the applicable shared controls/marker visual pattern.
- [x] Existing imports, compensation, staff, rooms, money, goals, and historical calculation workflows remain preserved by limiting changes to derived UI/model summaries and import conversion utilities.
- [ ] Render verification covers every major view on desktop and mobile against the approved reference.
- [ ] Independent final review compares exact source against the approved HTML reference and production requirements.

## Implementation Notes

- Manual lead-flow aggregates may remain for fallback/reporting, but they are not sufficient for clinician consult performance.
- Billed fees remain revenue basis, not cash collected.
- Owner clinical revenue accrues to the business without double-paying owner compensation.
- Blank user-entered goals and balances are allowed and interpreted as zero only for display/projection, not as seeded production facts.
