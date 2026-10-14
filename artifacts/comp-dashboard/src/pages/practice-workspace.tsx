import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  customFetch,
  useListBusinessGoals,
  useListScenarios,
  ApiError,
} from "@workspace/api-client-react";
import {
  Building2,
  Users,
  FlaskConical,
  Flag,
  ArrowRight,
  Plus,
  Settings2,
  RotateCcw,
  X,
  ChevronRight,
  ChevronDown,
  PanelTop,
  ChartNoAxesCombined,
  Download,
  Upload,
  Save,
  Trash2,
  FolderOpen,
} from "lucide-react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  ReferenceLine,
} from "recharts";
import {
  forecast,
  referencedClinicianIds,
  observed,
  observedSeries,
  workspaceSchema,
  focusedPlanAdoptionSchema,
  goalSchema,
  fundGoalSchema,
  consultAttributionOverrideSchema,
  budgetSchema,
  categorySchema,
  roomSchema,
  campaignSchema,
  funnelSchema,
  periodSchema,
  clinicianSettingSchema,
  termSchema,
  staffTermSchema,
  allocationSchema,
  type Workspace,
  type Context,
  type Collection,
  type Clinician,
  type Proposal,
  type Values,
} from "@workspace/practice/hub";
import { daysInclusive } from "@workspace/practice";
import {
  calculateClinicianMetrics,
  calculateStaffMemberCost,
} from "@workspace/practice/compensation";
import {
  getHub,
  getContext,
  hubKey,
  writeHub,
  type HubSnapshot,
} from "@/lib/hub-api";
import {
  copyPractice,
  makePlanningScenario,
  makeSandboxModel,
  blankPractice,
  readPracticeGoal,
  practiceChanges,
  type PracticeCopy,
} from "@/lib/practice-goals";
import {
  exportSection,
  importSection,
  type SectionBundle,
  type TransferSection,
} from "@/lib/section-transfer";
import { calculateGoalPace, type PacePoint } from "@/lib/goal-pace";
import { resolveWorkspaceDefaults } from "@/lib/workspace-defaults";
import {
  buildPracticeProjection,
  type PracticeView,
} from "@/lib/practice-projection";
import { buildImportedSessionOverlay } from "@/lib/import-derived-sessions";
import {
  compareOperatingPlans,
  summarizeOperatingPlan,
} from "@/lib/operating-plan";
import {
  fundProjectionSummary,
  periodOverheadSummary,
} from "@/lib/practice-money-visuals";
import { evaluateCompletedGoal } from "@/lib/completed-goals";
import { planRevisionSignature, planFocusHighlights } from "@/lib/plan-focus";
import { overviewClientFlow, overviewFundingSummary } from "@/lib/practice-overview";
import { moneyBridgeSummary } from "@/lib/money-bridge";
import { linkedGoalFor, linkedFundGoalFor, type LinkedPracticeGoal, type LinkedFundGoal } from "@/lib/legacy-practice-goals";
import { completedFundGoalStatus } from "@/lib/completed-fund-goals";
import { newRecord } from "@/components/hub/config";
import RecordEditor from "@/components/hub/record-editor";
import RecordTable from "@/components/hub/record-table";
import Settings, { SettingsEditor } from "@/components/hub/settings";
import Updates from "@/components/hub/updates";
import { type ViewProps, fmt, monthLabel } from "@/components/hub/views";
import WorkspaceSessions from "@/components/practice/workspace-sessions";
import { selectedPeriodSessionSummary } from "@/lib/session-trend";
import WorkspaceCalculations from "@/components/practice/workspace-calculations";
import LocalRetentionWorkspace, {
  useLocalRetentionWorkspaceState,
} from "@/components/practice/local-retention-workspace";
import {
  buildLocalRetentionMetrics,
  estimateLocalClientActivity,
  mergeImportedLocationRooms,
  summarizeConsultConversions,
} from "@/lib/retention-local";
import LeadFlow from "@/components/practice/lead-flow";
import {
  applyBulkLeads,
  planBulkLeads,
  type LeadBulkChange,
} from "@/lib/bulk-lead-flow";
import MoneyFlowToday from "@/components/practice/money-flow-today";
import WeeklyBlocks from "@/components/practice/weekly-blocks";
import SandboxView from "@/components/sandbox-view";
import BusinessGoalsTab from "@/components/tabs/business-goals-tab";
import CurrentRealityTab from "@/components/tabs/current-reality-tab";
import TeamBuilderTab from "@/components/tabs/team-builder-tab";
import ClinicianImpactViewTab from "@/components/tabs/clinician-impact-tab";
import ScenarioBuilderTab from "@/components/tabs/scenario-builder-tab";
import ScenarioComparisonTab from "@/components/tabs/scenario-comparison-tab";
import PDFExportTab from "@/components/tabs/export-tab";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import "@/pages/practice.css";
import "@/pages/hub.css";
import "@/pages/practice-workspace.css";
import "@/pages/practice-approved.css";

type Mode = "practice" | "sandbox" | "goals";
type IntegratedTool =
  | "team"
  | "impact"
  | "reality"
  | "business-goals"
  | "compensation-model"
  | "scenarios"
  | "compare";
type ToolTab = { id: IntegratedTool | null; label: string };

function IntegratedToolContent({
  tool,
  teamId,
}: {
  tool: IntegratedTool;
  teamId: number | null;
}) {
  switch (tool) {
    case "team":
      return <TeamBuilderTab teamId={teamId} />;
    case "impact":
      return <ClinicianImpactViewTab teamId={teamId} />;
    case "reality":
      return <CurrentRealityTab />;
    case "business-goals":
      return <BusinessGoalsTab />;
    case "compensation-model":
      return <SandboxView />;
    case "scenarios":
      return <ScenarioBuilderTab />;
    case "compare":
      return <ScenarioComparisonTab />;
  }
}

type PaceMetric = "sessions" | "revenue" | "profit";
type Section =
  | "clinicians"
  | "sessions"
  | "retention"
  | "calculations"
  | "marketing"
  | "rooms"
  | "budgets"
  | "money"
  | "summary"
  | "current-goals"
  | "settings"
  | "documents";
type SharedPeriod =
  | "30d"
  | "60d"
  | "90d"
  | "6m"
  | "year"
  | "overall"
  | "4pay"
  | "4weeks"
  | "custom";
type SessionMetricView = "sessions" | "retention" | "attrition";
type PlanAdoptionMetadata = {
  adoptedAt: string;
  adoptedRevision: number;
  focusKpis: string[];
  highlights: string[];
  assumptionSignature: string;
};
const sections: { id: Section; label: string; active?: Section[] }[] = [
  { id: "summary", label: "Overview" },
  { id: "sessions", label: "Sessions", active: ["sessions"] },
  { id: "clinicians", label: "Team" },
  { id: "money", label: "Money" },
  { id: "marketing", label: "Growth", active: ["marketing", "rooms"] },
  { id: "current-goals", label: "Goals" },
];
const sharedPeriodOptions: { id: SharedPeriod; label: string }[] = [
  { id: "30d", label: "30 days" },
  { id: "60d", label: "60 days" },
  { id: "90d", label: "90 days" },
  { id: "6m", label: "6 months" },
  { id: "year", label: "Year" },
  { id: "overall", label: "Overall" },
  { id: "4pay", label: "Last 4 completed pay periods" },
  { id: "4weeks", label: "Last 4 completed weeks" },
  { id: "custom", label: "Custom dates" },
];
const transferableSections = new Set<Section>([
  "clinicians",
  "sessions",
  "marketing",
  "rooms",
  "budgets",
  "money",
]);
const isTransferSection = (value: Section): value is TransferSection =>
  transferableSections.has(value);
const money = (n: number | null | undefined) => fmt(n, "currency");
const percent = (n: number | null | undefined) =>
  n === null || n === undefined ? "--" : `${Math.round(n * 100)}%`;
const optionalNumber = (value: string) =>
  value.trim() === "" ? null : Number(value);
const displayName = (value: string | null | undefined, fallback: string) =>
  value?.trim() || fallback;
const changeValue = (value: unknown) =>
  value === null || value === undefined || value === ""
    ? "Not set"
    : typeof value === "boolean"
      ? value
        ? "Yes"
        : "No"
      : Array.isArray(value)
        ? `${value.length} recurring ${value.length === 1 ? "block" : "blocks"}`
        : typeof value === "object"
          ? "Updated"
          : String(value);
const operatingCost = (values: Values, ownerBurdenPct: number) =>
  (values.clinicianPay ?? 0) +
  (values.employerBurden ?? 0) +
  (values.staffCost ?? 0) +
  (values.overhead ?? 0) +
  (values.marketing ?? 0) +
  (values.fees ?? 0) +
  (values.ownerPayroll ?? 0) * (1 + ownerBurdenPct / 100);
const periodLabel = (start: string, end: string) => {
  const short = (date: string) =>
    new Date(date + "T12:00:00").toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    });
  return `${short(start)} - ${short(end)}, ${end.slice(0, 4)}`;
};
const normalizeClinicianName = (value: string) =>
  value.trim().replace(/\s+/g, " ").toLowerCase();
const shiftDate = (date: string, days: number) =>
  new Date(Date.parse(date + "T12:00:00Z") + days * 86_400_000)
    .toISOString()
    .slice(0, 10);
const sharedPeriodRange = (
  period: SharedPeriod,
  today: string,
  custom: { start: string; end: string },
) => {
  if (period === "custom") return custom;
  if (period === "overall") return { start: "0000-01-01", end: today };
  if (period === "year")
    return { start: `${today.slice(0, 4)}-01-01`, end: today };
  const days =
    period === "60d"
      ? 60
      : period === "90d"
        ? 90
        : period === "6m"
          ? 183
          : period === "4pay"
            ? 56
            : period === "4weeks"
              ? 28
              : 30;
  return { start: shiftDate(today, -(days - 1)), end: today };
};
const sharedPeriodLabel = (period: SharedPeriod) =>
  sharedPeriodOptions.find((option) => option.id === period)?.label ?? "30 days";
const roomHours = (room: Workspace["rooms"][number]) =>
  room.blocks.length
    ? room.blocks.reduce(
        (sum, block) => sum + block.endHour - block.startHour,
        0,
      )
    : room.weeklyHours;
const assignedRoomHours = (room: Workspace["rooms"][number]) =>
  room.assignments.reduce(
    (total, assigned) =>
      total +
      (room.blocks.length
        ? room.blocks
            .filter((open) => open.day === assigned.day)
            .reduce(
              (sum, open) =>
                sum +
                Math.max(
                  0,
                  Math.min(open.endHour, assigned.endHour) -
                    Math.max(open.startHour, assigned.startHour),
                ),
              0,
            )
        : assigned.endHour - assigned.startHour),
    0,
  );
const metrics = [
  { key: "revenue", label: "Revenue" },
  { key: "profit", label: "Profit" },
  { key: "familyTakeHome", label: "Family take-home" },
];
const paceLabels: Record<PaceMetric, string> = {
  sessions: "sessions / month",
  revenue: "revenue / month",
  profit: "profit / month",
};
const paceValue = (value: number | null | undefined, metric: PaceMetric) =>
  metric === "sessions" ? fmt(value) : money(value);
const varianceText = (value: number | null, metric: PaceMetric) =>
  value === null
    ? "No matching goal month"
    : (value >= 0 ? "" : "-") +
      paceValue(Math.abs(value), metric) +
      (value >= 0 ? " ahead" : " behind");
const active = <T extends { archived?: boolean }>(rows: T[]) =>
  rows.filter((r) => !r.archived);
const planAdoptionMetadata = (
  proposal: Proposal,
  workspace: Workspace,
): PlanAdoptionMetadata | null => {
  const value = (workspace.focusedPlanAdoptions ?? []).find((adoption) => !adoption.archived && adoption.proposalId === proposal.id);
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (
    typeof record.adoptedAt !== "string" ||
    typeof record.adoptedRevision !== "number" ||
    !Array.isArray(record.focusKpis) ||
    !Array.isArray(record.highlights) ||
    typeof record.assumptionSignature !== "string"
  )
    return null;
  return {
    adoptedAt: record.adoptedAt,
    adoptedRevision: record.adoptedRevision,
    focusKpis: record.focusKpis.filter(
      (item): item is string => typeof item === "string",
    ),
    highlights: record.highlights.filter(
      (item): item is string => typeof item === "string",
    ),
    assumptionSignature: record.assumptionSignature,
  };
};
const errorText = (e: unknown) =>
  e instanceof ApiError
    ? ((e.data as { error?: string })?.error ?? e.message)
    : e instanceof Error
      ? e.message
      : "Save not confirmed. Please retry.";

function NumberField({
  label,
  caption,
  value,
  onSave,
  unit,
  max = 1e9,
  disabled = false,
}: {
  label: string;
  caption?: string;
  value: number;
  onSave: (value: number) => Promise<void>;
  unit?: string;
  max?: number;
  disabled?: boolean;
}) {
  const [text, setText] = useState(String(value));
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => setText(String(value)), [value]);
  async function save() {
    const next = Number(text);
    if (!text.trim() || !Number.isFinite(next) || next < 0 || next > max) {
      setError("Enter a number from 0 to " + max + ".");
      return;
    }
    if (next === value) {
      setError("");
      return;
    }
    setBusy(true);
    try {
      await onSave(next);
      setError("");
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <label className={"pw-number " + (error ? "pw-invalid" : "")}>
      <span>{caption ?? label}</span>
      <div>
        {unit === "$" && <b>$</b>}
        <input
          aria-label={label}
          type="number"
          min="0"
          max={max}
          step="any"
          value={text}
          disabled={disabled || busy}
          onChange={(e) => setText(e.target.value)}
          onBlur={() => void save()}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
            if (e.key === "Escape") {
              setText(String(value));
              setError("");
            }
          }}
        />
        {unit && unit !== "$" && <b>{unit}</b>}
      </div>
      {error && (
        <small role="alert">
          {error}{" "}
          <button type="button" onClick={() => void save()}>
            Retry
          </button>
        </small>
      )}
    </label>
  );
}
function DraftField({
  label,
  value,
  onChange,
  type = "text",
  min,
  max,
  step,
}: {
  label: string;
  value: string | number | null | undefined;
  onChange: (value: string) => void;
  type?: "text" | "number" | "date";
  min?: number;
  max?: number;
  step?: number;
}) {
  const [text, setText] = useState(value == null ? "" : String(value));
  useEffect(() => setText(value == null ? "" : String(value)), [value]);
  return (
    <label className="pw-draft-field">
      <span>{label}</span>
      <input
        type={type}
        aria-label={label}
        min={min}
        max={max}
        step={type === "number" ? (step ?? "any") : undefined}
        value={text}
        onChange={(event) => setText(event.target.value)}
        onBlur={() => {
          if (
            type === "number" &&
            text.trim() &&
            (!Number.isFinite(Number(text)) ||
              Number(text) < (min ?? 0) ||
              Number(text) > (max ?? Infinity))
          )
            setText(value == null ? "" : String(value));
          else if (text !== (value == null ? "" : String(value)))
            onChange(text);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
          if (event.key === "Escape")
            setText(value == null ? "" : String(value));
        }}
      />
    </label>
  );
}
function EditButton({
  label,
  onClick,
}: {
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      className="pw-icon"
      aria-label={label}
      title={label}
      onClick={onClick}
    >
      <Settings2 />
    </button>
  );
}

function SharedPeriodControls({
  period,
  custom,
  onPeriod,
  onCustom,
  note,
}: {
  period: SharedPeriod;
  custom: { start: string; end: string };
  onPeriod: (period: SharedPeriod) => void;
  onCustom: (range: { start: string; end: string }) => void;
  note?: string;
}) {
  return (
    <div className="pw-shared-period">
      <p>{note ?? "Reporting period carries across tabs."}</p>
      <label>
        Period
        <select
          aria-label="Shared reporting period"
          value={period}
          onChange={(event) => onPeriod(event.target.value as SharedPeriod)}
        >
          {sharedPeriodOptions.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      {period === "custom" && (
        <div className="pw-custom-period">
          <label>
            From
            <input
              type="date"
              value={custom.start}
              onChange={(event) =>
                onCustom({ ...custom, start: event.target.value })
              }
            />
          </label>
          <label>
            Through
            <input
              type="date"
              value={custom.end}
              onChange={(event) =>
                onCustom({ ...custom, end: event.target.value })
              }
            />
          </label>
        </div>
      )}
    </div>
  );
}

function MetricTargetBar({
  value,
  goal,
  benchmark,
  limit,
  lowerIsBetter = false,
  max,
  valueLabel = "Recorded",
}: {
  value: number | null | undefined;
  goal?: number | null;
  benchmark?: number | null;
  limit?: number | null;
  lowerIsBetter?: boolean;
  max?: number;
  valueLabel?: string;
}) {
  const finiteValues = [value, goal, benchmark, limit].filter(
    (item): item is number => item !== null && item !== undefined && Number.isFinite(item) && item >= 0,
  );
  const scale = Math.max(max ?? 0, ...finiteValues, 1) * 1.08;
  const pct = (item: number | null | undefined) =>
    item === null || item === undefined || !Number.isFinite(item) ? null : Math.max(0, Math.min(100, (item / scale) * 100));
  return (
    <div
      className={`pw-target-bar ${lowerIsBetter ? "pw-lower-better" : ""}`}
      aria-label={`${valueLabel}, goal, benchmark, and capacity comparison`}
    >
      <div className="pw-target-track">
        {pct(value) !== null && (
          <span
            className="pw-target-fill"
            style={{ width: `${pct(value)}%` }}
          />
        )}
        {pct(benchmark) !== null && (
          <i
            className="pw-benchmark-marker"
            style={{ left: `${pct(benchmark)}%` }}
          />
        )}
        {pct(goal) !== null && (
          <i className="pw-goal-marker" style={{ left: `${pct(goal)}%` }} />
        )}
        {pct(limit) !== null && (
          <i className="pw-limit-marker" style={{ left: `${pct(limit)}%` }} />
        )}
      </div>
      <div className="pw-marker-legend">
        <span>
          <i className="pw-actual-key" /> {valueLabel}
        </span>
        {benchmark !== null && benchmark !== undefined && (
          <span>
            <i className="pw-benchmark-key" /> Practice benchmark
          </span>
        )}
        {goal !== null && goal !== undefined && (
          <span>
            <i className="pw-goal-key" /> Goal
          </span>
        )}
        {limit !== null && limit !== undefined && (
          <span>
            <i className="pw-limit-key" /> Real capacity limit
          </span>
        )}
      </div>
    </div>
  );
}

export default function PracticeWorkspace() {
  const cache = useQueryClient();
  const query = useQuery({ queryKey: hubKey, queryFn: getHub });
  const contextQuery = useQuery({
    queryKey: ["hub-context"],
    queryFn: getContext,
  });
  const teams = useListBusinessGoals();
  const legacyScenarioQuery = useListScenarios();
  const [mode, setMode] = useState<Mode>("practice");
  const [integratedTool, setIntegratedTool] = useState<IntegratedTool | null>(
    null,
  );
  const [exportOpen, setExportOpen] = useState(false);
  const [practiceView] = useState<PracticeView>("actual");
  const [section, setSection] = useState<Section>("summary");
  const [sessionMetricView, setSessionMetricView] =
    useState<SessionMetricView>("sessions");
  const [sharedPeriod, setSharedPeriod] = useState<SharedPeriod>("30d");
  const [customPeriod, setCustomPeriod] = useState({
    start: "2026-09-01",
    end: "2026-10-14",
  });
  const [sharedContributor, setSharedContributor] = useState("Whole Practice");
  const [compareWholePractice, setCompareWholePractice] = useState(false);
  const [consultReviewClinicians, setConsultReviewClinicians] = useState<Record<string, string>>({});
  const localRetentionState = useLocalRetentionWorkspaceState();
  const [draft, setDraft] = useState<PracticeCopy | null>(null);
  const [draftMode, setDraftMode] = useState<"goals" | "sandbox" | null>(null);
  const [base, setBase] = useState<PracticeCopy | null>(null);
  const [draftStart, setDraftStart] = useState<PracticeCopy | null>(null);
  const [sourceRevision, setSourceRevision] = useState(0);
  const [editor, setEditor] = useState<{
    collection: Collection;
    record: Record<string, unknown>;
  } | null>(null);
  const [settings, setSettings] = useState<string | null>(null);
  const [detail, setDetail] = useState<Collection | null>(null);
  const [goalName, setGoalName] = useState("");
  const [goalDialog, setGoalDialog] = useState(false);
  const [planningId, setPlanningId] = useState<string | null>(null);
  const [sandboxId, setSandboxId] = useState<string | null>(null);
  const [sandboxName, setSandboxName] = useState("");
  const [sandboxDialog, setSandboxDialog] = useState(false);
  const [sandboxLibraryOpen, setSandboxLibraryOpen] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);
  const [transferSection, setTransferSection] =
    useState<TransferSection>("clinicians");
  const [transferFile, setTransferFile] = useState<SectionBundle | null>(null);
  const [resetDialog, setResetDialog] = useState(false);
  const [archiveTarget, setArchiveTarget] = useState<{
    collection: Collection;
    id: string;
  } | null>(null);
  const [sessionEditing, setSessionEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [marketingTab, setMarketingTab] = useState("results");
  const [moneyMonthIndex, setMoneyMonthIndex] = useState(0);
  const [summaryMonthDate, setSummaryMonthDate] = useState("");
  const [fillHorizonMonths, setFillHorizonMonths] = useState(6);
  const [stagedWorkspace, setStagedWorkspace] = useState<Workspace | null>(
    null,
  );
  const [stagedLabels, setStagedLabels] = useState<Record<string, string>>({});
  const [reviewStaged, setReviewStaged] = useState(false);
  const [compareId, setCompareId] = useState("");
  const [paceMetric, setPaceMetric] = useState<PaceMetric>("sessions");
  const [changeDetails, setChangeDetails] = useState(false);
  const busy = useRef(false);
  const pending = useRef<{
    data: Workspace;
    revision: number;
    requestId: string;
    action: string;
  } | null>(null);
  const pendingGoal = useRef<Proposal | null>(null);
  const pendingSandboxModel = useRef<Proposal | null>(null);
  const lastImportedRoomBackfillKey = useRef("");
  const today = new Date().toLocaleDateString("en-CA");
  const sandbox = mode === "sandbox" || (mode === "goals" && !!draft);
  const planningEdit = mode === "goals" && !!draft;
  const periodRange = sharedPeriodRange(sharedPeriod, today, customPeriod);
  useEffect(() => {
    setSharedContributor("Whole Practice");
    setCompareWholePractice(false);
  }, [section]);
  useEffect(() => {
    const url = new URL(window.location.href);
    const linkedSection = url.searchParams.get("section");
    if (linkedSection === "calculations" || url.hash === "#calculations") {
      url.searchParams.set("section", "retention");
      if (url.hash === "#calculations") url.hash = "#retention-calculations";
      window.history.replaceState(null, "", url);
      setSection("retention");
    }
  }, []);
  useEffect(() => {
    if (section === "calculations") setSection("retention");
  }, [section]);
  const savedResolved = useMemo(
    () =>
      query.data?.data && contextQuery.data
        ? resolveWorkspaceDefaults(
            query.data.data,
            contextQuery.data,
            teams.data,
          )
        : null,
    [query.data, contextQuery.data, teams.data],
  );
  const storedWorkspace = sandbox && draft ? draft.workspace : query.data?.data;
  const context = sandbox && draft ? draft.context : contextQuery.data;
  const resolved = useMemo(
    () =>
      sandbox && storedWorkspace
        ? {
            workspace: storedWorkspace,
            forecastWorkspace: storedWorkspace,
            goal: null,
            inherited: {
              team: false,
              sessionPace: false,
              overhead: false,
              ownerPay: false,
              profitGoal: false,
            },
          }
        : savedResolved,
    [sandbox, storedWorkspace, savedResolved],
  );
  const workspace = resolved?.workspace;
  const workingWorkspace = stagedWorkspace ?? workspace!;
  const forecastWorkspace = resolved?.forecastWorkspace;
  const importedSessionOverlay = useMemo(
    () =>
      !sandbox && context && workspace
        ? buildImportedSessionOverlay(
            context,
            localRetentionState.snapshots,
            workspace.settings.teamId,
            localRetentionState.sameDayVisitOverrides,
          )
        : null,
    [
      sandbox,
      context,
      workspace?.settings.teamId,
      localRetentionState.snapshots,
      localRetentionState.sameDayVisitOverrides,
    ],
  );
  const clientActivityEstimate = useMemo(
    () =>
      estimateLocalClientActivity(
        localRetentionState.snapshots,
        localRetentionState.sameDayVisitOverrides,
        56,
        56,
        28,
        today,
        90,
        periodRange.start,
        periodRange.end,
      ),
    [
      localRetentionState.snapshots,
      localRetentionState.sameDayVisitOverrides,
      periodRange.start,
      periodRange.end,
      today,
    ],
  );
  const localImportMetrics = useMemo(
    () =>
      buildLocalRetentionMetrics(
        localRetentionState.snapshots,
        localRetentionState.billingCodeMinutes,
        localRetentionState.sameDayVisitOverrides,
        28,
        today,
        90,
        periodRange.start,
        periodRange.end,
      ),
    [
      localRetentionState.snapshots,
      localRetentionState.billingCodeMinutes,
      localRetentionState.sameDayVisitOverrides,
      periodRange.start,
      periodRange.end,
      today,
    ],
  );
  const clinicianActivityByName = useMemo(
    () =>
      new Map(
        localImportMetrics.clientActivityByClinician.map((row) => [
          normalizeClinicianName(row.clinician),
          row,
        ]),
      ),
    [localImportMetrics.clientActivityByClinician],
  );
  const consultConversionSummary = useMemo(
    () =>
      summarizeConsultConversions(
        localRetentionState.snapshots,
        localRetentionState.sameDayVisitOverrides,
        periodRange.start,
        periodRange.end,
        today,
        (stagedWorkspace ?? workspace)?.consultAttributionOverrides ?? [],
      ),
    [
      localRetentionState.snapshots,
      localRetentionState.sameDayVisitOverrides,
      periodRange.start,
      periodRange.end,
      today,
      stagedWorkspace,
      workspace,
    ],
  );
  const modelContext = importedSessionOverlay?.context ?? context;
  const planProjection = useMemo(
    () =>
      savedResolved && modelContext
        ? buildPracticeProjection(
            savedResolved.forecastWorkspace,
            modelContext,
            "plan",
            today,
          )
        : null,
    [savedResolved, modelContext, today],
  );
  const viewProjection = useMemo(
    () =>
      sandbox
        ? null
        : practiceView === "plan"
          ? planProjection
          : forecastWorkspace && modelContext
            ? buildPracticeProjection(
                forecastWorkspace,
                modelContext,
                "actual",
                today,
              )
            : null,
    [
      sandbox,
      practiceView,
      planProjection,
      forecastWorkspace,
      modelContext,
      today,
    ],
  );
  const savedMonths = useMemo(
    () =>
      sandbox && forecastWorkspace && modelContext
        ? forecast(forecastWorkspace, modelContext)
        : (viewProjection?.months ?? []),
    [sandbox, forecastWorkspace, modelContext, viewProjection],
  );
  const stagedValidation = useMemo(
    () => (stagedWorkspace ? workspaceSchema.safeParse(stagedWorkspace) : null),
    [stagedWorkspace],
  );
  const stagedMonths = useMemo(() => {
    if (!stagedValidation?.success || !modelContext) return [];
    const next = resolveWorkspaceDefaults(
      stagedValidation.data,
      modelContext,
      teams.data,
    ).forecastWorkspace;
    return sandbox
      ? forecast(next, modelContext)
      : buildPracticeProjection(next, modelContext, practiceView, today).months;
  }, [
    stagedValidation,
    modelContext,
    teams.data,
    sandbox,
    practiceView,
    today,
  ]);
  const months = stagedValidation?.success ? stagedMonths : savedMonths;
  const summaryMonth =
    months.find((month) => month.date === summaryMonthDate) ?? months[0];
  const moneyFlowWorkspace = useMemo(
    () =>
      stagedValidation?.success && modelContext
        ? resolveWorkspaceDefaults(
            stagedValidation.data,
            modelContext,
            teams.data,
          ).forecastWorkspace
        : forecastWorkspace,
    [stagedValidation, modelContext, teams.data, forecastWorkspace],
  );
  const baselineMonths = useMemo(
    () =>
      base && workspace
        ? forecast(
            {
              ...base.workspace,
              settings: {
                ...base.workspace.settings,
                forecastStart: workspace.settings.forecastStart,
                horizonMonths: workspace.settings.horizonMonths,
              },
            },
            base.context,
          )
        : [],
    [
      base,
      workspace?.settings.forecastStart,
      workspace?.settings.horizonMonths,
    ],
  );
  const changes = useMemo(
    () => (draft && draftStart ? practiceChanges(draftStart, draft) : []),
    [draftStart, draft],
  );
  const comparisonChanges = useMemo(
    () => (draft && base ? practiceChanges(base, draft) : []),
    [base, draft],
  );
  const stagedDifferences = useMemo(
    () =>
      stagedWorkspace && workspace && context
        ? practiceChanges(
            copyPractice(workspace, context),
            copyPractice(stagedWorkspace, context),
          )
        : [],
    [stagedWorkspace, workspace, context],
  );
  const importedRoomBackfillKey = useMemo(
    () =>
      localRetentionState.snapshots
        .filter((snapshot) => snapshot.kind === "attendance")
        .map((snapshot) => `${snapshot.kind}:${snapshot.sourceHash}`)
        .join("|"),
    [localRetentionState.snapshots],
  );
  useEffect(() => {
    if (
      !workspace ||
      sandbox ||
      stagedWorkspace ||
      !localRetentionState.snapshots.length ||
      !importedRoomBackfillKey ||
      lastImportedRoomBackfillKey.current === importedRoomBackfillKey
    )
      return;
    const result = mergeImportedLocationRooms(
      workspace,
      localRetentionState.snapshots,
    );
    lastImportedRoomBackfillKey.current = importedRoomBackfillKey;
    if (!result.addedRooms.length) return;
    setStagedWorkspace(result.workspace);
    setStagedLabels((prior) => ({
      ...prior,
      ...Object.fromEntries(
        result.addedRooms.map((room) => [
          "rooms:" + room.id,
          "Imported location room: " + room.name,
        ]),
      ),
    }));
    setReviewStaged(true);
    setSection("rooms");
    setMessage(
      `Found ${result.addedRooms.length} imported attendance ${result.addedRooms.length === 1 ? "location" : "locations"} to review as Rooms.`,
    );
  }, [
    importedRoomBackfillKey,
    localRetentionState.snapshots,
    sandbox,
    stagedWorkspace,
    workspace,
  ]);
  const goals = useMemo(
    () =>
      active(query.data?.data.proposals ?? [])
        .filter((goal) => goal.baseline?.kind !== "sandbox-model-v1")
        .flatMap((goal) => {
          const snapshot = readPracticeGoal(goal);
          return snapshot ? [{ goal, snapshot }] : [];
        }),
    [query.data],
  );
  const sandboxModels = useMemo(
    () =>
      active(query.data?.data.proposals ?? [])
        .filter((model) => model.baseline?.kind === "sandbox-model-v1")
        .flatMap((model) => {
          const snapshot = readPracticeGoal(model);
          return snapshot ? [{ model, snapshot }] : [];
        }),
    [query.data],
  );
  const selectedGoal = goals.find((g) => g.goal.id === compareId);
  const selectedMonths = useMemo(
    () =>
      selectedGoal
        ? forecast(
            selectedGoal.snapshot.workspace,
            selectedGoal.snapshot.context,
          )
        : [],
    [selectedGoal],
  );
  const comparableGoal =
    selectedGoal?.snapshot.workspace.settings.teamId ===
    workspace?.settings.teamId;
  const selectedPeople = useMemo(
    () =>
      workspace && context
        ? context.clinicians.filter(
            (person) => (person.goalId ?? null) === workspace.settings.teamId,
          )
        : [],
    [workspace, context],
  );
  const desiredWeeklyTotal = selectedPeople.reduce(
    (sum, person) => sum + person.sessionsPerWeek,
    0,
  );
  const projectionBasis =
    workspace?.settings.baselineMode === "historical"
      ? "historical"
      : workspace &&
          workspace.settings.baselineWeeklySessions !== null &&
          Math.abs(
            workspace.settings.baselineWeeklySessions - desiredWeeklyTotal,
          ) < 0.001
        ? "desired"
        : "manual";
  const recordedFinancialPeriods = useMemo(
    () =>
      workspace && modelContext
        ? observedSeries(workspace, modelContext).filter((row) => row.date <= today).sort((a, b) =>
            b.date.localeCompare(a.date),
          )
        : [],
    [workspace, modelContext, today],
  );
  const moneyYtd = useMemo(
    () =>
      workspace && modelContext
        ? observed(workspace, modelContext, today.slice(0, 4) + "-01-01", today)
        : null,
    [workspace, modelContext, today],
  );
  const finalizedYtdCount =
    workspace?.periods.filter(
      (period) =>
        !period.archived &&
        period.status === "finalized" &&
        period.start >= today.slice(0, 4) + "-01-01" &&
        period.end <= today,
    ).length ?? 0;
  const moneyYtdGaps = useMemo(() => {
    if (!workspace) return [];
    const start = today.slice(0, 4) + "-01-01";
    const periods = workspace.periods
      .filter(
        (period) =>
          !period.archived &&
          period.status === "finalized" &&
          period.start >= start &&
          period.end <= today,
      )
      .sort((a, b) => a.start.localeCompare(b.start));
    const dayAfter = (date: string) =>
      new Date(Date.parse(date + "T12:00:00Z") + 86_400_000)
        .toISOString()
        .slice(0, 10);
    const gaps: string[] = [];
    let cursor = start;
    for (const period of periods) {
      if (period.start > cursor)
        gaps.push(
          cursor +
            " to " +
            new Date(Date.parse(period.start + "T12:00:00Z") - 86_400_000)
              .toISOString()
              .slice(0, 10),
        );
      if (dayAfter(period.end) > cursor) cursor = dayAfter(period.end);
    }
    if (cursor <= today) gaps.push(cursor + " to " + today);
    return gaps;
  }, [workspace, today]);
  const actualPaceSeries = useMemo<PacePoint[]>(() => {
    if (!workspace || !modelContext) return [];
    if (paceMetric !== "sessions")
      return recordedFinancialPeriods.map((row) => ({
        date: row.date,
        value: row.values[paceMetric] ?? null,
      }));
    const selectedIds = new Set(
      modelContext.clinicians
        .filter((c) => (c.goalId ?? null) === workspace.settings.teamId)
        .map((c) => c.id),
    );
    const periods = new Map<
      string,
      { date: string; days: number; value: number }
    >();
    for (const record of modelContext.sessions.filter((r) =>
      selectedIds.has(r.clinicianId),
    )) {
      const key = record.start + "|" + record.end;
      const period = periods.get(key) ?? {
        date: record.end,
        days: daysInclusive(record.start, record.end),
        value: 0,
      };
      period.value += record.completed;
      periods.set(key, period);
    }
    return [...periods.values()]
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((period) => ({
        date: period.date,
        value: (period.value / period.days) * 30.4375,
      }));
  }, [workspace, modelContext, paceMetric, recordedFinancialPeriods]);
  const goalPace = useMemo(
    () =>
      selectedGoal && comparableGoal
        ? calculateGoalPace(
            selectedMonths.map((row) => ({
              date: row.date,
              value: row.values[paceMetric] ?? null,
            })),
            actualPaceSeries,
          )
        : null,
    [
      selectedGoal,
      comparableGoal,
      selectedMonths,
      actualPaceSeries,
      paceMetric,
    ],
  );
  const summaryChartData = useMemo(() => {
    const projectionStart = months[0]?.date;
    const history = actualPaceSeries
      .filter(
        (point) =>
          point.date <= today && point.date < (projectionStart ?? today),
      )
      .map((point) => ({
        date: monthLabel(point.date),
        sortDate: point.date,
        estimated: null as number | null,
        goal: undefined as number | undefined,
        actual: point.value,
      }));
    const projected = months.map((row) => ({
      date: monthLabel(row.date),
      sortDate: row.date,
      estimated: row.values[paceMetric],
      goal: comparableGoal
        ? selectedMonths.find(
            (goal) => goal.date.slice(0, 7) === row.date.slice(0, 7),
          )?.values[paceMetric]
        : undefined,
      actual: null as number | null,
    }));
    return [...history, ...projected].sort((a, b) =>
      a.sortDate.localeCompare(b.sortDate),
    );
  }, [
    months,
    selectedMonths,
    actualPaceSeries,
    paceMetric,
    comparableGoal,
    today,
  ]);
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (changes.length || stagedWorkspace) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [changes.length, stagedWorkspace]);

  async function persist(data: Workspace, action: string) {
    if (busy.current)
      throw new Error("A save is in progress. Please retry this change.");
    const parsed = workspaceSchema.safeParse(data);
    if (!parsed.success)
      throw new Error(
        parsed.error.issues
          .map((i) => i.path.join(".") + ": " + i.message)
          .join("\n"),
      );
    const snapshot = cache.getQueryData<HubSnapshot>(hubKey);
    if (!snapshot) throw new Error("Practice data is still loading.");
    if (
      pending.current &&
      JSON.stringify(pending.current.data) !== JSON.stringify(parsed.data)
    )
      throw new Error(
        "A previous save is unconfirmed. Retry it or reload the saved practice before making another change.",
      );
    pending.current ??= {
      data: parsed.data,
      revision: snapshot.revision,
      requestId: crypto.randomUUID(),
      action,
    };
    busy.current = true;
    setSaving(true);
    setError("");
    try {
      const request = pending.current;
      const result = await writeHub(
        request.data,
        request.revision,
        request.action,
        request.requestId,
      );
      cache.setQueryData(hubKey, result);
      pending.current = null;
      setMessage("Saved to Today");
      void cache.invalidateQueries({ queryKey: ["hub-history"] });
    } catch (e) {
      if (e instanceof ApiError && [400, 409, 404].includes(e.status)) {
        pending.current = null;
        void query.refetch();
      }
      setError(errorText(e));
      throw e;
    } finally {
      busy.current = false;
      setSaving(false);
    }
  }
  async function saveWorkspace(data: Workspace, action = "Updated practice") {
    if (stagedWorkspace && data !== stagedWorkspace)
      throw new Error(
        "Review or discard the pending edits before saving another change.",
      );
    if (sandbox) {
      const parsed = workspaceSchema.parse(data);
      setDraft((d) => (d ? { ...d, workspace: parsed } : d));
      setMessage(mode === "goals" ? "Scenario only" : "Sandbox only");
    } else await persist(data, action);
  }
  async function adoptLongTermPlan(
    goal: Proposal,
    focusKpis: string[],
    highlights: string[],
    assumptionSignature: string,
  ) {
    if (!workspace || !query.data?.data) return;
    const current = query.data.data;
    const prior = current.focusedPlanAdoptions.find((adoption) => !adoption.archived && adoption.proposalId === goal.id);
    const adopted = focusedPlanAdoptionSchema.parse({
      ...prior,
      id: prior?.id ?? crypto.randomUUID(),
      name: goal.name + " focus",
      proposalId: goal.id,
      adoptedAt: new Date().toISOString(),
      adoptedRevision: query.data.revision,
      focusKpis,
      highlights,
      assumptionSignature,
    });
    await saveWorkspace(
      {
        ...current,
        focusedPlanAdoptions: prior
          ? current.focusedPlanAdoptions.map((adoption) => adoption.id === prior.id ? adopted : adoption)
          : [...current.focusedPlanAdoptions, adopted],
      },
      "Adopted Long Term Goals plan",
    );
  }
  type InlineCollection =
    | "budgets"
    | "campaigns"
    | "rooms"
    | "clinicians"
    | "terms"
    | "allocations";
  function stageRecord(
    collection: InlineCollection,
    id: string,
    patch: Record<string, unknown>,
    label: string,
  ) {
    if (!workspace) return;
    setStagedWorkspace((prior) => {
      const current = prior ?? workspace;
      return {
        ...current,
        [collection]: current[collection].map((row) =>
          row.id === id ? { ...row, ...patch } : row,
        ),
      } as Workspace;
    });
    setStagedLabels((prior) => ({ ...prior, [collection + ":" + id]: label }));
    setReviewStaged(false);
  }
  function stageSettings(patch: Partial<Workspace["settings"]>, label: string) {
    if (!workspace) return;
    setStagedWorkspace((prior) => {
      const current = prior ?? workspace;
      return { ...current, settings: { ...current.settings, ...patch } };
    });
    setStagedLabels((prior) => ({ ...prior, settings: label }));
    setReviewStaged(false);
  }
  function stageGoalPatch(
    id: string,
    patch: Partial<Workspace["goals"][number]>,
    label: string,
  ) {
    if (!workspace) return;
    setStagedWorkspace((prior) => {
      const current = prior ?? workspace;
      return {
        ...current,
        goals: current.goals.map((goal) =>
          goal.id === id ? { ...goal, ...patch } : goal,
        ),
      };
    });
    setStagedLabels((prior) => ({ ...prior, ["goals:" + id]: label }));
    setReviewStaged(false);
  }
  function stageNamedGoal(
    name: string,
    metric: Workspace["goals"][number]["metric"],
    patch: Partial<Workspace["goals"][number]>,
  ) {
    if (!workspace) return;
    const current = stagedWorkspace ?? workspace;
    const normalizedPatch = {
      ...patch,
      metric,
      ...(patch.date !== undefined ? { date: patch.date || null } : {}),
    };
    const existing = current.goals.find(
      (goal) => !goal.archived && goal.name.toLowerCase() === name.toLowerCase(),
    );
    if (existing) {
      stageGoalPatch(existing.id, normalizedPatch, name);
      return;
    }
    const goal = goalSchema.parse({
      id: crypto.randomUUID(),
      name,
      ...linkedGoalFor(name, current, resolved?.goal).initialDraftDefaults,
      ...normalizedPatch,
    });
    setStagedWorkspace({ ...current, goals: [...current.goals, goal] });
    setStagedLabels((prior) => ({ ...prior, ["goals:" + goal.id]: name }));
    setReviewStaged(false);
  }
  function stageFundGoalPatch(
    id: string,
    patch: Partial<Workspace["fundGoals"][number]>,
    label: string,
  ) {
    if (!workspace) return;
    setStagedWorkspace((prior) => {
      const current = prior ?? workspace;
      return {
        ...current,
        fundGoals: (current.fundGoals ?? []).map((goal) =>
          goal.id === id ? { ...goal, ...patch } : goal,
        ),
      };
    });
    setStagedLabels((prior) => ({ ...prior, ["fundGoals:" + id]: label }));
    setReviewStaged(false);
  }
  function stageNamedFundGoal(
    name: string,
    patch: Partial<Workspace["fundGoals"][number]>,
  ) {
    if (!workspace) return;
    const current = stagedWorkspace ?? workspace;
    const normalizedPatch = {
      ...patch,
      ...(patch.date !== undefined ? { date: patch.date || null } : {}),
      ...(patch.balanceDate !== undefined
        ? { balanceDate: patch.balanceDate || null }
        : {}),
    };
    const existing = (current.fundGoals ?? []).find(
      (goal) => !goal.archived && goal.name.toLowerCase() === name.toLowerCase(),
    );
    if (existing) {
      stageFundGoalPatch(existing.id, normalizedPatch, name);
      return;
    }
    const goal = fundGoalSchema.parse({
      id: crypto.randomUUID(),
      name,
      ...linkedFundGoalFor(name, current, resolved?.goal).initialDraftDefaults,
      ...normalizedPatch,
    });
    setStagedWorkspace({
      ...current,
      fundGoals: [...(current.fundGoals ?? []), goal],
    });
    setStagedLabels((prior) => ({ ...prior, ["fundGoals:" + goal.id]: name }));
    setReviewStaged(false);
  }
  function stageConsultAttributionOverride(
    clientId: string,
    outcome: Workspace["consultAttributionOverrides"][number]["outcome"],
    clinicianName: string | null,
  ) {
    if (!workspace) return;
    const current = stagedWorkspace ?? workspace;
    const existing = (current.consultAttributionOverrides ?? []).find(
      (override) => !override.archived && override.clientId === clientId,
    );
    const patch = {
      outcome,
      clinicianName:
        outcome === "needs_review" ? null : clinicianName?.trim() || null,
      name: `Consult attribution ${clientId}`,
    };
    if (existing) {
      setStagedWorkspace({
        ...current,
        consultAttributionOverrides: current.consultAttributionOverrides.map(
          (override) =>
            override.id === existing.id ? { ...override, ...patch } : override,
        ),
      });
      setStagedLabels((prior) => ({
        ...prior,
        ["consultAttributionOverrides:" + existing.id]:
          "Consult attribution " + clientId,
      }));
      setReviewStaged(false);
      return;
    }
    const override = consultAttributionOverrideSchema.parse({
      id: crypto.randomUUID(),
      ...patch,
      clientId,
      archived: false,
      notes:
        outcome === "confirmed_closer"
          ? "Manual closer confirmation from Practice workspace review."
          : outcome === "missed_owner"
            ? "Manual missed-consult ownership from Practice workspace review."
            : "Manual review requested from Practice workspace.",
      sourceAttachmentId: null,
    });
    setStagedWorkspace({
      ...current,
      consultAttributionOverrides: [
        ...(current.consultAttributionOverrides ?? []),
        override,
      ],
    });
    setStagedLabels((prior) => ({
      ...prior,
      ["consultAttributionOverrides:" + override.id]:
        "Consult attribution " + clientId,
    }));
    setReviewStaged(false);
  }
  function stageFunnelPatch(
    id: string,
    patch: Partial<Workspace["funnels"][number]>,
  ) {
    if (!workspace) return;
    setStagedWorkspace((prior) => {
      const current = prior ?? workspace;
      const funnels = current.funnels.map((row) =>
        row.id === id ? { ...row, ...patch } : row,
      );
      const changed = funnels.find((row) => row.id === id);
      return {
        ...current,
        funnels,
        periods: changed
          ? current.periods.map((period) =>
              period.id === changed.periodId
                ? {
                    ...period,
                    funnelComplete:
                      changed.scope === "practice" &&
                      changed.leads !== null &&
                      changed.scheduled !== null &&
                      changed.attended !== null &&
                      changed.clients !== null,
                  }
                : period,
            )
          : current.periods,
      };
    });
    setStagedLabels((prior) => ({
      ...prior,
      ["funnels:" + id]: "Lead flow result",
    }));
    setReviewStaged(false);
  }
  function stageFunnelRemove(id: string) {
    if (!workspace) return;
    setStagedWorkspace((prior) => {
      const current = prior ?? workspace;
      const removed = current.funnels.find((row) => row.id === id);
      return {
        ...current,
        funnels: current.funnels.filter((row) => row.id !== id),
        periods: removed
          ? current.periods.map((period) =>
              period.id === removed.periodId
                ? { ...period, funnelComplete: false }
                : period,
            )
          : current.periods,
      };
    });
    setStagedLabels((prior) => ({
      ...prior,
      ["funnels:" + id]: "Removed lead flow result",
    }));
    setReviewStaged(false);
  }
  async function saveLeadEntry(
    month: string,
    entry: Pick<
      Workspace["funnels"][number],
      | "scope"
      | "campaignId"
      | "sourceName"
      | "clinicianId"
      | "leads"
      | "scheduled"
      | "attended"
      | "clients"
    >,
    replacePracticeId?: string,
  ) {
    if (!workspace) throw new Error("Practice data is still loading.");
    const current = stagedWorkspace ?? workspace;
    const start = `${month}-01`;
    const end = new Date(
      Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5)), 0),
    )
      .toISOString()
      .slice(0, 10);
    const period =
      current.periods.find(
        (item) => !item.archived && item.start === start && item.end === end,
      ) ??
      periodSchema.parse({
        id: crypto.randomUUID(),
        name: new Intl.DateTimeFormat("en-US", {
          month: "long",
          year: "numeric",
          timeZone: "UTC",
        }).format(new Date(`${start}T12:00:00Z`)),
        start,
        end,
      });
    const result = funnelSchema.parse({
      id: crypto.randomUUID(),
      periodId: period.id,
      ...entry,
      spend: null,
      firstSessions: null,
    });
    const completed =
      entry.scope === "practice" &&
      entry.leads !== null &&
      entry.scheduled !== null &&
      entry.attended !== null &&
      entry.clients !== null;
    await persist(
      {
        ...current,
        periods: current.periods.some((item) => item.id === period.id)
          ? current.periods.map((item) =>
              item.id === period.id
                ? { ...item, funnelComplete: completed }
                : item,
            )
          : [...current.periods, { ...period, funnelComplete: completed }],
        funnels: [
          ...current.funnels.filter(
            (row) =>
              row.id !== replacePracticeId ||
              row.periodId !== period.id ||
              row.scope !== "practice",
          ),
          result,
        ],
      },
      "Recorded monthly lead flow",
    );
    setStagedWorkspace(null);
    setStagedLabels({});
    setReviewStaged(false);
  }
  async function saveBulkLeadEntries(changes: LeadBulkChange[]) {
    if (!workspace) throw new Error("Practice data is still loading.");
    if (stagedWorkspace)
      throw new Error(
        "Save or discard pending edits before saving monthly totals.",
      );
    const overrides = Object.fromEntries(
      changes.flatMap((change) =>
        (["leads", "scheduled", "attended", "clients"] as const).map(
          (field) => [
            `${change.month}:${field}`,
            change[field] === null ? "" : String(change[field]),
          ],
        ),
      ),
    );
    const checked = planBulkLeads(workspace, overrides);
    if (checked.issues.length || checked.changes.length !== changes.length)
      throw new Error(
        checked.issues[0]?.message ??
          "The monthly totals changed. Review the grid and try again.",
      );
    await persist(
      applyBulkLeads(workspace, checked.changes),
      "Recorded monthly lead flow",
    );
  }
  async function completeLeadMonth(periodId: string) {
    if (!workspace) return;
    const current = stagedWorkspace ?? workspace;
    await persist(
      {
        ...current,
        periods: current.periods.map((period) =>
          period.id === periodId ? { ...period, funnelComplete: true } : period,
        ),
      },
      "Completed monthly lead flow",
    );
    setStagedWorkspace(null);
    setStagedLabels({});
    setReviewStaged(false);
  }
  function stageFund(
    name: string,
    kind: "tax" | "reserve" | "distribution" | "retained",
    percent: number,
    start: string,
  ) {
    if (!workspace) return;
    const current = workingWorkspace;
    const defaults = [
      ["Tax fund", "tax", current.settings.taxPct],
      ["Business reserves", "reserve", current.settings.reservePct],
      ["Your distribution", "distribution", current.settings.distributionPct],
    ] as const;
    const existing = current.allocations.some((item) => !item.archived)
      ? current.allocations
      : defaults
          .filter(([, , share]) => share > 0)
          .map(([label, purpose, share]) =>
            allocationSchema.parse({
              id: crypto.randomUUID(),
              name: label,
              kind: purpose,
              percent: share,
              start,
              household: purpose === "distribution",
            }),
          );
    const record = allocationSchema.parse({
      id: crypto.randomUUID(),
      name,
      kind,
      percent,
      start,
      household: kind === "distribution",
    });
    setStagedWorkspace({
      ...current,
      allocations: [...existing, record],
    });
    setStagedLabels((prior) => ({
      ...prior,
      ["allocations:" + record.id]: "Added " + name,
    }));
    setReviewStaged(false);
  }
  function stageNew(collection: InlineCollection, start = today) {
    if (!workingWorkspace) return;
    let current = workingWorkspace;
    let record: Workspace[InlineCollection][number];
    if (collection === "budgets") {
      let category = current.categories.find(
        (c) => !c.archived && (c.kind === "expense" || c.kind === "facility"),
      );
      if (!category) {
        category = categorySchema.parse({
          id: crypto.randomUUID(),
          name: "Operating expenses",
          kind: "expense",
        });
        current = { ...current, categories: [...current.categories, category] };
      }
      record = budgetSchema.parse({
        ...newRecord("budgets", current, today),
        name: "New expense",
        categoryId: category.id,
        start,
      });
    } else if (collection === "campaigns") {
      record = campaignSchema.parse({
        ...newRecord("campaigns", current, today),
        name: "",
        source: "",
        start: null,
      });
    } else if (collection === "rooms") {
      record = roomSchema.parse({
        ...newRecord("rooms", current, today),
        name: "New room",
        start: today,
      });
    } else return;
    setStagedWorkspace({
      ...current,
      [collection]: [...current[collection], record],
    } as Workspace);
    setStagedLabels((prior) => ({
      ...prior,
      [collection + ":" + record.id]: "Added " + record.name,
    }));
    setReviewStaged(false);
  }
  function stageMarketingSupport(start = today) {
    if (!workingWorkspace) return;
    let current = workingWorkspace;
    let category = current.categories.find(
      (c) => !c.archived && c.kind === "marketing",
    );
    if (!category) {
      category = categorySchema.parse({
        id: crypto.randomUUID(),
        name: "Marketing services",
        kind: "marketing",
      });
      current = { ...current, categories: [...current.categories, category] };
    }
    const record = budgetSchema.parse({
      ...newRecord("budgets", current, today),
      name: "New marketing cost",
      categoryId: category.id,
      start,
    });
    setStagedWorkspace({ ...current, budgets: [...current.budgets, record] });
    setStagedLabels((prior) => ({
      ...prior,
      ["budgets:" + record.id]: "Added marketing support cost",
    }));
    setReviewStaged(false);
  }
  function stageClinicianAvailability(
    person: Clinician,
    availability: Workspace["clinicians"][number]["availability"],
  ) {
    if (!workingWorkspace) return;
    const profile = workingWorkspace.clinicians.find(
      (row) => row.clinicianId === person.id,
    );
    if (profile)
      stageRecord(
        "clinicians",
        profile.id,
        { availability },
        person.label + " availability",
      );
    else {
      const record = clinicianSettingSchema.parse({
        id: crypto.randomUUID(),
        clinicianId: person.id,
        start: today,
        desiredWeeklySessions: person.sessionsPerWeek,
        availability,
      });
      setStagedWorkspace({
        ...workingWorkspace,
        clinicians: [...workingWorkspace.clinicians, record],
      });
      setStagedLabels((prior) => ({
        ...prior,
        ["clinicians:" + record.id]: person.label + " availability",
      }));
      setReviewStaged(false);
    }
  }
  function stageClinicianAverageRate(
    person: Clinician,
    rate: number | null,
    start?: string,
  ) {
    if (!start) {
      const profile = workingWorkspace.clinicians.find(
        (row) => row.clinicianId === person.id && row.status !== "archived",
      );
      if (profile) {
        stageRecord(
          "clinicians",
          profile.id,
          { expectedSessionRevenue: rate },
          person.label + " expected average session revenue",
        );
        return;
      }
      const record = clinicianSettingSchema.parse({
        id: crypto.randomUUID(),
        clinicianId: person.id,
        start:
          context?.sessions
            .filter((item) => item.clinicianId === person.id)
            .map((item) => item.start)
            .sort()[0] ?? today,
        desiredWeeklySessions: person.sessionsPerWeek,
        expectedSessionRevenue: rate,
      });
      setStagedWorkspace({
        ...workingWorkspace,
        clinicians: [...workingWorkspace.clinicians, record],
      });
      setStagedLabels((prior) => ({
        ...prior,
        ["clinicians:" + record.id]:
          person.label + " expected average session revenue",
      }));
      setReviewStaged(false);
      return;
    }
    stageClinicianModel(
      person,
      { expectedSessionRevenue: rate ?? person.sessionRate },
      start,
    );
  }
  function stageClinicianModel(
    person: Clinician,
    patch: Partial<Workspace["clinicians"][number]>,
    start: string,
  ) {
    if (!workingWorkspace) return;
    const termPatch = {
      ...(patch.payMode !== undefined ? { payMode: patch.payMode } : {}),
      ...(patch.payAmount !== undefined ? { payAmount: patch.payAmount } : {}),
      ...(patch.paidHoursPerWeek !== undefined
        ? { paidHoursPerWeek: patch.paidHoursPerWeek }
        : {}),
      ...(patch.expectedSessionRevenue !== undefined
        ? { expectedSessionRevenue: patch.expectedSessionRevenue }
        : {}),
    };
    const existing = workingWorkspace.terms.find(
      (row) => row.clinicianId === person.id && row.effectiveDate === start,
    );
    if (existing) {
      stageRecord(
        "terms",
        existing.id,
        termPatch,
        person.label + " dated money flow inputs",
      );
      return;
    }
    const record = termSchema.parse({
      id: crypto.randomUUID(),
      clinicianId: person.id,
      effectiveDate: start,
      ...termPatch,
    });
    setStagedWorkspace({
      ...workingWorkspace,
      terms: [...workingWorkspace.terms, record],
    });
    setStagedLabels((prior) => ({
      ...prior,
      ["terms:" + record.id]: person.label + " dated money flow inputs",
    }));
    setReviewStaged(false);
  }
  async function commitStaged() {
    if (!stagedWorkspace) return;
    try {
      await saveWorkspace(stagedWorkspace, "Updated practice inputs");
      setStagedWorkspace(null);
      setStagedLabels({});
      setReviewStaged(false);
    } catch (e) {
      setError(errorText(e));
    }
  }
  function edit(collection: Collection, record?: Record<string, unknown>) {
    if (busy.current) return;
    if (stagedWorkspace) {
      setError(
        "Review or discard pending edits before opening other settings.",
      );
      return;
    }
    setDetail(null);
    if (workspace)
      setEditor({
        collection,
        record:
          record ??
          newRecord(collection, workspace, workspace.settings.forecastStart),
      });
  }
  async function patchRecord(
    collection: Collection,
    id: string,
    patch: Record<string, unknown>,
  ) {
    if (!workspace) return;
    await saveWorkspace(
      {
        ...workspace,
        [collection]: workspace[collection].map((r) =>
          r.id === id ? { ...r, ...patch } : r,
        ),
      },
      "Updated " + collection,
    );
  }
  async function patchPerson(person: Clinician, patch: Partial<Clinician>) {
    if (sandbox) {
      setDraft((d) => {
        if (!d) return d;
        const currentPeople = d.context.clinicians.filter(
          (clinician) =>
            (clinician.goalId ?? null) === d.workspace.settings.teamId,
        );
        const oldTotal = currentPeople.reduce(
          (sum, clinician) => sum + clinician.sessionsPerWeek,
          0,
        );
        const followsDesired =
          d.workspace.settings.baselineMode === "manual" &&
          d.workspace.settings.baselineWeeklySessions !== null &&
          Math.abs(d.workspace.settings.baselineWeeklySessions - oldTotal) <
            0.001;
        const clinicians = d.context.clinicians.map((c) =>
          c.id === person.id ? { ...c, ...patch } : c,
        );
        const nextTotal = clinicians
          .filter(
            (clinician) =>
              (clinician.goalId ?? null) === d.workspace.settings.teamId,
          )
          .reduce((sum, clinician) => sum + clinician.sessionsPerWeek, 0);
        return {
          ...d,
          context: { ...d.context, clinicians },
          workspace:
            (followsDesired || mode === "goals") &&
            patch.sessionsPerWeek !== undefined
              ? {
                  ...d.workspace,
                  settings: {
                    ...d.workspace.settings,
                    baselineWeeklySessions:
                      mode === "goals"
                        ? Math.max(
                            0,
                            (d.workspace.settings.baselineWeeklySessions ??
                              oldTotal) +
                              nextTotal -
                              oldTotal,
                          )
                        : nextTotal,
                  },
                }
              : d.workspace,
        };
      });
      return;
    }
    if (busy.current)
      throw new Error("A save is in progress. Please retry this change.");
    busy.current = true;
    setSaving(true);
    let updated = false;
    try {
      await customFetch("/api/clinicians/" + person.id, {
        method: "PATCH",
        body: JSON.stringify(patch),
      });
      cache.setQueryData<Context>(["hub-context"], (old) =>
        old
          ? {
              ...old,
              clinicians: old.clinicians.map((c) =>
                c.id === person.id ? { ...c, ...patch } : c,
              ),
            }
          : old,
      );
      void cache.invalidateQueries({ queryKey: ["/api/clinicians"] });
      setMessage("Saved to Today");
      updated = true;
    } finally {
      busy.current = false;
      setSaving(false);
    }
    if (
      updated &&
      workspace &&
      projectionBasis === "desired" &&
      patch.sessionsPerWeek !== undefined
    )
      await persist(
        {
          ...workspace,
          settings: {
            ...workspace.settings,
            baselineWeeklySessions:
              desiredWeeklyTotal -
              person.sessionsPerWeek +
              patch.sessionsPerWeek,
          },
        },
        "Updated desired session projection",
      );
  }
  async function patchStaff(
    member: Context["staff"][number],
    patch: Partial<Context["staff"][number]>,
    options?: { year: number; effectiveDate: string | null },
  ) {
    if (busy.current)
      throw new Error("A save is in progress. Please retry this change.");
    if (workspace && options && member.id) {
      const effectiveDate = options.effectiveDate ?? `${options.year}-01-01`;
      const end = options.effectiveDate ? null : `${options.year}-12-31`;
      const existing = workspace.staffTerms.find(
        (term) =>
          term.staffMemberId === member.id &&
          term.effectiveDate === effectiveDate &&
          (term.end ?? null) === end,
      );
      const valueFor = <
        K extends
          | "annualSalary"
          | "hourlyRate"
          | "hoursPerWeek"
          | "weeksPerYear",
      >(
        key: K,
      ) =>
        Object.prototype.hasOwnProperty.call(patch, key)
          ? patch[key]
          : (existing?.[key] ?? null);
      const nextTerm = staffTermSchema.parse({
        id: existing?.id ?? crypto.randomUUID(),
        staffMemberId: member.id,
        effectiveDate,
        end,
        annualSalary: valueFor("annualSalary"),
        hourlyRate: valueFor("hourlyRate"),
        hoursPerWeek: valueFor("hoursPerWeek"),
        weeksPerYear: valueFor("weeksPerYear"),
        notes: options.effectiveDate
          ? "Date-specific staff pay change"
          : `Default staff pay for ${options.year}`,
      });
      const nextWorkspace = {
        ...workspace,
        staffTerms: [
          ...workspace.staffTerms.filter(
            (term) =>
              !(
                term.staffMemberId === member.id &&
                term.effectiveDate === effectiveDate &&
                (term.end ?? null) === end
              ),
          ),
          nextTerm,
        ],
      };
      await persist(
        nextWorkspace,
        options.effectiveDate
          ? "Recorded staff pay change date"
          : `Updated ${options.year} staff pay estimate`,
      );
      setMessage("Saved to Today");
      return;
    }
    busy.current = true;
    setSaving(true);
    try {
      await customFetch("/api/staff/" + member.id, {
        method: "PATCH",
        body: JSON.stringify(patch),
      });
      cache.setQueryData<Context>(["hub-context"], (old) =>
        old
          ? {
              ...old,
              staff: old.staff.map((row) =>
                row.id === member.id ? { ...row, ...patch } : row,
              ),
            }
          : old,
      );
      void cache.invalidateQueries({ queryKey: ["/api/staff"] });
      setMessage("Saved to Today");
    } finally {
      busy.current = false;
      setSaving(false);
    }
  }
  function addModeledClinician() {
    if (!draft) return;
    const id =
      Math.max(0, ...draft.context.clinicians.map((person) => person.id)) + 1;
    const clinician: Clinician = {
      id,
      label: `New clinician ${id}`,
      goalId: draft.workspace.settings.teamId,
      classification: "1099",
      sessionRate: 175,
      sessionsPerWeek: 20,
      weeksWorkedPerYear: 48,
      capEnabled: false,
      capAmount: 0,
      preCapClinicianSplit: 60,
      preCapPracticeSplit: 40,
      postCapClinicianSplit: 60,
      postCapPracticeSplit: 40,
      w2EmployerFicaPct: 7.65,
      futaSutaPct: 1,
      workersCompPct: 0.5,
      otherEmployerBurdenPct: 0,
      nonClinicalHoursPerWeek: 0,
      nonClinicalHourlyRate: 0,
    };
    setDraft((current) =>
      current
        ? {
            ...current,
            context: {
              ...current.context,
              clinicians: [...current.context.clinicians, clinician],
            },
            workspace: {
              ...current.workspace,
              settings: {
                ...current.workspace.settings,
                baselineWeeklySessions:
                  (current.workspace.settings.baselineWeeklySessions ?? 0) +
                  clinician.sessionsPerWeek,
              },
            },
          }
        : current,
    );
  }
  function addModeledStaff() {
    setDraft((current) =>
      current
        ? {
            ...current,
            context: {
              ...current.context,
              staff: [
                ...current.context.staff,
                {
                  id:
                    Math.max(
                      0,
                      ...current.context.staff.map((member) => member.id ?? 0),
                    ) + 1,
                  label: `New staff ${current.context.staff.length + 1}`,
                  goalId: current.workspace.settings.teamId,
                  annualSalary: 0,
                  hourlyRate: null,
                  hoursPerWeek: null,
                  weeksPerYear: 48,
                  classification: "w2",
                  w2EmployerFicaPct: 7.65,
                  futaSutaPct: 1,
                  workersCompPct: 0.5,
                  otherEmployerBurdenPct: 0,
                },
              ],
            },
          }
        : current,
    );
  }
  async function patchModeledStaff(
    index: number,
    patch: Partial<Context["staff"][number]>,
  ) {
    setDraft((current) =>
      current
        ? {
            ...current,
            context: {
              ...current.context,
              staff: current.context.staff.map((row, i) =>
                i === index ? { ...row, ...patch } : row,
              ),
            },
          }
        : current,
    );
  }
  function removeModeledClinician(person: Clinician) {
    if (!draft) return;
    if (
      referencedClinicianIds(draft.workspace).has(person.id) ||
      draft.context.sessions.some((record) => record.clinicianId === person.id)
    ) {
      setError(
        "This clinician has linked settings or session history. Remove those links first, or set desired sessions to zero.",
      );
      return;
    }
    setDraft((current) =>
      current
        ? {
            ...current,
            context: {
              ...current.context,
              clinicians: current.context.clinicians.filter(
                (row) => row.id !== person.id,
              ),
            },
            workspace: {
              ...current.workspace,
              settings: {
                ...current.workspace.settings,
                baselineWeeklySessions: Math.max(
                  0,
                  (current.workspace.settings.baselineWeeklySessions ?? 0) -
                    person.sessionsPerWeek,
                ),
              },
            },
          }
        : current,
    );
  }
  function startSandbox() {
    if (!query.data) return;
    const copy = blankPractice(today);
    setBase(copy);
    setDraftStart(copy);
    setDraft(structuredClone(copy));
    setDraftMode("sandbox");
    setPlanningId(null);
    setSandboxId(null);
    setSandboxName("");
    setSourceRevision(query.data.revision);
    setMode("sandbox");
    setMarketingTab("campaigns");
    setMoneyMonthIndex(0);
    setError("");
    setMessage("");
  }
  function startPlanning() {
    if (!query.data || !contextQuery.data || !viewProjection) return;
    if (draft && changes.length) {
      setError(
        "Save or discard the open model before creating another scenario.",
      );
      return;
    }
    const copy = copyPractice(
      viewProjection.projectionWorkspace,
      contextQuery.data,
    );
    setBase(copy);
    setDraftStart(copy);
    setDraft(structuredClone(copy));
    setDraftMode("goals");
    setPlanningId(null);
    setSourceRevision(query.data.revision);
    setGoalName("");
    setMode("goals");
    setIntegratedTool(null);
    setSection("clinicians");
    setMessage("New scenario. Changes stay here until you save it.");
    setError("");
  }
  function openGoal(goal: Proposal) {
    const copy = readPracticeGoal(goal);
    if (!copy || !query.data || !contextQuery.data || !planProjection) return;
    if (planningEdit && changes.length) {
      setError("Save or discard the current scenario before opening another.");
      return;
    }
    setBase(
      copyPractice(
        viewProjection?.projectionWorkspace ??
          planProjection.projectionWorkspace,
        contextQuery.data,
      ),
    );
    setDraftStart(copyPractice(copy.workspace, copy.context));
    setDraft(copyPractice(copy.workspace, copy.context));
    setDraftMode("goals");
    setSourceRevision(copy.sourceRevision);
    setPlanningId(goal.id);
    setMode("goals");
    setIntegratedTool(null);
    setSection("clinicians");
    setMarketingTab("campaigns");
    setMoneyMonthIndex(0);
    setGoalName(goal.name);
    setError("");
  }
  async function saveGoal() {
    if (!draft || !query.data || saving) return;
    try {
      const existing = planningId
        ? query.data.data.proposals.find((p) => p.id === planningId)
        : undefined;
      pendingGoal.current ??= makePlanningScenario(
        goalName,
        draft,
        sourceRevision,
        mode === "sandbox" ? "sandbox" : "today",
        existing,
      );
      await persist(
        {
          ...query.data.data,
          proposals: existing
            ? query.data.data.proposals.map((p) =>
                p.id === existing.id ? pendingGoal.current! : p,
              )
            : [...query.data.data.proposals, pendingGoal.current],
        },
        "Saved planning scenario",
      );
      setCompareId(pendingGoal.current.id);
      pendingGoal.current = null;
      setGoalDialog(false);
      setGoalName("");
      setDraft(null);
      setDraftMode(null);
      setBase(null);
      setDraftStart(null);
      setPlanningId(null);
      setSandboxId(null);
      setMode("goals");
      setMessage("Scenario saved. Today is unchanged.");
    } catch (e) {
      setError(errorText(e));
    }
  }
  function openSandboxModel(model: Proposal) {
    if (changes.length) {
      setError("Save or discard this Sandbox model before opening another.");
      return;
    }
    const copy = readPracticeGoal(model);
    if (!copy) return;
    setDraft(copyPractice(copy.workspace, copy.context));
    setDraftStart(copyPractice(copy.workspace, copy.context));
    setBase(blankPractice(today));
    setDraftMode("sandbox");
    setSandboxId(model.id);
    setSandboxName(model.name);
    setSourceRevision(copy.sourceRevision);
    setSandboxLibraryOpen(false);
    setMode("sandbox");
    setSection("clinicians");
    setMessage("Saved model opened. Today is unchanged.");
    setError("");
  }
  async function saveSandboxModel() {
    if (!draft || !query.data || saving) return;
    try {
      const existing = sandboxId
        ? query.data.data.proposals.find((p) => p.id === sandboxId)
        : undefined;
      pendingSandboxModel.current ??= makeSandboxModel(
        sandboxName,
        draft,
        sourceRevision,
        existing,
      );
      await persist(
        {
          ...query.data.data,
          proposals: existing
            ? query.data.data.proposals.map((p) =>
                p.id === existing.id ? pendingSandboxModel.current! : p,
              )
            : [...query.data.data.proposals, pendingSandboxModel.current],
        },
        "Saved Sandbox model",
      );
      setSandboxId(pendingSandboxModel.current.id);
      pendingSandboxModel.current = null;
      setDraftStart(copyPractice(draft.workspace, draft.context));
      setSandboxDialog(false);
      setMessage("Sandbox model saved. Today and Long Term Goals are unchanged.");
    } catch (e) {
      setError(errorText(e));
    }
  }
  async function navigate(next: Mode) {
    if (stagedWorkspace && next !== mode) {
      setError(
        "Review and save, or discard, the pending practice edits before switching areas.",
      );
      return;
    }
    if (busy.current || sessionEditing) return;
    if (
      draft &&
      changes.length &&
      next !== mode &&
      next !== "practice" &&
      next !== draftMode
    ) {
      setError(
        "Save this scenario to Long Term Goals or discard its changes before opening another workspace.",
      );
      return;
    }
    if (integratedTool) {
      if (next === "sandbox" && !draft && query.data) {
        setIntegratedTool(null);
        startSandbox();
        return;
      }
      void contextQuery.refetch();
      void teams.refetch();
    }
    setIntegratedTool(null);
    setError("");
    if (next === "practice") {
      setMarketingTab(practiceView === "actual" ? "results" : "campaigns");
      setMoneyMonthIndex(0);
    }
    if (next === "sandbox") {
      setMarketingTab("campaigns");
      setMoneyMonthIndex(0);
    }
    if (next === "sandbox" && mode !== "sandbox" && draftMode !== "sandbox")
      startSandbox();
    else {
      if (next === "goals" && draftMode === "sandbox") {
        setDraft(null);
        setDraftMode(null);
        setBase(null);
        setDraftStart(null);
        setSandboxId(null);
      }
      setMode(next);
    }
    if (section === "documents" || section === "settings")
      setSection("clinicians");
  }

  function showTool(next: IntegratedTool | null) {
    if (integratedTool && integratedTool !== next) {
      void contextQuery.refetch();
      void teams.refetch();
    }
    setIntegratedTool(next);
  }
  function openRetentionCalculations() {
    if (integratedTool) showTool(null);
    setSection("retention");
  }
  function downloadSection() {
    if (!workspace || !context) return;
    const source =
      mode === "practice" ? "today" : mode === "goals" ? "planning" : "sandbox";
    const bundle = exportSection(
      copyPractice(workspace, context),
      transferSection,
      source,
    );
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" }),
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `emc-${source}-${transferSection}.json`;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function readTransferFile(file: File | undefined) {
    setTransferFile(null);
    if (!file) return;
    try {
      if (file.size > 15_000_000)
        throw new Error("Section file exceeds 15 MB.");
      const bundle = JSON.parse(await file.text()) as SectionBundle;
      if (bundle?.kind !== "emc-section-v1")
        throw new Error("Choose an EMC section export.");
      if (bundle.section !== transferSection)
        throw new Error(
          `This file contains ${bundle.section}. Select that section to import it.`,
        );
      if (!workspace || !context) return;
      importSection(
        copyPractice(workspace, context),
        bundle,
        mode === "practice"
          ? "today"
          : mode === "goals"
            ? "planning"
            : "sandbox",
      );
      setTransferFile(bundle);
      setError("");
    } catch (e) {
      setError(errorText(e));
    }
  }
  async function applyTransfer() {
    if (!workspace || !context || !transferFile) return;
    try {
      const next = importSection(
        copyPractice(workspace, context),
        transferFile,
        mode === "practice"
          ? "today"
          : mode === "goals"
            ? "planning"
            : "sandbox",
      );
      if (mode === "practice")
        await saveWorkspace(
          next.workspace,
          `Imported ${transferSection} section`,
        );
      else setDraft(next);
      setTransferOpen(false);
      setTransferFile(null);
      setMessage(
        `${transferSection} copied into ${mode === "practice" ? "Today" : mode === "goals" ? "Long Term Goals" : "Sandbox"}.`,
      );
    } catch (e) {
      setError(errorText(e));
    }
  }

  if (query.isPending || contextQuery.isPending)
    return <div className="pw-loading">Loading Today...</div>;
  if (!workspace || !context || query.isError || contextQuery.isError)
    return (
      <div className="pw-loading">
        <h1>Practice data could not be loaded</h1>
        <p>{errorText(query.error ?? contextQuery.error)}</p>
        <button
          onClick={() => {
            void query.refetch();
            void contextQuery.refetch();
          }}
        >
          Try again
        </button>
      </div>
    );
  const toolTabs: ToolTab[] =
    mode === "goals" && !draft
      ? [
          { id: null, label: "Long-term plans" },
          { id: "business-goals", label: "Compensation targets" },
          { id: "compensation-model", label: "Compensation model" },
          { id: "scenarios", label: "Existing scenarios" },
          { id: "compare", label: "Scenario comparison" },
        ]
      : sandbox
        ? [{ id: null, label: planningEdit ? "Scenario" : "Working copy" }]
        : section === "clinicians"
          ? [
              { id: null, label: "Clinician KPIs" },
              { id: "team", label: "Pay structure" },
              { id: "impact", label: "Pay comparison" },
            ]
          : section === "summary"
            ? [
                { id: null, label: "Overview" },
                { id: "reality", label: "Compensation baseline" },
              ]
            : [];
  const visibleTool = toolTabs.some((tab) => tab.id === integratedTool)
    ? integratedTool
    : null;
  const toolNotice =
    visibleTool === "reality"
      ? "This older manual baseline is separate from the recorded sessions and financial periods in Today."
      : visibleTool === "scenarios" || visibleTool === "compare"
        ? "Saved compensation scenarios are separate from this working copy. Editing them will not change Today."
        : visibleTool === "compensation-model"
          ? "Changes to this compensation model save to its linked team and business goal. Use Sandbox to test changes without saving them to Long Term Goals."
          : null;
  const people = selectedPeople;
  const contributorNames = [
    "Whole Practice",
    ...people.map((person) => person.label),
  ];
  const selectedContributorName = contributorNames.includes(sharedContributor)
    ? sharedContributor
    : "Whole Practice";
  const contributorActivity =
    selectedContributorName === "Whole Practice"
      ? null
      : clinicianActivityByName.get(
          normalizeClinicianName(selectedContributorName),
        ) ?? null;
  const contributorConsult =
    selectedContributorName === "Whole Practice"
      ? consultConversionSummary.practice
      : consultConversionSummary.byClinician.find(
          (row) =>
            normalizeClinicianName(row.clinician ?? "") ===
            normalizeClinicianName(selectedContributorName),
        ) ?? null;
  const recordedClinicianCount =
    viewProjection?.clinicianPace.filter(
      (person) => person.recordedWeekly !== null,
    ).length ?? 0;
  const recordedExpenses = workspace.transactions
    .filter(
      (transaction) =>
        workspace.categories.find(
          (category) => category.id === transaction.categoryId,
        )?.kind !== "income",
    )
    .sort((a, b) => b.date.localeCompare(a.date));
  const moneyMonth = months[Math.min(moneyMonthIndex, months.length - 1)];
  const moneyValues = moneyMonth?.values ?? {};
  const moneyBridge = moneyBridgeSummary(moneyValues, workingWorkspace.settings.ownerPayrollBurdenPct);
  const ownerBurden =
    ((moneyValues.ownerPayroll ?? 0) *
      workspace.settings.ownerPayrollBurdenPct) /
    100;
  const beforeOwnerPay =
    (moneyValues.profit ?? 0) + (moneyValues.ownerPayroll ?? 0) + ownerBurden;
  const operatingCosts =
    (moneyValues.clinicianPay ?? 0) +
    (moneyValues.employerBurden ?? 0) +
    (moneyValues.staffCost ?? 0) +
    (moneyValues.overhead ?? 0) +
    (moneyValues.marketing ?? 0) +
    (moneyValues.fees ?? 0);
  const otherBusinessIncome =
    beforeOwnerPay - (moneyValues.revenue ?? 0) + operatingCosts;
  const activeAllocations = active(workspace.allocations);
  const importAttentionCount =
    localRetentionState.snapshots.length +
    (importedSessionOverlay?.diagnostic.manualImportConflictCount ?? 0) +
    (importedSessionOverlay?.diagnostic.missingClinicianLabels.length ?? 0) +
    (importedSessionOverlay?.diagnostic.ambiguousClinicianLabels.length ?? 0);
  const overheadSummary = periodOverheadSummary(
    recordedFinancialPeriods,
    periodRange.start === "0000-01-01"
      ? workspace.periods.filter((period) => !period.archived && period.status === "finalized" && period.end <= today).map((period) => period.start).sort()[0] ?? today
      : periodRange.start,
    periodRange.end.slice(0, 7) >= today.slice(0, 7)
      ? new Date(Date.parse(today.slice(0, 7) + "-01T12:00:00Z") - 86400000).toISOString().slice(0, 10)
      : periodRange.end,
    { workspace: { ...workingWorkspace, periods: workingWorkspace.periods.filter((period) => period.end <= today) } },
  );
  const recordedOverheadValues = overheadSummary.values;
  const recordedOverheadAverage = overheadSummary.average;
  const familyDistributionPct = activeAllocations
    .filter(
      (allocation) =>
        allocation.kind === "distribution" && allocation.household,
    )
    .reduce((sum, allocation) => sum + allocation.percent, 0);
  const totalDistributionPct = activeAllocations
    .filter((allocation) => allocation.kind === "distribution")
    .reduce((sum, allocation) => sum + allocation.percent, 0);
  const familyDistributions = activeAllocations.length
    ? (moneyValues.distributions ?? 0) *
      (totalDistributionPct ? familyDistributionPct / totalDistributionPct : 0)
    : (moneyValues.distributions ?? 0);
  const endpoint = months.at(-1);
  const baselineEndpoint = baselineMonths.find(
    (m) => m.date === endpoint?.date,
  );
  const operatingPlan = summarizeOperatingPlan(
    workingWorkspace,
    summaryMonth,
    fillHorizonMonths,
    today,
  );
  const baselineOperatingPlan = base
    ? summarizeOperatingPlan(
        base.workspace,
        baselineMonths.find((month) => month.date === summaryMonth?.date),
        fillHorizonMonths,
        today,
      )
    : null;
  const scenarioDelta = compareOperatingPlans(
    baselineOperatingPlan,
    operatingPlan,
  );
  const focusedPlans = [
    {
      name: "Fill session capacity",
      focus: "Sessions + lead flow",
      reason:
        operatingPlan?.leadsNeeded === null
          ? "Add recent lead totals so the app can size the client pipeline."
          : `Current plan needs ${fmt(operatingPlan?.leadsNeeded)} leads / month to fill open caseload.`,
      action: "Review sessions and Growth before adopting.",
      target: "sessions" as Section,
    },
    {
      name: "Protect owner pay",
      focus: "Profit + take-home",
      reason:
        operatingPlan?.profitGap && operatingPlan.profitGap > 0
          ? `${money(operatingPlan.profitGap)} monthly gap remains against the selected profit target.`
          : "Use this to keep owner/co-owner goals visible while changing one lever at a time.",
      action: "Model revisions in a scenario; do not apply automatically.",
      target: "current-goals" as Section,
    },
    {
      name: "Match rooms to demand",
      focus: "Rooms + in-person capacity",
      reason:
        summaryMonth?.constraint === "Room capacity"
          ? "Room capacity is the current limiting factor."
          : "Keep room limits visible before adding demand or clinician capacity.",
      action: "Check room capacity, assignments, and telehealth assumptions.",
      target: "rooms" as Section,
    },
  ];
  const modeledGoalOptions = goals
    .map(({ goal, snapshot }) => {
      const rows = forecast(snapshot.workspace, snapshot.context);
      const projected = rows.at(-1);
      const baseline = endpoint ?? rows[0] ?? null;
      const revenueDelta =
        (projected?.values.revenue ?? 0) - (baseline?.values.revenue ?? 0);
      const profitDelta =
        (projected?.values.profit ?? 0) - (baseline?.values.profit ?? 0);
      const sessionDelta =
        (projected?.values.sessions ?? 0) - (baseline?.values.sessions ?? 0);
      const score = profitDelta * 1.5 + revenueDelta * 0.25 + sessionDelta * 500;
      const assumptions = [
        `Revenue ${revenueDelta >= 0 ? "+" : "-"}${money(Math.abs(revenueDelta))} / month`,
        `Profit ${profitDelta >= 0 ? "+" : "-"}${money(Math.abs(profitDelta))} / month`,
        `Sessions ${sessionDelta >= 0 ? "+" : "-"}${fmt(Math.abs(sessionDelta))} / month`,
      ];
      const assumptionSignature = planRevisionSignature(snapshot, workingWorkspace, modelContext ?? context, localRetentionState.snapshots, localRetentionState.sameDayVisitOverrides);
      const focusKpis = [
        { name: "Profit", weight: Math.abs(profitDelta) / 1000 },
        { name: "Sessions", weight: Math.abs(sessionDelta) },
        {
          name: projected?.values.roomUtilization ? "Rooms" : "Capacity",
          weight: projected?.values.roomUtilization ?? 0,
        },
      ]
        .sort((a, b) => b.weight - a.weight)
        .slice(0, 2)
        .map((item) => item.name);
      const adoption = planAdoptionMetadata(goal, workingWorkspace);
      const focusHighlights = planFocusHighlights(focusKpis, {
        Profit: assumptions[1],
        Sessions: assumptions[2],
        Rooms: `Projected room utilization ${fmt(projected?.values.roomUtilization, "percent")}; compare to configured room capacity.`,
        Capacity: `Projected capacity ${fmt(projected?.values.capacity)} sessions / month.`,
      });
      return {
        goal,
        snapshot,
        projected,
        revenueDelta,
        profitDelta,
        sessionDelta,
        score,
        assumptions,
        assumptionSignature,
        focusKpis,
        focusHighlights,
        adoption,
        revisionState: !adoption
          ? "not_adopted"
          : adoption.assumptionSignature === assumptionSignature
            ? "current"
            : "needs_refresh",
      };
    })
    .sort((a, b) => b.score - a.score);
  const roomCapacitySlots = active(workingWorkspace.rooms).reduce((sum, room) => {
    if (room.planningOnly) return sum;
    return (
      sum +
      (((roomHours(room) * 60) / Math.max(1, room.sessionMinutes)) *
        room.usablePct) /
        100
    );
  }, 0);
  const focusViews: Record<string, Section[]> = {
    Profit: ["money", "current-goals"],
    Sessions: ["sessions", "clinicians"],
    Rooms: ["rooms"],
    Capacity: ["rooms", "clinicians"],
  };
  const relevantAdoptedPlans = modeledGoalOptions.filter((option) => option.adoption && (
    section === "summary" || option.adoption.focusKpis.some((kpi) => focusViews[kpi]?.includes(section))
  ));
  const roomAssignedHoursTotal = active(workingWorkspace.rooms).reduce(
    (sum, room) =>
      sum + (room.usage === "shared" ? assignedRoomHours(room) : roomHours(room)),
    0,
  );
  const roomDemandWeekly =
    selectedPeriodSessionSummary((modelContext ?? context).sessions, people.map((person) => person.id), periodRange).inPersonWeekly;
  const requiredPracticeWeekly = operatingPlan && operatingPlan.sessions != null && operatingPlan.sessionsToCloseGap != null && operatingPlan.weeks > 0
    ? (operatingPlan.sessions + operatingPlan.sessionsToCloseGap) / operatingPlan.weeks
    : undefined;
  const selectedContributor = people.find((person) => person.label === selectedContributorName);
  const requiredContributorWeekly = selectedContributor && requiredPracticeWeekly != null
    ? desiredWeeklyTotal > 0 ? requiredPracticeWeekly * selectedContributor.sessionsPerWeek / desiredWeeklyTotal : undefined
    : requiredPracticeWeekly;
  const roomUtilizationPct =
    roomCapacitySlots > 0 && roomDemandWeekly !== null
      ? (roomDemandWeekly / roomCapacitySlots) * 100
      : null;
  const overheadTrendRows = overheadSummary.rows
    .slice().sort((a, b) => a.date.localeCompare(b.date))
    .map((row) => ({
      date: monthLabel(row.date),
      overhead: row.overhead,
    }));
  const currentOverheadProjection = months.find((row) => row.date.slice(0, 7) === today.slice(0, 7)) ?? forecast({
    ...workingWorkspace,
    settings: { ...workingWorkspace.settings, forecastStart: today.slice(0, 7) + "-01", horizonMonths: 1 },
  }, modelContext ?? context)[0];
  const overheadTrendMax = Math.max(
    1,
    workingWorkspace.settings.overheadFloorMonthly,
    ...overheadTrendRows.map((row) => row.overhead),
  );
  const table = (collection: Collection) => (
    <RecordTable
      collection={collection}
      workspace={workspace}
      context={context}
      onEdit={(r) => edit(collection, r)}
      onNew={() => edit(collection)}
      onArchive={(id) => setArchiveTarget({ collection, id })}
    />
  );
  const props: ViewProps = {
    workspace,
    context,
    months,
    range: {
      start: workspace.settings.historicalStart,
      end: workspace.settings.historicalEnd,
    },
    edit,
    settings: setSettings,
    save: saveWorkspace,
    table,
  };
  const heading = (title: string, subtitle: string, actions?: ReactNode) => (
    <div className="pw-section-heading">
      <div>
        <h2>{title}</h2>
        <p>{subtitle}</p>
      </div>
      <div className="pw-actions">{actions}</div>
    </div>
  );
  const add = (collection: Collection, label: string) => (
    <button className="pw-button" onClick={() => edit(collection)}>
      <Plus />
      {label}
    </button>
  );
  const detailButton = (collection: Collection, label: string) => (
    <button className="pw-text-button" onClick={() => setDetail(collection)}>
      {label}
      <ChevronRight />
    </button>
  );
  const activeCurrentGoals = active(workingWorkspace.goals);
  const correctedGoal = (goal: LinkedPracticeGoal) => ({
    ...goal,
    metric: ({ "owner pay": "ownerDistributionsPretax", "co-owner pay": "coOwnerSalaryPretax", "desired clinicians": "activeClinicalHeadcount" } as Record<string, Workspace["goals"][number]["metric"]>)[goal.name.toLowerCase()] ?? goal.metric,
  });
  const activeFundGoals = active(workingWorkspace.fundGoals ?? []);
  const findGoal = (name: string) => {
    const goal = linkedGoalFor(name, workingWorkspace, resolved?.goal).goal;
    return goal ? correctedGoal(goal) : undefined;
  };
  const findFundGoal = (name: string) =>
    linkedFundGoalFor(name, workingWorkspace, resolved?.goal).goal ?? undefined;
  const coreGoalRows = [
    {
      name: "Owner pay",
      metric: "ownerDistributionsPretax" as const,
      caption:
        "Pre-tax owner distribution target. Owner clinical revenue remains business revenue.",
    },
    {
      name: "Co-owner pay",
      metric: "coOwnerSalaryPretax" as const,
      caption:
        "Pre-tax salary target for Erin; payroll taxes and take-home stay in Money.",
    },
    {
      name: "Business Profit",
      metric: "profit" as const,
      caption: "Operating profit goal after payroll and practice costs.",
    },
    {
      name: "Desired Clinicians",
      metric: "activeClinicalHeadcount" as const,
      caption: "Active clinical headcount, including clinical owners.",
    },
  ];
  const fundGoalRows = ["Building Fund", "Emergency Reserve", "Growth Fund"];
  const goalExpected = (goal: LinkedPracticeGoal | undefined) =>
    goal
      ? months.find(
          (row) =>
            row.date.slice(0, 7) ===
            (goal.date ?? summaryMonth?.date ?? row.date).slice(0, 7),
        )
          ?.values[goal.metric]
      : null;
  const goalTarget = (goal: LinkedPracticeGoal | undefined) =>
    goal ? goal.amount / (goal.metric !== "activeClinicalHeadcount" && goal.basis === "annual" ? 12 : 1) : 0;
  const goalUnit = (metric: Workspace["goals"][number]["metric"]) =>
    metric === "sessions" || metric === "activeClinicalHeadcount" ? "number" : "currency";
  const completedGoalStatus = (
    goal: LinkedPracticeGoal | undefined,
    expected: number | null | undefined,
    target: number,
  ) => {
    return completedGoalResult(goal, expected).message;
  };
  const completedGoalResult = (
    goal: LinkedPracticeGoal | undefined,
    expected: number | null | undefined,
  ) => evaluateCompletedGoal({
    goal,
    workspace: workingWorkspace,
    context: modelContext ?? context,
    asOf: today,
    expected,
    financialObservations: recordedFinancialPeriods.map((row) => ({
      source: "actual" as const,
      start: row.periodStart,
      end: row.date,
      basis: "period" as const,
      values: row.values,
    })),
  });
  const evaluatedCurrentGoals = [...activeCurrentGoals.map(correctedGoal), ...coreGoalRows.flatMap((row) => activeCurrentGoals.some((goal) => goal.name.trim().toLowerCase() === row.name.toLowerCase()) ? [] : findGoal(row.name) ? [findGoal(row.name)!] : [])];
  const achievedGoals = evaluatedCurrentGoals.flatMap((goal) => {
    const result = completedGoalResult(goal, goalExpected(goal));
    return result.status === "met" ? [{ goal, result }] : [];
  });
  const completedSessionReview = evaluateCompletedGoal({ goal: { metric: "sessions", amount: 1, basis: "monthly" }, workspace: workingWorkspace, context: modelContext ?? context, asOf: today }).date;
  const completedReviewEnd = [completedSessionReview, ...recordedFinancialPeriods.filter((row) => row.periodStart && daysInclusive(row.periodStart, row.date) >= 12 && daysInclusive(row.periodStart, row.date) <= 16).map((row) => row.date)].filter((date): date is string => !!date).sort().at(-1) ?? null;
  const achievedFunds = fundGoalRows.flatMap((name) => {
    const goal = findFundGoal(name);
    const result = completedFundGoalStatus(goal, completedReviewEnd);
    return goal && result.met ? [{ goal, result }] : [];
  });
  const overviewYear = (summaryMonth?.date ?? today).slice(0, 4);
  const overviewAnnualProjection = buildPracticeProjection(moneyFlowWorkspace ?? workingWorkspace, modelContext ?? context, practiceView, today);
  const overviewAnnualMonths = forecast({ ...overviewAnnualProjection.projectionWorkspace, settings: { ...overviewAnnualProjection.projectionWorkspace.settings, forecastStart: overviewYear + "-01-01", horizonMonths: 12 } }, modelContext ?? context, [], 1, true, practiceView === "actual" ? {
    baselineWeeklyByClinician: Object.fromEntries(overviewAnnualProjection.clinicianPace.map((person) => [person.id, person.usedWeekly])),
  } : {});
  const overviewFinancial = overviewFundingSummary(workingWorkspace, overviewAnnualMonths, resolved?.goal);
  const overviewFlow = overviewClientFlow(localRetentionState.snapshots, localRetentionState.sameDayVisitOverrides, periodRange.start, periodRange.end, today);
  const overviewSessionEvidence = selectedPeriodSessionSummary((modelContext ?? context).sessions, people.map((person) => person.id), {
    start: periodRange.start.startsWith("0000-") ? (modelContext ?? context).sessions.map((record) => record.start).sort()[0] ?? today : periodRange.start,
    end: periodRange.end.startsWith("9999-") ? today : periodRange.end,
  }, importedSessionOverlay?.attendanceCoverage ?? []);
  const fundProjection = (goal: LinkedFundGoal | undefined) => {
    return fundProjectionSummary(
      goal,
      activeAllocations,
      moneyValues,
      moneyMonth?.date,
    );
  };
  const fundChartRows = fundGoalRows.map((name) => {
    const goal = findFundGoal(name);
    const projection = fundProjection(goal);
    const current = goal?.currentBalance ?? 0;
    const target = goal?.amount ?? 0;
    return {
      name,
      current,
      target,
      date: goal?.balanceDate ?? "date not recorded",
      assumptions: projection?.assumptions ?? [],
      trajectory: (projection?.trajectory ?? []).map((point) => ({
        date: Date.parse(point.date + "T12:00:00Z"),
        actual: point.kind === "actual" ? point.balance : null,
        projected: point.balance,
      })),
      projectedEta: projection?.eta ?? null,
      projectedContribution: projection?.contribution ?? null,
      remaining: projection?.remaining ?? Math.max(0, target - current),
      pct: target > 0 ? Math.min(100, (current / target) * 100) : 0,
      projectedPct:
        target > 0 && projection?.eta && projection.contribution !== null
          ? 100
          : target > 0
            ? Math.min(100, (current / target) * 100)
            : 0,
    };
  });
  const practiceRevenueForOverhead =
    moneyValues.revenue && moneyValues.revenue > 0
      ? (workingWorkspace.settings.overheadFloorMonthly / moneyValues.revenue) *
        100
      : null;

  return (
    <div className="practice-theme pw-app" data-appearance="dark">
      <aside className="pw-rail">
        <div className="pw-brand">
          <span className="pw-brand-mark">EMC</span>
          <span>
            {workspace.settings.practiceName}
            <small>Practice workspace</small>
          </span>
          <button
            className="pw-mobile-settings"
            title="Settings"
            aria-label="Open practice settings"
            disabled={saving || sessionEditing}
            onClick={() => {
              setMode("practice");
              setSection("settings");
            }}
          >
            <Settings2 />
          </button>
        </div>
        <div className="pw-nav-group-label">Today</div>
        <nav className="pw-today-navigation" aria-label="Practice sections">
          {sections.map((s, index) => <button key={s.id} aria-current={mode === "practice" && (section === s.id || s.active?.includes(section)) ? "page" : undefined} disabled={saving || sessionEditing} onClick={() => { if (mode !== "practice") navigate("practice"); if (integratedTool) showTool(null); setSection(s.id); }}><span className="pw-nav-number">{String(index + 1).padStart(2, "0")}</span><span>{s.label}</span></button>)}
        </nav>
        <nav className="pw-workspace-navigation" aria-label="Main navigation">
          {(
            [
              { id: "goals", label: "Long Term Goals", icon: Flag },
              { id: "sandbox", label: "Sandbox", icon: FlaskConical },
            ] as const
          ).map((item) => (
            <button
              key={item.id}
              disabled={saving || sessionEditing}
              aria-current={mode === item.id ? "page" : undefined}
              onClick={() => navigate(item.id)}
            >
              <item.icon />
              <span>{item.label}</span>
              {item.id === "goals" && goals.length > 0 && (
                <small>{goals.length}</small>
              )}
            </button>
          ))}
        </nav>
        <div className="pw-rail-bottom">
          <button disabled={saving || sessionEditing} aria-current={mode === "practice" && section === "retention" ? "page" : undefined} onClick={() => { if (mode !== "practice") navigate("practice"); if (integratedTool) showTool(null); setSection("retention"); }}><Upload />Data &amp; imports</button>
          <button
            disabled={saving || sessionEditing}
            onClick={() => {
              setMode("practice");
              setSection("settings");
            }}
          >
            <Settings2 />
            Settings
          </button>
          {!sandbox && (
            <a
              href={`${import.meta.env.BASE_URL}reference`}
              target="_blank"
              rel="noreferrer"
            >
              <PanelTop />
              Reference layout
            </a>
          )}
          {import.meta.env.DEV && (
            <span className="pw-local">Local preview</span>
          )}
        </div>
      </aside>
      <main className="pw-main">
        <header className="pw-header">
          <div>
            <div className="pw-eyebrow">
              {mode === "sandbox"
                ? "Independent model"
                : mode === "goals"
                  ? "Future scenarios"
                  : "Current business"}
            </div>
            <h1>
              {mode === "sandbox"
                ? "Sandbox"
                : mode === "goals"
                  ? "Long Term Goals"
                  : sections.find((item) => item.id === section)?.label ?? (section === "rooms" ? "Rooms" : section === "retention" ? "Data & imports" : section === "documents" ? "Reporting documents" : "Settings")}
            </h1>
          </div>
          <div className="pw-actions">
            {mode === "practice" && (
              <button
                className="pw-button"
                onClick={() => setExportOpen(true)}
                title="Export compensation reports"
              >
                <Download />
                Reports
              </button>
            )}
            {sandbox ? (
              !visibleTool && (
                <>
                  <button
                    className="pw-icon"
                    aria-label="Model settings"
                    title="Model settings"
                    onClick={() => setSection("settings")}
                  >
                    <Settings2 />
                  </button>
                  <button
                    className="pw-icon"
                    aria-label={
                      planningEdit ? "Discard scenario edits" : "Reset sandbox"
                    }
                    title={
                      planningEdit ? "Discard scenario edits" : "Reset sandbox"
                    }
                    onClick={() => setResetDialog(true)}
                  >
                    <RotateCcw />
                  </button>
                  {isTransferSection(section) && (
                    <button
                      className="pw-button"
                      onClick={() => {
                        setTransferSection(section);
                        setTransferOpen(true);
                      }}
                    >
                      <Download /> Move data
                    </button>
                  )}
                  {mode === "sandbox" && (
                    <>
                      <button
                        className="pw-button"
                        onClick={() => setSandboxLibraryOpen(true)}
                      >
                        <FolderOpen /> Saved models
                      </button>
                      <button
                        className="pw-button"
                        onClick={() => {
                          setGoalName(sandboxName);
                          setGoalDialog(true);
                          setError("");
                        }}
                      >
                        <Flag /> Copy to Long Term Goals
                      </button>
                    </>
                  )}
                  <button
                    className="pw-button pw-primary"
                    onClick={() => {
                      if (planningEdit) setGoalDialog(true);
                      else setSandboxDialog(true);
                      setError("");
                    }}
                  >
                    <Save />
                    {planningEdit ? "Save scenario" : "Save model"}
                  </button>
                </>
              )
            ) : mode === "practice" ? (
              <>
                {isTransferSection(section) && (
                  <button
                    className="pw-button"
                    onClick={() => {
                      setTransferSection(section);
                      setTransferOpen(true);
                    }}
                  >
                    <Download /> Move data
                  </button>
                )}
                <button className="pw-button" onClick={startPlanning}>
                  <Flag /> New scenario
                </button>
              </>
            ) : (
              <button className="pw-button" onClick={startPlanning}>
                <Plus />
                New scenario
              </button>
            )}
          </div>
        </header>
        {mode === "practice" && !visibleTool && ["summary", "money"].includes(section) && (
          <details className="pw-view-bar">
            <summary>Projection basis</summary>
            <span>
              {recordedClinicianCount
                ? `${recordedClinicianCount} of ${viewProjection?.clinicianPace.length ?? 0} clinicians recorded in the last 8 weeks; gaps use desired sessions`
                : "No sessions recorded in the last 8 weeks; using desired sessions"}
            </span>
          </details>
        )}
        {error && (
          <div className="pw-error" role="alert">
            {error}
            <button
              className="pw-icon"
              aria-label="Dismiss error"
              onClick={() => setError("")}
            >
              <X />
            </button>
          </div>
        )}
        {mode === "goals" && !draft && toolTabs.length > 0 && (
          <nav className="pw-tool-tabs" aria-label="Views in this area">
            {toolTabs.map((tab) => (
              <button
                key={tab.id ?? "overview"}
                type="button"
                aria-current={visibleTool === tab.id ? "page" : undefined}
                disabled={saving || sessionEditing}
                onClick={() => showTool(tab.id)}
              >
                {tab.label}
              </button>
            ))}
          </nav>
        )}
        {(mode !== "goals" || !!draft) && (
          <>
            {sandbox && !visibleTool && (
              <nav
                className="pw-sections"
                aria-label={sandbox ? "Sandbox sections" : "Practice sections"}
              >
                {sections.map((s) => (
                  <button
                    key={s.id}
                    aria-current={
                      section === s.id || s.active?.includes(section)
                        ? "page"
                        : undefined
                    }
                    disabled={saving || sessionEditing}
                    onClick={() => {
                      if (integratedTool) showTool(null);
                      setSection(s.id);
                    }}
                  >
                    {s.label}
                  </button>
                ))}
              </nav>
            )}
            {toolTabs.length > 0 && (
              <nav className="pw-tool-tabs" aria-label="Views in this area">
                {toolTabs.map((tab) => (
                  <button
                    key={tab.id ?? "overview"}
                    type="button"
                    aria-current={visibleTool === tab.id ? "page" : undefined}
                    disabled={saving || sessionEditing}
                    onClick={() => showTool(tab.id)}
                  >
                    {tab.label}
                  </button>
                ))}
              </nav>
            )}
            {sandbox && !visibleTool && (
              <div className="pw-sandbox-timeline">
                <span className="pw-tag">
                  {planningEdit ? <Flag /> : <FlaskConical />}
                  {planningEdit ? goalName || "New scenario" : "Sandbox only"}
                </span>
                <label>
                  Starting month
                  <input
                    type="month"
                    aria-label={
                      planningEdit
                        ? "Scenario starting month"
                        : "Sandbox starting month"
                    }
                    value={workspace.settings.forecastStart.slice(0, 7)}
                    onChange={(e) => {
                      if (e.target.value)
                        void saveWorkspace({
                          ...workspace,
                          settings: {
                            ...workspace.settings,
                            forecastStart: e.target.value + "-01",
                          },
                        }).catch((e) => setError(errorText(e)));
                    }}
                  />
                </label>
                <label>
                  Looking ahead
                  <select
                    aria-label={
                      planningEdit ? "Scenario horizon" : "Sandbox horizon"
                    }
                    value={workspace.settings.horizonMonths}
                    onChange={(e) =>
                      void saveWorkspace({
                        ...workspace,
                        settings: {
                          ...workspace.settings,
                          horizonMonths: Number(e.target.value),
                        },
                      })
                    }
                  >
                    {[
                      ...new Set([
                        3,
                        6,
                        12,
                        24,
                        36,
                        60,
                        workspace.settings.horizonMonths,
                      ]),
                    ]
                      .sort((a, b) => a - b)
                      .map((n) => (
                        <option key={n} value={n}>
                          {n} months
                        </option>
                      ))}
                  </select>
                </label>
                <button
                  className="pw-text-button"
                  onClick={() => setDetail("events")}
                >
                  Timed changes
                  <ChevronRight />
                </button>
              </div>
            )}
            {visibleTool && (
              <div className="pw-content">
                <div className="pw-integrated-tool">
                  {toolNotice && <p className="pw-tool-notice">{toolNotice}</p>}
                  <IntegratedToolContent
                    tool={visibleTool}
                    teamId={workspace.settings.teamId}
                  />
                </div>
              </div>
            )}
            <div className="pw-content" hidden={!!visibleTool}>
              {mode === "practice" && relevantAdoptedPlans.map((option) => (
                <div className="pw-focus-alert" key={option.goal.id} role="status">
                  <strong>{option.goal.name}: {option.adoption!.focusKpis.join(" + ")}</strong>
                  <p>{option.adoption!.highlights.join("; ")}</p>
                  {option.revisionState === "needs_refresh" && <p>New data or assumptions changed this plan. Review Long Term Goals before refreshing its focus.</p>}
                </div>
              ))}
              {section === "clinicians" && (
                <>
                  <SharedPeriodControls
                    period={sharedPeriod}
                    custom={customPeriod}
                    onPeriod={setSharedPeriod}
                    onCustom={setCustomPeriod}
                    note="Team KPIs use recorded/imported performance when available; pay structure remains editable below."
                  />
                  {heading(
                    "Clinical staff",
                    people.length + " clinicians",
                    <>
                      {sandbox ? (
                        <span className="pw-model-team">
                          {planningEdit ? "Scenario team" : "Independent team"}
                        </span>
                      ) : (
                        <select
                          aria-label="Practice team"
                          disabled={saving}
                          value={workspace.settings.teamId ?? "unassigned"}
                          onChange={(e) =>
                            void saveWorkspace({
                              ...workspace,
                              settings: {
                                ...workspace.settings,
                                teamId:
                                  e.target.value === "unassigned"
                                    ? null
                                    : Number(e.target.value),
                              },
                            }).catch((e) => setError(errorText(e)))
                          }
                        >
                          {!teams.data?.length && (
                            <option value="unassigned">
                              No saved compensation team
                            </option>
                          )}
                          {teams.data?.map((t) => (
                            <option key={t.id} value={t.id}>
                              {t.name}
                            </option>
                          ))}
                        </select>
                      )}
                      {sandbox ? (
                        <button
                          className="pw-button"
                          onClick={addModeledClinician}
                        >
                          <Plus /> Add clinician
                        </button>
                      ) : (
                        <button
                          className="pw-button"
                          onClick={() => showTool("team")}
                        >
                          <Plus />
                          Manage team
                        </button>
                      )}
                    </>,
                  )}
                  <div className="pw-clinicians">
                    {people.map((person) => {
                      const result = calculateClinicianMetrics(person);
                      const classification = String(
                        person.classification,
                      ).toLowerCase();
                      const projected =
                        months[0]?.clinicians[String(person.id)];
                      const pace = viewProjection?.clinicianPace.find(
                        (item) => item.id === person.id,
                      );
                      const personRecords = (modelContext ?? context).sessions.filter((record) => record.clinicianId === person.id);
                      const sessionEvidenceBounds = {
                        start: periodRange.start.startsWith("0000-") ? personRecords.map((record) => record.start).sort()[0] ?? today : periodRange.start,
                        end: periodRange.end.startsWith("9999-") ? today : periodRange.end,
                      };
                      const sessionEvidence = selectedPeriodSessionSummary(personRecords, [person.id], sessionEvidenceBounds, importedSessionOverlay?.attendanceCoverage ?? []);
                      const importedActivity = clinicianActivityByName.get(
                        normalizeClinicianName(person.label),
                      );
                      const consultMetric =
                        consultConversionSummary.byClinician.find(
                          (row) =>
                            normalizeClinicianName(row.clinician ?? "") ===
                            normalizeClinicianName(person.label),
                        ) ?? null;
                      const setting = workspace.clinicians.find(
                        (c) =>
                          c.clinicianId === person.id &&
                          c.status !== "archived",
                      );
                      return (
                        <article className="pw-person" key={person.id}>
                          <header>
                            <span className="pw-avatar">
                              {person.label
                                .split(/\s+/)
                                .slice(0, 2)
                                .map((p) => p[0])
                                .join("")}
                            </span>
                            <div>
                              {sandbox ? (
                                <input
                                  className="pw-person-name"
                                  aria-label={`Name for ${person.label}`}
                                  value={person.label}
                                  onChange={(event) =>
                                    void patchPerson(person, {
                                      label: event.target.value,
                                    })
                                  }
                                />
                              ) : (
                                <h3>{person.label}</h3>
                              )}
                              <div className="pw-person-meta">
                                <select
                                  className="pw-person-classification"
                                  aria-label={`${person.label} classification`}
                                  title="Classification affects pay and employer costs"
                                  value={classification}
                                  disabled={saving || sessionEditing}
                                  onChange={(event) =>
                                    void patchPerson(person, {
                                      classification: event.target.value,
                                    }).catch((error) =>
                                      setError(errorText(error)),
                                    )
                                  }
                                >
                                  <option value="1099">1099</option>
                                  <option value="w2">W2</option>
                                  <option value="owner">Owner</option>
                                  {!["1099", "w2", "owner"].includes(
                                    classification,
                                  ) && (
                                    <option value={classification}>
                                      {String(person.classification)}
                                    </option>
                                  )}
                                </select>
                                {setting && <span>{setting.status}</span>}
                              </div>
                            </div>
                            <EditButton
                              label={
                                "Schedule and pay method for " + person.label
                              }
                              onClick={() =>
                                edit(
                                  "clinicians",
                                  setting ?? {
                                    ...newRecord(
                                      "clinicians",
                                      workspace,
                                      today,
                                    ),
                                    clinicianId: person.id,
                                    desiredWeeklySessions:
                                      person.sessionsPerWeek,
                                  },
                                )
                              }
                            />
                            {sandbox && (
                              <button
                                className="pw-icon"
                                aria-label={`Remove ${person.label} from model`}
                                title="Remove from model"
                                onClick={() => removeModeledClinician(person)}
                              >
                                <Trash2 />
                              </button>
                            )}
                          </header>
                          <div className="pw-person-kpis">
                            <div>
                              <span>Sessions</span>
                              <strong>{fmt(sessionEvidence.completedWeekly ?? sessionEvidence.calendarWindowWeeklyEstimate)} / wk</strong>
                              <small>
                                {fmt(sessionEvidence.observedCompleted)} recorded visits · {sessionEvidence.coverageComplete ? "recorded pace" : "calendar-window estimate"}
                              </small>
                            </div>
                            <div>
                              <span>Retention</span>
                              <strong>
                                {importedActivity?.initialRetentionPct === null ||
                                importedActivity?.initialRetentionPct ===
                                  undefined
                                  ? "--"
                                  : fmt(importedActivity.initialRetentionPct, "percent")}
                              </strong>
                              <small>
                                {importedActivity
                                  ? `${fmt(importedActivity.initialRetentionDenominator)} evaluated starts; ${fmt(importedActivity.pendingInitialClients)} pending${importedActivity.coverageVerified ? "" : "; observed, coverage unverified"}`
                                  : "no imported clinician data"}
                              </small>
                            </div>
                            <div>
                              <span>Attrition</span>
                              <strong>
                                {fmt(
                                  importedActivity?.averageClientEndingsPerFullMonth,
                                )}
                              </strong>
                              <small>
                                {importedActivity?.endingFullMonthDenominator
                                  ? `${fmt(importedActivity.endingFullMonthDenominator)} observed client-months`
                                  : "no mature observed months"}
                              </small>
                            </div>
                            <div>
                              <span>Confirmed close</span>
                              <strong>{fmt(consultMetric?.conversionRate, "percent")}</strong>
                              <small>
                                {consultMetric
                                  ? `${fmt(consultMetric.converted)} confirmed; ${fmt(consultMetric.pending)} pending${consultConversionSummary.coverageVerified ? "" : "; observed, coverage unverified"}`
                                  : "no imported PHONE journeys"}
                              </small>
                            </div>
                          </div>
                          <details className="pw-clinician-operating-details"><summary>Clinician details</summary>
                          <div className="pw-number-grid">
                            <NumberField
                              label={person.label + " session fee"}
                              caption="Session fee"
                              value={person.sessionRate}
                              unit="$"
                              onSave={(n) =>
                                patchPerson(person, { sessionRate: n })
                              }
                            />
                            <NumberField
                              label={person.label + " desired sessions / week"}
                              caption="Desired sessions / week"
                              value={person.sessionsPerWeek}
                              max={100}
                              onSave={(n) =>
                                patchPerson(person, { sessionsPerWeek: n })
                              }
                            />
                            <NumberField
                              label={
                                person.label +
                                " expected average revenue per completed session"
                              }
                              caption="Avg. earned / session"
                              value={
                                setting?.expectedSessionRevenue ??
                                person.sessionRate
                              }
                              unit="$"
                              onSave={async (rate) =>
                                stageClinicianAverageRate(person, rate)
                              }
                            />
                          </div>
                          {setting?.expectedSessionRevenue !== null &&
                            setting?.expectedSessionRevenue !== undefined && (
                              <button
                                className="pw-text-button"
                                onClick={() =>
                                  stageClinicianAverageRate(person, null)
                                }
                              >
                                Use listed session fee for estimate
                              </button>
                            )}
                          <div className="pw-pay-structure">
                            <span>Clinician / practice split</span>
                            <strong>
                              {person.preCapClinicianSplit}% /{" "}
                              {person.preCapPracticeSplit}%
                            </strong>
                            {person.capEnabled && (
                              <small>
                                {person.postCapClinicianSplit}% /{" "}
                                {person.postCapPracticeSplit}% after{" "}
                                {money(person.capAmount)} cap
                              </small>
                            )}
                          </div>
                          <details className="pw-person-details">
                            <summary>
                              Pay structure <ChevronRight />
                            </summary>
                            <div className="pw-number-grid">
                              <NumberField
                                label={person.label + " clinician share"}
                                value={person.preCapClinicianSplit}
                                max={100}
                                unit="%"
                                onSave={(n) =>
                                  patchPerson(person, {
                                    preCapClinicianSplit: n,
                                    preCapPracticeSplit: 100 - n,
                                  })
                                }
                              />
                              <NumberField
                                label={person.label + " weeks / year"}
                                value={person.weeksWorkedPerYear}
                                max={52.18}
                                onSave={(n) =>
                                  patchPerson(person, {
                                    weeksWorkedPerYear: n,
                                  })
                                }
                              />
                            </div>
                            <label className="pw-checkbox">
                              <input
                                type="checkbox"
                                checked={person.capEnabled}
                                disabled={saving}
                                onChange={(e) =>
                                  void patchPerson(person, {
                                    capEnabled: e.target.checked,
                                  }).catch((e) => setError(errorText(e)))
                                }
                              />
                              Practice cap
                            </label>
                            {person.capEnabled && (
                              <div className="pw-number-grid">
                                <NumberField
                                  label={person.label + " cap"}
                                  value={person.capAmount}
                                  unit="$"
                                  onSave={(n) =>
                                    patchPerson(person, { capAmount: n })
                                  }
                                />
                                <NumberField
                                  label={person.label + " post-cap share"}
                                  value={person.postCapClinicianSplit}
                                  max={100}
                                  unit="%"
                                  onSave={(n) =>
                                    patchPerson(person, {
                                      postCapClinicianSplit: n,
                                      postCapPracticeSplit: 100 - n,
                                    })
                                  }
                                />
                              </div>
                            )}
                            <div className="pw-number-grid">
                              <NumberField
                                label={
                                  person.label + " non-clinical hours / week"
                                }
                                value={person.nonClinicalHoursPerWeek ?? 0}
                                onSave={(n) =>
                                  patchPerson(person, {
                                    nonClinicalHoursPerWeek: n,
                                  })
                                }
                              />
                              <NumberField
                                label={
                                  person.label + " non-clinical hourly pay"
                                }
                                value={person.nonClinicalHourlyRate ?? 0}
                                unit="$"
                                onSave={(n) =>
                                  patchPerson(person, {
                                    nonClinicalHourlyRate: n,
                                  })
                                }
                              />
                            </div>
                          </details>
                          <footer>
                            <span>
                              {mode === "practice" && practiceView === "actual"
                                ? pace?.recordedWeekly !== null
                                  ? `Projected at ${fmt(pace?.usedWeekly)} sessions / week`
                                  : "Projected from desired sessions / week"
                                : "At desired sessions / month"}
                            </span>
                            <dl>
                              <div>
                                <dt>Revenue</dt>
                                <dd>
                                  {money(
                                    mode === "practice" &&
                                      practiceView === "actual"
                                      ? projected?.revenue
                                      : result.annualProduction / 12,
                                  )}
                                </dd>
                              </div>
                              <div>
                                <dt>Est. clinician pay</dt>
                                <dd>
                                  {money(
                                    mode === "practice" &&
                                      practiceView === "actual"
                                      ? projected?.clinicianPay
                                      : result.clinicianCompensation / 12,
                                  )}
                                </dd>
                              </div>
                            </dl>
                            {setting &&
                              setting.payMode !== "existing_split" && (
                                <small>
                                  Split estimate shown. The{" "}
                                  {setting.payMode.replace("_", " ")} override
                                  applies in the forecast.
                                </small>
                              )}
                          </footer>
                          </details>
                        </article>
                      );
                    })}
                  </div>
                  {!people.length && (
                    <div className="pw-empty">
                      <Users />
                      <h3>No clinicians yet</h3>
                      <p>
                        {sandbox
                          ? "Add a clinician to begin this model."
                          : "Add clinicians in Team details."}
                      </p>
                    </div>
                  )}
                  {sandbox && (
                    <section
                      className="pw-modeled-staff"
                      aria-label="Staff pay in this model"
                    >
                      <div className="pw-section-heading">
                        <div>
                          <h3>Staff pay</h3>
                          <p>Support roles in this model</p>
                        </div>
                        <button className="pw-button" onClick={addModeledStaff}>
                          <Plus /> Add staff
                        </button>
                      </div>
                      {context.staff
                        .map((member, index) => ({ member, index }))
                        .filter(
                          ({ member }) =>
                            (member.goalId ?? null) ===
                            workspace.settings.teamId,
                        )
                        .map(({ member, index }) => (
                          <div
                            className="pw-modeled-staff-row"
                            key={member.id ?? index}
                          >
                            <input
                              aria-label={`Staff name ${index + 1}`}
                              value={member.label ?? `Staff ${index + 1}`}
                              onChange={(event) =>
                                void patchModeledStaff(index, {
                                  label: event.target.value,
                                })
                              }
                            />
                            <select
                              aria-label={`Pay type for ${member.label ?? "staff"}`}
                              value={
                                member.annualSalary !== null
                                  ? "salary"
                                  : "hourly"
                              }
                              onChange={(event) =>
                                void patchModeledStaff(
                                  index,
                                  event.target.value === "salary"
                                    ? {
                                        annualSalary: 0,
                                        hourlyRate: null,
                                        hoursPerWeek: null,
                                      }
                                    : {
                                        annualSalary: null,
                                        hourlyRate: 25,
                                        hoursPerWeek: 40,
                                      },
                                )
                              }
                            >
                              <option value="salary">Salary</option>
                              <option value="hourly">Hourly</option>
                            </select>
                            {member.annualSalary !== null ? (
                              <NumberField
                                label={`${member.label ?? "Staff"} annual salary`}
                                value={member.annualSalary ?? 0}
                                unit="$"
                                onSave={(value) =>
                                  patchModeledStaff(index, {
                                    annualSalary: value,
                                  })
                                }
                              />
                            ) : (
                              <>
                                <NumberField
                                  label={`${member.label ?? "Staff"} hourly rate`}
                                  value={member.hourlyRate ?? 0}
                                  unit="$"
                                  onSave={(value) =>
                                    patchModeledStaff(index, {
                                      hourlyRate: value,
                                    })
                                  }
                                />
                                <NumberField
                                  label={`${member.label ?? "Staff"} weekly hours`}
                                  value={member.hoursPerWeek ?? 0}
                                  max={168}
                                  onSave={(value) =>
                                    patchModeledStaff(index, {
                                      hoursPerWeek: value,
                                    })
                                  }
                                />
                              </>
                            )}
                            <span>
                              {money(
                                calculateStaffMemberCost(member)
                                  .totalAnnualCost / 12,
                              )}{" "}
                              / month
                            </span>
                            <button
                              className="pw-icon"
                              aria-label={`Remove ${member.label ?? "staff"} from model`}
                              title="Remove from model"
                              onClick={() =>
                                setDraft((current) =>
                                  current
                                    ? {
                                        ...current,
                                        context: {
                                          ...current.context,
                                          staff: current.context.staff.filter(
                                            (_, i) => i !== index,
                                          ),
                                        },
                                      }
                                    : current,
                                )
                              }
                            >
                              <Trash2 />
                            </button>
                          </div>
                        ))}
                    </section>
                  )}
                  <div className="pw-secondary-links">
                    {detailButton("terms", "Future pay changes")}
                    {detailButton("hiring", "Hiring costs")}
                    {!sandbox && (
                      <button
                        className="pw-text-button"
                        onClick={() => showTool("impact")}
                      >
                        Compare clinician pay
                        <ChevronRight />
                      </button>
                    )}
                  </div>
                </>
              )}
              {section === "sessions" && (
                <>
                  {sessionMetricView !== "sessions" && <SharedPeriodControls
                    period={sharedPeriod}
                    custom={customPeriod}
                    onPeriod={setSharedPeriod}
                    onCustom={setCustomPeriod}
                    note=""
                  />}
                  <div
                    className="pw-segmented"
                    role="tablist"
                    aria-label="Session metric view"
                  >
                    {(
                      [
                        ["sessions", "Session trends"],
                        ["retention", "Retention"],
                        ["attrition", "Attrition"],
                      ] as const
                    ).map(([id, label]) => (
                      <button
                        key={id}
                        role="tab"
                        aria-selected={sessionMetricView === id}
                        onClick={() => setSessionMetricView(id)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  {importedSessionOverlay &&
                    importedSessionOverlay.derivedSessions.length > 0 && (
                      <details className="pw-session-import-details"><summary>Import details</summary><p className="pw-note">
                        Saved imports are contributing{" "}
                        {importedSessionOverlay.diagnostic.rawAttendedRows.toLocaleString()}{" "}
                        attended rows,{" "}
                        {(
                          importedSessionOverlay.diagnostic.rawAttendedRows -
                          importedSessionOverlay.diagnostic
                            .collapsedDuplicateShowRows
                        ).toLocaleString()}{" "}
                        derived attended visits, and{" "}
                        {importedSessionOverlay.diagnostic.billedRows.toLocaleString()}{" "}
                        billed rows to projections. Fully covered imported
                        attendance replaces{" "}
                        {importedSessionOverlay.diagnostic.manualImportOverrideCount.toLocaleString()}{" "}
                        manual completed session
                        {importedSessionOverlay.diagnostic
                          .manualImportOverrideCount === 1
                          ? ""
                          : "s"}{" "}
                        in this view;{" "}
                        {importedSessionOverlay.diagnostic.manualImportConflictCount.toLocaleString()}{" "}
                        partial-overlap imported row
                        {importedSessionOverlay.diagnostic
                          .manualImportConflictCount === 1
                          ? ""
                          : "s"}{" "}
                        replaced stale aggregate manual totals for covered
                        dates; uncovered days remain unknown instead of being
                        prorated.
                      </p></details>
                    )}
                  {importedSessionOverlay &&
                    (importedSessionOverlay.diagnostic.missingClinicianLabels
                      .length > 0 ||
                      importedSessionOverlay.diagnostic.ambiguousClinicianLabels
                        .length > 0) && (
                      <p className="pw-error" role="alert">
                        Some imported attendance rows are excluded from
                        projections because clinician labels do not map cleanly:{" "}
                        {[
                          ...importedSessionOverlay.diagnostic
                            .missingClinicianLabels,
                          ...importedSessionOverlay.diagnostic
                            .ambiguousClinicianLabels,
                        ].join(", ")}
                        .
                      </p>
                    )}
                  {sessionMetricView === "sessions" ? (
                    <>
                    <WorkspaceSessions
                      key={mode + "-" + workspace.settings.teamId}
                      context={context}
                      summaryContext={modelContext ?? context}
                      teamId={workspace.settings.teamId}
                      sandbox={sandbox}
                      onEditingChange={setSessionEditing}
                      onPlanHire={startPlanning}
                      onOpenCalculations={openRetentionCalculations}
                      onOpenConvertedImports={() => setSection("retention")}
                      forecastMonths={months}
                      selectedPeriod={periodRange}
                      contributorId={selectedContributor?.id ?? null}
                      compareWholePractice={compareWholePractice && !!selectedContributor}
                      requiredWeeklySessions={requiredContributorWeekly}
                      attendanceCoverage={importedSessionOverlay?.attendanceCoverage}
                      attendanceObservedSpans={importedSessionOverlay?.attendanceObservedSpans}
                      controls={<><SharedPeriodControls period={sharedPeriod} custom={customPeriod} onPeriod={setSharedPeriod} onCustom={setCustomPeriod} note="" /><div className="pw-contributor-tabs" role="group" aria-label="Sessions contributor">
                        {contributorNames.map((name) => <button key={name} aria-pressed={selectedContributorName === name} onClick={() => { setSharedContributor(name); setCompareWholePractice(false); }}>{name}</button>)}
                        {selectedContributorName !== "Whole Practice" && <button aria-pressed={compareWholePractice} onClick={() => setCompareWholePractice((value) => !value)}>Compare with Whole Practice</button>}
                      </div></>}
                      onSaved={async () => {
                        await contextQuery.refetch();
                        void cache.invalidateQueries({
                          queryKey: ["session-records"],
                        });
                      }}
                    />
                    </>
                  ) : (
                    <section className="pw-metric-panel">
                      <div className="pw-section-heading">
                        <div>
                          <h3>
                            {sessionMetricView === "retention"
                              ? "Initial retention"
                              : "Attrition"}
                          </h3>
                          <p>
                            {selectedContributorName} ·{" "}
                            {sharedPeriodLabel(sharedPeriod)} · imported
                            treatment history only
                          </p>
                        </div>
                      </div>
                      <div
                        className="pw-contributor-tabs"
                        role="group"
                        aria-label="Contributor"
                      >
                        {contributorNames.map((name) => (
                          <button
                            key={name}
                            aria-pressed={selectedContributorName === name}
                            onClick={() => {
                              setSharedContributor(name);
                              setCompareWholePractice(false);
                            }}
                          >
                            {name}
                          </button>
                        ))}
                        {selectedContributorName !== "Whole Practice" && (
                          <button
                            aria-pressed={compareWholePractice}
                            onClick={() =>
                              setCompareWholePractice((value) => !value)
                            }
                          >
                            Compare with Whole Practice
                          </button>
                        )}
                      </div>
                      {sessionMetricView === "retention" ? (
                        <>
                          <div className="pw-metric-hero">
                            <strong>
                              {selectedContributorName === "Whole Practice"
                                ? percent(
                                    clientActivityEstimate?.initialRetentionRate,
                                  )
                                : contributorActivity?.initialRetentionPct ===
                                      null ||
                                    contributorActivity?.initialRetentionPct ===
                                      undefined
                                  ? "--"
                                  : `${contributorActivity.initialRetentionPct.toFixed(1)}%`}
                            </strong>
                            <span>
                              {selectedContributorName === "Whole Practice"
                                ? `${fmt(clientActivityEstimate?.retainedClientPairs)} retained / ${fmt(clientActivityEstimate?.initialRetentionDenominator)} mature starts`
                                : contributorActivity
                                  ? `${fmt(contributorActivity.retainedClients)} retained / ${fmt(contributorActivity.initialRetentionDenominator)} mature starts`
                                  : "No imported clinician data"}
                            </span>
                          </div>
                          <MetricTargetBar
                            value={
                              selectedContributorName === "Whole Practice"
                                ? clientActivityEstimate?.initialRetentionRate ===
                                    null ||
                                  clientActivityEstimate?.initialRetentionRate ===
                                    undefined
                                  ? null
                                  : clientActivityEstimate.initialRetentionRate *
                                    100
                                : contributorActivity?.initialRetentionPct
                            }
                            benchmark={
                              selectedContributorName === "Whole Practice" ||
                              clientActivityEstimate?.initialRetentionRate ===
                                null ||
                              clientActivityEstimate?.initialRetentionRate ===
                                undefined
                                ? null
                                : clientActivityEstimate.initialRetentionRate *
                                  100
                            }
                            goal={null}
                            valueLabel="Observed"
                            max={100}
                          />
                          <p className="pw-note">
                            {(selectedContributorName === "Whole Practice" ? !clientActivityEstimate?.coverageVerified : !contributorActivity?.coverageVerified) && "Observed rate; report coverage is unverified. "}
                            {fmt(selectedContributorName === "Whole Practice" ? clientActivityEstimate?.immatureClientPairsExcluded : contributorActivity?.pendingInitialClients)} pending starts. {" "}
                            Retention uses three attended treatment sessions,
                            the agreed 28-day initial gap, excludes PHONE
                            consults, and excludes pending immature starts from
                            the rate.
                          </p>
                        </>
                      ) : (
                        <>
                          <div className="pw-metric-hero">
                            <strong>
                              {selectedContributorName === "Whole Practice"
                                ? fmt(
                                    clientActivityEstimate?.averageClientEndingsPerFullMonth,
                                  )
                                : fmt(
                                    contributorActivity?.averageClientEndingsPerFullMonth,
                                  )}
                              <small> clients / month</small>
                            </strong>
                            <span>
                              {selectedContributorName === "Whole Practice"
                                ? `${fmt(clientActivityEstimate?.endingFullMonthDenominator)} mature observed months`
                                : contributorActivity
                                  ? `${fmt(contributorActivity.endingFullMonthDenominator)} mature observed months`
                                  : "No mature observed months"}
                            </span>
                          </div>
                          <MetricTargetBar
                            value={
                              selectedContributorName === "Whole Practice"
                                ? clientActivityEstimate?.averageClientEndingsPerFullMonth
                                : contributorActivity?.averageClientEndingsPerFullMonth
                            }
                            benchmark={
                              selectedContributorName === "Whole Practice"
                                ? null
                                : clientActivityEstimate?.averageClientEndingsPerFullMonth
                            }
                            goal={8}
                            lowerIsBetter
                          />
                          <p className="pw-note">
                            Attrition is lower-is-better, measured as client
                            endings per mature month. Endings require 90 covered
                            days without a later return; later returns remove
                            the prior ending.
                          </p>
                        </>
                      )}
                      {compareWholePractice && selectedContributorName !== "Whole Practice" && (
                        <div className="pw-comparison" aria-label="Whole Practice comparison">
                          <strong>Whole Practice</strong>
                          {sessionMetricView === "retention" ? (
                            <p>{percent(clientActivityEstimate?.initialRetentionRate)} · {fmt(clientActivityEstimate?.retainedClientPairs)} retained / {fmt(clientActivityEstimate?.initialRetentionDenominator)} mature starts</p>
                          ) : (
                            <p>{fmt(clientActivityEstimate?.averageClientEndingsPerFullMonth)} endings / month · {fmt(clientActivityEstimate?.endingFullMonthClientEnds)} unique client endings / {fmt(clientActivityEstimate?.endingFullMonthDenominator)} mature months</p>
                          )}
                        </div>
                      )}
                    </section>
                  )}
                </>
              )}
              {section === "retention" && (
                <>
                  <LocalRetentionWorkspace
                    workspaceState={localRetentionState}
                    today={today}
                  />
                  <div id="retention-calculations">
                    <WorkspaceCalculations
                      workspace={workingWorkspace}
                      context={modelContext ?? context}
                      clientActivityEstimate={clientActivityEstimate}
                      onSetting={(key, value) =>
                        stageSettings({ [key]: value }, "Session calculations")
                      }
                    />
                  </div>
                </>
              )}
              {section === "marketing" && (
                <>
                  {heading(
                    "Marketing",
                    marketingTab === "campaigns"
                      ? "Ad spend drives lead estimates. Service costs complete the marketing total."
                      : "Monthly leads, consults, and new clients.",
                    marketingTab === "campaigns" ? (
                      <button
                        className="pw-button"
                        onClick={() => stageNew("campaigns")}
                      >
                        <Plus />
                        Add campaign
                      </button>
                    ) : undefined,
                  )}
                  <SharedPeriodControls
                    period={sharedPeriod}
                    custom={customPeriod}
                    onPeriod={setSharedPeriod}
                    onCustom={setCustomPeriod}
                    note="Reporting period carries to Growth and Rooms; contributor resets when leaving the tab."
                  />
                  {marketingTab === "campaigns" && (
                    <div
                      className="pw-marketing-breakdown"
                      aria-label="Estimated marketing costs"
                    >
                      <div>
                        <span>Ad spend / month</span>
                        <strong>{money(months[0]?.values.adSpend)}</strong>
                      </div>
                      <div>
                        <span>Services &amp; campaign costs</span>
                        <strong>
                          {money(
                            (months[0]?.values.marketing ?? 0) -
                              (months[0]?.values.adSpend ?? 0),
                          )}
                        </strong>
                      </div>
                      <div>
                        <span>Total marketing cost</span>
                        <strong>{money(months[0]?.values.marketing)}</strong>
                      </div>
                    </div>
                  )}
                  {marketingTab === "campaigns" && (
                    <p className="pw-note">
                      Count agency fees and retainers either inside a campaign
                      or as a marketing service cost, not both.
                    </p>
                  )}
                  <div
                    className="pw-segmented"
                    role="tablist"
                    aria-label="Marketing view"
                  >
                    {["results", "campaigns"].map((t) => (
                      <button
                        key={t}
                        role="tab"
                        aria-selected={marketingTab === t}
                        onClick={() => setMarketingTab(t)}
                      >
                        {t === "campaigns"
                          ? "Leads & campaigns"
                          : "Consultations"}
                      </button>
                    ))}
                    <button
                      role="tab"
                      aria-selected={false}
                      onClick={() => setSection("rooms")}
                    >
                      Rooms
                    </button>
                  </div>
                  {marketingTab === "campaigns" ? (
                    <div className="pw-edit-list">
                      {active(workingWorkspace.campaigns).map((c) => (
                        <section className="pw-edit-item" key={c.id}>
                          <div className="pw-edit-item-heading">
                            <h3>{displayName(c.name, "Untitled campaign")}</h3>
                            <span>
                              Estimated clients:{" "}
                              {fmt(months[0]?.channels[c.id]?.clients)}
                            </span>
                          </div>
                          <div className="pw-edit-grid">
                            <DraftField
                              label="Campaign name"
                              value={c.name}
                              onChange={(value) =>
                                stageRecord(
                                  "campaigns",
                                  c.id,
                                  { name: value },
                                  displayName(c.name, "Campaign") + " name",
                                )
                              }
                            />
                            <DraftField
                              label="Lead source"
                              value={c.source}
                              onChange={(value) =>
                                stageRecord(
                                  "campaigns",
                                  c.id,
                                  { source: value },
                                  displayName(c.name, "Campaign") + " source",
                                )
                              }
                            />
                            <label className="pw-draft-field">
                              <span>Estimate clients using</span>
                              <select
                                value={c.method ?? ""}
                                onChange={(event) =>
                                  stageRecord(
                                    "campaigns",
                                    c.id,
                                    { method: event.target.value || null },
                                    displayName(c.name, "Campaign") +
                                      " estimate method",
                                  )
                                }
                              >
                                <option value="">Choose method</option>
                                {[
                                  ["cpl", "Cost per lead"],
                                  ["cac", "Cost per client"],
                                  ["historical", "Past performance"],
                                  ["manual", "Manual estimate"],
                                  ["clicks", "Click funnel"],
                                  ["custom", "Custom formula"],
                                ].map(([value, label]) => (
                                  <option value={value} key={value}>
                                    {label}
                                  </option>
                                ))}
                              </select>
                            </label>
                            <DraftField
                              label="Monthly ad spend ($)"
                              type="number"
                              value={c.monthlySpend}
                              onChange={(value) =>
                                stageRecord(
                                  "campaigns",
                                  c.id,
                                  { monthlySpend: optionalNumber(value) },
                                  displayName(c.name, "Campaign") + " ad spend",
                                )
                              }
                            />
                            <DraftField
                              label="Other campaign costs ($/month)"
                              type="number"
                              value={c.otherMonthlyCost}
                              onChange={(value) =>
                                stageRecord(
                                  "campaigns",
                                  c.id,
                                  { otherMonthlyCost: optionalNumber(value) },
                                  displayName(c.name, "Campaign") +
                                    " support cost",
                                )
                              }
                            />
                            {c.method === "cpl" && (
                              <DraftField
                                label="Cost per lead ($)"
                                type="number"
                                value={c.cpl}
                                onChange={(value) =>
                                  stageRecord(
                                    "campaigns",
                                    c.id,
                                    { cpl: optionalNumber(value) },
                                    displayName(c.name, "Campaign") +
                                      " cost per lead",
                                  )
                                }
                              />
                            )}
                            {c.method === "cac" && (
                              <DraftField
                                label="Cost per client ($)"
                                type="number"
                                value={c.cac}
                                onChange={(value) =>
                                  stageRecord(
                                    "campaigns",
                                    c.id,
                                    { cac: optionalNumber(value) },
                                    displayName(c.name, "Campaign") +
                                      " cost per client",
                                  )
                                }
                              />
                            )}
                            <DraftField
                              label="Lead to consultation (%)"
                              type="number"
                              max={100}
                              value={c.consultationPct}
                              onChange={(value) =>
                                stageRecord(
                                  "campaigns",
                                  c.id,
                                  { consultationPct: optionalNumber(value) },
                                  displayName(c.name, "Campaign") +
                                    " consultation rate",
                                )
                              }
                            />
                            <DraftField
                              label="Consultation attendance (%)"
                              type="number"
                              max={100}
                              value={c.attendancePct}
                              onChange={(value) =>
                                stageRecord(
                                  "campaigns",
                                  c.id,
                                  { attendancePct: optionalNumber(value) },
                                  displayName(c.name, "Campaign") +
                                    " attendance rate",
                                )
                              }
                            />
                            <DraftField
                              label="Attended consultation to client (%)"
                              type="number"
                              max={100}
                              value={c.closePct}
                              onChange={(value) =>
                                stageRecord(
                                  "campaigns",
                                  c.id,
                                  { closePct: optionalNumber(value) },
                                  displayName(c.name, "Campaign") +
                                    " close rate",
                                )
                              }
                            />
                            <DraftField
                              label="Forecast from"
                              type="date"
                              value={c.start}
                              onChange={(value) =>
                                stageRecord(
                                  "campaigns",
                                  c.id,
                                  { start: value || null },
                                  displayName(c.name, "Campaign") +
                                    " start date",
                                )
                              }
                            />
                          </div>
                          <div className="pw-secondary-links">
                            <button
                              className="pw-text-button"
                              disabled={!!stagedWorkspace}
                              onClick={() => edit("campaigns", c)}
                            >
                              More campaign settings <ChevronRight />
                            </button>
                            <button
                              className="pw-text-button"
                              onClick={() =>
                                stageRecord(
                                  "campaigns",
                                  c.id,
                                  { archived: true },
                                  "Archived " + displayName(c.name, "campaign"),
                                )
                              }
                            >
                              Archive campaign
                            </button>
                          </div>
                        </section>
                      ))}
                      <div className="pw-edit-item">
                        <div className="pw-edit-item-heading">
                          <h3>Marketing services and retainers</h3>
                          <button
                            className="pw-button"
                            onClick={() => stageMarketingSupport()}
                          >
                            <Plus />
                            Add cost
                          </button>
                        </div>
                        <p>
                          Use this for agency fees or ongoing marketing services
                          not already included in a campaign above. General
                          practice technology belongs in Operating expenses.
                        </p>
                        {active(workingWorkspace.budgets)
                          .filter(
                            (b) =>
                              workingWorkspace.categories.find(
                                (category) => category.id === b.categoryId,
                              )?.kind === "marketing",
                          )
                          .map((b) => (
                            <div
                              className="pw-edit-grid pw-support-row"
                              key={b.id}
                            >
                              <DraftField
                                label="Cost name"
                                value={b.name}
                                onChange={(value) =>
                                  stageRecord(
                                    "budgets",
                                    b.id,
                                    { name: value },
                                    b.name + " name",
                                  )
                                }
                              />
                              <DraftField
                                label="Amount ($)"
                                type="number"
                                value={b.amount}
                                onChange={(value) =>
                                  stageRecord(
                                    "budgets",
                                    b.id,
                                    { amount: Number(value) },
                                    b.name + " amount",
                                  )
                                }
                              />
                              <label className="pw-draft-field">
                                <span>Frequency</span>
                                <select
                                  value={b.cadence}
                                  onChange={(event) =>
                                    stageRecord(
                                      "budgets",
                                      b.id,
                                      { cadence: event.target.value },
                                      b.name + " frequency",
                                    )
                                  }
                                >
                                  {[
                                    "monthly",
                                    "weekly",
                                    "biweekly",
                                    "annual",
                                    "once",
                                  ].map((cadence) => (
                                    <option key={cadence} value={cadence}>
                                      {cadence}
                                    </option>
                                  ))}
                                </select>
                              </label>
                              {b.cadence === "monthly" && (
                                <DraftField
                                  label="Billing day"
                                  type="number"
                                  min={1}
                                  max={31}
                                  step={1}
                                  value={b.billingDay}
                                  onChange={(value) =>
                                    stageRecord(
                                      "budgets",
                                      b.id,
                                      { billingDay: Number(value) },
                                      b.name + " billing day",
                                    )
                                  }
                                />
                              )}
                              <DraftField
                                label="Forecast from"
                                type="date"
                                value={b.start}
                                onChange={(value) =>
                                  stageRecord(
                                    "budgets",
                                    b.id,
                                    { start: value },
                                    b.name + " forecast date",
                                  )
                                }
                              />
                              <DraftField
                                label="First bill date (optional)"
                                type="date"
                                value={b.billingReferenceStart ?? ""}
                                onChange={(value) =>
                                  stageRecord(
                                    "budgets",
                                    b.id,
                                    { billingReferenceStart: value || null },
                                    b.name + " first bill date",
                                  )
                                }
                              />
                            </div>
                          ))}
                      </div>
                    </div>
                  ) : (
                    <>
                      <section className="pw-metric-panel">
                        <div className="pw-section-heading">
                          <div>
                            <h3>Consult → treatment conversion</h3>
                            <p>
                              Imported PHONE/consultation journeys · one
                              calendar-month follow-up window
                            </p>
                          </div>
                        </div>
                        <div
                          className="pw-contributor-tabs"
                          role="group"
                          aria-label="Consult contributor"
                        >
                          {contributorNames.map((name) => (
                            <button
                              key={name}
                              aria-pressed={selectedContributorName === name}
                              onClick={() => {
                                setSharedContributor(name);
                                setCompareWholePractice(false);
                              }}
                            >
                              {name}
                            </button>
                          ))}
                          {selectedContributorName !== "Whole Practice" && (
                            <button
                              aria-pressed={compareWholePractice}
                              onClick={() =>
                                setCompareWholePractice((value) => !value)
                              }
                            >
                              Compare with Whole Practice
                            </button>
                          )}
                        </div>
                        <div className="pw-metric-hero">
                          <strong>
                            {fmt(contributorConsult?.conversionRate, "percent")}
                          </strong>
                          <span>
                            {contributorConsult
                              ? `${fmt(contributorConsult.converted)} ${selectedContributorName === "Whole Practice" ? "treatment starts" : "confirmed closes"} of ${fmt(contributorConsult.evaluated)} evaluated; ${fmt(contributorConsult.candidateConversions)} treatment-start candidates; ${fmt(contributorConsult.pending)} pending`
                              : "No imported PHONE journeys for this contributor"}
                          </span>
                        </div>
                        <MetricTargetBar
                          value={contributorConsult?.conversionRate}
                          benchmark={
                            selectedContributorName === "Whole Practice"
                              ? null
                              : consultConversionSummary.practice.conversionRate
                          }
                          goal={null}
                          valueLabel="Observed"
                          max={100}
                        />
                        {contributorConsult && !consultConversionSummary.coverageVerified && <p className="pw-note">Observed conversions; report coverage is unverified. {fmt(contributorConsult.pending)} journeys remain pending.</p>}
                        {compareWholePractice && selectedContributorName !== "Whole Practice" && (
                          <div className="pw-comparison" aria-label="Whole Practice conversion comparison">
                            <strong>Whole Practice</strong>
                            <p>{fmt(consultConversionSummary.practice.conversionRate, "percent")} · {fmt(consultConversionSummary.practice.converted)} treatment starts / {fmt(consultConversionSummary.practice.evaluated)} mature or converted journeys; {fmt(consultConversionSummary.practice.pending)} pending</p>
                          </div>
                        )}
                        <div className="pw-number-grid pw-consult-audit">
                          <div>
                            <span>Needs attribution</span>
                            <strong>
                              {fmt(contributorConsult?.needsAttribution)}
                            </strong>
                            <small>
                              Missing manual closer confirmation or missed-owner
                              review.
                            </small>
                          </div>
                          <div>
                            <span>Internal referrals protected</span>
                            <strong>
                              {fmt(
                                contributorConsult?.internalReferralsProtected,
                              )}
                            </strong>
                            <small>
                              Referrers are not counted as misses when another
                              clinician closes.
                            </small>
                          </div>
                        </div>
                        <p className="pw-note">
                          Practice conversion is de-duplicated once per client.
                          A qualifying treatment start counts for practice
                          conversion, but clinician close rates use only manual
                          closer confirmations. The treatment-start clinician is
                          shown as a candidate until confirmed.
                          Non-converted clients stay pending until one calendar
                          month after consultation.
                        </p>
                        <details className="pw-consult-resolution">
                          <summary>
                            Review client attribution candidates
                            <ChevronDown />
                          </summary>
                          <div className="pw-consult-resolution-list">
                            {consultConversionSummary.journeys
                              .filter(
                                (journey) =>
                                  journey.status === "needs_attribution" ||
                                  journey.attributionSource !== "none",
                              )
                              .slice(0, 25)
                              .map((journey) => {
                                const candidate =
                                  journey.treatmentStartClinician ??
                                  (journey.consultClinicians.length === 1
                                    ? journey.consultClinicians[0]
                                    : null);
                                const reviewClinician = consultReviewClinicians[journey.clientId] ?? journey.creditedClinician ?? "";
                                return (
                                  <div
                                    className="pw-consult-resolution-row"
                                    key={`${journey.clientId}:${journey.consultDate}`}
                                  >
                                    <div>
                                      <strong>{journey.clientId}</strong>
                                      <span>
                                        Consult {journey.consultDate}
                                        {journey.treatmentDate
                                          ? ` · treatment start ${journey.treatmentDate}`
                                          : ""}
                                      </span>
                                      <small>
                                        {journey.attributionIssue ??
                                          (journey.attributionSource ===
                                          "manual_confirmed_closer"
                                            ? "Manually confirmed closer."
                                            : journey.attributionSource ===
                                                "manual_missed_owner"
                                              ? "Manually confirmed missed-consult owner."
                                              : "No review needed.")}
                                      </small>
                                    </div>
                                    <div>
                                      <span>
                                        Candidate: {candidate ?? "needs review"}
                                      </span>
                                      <span>
                                        Consult clinician
                                        {journey.consultClinicians.length === 1
                                          ? `: ${journey.consultClinicians[0]}`
                                          : `s: ${journey.consultClinicians.join(", ") || "--"}`}
                                      </span>
                                    </div>
                                    <div className="pw-consult-resolution-actions">
                                      <label className="pw-draft-field">
                                        <span>Confirmed owner</span>
                                        <select
                                          aria-label={`Confirmed owner for ${journey.clientId}`}
                                          value={reviewClinician}
                                          onChange={(event) => setConsultReviewClinicians((prior) => ({ ...prior, [journey.clientId]: event.target.value }))}
                                        >
                                          <option value="">Select clinician</option>
                                          {[...new Set([...(modelContext ?? context).clinicians.map((person) => person.label), ...journey.consultClinicians, ...(candidate ? [candidate] : []), ...(journey.creditedClinician ? [journey.creditedClinician] : [])])].sort().map((name) => <option key={name} value={name}>{name}</option>)}
                                        </select>
                                      </label>
                                      <button
                                        className="pw-text-button"
                                        disabled={!journey.treatmentDate || !reviewClinician}
                                        onClick={() =>
                                          stageConsultAttributionOverride(
                                            journey.clientId,
                                            "confirmed_closer",
                                            reviewClinician,
                                          )
                                        }
                                      >
                                        Confirm closer
                                      </button>
                                      <button
                                        className="pw-text-button"
                                        disabled={
                                          !!journey.treatmentDate || journey.status === "pending" || !reviewClinician
                                        }
                                        onClick={() =>
                                          stageConsultAttributionOverride(
                                            journey.clientId,
                                            "missed_owner",
                                            reviewClinician,
                                          )
                                        }
                                      >
                                        Assign missed
                                      </button>
                                      <button
                                        className="pw-text-button"
                                        onClick={() =>
                                          stageConsultAttributionOverride(
                                            journey.clientId,
                                            "needs_review",
                                            null,
                                          )
                                        }
                                      >
                                        Mark review
                                      </button>
                                    </div>
                                  </div>
                                );
                              })}
                            {!consultConversionSummary.journeys.length && (
                              <p className="pw-note">
                                Import PHONE consultation rows to review
                                attribution candidates.
                              </p>
                            )}
                          </div>
                        </details>
                      </section>
                      <LeadFlow
                        workspace={workingWorkspace}
                        context={context}
                        readOnly={sandbox}
                        pending={!!stagedWorkspace}
                        canSave={
                          !!stagedValidation?.success &&
                          !!stagedDifferences.length &&
                          !saving
                        }
                        onSaveEntry={saveLeadEntry}
                        onSaveBulk={saveBulkLeadEntries}
                        onCompleteMonth={completeLeadMonth}
                        onPatch={stageFunnelPatch}
                        onRemove={stageFunnelRemove}
                        onSave={() => void commitStaged()}
                        onOpenPeriods={() => setDetail("periods")}
                        onEditDetails={(row) => edit("funnels", row)}
                        onAddCorrection={(periodId) =>
                          edit("funnels", {
                            ...newRecord("funnels", workspace, today),
                            periodId,
                          })
                        }
                      />
                    </>
                  )}
                  {marketingTab === "campaigns" &&
                    !active(workspace.campaigns).length && (
                      <div className="pw-empty">
                        <ChartNoAxesCombined />
                        <h3>No lead sources set up yet</h3>
                        <p>
                          Add Google Ads, Meta, referrals, or another source to
                          estimate leads and record results in one place.
                        </p>
                      </div>
                    )}
                </>
              )}
              {section === "rooms" && (
                <>
                  {heading(
                    "Rooms",
                    "Who can use each room, and when",
                    <button
                      className="pw-button"
                      onClick={() => stageNew("rooms")}
                    >
                      <Plus />
                      Add room
                    </button>,
                  )}
                  <SharedPeriodControls
                    period={sharedPeriod}
                    custom={customPeriod}
                    onPeriod={setSharedPeriod}
                    onCustom={setCustomPeriod}
                    note="Recorded in-person demand uses completed records within the reporting period."
                  />
                  <section className="pw-metric-panel">
                    <div className="pw-section-heading">
                      <div>
                        <h3>Room capacity vs demand</h3>
                        <p>
                          Capacity comes from real room setup, recurring blocks,
                          and usable percentage. Imported location-only rooms
                          stay review-only until configured.
                        </p>
                      </div>
                    </div>
                    <div className="pw-consult-audit">
                      <div>
                        <span>Configured weekly room slots</span>
                        <strong>{fmt(roomCapacitySlots)}</strong>
                        <small>{fmt(roomAssignedHoursTotal)} assigned/open hours</small>
                      </div>
                      <div>
                        <span>Recorded in-person demand</span>
                        <strong>{fmt(roomDemandWeekly)} / week</strong>
                        <small>{sharedPeriodLabel(sharedPeriod)} · missing modality or team coverage shows --</small>
                      </div>
                      <div>
                        <span>Utilization</span>
                        <strong>{fmt(roomUtilizationPct, "percent")}</strong>
                        <small>Red marker is physical room limit</small>
                      </div>
                    </div>
                    <MetricTargetBar
                      value={roomDemandWeekly}
                      goal={desiredWeeklyTotal}
                      benchmark={viewProjection?.projectedWeekly}
                      limit={roomCapacitySlots || null}
                    />
                  </section>
                  <div className="pw-edit-list">
                    {active(workingWorkspace.rooms).map((room) => (
                      <section className="pw-edit-item" key={room.id}>
                        <div className="pw-edit-item-heading">
                          <h3>{room.name}</h3>
                          <span>
                            {fmt(
                              (((roomHours(room) * 60) / room.sessionMinutes) *
                                room.usablePct) /
                                100,
                            )}{" "}
                            potential slots / week ·{" "}
                            {room.usage === "dedicated"
                              ? "reserved"
                              : fmt(
                                  Math.max(
                                    0,
                                    roomHours(room) - assignedRoomHours(room),
                                  ),
                                ) + " unassigned hours"}
                          </span>
                        </div>
                        <div className="pw-edit-grid">
                          <DraftField
                            label="Room name"
                            value={room.name}
                            onChange={(value) =>
                              stageRecord(
                                "rooms",
                                room.id,
                                { name: value },
                                room.name + " name",
                              )
                            }
                          />
                          <label className="pw-draft-field">
                            <span>Location</span>
                            <select
                              value={room.locationId ?? ""}
                              onChange={(event) =>
                                stageRecord(
                                  "rooms",
                                  room.id,
                                  { locationId: event.target.value || null },
                                  room.name + " location",
                                )
                              }
                            >
                              <option value="">No location</option>
                              {active(workingWorkspace.locations).map(
                                (location) => (
                                  <option value={location.id} key={location.id}>
                                    {location.name}
                                  </option>
                                ),
                              )}
                            </select>
                          </label>
                          <label className="pw-draft-field">
                            <span>Room use</span>
                            <select
                              value={room.usage}
                              onChange={(event) =>
                                stageRecord(
                                  "rooms",
                                  room.id,
                                  {
                                    usage: event.target.value,
                                    dedicatedClinicianId:
                                      event.target.value === "dedicated"
                                        ? (room.dedicatedClinicianId ??
                                          selectedPeople[0]?.id ??
                                          null)
                                        : null,
                                  },
                                  room.name + " room use",
                                )
                              }
                            >
                              <option value="shared">Shared / rotating</option>
                              <option value="dedicated">Dedicated</option>
                            </select>
                          </label>
                          {room.usage === "dedicated" && (
                            <label className="pw-draft-field">
                              <span>Reserved for</span>
                              <select
                                value={room.dedicatedClinicianId ?? ""}
                                onChange={(event) =>
                                  stageRecord(
                                    "rooms",
                                    room.id,
                                    {
                                      dedicatedClinicianId: Number(
                                        event.target.value,
                                      ),
                                    },
                                    room.name + " reserved clinician",
                                  )
                                }
                              >
                                <option value="">Select clinician</option>
                                {selectedPeople.map((person) => (
                                  <option key={person.id} value={person.id}>
                                    {person.label}
                                  </option>
                                ))}
                              </select>
                            </label>
                          )}
                          <DraftField
                            label="Available room hours / week"
                            type="number"
                            min={0}
                            max={168}
                            value={room.weeklyHours}
                            onChange={(value) =>
                              stageRecord(
                                "rooms",
                                room.id,
                                { weeklyHours: Number(value) },
                                room.name + " weekly hours",
                              )
                            }
                          />
                          <DraftField
                            label="Session minutes"
                            type="number"
                            min={15}
                            max={240}
                            value={room.sessionMinutes}
                            onChange={(value) =>
                              stageRecord(
                                "rooms",
                                room.id,
                                { sessionMinutes: Number(value) },
                                room.name + " session length",
                              )
                            }
                          />
                          <DraftField
                            label="Usable capacity (%)"
                            type="number"
                            min={0}
                            max={100}
                            value={room.usablePct}
                            onChange={(value) =>
                              stageRecord(
                                "rooms",
                                room.id,
                                { usablePct: Number(value) },
                                room.name + " usable capacity",
                              )
                            }
                          />
                          <label className="pw-draft-check">
                            <input
                              type="checkbox"
                              checked={room.telehealthUsesRoom}
                              onChange={(event) =>
                                stageRecord(
                                  "rooms",
                                  room.id,
                                  { telehealthUsesRoom: event.target.checked },
                                  room.name + " telehealth use",
                                )
                              }
                            />
                            Telehealth uses this room
                          </label>
                        </div>
                        <WeeklyBlocks
                          label="Room opening hours"
                          blocks={room.blocks}
                          onChange={(blocks) =>
                            stageRecord(
                              "rooms",
                              room.id,
                              { blocks },
                              room.name + " opening hours",
                            )
                          }
                        />
                        {room.usage === "shared" && (
                          <>
                            <WeeklyBlocks
                              label="Recurring clinician blocks"
                              blocks={room.assignments}
                              people={selectedPeople}
                              onChange={(assignments) =>
                                stageRecord(
                                  "rooms",
                                  room.id,
                                  { assignments },
                                  room.name + " weekly assignments",
                                )
                              }
                            />
                            <div className="pw-weekly-title">
                              <strong>Week exceptions</strong>
                              <button
                                className="pw-text-button"
                                onClick={() => {
                                  const date = new Date(today + "T12:00:00Z");
                                  date.setUTCDate(
                                    date.getUTCDate() -
                                      ((date.getUTCDay() + 6) % 7),
                                  );
                                  stageRecord(
                                    "rooms",
                                    room.id,
                                    {
                                      skippedWeeks: [
                                        ...room.skippedWeeks,
                                        {
                                          weekStart: date
                                            .toISOString()
                                            .slice(0, 10),
                                          clinicianId:
                                            selectedPeople[0]?.id ?? 0,
                                        },
                                      ],
                                    },
                                    room.name + " week exception",
                                  );
                                }}
                                disabled={!selectedPeople.length}
                              >
                                <Plus />
                                Skip a recurring week
                              </button>
                            </div>
                            {room.skippedWeeks.map((exception, index) => (
                              <div
                                className="pw-weekly-row pw-weekly-exception"
                                key={index}
                              >
                                <DraftField
                                  label="Skip from date (7 days)"
                                  type="date"
                                  value={exception.weekStart}
                                  onChange={(value) =>
                                    stageRecord(
                                      "rooms",
                                      room.id,
                                      {
                                        skippedWeeks: room.skippedWeeks.map(
                                          (entry, i) =>
                                            i === index
                                              ? { ...entry, weekStart: value }
                                              : entry,
                                        ),
                                      },
                                      room.name + " week exception",
                                    )
                                  }
                                />
                                <label>
                                  <span>Clinician</span>
                                  <select
                                    value={exception.clinicianId}
                                    onChange={(event) =>
                                      stageRecord(
                                        "rooms",
                                        room.id,
                                        {
                                          skippedWeeks: room.skippedWeeks.map(
                                            (entry, i) =>
                                              i === index
                                                ? {
                                                    ...entry,
                                                    clinicianId: Number(
                                                      event.target.value,
                                                    ),
                                                  }
                                                : entry,
                                          ),
                                        },
                                        room.name + " week exception",
                                      )
                                    }
                                  >
                                    {selectedPeople.map((person) => (
                                      <option key={person.id} value={person.id}>
                                        {person.label}
                                      </option>
                                    ))}
                                  </select>
                                </label>
                                <button
                                  className="pw-icon"
                                  title="Remove exception"
                                  aria-label="Remove exception"
                                  onClick={() =>
                                    stageRecord(
                                      "rooms",
                                      room.id,
                                      {
                                        skippedWeeks: room.skippedWeeks.filter(
                                          (_, i) => i !== index,
                                        ),
                                      },
                                      room.name + " week exception",
                                    )
                                  }
                                >
                                  <X />
                                </button>
                              </div>
                            ))}
                          </>
                        )}
                        <div className="pw-secondary-links">
                          <button
                            className="pw-text-button"
                            disabled={!!stagedWorkspace}
                            onClick={() => edit("rooms", room)}
                          >
                            More room settings <ChevronRight />
                          </button>
                          <button
                            className="pw-text-button"
                            onClick={() =>
                              stageRecord(
                                "rooms",
                                room.id,
                                { archived: true },
                                "Archived " + room.name,
                              )
                            }
                          >
                            Archive room
                          </button>
                        </div>
                      </section>
                    ))}
                  </div>
                  {!active(workingWorkspace.rooms).length && (
                    <p className="pw-empty">No rooms yet.</p>
                  )}
                  <div className="pw-edit-item">
                    <div className="pw-edit-item-heading">
                      <h3>Clinician availability</h3>
                      <span>
                        Compare time available with desired and recently
                        completed sessions
                      </span>
                    </div>
                    {selectedPeople.map((person) => {
                      const profile = workingWorkspace.clinicians.find(
                        (row) => row.clinicianId === person.id,
                      );
                      const pace = viewProjection?.clinicianPace.find(
                        (row) => row.id === person.id,
                      );
                      return (
                        <div className="pw-clinician-hours" key={person.id}>
                          <div className="pw-edit-item-heading">
                            <strong>{person.label}</strong>
                            <span>
                              {fmt(
                                profile?.desiredWeeklySessions ??
                                  person.sessionsPerWeek,
                              )}{" "}
                              desired /{" "}
                              {pace?.recordedWeekly == null
                                ? "no recent sessions"
                                : fmt(pace.recordedWeekly) +
                                  " recent sessions"}{" "}
                              per week
                            </span>
                          </div>
                          <WeeklyBlocks
                            label={person.label + " recurring availability"}
                            blocks={profile?.availability ?? []}
                            onChange={(blocks) =>
                              stageClinicianAvailability(person, blocks)
                            }
                          />
                        </div>
                      );
                    })}
                  </div>
                  <div className="pw-secondary-links">
                    {detailButton("locations", "Locations")}
                  </div>
                </>
              )}
              {section === "budgets" && (
                <>
                  {heading(
                    "Operating expenses",
                    "Recurring costs that keep the practice running. Marketing costs live in Marketing.",
                    <button
                      className="pw-button"
                      onClick={() => stageNew("budgets")}
                    >
                      <Plus />
                      Add expense
                    </button>,
                  )}
                  <p className="pw-budget-date-note">
                    Forecast from affects the estimate. Billing dates are only
                    for your reference; monthly bills default to the 5th.
                  </p>
                  {resolved?.goal && resolved.goal.annualOverheadGoal > 0 && (
                    <div className="pw-budget-basis">
                      <div>
                        <strong>Overhead basis</strong>
                        <p>
                          The compensation plan estimates{" "}
                          {money(resolved.goal.annualOverheadGoal / 12)} per
                          month. Entered expenses fill that allowance until you
                          confirm the list is complete.
                        </p>
                      </div>
                      <div
                        className="pw-view-switch"
                        role="group"
                        aria-label="Overhead basis"
                      >
                        <button
                          type="button"
                          aria-pressed={
                            workingWorkspace.settings.overheadMode ===
                            "baseline"
                          }
                          onClick={() =>
                            stageSettings(
                              { overheadMode: "baseline" },
                              "Overhead uses compensation estimate",
                            )
                          }
                        >
                          Keep estimate
                        </button>
                        <button
                          type="button"
                          aria-pressed={
                            workingWorkspace.settings.overheadMode ===
                            "detailed"
                          }
                          onClick={() =>
                            stageSettings(
                              { overheadMode: "detailed" },
                              "Overhead uses entered expenses only",
                            )
                          }
                        >
                          Expenses complete
                        </button>
                      </div>
                    </div>
                  )}
                  {workingWorkspace.settings.overheadMode === "detailed" &&
                    !active(workingWorkspace.budgets).some((budget) =>
                      ["expense", "facility"].includes(
                        workingWorkspace.categories.find(
                          (category) => category.id === budget.categoryId,
                        )?.kind ?? "",
                      ),
                    ) && (
                      <p className="pw-money-warning">
                        No operating expenses are entered. Switching to detailed
                        expenses will forecast zero recurring overhead.
                      </p>
                    )}
                  <div className="pw-table-scroll">
                    <table className="pw-table pw-edit-table">
                      <thead>
                        <tr>
                          <th>Expense</th>
                          <th>Category</th>
                          <th>Amount / rate</th>
                          <th>Frequency</th>
                          <th>Forecast from</th>
                          <th>Billing day</th>
                          <th>First bill date</th>
                          <th />
                        </tr>
                      </thead>
                      <tbody>
                        {active(workingWorkspace.budgets)
                          .filter((b) =>
                            ["expense", "facility"].includes(
                              workingWorkspace.categories.find(
                                (c) => c.id === b.categoryId,
                              )?.kind ?? "",
                            ),
                          )
                          .map((b) => (
                            <tr key={b.id}>
                              <th>
                                <DraftField
                                  label={b.name + " expense name"}
                                  value={b.name}
                                  onChange={(value) =>
                                    stageRecord(
                                      "budgets",
                                      b.id,
                                      { name: value },
                                      b.name + " name",
                                    )
                                  }
                                />
                              </th>
                              <td>
                                <label className="pw-draft-field">
                                  <span>{b.name} category</span>
                                  <select
                                    value={b.categoryId}
                                    onChange={(event) =>
                                      stageRecord(
                                        "budgets",
                                        b.id,
                                        { categoryId: event.target.value },
                                        b.name + " category",
                                      )
                                    }
                                  >
                                    {active(workingWorkspace.categories)
                                      .filter(
                                        (c) =>
                                          c.kind === "expense" ||
                                          c.kind === "facility",
                                      )
                                      .map((c) => (
                                        <option key={c.id} value={c.id}>
                                          {c.name}
                                        </option>
                                      ))}
                                  </select>
                                </label>
                              </td>
                              <td>
                                <DraftField
                                  label={
                                    b.name +
                                    (b.cadence === "percent_revenue"
                                      ? " percent of revenue"
                                      : b.cadence === "per_session"
                                        ? " cost per session ($)"
                                        : " amount ($)")
                                  }
                                  type="number"
                                  min={0}
                                  value={b.amount}
                                  onChange={(value) =>
                                    stageRecord(
                                      "budgets",
                                      b.id,
                                      { amount: Number(value) },
                                      b.name + " amount",
                                    )
                                  }
                                />
                              </td>
                              <td>
                                <label className="pw-draft-field">
                                  <span>{b.name} frequency</span>
                                  <select
                                    value={b.cadence}
                                    onChange={(event) =>
                                      stageRecord(
                                        "budgets",
                                        b.id,
                                        { cadence: event.target.value },
                                        b.name + " frequency",
                                      )
                                    }
                                  >
                                    {[
                                      "monthly",
                                      "weekly",
                                      "biweekly",
                                      "annual",
                                      "once",
                                      "per_session",
                                      "percent_revenue",
                                    ].map((cadence) => (
                                      <option key={cadence} value={cadence}>
                                        {cadence.replaceAll("_", " ")}
                                      </option>
                                    ))}
                                  </select>
                                </label>
                              </td>
                              <td>
                                <DraftField
                                  label={b.name + " effective date"}
                                  type="date"
                                  value={b.start}
                                  onChange={(value) =>
                                    stageRecord(
                                      "budgets",
                                      b.id,
                                      { start: value },
                                      b.name + " forecast date",
                                    )
                                  }
                                />
                              </td>
                              <td>
                                {b.cadence === "monthly" ? (
                                  <DraftField
                                    label={b.name + " billing day"}
                                    type="number"
                                    min={1}
                                    max={31}
                                    value={b.billingDay}
                                    onChange={(value) =>
                                      stageRecord(
                                        "budgets",
                                        b.id,
                                        { billingDay: Number(value) },
                                        b.name + " billing day",
                                      )
                                    }
                                  />
                                ) : (
                                  <span className="pw-muted">
                                    Use first bill date
                                  </span>
                                )}
                              </td>
                              <td>
                                <DraftField
                                  label={b.name + " first bill date"}
                                  type="date"
                                  value={b.billingReferenceStart ?? ""}
                                  onChange={(value) =>
                                    stageRecord(
                                      "budgets",
                                      b.id,
                                      { billingReferenceStart: value || null },
                                      b.name + " first bill date",
                                    )
                                  }
                                />
                              </td>
                              <td>
                                <EditButton
                                  label={"Edit " + b.name}
                                  onClick={() => edit("budgets", b)}
                                />
                              </td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </div>
                  {!active(workingWorkspace.budgets).some((b) =>
                    ["expense", "facility"].includes(
                      workingWorkspace.categories.find(
                        (c) => c.id === b.categoryId,
                      )?.kind ?? "",
                    ),
                  ) && (
                    <div className="pw-empty">
                      <h3>No operating expenses yet</h3>
                      <p>
                        Add recurring expenses individually or import a budget
                        to build the overhead total.
                      </p>
                    </div>
                  )}
                  {active(workingWorkspace.budgets).some(
                    (b) =>
                      !["expense", "facility", "marketing"].includes(
                        workingWorkspace.categories.find(
                          (c) => c.id === b.categoryId,
                        )?.kind ?? "",
                      ),
                  ) && (
                    <section className="pw-edit-item">
                      <div className="pw-edit-item-heading">
                        <h3>Other plan lines</h3>
                        <span>Income, owner pay, taxes, and reserves</span>
                      </div>
                      {active(workingWorkspace.budgets)
                        .filter(
                          (b) =>
                            !["expense", "facility", "marketing"].includes(
                              workingWorkspace.categories.find(
                                (c) => c.id === b.categoryId,
                              )?.kind ?? "",
                            ),
                        )
                        .map((b) => (
                          <div className="pw-money-source-row" key={b.id}>
                            <div>
                              <strong>{b.name}</strong>
                              <span>
                                {workingWorkspace.categories.find(
                                  (c) => c.id === b.categoryId,
                                )?.name ?? "Uncategorized"}{" "}
                                · {b.cadence}
                              </span>
                            </div>
                            <DraftField
                              label={b.name + " amount"}
                              type="number"
                              value={b.amount}
                              onChange={(value) =>
                                stageRecord(
                                  "budgets",
                                  b.id,
                                  { amount: Number(value) },
                                  b.name + " amount",
                                )
                              }
                            />
                            <EditButton
                              label={"Edit " + b.name}
                              onClick={() => edit("budgets", b)}
                            />
                          </div>
                        ))}
                    </section>
                  )}
                  <div className="pw-secondary-links">
                    {detailButton("categories", "Categories")}
                    {!sandbox && practiceView === "plan" && (
                      <>
                        {detailButton("transactions", "Recorded expenses")}
                        <button
                          className="pw-text-button"
                          onClick={() => setSection("retention")}
                        >
                          Import a budget
                          <ChevronRight />
                        </button>
                      </>
                    )}
                  </div>
                  {mode === "practice" && practiceView === "actual" && (
                    <section
                      className="pw-projection-table"
                      aria-label="Recorded expenses"
                    >
                      {heading(
                        "Recorded expenses",
                        "Expenses you have entered for completed periods",
                        add("transactions", "Record expense"),
                      )}
                      <div className="pw-table-scroll">
                        <table className="pw-table">
                          <thead>
                            <tr>
                              <th>Date</th>
                              <th>Expense</th>
                              <th>Category</th>
                              <th>Amount</th>
                              <th />
                            </tr>
                          </thead>
                          <tbody>
                            {recordedExpenses.slice(0, 8).map((transaction) => (
                              <tr key={transaction.id}>
                                <th>{transaction.date}</th>
                                <td>{transaction.description}</td>
                                <td>
                                  {workspace.categories.find(
                                    (category) =>
                                      category.id === transaction.categoryId,
                                  )?.name ?? "Uncategorized"}
                                </td>
                                <td>{money(transaction.amount)}</td>
                                <td>
                                  <EditButton
                                    label={"Edit " + transaction.description}
                                    onClick={() =>
                                      edit("transactions", transaction)
                                    }
                                  />
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      {!recordedExpenses.length && (
                        <p className="pw-notice">No expenses recorded yet.</p>
                      )}
                      {recordedExpenses.length > 8 &&
                        detailButton("transactions", "All recorded expenses")}
                    </section>
                  )}
                </>
              )}
              {section === "money" && mode === "practice" && (
                <>
                  <SharedPeriodControls
                    period={sharedPeriod}
                    custom={customPeriod}
                    onPeriod={setSharedPeriod}
                    onCustom={setCustomPeriod}
                    note="Money keeps recorded values, projections, and model goals distinct."
                  />
                  <section className="pw-money-bridge-panel">
                    <div className="pw-section-heading">
                      <div>
                        <h3>Money bridge</h3>
                        <p>
                          {monthLabel(moneyMonth?.date ?? today)} projection
                          from billed revenue to operating profit.
                        </p>
                      </div>
                    </div>
                    <div className="pw-money-bridge">
                      {[
                        ["Billed revenue", moneyValues.revenue ?? null, "in"],
                        ...(moneyBridge.adjustments !== null && Math.abs(moneyBridge.adjustments) > 0.005
                          ? [["Other income / adjustments", moneyBridge.adjustments, "in"]]
                          : []),
                        [
                          "Clinician pay",
                          moneyValues.clinicianPay == null
                            ? null
                            : -moneyValues.clinicianPay,
                          "out",
                        ],
                        [
                          "Other practice costs",
                          moneyBridge.otherCosts === null ? null : -moneyBridge.otherCosts,
                          "out",
                        ],
                        ["Operating profit", moneyValues.profit ?? null, "profit"],
                      ].map(([label, value, kind]) => (
                        <div className={`pw-bridge-step pw-bridge-${kind}`} key={label}>
                          <strong>{money(value as number | null)}</strong>
                          <span>{label}</span>
                        </div>
                      ))}
                    </div>
                    <details aria-label="Money bridge cost breakdown">
                      <summary>Cost breakdown</summary>
                      {moneyBridge.components.map((component) => <div className="pw-overview-total" key={component.label}><span>{component.label}</span><strong>{money(component.value)}</strong></div>)}
                      <div className="pw-overview-total"><span>Other income / reconciliation adjustment</span><strong>{money(moneyBridge.adjustments)}</strong></div>
                      <p className="pw-note">Costs use this projection's period and revenue basis. The adjustment reconciles billed revenue and disclosed costs to the engine's operating profit; it is not assigned to an unverified cost category. Taxes, reserves and distributions are allocations after operating profit.</p>
                    </details>
                    <MetricTargetBar
                      value={moneyValues.profit}
                      valueLabel="Projected"
                      goal={workingWorkspace.settings.targetProfitMonthly}
                      benchmark={recordedFinancialPeriods[0]?.values.profit}
                    />
                    <p className="pw-note">
                      Billed fees are revenue basis, not cash collected.
                      Current-month values remain labelled projections until
                      the reporting period is completed.
                    </p>
                  </section>
                  <section className="pw-money-bridge-panel">
                    <div className="pw-section-heading">
                      <div>
                        <h3>Recorded overhead average</h3>
                        <p>
                          Completed-period overhead compared with the current
                          fixed-dollar setting.
                        </p>
                      </div>
                    </div>
                    <div className="pw-overhead-chart">
                      {overheadTrendRows.map((row) => (
                        <div className="pw-overhead-bar" key={row.date}>
                          <span>{row.date}</span>
                          <div>
                            <i
                              style={{
                                width: `${Math.min(100, (row.overhead / overheadTrendMax) * 100)}%`,
                              }}
                            />
                          </div>
                          <strong>{money(row.overhead)}</strong>
                        </div>
                      ))}
                      {!overheadTrendRows.length && (
                        <p className="pw-note">
                          No finalized overhead periods yet.
                        </p>
                      )}
                      {overheadSummary.months.some((month) => month.status === "unknown") && (
                        <p className="pw-note">Monthly average unavailable: {overheadSummary.months.filter((month) => month.status === "unknown").map((month) => `${monthLabel(month.date)} (${month.reasons.join(", ")})`).join("; ")}. Completed monthly totals require dated expenses and full coverage.</p>
                      )}
                      {currentOverheadProjection && currentOverheadProjection.values.overhead != null && (
                        <div className="pw-overhead-bar pw-overhead-projection">
                          <span>{monthLabel(currentOverheadProjection.date)} projection</span>
                          <div><i style={{ width: `${Math.min(100, (currentOverheadProjection.values.overhead / Math.max(overheadTrendMax, currentOverheadProjection.values.overhead)) * 100)}%` }} /></div>
                          <strong>{money(currentOverheadProjection.values.overhead)}</strong>
                        </div>
                      )}
                    </div>
                    <MetricTargetBar
                      value={recordedOverheadAverage}
                      goal={workingWorkspace.settings.overheadFloorMonthly}
                      benchmark={recordedOverheadValues[0] ?? null}
                      lowerIsBetter
                    />
                  </section>
                  <section className="pw-money-bridge-panel">
                    <div className="pw-section-heading">
                      <div>
                        <h3>Dated fund goals</h3>
                        <p>
                          Current balances are recorded separately from monthly
                          projected contributions. Blank balances count as $0.
                        </p>
                      </div>
                      <button
                        className="pw-text-button"
                        onClick={() => setSection("current-goals")}
                      >
                        Edit fund goals
                        <ChevronRight />
                      </button>
                    </div>
                    <div className="pw-fund-chart">
                      {fundChartRows.map((row) => (
                        <div className="pw-fund-chart-row" key={row.name}>
                          <div>
                            <strong>{row.name}</strong>
                            <span>
                              {money(row.current)} recorded anchor · {row.date}
                            </span>
                          </div>
                          <div className="pw-dated-fund-chart" aria-label={`${row.name} dated balance trajectory`}>
                            {row.trajectory.length ? (
                              <ResponsiveContainer width="100%" height="100%">
                                <LineChart data={row.trajectory} margin={{ top: 12, right: 20, bottom: 8, left: 8 }}>
                                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                                  <XAxis dataKey="date" type="number" domain={["dataMin", "dataMax"]} tickFormatter={(value: number) => monthLabel(new Date(value).toISOString().slice(0, 10))} minTickGap={50} />
                                  <YAxis tickFormatter={(value: number) => money(value)} width={75} />
                                  <Tooltip labelFormatter={(value) => new Date(Number(value)).toISOString().slice(0, 10)} formatter={(value: number, name: string) => [money(value), name]} />
                                  {row.target > 0 && <ReferenceLine y={row.target} stroke="#27824b" strokeDasharray="5 4" label={{ value: "Goal", position: "insideTopLeft" }} />}
                                  <Line dataKey="projected" name="Projected balance" stroke="#287f98" strokeDasharray="3 5" dot={false} isAnimationActive={false} />
                                  <Line dataKey="actual" name="Recorded balance" stroke="#24663c" strokeWidth={3} dot={{ r: 5 }} isAnimationActive={false} connectNulls={false} />
                                </LineChart>
                              </ResponsiveContainer>
                            ) : <p className="pw-note">Enter a dated balance to establish the trajectory.</p>}
                          </div>
                          <span>
                            {money(row.target)} goal
                            {row.projectedEta
                              ? ` · dotted projection reaches ${monthLabel(row.projectedEta)}`
                              : row.projectedContribution === null
                                ? " · no projected contribution"
                                : ""}
                          </span>
                          <details><summary>Projection assumptions</summary>{row.assumptions.map((assumption) => <p className="pw-note" key={assumption}>{assumption}</p>)}</details>
                        </div>
                      ))}
                    </div>
                  </section>
                  <MoneyFlowToday
                    workspace={
                      stagedWorkspace && !stagedValidation?.success
                        ? workingWorkspace
                        : (moneyFlowWorkspace ?? workingWorkspace)
                    }
                    context={modelContext ?? context}
                    today={today}
                    onPayeeChange={(id) =>
                      stageSettings(
                        {
                          familyW2ClinicianId: id,
                          ...(id !== null
                            ? {
                                ownerPayrollOverride: true,
                                ...(resolved?.inherited.ownerPay
                                  ? { ownerPayrollMonthly: 0 }
                                  : {}),
                              }
                            : {}),
                        },
                        "Family W2 pay",
                      )
                    }
                    onAllocationPercent={(id, percent) =>
                      stageRecord(
                        "allocations",
                        id,
                        { percent },
                        "Fund allocation",
                      )
                    }
                    onDefaultAllocationPercent={(key, percent) =>
                      stageSettings({ [key]: percent }, "Fund allocation")
                    }
                    onAddFund={stageFund}
                    onFundPatch={(id, patch) =>
                      stageRecord("allocations", id, patch, "Fund details")
                    }
                    onFundRemove={(id) =>
                      stageRecord(
                        "allocations",
                        id,
                        { archived: true },
                        "Removed fund",
                      )
                    }
                    onSettingNumber={(key, value) =>
                      stageSettings(
                        {
                          [key]: value,
                          ...(key === "ownerPayrollMonthly"
                            ? { ownerPayrollOverride: true }
                            : {}),
                          ...(key === "overheadFloorMonthly"
                            ? { overheadFloorOverride: true }
                            : {}),
                        },
                        "Money flow settings",
                      )
                    }
                    onOverheadMode={(overheadMode) =>
                      stageSettings({ overheadMode }, "Overhead basis")
                    }
                    onAverageRate={(person, rate, start) =>
                      stageClinicianModel(
                        person,
                        { expectedSessionRevenue: rate },
                        start,
                      )
                    }
                    onClinicianModel={stageClinicianModel}
                    onPersonPatch={patchPerson}
                    onStaffPatch={patchStaff}
                    onBudgetPatch={(id, patch) =>
                      stageRecord("budgets", id, patch, "Expense details")
                    }
                    onAddExpense={(start) => stageNew("budgets", start)}
                    onAddMarketingCost={stageMarketingSupport}
                    onCampaignPatch={(id, patch) =>
                      stageRecord("campaigns", id, patch, "Campaign costs")
                    }
                    onAddCampaign={(start) => stageNew("campaigns", start)}
                    onNavigate={(target) => setSection(target)}
                  />
                </>
              )}
              {section === "money" && mode !== "practice" && (
                <>
                  {heading(
                    "Money flow",
                    "Modeled monthly income, costs, and family pay",
                    <div className="pw-money-period">
                      <label>
                        Forecast month
                        <select
                          aria-label="Money flow month"
                          value={Math.min(moneyMonthIndex, months.length - 1)}
                          onChange={(event) =>
                            setMoneyMonthIndex(Number(event.target.value))
                          }
                        >
                          {months.map((month, index) => (
                            <option key={month.date} value={index}>
                              {monthLabel(month.date)}
                            </option>
                          ))}
                        </select>
                      </label>
                      <EditButton
                        label="All money settings"
                        onClick={() => setSettings("money")}
                      />
                    </div>,
                  )}
                  {!sandbox && practiceView === "actual" && (
                    <section
                      className="pw-money-ytd"
                      aria-label="Year to date actuals"
                    >
                      <div className="pw-edit-item-heading">
                        <h3>Year to date · recorded</h3>
                        <span>
                          {finalizedYtdCount} finalized{" "}
                          {finalizedYtdCount === 1 ? "period" : "periods"}
                          {moneyYtd?.dataThrough
                            ? " · through " + moneyYtd.dataThrough
                            : ""}
                        </span>
                      </div>
                      <div className="pw-money-ytd-grid">
                        {(
                          [
                            ["Billed session income", moneyYtd?.values.revenue],
                            ["Operating overhead", moneyYtd?.values.overhead],
                            ["Marketing", moneyYtd?.values.marketing],
                            ["Operating profit", moneyYtd?.values.profit],
                            [
                              "Family take-home",
                              moneyYtd?.values.familyTakeHome,
                            ],
                          ] as const
                        ).map(([label, amount]) => (
                          <div key={label}>
                            <span>{label}</span>
                            <strong>{money(amount)}</strong>
                          </div>
                        ))}
                      </div>
                      {!finalizedYtdCount && (
                        <p>
                          No finalized financial periods yet. Recorded sessions
                          inform the forecast, but they are not booked revenue.
                        </p>
                      )}
                      {!!moneyYtdGaps.length && (
                        <p className="pw-money-coverage">
                          Recorded YTD is incomplete. Missing:{" "}
                          {moneyYtdGaps.slice(0, 3).join(", ")}
                          {moneyYtdGaps.length > 3
                            ? ` and ${moneyYtdGaps.length - 3} more gaps`
                            : ""}
                          .
                        </p>
                      )}
                      {!!moneyYtd?.warnings.length && (
                        <details>
                          <summary>Actuals coverage and missing data</summary>
                          {moneyYtd.warnings.map((warning) => (
                            <p key={warning}>{warning}</p>
                          ))}
                        </details>
                      )}
                    </section>
                  )}
                  <div className="pw-money-workspace">
                    <div className="pw-money-ledger">
                      <div className="pw-money-ledger-heading">
                        <div>
                          <h3>Monthly practice flow</h3>
                          <p>
                            {moneyMonth
                              ? monthLabel(moneyMonth.date)
                              : "No forecast month"}
                          </p>
                        </div>
                        <span>Model estimate</span>
                      </div>

                      <div className="pw-money-group-label">Income</div>
                      <div className="pw-money-row pw-money-positive">
                        <div>
                          <strong>Billed session income</strong>
                          <span>
                            Imported charged fees or projected sessions x rate
                          </span>
                        </div>
                        <button
                          className="pw-text-button"
                          onClick={() => setSection("clinicians")}
                        >
                          Edit clinician inputs
                          <ChevronRight />
                        </button>
                        <b>{money(moneyValues.revenue)}</b>
                      </div>
                      <div className="pw-money-row pw-money-positive">
                        <div>
                          <strong>Other business income</strong>
                          <span>Income-category budget lines</span>
                        </div>
                        <button
                          className="pw-text-button"
                          onClick={() => setSection("budgets")}
                        >
                          Edit income lines
                          <ChevronRight />
                        </button>
                        <b>{money(otherBusinessIncome)}</b>
                      </div>
                      <div className="pw-money-group-label">
                        Cost to run the practice
                      </div>
                      {[
                        [
                          "Clinician compensation",
                          "Pay tied to clinical work",
                          moneyValues.clinicianPay,
                          "clinicians",
                        ],
                        [
                          "Clinical payroll burden",
                          "Employer taxes and insurance",
                          moneyValues.employerBurden,
                          "clinicians",
                        ],
                        [
                          "Support staff",
                          "Administrative and support payroll",
                          moneyValues.staffCost,
                          "clinicians",
                        ],
                        [
                          "Overhead",
                          "Active operating budget lines",
                          moneyValues.overhead,
                          "budgets",
                        ],
                        [
                          "Marketing",
                          "Campaign spend and related costs",
                          moneyValues.marketing,
                          "marketing",
                        ],
                      ].map(([label, caption, amount, target]) => (
                        <div
                          className="pw-money-row pw-money-cost"
                          key={String(label)}
                        >
                          <div>
                            <strong>{label}</strong>
                            <span>{caption}</span>
                          </div>
                          <button
                            className="pw-text-button"
                            onClick={() => setSection(target as Section)}
                          >
                            Edit source
                            <ChevronRight />
                          </button>
                          <b>-{money(amount as number | null)}</b>
                        </div>
                      ))}
                      <div className="pw-money-row pw-money-cost pw-money-processing">
                        <div>
                          <strong>Payment processing</strong>
                          <span>
                            Estimated from projected completed sessions and
                            successful payments
                          </span>
                        </div>
                        <div className="pw-money-fee-inputs">
                          <DraftField
                            label="Rate (%)"
                            type="number"
                            max={100}
                            value={workingWorkspace.settings.processingPct}
                            onChange={(value) =>
                              stageSettings(
                                { processingPct: Number(value) },
                                "Processing rate",
                              )
                            }
                          />
                          <DraftField
                            label="Per successful payment ($)"
                            type="number"
                            value={
                              workingWorkspace.settings
                                .processingFixedPerTransaction
                            }
                            onChange={(value) =>
                              stageSettings(
                                {
                                  processingFixedPerTransaction: Number(value),
                                },
                                "Fixed processing fee",
                              )
                            }
                          />
                          <DraftField
                            label="Payments per completed session"
                            type="number"
                            max={10}
                            value={
                              workingWorkspace.settings
                                .processingTransactionsPerSession
                            }
                            onChange={(value) =>
                              stageSettings(
                                {
                                  processingTransactionsPerSession:
                                    Number(value),
                                },
                                "Estimated payment count",
                              )
                            }
                          />
                          <button
                            className="pw-text-button"
                            onClick={() =>
                              stageSettings(
                                {
                                  processingPct: 3.15,
                                  processingFixedPerTransaction: 0.3,
                                  processingTransactionsPerSession: 1,
                                },
                                "SimplePractice fee estimate",
                              )
                            }
                          >
                            Use 3.15% + $0.30
                          </button>
                        </div>
                        <b>-{money(moneyValues.fees)}</b>
                      </div>
                      <div className="pw-money-row pw-money-subtotal">
                        <div>
                          <strong>Available before owner pay</strong>
                          <span>
                            What the practice creates before owner payroll
                          </span>
                        </div>
                        <span />
                        <b>{money(beforeOwnerPay)}</b>
                      </div>
                      <div className="pw-money-row pw-money-total">
                        <div>
                          <strong>Operating profit</strong>
                          <span>After owner payroll and its employer cost</span>
                        </div>
                        <DraftField
                          label="Monthly profit goal ($)"
                          type="number"
                          value={workingWorkspace.settings.targetProfitMonthly}
                          onChange={(value) =>
                            stageSettings(
                              { targetProfitMonthly: Number(value) },
                              "Monthly profit goal",
                            )
                          }
                        />
                        <b>{money(moneyValues.profit)}</b>
                      </div>
                    </div>
                  </div>
                  <details className="pw-money-advanced">
                    <summary>Collection exceptions</summary>
                    <p>
                      Most practices can leave these at 100% and no delay. The
                      paid portion affects estimated collections and cash, not
                      billed session income.
                    </p>
                    <div className="pw-edit-grid">
                      <DraftField
                        label="Expected paid portion of fees (%)"
                        type="number"
                        max={100}
                        value={workingWorkspace.settings.collectionPct}
                        onChange={(value) =>
                          stageSettings(
                            { collectionPct: Number(value) },
                            "Expected paid portion",
                          )
                        }
                      />
                      <DraftField
                        label="Collection delay (months)"
                        type="number"
                        max={12}
                        value={workingWorkspace.settings.collectionDelayMonths}
                        onChange={(value) =>
                          stageSettings(
                            { collectionDelayMonths: Number(value) },
                            "Collection delay",
                          )
                        }
                      />
                      <DraftField
                        label="Opening receivables ($)"
                        type="number"
                        value={workingWorkspace.settings.openingReceivables}
                        onChange={(value) =>
                          stageSettings(
                            { openingReceivables: Number(value) },
                            "Opening receivables",
                          )
                        }
                      />
                      <DraftField
                        label="Successful opening payments"
                        type="number"
                        max={1_000_000}
                        step={1}
                        value={
                          workingWorkspace.settings
                            .processingOpeningTransactions
                        }
                        onChange={(value) =>
                          stageSettings(
                            { processingOpeningTransactions: Number(value) },
                            "Opening payment count",
                          )
                        }
                      />
                    </div>
                    {workspace.settings.collectionDelayMonths > 0 && (
                      <p>
                        Projected cash received this month:{" "}
                        {money(moneyValues.collections)}
                      </p>
                    )}
                  </details>

                  <section className="pw-money-sources">
                    <div className="pw-section-heading">
                      <div>
                        <h3>Inputs behind the totals</h3>
                        <p>
                          Edit recurring amounts here or in their own sections
                        </p>
                      </div>
                    </div>
                    <div className="pw-money-source-grid">
                      <div>
                        <div className="pw-money-source-heading">
                          <h3>Operating expenses</h3>
                          <button
                            className="pw-icon"
                            title="Add expense"
                            aria-label="Add expense"
                            onClick={() => stageNew("budgets")}
                          >
                            <Plus />
                          </button>
                        </div>
                        {active(workingWorkspace.budgets)
                          .filter((budget) =>
                            ["expense", "facility"].includes(
                              workingWorkspace.categories.find(
                                (category) => category.id === budget.categoryId,
                              )?.kind ?? "",
                            ),
                          )
                          .map((budget) => (
                            <div
                              className="pw-money-source-row"
                              key={budget.id}
                            >
                              <div>
                                <strong>{budget.name}</strong>
                                <span>
                                  {budget.cadence.replaceAll("_", " ")}
                                </span>
                              </div>
                              <DraftField
                                label={`${budget.name} ${budget.cadence === "percent_revenue" ? "percent of revenue" : budget.cadence === "per_session" ? "cost per session ($)" : "amount ($)"}`}
                                type="number"
                                value={budget.amount}
                                onChange={(value) =>
                                  stageRecord(
                                    "budgets",
                                    budget.id,
                                    { amount: Number(value) },
                                    budget.name + " amount",
                                  )
                                }
                              />
                              <EditButton
                                label={`Edit ${budget.name}`}
                                onClick={() => edit("budgets", budget)}
                              />
                            </div>
                          ))}
                        {(moneyValues.overhead ?? 0) >
                          (moneyMonth?.budgetValues?.overhead ?? 0) + 0.01 && (
                          <div className="pw-money-source-row">
                            <div>
                              <strong>
                                Remaining overhead allowance and other costs
                              </strong>
                              <span>
                                Compensation-plan baseline or dated expansion
                                costs
                              </span>
                            </div>
                            <strong>
                              {money(
                                (moneyValues.overhead ?? 0) -
                                  (moneyMonth?.budgetValues?.overhead ?? 0),
                              )}
                            </strong>
                          </div>
                        )}
                        {!active(workingWorkspace.budgets).length && (
                          <p className="pw-empty">
                            No recurring budget lines yet.
                          </p>
                        )}
                      </div>
                      <div>
                        <div className="pw-money-source-heading">
                          <h3>Ad spend and support costs</h3>
                          <button
                            className="pw-icon"
                            title="Add campaign"
                            aria-label="Add campaign"
                            onClick={() => stageNew("campaigns")}
                          >
                            <Plus />
                          </button>
                        </div>
                        {active(workingWorkspace.campaigns).map((campaign) => (
                          <div
                            className="pw-money-source-row"
                            key={campaign.id}
                          >
                            <div>
                              <strong>{campaign.name}</strong>
                              <span>Ad spend · {campaign.source}</span>
                            </div>
                            <DraftField
                              label={`${campaign.name} monthly ad spend`}
                              type="number"
                              value={campaign.monthlySpend}
                              onChange={(value) =>
                                stageRecord(
                                  "campaigns",
                                  campaign.id,
                                  { monthlySpend: Number(value) },
                                  campaign.name + " ad spend",
                                )
                              }
                            />
                            <EditButton
                              label={`Edit ${campaign.name}`}
                              onClick={() => edit("campaigns", campaign)}
                            />
                          </div>
                        ))}
                        {active(workingWorkspace.budgets)
                          .filter(
                            (budget) =>
                              workingWorkspace.categories.find(
                                (category) => category.id === budget.categoryId,
                              )?.kind === "marketing",
                          )
                          .map((budget) => (
                            <div
                              className="pw-money-source-row"
                              key={budget.id}
                            >
                              <div>
                                <strong>{budget.name}</strong>
                                <span>
                                  Marketing support · {budget.cadence}
                                </span>
                              </div>
                              <DraftField
                                label={`${budget.name} ${budget.cadence === "percent_revenue" ? "percent of revenue" : budget.cadence === "per_session" ? "cost per session ($)" : "amount ($)"}`}
                                type="number"
                                value={budget.amount}
                                onChange={(value) =>
                                  stageRecord(
                                    "budgets",
                                    budget.id,
                                    { amount: Number(value) },
                                    budget.name + " amount",
                                  )
                                }
                              />
                            </div>
                          ))}
                        {!active(workingWorkspace.campaigns).length && (
                          <p className="pw-empty">No active campaigns yet.</p>
                        )}
                      </div>
                    </div>
                  </section>

                  <section className="pw-money-allocations">
                    <div className="pw-section-heading">
                      <div>
                        <h3>Allocate positive cash profit</h3>
                        <p>
                          Taxes and reserves stay in the business; marked owner
                          distributions go to the family
                        </p>
                      </div>
                      {add("allocations", "Add allocation")}
                    </div>
                    {active(workingWorkspace.allocations).length ? (
                      active(workingWorkspace.allocations).map((allocation) => (
                        <div key={allocation.id} className="pw-allocation">
                          <div>
                            <h3>{allocation.name}</h3>
                            <p>
                              {allocation.kind.replaceAll("_", " ")}
                              {allocation.household
                                ? " / family"
                                : " / business"}
                            </p>
                          </div>
                          <DraftField
                            label={`${allocation.name} share (%)`}
                            type="number"
                            max={100}
                            value={allocation.percent}
                            onChange={(value) =>
                              stageRecord(
                                "allocations",
                                allocation.id,
                                { percent: Number(value) },
                                allocation.name + " allocation",
                              )
                            }
                          />
                          <EditButton
                            label={`Edit ${allocation.name}`}
                            onClick={() => edit("allocations", allocation)}
                          />
                        </div>
                      ))
                    ) : (
                      <div className="pw-money-allocation-grid">
                        {[
                          ["Taxes", "taxPct", moneyValues.taxReserve],
                          [
                            "Business reserves",
                            "reservePct",
                            moneyValues.reserves,
                          ],
                          [
                            "Owner distributions",
                            "distributionPct",
                            moneyValues.distributions,
                          ],
                        ].map(([label, key, amount]) => (
                          <div key={String(key)}>
                            <DraftField
                              label={String(label) + " (%)"}
                              type="number"
                              max={100}
                              value={
                                workingWorkspace.settings[
                                  key as
                                    | "taxPct"
                                    | "reservePct"
                                    | "distributionPct"
                                ]
                              }
                              onChange={(value) =>
                                stageSettings(
                                  {
                                    [key as
                                      | "taxPct"
                                      | "reservePct"
                                      | "distributionPct"]: Number(value),
                                  },
                                  String(label) + " allocation",
                                )
                              }
                            />
                            <strong>{money(amount as number | null)}</strong>
                          </div>
                        ))}
                      </div>
                    )}
                    <div className="pw-money-cash-result">
                      <span>
                        <strong>Available cash change</strong>
                        <small>After taxes, reserves, and distributions</small>
                      </span>
                      <b>{money(moneyValues.retainedCash)}</b>
                      <span>
                        <strong>Available cash balance</strong>
                        <small>Projected end of month</small>
                      </span>
                      <b>{money(moneyValues.cash)}</b>
                    </div>
                  </section>

                  {!sandbox && practiceView === "actual" && (
                    <section
                      className="pw-projection-table"
                      aria-label="Recorded financial periods"
                    >
                      {heading(
                        "Recorded financial periods",
                        "Finalized figures entered for completed periods",
                        detailButton("periods", "Review periods"),
                      )}
                      {recordedFinancialPeriods.length ? (
                        <div className="pw-table-scroll">
                          <table className="pw-table">
                            <thead>
                              <tr>
                                <th>Period</th>
                                <th>Billed session income</th>
                                <th>Clinician pay</th>
                                <th>Overhead</th>
                                <th>Profit</th>
                              </tr>
                            </thead>
                            <tbody>
                              {recordedFinancialPeriods
                                .slice(0, 6)
                                .map((period) => (
                                  <tr key={period.periodStart + period.date}>
                                    <th>
                                      {periodLabel(
                                        period.periodStart ?? period.date,
                                        period.date,
                                      )}
                                    </th>
                                    <td>{money(period.values.revenue)}</td>
                                    <td>{money(period.values.clinicianPay)}</td>
                                    <td>{money(period.values.overhead)}</td>
                                    <td>{money(period.values.profit)}</td>
                                  </tr>
                                ))}
                            </tbody>
                          </table>
                        </div>
                      ) : (
                        <p className="pw-notice">
                          No finalized financial periods yet. The money flow
                          above uses planned rates and budgets with recent
                          session pace.
                        </p>
                      )}
                    </section>
                  )}

                  <section className="pw-owner-flow">
                    <div className="pw-section-heading">
                      <div>
                        <h3>Family take-home from the practice</h3>
                        <p>
                          Owner pay and distributions, not a household budget
                        </p>
                      </div>
                    </div>
                    <div className="pw-owner-grid">
                      <div className="pw-owner-line">
                        <div>
                          <strong>Owner payroll</strong>
                          <span>Non-clinical monthly compensation</span>
                        </div>
                        <DraftField
                          label="Owner monthly payroll ($)"
                          type="number"
                          value={workingWorkspace.settings.ownerPayrollMonthly}
                          onChange={(value) =>
                            stageSettings(
                              { ownerPayrollMonthly: Number(value) },
                              "Owner payroll",
                            )
                          }
                        />
                        <b>{money(moneyValues.ownerPayroll)}</b>
                      </div>
                      <div className="pw-owner-line">
                        <div>
                          <strong>Owner payroll burden</strong>
                          <span>Employer-side payroll cost</span>
                        </div>
                        <DraftField
                          label="Owner payroll employer burden (%)"
                          type="number"
                          max={100}
                          value={
                            workingWorkspace.settings.ownerPayrollBurdenPct
                          }
                          onChange={(value) =>
                            stageSettings(
                              { ownerPayrollBurdenPct: Number(value) },
                              "Owner payroll burden",
                            )
                          }
                        />
                        <b>{money(ownerBurden)}</b>
                      </div>
                      <div className="pw-owner-line">
                        <div>
                          <strong>Owner clinical pay</strong>
                          <span>
                            Clinical compensation already included above
                          </span>
                        </div>
                        <label className="pw-toggle">
                          <input
                            type="checkbox"
                            checked={
                              workingWorkspace.settings.includeOwnerClinical
                            }
                            onChange={(event) =>
                              stageSettings(
                                { includeOwnerClinical: event.target.checked },
                                "Owner clinical take-home",
                              )
                            }
                          />
                          Include in take-home
                        </label>
                        <b>{money(moneyValues.ownerClinicalPay)}</b>
                      </div>
                      <div className="pw-owner-line">
                        <div>
                          <strong>Owner distributions</strong>
                          <span>Distributions marked for family above</span>
                        </div>
                        <span />
                        <b>{money(familyDistributions)}</b>
                      </div>
                      <div className="pw-owner-line pw-owner-total">
                        <div>
                          <strong>Planned family take-home</strong>
                          <span>
                            {workingWorkspace.settings.familyW2ClinicianId !==
                            null
                              ? "Selected W2 clinician pay after estimated employee taxes, plus distributions"
                              : "Owner payroll + included clinical pay + marked distributions. Owner payroll is before personal withholding."}
                          </span>
                        </div>
                        <span />
                        <b>{money(moneyValues.familyTakeHome)}</b>
                      </div>
                      <div className="pw-owner-line">
                        <div>
                          <strong>Available from projected operations</strong>
                          <span>
                            After practice costs, payroll burden, tax, and
                            business reserves; before using existing cash
                          </span>
                        </div>
                        <span />
                        <b>
                          {money(
                            Math.max(
                              0,
                              beforeOwnerPay -
                                ownerBurden -
                                (moneyValues.taxReserve ?? 0) -
                                (moneyValues.reserves ?? 0) +
                                (workspace.settings.includeOwnerClinical
                                  ? (moneyValues.ownerClinicalPay ?? 0)
                                  : 0),
                            ),
                          )}
                        </b>
                      </div>
                      {(moneyValues.familyTakeHome ?? 0) >
                        Math.max(
                          0,
                          beforeOwnerPay -
                            ownerBurden -
                            (moneyValues.taxReserve ?? 0) -
                            (moneyValues.reserves ?? 0) +
                            (workspace.settings.includeOwnerClinical
                              ? (moneyValues.ownerClinicalPay ?? 0)
                              : 0),
                        ) && (
                        <p className="pw-money-warning">
                          Planned family take-home is higher than this month’s
                          modeled operating capacity. The difference would
                          require existing cash or a change to the plan.
                        </p>
                      )}
                    </div>
                  </section>
                </>
              )}
              {section === "summary" && (
                <>
                  {achievedGoals.map(({ goal, result }) => (
                    <div className="pw-achievement-alert" role="status" key={goal.id ?? goal.name}>
                      <strong>{goal.name} goal met</strong>
                      <p>{result.message} The goal remains saved until you change it.</p>
                    </div>
                  ))}
                  {achievedFunds.map(({ goal, result }) => <div className="pw-achievement-alert" role="status" key={"fund:" + goal.name}><strong>{goal.name} goal met</strong><p>{result.message}</p></div>)}
                  <SharedPeriodControls
                    period={sharedPeriod}
                    custom={customPeriod}
                    onPeriod={setSharedPeriod}
                    onCustom={setCustomPeriod}
                    note="This reporting period carries into Sessions, Team, Money, Growth, Rooms, and Goals."
                  />
                  {heading(
                    "Practice summary",
                    (mode === "practice" && practiceView === "actual"
                      ? "Forecast / "
                      : "Plan / ") +
                      monthLabel(
                        summaryMonth?.date ?? workspace.settings.forecastStart,
                      ),
                    <div className="pw-summary-controls">
                      <label>
                        Month
                        <select
                          aria-label="Summary month"
                          value={summaryMonth?.date ?? ""}
                          onChange={(event) =>
                            setSummaryMonthDate(event.target.value)
                          }
                        >
                          {months.map((month) => (
                            <option key={month.date} value={month.date}>
                              {monthLabel(month.date)}
                            </option>
                          ))}
                        </select>
                      </label>
                      {(sandbox || practiceView === "plan") && (
                        <label>
                          Plan sessions
                          <select
                            aria-label="Plan session basis"
                            value={
                              projectionBasis === "manual"
                                ? "manual"
                                : "desired"
                            }
                            onChange={(e) => {
                              if (e.target.value === "manual") {
                                setSettings("forecast");
                                return;
                              }
                              void saveWorkspace({
                                ...workspace,
                                settings: {
                                  ...workspace.settings,
                                  baselineMode: "manual",
                                  baselineWeeklySessions: desiredWeeklyTotal,
                                },
                              }).catch((e) => setError(errorText(e)));
                            }}
                          >
                            <option value="desired">Desired sessions</option>
                            <option value="manual">Custom weekly pace</option>
                          </select>
                        </label>
                      )}
                      <label>
                        Compare with
                        <select
                          aria-label="Compare with goal"
                          value={compareId}
                          onChange={(e) => setCompareId(e.target.value)}
                        >
                          <option value="">No goal comparison</option>
                          {goals.map((g) => (
                            <option key={g.goal.id} value={g.goal.id}>
                              {g.goal.name}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>,
                  )}
                  {mode === "practice" && practiceView === "actual" && (
                    <section className="pw-import-attention">
                      <div>
                        <span className="pw-tag">
                          <Upload /> Imports
                        </span>
                        <strong>
                          {localRetentionState.snapshots.length
                            ? `${localRetentionState.snapshots.length} converted snapshot${localRetentionState.snapshots.length === 1 ? "" : "s"} loaded`
                            : "No converted snapshots loaded"}
                        </strong>
                        <small>
                          {importAttentionCount
                            ? "Review imported coverage, mapping, overlap, and same-day exceptions before relying on clinical metrics."
                            : "Import review stays separate from manual session entry and forecast assumptions."}
                        </small>
                      </div>
                      <button
                        className="pw-button"
                        onClick={() => setSection("retention")}
                      >
                        Open Imports
                        <ChevronRight />
                      </button>
                    </section>
                  )}
                  <div className="pw-overview-primary-grid">
                    <section aria-label="Overview monthly surplus">
                      <h3>Monthly surplus</h3><p>{monthLabel(summaryMonth?.date ?? today)} · projection</p>
                      <div className="pw-metric-hero"><strong>{money(summaryMonth?.values.profit)}</strong><span>After clinician pay and practice costs</span></div>
                      <button className="pw-button" onClick={() => setSection("money")}>Money<ChevronRight /></button>
                      <details><summary>Details</summary><p>Projected practice profit, not collected cash or owner take-home. Clinical revenue remains business revenue.</p></details>
                    </section>
                    <section aria-label="Overview session pace">
                      <h3>Sessions / week</h3><p>{sharedPeriodLabel(sharedPeriod)} · recorded visits</p>
                      <div className="pw-metric-hero"><strong>{fmt(overviewSessionEvidence.completedWeekly ?? overviewSessionEvidence.calendarWindowWeeklyEstimate)}</strong><span>{overviewSessionEvidence.coverageComplete ? "Recorded calendar-week pace" : "Calendar-window estimate · coverage unknown"}</span></div>
                      <p>{fmt(overviewSessionEvidence.observedCompleted)} observed sessions</p>
                      <button className="pw-button" onClick={() => { setSessionMetricView("sessions"); setSection("sessions"); }}>Sessions<ChevronRight /></button>
                      <details><summary>Details</summary><p>Observed visits remain visible. Unverified missing dates are not recorded zeros and cannot establish achievement.</p></details>
                    </section>
                    <section className="pw-overview-client-flow" aria-label="Overview client growth">
                      <h3>Client growth</h3><p>{sharedPeriodLabel(sharedPeriod)} · recorded treatment history</p>
                      {[["New treatment starts", overviewFlow.starts, "starts"], ["Retained-client departures", overviewFlow.departures, "departures"]].map(([label, value, kind]) => <div className="pw-overview-flow-row" key={String(kind)}><span>{label}</span><strong>{fmt(value as number | null)}</strong><div><i className={String(kind)} style={{ width: `${value === null ? 0 : Number(value) / Math.max(1, overviewFlow.starts ?? 0, overviewFlow.departures ?? 0) * 100}%` }} /></div></div>)}
                      <button className="pw-button" onClick={() => { setSessionMetricView("attrition"); setSection("sessions"); }}>Retention &amp; attrition<ChevronRight /></button>
                      <details><summary>Details</summary><p>Starts and departures use different maturity cutoffs and are not subtracted into a false net-growth figure. Mature departures require 90 days of covered follow-up after three treatment sessions; later returns are handled separately.</p></details>
                    </section>
                  </div>
                  <div className="pw-overview-composition">
                    <section aria-label="Overview financial summary">
                      <h3>Financial summary</h3>
                      <p>{overviewYear} · full-year projection · billed revenue, not collected cash</p>
                      <div className="pw-overview-bridge" role="img" aria-label="Projected annual income less clinician compensation and operating costs leaves practice profit">
                        {[
                          { label: "Income", value: overviewFinancial.income !== null && overviewFinancial.adjustments !== null ? overviewFinancial.income + overviewFinancial.adjustments : null, bottom: 0, kind: "income" },
                          { label: "Clinician pay", value: overviewFinancial.clinicianPay === null ? null : -overviewFinancial.clinicianPay, bottom: overviewFinancial.income === null || overviewFinancial.adjustments === null || overviewFinancial.clinicianPay === null ? 0 : overviewFinancial.income + overviewFinancial.adjustments - overviewFinancial.clinicianPay, kind: "deduction" },
                          { label: "Other practice costs", value: overviewFinancial.otherCosts === null ? null : -overviewFinancial.otherCosts, bottom: Math.max(0, overviewFinancial.profit ?? 0), kind: "deduction" },
                          { label: "Practice profit", value: overviewFinancial.profit, bottom: 0, kind: "profit" },
                        ].map((step) => {
                          const scale = Math.max(1, Math.abs((overviewFinancial.income ?? 0) + (overviewFinancial.adjustments ?? 0)), Math.abs(overviewFinancial.profit ?? 0));
                          return <div key={step.label}><strong>{money(step.value)}</strong><div className="pw-overview-bridge-plot"><i className={step.kind} style={{ height: `${Math.min(100, Math.abs(step.value ?? 0) / scale * 100)}%`, bottom: `${Math.max(0, Math.min(100, step.bottom / scale * 100))}%` }} /></div><span>{step.label}</span></div>;
                        })}
                      </div>
                      <details><summary>Financial details</summary><p>Clinical revenue {money(overviewFinancial.income)}; other income or reconciliation adjustments {money(overviewFinancial.adjustments)}.</p>{overviewFinancial.costComponents.map((component) => <div className="pw-overview-total" key={component.label}><span>{component.label}</span><strong>{money(component.value)}</strong></div>)}<p>Owner distributions are funding needs after profit; owner clinical revenue stays in the business. Taxes, reserves and distributions are not counted again as operating costs.</p></details>
                    </section>
                    <section aria-label="Overview combined funding progress">
                      <h3>Projected goal progress</h3>
                      <p>{overviewYear} · projected finish against current funding needs</p>
                      <div className="pw-metric-hero"><strong>{overviewFinancial.target !== null && overviewFinancial.target > 0 && overviewFinancial.profit !== null ? fmt(overviewFinancial.profit / overviewFinancial.target * 100, "percent") : "--"}</strong><span>Projected finish {money(overviewFinancial.profit)}</span></div>
                      <MetricTargetBar value={overviewFinancial.profit} goal={overviewFinancial.target} valueLabel="Projected finish" />
                      <div className="pw-overview-total"><span>Combined annual funding target</span><strong>{money(overviewFinancial.target)}</strong></div>
                      <div className="pw-overview-total"><span>Projected surplus / gap</span><strong>{money(overviewFinancial.target === null || overviewFinancial.profit === null ? null : overviewFinancial.profit - overviewFinancial.target)}</strong></div>
                      {overviewFinancial.missingAmounts > 0 && <p className="pw-note">{overviewFinancial.missingAmounts} funding amounts remain unknown. Known annual subtotal {money(overviewFinancial.knownSubtotal)}.</p>}
                      <details><summary>Funding details</summary><p>Owner distribution target {money(overviewFinancial.ownerAnnual)}; additional co-owner salary need {money(overviewFinancial.salaryGap)} after {money(overviewFinancial.includedSalaryAnnual)} matching gross salary already included in costs; retained profit target {money(overviewFinancial.retainedAnnual)}; projected fund contributions {money(overviewFinancial.fundsAnnual)}. Total fund-balance goals, overhead already deducted, and headcount are not added as recurring costs. This projection cannot establish achievement.</p></details>
                    </section>
                  </div>
                  <div className="pw-overview-clinical-grid">
                    <section aria-label="Overview initial retention"><h3>Initial retention</h3><p>Recorded treatment history · {sharedPeriodLabel(sharedPeriod)}</p><div className="pw-metric-hero"><strong>{percent(clientActivityEstimate?.initialRetentionRate)}</strong></div><p>{fmt(clientActivityEstimate?.retainedClientPairs)} retained / {fmt(clientActivityEstimate?.initialRetentionDenominator)} evaluated starts · {fmt(clientActivityEstimate?.immatureClientPairsExcluded)} pending{clientActivityEstimate?.coverageVerified ? "" : " · observed, coverage unverified"}</p><button className="pw-button" onClick={() => { setSessionMetricView("retention"); setSection("sessions"); }}>Retention<ChevronRight /></button><details><summary>Details</summary><p>Three treatment sessions with initial gaps of no more than 28 days. PHONE consultations are excluded.</p></details></section>
                    <section aria-label="Overview consult conversion"><h3>Consult close rate</h3><p>{sharedPeriodLabel(sharedPeriod)} · one calendar month</p><div className="pw-metric-hero"><strong>{fmt(consultConversionSummary.practice.conversionRate, "percent")}</strong></div><p>{fmt(consultConversionSummary.practice.converted)} treatment starts / {fmt(consultConversionSummary.practice.evaluated)} evaluated journeys · {fmt(consultConversionSummary.practice.pending)} pending{consultConversionSummary.coverageVerified ? "" : " · observed, coverage unverified"}</p><button className="pw-button" onClick={() => { setMarketingTab("results"); setSection("marketing"); }}>Growth<ChevronRight /></button><details><summary>Details</summary><p>The actual closer receives credit; internal referrals do not penalize the referring clinician. Each practice conversion is counted once.</p></details></section>
                  </div>
                  <details className="pw-overview-existing-details"><summary>Forecast and historical details</summary>
                  <div className="pw-summary">
                    {metrics.map((m) => (
                      <div key={m.key}>
                        <span>{m.label}</span>
                        <strong>{money(summaryMonth?.values[m.key])}</strong>
                        {selectedGoal && (
                          <small>
                            Goal:{" "}
                            {comparableGoal
                              ? money(
                                  selectedMonths.find(
                                    (row) => row.date === summaryMonth?.date,
                                  )?.values[m.key],
                                )
                              : "Different team"}
                          </small>
                        )}
                      </div>
                    ))}
                  </div>
                  {operatingPlan && (
                    <section
                      className="pw-operating-plan"
                      aria-label="Selected month operating plan"
                    >
                      <div className="pw-section-heading">
                        <div>
                          <h3>Selected month plan</h3>
                          <p>
                            {monthLabel(operatingPlan.month)} estimate from
                            session pace, lead flow, compensation, and budgets.
                          </p>
                        </div>
                        <button
                          type="button"
                          className="pw-text-button"
                          onClick={openRetentionCalculations}
                        >
                          Assumptions <ChevronRight />
                        </button>
                      </div>
                      <div className="pw-operating-grid">
                        <div>
                          <span>Session pace</span>
                          <strong>
                            {fmt(operatingPlan.weeklySessions)} / week
                          </strong>
                          <small>
                            {fmt(operatingPlan.sessions)} sessions / month
                            {operatingPlan.activeClients !== null
                              ? `; about ${fmt(operatingPlan.activeClients)} active clients`
                              : ""}
                          </small>
                        </div>
                        <div>
                          <span>Clinician compensation</span>
                          <strong>
                            {money(operatingPlan.clinicianCompensation)}
                          </strong>
                          <small>Clinician pay plus employer burden.</small>
                        </div>
                        <div>
                          <span>Other operating costs</span>
                          <strong>
                            {money(operatingPlan.operatingExpense)}
                          </strong>
                          <small>
                            Staff, overhead, marketing, fees, and owner payroll;
                            excludes clinician compensation above.
                          </small>
                        </div>
                        <div>
                          <span>Leads needed / month</span>
                          <strong>
                            {operatingPlan.leadsNeeded === null
                              ? "--"
                              : fmt(operatingPlan.leadsNeeded)}
                          </strong>
                          <small>
                            {operatingPlan.leadToClientRate === null
                              ? "Add leads and booked clients in Marketing to estimate this."
                              : operatingPlan.leadToClientRate === 0
                                ? "No booked clients from recent leads; review conversion in Marketing."
                                : `Replace attrition and fill open caseload over ${fillHorizonMonths} months at ${percent(operatingPlan.leadToClientRate)} lead-to-client.`}
                          </small>
                        </div>
                      </div>
                      <div className="pw-goal-gap" role="status">
                        <span>
                          {operatingPlan.targetProfit > 0
                            ? "Gap to monthly profit goal"
                            : "Gap to break even"}
                        </span>
                        <strong>{money(operatingPlan.profitGap)}</strong>
                        <small>
                          {operatingPlan.targetProfit > 0
                            ? `Target ${money(operatingPlan.targetProfit)}`
                            : "Break-even target $0"}
                          ;{" "}
                          {operatingPlan.profitGap === null
                            ? "profit estimate is incomplete"
                            : operatingPlan.profitGap === 0
                              ? operatingPlan.targetProfit > 0
                                ? "goal met in this estimate"
                                : "at or above break even in this estimate"
                              : operatingPlan.sessionsToCloseGap === null
                                ? "session contribution is not available"
                                : `about ${operatingPlan.sessionsToCloseGap} additional sessions / month at the current mix`}
                        </small>
                      </div>
                      {scenarioDelta && (
                        <div className="pw-scenario-delta">
                          <span>Compared with starting point</span>
                          <strong>
                            Profit{" "}
                            {scenarioDelta.profit === null
                              ? "--"
                              : `${scenarioDelta.profit >= 0 ? "+" : "-"}${money(Math.abs(scenarioDelta.profit))}`}
                          </strong>
                          <small>
                            Revenue{" "}
                            {scenarioDelta.revenue === null
                              ? "--"
                              : `${scenarioDelta.revenue >= 0 ? "+" : "-"}${money(Math.abs(scenarioDelta.revenue))}`}
                            {scenarioDelta.addedCapacitySessions !== null &&
                              scenarioDelta.addedCapacitySessions > 0 &&
                              `; ${fmt(scenarioDelta.addedCapacitySessions)} added session spaces / month`}
                          </small>
                        </div>
                      )}
                      <details className="pw-operating-disclosure">
                        <summary>See lead and cost math</summary>
                        <div className="pw-operating-details">
                          {scenarioDelta &&
                            scenarioDelta.addedCapacitySessions !== null &&
                            scenarioDelta.addedCapacitySessions > 0 && (
                              <section>
                                <h4>Added capacity in this model</h4>
                                <dl>
                                  <div>
                                    <dt>New session spaces / month</dt>
                                    <dd>
                                      {fmt(scenarioDelta.addedCapacitySessions)}
                                    </dd>
                                  </div>
                                  <div>
                                    <dt>Clients to fill them / month</dt>
                                    <dd>
                                      {fmt(scenarioDelta.addedClientsPerMonth)}
                                    </dd>
                                  </div>
                                  <div>
                                    <dt>Added leads needed / month</dt>
                                    <dd>
                                      {fmt(scenarioDelta.addedLeadsPerMonth)}
                                    </dd>
                                  </div>
                                </dl>
                                <p>
                                  Additional leads are spread over{" "}
                                  {fillHorizonMonths} months at the selected
                                  conversion rate.
                                </p>
                              </section>
                            )}
                          <section>
                            <h4>Lead path</h4>
                            <label className="pw-fill-horizon">
                              Fill open caseload over
                              <select
                                aria-label="Months to fill open caseload"
                                value={fillHorizonMonths}
                                onChange={(event) =>
                                  setFillHorizonMonths(
                                    Number(event.target.value),
                                  )
                                }
                              >
                                {[3, 6, 12, 24].map((count) => (
                                  <option key={count} value={count}>
                                    {count} months
                                  </option>
                                ))}
                              </select>
                            </label>
                            <p>
                              Lead conversion:{" "}
                              {operatingPlan.leadRateSource === "recorded"
                                ? "recent recorded results"
                                : operatingPlan.leadRateSource === "campaign"
                                  ? "campaign estimates"
                                  : "not available"}
                              .
                              {` Monthly attrition assumption: ${fmt(operatingPlan.monthlyAttritionPct)}%.`}
                            </p>
                            <dl>
                              <div>
                                <dt>Replacement clients / month</dt>
                                <dd>{fmt(operatingPlan.replacementClients)}</dd>
                              </div>
                              <div>
                                <dt>Clients to fill capacity / month</dt>
                                <dd>{fmt(operatingPlan.fillClients)}</dd>
                              </div>
                              <div>
                                <dt>Total clients needed / month</dt>
                                <dd>{fmt(operatingPlan.clientsNeeded)}</dd>
                              </div>
                              <div>
                                <dt>Scheduled consults needed</dt>
                                <dd>{fmt(operatingPlan.consultsNeeded)}</dd>
                              </div>
                              <div>
                                <dt>Attended consults needed</dt>
                                <dd>
                                  {fmt(operatingPlan.attendedConsultsNeeded)}
                                </dd>
                              </div>
                            </dl>
                          </section>
                          <section>
                            <h4>How the estimate connects</h4>
                            <dl>
                              <div>
                                <dt>Session revenue</dt>
                                <dd>{money(operatingPlan.estimatedRevenue)}</dd>
                              </div>
                              {operatingPlan.otherIncome !== null &&
                                Math.abs(operatingPlan.otherIncome) > 0.01 && (
                                  <div>
                                    <dt>Other business income</dt>
                                    <dd>{money(operatingPlan.otherIncome)}</dd>
                                  </div>
                                )}
                              <div>
                                <dt>Clinician compensation</dt>
                                <dd>
                                  -{money(operatingPlan.clinicianCompensation)}
                                </dd>
                              </div>
                              <div>
                                <dt>Other operating costs</dt>
                                <dd>
                                  -{money(operatingPlan.operatingExpense)}
                                </dd>
                              </div>
                              <div>
                                <dt>Estimated profit</dt>
                                <dd>{money(operatingPlan.estimatedProfit)}</dd>
                              </div>
                            </dl>
                            <p>
                              Active clients are estimated from monthly sessions
                              divided by{" "}
                              {fmt(operatingPlan.sessionsPerClientMonth)}{" "}
                              sessions per client per month. Sessions per week
                              is clinician workload, not client count.
                            </p>
                          </section>
                          {mode === "practice" && (
                            <section>
                              <h4>Test a hire</h4>
                              <p>
                                Model a clinician and compare the resulting plan
                                here.
                              </p>
                              <button
                                type="button"
                                className="pw-button"
                                onClick={startPlanning}
                              >
                                Open Long Term Goals
                              </button>
                            </section>
                          )}
                        </div>
                      </details>
                      {!!operatingPlan.warnings.length && (
                        <details className="pw-assumption-notes">
                          <summary>Missing assumptions to review</summary>
                          <ul>
                            {operatingPlan.warnings.map((warning) => (
                              <li key={warning}>{warning}</li>
                            ))}
                          </ul>
                        </details>
                      )}
                    </section>
                  )}
                  {mode === "practice" && practiceView === "actual" && (
                    <section
                      className="pw-recorded-pulse"
                      aria-label="Recorded session pace"
                    >
                      <div>
                        <span>Recent session pace</span>
                        <strong>
                          {fmt(viewProjection?.projectedWeekly)} / week
                        </strong>
                        <small>
                          {recordedClinicianCount} clinician
                          {recordedClinicianCount === 1 ? "" : "s"} with
                          records; missing days use desired sessions
                        </small>
                      </div>
                      <button
                        className="pw-text-button"
                        onClick={() => setSection("sessions")}
                      >
                        Edit recorded sessions
                        <ChevronRight />
                      </button>
                    </section>
                  )}
                  {resolved &&
                    Object.values(resolved.inherited).some(Boolean) && (
                      <p className="pw-notice">
                        Starting from{" "}
                        {resolved.goal?.name ?? "your compensation plan"}.
                        {!(modelContext ?? context).sessions.some((record) =>
                          people.some(
                            (person) => person.id === record.clinicianId,
                          ),
                        ) &&
                          " Desired sessions are used until recorded sessions are available."}
                      </p>
                    )}
                  {mode === "practice" &&
                    practiceView === "actual" &&
                    !!viewProjection?.recentPeriods.length && (
                      <section
                        className="pw-projection-table"
                        aria-label="Recent recorded periods"
                      >
                        <div className="pw-section-heading">
                          <div>
                            <h3>Recent periods</h3>
                            <p>
                              Recorded sessions are counted; missing clinician
                              entries use desired sessions.
                            </p>
                          </div>
                        </div>
                        <div className="pw-table-scroll">
                          <table className="pw-table">
                            <thead>
                              <tr>
                                <th>Period ending</th>
                                <th>Recorded</th>
                                <th>Estimated gap</th>
                                <th>Working total</th>
                              </tr>
                            </thead>
                            <tbody>
                              {viewProjection.recentPeriods.map((period) => (
                                <tr key={period.start + period.end}>
                                  <th>
                                    {periodLabel(period.start, period.end)}
                                  </th>
                                  <td>{fmt(period.recorded)}</td>
                                  <td>{fmt(period.estimated)}</td>
                                  <td>{fmt(period.total)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </section>
                    )}
                  <section
                    className="pw-projection-table"
                    aria-label="Six month outlook"
                  >
                    <div className="pw-section-heading">
                      <div>
                        <h3>Six-month outlook</h3>
                        <p>
                          {mode === "practice" && practiceView === "actual"
                            ? "Projected from recorded pace, with planned rates and costs"
                            : "Projected from your plan"}
                        </p>
                      </div>
                    </div>
                    <div className="pw-table-scroll">
                      <table className="pw-table">
                        <thead>
                          <tr>
                            <th>Month</th>
                            <th>Sessions</th>
                            <th>Revenue</th>
                            <th>Operating cost</th>
                            <th>Profit</th>
                            <th>Est. family take-home</th>
                          </tr>
                        </thead>
                        <tbody>
                          {months.slice(0, 6).map((row) => {
                            return (
                              <tr key={row.date}>
                                <th>{monthLabel(row.date)}</th>
                                <td>{fmt(row.values.sessions)}</td>
                                <td>{money(row.values.revenue)}</td>
                                <td>
                                  {money(
                                    operatingCost(
                                      row.values,
                                      workspace.settings.ownerPayrollBurdenPct,
                                    ),
                                  )}
                                </td>
                                <td>{money(row.values.profit)}</td>
                                <td>{money(row.values.familyTakeHome)}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                    {workspace.settings.familyW2ClinicianId === null &&
                      months.some((row) => (row.values.profit ?? 0) < 0) && (
                        <p className="pw-projection-note">
                          Planned family take-home includes owner pay; it can
                          remain positive while practice profit is negative.
                        </p>
                      )}
                  </section>
                  {selectedGoal && comparableGoal && (
                    <section className="pw-pace" aria-label="Goal pace">
                      <div className="pw-section-heading">
                        <div>
                          <h3>Goal pace</h3>
                          <p>{selectedGoal.goal.name}</p>
                        </div>
                        <label>
                          Track
                          <select
                            aria-label="Goal pace metric"
                            value={paceMetric}
                            onChange={(e) =>
                              setPaceMetric(e.target.value as PaceMetric)
                            }
                          >
                            <option value="sessions">Sessions</option>
                            <option value="revenue">Revenue</option>
                            <option value="profit">Profit</option>
                          </select>
                        </label>
                      </div>
                      {goalPace ? (
                        <>
                          <div className="pw-pace-callouts">
                            <div>
                              <span>
                                As of {monthLabel(goalPace.latest.date)}
                              </span>
                              <strong>
                                {varianceText(goalPace.variance, paceMetric)}
                              </strong>
                              {goalPace.prior && (
                                <small>
                                  {monthLabel(goalPace.prior.date)}:{" "}
                                  {varianceText(
                                    goalPace.priorVariance,
                                    paceMetric,
                                  )}
                                </small>
                              )}
                            </div>
                            <div>
                              <span>Needed increase in monthly pace</span>
                              <strong>
                                +
                                {paceValue(
                                  goalPace.monthlyGainNeeded,
                                  paceMetric,
                                )}{" "}
                                / month
                              </strong>
                              <small>
                                Add this much to the pace each month to reach{" "}
                                {paceValue(goalPace.target, paceMetric)} by{" "}
                                {monthLabel(goalPace.targetDate)}
                              </small>
                            </div>
                            <div>
                              <span>Estimated finish at recent pace</span>
                              <strong>
                                {goalPace.estimatedFinishDate
                                  ? monthLabel(goalPace.estimatedFinishDate)
                                  : "Not reached on current trend"}
                              </strong>
                              <small>
                                Recent change:{" "}
                                {goalPace.recentMonthlyGain === null
                                  ? "More data needed"
                                  : (goalPace.recentMonthlyGain >= 0
                                      ? "+"
                                      : "-") +
                                    paceValue(
                                      Math.abs(goalPace.recentMonthlyGain),
                                      paceMetric,
                                    ) +
                                    " / month"}
                              </small>
                            </div>
                          </div>
                          <div className="pw-table-scroll">
                            <table className="pw-table pw-pace-table">
                              <thead>
                                <tr>
                                  <th>Period</th>
                                  <th>Recorded pace</th>
                                  <th>Goal pace</th>
                                  <th>Variance</th>
                                </tr>
                              </thead>
                              <tbody>
                                {goalPace.rows.map((row) => (
                                  <tr key={row.date}>
                                    <th>{monthLabel(row.date)}</th>
                                    <td>{paceValue(row.actual, paceMetric)}</td>
                                    <td>
                                      {paceValue(row.planned, paceMetric)}
                                    </td>
                                    <td>
                                      {varianceText(row.variance, paceMetric)}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </>
                      ) : (
                        <p className="pw-notice">
                          Add recorded {paceLabels[paceMetric]} to see pace,
                          catch-up needs, and a revised finish date.
                        </p>
                      )}
                    </section>
                  )}
                  {selectedGoal && !comparableGoal && (
                    <p className="pw-notice">
                      This goal uses a different clinician team. Select the
                      matching team to compare progress.
                    </p>
                  )}
                  <div className="pw-chart">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={summaryChartData}>
                        <CartesianGrid vertical={false} stroke="#e5e9e7" />
                        <XAxis
                          dataKey="date"
                          tickLine={false}
                          axisLine={false}
                          minTickGap={35}
                        />
                        <YAxis
                          tickFormatter={(n) =>
                            paceMetric === "sessions"
                              ? String(Math.round(n))
                              : "$" + Math.round(n / 1000) + "k"
                          }
                          tickLine={false}
                          axisLine={false}
                        />
                        <Tooltip
                          formatter={(v) => paceValue(Number(v), paceMetric)}
                        />
                        <Line
                          dataKey="estimated"
                          name={
                            (mode === "practice" && practiceView === "actual"
                              ? "Forecast "
                              : "Plan ") + paceLabels[paceMetric]
                          }
                          type="monotone"
                          stroke="#39755b"
                          strokeWidth={2}
                          dot={false}
                        />
                        {selectedGoal && (
                          <Line
                            dataKey="goal"
                            name="Saved goal"
                            type="monotone"
                            stroke="#537eaa"
                            strokeDasharray="4 4"
                            dot={false}
                          />
                        )}
                        <Line
                          dataKey="actual"
                          name={"Recorded " + paceLabels[paceMetric]}
                          type="monotone"
                          stroke="#9b625c"
                          strokeWidth={2}
                          connectNulls
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="pw-secondary-links">
                    <button
                      className="pw-text-button"
                      onClick={() =>
                        mode === "practice" && practiceView === "actual"
                          ? setSection("sessions")
                          : setSettings("forecast")
                      }
                    >
                      {mode === "practice" && practiceView === "actual"
                        ? "Review session history"
                        : "Forecast assumptions"}
                      <ChevronRight />
                    </button>
                    {detailButton("goals", "Metric targets")}
                  </div>
                  </details>
                </>
              )}
              {section === "current-goals" && (
                <>
                  <SharedPeriodControls
                    period={sharedPeriod}
                    custom={customPeriod}
                    onPeriod={setSharedPeriod}
                    onCustom={setCustomPeriod}
                    note="Goal comparisons use the same reporting period; blank targets remain editable and count as zero in displays only."
                  />
                  {heading(
                    "Current goals",
                    "Editable monthly or annual targets for Today. Blank amounts are treated as zero until you enter them.",
                    <button
                      className="pw-button"
                      onClick={() => setSection("money")}
                    >
                      Open Money
                      <ChevronRight />
                    </button>,
                  )}
                  <div className="pw-goal-editor">
                    {coreGoalRows.map((row) => {
                      const goal = findGoal(row.name);
                      const expected = goalExpected(goal) ?? summaryMonth?.values[row.metric];
                      const target = goalTarget(goal);
                      const unit = goalUnit(row.metric);
                      return (
                        <section className="pw-edit-item" key={row.name}>
                          <div className="pw-edit-item-heading">
                            <div>
                              <h3>{row.name}</h3>
                              <p>{row.caption}</p>
                            </div>
                            <span className="pw-tag">
                              {linkedGoalFor(row.name, workingWorkspace, resolved?.goal).origin === "legacy" ? `Linked: ${resolved?.goal?.name}` : goal ? "Saved" : "Not set"}
                            </span>
                          </div>
                          <div className="pw-edit-grid">
                            <DraftField
                              label="Goal amount"
                              type="number"
                              value={goal?.amount ?? 0}
                              onChange={(value) =>
                                stageNamedGoal(row.name, row.metric, {
                                  amount: optionalNumber(value) ?? 0,
                                })
                              }
                            />
                            {row.metric !== "activeClinicalHeadcount" && <label className="pw-draft-field">
                              <span>Basis</span>
                              <select
                                aria-label={`${row.name} basis`}
                                value={goal?.basis ?? "annual"}
                                onChange={(event) =>
                                  stageNamedGoal(row.name, row.metric, {
                                    basis: event.target
                                      .value as Workspace["goals"][number]["basis"],
                                  })
                                }
                              >
                                <option value="monthly">Monthly</option>
                                <option value="annual">Annual</option>
                              </select>
                            </label>}
                            <DraftField
                              label="Target date (optional)"
                              type="date"
                              value={goal?.date ?? ""}
                              onChange={(value) =>
                                stageNamedGoal(row.name, row.metric, {
                                  date: value,
                                })
                              }
                            />
                          </div>
                          <div className="pw-progress-comparison">
                            <div>
                              <span>{row.metric === "activeClinicalHeadcount" ? "Active clinical headcount" : "Current monthly pre-tax measure"}</span>
                              <strong>{fmt(expected, unit)}</strong>
                            </div>
                            <div>
                              <span>Goal line</span>
                              <strong>{fmt(target, unit)}</strong>
                            </div>
                            <MetricTargetBar
                              value={expected ?? null}
                              valueLabel="Projected"
                              goal={target || null}
                              benchmark={
                                recordedFinancialPeriods[0]?.values[row.metric]
                              }
                            />
                            <small>
                              {completedGoalStatus(goal, expected, target)}
                            </small>
                          </div>
                        </section>
                      );
                    })}
                    <section className="pw-edit-item">
                      <div className="pw-edit-item-heading">
                        <div>
                          <h3>Overhead</h3>
                          <p>
                            Keep dollars fixed or manage percent-of-revenue
                            expenses in Money; this shows the calculated
                            equivalent for the selected month.
                          </p>
                        </div>
                      </div>
                      <div className="pw-edit-grid">
                        <DraftField
                          label="Fixed monthly overhead"
                          type="number"
                          value={workingWorkspace.settings.overheadFloorMonthly}
                          onChange={(value) =>
                            stageSettings(
                              {
                                overheadFloorMonthly:
                                  optionalNumber(value) ?? 0,
                                overheadMode: "baseline",
                              },
                              "Overhead goal",
                            )
                          }
                        />
                        <label className="pw-draft-field">
                          <span>Basis</span>
                          <select
                            aria-label="Overhead basis"
                            value={workingWorkspace.settings.overheadMode}
                            onChange={(event) =>
                              stageSettings(
                                {
                                  overheadMode: event.target
                                    .value as Workspace["settings"]["overheadMode"],
                                },
                                "Overhead basis",
                              )
                            }
                          >
                            <option value="baseline">Fixed dollars</option>
                            <option value="detailed">Entered expenses</option>
                          </select>
                        </label>
                        <div className="pw-readout">
                          <span>Calculated equivalent</span>
                          <strong>
                            {practiceRevenueForOverhead === null
                              ? "Waiting for revenue"
                              : `${practiceRevenueForOverhead.toFixed(1)}%`}
                          </strong>
                        </div>
                        <div className="pw-readout">
                          <span>Recorded monthly average</span>
                          <strong>{money(recordedOverheadAverage)}</strong>
                        </div>
                        <div className="pw-readout">
                          <span>Latest recorded overhead</span>
                          <strong>
                            {money(recordedOverheadValues[0] ?? null)}
                          </strong>
                        </div>
                      </div>
                    </section>
                    <section className="pw-edit-item">
                      <div className="pw-edit-item-heading">
                        <div>
                          <h3>Funds</h3>
                          <p>
                            Total-balance goals stay distinct from monthly
                            Profit First contribution shares. Blank balances
                            are assumed $0 until entered.
                          </p>
                        </div>
                        <button
                          className="pw-button"
                          onClick={() => setSection("money")}
                        >
                          Edit contributions
                        </button>
                      </div>
                      <div className="pw-goal-fund-grid">
                        {fundGoalRows.map((name) => {
                          const goal = findFundGoal(name);
                          const projection = fundProjection(goal);
                          return (
                            <div className="pw-goal-fund" key={name}>
                              <strong>{name}</strong>
                              <DraftField
                                label={`${name} total goal`}
                                type="number"
                                value={goal?.amount ?? 0}
                                onChange={(value) =>
                                  stageNamedFundGoal(name, {
                                    amount: optionalNumber(value) ?? 0,
                                  })
                                }
                              />
                              <DraftField
                                label="Target date (optional)"
                                type="date"
                                value={goal?.date ?? ""}
                                onChange={(value) =>
                                  stageNamedFundGoal(name, { date: value })
                                }
                              />
                              <DraftField
                                label="Current balance"
                                type="number"
                                value={goal?.currentBalance ?? ""}
                                onChange={(value) =>
                                  stageNamedFundGoal(name, {
                                    currentBalance: optionalNumber(value) ?? null,
                                  })
                                }
                              />
                              <DraftField
                                label="Balance date"
                                type="date"
                                value={goal?.balanceDate ?? ""}
                                onChange={(value) =>
                                  stageNamedFundGoal(name, {
                                    balanceDate: value,
                                  })
                                }
                              />
                              <small>
                                Current recorded balance:{" "}
                                {fmt(goal?.currentBalance ?? 0, "currency")}
                                {goal?.balanceDate
                                  ? ` as of ${goal.balanceDate}`
                                  : " when blank"}
                              </small>
                              <MetricTargetBar
                                value={goal?.currentBalance ?? 0}
                                goal={goal?.amount ?? 0}
                              />
                              <small>
                                Dotted projection:{" "}
                                {projection && projection.remaining <= 0
                                  ? "target already funded or no remaining gap"
                                  : projection?.contribution === null
                                  ? "add a matching monthly contribution in Money"
                                  : projection?.eta
                                    ? `${money(projection.contribution)} / month reaches the target around ${monthLabel(projection.eta)}`
                                    : projection
                                      ? "waiting for a positive monthly contribution"
                                      : "waiting for a target"}
                              </small>
                            </div>
                          );
                        })}
                      </div>
                    </section>
                  </div>
                  <div className="pw-secondary-links">
                    {detailButton("goals", "All metric targets")}
                    {detailButton("allocations", "Fund contribution records")}
                  </div>
                </>
              )}
              {section === "settings" && (
                <>
                  <Settings {...props} />
                  <a
                    className="pw-text-button"
                    href={`${import.meta.env.BASE_URL}reference`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Original layout for reference
                    <ChevronRight />
                  </a>
                </>
              )}
              {section === "documents" && !sandbox && (
                <>
                  <button
                    className="pw-text-button"
                    onClick={() => setSection("summary")}
                  >
                    Back to Overview
                  </button>
                  <Updates {...props} theme="light" />
                </>
              )}
            </div>
          </>
        )}
        {mode === "goals" && !draft && visibleTool && (
          <div className="pw-content">
            <div className="pw-integrated-tool">
              {toolNotice && <p className="pw-tool-notice">{toolNotice}</p>}
              <IntegratedToolContent
                tool={visibleTool}
                teamId={workspace.settings.teamId}
              />
            </div>
          </div>
        )}
        {mode === "goals" && !draft && (
          <div className="pw-content" hidden={!!visibleTool}>
            <div className="pw-section-heading">
              <div>
                <h2>Saved scenarios</h2>
                <p>
                {goals.length} Practice workspace {goals.length === 1 ? "version" : "versions"} · {Array.isArray(legacyScenarioQuery.data) ? legacyScenarioQuery.data.length : 0} existing compensation scenarios
                </p>
              </div>
            </div>
            <section className="pw-legacy-plans" aria-label="Existing compensation plans">
              <h3>Existing compensation plans</h3>
              {legacyScenarioQuery.isError && <p className="pw-error">Existing scenarios could not be loaded. Your saved records have not been changed.</p>}
              <div className="pw-edit-list">
                {(Array.isArray(legacyScenarioQuery.data) ? legacyScenarioQuery.data : []).map((scenario) => <article className="pw-edit-item" key={scenario.id}><h3>{scenario.name}</h3><p>{teams.data?.find((team) => team.id === scenario.businessGoalId)?.name ?? "Existing compensation scenario"}</p>{scenario.notes && <p>{scenario.notes}</p>}<button className="pw-text-button" onClick={() => showTool("scenarios")}>Review existing scenario <ChevronRight /></button></article>)}
              </div>
              <details><summary>Existing compensation targets</summary>{(teams.data ?? []).map((team) => <div className="pw-overview-total" key={team.id}><span>{team.name}</span><strong>{money(team.ownerPayGoal)} annual owner target · {fmt(team.desiredCliniciansCount)} clinicians</strong></div>)}<button className="pw-text-button" onClick={() => showTool("business-goals")}>Review compensation targets <ChevronRight /></button></details>
            </section>
            <section className="pw-focused-plans" aria-label="Focused plan options">
              <div className="pw-section-heading">
                <div>
                  <h3>Modeled alternatives</h3>
                  <p>
                    Ranked from saved Long Term Goals using the forecasted
                    endpoint versus Today. Assumptions stay visible before any
                    adoption.
                  </p>
                </div>
              </div>
              {modeledGoalOptions.length ? (
                <div className="pw-focused-plan-grid">
                  {modeledGoalOptions.slice(0, 3).map((option, index) => (
                    <article className="pw-focused-plan" key={option.goal.id}>
                      <span className="pw-tag">Rank {index + 1}</span>
                      <h4>{option.goal.name}</h4>
                      <strong>{option.focusKpis.join(" + ")}</strong>
                      <ul className="pw-assumption-list">
                        {option.assumptions.map((assumption) => (
                          <li key={assumption}>{assumption}</li>
                        ))}
                      </ul>
                      <MetricTargetBar
                        value={option.projected?.values.profit ?? null}
                        goal={workingWorkspace.settings.targetProfitMonthly}
                        benchmark={endpoint?.values.profit ?? null}
                      />
                      <small>
                        Saved{" "}
                        {new Date(option.snapshot.savedAt).toLocaleDateString()}{" "}
                        ·{" "}
                        {option.revisionState === "current"
                          ? `adopted ${new Date(option.adoption!.adoptedAt).toLocaleDateString()}`
                          : option.revisionState === "needs_refresh"
                            ? "adopted assumptions changed; refresh review"
                            : "not adopted"}
                      </small>
                      {option.adoption && (
                        <div className="pw-plan-adoption">
                          <span>Adopted focus</span>
                          <strong>{option.adoption.focusKpis.join(" + ")}</strong>
                          <small>{option.adoption.highlights.join("; ")}</small>
                        </div>
                      )}
                      <button
                        className="pw-button"
                        onClick={() => openGoal(option.goal)}
                      >
                        Review model
                        <ChevronRight />
                      </button>
                      <button
                        className="pw-text-button"
                        disabled={saving}
                        onClick={() =>
                          void adoptLongTermPlan(
                            option.goal,
                            option.focusKpis,
                            option.focusHighlights,
                            option.assumptionSignature,
                          ).catch((e) => setError(errorText(e)))
                        }
                      >
                        {option.revisionState === "current"
                          ? "Refresh adoption"
                          : option.revisionState === "needs_refresh"
                            ? "Re-adopt updated assumptions"
                            : "Adopt plan"}
                        <ChevronRight />
                      </button>
                    </article>
                  ))}
                </div>
              ) : (
                <div className="pw-focused-plan-grid">
                  {focusedPlans.map((plan, index) => (
                    <article className="pw-focused-plan" key={plan.name}>
                      <span className="pw-tag">Starting point {index + 1}</span>
                      <h4>{plan.name}</h4>
                      <strong>{plan.focus}</strong>
                      <p>{plan.reason}</p>
                      <small>{plan.action}</small>
                      <button
                        className="pw-button"
                        onClick={() => {
                          setMode("practice");
                          setSection(plan.target);
                        }}
                      >
                        Review inputs
                        <ChevronRight />
                      </button>
                    </article>
                  ))}
                </div>
              )}
              <p className="pw-note">
                Existing goals remain active until manually changed, even after
                a completed period meets the target.
              </p>
            </section>
            {!goals.length ? (
              <div className="pw-empty pw-goal-empty">
                <Flag />
                <h3>No scenarios yet</h3>
                <button
                  className="pw-button pw-primary"
                  onClick={startPlanning}
                >
                  Create scenario
                  <ArrowRight />
                </button>
              </div>
            ) : (
              <div className="pw-goals">
                {goals.map(({ goal, snapshot }) => {
                  const projected = forecast(
                    snapshot.workspace,
                    snapshot.context,
                  ).at(-1);
                  return (
                    <article className="pw-goal" key={goal.id}>
                      <Flag />
                      <div>
                        <h3>{goal.name}</h3>
                        <p>
                          {monthLabel(
                            snapshot.workspace.settings.forecastStart,
                          )}{" "}
                          to {projected ? monthLabel(projected.date) : "--"}
                        </p>
                        <small>
                          Saved{" "}
                          {new Date(snapshot.savedAt).toLocaleDateString()}
                        </small>
                      </div>
                      <div>
                        <span>Estimated revenue</span>
                        <strong>
                          {money(projected?.values.revenue)}
                          <small> / month</small>
                        </strong>
                      </div>
                      <div>
                        <span>Estimated profit</span>
                        <strong>
                          {money(projected?.values.profit)}
                          <small> / month</small>
                        </strong>
                      </div>
                      <button
                        className="pw-button"
                        onClick={() => openGoal(goal)}
                      >
                        Explore
                        <ArrowRight />
                      </button>
                    </article>
                  );
                })}
              </div>
            )}
            <div className="pw-secondary-links">
              {detailButton("goals", "Metric targets")}
              <a href="/hub/plans" target="_blank" rel="noreferrer">
                Existing plans &amp; approvals
                <ChevronRight />
              </a>
            </div>
          </div>
        )}
        {planningEdit && !visibleTool && (
          <aside
            className="pw-impact"
            aria-label="Scenario endpoint comparison"
          >
            <div className="pw-impact-heading">
              <span>
                <ChartNoAxesCombined />
                Scenario endpoint vs starting plan /{" "}
                {endpoint ? monthLabel(endpoint.date) : "end of scenario"}
              </span>
              <button
                className="pw-text-button"
                onClick={() => setChangeDetails((v) => !v)}
              >
                Review {comparisonChanges.length}{" "}
                {comparisonChanges.length === 1 ? "change" : "changes"}
                <ChevronRight />
              </button>
            </div>
            <div className="pw-impact-values">
              {metrics.map((m) => {
                const before = baselineEndpoint?.values[m.key];
                const after = endpoint?.values[m.key];
                return (
                  <div key={m.key}>
                    <span>{m.label} / month</span>
                    <div className="pw-impact-comparison">
                      <small>
                        <span>Starting plan</span>
                        {money(before)}
                      </small>
                      <ArrowRight />
                      <strong>
                        <span>Current scenario</span>
                        {money(after)}
                      </strong>
                    </div>
                    {before != null && after != null && (
                      <em>
                        Change: {after - before >= 0 ? "+" : ""}
                        {money(after - before)}
                      </em>
                    )}
                    {m.key === "profit" && after != null && after < 0 && (
                      <small>Practice still runs at a loss.</small>
                    )}
                    {m.key === "profit" && baselineEndpoint && endpoint && (
                      <small>
                        Operating costs:{" "}
                        {money(
                          operatingCost(
                            baselineEndpoint.values,
                            base?.workspace.settings.ownerPayrollBurdenPct ?? 0,
                          ),
                        )}{" "}
                        to{" "}
                        {money(
                          operatingCost(
                            endpoint.values,
                            workspace.settings.ownerPayrollBurdenPct,
                          ),
                        )}
                      </small>
                    )}
                    {m.key === "familyTakeHome" &&
                      before === after &&
                      (endpoint?.values.profit ?? 0) < 0 && (
                        <small>Planned owner pay is unchanged.</small>
                      )}
                  </div>
                );
              })}
            </div>
            {changeDetails && (
              <div className="pw-changes">
                {comparisonChanges.length ? (
                  comparisonChanges.map((c, i) => (
                    <div key={i}>
                      <span>{c.label}</span>
                      <small>
                        {typeof c.before === "object"
                          ? "Previous"
                          : String(c.before ?? "None")}
                      </small>
                      <ArrowRight />
                      <strong>
                        {typeof c.after === "object"
                          ? "Updated"
                          : String(c.after ?? "None")}
                      </strong>
                    </div>
                  ))
                ) : (
                  <p>No changes yet.</p>
                )}
              </div>
            )}
          </aside>
        )}
        {stagedWorkspace && (
          <aside className="pw-staged" aria-label="Pending practice edits">
            <div className="pw-staged-top">
              <strong>
                {stagedDifferences.length} pending{" "}
                {stagedDifferences.length === 1 ? "change" : "changes"}
              </strong>
              <span>These edits are not saved yet.</span>
              <button
                className="pw-button"
                type="button"
                onClick={() => setReviewStaged((open) => !open)}
              >
                {reviewStaged ? "Hide review" : "Review changes"}
              </button>
              <button
                className="pw-button"
                type="button"
                onClick={() => {
                  setStagedWorkspace(null);
                  setStagedLabels({});
                  setReviewStaged(false);
                }}
              >
                Discard
              </button>
            </div>
            {reviewStaged && (
              <div className="pw-staged-review">
                <div>
                  <h3>What changed</h3>
                  <ul>
                    {stagedDifferences.map((change, index) => (
                      <li key={index}>
                        <strong>{change.label}</strong>
                        <span>
                          {changeValue(change.before)} →{" "}
                          {changeValue(change.after)}
                        </span>
                      </li>
                    ))}
                  </ul>
                  {stagedValidation && !stagedValidation.success && (
                    <div className="pw-error" role="alert">
                      {stagedValidation.error.issues
                        .slice(0, 5)
                        .map((issue) => (
                          <p key={issue.path.join(".")}>
                            {issue.path.join(".")}: {issue.message}
                          </p>
                        ))}
                    </div>
                  )}
                </div>
                <div>
                  <h3>Estimated monthly effect</h3>
                  {(
                    [
                      "revenue",
                      "overhead",
                      "marketing",
                      "fees",
                      "profit",
                      "familyTakeHome",
                    ] as const
                  ).map((key) => {
                    const before =
                      savedMonths[
                        Math.min(moneyMonthIndex, savedMonths.length - 1)
                      ]?.values[key];
                    const after = stagedMonths.find(
                      (row) =>
                        row.date ===
                        savedMonths[
                          Math.min(moneyMonthIndex, savedMonths.length - 1)
                        ]?.date,
                    )?.values[key];
                    return (
                      <div className="pw-staged-effect" key={key}>
                        <span>
                          {key === "familyTakeHome"
                            ? "Planned family take-home"
                            : key}
                        </span>
                        <span>
                          {money(before)} <ArrowRight /> {money(after)}
                        </span>
                      </div>
                    );
                  })}
                </div>
                <button
                  className="pw-button pw-primary"
                  type="button"
                  disabled={
                    saving ||
                    !stagedValidation?.success ||
                    !stagedDifferences.length
                  }
                  onClick={() => void commitStaged()}
                >
                  <Save />
                  Save changes
                </button>
              </div>
            )}
          </aside>
        )}
        <footer className="pw-status" aria-live="polite">
          <span>
            {saving
              ? "Saving..."
              : visibleTool
                ? visibleTool === "team"
                  ? "Team changes save to Today"
                  : visibleTool === "compensation-model"
                    ? "Changes here save to the linked compensation plan"
                    : "Saved compensation records"
                : message ||
                  (sandbox
                    ? planningEdit
                      ? "Today is unchanged"
                      : "Sandbox only"
                    : "Today")}
          </span>
          {!visibleTool &&
            months.some((m) => m.warnings.length > 0) &&
            (mode !== "goals" || planningEdit) && (
              <details>
                <summary>Forecast checks</summary>
                {[...new Set(months.flatMap((m) => m.warnings))].map((w) => (
                  <p key={w}>{w}</p>
                ))}
              </details>
            )}
        </footer>
      </main>
      <Dialog
        open={transferOpen}
        onOpenChange={(open) => {
          setTransferOpen(open);
          if (!open) setTransferFile(null);
        }}
      >
        <DialogContent
          className="practice-theme pw-save-dialog"
          data-appearance="light"
        >
          <DialogHeader>
            <DialogTitle>Move section data</DialogTitle>
            <DialogDescription>
              Export a section here, then import it in Today, Long Term Goals, or
              Sandbox. Import replaces only the selected section. Recorded
              sessions and clinician records cannot be replaced in Today.
            </DialogDescription>
          </DialogHeader>
          <label className="pr-field">
            Section
            <select
              value={transferSection}
              onChange={(event) => {
                setTransferSection(event.target.value as TransferSection);
                setTransferFile(null);
              }}
            >
              <option value="clinicians">Clinicians &amp; pay</option>
              <option value="sessions">Sessions</option>
              <option value="marketing">Marketing</option>
              <option value="rooms">Rooms</option>
              <option value="budgets">Budgets</option>
              <option value="money">Money flow</option>
            </select>
          </label>
          <button className="pw-button" onClick={downloadSection}>
            <Download /> Export section
          </button>
          <label className="pr-field">
            Import section file
            <input
              type="file"
              accept="application/json,.json"
              onChange={(event) =>
                void readTransferFile(event.target.files?.[0])
              }
            />
          </label>
          {transferFile && (
            <div className="pw-transfer-preview">
              <strong>
                {transferFile.section} from {transferFile.source}
              </strong>
              <span>
                Exported {new Date(transferFile.exportedAt).toLocaleString()}
              </span>
              <span>
                {[
                  ...Object.entries(transferFile.workspace),
                  ...Object.entries(transferFile.context),
                ]
                  .filter(([, rows]) => Array.isArray(rows))
                  .map(
                    ([name, rows]) => `${name}: ${(rows as unknown[]).length}`,
                  )
                  .join(", ")}
              </span>
              <span>
                Will replace {transferFile.section} in{" "}
                {mode === "practice"
                  ? "Today"
                  : mode === "goals"
                    ? "this Long Term Goals scenario"
                    : "Sandbox"}
                . Other sections stay as they are.
              </span>
              {mode === "practice" &&
                (transferSection === "marketing" ||
                  transferSection === "money") && (
                  <span>
                    Recorded marketing and financial history in Today will stay
                    unchanged.
                  </span>
                )}
              {mode !== "practice" && (
                <span>Save the scenario afterward to keep this change.</span>
              )}
              <button
                className="pw-button pw-primary"
                disabled={saving || !!stagedWorkspace}
                onClick={() => void applyTransfer()}
              >
                <Upload /> Replace section
              </button>
            </div>
          )}
          {error && (
            <p className="pw-error" role="alert">
              {error}
            </p>
          )}
        </DialogContent>
      </Dialog>
      <Dialog open={exportOpen} onOpenChange={setExportOpen}>
        <DialogContent
          className="practice-theme pw-export-dialog"
          data-appearance="light"
        >
          <DialogHeader>
            <DialogTitle>Compensation reports</DialogTitle>
            <DialogDescription>
              Reports use saved compensation records, not unsaved Long Term Goals or
              Sandbox changes.
            </DialogDescription>
          </DialogHeader>
          <PDFExportTab />
        </DialogContent>
      </Dialog>
      {editor && (
        <RecordEditor
          key={editor.record.id as string}
          {...editor}
          workspace={workspace}
          context={context}
          theme="light"
          onClose={() => setEditor(null)}
          onSave={async (record, corrections) => {
            const list = workspace[editor.collection];
            let next = {
              ...workspace,
              [editor.collection]: list.some((r) => r.id === record.id)
                ? list.map((r) => (r.id === record.id ? record : r))
                : [...list, record],
            };
            if (corrections)
              next = {
                ...next,
                periods: next.periods.map((p) =>
                  corrections[p.id]
                    ? { ...p, correctionReason: corrections[p.id] }
                    : p,
                ),
              };
            await saveWorkspace(
              next as Workspace,
              "Updated " + editor.collection,
            );
            setEditor(null);
          }}
        />
      )}
      {settings && (
        <SettingsEditor
          section={settings}
          workspace={workspace}
          context={context}
          theme="light"
          onClose={() => setSettings(null)}
          onSave={async (data) => {
            await saveWorkspace(data);
            setSettings(null);
          }}
        />
      )}
      {detail && (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open) setDetail(null);
          }}
        >
          <DialogContent
            className="practice-theme pw-detail-dialog"
            data-appearance="light"
          >
            <DialogHeader>
              <DialogTitle>{detail.replaceAll("_", " ")}</DialogTitle>
              <DialogDescription>
                {planningEdit
                  ? "Long Term Goals settings"
                  : sandbox
                    ? "Sandbox settings"
                    : "Today settings"}
              </DialogDescription>
            </DialogHeader>
            {table(detail)}
          </DialogContent>
        </Dialog>
      )}
      <Dialog open={sandboxLibraryOpen} onOpenChange={setSandboxLibraryOpen}>
        <DialogContent
          className="practice-theme pw-save-dialog"
          data-appearance="light"
        >
          <DialogHeader>
            <DialogTitle>Saved Sandbox models</DialogTitle>
            <DialogDescription>
              Independent models stay separate from Today and Long Term Goals.
            </DialogDescription>
          </DialogHeader>
          {sandboxModels.length ? (
            sandboxModels.map(({ model, snapshot }) => (
              <button
                className="pw-saved-model"
                key={model.id}
                onClick={() => openSandboxModel(model)}
              >
                <strong>{model.name}</strong>
                <span>
                  Saved {new Date(snapshot.savedAt).toLocaleDateString()}
                </span>
                <ArrowRight />
              </button>
            ))
          ) : (
            <p>No saved models yet.</p>
          )}
          {error && (
            <p className="pw-error" role="alert">
              {error}
            </p>
          )}
          <button
            className="pw-button"
            onClick={() => {
              setSandboxLibraryOpen(false);
              setResetDialog(true);
            }}
          >
            <Plus /> Start blank model
          </button>
        </DialogContent>
      </Dialog>
      <Dialog
        open={sandboxDialog}
        onOpenChange={(open) => {
          if (!saving) {
            setSandboxDialog(open);
            if (!open) pendingSandboxModel.current = null;
          }
        }}
      >
        <DialogContent
          className="practice-theme pw-save-dialog"
          data-appearance="light"
        >
          <DialogHeader>
            <DialogTitle>Save Sandbox model</DialogTitle>
            <DialogDescription>
              This keeps a copy in Sandbox. Today and Long Term Goals stay unchanged.
            </DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void saveSandboxModel();
            }}
          >
            <label className="pr-field">
              Model name
              <input
                autoFocus
                required
                maxLength={120}
                placeholder="e.g. Second location"
                value={sandboxName}
                disabled={!!pendingSandboxModel.current}
                onChange={(event) => setSandboxName(event.target.value)}
              />
            </label>
            {error && (
              <p className="pw-error" role="alert">
                {error}
              </p>
            )}
            <button
              className="pw-button pw-primary"
              disabled={saving || !sandboxName.trim()}
            >
              <Save />{" "}
              {saving ? "Saving..." : sandboxId ? "Update model" : "Save model"}
            </button>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog
        open={goalDialog}
        onOpenChange={(open) => {
          if (!saving && !pending.current) {
            setGoalDialog(open);
            if (!open) pendingGoal.current = null;
          }
        }}
      >
        <DialogContent
          className="practice-theme pw-save-dialog"
          data-appearance="light"
        >
          <DialogHeader>
            <DialogTitle>
              {planningEdit ? "Save scenario" : "Send model to Long Term Goals"}
            </DialogTitle>
            <DialogDescription>Today stays unchanged.</DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void saveGoal();
            }}
          >
            <label className="pr-field">
              Scenario name
              <input
                autoFocus
                required
                maxLength={120}
                placeholder="e.g. Three-room expansion"
                value={goalName}
                disabled={!!pendingGoal.current}
                onChange={(e) => setGoalName(e.target.value)}
              />
            </label>
            <p>
              {changes.length} changes / {workspace.settings.horizonMonths}{" "}
              months
            </p>
            {error && (
              <p className="pw-error" role="alert">
                {error}
              </p>
            )}
            <button
              className="pw-button pw-primary"
              disabled={saving || !goalName.trim()}
            >
              <Flag />
              {saving
                ? "Saving..."
                : pendingGoal.current
                  ? "Retry save"
                  : "Save scenario"}
            </button>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog open={resetDialog} onOpenChange={setResetDialog}>
        <DialogContent
          className="practice-theme pw-save-dialog"
          data-appearance="light"
        >
          <DialogHeader>
            <DialogTitle>
              {planningEdit
                ? "Discard scenario edits?"
                : "Start a blank Sandbox again?"}
            </DialogTitle>
            <DialogDescription>
              Unsaved changes will be discarded. Saved scenarios remain.
            </DialogDescription>
          </DialogHeader>
          <button
            className="pw-button pw-primary"
            onClick={() => {
              if (planningEdit) {
                setDraft(null);
                setDraftMode(null);
                setBase(null);
                setDraftStart(null);
                setPlanningId(null);
                setMode("goals");
              } else startSandbox();
              setResetDialog(false);
            }}
          >
            {planningEdit ? "Discard changes" : "Reset Sandbox"}
          </button>
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!archiveTarget}
        onOpenChange={(open) => {
          if (!open && !saving) setArchiveTarget(null);
        }}
      >
        <DialogContent
          className="practice-theme pw-save-dialog"
          data-appearance="light"
        >
          <DialogHeader>
            <DialogTitle>Change archive status?</DialogTitle>
            <DialogDescription>
              The record and its history will be retained.
            </DialogDescription>
          </DialogHeader>
          <button
            className="pw-button pw-primary"
            disabled={saving}
            onClick={async () => {
              if (!archiveTarget) return;
              const record = workspace[archiveTarget.collection].find(
                (r) => r.id === archiveTarget.id,
              );
              if (!record) return;
              try {
                await patchRecord(
                  archiveTarget.collection,
                  archiveTarget.id,
                  "archived" in record
                    ? { archived: !record.archived }
                    : {
                        status:
                          "status" in record && record.status === "archived"
                            ? "active"
                            : "archived",
                      },
                );
                setArchiveTarget(null);
              } catch (e) {
                setError(errorText(e));
              }
            }}
          >
            Confirm
          </button>
        </DialogContent>
      </Dialog>
    </div>
  );
}
