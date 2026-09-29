import { useState } from "react";
import { MoreHorizontal, Plus, Save, Trash2 } from "lucide-react";
import type { Context, Workspace } from "@workspace/practice/hub";

type Funnel = Workspace["funnels"][number];
type CountKey = "leads" | "scheduled" | "attended" | "clients";

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

function CountInput({ row, field, disabled, onPatch }: {
  row: Funnel;
  field: CountKey;
  disabled: boolean;
  onPatch: (id: string, patch: Partial<Funnel>) => void;
}) {
  const current = row[field];
  return (
    <input
      key={`${row.id}:${field}:${current}`}
      aria-label={`${field} for ${row.sourceName || "campaign"}`}
      type="number"
      min="0"
      max="10000000"
      step="1"
      defaultValue={current ?? ""}
      disabled={disabled}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
      }}
      onBlur={(event) => {
        const raw = event.currentTarget.value.trim();
        const next = raw === "" ? null : Number(raw);
        if (next !== null && (!Number.isInteger(next) || next < 0 || next > 10_000_000)) {
          event.currentTarget.value = current === null ? "" : String(current);
        } else if (next !== current) {
          onPatch(row.id, { [field]: next });
        }
      }}
    />
  );
}

export default function LeadFlow({
  workspace,
  context,
  readOnly,
  pending,
  canSave,
  onAdd,
  onAddMonth,
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
  onAdd: (periodId: string, campaignId: string | null, sourceName: string, clinicianId: number | null) => void;
  onAddMonth: (month: string) => string | null;
  onPatch: (id: string, patch: Partial<Funnel>) => void;
  onRemove: (id: string) => void;
  onSave: () => void;
  onOpenPeriods: () => void;
  onEditDetails: (row: Funnel) => void;
  onAddCorrection: (periodId: string) => void;
}) {
  const periods = workspace.periods.filter((period) => !period.archived)
    .sort((a, b) => b.start.localeCompare(a.start));
  const [periodChoice, setPeriodChoice] = useState("");
  const [newMonth, setNewMonth] = useState(() => new Date().toLocaleDateString("en-CA").slice(0, 7));
  const [campaignChoice, setCampaignChoice] = useState("");
  const [sourceName, setSourceName] = useState("Other");
  const [clinicianChoice, setClinicianChoice] = useState("");
  const today = new Date().toLocaleDateString("en-CA");
  const selected = periods.find((period) => period.id === periodChoice) ??
    periods.find((period) => period.end < today) ?? periods[0];
  const monthStart = `${newMonth}-01`;
  const monthEnd = newMonth
    ? new Date(Date.UTC(Number(newMonth.slice(0, 4)), Number(newMonth.slice(5)), 0)).toISOString().slice(0, 10)
    : "";
  const monthOverlaps = periods.some((period) => period.start <= monthEnd && monthStart <= period.end);
  const rows = workspace.funnels.filter((row) => row.periodId === selected?.id);
  const clinicians = context.clinicians.filter((person) =>
    (person.goalId ?? null) === workspace.settings.teamId,
  );
  const campaigns = workspace.campaigns.filter((campaign) => !campaign.archived);
  const candidate = {
    campaignId: campaignChoice || null,
    sourceName: campaignChoice ? "" : sourceName.trim() || "Other",
    clinicianId: clinicianChoice ? Number(clinicianChoice) : null,
  };
  const overlaps = (row: Funnel, other: Pick<Funnel, "campaignId" | "sourceName" | "clinicianId">) =>
    sourceKey(row) === sourceKey(other) &&
    (row.clinicianId === other.clinicianId || row.clinicianId === null || other.clinicianId === null);
  const addConflict = rows.some((row) => overlaps(row, candidate));
  const rowConflict = rows.some((row, index) => rows.some((other, otherIndex) =>
    otherIndex < index && overlaps(row, other),
  ));
  const attributed = [...new Set(rows.map((row) => row.clinicianId)
    .filter((id): id is number => id !== null))].map((id) => ({
      id,
      name: context.clinicians.find((person) => person.id === id)?.label ?? `Clinician ${id}`,
      rows: rows.filter((row) => row.clinicianId === id),
    }));

  return (
    <section className="pw-lead-flow" aria-label="Lead flow">
      <div className="pw-lead-flow-top">
        <div>
          <h3>Lead flow</h3>
          <p>Leads, attended consults, and clients booked in the calendar.</p>
        </div>
        <div className="pw-lead-flow-actions">
          <label>Month
            <select aria-label="Lead flow month" value={selected?.id ?? ""}
              onChange={(event) => setPeriodChoice(event.target.value)}>
              {periods.map((period) => (
                <option key={period.id} value={period.id}>{period.name} · {period.start} to {period.end}</option>
              ))}
            </select>
          </label>
          {!readOnly && <div className="pw-lead-flow-new-month">
            <label>Add month
              <input aria-label="New lead flow month" type="month" value={newMonth}
                onChange={(event) => setNewMonth(event.target.value)} />
            </label>
            <button className="pw-button" type="button" disabled={!newMonth || monthOverlaps}
              title={monthOverlaps ? "This month already has a reporting period" : undefined}
              onClick={() => {
                const id = onAddMonth(newMonth);
                if (id) setPeriodChoice(id);
              }}><Plus /> Add month</button>
          </div>}
          {!readOnly && <button className="pw-button" type="button" onClick={onOpenPeriods}>Reporting periods</button>}
          {pending && !readOnly && <button className="pw-button pw-primary" type="button" disabled={!canSave}
            onClick={onSave}><Save /> Save changes</button>}
        </div>
      </div>
      {!selected ? (
        <div className="pw-empty">
          <h3>No reporting months yet</h3>
          <p>Choose a month above to begin entering leads and consults.</p>
        </div>
      ) : (
        <>
          <div className="pw-lead-flow-totals" aria-label="Monthly lead flow totals">
            <div><span>Leads</span><strong>{shown(total(rows, "leads"))}</strong></div>
            <div><span>Consults attended</span><strong>{shown(total(rows, "attended"))}</strong></div>
            <div><span>Clients booked</span><strong>{shown(total(rows, "clients"))}</strong></div>
            <div><span>Close rate</span><strong>{rate(total(rows, "clients"), total(rows, "attended"))}</strong></div>
          </div>
          {rowConflict && <p className="pw-error" role="alert">The same source has both an unassigned total and clinician rows. Assign or remove the total before saving, so clients are not counted twice.</p>}
          <div className="pw-table-scroll">
            <table className="pw-table pw-lead-flow-table">
              <thead><tr>
                <th>Source</th><th>Clinician</th><th>Leads</th><th>Scheduled</th><th>Attended</th><th>Booked</th><th>Close rate</th><th aria-label="Actions" />
              </tr></thead>
              <tbody>
                {rows.map((row) => {
                  const locked = readOnly || selected.status === "finalized";
                  return <tr key={row.id}>
                    <td>
                      <select aria-label="Lead source" value={row.campaignId ?? ""} disabled={locked}
                        onChange={(event) => onPatch(row.id, { campaignId: event.target.value || null, sourceName: event.target.value ? "" : row.sourceName || "Other" })}>
                        <option value="">Other / referrals</option>
                        {campaigns.map((campaign) => <option key={campaign.id} value={campaign.id}>{campaign.name}</option>)}
                      </select>
                      {!row.campaignId && <input aria-label="Other lead source name"
                        key={`${row.id}:source:${row.sourceName}`}
                        defaultValue={row.sourceName || "Other"} disabled={locked}
                        onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }}
                        onBlur={(event) => {
                          const next = event.currentTarget.value.trim() || "Other";
                          if (next !== row.sourceName) onPatch(row.id, { sourceName: next });
                        }} />}
                    </td>
                    <td><select aria-label="Consulting clinician" value={row.clinicianId ?? ""} disabled={locked}
                      onChange={(event) => onPatch(row.id, { clinicianId: event.target.value ? Number(event.target.value) : null })}>
                      <option value="">Unassigned total</option>
                      {clinicians.map((person) => <option key={person.id} value={person.id}>{person.label}</option>)}
                      {row.clinicianId !== null && !clinicians.some((person) => person.id === row.clinicianId) && (
                        <option value={row.clinicianId}>
                          {context.clinicians.find((person) => person.id === row.clinicianId)?.label ?? `Clinician ${row.clinicianId}`}
                        </option>
                      )}
                    </select></td>
                    {(["leads", "scheduled", "attended", "clients"] as const).map((field) =>
                      <td key={field}><CountInput row={row} field={field} disabled={locked} onPatch={onPatch} /></td>,
                    )}
                    <td>{rate(row.clients, row.attended)}</td>
                    <td className="pw-lead-flow-row-actions">
                      <button className="pw-icon" type="button" title="More result details" aria-label="More result details"
                        disabled={readOnly || pending} onClick={() => onEditDetails(row)}><MoreHorizontal /></button>
                      {!locked && <button className="pw-icon" type="button" title="Remove result row" aria-label="Remove result row"
                        onClick={() => onRemove(row.id)}><Trash2 /></button>}
                    </td>
                  </tr>;
                })}
                {!rows.length && <tr><td colSpan={8}>No results entered for this month.</td></tr>}
              </tbody>
            </table>
          </div>
          {!readOnly && selected.status !== "finalized" && (
            <div className="pw-lead-flow-add">
              <select aria-label="New result source" value={campaignChoice} onChange={(event) => setCampaignChoice(event.target.value)}>
                <option value="">Other / referrals</option>
                {campaigns.map((campaign) => <option key={campaign.id} value={campaign.id}>{campaign.name}</option>)}
              </select>
              {!campaignChoice && <input aria-label="New lead source name" value={sourceName} maxLength={120}
                onChange={(event) => setSourceName(event.target.value)} />}
              <select aria-label="New result clinician" value={clinicianChoice} onChange={(event) => setClinicianChoice(event.target.value)}>
                <option value="">Unassigned total</option>
                {clinicians.map((person) => <option key={person.id} value={person.id}>{person.label}</option>)}
              </select>
              <button className="pw-button" type="button" disabled={addConflict}
                title={addConflict ? "This source and clinician already have a result for this month" : undefined}
                onClick={() => onAdd(selected.id, candidate.campaignId, candidate.sourceName, candidate.clinicianId)}>
                <Plus /> Add results
              </button>
            </div>
          )}
          {selected.status === "finalized" && !readOnly && (
            <div className="pw-lead-flow-finalized">
              <p className="pw-lead-flow-note">This month is finalized. Changes require a correction reason.</p>
              <button className="pw-button" type="button" disabled={pending} onClick={() => onAddCorrection(selected.id)}>
                <Plus /> Add documented result
              </button>
            </div>
          )}
          {attributed.length > 0 && (
            <div className="pw-lead-flow-people">
              <h4>Consult close rates by clinician</h4>
              <div className="pw-table-scroll"><table className="pw-table">
                <thead><tr><th>Clinician</th><th>Attended</th><th>Booked</th><th>Close rate</th></tr></thead>
                <tbody>{attributed.map(({ id, name, rows: personRows }) => <tr key={id}>
                  <th>{name}</th>
                  <td>{shown(total(personRows, "attended"))}</td>
                  <td>{shown(total(personRows, "clients"))}</td>
                  <td>{rate(total(personRows, "clients"), total(personRows, "attended"))}</td>
                </tr>)}</tbody>
              </table></div>
            </div>
          )}
        </>
      )}
    </section>
  );
}
