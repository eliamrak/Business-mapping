/** Known departed clinicians are expected exclusions; unmapped/ambiguous identities remain actionable. */
export function actionableImportLabels(missing: readonly string[], ambiguous: readonly string[], roster: readonly {id:number;label:string}[], currentIds: readonly number[]) {
 const normalize=(value:string)=>value.trim().toLowerCase().replace(/\s+/g,' ');
 return [...new Set([...missing.filter(label=>{
  const matches=roster.filter(person=>normalize(person.label)===normalize(label));
  return matches.length!==1 || currentIds.includes(matches[0].id);
 }),...ambiguous])];
}
