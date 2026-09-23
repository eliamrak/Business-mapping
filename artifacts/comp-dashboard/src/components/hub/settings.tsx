import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useClerk, useUser } from "@clerk/react";
import {
  Save,
  Plus,
  Settings2,
  Check,
  Play,
  Copy,
  UserPlus,
  Shield,
  LogOut,
  CalendarRange,
  Gauge,
  Users,
} from "lucide-react";
import { customFetch, useListBusinessGoals } from "@workspace/api-client-react";
import {
  settingsSchema,
  evaluateRules,
  evaluateObservedRules,
  eventSchema,
  proposalSchema,
  ruleResponseEvents,
  type Workspace,
  type Context,
} from "@workspace/practice/hub";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { InputField } from "./record-editor";
import { type Field } from "./config";
import { Tabs, type ViewProps, monthLabel } from "./views";
import { useUnsaved } from "./use-unsaved";

const numeric = (
  key: string,
  label: string,
  extra: Partial<Field> = {},
): Field => ({ key, label, type: "number", min: 0, step: "any", ...extra });
const percent = (key: string, label: string) =>
  numeric(key, label, { max: 100 });
const settingsFields: Record<string, Field[]> = {
  forecast: [
    { key: "practiceName", label: "Practice name" },
    { key: "forecastStart", label: "Forecast starts", type: "date" },
    numeric("horizonMonths", "Months to forecast", {
      min: 1,
      max: 60,
      step: "1",
    }),
    {
      key: "baselineMode",
      label: "Baseline session source",
      type: "select",
      options: [
        { value: "historical", label: "Recorded session history" },
        { value: "manual", label: "Manual weekly assumption" },
      ],
    },
    numeric("baselineWeeklySessions", "Baseline completed sessions / week", {
      optional: true,
    }),
    { key: "historicalStart", label: "Historical window starts", type: "date" },
    { key: "historicalEnd", label: "Historical window ends", type: "date" },
    percent(
      "baselineRetentionPct",
      "Existing caseload retained each month (%)",
    ),
    percent("attendancePct", "Expected session attendance (%)"),
    {
      key: "attendanceMode",
      label: "Session attendance source",
      type: "select",
      options: [
        { value: "manual", label: "Manual assumption" },
        { value: "historical", label: "Recorded historical window" },
      ],
    },
    percent("collectionPct", "Expected fee collection (%)"),
    numeric("collectionDelayMonths", "Collection delay (months)", {
      max: 12,
      step: "1",
    }),
    numeric(
      "openingReceivables",
      "Opening receivables collected in month one ($)",
    ),
    numeric("organicClientsPerMonth", "Additional organic clients / month"),
    numeric("retentionMonths", "New-client retention (months)", {
      min: 1,
      max: 120,
    }),
    numeric("sessionsPerClientMonth", "Sessions / client / month", { max: 31 }),
    percent("defaultInPersonPct", "Default in-person share (%)"),
  ],
  money: [
    numeric("openingCash", "Opening available cash ($)", { min: -1e10 }),
    numeric("minimumCash", "Minimum operating cash ($)"),
    percent("processingPct", "Payment-processing fee (%)"),
    numeric("ownerPayrollMonthly", "Owner non-clinical payroll / month ($)"),
    percent("ownerPayrollBurdenPct", "Owner payroll employer burden (%)"),
    percent("taxPct", "Tax allocation of positive cash profit (%)"),
    percent("reservePct", "Reserve allocation (%)"),
    percent("distributionPct", "Distribution allocation (%)"),
    {
      key: "includeOwnerClinical",
      label: "Include owner clinical compensation in family cash",
      type: "checkbox",
    },
    numeric("targetProfitMonthly", "Target operating profit / month ($)"),
  ],
};
export function SettingsEditor({
  section,
  workspace,
  context,
  theme,
  onSave,
  onClose,
}: {
  section: string;
  workspace: Workspace;
  context: Context;
  theme: string;
  onSave: (data: Workspace) => Promise<void>;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(workspace.settings),
    [error, setError] = useState(""),
    [saving, setSaving] = useState(false);
  const dirty = JSON.stringify(draft) !== JSON.stringify(workspace.settings);
  useUnsaved(dirty);
  const close = () => {
    if (!saving && (!dirty || window.confirm("Discard unsaved settings?")))
      onClose();
  };
  const goals = useListBusinessGoals();
  const desiredForTeam = (teamId: number | null) =>
    context.clinicians
      .filter((clinician) => (clinician.goalId ?? null) === teamId)
      .reduce((sum, clinician) => sum + clinician.sessionsPerWeek, 0);
  const desiredWeekly = desiredForTeam(draft.teamId);
  const inferredPace =
    draft.baselineMode === "historical"
      ? "historical"
      : draft.baselineWeeklySessions !== null &&
          Math.abs(draft.baselineWeeklySessions - desiredWeekly) < 0.001
        ? "desired"
        : "custom";
  const [paceChoice, setPaceChoice] = useState<
    "historical" | "desired" | "custom"
  >(inferredPace);
  const update = (key: keyof typeof draft, value: unknown) =>
    setDraft({ ...draft, [key]: value });
  const field = (definition: Field) => (
    <InputField
      key={definition.key}
      field={definition}
      value={draft[definition.key as keyof typeof draft]}
      workspace={workspace}
      context={context}
      record={draft}
      onChange={(value) => update(definition.key as keyof typeof draft, value)}
    />
  );
  async function save(e: React.FormEvent) {
    e.preventDefault();
    const result = settingsSchema.safeParse(draft);
    if (!result.success) {
      setError(
        result.error.issues.map((i) => `${i.path}: ${i.message}`).join("\n"),
      );
      return;
    }
    setSaving(true);
    try {
      await onSave({ ...workspace, settings: result.data });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed.");
    } finally {
      setSaving(false);
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <DialogContent
        className={`practice-theme practice-dialog hub-editor ${section === "forecast" ? "hub-forecast-editor" : ""}`}
        data-appearance={theme}
        onPointerDownOutside={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>
            {section === "money"
              ? "Money & family settings"
              : "Forecast assumptions"}
          </DialogTitle>
          <DialogDescription>
            {section === "forecast"
              ? "Set the starting point for your active plan"
              : "Active-plan assumptions"}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={save}>
          {section === "forecast" ? (
            <div className="hub-forecast-setup">
              <section>
                <div className="hub-forecast-section-heading">
                  <Users />
                  <div>
                    <h3>Plan frame</h3>
                    <p>The people and time covered by this forecast</p>
                  </div>
                </div>
                <div className="hub-form-grid hub-forecast-plan-grid">
                  <label className="pr-field">
                    Clinicians included
                    <select
                      value={draft.teamId ?? ""}
                      onChange={(event) => {
                        const teamId = event.target.value
                          ? Number(event.target.value)
                          : null;
                        setDraft({
                          ...draft,
                          teamId,
                          ...(paceChoice === "desired"
                            ? {
                                baselineMode: "manual",
                                baselineWeeklySessions: desiredForTeam(teamId),
                              }
                            : {}),
                        });
                      }}
                    >
                      <option value="">Unassigned clinicians</option>
                      {goals.data?.map((goal) => (
                        <option key={goal.id} value={goal.id}>
                          {goal.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="pr-field">
                    Plan starts
                    <input
                      type="date"
                      value={draft.forecastStart}
                      onChange={(event) =>
                        update("forecastStart", event.target.value)
                      }
                    />
                  </label>
                  <label className="pr-field">
                    Plan length
                    <select
                      value={draft.horizonMonths}
                      onChange={(event) =>
                        update("horizonMonths", Number(event.target.value))
                      }
                    >
                      {![12, 24, 36, 48, 60].includes(draft.horizonMonths) && (
                        <option value={draft.horizonMonths}>
                          {draft.horizonMonths} months
                        </option>
                      )}
                      <option value="12">1 year</option>
                      <option value="24">2 years</option>
                      <option value="36">3 years</option>
                      <option value="48">4 years</option>
                      <option value="60">5 years</option>
                    </select>
                  </label>
                </div>
              </section>

              <section>
                <div className="hub-forecast-section-heading">
                  <Gauge />
                  <div>
                    <h3>Starting session pace</h3>
                    <p>Choose what month one should be based on</p>
                  </div>
                </div>
                <div
                  className="hub-choice-list"
                  role="radiogroup"
                  aria-label="Starting session pace"
                >
                  <label>
                    <input
                      type="radio"
                      name="pace"
                      checked={paceChoice === "historical"}
                      onChange={() => {
                        setPaceChoice("historical");
                        update("baselineMode", "historical");
                      }}
                    />
                    <span>
                      <strong>Recent completed sessions</strong>
                      <small>
                        Uses the session tracker from {draft.historicalStart}{" "}
                        through {draft.historicalEnd}
                      </small>
                    </span>
                  </label>
                  <label>
                    <input
                      type="radio"
                      name="pace"
                      checked={paceChoice === "desired"}
                      onChange={() => {
                        setPaceChoice("desired");
                        setDraft({
                          ...draft,
                          baselineMode: "manual",
                          baselineWeeklySessions: desiredWeekly,
                        });
                      }}
                    />
                    <span>
                      <strong>Clinicians' desired sessions</strong>
                      <small>
                        {desiredWeekly.toLocaleString()} sessions per week
                        across this team
                      </small>
                    </span>
                  </label>
                  <label>
                    <input
                      type="radio"
                      name="pace"
                      checked={paceChoice === "custom"}
                      onChange={() => {
                        setPaceChoice("custom");
                        setDraft({
                          ...draft,
                          baselineMode: "manual",
                          baselineWeeklySessions:
                            draft.baselineWeeklySessions ?? desiredWeekly,
                        });
                      }}
                    />
                    <span>
                      <strong>Custom starting pace</strong>
                      <small>Use a specific completed-session estimate</small>
                    </span>
                  </label>
                </div>
                {paceChoice === "custom" && (
                  <div className="hub-forecast-inline-field">
                    {field(
                      numeric(
                        "baselineWeeklySessions",
                        "Completed sessions per week at the start",
                        { max: 10000 },
                      ),
                    )}
                  </div>
                )}
              </section>

              <section>
                <div className="hub-forecast-section-heading">
                  <CalendarRange />
                  <div>
                    <h3>Attendance &amp; collections</h3>
                    <p>
                      How scheduled care becomes completed and paid sessions
                    </p>
                  </div>
                </div>
                <div className="hub-form-grid">
                  <label className="pr-field">
                    Attendance estimate
                    <select
                      value={draft.attendanceMode}
                      onChange={(event) =>
                        update("attendanceMode", event.target.value)
                      }
                    >
                      <option value="historical">
                        Use recorded attendance
                      </option>
                      <option value="manual">Set an attendance rate</option>
                    </select>
                  </label>
                  {draft.attendanceMode === "manual" &&
                    field(percent("attendancePct", "Expected attendance (%)"))}
                  {field(
                    percent(
                      "collectionPct",
                      "Expected collections from billed fees (%)",
                    ),
                  )}
                </div>
              </section>

              <details className="hub-forecast-advanced">
                <summary>Growth, history &amp; cash timing</summary>
                <div className="hub-form-grid">
                  {[
                    { key: "practiceName", label: "Practice name" },
                    {
                      key: "historicalStart",
                      label: "Recorded window starts",
                      type: "date",
                    },
                    {
                      key: "historicalEnd",
                      label: "Recorded window ends",
                      type: "date",
                    },
                    percent(
                      "baselineRetentionPct",
                      "Existing monthly caseload retained (%)",
                    ),
                    numeric(
                      "organicClientsPerMonth",
                      "New clients not tied to campaigns / month",
                    ),
                    numeric(
                      "retentionMonths",
                      "Average months a new client stays",
                      { min: 1, max: 120 },
                    ),
                    numeric(
                      "sessionsPerClientMonth",
                      "Sessions per client / month",
                      { max: 31 },
                    ),
                    numeric("collectionDelayMonths", "Payment delay (months)", {
                      max: 12,
                      step: "1",
                    }),
                    numeric(
                      "openingReceivables",
                      "Existing receivables collected in month one ($)",
                    ),
                    percent(
                      "defaultInPersonPct",
                      "Default in-person share (%)",
                    ),
                  ].map(field)}
                </div>
              </details>
            </div>
          ) : (
            <div className="hub-form-grid">
              {(settingsFields[section] ?? settingsFields.money).map(field)}
            </div>
          )}
          {error && (
            <p className="pr-error hub-error" role="alert">
              {error}
            </p>
          )}
          <div className="pr-dialog-actions">
            <button className="pr-button pr-primary" disabled={saving}>
              <Save />
              {saving ? "Saving..." : "Save settings"}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function Settings(props: ViewProps) {
  const [tab, setTab] = useState("rules"),
    [error, setError] = useState("");
  const { workspace, months, edit, table, save } = props;
  const { signOut } = useClerk();
  const { user } = useUser();
  const signals = evaluateRules(workspace, months);
  const recorded = evaluateObservedRules(workspace, props.context);
  const email = user?.primaryEmailAddress?.emailAddress ?? "your Clerk account";
  return (
    <>
      <Tabs
        value={tab}
        onChange={setTab}
        items={[
          ["rules", "If This, Then That"],
          ["kpis", "Custom KPIs"],
          ["preferences", "Shared assumptions"],
          ["access", "Access"],
        ]}
      />
      {tab === "rules" ? (
        <>
          {table("rules")}
          <section className="hub-signals">
            <h2>Latest recorded signals</h2>
            {recorded.map((s) => (
              <div className="hub-signal" key={s.rule.id}>
                <strong>{s.rule.name}</strong>
                <span className="hub-status">{s.status}</span>
                <small>
                  {s.date ? `Through ${s.date}` : "No finalized observations"}
                </small>
              </div>
            ))}
          </section>
          <section className="hub-signals">
            <h2>Forecast rule results</h2>
            {signals.map((signal) => (
              <div className="hub-signal" key={signal.rule.id}>
                <div className="hub-section-heading">
                  <h3>{signal.rule.name}</h3>
                  <span className={`hub-status ${signal.status}`}>
                    {signal.status}
                  </span>
                </div>
                <p>{signal.rule.action}</p>
                {signal.rule.responses.map((r) => (
                  <p key={r.id}>
                    {r.name} ({r.offsetMonths >= 0 ? "+" : ""}
                    {r.offsetMonths} months)
                  </p>
                ))}
                <p className="hub-muted">
                  {signal.date
                    ? `Expected ${monthLabel(signal.date)}. Begin action ${monthLabel(signal.actionDate!)}.`
                    : "Not triggered within the selected horizon."}
                </p>
                <div className="hub-actions">
                  <button
                    className="pr-button"
                    onClick={() =>
                      edit(
                        "events",
                        eventSchema.parse({
                          ...signal.rule.event,
                          id: crypto.randomUUID(),
                          name: signal.rule.action,
                          date:
                            signal.actionDate ??
                            workspace.settings.forecastStart,
                          field: signal.rule.event?.field ?? "custom",
                          value: signal.rule.event?.value ?? 0,
                        }),
                      )
                    }
                  >
                    <Plus />
                    Review plan event
                  </button>
                  <button
                    className="pr-button"
                    disabled={!signal.actionDate}
                    onClick={() => {
                      const proposal = proposalSchema.parse({
                        id: crypto.randomUUID(),
                        name: signal.rule.name,
                        changes: ruleResponseEvents(
                          signal.rule,
                          workspace,
                          signal.actionDate!,
                          () => crypto.randomUUID(),
                        ),
                      });
                      void save(
                        {
                          ...workspace,
                          proposals: [...workspace.proposals, proposal],
                        },
                        `Draft rule responses: ${signal.rule.name}`,
                      ).catch((e) => setError(e.message));
                    }}
                  >
                    <Copy />
                    Draft all responses in sandbox
                  </button>
                  <button
                    className="pr-button"
                    onClick={() =>
                      void save(
                        {
                          ...workspace,
                          rules: workspace.rules.map((r) =>
                            r.id === signal.rule.id
                              ? {
                                  ...r,
                                  status:
                                    r.status === "acknowledged"
                                      ? "completed"
                                      : "acknowledged",
                                }
                              : r,
                          ),
                        },
                        `Update signal: ${signal.rule.name}`,
                      ).catch((e) => setError(e.message))
                    }
                  >
                    <Check />
                    {signal.rule.status === "acknowledged"
                      ? "Complete"
                      : "Acknowledge"}
                  </button>
                </div>
              </div>
            ))}
          </section>
        </>
      ) : tab === "kpis" ? (
        table("kpis")
      ) : tab === "preferences" ? (
        <div className="hub-setting-list">
          <button onClick={() => props.settings("forecast")}>
            <Settings2 />
            <span>Forecast, historical windows & operating assumptions</span>
          </button>
          <button onClick={() => props.settings("money")}>
            <Settings2 />
            <span>Cash, allocations & family take-home</span>
          </button>
        </div>
      ) : (
        <>
          <div className="hub-section-heading">
            <h2>
              <Shield /> Access
            </h2>
            <span className="hub-status">Clerk authentication</span>
          </div>
          <p className="hub-muted">
            Signed in as <strong>{email}</strong>. Google sign-in and account
            access are managed by Clerk. Future internal users can be invited
            and assigned an app role without bringing back local passwords.
          </p>
          <button
            className="pr-button"
            onClick={() => {
              if (
                window.dispatchEvent(
                  new Event("emc-discard", { cancelable: true }),
                )
              )
                void signOut({ redirectUrl: import.meta.env.BASE_URL || "/" })
                  .catch((e) => setError(e.message));
            }}
          >
            <LogOut />
            Sign out
          </button>
        </>
      )}
      {error && (
        <p className="pr-error" role="alert">
          {error}
        </p>
      )}
    </>
  );
}

function AccessUsers() {
  const users = useQuery({
    queryKey: ["hub-users"],
    queryFn: () =>
      customFetch<
        {
          id: string;
          email: string;
          name: string;
          role: string;
          disabled: number;
        }[]
      >("/api/auth/users"),
  });
  const [adding, setAdding] = useState(false),
    [email, setEmail] = useState(""),
    [name, setName] = useState(""),
    [role, setRole] = useState("data_entry"),
    [password, setPassword] = useState(""),
    [error, setError] = useState("");
  async function create(e: React.FormEvent) {
    e.preventDefault();
    try {
      await customFetch("/api/auth/users", {
        method: "POST",
        body: JSON.stringify({ email, name, role, password }),
      });
      setPassword("");
      setAdding(false);
      await users.refetch();
    } catch {
      setError(
        "Account was not created. Check the email and use a password of at least 12 characters.",
      );
    }
  }
  return (
    <section>
      <div className="hub-section-heading">
        <h3>Additional accounts</h3>
        <button className="pr-button" onClick={() => setAdding(!adding)}>
          <UserPlus />
          Add account
        </button>
      </div>
      {adding && (
        <form className="hub-form-grid" onSubmit={create}>
          <label className="pr-field">
            Name
            <input
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <label className="pr-field">
            Email
            <input
              required
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          <label className="pr-field">
            Role
            <select value={role} onChange={(e) => setRole(e.target.value)}>
              <option value="data_entry">Data entry</option>
              <option value="owner">Owner</option>
            </select>
          </label>
          <label className="pr-field">
            Initial password
            <input
              type="password"
              minLength={12}
              autoComplete="new-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          <button className="pr-button pr-primary">
            <UserPlus />
            Create account
          </button>
        </form>
      )}
      {error && (
        <p className="pr-error" role="alert">
          {error}
        </p>
      )}
      <div className="pr-table-wrap">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Role</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {users.data?.map((user) => (
              <tr key={user.id}>
                <td>{user.name}</td>
                <td>{user.email}</td>
                <td>{user.role}</td>
                <td>
                  <button
                    className="pr-button"
                    onClick={() =>
                      void customFetch(`/api/auth/users/${user.id}`, {
                        method: "PATCH",
                        body: JSON.stringify({ disabled: !user.disabled }),
                      })
                        .then(() => users.refetch())
                        .catch(() => setError("Account update failed."))
                    }
                  >
                    {user.disabled ? "Enable access" : "Disable access"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
