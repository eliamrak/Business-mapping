import { useMemo, useRef, useState } from "react";
import { Check, FileSpreadsheet, Upload } from "lucide-react";
import { customFetch } from "@workspace/api-client-react";
import type { Context } from "@workspace/practice/hub";
import { saveSessionRecord } from "@/lib/session-api";
import {
  inspectSessionSheet,
  planSessionImport,
  type SessionSheet,
} from "@/lib/session-import";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type Preview = {
  sheets: { name: string; rows: string[][] }[];
  limited: boolean;
};

export default function SessionImportDialog({
  context,
  teamId,
  onSaved,
  onClose,
}: {
  context: Context;
  teamId: number | null;
  onSaved: () => Promise<void>;
  onClose: (message?: string) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [sheetIndex, setSheetIndex] = useState(0);
  const [headerRow, setHeaderRow] = useState<number | undefined>();
  const [year, setYear] = useState(new Date().getFullYear());
  const [mappings, setMappings] = useState<Record<number, number | "skip" | null>>({});
  const [corrections, setCorrections] = useState<Record<number, { start: string; end: string }>>({});
  const [goalSource, setGoalSource] = useState<"sheet" | "practice">("sheet");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const people = context.clinicians.filter(
    (person) => (person.goalId ?? null) === teamId,
  );
  const inspected = useMemo(() => {
    if (!preview) return { sheet: null as SessionSheet | null, error: "" };
    try {
      return {
        sheet: inspectSessionSheet(
          preview.sheets[sheetIndex]?.rows ?? [],
          people,
          headerRow === undefined ? undefined : headerRow - 1,
        ),
        error: "",
      };
    } catch (cause) {
      return {
        sheet: null,
        error: cause instanceof Error ? cause.message : "This worksheet could not be read.",
      };
    }
  }, [preview, sheetIndex, headerRow, context.clinicians, teamId]);
  const sheet = inspected.sheet;
  const plan = useMemo(
    () => sheet
      ? planSessionImport(
          sheet,
          year,
          mappings,
          corrections,
          goalSource,
          people,
          context.sessions,
        )
      : null,
    [sheet, year, mappings, corrections, goalSource, context.sessions],
  );
  const periods = sheet?.periods.filter(
    (period) => Number((corrections[period.row]?.end ?? period.end).slice(0, 4)) === year,
  ) ?? [];
  const activeColumns = sheet?.columns.filter((column) =>
    periods.some((period) => typeof period.counts[column.index] === "number"),
  ) ?? [];

  async function readFile(file: File) {
    setError("");
    setPreview(null);
    if (!/\.(csv|xlsx)$/i.test(file.name) || !file.size || file.size > 10 * 1024 * 1024) {
      setError("Choose a CSV or XLSX file up to 10 MB.");
      return;
    }
    setBusy(true);
    try {
      const data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(",")[1]);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      const next = await customFetch<Preview>("/api/session-records/import-preview", {
        method: "POST",
        body: JSON.stringify({ name: file.name, data }),
      });
      if (next.limited) throw new Error("This file exceeds 1,000 rows or 80 columns. Split it before importing.");
      setFileName(file.name);
      setPreview(next);
      setSheetIndex(0);
      setHeaderRow(undefined);
      setCorrections({});
      const parsed = inspectSessionSheet(next.sheets[0]?.rows ?? [], people);
      const selectedYear = parsed.years.includes(new Date().getFullYear())
        ? new Date().getFullYear()
        : parsed.years.at(-1)!;
      setYear(selectedYear);
      setMappings(Object.fromEntries(parsed.columns.map((column) => [column.index, column.suggestedId])));
      setGoalSource(parsed.columns.some((column) => column.sheetGoal !== null) ? "sheet" : "practice");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The file could not be read.");
      setPreview(null);
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  function changeSheet(index: number) {
    setSheetIndex(index);
    setHeaderRow(undefined);
    setCorrections({});
    try {
      const next = inspectSessionSheet(preview?.sheets[index]?.rows ?? [], people);
      setMappings(Object.fromEntries(next.columns.map((column) => [column.index, column.suggestedId])));
      setYear(next.years.includes(new Date().getFullYear()) ? new Date().getFullYear() : next.years.at(-1)!);
    } catch {
      setMappings({});
    }
  }

  function changeHeaderRow(row: number) {
    setHeaderRow(row);
    try {
      const next = inspectSessionSheet(preview?.sheets[sheetIndex]?.rows ?? [], people, row - 1);
      setMappings(Object.fromEntries(next.columns.map((column) => [column.index, column.suggestedId])));
    } catch {
      setMappings({});
    }
  }

  async function save() {
    if (!plan?.entries.length || plan.errors.length || busy) return;
    setBusy(true);
    setError("");
    let saved = 0;
    try {
      for (const entry of plan.entries) {
        await saveSessionRecord({
          requestId: crypto.randomUUID(),
          expectedRevision: null,
          entry,
        });
        saved++;
      }
      await onSaved();
      onClose(`Imported ${saved} session totals from ${fileName}.`);
    } catch (cause) {
      if (saved) await onSaved();
      setError(
        `${saved} totals saved. ${cause instanceof Error ? cause.message : "The next total could not be saved."} Reloaded records will be skipped on retry.`,
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !busy) onClose(); }}>
      <DialogContent className="practice-theme pw-import-dialog" data-appearance="light">
        <DialogHeader>
          <DialogTitle>Import session history</DialogTitle>
          <DialogDescription>Review biweekly totals before they become recorded sessions.</DialogDescription>
        </DialogHeader>
        <div className="pw-import-body">
          <div className="pw-import-file">
            <FileSpreadsheet />
            <span>{fileName || "Choose a clinician-column spreadsheet"}</span>
            <input
              ref={input}
              type="file"
              accept=".xlsx,.csv"
              aria-label="Session history spreadsheet"
              hidden
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void readFile(file);
              }}
            />
            <button className="pw-button" disabled={busy} onClick={() => input.current?.click()}>
              <Upload /> Choose file
            </button>
          </div>
          {preview && (
            <>
              <div className="pw-import-controls">
                {preview.sheets.length > 1 && (
                  <label>Worksheet
                    <select value={sheetIndex} onChange={(event) => changeSheet(Number(event.target.value))}>
                      {preview.sheets.map((item, index) => <option key={index} value={index}>{item.name}</option>)}
                    </select>
                  </label>
                )}
                <label>Clinician names are on row
                  <input
                    type="number"
                    min="1"
                    max={preview.sheets[sheetIndex]?.rows.length ?? 1}
                    value={headerRow ?? sheet?.headerRow ?? 1}
                    onChange={(event) => changeHeaderRow(Number(event.target.value))}
                  />
                </label>
                <label>Year to import
                  <select value={year} onChange={(event) => setYear(Number(event.target.value))}>
                    {sheet?.years.map((value) => <option key={value} value={value}>{value}</option>)}
                  </select>
                </label>
                <label>Historical desired sessions
                  <select value={goalSource} onChange={(event) => setGoalSource(event.target.value as "sheet" | "practice")}>
                    <option value="sheet">Goal Average from the sheet</option>
                    <option value="practice">Current clinician goals</option>
                  </select>
                </label>
              </div>
              {inspected.error && <p className="pw-error" role="alert">{inspected.error}</p>}
              {sheet && (
                <>
                  <div className="pw-import-summary">
                    <strong>{periods.length} biweekly periods</strong>
                    <span>{plan?.entries.length ?? 0} totals ready</span>
                    <span>{plan?.duplicateCount ?? 0} already saved</span>
                    {!!plan?.conflictCount && <span>{plan.conflictCount} different existing totals kept</span>}
                    {!!plan?.skippedCount && <span>{plan.skippedCount} explicitly skipped</span>}
                  </div>
                  <h3>Match clinicians</h3>
                  <div className="pw-import-table-wrap">
                    <table className="pw-import-table">
                      <thead><tr><th>Sheet column</th><th>Recorded totals</th><th>Historic goal / period</th><th>Import as</th></tr></thead>
                      <tbody>
                        {activeColumns.map((column) => (
                          <tr key={column.index}>
                            <th>{column.name}</th>
                            <td>{periods.filter((period) => typeof period.counts[column.index] === "number").length}</td>
                            <td>{column.sheetGoal ?? "Not entered"}</td>
                            <td>
                              <select
                                aria-label={`Map ${column.name}`}
                                value={mappings[column.index] ?? ""}
                                onChange={(event) => setMappings((current) => ({
                                  ...current,
                                  [column.index]: event.target.value === "skip"
                                    ? "skip"
                                    : event.target.value ? Number(event.target.value) : null,
                                }))}
                              >
                                <option value="">Choose clinician</option>
                                {people.map((person) => <option key={person.id} value={person.id}>{person.label}</option>)}
                                <option value="skip">Skip this column</option>
                              </select>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {goalSource === "sheet" && activeColumns.some((column) => column.sheetGoal === null) && (
                    <p className="pw-import-note">Columns without a sheet goal use that clinician's current desired sessions.</p>
                  )}
                  {!!plan?.conflictCount && (
                    <p className="pw-import-note">Different existing entries will not be changed. Review or edit those periods in Sessions after import.</p>
                  )}
                  {sheet.periods.filter((period) => period.end && Number(period.end.slice(0, 4)) !== year).length > 0 && (
                    <p className="pw-import-note">Periods outside {year} are not imported.</p>
                  )}
                  {periods.some((period) => period.errors.some((item) => item.includes("date") || item.includes("range"))) && (
                    <section className="pw-import-dates">
                      <h3>Check dates</h3>
                      {periods.filter((period) => period.errors.some((item) => item.includes("date") || item.includes("range"))).map((period) => {
                        const dates = corrections[period.row] ?? period;
                        return (
                          <div key={period.row}>
                            <span>Row {period.row}: {period.label}</span>
                            <input
                              type="date"
                              aria-label={`Row ${period.row} start`}
                              value={dates.start}
                              onChange={(event) => setCorrections((current) => ({
                                ...current,
                                [period.row]: { start: event.target.value, end: dates.end },
                              }))}
                            />
                            <input
                              type="date"
                              aria-label={`Row ${period.row} end`}
                              value={dates.end}
                              onChange={(event) => setCorrections((current) => ({
                                ...current,
                                [period.row]: { start: dates.start, end: event.target.value },
                              }))}
                            />
                          </div>
                        );
                      })}
                    </section>
                  )}
                  {!!plan?.errors.length && (
                    <div className="pw-error" role="alert">
                      {plan.errors.slice(0, 8).map((item) => <p key={item}>{item}</p>)}
                      {plan.errors.length > 8 && <p>And {plan.errors.length - 8} more issues.</p>}
                    </div>
                  )}
                </>
              )}
            </>
          )}
          {error && <p className="pw-error" role="alert">{error}</p>}
        </div>
        <div className="pw-import-footer">
          <span>Existing entries are never overwritten. Blank cells are not imported; recorded zeroes are.</span>
          <button className="pw-button pw-primary" disabled={busy || !plan?.entries.length || !!plan.errors.length} onClick={() => void save()}>
            <Check /> {busy ? "Working..." : `Import ${plan?.entries.length ?? 0} totals`}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
