# Unboxed, simpler Practice information

Ordinary child of `05e82071e394e3ed67f5239a7e6a03c86c1ae3fa`; includes the earlier comparison disclosure cleanup in its ancestry. No metric calculation, source records, import, filter, selected-period, provider, or persistence changes.

## Presentation

Removed the shared pale prose/label/value backplates and text halos across Practice. The 50% glass cards and transparent page backing remain. Supporting copy uses a shared larger reading hierarchy (generally 15px, comparison labels 14px); lifetime values are 22px. Darker navy ink provides contrast on glass; standalone text over the artwork uses light ink. Standalone staff detail, Money table labels and menu labels were checked and corrected. Semantic alerts use different readable ink on glass versus directly over the artwork.

Functional buttons, inputs, menus, chart plotting surfaces and their affordances remain. Reduced-transparency mode retains solid cards. No opaque page blanket was reintroduced.

## Representative copy changes

- Sessions: two dense sentences become “{rate} sessions / week across {days} covered calendar days.” followed by “Partial total: incomplete periods excluded.” when partial. Observed-session total, rate, covered days and partial status still come from the same calculations.
- Lifetime: “Mean sessions” → “Average sessions”; “Mean elapsed time” → “Average observed span.” Median labels remain explicit.
- The ongoing group becomes “Ongoing or uncertain,” with “Still in treatment or not enough evidence of an ending.” It is not presented as an active-client count.
- Apparent endings retain the 90-day rule and “not a confirmed discharge.” The observed, not predicted, qualifier appears at the section heading. First-to-last recorded treatment and missing-earlier-history caveats are one short sentence below the groups.
- Limited follow-up remains visible where applicable. When every group member has limited coverage, the warning states that once instead of repeating the same group count. Zero limited cases no longer generate a redundant zero-count note.
- Removed the progression kicker/question duplication and shortened scope/coverage explanations. Existing detailed method/source controls remain; no new disclosures were added.
- Marketing services explanation becomes “Practice-wide marketing services. Software belongs in Operating expenses.” The existing double-counting guard remains.

## Validation and evidence

Final full regression: 1,272 passed. Dashboard TypeScript and final Vite production build passed (existing sourcemap/chunk-size notices). No dependencies added.

Synthetic cloud browser only: 31 full-page captures plus 3 focused captures (lifetime desktop/mobile and sessions summary). Overview, Sessions, Team, Growth, Money/Allocations/Budget, Goals, Settings and imports checked at 1280/390/320 widths; keyboard, filtering, export, expansion, long text, 200% Growth zoom and reduced-transparency checks retained. Zero browser errors, API writes, or tested viewport overflow. Supporting prose samples are unboxed and at least 15px. Sampled interactive contrast minimum: 5.847:1 in Overview and Settings; not an exhaustive certification of every legacy chart/semantic color.

New assertions cover: lifetime labels and retained meaning, 22px values, partial-session summary, unboxed staff text, staff detail contrast inheritance, Money table minimum type size, warning ink on glass/artwork, removal of the previous disclosure rows, and retained card alpha/opaque contents. Actual pixels reviewed for desktop Overview, mobile Growth/Team/Money and focused lifetime desktop/mobile and sessions summary.

Final evidence directory: `/tmp/practice-unboxed-final-gate/`, including `report.json`, `lifetime-1280.png`, `lifetime-390.png`, and `sessions-summary-1280.png`. Consumer-local paths are not assumed shared. Parent supplied actual source-screenshot pixel observations for the prose strip and lifetime backplates; no claim of local inspection of those Library originals.

No publication from author. Publisher can integrate this commit together with parent `05e82071` onto the held composed release, then verify the live Mac wrapper separately.
