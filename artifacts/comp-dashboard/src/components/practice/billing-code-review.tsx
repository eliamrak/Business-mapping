import { useEffect, useId, useRef, useState } from "react";
import { Eye, RefreshCw, Save, Undo2 } from "lucide-react";
import { customFetch } from "@workspace/api-client-react";
import type { BillingResolution } from "@workspace/practice/hub";

type Source = { choiceToken: string; snapshotId: string; sourceHash: string; importedAt: string; billingCode: string | null };
type Candidate = {
  caseToken: string; clientReference: string; clinicianLabel: string; serviceDate: string;
  totalFeeCharged: number; sources: Source[]; canResolve: boolean; reason: string | null;
  resolutionId: string | null; selectedChoiceToken: string | null; stale: boolean;
};
type Candidates = { revision: number; candidates: Candidate[] };
type Props = { revision: number; sourceKey: string; onSaved: (resolutions: BillingResolution[], revision: number) => void };
type Saved = { billingResolutions: BillingResolution[]; billingResolutionRevision: number };
const endpoint = "/api/practice-imports/billing-code-resolutions";
const code = (value: string | null) => value?.trim() || "No billing code";
const money = (value: number) => value.toLocaleString("en-US", { style: "currency", currency: "USD" });

export function BillingCodeReview(props: Props) {
  return <BillingCodePanel key={JSON.stringify([props.revision, props.sourceKey])} {...props} />;
}

function BillingCodePanel({ onSaved }: Props) {
  const [data, setData] = useState<Candidates | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [generation, setGeneration] = useState(0);
  const request = useRef(0);
  const writing = useRef(false);
  const mounted = useRef(true);

  async function load() {
    const ticket = ++request.current;
    setData(null); setError(""); setBusy(true);
    try {
      const value = await customFetch<Candidates>("/api/practice-imports/billing-code-candidates", { cache: "no-store" });
      if (!value || typeof value !== "object" || !Number.isInteger(value.revision) || value.revision < 0 || !Array.isArray(value.candidates)) {
        throw new Error("Invalid billing code review response.");
      }
      if (mounted.current && ticket === request.current) { setData(value); setGeneration(value => value + 1); }
    } catch {
      if (mounted.current && ticket === request.current) setError("Billing code review unavailable. Owner access is required. Reload to try again.");
    } finally {
      if (mounted.current && ticket === request.current) setBusy(false);
    }
  }
  useEffect(() => {
    mounted.current = true;
    void load();
    return () => { mounted.current = false; request.current++; };
  }, []);

  async function save(candidate: Candidate, choiceToken: string, note: string, undo: boolean) {
    if (!data || writing.current || busy || !note.trim() || (undo ? !candidate.resolutionId : !candidate.canResolve || !!candidate.resolutionId || !candidate.sources.some(source => source.choiceToken === choiceToken))) return;
    writing.current = true; setBusy(true); setError("");
    const expectedRevision = data.revision;
    // Removing the old form also invalidates its preview and confirmation after any write attempt.
    setData(null);
    try {
      const result = await customFetch<Saved>(undo ? `${endpoint}/${encodeURIComponent(candidate.resolutionId!)}/revoke` : endpoint, {
        method: "POST", body: JSON.stringify(undo
          ? { expectedRevision, approvalNote: note.trim(), confirmed: true }
          : { caseToken: candidate.caseToken, choiceToken, expectedRevision, approvalNote: note.trim(), confirmed: true }),
      });
      if (!mounted.current) return;
      onSaved(result.billingResolutions, result.billingResolutionRevision);
      await load();
    } catch (cause) {
      if (mounted.current) setError(cause && typeof cause === "object" && "status" in cause && cause.status === 409
        ? "Evidence or approval revision changed. Reload and review again; the old preview is no longer valid."
        : "Code choice was not confirmed. Reload the current journal before trying again.");
    } finally {
      writing.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  return <details className="pw-import-provenance pw-billing-code-review" style={{ minWidth: 0, maxWidth: "100%", overflowWrap: "anywhere" }}>
    <summary style={{ cursor: "pointer", paddingBlock: 8 }}><strong>Billing code conflicts</strong>{data ? ` (${data.candidates.length})` : ""}</summary>
    <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
      <p style={{ flex: "1 1 150px" }}>Owner review{data ? ` · Journal revision ${data.revision}` : ""}</p>
      <button type="button" className="pw-button" title="Reload billing code conflicts" aria-label="Reload billing code conflicts" disabled={busy} onClick={() => void load()}><RefreshCw size={16} /></button>
    </div>
    {error && <p role="alert">{error}</p>}
    {busy && <p role="status">Loading current billing code review...</p>}
    {data?.candidates.length === 0 && <p>No billing code conflicts require review.</p>}
    {data?.candidates.map(candidate => <BillingCodeCase key={`${generation}:${candidate.caseToken}`} candidate={candidate} busy={busy} onSave={save} />)}
  </details>;
}

function BillingCodeCase({ candidate, busy, onSave }: {
  candidate: Candidate; busy: boolean;
  onSave: (candidate: Candidate, choiceToken: string, note: string, undo: boolean) => Promise<void>;
}) {
  const group = useId();
  const [choice, setChoice] = useState("");
  const [preview, setPreview] = useState(false);
  const [undo, setUndo] = useState(false);
  const [note, setNote] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const selected = candidate.sources.find(source => source.choiceToken === choice);
  const canChoose = candidate.canResolve && !candidate.resolutionId;
  const reset = () => { setPreview(false); setNote(""); setConfirmed(false); };
  return <details style={{ borderTop: "1px solid var(--pw-tone-border)", paddingBlock: 12, minWidth: 0 }}>
    <summary style={{ cursor: "pointer" }}><strong>{candidate.serviceDate} · {candidate.clinicianLabel}</strong><span> · {candidate.resolutionId ? candidate.stale ? "Stale code choice" : "Code choice applied" : "Unresolved"}</span></summary>
    <p>Private client reference: {candidate.clientReference}</p>
    <p>Charge: {money(candidate.totalFeeCharged)}</p>
    {candidate.stale && <p role="status">Source evidence changed. The previous choice no longer resolves this conflict.</p>}
    <fieldset disabled={busy} style={{ minWidth: 0, margin: 0, padding: 12, border: "1px solid var(--pw-tone-border)", borderRadius: 4 }}>
      <legend>Source billing codes</legend>
      {candidate.sources.map((source, index) => <label key={source.choiceToken} style={{ display: "flex", alignItems: "flex-start", gap: 8, paddingBlock: 8, minWidth: 0 }}>
        {canChoose && <input type="radio" name={group} value={source.choiceToken} checked={choice === source.choiceToken} onChange={() => { setChoice(source.choiceToken); reset(); }} style={{ flexShrink: 0, marginTop: 4 }} />}
        <span style={{ minWidth: 0 }}><strong>{code(source.billingCode)}</strong>{candidate.selectedChoiceToken === source.choiceToken && <span> · Previously chosen</span>}<br />Source {index + 1} · Imported {source.importedAt.slice(0, 10)}</span>
      </label>)}
    </fieldset>
    <details style={{ paddingBlock: 8 }}>
      <summary style={{ cursor: "pointer" }}>Source provenance</summary>
      {candidate.sources.map((source, index) => <div key={source.choiceToken} style={{ paddingBlock: 8 }}>
        <strong>Source {index + 1} · {code(source.billingCode)}</strong><br />
        Snapshot: {source.snapshotId}<br />Source hash: {source.sourceHash}<br />Imported: {source.importedAt}
      </div>)}
    </details>
    {candidate.reason && <p>{candidate.reason}</p>}
    {!canChoose && !candidate.resolutionId && <p>Code selection is unavailable until the evidence and provider mapping can be verified.</p>}
    {canChoose && <button type="button" className="pw-button" disabled={busy || !selected} onClick={() => { setPreview(true); setConfirmed(false); }} style={{ marginTop: 12, whiteSpace: "normal" }}><Eye size={16} />Preview impact</button>}
    {candidate.resolutionId && !undo && <button type="button" className="pw-button" disabled={busy} onClick={() => { setUndo(true); reset(); }} style={{ marginTop: 12 }}><Undo2 size={16} />Undo code choice</button>}
    {(preview && selected && canChoose || undo && candidate.resolutionId) && <form aria-label={undo ? "Undo code choice approval" : "Code choice approval"} onSubmit={event => { event.preventDefault(); if (confirmed && note.trim()) void onSave(candidate, choice, note, undo); }}>
      <div role="status" style={{ paddingBlock: 12 }}>
        <strong>{undo ? "Undo impact" : "Preview impact"}</strong>
        <p>{undo ? "Undo returns this case to an unresolved billing code conflict. It does not delete any source records." : `One billed charge of ${money(candidate.totalFeeCharged)} using ${code(selected!.billingCode)}.`}</p>
        <p>This does not certify attendance or report coverage. Raw sources are retained.</p>
        {!undo && candidate.sources.some(source => source.billingCode?.trim().toLowerCase() === "phone")
          && candidate.sources.some(source => source.billingCode?.trim() === "0")
          && <p>PHONE identifies a consultation; code 0 does not establish an appointment type. This billing choice does not rewrite attendance or confirm treatment.</p>}
      </div>
      <fieldset disabled={busy} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
        <label style={{ display: "grid", gap: 6 }}>Owner approval note<textarea required rows={2} maxLength={2000} value={note} onChange={event => { setNote(event.target.value); setConfirmed(false); }} style={{ width: "100%", minWidth: 0, boxSizing: "border-box", background: "var(--pw-tone-input)", color: "var(--pw-tone-text)", border: "1px solid var(--pw-tone-border-input)", borderRadius: 4, padding: 8 }} /></label>
        <label style={{ display: "flex", alignItems: "flex-start", gap: 8, marginBlock: 12 }}><input type="checkbox" required checked={confirmed} onChange={event => setConfirmed(event.target.checked)} style={{ flexShrink: 0, marginTop: 4 }} /><span>{undo ? "I confirm undoing this code choice and restoring the conflict." : "I confirm this source code choice for this one billed charge."}</span></label>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          <button type="submit" className="pw-button" disabled={busy || !confirmed || !note.trim()} style={{ whiteSpace: "normal" }}>{undo ? <Undo2 size={16} /> : <Save size={16} />}{undo ? "Confirm undo" : "Apply code choice"}</button>
          <button type="button" className="pw-button" onClick={() => { reset(); setUndo(false); }}>Cancel</button>
        </div>
      </fieldset>
    </form>}
  </details>;
}
