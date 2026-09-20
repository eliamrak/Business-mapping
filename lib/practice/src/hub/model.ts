import { z } from "zod/v4";
import { dateSchema } from "../index.ts";
import { metricMap } from "./metrics.ts";

const id = z.uuid();
const label = z.string().trim().min(1).max(160);
const note = z.string().max(6000).default("");
const money = z.number().finite().min(0).max(1e10);
const percent = z.number().finite().min(0).max(100);
const count = z.number().int().min(0).max(1e7);
const optionalId = id.nullable().default(null);
const dates = { start: dateSchema, end: dateSchema.nullable().default(null) };
const named = {
  id,
  name: label,
  archived: z.boolean().default(false),
  notes: note,
  sourceAttachmentId: optionalId,
};

export const categorySchema = z.object({
  ...named,
  parentId: optionalId,
  kind: z.enum([
    "expense",
    "income",
    "payroll",
    "marketing",
    "facility",
    "tax",
    "reserve",
    "owner",
  ]),
  order: z.number().int().default(0),
  tags: z.array(label).max(50).default([]),
});
export const budgetSchema = z.object({
  ...named,
  planningOnly: z.boolean().default(false),
  ...dates,
  categoryId: id,
  amount: money,
  cadence: z.enum([
    "monthly",
    "weekly",
    "biweekly",
    "annual",
    "once",
    "per_session",
    "percent_revenue",
  ]),
  status: z.enum(["budget", "committed"]).default("budget"),
  locationId: optionalId,
  roomId: optionalId,
  campaignId: optionalId,
  clinicianId: z.number().int().positive().nullable().default(null),
});
export const locationSchema = z.object({
  ...named,
  address: z.string().max(500).default(""),
});
export const roomSchema = z.object({
  ...named,
  planningOnly: z.boolean().default(false),
  ...dates,
  locationId: optionalId,
  weeklyHours: z.number().min(0).max(168),
  sessionMinutes: z.number().int().min(15).max(240).default(60),
  usablePct: percent.default(85),
  telehealthUsesRoom: z.boolean().default(false),
  blocks: z
    .array(
      z.object({
        day: z.number().int().min(0).max(6),
        startHour: z.number().min(0).max(24),
        endHour: z.number().min(0).max(24),
      }),
    )
    .max(100)
    .default([]),
});
export const clinicianSettingSchema = z.object({
  id,
  clinicianId: z.number().int().positive(),
  ...dates,
  status: z.enum(["active", "planned", "archived"]).default("active"),
  desiredWeeklySessions: z.number().min(0).max(100),
  inPersonPct: percent.default(100),
  locationId: optionalId,
  roomId: optionalId,
  payMode: z
    .enum(["existing_split", "salary", "hourly", "per_session"])
    .default("existing_split"),
  payAmount: money.default(0),
  paidHoursPerWeek: z.number().min(0).max(100).default(0),
  openingCapContribution: money.nullable().default(null),
});
export const termSchema = z.object({
  id,
  clinicianId: z.number().int().positive(),
  effectiveDate: dateSchema,
  sessionRate: money.nullable().default(null),
  clinicianSplit: percent.nullable().default(null),
  capacity: z.number().min(0).max(100).nullable().default(null),
  payMode: z
    .enum(["existing_split", "salary", "hourly", "per_session"])
    .nullable()
    .default(null),
  payAmount: money.nullable().default(null),
  notes: note,
});

export const campaignMethods = [
  "cpl",
  "cac",
  "clicks",
  "historical",
  "manual",
  "custom",
] as const;
export const campaignSchema = z.object({
  ...named,
  planningOnly: z.boolean().default(false),
  ...dates,
  source: label,
  method: z.enum(campaignMethods),
  monthlySpend: money,
  otherMonthlyCost: money.default(0),
  cpl: money.default(50),
  cac: money.default(200),
  consultationPct: percent.default(80),
  attendancePct: percent.default(85),
  closePct: percent.default(50),
  cpm: money.default(20),
  ctrPct: percent.default(2),
  clickToLeadPct: percent.default(10),
  manualLeads: money.default(0),
  manualClients: money.default(0),
  overlapPct: percent.default(0),
  conversionDelayMonths: z.number().int().min(0).max(24).default(0),
  retentionMonths: z.number().min(1).max(120).default(6),
  sessionsPerClientMonth: z.number().min(0).max(31).default(4),
  historicalStart: dateSchema.nullable().default(null),
  historicalEnd: dateSchema.nullable().default(null),
  customKpiId: optionalId,
  economicsSource: z
    .enum(["forecast", "historical", "manual"])
    .default("forecast"),
  revenuePerSession: money.nullable().default(null),
  deliveryCostPerSession: money.nullable().default(null),
});
export const funnelSchema = z.object({
  sourceAttachmentId: optionalId,
  id,
  campaignId: id,
  periodId: id,
  spend: money.nullable(),
  leads: count.nullable(),
  scheduled: count.nullable(),
  attended: count.nullable(),
  clients: count.nullable(),
  firstSessions: count.nullable(),
  attributedRevenue: money.nullable().default(null),
  attributedSessions: count.nullable().default(null),
  deliveryCosts: money.nullable().default(null),
  notes: note,
});
export const transactionSchema = z.object({
  id,
  periodId: id,
  categoryId: id,
  date: dateSchema,
  description: label,
  amount: money,
  budgetId: optionalId,
  attachmentId: optionalId,
  campaignId: optionalId,
});
export const periodSchema = z.object({
  ...named,
  start: dateSchema,
  end: dateSchema,
  status: z.enum(["draft", "reviewed", "finalized"]).default("draft"),
  revenue: money.nullable().default(null),
  earnedRevenue: money.nullable().default(null),
  clinicianPay: money.nullable().default(null),
  employerBurden: money.nullable().default(null),
  staffPay: money.nullable().default(null),
  ownerPay: money.nullable().default(null),
  ownerClinicalPay: money.nullable().default(null),
  distributions: money.nullable().default(null),
  taxes: money.nullable().default(null),
  reserves: money.nullable().default(null),
  closingCash: money.nullable().default(null),
  expensesComplete: z.boolean().default(false),
  funnelComplete: z.boolean().default(false),
  finalizedAt: z.string().nullable().default(null),
  correctionReason: note,
});
export const allocationSchema = z.object({
  ...named,
  ...dates,
  kind: z.enum(["tax", "reserve", "distribution", "retained"]),
  percent,
  household: z.boolean().default(false),
});
export const hiringSchema = z.object({
  ...named,
  templateClinicianId: z.number().int().positive(),
  start: dateSchema,
  desiredWeeklySessions: z.number().min(1).max(100).default(25),
  recruiting: money.default(0),
  credentialing: money.default(0),
  training: money.default(0),
  equipment: money.default(0),
  preCaseloadPay: money.default(0),
  monthlySupport: money.default(0),
  delayMonths: z.number().int().min(0).max(24).default(2),
  rampMonths: z.number().int().min(1).max(36).default(6),
});

export const eventFields = [
  "marketing.spend",
  "marketing.cpl",
  "marketing.cac",
  "marketing.closePct",
  "clinician.hire",
  "clinician.capacity",
  "clinician.rate",
  "clinician.split",
  "clinician.payAmount",
  "room.add",
  "room.hours",
  "budget.amount",
  "assumption.retention",
  "assumption.attendance",
  "assumption.collection",
  "assumption.organic",
  "assumption.ownerPay",
  "custom",
] as const;
export const eventSchema = z
  .object({
    id,
    name: label,
    date: dateSchema,
    end: dateSchema.nullable().default(null),
    field: z.enum(eventFields),
    targetId: z.string().max(100).default(""),
    value: money,
    enabled: z.boolean().default(true),
    dependsOn: z.array(id).max(100).default([]),
    delayMonths: z.number().int().min(0).max(24).default(0),
    rampMonths: z.number().int().min(1).max(36).default(1),
    oneTimeCost: money.default(0),
    monthlyCost: money.default(0),
    notes: note,
    initiativeId: optionalId,
    sourceChangeId: id.optional(),
  })
  .superRefine((event, ctx) => {
    if (event.end && event.end < event.date)
      ctx.addIssue({
        code: "custom",
        path: ["end"],
        message: "End date must follow the effective date.",
      });
    if (
      [
        "marketing.closePct",
        "clinician.split",
        "assumption.retention",
        "assumption.attendance",
        "assumption.collection",
      ].includes(event.field) &&
      event.value > 100
    )
      ctx.addIssue({
        code: "custom",
        path: ["value"],
        message: "Percentage must be between 0 and 100.",
      });
    if (event.field === "room.add" && !Number.isInteger(event.value))
      ctx.addIssue({
        code: "custom",
        path: ["value"],
        message: "Room count must be a whole number.",
      });
    if (
      ["clinician.capacity", "clinician.hire"].includes(event.field) &&
      event.value > 100
    )
      ctx.addIssue({
        code: "custom",
        path: ["value"],
        message: "Weekly clinical capacity cannot exceed 100 sessions.",
      });
  });
export const goalSchema = z.object({
  ...named,
  metric: z.enum(["sessions", "revenue", "profit", "familyTakeHome"]),
  amount: money,
  date: dateSchema,
  basis: z.enum(["monthly", "annual"]).default("monthly"),
});
export const proposalSchema = z.object({
  ...named,
  status: z
    .enum([
      "draft",
      "approved",
      "active",
      "paused",
      "completed",
      "stopped",
      "rejected",
    ])
    .default("draft"),
  changes: z.array(eventSchema).max(200).default([]),
  cases: z
    .object({
      conservative: percent.default(75),
      expected: z.literal(100).default(100),
      optimistic: z.number().min(100).max(200).default(125),
    })
    .default({ conservative: 75, expected: 100, optimistic: 125 }),
  approvedIds: z.array(id).default([]),
  approvedAt: z.string().nullable().default(null),
  baseline: z.record(z.string(), z.unknown()).nullable().default(null),
});

export const operations = [
  "add",
  "subtract",
  "multiply",
  "divide",
  "min",
  "max",
] as const;
export const customKpiSchema = z.object({
  ...named,
  key: z.string().regex(/^[a-z][a-zA-Z0-9_]{1,60}$/),
  left: z.string().max(80),
  operation: z.enum(operations),
  right: z.string().max(80).default(""),
  constant: z.number().finite().nullable().default(null),
  unit: z.enum(["currency", "number", "percent"]),
  versions: z
    .array(
      z.object({
        effectiveDate: dateSchema,
        left: z.string().min(1).max(80),
        operation: z.enum(operations),
        right: z.string().max(80).default(""),
        constant: z.number().finite().nullable().default(null),
      }),
    )
    .max(120)
    .default([]),
});
export type Condition =
  | { id: string; type: "group"; logic: "all" | "any"; children: Condition[] }
  | {
      id: string;
      type: "condition";
      metric: string;
      operator: "gt" | "gte" | "lt" | "lte" | "eq" | "between" | "missing";
      value: number;
      upper: number;
      scope:
        | "practice"
        | "all"
        | "any"
        | "average"
        | "sum"
        | "count"
        | "percentage";
      clinicianIds: number[];
      periods: number;
      compareTo:
        | "value"
        | "previous"
        | "goal"
        | "forecast"
        | "budget"
        | "metric";
      comparisonMetric?: string;
      measure?: "value" | "change" | "changePct" | "average" | "sum";
      window?: number;
      start?: string | null;
      end?: string | null;
    };
export const conditionSchema: z.ZodType<Condition> = z.lazy(() =>
  z.discriminatedUnion("type", [
    z.object({
      id,
      type: z.literal("group"),
      logic: z.enum(["all", "any"]),
      children: z.array(conditionSchema).min(1).max(30),
    }),
    z.object({
      id,
      type: z.literal("condition"),
      metric: z.string().min(1).max(80),
      operator: z.enum(["gt", "gte", "lt", "lte", "eq", "between", "missing"]),
      value: z.number().finite(),
      upper: z.number().finite(),
      scope: z.enum([
        "practice",
        "all",
        "any",
        "average",
        "sum",
        "count",
        "percentage",
      ]),
      clinicianIds: z.array(z.number().int().positive()).max(1000),
      periods: z.number().int().min(1).max(60),
      compareTo: z.enum([
        "value",
        "previous",
        "goal",
        "forecast",
        "budget",
        "metric",
      ]),
      comparisonMetric: z.string().max(80).default(""),
      measure: z
        .enum(["value", "change", "changePct", "average", "sum"])
        .default("value"),
      window: z.number().int().min(1).max(60).default(1),
      start: dateSchema.nullable().default(null),
      end: dateSchema.nullable().default(null),
    }),
  ]),
);
export const ruleSchema = z.object({
  ...named,
  enabled: z.boolean().default(true),
  condition: conditionSchema,
  leadMonths: z.number().int().min(0).max(36).default(0),
  action: label,
  event: eventSchema.nullable().default(null),
  responses: z
    .array(
      z.object({
        id,
        name: label,
        offsetMonths: z.number().int().min(-36).max(36).default(0),
        eventId: optionalId,
      }),
    )
    .max(30)
    .default([]),
  status: z.enum(["open", "acknowledged", "completed"]).default("open"),
});

export const goalSearchSchema = z
  .object({
    metric: z.enum(["sessions", "revenue", "profit", "familyTakeHome"]),
    target: money,
    deadline: dateSchema,
    firstStart: dateSchema,
    lastStart: dateSchema,
    sustainMonths: z.number().int().min(1).max(12).default(1),
    minimumCash: z.number().finite().min(-1e10).max(1e10).default(0),
    objective: z
      .enum(["earliest", "fewest_hires", "lowest_cost"])
      .default("earliest"),
    hiring: z
      .array(
        z.object({ profileId: id, maxCount: z.number().int().min(0).max(10) }),
      )
      .max(3)
      .default([]),
    roomId: optionalId,
    maxRooms: z.number().int().min(0).max(10).default(0),
    roomSetupCost: money.default(0),
    roomMonthlyCost: money.default(0),
    campaignId: optionalId,
    spendMin: money.default(0),
    spendMax: money.default(0),
    spendStep: z.number().min(1).max(1e10).default(500),
  })
  .superRefine((s, ctx) => {
    if (s.lastStart < s.firstStart || s.deadline < s.lastStart)
      ctx.addIssue({
        code: "custom",
        message:
          "Search dates must be ordered: first start, last start, deadline.",
      });
    if (s.spendMax < s.spendMin)
      ctx.addIssue({
        code: "custom",
        path: ["spendMax"],
        message: "Maximum spend must be at least the minimum.",
      });
    if (s.maxRooms && !s.roomId)
      ctx.addIssue({
        code: "custom",
        path: ["roomId"],
        message: "Choose a room template.",
      });
    if (new Set(s.hiring.map((h) => h.profileId)).size !== s.hiring.length)
      ctx.addIssue({
        code: "custom",
        path: ["hiring"],
        message: "Choose each hiring profile once.",
      });
  });
export type GoalSearch = z.infer<typeof goalSearchSchema>;

export const settingsSchema = z.object({
  practiceName: label.default("EMCounseling"),
  teamId: z.number().int().positive().nullable().default(null),
  forecastStart: dateSchema,
  horizonMonths: z.number().int().min(1).max(60).default(24),
  baselineMode: z.enum(["manual", "historical"]).default("historical"),
  baselineWeeklySessions: money.nullable().default(null),
  baselineRetentionPct: percent.default(95),
  historicalStart: dateSchema,
  historicalEnd: dateSchema,
  attendancePct: percent.default(90),
  attendanceMode: z.enum(["manual", "historical"]).default("manual"),
  collectionPct: percent.default(100),
  processingPct: percent.default(0),
  collectionDelayMonths: z.number().int().min(0).max(12).default(0),
  openingReceivables: money.default(0),
  openingCash: z.number().finite().min(-1e10).max(1e10).default(0),
  minimumCash: money.default(0),
  organicClientsPerMonth: money.default(0),
  retentionMonths: z.number().min(1).max(120).default(6),
  sessionsPerClientMonth: z.number().min(0).max(31).default(4),
  ownerPayrollMonthly: money.default(0),
  ownerPayrollBurdenPct: percent.default(0),
  householdWithholdingPct: percent.default(0),
  includeOwnerClinical: z.boolean().default(true),
  otherHouseholdIncome: money.default(0),
  householdBenefitsCost: money.default(0),
  taxPct: percent.default(0),
  reservePct: percent.default(0),
  distributionPct: percent.default(0),
  targetProfitMonthly: money.default(0),
  defaultInPersonPct: percent.default(100),
  weeksPerYear: z.number().min(1).max(52.1786).default(48),
  goalSearch: goalSearchSchema.nullable().default(null),
});

export const workspaceSchema = z
  .object({
    settings: settingsSchema,
    categories: z.array(categorySchema).max(5000),
    budgets: z.array(budgetSchema).max(20000),
    locations: z.array(locationSchema).max(1000),
    rooms: z.array(roomSchema).max(5000),
    clinicians: z.array(clinicianSettingSchema).max(5000),
    terms: z.array(termSchema).max(10000),
    campaigns: z.array(campaignSchema).max(2000),
    funnels: z.array(funnelSchema).max(30000),
    transactions: z.array(transactionSchema).max(50000),
    periods: z.array(periodSchema).max(5000),
    allocations: z.array(allocationSchema).max(2000),
    hiring: z.array(hiringSchema).max(2000),
    events: z.array(eventSchema).max(5000),
    goals: z.array(goalSchema).max(2000),
    proposals: z.array(proposalSchema).max(1000),
    kpis: z.array(customKpiSchema).max(1000),
    rules: z.array(ruleSchema).max(1000),
  })
  .strict()
  .superRefine((data, ctx) => {
    const issue = (path: (string | number)[], message: string) =>
      ctx.addIssue({ code: "custom", path, message });
    for (const [key, rows] of Object.entries(data)) {
      if (!Array.isArray(rows)) continue;
      const ids = new Set<string>();
      rows.forEach((row, i) => {
        if (ids.has(row.id)) issue([key, i, "id"], "Duplicate record ID.");
        ids.add(row.id);
        if ("start" in row && "end" in row && row.end && row.start > row.end)
          issue([key, i, "end"], "End date must follow start date.");
      });
    }
    const exists = (rows: { id: string }[], value: string | null) =>
      value === null || rows.some((r) => r.id === value);
    data.categories.forEach((c, i) => {
      if (!exists(data.categories, c.parentId))
        issue(["categories", i, "parentId"], "Parent category not found.");
      const seen = new Set([c.id]);
      let parent = c.parentId;
      while (parent) {
        if (seen.has(parent)) {
          issue(
            ["categories", i, "parentId"],
            "Category hierarchy cannot contain a cycle.",
          );
          break;
        }
        seen.add(parent);
        parent = data.categories.find((x) => x.id === parent)?.parentId ?? null;
      }
    });
    data.budgets.forEach((b, i) => {
      if (!exists(data.categories, b.categoryId))
        issue(["budgets", i, "categoryId"], "Choose an existing category.");
      if (
        !exists(data.rooms, b.roomId) ||
        !exists(data.locations, b.locationId) ||
        !exists(data.campaigns, b.campaignId)
      )
        issue(["budgets", i], "Linked record not found.");
      if (b.cadence === "percent_revenue" && b.amount > 100)
        issue(["budgets", i, "amount"], "Percentage cannot exceed 100.");
    });
    data.rooms.forEach((r, i) => {
      if (!exists(data.locations, r.locationId))
        issue(["rooms", i, "locationId"], "Location not found.");
      r.blocks.forEach((b, j) => {
        if (b.endHour <= b.startHour)
          issue(["rooms", i, "blocks", j], "End time must follow start time.");
        if (
          r.blocks.some(
            (x, k) =>
              k < j &&
              x.day === b.day &&
              x.startHour < b.endHour &&
              b.startHour < x.endHour,
          )
        )
          issue(["rooms", i, "blocks", j], "Room availability blocks overlap.");
      });
    });
    data.transactions.forEach((t, i) => {
      const period = data.periods.find((p) => p.id === t.periodId);
      if (!period || t.date < period.start || t.date > period.end)
        issue(
          ["transactions", i, "date"],
          "Transaction must be inside its reporting period.",
        );
      if (
        !exists(data.categories, t.categoryId) ||
        !exists(data.budgets, t.budgetId) ||
        !exists(data.campaigns, t.campaignId)
      )
        issue(["transactions", i], "Linked financial record not found.");
    });
    data.funnels.forEach((f, i) => {
      if (
        !exists(data.campaigns, f.campaignId) ||
        !exists(data.periods, f.periodId)
      )
        issue(["funnels", i], "Choose an existing campaign and period.");
      if (
        data.funnels.some(
          (x, j) =>
            j < i && x.campaignId === f.campaignId && x.periodId === f.periodId,
        )
      )
        issue(["funnels", i], "Only one funnel entry per campaign and period.");
      if (
        f.scheduled !== null &&
        f.attended !== null &&
        f.attended > f.scheduled
      )
        issue(
          ["funnels", i, "attended"],
          "Attended consultations exceed scheduled consultations.",
        );
    });
    data.periods.forEach((p, i) => {
      if (
        data.periods.some(
          (x, j) =>
            j < i &&
            !x.archived &&
            !p.archived &&
            x.start <= p.end &&
            p.start <= x.end,
        )
      )
        issue(["periods", i], "Reporting periods cannot overlap.");
      if (
        p.status === "finalized" &&
        (p.revenue === null || !p.expensesComplete)
      )
        issue(
          ["periods", i],
          "Finalization requires collections and reviewed expenses.",
        );
    });
    const clinicianIds = new Set<number>();
    data.clinicians.forEach((c, i) => {
      if (clinicianIds.has(c.clinicianId))
        issue(["clinicians", i], "Only one operating profile per clinician.");
      clinicianIds.add(c.clinicianId);
      if (
        !exists(data.rooms, c.roomId) ||
        !exists(data.locations, c.locationId)
      )
        issue(["clinicians", i], "Linked room or location not found.");
      if (
        c.roomId &&
        c.locationId &&
        data.rooms.find((r) => r.id === c.roomId)?.locationId !== c.locationId
      )
        issue(
          ["clinicians", i, "roomId"],
          "Assigned room must belong to the selected location.",
        );
    });
    data.terms.forEach((t, i) => {
      if (
        data.terms.some(
          (x, j) =>
            j < i &&
            x.clinicianId === t.clinicianId &&
            x.effectiveDate === t.effectiveDate,
        )
      )
        issue(
          ["terms", i],
          "Only one compensation term per clinician and effective date.",
        );
    });
    const keys = new Set<string>();
    data.kpis.forEach((k, i) => {
      if (keys.has(k.key))
        issue(["kpis", i, "key"], "Custom KPI keys must be unique.");
      keys.add(k.key);
      if (metricMap[k.key] || k.key === "spend")
        issue(["kpis", i, "key"], "This key belongs to a built-in metric.");
      const known = (key: string) =>
        !!metricMap[key] ||
        key === "spend" ||
        data.kpis.some((other) => other.key === key);
      const definitions = [k, ...k.versions];
      if (
        definitions.some(
          (d) => !known(d.left) || (d.constant === null && !known(d.right)),
        )
      )
        issue(["kpis", i], "Choose registered inputs or a fixed right value.");
      if (
        new Set(k.versions.map((v) => v.effectiveDate)).size !==
        k.versions.length
      )
        issue(
          ["kpis", i, "versions"],
          "Only one formula version per effective date.",
        );
      const walk = (key: string, seen: Set<string>): boolean => {
        if (seen.has(key) || seen.size > 32) return false;
        const item = data.kpis.find((item) => item.key === key);
        if (!item) return true;
        const next = new Set([...seen, key]);
        return [item, ...item.versions].every(
          (d) =>
            walk(d.left, next) && (d.constant !== null || walk(d.right, next)),
        );
      };
      if (!walk(k.key, new Set()))
        issue(
          ["kpis", i],
          "KPI formulas cannot contain cycles or more than 32 linked steps.",
        );
    });
    data.rules.forEach((r, i) => {
      const known = (key: string) =>
        !!metricMap[key] || data.kpis.some((k) => k.key === key && !k.archived);
      let nodes = 0;
      const check = (c: Condition, depth: number): void => {
        if (++nodes > 200 || depth > 5) {
          issue(
            ["rules", i, "condition"],
            "Rules allow up to 200 conditions and 5 nested groups.",
          );
          return;
        }
        if (c.type === "group") {
          c.children.forEach((child) => check(child, depth + 1));
          return;
        }
        if (
          !known(c.metric) ||
          (c.compareTo === "metric" && !known(c.comparisonMetric ?? ""))
        )
          issue(["rules", i, "condition"], "Choose an available metric.");
        if (c.start && c.end && c.start > c.end)
          issue(
            ["rules", i, "condition"],
            "Rule end date must follow start date.",
          );
        if (
          c.compareTo === "budget" &&
          (c.scope !== "practice" || c.metric !== "overhead")
        )
          issue(
            ["rules", i, "condition"],
            "Budget comparisons use practice operating overhead.",
          );
        if (c.compareTo === "forecast" && c.scope !== "practice")
          issue(
            ["rules", i, "condition"],
            "Forecast comparisons use practice totals.",
          );
      };
      check(r.condition, 0);
      if (new Set(r.responses.map((x) => x.id)).size !== r.responses.length)
        issue(["rules", i, "responses"], "Response IDs must be unique.");
      r.responses.forEach((response) => {
        if (!exists(data.events, response.eventId))
          issue(
            ["rules", i, "responses"],
            "Response event template not found.",
          );
      });
    });
    const allocationDates = data.allocations
      .filter((a) => !a.archived)
      .map((a) => a.start);
    for (const date of allocationDates) {
      const total = data.allocations
        .filter(
          (a) => !a.archived && a.start <= date && (!a.end || a.end >= date),
        )
        .reduce((sum, a) => sum + a.percent, 0);
      if (total > 100) {
        issue(
          ["allocations"],
          `Active allocation percentages exceed 100% on ${date}.`,
        );
        break;
      }
    }
    if (data.settings.historicalStart > data.settings.historicalEnd)
      issue(["settings", "historicalEnd"], "Historical end must follow start.");
    if (
      data.settings.taxPct +
        data.settings.reservePct +
        data.settings.distributionPct >
      100
    )
      issue(
        ["settings", "distributionPct"],
        "Tax, reserve and distribution allocations exceed 100%.",
      );
  });

export type Workspace = z.infer<typeof workspaceSchema>;
export type Campaign = z.infer<typeof campaignSchema>;
export type PlanEvent = z.infer<typeof eventSchema>;
export type Proposal = z.infer<typeof proposalSchema>;
export type Rule = z.infer<typeof ruleSchema>;
export type Period = z.infer<typeof periodSchema>;
export type Collection = Exclude<keyof Workspace, "settings">;
export const collections: Collection[] = [
  "categories",
  "budgets",
  "locations",
  "rooms",
  "clinicians",
  "terms",
  "campaigns",
  "funnels",
  "transactions",
  "periods",
  "allocations",
  "hiring",
  "events",
  "goals",
  "proposals",
  "kpis",
  "rules",
];
export function emptyWorkspace(
  date = new Date().toISOString().slice(0, 10),
): Workspace {
  return workspaceSchema.parse({
    settings: {
      forecastStart: date.slice(0, 7) + "-01",
      historicalStart: date.slice(0, 7) + "-01",
      historicalEnd: date,
    },
    ...Object.fromEntries(collections.map((key) => [key, []])),
  });
}
