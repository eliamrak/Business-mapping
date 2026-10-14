const canonical = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object")
    return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)]));
  return value;
};

/** Compact change detection over complete inputs; not used as a security digest. */
export function planInputSignature(inputs: unknown): string {
  const serialized = JSON.stringify(canonical(inputs));
  const hashes = [0x811c9dc5, 0x9e3779b9, 0x85ebca6b, 0xc2b2ae35];
  for (let index = 0; index < serialized.length; index++) {
    const code = serialized.charCodeAt(index);
    for (let lane = 0; lane < hashes.length; lane++)
      hashes[lane] = Math.imul(hashes[lane] ^ code, 0x01000193);
  }
  return `${serialized.length}:` + hashes.map((hash) => (hash >>> 0).toString(16).padStart(8, "0")).join("");
}

export function planRevisionSignature(snapshot: unknown, workspace: Record<string, unknown>, context: unknown, imports: unknown, overrides: unknown): string {
  const { focusedPlanAdoptions, proposals, ...operatingInputs } = workspace;
  return planInputSignature({ snapshot, workspace: operatingInputs, context, imports, overrides });
}

export function planFocusHighlights(focus: string[], values: Record<string, string>): string[] {
  return focus.flatMap((kpi) => values[kpi] ? [values[kpi]] : []).slice(0, 2);
}
