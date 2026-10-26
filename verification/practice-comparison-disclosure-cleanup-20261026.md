# Comparison disclosure cleanup

Base `bf4356adbe55719b0b8bd23adb9b7c1273180e7a`; ordinary child on the existing Practice author branch.

Removed visible Definition and Exact change/Exact changes disclosure rows from the four Overview comparison cards. Removed Period dates disclosure rows from the same shared comparison presentation in Overview, Sessions, and expanded Team history. This is not a global deletion of definitions, dates, or details controls. Unrelated coverage, source/import, records, and planning disclosures remain.

Date boundaries, definitions and comparison arithmetic remain noninteractive screen-reader metadata. The main period headings, two-column metrics, rings, baseline markers, selected clinician/date controls, unknown states, coverage warnings and business records are unchanged. Removed the now-dangling “see definition” wording. No computation source or record persistence changed.

Reference: Library `libfile_2cc40868301481918a5037890471a43e`, authorized filename `Screenshot 2026-10-26 at 3.09.40 PM.png` (Library uses a narrow no-break space before PM). The supported current helper failed to download on the first attempt and one bounded retry; no local reference pixels were claimed. Parent subsequently confirmed actual pixels: four pale collapsed Definition/Period dates boxes in two columns and a fifth full-width Exact change row; the baseline value above them is retained metric content. Source labels and resulting synthetic renders match that scope.

Validation:
- 1,272 full domain/dashboard tests passed, including the added accessible-date/no-disclosure test and existing metric, baseline, unknown, coverage and immutability assertions.
- Dashboard TypeScript and production Vite build passed; existing sourcemap/chunk-size notices only.
- 31 synthetic loopback browser captures at desktop and narrow widths, with existing keyboard/filter/export/disclosure checks. Zero browser errors, writes, or tested viewport overflow. New checks assert target summaries absent, Coverage controls retained, eight Overview date boundaries clipped to screen-reader-only size, and no Period dates rows in expanded Team history or Sessions.
- Actual output pixels inspected: Overview desktop and 390px mobile; two-column comparisons, baseline markers, coverage controls and unknown information remain, without the removed disclosure boxes.
- One initial browser run was interrupted by a development reload; the final stable run passed. No live browser used.

Evidence is consumer-local at `/tmp/practice-disclosure-final/` (31 PNGs and report.json), not assumed shared. No deployment. Publisher should integrate this focused commit onto its current composed release and verify the live view separately.
