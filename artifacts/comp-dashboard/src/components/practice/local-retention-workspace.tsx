import {
  type Dispatch,
  type SetStateAction,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { ApiError } from "@workspace/api-client-react";
import { Download, FileSpreadsheet, ShieldCheck, Upload } from "lucide-react";
import {
  buildLocalRetentionMetrics,
  exportLocalBackup,
  importAttendanceCsv,
  importBillingCsv,
  importLocalBackup,
  importLocalPackage,
  mergeLocalPackage,
  mergeSnapshot,
  replaceOverlappingPackageSnapshots,
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

type CodeDraft = { code: string; minutes: string };

type PendingLocalSnapshot = {
  incoming: LocalSnapshot[];
  existing: Array<{
    id: string;
    kind: LocalFactKind;
    coverageStart: string;
    coverageEnd: string;
  }>;
  billingCodeMinutes: BillingCodeMinutes;
  packageId: string;
  warnings: string[];
  serverPackage?: unknown;
};

type HistoryStore = {
  load: () => Promise<{
    snapshots: LocalSnapshot[];
    billingCodeMinutes: BillingCodeMinutes;
  }>;
  importPackage: (
    packageData: unknown,
    replaceOverlaps?: boolean,
  ) => Promise<{
    snapshots: LocalSnapshot[];
    billingCodeMinutes: BillingCodeMinutes;
    status: "added" | "duplicate" | "replaced";
    warnings: string[];
  }>;
  saveBillingCodeMinutes: (billingCodeMinutes: BillingCodeMinutes) => Promise<{
    snapshots: LocalSnapshot[];
    billingCodeMinutes: BillingCodeMinutes;
  }>;
  restoreBackup: (backup: unknown) => Promise<{
    snapshots: LocalSnapshot[];
    billingCodeMinutes: BillingCodeMinutes;
    status: "restored";
  }>;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

const errorMessage = (cause: unknown, fallback: string) => {
  if (cause instanceof ApiError && isRecord(cause.data)) {
    const message = cause.data.error;
    if (typeof message === "string") return message;
  }
  return cause instanceof Error ? cause.message : fallback;
};

export type LocalRetentionWorkspaceState = {
  snapshots: LocalSnapshot[];
  setSnapshots: Dispatch<SetStateAction<LocalSnapshot[]>>;
  billingCodeMinutes: BillingCodeMinutes;
  setBillingCodeMinutes: Dispatch<SetStateAction<BillingCodeMinutes>>;
  codeDraft: CodeDraft;
  setCodeDraft: Dispatch<SetStateAction<CodeDraft>>;
  status: string;
  setStatus: Dispatch<SetStateAction<string>>;
  error: string;
  setError: Dispatch<SetStateAction<string>>;
  busy: boolean;
  setBusy: Dispatch<SetStateAction<boolean>>;
  pending: PendingLocalSnapshot | null;
  setPending: Dispatch<SetStateAction<PendingLocalSnapshot | null>>;
};

export function useLocalRetentionWorkspaceState(): LocalRetentionWorkspaceState {
  const [snapshots, setSnapshots] = useState<LocalSnapshot[]>([]);
  const [billingCodeMinutes, setBillingCodeMinutes] =
    useState<BillingCodeMinutes>({});
  const [codeDraft, setCodeDraft] = useState<CodeDraft>({
    code: "",
    minutes: "",
  });
  const [status, setStatus] = useState("No files imported yet.");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<PendingLocalSnapshot | null>(null);

  return {
    snapshots,
    setSnapshots,
    billingCodeMinutes,
    setBillingCodeMinutes,
    codeDraft,
    setCodeDraft,
    status,
    setStatus,
    error,
    setError,
    busy,
    setBusy,
    pending,
    setPending,
  };
}

async function readText(file: File) {
  if (
    !/\.(csv|json)$/i.test(file.name) ||
    !file.size ||
    file.size > 10 * 1024 * 1024
  )
    throw new Error(
      "Choose a CSV, Practice package, or local backup JSON file up to 10 MB.",
    );
  return await file.text();
}

export default function LocalRetentionWorkspace({
  historyStore,
  workspaceState,
}: {
  historyStore?: HistoryStore;
  workspaceState?: LocalRetentionWorkspaceState;
}) {
  const ownedState = useLocalRetentionWorkspaceState();
  const {
    snapshots,
    setSnapshots,
    billingCodeMinutes,
    setBillingCodeMinutes,
    codeDraft,
    setCodeDraft,
    status,
    setStatus,
    error,
    setError,
    busy,
    setBusy,
    pending,
    setPending,
  } = workspaceState ?? ownedState;
  const attendanceInput = useRef<HTMLInputElement>(null);
  const billingInput = useRef<HTMLInputElement>(null);
  const packageInput = useRef<HTMLInputElement>(null);
  const backupInput = useRef<HTMLInputElement>(null);
  const metrics = useMemo(
    () => buildLocalRetentionMetrics(snapshots, billingCodeMinutes),
    [snapshots, billingCodeMinutes],
  );

  useEffect(() => {
    if (!historyStore) return;
    let active = true;
    setBusy(true);
    setStatus("Loading saved converted report history...");
    historyStore
      .load()
      .then((history) => {
        if (!active) return;
        setSnapshots(history.snapshots);
        setBillingCodeMinutes(history.billingCodeMinutes);
        setStatus(
          history.snapshots.length
            ? `Loaded ${history.snapshots.length} saved converted report snapshots.`
            : "No converted reports saved yet.",
        );
      })
      .catch((cause) => {
        if (!active) return;
        setError(
          cause instanceof Error
            ? cause.message
            : "Saved converted report history could not be loaded.",
        );
        setStatus("No converted reports loaded.");
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
  }, [
    historyStore,
    setBillingCodeMinutes,
    setBusy,
    setError,
    setSnapshots,
    setStatus,
  ]);

  async function importCsv(kind: LocalFactKind, file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setError("");
    setPending(null);
    try {
      const text = await readText(file);
      const result =
        kind === "attendance"
          ? importAttendanceCsv(text)
          : importBillingCsv(text);
      const merged = mergeSnapshot(snapshots, result.snapshot);
      if (merged.status === "duplicate") {
        setStatus("That exact snapshot is already loaded. Nothing was added.");
      } else if (merged.status === "overlap") {
        setPending({
          incoming: [merged.incoming],
          existing: merged.existing,
          billingCodeMinutes: {},
          packageId: merged.incoming.id,
          warnings: [],
        });
        setStatus(
          "This snapshot overlaps loaded local data. Choose whether to replace the overlapping local snapshot.",
        );
      } else {
        setSnapshots(merged.snapshots);
        setStatus(
          historyStore
            ? `Loaded ${result.snapshot.rows.length} ${kind} rows for this page only. Use a complete package to save durable converted history.`
            : `Loaded ${result.snapshot.rows.length} ${kind} rows for ${result.snapshot.coverageStart} to ${result.snapshot.coverageEnd}.`,
        );
      }
      if (result.warnings.length) setError(result.warnings.join(" "));
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "The file could not be read.",
      );
    } finally {
      setBusy(false);
      if (kind === "attendance" && attendanceInput.current)
        attendanceInput.current.value = "";
      if (kind === "billing" && billingInput.current)
        billingInput.current.value = "";
    }
  }

  async function importPackage(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setError("");
    setPending(null);
    let packageData: unknown;
    let parsed: ReturnType<typeof importLocalPackage> | null = null;
    try {
      packageData = JSON.parse(await readText(file));
      parsed = importLocalPackage(packageData);
      if (historyStore) {
        const saved = await historyStore.importPackage(packageData);
        setSnapshots(saved.snapshots);
        setBillingCodeMinutes(saved.billingCodeMinutes);
        if (saved.status === "duplicate") {
          setStatus(
            `Package ${parsed.packageId} is already saved. Nothing was added.`,
          );
        } else {
          setStatus(
            `Saved package ${parsed.packageId}: ${parsed.snapshots[0].rows.length} attendance rows and ${parsed.snapshots[1].rows.length} billing rows.`,
          );
        }
        if (saved.warnings.length) setError(saved.warnings.join(" "));
        return;
      }
      const merged = mergeLocalPackage(snapshots, billingCodeMinutes, parsed);
      if (merged.status === "duplicate") {
        setStatus(
          `Package ${parsed.packageId} is already loaded. Nothing was added.`,
        );
      } else if (merged.status === "blocked") {
        setError(merged.reason);
        setStatus("No local data changed.");
      } else if (merged.status === "overlap") {
        setPending({
          incoming: merged.incoming,
          existing: merged.existing,
          billingCodeMinutes: parsed.billingCodeMinutes,
          packageId: parsed.packageId,
          warnings: merged.warnings,
        });
        setStatus(
          "This package overlaps loaded local data. Review before replacing overlapping local snapshots.",
        );
        if (merged.warnings.length) setError(merged.warnings.join(" "));
      } else {
        setSnapshots(merged.snapshots);
        setBillingCodeMinutes(merged.billingCodeMinutes);
        setStatus(
          `Loaded package ${parsed.packageId}: ${parsed.snapshots[0].rows.length} attendance rows and ${parsed.snapshots[1].rows.length} billing rows.`,
        );
        if (merged.warnings.length) setError(merged.warnings.join(" "));
      }
    } catch (cause) {
      if (
        historyStore &&
        parsed &&
        packageData !== undefined &&
        cause instanceof ApiError &&
        isRecord(cause.data)
      ) {
        if (
          cause.data.status === "overlap" &&
          Array.isArray(cause.data.existing)
        ) {
          setPending({
            incoming: parsed.snapshots,
            existing: cause.data.existing as PendingLocalSnapshot["existing"],
            billingCodeMinutes: parsed.billingCodeMinutes,
            packageId: parsed.packageId,
            warnings: Array.isArray(cause.data.warnings)
              ? cause.data.warnings.filter(
                  (warning): warning is string => typeof warning === "string",
                )
              : [],
            serverPackage: packageData,
          });
          setStatus(
            "This package overlaps saved converted report history. Review before replacing overlapping saved snapshots.",
          );
          setError(
            errorMessage(cause, "Saved retention history was not changed."),
          );
          return;
        }
        if (cause.data.status === "blocked") {
          setStatus("Saved retention history was not changed.");
          setError(errorMessage(cause, "The package could not be saved."));
          return;
        }
      }
      setError(errorMessage(cause, "The package could not be read."));
    } finally {
      setBusy(false);
      if (packageInput.current) packageInput.current.value = "";
    }
  }

  async function replacePending() {
    if (!pending) return;
    if (historyStore && pending.serverPackage !== undefined) {
      setBusy(true);
      try {
        const saved = await historyStore.importPackage(
          pending.serverPackage,
          true,
        );
        setSnapshots(saved.snapshots);
        setBillingCodeMinutes(saved.billingCodeMinutes);
        setStatus(
          `Replaced overlapping saved snapshots with package ${pending.packageId}.`,
        );
        const warnings = [...pending.warnings, ...saved.warnings];
        setError(warnings.length ? warnings.join(" ") : "");
        setPending(null);
      } catch (cause) {
        setError(errorMessage(cause, "The package could not be saved."));
      } finally {
        setBusy(false);
      }
      return;
    }
    const replaced = replaceOverlappingPackageSnapshots(
      snapshots,
      billingCodeMinutes,
      pending.incoming,
      pending.billingCodeMinutes,
    );
    setSnapshots(replaced.snapshots);
    setBillingCodeMinutes(replaced.billingCodeMinutes);
    setStatus(
      `Replaced overlapping local snapshots with package ${pending.packageId}.`,
    );
    const warnings = [...pending.warnings, ...replaced.warnings];
    setError(warnings.length ? warnings.join(" ") : "");
    setPending(null);
  }

  function keepExisting() {
    setStatus("Kept existing local snapshot. Incoming overlap was not loaded.");
    setPending(null);
  }

  async function addBillingCodeMinutes() {
    const code = codeDraft.code.trim();
    const minutes = Number(codeDraft.minutes);
    if (!code || !Number.isFinite(minutes) || minutes <= 0) {
      setError("Enter a billing code and positive default minutes.");
      return;
    }
    const next = { ...billingCodeMinutes, [code]: minutes };
    if (historyStore) {
      setBusy(true);
      try {
        const saved = await historyStore.saveBillingCodeMinutes(next);
        setSnapshots(saved.snapshots);
        setBillingCodeMinutes(saved.billingCodeMinutes);
        setCodeDraft({ code: "", minutes: "" });
        setStatus("Saved billing-code minutes with converted report history.");
        setError("");
      } catch (cause) {
        setError(
          errorMessage(cause, "Billing-code minutes could not be saved."),
        );
      } finally {
        setBusy(false);
      }
      return;
    }
    setBillingCodeMinutes(next);
    setCodeDraft({ code: "", minutes: "" });
    setError("");
  }

  function exportBackup() {
    localDownload(
      exportLocalBackup(snapshots, billingCodeMinutes),
      "emc-local-retention-backup.json",
    );
    setStatus(
      "Downloaded an unencrypted local JSON backup. It contains row-level local facts and should stay off the practice API.",
    );
  }

  async function importBackup(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setError("");
    setPending(null);
    try {
      const backup = JSON.parse(await readText(file));
      const parsed = historyStore
        ? await historyStore.restoreBackup(backup)
        : importLocalBackup(backup);
      setSnapshots(parsed.snapshots);
      setBillingCodeMinutes(parsed.billingCodeMinutes);
      setStatus(
        historyStore
          ? `Restored ${parsed.snapshots.length} saved converted report snapshots from backup.`
          : `Restored ${parsed.snapshots.length} local snapshots from backup.`,
      );
    } catch (cause) {
      setError(errorMessage(cause, "The backup could not be read."));
    } finally {
      setBusy(false);
      if (backupInput.current) backupInput.current.value = "";
    }
  }

  return (
    <section
      className="pw-local-retention"
      aria-label="Local retention workspace"
    >
      <div className="pw-local-retention-hero">
        <div>
          <p className="pw-eyebrow">
            {historyStore
              ? "Saved converted report history"
              : "Local-only package workspace"}
          </p>
          <h2>Retention and billed sessions</h2>
          {historyStore ? (
            <p>
              Import the converter package prepared with permanent random client
              IDs and no direct client names. Converted report facts are saved
              in the authenticated Practice app so retention, sessions, and
              charged-fee history remain available after reload and sign-in.
            </p>
          ) : (
            <p>
              Import the converter package prepared with permanent random client
              IDs and no direct client names. Rows stay in this browser page
              while you move between workspace tabs. Reloading or closing the
              page clears them unless you explicitly download a local backup.
            </p>
          )}
        </div>
        <ShieldCheck aria-hidden="true" />
      </div>

      <div className="pw-privacy-strip">
        <span>
          {historyStore
            ? "Raw names and converter mapping stay off the server."
            : "Raw rows are not sent to the API."}
        </span>
        <span>Manual session records are unchanged.</span>
        <span>Billing is charged fees, not collected payments.</span>
      </div>

      <div className="pw-local-import-grid">
        <section>
          <Upload aria-hidden="true" />
          <h3>Complete package</h3>
          <p>
            Upload the one JSON package from the local converter. It contains
            private stable IDs only.
          </p>
          <input
            ref={packageInput}
            type="file"
            accept=".json"
            disabled={busy}
            onChange={(event) => void importPackage(event.target.files?.[0])}
          />
        </section>
        <section>
          <FileSpreadsheet aria-hidden="true" />
          <h3>Attendance CSV</h3>
          <p>Client, Clinician, Date of service, optional Location, Status.</p>
          <input
            ref={attendanceInput}
            type="file"
            accept=".csv"
            disabled={busy}
            onChange={(event) =>
              void importCsv("attendance", event.target.files?.[0])
            }
          />
        </section>
        <section>
          <FileSpreadsheet aria-hidden="true" />
          <h3>Billing CSV</h3>
          <p>
            Date of Service, Client, Clinician, Total Fee, optional Billing
            Code.
          </p>
          <input
            ref={billingInput}
            type="file"
            accept=".csv"
            disabled={busy}
            onChange={(event) =>
              void importCsv("billing", event.target.files?.[0])
            }
          />
        </section>
        <section>
          <Upload aria-hidden="true" />
          <h3>Local plaintext backup</h3>
          <p>
            Exports unencrypted JSON with row-level converted facts. Store it
            only in an approved secure location.
          </p>
          <div className="pw-backup-actions">
            <button
              className="pw-button"
              disabled={busy || !snapshots.length}
              onClick={exportBackup}
            >
              <Download />
              Download local JSON backup
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
            <strong>Overlapping local data</strong>
            <p>
              Incoming package {pending.packageId} overlaps{" "}
              {pending.existing.length} loaded snapshot
              {pending.existing.length === 1 ? "" : "s"}. Replacing removes the
              overlapped local snapshots as whole snapshots before loading the
              package.
            </p>
          </div>
          <div>
            <button className="pw-button" onClick={keepExisting}>
              Keep existing
            </button>
            <button
              className="pw-button pw-primary"
              onClick={() => void replacePending()}
            >
              Replace overlapping data
            </button>
          </div>
        </div>
      )}

      {error && (
        <p className="pw-error" role="alert">
          {error}
        </p>
      )}
      <p className="pw-note">{status}</p>

      <section className="pw-billing-codes">
        <div>
          <h3>Billing-code minutes</h3>
          <p>
            Optional. Unknown codes remain unconfigured, and estimated hours are
            billing-code coverage only.
          </p>
        </div>
        <div className="pw-code-entry">
          <input
            aria-label="Billing code"
            placeholder="Code"
            value={codeDraft.code}
            onChange={(event) =>
              setCodeDraft((current) => ({
                ...current,
                code: event.target.value,
              }))
            }
          />
          <input
            aria-label="Default minutes"
            placeholder="Minutes"
            type="number"
            min={1}
            value={codeDraft.minutes}
            onChange={(event) =>
              setCodeDraft((current) => ({
                ...current,
                minutes: event.target.value,
              }))
            }
          />
          <button
            className="pw-button"
            onClick={() => void addBillingCodeMinutes()}
          >
            Add
          </button>
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
          <strong>
            {dateLabel(metrics.coverageStart)} to{" "}
            {dateLabel(metrics.coverageEnd)}
          </strong>
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
                  <td>
                    {row.firstObservedClients}
                    {row.immatureClientsExcluded
                      ? ` (${row.immatureClientsExcluded} immature)`
                      : ""}
                  </td>
                  <td>{row.retainedClients}</td>
                </tr>
              ))}
              {!metrics.attendanceByClinician.length && (
                <tr>
                  <td colSpan={8}>
                    Import attendance CSVs to calculate show-based retention.
                  </td>
                </tr>
              )}
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
                  <td>
                    {row.estimatedBillingHours === null
                      ? "Unconfigured"
                      : row.estimatedBillingHours.toFixed(1)}
                  </td>
                </tr>
              ))}
              {!metrics.billingByClinician.length && (
                <tr>
                  <td colSpan={5}>
                    Import billing CSVs to calculate billed counts and charged
                    fees.
                  </td>
                </tr>
              )}
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
              {!metrics.roomCounts.length && (
                <tr>
                  <td colSpan={5}>Attendance locations will appear here.</td>
                </tr>
              )}
            </tbody>
          </table>
        </section>
      </div>
    </section>
  );
}
