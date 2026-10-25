import { resolveHistoricalBillingProvider, type ImportDeclarations } from "@workspace/practice/hub";

/** Known departed clinicians are expected exclusions; unmapped/ambiguous identities remain actionable. */
export function actionableImportLabels(missing: readonly string[], ambiguous: readonly string[], roster: readonly {id:number;label:string}[], currentIds: readonly number[], declarations?: ImportDeclarations | null) {
 const normalize=(value:string)=>value.trim().toLowerCase().replace(/\s+/g,' ');
 return [...new Set([...missing.filter(label=>{
  const matches=roster.filter(person=>normalize(person.label)===normalize(label));
  // Billing-only registration changes presentation, never attendance eligibility.
  // Roster collisions and explicit clinician mappings must remain actionable.
  if (matches.length === 0 && resolveHistoricalBillingProvider(label, roster, declarations) !== null) return false;
  return matches.length!==1 || currentIds.includes(matches[0].id);
 }),...ambiguous])];
}
