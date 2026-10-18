# Bounded Keyboard, Reflow and Draft Acceptance

## Candidate

- Base: `f08ae601e8ddb811a5afce3dd647909482ccd3a4`.
- Runtime/test: `338e6001bced3923974f78f3b77e64c92b59b8c3`.
- Tree: `c51cf716d83e384d33b341824e6ee30cc523c260`.
- Branch: `codex/keyboard-zoom-navigation-acceptance`.

Existing acceptance notes and the staff/annual-goal review were read first. Previous reviewer Kierkegaard was unavailable in this turn's agent state; Euler continued the same bounded review independently. No owner QA, new sign-in, financial records, client files, live API/database, imports or production writes were used. No SEO/Ads or new product scope.

## Acceptance Matrix

All rows pass for the frozen candidate. The fixture mounts actual PracticeWorkspace, dialogs, editors and draft hooks against loopback fixture GETs. Frontend identity is a fixture; all application write requests and non-loopback browser requests are blocked.

| Path | What Was Verified |
| --- | --- |
| Today keyboard navigation | Tab reaches Sessions, Enter activates it; Tab reaches Team, Space activates it; focused navigation has a visible outline. |
| Reports and Move data | Initial modal focus, complete forward Tab cycle/wrap, reverse Tab, Escape closes, opener regains focus. No PDF/download/transfer action executed. |
| Dirty record editor | Escape opens discard confirmation; Keep editing retains text; X close can be vetoed; explicit Discard closes and restores opener focus. No record saved. |
| Dialog contracts | Autofocused child does not replace opener; vetoed close plus rerender retains opener; caller-prevented/custom close focus is honored; uncontrolled Radix Trigger behavior remains native. |
| Goal text | Escape restores uncommitted text without staging or saving. Actual reload while text remains focused produces beforeunload; cancellation retains text. |
| Staged Goal/date changes | Pending edit survives Today section changes. Valid custom dates carry; incomplete dates retain the named last-valid range. Switching to Sandbox is blocked while staged changes remain. Explicit Discard restores saved target. |
| Bulk leads | Dirty year grid disables year/month-detail changes. Section change can be cancelled without losing values; explicit discard/accepted navigation leaves no ghost draft and makes no save. |
| Month entry | Cancelling month-input change keeps February counts. Year totals -> March follows the same guard; cancellation restores February's context and acceptance clears the draft rather than moving its values into March. |
| Saved lead fields | Unblurred saved count and source text each warn before actual reload; cancellation preserves raw text. Saved/fixture values are not written. |
| Reflow | Overview, Goals, Money, Growth, Reports modal and pending review at all five configurations below. No document horizontal overflow; settled modal bounds fit. Pending review's Discard/Save are keyboard reachable, visible and not covered; reverse Tab reaches its toggle. |

Viewport configurations:

| Configuration | CSS Viewport | DPR | Verified PNG |
| --- | --- | --- | --- |
| Desktop | 1280x900 | 1 | 1280x900 |
| Narrow | 390x900 | 1 | 390x900 |
| Narrow | 320x800 | 1 | 320x800 |
| 200%-equivalent desktop | 640x450 | 2 | 1280x900 |
| 200%-equivalent narrow | 320x400 | 2 | 640x800 |

**44 unique checks, 58 executions:** 14 interaction checks repeated in both browser-context scale runs plus 30 viewport/surface checks. Normal/narrow run: **32 PASS**; DPR2 run: **26 PASS**. Zero browser exceptions and zero application writes. Width, height, DPR and physical PNG dimensions are asserted for every capture. Finite dialog opening animations are settled before final geometry checks.

## Defects and Fixes

1. **Controlled dialogs lost focus.** Reports, Move data and record-editor discard reproduced focus loss. Their openers are not Radix DialogTriggers. The shared Dialog wrapper now records the opener on actual controlled-open transitions, before child autofocus, and restores it on close when connected. Caller cancellation/custom focus takes precedence. Uncontrolled dialogs retain native Trigger behavior. Rejected close requests do not overwrite the opener.
2. **Focused unblurred Goal text lacked reload protection.** DraftField previously kept text locally until blur while the parent unload guard saw only staged changes. DraftField now uses the existing unsaved hook for its raw draft; Escape still resets it without saving.
3. **Local Growth drafts could be lost or moved across contexts.** Bulk section navigation and month input changes reproduced missing protection. Review also found the year-grid month handler bypassed draft reset. LeadFlow now registers local raw/new/bulk draft state with the existing unsaved protocol. Marked view-navigation buttons ask before unmounting dirty local views. Both month entry points use one guarded reset; cancellation preserves context, acceptance deliberately clears the unsaved entry. Saved count/source fields also protect focused raw text before reload.

No CSS/layout redesign, financial formulas, metric labels, backend authorization, API/persistence schema or saved business records changed. Existing staged Goal behavior remains save/review-based. Draft confirmation is not an automatic save.

## Evidence and Review

- Author: **756 unit tests**, **133 database-free API tests**, dashboard TypeScript and fresh Vite builds pass; diff whitespace check passes. Existing Vite sourcemap/mixed-import/large-bundle warnings remain.
- Three new pure navigation-guard tests cover marked/current/disabled controls, keyboard-generated and modified clicks, links/new tabs/downloads and cancelled events. Actual browser regressions exercise the hooks and dialogs.
- Reviewer **Euler**, `01a1515c-75ad-76fe-bde7-21e2265100c8`, confirmed the exact runtime/test commit and tree and independently ran both browser passes (**32 + 26 PASS**), all **756 unit tests**, and dashboard TypeScript. Representative captures inspected; **no blocking findings within scope**. All prior review findings are closed.
- Both final author results and both independent results identify `338e600` and its exact tree. Earlier exploratory results identifying the base are not release evidence.
- Preliminary reflow labels were withdrawn: a CDP-only override was reset by Playwright screenshot preparation, and early modal measurements sampled opening animation. Those reports are not counted. Final tests use separate browser-context DPR settings, set each viewport explicitly and verify actual dimensions. No CSS repair was inferred from those fixture errors.

[Author normal](keyboard-zoom-evidence/normal/results.json), [author DPR2](keyboard-zoom-evidence/zoom200/results.json), [independent normal](keyboard-zoom-evidence/independent-normal-results.json), [independent DPR2](keyboard-zoom-evidence/independent-zoom200-results.json), and [baseline interaction failures](keyboard-zoom-evidence/baseline-interaction-failures.json).

Thirty final author captures remain in `/tmp/practice-keyboard-final-normal/` and `/tmp/practice-keyboard-final-zoom200/`; eight representative captures are committed. Examples: [320px Reports](keyboard-zoom-evidence/normal/narrow320-reports.png), [200%-equivalent Overview](keyboard-zoom-evidence/zoom200/zoom200-desktop-overview.png), [200%-equivalent pending review](keyboard-zoom-evidence/zoom200/zoom200-narrow-pending-review.png). Author visually inspected representative modal and pending-review captures.

Reproduce from repository root with the existing temporary Playwright runtime:

```sh
env PRACTICE_PLAYWRIGHT_PACKAGE=/tmp/forge-reviewed-da6f1d2c-stage/package.json PRACTICE_QA_DPR=1 PRACTICE_RENDER_OUTPUT=/tmp/practice-qa-normal node verification/keyboard-zoom-navigation.mjs
env PRACTICE_PLAYWRIGHT_PACKAGE=/tmp/forge-reviewed-da6f1d2c-stage/package.json PRACTICE_QA_DPR=2 PRACTICE_RENDER_OUTPUT=/tmp/practice-qa-zoom node verification/keyboard-zoom-navigation.mjs
```

The harness builds fresh CSS and refuses tracked runtime changes before or during candidate recording. It uses a new isolated browser, never an owner profile/session. It does not send writes to the fixture or production.

## Limits and Release Boundary

This is bounded Chromium keyboard and reflow acceptance, **not full accessibility/WCAG certification**, screen-reader testing, native browser-chrome zoom, text-only zoom, all browser/OS combinations or Mac native-wrapper acceptance. The 200% cases emulate equivalent CSS viewport/device scaling; they do not operate a native Zoom menu. Internal section/workspace navigation and actual reload cancellation are covered; exhaustive browser Back/Forward and every editor/modal combination are not.

No new authenticated provider/native PostgreSQL claim is made; prior JWT/PGlite evidence remains separate. This task has not deployed or edited live records. Normal reviewed source push is authorized separately; release coordination must use the exact reviewed target, preserve all live data, and must not substitute these fixtures for live verification.
