import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import {
  useListClinicians, useCreateClinician, useDeleteClinician, useUpdateClinician,
  useCopyClinicianToGoal,
  useListBusinessGoals, useUpdateBusinessGoal, useCreateBusinessGoal,
  useListScenarios, useCreateScenario, useDeleteScenario,
  useAddScenarioClinician, getScenario,
  getListCliniciansQueryKey, getListBusinessGoalsQueryKey, getListScenariosQueryKey,
  getGetScenarioQueryKey,
} from "@workspace/api-client-react";
import type { Clinician, BusinessGoal, ScenarioDetail } from "@workspace/api-client-react";
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
  Loader2, Settings2, User, FolderOpen, CheckCircle2, Download,
} from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { calculateClinicianMetrics, calculateBusinessGoalOutputs } from "@/lib/calculations";
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
      <span className="text-[11px] text-muted-foreground">Split (clx / practice)</span>
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

// ─── LiveSummaryPanel ────────────────────────────────────────────────────────

function LiveSummaryPanel({
  clinicians,
  goal,
}: {
  clinicians: SandboxClinician[];
  goal: SandboxGoal;
}) {
  const metrics = clinicians.map(c => calculateClinicianMetrics(c));
  const totalProduction = metrics.reduce((s, m) => s + m.annualProduction, 0);
  const totalComp = metrics.reduce((s, m) => s + m.clinicianCompensation, 0);
  const totalBurden = metrics.reduce((s, m) => s + m.employerObligations, 0);
  const totalPracticeNet = metrics.reduce((s, m) => s + m.practiceNetBeforeOverhead, 0);
  const overhead = goal.annualOverheadGoal || 0;
  const netAfterOverhead = totalPracticeNet - overhead;
  const goalOutputs = calculateBusinessGoalOutputs(goal as Partial<BusinessGoal>);
  // totalAnnualBusinessNeed already includes overhead, so compare against
  // totalPracticeNet (pre-overhead) — not netAfterOverhead, which would
  // double-count overhead in the gap calculation.
  const gap = goalOutputs.totalAnnualBusinessNeed - totalPracticeNet;
  const isOnTrack = totalPracticeNet >= goalOutputs.totalAnnualBusinessNeed;
  const pct = goalOutputs.totalAnnualBusinessNeed > 0
    ? Math.round((totalPracticeNet / goalOutputs.totalAnnualBusinessNeed) * 100)
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
              <span className="text-muted-foreground">Gross Production</span>
              <span className="font-semibold">{formatCurrency(totalProduction)}</span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-muted-foreground">Clinician Comp</span>
              <span className="font-semibold text-amber-600">−{formatCurrency(totalComp)}</span>
            </div>
            {totalBurden > 0 && (
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">Employer Burden</span>
                <span className="font-semibold text-amber-600">−{formatCurrency(totalBurden)}</span>
              </div>
            )}
            <Separator className="my-1" />
            <div className="flex justify-between text-xs">
              <span className="text-muted-foreground">Practice Net</span>
              <span className="font-semibold text-primary">{formatCurrency(totalPracticeNet)}</span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-muted-foreground">Est. Overhead</span>
              <span className="font-semibold text-muted-foreground">−{formatCurrency(overhead)}</span>
            </div>
            <Separator className="my-1" />
            <div className="flex justify-between text-sm">
              <span className="font-semibold">Net After Overhead</span>
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
                <span className={`ml-auto text-xs font-bold ${isOnTrack ? "text-green-700" : "text-destructive"}`}>
                  {pct}%
                </span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">Goal Target</span>
                <span className="font-semibold">{formatCurrency(goalOutputs.totalAnnualBusinessNeed)}</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">{isOnTrack ? "Surplus" : "Gap"}</span>
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
              <span className="font-semibold">{formatCurrency(totalPracticeNet / 12)}</span>
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
}: {
  clinician: SandboxClinician;
  onChange: (localId: string, patch: Partial<SandboxClinician>) => void;
  onSave: (localId: string) => void;
  onRemove: (localId: string) => void;
}) {
  const metrics = useMemo(() => calculateClinicianMetrics(clinician), [clinician]);
  const savedLabel = useRelativeTime(clinician._savedAt);

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
            <span className="text-[11px] text-muted-foreground">Annual Comp</span>
            <p className="text-sm font-semibold text-green-600">{formatCurrency(metrics.clinicianCompensation)}</p>
          </div>
        </div>

        {metrics.employerObligations > 0 && (
          <div className="flex items-center justify-between text-[11px]">
            <span className="text-muted-foreground">W2 employer burden</span>
            <span className="font-medium text-amber-600">−{formatCurrency(metrics.employerObligations)}/yr</span>
          </div>
        )}

        <button
          onClick={() => onChange(clinician._localId, { _expanded: !clinician._expanded, _dirty: clinician._dirty })}
          className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors w-full"
        >
          {clinician._expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          {clinician._expanded ? "Fewer settings" : "More settings"}
          <span className="ml-auto text-[10px] text-muted-foreground">
            {metrics.employerObligations > 0 ? "Net after burden" : "Net to practice"}: {formatCurrency(metrics.practiceNetBeforeOverhead)}
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
              <div className="grid grid-cols-2 gap-2">
                <InlineNumber label="Employer FICA (%)" value={clinician.w2EmployerFicaPct} onChange={v => setField("w2EmployerFicaPct", v)} step={0.01} suffix="%" />
                <InlineNumber label="FUTA/SUTA (%)" value={clinician.futaSutaPct} onChange={v => setField("futaSutaPct", v)} step={0.01} suffix="%" />
              </div>
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

// ─── SandboxView (main export) ───────────────────────────────────────────────

export default function SandboxView({ onShowAdvanced }: { onShowAdvanced: () => void }) {
  const { data: apiClinicians, isLoading: loadingClinicians } = useListClinicians();
  const { data: apiGoals, isLoading: loadingGoals } = useListBusinessGoals();

  const createClinician = useCreateClinician();
  const updateClinician = useUpdateClinician();
  const deleteClinician = useDeleteClinician();
  const updateGoal = useUpdateBusinessGoal();
  const createGoal = useCreateBusinessGoal();

  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [clinicians, setClinicians] = useState<SandboxClinician[]>([]);
  const [goal, setGoal] = useState<SandboxGoal>(DEFAULT_GOAL);
  const [goalSaving, setGoalSaving] = useState(false);
  const [scenariosOpen, setScenariosOpen] = useState(false);
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    if (!initialized && !loadingClinicians && !loadingGoals) {
      if (apiClinicians) setClinicians(apiClinicians.map(teamClinicianToSandbox));
      if (apiGoals && apiGoals.length > 0) setGoal(goalToSandbox(apiGoals[0]));
      setInitialized(true);
    }
  }, [initialized, loadingClinicians, loadingGoals, apiClinicians, apiGoals]);

  const handleGoalChange = useCallback((patch: Partial<SandboxGoal>) => {
    setGoal(prev => ({ ...prev, ...patch }));
  }, []);

  const handleSelectGoal = useCallback((g: BusinessGoal) => {
    setGoal(goalToSandbox(g));
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
      label: c.label, roleType: c.roleType, classification: c.classification,
      sessionRate: c.sessionRate, sessionsPerWeek: c.sessionsPerWeek,
      weeksWorkedPerYear: c.weeksWorkedPerYear,
      preCapClinicianSplit: c.preCapClinicianSplit, preCapPracticeSplit: c.preCapPracticeSplit,
      capEnabled: c.capEnabled, capAmount: c.capAmount,
      postCapClinicianSplit: c.postCapClinicianSplit, postCapPracticeSplit: c.postCapPracticeSplit,
      w2EmployerFicaPct: c.w2EmployerFicaPct, futaSutaPct: c.futaSutaPct,
      workersCompPct: c.workersCompPct, otherEmployerBurdenPct: c.otherEmployerBurdenPct,
      notes: c.notes,
    };

    try {
      if (c.id) {
        await new Promise<void>((resolve, reject) => {
          updateClinician.mutate({ id: c.id!, data: data as never }, {
            onSuccess: () => {
              queryClient.invalidateQueries({ queryKey: getListCliniciansQueryKey() });
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
              queryClient.invalidateQueries({ queryKey: getListCliniciansQueryKey() });
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
  }, [clinicians, updateClinician, createClinician, queryClient, toast]);

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
        onSuccess: () => queryClient.invalidateQueries({ queryKey: getListCliniciansQueryKey() }),
        onError: () => toast({ title: "Remove failed", variant: "destructive" }),
      });
    }
    setClinicians(prev => prev.filter(x => x._localId !== localId));
  }, [clinicians, deleteClinician, queryClient, toast]);

  const handleLoadScenario = useCallback((newClinicians: SandboxClinician[], linkedGoalId?: number) => {
    setClinicians(newClinicians);
    if (linkedGoalId && apiGoals) {
      const g = apiGoals.find(g => g.id === linkedGoalId);
      if (g) setGoal(goalToSandbox(g));
    }
  }, [apiGoals]);

  if (loadingClinicians || loadingGoals) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="flex flex-col min-h-0">
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
            <Button size="sm" className="h-7 text-xs px-3" onClick={handleAddClinician}>
              <Plus className="h-3.5 w-3.5 mr-1" />
              Add Clinician
            </Button>
          </div>

          {clinicians.length === 0 ? (
            <div className="rounded-lg border border-dashed p-12 text-center">
              <User className="h-8 w-8 text-muted-foreground mx-auto mb-3" />
              <h3 className="font-medium text-sm mb-1">No clinicians in sandbox</h3>
              <p className="text-xs text-muted-foreground mb-4 max-w-xs mx-auto">
                Add clinicians to model compensation and see live profit projections.
              </p>
              <Button size="sm" onClick={handleAddClinician}>
                <Plus className="h-3.5 w-3.5 mr-1" />
                Add Clinician
              </Button>
            </div>
          ) : (
            <div className="space-y-2">
              {clinicians.map(c => (
                <ClinicianCard
                  key={c._localId}
                  clinician={c}
                  onChange={handleClinicianChange}
                  onSave={handleSaveClinician}
                  onRemove={handleRemoveClinician}
                />
              ))}
            </div>
          )}
        </main>

        <aside className="lg:sticky lg:top-20 space-y-4 lg:overflow-y-auto lg:max-h-[calc(100vh-8rem)]">
          <LiveSummaryPanel clinicians={clinicians} goal={goal} />
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
  );
}
