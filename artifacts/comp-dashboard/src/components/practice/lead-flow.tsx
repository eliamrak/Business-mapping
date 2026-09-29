import { useState } from "react";
import { MoreHorizontal, Plus, Save, Trash2 } from "lucide-react";
import type { Context, Workspace } from "@workspace/practice/hub";

type Funnel = Workspace["funnels"][number];
type CountKey = "leads" | "attended" | "clients";
type Entry = Pick<Funnel, "scope" | "campaignId" | "sourceName" | "clinicianId" | CountKey>;

const countFields: { key: CountKey; label: string }[] = [
  { key: "leads", label: "Leads" },
  { key: "attended", label: "Consults" },
  { key: "clients", label: "Clients booked" },
];
const sourceKey = (row: Pick<Funnel, "campaignId" | "sourceName">) =>
  row.campaignId ?? `other:${row.sourceName.trim().toLowerCase() || "other"}`;
const total = (rows: Funnel[], key: CountKey) =>
  rows.length && rows.every((row) => row[key] !== null)
    ? rows.reduce((sum, row) => sum + (row[key] ?? 0), 0)
    : null;
const shown = (value: number | null) => value === null ? "-" : value.toLocaleString();
const rate = (clients: number | null, attended: number | null) =>
  clients === null || attended === null || attended === 0
    ? "-"
    : `${Math.round(clients / attended * 100)}%`;
const validCount = (value: string) => value === "" || (/^\d+$/.test(value) && Number(value) <= 10_000_000);

function CountInput({ row, field, disabled, onPatch }: {
  row: Funnel;
  field: CountKey;
  disabled: boolean;
  onPatch: (id: string, patch: Partial<Funnel>) => void;
}) {
  const current = row[field];
  const label = countFields.find((item) => item.key === field)?.label ?? field;
  return <input
    key={`${row.id}:${field}:${current}`}
    aria-label={`${label} for ${row.scope === "practice" ? "whole practice" : row.sourceName || "campaign"}`}
    type="number" min="0" max="10000000" step="1"
    defaultValue={current ?? ""} disabled={disabled}
    onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }}
    onBlur={(event) => {
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
  context,
  readOnly,
  pending,
  canSave,
  onSaveEntry,
  onCompleteMonth,
  onPatch,
  onRemove,
  onSave,
  onOpenPeriods,
  onEditDetails,
  onAddCorrection,
}: {
  workspace: Workspace;
  context: Context;
  readOnly: boolean;
  pending: boolean;
  canSave: boolean;
  onSaveEntry: (month: string, entry: Entry, replacePracticeId?: string) => Promise<void>;
  onCompleteMonth: (periodId: string) => Promise<void>;
  onPatch: (id: string, patch: Partial<Funnel>) => void;
  onRemove: (id: string) => void;
  onSave: () => void;
  onOpenPeriods: () => void;
  onEditDetails: (row: Funnel) => void;
  onAddCorrection: (periodId: string) => void;
}) {
  const [month, setMonth] = useState(() => new Date().toLocaleDateString("en-CA").slice(0, 7));
  const [entryMode, setEntryMode] = useState<"practice" | "source">("practice");
  const [replacePractice, setReplacePractice] = useState(false);
  const [draftSource, setDraftSource] = useState("");
  const [draftClinician, setDraftClinician] = useState("");
  const [draftCounts, setDraftCounts] = useState<Record<CountKey, string>>({ leads: "", attended: "", clients: "" });
  const [entryError, setEntryError] = useState("");
  const [entrySaving, setEntrySaving] = useState(false);
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
    .filter((id): id is number => id !== null))].map((id) => ({
      id,
      name: context.clinicians.find((person) => person.id === id)?.label ?? `Clinician ${id}`,
      rows: rows.filter((row) => row.clinicianId === id),
    }));
  const monthReady = rows.length > 0 && rows.every((row) =>
    row.leads !== null && row.attended !== null && row.clients !== null,
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
        attended: draftCounts.attended === "" ? null : Number(draftCounts.attended),
        clients: draftCounts.clients === "" ? null : Number(draftCounts.clients),
      }, replacePractice ? practiceRow?.id : undefined);
      setDraftCounts({ leads: "", attended: "", clients: "" });
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
    <div className="pw-lead-flow-top">
      <label className="pw-lead-flow-month">Month
        <input aria-label="Lead flow month" type="month" value={month}
          onChange={(event) => {
            setMonth(event.target.value);
            setEntryMode("practice");
            setReplacePractice(false);
            setDraftCounts({ leads: "", attended: "", clients: "" });
            setDraftSource("");
            setDraftClinician("");
            setEntryError("");
          }} />
      </label>
      {pending && !readOnly && <button className="pw-button pw-primary" type="button" disabled={!canSave || entrySaving}
        onClick={onSave}><Save /> Save edits</button>}
    </div>

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
          <h3>{practiceRow ? "Recorded this month" : "This month's numbers"}</h3>
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
            <span>Close rate <strong>{rate(practiceRow.clients, practiceRow.attended)}</strong></span>
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
          <thead><tr><th>Source</th><th>Clinician</th><th>Leads</th><th>Consults</th><th>Booked</th><th>Close rate</th><th aria-label="Actions" /></tr></thead>
          <tbody>{visibleRows.map((row) => {
            const locked = readOnly || selected?.status === "finalized";
            return <tr key={row.id}>
              <td><input aria-label="Lead source" list="pw-lead-sources" maxLength={120}
                key={`${row.id}:source:${sourceLabel(row)}`} defaultValue={sourceLabel(row)} disabled={locked}
                onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }}
                onBlur={(event) => {
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
              <td>{rate(row.clients, row.attended)}</td>
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
            title={!monthReady ? "Enter leads, consults and booked clients in every row first" : undefined}
            onClick={() => void finishMonth()}>Finish this month</button>}
      </div>}
      {selected?.status === "finalized" && !readOnly && !practiceRow && <div className="pw-lead-flow-finalized">
        <p className="pw-lead-flow-note">This month is finalized. Changes need a correction reason.</p>
        <button className="pw-button" type="button" disabled={pending} onClick={() => onAddCorrection(selected.id)}>
          <Plus /> Add documented result
        </button>
      </div>}
      {!!visibleRows.length && mode === "source" && <div className="pw-lead-flow-totals" aria-label="Monthly lead flow totals">
        <div><span>Total leads</span><strong>{shown(total(visibleRows, "leads"))}</strong></div>
        <div><span>Consults</span><strong>{shown(total(visibleRows, "attended"))}</strong></div>
        <div><span>Booked</span><strong>{shown(total(visibleRows, "clients"))}</strong></div>
        <div><span>Close rate</span><strong>{rate(total(visibleRows, "clients"), total(visibleRows, "attended"))}</strong></div>
      </div>}
      {attributed.length > 0 && <div className="pw-lead-flow-people">
        <h4>Close rate by clinician</h4>
        <div className="pw-table-scroll"><table className="pw-table">
          <thead><tr><th>Clinician</th><th>Consults</th><th>Booked</th><th>Close rate</th></tr></thead>
          <tbody>{attributed.map(({ id, name, rows: personRows }) => <tr key={id}>
            <th>{name}</th>
            <td>{shown(total(personRows, "attended"))}</td>
            <td>{shown(total(personRows, "clients"))}</td>
            <td>{rate(total(personRows, "clients"), total(personRows, "attended"))}</td>
          </tr>)}</tbody>
        </table></div>
      </div>}
    </>}
  </section>;
}
