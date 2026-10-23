import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
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
  const restored = stripMobileWorkspace(source);
  assert.equal(restored, git("show", `${mobileBase}:${workspaceFile}`), "Only literal mobile JSX/import and guard-marker relocations may differ from approved workspace bytes");
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

// Existing publisher history outside runtime scope, not mobile deliverables.
// Contents remain protected by the publisher's separate pre/post hash guard.
export const publisherHistoryFiles = new Set([
  ".agents/memory/MEMORY.md",
  ".agents/memory/release-evidence-temp-files.md",
]);
