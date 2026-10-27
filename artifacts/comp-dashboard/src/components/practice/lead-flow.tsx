import { consultationLeadMonth, importedConsultationRates, type ConsultationLeadSource } from '@/lib/consultation-lead-flow';
import { useState } from "react";
import { useUnsaved } from "@/components/hub/use-unsaved";
import { MoreHorizontal, Plus, Save, Trash2 } from "lucide-react";
import type { Context, Workspace } from "@workspace/practice/hub";
import BulkLeadEntry from "./bulk-lead-entry";
import type { LeadBulkChange } from "@/lib/bulk-lead-flow";
import { leadFlowRates } from "@/lib/lead-flow-rates";
import { HelpBubble } from "./help-bubble";

const rateDefinitions = {
  "Schedule rate": "Recorded scheduled consults divided by leads; imported outcomes are shown separately",
  "Show rate": "Attended consults divided by scheduled consults",
  "Consult close rate": "Recorded booked clients divided by recorded attended consults; unchanged manual funnel basis, separate from imported appointment counts",
  "Overall close rate": "Recorded booked clients divided by recorded leads; booked does not mean attended treatment",
} as const;
function RateLabel({ name }: { name: keyof typeof rateDefinitions }) {
  return <span className="inline-flex items-center gap-1">{name}<HelpBubble label={`About ${name}`} text={rateDefinitions[name]} /></span>;
}

type Funnel = Workspace["funnels"][number];
type CountKey = "leads" | "scheduled" | "attended" | "clients";
type Entry = Pick<Funnel, "scope" | "campaignId" | "sourceName" | "clinicianId" | CountKey>;

const countFields: { key: CountKey; label: string }[] = [
  { key: "leads", label: "Leads" },
  { key: "scheduled", label: "Consults scheduled" },
  { key: "attended", label: "Consults attended" },
  { key: "clients", label: "Clients booked" },
];
const sourceKey = (row: Pick<Funnel, "campaignId" | "sourceName">) =>
  row.campaignId ?? `other:${row.sourceName.trim().toLowerCase() || "other"}`;
const total = (rows: Funnel[], key: CountKey) =>
  rows.length && rows.every((row) => row[key] !== null)
    ? rows.reduce((sum, row) => sum + (row[key] ?? 0), 0)
    : null;
const shown = (value: number | null) => value === null ? "-" : value.toLocaleString();
const validCount = (value: string) => value === "" || (/^\d+$/.test(value) && Number(value) <= 10_000_000);

function CountInput({ row, field, disabled, onPatch }: {
  row: Funnel;
  field: CountKey;
  disabled: boolean;
  onPatch: (id: string, patch: Partial<Funnel>) => void;
}) {
  const current = row[field];
  const [dirty, setDirty] = useState(false);
  useUnsaved(dirty);
  const label = countFields.find((item) => item.key === field)?.label ?? field;
  return <input
    key={`${row.id}:${field}:${current}`}
    aria-label={`${label} for ${row.scope === "practice" ? "whole practice" : row.sourceName || "campaign"}`}
    type="number" min="0" max="10000000" step="1"
    defaultValue={current ?? ""} disabled={disabled}
    onChange={(event) => setDirty(event.currentTarget.value !== (current == null ? "" : String(current)))}
    onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }}
    onBlur={(event) => {
      setDirty(false);
      const raw = event.currentTarget.value.trim();
      if (!validCount(raw)) {
        event.currentTarget.value = current === null ? "" : String(current);
        return;
      }
      const next = raw === "" ? null : Number(raw);
      if (next !== current) onPatch(row.id, { [field]: next });
    }}
  />;
}

export default function LeadFlow({
  workspace,
  consultationSource,
  context,
  readOnly,
  pending,
  canSave,
  onSaveEntry,
  onSaveBulk,
  onCompleteMonth,
  onPatch,
  onRemove,
  onSave,
  onOpenPeriods,
  onEditDetails,
  onAddCorrection,
}: {
  consultationSource?:ConsultationLeadSource;
  workspace: Workspace;
  context: Context;
  readOnly: boolean;
  pending: boolean;
  canSave: boolean;
  onSaveEntry: (month: string, entry: Entry, replacePracticeId?: string) => Promise<void>;
  onSaveBulk: (changes: LeadBulkChange[]) => Promise<void>;
  onCompleteMonth: (periodId: string) => Promise<void>;
  onPatch: (id: string, patch: Partial<Funnel>) => void;
  onRemove: (id: string) => void;
  onSave: () => void;
  onOpenPeriods: () => void;
  onEditDetails: (row: Funnel) => void;
  onAddCorrection: (periodId: string) => void;
}) {
  const [month, setMonth] = useState(() => new Date().toLocaleDateString("en-CA").slice(0, 7));
  const [year, setYear] = useState(() => new Date().getFullYear());
  const [view, setView] = useState<"year" | "month">("year");
  const [bulkDirty, setBulkDirty] = useState(false);
  const [entryMode, setEntryMode] = useState<"practice" | "source">("practice");
  const [replacePractice, setReplacePractice] = useState(false);
  const [draftSource, setDraftSource] = useState("");
  const [draftClinician, setDraftClinician] = useState("");
  const [draftCounts, setDraftCounts] = useState<Record<CountKey, string>>({ leads: "", scheduled: "", attended: "", clients: "" });
  const [entryError, setEntryError] = useState("");
  const [entrySaving, setEntrySaving] = useState(false);
  const [sourceEditing, setSourceEditing] = useState(false);
  const entryDirty = Object.values(draftCounts).some(value => value !== "") || !!draftSource || !!draftClinician;
  useUnsaved(bulkDirty || entryDirty || sourceEditing);
  function selectMonth(next: string) {
    if (next === month) return true;
    if (!window.dispatchEvent(new Event("emc-discard", { cancelable: true }))) return false;
    setMonth(next);
    setEntryMode("practice");
    setReplacePractice(false);
    setDraftCounts({ leads: "", scheduled: "", attended: "", clients: "" });
    setDraftSource("");
    setDraftClinician("");
    setEntryError("");
    return true;
  }
  const importedMonth=consultationSource&&/^\d{4}-(0[1-9]|1[0-2])$/.test(month)?consultationLeadMonth(consultationSource,month):null;
  const importedYear=consultationSource?Object.fromEntries(Array.from({length:12},(_,index)=>{
    const m=`${year}-${String(index+1).padStart(2,'0')}`;return [m,consultationLeadMonth(consultationSource,m)];
  })):undefined;
  const start = `${month}-01`;
  const end = month
    ? new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5)), 0)).toISOString().slice(0, 10)
    : "";
  const periods = workspace.periods.filter((period) => !period.archived);
  const selected = periods.find((period) => period.start === start && period.end === end);
  const overlap = !selected && periods.some((period) => period.start <= end && start <= period.end);
  const rows = workspace.funnels.filter((row) => row.periodId === selected?.id);
  const practiceRow = rows.find((row) => row.scope === "practice");
  const mode = replacePractice ? "source" : practiceRow ? "practice" : rows.length ? "source" : entryMode;
  const visibleRows = replacePractice ? [] : rows;
  const clinicians = context.clinicians.filter((person) =>
    (person.goalId ?? null) === workspace.settings.teamId,
  );
  const campaigns = workspace.campaigns.filter((campaign) => !campaign.archived);
  const sourceFor = (name: string) => {
    const trimmed = name.trim();
    const campaign = workspace.campaigns.find((item) => item.name.toLowerCase() === trimmed.toLowerCase());
    return { campaignId: campaign?.id ?? null, sourceName: campaign ? "" : trimmed };
  };
  const sourceLabel = (row: Funnel) => workspace.campaigns.find((item) => item.id === row.campaignId)?.name ?? row.sourceName;
  const candidate = { ...sourceFor(draftSource), clinicianId: draftClinician ? Number(draftClinician) : null };
  const duplicate = mode === "source" && visibleRows.some((row) =>
    sourceKey(row) === sourceKey(candidate) &&
    (row.clinicianId === candidate.clinicianId || row.clinicianId === null || candidate.clinicianId === null),
  );
  const rowConflict = visibleRows.some((row, index) => visibleRows.some((other, otherIndex) =>
    otherIndex < index && sourceKey(row) === sourceKey(other) &&
    (row.clinicianId === other.clinicianId || row.clinicianId === null || other.clinicianId === null),
  ));
  const allCountsValid = countFields.every(({ key }) => validCount(draftCounts[key]));
  const anyCount = countFields.some(({ key }) => draftCounts[key] !== "");
  const canEnter = !!month && !readOnly && !overlap && selected?.status !== "finalized";
  const canSaveEntry = canEnter && !entrySaving && allCountsValid && anyCount &&
    (mode === "practice" || (!!draftSource.trim() && !duplicate));
  const attributed = [...new Set(rows.map((row) => row.clinicianId)
    .filter((id): id is number => id !== null))].map((id) => {
      const personRows = rows.filter((row) => row.clinicianId === id);
      return {
        id,
        name: context.clinicians.find((person) => person.id === id)?.label ?? `Clinician ${id}`,
        counts: {
          leads: total(personRows, "leads"),
          scheduled: total(personRows, "scheduled"),
          attended: total(personRows, "attended"),
          clients: total(personRows, "clients"),
        },
      };
    });
  const practiceRates = practiceRow ? leadFlowRates(practiceRow) : null;
  const totals = {
    leads: total(visibleRows, "leads"),
    scheduled: total(visibleRows, "scheduled"),
    attended: total(visibleRows, "attended"),
    clients: total(visibleRows, "clients"),
  };
  const totalRates = leadFlowRates(totals);
  const monthReady = rows.length > 0 && rows.every((row) =>
    row.leads !== null && row.scheduled !== null && row.attended !== null && row.clients !== null,
  );

  async function saveEntry() {
    if (!canSaveEntry) return;
    setEntryError("");
    setEntrySaving(true);
    try {
      await onSaveEntry(month, {
        scope: mode,
        ...(mode === "practice" ? { campaignId: null, sourceName: "", clinicianId: null } : candidate),
        leads: draftCounts.leads === "" ? null : Number(draftCounts.leads),
        scheduled: draftCounts.scheduled === "" ? null : Number(draftCounts.scheduled),
        attended: draftCounts.attended === "" ? null : Number(draftCounts.attended),
        clients: draftCounts.clients === "" ? null : Number(draftCounts.clients),
      }, replacePractice ? practiceRow?.id : undefined);
      setDraftCounts({ leads: "", scheduled: "", attended: "", clients: "" });
      setDraftSource("");
      setDraftClinician("");
      setReplacePractice(false);
    } catch (error) {
      setEntryError(error instanceof Error ? error.message : "Could not save this month.");
    } finally {
      setEntrySaving(false);
    }
  }

  async function finishMonth() {
    if (!selected || !monthReady) return;
    setEntryError("");
    setEntrySaving(true);
    try {
      await onCompleteMonth(selected.id);
    } catch (error) {
      setEntryError(error instanceof Error ? error.message : "Could not finish this month.");
    } finally {
      setEntrySaving(false);
    }
  }

  const draftFields = <div className="pw-lead-flow-fields">
    {countFields.map(({ key, label }) => <label key={key}>{label}
      <input aria-label={`New ${label.toLowerCase()}`} type="number" min="0" max="10000000" step="1"
        placeholder="-" value={draftCounts[key]}
        onChange={(event) => setDraftCounts((prior) => ({ ...prior, [key]: event.target.value }))} />
    </label>)}
  </div>;

  return <section className="pw-lead-flow" aria-label="Lead flow">
    <div className="pw-lead-flow-view" role="group" aria-label="Lead flow view">
      <button type="button" className={view === "year" ? "active" : ""} aria-pressed={view === "year"}
        onClick={() => setView("year")}>Year totals</button>
      <button type="button" className={view === "month" ? "active" : ""} aria-pressed={view === "month"}
        disabled={bulkDirty} title={bulkDirty ? "Save or discard changed months first" : undefined}
        onClick={() => setView("month")}>Month details</button>
    </div>
    {view === "year" ? <BulkLeadEntry workspace={workspace} readOnly={readOnly} pending={pending}
      consultations={importedYear} year={year} onYearChange={setYear} onDirtyChange={setBulkDirty} onSave={onSaveBulk}
      onOpenMonth={(next) => { if (selectMonth(next)) setView("month"); }} /> : <>
    <div className="pw-lead-flow-top">
      <label className="pw-lead-flow-month">Month
        <input aria-label="Lead flow month" type="month" value={month}
          onChange={(event) => selectMonth(event.target.value)} />
      </label>
      {pending && !readOnly && <button className="pw-button pw-primary" type="button" disabled={!canSave || entrySaving}
        onClick={onSave}><Save /> Save edits</button>}
    </div>

    {importedMonth && <section aria-label="Imported consultation outcomes">
      <h3>Consultations · {month}</h3>
      <div className="pw-lead-flow-totals">
       <div><span>Consults scheduled</span><strong>{shown(importedMonth.scheduled)}</strong></div>
       <div><span>Consults attended</span><strong>{shown(importedMonth.attended)}</strong></div>
       <div><span>Did not attend</span><strong>{shown(importedMonth.didNotAttend)}</strong></div>
       <div><span>Schedule rate</span><strong>{importedConsultationRates(importedMonth,rowConflict?null:total(rows,'leads'),selected?.funnelComplete).scheduledConsult}</strong>{importedConsultationRates(importedMonth,rowConflict?null:total(rows,'leads'),selected?.funnelComplete).scheduleProvisional&&<small>Provisional leads</small>}</div>
       <div><span>Show rate</span><strong>{importedConsultationRates(importedMonth,null).show}</strong></div>
       <div><RateLabel name="Consult close rate" /><strong>{practiceRates?.consultClose??totalRates.consultClose}</strong></div>
       <div><RateLabel name="Overall close rate" /><strong>{practiceRates?.overallClose??totalRates.overallClose}</strong></div>
      </div>
      {importedMonth.reason&&<p>{importedMonth.reason}; counts are unknown, not zero.</p>}
      <details><summary>Counts and source</summary><p>{importedMonth.status==='unavailable'?'Accepted subset only. ':''}Did not attend: {importedMonth.observed.clientCancelled} cancelled, {importedMonth.observed.lateCancelled} late cancelled, {importedMonth.observed.noShow} no-show. Clinician cancelled: {shown(importedMonth.clinicianCancelled)} (excluded from scheduled and show rate).</p><p>Appointment records, not unique people. Schedule rate compares appointments with same-month reported leads; it is not linked lead conversion and can exceed 100%. Booked clients are not attended treatment. Rescheduled visits retain their separate recorded outcomes.</p></details>
    </section>}
    <details open={!importedMonth}><summary>Recorded funnel entries and source details</summary>
    {overlap ? <div className="pw-lead-flow-status">
      <p>This month overlaps a custom reporting period.</p>
      {!readOnly && <button className="pw-button" type="button" onClick={onOpenPeriods}>Review dates</button>}
    </div> : <>
      {!rows.length && <div className="pw-lead-flow-mode" role="group" aria-label="How to enter this month">
        <button type="button" className={mode === "practice" ? "active" : ""}
          aria-pressed={mode === "practice"} disabled={readOnly || !month}
          onClick={() => setEntryMode("practice")}>Practice total</button>
        <button type="button" className={mode === "source" ? "active" : ""}
          aria-pressed={mode === "source"} disabled={readOnly || !month}
          onClick={() => setEntryMode("source")}>By source or clinician</button>
      </div>}

      {mode === "practice" ? <div className="pw-lead-flow-practice">
        <div className="pw-lead-flow-section-head">
          <h3>{practiceRow ? "Recorded funnel entries" : "This month's numbers"}</h3>
          {practiceRow && !readOnly && selected?.status !== "finalized" &&
            <button className="pw-button" type="button" onClick={() => setReplacePractice(true)}>
              Break down this month
            </button>}
        </div>
        {practiceRow ? <>
          <div className="pw-lead-flow-fields">
            {countFields.map(({ key, label }) => <label key={key}>{label}
              <CountInput row={practiceRow} field={key} disabled={readOnly || selected?.status === "finalized"} onPatch={onPatch} />
            </label>)}
          </div>
          <div className="pw-lead-flow-result">
            <span><RateLabel name="Schedule rate" /> <strong>{practiceRates?.scheduledConsult}</strong></span>
            <span><RateLabel name="Show rate" /> <strong>{practiceRates?.show}</strong></span>
            <span><RateLabel name="Consult close rate" /> <strong>{practiceRates?.consultClose}</strong></span>
            <span><RateLabel name="Overall close rate" /> <strong>{practiceRates?.overallClose}</strong></span>
            {!readOnly && <button className="pw-icon" type="button" title="More result details" aria-label="More result details"
              disabled={pending} onClick={() => onEditDetails(practiceRow)}><MoreHorizontal /></button>}
          </div>
        </> : canEnter ? <>
          {draftFields}
          <button className="pw-button pw-primary pw-lead-flow-submit" type="button" disabled={!canSaveEntry}
            onClick={() => void saveEntry()}><Save /> {entrySaving ? "Saving..." : "Save month"}</button>
        </> : <p className="pw-lead-flow-note">No lead data recorded for this month.</p>}
      </div> : <div className="pw-lead-flow-breakdown">
        <div className="pw-lead-flow-section-head">
          <h3>Sources and clinicians</h3>
          {replacePractice && <button className="pw-button" type="button" onClick={() => setReplacePractice(false)}>
            Keep practice total
          </button>}
        </div>
        {replacePractice && <p className="pw-lead-flow-note">Saving the first detailed row will replace this month's practice total.</p>}
        {rowConflict && <p className="pw-error" role="alert">These rows overlap. Give each source and clinician one row, or remove the unassigned total.</p>}
        {!!visibleRows.length && <div className="pw-table-scroll"><table className="pw-table pw-lead-flow-table">
          <thead><tr><th>Source</th><th>Clinician</th><th>Leads</th><th>Scheduled</th><th>Attended</th><th>Booked</th>
            <th><RateLabel name="Schedule rate" /></th>
            <th><RateLabel name="Show rate" /></th>
            <th><RateLabel name="Consult close rate" /></th>
            <th><RateLabel name="Overall close rate" /></th>
            <th aria-label="Actions" /></tr></thead>
          <tbody>{visibleRows.map((row) => {
            const locked = readOnly || selected?.status === "finalized";
            const rowRates = leadFlowRates(row);
            return <tr key={row.id}>
              <td><input aria-label="Lead source" list="pw-lead-sources" maxLength={120}
                key={`${row.id}:source:${sourceLabel(row)}`} defaultValue={sourceLabel(row)} disabled={locked}
                onChange={(event) => setSourceEditing(event.currentTarget.value !== sourceLabel(row))}
                onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }}
                onBlur={(event) => {
                  setSourceEditing(false);
                  if (!event.currentTarget.value.trim()) {
                    event.currentTarget.value = sourceLabel(row);
                    return;
                  }
                  const next = sourceFor(event.currentTarget.value);
                  if (next.campaignId !== row.campaignId || next.sourceName !== row.sourceName)
                    onPatch(row.id, next);
                }} /></td>
              <td><select aria-label="Consulting clinician" value={row.clinicianId ?? ""} disabled={locked}
                onChange={(event) => onPatch(row.id, { clinicianId: event.target.value ? Number(event.target.value) : null })}>
                <option value="">Not assigned</option>
                {clinicians.map((person) => <option key={person.id} value={person.id}>{person.label}</option>)}
                {row.clinicianId !== null && !clinicians.some((person) => person.id === row.clinicianId) &&
                  <option value={row.clinicianId}>{context.clinicians.find((person) => person.id === row.clinicianId)?.label ?? `Clinician ${row.clinicianId}`}</option>}
              </select></td>
              {countFields.map(({ key }) => <td key={key}><CountInput row={row} field={key} disabled={locked} onPatch={onPatch} /></td>)}
              <td>{rowRates.scheduledConsult}</td>
              <td>{rowRates.show}</td>
              <td>{rowRates.consultClose}</td>
              <td>{rowRates.overallClose}</td>
              <td className="pw-lead-flow-row-actions">
                {!readOnly && <button className="pw-icon" type="button" title="More result details" aria-label="More result details"
                  disabled={pending} onClick={() => onEditDetails(row)}><MoreHorizontal /></button>}
                {!locked && <button className="pw-icon" type="button" title="Remove result row" aria-label="Remove result row"
                  onClick={() => onRemove(row.id)}><Trash2 /></button>}
              </td>
            </tr>;
          })}</tbody>
        </table></div>}
        {canEnter && <div className="pw-lead-flow-entry">
          <div className="pw-lead-flow-entry-heading">{visibleRows.length ? "Add another row" : "Add your first row"}</div>
          <div className="pw-lead-flow-entry-options">
            <label>Source
              <input aria-label="New lead source" list="pw-lead-sources" maxLength={120}
                placeholder="Google Ads, referral..." value={draftSource}
                onChange={(event) => setDraftSource(event.target.value)} />
            </label>
            <label>Consulting clinician
              <select aria-label="New consulting clinician" value={draftClinician}
                onChange={(event) => setDraftClinician(event.target.value)}>
                <option value="">Not assigned</option>
                {clinicians.map((person) => <option key={person.id} value={person.id}>{person.label}</option>)}
              </select>
            </label>
          </div>
          {draftFields}
          {duplicate && <p className="pw-error" role="alert">This source and clinician already have a row this month.</p>}
          <button className="pw-button pw-primary pw-lead-flow-submit" type="button" disabled={!canSaveEntry}
            onClick={() => void saveEntry()}><Plus /> {entrySaving ? "Saving..." : "Save row"}</button>
        </div>}
      </div>}

      <datalist id="pw-lead-sources">
        {campaigns.map((campaign) => <option key={campaign.id} value={campaign.name} />)}
        <option value="Referrals" />
      </datalist>
      {entryError && <p className="pw-error" role="alert">{entryError}</p>}
      {!!visibleRows.length && <div className="pw-lead-flow-completion">
        {selected?.funnelComplete ? <span>Month complete</span> : mode === "source" && !readOnly && selected?.status !== "finalized" &&
          <button className="pw-button" type="button" disabled={!monthReady || entrySaving}
            title={!monthReady ? "Enter leads, scheduled consults, attended consults, and booked clients in every row first" : undefined}
            onClick={() => void finishMonth()}>Finish this month</button>}
      </div>}
      {selected?.status === "finalized" && !readOnly && !practiceRow && <div className="pw-lead-flow-finalized">
        <p className="pw-lead-flow-note">This month is finalized. Changes need a correction reason.</p>
        <button className="pw-button" type="button" disabled={pending} onClick={() => onAddCorrection(selected.id)}>
          <Plus /> Add documented result
        </button>
      </div>}
      {!!visibleRows.length && mode === "source" && <div className="pw-lead-flow-totals" aria-label="Monthly lead flow totals">
        <div><span>Total leads</span><strong>{shown(totals.leads)}</strong></div>
        <div><span>Scheduled consults</span><strong>{shown(totals.scheduled)}</strong></div>
        <div><span>Attended consults</span><strong>{shown(totals.attended)}</strong></div>
        <div><span>Booked</span><strong>{shown(totals.clients)}</strong></div>
        <div><RateLabel name="Schedule rate" /><strong>{totalRates.scheduledConsult}</strong></div>
        <div><RateLabel name="Show rate" /><strong>{totalRates.show}</strong></div>
        <div><RateLabel name="Consult close rate" /><strong>{totalRates.consultClose}</strong></div>
        <div><RateLabel name="Overall close rate" /><strong>{totalRates.overallClose}</strong></div>
      </div>}
      {attributed.length > 0 && <div className="pw-lead-flow-people">
        <h4>Consult performance by clinician</h4>
        <div className="pw-table-scroll"><table className="pw-table">
          <thead><tr><th>Clinician</th><th>Leads</th><th>Scheduled</th><th>Attended</th><th>Booked</th>
            <th><RateLabel name="Schedule rate" /></th>
            <th><RateLabel name="Show rate" /></th>
            <th><RateLabel name="Consult close rate" /></th>
            <th><RateLabel name="Overall close rate" /></th></tr></thead>
          <tbody>{attributed.map(({ id, name, counts }) => {
            const rates = leadFlowRates(counts);
            const imported=consultationSource&&/^\d{4}-(0[1-9]|1[0-2])$/.test(month)?consultationLeadMonth(consultationSource,month,id):null;
            const observedRates=imported?importedConsultationRates(imported,counts.leads,selected?.funnelComplete):null;
            return <tr key={id}>
              <th>{name}</th>
              <td>{shown(counts.leads)}</td>
              <td>{shown(imported?imported.scheduled:counts.scheduled)}</td>
              <td>{shown(imported?imported.attended:counts.attended)}</td>
              <td>{shown(counts.clients)}</td>
              <td>{observedRates?.scheduledConsult??rates.scheduledConsult}{observedRates?.scheduleProvisional&&<small> provisional</small>}</td>
              <td>{observedRates?.show??rates.show}</td>
              <td>{rates.consultClose}</td>
              <td>{rates.overallClose}</td>
            </tr>;
          })}</tbody>
        </table></div>
      </div>}
    </>}
    </details>
    </>}
  </section>;
}
