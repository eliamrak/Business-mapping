import {
  workspaceSchema,
  type Workspace,
  type Context,
} from "@workspace/practice/hub";
import { validatePracticeCopy, type PracticeCopy } from "./practice-goals.ts";

export type TransferSection =
  | "clinicians"
  | "sessions"
  | "marketing"
  | "rooms"
  | "budgets"
  | "money";
export type TransferSource = "today" | "planning" | "sandbox";
export type SectionBundle = {
  kind: "emc-section-v1";
  section: TransferSection;
  source: TransferSource;
  exportedAt: string;
  clinicianNames?: Record<string, string>;
  workspace: Omit<Partial<Workspace>, "settings"> & {
    settings?: Partial<Workspace["settings"]>;
  };
  context: Partial<Context>;
};

const moneySettings = [
  "collectionPct",
  "processingPct",
  "processingFixedPerTransaction",
  "processingTransactionsPerSession",
  "processingOpeningTransactions",
  "collectionDelayMonths",
  "openingReceivables",
  "openingCash",
  "minimumCash",
  "ownerPayrollMonthly",
  "ownerPayrollBurdenPct",
  "householdWithholdingPct",
  "includeOwnerClinical",
  "otherHouseholdIncome",
  "householdBenefitsCost",
  "taxPct",
  "reservePct",
  "distributionPct",
  "targetProfitMonthly",
] as const;

export function exportSection(
  copy: PracticeCopy,
  section: TransferSection,
  source: TransferSource,
): SectionBundle {
  const { workspace: w, context: c } = copy;
  const workspace: SectionBundle["workspace"] = {};
  const context: Partial<Context> = {};
  let clinicianNames: Record<string, string> | undefined;
  if (section === "clinicians") {
    workspace.clinicians = w.clinicians;
    workspace.terms = w.terms;
    workspace.hiring = w.hiring;
    context.clinicians = c.clinicians;
    context.staff = c.staff;
  } else if (section === "sessions") {
    context.sessions = c.sessions;
    clinicianNames = Object.fromEntries(
      c.clinicians.map((person) => [person.id, person.label]),
    );
  } else if (section === "marketing") {
    workspace.categories = w.categories.filter(
      (row) => row.kind === "marketing",
    );
    const ids = new Set(workspace.categories.map((row) => row.id));
    workspace.budgets = w.budgets.filter((row) => ids.has(row.categoryId));
    workspace.campaigns = w.campaigns;
    workspace.funnels = w.funnels;
  } else if (section === "rooms") {
    workspace.locations = w.locations;
    workspace.rooms = w.rooms;
  } else if (section === "budgets") {
    workspace.categories = w.categories.filter(
      (row) => row.kind !== "marketing",
    );
    const ids = new Set(workspace.categories.map((row) => row.id));
    workspace.budgets = w.budgets.filter((row) => ids.has(row.categoryId));
    workspace.settings = {
      overheadMode: w.settings.overheadMode,
      overheadFloorMonthly: w.settings.overheadFloorMonthly,
    };
  } else {
    workspace.allocations = w.allocations;
    workspace.transactions = w.transactions;
    workspace.periods = w.periods;
    workspace.settings = Object.fromEntries(
      moneySettings.map((key) => [key, w.settings[key]]),
    ) as Partial<Workspace["settings"]>;
  }
  return {
    kind: "emc-section-v1",
    section,
    source,
    exportedAt: new Date().toISOString(),
    clinicianNames,
    workspace,
    context,
  };
}

export function importSection(
  target: PracticeCopy,
  input: unknown,
  destination: TransferSource,
): PracticeCopy {
  if (!input || typeof input !== "object")
    throw new Error("Not an EMC section export.");
  const bundle = input as SectionBundle;
  if (
    bundle.kind !== "emc-section-v1" ||
    ![
      "clinicians",
      "sessions",
      "marketing",
      "rooms",
      "budgets",
      "money",
    ].includes(bundle.section)
  )
    throw new Error("Not a supported EMC section export.");
  if (
    !bundle.workspace ||
    typeof bundle.workspace !== "object" ||
    !bundle.context ||
    typeof bundle.context !== "object"
  )
    throw new Error("Section export is incomplete.");
  if (
    destination === "today" &&
    ["clinicians", "sessions"].includes(bundle.section)
  )
    throw new Error(
      "Clinician and session history cannot be replaced through section import into Today.",
    );
  const w = structuredClone(target.workspace);
  const c = structuredClone(target.context);
  const part = bundle.workspace;
  const data = bundle.context;
  if (bundle.section === "clinicians") {
    if (
      !Array.isArray(data.clinicians) ||
      !Array.isArray(data.staff) ||
      !Array.isArray(part.clinicians) ||
      !Array.isArray(part.terms) ||
      !Array.isArray(part.hiring)
    )
      throw new Error("Clinician export is incomplete.");
    const incoming = new Map(
      data.clinicians.map((person) => [person.id, person.label]),
    );
    const previous = new Map(
      c.clinicians.map((person) => [person.id, person.label]),
    );
    if (
      c.sessions.some(
        (record) =>
          !incoming.has(record.clinicianId) ||
          (previous.has(record.clinicianId) &&
            previous.get(record.clinicianId) !==
              incoming.get(record.clinicianId)),
      )
    )
      throw new Error(
        "Existing session history belongs to different clinicians. Import this team into a blank Sandbox, or clear the modeled sessions first.",
      );
    c.clinicians = data.clinicians.map((person) => ({
      ...person,
      goalId: w.settings.teamId,
    }));
    c.staff = data.staff.map((member) => ({
      ...member,
      goalId: w.settings.teamId,
    }));
    w.clinicians = part.clinicians;
    w.terms = part.terms;
    w.hiring = part.hiring;
    w.settings = {
      ...w.settings,
      baselineMode: "manual",
      baselineWeeklySessions: c.clinicians.reduce(
        (total, person) => total + person.sessionsPerWeek,
        0,
      ),
    };
  } else if (bundle.section === "sessions") {
    if (!Array.isArray(data.sessions))
      throw new Error("Session export is incomplete.");
    const names = Object.fromEntries(
      c.clinicians.map((person) => [person.id, person.label]),
    );
    if (
      data.sessions.some(
        (record) =>
          !bundle.clinicianNames ||
          names[record.clinicianId] !==
            bundle.clinicianNames[String(record.clinicianId)],
      )
    )
      throw new Error(
        "Session history needs the same clinicians in the destination. Import Clinicians & pay first.",
      );
    c.sessions = data.sessions;
  } else if (bundle.section === "marketing") {
    if (
      !Array.isArray(part.categories) ||
      !Array.isArray(part.budgets) ||
      !Array.isArray(part.campaigns) ||
      !Array.isArray(part.funnels)
    )
      throw new Error("Marketing export is incomplete.");
    if (part.categories.some((row) => row.kind !== "marketing"))
      throw new Error("Marketing export contains another category type.");
    const incomingIds = new Set(part.categories.map((row) => row.id));
    if (part.budgets.some((row) => !incomingIds.has(row.categoryId)))
      throw new Error("Marketing costs require their matching categories.");
    const oldIds = new Set(
      w.categories
        .filter((row) => row.kind === "marketing")
        .map((row) => row.id),
    );
    w.categories = [
      ...w.categories.filter((row) => row.kind !== "marketing"),
      ...part.categories,
    ];
    w.budgets = [
      ...w.budgets.filter((row) => !oldIds.has(row.categoryId)),
      ...part.budgets,
    ];
    w.campaigns = part.campaigns;
    if (destination !== "today") w.funnels = part.funnels;
  } else if (bundle.section === "rooms") {
    if (!Array.isArray(part.locations) || !Array.isArray(part.rooms))
      throw new Error("Room export is incomplete.");
    w.locations = part.locations;
    w.rooms = part.rooms;
  } else if (bundle.section === "budgets") {
    if (
      !Array.isArray(part.categories) ||
      !Array.isArray(part.budgets) ||
      !part.settings ||
      part.settings.overheadMode === undefined ||
      part.settings.overheadFloorMonthly === undefined
    )
      throw new Error("Budget export is incomplete.");
    if (part.categories.some((row) => row.kind === "marketing"))
      throw new Error("Budget export contains marketing categories.");
    const incomingIds = new Set(part.categories.map((row) => row.id));
    if (part.budgets.some((row) => !incomingIds.has(row.categoryId)))
      throw new Error("Expenses require their matching categories.");
    const oldIds = new Set(
      w.categories
        .filter((row) => row.kind !== "marketing")
        .map((row) => row.id),
    );
    w.categories = [
      ...w.categories.filter((row) => row.kind === "marketing"),
      ...part.categories,
    ];
    w.budgets = [
      ...w.budgets.filter((row) => !oldIds.has(row.categoryId)),
      ...part.budgets,
    ];
    w.settings = {
      ...w.settings,
      overheadMode: part.settings.overheadMode,
      overheadFloorMonthly: part.settings.overheadFloorMonthly,
    };
  } else {
    if (
      !Array.isArray(part.allocations) ||
      !Array.isArray(part.transactions) ||
      !Array.isArray(part.periods) ||
      !part.settings
    )
      throw new Error("Money flow export is incomplete.");
    if (moneySettings.some((key) => part.settings![key] === undefined))
      throw new Error("Money flow export is incomplete.");
    w.allocations = part.allocations;
    if (destination !== "today") {
      w.transactions = part.transactions;
      w.periods = part.periods;
    }
    w.settings = {
      ...w.settings,
      ...Object.fromEntries(
        moneySettings.map((key) => [key, part.settings![key]]),
      ),
    };
  }
  return validatePracticeCopy({
    workspace: workspaceSchema.parse(w),
    context: c,
  });
}
