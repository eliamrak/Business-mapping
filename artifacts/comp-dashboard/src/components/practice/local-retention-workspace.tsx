import { useMemo, useRef, useState } from "react";
import { Download, FileSpreadsheet, ShieldCheck, Upload } from "lucide-react";
import {
  buildLocalRetentionMetrics,
  exportLocalBackup,
  importAttendanceCsv,
  importBillingCsv,
  importLocalBackup,
  mergeSnapshot,
  replaceOverlappingSnapshots,
  type BillingCodeMinutes,
  type LocalFactKind,
  type LocalSnapshot,
} from "@/lib/retention-local";

const money = (value: number) =>
  value.toLocaleString("en-US", { style: "currency", currency: "USD" });
const dateLabel = (value: string | null) => value ?? "--";
const localDownload = (value: unknown, name: string) => {
  const blob = new Blob([JSON.stringify(value, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

async function readText(file: File) {
  if (!/\.(csv|json)$/i.test(file.name) || !file.size || file.size > 10 * 1024 * 1024)
    throw new Error("Choose a CSV or local backup JSON file up to 10 MB.");
  return await file.text();
}

export default function LocalRetentionWorkspace() {
  const [snapshots, setSnapshots] = useState<LocalSnapshot[]>([]);
  const [billingCodeMinutes, setBillingCodeMinutes] = useState<BillingCodeMinutes>({});
  const [codeDraft, setCodeDraft] = useState({ code: "", minutes: "" });
  const [status, setStatus] = useState("No files imported yet.");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<{
    incoming: LocalSnapshot;
    existing: LocalSnapshot[];
  } | null>(null);
  const attendanceInput = useRef<HTMLInputElement>(null);
  const billingInput = useRef<HTMLInputElement>(null);
  const backupInput = useRef<HTMLInputElement>(null);
  const metrics = useMemo(
    () => buildLocalRetentionMetrics(snapshots, billingCodeMinutes),
    [snapshots, billingCodeMinutes],
  );

  async function importCsv(kind: LocalFactKind, file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setError("");
    setPending(null);
    try {
      const text = await readText(file);
      const result = kind === "attendance"
        ? importAttendanceCsv(text)
        : importBillingCsv(text);
      const merged = mergeSnapshot(snapshots, result.snapshot);
      if (merged.status === "duplicate") {
        setStatus("That exact snapshot is already loaded. Nothing was added.");
      } else if (merged.status === "overlap") {
        setPending({ incoming: merged.incoming, existing: merged.existing });
        setStatus("This snapshot overlaps loaded local data. Choose whether to replace the overlapping local snapshot.");
      } else {
        setSnapshots(merged.snapshots);
        setStatus(`Loaded ${result.snapshot.rows.length} ${kind} rows for ${result.snapshot.coverageStart} to ${result.snapshot.coverageEnd}.`);
      }
      if (result.warnings.length) setError(result.warnings.join(" "));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The file could not be read.");
    } finally {
      setBusy(false);
      if (kind === "attendance" && attendanceInput.current) attendanceInput.current.value = "";
      if (kind === "billing" && billingInput.current) billingInput.current.value = "";
    }
  }

  function replacePending() {
    if (!pending) return;
    setSnapshots((current) => replaceOverlappingSnapshots(current, pending.incoming));
    setStatus(`Replaced overlapping ${pending.incoming.kind} snapshot for ${pending.incoming.coverageStart} to ${pending.incoming.coverageEnd}.`);
    setPending(null);
  }

  function keepExisting() {
    setStatus("Kept existing local snapshot. Incoming overlap was not loaded.");
    setPending(null);
  }

  function addBillingCodeMinutes() {
    const code = codeDraft.code.trim();
    const minutes = Number(codeDraft.minutes);
    if (!code || !Number.isFinite(minutes) || minutes <= 0) {
      setError("Enter a billing code and positive default minutes.");
      return;
    }
    setBillingCodeMinutes((current) => ({ ...current, [code]: minutes }));
    setCodeDraft({ code: "", minutes: "" });
    setError("");
  }

  function exportBackup() {
    localDownload(
      exportLocalBackup(snapshots, billingCodeMinutes),
      "emc-local-retention-backup.json",
    );
    setStatus("Downloaded a local backup. It contains de-identified row-level facts and should stay off the practice API.");
  }

  async function importBackup(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setError("");
    setPending(null);
    try {
      const parsed = importLocalBackup(JSON.parse(await readText(file)));
      setSnapshots(parsed.snapshots);
      setBillingCodeMinutes(parsed.billingCodeMinutes);
      setStatus(`Restored ${parsed.snapshots.length} local snapshots from backup.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The backup could not be read.");
    } finally {
      setBusy(false);
      if (backupInput.current) backupInput.current.value = "";
    }
  }

  return (
    <section className="pw-local-retention" aria-label="Local retention workspace">
      <div className="pw-local-retention-hero">
        <div>
          <p className="pw-eyebrow">Local-only CSV workspace</p>
          <h2>Retention and billed sessions</h2>
          <p>
            Import already de-identified CSVs that use permanent random client IDs.
            Rows stay in this browser session unless you explicitly download a local backup.
          </p>
        </div>
        <ShieldCheck aria-hidden="true" />
      </div>

      <div className="pw-privacy-strip">
        <span>Raw rows are not sent to the API.</span>
        <span>Manual session records are unchanged.</span>
        <span>Billing is charged fees, not collected payments.</span>
      </div>

      <div className="pw-local-import-grid">
        <section>
          <FileSpreadsheet aria-hidden="true" />
          <h3>Attendance CSV</h3>
          <p>Client, Clinician, Date of service, optional Location, Status.</p>
          <input
            ref={attendanceInput}
            type="file"
            accept=".csv"
            disabled={busy}
            onChange={(event) => void importCsv("attendance", event.target.files?.[0])}
          />
        </section>
        <section>
          <FileSpreadsheet aria-hidden="true" />
          <h3>Billing CSV</h3>
          <p>Date of Service, Client, Clinician, Total Fee, optional Billing Code.</p>
          <input
            ref={billingInput}
            type="file"
            accept=".csv"
            disabled={busy}
            onChange={(event) => void importCsv("billing", event.target.files?.[0])}
          />
        </section>
        <section>
          <Upload aria-hidden="true" />
          <h3>Protected local backup</h3>
          <p>Use only when you want row-level local facts restored later.</p>
          <div className="pw-backup-actions">
            <button className="pw-button" disabled={busy || !snapshots.length} onClick={exportBackup}>
              <Download />
              Download backup
            </button>
            <input
              ref={backupInput}
              type="file"
              accept=".json"
              disabled={busy}
              onChange={(event) => void importBackup(event.target.files?.[0])}
            />
          </div>
        </section>
      </div>

      {pending && (
        <div className="pw-overlap-review" role="alert">
          <div>
            <strong>Overlapping local snapshot</strong>
            <p>
              Incoming {pending.incoming.kind} range {pending.incoming.coverageStart} to {pending.incoming.coverageEnd}
              {" "}overlaps {pending.existing.length} loaded snapshot{pending.existing.length === 1 ? "" : "s"}.
              Replace only the overlapping local import, or keep the current one.
            </p>
          </div>
          <div>
            <button className="pw-button" onClick={keepExisting}>Keep existing</button>
            <button className="pw-button pw-primary" onClick={replacePending}>Replace local snapshot</button>
          </div>
        </div>
      )}

      {error && <p className="pw-error" role="alert">{error}</p>}
      <p className="pw-note">{status}</p>

      <section className="pw-billing-codes">
        <div>
          <h3>Billing-code minutes</h3>
          <p>Optional. Unknown codes remain unconfigured, and estimated hours are billing-code coverage only.</p>
        </div>
        <div className="pw-code-entry">
          <input
            aria-label="Billing code"
            placeholder="Code"
            value={codeDraft.code}
            onChange={(event) => setCodeDraft((current) => ({ ...current, code: event.target.value }))}
          />
          <input
            aria-label="Default minutes"
            placeholder="Minutes"
            type="number"
            min={1}
            value={codeDraft.minutes}
            onChange={(event) => setCodeDraft((current) => ({ ...current, minutes: event.target.value }))}
          />
          <button className="pw-button" onClick={addBillingCodeMinutes}>Add</button>
        </div>
        {!!Object.keys(billingCodeMinutes).length && (
          <div className="pw-code-list">
            {Object.entries(billingCodeMinutes).map(([code, minutes]) => (
              <button
                key={code}
                className="pw-chip"
                onClick={() =>
                  setBillingCodeMinutes((current) => {
                    const next = { ...current };
                    delete next[code];
                    return next;
                  })
                }
                title="Remove billing-code minutes"
              >
                {code}: {minutes} min
              </button>
            ))}
          </div>
        )}
      </section>

      <div className="pw-retention-summary">
        <div>
          <span>Coverage</span>
          <strong>{dateLabel(metrics.coverageStart)} to {dateLabel(metrics.coverageEnd)}</strong>
        </div>
        <div>
          <span>Attendance rows</span>
          <strong>{metrics.attendanceRows.toLocaleString()}</strong>
        </div>
        <div>
          <span>Billed rows</span>
          <strong>{metrics.billingRows.toLocaleString()}</strong>
        </div>
      </div>

      <div className="pw-local-tables">
        <section>
          <h3>Attendance and retention</h3>
          <table>
            <thead>
              <tr>
                <th>Clinician</th>
                <th>Shows</th>
                <th>Client cancel</th>
                <th>No-show</th>
                <th>Clinician cancel</th>
                <th>Active clients</th>
                <th>First observed</th>
                <th>Retained</th>
              </tr>
            </thead>
            <tbody>
              {metrics.attendanceByClinician.map((row) => (
                <tr key={row.clinician}>
                  <td>{row.clinician}</td>
                  <td>{row.shows}</td>
                  <td>{row.clientCancelled}</td>
                  <td>{row.noShows}</td>
                  <td>{row.clinicianCancelled}</td>
                  <td>{row.uniqueActiveClients}</td>
                  <td>{row.firstObservedClients}{row.immatureClientsExcluded ? ` (${row.immatureClientsExcluded} immature)` : ""}</td>
                  <td>{row.retainedClients}</td>
                </tr>
              ))}
              {!metrics.attendanceByClinician.length && <tr><td colSpan={8}>Import attendance CSVs to calculate show-based retention.</td></tr>}
            </tbody>
          </table>
        </section>
        <section>
          <h3>Billing charged</h3>
          <table>
            <thead>
              <tr>
                <th>Clinician</th>
                <th>Billed rows</th>
                <th>Total fees charged</th>
                <th>Configured rows</th>
                <th>Estimated billing hours</th>
              </tr>
            </thead>
            <tbody>
              {metrics.billingByClinician.map((row) => (
                <tr key={row.clinician}>
                  <td>{row.clinician}</td>
                  <td>{row.billedRows}</td>
                  <td>{money(row.totalFeesCharged)}</td>
                  <td>{row.configuredMinuteRows}</td>
                  <td>{row.estimatedBillingHours === null ? "Unconfigured" : row.estimatedBillingHours.toFixed(1)}</td>
                </tr>
              ))}
              {!metrics.billingByClinician.length && <tr><td colSpan={5}>Import billing CSVs to calculate billed counts and charged fees.</td></tr>}
            </tbody>
          </table>
        </section>
        <section>
          <h3>Room session counts</h3>
          <table>
            <thead>
              <tr>
                <th>Location</th>
                <th>Shows</th>
                <th>Client cancel</th>
                <th>No-show</th>
                <th>Clinician cancel</th>
              </tr>
            </thead>
            <tbody>
              {metrics.roomCounts.map((row) => (
                <tr key={row.location}>
                  <td>{row.location}</td>
                  <td>{row.showRows}</td>
                  <td>{row.clientCancelled}</td>
                  <td>{row.noShows}</td>
                  <td>{row.clinicianCancelled}</td>
                </tr>
              ))}
              {!metrics.roomCounts.length && <tr><td colSpan={5}>Attendance locations will appear here.</td></tr>}
            </tbody>
          </table>
        </section>
      </div>
    </section>
  );
}
