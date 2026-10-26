# Practice universal glass controls — 2026-10-26

Base: `9adb41b1b20a89db90362b0f1b0a8d3b086cdada` (separate attrition presentation correction), following published readability baseline `bf4714b`.

## Scope

Practice-only shared control stylesheet covers navigation, clinician filters, tool tabs, buttons, fields, table headers, menus and portal dialogs. Surfaces use 50% background alpha, never container/text opacity. Selected controls retain a teal border, inset outline and bold label; keyboard focus has a separate 3px outline. Disabled controls keep readable text and use dashed borders. Inputs use 16px text; ordinary controls retain 44px minimum height. Native checkbox/radio indicators retain their native behavior. Native select option popups retain solid platform-readable backgrounds.

The header provides one glass layer, with transparent child navigation buttons. Chart canvases and secondary navigation wrappers no longer add pale backing over their parent; chart labels use readable dark 14px text. Lead-entry tables have one glass parent so labels and numeric cells remain legible. Reduced-transparency, forced-colors and unsupported-blur paths retain solid surfaces.

The redundant Overview Sessions shortcut is removed; main Sessions navigation remains. Team historical help moves beside Clinical staff, replacing the count-only help at that heading. No help content or action is deleted. Reports dialog now explicitly constrains logical width on mobile, wraps contents and scrolls vertically; nested report cards share its glass surface.

No calculations, API contracts, import behavior, dates, business records or saved settings changed. This commit does not enable disabled Knowledge features.

## Evidence

Cloud-only synthetic browser harness: `verification/practice-surface-render.mjs`. Baseline captures: `/tmp/practice-attrition-primary`. Final captures: `/tmp/practice-unified-release-final`. These paths belong to the author environment; they are not shared parent paths.

Coverage includes Overview, Team, Growth, Sessions, Money and Goals at 1280/390/320px; Settings, Imports, budget/payroll details, Team expansion, progression filters/export, Growth 200% zoom and reduced transparency, plus Reports desktop/mobile viewport captures. The harness blocks external requests and asserts zero business-write requests. Reports export is not executed. Main-page checks assert no horizontal page overflow; wide tables preserve their labeled horizontal scrolling regions.

Additional checks cover contributor selected state/glass fill and keyboard focus, Team help placement, removed duplicate shortcut, mobile dialog bounds/Escape, primary attrition values, card/content opacity and reduced-transparency control fallback. Dialog screenshots use viewport capture: full-page capture changes fixed-layout rendering and is unsuitable for modal visual evidence.

Readability tradeoff: controls inside cards necessarily composite with the card beneath, so they appear lighter than standalone pills. Neither receives whole-element opacity. Native option menus and accessibility fallback surfaces are intentionally solid.

## Release

Author does not deploy. Publisher must integrate both the attrition commit and this child styling commit and perform installed-app/live verification. Synthetic evidence is not reconciliation of live counts or real client records.

## Validation results

- Full domain/dashboard regression: 1,274 passed, 0 failed (`/tmp/unified-final-tests.log`).
- Dashboard TypeScript check passed (`/tmp/unified-final-types.log`).
- Production dashboard build passed (`/tmp/unified-release-build-final.log`); existing source-map/chunk-size warnings remain.
- Synthetic browser assertions passed in the final release run: 31 main-view checks, 40 PNGs, zero browser errors, zero non-GET API requests. Sampled Overview/Settings composite text contrast minimum 5.847:1; this is a computed ancestor-background check, not a claim that every artwork pixel was measured. Final release rerun adds two viewport screenshots. Actual viewport captures confirm narrow Team controls/text render normally; Chromium full-page capture can show blank compositing patches with backdrop-filter.
- Actual pixels inspected: desktop Overview, narrow Team/Growth, mobile Reports, lifetime panel. Native Mac/WebKit verification remains publisher-owned.
