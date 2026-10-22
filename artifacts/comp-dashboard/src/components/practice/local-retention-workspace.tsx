import {
  type Dispatch,
  type SetStateAction,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { ApiError, customFetch } from "@workspace/api-client-react";
import { Download, Save, RefreshCw, Upload } from "lucide-react";
import type { StoredImportDeclarations, BillingChargeResolution } from "@workspace/practice/hub";
import { bindBillingResolutions, canonicalServicePeriod, planNextReportPeriod, type NextReportPeriodPlan } from "@workspace/practice/hub";
import { ImportDeclarationReview } from "./import-declaration-review";
import { BillingResolutionReview } from "./billing-resolution-review";
import { ReaderStatus } from "./reader-status";
import { readPracticePackageFile } from "@/lib/practice-package-file";
import { importFailureStage, importFeedbackTitle, importReceipt, type ImportFeedback } from "@/lib/import-feedback";
import { completeReportCoverage, type CompleteReportCoverage } from "@/lib/complete-report-coverage";
import { summarizeReportedBilling } from "@/lib/reported-billing";
import {
  buildLocalRetentionMetrics,
  buildSameDayShowReview,
  buildLocalVisitReconciliation,
  exportLocalBackup,
  importLocalPackage,
  localDerivedVisitDetail,
  phoneChargeAnomalies,
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
  reason?: string;
  incoming: LocalSnapshot[];
  existing: LocalSnapshot[];
  billingCodeMinutes: BillingCodeMinutes;
  packageId: string;
  packageData?: unknown;
  warnings: string[];
};

type StoredImportHistory = {
  billingResolutions?: BillingChargeResolution[];
  billingResolutionRevision?: number;
  declarations?: StoredImportDeclarations | null;
  snapshots: LocalSnapshot[];
  billingCodeMinutes: BillingCodeMinutes;
  sameDayVisitOverrides: SameDayVisitOverrides;
  packages: Array<{
    packageId: string;
    importedAt: string;
    exportedAt: string;
    contentHash: string;
    sourceIds?: string[];
  }>;
};

type ImportResponse = StoredImportHistory & {
  status: "added" | "duplicate" | "replaced" | "retained";
  importedSourceIds?: string[];
};

type CoverageConfirmation = {
  snapshotId: string;
  reportCoverage: { start: string; end: string; complete: true };
  expectedReportCoverage: LocalSnapshot["reportCoverage"] | null;
  sourceBasis: "source-report" | "owner-confirmation";
  confirmed: true;
};

function SnapshotCoverageConfirmation({ snapshot, today, disabled, onSave }: {
  snapshot: LocalSnapshot;
  today: string;
  disabled: boolean;
  onSave: (confirmation: CoverageConfirmation) => Promise<void>;
}) {
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [sourceBasis, setSourceBasis] = useState<CoverageConfirmation["sourceBasis"] | "">("");
  const [confirmed, setConfirmed] = useState(false);
  const [expectedReportCoverage] = useState(() => structuredClone(snapshot.reportCoverage ?? null));
  const ready = !!start && !!end && start <= end && end <= today && !!sourceBasis && confirmed;
  return <details className="pw-import-source">
    <summary>{snapshot.kind === "attendance" ? "Attendance" : "Billing"} · observed {snapshot.coverageStart} to {snapshot.coverageEnd} · {snapshot.reportCoverage ? "coverage declaration recorded" : "complete dates needed"}</summary>
    <p>Observed rows: {snapshot.coverageStart} through {snapshot.coverageEnd}. Observed bounds do not establish complete reporting.</p>
    {snapshot.reportCoverage && <p>Current declaration: {snapshot.reportCoverage.start} through {snapshot.reportCoverage.end}.</p>}
    <form aria-label={`Report coverage for ${snapshot.id}`} onSubmit={(event) => {
      event.preventDefault();
      if (!ready || disabled || !sourceBasis) return;
      void onSave({ snapshotId: snapshot.id, reportCoverage: { start, end, complete: true }, expectedReportCoverage, sourceBasis, confirmed: true });
    }}>
      <fieldset disabled={disabled} style={{ border: 0, padding: 0, minWidth: 0, display: "grid", gap: 12 }}>
        <label style={{ display: "grid", gap: 4 }}>Report start<input style={{ width: "100%", minWidth: 0, boxSizing: "border-box" }} aria-label="Report start" type="date" value={start} required max={today} onChange={(event) => { setStart(event.target.value); setConfirmed(false); }} /></label>
        <label style={{ display: "grid", gap: 4 }}>Report end<input style={{ width: "100%", minWidth: 0, boxSizing: "border-box" }} aria-label="Report end" type="date" value={end} required max={today} onChange={(event) => { setEnd(event.target.value); setConfirmed(false); }} /></label>
        <label style={{ display: "grid", gap: 4 }}>Confirmation basis<select style={{ width: "100%", minWidth: 0 }} aria-label="Confirmation basis" value={sourceBasis} required onChange={(event) => { setSourceBasis(event.target.value as CoverageConfirmation["sourceBasis"] | ""); setConfirmed(false); }}>
          <option value="">Choose basis</option><option value="source-report">Source report</option><option value="owner-confirmation">Owner confirmation</option>
        </select></label>
        <label style={{ display: "flex", alignItems: "flex-start", gap: 8 }}><input style={{ flexShrink: 0 }} type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} /><span>I confirm this import is a complete report for the entire entered date range, including days with no activity.</span></label>
        <button className="pw-button" type="submit" disabled={!ready || disabled}><Save aria-hidden="true" />Save coverage</button>
      </fieldset>
    </form>
  </details>;
}

class ImportConflict extends Error {
  code?: string;
  reason?: string;
  existing?: PendingLocalSnapshot["existing"];
  incoming?: PendingLocalSnapshot["incoming"];
}

export type LocalRetentionWorkspaceState = {
  importFeedback?: ImportFeedback;
  setImportFeedback?: Dispatch<SetStateAction<ImportFeedback>>;
  billingResolutions: BillingChargeResolution[];
  setBillingResolutions: Dispatch<SetStateAction<BillingChargeResolution[]>>;
  billingResolutionRevision: number;
  setBillingResolutionRevision: Dispatch<SetStateAction<number>>;
  declarations: StoredImportDeclarations | null;
  setDeclarations: Dispatch<SetStateAction<StoredImportDeclarations | null>>;
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
  const [billingResolutions, setBillingResolutions] = useState<BillingChargeResolution[]>([]);
  const [billingResolutionRevision, setBillingResolutionRevision] = useState(0);
  const [declarations, setDeclarations] = useState<StoredImportDeclarations | null>(null);
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
  const [importFeedback, setImportFeedback] = useState<ImportFeedback>({ stage: "idle" });

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    setBusy(true);
    setImportFeedback({ stage: "loading" });
    getStoredHistory()
      .then((history) => {
        if (cancelled) return;
        setSnapshots(history.snapshots);
        setDeclarations(history.declarations ?? null);
        setBillingResolutions(history.billingResolutions ?? []);
        setBillingResolutionRevision(history.billingResolutionRevision ?? 0);
        setPackages(history.packages ?? []);
        setBillingCodeMinutes(history.billingCodeMinutes);
        setSameDayVisitOverrides(history.sameDayVisitOverrides ?? {});
        setStatus(history.snapshots.length
          ? `Loaded ${history.snapshots.length} saved converted snapshots from practice storage.`
          : "No converted packages imported yet.");
        setImportFeedback({ stage: "loaded", detail: `${history.snapshots.length} saved sources loaded from practice storage.` });
      })
      .catch((cause) => {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : "Saved converted history could not be loaded.");
          setImportFeedback({ stage: "unconfirmed", detail: "Saved history could not be loaded. Reload before retrying an upload." });
        }
      })
      .finally(() => { if (!cancelled) setBusy(false); });
    return () => { cancelled = true; };
  }, [enabled]);

  return {
    importFeedback, setImportFeedback,
    billingResolutions, setBillingResolutions, billingResolutionRevision, setBillingResolutionRevision,
    declarations, setDeclarations,
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

function readImportConflict(apiError: ApiError) {
  const data = apiError.data as Record<string, unknown> | null;
  const conflict = new ImportConflict(
    typeof data?.error === "string"
      ? data.error
      : "The package could not be imported.",
  );
  conflict.code = typeof data?.code === "string" ? data.code : undefined;
  conflict.reason = typeof data?.reason === "string" ? data.reason : undefined;
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
  retainOverlaps = false,
) {
  try {
    return await customFetch<ImportResponse>("/api/practice-imports/package", {
      method: "POST",
      body: JSON.stringify({ package: packageData, replaceOverlaps, retainOverlaps }),
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
  roster = [],
  teamId = null,
}: {
  roster?: Array<{ id: number; label: string; goalId?: number | null }>;
  teamId?: number | null;
  workspaceState?: LocalRetentionWorkspaceState;
  coverageSummary?: CompleteReportCoverage;
  /** Eligible historical snapshots, including former-clinician follow-up evidence; never raw reconciliation rows. */
  metricSnapshots?: LocalSnapshot[];
  excludedFollowUpEvidence?: readonly { clientId: string; serviceDate: string }[];
  today?: string;
}) {
  const ownedState = useLocalRetentionWorkspaceState(!workspaceState);
  const [fallbackFeedback, setFallbackFeedback] = useState<ImportFeedback>({ stage: "idle" });
  const [reportMode, setReportMode] = useState<"next" | "other">("next");
  const feedback = workspaceState?.importFeedback ?? ownedState.importFeedback ?? fallbackFeedback;
  const setFeedback = workspaceState?.setImportFeedback ?? (!workspaceState ? ownedState.setImportFeedback : undefined) ?? setFallbackFeedback;
  const {
    billingResolutions: storedBillingResolutions, setBillingResolutions, billingResolutionRevision, setBillingResolutionRevision,
    declarations, setDeclarations,
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
  const billingResolutions = useMemo(() => bindBillingResolutions(storedBillingResolutions, roster, declarations?.data), [storedBillingResolutions, roster, declarations]);
  const verifiedCoverage = useMemo(() => coverageSummary ?? completeReportCoverage(snapshots, [], today), [coverageSummary, snapshots, today]);
  const eligibleMetricSnapshots = metricSnapshots ?? verifiedCoverage.eligibleSnapshots;
  const reportedCharges = useMemo(() => summarizeReportedBilling(eligibleMetricSnapshots, today, { billingResolutions }), [eligibleMetricSnapshots, today, billingResolutions]);
  const rawBillingEvidence = useMemo(() => summarizeReportedBilling(snapshots, today, { billingResolutions }).evidence, [snapshots, today, billingResolutions]);
  const chargedByClinician = useMemo(() => {
    const labels = new Map<string, { clinician: string; sourceRows: number }>();
    for (const snapshot of eligibleMetricSnapshots) if (snapshot.kind === "billing") for (const row of snapshot.rows) {
      const key = row.clinician.trim().replace(/\s+/g, " ").toLowerCase();
      const entry = labels.get(key) ?? { clinician: row.clinician.trim().replace(/\s+/g, " "), sourceRows: 0 };
      entry.sourceRows++;
      labels.set(key, entry);
    }
    return [...labels.values()].sort((a, b) => a.clinician.localeCompare(b.clinician)).map((row) => ({ ...row,
      charges: totalReportedCharges(summarizeReportedBilling(eligibleMetricSnapshots, today, { clinicianLabel: row.clinician, billingResolutions })),
    }));
  }, [eligibleMetricSnapshots, today, billingResolutions]);
  const recentCoverageGaps = [...verifiedCoverage.incompletePeriods]
    .filter((period) => period.start !== null && period.end !== null)
    .sort((a, b) => b.end!.localeCompare(a.end!) || b.start!.localeCompare(a.start!))
    .slice(0, 3);
  const remainingCoverageGaps = verifiedCoverage.incompletePeriods.length - recentCoverageGaps.length;
  const missingProofIds = new Set(verifiedCoverage.incompletePeriods.filter(period => period.snapshotId && /Missing or invalid explicit complete report proof/.test(period.reason)).map(period => period.snapshotId));
  const billingNeedsReview = rawBillingEvidence.conflictingHashCount > 0 || rawBillingEvidence.ambiguousEncounterCount > 0 || rawBillingEvidence.staleResolutionCount > 0 || phoneChargeAnomalies(snapshots).length > 0;
  const openReview = (id: string) => { const element = document.getElementById(id); if (element instanceof HTMLDetailsElement) element.open = true; };
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
  const lastPackageImport = packages.map(item => item.importedAt).sort().at(-1);
  const nextPeriod = verifiedCoverage.dataThrough ? canonicalServicePeriod(new Date(Date.parse(verifiedCoverage.dataThrough + "T12:00:00Z") + 86400000).toISOString().slice(0, 10)) : null;
  const latestPackage = [...packages].sort((a, b) => b.importedAt.localeCompare(a.importedAt) || a.packageId.localeCompare(b.packageId))[0];
  const currentHistory = { snapshots, packages, declarations, billingResolutions: storedBillingResolutions, billingResolutionRevision, billingCodeMinutes, sameDayVisitOverrides };
  const periodPlan = useMemo(() => latestPackage?.sourceIds?.length
    ? planNextReportPeriod({ snapshots, storedDeclarations: declarations, roster, teamId, newSourceIds: latestPackage.sourceIds, today, billingResolutions: storedBillingResolutions }) : null,
  [snapshots, declarations, roster, teamId, latestPackage?.sourceIds, today, storedBillingResolutions]);
  const knownPeriodSources = new Set(periodPlan?.period && periodPlan.status !== "up-to-date" ? latestPackage?.sourceIds ?? [] : []);
  const sourcesNeedingProof = snapshots.filter(source => missingProofIds.has(source.id) && !knownPeriodSources.has(source.id));
  const actionableCoverage = verifiedCoverage.incompletePeriods.filter(period => !/has not ended/.test(period.reason)
    && !(period.snapshotId && knownPeriodSources.has(period.snapshotId) && /Missing or invalid explicit complete report proof/.test(period.reason)));

  function applySavedHistory(history: StoredImportHistory) {
    setSnapshots(history.snapshots); setPackages(history.packages ?? []);
    setDeclarations(history.declarations ?? null);
    setBillingResolutions(history.billingResolutions ?? []);
    setBillingResolutionRevision(history.billingResolutionRevision ?? 0);
    setBillingCodeMinutes(history.billingCodeMinutes);
    setSameDayVisitOverrides(history.sameDayVisitOverrides ?? {});
  }

  function planSavedPeriod(history: StoredImportHistory, sourceIds: string[]) {
    return planNextReportPeriod({ snapshots: history.snapshots, storedDeclarations: history.declarations ?? null, roster, teamId,
      newSourceIds: sourceIds, today, billingResolutions: history.billingResolutions ?? [] });
  }

  async function persistPeriod(history: StoredImportHistory, packageId: string, sourceIds: string[], plan: NextReportPeriodPlan, receipt: string) {
    if (plan.status !== "ready" || !plan.data || !plan.period || !history.declarations) return false;
    setFeedback({ stage: "saving", detail: `Report rows are saved. Reconciling ${plan.period.start} through ${plan.period.end}.` });
    try {
      const saved = await customFetch<StoredImportHistory>("/api/practice-imports/declarations", { method: "PUT", body: JSON.stringify({
        expectedRevision: history.declarations.revision, confirmed: true, data: plan.data, nextPeriod: { packageId, sourceIds, teamId },
      }) });
      applySavedHistory(saved);
      setFeedback({ stage: "saved", detail: `${receipt} Reporting period ${plan.period.start} through ${plan.period.end} reconciled; ${plan.carryover.matched} prior-period rows matched without adding them again.` });
      setStatus(`Saved and reconciled the full ${plan.period.start} through ${plan.period.end} report. Original rows and prior declarations are retained.`);
      return true;
    } catch (cause) {
      const unconfirmed = importFailureStage(true, cause instanceof ApiError ? cause.status : undefined) === "unconfirmed";
      setFeedback({ stage: unconfirmed ? "unconfirmed" : "saved", detail: unconfirmed
        ? "Report rows are saved; the period update was not confirmed. Reload saved history before retrying."
        : "Report rows are saved. Period reconciliation needs review; no source was removed." });
      setError(cause instanceof Error ? cause.message : "Reporting-period reconciliation could not be confirmed.");
      return false;
    }
  }

  async function reconcileSavedPeriod() {
    if (busy || feedback.stage === "unconfirmed" || !periodPlan || periodPlan.status !== "ready" || !latestPackage?.sourceIds) return;
    setBusy(true); setError("");
    try { await persistPeriod(currentHistory, latestPackage.packageId, latestPackage.sourceIds, periodPlan, "Existing report rows remain saved."); }
    finally { setBusy(false); }
  }

  async function importPackage(file: File | undefined) {
    if (!file || busy || feedback.stage === "unconfirmed") return;
    setBusy(true);
    setError("");
    setPending(null);
    setFeedback({ stage: "validating", detail: file.name });
    let saveStarted = false;
    const periodIntent = reportMode === "next" && nextPeriod !== null;
    try {
      const packageData = await readPracticePackageFile(file);
      const parsed = importLocalPackage(packageData);
      setFeedback({ stage: "saving", detail: "File checked. Waiting for the server to confirm saved history." });
      saveStarted = true;
      const saved = await importStoredPackage(packageData);
      applySavedHistory(saved);
      const receipt = importReceipt({
        attendance: parsed.snapshots.find(source => source.kind === "attendance")?.rows.length ?? 0,
        billing: parsed.snapshots.find(source => source.kind === "billing")?.rows.length ?? 0,
      }, saved.status);
      setFeedback({ stage: saved.status === "duplicate" ? "duplicate" : "saved", detail: receipt });
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
      if (periodIntent && saved.importedSourceIds?.length) {
        const plan = planSavedPeriod(saved, saved.importedSourceIds);
        if (plan.status === "ready") await persistPeriod(saved, parsed.packageId, saved.importedSourceIds, plan, receipt);
        else if (plan.status === "blocked") {
          setFeedback({ stage: "saved", detail: `${receipt} Reporting-period reconciliation needs review.` });
          setError(plan.reasons.slice(0, 3).join(" "));
        }
      }
    } catch (cause) {
      if (
        cause instanceof ImportConflict &&
        cause.code === "OVERLAP_REVIEW_REQUIRED"
      ) {
        try {
          const packageData = await readPracticePackageFile(file);
          const parsed = importLocalPackage(packageData);
          setPending({
            reason: cause.message,
            incoming: cause.incoming ?? parsed.snapshots,
            existing: cause.existing ?? [],
            billingCodeMinutes: parsed.billingCodeMinutes,
            packageId: parsed.packageId,
            packageData,
            warnings: parsed.warnings,
          });
          setFeedback({ stage: "review", detail: cause.message });
          setStatus(
            "This package overlaps saved converted history. Keep both sources for reconciliation, or explicitly replace overlapping snapshots.",
          );
          if (parsed.warnings.length) setError(parsed.warnings.join(" "));
          return;
        } catch {
          // Fall through to the original import error.
        }
      }
      const stage = importFailureStage(saveStarted, cause instanceof ApiError ? cause.status : cause instanceof ImportConflict ? 409 : undefined);
      setFeedback({ stage, detail: stage === "unconfirmed" ? "The server did not confirm the result. Reload saved history before retrying; the save may have completed." : "No import was accepted by this request. Check the error below." });
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

  function savePending(mode: "retain" | "replace") {
    if (!pending || busy || feedback.stage === "unconfirmed") return;
    setBusy(true);
    setFeedback({ stage: "saving", detail: "Waiting for the server to confirm saved history." });
    importStoredPackage(pending.packageData, mode === "replace", mode === "retain")
      .then((saved) => {
        setSnapshots(saved.snapshots);
        setPackages(saved.packages ?? []);
        setBillingCodeMinutes(saved.billingCodeMinutes);
        setSameDayVisitOverrides(saved.sameDayVisitOverrides ?? {});
        setFeedback({ stage: saved.status === "duplicate" ? "duplicate" : "saved", detail: "Server acknowledged the saved source history. Coverage and any unresolved conflicts are shown below." });
        setStatus(
          saved.status === "duplicate"
            ? `Package ${pending.packageId} is already loaded. Nothing was added.`
            : mode === "retain"
            ? `Kept existing history and saved package ${pending.packageId} for overlap reconciliation. Matching rows are reconciled independently; conflicting facts remain reviewable. Existing settings are unchanged.`
            : `Replaced overlapping converted snapshots with package ${pending.packageId}.`,
        );
        setError(pending.warnings.length ? pending.warnings.join(" ") : "");
        setPending(null);
      })
      .catch((cause) => {
        setFeedback({ stage: importFailureStage(true, cause instanceof ApiError ? cause.status : cause instanceof ImportConflict ? 409 : undefined), detail: "Reload saved history before retrying if the save was not confirmed." });
        setError(
          cause instanceof Error
            ? cause.message
            : "The overlapping package could not be saved.",
        );
      })
      .finally(() => setBusy(false));
  }

  function keepExisting() {
    if (busy || feedback.stage === "unconfirmed") return;
    setStatus("Kept existing local snapshot. Incoming overlap was not loaded.");
    setPending(null);
    setFeedback({ stage: "loaded", detail: "Import cancelled. Previously saved history is unchanged." });
  }

  async function reloadHistory() {
    if (busy) return;
    setBusy(true); setError(""); setFeedback({ stage: "loading" });
    try {
      const saved = await getStoredHistory();
      setSnapshots(saved.snapshots); setPackages(saved.packages ?? []);
      setDeclarations(saved.declarations ?? null);
      setBillingResolutions(saved.billingResolutions ?? []);
      setBillingResolutionRevision(saved.billingResolutionRevision ?? 0);
      setBillingCodeMinutes(saved.billingCodeMinutes);
      setSameDayVisitOverrides(saved.sameDayVisitOverrides ?? {});
      setPending(null);
      setFeedback({ stage: "loaded", detail: `${saved.snapshots.length} saved sources loaded from practice storage.` });
      setStatus("Saved history reloaded from practice storage.");
    } catch (cause) {
      setFeedback({ stage: "unconfirmed", detail: "Saved history could not be loaded. Do not assume an earlier upload failed." });
      setError(cause instanceof Error ? cause.message : "Saved history could not be loaded.");
    } finally { setBusy(false); }
  }

  async function confirmSnapshotCoverage(confirmation: CoverageConfirmation) {
    if (busy || feedback.stage === "unconfirmed") return;
    setBusy(true);
    setError("");
    try {
      const saved = await customFetch<StoredImportHistory>("/api/practice-imports/report-coverage", {
        method: "PUT", body: JSON.stringify(confirmation),
      });
      setSnapshots(saved.snapshots);
      setPackages(saved.packages);
      setBillingCodeMinutes(saved.billingCodeMinutes);
      setSameDayVisitOverrides(saved.sameDayVisitOverrides);
      setStatus("Saved report coverage confirmation. Original rows, hashes and observed bounds are unchanged.");
      setFeedback({ stage: "loaded", detail: "Report coverage confirmation saved. Metric eligibility is recalculated from the saved proof and provider identities." });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Report coverage could not be confirmed. Reload history if another confirmation changed it.");
    } finally {
      setBusy(false);
    }
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
      <section className="pw-import-start" aria-label="Upload and saved status" aria-busy={busy}>
        <div className="pw-import-heading"><h2>Upload reports</h2>
          <button className="pw-button" disabled={busy} onClick={() => void reloadHistory()}><RefreshCw size={16} />Reload saved history</button>
        </div>
        {nextPeriod && <div className="pw-report-period-choice">
          <div className="pw-segmented" role="group" aria-label="Report scope">
            <button type="button" aria-pressed={reportMode === "next"} disabled={busy} onClick={() => setReportMode("next")}>Next full period</button>
            <button type="button" aria-pressed={reportMode === "other"} disabled={busy} onClick={() => setReportMode("other")}>Other report</button>
          </div>
          <span>{reportMode === "next" ? `${nextPeriod.start} – ${nextPeriod.end}` : "Saved as source history; existing coverage is unchanged"}</span>
        </div>}
        <label className="pw-import-picker"><span><Upload size={18} aria-hidden="true" />Upload converter package</span>
          <small id="converter-package-help">JSON · up to 10 MB</small>
          <input ref={packageInput} type="file" aria-label="Upload converter package" aria-describedby="converter-package-help" disabled={busy || feedback.stage === "unconfirmed"} onChange={event => void importPackage(event.target.files?.[0])} />
        </label>
        <div className="pw-import-feedback" role="status" aria-live="polite" aria-atomic="true" data-stage={feedback.stage}>
          <strong>{importFeedbackTitle(feedback)}</strong>
          {feedback.detail && <p>{feedback.detail}</p>}
          {lastPackageImport && <p>Last package saved: {lastPackageImport.replace("T", " ").replace(/\.\d+Z$/, " UTC")}</p>}
          {["loading", "validating", "saving"].includes(feedback.stage) && <progress aria-label={importFeedbackTitle(feedback)} />}
        </div>
        {periodPlan?.period && periodPlan.status !== "up-to-date" && <div className="pw-period-reconcile" aria-label="Saved report period reconciliation">
          <strong>Expected next period · {periodPlan.period.start} – {periodPlan.period.end}</strong>
          {periodPlan.carryover.rows > 0 && <p>{periodPlan.carryover.matched} / {periodPlan.carryover.rows} prior-period rows match{periodPlan.carryover.conflicts > 0 ? `; ${periodPlan.carryover.conflicts} need review` : ""}.</p>}
          {periodPlan.status === "ready" ? <>
            <p>Original records stay intact.</p>
            <button type="button" className="pw-button pw-primary" disabled={busy || feedback.stage === "unconfirmed"} onClick={() => void reconcileSavedPeriod()}>Reconcile this period</button>
          </> : <details><summary>Reconciliation needs review</summary>{periodPlan.reasons.map(reason => <p key={reason}>{reason}</p>)}</details>}
        </div>}
        {error && <p className="pw-error" role="alert">{error}</p>}
        <div className="pw-import-coverage" aria-label="Saved data and metric coverage">
          <div><span>Saved sources</span><strong>{snapshots.length}</strong></div>
          <div><span>Observed attendance through</span><strong>{dateLabel(attendanceCoverage.end)}</strong></div>
          <div><span>Observed billing through</span><strong>{dateLabel(billingCoverage.end)}</strong></div>
          <div><span>Verified metric coverage through</span><strong>{dateLabel(verifiedCoverage.dataThrough)}</strong></div>
        </div>
        {(actionableCoverage.length > 0 || rawBillingEvidence.conflictingHashCount > 0 || rawBillingEvidence.ambiguousEncounterCount > 0 || verifiedCoverage.attendanceStatusConflictCount > 0 || rawBillingEvidence.staleResolutionCount > 0 || phoneChargeAnomalies(snapshots).length > 0) &&
          <div className="pw-import-attention" aria-label="Import attention items">
            <strong>Needs attention</strong>
            {sourcesNeedingProof.length > 0 ? <p>{sourcesNeedingProof.length} saved sources lack complete report dates. Confirm the full report period, including days with no activity, before those sources can extend verified metrics.</p> : actionableCoverage.length > 0 && <p>Some report periods or provider identities remain unverified. Saved rows are retained; affected metrics remain unknown.</p>}
            {(rawBillingEvidence.conflictingHashCount > 0 || rawBillingEvidence.ambiguousEncounterCount > 0 || rawBillingEvidence.staleResolutionCount > 0 || verifiedCoverage.attendanceStatusConflictCount > 0 || phoneChargeAnomalies(snapshots).length > 0) && <p>Some source facts conflict or need a specific billing review. Affected values remain unknown.</p>}
            {(actionableCoverage.length > 0 || verifiedCoverage.attendanceStatusConflictCount > 0) && <a href="#import-coverage-review" onClick={() => openReview("import-coverage-review")}>Review coverage and identities</a>}
            {billingNeedsReview && <a href="#import-billing-review" onClick={() => openReview("import-billing-review")}>Review billing exceptions</a>}
          </div>}
      </section>
      {pending && (
        <div className="pw-overlap-review pw-import-conflict" role="alert">
          <div><strong>Source conflict needs review</strong>
            <p>{pending.reason ?? "The incoming package overlaps source evidence that cannot be reconciled safely without review."}</p>
            <p>Keeping history preserves both sources and existing settings; unresolved values remain unknown. Replacing archives entire overlapping sources, including their other dates.</p>
          </div>
          <div>
            <button className="pw-button pw-primary" disabled={busy || feedback.stage === "unconfirmed"} onClick={() => savePending("retain")}>Keep history and reconcile overlap</button>
            <button className="pw-button" disabled={busy || feedback.stage === "unconfirmed"} onClick={keepExisting}>Cancel import</button>
            <details><summary>Advanced replacement</summary><button className="pw-button" disabled={busy || feedback.stage === "unconfirmed"} onClick={() => savePending("replace")}>Replace overlapping data</button></details>
          </div>
        </div>
      )}
      <details className="pw-data-disclosure" id="import-coverage-review">
        <summary>Coverage and provider identities{actionableCoverage.length > 0 ? " · review needed" : ""}</summary>
        {sourcesNeedingProof.length > 0 && <section aria-label="Missing complete report dates">
          <h3>Confirm complete report dates</h3>
          <p>These files were saved, but only contain observed service dates. Enter the full period shown on each source report; do not use the first and last appointment as proof.</p>
          {sourcesNeedingProof.map(snapshot => <SnapshotCoverageConfirmation key={`${snapshot.id}:${JSON.stringify(snapshot.reportCoverage ?? null)}`} snapshot={snapshot} today={today} disabled={busy || feedback.stage === "unconfirmed" || snapshots.filter(source => source.id === snapshot.id).length !== 1} onSave={confirmSnapshotCoverage} />)}
        </section>}
        <details><summary>Existing provider mappings and advanced source declarations</summary>
        <section className="pw-import-provenance" aria-label="Verified complete report coverage">
        <h3>Data covers through {dateLabel(verifiedCoverage.dataThrough)}</h3>
        <p>Attendance: {dateLabel(verifiedCoverage.attendanceThrough)} · Billing: {dateLabel(verifiedCoverage.billingThrough)}</p>
        <p>{verifiedCoverage.excludedRowsCount} raw rows excluded from eligible metrics.</p>
        {(rawBillingEvidence.conflictingHashCount > 0 || rawBillingEvidence.ambiguousEncounterCount > 0) && <p>Billing source review: {rawBillingEvidence.conflictingHashCount} fee conflicts; {rawBillingEvidence.ambiguousEncounterCount} ambiguous fee encounters. Review the source evidence below.</p>}
        {rawBillingEvidence.resolvedCaseCount > 0 && <p>{rawBillingEvidence.resolvedCaseCount} exact two-charge cases accepted by owner approval.</p>}
        {rawBillingEvidence.staleResolutionCount > 0 && <p role="alert">{rawBillingEvidence.staleResolutionCount} approved cases have changed or missing evidence. Their charges remain unknown pending review.</p>}
        {verifiedCoverage.attendanceStatusConflictCount > 0 && <p>{verifiedCoverage.attendanceStatusConflictCount} conflicting attendance status groups. Affected complete provider periods are withheld, not zero; review matching diagnostics below.</p>}
        <details><summary>Coverage and billing definitions</summary>
          <p>Raw rows remain available for reconciliation and review; they are not certified actual totals. Imported coverage proof does not certify separate manual-source session history.</p>
          <p>Original exports are retained. Conflicting amounts are not added together or automatically applied as corrections; actual totals still require independently admitted complete-period evidence.</p>
          {rawBillingEvidence.resolvedCaseCount > 0 && <p>Original source signals remain: {rawBillingEvidence.originalConflictingCaseCount} fee conflicts and {rawBillingEvidence.originalAmbiguousCaseCount} ambiguous encounters. Attendance counts are unchanged; billed fees are not cash.</p>}
        </details>
        {phoneChargeAnomalies(snapshots).length > 0 && <p role="alert">PHONE charge review: {phoneChargeAnomalies(snapshots).length} raw source rows violate the zero-fee policy. Original amounts are preserved; PHONE is excluded from treatment counts and affected revenue remains unknown.</p>}
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
      <ImportDeclarationReview key={`${teamId}:${declarations?.revision ?? 0}:${snapshots.map((source) => source.id).sort().join(",")}`}
        snapshots={snapshots} roster={roster} teamId={teamId} stored={declarations} onSaved={setDeclarations} />
      <section className="pw-import-provenance" aria-label="Confirm individual import coverage">
        <h3>Confirm report coverage</h3>
        <p>Enter dates from the source report or an explicit owner confirmation. Dates are never filled from occupied service dates. This saves coverage metadata only; it does not alter source facts or establish a provider roster.</p>
        {snapshots.map((snapshot) => <SnapshotCoverageConfirmation key={`${snapshot.id}:${JSON.stringify(snapshot.reportCoverage ?? null)}`} snapshot={snapshot} today={today}
          disabled={busy || feedback.stage === "unconfirmed" || snapshots.filter((item) => item.id === snapshot.id).length !== 1} onSave={confirmSnapshotCoverage} />)}
        {snapshots.some((snapshot) => snapshots.filter((item) => item.id === snapshot.id).length !== 1) && <p>Duplicate import identities must be resolved before coverage can be confirmed.</p>}
        {!snapshots.length && <p>No saved imports to confirm.</p>}
      </section>
      </details>
      </details>
      <details className="pw-data-disclosure" id="import-billing-review"><summary>Billing exceptions{rawBillingEvidence.conflictingHashCount + rawBillingEvidence.ambiguousEncounterCount + rawBillingEvidence.staleResolutionCount > 0 ? " · review needed" : ""}</summary>
        <BillingResolutionReview revision={billingResolutionRevision} sourceKey={`${declarations?.revision ?? 0}:${snapshots.map((source) => source.id).sort().join(",")}`}
          onSaved={(resolutions, revision) => { setBillingResolutions(resolutions); setBillingResolutionRevision(revision); }} />
      </details>
      <details className="pw-data-disclosure"><summary>More data tools</summary>
      <details className="pw-data-disclosure"><summary>Saved packages and source history</summary>
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
      </details>

      <details className="pw-data-disclosure"><summary>Billing-code minutes</summary>
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
      </details>
      <details className="pw-data-disclosure"><summary>Source analysis and matching details</summary>
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
                    {row.reviewReason && <small>{row.reviewReason}</small>}
                  </td>
                  <td data-label="Attendance">{row.attendanceRows.length}<small>{[...new Set(row.attendanceRows.map((fact) => fact.status))].join(", ")}</small></td>
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
      </details>
      <details className="pw-data-disclosure"><summary>Storage and reader status</summary>
        <ReaderStatus />
        <p className="pw-note">{status}</p>
        <p>Saved import history is saved to authenticated practice storage and loaded again after sign-in or refresh.</p>
        <p>Original converted facts are retained. Billing is charged fees, not collected payments. Observed service dates alone do not establish complete reporting.</p>
      </details>
      </details>
    </section>
  );
}
