import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  customFetch,
  useListBusinessGoals,
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
} from "recharts";
import {
  forecast,
  referencedClinicianIds,
  observed,
  observedSeries,
  workspaceSchema,
  budgetSchema,
  categorySchema,
  roomSchema,
  campaignSchema,
  clinicianSettingSchema,
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
import { newRecord } from "@/components/hub/config";
import RecordEditor from "@/components/hub/record-editor";
import RecordTable from "@/components/hub/record-table";
import Settings, { SettingsEditor } from "@/components/hub/settings";
import Updates from "@/components/hub/updates";
import { type ViewProps, fmt, monthLabel } from "@/components/hub/views";
import WorkspaceSessions from "@/components/practice/workspace-sessions";
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
  | "marketing"
  | "rooms"
  | "budgets"
  | "money"
  | "summary"
  | "settings"
  | "documents";
const sections: { id: Section; label: string }[] = [
  { id: "clinicians", label: "Clinicians & pay" },
  { id: "sessions", label: "Sessions" },
  { id: "marketing", label: "Marketing" },
  { id: "rooms", label: "Rooms" },
  { id: "budgets", label: "Budgets" },
  { id: "money", label: "Money flow" },
  { id: "summary", label: "Summary" },
];
const money = (n: number | null | undefined) => fmt(n, "currency");
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
  value: string | number;
  onChange: (value: string) => void;
  type?: "text" | "number" | "date";
  min?: number;
  max?: number;
  step?: number;
}) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
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
            (!text.trim() ||
              !Number.isFinite(Number(text)) ||
              Number(text) < (min ?? 0) ||
              Number(text) > (max ?? Infinity))
          )
            setText(String(value));
          else if (text !== String(value)) onChange(text);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
          if (event.key === "Escape") setText(String(value));
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

export default function PracticeWorkspace() {
  const cache = useQueryClient();
  const query = useQuery({ queryKey: hubKey, queryFn: getHub });
  const contextQuery = useQuery({
    queryKey: ["hub-context"],
    queryFn: getContext,
  });
  const teams = useListBusinessGoals();
  const [mode, setMode] = useState<Mode>("practice");
  const [integratedTool, setIntegratedTool] = useState<IntegratedTool | null>(
    null,
  );
  const [exportOpen, setExportOpen] = useState(false);
  const [practiceView] = useState<PracticeView>("actual");
  const [section, setSection] = useState<Section>("clinicians");
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
  const [marketingTab, setMarketingTab] = useState("campaigns");
  const [moneyMonthIndex, setMoneyMonthIndex] = useState(0);
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
  const today = new Date().toLocaleDateString("en-CA");
  const sandbox = mode === "sandbox" || (mode === "goals" && !!draft);
  const planningEdit = mode === "goals" && !!draft;
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
  const planProjection = useMemo(
    () =>
      savedResolved && contextQuery.data
        ? buildPracticeProjection(
            savedResolved.forecastWorkspace,
            contextQuery.data,
            "plan",
            today,
          )
        : null,
    [savedResolved, contextQuery.data, today],
  );
  const viewProjection = useMemo(
    () =>
      sandbox
        ? null
        : practiceView === "plan"
          ? planProjection
          : forecastWorkspace && context
            ? buildPracticeProjection(
                forecastWorkspace,
                context,
                "actual",
                today,
              )
            : null,
    [sandbox, practiceView, planProjection, forecastWorkspace, context, today],
  );
  const savedMonths = useMemo(
    () =>
      sandbox && forecastWorkspace && context
        ? forecast(forecastWorkspace, context)
        : (viewProjection?.months ?? []),
    [sandbox, forecastWorkspace, context, viewProjection],
  );
  const stagedValidation = useMemo(
    () => (stagedWorkspace ? workspaceSchema.safeParse(stagedWorkspace) : null),
    [stagedWorkspace],
  );
  const stagedMonths = useMemo(() => {
    if (!stagedValidation?.success || !context) return [];
    const next = resolveWorkspaceDefaults(
      stagedValidation.data,
      context,
      teams.data,
    ).forecastWorkspace;
    return sandbox
      ? forecast(next, context)
      : buildPracticeProjection(next, context, practiceView, today).months;
  }, [stagedValidation, context, teams.data, sandbox, practiceView, today]);
  const months = stagedValidation?.success ? stagedMonths : savedMonths;
  const moneyFlowWorkspace = useMemo(
    () =>
      stagedValidation?.success && context
        ? resolveWorkspaceDefaults(stagedValidation.data, context, teams.data).forecastWorkspace
        : forecastWorkspace,
    [stagedValidation, context, teams.data, forecastWorkspace],
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
      workspace && context
        ? observedSeries(workspace, context).sort((a, b) =>
            b.date.localeCompare(a.date),
          )
        : [],
    [workspace, context],
  );
  const moneyYtd = useMemo(
    () =>
      workspace && context
        ? observed(workspace, context, today.slice(0, 4) + "-01-01", today)
        : null,
    [workspace, context, today],
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
    if (!workspace || !context) return [];
    if (paceMetric !== "sessions")
      return recordedFinancialPeriods.map((row) => ({
        date: row.date,
        value: row.values[paceMetric] ?? null,
      }));
    const selectedIds = new Set(
      context.clinicians
        .filter((c) => (c.goalId ?? null) === workspace.settings.teamId)
        .map((c) => c.id),
    );
    const periods = new Map<
      string,
      { date: string; days: number; value: number }
    >();
    for (const record of context.sessions.filter((r) =>
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
  }, [workspace, context, paceMetric, recordedFinancialPeriods]);
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
  type InlineCollection =
    | "budgets"
    | "campaigns"
    | "rooms"
    | "clinicians"
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
  function stageFamilyPaycheck(
    id: string,
    next: Workspace["familyPaychecks"][number] | null,
  ) {
    if (!workspace) return;
    setStagedWorkspace((prior) => {
      const current = prior ?? workspace;
      return {
        ...current,
        familyPaychecks: next === null
          ? current.familyPaychecks.filter((item) => item.id !== id)
          : current.familyPaychecks.some((item) => item.id === id)
            ? current.familyPaychecks.map((item) => item.id === id ? next : item)
            : [...current.familyPaychecks, next],
      };
    });
    setStagedLabels((prior) => ({ ...prior, ["familyPaychecks:" + id]: "Net paycheck" }));
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
      : defaults.filter(([, , share]) => share > 0).map(([label, purpose, share]) =>
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
  function stageNew(collection: InlineCollection) {
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
        start: today,
      });
    } else if (collection === "campaigns") {
      record = campaignSchema.parse({
        ...newRecord("campaigns", current, today),
        name: "New campaign",
        source: "New source",
        start: today,
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
  function stageMarketingSupport() {
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
      start: today,
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
  function stageClinicianAverageRate(person: Clinician, rate: number | null) {
    if (!workingWorkspace) return;
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
      start: context?.sessions
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
      ["clinicians:" + record.id]: person.label + " expected average session revenue",
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
      setMessage("Sandbox model saved. Today and Planning are unchanged.");
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
        "Save this scenario to Planning or discard its changes before opening another workspace.",
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
        `${transferSection} copied into ${mode === "practice" ? "Today" : mode === "goals" ? "Planning" : "Sandbox"}.`,
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
          { id: null, label: "Scenarios" },
          { id: "business-goals", label: "Compensation targets" },
          { id: "compensation-model", label: "Compensation model" },
        ]
      : sandbox
        ? [{ id: null, label: planningEdit ? "Scenario" : "Working copy" }]
        : section === "clinicians"
          ? [
              { id: null, label: "Clinicians" },
              { id: "team", label: "Team details" },
              { id: "impact", label: "Pay comparison" },
            ]
          : section === "summary"
            ? [
                { id: null, label: "Summary" },
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
          ? "Changes to this compensation model save to its linked team and business goal. Use Sandbox to test changes without saving them to the plan."
          : null;
  const people = selectedPeople;
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

  return (
    <div className="practice-theme pw-app" data-appearance="light">
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
        <nav aria-label="Main navigation">
          {(
            [
              { id: "practice", label: "Today", icon: Building2 },
              { id: "goals", label: "Planning", icon: Flag },
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
                  ? "Your scenarios"
                  : "Current business"}
            </div>
            <h1>
              {mode === "sandbox"
                ? "Sandbox"
                : mode === "goals"
                  ? "Planning"
                  : "Today"}
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
                  {section !== "summary" &&
                    section !== "settings" &&
                    section !== "documents" && (
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
                        <Flag /> Copy to Planning
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
                {section !== "summary" &&
                  section !== "settings" &&
                  section !== "documents" && (
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
        {mode === "practice" && !visibleTool && (
          <div className="pw-view-bar">
            <span>
              {recordedClinicianCount
                ? `${recordedClinicianCount} of ${viewProjection?.clinicianPace.length ?? 0} clinicians recorded in the last 8 weeks; gaps use desired sessions`
                : "No sessions recorded in the last 8 weeks; using desired sessions"}
            </span>
          </div>
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
            {(!sandbox || !visibleTool) && (
              <nav
                className="pw-sections"
                aria-label={sandbox ? "Sandbox sections" : "Practice sections"}
              >
                {sections.map((s) => (
                  <button
                    key={s.id}
                    aria-current={section === s.id ? "page" : undefined}
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
                  Starting
                  <input
                    type="date"
                    aria-label={
                      planningEdit ? "Scenario start" : "Sandbox start"
                    }
                    value={workspace.settings.forecastStart}
                    onChange={(e) => {
                      if (e.target.value)
                        void saveWorkspace({
                          ...workspace,
                          settings: {
                            ...workspace.settings,
                            forecastStart: e.target.value,
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
              {section === "clinicians" && (
                <>
                  {heading(
                    "Clinicians & pay",
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
                              label={person.label + " expected average revenue per completed session"}
                              caption="Avg. earned / session"
                              value={setting?.expectedSessionRevenue ?? person.sessionRate}
                              unit="$"
                              onSave={async (rate) => stageClinicianAverageRate(person, rate)}
                            />
                          </div>
                          {setting?.expectedSessionRevenue !== null && setting?.expectedSessionRevenue !== undefined && (
                            <button className="pw-text-button" onClick={() => stageClinicianAverageRate(person, null)}>
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
                <WorkspaceSessions
                  key={mode + "-" + workspace.settings.teamId}
                  context={context}
                  teamId={workspace.settings.teamId}
                  sandbox={sandbox}
                  onEditingChange={setSessionEditing}
                  onSaved={async () => {
                    await contextQuery.refetch();
                    void cache.invalidateQueries({
                      queryKey: ["session-records"],
                    });
                  }}
                />
              )}
              {section === "marketing" && (
                <>
                  {heading(
                    "Marketing",
                    "Ad spend drives lead estimates. Service costs complete the marketing total.",
                    <button
                      className="pw-button"
                      onClick={() => stageNew("campaigns")}
                    >
                      <Plus />
                      Add campaign
                    </button>,
                  )}
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
                  <div
                    className="pw-segmented"
                    role="tablist"
                    aria-label="Marketing view"
                  >
                    {["campaigns", "results"].map((t) => (
                      <button
                        key={t}
                        role="tab"
                        aria-selected={marketingTab === t}
                        onClick={() => setMarketingTab(t)}
                      >
                        {t === "campaigns"
                          ? "Campaigns & estimates"
                          : "Recorded results"}
                      </button>
                    ))}
                  </div>
                  {marketingTab === "campaigns" ? (
                    <div className="pw-edit-list">
                      {active(workingWorkspace.campaigns).map((c) => (
                        <section className="pw-edit-item" key={c.id}>
                          <div className="pw-edit-item-heading">
                            <h3>{c.name}</h3>
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
                                  c.name + " name",
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
                                  c.name + " source",
                                )
                              }
                            />
                            <label className="pw-draft-field">
                              <span>Estimate clients using</span>
                              <select
                                value={c.method}
                                onChange={(event) =>
                                  stageRecord(
                                    "campaigns",
                                    c.id,
                                    { method: event.target.value },
                                    c.name + " estimate method",
                                  )
                                }
                              >
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
                                  { monthlySpend: Number(value) },
                                  c.name + " ad spend",
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
                                  { otherMonthlyCost: Number(value) },
                                  c.name + " support cost",
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
                                    { cpl: Number(value) },
                                    c.name + " cost per lead",
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
                                    { cac: Number(value) },
                                    c.name + " cost per client",
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
                                  { consultationPct: Number(value) },
                                  c.name + " consultation rate",
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
                                  { attendancePct: Number(value) },
                                  c.name + " attendance rate",
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
                                  { closePct: Number(value) },
                                  c.name + " close rate",
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
                                  { start: value },
                                  c.name + " start date",
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
                                  "Archived " + c.name,
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
                            onClick={stageMarketingSupport}
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
                      {sandbox ? (
                        <p className="pw-notice">
                          Recorded results stay in Today. Campaign estimates can
                          be adjusted above.
                        </p>
                      ) : (
                        <div className="pw-secondary-links">
                          {add("funnels", "Record results")}
                          {detailButton("periods", "Reporting periods")}
                        </div>
                      )}
                      <div className="pw-table-scroll">
                        <table className="pw-table">
                          <thead>
                            <tr>
                              <th>Period</th>
                              <th>Source</th>
                              <th>Leads</th>
                              <th>Consults</th>
                              <th>Clients</th>
                              <th>Close rate</th>
                              <th />
                            </tr>
                          </thead>
                          <tbody>
                            {workspace.funnels.map((f) => (
                              <tr key={f.id}>
                                <th>
                                  {workspace.periods.find(
                                    (p) => p.id === f.periodId,
                                  )?.name ?? "Period"}
                                </th>
                                <td>
                                  {
                                    workspace.campaigns.find(
                                      (c) => c.id === f.campaignId,
                                    )?.name
                                  }
                                </td>
                                <td>{fmt(f.leads)}</td>
                                <td>{fmt(f.attended)}</td>
                                <td>{fmt(f.clients)}</td>
                                <td>
                                  {f.attended && f.clients != null
                                    ? fmt(
                                        (f.clients / f.attended) * 100,
                                        "percent",
                                      )
                                    : "--"}
                                </td>
                                <td>
                                  {!sandbox && (
                                    <EditButton
                                      label="Edit recorded results"
                                      onClick={() => edit("funnels", f)}
                                    />
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </>
                  )}
                  {!active(workspace.campaigns).length && (
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
                          onClick={() => setSection("documents")}
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
                <MoneyFlowToday
                  workspace={moneyFlowWorkspace ?? workingWorkspace}
                  context={context}
                  today={today}
                  onPayeeChange={(id) => stageSettings({
                    familyW2ClinicianId: id,
                    ...(id !== null && resolved?.inherited.ownerPay ? { ownerPayrollMonthly: 0 } : {}),
                  }, "Family W2 paycheck")}
                  onAddPaycheck={(paycheck) => stageFamilyPaycheck(paycheck.id, paycheck)}
                  onUpdatePaycheck={(id, patch) => {
                    const previous = workingWorkspace.familyPaychecks.find((item) => item.id === id);
                    if (previous) stageFamilyPaycheck(id, { ...previous, ...patch });
                  }}
                  onRemovePaycheck={(id) => stageFamilyPaycheck(id, null)}
                  onAllocationPercent={(id, percent) => stageRecord("allocations", id, { percent }, "Fund allocation")}
                  onDefaultAllocationPercent={(key, percent) => stageSettings({ [key]: percent }, "Fund allocation")}
                  onAddFund={stageFund}
                  onEditFunds={() => setDetail("allocations")}
                  onNavigate={(target) => setSection(target)}
                  onLegacyPayrollChange={(amount) => stageSettings({ ownerPayrollMonthly: amount }, "Separate owner payroll")}
                />
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
                            ["Earned revenue", moneyYtd?.values.revenue],
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
                        <span>
                          Model estimate
                        </span>
                      </div>

                      <div className="pw-money-group-label">Income</div>
                      <div className="pw-money-row pw-money-positive">
                        <div>
                          <strong>Earned revenue</strong>
                          <span>Sessions delivered during the month</span>
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
                      paid portion also affects estimated earned revenue.
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
                                <th>Earned revenue</th>
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
                            Owner payroll + included clinical pay + marked
                            distributions. Payroll is before personal tax
                            withholding.
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
                  {heading(
                    "Practice summary",
                    (mode === "practice" && practiceView === "actual"
                      ? "Today / "
                      : "Plan / ") +
                      monthLabel(
                        months[0]?.date ?? workspace.settings.forecastStart,
                      ),
                    <div className="pw-summary-controls">
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
                  <div className="pw-summary">
                    {metrics.map((m) => (
                      <div key={m.key}>
                        <span>{m.label}</span>
                        <strong>{money(months[0]?.values[m.key])}</strong>
                        {selectedGoal && (
                          <small>
                            Goal:{" "}
                            {comparableGoal
                              ? money(
                                  selectedMonths.find(
                                    (row) => row.date === months[0]?.date,
                                  )?.values[m.key],
                                )
                              : "Different team"}
                          </small>
                        )}
                      </div>
                    ))}
                  </div>
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
                        {!context.sessions.some((record) =>
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
                    {workspace.settings.familyW2ClinicianId !== null && months.some((row) => row.values.familyTakeHome === null) && (
                      <p className="pw-projection-note">
                        Enter a completed month of net W2 deposits in Money flow to estimate future family take-home. Distributions are modeled from positive profit.
                      </p>
                    )}
                    {workspace.settings.familyW2ClinicianId === null && months.some((row) => (row.values.profit ?? 0) < 0) && (
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
                    onClick={() => setSection("budgets")}
                  >
                    Back to budgets
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
                  {goals.length} saved{" "}
                  {goals.length === 1 ? "version" : "versions"}
                </p>
              </div>
            </div>
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
          <aside className="pw-impact" aria-label="Scenario comparison">
            <div className="pw-impact-heading">
              <span>
                <ChartNoAxesCombined />
                Scenario vs Today /{" "}
                {endpoint ? monthLabel(endpoint.date) : "scenario"}
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
                        <span>Today</span>
                        {money(before)}
                      </small>
                      <ArrowRight />
                      <strong>
                        <span>Sandbox</span>
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
              Export a section here, then import it in Today, Planning, or
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
                    ? "this Planning scenario"
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
              Reports use saved compensation records, not unsaved Planning or
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
                  ? "Planning settings"
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
              Independent models stay separate from Today and Planning.
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
              This keeps a copy in Sandbox. Today and Planning stay unchanged.
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
              {planningEdit ? "Save scenario" : "Send model to Planning"}
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
