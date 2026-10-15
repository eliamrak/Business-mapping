import {
  type Dispatch,
  type SetStateAction,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { ApiError, customFetch } from "@workspace/api-client-react";
import { Download, ShieldCheck, Upload } from "lucide-react";
import { completeReportCoverage, type CompleteReportCoverage } from "@/lib/complete-report-coverage";
import { summarizeReportedBilling } from "@/lib/reported-billing";
import {
  buildLocalRetentionMetrics,
  buildSameDayShowReview,
  buildLocalVisitReconciliation,
  exportLocalBackup,
  importLocalPackage,
  localDerivedVisitDetail,
  type BillingCodeMinutes,
  type LocalSnapshot,
  type SameDayVisitOverrides,
} from "@/lib/retention-local";

const money = (value: number) =>
  value.toLocaleString("en-US", { style: "currency", currency: "USD" });
const totalReportedCharges = (summary: ReturnType<typeof summarizeReportedBilling>) =>
  summary.months.length > 0 && summary.evidence.invalidDateRowCount === 0 && summary.months.every((month) => month.charges !== null)
    ? summary.months.reduce((sum, month) => sum + month.charges!, 0) : null;
const chargedMoney = (value: number | null) => value === null ? "--" : money(value);
const dateLabel = (value: string | null) => value ?? "--";
const importedLabel = (value: string | null) =>
  value ? value.slice(0, 10) : "not loaded";
const sourceCoverage = (
  snapshots: LocalSnapshot[],
  kind: LocalSnapshot["kind"],
) => {
  const sourceSnapshots = snapshots.filter(
    (snapshot) => snapshot.kind === kind,
  );
  const serviceDates = sourceSnapshots
    .flatMap((snapshot) => snapshot.rows.map((row) => row.serviceDate))
    .sort();
  const importedAt = sourceSnapshots
    .map((snapshot) => snapshot.importedAt)
    .sort()
    .at(-1);
  return {
    start: serviceDates[0] ?? null,
    end: serviceDates.at(-1) ?? null,
    importedAt: importedAt ?? null,
  };
};
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
  existing: LocalSnapshot[];
  billingCodeMinutes: BillingCodeMinutes;
  packageId: string;
  packageData?: unknown;
  warnings: string[];
};

type StoredImportHistory = {
  snapshots: LocalSnapshot[];
  billingCodeMinutes: BillingCodeMinutes;
  sameDayVisitOverrides: SameDayVisitOverrides;
  packages: Array<{
    packageId: string;
    importedAt: string;
    exportedAt: string;
    contentHash: string;
  }>;
};

type ImportResponse = StoredImportHistory & {
  status: "added" | "duplicate" | "replaced";
};

class ImportConflict extends Error {
  code?: string;
  existing?: PendingLocalSnapshot["existing"];
  incoming?: PendingLocalSnapshot["incoming"];
}

export type LocalRetentionWorkspaceState = {
  packages: StoredImportHistory["packages"];
  setPackages: Dispatch<SetStateAction<StoredImportHistory["packages"]>>;
  snapshots: LocalSnapshot[];
  setSnapshots: Dispatch<SetStateAction<LocalSnapshot[]>>;
  billingCodeMinutes: BillingCodeMinutes;
  setBillingCodeMinutes: Dispatch<SetStateAction<BillingCodeMinutes>>;
  sameDayVisitOverrides: SameDayVisitOverrides;
  setSameDayVisitOverrides: Dispatch<SetStateAction<SameDayVisitOverrides>>;
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

export function useLocalRetentionWorkspaceState(enabled = true): LocalRetentionWorkspaceState {
  const [packages, setPackages] = useState<StoredImportHistory["packages"]>([]);
  const [snapshots, setSnapshots] = useState<LocalSnapshot[]>([]);
  const [billingCodeMinutes, setBillingCodeMinutes] =
    useState<BillingCodeMinutes>({});
  const [sameDayVisitOverrides, setSameDayVisitOverrides] =
    useState<SameDayVisitOverrides>({});
  const [codeDraft, setCodeDraft] = useState<CodeDraft>({
    code: "",
    minutes: "",
  });
  const [status, setStatus] = useState("No files imported yet.");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<PendingLocalSnapshot | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    setBusy(true);
    getStoredHistory()
      .then((history) => {
        if (cancelled) return;
        setSnapshots(history.snapshots);
        setPackages(history.packages ?? []);
        setBillingCodeMinutes(history.billingCodeMinutes);
        setSameDayVisitOverrides(history.sameDayVisitOverrides ?? {});
        setStatus(history.snapshots.length
          ? `Loaded ${history.snapshots.length} saved converted snapshots from practice storage.`
          : "No converted packages imported yet.");
      })
      .catch((cause) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "Saved converted history could not be loaded.");
      })
      .finally(() => { if (!cancelled) setBusy(false); });
    return () => { cancelled = true; };
  }, [enabled]);

  return {
    packages,
    setPackages,
    snapshots,
    setSnapshots,
    billingCodeMinutes,
    setBillingCodeMinutes,
    sameDayVisitOverrides,
    setSameDayVisitOverrides,
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
  if (!/\.json$/i.test(file.name) || !file.size || file.size > 10 * 1024 * 1024)
    throw new Error("Choose a Practice package JSON file up to 10 MB.");
  return await file.text();
}

function readImportConflict(apiError: ApiError) {
  const data = apiError.data as Record<string, unknown> | null;
  const conflict = new ImportConflict(
    typeof data?.error === "string"
      ? data.error
      : "The package could not be imported.",
  );
  conflict.code = typeof data?.code === "string" ? data.code : undefined;
  conflict.existing = Array.isArray(data?.existing)
    ? (data.existing as PendingLocalSnapshot["existing"])
    : undefined;
  conflict.incoming = Array.isArray(data?.incoming)
    ? (data.incoming as PendingLocalSnapshot["incoming"])
    : undefined;
  return conflict;
}

async function getStoredHistory() {
  return customFetch<StoredImportHistory>("/api/practice-imports");
}

async function importStoredPackage(
  packageData: unknown,
  replaceOverlaps = false,
) {
  try {
    return await customFetch<ImportResponse>("/api/practice-imports/package", {
      method: "POST",
      body: JSON.stringify({ package: packageData, replaceOverlaps }),
    });
  } catch (error) {
    if (error instanceof ApiError && error.status === 409)
      throw readImportConflict(error);
    throw error;
  }
}

async function saveStoredBillingCodeMinutes(
  billingCodeMinutes: BillingCodeMinutes,
) {
  return customFetch<StoredImportHistory>(
    "/api/practice-imports/billing-code-minutes",
    {
      method: "PUT",
      body: JSON.stringify({ billingCodeMinutes }),
    },
  );
}

async function saveStoredSameDayVisitOverrides(
  sameDayVisitOverrides: SameDayVisitOverrides,
) {
  return customFetch<StoredImportHistory>(
    "/api/practice-imports/same-day-visit-overrides",
    {
      method: "PUT",
      body: JSON.stringify({ sameDayVisitOverrides }),
    },
  );
}

export default function LocalRetentionWorkspace({
  workspaceState,
  coverageSummary,
  metricSnapshots,
  excludedFollowUpEvidence,
  today = new Date().toLocaleDateString("en-CA"),
}: {
  workspaceState?: LocalRetentionWorkspaceState;
  coverageSummary?: CompleteReportCoverage;
  /** Eligible historical snapshots, including former-clinician follow-up evidence; never raw reconciliation rows. */
  metricSnapshots?: LocalSnapshot[];
  excludedFollowUpEvidence?: readonly { clientId: string; serviceDate: string }[];
  today?: string;
}) {
  const ownedState = useLocalRetentionWorkspaceState(!workspaceState);
  const {
    packages,
    setPackages,
    snapshots,
    setSnapshots,
    billingCodeMinutes,
    setBillingCodeMinutes,
    sameDayVisitOverrides,
    setSameDayVisitOverrides,
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
  const verifiedCoverage = useMemo(() => coverageSummary ?? completeReportCoverage(snapshots, [], today), [coverageSummary, snapshots, today]);
  const eligibleMetricSnapshots = metricSnapshots ?? verifiedCoverage.eligibleSnapshots;
  const reportedCharges = useMemo(() => summarizeReportedBilling(eligibleMetricSnapshots, today), [eligibleMetricSnapshots, today]);
  const chargedByClinician = useMemo(() => {
    const labels = new Map<string, { clinician: string; sourceRows: number }>();
    for (const snapshot of eligibleMetricSnapshots) if (snapshot.kind === "billing") for (const row of snapshot.rows) {
      const key = row.clinician.trim().replace(/\s+/g, " ").toLowerCase();
      const entry = labels.get(key) ?? { clinician: row.clinician.trim().replace(/\s+/g, " "), sourceRows: 0 };
      entry.sourceRows++;
      labels.set(key, entry);
    }
    return [...labels.values()].sort((a, b) => a.clinician.localeCompare(b.clinician)).map((row) => ({ ...row,
      charges: totalReportedCharges(summarizeReportedBilling(eligibleMetricSnapshots, today, { clinicianLabel: row.clinician })),
    }));
  }, [eligibleMetricSnapshots, today]);
  const recentCoverageGaps = [...verifiedCoverage.incompletePeriods]
    .filter((period) => period.start !== null && period.end !== null)
    .sort((a, b) => b.end!.localeCompare(a.end!) || b.start!.localeCompare(a.start!))
    .slice(0, 3);
  const remainingCoverageGaps = verifiedCoverage.incompletePeriods.length - recentCoverageGaps.length;
  const gapDescription = (period: CompleteReportCoverage["incompletePeriods"][number]) =>
    `${period.kind} · ${period.snapshotId ? "unverified report span " : ""}${dateLabel(period.start)} through ${dateLabel(period.end)}${period.clinicianLabel ? ` · ${period.clinicianLabel}` : period.clinicianId === undefined ? "" : ` · clinician ${period.clinicianId}`}: ${period.reason}`;
  const packageInput = useRef<HTMLInputElement>(null);
  const metrics = useMemo(
    () =>
      buildLocalRetentionMetrics(
        metricSnapshots ?? verifiedCoverage.eligibleSnapshots,
        billingCodeMinutes,
        sameDayVisitOverrides,
        28,
        today,
        90,
        undefined,
        undefined,
        { excludedFollowUpEvidence },
      ),
    [metricSnapshots, verifiedCoverage, billingCodeMinutes, sameDayVisitOverrides, today, excludedFollowUpEvidence],
  );
  const clinicianActivityByName = useMemo(
    () =>
      new Map(
        metrics.clientActivityByClinician.map((row) => [row.clinician, row]),
      ),
    [metrics.clientActivityByClinician],
  );
  const sameDayReview = useMemo(
    () => buildSameDayShowReview(snapshots, sameDayVisitOverrides, today),
    [snapshots, sameDayVisitOverrides, today],
  );
  const reconciliation = useMemo(
    () =>
      buildLocalVisitReconciliation(snapshots, sameDayVisitOverrides, today),
    [snapshots, sameDayVisitOverrides, today],
  );
  const reconciliationReviewRows = useMemo(
    () =>
      reconciliation.rows.filter(
        (row) => row.status !== "matched" && row.reviewReason !== null,
      ),
    [reconciliation.rows],
  );
  const attendanceCoverage = useMemo(
    () => sourceCoverage(snapshots, "attendance"),
    [snapshots],
  );
  const billingCoverage = useMemo(
    () => sourceCoverage(snapshots, "billing"),
    [snapshots],
  );

  async function importPackage(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setError("");
    setPending(null);
    try {
      const packageData = JSON.parse(await readText(file));
      const parsed = importLocalPackage(packageData);
      const saved = await importStoredPackage(packageData);
      setSnapshots(saved.snapshots);
      setPackages(saved.packages ?? []);
      setBillingCodeMinutes(saved.billingCodeMinutes);
      setSameDayVisitOverrides(saved.sameDayVisitOverrides ?? {});
      if (saved.status === "duplicate") {
        setStatus(
          `Package ${parsed.packageId} is already loaded. Nothing was added.`,
        );
      } else if (saved.status === "replaced") {
        setStatus(
          `Replaced overlapping converted snapshots with package ${parsed.packageId}.`,
        );
      } else {
        setStatus(
          `Saved package ${parsed.packageId}: ${parsed.snapshots[0].rows.length} attendance rows and ${parsed.snapshots[1].rows.length} billing rows.`,
        );
      }
      if (parsed.warnings.length) setError(parsed.warnings.join(" "));
    } catch (cause) {
      if (
        cause instanceof ImportConflict &&
        cause.code === "OVERLAP_REVIEW_REQUIRED"
      ) {
        try {
          const packageData = JSON.parse(await readText(file));
          const parsed = importLocalPackage(packageData);
          setPending({
            incoming: cause.incoming ?? parsed.snapshots,
            existing: cause.existing ?? [],
            billingCodeMinutes: parsed.billingCodeMinutes,
            packageId: parsed.packageId,
            packageData,
            warnings: parsed.warnings,
          });
          setStatus(
            "This package overlaps saved converted history. Review before replacing overlapping snapshots.",
          );
          if (parsed.warnings.length) setError(parsed.warnings.join(" "));
          return;
        } catch {
          // Fall through to the original import error.
        }
      }
      setError(
        cause instanceof Error
          ? cause.message
          : "The package could not be read.",
      );
    } finally {
      setBusy(false);
      if (packageInput.current) packageInput.current.value = "";
    }
  }

  function replacePending() {
    if (!pending) return;
    setBusy(true);
    importStoredPackage(pending.packageData, true)
      .then((saved) => {
        setSnapshots(saved.snapshots);
        setPackages(saved.packages ?? []);
        setBillingCodeMinutes(saved.billingCodeMinutes);
        setSameDayVisitOverrides(saved.sameDayVisitOverrides ?? {});
        setStatus(
          `Replaced overlapping converted snapshots with package ${pending.packageId}.`,
        );
        setError(pending.warnings.length ? pending.warnings.join(" ") : "");
        setPending(null);
      })
      .catch((cause) =>
        setError(
          cause instanceof Error
            ? cause.message
            : "The overlapping package could not be saved.",
        ),
      )
      .finally(() => setBusy(false));
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
    const next = { ...billingCodeMinutes, [code]: minutes };
    setBillingCodeMinutes(next);
    void saveStoredBillingCodeMinutes(next).catch((cause) =>
      setError(
        cause instanceof Error
          ? cause.message
          : "Billing-code minutes could not be saved.",
      ),
    );
    setCodeDraft({ code: "", minutes: "" });
    setError("");
  }

  function setSameDayVisitCount(
    key: string,
    rawShowRows: number,
    value: number,
  ) {
    const parsed = Number.isFinite(value) ? Math.trunc(value) : 1;
    const count = Math.min(rawShowRows, Math.max(1, parsed));
    const next = { ...sameDayVisitOverrides };
    if (count === 1) delete next[key];
    else next[key] = count;
    setSameDayVisitOverrides(next);
    void saveStoredSameDayVisitOverrides(next)
      .then((history) => {
        setSameDayVisitOverrides(history.sameDayVisitOverrides ?? {});
        setStatus("Updated same-day visit confirmation.");
      })
      .catch((cause) =>
        setError(
          cause instanceof Error
            ? cause.message
            : "Same-day visit confirmation could not be saved.",
        ),
      );
  }

  function exportBackup() {
    localDownload(
      exportLocalBackup(snapshots, billingCodeMinutes, sameDayVisitOverrides),
      "emc-local-retention-backup.json",
    );
    setStatus(
      "Downloaded an unencrypted local JSON backup. It contains row-level local facts and should stay off the practice API.",
    );
  }

  return (
    <section
      className="pw-local-retention"
      aria-label="Local retention workspace"
    >
      <div className="pw-local-retention-hero">
        <div>
          <p className="pw-eyebrow">Saved import history</p>
          <h2>Imported clinical history</h2>
          <p>
            Import the converter package prepared with permanent random client
            IDs and no direct client names. Converted attendance and billing
            facts are saved to authenticated practice storage so biweekly
            imports accumulate across reloads and sign-ins.
          </p>
        </div>
        <ShieldCheck aria-hidden="true" />
      </div>
      <section className="pw-import-provenance" aria-label="Verified complete report coverage">
        <h3>Data covers through {dateLabel(verifiedCoverage.dataThrough)}</h3>
        <p>Attendance: {dateLabel(verifiedCoverage.attendanceThrough)} · Billing: {dateLabel(verifiedCoverage.billingThrough)}</p>
        <p>{verifiedCoverage.excludedRowsCount} raw rows excluded from eligible actual totals and historical averages. Raw rows remain available for reconciliation and review; they are not certified actual totals.</p>
        <p>Imported coverage proof does not certify separate manual-source session history.</p>
        {!coverageSummary && <p>Provider roster scope is unavailable. Actual metrics remain withheld until mapped complete-report coverage is supplied.</p>}
        {recentCoverageGaps.length > 0 && <ul aria-label="Most recent incomplete report periods">
          {recentCoverageGaps.map((period, index) => <li key={index}>{gapDescription(period)}</li>)}
        </ul>}
        {remainingCoverageGaps > 0 && <p>{remainingCoverageGaps} additional incomplete or unverified entries in Details.</p>}
        <details>
          <summary>Details: all gaps and incomplete periods ({verifiedCoverage.incompletePeriods.length})</summary>
          {verifiedCoverage.incompletePeriods.map((period, index) => <p key={index}>{gapDescription(period)}</p>)}
          {verifiedCoverage.limits.map((limit) => <p key={limit}>{limit}</p>)}
        </details>
      </section>
      <details className="pw-import-provenance" aria-label="Saved import provenance">
        <summary>Saved packages and observed service dates ({snapshots.length} snapshots)</summary>
        <p>Service-date spans describe rows present in the export. They do not prove complete reporting for missing days.</p>
        {packages.map((item) => <div className="pw-import-source" key={item.packageId}><strong>{item.packageId}</strong><span>Exported {item.exportedAt} · imported {item.importedAt}</span><small title={item.contentHash}>Content hash {item.contentHash.slice(0, 12)}</small></div>)}
        {snapshots.map((snapshot) => <div className="pw-import-source" key={snapshot.id}><strong>{snapshot.kind}: {snapshot.rows.length} rows</strong><span>Observed service dates (unverified coverage) {snapshot.coverageStart} through {snapshot.coverageEnd}</span><span>{snapshot.reportCoverage ? `Declared coverage (unverified here): ${snapshot.reportCoverage.start} through ${snapshot.reportCoverage.end}` : "Report completeness unverified"}</span><span>Imported {snapshot.importedAt}</span><small title={snapshot.sourceHash}>Source hash {snapshot.sourceHash.slice(0, 12)}</small></div>)}
        {!packages.length && <p>No package metadata is available for these snapshots.</p>}
      </details>

      <div className="pw-privacy-strip">
        <span>
          No source reports, names, paths, headers, or crosswalks are stored.
        </span>
        <span>Manual session records are unchanged.</span>
        <span>Billing is charged fees, not collected payments.</span>
        <span>
          Room use is recorded Location counts, not exact occupancy hours.
        </span>
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
          <Upload aria-hidden="true" />
          <h3>Converted history backup</h3>
          <p>
            Downloads unencrypted JSON with de-identified converted facts from
            the saved history view.
          </p>
          <div className="pw-backup-actions">
            <button
              className="pw-button"
              disabled={busy || !snapshots.length}
              onClick={exportBackup}
            >
              <Download />
              Download JSON backup
            </button>
          </div>
        </section>
      </div>

      {pending && (
        <div className="pw-overlap-review" role="alert">
          <div>
            <strong>Overlapping local data</strong>
            <p>
              Incoming package {pending.packageId} overlaps{" "}
              {pending.existing.length} saved snapshot
              {pending.existing.length === 1 ? "" : "s"}. Replacing archives
              only the overlapping converted snapshots before loading the
              package; unrelated history stays in place.
            </p>
          </div>
          <div>
            <button className="pw-button" onClick={keepExisting}>
              Keep existing
            </button>
            <button className="pw-button pw-primary" onClick={replacePending}>
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
          <button className="pw-button" onClick={addBillingCodeMinutes}>
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
                    void saveStoredBillingCodeMinutes(next).catch((cause) =>
                      setError(
                        cause instanceof Error
                          ? cause.message
                          : "Billing-code minutes could not be saved.",
                      ),
                    );
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
        <div title="Dates present in converted attendance rows. This range does not imply that every date has an attendance record.">
          <span>Attendance coverage</span>
          <strong>
            {dateLabel(attendanceCoverage.start)} to{" "}
            {dateLabel(attendanceCoverage.end)}
          </strong>
          <small>Loaded {importedLabel(attendanceCoverage.importedAt)}</small>
        </div>
        <div title="Dates present in converted billing rows. This range does not imply that every date has a billing record.">
          <span>Billing coverage</span>
          <strong>
            {dateLabel(billingCoverage.start)} to{" "}
            {dateLabel(billingCoverage.end)}
          </strong>
          <small>Loaded {importedLabel(billingCoverage.importedAt)}</small>
        </div>
        <div title="Converted attendance fact rows: shows, client cancellations, no-shows, and clinician cancellations. This is not the attended-session count.">
          <span>Attendance rows</span>
          <strong>{metrics.attendanceRows.toLocaleString()}</strong>
        </div>
        <div title="Derived attended treatment visits after consultation rows are excluded and same-day treatment duplicate show rows are collapsed unless a confirmed extra visit is marked below.">
          <span>Derived attended visits</span>
          <strong>{metrics.derivedShowVisits.toLocaleString()}</strong>
          <small>{localDerivedVisitDetail(metrics)}</small>
        </div>
        <div title="Converted billing fact rows with charged fee amounts. These are charges, not collected payments.">
          <span>Billing source rows (all codes)</span>
          <strong>{chargedByClinician.reduce((sum, row) => sum + row.sourceRows, 0).toLocaleString()}</strong>
        </div>
        <div title="Total charged fees from the converted billing source. This does not depend on visit matching and is not collected cash.">
          <span>Charged fees (all codes)</span>
          <strong>{chargedMoney(totalReportedCharges(reportedCharges))}</strong>
          <small>Includes PHONE charge facts, not treatment classification or cash.</small>
        </div>
        <div title="Attendance rows with no same client, clinician, and date billing counterpart in saved converted history. This is a matching status, not proof that billing is missing.">
          <span>Attendance without billing</span>
          <strong>{reconciliation.attendanceOnlyRows.toLocaleString()}</strong>
        </div>
        <div title="Billing rows with no same client, clinician, and date attendance counterpart in saved converted history. This is a matching status, not proof that attendance is missing.">
          <span>Billing without attendance</span>
          <strong>{reconciliation.billingOnlyRows.toLocaleString()}</strong>
        </div>
        <div title="Same stable client ID, clinician, and service date has multiple rows to pair. Rows are kept as diagnostics; this table does not resolve billing ambiguity.">
          <span>Ambiguous same-day groups</span>
          <strong>{reconciliation.ambiguousGroups.toLocaleString()}</strong>
        </div>
      </div>

      <div className="pw-local-tables">
        <details>
          <summary>Same-day exceptions</summary>
          <p className="pw-note">
            No action is required for ordinary duplicate rows: the default one
            attended visit is already applied. Open this only to confirm a
            genuine second same-day appointment; billing amounts stay unchanged.
          </p>
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Clinician</th>
                <th>Client ID</th>
                <th>Locations</th>
                <th>Show rows</th>
                <th>Count as visits</th>
                <th>Collapsed</th>
              </tr>
            </thead>
            <tbody>
              {sameDayReview.slice(0, 50).map((group) => (
                <tr key={group.key}>
                  <td data-label="Date">{group.serviceDate}</td>
                  <td data-label="Clinician">{group.clinician}</td>
                  <td data-label="Client ID">{group.clientId}</td>
                  <td data-label="Locations">{group.locations.join(", ")}</td>
                  <td data-label="Show rows">{group.rawShowRows}</td>
                  <td data-label="Count as visits">
                    <select
                      aria-label={`Confirmed visits for ${group.clientId} on ${group.serviceDate}`}
                      disabled={busy}
                      value={group.confirmedVisitCount}
                      onChange={(event) =>
                        setSameDayVisitCount(
                          group.key,
                          group.rawShowRows,
                          Number(event.target.value),
                        )
                      }
                    >
                      {Array.from(
                        { length: group.rawShowRows },
                        (_, index) => index + 1,
                      ).map((count) => (
                        <option value={count} key={count}>
                          {count}
                          {count === 1 ? " (default)" : ""}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td data-label="Collapsed">
                    {group.collapsedRows}
                    {group.overrideApplied ? " (confirmed)" : ""}
                  </td>
                </tr>
              ))}
              {!sameDayReview.length && (
                <tr>
                  <td colSpan={7}>
                    Same-day duplicate rows will appear here only when an
                    exception can be confirmed.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </details>
        <details>
          <summary>Matching diagnostics</summary>
          <p className="pw-note">
            These rows are saved diagnostics for billing-only and ambiguous
            same-day counterparts. They are not an action queue, and unresolved
            fee values are left unknown rather than treated as zero.
          </p>
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Clinician</th>
                <th>Client ID</th>
                <th>Status</th>
                <th>Attendance</th>
                <th>Billing</th>
                <th>Billed fee</th>
              </tr>
            </thead>
            <tbody>
              {reconciliationReviewRows.slice(0, 50).map((row) => (
                <tr key={row.key}>
                  <td data-label="Date">{row.serviceDate}</td>
                  <td data-label="Clinician">{row.clinician}</td>
                  <td data-label="Client ID">{row.clientId}</td>
                  <td data-label="Status">
                    {row.status === "matched"
                      ? "Matched"
                      : row.status === "attendance_only"
                        ? "Attendance only"
                        : row.status === "billing_only"
                          ? "Billing only"
                          : "Ambiguous same-day pairing"}
                  </td>
                  <td data-label="Attendance">{row.attendanceRows.length}</td>
                  <td data-label="Billing">{row.billingRows.length}</td>
                  <td data-label="Billed fee">
                    {row.totalFeeCharged === null
                      ? "Unknown"
                      : money(row.totalFeeCharged)}
                  </td>
                </tr>
              ))}
              {!reconciliationReviewRows.length && (
                <tr>
                  <td colSpan={7}>
                    Billing-only and ambiguous matching diagnostics will appear
                    here when present.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </details>
        <section>
          <h3>Attendance and retention</h3>
          <table>
            <thead>
              <tr>
                <th>Clinician</th>
                <th>Derived shows</th>
                <th>Client cancel</th>
                <th>No-show</th>
                <th>Clinician cancel</th>
                <th>Active clients</th>
                <th>Initial retention</th>
                <th>90-day clinician-final sessions</th>
              </tr>
            </thead>
            <tbody>
              {metrics.attendanceByClinician.map((row) => {
                const activity = clinicianActivityByName.get(row.clinician);
                const latestSixRange =
                  activity && activity.latestSixEndingMonths.length > 0
                    ? `${activity.latestSixEndingMonths[0]} to ${activity.latestSixEndingMonths.at(-1)}`
                    : null;
                return (
                  <tr key={row.clinician}>
                    <td data-label="Clinician">{row.clinician}</td>
                    <td data-label="Derived shows">{row.shows}</td>
                    <td data-label="Client cancel">{row.clientCancelled}</td>
                    <td data-label="No-show">{row.noShows}</td>
                    <td data-label="Clinician cancel">
                      {row.clinicianCancelled}
                    </td>
                    <td data-label="Active clients">
                      {row.uniqueActiveClients}
                    </td>
                    <td data-label="Initial retention">
                      {activity?.initialRetentionPct === null ||
                      activity?.initialRetentionPct === undefined
                        ? "--"
                        : `${activity.initialRetentionPct.toFixed(1)}%`}
                      {activity
                        ? ` (${activity.retainedClients}/${activity.initialRetentionDenominator}; ${activity.pendingInitialClients} pending)`
                        : ""}
                    </td>
                    <td data-label="90-day clinician-final sessions">
                      {activity?.averageClientEndingsPerLatestSixMonths ===
                        null ||
                      activity?.averageClientEndingsPerLatestSixMonths ===
                        undefined
                        ? "--"
                        : `${activity.averageClientEndingsPerLatestSixMonths.toFixed(1)}/mo`}
                      {activity
                        ? ` (${activity.latestSixClientEnds}/${activity.latestSixEndingMonths.length} latest full months${latestSixRange ? `, ${latestSixRange}` : ""}; clinician-final, not practice exits; cutoff ${activity.endingObservationCutoff ?? "--"}${activity.partialEndingMonth ? `; partial ${activity.partialEndingMonth.month} ${activity.partialEndingMonth.endedClients} through ${activity.partialEndingMonth.through}` : ""})`
                        : ""}
                    </td>
                  </tr>
                );
              })}
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
          <h3>Charged fees by clinician</h3>
          <p>All billing codes, including PHONE. Source-row counts are not unique visits; charged totals reconcile overlapping sources.</p>
          <table>
            <thead><tr><th>Clinician</th><th>Billing source rows</th><th>Total fees charged</th></tr></thead>
            <tbody>
              {chargedByClinician.map((row) => <tr key={row.clinician}>
                <td data-label="Clinician">{row.clinician}</td>
                <td data-label="Billing source rows">{row.sourceRows}</td>
                <td data-label="Total fees charged">{chargedMoney(row.charges)}</td>
              </tr>)}
              {!chargedByClinician.length && <tr><td colSpan={3}>No eligible complete-report billing facts.</td></tr>}
            </tbody>
          </table>
          <h3>Treatment billing-minute analysis</h3>
          <p>Treatment-code source rows only; PHONE consultations are excluded from this minute estimate.</p>
          <table>
            <thead>
              <tr>
                <th>Clinician</th>
                <th>Treatment source rows</th>
                <th>Configured rows</th>
                <th>Estimated billing hours</th>
              </tr>
            </thead>
            <tbody>
              {metrics.billingByClinician.map((row) => (
                <tr key={row.clinician}>
                  <td data-label="Clinician">{row.clinician}</td>
                  <td data-label="Treatment source rows">{row.billedRows}</td>
                  <td data-label="Configured rows">
                    {row.configuredMinuteRows}
                  </td>
                  <td data-label="Estimated billing hours">
                    {row.estimatedBillingHours === null
                      ? "Unconfigured"
                      : row.estimatedBillingHours.toFixed(1)}
                  </td>
                </tr>
              ))}
              {!metrics.billingByClinician.length && (
                <tr>
                  <td colSpan={4}>
                    No eligible treatment billing rows for minute analysis.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </section>
        <section>
          <h3>Recorded room use</h3>
          <table>
            <thead>
              <tr>
                <th>Attendance location</th>
                <th>Derived shows</th>
                <th>Client cancel</th>
                <th>No-show</th>
                <th>Clinician cancel</th>
              </tr>
            </thead>
            <tbody>
              {metrics.roomCounts.map((row) => (
                <tr key={row.location}>
                  <td data-label="Attendance location">{row.location}</td>
                  <td data-label="Derived shows">{row.showRows}</td>
                  <td data-label="Client cancel">{row.clientCancelled}</td>
                  <td data-label="No-show">{row.noShows}</td>
                  <td data-label="Clinician cancel">
                    {row.clinicianCancelled}
                  </td>
                </tr>
              ))}
              {!metrics.roomCounts.length && (
                <tr>
                  <td colSpan={5}>
                    Imported attendance locations will appear here.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </section>
      </div>
    </section>
  );
}
