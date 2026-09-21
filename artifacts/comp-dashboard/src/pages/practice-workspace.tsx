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
  observedSeries,
  workspaceSchema,
  type Workspace,
  type Context,
  type Collection,
  type Clinician,
  type Proposal,
} from "@workspace/practice/hub";
import { daysInclusive } from "@workspace/practice";
import { calculateClinicianMetrics } from "@workspace/practice/compensation";
import {
  getHub,
  getContext,
  hubKey,
  writeHub,
  type HubSnapshot,
} from "@/lib/hub-api";
import {
  copyPractice,
  makePracticeGoal,
  readPracticeGoal,
  practiceChanges,
  type PracticeCopy,
} from "@/lib/practice-goals";
import { calculateGoalPace, type PacePoint } from "@/lib/goal-pace";
import { resolveWorkspaceDefaults } from "@/lib/workspace-defaults";
import { newRecord } from "@/components/hub/config";
import RecordEditor from "@/components/hub/record-editor";
import RecordTable from "@/components/hub/record-table";
import Settings, { SettingsEditor } from "@/components/hub/settings";
import Updates from "@/components/hub/updates";
import { type ViewProps, fmt, monthLabel } from "@/components/hub/views";
import WorkspaceSessions from "@/components/practice/workspace-sessions";
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
  const [section, setSection] = useState<Section>("clinicians");
  const [draft, setDraft] = useState<PracticeCopy | null>(null);
  const [base, setBase] = useState<PracticeCopy | null>(null);
  const [sourceRevision, setSourceRevision] = useState(0);
  const [editor, setEditor] = useState<{
    collection: Collection;
    record: Record<string, unknown>;
  } | null>(null);
  const [settings, setSettings] = useState<string | null>(null);
  const [detail, setDetail] = useState<Collection | null>(null);
  const [goalName, setGoalName] = useState("");
  const [goalDialog, setGoalDialog] = useState(false);
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
  const sandbox = mode === "sandbox";
  const storedWorkspace = sandbox && draft ? draft.workspace : query.data?.data;
  const context = sandbox && draft ? draft.context : contextQuery.data;
  const resolved = useMemo(
    () =>
      storedWorkspace && context
        ? resolveWorkspaceDefaults(storedWorkspace, context, teams.data)
        : null,
    [storedWorkspace, context, teams.data],
  );
  const workspace = resolved?.workspace;
  const forecastWorkspace = resolved?.forecastWorkspace;
  const months = useMemo(
    () =>
      forecastWorkspace && context ? forecast(forecastWorkspace, context) : [],
    [forecastWorkspace, context],
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
    () => (draft && base ? practiceChanges(base, draft) : []),
    [base, draft],
  );
  const goals = useMemo(
    () =>
      active(query.data?.data.proposals ?? []).flatMap((goal) => {
        const snapshot = readPracticeGoal(goal);
        return snapshot ? [{ goal, snapshot }] : [];
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
  const actualPaceSeries = useMemo<PacePoint[]>(() => {
    if (!workspace || !context) return [];
    if (paceMetric !== "sessions")
      return observedSeries(workspace, context).map((row) => ({
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
  }, [workspace, context, paceMetric]);
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
    const actualByMonth = new Map(
      actualPaceSeries.map((point) => [point.date.slice(0, 7), point.value]),
    );
    return months.map((row) => ({
      date: monthLabel(row.date),
      estimated: row.values[paceMetric],
      goal: comparableGoal
        ? selectedMonths.find(
            (goal) => goal.date.slice(0, 7) === row.date.slice(0, 7),
          )?.values[paceMetric]
        : undefined,
      actual: actualByMonth.get(row.date.slice(0, 7)),
    }));
  }, [months, selectedMonths, actualPaceSeries, paceMetric, comparableGoal]);
  const today = new Date().toLocaleDateString("en-CA");
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (changes.length) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [changes.length]);

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
      setMessage("Saved to My Practice");
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
    if (sandbox) {
      const parsed = workspaceSchema.parse(data);
      setDraft((d) => (d ? { ...d, workspace: parsed } : d));
      setMessage("Sandbox only");
    } else await persist(data, action);
  }
  function edit(collection: Collection, record?: Record<string, unknown>) {
    if (busy.current) return;
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
            followsDesired && patch.sessionsPerWeek !== undefined
              ? {
                  ...d.workspace,
                  settings: {
                    ...d.workspace.settings,
                    baselineWeeklySessions: nextTotal,
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
      setMessage("Saved to My Practice");
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
  function startSandbox() {
    if (!query.data || !contextQuery.data || !workspace) return;
    const copy = copyPractice(
      forecastWorkspace ?? workspace,
      contextQuery.data,
    );
    setBase(copy);
    setDraft(structuredClone(copy));
    setSourceRevision(query.data.revision);
    setMode("sandbox");
    setError("");
    setMessage("");
  }
  function openGoal(goal: Proposal) {
    const copy = readPracticeGoal(goal);
    if (!copy || !query.data || !contextQuery.data || !workspace) return;
    if (changes.length) {
      setError(
        "Save the current sandbox as a goal, or reset it, before opening another goal.",
      );
      return;
    }
    setBase(copyPractice(forecastWorkspace ?? workspace, contextQuery.data));
    setDraft(copyPractice(copy.workspace, copy.context));
    setSourceRevision(copy.sourceRevision);
    setMode("sandbox");
    setSection("clinicians");
    setGoalName(goal.name + " - revision");
    setError("");
  }
  async function saveGoal() {
    if (!draft || !query.data || saving) return;
    try {
      pendingGoal.current ??= makePracticeGoal(goalName, draft, sourceRevision);
      await persist(
        {
          ...query.data.data,
          proposals: [...query.data.data.proposals, pendingGoal.current],
        },
        "Saved sandbox as a goal",
      );
      setCompareId(pendingGoal.current.id);
      pendingGoal.current = null;
      setGoalDialog(false);
      setGoalName("");
      setDraft(null);
      setBase(null);
      setMode("goals");
      setMessage("Goal saved. My Practice is unchanged.");
    } catch (e) {
      setError(errorText(e));
    }
  }
  function navigate(next: Mode) {
    if (busy.current || sessionEditing) return;
    setError("");
    if (next === "sandbox" && !draft) startSandbox();
    else setMode(next);
    if (section === "documents" || section === "settings")
      setSection("clinicians");
  }

  if (query.isPending || contextQuery.isPending)
    return <div className="pw-loading">Loading My Practice...</div>;
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
  const people = selectedPeople;
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
  const householdDistributionPct = activeAllocations
    .filter(
      (allocation) =>
        allocation.kind === "distribution" && allocation.household,
    )
    .reduce((sum, allocation) => sum + allocation.percent, 0);
  const totalDistributionPct = activeAllocations
    .filter((allocation) => allocation.kind === "distribution")
    .reduce((sum, allocation) => sum + allocation.percent, 0);
  const householdDistributions = activeAllocations.length
    ? (moneyValues.distributions ?? 0) *
      (totalDistributionPct
        ? householdDistributionPct / totalDistributionPct
        : 0)
    : (moneyValues.distributions ?? 0);
  const householdWithholding =
    ((moneyValues.ownerPayroll ?? 0) +
      (workspace.settings.includeOwnerClinical
        ? (moneyValues.ownerClinicalPay ?? 0)
        : 0) +
      householdDistributions) *
    (workspace.settings.householdWithholdingPct / 100);
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
              { id: "practice", label: "My Practice", icon: Building2 },
              { id: "sandbox", label: "Sandbox", icon: FlaskConical },
              { id: "goals", label: "Goals", icon: Flag },
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
            <a href="/" target="_blank" rel="noreferrer">
              <PanelTop />
              Original tools
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
              {sandbox
                ? "Working copy"
                : mode === "goals"
                  ? "Saved destinations"
                  : "Your business"}
            </div>
            <h1>
              {sandbox ? "Sandbox" : mode === "goals" ? "Goals" : "My Practice"}
            </h1>
          </div>
          <div className="pw-actions">
            {sandbox ? (
              <>
                <button
                  className="pw-icon"
                  aria-label="Reset sandbox"
                  title="Reset sandbox from My Practice"
                  onClick={() => setResetDialog(true)}
                >
                  <RotateCcw />
                </button>
                <button
                  className="pw-button pw-primary"
                  onClick={() => {
                    setGoalDialog(true);
                    setError("");
                  }}
                >
                  <Flag />
                  Save as goal
                </button>
              </>
            ) : mode === "practice" ? (
              <button className="pw-button" onClick={() => navigate("sandbox")}>
                <FlaskConical />
                Try a change
              </button>
            ) : (
              <button className="pw-button" onClick={() => navigate("sandbox")}>
                <Plus />
                Open Sandbox
              </button>
            )}
          </div>
        </header>
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
        {mode !== "goals" && (
          <>
            <nav
              className="pw-sections"
              aria-label={sandbox ? "Sandbox sections" : "Practice sections"}
            >
              {sections.map((s) => (
                <button
                  key={s.id}
                  aria-current={section === s.id ? "page" : undefined}
                  disabled={saving || sessionEditing}
                  onClick={() => setSection(s.id)}
                >
                  {s.label}
                </button>
              ))}
            </nav>
            {sandbox && (
              <div className="pw-sandbox-timeline">
                <span className="pw-tag">
                  <FlaskConical />
                  Sandbox only
                </span>
                <label>
                  Starting
                  <input
                    type="date"
                    aria-label="Sandbox start"
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
                    aria-label="Sandbox horizon"
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
            <div className="pw-content">
              {section === "clinicians" && (
                <>
                  {heading(
                    "Clinicians & pay",
                    people.length + " clinicians",
                    <>
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
                      {sandbox ? (
                        <button
                          className="pw-button"
                          onClick={() =>
                            edit("events", {
                              ...newRecord(
                                "events",
                                workspace,
                                workspace.settings.forecastStart,
                              ),
                              name: "New clinician",
                              field: "clinician.hire",
                              targetId: String(people[0]?.id ?? ""),
                              value: 20,
                            })
                          }
                        >
                          <Plus />
                          Plan a hire
                        </button>
                      ) : (
                        <a
                          className="pw-button"
                          href="/?view=team"
                          target="_blank"
                          rel="noreferrer"
                        >
                          <Plus />
                          Manage team
                        </a>
                      )}
                    </>,
                  )}
                  <div className="pw-clinicians">
                    {people.map((person) => {
                      const result = calculateClinicianMetrics(person);
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
                              <h3>{person.label}</h3>
                              <span>
                                {String(person.classification).toUpperCase()}
                                {setting ? " / " + setting.status : ""}
                              </span>
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
                          </div>
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
                                  patchPerson(person, { weeksWorkedPerYear: n })
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
                            <span>At desired sessions / month</span>
                            <dl>
                              <div>
                                <dt>Revenue</dt>
                                <dd>{money(result.annualProduction / 12)}</dd>
                              </div>
                              <div>
                                <dt>Est. clinician pay</dt>
                                <dd>
                                  {money(result.clinicianCompensation / 12)}
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
                      <h3>No clinicians in this team</h3>
                      <p>
                        Select an existing team above to use its compensation
                        structures.
                      </p>
                    </div>
                  )}
                  <div className="pw-secondary-links">
                    {detailButton("terms", "Future pay changes")}
                    {detailButton("hiring", "Hiring costs")}
                    {!sandbox && (
                      <a href="/" target="_blank" rel="noreferrer">
                        Open detailed compensation
                        <ChevronRight />
                      </a>
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
                    active(workspace.campaigns).length + " lead sources",
                    add("campaigns", "Add campaign"),
                  )}
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
                    <div className="pw-list">
                      {active(workspace.campaigns).map((c) => (
                        <article className="pw-campaign" key={c.id}>
                          <div>
                            <h3>{c.name}</h3>
                            <p>{c.source}</p>
                            <button
                              className="pw-text-button"
                              onClick={() => edit("campaigns", c)}
                            >
                              {
                                {
                                  cpl: "Cost per lead",
                                  cac: "Cost per client",
                                  historical: "Past performance",
                                  manual: "Manual estimate",
                                  clicks: "Click funnel",
                                  custom: "Custom formula",
                                }[c.method]
                              }
                              <ChevronRight />
                            </button>
                          </div>
                          <NumberField
                            label={c.name + " monthly spend"}
                            value={c.monthlySpend}
                            unit="$"
                            onSave={(n) =>
                              patchRecord("campaigns", c.id, {
                                monthlySpend: n,
                              })
                            }
                          />
                          {c.method === "cpl" ? (
                            <NumberField
                              label={c.name + " cost per lead"}
                              value={c.cpl}
                              unit="$"
                              onSave={(n) =>
                                patchRecord("campaigns", c.id, { cpl: n })
                              }
                            />
                          ) : c.method === "cac" ? (
                            <NumberField
                              label={c.name + " cost per client"}
                              value={c.cac}
                              unit="$"
                              onSave={(n) =>
                                patchRecord("campaigns", c.id, { cac: n })
                              }
                            />
                          ) : (
                            <div>
                              <span>Estimated clients / first month</span>
                              <strong>
                                {fmt(months[0]?.channels[c.id]?.clients)}
                              </strong>
                            </div>
                          )}
                          <EditButton
                            label={"Edit " + c.name}
                            onClick={() => edit("campaigns", c)}
                          />
                        </article>
                      ))}
                    </div>
                  ) : (
                    <>
                      {sandbox ? (
                        <p className="pw-notice">
                          Recorded results stay in My Practice. Campaign
                          estimates can be adjusted above.
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
                    "Space and available session hours",
                    add("rooms", "Add room"),
                  )}
                  <div className="pw-list">
                    {active(workspace.rooms).map((room) => (
                      <article className="pw-room" key={room.id}>
                        <Building2 />
                        <div>
                          <h3>{room.name}</h3>
                          <p>
                            {workspace.locations.find(
                              (l) => l.id === room.locationId,
                            )?.name ?? "No location assigned"}
                          </p>
                        </div>
                        <NumberField
                          label={room.name + " hours / week"}
                          value={room.weeklyHours}
                          max={168}
                          onSave={(n) =>
                            patchRecord("rooms", room.id, { weeklyHours: n })
                          }
                        />
                        <div>
                          <span>Usable sessions / week</span>
                          <strong>
                            {fmt(
                              (((room.weeklyHours * 60) / room.sessionMinutes) *
                                room.usablePct) /
                                100,
                            )}
                          </strong>
                        </div>
                        <EditButton
                          label={"Edit " + room.name}
                          onClick={() => edit("rooms", room)}
                        />
                      </article>
                    ))}
                  </div>
                  {!active(workspace.rooms).length && (
                    <p className="pw-empty">No rooms yet.</p>
                  )}
                  <div className="pw-secondary-links">
                    {detailButton("locations", "Locations")}
                  </div>
                </>
              )}
              {section === "budgets" && (
                <>
                  {heading(
                    "Budgets",
                    "Overhead and planned expenses",
                    add("budgets", "Add expense"),
                  )}
                  <div className="pw-table-scroll">
                    <table className="pw-table">
                      <thead>
                        <tr>
                          <th>Expense</th>
                          <th>Category</th>
                          <th>Amount</th>
                          <th>Frequency</th>
                          <th />
                        </tr>
                      </thead>
                      <tbody>
                        {active(workspace.budgets).map((b) => (
                          <tr key={b.id}>
                            <th>{b.name}</th>
                            <td>
                              {workspace.categories.find(
                                (c) => c.id === b.categoryId,
                              )?.name ?? "Uncategorized"}
                            </td>
                            <td>
                              <NumberField
                                label={b.name + " amount"}
                                value={b.amount}
                                unit={
                                  b.cadence === "percent_revenue" ? "%" : "$"
                                }
                                onSave={(n) =>
                                  patchRecord("budgets", b.id, { amount: n })
                                }
                              />
                            </td>
                            <td>{b.cadence.replaceAll("_", " ")}</td>
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
                  {!active(workspace.budgets).length &&
                    (resolved?.inherited.overhead ? (
                      <div className="pw-notice">
                        <strong>
                          Using {money(resolved.goal?.annualOverheadGoal)} per
                          year from {resolved.goal?.name}
                        </strong>
                        <span>
                          Add detailed expenses here when you are ready. They
                          will replace this single overhead estimate.
                        </span>
                      </div>
                    ) : (
                      <div className="pw-empty">
                        <h3>No operating expenses yet</h3>
                        <p>
                          Add recurring expenses individually or import a budget
                          to build the overhead total.
                        </p>
                      </div>
                    ))}
                  <div className="pw-secondary-links">
                    {detailButton("categories", "Categories")}
                    {!sandbox && (
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
                </>
              )}
              {section === "money" && (
                <>
                  {heading(
                    "Money flow",
                    "See where each monthly dollar comes from and where it goes",
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
                        <span>Live estimate</span>
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
                      <div className="pw-money-row">
                        <div>
                          <strong>Cash collected</strong>
                          <span>Revenue received after collection timing</span>
                        </div>
                        <NumberField
                          label="Collection rate"
                          caption="Collection rate"
                          value={workspace.settings.collectionPct}
                          max={100}
                          unit="%"
                          onSave={(n) =>
                            saveWorkspace(
                              {
                                ...workspace,
                                settings: {
                                  ...workspace.settings,
                                  collectionPct: n,
                                },
                              },
                              "Updated collection rate",
                            )
                          }
                        />
                        <b>{money(moneyValues.collections)}</b>
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
                      <div className="pw-money-row pw-money-cost">
                        <div>
                          <strong>Payment processing</strong>
                          <span>Fees charged on collections</span>
                        </div>
                        <NumberField
                          label="Payment processing rate"
                          caption="Fee rate"
                          value={workspace.settings.processingPct}
                          max={100}
                          unit="%"
                          onSave={(n) =>
                            saveWorkspace(
                              {
                                ...workspace,
                                settings: {
                                  ...workspace.settings,
                                  processingPct: n,
                                },
                              },
                              "Updated payment processing",
                            )
                          }
                        />
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
                        <NumberField
                          label="Target monthly operating profit"
                          caption="Monthly goal"
                          value={workspace.settings.targetProfitMonthly}
                          unit="$"
                          onSave={(n) =>
                            saveWorkspace(
                              {
                                ...workspace,
                                settings: {
                                  ...workspace.settings,
                                  targetProfitMonthly: n,
                                },
                              },
                              "Updated profit target",
                            )
                          }
                        />
                        <b>{money(moneyValues.profit)}</b>
                      </div>
                    </div>

                    <aside
                      className="pw-money-summary"
                      aria-label="Monthly money summary"
                    >
                      <h3>Owner view</h3>
                      <p>One month, fully connected</p>
                      <dl>
                        <div>
                          <dt>Total income</dt>
                          <dd>
                            {money(
                              (moneyValues.revenue ?? 0) + otherBusinessIncome,
                            )}
                          </dd>
                        </div>
                        <div>
                          <dt>Operating costs</dt>
                          <dd>{money(operatingCosts)}</dd>
                        </div>
                        <div>
                          <dt>Before owner pay</dt>
                          <dd>{money(beforeOwnerPay)}</dd>
                        </div>
                        <div>
                          <dt>Operating profit</dt>
                          <dd>{money(moneyValues.profit)}</dd>
                        </div>
                        <div>
                          <dt>Cash retained</dt>
                          <dd>{money(moneyValues.retainedCash)}</dd>
                        </div>
                      </dl>
                      <div className="pw-money-summary-result">
                        <span>Family take-home</span>
                        <strong>{money(moneyValues.familyTakeHome)}</strong>
                      </div>
                    </aside>
                  </div>

                  <section className="pw-money-sources">
                    <div className="pw-section-heading">
                      <div>
                        <h3>Inputs behind the totals</h3>
                        <p>
                          Edit the recurring amounts that feed the flow above
                        </p>
                      </div>
                    </div>
                    <div className="pw-money-source-grid">
                      <div>
                        <div className="pw-money-source-heading">
                          <h3>Budget lines</h3>
                          <button
                            className="pw-icon"
                            title="Add expense"
                            aria-label="Add expense"
                            onClick={() => edit("budgets")}
                          >
                            <Plus />
                          </button>
                        </div>
                        {active(workspace.budgets).map((budget) => (
                          <div className="pw-money-source-row" key={budget.id}>
                            <div>
                              <strong>{budget.name}</strong>
                              <span>{budget.cadence.replaceAll("_", " ")}</span>
                            </div>
                            <NumberField
                              label={`${budget.name} amount`}
                              value={budget.amount}
                              unit={
                                budget.cadence === "percent_revenue" ? "%" : "$"
                              }
                              onSave={(n) =>
                                patchRecord("budgets", budget.id, { amount: n })
                              }
                            />
                            <EditButton
                              label={`Edit ${budget.name}`}
                              onClick={() => edit("budgets", budget)}
                            />
                          </div>
                        ))}
                        {!active(workspace.budgets).length && (
                          <p className="pw-empty">
                            No recurring budget lines yet.
                          </p>
                        )}
                      </div>
                      <div>
                        <div className="pw-money-source-heading">
                          <h3>Marketing spend</h3>
                          <button
                            className="pw-icon"
                            title="Add campaign"
                            aria-label="Add campaign"
                            onClick={() => edit("campaigns")}
                          >
                            <Plus />
                          </button>
                        </div>
                        {active(workspace.campaigns).map((campaign) => (
                          <div
                            className="pw-money-source-row"
                            key={campaign.id}
                          >
                            <div>
                              <strong>{campaign.name}</strong>
                              <span>{campaign.source}</span>
                            </div>
                            <NumberField
                              label={`${campaign.name} monthly spend`}
                              value={campaign.monthlySpend}
                              unit="$"
                              onSave={(n) =>
                                patchRecord("campaigns", campaign.id, {
                                  monthlySpend: n,
                                })
                              }
                            />
                            <EditButton
                              label={`Edit ${campaign.name}`}
                              onClick={() => edit("campaigns", campaign)}
                            />
                          </div>
                        ))}
                        {!active(workspace.campaigns).length && (
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
                          Taxes and reserves stay in the business; household
                          distributions flow to the family
                        </p>
                      </div>
                      {add("allocations", "Add allocation")}
                    </div>
                    {activeAllocations.length ? (
                      activeAllocations.map((allocation) => (
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
                          <NumberField
                            label={`${allocation.name} share`}
                            value={allocation.percent}
                            max={100}
                            unit="%"
                            onSave={(n) =>
                              patchRecord("allocations", allocation.id, {
                                percent: n,
                              })
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
                            <NumberField
                              label={String(label)}
                              value={
                                workspace.settings[
                                  key as
                                    | "taxPct"
                                    | "reservePct"
                                    | "distributionPct"
                                ]
                              }
                              max={100}
                              unit="%"
                              onSave={(n) =>
                                saveWorkspace(
                                  {
                                    ...workspace,
                                    settings: {
                                      ...workspace.settings,
                                      [key as
                                        | "taxPct"
                                        | "reservePct"
                                        | "distributionPct"]: n,
                                    },
                                  },
                                  `Updated ${String(label).toLowerCase()}`,
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

                  <section className="pw-owner-flow">
                    <div className="pw-section-heading">
                      <div>
                        <h3>Owner pay &amp; household</h3>
                        <p>
                          The final step: what leaves the practice and what
                          reaches your family
                        </p>
                      </div>
                    </div>
                    <div className="pw-owner-grid">
                      <div className="pw-owner-line">
                        <div>
                          <strong>Owner payroll</strong>
                          <span>Non-clinical monthly compensation</span>
                        </div>
                        <NumberField
                          label="Owner monthly payroll"
                          value={workspace.settings.ownerPayrollMonthly}
                          unit="$"
                          onSave={(n) =>
                            saveWorkspace(
                              {
                                ...workspace,
                                settings: {
                                  ...workspace.settings,
                                  ownerPayrollMonthly: n,
                                },
                              },
                              "Updated owner payroll",
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
                        <NumberField
                          label="Owner payroll employer burden"
                          value={workspace.settings.ownerPayrollBurdenPct}
                          max={100}
                          unit="%"
                          onSave={(n) =>
                            saveWorkspace(
                              {
                                ...workspace,
                                settings: {
                                  ...workspace.settings,
                                  ownerPayrollBurdenPct: n,
                                },
                              },
                              "Updated owner payroll burden",
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
                            checked={workspace.settings.includeOwnerClinical}
                            onChange={(event) =>
                              void saveWorkspace(
                                {
                                  ...workspace,
                                  settings: {
                                    ...workspace.settings,
                                    includeOwnerClinical: event.target.checked,
                                  },
                                },
                                "Updated owner clinical take-home",
                              )
                            }
                          />
                          Include in take-home
                        </label>
                        <b>{money(moneyValues.ownerClinicalPay)}</b>
                      </div>
                      <div className="pw-owner-line">
                        <div>
                          <strong>Household distributions</strong>
                          <span>Distribution buckets marked for family</span>
                        </div>
                        <span />
                        <b>{money(householdDistributions)}</b>
                      </div>
                      <div className="pw-owner-line">
                        <div>
                          <strong>Household withholding / reserve</strong>
                          <span>Held back from owner cash flows</span>
                        </div>
                        <NumberField
                          label="Household withholding rate"
                          value={workspace.settings.householdWithholdingPct}
                          max={100}
                          unit="%"
                          onSave={(n) =>
                            saveWorkspace(
                              {
                                ...workspace,
                                settings: {
                                  ...workspace.settings,
                                  householdWithholdingPct: n,
                                },
                              },
                              "Updated household withholding",
                            )
                          }
                        />
                        <b>-{money(householdWithholding)}</b>
                      </div>
                      <div className="pw-owner-line">
                        <div>
                          <strong>Other household income</strong>
                          <span>Income outside the practice</span>
                        </div>
                        <NumberField
                          label="Other household income per month"
                          value={workspace.settings.otherHouseholdIncome}
                          unit="$"
                          onSave={(n) =>
                            saveWorkspace(
                              {
                                ...workspace,
                                settings: {
                                  ...workspace.settings,
                                  otherHouseholdIncome: n,
                                },
                              },
                              "Updated other household income",
                            )
                          }
                        />
                        <b>{money(workspace.settings.otherHouseholdIncome)}</b>
                      </div>
                      <div className="pw-owner-line">
                        <div>
                          <strong>Household benefits cost</strong>
                          <span>Benefits paid from household cash flow</span>
                        </div>
                        <NumberField
                          label="Household benefits cost per month"
                          value={workspace.settings.householdBenefitsCost}
                          unit="$"
                          onSave={(n) =>
                            saveWorkspace(
                              {
                                ...workspace,
                                settings: {
                                  ...workspace.settings,
                                  householdBenefitsCost: n,
                                },
                              },
                              "Updated household benefits cost",
                            )
                          }
                        />
                        <b>
                          -{money(workspace.settings.householdBenefitsCost)}
                        </b>
                      </div>
                      <div className="pw-owner-line pw-owner-total">
                        <div>
                          <strong>Estimated family take-home</strong>
                          <span>
                            Payroll + included clinical pay + household
                            distributions + other income, after withholding and
                            benefits
                          </span>
                        </div>
                        <span />
                        <b>{money(moneyValues.familyTakeHome)}</b>
                      </div>
                    </div>
                  </section>
                </>
              )}
              {section === "summary" && (
                <>
                  {heading(
                    "Practice summary",
                    "Estimated / " +
                      monthLabel(workspace.settings.forecastStart),
                    <div className="pw-summary-controls">
                      <label>
                        Projection starts from
                        <select
                          aria-label="Projection basis"
                          value={projectionBasis}
                          onChange={(e) => {
                            const next = e.target.value;
                            if (next === "manual") {
                              setSettings("forecast");
                              return;
                            }
                            void saveWorkspace({
                              ...workspace,
                              settings: {
                                ...workspace.settings,
                                baselineMode:
                                  next === "historical"
                                    ? "historical"
                                    : "manual",
                                baselineWeeklySessions:
                                  next === "desired"
                                    ? desiredWeeklyTotal
                                    : workspace.settings.baselineWeeklySessions,
                              },
                            }).catch((e) => setError(errorText(e)));
                          }}
                        >
                          <option value="historical">
                            Recent actual sessions
                          </option>
                          <option value="desired">Desired sessions</option>
                          <option value="manual">Custom weekly pace</option>
                        </select>
                      </label>
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
                          name={"Estimated " + paceLabels[paceMetric]}
                          type="monotone"
                          stroke="#39755b"
                          strokeWidth={2}
                          dot={false}
                        />
                        {selectedGoal && (
                          <Line
                            dataKey="goal"
                            name="Goal revenue"
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
                      onClick={() => setSettings("forecast")}
                    >
                      How this estimate is calculated
                      <ChevronRight />
                    </button>
                    {detailButton("goals", "Metric targets")}
                  </div>
                </>
              )}
              {section === "settings" && <Settings {...props} />}
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
        {mode === "goals" && (
          <div className="pw-content">
            <div className="pw-section-heading">
              <div>
                <h2>Saved goals</h2>
                <p>
                  {goals.length} saved{" "}
                  {goals.length === 1 ? "version" : "versions"}
                </p>
              </div>
            </div>
            {!goals.length ? (
              <div className="pw-empty pw-goal-empty">
                <Flag />
                <h3>No saved goals yet</h3>
                <button
                  className="pw-button pw-primary"
                  onClick={() => navigate("sandbox")}
                >
                  Open Sandbox
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
                        <span>Est. revenue at goal</span>
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
        {sandbox && (
          <aside className="pw-impact" aria-label="Sandbox impact">
            <div className="pw-impact-heading">
              <span>
                <ChartNoAxesCombined />
                At {endpoint ? monthLabel(endpoint.date) : "goal"}
              </span>
              <button
                className="pw-text-button"
                onClick={() => setChangeDetails((v) => !v)}
              >
                {changes.length} {changes.length === 1 ? "change" : "changes"}
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
                    <div>
                      <small>{money(before)}</small>
                      <ArrowRight />
                      <strong>{money(after)}</strong>
                    </div>
                    {before != null && after != null && (
                      <em>
                        {after - before >= 0 ? "+" : ""}
                        {money(after - before)}
                      </em>
                    )}
                  </div>
                );
              })}
            </div>
            {changeDetails && (
              <div className="pw-changes">
                {changes.length ? (
                  changes.map((c, i) => (
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
        <footer className="pw-status" aria-live="polite">
          <span>
            {saving
              ? "Saving..."
              : message ||
                (sandbox ? "My Practice is unchanged" : "My Practice")}
          </span>
          {months.some((m) => m.warnings.length > 0) && mode !== "goals" && (
            <details>
              <summary>Forecast checks</summary>
              {[...new Set(months.flatMap((m) => m.warnings))].map((w) => (
                <p key={w}>{w}</p>
              ))}
            </details>
          )}
        </footer>
      </main>
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
                {sandbox ? "Sandbox settings" : "My Practice settings"}
              </DialogDescription>
            </DialogHeader>
            {table(detail)}
          </DialogContent>
        </Dialog>
      )}
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
            <DialogTitle>Save as a goal</DialogTitle>
            <DialogDescription>My Practice stays unchanged.</DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void saveGoal();
            }}
          >
            <label className="pr-field">
              Goal name
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
                  : "Save goal"}
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
            <DialogTitle>Start again from My Practice?</DialogTitle>
            <DialogDescription>
              Unsaved sandbox changes will be discarded. Saved goals will
              remain.
            </DialogDescription>
          </DialogHeader>
          <button
            className="pw-button pw-primary"
            onClick={() => {
              startSandbox();
              setResetDialog(false);
            }}
          >
            Reset sandbox
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
