import { useState } from "react";
import { Save } from "lucide-react";
import { customFetch } from "@workspace/api-client-react";
import { normalizeProviderLabel, type ImportDeclarations, type StoredImportDeclarations } from "@workspace/practice/hub";
import type { LocalSnapshot } from "@/lib/retention-local";

export function ImportDeclarationReview({ snapshots, roster, teamId, stored, onSaved }: {
  snapshots: LocalSnapshot[];
  roster: Array<{ id: number; label: string; goalId?: number | null }>;
  teamId: number | null;
  stored: StoredImportDeclarations | null;
  onSaved: (value: StoredImportDeclarations | null) => void;
}) {
  const labels = [...new Map(snapshots.flatMap((source) => source.rows.map((row) => [normalizeProviderLabel(row.clinician), row.clinician] as const))).values()].sort();
  const [choices, setChoices] = useState<Record<string, string>>(() => Object.fromEntries([
    ...(stored?.data.mappings ?? []).filter((row) => row.teamId === teamId).map((row) => [normalizeProviderLabel(row.sourceLabel), String(row.clinicianId)]),
    ...(stored?.data.historicalBillingProviders ?? []).map((row) => [normalizeProviderLabel(row.sourceLabel), "historical"]),
  ]));
  const [sets, setSets] = useState(() => (["attendance", "billing"] as const).map((kind) => {
    const old = stored?.data.sourceSets.find((row) => row.kind === kind);
    return { kind, start: old?.start ?? "", end: old?.end ?? "", snapshotIds: old?.snapshotIds ?? [] as string[] };
  }));
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const retainedPeriodSets = (stored?.data.sourceSets ?? []).filter((set, index, all) => index !== all.findIndex(candidate => candidate.kind === set.kind));
  async function save() {
    setError("");
    const mappings = labels.filter((label) => choices[normalizeProviderLabel(label)] !== "historical").map((sourceLabel) => {
      const person = roster.find((row) => row.id === Number(choices[normalizeProviderLabel(sourceLabel)]) && (row.goalId ?? null) === teamId);
      if (!person) throw new Error(`Choose the intended clinician for ${sourceLabel}.`);
      return { sourceLabel, clinicianId: person.id, clinicianLabel: person.label, teamId };
    });
    const historicalLabels = labels.filter((label) => choices[normalizeProviderLabel(label)] === "historical");
    const billingSet = sets.find((set) => set.kind === "billing")!;
    if (historicalLabels.length && (!billingSet.snapshotIds.length || !billingSet.start || !billingSet.end)) throw new Error("Confirm the historical providers' billing sources and report dates.");
    const historicalBillingProviders = [
      ...(stored?.data.historicalBillingProviders ?? []).filter((provider) => !labels.some((label) => normalizeProviderLabel(label) === normalizeProviderLabel(provider.sourceLabel))),
      ...historicalLabels.map((sourceLabel) => ({
        id: stored?.data.historicalBillingProviders?.find((provider) => normalizeProviderLabel(provider.sourceLabel) === normalizeProviderLabel(sourceLabel))?.id ?? crypto.randomUUID(),
        sourceLabel, sourceSets: [{ snapshotIds: billingSet.snapshotIds, start: billingSet.start, end: billingSet.end, complete: true as const }],
      })),
    ];
    const data: ImportDeclarations = { version: 1, mappings,
      sourceSets: [...sets.filter((set) => set.snapshotIds.length).map((set) => ({ ...set, complete: true as const,
        clinicianIds: [...new Set(mappings.filter((mapping) => snapshots.some((source) => set.snapshotIds.includes(source.id)
          && source.rows.some((row) => normalizeProviderLabel(row.clinician) === normalizeProviderLabel(mapping.sourceLabel)))).map((row) => row.clinicianId))],
      })).filter((set) => set.clinicianIds.length > 0), ...retainedPeriodSets],
      ...(historicalBillingProviders.length || stored?.data.historicalBillingProviders ? { historicalBillingProviders } : {}),
    };
    const response = await customFetch<{ declarations: StoredImportDeclarations | null }>("/api/practice-imports/declarations", {
      method: "PUT", body: JSON.stringify({ expectedRevision: stored?.revision ?? 0, confirmed, data }),
    });
    onSaved(response.declarations);
    setConfirmed(false);
  }
  return <section className="pw-import-provenance" aria-label="Provider mappings and source-set coverage">
    <h3>Provider mappings and source-set coverage</h3>
    <p>Configuration {teamId ?? "Unassigned"} · {stored ? `confirmed revision ${stored.revision}` : "not confirmed"}</p>
    {retainedPeriodSets.length > 0 && <details><summary>Additional confirmed report periods ({retainedPeriodSets.length})</summary>
      <p>These period declarations are retained when legacy mappings are edited.</p>
      {retainedPeriodSets.map((set, index) => <p key={index}>{set.kind} · {set.start} through {set.end} · {set.snapshotIds.length} sources</p>)}
    </details>}
    <form onSubmit={(event) => { event.preventDefault(); setBusy(true); void save().catch((cause) => setError(cause instanceof Error ? cause.message : "Confirmation failed.")).finally(() => setBusy(false)); }}>
      <fieldset disabled={busy} style={{ minWidth: 0 }}>
        {labels.map((label) => <label key={normalizeProviderLabel(label)} style={{ display: "grid", gap: 4, marginBlock: 10 }}>{label}
          <select aria-label={`Map ${label}`} value={choices[normalizeProviderLabel(label)] ?? ""} required style={{ width: "100%", minWidth: 0 }} onChange={(event) => { setChoices({ ...choices, [normalizeProviderLabel(label)]: event.target.value }); setConfirmed(false); }}>
            <option value="">Choose provider identity</option>
            {roster.filter((person) => (person.goalId ?? null) === teamId && normalizeProviderLabel(person.label) === normalizeProviderLabel(label)).map((person) => <option key={person.id} value={person.id}>{person.label} · #{person.id}</option>)}
            {!roster.some((person) => normalizeProviderLabel(person.label) === normalizeProviderLabel(label))
              && snapshots.some((source) => source.kind === "billing" && source.rows.some((row) => normalizeProviderLabel(row.clinician) === normalizeProviderLabel(label)))
              && <option value="historical">Historical billing only · no clinician card</option>}
          </select>
        </label>)}
        {sets.map((set, index) => <fieldset key={set.kind} style={{ minWidth: 0, marginBlock: 12 }}>
          <legend>{set.kind === "attendance" ? "Attendance source set" : "Billing source set"}</legend>
          {snapshots.filter((source) => source.kind === set.kind).map((source) => <label key={source.id} style={{ display: "flex", alignItems: "flex-start", gap: 8, overflowWrap: "anywhere", marginBlock: 8 }}>
            <input type="checkbox" style={{ width: 16, height: 16, margin: 0, flexShrink: 0 }} checked={set.snapshotIds.includes(source.id)} onChange={(event) => { setSets(sets.map((row, i) => i === index ? { ...row, snapshotIds: event.target.checked ? [...row.snapshotIds, source.id] : row.snapshotIds.filter((id) => id !== source.id) } : row)); setConfirmed(false); }} />
            <span>{source.id} · observed {source.coverageStart} to {source.coverageEnd}</span>
          </label>)}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 8 }}>
            {(["start", "end"] as const).map((key) => <label key={key} style={{ display: "grid", gap: 4 }}>Complete {key}<input type="date" aria-label={`${set.kind} source-set ${key}`} required={set.snapshotIds.length > 0} value={set[key]} style={{ width: "100%", minWidth: 0 }} onChange={(event) => { setSets(sets.map((row, i) => i === index ? { ...row, [key]: event.target.value } : row)); setConfirmed(false); }} /></label>)}
          </div>
        </fieldset>)}
        <label style={{ display: "flex", alignItems: "flex-start", gap: 8 }}><input type="checkbox" style={{ width: 16, height: 16, margin: 0, flexShrink: 0 }} checked={confirmed} required onChange={(event) => setConfirmed(event.target.checked)} /><span>I confirm these provider identities, historical billing-only classifications, and that the selected source sets include all reported activity for their stated providers and dates. Individual files may be partial.</span></label>
        <button type="submit" className="pw-button" disabled={!confirmed || !labels.length || busy}><Save size={16} />Save confirmed declarations</button>
      </fieldset>
      {error && <p role="alert">{error}</p>}
    </form>
  </section>;
}
