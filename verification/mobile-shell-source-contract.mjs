import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import path from "node:path";

export const root = path.resolve(import.meta.dirname, "..");
export const mobileBase = "72dc5fb7da9e7dce7dcb0eb57697edcb790083d7";
export const workspaceFile = "artifacts/comp-dashboard/src/pages/practice-workspace.tsx";
export const mobileComponentFile = "artifacts/comp-dashboard/src/components/practice/mobile-workspace-controls.tsx";
export const mobileCssFile = "artifacts/comp-dashboard/src/components/practice/mobile-workspace-controls.css";
export const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" });

// Literal reviewed fragments, not patterns that could absorb unrelated JSX or logic.
const additions = [
  'import { MobileWorkspaceNavigation, MobilePageActions, MobileContributorSelect } from "@/components/practice/mobile-workspace-controls";\n',
  `        <MobileWorkspaceNavigation name={workspace.settings.practiceName} disabled={saving || sessionEditing}
          modes={([
            { id: "practice", label: "Today" },
            { id: "goals", label: "Long Term Goals" },
            { id: "sandbox", label: "Sandbox" },
          ] as const).map(item => ({ ...item, selected: mode === item.id, onSelect: () => navigate(item.id) }))}
          sections={sections.map(item => ({ id: item.id, label: item.label,
            selected: mode === "practice" && (section === item.id || item.active?.includes(section)),
            onSelect: () => { if (mode !== "practice") navigate("practice"); if (integratedTool) showTool(null); setSection(item.id); } }))}
          utilities={[
            { id: "imports", label: "Data & imports", selected: mode === "practice" && section === "retention", onSelect: () => { if (mode !== "practice") navigate("practice"); if (integratedTool) showTool(null); setSection("retention"); } },
            { id: "settings", label: "Settings", selected: mode === "practice" && section === "settings", onSelect: () => { setMode("practice"); setSection("settings"); } },
          ]}
          referenceHref={!sandbox ? ${'`${import.meta.env.BASE_URL}reference`'} : undefined} />
`,
  '          <MobilePageActions viewControl={toolTabs.length > 0 ? <label>View<select aria-label="Page view" value={visibleTool ?? "overview"} disabled={saving || sessionEditing} onChange={event => showTool(event.target.value === "overview" ? null : event.target.value as IntegratedTool)}>{toolTabs.map(tab => <option key={tab.id ?? "overview"} value={tab.id ?? "overview"}>{tab.label}</option>)}</select></label> : undefined}>\n',
  '          </MobilePageActions>\n',
  '                  <MobileContributorSelect label="Sessions clinician" names={contributorNames} value={selectedContributorName} compare={compareWholePractice} onCompare={() => setCompareWholePractice(true)} onChange={name => { setSharedContributor(name); setCompareWholePractice(false); }} />\n',
  '                  <MobileContributorSelect label="Overview clinician" names={contributorNames} value={selectedContributorName} onChange={setSharedContributor} />\n',
];

// Reviewed observed-progression integration: exact literals keep unrelated workspace logic protected.
const progressionAdditions = [
  'import { SessionProgressionPanel } from "@/components/practice/session-progression-panel";\n',
  `                      <div data-widget-id="session-progression" data-widget-title="Session progression & observed lifetime" data-widget-size="wide">
                        <SessionProgressionPanel
                          snapshots={historicalClinicalSnapshots}
                          classificationSnapshots={localRetentionState.snapshots}
                          excludedFollowUpEvidence={excludedFollowUpEvidence}
                          overrides={localRetentionState.sameDayVisitOverrides}
                          start={periodRange.start} end={periodRange.end} asOf={today}
                          clinician={compareWholePractice || selectedContributorName === "Whole Practice" ? undefined : selectedContributorName}
                          identityVerified={compareWholePractice || selectedContributorName === "Whole Practice" || hasUniqueClinicianIdentity(context.clinicians, selectedContributorName, workspace.settings.teamId)}
                          comparisonMode={compareWholePractice}
                          coverage={completeClinicalReports}
                        />
                      </div>
`,
];

const relocations = [
  ['<header className="pw-rail pw-top-navigation" aria-label="Practice navigation">', '<header className="pw-rail pw-top-navigation" aria-label="Practice navigation" data-unsaved-navigation>'],
  ['className="pw-mobile-settings"\n            data-unsaved-navigation\n', 'className="pw-mobile-settings"\n'],
  ['<nav className="pw-workspace-navigation" aria-label="Main navigation" data-unsaved-navigation>', '<nav className="pw-workspace-navigation" aria-label="Main navigation">'],
  ['<nav className="pw-today-navigation" aria-label="Practice sections" data-unsaved-navigation>', '<nav className="pw-today-navigation" aria-label="Practice sections">'],
  ['<div className="pw-rail-bottom" data-unsaved-navigation>', '<div className="pw-rail-bottom">'],
];

function replaceOnce(source, fragment, replacement) {
  assert.equal(source.split(fragment).length - 1, 1, `Expected exactly one reviewed fragment: ${fragment.slice(0, 100)}`);
  return source.replace(fragment, replacement);
}

export function stripMobileWorkspace(source) {
  for (const fragment of additions) source = replaceOnce(source, fragment, "");
  for (const [fragment, replacement] of relocations) source = replaceOnce(source, fragment, replacement);
  return source;
}

export function assertMobileWorkspace(source) {
  for (const fragment of progressionAdditions) source = replaceOnce(source, fragment, "");
  // Two reviewed Today Money/Goals props, separately bounded from the mobile JSX.
  source = replaceOnce(source, '                    costSource="budget"\n                    estimatedBudgetMonth={currentMoneyPlanning?.budgetEstimate}\n', '                    costSource="budget"\n');
  source = replaceOnce(source, '                  <ProfitFirstPlanning renderMode="funding" costSource="budget" workspace={planningWorkspace} context={modelContext ?? context}\n                    estimatedBudgetMonth={currentMoneyPlanning?.budgetEstimate}\n', '                  <ProfitFirstPlanning renderMode="funding" costSource="budget" workspace={planningWorkspace} context={modelContext ?? context}\n');
  const restored = stripMobileWorkspace(source);
  assert.equal(restored, git("show", `${mobileBase}:${workspaceFile}`), "Only literal mobile JSX/import, guard-marker relocations, the two reviewed financial props and literal reviewed progression integration may differ from approved workspace bytes");
  return restored;
}

export const mobileAllowedFiles = new Set([
  workspaceFile, mobileComponentFile, mobileCssFile,
  "verification/mobile-shell.test.mjs",
  "verification/mobile-shell-source-contract.mjs",
  "verification/mobile-shell-acceptance.mjs",
  "verification/tidal-theme.test.mjs",
  "verification/MOBILE-SHELL-INDEPENDENT-REVIEW.md",
  "verification/OCTOBER23-MOBILE-SHELL-RECEIPT.md",
]);

// Financial repair is independently reviewed; no API/core directory exemption.
export const financialAllowedFiles = new Set([
  workspaceFile,
  "artifacts/comp-dashboard/src/lib/profit-first-planning.ts",
  "artifacts/comp-dashboard/src/lib/money-planning-forecast.ts",
  "artifacts/comp-dashboard/src/lib/financial-fixed-date.test.ts",
  "verification/FINANCIAL-BUDGET-INDEPENDENT-REVIEW.md",
  "verification/OCTOBER23-FINANCIAL-BASELINE-RECEIPT.md",
]);

// Existing publisher history outside runtime scope, not mobile deliverables.
// Contents remain protected by the publisher's separate pre/post hash guard.
export const publisherHistoryFiles = new Set([
  ".agents/memory/MEMORY.md",
  ".agents/memory/release-evidence-temp-files.md",
]);

// Prior accepted readiness follow-up, not permission for new runtime changes.
// Publisher pre/post preservation must retain these exact bytes as well.
export const reviewedMobileReadiness = new Map([
  ["artifacts/comp-mobile/server/serve.js", "d0161767d8de2ed7320e982faa5e484ad455bbe3cc2a18dea591567320c78be4"],
  ["verification/OCTOBER22-MOBILE-READINESS-RECEIPT.md", "1ffa0d30c418575dfff1a8b001bf731df1b57781b9d13f95145db872d0d189ae"],
  ["verification/mobile-readiness.test.cjs", "794a0f9fa5b8a8e18fae4270b712d312e449c4c74a0bb123c2ee42669d42aab1"],
]);

export function assertReviewedMobileReadiness(file, bytes) {
  assert.ok(reviewedMobileReadiness.has(file), `Unreviewed readiness path: ${file}`);
  assert.equal(createHash("sha256").update(bytes).digest("hex"), reviewedMobileReadiness.get(file), `Reviewed mobile readiness bytes changed: ${file}`);
}

// Frozen reviewed progression source 19942df, plus reviewed contrast-only CSS/harness follow-up.
// Exact hashes remain required; no directory/prefix exemptions.
export const reviewedSessionProgression = new Map([
  ["artifacts/comp-dashboard/src/components/practice/session-progression-panel.css", "249474170d77c401228356f9adb17b5c21ac84627deb7685d7216cbbbcc9350d"],
  ["artifacts/comp-dashboard/src/components/practice/session-progression-panel.tsx", "09f23c328abecba1694dced7e5bcc04fb7577c920c6b1d99fad37e223e2dc53d"],
  ["artifacts/comp-dashboard/src/lib/session-progression-export.test.ts", "8d803ca30c858723ffd87a6ed52a2d8cfcdf03109e9f1d0edd9b071cf08132c9"],
  ["artifacts/comp-dashboard/src/lib/session-progression-export.ts", "007be5ec41ce27dfdeb5d11a0f0abf6023010c5d2455f9ab7ab8c5b2f8aa8bd3"],
  ["artifacts/comp-dashboard/src/lib/session-progression.test.ts", "cefb49bebefb46886ebb74b5441b593cbf4c914799df5d970b684b94c064650d"],
  ["artifacts/comp-dashboard/src/lib/session-progression.ts", "cc27b24dbfb9ef5795895351aef30306f44e7a5b7bed110977c128b9270ad062"],
  ["design-qa.md", "b677ea28e84138185cf623153b24ec88b9de1b7147b739431babf8f229fb4e04"],
  ["docs/session-progression-contract.md", "ac5282496da058e4105b1e5ad32bbb9a8a582e0dca4a23ee8637ef94a43eb990"],
  ["verification/SESSION-PROGRESSION-UI.md", "0cd46622ccf1295962702e8ac94b3a18488915d03b5a4c595c6930af5f55f03c"],
  ["verification/session-progression-browser-report.json", "e2268fb63d4a372a5d6460a824ef198e6d46aad1623936e80aa8618c43b005d1"],
  ["verification/session-progression-render.mjs", "c40c9086e923b1c69cda892e1725037aecce42987a83fb409186f944b2823958"],
]);

export function assertReviewedSessionProgression(file, bytes) {
  assert.ok(reviewedSessionProgression.has(file), `Unreviewed progression path: ${file}`);
  assert.equal(createHash("sha256").update(bytes).digest("hex"), reviewedSessionProgression.get(file), `Reviewed progression bytes changed: ${file}`);
}
