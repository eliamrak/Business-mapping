import { useEffect, useState } from "react";
import { RefreshCw, Save } from "lucide-react";
import { customFetch } from "@workspace/api-client-react";
import type { BillingChargeResolution } from "@workspace/practice/hub";

type Candidate = {
  caseToken: string; clinicianLabel: string; serviceDate: string; billingCode: string;
  amounts: [number, number] | null; rawRowCount: number; sourceCount: number;
  resolutionId: string | null; stale: boolean; canAccept: boolean;
};
type Candidates = { revision: number; candidates: Candidate[] };
const money = (value: number) => value.toLocaleString("en-US", { style: "currency", currency: "USD" });

export function BillingResolutionReview({ revision, sourceKey, onSaved }: {
  revision: number; sourceKey: string;
  onSaved: (resolutions: BillingChargeResolution[], revision: number) => void;
}) {
  const [data, setData] = useState<Candidates | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function load() {
    setError("");
    setData(await customFetch<Candidates>("/api/practice-imports/billing-resolution-candidates"));
  }
  useEffect(() => {
    let current = true;
    setData(null);
    void customFetch<Candidates>("/api/practice-imports/billing-resolution-candidates").then((value) => {
      if (current) { setData(value); setError(""); }
    }).catch((cause) => { if (current) setError(cause instanceof Error ? cause.message : "Billing review unavailable."); });
    return () => { current = false; };
  }, [revision, sourceKey]);
  async function save(candidate: Candidate, approvalNote: string) {
    if (!candidate.amounts || !data) return;
    setBusy(true); setError("");
    try {
      const result = await customFetch<{ billingResolutions: BillingChargeResolution[]; billingResolutionRevision: number }>("/api/practice-imports/billing-resolutions", {
        method: "POST", body: JSON.stringify({ caseToken: candidate.caseToken, expectedRevision: data.revision,
          clinicianLabel: candidate.clinicianLabel, serviceDate: candidate.serviceDate, amounts: candidate.amounts,
          approvalNote, confirmed: true }),
      });
      onSaved(result.billingResolutions, result.billingResolutionRevision);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Exception was not saved.");
      setData(null);
    } finally { setBusy(false); }
  }
  return <section className="pw-import-provenance" aria-label="Billing charge exceptions">
    <h3>Billing charge exceptions</h3>
    <p>Approval journal revision {data?.revision ?? revision}. Source records and attendance counts are unchanged.</p>
    <button type="button" className="pw-button" title="Reload billing cases" aria-label="Reload billing cases" disabled={busy} onClick={() => { setBusy(true); void load().catch((cause) => setError(cause instanceof Error ? cause.message : "Billing review unavailable.")).finally(() => setBusy(false)); }}><RefreshCw size={16} /></button>
    {error && <p role="alert">{error}</p>}
    {!data && !error && <p role="status">Loading billing cases...</p>}
    {data?.candidates.length === 0 && <p>No billing cases require review.</p>}
    {data?.candidates.map((candidate) => <BillingCase key={`${candidate.caseToken}:${candidate.resolutionId ?? "pending"}`} candidate={candidate} busy={busy} onSave={save} />)}
  </section>;
}

function BillingCase({ candidate, busy, onSave }: { candidate: Candidate; busy: boolean; onSave: (candidate: Candidate, note: string) => Promise<void> }) {
  const [confirmed, setConfirmed] = useState(false);
  const [note, setNote] = useState("");
  return <form aria-label={`Billing case ${candidate.clinicianLabel} ${candidate.serviceDate}`} onSubmit={(event) => { event.preventDefault(); if (confirmed && note.trim()) void onSave(candidate, note.trim()); }} style={{ borderTop: "1px solid var(--pw-border, #ddd)", paddingBlock: 16, overflowWrap: "anywhere" }}>
    <strong>{candidate.clinicianLabel} · {candidate.serviceDate}</strong>
    <p>{candidate.billingCode} · {candidate.amounts ? candidate.amounts.map(money).join(" + ") : "Charge pair requires investigation"}</p>
    <p>{candidate.rawRowCount} original rows · {candidate.sourceCount} sources · {candidate.resolutionId ? "Accepted: two charges" : candidate.stale ? "Evidence changed: review required" : "Unresolved"}</p>
    {candidate.canAccept && <fieldset disabled={busy} style={{ minWidth: 0 }}>
      <label style={{ display: "grid", gap: 4, maxWidth: 640 }}>Owner approval note<textarea required rows={2} maxLength={2000} value={note} onChange={(event) => { setNote(event.target.value); setConfirmed(false); }} style={{ width: "100%", minWidth: 0, minHeight: 72, boxSizing: "border-box", border: "1px solid var(--pw-tone-border-input)", borderRadius: 4, background: "var(--pw-tone-input)", color: "var(--pw-tone-text)", padding: 8 }} /></label>
      <label style={{ display: "flex", gap: 8, alignItems: "flex-start", marginBlock: 12 }}><input type="checkbox" required checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} style={{ width: 16, height: 16, flexShrink: 0 }} /><span>I confirm both listed charges are valid for this exact case.</span></label>
      <button type="submit" className="pw-button" disabled={!confirmed || !note.trim() || busy}><Save size={16} />Accept two charges</button>
    </fieldset>}
    {!candidate.canAccept && !candidate.resolutionId && <p>Approval unavailable until the exact evidence and provider mapping can be verified.</p>}
  </form>;
}
