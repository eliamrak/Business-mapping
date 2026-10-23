# Mobile Shell Independent Source Review

Reviewed 2026-10-23 against approved commit
`72dc5fb7da9e7dce7dcb0eb57697edcb790083d7`. Application and browser-harness owners
worked concurrently. This reviewer edited only the four authorized verification
files named below. No application source, real records, backend, data files,
dependencies, or deployment was edited or accessed by this review.

## Findings

**Accepted for the scoped mobile-shell repair. No blocking defect remains.**
The source contract, inspected mobile/boundary images and final browser rerun
records support this verdict. Earlier focus and Settings failures were harness
issues and are resolved below. This is a local release-review verdict, not a
deployment or native-device certification.

Final handoff: independently read
`/tmp/practice-mobile-shell-acceptance/acceptance-result.json` after Dirac finished.
It reports `status: passed`, 16 desktop checks with zero changed pixels, 55 passing
interaction checks, no interaction failures and no browser errors. Its linked
interaction and boundary records agree. The fixture SHA-256 is
`1944dc8e2934b27e3fe36e79237ae04c0a74c56142a86b134d0f87b9e8d0d8c8`.
Reviewed `verification/OCTOBER23-MOBILE-SHELL-RECEIPT.md` and the final harness:
the source/evidence boundaries agree with this review. At that read, the receipt's
completion paragraph still awaited the final web build and this independent
verdict; it should be finalized by its owner using the passing browser records.
The web build was running per the owner and is not claimed complete here.
There is no remaining code/browser blocker in this scoped review.

**P2, resolved by the application owner: unsaved-edit capture did not cross the
navigation portal.** Initially the new menu trigger inherited the old header's
`data-unsaved-navigation` marker, causing a discard confirmation merely to open
navigation. Destination buttons in the portal lost that DOM ancestor and could
bypass the existing confirmation. The application owner removed the header marker,
marked the original two navs, original footer and legacy mobile settings button,
and marked each of the three new portaled destination navs. Neither the new opener
nor the dialog close button is marked. The regression test invokes the real
`requiresUnsavedNavigationConfirm` implementation with component-produced button
attributes and ancestor markers, covering inactive/current destinations and both
non-navigation controls. The existing unsaved-navigation tests also pass.

No P0/P1 issue was identified. No business-logic mutation was found.
Dirty-form navigation cancellation was not exercised in the browser. The actual
guard function was executed in the independent unit regression, and marker
relocations are included in the exact source contract. This narrower evidence
is retained explicitly; no browser dirty-form-cancel claim is made.

## Independent Image And Browser-Evidence Review

Opened and visually compared the supplied files, rather than relying on the
application owner's description:

- `/tmp/practice-mobile-shell-acceptance/before/17-overview-320-top.png`
- `/tmp/practice-mobile-shell-acceptance/after/17-overview-320-top.png`
- `/tmp/practice-mobile-shell-acceptance/before/25-overview-390-top.png`
- `/tmp/practice-mobile-shell-acceptance/after/25-overview-390-top.png`

Both after images show the intended compact branded toolbar, legible navigation
and action icons, full-width native contributor selector and first metric card
around y=249. Before, the 320px navigation occupied roughly 444px and no metric
card was visible; at 390px the first card only began around y=800. The inspected
after images have no visible new overlap or clipped shell controls. Existing
metric-card labels and two-column metrics remain legible at these widths.
This is a judgment about these two captured first viewports, not other screens
or scroll positions. The synthetic `captures.json` independently reports nav
height 61px and document widths exactly 320/390px for those captures.

Also opened `/tmp/practice-mobile-shell-acceptance/after/sheet-320.png`. All three
workspace modes, six practice sections, both utilities and Reference layout fit
in the captured navigation sheet, with a visible close icon and focus ring.

Read the concurrently produced `after/checks.json`. At inspection it recorded
all **16 desktop comparisons passing with zero changed pixels** at 1024/1440.
This reviewer inspected those recorded comparison results and the comparison
implementation; this is not an independent rerun of their pixel calculation.

Final rerun records independently read by this reviewer:

- `/tmp/practice-mobile-shell-acceptance/interaction-recheck/checks.json`:
  **55/55 passed, errors empty:** 54 mobile checks plus the boundary check.
  At each of 320/390/430px these cover modal Tab
  containment, Escape and focus return, six section destinations/selected states,
  three workspace modes, both utilities including Settings, Reference layout,
  action-disclosure Escape/focus return, Overview/Sessions native contributor
  selection including comparison, and synthetic 200 percent text enlargement.
- `/tmp/practice-mobile-shell-acceptance/boundary/checks.json`:
  **1/1 passed, errors empty.** Open at 760px, resize to 761px, require the dialog
  hidden and original section navigation visible, require pointer/scroll lock
  cleared, then resize back and require no dialog remains open.

The two failures in the earlier partial `after/checks.json` are superseded by
these specific passing reruns, rather than waived:

- The immediate post-Escape focus assertion raced Radix's deferred unmount
  autofocus (`setTimeout(..., 0)` in the installed focus-scope implementation).
  The updated harness waits for the trigger to become the active element and
  still asserts focus return. All three widths pass; no app focus workaround was
  introduced.
- The isolated harness lacked Clerk context and crashed at Settings. Its build
  now supplies explicit synthetic identity hooks (`useAuth`, `useUser`,
  `useClerk`), with sign-out intentionally throwing as outside acceptance scope.
  Settings and subsequent checks pass at all three widths. Production auth was
  not altered, and sign-in/sign-out behavior is not certified by the stub.

Also opened `boundary/drawer-760.png` and `boundary/desktop-761.png`: the drawer
fits at the mobile limit, and the original toolbar, section navigation, view tabs
and contributor pills return above it without visible overlap. No 768/820px
screenshots were produced, so this review certifies the exercised boundary and
existing-source preservation, not every intermediate tablet width. This is an
evidence limit, not a blocking defect for the requested max-760px repair. Native
Safari and real-phone focus behavior remain untested. Text enlargement doubles
computed text sizes/line heights; it is not browser zoom or OS font scaling.

## Exact Preservation Contract

`mobile-shell-source-contract.mjs` removes exactly one occurrence of each literal
reviewed fragment: mobile import, navigation JSX, page-actions opening/closing
wrapper including its native view selector, and Sessions/Overview contributor
selectors. It reverses exactly the five guard-marker relocations above. Every
remaining byte must equal the workspace at the full approved commit hash.
There is no wildcard JSX removal, source-region waiver, or optional fallback.

This proves that existing metrics, callbacks, query behavior, persistence,
calculations, original desktop actions, original contributor tabs and original
view tabs remain byte-identical. New mobile handlers reuse the original
`navigate`, `showTool`, `setSection`, `setSharedContributor` and comparison state
paths. Navigation maps the existing `sections` array and all three workspace modes;
Data & imports, Settings and the conditional Reference layout link remain present.
Subview options map every existing `toolTabs` entry and preserve its null/overview
selection mapping. Contributor options preserve the original roster order, current
value, Whole Practice and Sessions comparison choice.

`tidal-theme.test.mjs` now uses that independently bounded restoration before its
original exact historical-theme comparison. The original token, artwork, motion,
JPEG metadata and stylesheet byte contracts are retained unchanged.

The new cumulative mobile gate allows only these exact paths since `72dc5fb`:

- `artifacts/comp-dashboard/src/pages/practice-workspace.tsx`
- `artifacts/comp-dashboard/src/components/practice/mobile-workspace-controls.tsx`
- `artifacts/comp-dashboard/src/components/practice/mobile-workspace-controls.css`
- `verification/mobile-shell.test.mjs`
- `verification/mobile-shell-source-contract.mjs`
- `verification/mobile-shell-acceptance.mjs`
- `verification/tidal-theme.test.mjs`
- `verification/MOBILE-SHELL-INDEPENDENT-REVIEW.md`
- `verification/OCTOBER23-MOBILE-SHELL-RECEIPT.md`

The older cumulative Tidal gate includes the same exact additions without a
directory exemption. New API, business-domain, existing CSS, shared UI, package,
lockfile, fixture or raw-data changes fail the mobile gate. Synthetic browser
artifacts remain outside the repository under `/tmp` and are not waived paths.

## CSS And Interaction Review

PostCSS requires the only desktop declarations to be the four new controls hidden
with `display: none` and the two action wrappers using `display: contents`.
Every remaining rule must be inside exactly `(max-width: 760px)` and start with an
owned `pw-app`, `pw-mobile-` or `pw-page-actions-` selector. Existing CSS files are
unchanged. The new portaled Radix Dialog uses static owned overlay/content styles;
no transition or animation declaration is permitted by the test.

The component uses the already installed Radix Dialog with modal defaults, Portal,
Overlay, Trigger, Content, Title, Description and a labeled Close control. That
retains the established focus-trapping, Escape and focus-restoration engine;
actual DOM focus behavior is a browser acceptance responsibility. The owned
navigation effect closes the dialog above 760px and removes its media listener on
unmount. Destination buttons retain disabled and current-page state.

Page actions preserve the original command children. Their trigger has a stable
`aria-controls` target and reflects expanded state. Escape closes the disclosure,
stops propagation and focuses the trigger. Native selects have associated labels,
retain the full roster and invoke the original selection/comparison callbacks.
The unit harness executes the actual TypeScript component bodies in memory with
React hook doubles; it does not claim browser geometry or native keyboard proof.

## Verification

```sh
node --test verification/mobile-shell.test.mjs verification/tidal-theme.test.mjs
node --test artifacts/comp-dashboard/src/lib/unsaved-navigation.test.ts
git diff --check
```

Results: **30/30 passed** for mobile plus retained Tidal contracts; **3/3 passed**
for existing unsaved navigation; whitespace gate clean. No skipped, expected-fail
or relaxed test was used. Negative probes also confirm the source contract rejects
sample navigation/view-handler mutations and duplicate mobile imports.

No browser process, build, production service, external app or real-data endpoint
was run by this reviewer. Existing synthetic screenshots and recorded browser
results were read directly as documented above. Dirac owns execution of the
browser harness; this reviewer independently assessed its source, final rerun
records, and the selected actual images. The records support acceptance of the
requested repair with the stated device/auth limits.
The application owner additionally reported 44 source/theme/PDF/icon tests,
1335 functional tests, 251 API tests and both UI/API typechecks passing; those
broader runs were not independently rerun by this reviewer.

## Reviewed Application SHA-256

```text
practice-workspace.tsx          99fd1f20f7f689fbf36b71bccf1bedcd193808ab73c38f62c20225febe83d769
mobile-workspace-controls.tsx   9052ef175eab3366a8f15c24260aa67ef64059e5df42259a9f04a3ca7bfa2b2a
mobile-workspace-controls.css   f4fd464c323ac6d6467af876722cef32fe088bfa91f05c49661ff1d4dd1e3155
```

These hashes describe the inspected concurrent snapshot. Rerun the gates against
the final integrated source; future revisions are not certified by this report.
