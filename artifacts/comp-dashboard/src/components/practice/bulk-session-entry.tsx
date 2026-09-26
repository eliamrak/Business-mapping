import { useEffect, useMemo, useRef, useState } from "react";
import { RotateCcw, Save } from "lucide-react";
import { ApiError } from "@workspace/api-client-react";
import { dateSchema, type SessionRecord, type SessionWrite } from "@workspace/practice";
import type { Clinician } from "@workspace/practice/hub";
import { saveSessionRecordBounded } from "@/lib/session-api";
import {
  MAX_BULK_PERIODS,
  buildBulkPeriods,
  bulkCellKey,
  parsePastedTotals,
  planBulkSessions,
  shiftBulkDate,
  writeBulkSessions,
  type BulkPeriod,
} from "@/lib/bulk-sessions";

const shortDate = (date: string) => new Date(`${date}T12:00:00`).toLocaleDateString(
  "en-US", { month: "short", day: "numeric", year: "2-digit" },
);

export default function BulkSessionEntry({
  people,
  records,
  initialRange,
  onSaved,
  onStateChange,
}: {
  people: Clinician[];
  records: SessionRecord[];
  initialRange: BulkPeriod;
  onSaved: () => Promise<void>;
  onStateChange: (state: { dirty: boolean; busy: boolean }) => void;
}) {
  const [firstStart, setFirstStart] = useState(initialRange.start);
  const [firstEnd, setFirstEnd] = useState(
    dateSchema.safeParse(initialRange.start).success
      ? shiftBulkDate(initialRange.start, 13)
      : initialRange.end,
  );
  const [rowCount, setRowCount] = useState(12);
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [savedCount, setSavedCount] = useState(0);
  const [saveTotal, setSaveTotal] = useState(0);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const pending = useRef(new Map<string, SessionWrite>());
  const built = useMemo(() => {
    try {
      return { periods: buildBulkPeriods(firstStart, firstEnd, rowCount), error: "" };
    } catch (cause) {
      return { periods: [] as BulkPeriod[], error: cause instanceof Error ? cause.message : "Check the first period." };
    }
  }, [firstStart, firstEnd, rowCount]);
  const plan = useMemo(
    () => planBulkSessions(built.periods, people, overrides, records),
    [built.periods, people, overrides, records],
  );
  const dirty = Object.keys(overrides).length > 0;
  useEffect(() => onStateChange({ dirty, busy }), [dirty, busy, onStateChange]);

  const savedAt = (period: BulkPeriod, clinicianId: number) => records.find(
    (record) => record.clinicianId === clinicianId &&
      record.start === period.start && record.end === period.end,
  );

  function setCell(period: BulkPeriod, clinicianId: number, raw: string) {
    const key = bulkCellKey(period.start, clinicianId);
    const saved = savedAt(period, clinicianId);
    setOverrides((current) => {
      const next = { ...current };
      if (!raw.trim() || raw.trim() === String(saved?.completed)) delete next[key];
      else next[key] = raw;
      return next;
    });
    pending.current.delete(key);
    setError("");
    setMessage("");
  }

  function pasteAt(event: React.ClipboardEvent<HTMLInputElement>, row: number, column: number) {
    const text = event.clipboardData.getData("text/plain");
    if (!text) return;
    event.preventDefault();
    const cells = parsePastedTotals(text);
    if (row + cells.length > MAX_BULK_PERIODS ||
        cells.some((line) => column + line.length > people.length)) {
      setError(`This paste extends beyond ${MAX_BULK_PERIODS} periods or the last clinician column.`);
      return;
    }
    setRowCount((count) => Math.max(count, row + cells.length));
    setOverrides((current) => {
      const next = { ...current };
      cells.forEach((line, rowOffset) => {
        const period = {
          start: shiftBulkDate(firstStart, (row + rowOffset) * 14),
          end: shiftBulkDate(firstEnd, (row + rowOffset) * 14),
        };
        line.forEach((raw, colOffset) => {
          const clinicianId = people[column + colOffset].id;
          const key = bulkCellKey(period.start, clinicianId);
          const saved = savedAt(period, clinicianId);
          if (!raw || raw === String(saved?.completed)) delete next[key];
          else next[key] = raw;
          pending.current.delete(key);
        });
      });
      return next;
    });
    setError("");
    setMessage("");
  }

  async function save() {
    if (busy || built.error || plan.issues.length || !plan.entries.length) return;
    setBusy(true);
    setSavedCount(0);
    setSaveTotal(plan.entries.length);
    setError("");
    const savedKeys: string[] = [];
    try {
      const result = await writeBulkSessions(
        plan.entries, pending.current, saveSessionRecordBounded, setSavedCount,
      );
      savedKeys.push(...result.savedKeys);
      if (result.error) throw result.error;
      await onSaved();
      setOverrides((current) => {
        const next = { ...current };
        savedKeys.forEach((key) => delete next[key]);
        return next;
      });
      setMessage(`Saved ${savedKeys.length} session total${savedKeys.length === 1 ? "" : "s"}.`);
    } catch (cause) {
      if (cause instanceof ApiError && [400, 404, 409].includes(cause.status))
        pending.current.clear();
      if (savedKeys.length || cause instanceof ApiError) {
        try { await onSaved(); } catch { /* The save error remains visible for retry. */ }
        setOverrides((current) => {
          const next = { ...current };
          savedKeys.forEach((key) => delete next[key]);
          return next;
        });
      }
      setError(`${savedKeys.length} of ${plan.entries.length} totals confirmed saved. ${
        cause instanceof ApiError
          ? ((cause.data as { error?: string })?.error ?? cause.message)
          : cause instanceof Error && cause.name === "TimeoutError"
            ? "A request took too long to confirm. It may still have reached the server."
          : cause instanceof Error ? cause.message : "The next total was not confirmed."
      } Review the remaining cells before retrying.`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="pw-bulk-entry">
      <div className="pw-bulk-toolbar">
        <div className="pw-session-dates">
          <label>First period starts
            <input
              type="date"
              value={firstStart}
              disabled={dirty || busy}
              onChange={(event) => {
                const start = event.target.value;
                setFirstStart(start);
                if (dateSchema.safeParse(start).success) setFirstEnd(shiftBulkDate(start, 13));
              }}
            />
          </label>
          <span>to</span>
          <label>First period ends
            <input type="date" value={firstEnd} disabled={dirty || busy}
              onChange={(event) => setFirstEnd(event.target.value)} />
          </label>
        </div>
        <label className="pw-bulk-count">Periods
          <input
            type="number" min="1" max={MAX_BULK_PERIODS} value={rowCount}
            disabled={busy}
            onChange={(event) => {
              const count = Number(event.target.value);
              if (!Number.isInteger(count) || count < 1 || count > MAX_BULK_PERIODS) return;
              if (count < rowCount && dirty) {
                setError("Save or discard entered totals before showing fewer periods.");
                return;
              }
              setRowCount(count);
              setError("");
            }}
          />
        </label>
        <span className="pw-bulk-summary" role="status">
          {busy ? `${savedCount} of ${saveTotal} saved` : `${plan.entries.length} ready to save`}
        </span>
      </div>
      {built.error && <p className="pw-error" role="alert">{built.error}</p>}
      <div className="pw-bulk-table-wrap">
        <table className="pw-bulk-table">
          <thead>
            <tr><th>Biweekly period</th>{people.map((person) => <th key={person.id}>{person.label}</th>)}</tr>
          </thead>
          <tbody>
            {built.periods.map((period, row) => (
              <tr key={period.start}>
                <th><strong>{shortDate(period.start)}</strong><span>to {shortDate(period.end)}</span></th>
                {people.map((person, column) => {
                  const key = bulkCellKey(period.start, person.id);
                  const saved = savedAt(period, person.id);
                  const issue = plan.issues.find((item) => item.key === key);
                  return (
                    <td key={person.id} data-saved={!!saved} data-changed={key in overrides}>
                      <input
                        type="text"
                        inputMode="numeric"
                        aria-label={`${person.label} sessions, ${shortDate(period.start)} to ${shortDate(period.end)}`}
                        aria-invalid={!!issue}
                        title={issue?.message || (saved ? "Previously saved" : undefined)}
                        placeholder="-"
                        value={overrides[key] ?? String(saved?.completed ?? "")}
                        disabled={busy}
                        onChange={(event) => setCell(period, person.id, event.target.value)}
                        onPaste={(event) => pasteAt(event, row, column)}
                      />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!!plan.issues.length && (
        <div className="pw-error" role="alert">
          {plan.issues.slice(0, 4).map((issue) => <p key={issue.key}>{issue.message}</p>)}
          {plan.issues.length > 4 && <p>{plan.issues.length - 4} more cells need attention.</p>}
        </div>
      )}
      {error && <p className="pw-error" role="alert">{error}</p>}
      {message && <p className="pw-success" role="status">{message}</p>}
      <div className="pw-session-savebar">
        <div><strong>{busy ? `${savedCount} of ${saveTotal} saved` : dirty ? `${plan.entries.length} changed totals` : "Ready for totals"}</strong>
          <span>{built.periods.length ? `${shortDate(built.periods[0].start)} - ${shortDate(built.periods.at(-1)!.end)}` : "Check first period dates"}</span></div>
        {dirty && <button className="pw-button" disabled={busy} onClick={() => {
          setOverrides({});
          pending.current.clear();
          setError("");
        }}><RotateCcw /> Discard</button>}
        <button className="pw-button pw-primary" disabled={busy || !plan.entries.length || !!plan.issues.length || !!built.error}
          onClick={() => void save()}><Save /> {busy ? `Saving ${savedCount}/${saveTotal}` : "Save totals"}</button>
      </div>
    </div>
  );
}
