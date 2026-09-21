import {
  categorySchema,
  budgetSchema,
  locationSchema,
  roomSchema,
  clinicianSettingSchema,
  termSchema,
  campaignSchema,
  funnelSchema,
  transactionSchema,
  periodSchema,
  allocationSchema,
  hiringSchema,
  eventSchema,
  goalSchema,
  proposalSchema,
  customKpiSchema,
  ruleSchema,
  eventFields,
  metrics,
  type Workspace,
  type Collection,
} from "@workspace/practice/hub";
export type Field = {
  key: string;
  label: string;
  type?: "text" | "number" | "date" | "select" | "checkbox" | "textarea";
  options?: { value: string; label: string }[];
  source?: Collection | "legacyClinicians" | "legacyGoals" | "metrics";
  optional?: boolean;
  advanced?: boolean;
  step?: string;
  min?: number;
  max?: number;
  hint?: string;
};
const n = (key: string, label: string, extra: Partial<Field> = {}): Field => ({
  key,
  label,
  type: "number",
  min: 0,
  step: "any",
  ...extra,
});
const d = (key: string, label: string, optional = false): Field => ({
  key,
  label,
  type: "date",
  optional,
});
const select = (key: string, label: string, values: string[]): Field => ({
  key,
  label,
  type: "select",
  options: values.map((value) => ({
    value,
    label: value.replaceAll("_", " "),
  })),
});
const ref = (
  key: string,
  label: string,
  source: Field["source"],
  optional = false,
): Field => ({ key, label, type: "select", source, optional });
const name: Field = { key: "name", label: "Name" };
const notes: Field = {
  key: "notes",
  label: "Notes",
  type: "textarea",
  optional: true,
  advanced: true,
};
const range = [d("start", "Starts"), d("end", "Ends", true)];
const pct = (key: string, label: string, advanced = false) =>
  n(key, label, { max: 100, advanced });
export const schemas = {
  categories: categorySchema,
  budgets: budgetSchema,
  locations: locationSchema,
  rooms: roomSchema,
  clinicians: clinicianSettingSchema,
  terms: termSchema,
  campaigns: campaignSchema,
  funnels: funnelSchema,
  transactions: transactionSchema,
  periods: periodSchema,
  allocations: allocationSchema,
  hiring: hiringSchema,
  events: eventSchema,
  goals: goalSchema,
  proposals: proposalSchema,
  kpis: customKpiSchema,
  rules: ruleSchema,
};
export const fields: Record<Collection, Field[]> = {
  categories: [
    name,
    select("kind", "Money-flow type", [
      "expense",
      "income",
      "payroll",
      "marketing",
      "facility",
      "tax",
      "reserve",
      "owner",
    ]),
    ref("parentId", "Parent category", "categories", true),
    n("order", "Order"),
    notes,
  ],
  budgets: [
    name,
    ref("categoryId", "Category", "categories"),
    n("amount", "Amount ($, or % for revenue-based lines)"),
    select("cadence", "Repeats", [
      "monthly",
      "weekly",
      "biweekly",
      "annual",
      "once",
      "per_session",
      "percent_revenue",
    ]),
    ...range,
    select("status", "Status", ["budget", "committed"]),
    {
      ...ref("clinicianId", "Clinician", "legacyClinicians", true),
      advanced: true,
    },
    { ...ref("campaignId", "Campaign", "campaigns", true), advanced: true },
    { ...ref("locationId", "Location", "locations", true), advanced: true },
    { ...ref("roomId", "Room", "rooms", true), advanced: true },
    notes,
  ],
  locations: [
    name,
    { key: "address", label: "Address", optional: true },
    notes,
  ],
  rooms: [
    name,
    ref("locationId", "Location", "locations", true),
    n("weeklyHours", "Available hours / week", { max: 168 }),
    n("sessionMinutes", "Minutes / session", { min: 15, max: 240, step: "1" }),
    pct("usablePct", "Usable capacity (%)"),
    ...range,
    {
      key: "telehealthUsesRoom",
      label: "Telehealth also occupies a room",
      type: "checkbox",
    },
    notes,
  ],
  clinicians: [
    ref("clinicianId", "Clinician", "legacyClinicians"),
    select("status", "Operating status", ["active", "planned", "archived"]),
    n("desiredWeeklySessions", "Desired sessions / week", { max: 100 }),
    pct("inPersonPct", "In-person sessions (%)"),
    ...range,
    ref("locationId", "Location", "locations", true),
    ref("roomId", "Room", "rooms", true),
    select("payMode", "Compensation method", [
      "existing_split",
      "salary",
      "hourly",
      "per_session",
    ]),
    n("payAmount", "Annual salary, hourly rate or session pay ($)"),
    n("paidHoursPerWeek", "Paid hours / week", { max: 100 }),
    n(
      "openingCapContribution",
      "Practice cap contribution before forecast start ($)",
      { optional: true, advanced: true },
    ),
  ],
  terms: [
    ref("clinicianId", "Clinician", "legacyClinicians"),
    d("effectiveDate", "Effective date"),
    n("sessionRate", "Session fee ($)", { optional: true }),
    n("clinicianSplit", "Clinician share before cap (%)", {
      optional: true,
      max: 100,
    }),
    n("capacity", "Desired sessions / week", { optional: true, max: 100 }),
    {
      ...select("payMode", "Compensation method", [
        "existing_split",
        "salary",
        "hourly",
        "per_session",
      ]),
      optional: true,
    },
    n("payAmount", "Annual salary, hourly rate or session pay ($)", {
      optional: true,
    }),
    notes,
  ],
  campaigns: [
    name,
    { key: "source", label: "Lead source" },
    {
      key: "method",
      label: "Estimate new clients using",
      type: "select",
      options: [
        { value: "cpl", label: "Cost per lead + conversion rates" },
        { value: "cac", label: "Cost per acquired client" },
        { value: "historical", label: "Past campaign performance" },
        { value: "manual", label: "Manual lead and client estimate" },
        { value: "clicks", label: "Impressions and click funnel" },
        { value: "custom", label: "Custom KPI formula" },
      ],
    },
    n("monthlySpend", "Monthly ad spend ($)"),
    ...range,
    n("cpl", "Cost per lead ($)"),
    n("cac", "Cost per acquired client ($)"),
    pct("consultationPct", "Lead to consultation (%)"),
    pct("attendancePct", "Consultation attendance (%)"),
    pct("closePct", "Attended consultation to client (%)"),
    n("sessionsPerClientMonth", "Sessions / client / month", { max: 31 }),
    n("retentionMonths", "Expected retention (months)", { min: 1, max: 120 }),
    {
      ...select("economicsSource", "Session economics source", [
        "forecast",
        "historical",
        "manual",
      ]),
      advanced: true,
    },
    n("revenuePerSession", "Collected revenue per session ($)", {
      optional: true,
      advanced: true,
    }),
    n(
      "deliveryCostPerSession",
      "Care delivery and payment cost per session ($)",
      { optional: true, advanced: true },
    ),
    n("otherMonthlyCost", "Other monthly campaign costs ($)", {
      advanced: true,
    }),
    pct("overlapPct", "Client overlap / nonincremental share (%)", true),
    n("conversionDelayMonths", "Conversion delay (months)", {
      step: "1",
      max: 24,
      advanced: true,
    }),
    n("cpm", "Cost per 1,000 impressions ($)", { advanced: true }),
    pct("ctrPct", "Click-through rate (%)", true),
    pct("clickToLeadPct", "Click to lead (%)", true),
    n("manualLeads", "Manual monthly leads", { advanced: true }),
    n("manualClients", "Manual monthly clients", { advanced: true }),
    {
      ...d("historicalStart", "Historical period starts", true),
      advanced: true,
    },
    { ...d("historicalEnd", "Historical period ends", true), advanced: true },
    {
      ...ref("customKpiId", "Custom client formula", "kpis", true),
      advanced: true,
    },
    notes,
  ],
  funnels: [
    ref("periodId", "Reporting period", "periods"),
    ref("campaignId", "Campaign", "campaigns"),
    n("spend", "Actual spend ($)", { optional: true }),
    n("leads", "Leads", { optional: true, step: "1" }),
    n("scheduled", "Consultations scheduled", { optional: true, step: "1" }),
    n("attended", "Consultations attended", { optional: true, step: "1" }),
    n("clients", "Clients closed", { optional: true, step: "1" }),
    n("firstSessions", "First sessions completed", {
      optional: true,
      step: "1",
    }),
    n("attributedRevenue", "Attributed collections ($)", { optional: true }),
    n("attributedSessions", "Attributed completed sessions", {
      optional: true,
      step: "1",
    }),
    n("deliveryCosts", "Attributed care delivery and payment costs ($)", {
      optional: true,
    }),
    notes,
  ],
  transactions: [
    ref("periodId", "Reporting period", "periods"),
    { key: "description", label: "Description" },
    d("date", "Date"),
    ref("categoryId", "Category", "categories"),
    n("amount", "Amount ($)"),
    ref("budgetId", "Budget line", "budgets", true),
    ref("campaignId", "Campaign", "campaigns", true),
  ],
  periods: [
    name,
    d("start", "Period start"),
    d("end", "Period end"),
    n("revenue", "Practice collections ($)", { optional: true }),
    n("earnedRevenue", "Earned revenue for services in this period ($)", {
      optional: true,
    }),
    n("clinicianPay", "Clinician compensation ($)", { optional: true }),
    n("employerBurden", "Employer burden ($)", { optional: true }),
    n("staffPay", "Support staff payroll ($)", { optional: true }),
    n("ownerPay", "Owner payroll ($)", { optional: true }),
    n("ownerClinicalPay", "Owner clinical pay, included in clinician pay ($)", {
      optional: true,
    }),
    n("distributions", "Owner distributions ($)", { optional: true }),
    n("taxes", "Taxes allocated / paid ($)", { optional: true }),
    n("reserves", "Transferred to reserves ($)", { optional: true }),
    n("closingCash", "Closing available cash ($)", { optional: true }),
    {
      key: "expensesComplete",
      label: "All expense lines have been reviewed",
      type: "checkbox",
    },
    {
      key: "funnelComplete",
      label: "Lead-generation figures have been reviewed",
      type: "checkbox",
    },
    {
      key: "correctionReason",
      label: "Correction reason for finalized records",
      optional: true,
    },
    notes,
  ],
  allocations: [
    name,
    select("kind", "Allocation", [
      "tax",
      "reserve",
      "distribution",
      "retained",
    ]),
    pct("percent", "Share of positive cash profit (%)"),
    {
      key: "household",
      label: "Include distributions in family take-home",
      type: "checkbox",
    },
    ...range,
    notes,
  ],
  hiring: [
    name,
    ref("templateClinicianId", "Compensation template", "legacyClinicians"),
    d("start", "Proposed start"),
    n("desiredWeeklySessions", "Full caseload / week", { min: 1, max: 100 }),
    n("delayMonths", "Recruiting / credentialing delay (months)", {
      max: 24,
      step: "1",
    }),
    n("rampMonths", "Caseload ramp (months)", { min: 1, max: 36, step: "1" }),
    n("recruiting", "Recruiting ($)"),
    n("credentialing", "Credentialing ($)"),
    n("training", "Training / onboarding ($)"),
    n("equipment", "Equipment ($)"),
    n("preCaseloadPay", "Pre-caseload payroll ($)"),
    n("monthlySupport", "Monthly supervision, software and support ($)"),
    notes,
  ],
  events: [
    name,
    d("date", "Effective date"),
    d("end", "Ends", true),
    select("field", "Change", [...eventFields]),
    { key: "targetId", label: "Target", type: "select" },
    n("value", "New value / weekly capacity / room count"),
    n("oneTimeCost", "One-time cost ($)"),
    n("monthlyCost", "Monthly hire support ($)"),
    n("delayMonths", "Delay (months)", { max: 24, step: "1" }),
    n("rampMonths", "Ramp (months)", { min: 1, max: 36, step: "1" }),
    { key: "enabled", label: "Enabled", type: "checkbox" },
    notes,
  ],
  goals: [
    name,
    select("metric", "Goal", [
      "sessions",
      "revenue",
      "profit",
      "familyTakeHome",
    ]),
    n("amount", "Target"),
    select("basis", "Period", ["monthly", "annual"]),
    d("date", "Target date"),
    notes,
  ],
  proposals: [name, notes],
  kpis: [
    name,
    { key: "key", label: "Metric key" },
    ref("left", "Left input", "metrics"),
    select("operation", "Calculation", [
      "add",
      "subtract",
      "multiply",
      "divide",
      "min",
      "max",
    ]),
    ref("right", "Right input", "metrics", true),
    n("constant", "Or fixed right value", { optional: true, min: -1e10 }),
    select("unit", "Unit", ["currency", "number", "percent"]),
    notes,
  ],
  rules: [
    name,
    { key: "enabled", label: "Enabled", type: "checkbox" },
    {
      ...select("status", "Decision status", [
        "open",
        "acknowledged",
        "completed",
      ]),
      advanced: true,
    },
    { key: "action", label: "Then recommend" },
    n("leadMonths", "Action lead time (months)", { max: 36, step: "1" }),
    notes,
  ],
};
export const labels: Record<Collection, string> = {
  categories: "Categories",
  budgets: "Budget lines",
  locations: "Locations",
  rooms: "Rooms",
  clinicians: "Operating roster",
  terms: "Dated compensation",
  campaigns: "Campaigns",
  funnels: "Lead-generation actuals",
  transactions: "Actual expense lines",
  periods: "Reporting periods",
  allocations: "Money-flow allocations",
  hiring: "Hiring economics",
  events: "Plan events",
  goals: "Goals",
  proposals: "Proposals",
  kpis: "Custom KPIs",
  rules: "Decision rules",
};
export function newRecord(
  key: Collection,
  workspace: Workspace,
  today: string,
) {
  const base = {
    id: crypto.randomUUID(),
    name: "",
    start: today,
    end: null,
    notes: "",
  };
  const first = (collection: Collection) =>
    workspace[collection].find(
      (r) =>
        !("archived" in r && r.archived) &&
        (collection !== "periods" ||
          !("status" in r) ||
          r.status !== "finalized"),
    )?.id ?? "";
  const defaults: Record<Collection, Record<string, unknown>> = {
    categories: { kind: "expense", parentId: null },
    budgets: {
      categoryId: first("categories"),
      amount: 0,
      cadence: "monthly",
      clinicianId: null,
      campaignId: null,
    },
    locations: { address: "" },
    rooms: { weeklyHours: 40 },
    clinicians: { clinicianId: 0, desiredWeeklySessions: 25 },
    terms: { clinicianId: 0, effectiveDate: today },
    campaigns: { source: "", method: "cpl", monthlySpend: 0 },
    funnels: {
      periodId: first("periods"),
      campaignId: first("campaigns"),
      spend: null,
      leads: null,
      scheduled: null,
      attended: null,
      clients: null,
      firstSessions: null,
    },
    transactions: {
      periodId: first("periods"),
      categoryId: first("categories"),
      description: "",
      date: today,
      amount: 0,
      campaignId: null,
    },
    periods: { end: today },
    allocations: { kind: "reserve", percent: 0 },
    hiring: { templateClinicianId: 0 },
    events: {
      date: today,
      field: "custom",
      value: 0,
      enabled: true,
      targetId: "",
      dependsOn: [],
      rampMonths: 1,
      delayMonths: 0,
      oneTimeCost: 0,
      monthlyCost: 0,
    },
    goals: { metric: "revenue", amount: 0, date: today },
    proposals: { changes: [] },
    kpis: {
      key: "",
      left: "revenue",
      operation: "subtract",
      right: "overhead",
      constant: null,
      unit: "currency",
    },
    rules: {
      action: "Review capacity",
      condition: {
        id: crypto.randomUUID(),
        type: "group",
        logic: "all",
        children: [
          {
            id: crypto.randomUUID(),
            type: "condition",
            metric: "utilization",
            operator: "gte",
            value: 80,
            upper: 100,
            scope: "all",
            clinicianIds: [],
            periods: 1,
            compareTo: "value",
          },
        ],
      },
    },
  };
  const candidate = { ...base, ...defaults[key] };
  // Populate schema defaults without inventing a valid label or foreign key.
  const temporary = {
    ...candidate,
    name: "New record",
    description: "New entry",
    source: "New source",
    key: "customMetric",
    clinicianId: 1,
    templateClinicianId: 1,
    categoryId: first("categories") || crypto.randomUUID(),
    periodId: first("periods") || crypto.randomUUID(),
    campaignId: first("campaigns") || crypto.randomUUID(),
  };
  const parsed = schemas[key].safeParse(temporary);
  return { ...(parsed.success ? parsed.data : {}), ...candidate } as Record<
    string,
    unknown
  >;
}
export function fieldOptions(
  field: Field,
  workspace: Workspace,
  context: {
    clinicians: { id: number; label: string; goalId?: number | null }[];
  },
  record: Record<string, unknown>,
) {
  if (field.key === "targetId") {
    const prefix = String(record.field).split(".")[0];
    const source =
      prefix === "marketing"
        ? workspace.campaigns
        : prefix === "budget"
          ? workspace.budgets
          : prefix === "room"
            ? workspace.rooms
            : null;
    return source
      ? source
          .filter((r) => !r.archived)
          .map((r) => ({ value: r.id, label: r.name }))
      : prefix === "clinician"
        ? context.clinicians.map((c) => ({
            value: String(c.id),
            label: c.label,
          }))
        : [{ value: "", label: "Practice-wide" }];
  }
  if (field.source === "legacyClinicians")
    return context.clinicians
      .filter(
        (clinician) => (clinician.goalId ?? null) === workspace.settings.teamId,
      )
      .map((c) => ({
        value: String(c.id),
        label: c.label,
      }));
  if (field.source === "metrics")
    return [
      ...metrics.map(([value, label]) => ({ value, label })),
      ...workspace.kpis.map((k) => ({ value: k.key, label: k.name })),
      { value: "spend", label: "Campaign spend" },
    ];
  if (field.source && field.source !== "legacyGoals")
    return workspace[field.source].map((r) => ({
      value: r.id,
      label: "name" in r ? String(r.name) : r.id.slice(0, 8),
    }));
  return field.options ?? [];
}
