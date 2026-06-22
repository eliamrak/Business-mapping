import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import {
  useListClinicians, useCreateClinician, useDeleteClinician, useUpdateClinician,
  useCopyClinicianToGoal,
  useListBusinessGoals, useUpdateBusinessGoal, useCreateBusinessGoal,
  useListScenarios, useCreateScenario, useDeleteScenario,
  useAddScenarioClinician, getScenario,
  getListCliniciansQueryKey, getListBusinessGoalsQueryKey, getListScenariosQueryKey,
  getGetScenarioQueryKey,
  useListStaffMembers, useCreateStaffMember, useUpdateStaffMember, useDeleteStaffMember,
  useCopyStaffToGoal,
  getListStaffMembersQueryKey,
} from "@workspace/api-client-react";
import type { Clinician, BusinessGoal, ScenarioDetail, StaffMember } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import {
  Plus, Trash, Save, ChevronDown, ChevronRight,
  BookMarked, X, Check, AlertCircle, TrendingUp,
  Loader2, Settings2, User, Users, FolderOpen, CheckCircle2, Download, Info,
  Monitor, Link2, CheckCheck,
} from "lucide-react";
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from "@/components/ui/tooltip";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ClinicianPresenterCard } from "@/components/clinician-presenter-card";
import { calculateClinicianMetrics, calculateBusinessGoalOutputs, calculateTotalStaffCost, calculateStaffMemberCost } from "@/lib/calculations";
import { formatCurrency } from "@/lib/format";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";

// ─── Helpers ────────────────────────────────────────────────────────────────

function useRelativeTime(ts: number | null): string | null {
  const compute = useCallback(() => {
    if (!ts) return null;
    const mins = Math.floor((Date.now() - ts) / 60_000);
    if (mins < 1) return "just now";
    if (mins === 1) return "1 min ago";
    if (mins < 60) return `${mins} mins ago`;
    const hrs = Math.floor(mins / 60);
    return hrs === 1 ? "1 hr ago" : `${hrs} hrs ago`;
  }, [ts]);

  const [label, setLabel] = useState<string | null>(compute);
  useEffect(() => {
    setLabel(compute());
    if (!ts) return;
    const id = setInterval(() => setLabel(compute()), 30_000);
    return () => clearInterval(id);
  }, [ts, compute]);
  return label;
}

// ─── Types ──────────────────────────────────────────────────────────────────

type SandboxClinician = {
  _localId: string;
  id?: number;
  label: string;
  roleType: string;
  classification: string;
  sessionRate: number;
  sessionsPerWeek: number;
  weeksWorkedPerYear: number;
  preCapClinicianSplit: number;
  preCapPracticeSplit: number;
  capEnabled: boolean;
  capAmount: number;
  postCapClinicianSplit: number;
  postCapPracticeSplit: number;
  w2EmployerFicaPct: number;
  futaSutaPct: number;
  workersCompPct: number;
  otherEmployerBurdenPct: number;
  nonClinicalHoursPerWeek: number;
  nonClinicalHourlyRate: number;
  notes: string;
  _dirty: boolean;
  _saving: boolean;
  _expanded: boolean;
  _version: number;
  _savedAt: number | null;
};

type SandboxGoal = {
  id?: number;
  ownerPayGoal: number;
  secondOwnerPayGoal: number;
  annualOverheadGoal: number;
  businessProfitGoal: number;
  buildingFundGoal: number;
  emergencyReserveGoal: number;
  growthFundGoal: number;
  desiredCliniciansCount: number;
};

type SandboxStaffMember = {
  _localId: string;
  id?: number;
  label: string;
  roleType: string;
  classification: string;
  annualSalary: number | null;
  hourlyRate: number | null;
  hoursPerWeek: number | null;
  weeksPerYear: number;
  w2EmployerFicaPct: number;
  futaSutaPct: number;
  workersCompPct: number;
  otherEmployerBurdenPct: number;
  notes: string;
  payMode: "salary" | "hourly";
  _dirty: boolean;
  _saving: boolean;
  _burdenOpen: boolean;
  _version: number;
  _savedAt: number | null;
};

// ─── Constants ──────────────────────────────────────────────────────────────

const DEFAULT_GOAL: SandboxGoal = {
  ownerPayGoal: 100000,
  secondOwnerPayGoal: 0,
  annualOverheadGoal: 50000,
  businessProfitGoal: 20000,
  buildingFundGoal: 0,
  emergencyReserveGoal: 10000,
  growthFundGoal: 0,
  desiredCliniciansCount: 5,
};

const DEFAULT_STAFF_FIELDS = {
  roleType: "admin",
  classification: "w2",
  annualSalary: 45000 as number | null,
  hourlyRate: null as number | null,
  hoursPerWeek: null as number | null,
  weeksPerYear: 52,
  w2EmployerFicaPct: 7.65,
  futaSutaPct: 1.0,
  workersCompPct: 0.5,
  otherEmployerBurdenPct: 0,
  notes: "",
  payMode: "salary" as "salary" | "hourly",
};

const DEFAULT_CLINICIAN_FIELDS = {
  roleType: "associate",
  classification: "w2",
  sessionRate: 175,
  sessionsPerWeek: 20,
  weeksWorkedPerYear: 48,
  preCapClinicianSplit: 60,
  preCapPracticeSplit: 40,
  capEnabled: true,
  capAmount: 50000,
  postCapClinicianSplit: 75,
  postCapPracticeSplit: 25,
  w2EmployerFicaPct: 7.65,
  futaSutaPct: 1.0,
  workersCompPct: 0.5,
  otherEmployerBurdenPct: 0,
  nonClinicalHoursPerWeek: 0,
  nonClinicalHourlyRate: 0,
  notes: "",
};

let localIdCounter = 0;
function makeLocalId() { return `local-${++localIdCounter}`; }

// ─── Converters ─────────────────────────────────────────────────────────────

function clinicianToSandbox(c: Clinician | ScenarioDetail["clinicians"][number]): SandboxClinician {
  return {
    _localId: makeLocalId(),
    id: undefined,
    label: c.label,
    roleType: c.roleType,
    classification: String(c.classification),
    sessionRate: c.sessionRate,
    sessionsPerWeek: c.sessionsPerWeek,
    weeksWorkedPerYear: c.weeksWorkedPerYear,
    preCapClinicianSplit: c.preCapClinicianSplit,
    preCapPracticeSplit: c.preCapPracticeSplit,
    capEnabled: c.capEnabled,
    capAmount: c.capAmount,
    postCapClinicianSplit: c.postCapClinicianSplit,
    postCapPracticeSplit: c.postCapPracticeSplit,
    w2EmployerFicaPct: c.w2EmployerFicaPct,
    futaSutaPct: c.futaSutaPct,
    workersCompPct: c.workersCompPct,
    otherEmployerBurdenPct: c.otherEmployerBurdenPct,
    nonClinicalHoursPerWeek: (c as Clinician).nonClinicalHoursPerWeek ?? 0,
    nonClinicalHourlyRate: (c as Clinician).nonClinicalHourlyRate ?? 0,
    notes: c.notes ?? "",
    _dirty: false,
    _saving: false,
    _expanded: false,
    _version: 0,
    _savedAt: null,
  };
}

function teamClinicianToSandbox(c: Clinician): SandboxClinician {
  return { ...clinicianToSandbox(c), id: c.id };
}

function goalToSandbox(g: BusinessGoal): SandboxGoal {
  return {
    id: g.id,
    ownerPayGoal: g.ownerPayGoal,
    secondOwnerPayGoal: g.secondOwnerPayGoal,
    annualOverheadGoal: g.annualOverheadGoal,
    businessProfitGoal: g.businessProfitGoal,
    buildingFundGoal: g.buildingFundGoal,
    emergencyReserveGoal: g.emergencyReserveGoal,
    growthFundGoal: g.growthFundGoal,
    desiredCliniciansCount: g.desiredCliniciansCount,
  };
}

function staffMemberToSandbox(s: StaffMember): SandboxStaffMember {
  return {
    _localId: makeLocalId(),
    id: s.id,
    label: s.label,
    roleType: String(s.roleType),
    classification: String(s.classification),
    annualSalary: s.annualSalary ?? null,
    hourlyRate: s.hourlyRate ?? null,
    hoursPerWeek: s.hoursPerWeek ?? null,
    weeksPerYear: s.weeksPerYear,
    w2EmployerFicaPct: s.w2EmployerFicaPct,
    futaSutaPct: s.futaSutaPct,
    workersCompPct: s.workersCompPct,
    otherEmployerBurdenPct: s.otherEmployerBurdenPct,
    notes: s.notes ?? "",
    payMode: s.annualSalary != null && s.annualSalary > 0 ? "salary" : "hourly",
    _dirty: false,
    _saving: false,
    _burdenOpen: false,
    _version: 0,
    _savedAt: null,
  };
}

// ─── InlineNumber ─────────────────────────────────────────────────────────────
// Updates parent on every valid keystroke for instant live summary recalculation.

function InlineNumber({
  label, value, onChange, step = 1, prefix, suffix,
}: {
  label: string; value: number; onChange: (v: number) => void;
  step?: number; prefix?: string; suffix?: string;
}) {
  const [raw, setRaw] = useState(String(value));

  useEffect(() => { setRaw(String(value)); }, [value]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const s = e.target.value;
    setRaw(s);
    const n = parseFloat(s);
    if (!isNaN(n) && n >= 0) onChange(n);
  };

  const handleBlur = () => {
    const n = parseFloat(raw);
    if (isNaN(n) || n < 0) setRaw(String(value));
  };

  return (
    <div className="space-y-0.5">
      <span className="text-[11px] text-muted-foreground">{label}</span>
      <div className="flex items-center gap-0.5">
        {prefix && <span className="text-xs text-muted-foreground">{prefix}</span>}
        <Input
          type="number"
          step={step}
          min={0}
          value={raw}
          onChange={handleChange}
          onBlur={handleBlur}
          className="h-11 sm:h-7 text-sm px-2 w-full"
        />
        {suffix && <span className="text-xs text-muted-foreground">{suffix}</span>}
      </div>
    </div>
  );
}

// ─── SplitInput ──────────────────────────────────────────────────────────────
// Updates parent on every valid keystroke.

function SplitInput({ clinicianSplit, onClinicianChange }: {
  clinicianSplit: number;
  onClinicianChange: (v: number) => void;
}) {
  const [raw, setRaw] = useState(String(clinicianSplit));

  useEffect(() => { setRaw(String(clinicianSplit)); }, [clinicianSplit]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const s = e.target.value;
    setRaw(s);
    const n = parseFloat(s);
    if (!isNaN(n)) {
      const clamped = Math.min(100, Math.max(0, n));
      onClinicianChange(clamped);
    }
  };

  const handleBlur = () => {
    const n = Math.min(100, Math.max(0, parseFloat(raw) || 0));
    onClinicianChange(n);
    setRaw(String(n));
  };

  const practiceShare = Math.round((100 - clinicianSplit) * 10) / 10;

  return (
    <div className="space-y-0.5">
      <span className="text-[11px] text-muted-foreground flex items-center gap-1">
        Split (clx / practice)
        <InfoTip text="The % of each session fee going to the clinician vs. staying with the practice. 'Clx' = clinician. The two numbers always add up to 100." />
      </span>
      <div className="flex items-center gap-1">
        <Input
          type="number" step={1} min={0} max={100}
          value={raw}
          onChange={handleChange}
          onBlur={handleBlur}
          className="h-11 sm:h-7 text-sm px-2 w-16 sm:w-14"
        />
        <span className="text-xs text-muted-foreground">/</span>
        <span className="text-sm font-medium w-10 text-right">{practiceShare}%</span>
      </div>
    </div>
  );
}

// ─── InfoTip ─────────────────────────────────────────────────────────────────

function InfoTip({ text }: { text: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className="cursor-help shrink-0 inline-flex items-center"
          onClick={e => e.stopPropagation()}
        >
          <Info className="h-3 w-3 text-muted-foreground/50" />
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-[220px] text-center leading-snug whitespace-normal">
        {text}
      </TooltipContent>
    </Tooltip>
  );
}

// ─── CardMetric ──────────────────────────────────────────────────────────────

type CardMetric =
  | "coversOverhead"
  | "overheadCostAdded"
  | "coversTotalGoal"
  | "practiceContribution"
  | "netAfterEmployerTaxes"
  | "fullyLoadedProfit";

const CARD_METRIC_LABELS: Record<CardMetric, string> = {
  coversOverhead:        "Covers overhead",
  overheadCostAdded:    "Overhead cost added",
  coversTotalGoal:       "Covers total goal",
  practiceContribution:  "Practice contribution",
  netAfterEmployerTaxes: "Net after employer taxes",
  fullyLoadedProfit:     "Fully loaded profit",
};

type OverheadAllocationModel = "equal" | "revenue" | "session";

// ─── SandboxStaffCard ────────────────────────────────────────────────────────

const STAFF_ROLE_OPTIONS = [
  { value: "admin", label: "Admin / Office Manager" },
  { value: "billing", label: "Billing Coordinator" },
  { value: "front_desk", label: "Front Desk" },
  { value: "other", label: "Other" },
];

function SandboxStaffCard({
  staff,
  onChange,
  onSave,
  onRemove,
}: {
  staff: SandboxStaffMember;
  onChange: (localId: string, patch: Partial<SandboxStaffMember>) => void;
  onSave: (localId: string) => void;
  onRemove: (localId: string) => void;
}) {
  const savedLabel = useRelativeTime(staff._savedAt);
  const [savedVisible, setSavedVisible] = useState(false);
  const [savedOpaque, setSavedOpaque] = useState(false);

  const onSaveRef = useRef(onSave);
  useEffect(() => { onSaveRef.current = onSave; }, [onSave]);

  useEffect(() => {
    if (!staff._savedAt) return;
    setSavedVisible(true);
    const tIn  = setTimeout(() => setSavedOpaque(true), 50);
    const tOut = setTimeout(() => setSavedOpaque(false), 1500);
    const tEnd = setTimeout(() => setSavedVisible(false), 2200);
    return () => { clearTimeout(tIn); clearTimeout(tOut); clearTimeout(tEnd); };
  }, [staff._savedAt]);

  useEffect(() => {
    if (!staff._dirty || staff._saving) return;
    const timer = setTimeout(() => {
      onSaveRef.current(staff._localId);
    }, 800);
    return () => clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [staff]);

  const setField = useCallback((name: string, value: unknown) => {
    onChange(staff._localId, { [name]: value, _dirty: true, _version: staff._version + 1 } as Partial<SandboxStaffMember>);
  }, [staff._localId, staff._version, onChange]);

  const isW2 = String(staff.classification).toLowerCase() === "w2";

  const { totalAnnualCost } = useMemo(() => calculateStaffMemberCost({
    annualSalary: staff.payMode === "salary" ? staff.annualSalary : null,
    hourlyRate: staff.payMode === "hourly" ? staff.hourlyRate : null,
    hoursPerWeek: staff.payMode === "hourly" ? staff.hoursPerWeek : null,
    weeksPerYear: staff.weeksPerYear,
    classification: staff.classification,
    w2EmployerFicaPct: staff.w2EmployerFicaPct,
    futaSutaPct: staff.futaSutaPct,
    workersCompPct: staff.workersCompPct,
    otherEmployerBurdenPct: staff.otherEmployerBurdenPct,
  }), [staff]);

  return (
    <div className={`rounded-lg border bg-card transition-all ${staff._dirty ? "border-amber-300 shadow-sm" : ""}`}>
      <div className="p-3 space-y-2">
        {/* Row 1: name + role + remove */}
        <div className="flex items-center gap-2">
          <Input
            value={staff.label}
            onChange={e => setField("label", e.target.value)}
            className="h-11 sm:h-7 text-sm font-semibold border-transparent bg-transparent hover:border-input focus:border-input px-1.5 flex-1 min-w-0"
            placeholder="Staff name"
          />
          <Select value={staff.roleType} onValueChange={v => setField("roleType", v)}>
            <SelectTrigger className="h-11 sm:h-7 w-28 text-[11px] shrink-0">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STAFF_ROLE_OPTIONS.map(o => (
                <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={staff.classification} onValueChange={v => setField("classification", v)}>
            <SelectTrigger className="h-11 sm:h-7 w-24 text-[11px] shrink-0">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="w2">W2</SelectItem>
              <SelectItem value="contractor">1099</SelectItem>
            </SelectContent>
          </Select>
          <button
            onClick={() => onRemove(staff._localId)}
            className="h-11 w-11 sm:h-7 sm:w-7 flex items-center justify-center shrink-0 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* Row 2: pay mode toggle + pay inputs */}
        <div className="space-y-2">
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setField("payMode", "salary")}
              className={`px-2 py-0.5 rounded text-[11px] transition-colors border ${staff.payMode === "salary" ? "bg-primary text-primary-foreground border-primary" : "border-muted-foreground/30 text-muted-foreground hover:text-foreground"}`}
            >
              Salary
            </button>
            <button
              type="button"
              onClick={() => setField("payMode", "hourly")}
              className={`px-2 py-0.5 rounded text-[11px] transition-colors border ${staff.payMode === "hourly" ? "bg-primary text-primary-foreground border-primary" : "border-muted-foreground/30 text-muted-foreground hover:text-foreground"}`}
            >
              Hourly
            </button>
            <span className="ml-auto text-xs font-semibold text-primary">
              {formatCurrency(totalAnnualCost)}/yr
            </span>
          </div>

          {staff.payMode === "salary" ? (
            <InlineNumber
              label="Annual Salary"
              prefix="$"
              value={staff.annualSalary ?? 0}
              onChange={v => onChange(staff._localId, { annualSalary: v, hourlyRate: null, hoursPerWeek: null, _dirty: true, _version: staff._version + 1 })}
            />
          ) : (
            <div className="grid grid-cols-3 gap-2">
              <InlineNumber
                label="Hourly Rate"
                prefix="$"
                step={0.01}
                value={staff.hourlyRate ?? 0}
                onChange={v => onChange(staff._localId, { hourlyRate: v, annualSalary: null, _dirty: true, _version: staff._version + 1 })}
              />
              <InlineNumber
                label="Hrs/Wk"
                step={0.5}
                value={staff.hoursPerWeek ?? 0}
                onChange={v => onChange(staff._localId, { hoursPerWeek: v, _dirty: true, _version: staff._version + 1 })}
              />
              <InlineNumber
                label="Wks/Yr"
                value={staff.weeksPerYear}
                onChange={v => setField("weeksPerYear", v)}
              />
            </div>
          )}
        </div>

        {/* W2 burden section (collapsible) */}
        {isW2 && (
          <div>
            <button
              type="button"
              onClick={() => onChange(staff._localId, { _burdenOpen: !staff._burdenOpen } as Partial<SandboxStaffMember>)}
              className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
            >
              {staff._burdenOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
              Employer burden
            </button>
            {staff._burdenOpen && (
              <div className="grid grid-cols-2 gap-2 mt-2">
                <InlineNumber label="FICA %" step={0.01} suffix="%" value={staff.w2EmployerFicaPct} onChange={v => setField("w2EmployerFicaPct", v)} />
                <InlineNumber label="FUTA/SUTA %" step={0.01} suffix="%" value={staff.futaSutaPct} onChange={v => setField("futaSutaPct", v)} />
                <InlineNumber label="Workers' Comp %" step={0.01} suffix="%" value={staff.workersCompPct} onChange={v => setField("workersCompPct", v)} />
                <InlineNumber label="Other Burden %" step={0.01} suffix="%" value={staff.otherEmployerBurdenPct} onChange={v => setField("otherEmployerBurdenPct", v)} />
              </div>
            )}
          </div>
        )}

        {/* Save indicator */}
        <div className="flex items-center justify-end gap-1.5 min-h-[14px]">
          {staff._saving && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
          {savedVisible && !staff._saving && (
            <span className={`text-[10px] text-muted-foreground flex items-center gap-0.5 transition-opacity duration-500 ${savedOpaque ? "opacity-100" : "opacity-0"}`}>
              <CheckCheck className="h-3 w-3" />
              {savedLabel}
            </span>
          )}
          {staff._dirty && !staff._saving && (
            <span className="text-[10px] text-amber-500 flex items-center gap-0.5">
              <Save className="h-3 w-3" /> Saving…
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── LiveSummaryPanel ────────────────────────────────────────────────────────

function LiveSummaryPanel({
  clinicians,
  goal,
  staff,
}: {
  clinicians: SandboxClinician[];
  goal: SandboxGoal;
  staff: SandboxStaffMember[];
}) {
  const staffCostBreakdown = useMemo(() => {
    let salaries = 0;
    let burden = 0;
    for (const s of staff) {
      const { baseAnnualCost, employerBurden } = calculateStaffMemberCost({
        annualSalary: s.annualSalary,
        hourlyRate: s.hourlyRate,
        hoursPerWeek: s.hoursPerWeek,
        weeksPerYear: s.weeksPerYear,
        classification: String(s.classification),
        w2EmployerFicaPct: s.w2EmployerFicaPct,
        futaSutaPct: s.futaSutaPct,
        workersCompPct: s.workersCompPct,
        otherEmployerBurdenPct: s.otherEmployerBurdenPct,
      });
      salaries += baseAnnualCost;
      burden += employerBurden;
    }
    return { salaries, burden, total: salaries + burden };
  }, [staff]);

  const totalStaffCost = staffCostBreakdown.total;

  const metrics = clinicians.map(c => calculateClinicianMetrics(c));
  const totalProduction = metrics.reduce((s, m) => s + m.annualProduction, 0);
  const totalComp = metrics.reduce((s, m) => s + m.clinicianCompensation, 0);
  const totalBurden = metrics.reduce((s, m) => s + m.employerObligations, 0);
  const totalPracticeNet = metrics.reduce((s, m) => s + m.practiceNetBeforeOverhead, 0);
  const overhead = goal.annualOverheadGoal || 0;
  const netAfterOverhead = totalPracticeNet - overhead - totalStaffCost;
  const goalOutputs = calculateBusinessGoalOutputs(goal as Partial<BusinessGoal>);
  // totalAnnualBusinessNeed already includes overhead, so compare against
  // totalPracticeNet minus staff cost — staff overhead reduces the available
  // net the same way any other real expense does.
  const effectivePracticeNet = totalPracticeNet - totalStaffCost;
  const gap = goalOutputs.totalAnnualBusinessNeed - effectivePracticeNet;
  const isOnTrack = effectivePracticeNet >= goalOutputs.totalAnnualBusinessNeed;
  const pct = goalOutputs.totalAnnualBusinessNeed > 0
    ? Math.round((effectivePracticeNet / goalOutputs.totalAnnualBusinessNeed) * 100)
    : 100;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <TrendingUp className="h-4 w-4 text-primary" />
        <h3 className="font-semibold text-sm">Live Summary</h3>
        {clinicians.length > 0 && (
          <Badge variant="secondary" className="text-[10px] ml-auto">
            {clinicians.length} clinician{clinicians.length !== 1 ? "s" : ""}
          </Badge>
        )}
      </div>

      {clinicians.length === 0 ? (
        <div className="rounded-lg border border-dashed p-6 text-center">
          <User className="h-6 w-6 text-muted-foreground mx-auto mb-2" />
          <p className="text-xs text-muted-foreground">Add clinicians to see live projections</p>
        </div>
      ) : (
        <div className="space-y-2">
          <div className="rounded-lg bg-muted/50 border p-3 space-y-2">
            <div className="flex justify-between text-xs">
              <span className="text-muted-foreground flex items-center gap-1">Gross Production <InfoTip text="Total session revenue all clinicians generate (sessions × rate × weeks worked)." /></span>
              <span className="font-semibold">{formatCurrency(totalProduction)}</span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-muted-foreground flex items-center gap-1">Clinician Comp <InfoTip text="Total gross compensation paid to all clinicians on the roster, before their personal taxes." /></span>
              <span className="font-semibold text-amber-600">−{formatCurrency(totalComp)}</span>
            </div>
            {totalBurden > 0 && (
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground flex items-center gap-1">Employer Burden <InfoTip text="Employer-side payroll taxes on W2 clinicians: FICA (7.65%), FUTA/SUTA, and workers' comp. $0 for 1099 contractors." /></span>
                <span className="font-semibold text-amber-600">−{formatCurrency(totalBurden)}</span>
              </div>
            )}
            <Separator className="my-1" />
            <div className="flex justify-between text-xs">
              <span className="text-muted-foreground flex items-center gap-1">Practice Net <InfoTip text="Revenue left for the practice after paying all clinicians and any W2 employer taxes. Overhead and profit come out of this." /></span>
              <span className="font-semibold text-primary">{formatCurrency(totalPracticeNet)}</span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-muted-foreground flex items-center gap-1">Est. Overhead <InfoTip text="Your annual overhead goal from Practice Inputs — facilities, admin, software, etc." /></span>
              <span className="font-semibold text-muted-foreground">−{formatCurrency(overhead)}</span>
            </div>
            {staffCostBreakdown.salaries > 0 && (
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground flex items-center gap-1">Staff Salaries <InfoTip text="Total base compensation for all non-clinical staff (salaries or hourly pay × hours × weeks)." /></span>
                <span className="font-semibold text-amber-600">−{formatCurrency(staffCostBreakdown.salaries)}</span>
              </div>
            )}
            {staffCostBreakdown.burden > 0 && (
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground flex items-center gap-1">Staff Employer Burden <InfoTip text="Employer-side payroll taxes on W2 staff: FICA, FUTA/SUTA, and workers' comp. $0 for 1099 contractors." /></span>
                <span className="font-semibold text-amber-600">−{formatCurrency(staffCostBreakdown.burden)}</span>
              </div>
            )}
            <Separator className="my-1" />
            <div className="flex justify-between text-sm">
              <span className="font-semibold flex items-center gap-1">Net After Overhead <InfoTip text="Practice net minus overhead and staff costs. This is the pool available for owner pay and business profit." /></span>
              <span className={`font-bold ${netAfterOverhead >= 0 ? "text-primary" : "text-destructive"}`}>
                {formatCurrency(netAfterOverhead)}
              </span>
            </div>
          </div>

          {goalOutputs.totalAnnualBusinessNeed > 0 && (
            <div className={`rounded-lg border p-3 space-y-2 ${isOnTrack ? "border-green-400 bg-green-50" : "border-red-300 bg-red-50"}`}>
              <div className="flex items-center gap-2">
                {isOnTrack
                  ? <Check className="h-4 w-4 text-green-600 shrink-0" />
                  : <AlertCircle className="h-4 w-4 text-destructive shrink-0" />
                }
                <span className={`text-xs font-semibold ${isOnTrack ? "text-green-700" : "text-destructive"}`}>
                  {isOnTrack ? "Goal Achieved" : "Below Goal"}
                </span>
                <span className="ml-auto flex items-center gap-1">
                  <InfoTip text="How much of your total annual business need your current clinician roster is meeting (Practice Net ÷ Goal Target)." />
                  <span className={`text-xs font-bold ${isOnTrack ? "text-green-700" : "text-destructive"}`}>{pct}%</span>
                </span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground flex items-center gap-1">Goal Target <InfoTip text="Your complete annual business need: owner pay + overhead + profit goal. Everything the practice must generate." /></span>
                <span className="font-semibold">{formatCurrency(goalOutputs.totalAnnualBusinessNeed)}</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground flex items-center gap-1">
                  {isOnTrack ? "Surplus" : "Gap"}
                  <InfoTip text={isOnTrack ? "How much your practice net exceeds the Goal Target." : "How much more practice net you need to hit your Goal Target."} />
                </span>
                <span className={`font-bold ${isOnTrack ? "text-green-600" : "text-destructive"}`}>
                  {isOnTrack
                    ? `+${formatCurrency(Math.abs(gap))}`
                    : `−${formatCurrency(Math.abs(gap))}`}
                </span>
              </div>
              <div className="w-full bg-muted rounded-full h-1.5 mt-1">
                <div
                  className={`h-1.5 rounded-full transition-all ${isOnTrack ? "bg-green-500" : "bg-red-400"}`}
                  style={{ width: `${Math.max(0, Math.min(100, pct))}%` }}
                />
              </div>
            </div>
          )}

          <div className="rounded-lg bg-muted/50 border p-3 space-y-1.5">
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Per Month</p>
            <div className="flex justify-between text-xs">
              <span className="text-muted-foreground">Monthly Net</span>
              <span className="font-semibold">{formatCurrency(effectivePracticeNet / 12)}</span>
            </div>
            {goalOutputs.totalAnnualBusinessNeed > 0 && (
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">Monthly Goal Need</span>
                <span className="font-semibold">{formatCurrency(goalOutputs.totalAnnualBusinessNeed / 12)}</span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── ClinicianCard ───────────────────────────────────────────────────────────

function ClinicianCard({
  clinician,
  onChange,
  onSave,
  onRemove,
  overhead,
  totalAnnualBusinessNeed,
  selectedMetric,
  onSelectMetric,
  overheadAllocationModel,
  totalAnnualSessions,
  totalAnnualRevenue,
  clinicianCount,
}: {
  clinician: SandboxClinician;
  onChange: (localId: string, patch: Partial<SandboxClinician>) => void;
  onSave: (localId: string) => void;
  onRemove: (localId: string) => void;
  overhead: number;
  totalAnnualBusinessNeed: number;
  selectedMetric: CardMetric;
  onSelectMetric: (m: CardMetric) => void;
  overheadAllocationModel: OverheadAllocationModel;
  totalAnnualSessions: number;
  totalAnnualRevenue: number;
  clinicianCount: number;
}) {
  const metrics = useMemo(() => calculateClinicianMetrics(clinician), [clinician]);
  const savedLabel = useRelativeTime(clinician._savedAt);
  const [breakdownOpen, setBreakdownOpen] = useState(false);
  const [nonClinicalOpen, setNonClinicalOpen] = useState(false);
  const [presentOpen, setPresentOpen] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);

  const isW2 = String(clinician.classification).toLowerCase() === "w2";

  const allocatedOverhead = useMemo(() => {
    if (overhead <= 0) return 0;
    switch (overheadAllocationModel) {
      case "equal":
        return clinicianCount > 0 ? overhead / clinicianCount : overhead;
      case "revenue":
        return totalAnnualRevenue > 0 ? (metrics.annualProduction / totalAnnualRevenue) * overhead : 0;
      case "session":
        return totalAnnualSessions > 0 ? (metrics.annualSessions / totalAnnualSessions) * overhead : 0;
    }
  }, [overheadAllocationModel, overhead, clinicianCount, totalAnnualRevenue, totalAnnualSessions, metrics]);

  const profitabilityData = useMemo(() => {
    const contributionMargin = metrics.practiceNetBeforeOverhead;
    const fullyLoadedProfit = contributionMargin - allocatedOverhead;
    const weeksWorked = clinician.weeksWorkedPerYear || 1;
    const retainedPerSession = metrics.annualSessions > 0
      ? contributionMargin / metrics.annualSessions
      : 0;
    const breakEvenSessionsPerYear = retainedPerSession > 0
      ? allocatedOverhead / retainedPerSession
      : allocatedOverhead > 0 ? Infinity : 0;
    const breakEvenSessionsPerWeek = isFinite(breakEvenSessionsPerYear)
      ? breakEvenSessionsPerYear / weeksWorked
      : Infinity;
    const sessionsVsBreakEven = isFinite(breakEvenSessionsPerWeek)
      ? clinician.sessionsPerWeek - breakEvenSessionsPerWeek
      : -Infinity;
    const isProfit = fullyLoadedProfit > 0;
    const isLosing = contributionMargin <= 0;
    const isBelowBreakEven = !isProfit && !isLosing && isFinite(breakEvenSessionsPerWeek) && clinician.sessionsPerWeek < breakEvenSessionsPerWeek;
    const status: string = isProfit
      ? "Profitable"
      : isLosing
      ? "Losing Money"
      : isBelowBreakEven
      ? "Below Break-Even"
      : "Covers Direct Costs Only";
    return { contributionMargin, fullyLoadedProfit, breakEvenSessionsPerWeek, sessionsVsBreakEven, status, isProfit, isLosing, isBelowBreakEven };
  }, [metrics, allocatedOverhead, clinician.sessionsPerWeek, clinician.weeksWorkedPerYear]);

  const metricRows = useMemo(() => {
    const overheadCostPct = isW2 && overhead > 0
      ? Math.round((metrics.employerObligations / overhead) * 100)
      : null;
    const coversOverheadPct = overhead > 0
      ? Math.round((metrics.practiceNetBeforeOverhead / overhead) * 100)
      : null;
    const coversTotalPct = totalAnnualBusinessNeed > 0
      ? Math.round((metrics.practiceNetBeforeOverhead / totalAnnualBusinessNeed) * 100)
      : null;
    const netVal = metrics.practiceNetBeforeOverhead;
    const pctColor = (pct: number | null) =>
      pct === null ? "text-muted-foreground"
      : pct >= 100  ? "text-green-600"
      : pct >= 50   ? "text-amber-600"
      :               "text-red-600";
    const dollarColor = (v: number) => v >= 0 ? "text-green-600" : "text-red-600";
    const overheadCostColor = (pct: number | null) =>
      pct === null ? "text-muted-foreground"
      : pct <= 5   ? "text-green-600"
      : pct <= 15  ? "text-amber-600"
      :              "text-red-600";
    return [
      {
        id: "overheadCostAdded" as CardMetric,
        value: overheadCostPct !== null ? `${overheadCostPct}% of overhead` : "—",
        valueColor: overheadCostColor(overheadCostPct),
      },
      {
        id: "coversOverhead" as CardMetric,
        value: coversOverheadPct !== null ? `${coversOverheadPct}% of overhead` : "—",
        valueColor: pctColor(coversOverheadPct),
      },
      {
        id: "coversTotalGoal" as CardMetric,
        value: coversTotalPct !== null ? `${coversTotalPct}% of goal` : "—",
        valueColor: pctColor(coversTotalPct),
      },
      {
        id: "practiceContribution" as CardMetric,
        value: formatCurrency(netVal),
        valueColor: dollarColor(netVal),
      },
      {
        id: "netAfterEmployerTaxes" as CardMetric,
        value: isW2
          ? `${formatCurrency(metrics.practiceGrossRevenue)} → ${formatCurrency(netVal)}`
          : formatCurrency(netVal),
        valueColor: dollarColor(netVal),
      },
      {
        id: "fullyLoadedProfit" as CardMetric,
        value: formatCurrency(profitabilityData.fullyLoadedProfit),
        valueColor: dollarColor(profitabilityData.fullyLoadedProfit),
      },
    ];
  }, [metrics, overhead, totalAnnualBusinessNeed, isW2, profitabilityData]);

  const badgeData = useMemo((): { label: string; cls: string } | null => {
    switch (selectedMetric) {
      case "coversOverhead": {
        if (overhead <= 0) return null;
        const pct = Math.round((metrics.practiceNetBeforeOverhead / overhead) * 100);
        const cls = pct >= 100 ? "bg-green-100 text-green-700" : pct >= 50 ? "bg-amber-100 text-amber-700" : "bg-red-50 text-red-600";
        return { label: `${pct}% of overhead`, cls };
      }
      case "overheadCostAdded": {
        if (!isW2) return { label: "—", cls: "bg-muted text-muted-foreground" };
        if (overhead <= 0) return null;
        const pct = Math.round((metrics.employerObligations / overhead) * 100);
        const cls = pct <= 5 ? "bg-green-100 text-green-700" : pct <= 15 ? "bg-amber-100 text-amber-700" : "bg-red-50 text-red-600";
        return { label: `+${pct}% overhead`, cls };
      }
      case "coversTotalGoal": {
        if (totalAnnualBusinessNeed <= 0) return null;
        const pct = Math.round((metrics.practiceNetBeforeOverhead / totalAnnualBusinessNeed) * 100);
        const cls = pct >= 100 ? "bg-green-100 text-green-700" : pct >= 50 ? "bg-amber-100 text-amber-700" : "bg-red-50 text-red-600";
        return { label: `${pct}% of goal`, cls };
      }
      case "practiceContribution": {
        const v = metrics.practiceNetBeforeOverhead;
        return { label: formatCurrency(v), cls: v >= 0 ? "bg-green-100 text-green-700" : "bg-red-50 text-red-600" };
      }
      case "netAfterEmployerTaxes": {
        const v = metrics.practiceNetBeforeOverhead;
        return { label: formatCurrency(v), cls: v >= 0 ? "bg-green-100 text-green-700" : "bg-red-50 text-red-600" };
      }
      case "fullyLoadedProfit": {
        const v = profitabilityData.fullyLoadedProfit;
        const cls = v > 0
          ? "bg-green-100 text-green-700"
          : v > -(allocatedOverhead * 0.1 + 1)
          ? "bg-amber-100 text-amber-700"
          : "bg-red-50 text-red-600";
        return { label: formatCurrency(v), cls };
      }
    }
  }, [selectedMetric, metrics, overhead, totalAnnualBusinessNeed, isW2, profitabilityData, allocatedOverhead]);

  const onSaveRef = useRef(onSave);
  useEffect(() => { onSaveRef.current = onSave; }, [onSave]);

  const [savedVisible, setSavedVisible] = useState(false);
  const [savedOpaque, setSavedOpaque] = useState(false);

  useEffect(() => {
    if (!clinician._savedAt) return;
    setSavedVisible(true);
    const tIn  = setTimeout(() => setSavedOpaque(true),  50);
    const tOut = setTimeout(() => setSavedOpaque(false), 1500);
    const tEnd = setTimeout(() => setSavedVisible(false), 2200);
    return () => { clearTimeout(tIn); clearTimeout(tOut); clearTimeout(tEnd); };
  }, [clinician._savedAt]);

  useEffect(() => {
    if (!clinician._dirty || clinician._saving) return;
    const timer = setTimeout(() => {
      onSaveRef.current(clinician._localId);
    }, 800);
    return () => clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clinician]);

  const setField = useCallback((name: string, value: unknown) => {
    const patch: Partial<SandboxClinician> = { [name]: value, _dirty: true, _version: clinician._version + 1 };
    const v = Number(value);
    const clamped = Math.min(100, Math.max(0, v));
    if (name === "preCapClinicianSplit")  patch.preCapPracticeSplit  = Math.round((100 - clamped) * 10) / 10;
    if (name === "preCapPracticeSplit")   patch.preCapClinicianSplit = Math.round((100 - clamped) * 10) / 10;
    if (name === "postCapClinicianSplit") patch.postCapPracticeSplit = Math.round((100 - clamped) * 10) / 10;
    if (name === "postCapPracticeSplit")  patch.postCapClinicianSplit = Math.round((100 - clamped) * 10) / 10;
    onChange(clinician._localId, patch);
  }, [clinician._localId, clinician._version, onChange]);

  return (
    <div className={`rounded-lg border bg-card transition-all ${clinician._dirty ? "border-amber-300 shadow-sm" : ""}`}>
      <div className="p-3 space-y-2.5">
        <div className="flex items-center gap-2">
          <Input
            value={clinician.label}
            onChange={e => setField("label", e.target.value)}
            className="h-11 sm:h-7 text-sm font-semibold border-transparent bg-transparent hover:border-input focus:border-input px-1.5 flex-1 min-w-0"
            placeholder="Clinician name"
          />
          <Select value={clinician.classification} onValueChange={v => setField("classification", v)}>
            <SelectTrigger className="h-11 sm:h-7 w-20 text-[11px] shrink-0">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="w2">W2</SelectItem>
              <SelectItem value="1099">1099</SelectItem>
              <SelectItem value="owner">Owner</SelectItem>
            </SelectContent>
          </Select>
          <Button
            variant="ghost" size="icon"
            className="h-11 w-11 sm:h-7 sm:w-7 text-muted-foreground hover:text-primary shrink-0"
            onClick={() => setPresentOpen(true)}
            title="Present to clinician"
          >
            <Monitor className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost" size="icon"
            className="h-11 w-11 sm:h-7 sm:w-7 text-muted-foreground hover:text-destructive shrink-0"
            onClick={() => onRemove(clinician._localId)}
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>

        {savedLabel && !clinician._dirty && (
          <p className="text-[10px] text-muted-foreground/70 -mt-1 px-1.5">Saved {savedLabel}</p>
        )}

        <div className="grid grid-cols-3 sm:grid-cols-3 gap-2">
          <InlineNumber label="Rate ($)" value={clinician.sessionRate} onChange={v => setField("sessionRate", v)} prefix="$" />
          <InlineNumber label="Sess/wk" value={clinician.sessionsPerWeek} onChange={v => setField("sessionsPerWeek", v)} />
          <InlineNumber label="Wks/yr" value={clinician.weeksWorkedPerYear} onChange={v => setField("weeksWorkedPerYear", v)} />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <SplitInput
            clinicianSplit={clinician.preCapClinicianSplit}
            onClinicianChange={v => setField("preCapClinicianSplit", v)}
          />
          <div className="space-y-0.5">
            <span className="text-[11px] text-muted-foreground flex items-center gap-1">
              Annual Comp
              <InfoTip text="The clinician's total gross annual earnings before personal income taxes." />
            </span>
            <p className="text-sm font-semibold text-green-600">{formatCurrency(metrics.clinicianCompensation)}</p>
          </div>
        </div>

        {metrics.employerObligations > 0 && (
          <div className="flex items-center justify-between text-[11px]">
            <span className="text-muted-foreground flex items-center gap-1">
              W2 employer burden
              <InfoTip text="Extra payroll costs the practice owes on top of wages: employer FICA (7.65%), FUTA/SUTA, and workers' comp. Only applies to W2 employees." />
            </span>
            <span className="font-medium text-amber-600">−{formatCurrency(metrics.employerObligations)}/yr</span>
          </div>
        )}

        {metrics.nonClinicalComp > 0 && (
          <div className="flex items-center justify-between text-[11px]">
            <span className="text-muted-foreground flex items-center gap-1">
              Non-clinical pay
              <InfoTip text="Additional annual pay for non-clinical hours (supervision, admin, documentation) at an hourly rate, added on top of session-split earnings." />
            </span>
            <span className="font-medium text-green-700">+{formatCurrency(metrics.nonClinicalComp)}/yr</span>
          </div>
        )}

        <button
          type="button"
          onClick={() => setNonClinicalOpen(prev => !prev)}
          className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors w-full"
        >
          {nonClinicalOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          Non-Clinical Hours
          {clinician.nonClinicalHoursPerWeek > 0 && (
            <span className="ml-1 text-[10px] text-primary font-medium">
              {clinician.nonClinicalHoursPerWeek} hrs/wk @ ${clinician.nonClinicalHourlyRate}/hr
            </span>
          )}
        </button>

        {nonClinicalOpen && (
          <div className="grid grid-cols-2 gap-2 pt-1 border-t">
            <InlineNumber
              label="Non-Clinical Hrs/Wk"
              value={clinician.nonClinicalHoursPerWeek}
              onChange={v => setField("nonClinicalHoursPerWeek", v)}
              step={0.5}
              suffix="hrs"
            />
            <InlineNumber
              label="Hourly Rate ($)"
              value={clinician.nonClinicalHourlyRate}
              onChange={v => setField("nonClinicalHourlyRate", v)}
              prefix="$"
            />
            {metrics.nonClinicalComp > 0 && (
              <div className="col-span-2 rounded bg-green-50 border border-green-100 px-2.5 py-1.5 text-[11px] text-green-700">
                <span className="font-medium">Annual add-on: </span>
                {formatCurrency(metrics.nonClinicalComp)}/yr
                <span className="text-green-600/70 ml-1">
                  ({clinician.nonClinicalHoursPerWeek} hrs × ${clinician.nonClinicalHourlyRate}/hr × {clinician.weeksWorkedPerYear} wks)
                </span>
              </div>
            )}
          </div>
        )}

        <button
          onClick={() => onChange(clinician._localId, { _expanded: !clinician._expanded, _dirty: clinician._dirty })}
          className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors w-full"
        >
          {clinician._expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          {clinician._expanded ? "Fewer settings" : "More settings"}
          <span className="ml-auto text-[10px] text-muted-foreground flex items-center gap-1.5">
            {metrics.employerObligations > 0 ? "Net after burden" : "Net to practice"}: {formatCurrency(metrics.practiceNetBeforeOverhead)}
            <InfoTip text={metrics.employerObligations > 0
              ? "Revenue the practice keeps after paying this clinician and W2 employer taxes. Overhead and profit come out of this."
              : "Revenue the practice keeps after paying this clinician. Overhead and profit come out of this."
            } />
            {badgeData && (
              <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium ${badgeData.cls}`}>
                {badgeData.label}
              </span>
            )}
          </span>
        </button>

        {clinician._expanded && (
          <div className="space-y-2 pt-1 border-t">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label className="text-[11px]">Role Type</Label>
                <Select value={clinician.roleType} onValueChange={v => setField("roleType", v)}>
                  <SelectTrigger className="h-11 sm:h-7 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="associate">Associate</SelectItem>
                    <SelectItem value="contractor">Contractor</SelectItem>
                    <SelectItem value="owner">Owner</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center gap-2 pt-4">
                <Switch
                  checked={clinician.capEnabled}
                  onCheckedChange={v => setField("capEnabled", v)}
                  id={`cap-${clinician._localId}`}
                />
                <Label htmlFor={`cap-${clinician._localId}`} className="text-[11px]">Revenue cap</Label>
              </div>
            </div>

            {clinician.capEnabled && (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <InlineNumber label="Cap Amount ($)" value={clinician.capAmount} onChange={v => setField("capAmount", v)} prefix="$" />
                  <SplitInput
                    clinicianSplit={clinician.postCapClinicianSplit}
                    onClinicianChange={v => setField("postCapClinicianSplit", v)}
                  />
                </div>
                <p className="text-[10px] text-muted-foreground">
                  Post-cap split shown. Pre-cap: {Math.round(metrics.preCapSessions)} sessions, post-cap: {Math.round(metrics.postCapSessions)}
                </p>
              </>
            )}

            {clinician.classification === "w2" && (
              <div className="space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  <InlineNumber label="Employer FICA (%)" value={clinician.w2EmployerFicaPct} onChange={v => setField("w2EmployerFicaPct", v)} step={0.01} suffix="%" />
                  <InlineNumber label="FUTA/SUTA (%)" value={clinician.futaSutaPct} onChange={v => setField("futaSutaPct", v)} step={0.01} suffix="%" />
                </div>
                {metrics.employerObligations > 0 && (
                  <div className="rounded bg-amber-50 border border-amber-100 px-2.5 py-1.5 text-[11px] text-amber-700 flex flex-wrap gap-x-3 gap-y-0.5">
                    <span className="font-medium text-amber-800">Burden breakdown:</span>
                    {metrics.burdenFica > 0 && (
                      <span>FICA {formatCurrency(metrics.burdenFica)}</span>
                    )}
                    {metrics.burdenFutaSuta > 0 && (
                      <span>FUTA/SUTA {formatCurrency(metrics.burdenFutaSuta)}</span>
                    )}
                    {metrics.burdenWorkersComp > 0 && (
                      <span>WC {formatCurrency(metrics.burdenWorkersComp)}</span>
                    )}
                    {metrics.burdenOther > 0 && (
                      <span>Other {formatCurrency(metrics.burdenOther)}</span>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        <button
          type="button"
          onClick={() => setBreakdownOpen(prev => !prev)}
          className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors w-full"
        >
          {breakdownOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          Contribution breakdown
        </button>

        {breakdownOpen && (
          <div className="rounded border bg-muted/40 p-1.5 space-y-0.5">
            {metricRows.map(row => {
              const isSelected = selectedMetric === row.id;
              return (
                <button
                  key={row.id}
                  type="button"
                  onClick={() => onSelectMetric(row.id)}
                  className={`flex items-center w-full gap-2 py-1 px-1.5 rounded text-left transition-colors ${
                    isSelected ? "bg-primary/5 hover:bg-primary/10" : "hover:bg-muted/80"
                  }`}
                >
                  <span className={`flex-1 text-[11px] transition-colors ${
                    isSelected ? "text-foreground font-semibold" : "text-muted-foreground"
                  }`}>{CARD_METRIC_LABELS[row.id]}</span>
                  <span className={`text-[11px] font-medium tabular-nums shrink-0 ${row.valueColor}`}>{row.value}</span>
                  <span className={`h-3.5 w-3.5 rounded-full border-2 shrink-0 flex items-center justify-center transition-colors ${
                    isSelected ? "border-primary" : "border-muted-foreground/30"
                  }`}>
                    {isSelected && (
                      <span className="h-1.5 w-1.5 rounded-full bg-primary" />
                    )}
                  </span>
                </button>
              );
            })}

            {overhead > 0 && (
              <>
                <div className="pt-1 pb-0.5">
                  <div className="border-t border-border/60" />
                  <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mt-1.5 px-1.5 flex items-center gap-1">
                    Overhead allocation
                    <InfoTip text="Your share of annual overhead based on the selected allocation model (Equal / Revenue / Session)." />
                  </p>
                </div>

                <div className="flex items-center w-full gap-2 py-1 px-1.5">
                  <span className="flex-1 text-[11px] text-muted-foreground flex items-center gap-1">
                    Overhead allocated
                    <InfoTip text="Dollar share of practice overhead assigned to this clinician under the chosen model." />
                  </span>
                  <span className={`text-[11px] font-medium tabular-nums ${
                    allocatedOverhead <= 0
                      ? "text-muted-foreground"
                      : allocatedOverhead <= (overhead / Math.max(1, clinicianCount)) * 0.8
                      ? "text-green-600"
                      : allocatedOverhead <= (overhead / Math.max(1, clinicianCount)) * 1.2
                      ? "text-amber-600"
                      : "text-red-600"
                  }`}>
                    {formatCurrency(allocatedOverhead)}
                  </span>
                </div>

                <div className="flex items-center w-full gap-2 py-1 px-1.5">
                  <span className="flex-1 text-[11px] text-muted-foreground flex items-center gap-1">
                    Contribution margin
                    <InfoTip text="Revenue kept by the practice after paying clinician comp and W2 employer taxes. This is the practice's share before overhead." />
                  </span>
                  <span className={`text-[11px] font-medium tabular-nums ${
                    profitabilityData.contributionMargin >= 0 ? "text-green-600" : "text-red-600"
                  }`}>
                    {formatCurrency(profitabilityData.contributionMargin)}
                  </span>
                </div>

                <div className="flex items-center w-full gap-2 py-1 px-1.5">
                  <span className="flex-1 text-[11px] text-muted-foreground flex items-center gap-1">
                    Fully loaded profit
                    <InfoTip text="Contribution margin minus allocated overhead. Positive means this clinician is profitable after absorbing their fair share of shared costs." />
                  </span>
                  <span className={`text-[11px] font-medium tabular-nums ${
                    profitabilityData.fullyLoadedProfit > 0 ? "text-green-600" : "text-red-600"
                  }`}>
                    {formatCurrency(profitabilityData.fullyLoadedProfit)}
                  </span>
                </div>

                <div className="flex items-center w-full gap-2 py-1 px-1.5">
                  <span className="flex-1 text-[11px] text-muted-foreground flex items-center gap-1">
                    Break-even sessions/wk
                    <InfoTip text="Minimum weekly sessions needed for this clinician to cover their allocated overhead at current rates." />
                  </span>
                  <span className={`text-[11px] font-medium tabular-nums ${
                    !isFinite(profitabilityData.breakEvenSessionsPerWeek)
                      ? "text-red-600"
                      : clinician.sessionsPerWeek >= profitabilityData.breakEvenSessionsPerWeek
                      ? "text-green-600"
                      : "text-amber-600"
                  }`}>
                    {isFinite(profitabilityData.breakEvenSessionsPerWeek)
                      ? profitabilityData.breakEvenSessionsPerWeek.toFixed(1)
                      : "—"}
                  </span>
                </div>

                <div className="flex items-center w-full gap-2 py-1 px-1.5">
                  <span className="flex-1 text-[11px] text-muted-foreground flex items-center gap-1">
                    Sessions vs break-even
                    <InfoTip text="Actual sessions per week minus break-even sessions per week." />
                  </span>
                  <span className={`text-[11px] font-medium tabular-nums ${
                    !isFinite(profitabilityData.sessionsVsBreakEven) || profitabilityData.sessionsVsBreakEven < 0
                      ? "text-red-600"
                      : "text-green-600"
                  }`}>
                    {isFinite(profitabilityData.sessionsVsBreakEven)
                      ? profitabilityData.sessionsVsBreakEven >= 0
                        ? `+${profitabilityData.sessionsVsBreakEven.toFixed(1)} sessions above`
                        : `${profitabilityData.sessionsVsBreakEven.toFixed(1)} sessions below`
                      : "—"}
                  </span>
                </div>

                <div className="flex items-center w-full gap-2 py-1 px-1.5">
                  <span className="flex-1 text-[11px] text-muted-foreground">Status</span>
                  <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${
                    profitabilityData.isProfit
                      ? "bg-green-100 text-green-700"
                      : profitabilityData.isLosing
                      ? "bg-red-100 text-red-700"
                      : "bg-amber-100 text-amber-700"
                  }`}>
                    {profitabilityData.status}
                  </span>
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {(clinician._dirty || clinician._saving) && (
        <div className="border-t px-3 py-2 flex items-center justify-between bg-amber-50/60">
          {clinician._saving ? (
            <>
              <span className="text-[11px] text-amber-700 flex items-center gap-1">
                <Loader2 className="h-3 w-3 animate-spin" />Saving…
              </span>
            </>
          ) : (
            <>
              <span className="text-[11px] text-amber-700">Unsaved changes</span>
              <Button
                size="sm"
                variant="ghost"
                className="h-6 text-[11px] px-2 text-amber-700 hover:bg-amber-100"
                onClick={() => onSave(clinician._localId)}
              >
                <Save className="h-3 w-3 mr-1" />Save now
              </Button>
            </>
          )}
        </div>
      )}
      {savedVisible && !clinician._dirty && !clinician._saving && (
        <div
          className={`border-t px-3 py-2 bg-green-50/70 transition-opacity duration-700 ${savedOpaque ? "opacity-100" : "opacity-0"}`}
        >
          <span className="text-[11px] text-green-700 flex items-center gap-1">
            <CheckCircle2 className="h-3 w-3" />All changes saved
          </span>
        </div>
      )}

      <Dialog open={presentOpen} onOpenChange={setPresentOpen}>
        <DialogContent
          className="fixed inset-0 w-screen h-screen max-w-none max-h-none translate-x-0 translate-y-0 rounded-none border-0 p-0 gap-0 flex flex-col bg-background"
          aria-describedby={undefined}
        >
          <DialogHeader className="px-5 pt-4 pb-3 border-b shrink-0 flex flex-row items-center justify-between gap-2">
            <DialogTitle className="text-sm font-semibold">Clinician Compensation View</DialogTitle>
            <div className="flex items-center gap-2 ml-auto">
              {clinician.id ? (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs gap-1.5"
                  onClick={() => {
                    const base = import.meta.env.BASE_URL.replace(/\/$/, "");
                    const url = `${window.location.origin}${base}/present/${clinician.id}`;
                    navigator.clipboard.writeText(url).catch(() => {}).then(() => {
                      setLinkCopied(true);
                      setTimeout(() => setLinkCopied(false), 2000);
                    });
                  }}
                >
                  {linkCopied ? (
                    <><CheckCheck className="h-3 w-3 text-green-600" />Copied!</>
                  ) : (
                    <><Link2 className="h-3 w-3" />Copy link</>
                  )}
                </Button>
              ) : (
                <span className="text-[11px] text-muted-foreground italic">Save first to get a shareable link</span>
              )}
            </div>
          </DialogHeader>
          <div className="flex-1 overflow-y-auto flex items-center justify-center p-6">
            <ClinicianPresenterCard
              data={{
                label: clinician.label,
                classification: clinician.classification,
                sessionRate: clinician.sessionRate,
                sessionsPerWeek: clinician.sessionsPerWeek,
                weeksWorkedPerYear: clinician.weeksWorkedPerYear,
                preCapClinicianSplit: clinician.preCapClinicianSplit,
                preCapPracticeSplit: clinician.preCapPracticeSplit,
                capEnabled: clinician.capEnabled,
                capAmount: clinician.capAmount,
                postCapClinicianSplit: clinician.postCapClinicianSplit,
                postCapPracticeSplit: clinician.postCapPracticeSplit,
                w2EmployerFicaPct: clinician.w2EmployerFicaPct,
                futaSutaPct: clinician.futaSutaPct,
                workersCompPct: clinician.workersCompPct,
                otherEmployerBurdenPct: clinician.otherEmployerBurdenPct,
                nonClinicalHoursPerWeek: clinician.nonClinicalHoursPerWeek,
                nonClinicalHourlyRate: clinician.nonClinicalHourlyRate,
              }}
            />
          </div>
          <div className="px-5 py-3 border-t bg-muted/30 shrink-0">
            <p className="text-[11px] text-muted-foreground text-center">
              Estimates are based on the schedule shown above. Actual compensation may vary.
            </p>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── PracticeInputsPanel ─────────────────────────────────────────────────────

function PracticeInputsPanel({
  goal,
  goalSaving,
  onGoalChange,
  onSaveGoal,
  goals,
  onSelectGoal,
}: {
  goal: SandboxGoal;
  goalSaving: boolean;
  onGoalChange: (patch: Partial<SandboxGoal>) => void;
  onSaveGoal: () => void;
  goals: BusinessGoal[] | undefined;
  onSelectGoal: (g: BusinessGoal) => void;
}) {
  const [showExtra, setShowExtra] = useState(false);
  const goalOutputs = calculateBusinessGoalOutputs(goal as Partial<BusinessGoal>);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Settings2 className="h-4 w-4 text-primary" />
        <h3 className="font-semibold text-sm">Practice Inputs</h3>
      </div>

      {goals && goals.length > 1 && (
        <div className="space-y-1">
          <span className="text-[11px] text-muted-foreground">Active Goal</span>
          <Select
            value={goal.id ? String(goal.id) : "none"}
            onValueChange={v => {
              const g = goals.find(g => String(g.id) === v);
              if (g) onSelectGoal(g);
            }}
          >
            <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Select goal" /></SelectTrigger>
            <SelectContent>
              {goals.map(g => <SelectItem key={g.id} value={String(g.id)}>{g.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      )}

      <div className="space-y-2.5">
        <InlineNumber label="Owner Pay Goal" value={goal.ownerPayGoal} onChange={v => onGoalChange({ ownerPayGoal: v })} prefix="$" />
        <InlineNumber label="Annual Overhead" value={goal.annualOverheadGoal} onChange={v => onGoalChange({ annualOverheadGoal: v })} prefix="$" />
        <InlineNumber label="Business Profit Goal" value={goal.businessProfitGoal} onChange={v => onGoalChange({ businessProfitGoal: v })} prefix="$" />
        <InlineNumber label="Desired Clinicians" value={goal.desiredCliniciansCount} onChange={v => onGoalChange({ desiredCliniciansCount: Math.max(1, Math.round(v)) })} />
      </div>

      <button
        onClick={() => setShowExtra(!showExtra)}
        className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
      >
        {showExtra ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        Additional goals
      </button>

      {showExtra && (
        <div className="space-y-2.5 pl-1">
          <InlineNumber label="2nd Owner Pay Goal" value={goal.secondOwnerPayGoal} onChange={v => onGoalChange({ secondOwnerPayGoal: v })} prefix="$" />
          <InlineNumber label="Building Fund Goal" value={goal.buildingFundGoal} onChange={v => onGoalChange({ buildingFundGoal: v })} prefix="$" />
          <InlineNumber label="Emergency Reserve Goal" value={goal.emergencyReserveGoal} onChange={v => onGoalChange({ emergencyReserveGoal: v })} prefix="$" />
          <InlineNumber label="Growth Fund Goal" value={goal.growthFundGoal} onChange={v => onGoalChange({ growthFundGoal: v })} prefix="$" />
        </div>
      )}

      <div className="rounded-lg bg-muted/50 border p-2.5 text-xs space-y-1">
        <div className="flex justify-between">
          <span className="text-muted-foreground">Total Annual Need</span>
          <span className="font-semibold">{formatCurrency(goalOutputs.totalAnnualBusinessNeed)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Net / Clinician Needed</span>
          <span className="font-semibold">{formatCurrency(goalOutputs.requiredNetPerClinician)}</span>
        </div>
      </div>

      <Button
        size="sm"
        variant="outline"
        className="w-full h-8 text-xs"
        onClick={onSaveGoal}
        disabled={goalSaving}
      >
        {goalSaving ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Save className="h-3.5 w-3.5 mr-1.5" />}
        Save Baseline
      </Button>
    </div>
  );
}

// ─── ScenariosPanel ──────────────────────────────────────────────────────────

function ScenariosPanel({
  onClose,
  sandboxClinicians,
  goal,
  onLoadScenario,
}: {
  onClose: () => void;
  sandboxClinicians: SandboxClinician[];
  goal: SandboxGoal;
  onLoadScenario: (clinicians: SandboxClinician[], goalId?: number) => void;
}) {
  const { data: scenarios, isLoading } = useListScenarios();
  const { data: goals } = useListBusinessGoals();
  const createScenario = useCreateScenario();
  const deleteScenario = useDeleteScenario();
  const addScenarioClinician = useAddScenarioClinician();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [newName, setNewName] = useState("");
  const [saving, setSaving] = useState(false);
  const [loadingId, setLoadingId] = useState<number | null>(null);

  const handleSaveCurrent = async () => {
    if (!newName.trim()) return;
    setSaving(true);
    try {
      const linkedGoalId = goal.id ?? null;
      const scenario = await new Promise<{ id: number }>((resolve, reject) => {
        createScenario.mutate(
          { data: { name: newName.trim(), notes: "", businessGoalId: linkedGoalId } as never },
          { onSuccess: resolve, onError: reject }
        );
      });

      for (const c of sandboxClinicians) {
        await new Promise<void>((resolve, reject) => {
          addScenarioClinician.mutate(
            {
              scenarioId: scenario.id,
              data: {
                label: c.label, roleType: c.roleType, classification: c.classification,
                sessionRate: c.sessionRate, sessionsPerWeek: c.sessionsPerWeek,
                weeksWorkedPerYear: c.weeksWorkedPerYear,
                preCapClinicianSplit: c.preCapClinicianSplit, preCapPracticeSplit: c.preCapPracticeSplit,
                capEnabled: c.capEnabled, capAmount: c.capAmount,
                postCapClinicianSplit: c.postCapClinicianSplit, postCapPracticeSplit: c.postCapPracticeSplit,
                w2EmployerFicaPct: c.w2EmployerFicaPct, futaSutaPct: c.futaSutaPct,
                workersCompPct: c.workersCompPct, otherEmployerBurdenPct: c.otherEmployerBurdenPct,
                notes: c.notes, sourceClinicianId: c.id ?? null,
              } as never
            },
            { onSuccess: () => resolve(), onError: reject }
          );
        });
      }

      queryClient.invalidateQueries({ queryKey: getListScenariosQueryKey() });
      toast({ title: "Scenario saved", description: `"${newName}" created with ${sandboxClinicians.length} clinicians.` });
      setNewName("");
    } catch {
      toast({ title: "Save failed", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handleLoad = async (scenarioId: number, scenarioName: string) => {
    setLoadingId(scenarioId);
    try {
      const detail = await queryClient.fetchQuery<ScenarioDetail>({
        queryKey: getGetScenarioQueryKey(scenarioId),
        queryFn: () => getScenario(scenarioId),
        staleTime: 0,
      });

      const sandboxClx: SandboxClinician[] = (detail.clinicians ?? []).map(c => clinicianToSandbox(c));
      onLoadScenario(sandboxClx, detail.businessGoalId ?? undefined);
      toast({ title: "Scenario loaded", description: `"${scenarioName}" is now in the sandbox.` });
      onClose();
    } catch {
      toast({ title: "Load failed", description: "Could not load scenario.", variant: "destructive" });
    } finally {
      setLoadingId(null);
    }
  };

  const handleDelete = (id: number, name: string) => {
    deleteScenario.mutate({ id }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListScenariosQueryKey() });
        toast({ title: "Scenario deleted", description: `"${name}" removed.` });
      },
      onError: () => toast({ title: "Delete failed", variant: "destructive" }),
    });
  };

  return (
    <div className="border-b bg-muted/30 animate-in slide-in-from-top-1 duration-200">
      <div className="container mx-auto px-6 py-4">
        <div className="flex items-start gap-6">
          <div className="flex-1 min-w-0 space-y-3">
            <div className="flex items-center gap-2">
              <BookMarked className="h-4 w-4 text-primary" />
              <h3 className="text-sm font-semibold">Scenarios</h3>
              <Button variant="ghost" size="icon" className="h-6 w-6 ml-auto" onClick={onClose}>
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>

            <div className="flex gap-6 flex-wrap items-start">
              <div className="min-w-56">
                <p className="text-[11px] text-muted-foreground mb-2">Save current sandbox as new scenario</p>
                <div className="flex gap-2">
                  <Input
                    value={newName}
                    onChange={e => setNewName(e.target.value)}
                    placeholder="Scenario name…"
                    className="h-8 text-xs flex-1"
                    onKeyDown={e => { if (e.key === "Enter") handleSaveCurrent(); }}
                  />
                  <Button
                    size="sm"
                    className="h-8 text-xs px-3 shrink-0"
                    disabled={!newName.trim() || saving}
                    onClick={handleSaveCurrent}
                  >
                    {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                    <span className="ml-1">Save</span>
                  </Button>
                </div>
              </div>

              <div className="flex-1 min-w-0">
                <p className="text-[11px] text-muted-foreground mb-2">
                  {isLoading ? "Loading…" : scenarios && scenarios.length > 0 ? "Load a saved scenario into sandbox" : "No saved scenarios yet."}
                </p>
                {!isLoading && scenarios && scenarios.length > 0 && (
                  <div className="flex gap-2 flex-wrap">
                    {scenarios.map(s => {
                      const linkedGoal = goals?.find(g => g.id === s.businessGoalId);
                      return (
                        <div
                          key={s.id}
                          className="flex items-center gap-1.5 rounded-md border bg-card px-2.5 py-1.5 text-xs"
                        >
                          <span className="font-medium">{s.name}</span>
                          {linkedGoal && (
                            <span className="text-muted-foreground text-[10px]">· {linkedGoal.name}</span>
                          )}
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-5 px-1.5 text-[10px] text-primary hover:text-primary ml-1"
                            disabled={loadingId === s.id}
                            onClick={() => handleLoad(s.id, s.name)}
                          >
                            {loadingId === s.id
                              ? <Loader2 className="h-3 w-3 animate-spin" />
                              : <FolderOpen className="h-3 w-3" />}
                            <span className="ml-0.5">Load</span>
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-5 w-5 text-muted-foreground hover:text-destructive"
                            onClick={() => handleDelete(s.id, s.name)}
                          >
                            <Trash className="h-3 w-3" />
                          </Button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── ImportCliniciansDialog ───────────────────────────────────────────────────

function ImportCliniciansDialog({
  open, onClose, goals, currentGoalId, onImported,
}: {
  open: boolean;
  onClose: () => void;
  goals: BusinessGoal[];
  currentGoalId: number | undefined;
  onImported: (clinicians: SandboxClinician[]) => void;
}) {
  const [sourceGoalId, setSourceGoalId] = useState<number | null>(null);
  const srcParams = { goalId: sourceGoalId ?? undefined };
  const { data: sourceClinicians, isLoading: loadingSource } = useListClinicians(
    srcParams,
    { query: { queryKey: getListCliniciansQueryKey(srcParams), enabled: !!sourceGoalId } }
  );
  const copyMutation = useCopyClinicianToGoal();
  const { toast } = useToast();
  const otherGoals = goals.filter(g => g.id !== currentGoalId);

  const handleImport = () => {
    if (!sourceClinicians?.length || !sourceGoalId || !currentGoalId) return;
    copyMutation.mutate(
      { data: { ids: sourceClinicians.map(c => c.id), toGoalId: currentGoalId } },
      {
        onSuccess: (imported) => {
          onImported(imported.map(teamClinicianToSandbox));
          onClose();
        },
        onError: () => toast({ title: "Import failed", variant: "destructive" }),
      }
    );
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Import clinicians from another goal</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 pt-2">
          <div className="space-y-1.5">
            <Label className="text-xs">Copy from goal</Label>
            <Select onValueChange={v => setSourceGoalId(Number(v))}>
              <SelectTrigger className="h-8 text-sm">
                <SelectValue placeholder="Select a goal…" />
              </SelectTrigger>
              <SelectContent>
                {otherGoals.map(g => (
                  <SelectItem key={g.id} value={String(g.id)}>{g.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {sourceGoalId && !loadingSource && (
            <p className="text-xs text-muted-foreground">
              {sourceClinicians?.length
                ? `${sourceClinicians.length} clinician${sourceClinicians.length !== 1 ? "s" : ""} will be copied into this goal.`
                : "That goal has no clinicians to import."}
            </p>
          )}
          {sourceGoalId && loadingSource && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" /> Loading…
            </div>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
            <Button
              size="sm"
              onClick={handleImport}
              disabled={!sourceClinicians?.length || copyMutation.isPending}
            >
              {copyMutation.isPending && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
              Import{sourceClinicians?.length ? ` ${sourceClinicians.length} clinician${sourceClinicians.length !== 1 ? "s" : ""}` : ""}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── ImportStaffDialog ────────────────────────────────────────────────────────

function ImportStaffDialog({
  open, onClose, goals, currentGoalId, onImported,
}: {
  open: boolean;
  onClose: () => void;
  goals: BusinessGoal[];
  currentGoalId: number | undefined;
  onImported: (staff: SandboxStaffMember[]) => void;
}) {
  const [sourceGoalId, setSourceGoalId] = useState<number | null>(null);
  const srcParams = { goalId: sourceGoalId ?? undefined };
  const { data: sourceStaff, isLoading: loadingSource } = useListStaffMembers(
    srcParams,
    { query: { queryKey: getListStaffMembersQueryKey(srcParams), enabled: !!sourceGoalId } }
  );
  const copyMutation = useCopyStaffToGoal();
  const { toast } = useToast();
  const otherGoals = goals.filter(g => g.id !== currentGoalId);

  const handleImport = () => {
    if (!sourceStaff?.length || !sourceGoalId || !currentGoalId) return;
    copyMutation.mutate(
      { data: { ids: sourceStaff.map(s => s.id), toGoalId: currentGoalId } },
      {
        onSuccess: (imported) => {
          onImported(imported.map(staffMemberToSandbox));
          onClose();
        },
        onError: () => toast({ title: "Import failed", variant: "destructive" }),
      }
    );
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Import staff from another goal</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 pt-2">
          <div className="space-y-1.5">
            <Label className="text-xs">Copy from goal</Label>
            <Select onValueChange={v => setSourceGoalId(Number(v))}>
              <SelectTrigger className="h-8 text-sm">
                <SelectValue placeholder="Select a goal…" />
              </SelectTrigger>
              <SelectContent>
                {otherGoals.map(g => (
                  <SelectItem key={g.id} value={String(g.id)}>{g.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {sourceGoalId && !loadingSource && (
            <p className="text-xs text-muted-foreground">
              {sourceStaff?.length
                ? `${sourceStaff.length} staff member${sourceStaff.length !== 1 ? "s" : ""} will be copied into this goal.`
                : "That goal has no staff to import."}
            </p>
          )}
          {sourceGoalId && loadingSource && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" /> Loading…
            </div>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
            <Button
              size="sm"
              onClick={handleImport}
              disabled={!sourceStaff?.length || copyMutation.isPending}
            >
              {copyMutation.isPending && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
              Import{sourceStaff?.length ? ` ${sourceStaff.length} staff member${sourceStaff.length !== 1 ? "s" : ""}` : ""}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── SandboxView (main export) ───────────────────────────────────────────────

export default function SandboxView({ onShowAdvanced }: { onShowAdvanced: () => void }) {
  const { data: apiGoals, isLoading: loadingGoals } = useListBusinessGoals();

  const createClinician = useCreateClinician();
  const updateClinician = useUpdateClinician();
  const deleteClinician = useDeleteClinician();
  const updateGoal = useUpdateBusinessGoal();
  const createGoal = useCreateBusinessGoal();
  const createStaff = useCreateStaffMember();
  const updateStaff = useUpdateStaffMember();
  const deleteStaff = useDeleteStaffMember();

  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [clinicians, setClinicians] = useState<SandboxClinician[]>([]);
  const [sandboxStaff, setSandboxStaff] = useState<SandboxStaffMember[]>([]);
  const [staffSectionOpen, setStaffSectionOpen] = useState(true);
  const [goal, setGoal] = useState<SandboxGoal>(DEFAULT_GOAL);
  const [goalSaving, setGoalSaving] = useState(false);
  const [scenariosOpen, setScenariosOpen] = useState(false);
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [importStaffDialogOpen, setImportStaffDialogOpen] = useState(false);
  const [initialized, setInitialized] = useState(false);
  const VALID_CARD_METRICS: CardMetric[] = [
    "coversOverhead",
    "overheadCostAdded",
    "coversTotalGoal",
    "practiceContribution",
    "netAfterEmployerTaxes",
    "fullyLoadedProfit",
  ];
  const SELECTED_METRIC_STORAGE_KEY = "compDashboard_pinnedMetric";
  const storedMetric = localStorage.getItem(SELECTED_METRIC_STORAGE_KEY) as CardMetric | null;
  const [selectedMetric, setSelectedMetric] = useState<CardMetric>(
    storedMetric && VALID_CARD_METRICS.includes(storedMetric) ? storedMetric : "coversOverhead"
  );
  const ALLOCATION_MODEL_STORAGE_KEY = "compDashboard_allocationModel";
  const storedModel = localStorage.getItem(ALLOCATION_MODEL_STORAGE_KEY) as OverheadAllocationModel | null;
  const validModels: OverheadAllocationModel[] = ["equal", "revenue", "session"];
  const [overheadAllocationModel, setOverheadAllocationModel] = useState<OverheadAllocationModel>(
    storedModel && validModels.includes(storedModel) ? storedModel : "session"
  );
  const handleSetAllocationModel = (m: OverheadAllocationModel) => {
    localStorage.setItem(ALLOCATION_MODEL_STORAGE_KEY, m);
    setOverheadAllocationModel(m);
  };

  const handleSetSelectedMetric = (metric: CardMetric) => {
    localStorage.setItem(SELECTED_METRIC_STORAGE_KEY, metric);
    setSelectedMetric(metric);
  };
  const cliniciansLoadedForGoalIdRef = useRef<number | undefined>(undefined);
  const staffLoadedForGoalIdRef = useRef<number | undefined>(undefined);

  const activeGoalId = goal.id;
  const goalClinicianParams = { goalId: activeGoalId };
  const { data: apiGoalClinicians, isLoading: loadingGoalClinicians } = useListClinicians(
    goalClinicianParams,
    { query: { queryKey: getListCliniciansQueryKey(goalClinicianParams), enabled: !!activeGoalId } }
  );
  const goalStaffParams = { goalId: activeGoalId };
  const { data: apiGoalStaff } = useListStaffMembers(
    goalStaffParams,
    { query: { queryKey: getListStaffMembersQueryKey(goalStaffParams), enabled: !!activeGoalId } }
  );

  useEffect(() => {
    if (!initialized && !loadingGoals) {
      if (apiGoals && apiGoals.length > 0) setGoal(goalToSandbox(apiGoals[0]));
      setInitialized(true);
    }
  }, [initialized, loadingGoals, apiGoals]);

  useEffect(() => {
    if (apiGoalClinicians !== undefined && activeGoalId !== undefined) {
      if (cliniciansLoadedForGoalIdRef.current !== activeGoalId) {
        setClinicians(apiGoalClinicians.map(teamClinicianToSandbox));
        cliniciansLoadedForGoalIdRef.current = activeGoalId;
      }
    }
  }, [apiGoalClinicians, activeGoalId]);

  useEffect(() => {
    if (apiGoalStaff !== undefined && activeGoalId !== undefined) {
      if (staffLoadedForGoalIdRef.current !== activeGoalId) {
        setSandboxStaff(apiGoalStaff.map(staffMemberToSandbox));
        staffLoadedForGoalIdRef.current = activeGoalId;
      }
    }
  }, [apiGoalStaff, activeGoalId]);

  const handleGoalChange = useCallback((patch: Partial<SandboxGoal>) => {
    setGoal(prev => ({ ...prev, ...patch }));
  }, []);

  const handleSelectGoal = useCallback((g: BusinessGoal) => {
    setGoal(goalToSandbox(g));
    setClinicians([]);
    setSandboxStaff([]);
    cliniciansLoadedForGoalIdRef.current = undefined;
    staffLoadedForGoalIdRef.current = undefined;
  }, []);

  const handleSaveGoal = useCallback(async () => {
    setGoalSaving(true);
    try {
      if (goal.id) {
        await new Promise<void>((resolve, reject) => {
          updateGoal.mutate({ id: goal.id!, data: goal as never }, {
            onSuccess: () => {
              queryClient.invalidateQueries({ queryKey: getListBusinessGoalsQueryKey() });
              resolve();
            },
            onError: reject,
          });
        });
      } else {
        await new Promise<void>((resolve, reject) => {
          createGoal.mutate({ data: { name: "Sandbox Goal", timeHorizon: "1year", ...goal } as never }, {
            onSuccess: (created) => {
              setGoal(prev => ({ ...prev, id: created.id }));
              queryClient.invalidateQueries({ queryKey: getListBusinessGoalsQueryKey() });
              resolve();
            },
            onError: reject,
          });
        });
      }
      toast({ title: "Baseline saved" });
    } catch {
      toast({ title: "Save failed", variant: "destructive" });
    } finally {
      setGoalSaving(false);
    }
  }, [goal, updateGoal, createGoal, queryClient, toast]);

  const handleClinicianChange = useCallback((localId: string, patch: Partial<SandboxClinician>) => {
    setClinicians(prev => prev.map(c => c._localId === localId ? { ...c, ...patch } : c));
  }, []);

  const handleSaveClinician = useCallback(async (localId: string) => {
    const c = clinicians.find(x => x._localId === localId);
    if (!c) return;

    const versionAtSaveStart = c._version;
    setClinicians(prev => prev.map(x => x._localId === localId ? { ...x, _saving: true } : x));

    const data = {
      goalId: goal.id,
      label: c.label, roleType: c.roleType, classification: c.classification,
      sessionRate: c.sessionRate, sessionsPerWeek: c.sessionsPerWeek,
      weeksWorkedPerYear: c.weeksWorkedPerYear,
      preCapClinicianSplit: c.preCapClinicianSplit, preCapPracticeSplit: c.preCapPracticeSplit,
      capEnabled: c.capEnabled, capAmount: c.capAmount,
      postCapClinicianSplit: c.postCapClinicianSplit, postCapPracticeSplit: c.postCapPracticeSplit,
      w2EmployerFicaPct: c.w2EmployerFicaPct, futaSutaPct: c.futaSutaPct,
      workersCompPct: c.workersCompPct, otherEmployerBurdenPct: c.otherEmployerBurdenPct,
      nonClinicalHoursPerWeek: c.nonClinicalHoursPerWeek,
      nonClinicalHourlyRate: c.nonClinicalHourlyRate,
      notes: c.notes,
    };

    try {
      if (c.id) {
        await new Promise<void>((resolve, reject) => {
          updateClinician.mutate({ id: c.id!, data: data as never }, {
            onSuccess: () => {
              queryClient.invalidateQueries({ queryKey: getListCliniciansQueryKey({ goalId: goal.id }) });
              resolve();
            },
            onError: reject,
          });
        });
      } else {
        await new Promise<void>((resolve, reject) => {
          createClinician.mutate({ data: data as never }, {
            onSuccess: (created) => {
              setClinicians(prev => prev.map(x => x._localId === localId ? { ...x, id: created.id } : x));
              queryClient.invalidateQueries({ queryKey: getListCliniciansQueryKey({ goalId: goal.id }) });
              resolve();
            },
            onError: reject,
          });
        });
      }
      // Only clear dirty if no new edits arrived while the request was in-flight.
      // If _version changed, the debounce effect will schedule another save automatically.
      setClinicians(prev => prev.map(x => {
        if (x._localId !== localId) return x;
        const newEditsArrived = x._version !== versionAtSaveStart;
        return { ...x, _dirty: newEditsArrived, _saving: false, _savedAt: newEditsArrived ? x._savedAt : Date.now() };
      }));
    } catch {
      setClinicians(prev => prev.map(x => x._localId === localId ? { ...x, _saving: false } : x));
      toast({ title: "Auto-save failed", description: "Could not save clinician. Will retry.", variant: "destructive" });
    }
  }, [clinicians, goal, updateClinician, createClinician, queryClient, toast]);

  const handleAddClinician = useCallback(() => {
    const newC: SandboxClinician = {
      _localId: makeLocalId(),
      label: `Clinician ${clinicians.length + 1}`,
      ...DEFAULT_CLINICIAN_FIELDS,
      _dirty: true,
      _saving: false,
      _expanded: false,
      _version: 0,
      _savedAt: null,
    };
    setClinicians(prev => [...prev, newC]);
  }, [clinicians.length]);

  const handleRemoveClinician = useCallback(async (localId: string) => {
    const c = clinicians.find(x => x._localId === localId);
    if (!c) return;
    if (c.id) {
      deleteClinician.mutate({ id: c.id }, {
        onSuccess: () => queryClient.invalidateQueries({ queryKey: getListCliniciansQueryKey({ goalId: goal.id }) }),
        onError: () => toast({ title: "Remove failed", variant: "destructive" }),
      });
    }
    setClinicians(prev => prev.filter(x => x._localId !== localId));
  }, [clinicians, goal, deleteClinician, queryClient, toast]);

  const handleStaffChange = useCallback((localId: string, patch: Partial<SandboxStaffMember>) => {
    setSandboxStaff(prev => prev.map(s => s._localId === localId ? { ...s, ...patch } : s));
  }, []);

  const handleSaveStaff = useCallback(async (localId: string) => {
    const s = sandboxStaff.find(x => x._localId === localId);
    if (!s) return;

    if (goal.id === undefined) {
      setSandboxStaff(prev => prev.map(x => x._localId === localId ? { ...x, _dirty: true, _saving: false } : x));
      return;
    }

    const versionAtSaveStart = s._version;
    setSandboxStaff(prev => prev.map(x => x._localId === localId ? { ...x, _saving: true } : x));

    const data = {
      goalId: goal.id,
      label: s.label,
      roleType: s.roleType,
      classification: s.classification,
      annualSalary: s.payMode === "salary" ? (s.annualSalary ?? undefined) : null,
      hourlyRate: s.payMode === "hourly" ? (s.hourlyRate ?? undefined) : null,
      hoursPerWeek: s.payMode === "hourly" ? (s.hoursPerWeek ?? undefined) : null,
      weeksPerYear: s.weeksPerYear,
      w2EmployerFicaPct: s.w2EmployerFicaPct,
      futaSutaPct: s.futaSutaPct,
      workersCompPct: s.workersCompPct,
      otherEmployerBurdenPct: s.otherEmployerBurdenPct,
      notes: s.notes || undefined,
    };

    try {
      if (s.id) {
        await new Promise<void>((resolve, reject) => {
          updateStaff.mutate({ id: s.id!, data: data as never }, {
            onSuccess: () => {
              queryClient.invalidateQueries({ queryKey: getListStaffMembersQueryKey({ goalId: goal.id }) });
              resolve();
            },
            onError: reject,
          });
        });
      } else {
        await new Promise<void>((resolve, reject) => {
          createStaff.mutate({ data: data as never }, {
            onSuccess: (created) => {
              setSandboxStaff(prev => prev.map(x => x._localId === localId ? { ...x, id: created.id } : x));
              queryClient.invalidateQueries({ queryKey: getListStaffMembersQueryKey({ goalId: goal.id }) });
              resolve();
            },
            onError: reject,
          });
        });
      }
      setSandboxStaff(prev => prev.map(x => {
        if (x._localId !== localId) return x;
        const newEditsArrived = x._version !== versionAtSaveStart;
        return { ...x, _dirty: newEditsArrived, _saving: false, _savedAt: newEditsArrived ? x._savedAt : Date.now() };
      }));
    } catch {
      setSandboxStaff(prev => prev.map(x => x._localId === localId ? { ...x, _saving: false } : x));
      toast({ title: "Auto-save failed", description: "Could not save staff member.", variant: "destructive" });
    }
  }, [sandboxStaff, goal, updateStaff, createStaff, queryClient, toast]);

  const goalIdRef = useRef<number | undefined>(undefined);
  useEffect(() => {
    const prevGoalId = goalIdRef.current;
    goalIdRef.current = goal.id;
    if (prevGoalId === undefined && goal.id !== undefined) {
      setSandboxStaff(prev => {
        const dirty = prev.filter(s => s._dirty && !s._saving && !s.id);
        dirty.forEach(s => {
          setTimeout(() => handleSaveStaff(s._localId), 0);
        });
        return prev;
      });
    }
  }, [goal.id, handleSaveStaff]);

  const handleAddStaff = useCallback(() => {
    const newS: SandboxStaffMember = {
      _localId: makeLocalId(),
      label: `Staff ${sandboxStaff.length + 1}`,
      ...DEFAULT_STAFF_FIELDS,
      _dirty: true,
      _saving: false,
      _burdenOpen: false,
      _version: 0,
      _savedAt: null,
    };
    setSandboxStaff(prev => [...prev, newS]);
  }, [sandboxStaff.length]);

  const handleRemoveStaff = useCallback((localId: string) => {
    const s = sandboxStaff.find(x => x._localId === localId);
    if (!s) return;
    if (s.id) {
      deleteStaff.mutate({ id: s.id }, {
        onSuccess: () => queryClient.invalidateQueries({ queryKey: getListStaffMembersQueryKey({ goalId: goal.id }) }),
        onError: () => toast({ title: "Remove failed", variant: "destructive" }),
      });
    }
    setSandboxStaff(prev => prev.filter(x => x._localId !== localId));
  }, [sandboxStaff, goal, deleteStaff, queryClient, toast]);

  const handleLoadScenario = useCallback((newClinicians: SandboxClinician[], linkedGoalId?: number) => {
    setClinicians(newClinicians);
    if (linkedGoalId && apiGoals) {
      const g = apiGoals.find(g => g.id === linkedGoalId);
      if (g) setGoal(goalToSandbox(g));
    }
  }, [apiGoals]);

  if (loadingGoals) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <TooltipProvider delayDuration={300}>
    <div className="flex flex-col min-h-0">
      {importDialogOpen && apiGoals && (
        <ImportCliniciansDialog
          open={importDialogOpen}
          onClose={() => setImportDialogOpen(false)}
          goals={apiGoals}
          currentGoalId={goal.id}
          onImported={(imported) => {
            setClinicians(prev => [...prev, ...imported]);
            queryClient.invalidateQueries({ queryKey: getListCliniciansQueryKey({ goalId: goal.id }) });
          }}
        />
      )}
      {importStaffDialogOpen && apiGoals && (
        <ImportStaffDialog
          open={importStaffDialogOpen}
          onClose={() => setImportStaffDialogOpen(false)}
          goals={apiGoals}
          currentGoalId={goal.id}
          onImported={(imported) => {
            setSandboxStaff(prev => [...prev, ...imported]);
            queryClient.invalidateQueries({ queryKey: getListStaffMembersQueryKey({ goalId: goal.id }) });
          }}
        />
      )}

      {scenariosOpen && (
        <ScenariosPanel
          onClose={() => setScenariosOpen(false)}
          sandboxClinicians={clinicians}
          goal={goal}
          onLoadScenario={handleLoadScenario}
        />
      )}

      <div className="flex-1 grid grid-cols-1 lg:grid-cols-[220px_1fr_220px] gap-4 min-h-0 items-start">
        <aside className="lg:sticky lg:top-20 space-y-4 lg:overflow-y-auto lg:max-h-[calc(100vh-8rem)]">
          <PracticeInputsPanel
            goal={goal}
            goalSaving={goalSaving}
            onGoalChange={handleGoalChange}
            onSaveGoal={handleSaveGoal}
            goals={apiGoals}
            onSelectGoal={handleSelectGoal}
          />
        </aside>

        <main className="space-y-3 min-w-0">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-sm flex items-center gap-2">
              <User className="h-4 w-4 text-primary" />
              Clinician Roster
              {clinicians.length > 0 && (
                <Badge variant="secondary" className="text-[10px]">{clinicians.length}</Badge>
              )}
            </h3>
            <div className="flex items-center gap-1.5">
              {apiGoals && apiGoals.length > 1 && (
                <Button variant="ghost" size="sm" className="h-7 text-xs px-2.5 text-muted-foreground" onClick={() => setImportDialogOpen(true)}>
                  <Download className="h-3.5 w-3.5 mr-1" />
                  Import
                </Button>
              )}
              <Button size="sm" className="h-7 text-xs px-3" onClick={handleAddClinician}>
                <Plus className="h-3.5 w-3.5 mr-1" />
                Add Clinician
              </Button>
            </div>
          </div>
          {clinicians.length > 0 && (goal.annualOverheadGoal ?? 0) > 0 && (
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                Overhead allocation
                <InfoTip text="How shared overhead is divided across clinicians. Equal splits it evenly; Revenue weights by each clinician's production; Session weights by session count." />
              </span>
              <div className="flex items-center gap-px rounded bg-muted/70 border p-0.5 ml-auto">
                {(["equal", "revenue", "session"] as const).map(m => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => handleSetAllocationModel(m)}
                    className={`px-2.5 py-0.5 rounded text-[10px] capitalize transition-colors ${
                      overheadAllocationModel === m
                        ? "bg-background shadow-sm font-semibold text-foreground"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {m.charAt(0).toUpperCase() + m.slice(1)}
                  </button>
                ))}
              </div>
            </div>
          )}

          {clinicians.length === 0 && loadingGoalClinicians ? (
            <div className="flex items-center justify-center h-32">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : clinicians.length === 0 ? (
            <div className="rounded-lg border border-dashed p-12 text-center">
              <User className="h-8 w-8 text-muted-foreground mx-auto mb-3" />
              <h3 className="font-medium text-sm mb-1">No clinicians in this goal</h3>
              <p className="text-xs text-muted-foreground mb-4 max-w-xs mx-auto">
                Add clinicians to model compensation and see live profit projections.
              </p>
              <div className="flex items-center justify-center gap-2 flex-wrap">
                <Button size="sm" onClick={handleAddClinician}>
                  <Plus className="h-3.5 w-3.5 mr-1" />
                  Add Clinician
                </Button>
                {apiGoals && apiGoals.length > 1 && (
                  <Button variant="outline" size="sm" onClick={() => setImportDialogOpen(true)}>
                    <Download className="h-3.5 w-3.5 mr-1" />
                    Import from another goal
                  </Button>
                )}
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              {(() => {
                const allMetrics = clinicians.map(c => calculateClinicianMetrics(c));
                const totalAnnualSessions = allMetrics.reduce((s, m) => s + m.annualSessions, 0);
                const totalAnnualRevenue = allMetrics.reduce((s, m) => s + m.annualProduction, 0);
                const clinicianCount = clinicians.length;
                return clinicians.map(c => (
                  <ClinicianCard
                    key={c._localId}
                    clinician={c}
                    onChange={handleClinicianChange}
                    onSave={handleSaveClinician}
                    onRemove={handleRemoveClinician}
                    overhead={goal.annualOverheadGoal || 0}
                    totalAnnualBusinessNeed={calculateBusinessGoalOutputs(goal as Partial<BusinessGoal>).totalAnnualBusinessNeed}
                    selectedMetric={selectedMetric}
                    onSelectMetric={handleSetSelectedMetric}
                    overheadAllocationModel={overheadAllocationModel}
                    totalAnnualSessions={totalAnnualSessions}
                    totalAnnualRevenue={totalAnnualRevenue}
                    clinicianCount={clinicianCount}
                  />
                ));
              })()}
            </div>
          )}
          {/* ── Non-Clinical Staff Section ── */}
          <div className="mt-2">
            <div className="flex items-center gap-2 py-1">
              <button
                type="button"
                onClick={() => setStaffSectionOpen(o => !o)}
                className="flex items-center gap-2 flex-1 text-sm font-semibold text-foreground hover:text-primary transition-colors"
              >
                {staffSectionOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                <Users className="h-4 w-4 text-muted-foreground" />
                Non-Clinical Staff
                {sandboxStaff.length > 0 && (
                  <Badge variant="secondary" className="text-[10px] ml-1">{sandboxStaff.length}</Badge>
                )}
              </button>
              {(apiGoals?.length ?? 0) > 1 && (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs px-3 shrink-0"
                  onClick={() => { setImportStaffDialogOpen(true); setStaffSectionOpen(true); }}
                >
                  <Download className="h-3.5 w-3.5 mr-1" />
                  Import
                </Button>
              )}
              <Button
                size="sm"
                className="h-7 text-xs px-3 shrink-0"
                onClick={() => { handleAddStaff(); setStaffSectionOpen(true); }}
                disabled={goal.id === undefined}
              >
                <Plus className="h-3.5 w-3.5 mr-1" />
                Add Staff
              </Button>
            </div>

            {staffSectionOpen && (
              <div className="mt-2 space-y-2">
                {sandboxStaff.length === 0 ? (
                  <div className="rounded-lg border border-dashed p-6 text-center">
                    <Users className="h-6 w-6 text-muted-foreground mx-auto mb-2" />
                    <p className="text-xs text-muted-foreground mb-3">Add support staff to see their cost in the Live Summary</p>
                    <Button size="sm" variant="outline" onClick={handleAddStaff} disabled={goal.id === undefined}>
                      <Plus className="h-3.5 w-3.5 mr-1" />
                      Add Staff Member
                    </Button>
                  </div>
                ) : (
                  <>
                    {sandboxStaff.map(s => (
                      <SandboxStaffCard
                        key={s._localId}
                        staff={s}
                        onChange={handleStaffChange}
                        onSave={handleSaveStaff}
                        onRemove={handleRemoveStaff}
                      />
                    ))}
                    {sandboxStaff.length > 1 && (
                      <div className="flex items-center justify-between px-3 py-2 rounded-lg bg-muted/50 border border-border/50 text-xs text-muted-foreground">
                        <span>Total staff overhead</span>
                        <span className="font-medium text-foreground">
                          ${calculateTotalStaffCost(sandboxStaff as Parameters<typeof calculateTotalStaffCost>[0]).toLocaleString()}/yr
                        </span>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        </main>

        <aside className="lg:sticky lg:top-20 space-y-4 lg:overflow-y-auto lg:max-h-[calc(100vh-8rem)]">
          <LiveSummaryPanel clinicians={clinicians} goal={goal} staff={sandboxStaff} />
        </aside>
      </div>

      <div className="flex items-center justify-between pt-4 mt-4 border-t">
        <Button
          variant="ghost"
          size="sm"
          className="text-xs text-muted-foreground h-7"
          onClick={onShowAdvanced}
        >
          <Settings2 className="h-3.5 w-3.5 mr-1.5" />
          Advanced view
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className={`text-xs h-7 ${scenariosOpen ? "text-primary" : "text-muted-foreground"}`}
          onClick={() => setScenariosOpen(!scenariosOpen)}
        >
          <BookMarked className="h-3.5 w-3.5 mr-1.5" />
          Scenarios
        </Button>
      </div>
    </div>
    </TooltipProvider>
  );
}
