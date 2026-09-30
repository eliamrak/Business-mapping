import { useEffect, useMemo, useState } from "react";
import { RotateCcw, Save } from "lucide-react";
import type { Workspace } from "@workspace/practice/hub";
import { parsePastedTotals } from "@/lib/bulk-sessions";
import {
  leadCellKey, leadMonth, leadMonthState, planBulkLeads,
  type LeadBulkChange, type LeadCountKey,
} from "@/lib/bulk-lead-flow";
import { leadFlowRates } from "@/lib/lead-flow-rates";

const fields: { key: LeadCountKey; label: string }[] = [
  { key: "leads", label: "Leads" },
  { key: "scheduled", label: "Consults scheduled" },
  { key: "attended", label: "Consults attended" },
  { key: "clients", label: "Clients booked" },
];

export default function BulkLeadEntry({ workspace, readOnly, pending, year, onYearChange, onOpenMonth, onDirtyChange, onSave }: {
  workspace: Workspace;
  readOnly: boolean;
  pending: boolean;
  year: number;
  onYearChange: (year: number) => void;
  onOpenMonth: (month: string) => void;
  onDirtyChange: (dirty: boolean) => void;
  onSave: (changes: LeadBulkChange[]) => Promise<void>;
}) {
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const plan = useMemo(() => planBulkLeads(workspace, overrides), [workspace, overrides]);
  const dirty = Object.keys(overrides).length > 0;
  useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange]);

  function setCell(month: string, field: LeadCountKey, raw: string) {
    const key = leadCellKey(month, field);
    const saved = leadMonthState(workspace, month).practice?.[field];
    setOverrides((prior) => {
      const next = { ...prior };
      if (!raw && saved == null || raw === String(saved)) delete next[key];
      else next[key] = raw;
      return next;
    });
    setError("");
    setMessage("");
  }

  function pasteAt(event: React.ClipboardEvent<HTMLInputElement>, row: number, column: number) {
    const text = event.clipboardData.getData("text/plain");
    if (!text) return;
    event.preventDefault();
    const cells = parsePastedTotals(text);
    if (row + cells.length > 12 || cells.some((line) => column + line.length > fields.length)) {
      setError("The paste extends past December or the last column.");
      return;
    }
    if (cells.some((_, offset) => leadMonthState(workspace, leadMonth(year, row + offset)).locked)) {
      setError("The paste includes a locked month. Open that month's details to edit it.");
      return;
    }
    setOverrides((prior) => {
      const next = { ...prior };
      cells.forEach((line, rowOffset) => line.forEach((raw, columnOffset) => {
        const month = leadMonth(year, row + rowOffset);
        const field = fields[column + columnOffset].key;
        const key = leadCellKey(month, field);
        const saved = leadMonthState(workspace, month).practice?.[field];
        if (!raw && saved == null || raw === String(saved)) delete next[key];
        else next[key] = raw;
      }));
      return next;
    });
    setError("");
    setMessage("");
  }

  async function save() {
    if (busy || pending || plan.issues.length || !plan.changes.length) return;
    setBusy(true);
    setError("");
    try {
      await onSave(plan.changes);
      setOverrides({});
      setMessage(`Saved ${plan.changes.length} month${plan.changes.length === 1 ? "" : "s"}.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save monthly totals.");
    } finally {
      setBusy(false);
    }
  }

  return <div className="pw-bulk-entry pw-bulk-leads">
    <div className="pw-bulk-toolbar">
      <label className="pw-bulk-count">Year
        <input type="number" min="2000" max="2100" value={year} disabled={dirty || busy}
          onChange={(event) => {
            const next = Number(event.target.value);
            if (Number.isInteger(next) && next >= 2000 && next <= 2100) onYearChange(next);
          }} />
      </label>
      <span className="pw-bulk-summary">{busy ? "Saving..." : `${plan.changes.length} month${plan.changes.length === 1 ? "" : "s"} ready to save`}</span>
    </div>
    <div className="pw-bulk-table-wrap"><table className="pw-bulk-table">
      <thead><tr><th>Month</th>{fields.map(({ key, label }) => <th key={key}>{label}</th>)}
        <th title="Scheduled consults divided by leads">Schedule rate</th>
        <th title="Attended consults divided by scheduled consults">Show rate</th>
        <th title="Clients booked divided by attended consults">Consult close rate</th>
        <th title="Clients booked divided by leads">Overall close rate</th></tr></thead>
      <tbody>{Array.from({ length: 12 }, (_, index) => {
        const month = leadMonth(year, index);
        const { practice, locked } = leadMonthState(workspace, month);
        const values = Object.fromEntries(fields.map(({ key }) => {
          const cell = leadCellKey(month, key);
          return [key, overrides[cell] ?? String(practice?.[key] ?? "")];
        })) as Record<LeadCountKey, string>;
        const count = (raw: string) => /^\d+$/.test(raw.trim()) ? Number(raw) : null;
        const rates = leadFlowRates({
          leads: count(values.leads),
          scheduled: count(values.scheduled),
          attended: count(values.attended),
          clients: count(values.clients),
        });
        return <tr key={month}>
          <th><button type="button" className="pw-bulk-lead-month" onClick={() => onOpenMonth(month)}
            disabled={dirty || busy} title={dirty ? "Save or discard changes first" : "Open month details"}>
            {new Date(`${month}-01T12:00:00`).toLocaleDateString("en-US", { month: "long" })}</button>
            {locked && <span>{locked}</span>}</th>
          {fields.map(({ key, label }, column) => {
            const cell = leadCellKey(month, key);
            const invalid = cell in overrides && values[key].trim() !== "" && !/^\d+$/.test(values[key].trim());
            return <td key={key} data-saved={practice?.[key] != null} data-changed={cell in overrides}>
              <input type="text" inputMode="numeric" placeholder="-" value={values[key]}
                aria-label={`${label}, ${month}`} aria-invalid={invalid} title={locked || undefined}
                disabled={readOnly || busy || pending || !!locked}
                onChange={(event) => setCell(month, key, event.target.value)}
                onPaste={(event) => pasteAt(event, index, column)} />
            </td>;
          })}<td>{rates.scheduledConsult}</td><td>{rates.show}</td><td>{rates.consultClose}</td><td>{rates.overallClose}</td>
        </tr>;
      })}</tbody>
    </table></div>
    {plan.issues.length > 0 && <div className="pw-error" role="alert">
      {plan.issues.slice(0, 3).map((issue) => <p key={issue.month}>{issue.message}</p>)}
    </div>}
    {error && <p className="pw-error" role="alert">{error}</p>}
    {message && <p className="pw-success" role="status">{message}</p>}
    <div className="pw-session-savebar">
      <div><strong>{dirty ? `${plan.changes.length} changed month${plan.changes.length === 1 ? "" : "s"}` : "Ready for monthly totals"}</strong>
        <span>{year}</span></div>
      {dirty && <button type="button" className="pw-button" disabled={busy} onClick={() => {
        setOverrides({}); setError("");
      }}><RotateCcw /> Discard</button>}
      <button type="button" className="pw-button pw-primary"
        disabled={readOnly || busy || pending || !plan.changes.length || !!plan.issues.length}
        onClick={() => void save()}><Save /> {busy ? "Saving..." : "Save months"}</button>
    </div>
  </div>;
}
