import type { SessionProgression } from "./session-progression.ts";

/** Aggregate display data only: never export client identifiers or raw source rows. */
export function progressionCsv(result: SessionProgression): string {
  const rounded = (value: number | null) => value === null ? "" : Number(value.toFixed(1));
  const rows: Array<Array<string | number>> = [
    ["Observed session progression — not eventual lifetime or dropout"],
    ["First observed treatment cohort start", result.start === "0000-01-01" ? "Earliest observed history" : result.start],
    ["First observed treatment cohort end", result.end],
    ["Observation cutoff (not coverage certification)", result.observedThrough],
    ["First-date clinician membership", result.clinician ?? "Whole Practice"],
    ["Clients with unresolved evidence", result.clientsWithUnresolvedEvidence],
    ["Session completed", "Eligible cohort", "Number reaching", "Percent reached", "Change (percentage points)"],
    ...result.rows.map(row => [row.session, row.eligibleClients, row.completions, rounded(row.reachedPct), rounded(row.changePercentagePoints)]),
    [],
    ["Observed first-to-last lifetime (not expected eventual lifetime)"],
    ["Group", "Clients", "Mean sessions", "Median sessions", "Mean elapsed days", "Median elapsed days", "Coverage-limited clients"],
    ...([
      ["Apparent endings (existing 90-day rule, not confirmed discharge)", result.lifetime.apparentEndings],
      ["Ongoing or not classifiable as ended (not all known active)", result.lifetime.ongoingOrCensored],
    ] as const).map(([label, group]) => [label, group.clients, rounded(group.meanSessions), rounded(group.medianSessions), rounded(group.meanElapsedDays), rounded(group.medianElapsedDays), group.coverageLimitedClients]),
    ["Missing earlier history may shorten all observed lifetimes; ongoing or unclassified observations are not completed lifetimes."],
  ];
  return rows.map(row => row.map(value => {
    const text = String(value);
    // Only text cells can be untrusted labels. Numeric negative changes stay numbers.
    const safe = typeof value === "string" && /^[\s]*[=+\-@\t\r]/.test(text) ? `'${text}` : text;
    return `"${safe.replaceAll('"', '""')}"`;
  }).join(",")).join("\r\n") + "\r\n";
}
