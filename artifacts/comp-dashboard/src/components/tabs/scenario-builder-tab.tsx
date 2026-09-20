import { useState } from "react";
import {
  useListScenarios, useCreateScenario, useDeleteScenario,
  useUpdateScenario, useDuplicateScenario,
  useGetScenario, useAddScenarioClinician, useUpdateScenarioClinician, useRemoveScenarioClinician,
  useDuplicateScenarioClinician,
  useListBusinessGoals, useListClinicians, useListStaffMembers,
  useAddScenarioStaffMember, useUpdateScenarioStaffMember, useRemoveScenarioStaffMember,
  getListScenariosQueryKey, getGetScenarioQueryKey
} from "@workspace/api-client-react";
import type { Scenario, ScenarioClinician, Clinician, ScenarioStaffMember, StaffMember } from "@workspace/api-client-react";
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Plus, Trash, Copy, ChevronLeft, GitMerge, UserPlus, Pencil, Users } from "lucide-react";
import { calculateClinicianMetrics, calculateBusinessGoalOutputs, calculateStaffMemberCost } from "@/lib/calculations";
import { formatCurrency } from "@/lib/format";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";

const STAFF_ROLE_LABELS: Record<string, string> = {
  admin: "Admin",
  billing: "Billing",
  front_desk: "Front Desk",
  other: "Other",
};

type ScenStaffForm = {
  label: string;
  roleType: string;
  classification: string;
  annualSalary: number | null;
  hourlyRate: number | null;
  hoursPerWeek: number | null;
  weeksPerYear: number | null;
  w2EmployerFicaPct: number;
  futaSutaPct: number;
  workersCompPct: number;
  otherEmployerBurdenPct: number;
};

function ssToForm(s: ScenarioStaffMember): ScenStaffForm {
  return {
    label: s.label,
    roleType: String(s.roleType),
    classification: String(s.classification),
    annualSalary: s.annualSalary != null ? Number(s.annualSalary) : null,
    hourlyRate: s.hourlyRate != null ? Number(s.hourlyRate) : null,
    hoursPerWeek: s.hoursPerWeek != null ? Number(s.hoursPerWeek) : null,
    weeksPerYear: s.weeksPerYear != null ? Number(s.weeksPerYear) : null,
    w2EmployerFicaPct: Number(s.w2EmployerFicaPct ?? 7.65),
    futaSutaPct: Number(s.futaSutaPct ?? 1),
    workersCompPct: Number(s.workersCompPct ?? 0.5),
    otherEmployerBurdenPct: Number(s.otherEmployerBurdenPct ?? 0),
  };
}

function StaffEditDialog({
  open, onClose, initial, onSave, title,
}: {
  open: boolean; onClose: () => void;
  initial: ScenStaffForm; onSave: (f: ScenStaffForm) => void; title: string;
}) {
  const [form, setForm] = useState<ScenStaffForm>(initial);
  const isSalary = form.annualSalary != null && form.annualSalary > 0;
  const isW2 = form.classification === "w2";

  const previewCost = calculateStaffMemberCost({
    annualSalary: form.annualSalary,
    hourlyRate: form.hourlyRate,
    hoursPerWeek: form.hoursPerWeek,
    weeksPerYear: form.weeksPerYear ?? 0,
    classification: form.classification,
    w2EmployerFicaPct: form.w2EmployerFicaPct,
    futaSutaPct: form.futaSutaPct,
    workersCompPct: form.workersCompPct,
    otherEmployerBurdenPct: form.otherEmployerBurdenPct,
  });

  const set = (k: keyof ScenStaffForm, v: unknown) =>
    setForm(f => ({ ...f, [k]: v }));

  return (
    <Dialog open={open} onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent className="w-[95vw] sm:max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{title}</DialogTitle></DialogHeader>
        <div className="space-y-5 py-2">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2 space-y-1">
              <Label>Name / Label</Label>
              <Input value={form.label} onChange={e => set("label", e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Role Type</Label>
              <Select value={form.roleType} onValueChange={v => set("roleType", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(STAFF_ROLE_LABELS).map(([k, v]) => (
                    <SelectItem key={k} value={k}>{v}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Classification</Label>
              <Select value={form.classification} onValueChange={v => set("classification", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="w2">W2 Employee</SelectItem>
                  <SelectItem value="contractor">1099 Contractor</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="sm:col-span-2 space-y-2">
              <div className="flex items-center gap-3">
                <span className="text-sm font-medium">Compensation Mode</span>
                <div className="flex items-center gap-2 text-sm">
                  <span className={isSalary ? "text-muted-foreground" : "font-medium"}>Hourly</span>
                  <Switch
                    checked={isSalary}
                    onCheckedChange={on => {
                      if (on) { set("annualSalary", 50000); set("hourlyRate", null); set("hoursPerWeek", null); set("weeksPerYear", null); }
                      else { set("annualSalary", null); set("hourlyRate", 25); set("hoursPerWeek", 40); set("weeksPerYear", 50); }
                    }}
                  />
                  <span className={isSalary ? "font-medium" : "text-muted-foreground"}>Annual Salary</span>
                </div>
              </div>
              {isSalary ? (
                <div className="space-y-1">
                  <Label>Annual Salary ($)</Label>
                  <Input type="number" min={0} value={form.annualSalary ?? ""} onChange={e => set("annualSalary", Number(e.target.value))} />
                </div>
              ) : (
                <div className="grid grid-cols-3 gap-3">
                  <div className="space-y-1">
                    <Label>Hourly Rate ($)</Label>
                    <Input type="number" min={0} value={form.hourlyRate ?? ""} onChange={e => set("hourlyRate", Number(e.target.value))} />
                  </div>
                  <div className="space-y-1">
                    <Label>Hours / Week</Label>
                    <Input type="number" min={0} value={form.hoursPerWeek ?? ""} onChange={e => set("hoursPerWeek", Number(e.target.value))} />
                  </div>
                  <div className="space-y-1">
                    <Label>Weeks / Year</Label>
                    <Input type="number" min={0} value={form.weeksPerYear ?? ""} onChange={e => set("weeksPerYear", Number(e.target.value))} />
                  </div>
                </div>
              )}
            </div>
            {isW2 && (
              <>
                <div className="space-y-1">
                  <Label>Employer FICA (%)</Label>
                  <Input type="number" min={0} step={0.01} value={form.w2EmployerFicaPct} onChange={e => set("w2EmployerFicaPct", Number(e.target.value))} />
                </div>
                <div className="space-y-1">
                  <Label>FUTA/SUTA (%)</Label>
                  <Input type="number" min={0} step={0.01} value={form.futaSutaPct} onChange={e => set("futaSutaPct", Number(e.target.value))} />
                </div>
                <div className="space-y-1">
                  <Label>Workers&apos; Comp (%)</Label>
                  <Input type="number" min={0} step={0.01} value={form.workersCompPct} onChange={e => set("workersCompPct", Number(e.target.value))} />
                </div>
                <div className="space-y-1">
                  <Label>Other Burden (%)</Label>
                  <Input type="number" min={0} step={0.01} value={form.otherEmployerBurdenPct} onChange={e => set("otherEmployerBurdenPct", Number(e.target.value))} />
                </div>
              </>
            )}
          </div>

          <div className="rounded-lg bg-muted/60 p-3 space-y-1 text-sm">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Cost Preview</p>
            <div className="grid grid-cols-3 gap-2 text-center">
              <div>
                <span className="text-xs text-muted-foreground block">Base Cost</span>
                <span className="font-semibold">{formatCurrency(previewCost.baseAnnualCost)}</span>
              </div>
              <div>
                <span className="text-xs text-muted-foreground block">Employer Burden</span>
                <span className="font-semibold text-amber-600">{formatCurrency(previewCost.employerBurden)}</span>
              </div>
              <div>
                <span className="text-xs text-muted-foreground block">Total Annual</span>
                <span className="font-bold text-rose-600">{formatCurrency(previewCost.totalAnnualCost)}</span>
              </div>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => onSave(form)}>Save Changes</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type ScenClxForm = {
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
};

function scToForm(sc: ScenarioClinician | Clinician): ScenClxForm {
  return {
    label: sc.label,
    roleType: sc.roleType,
    classification: String(sc.classification),
    sessionRate: sc.sessionRate,
    sessionsPerWeek: sc.sessionsPerWeek,
    weeksWorkedPerYear: sc.weeksWorkedPerYear,
    preCapClinicianSplit: sc.preCapClinicianSplit,
    preCapPracticeSplit: sc.preCapPracticeSplit,
    capEnabled: sc.capEnabled,
    capAmount: sc.capAmount,
    postCapClinicianSplit: sc.postCapClinicianSplit,
    postCapPracticeSplit: sc.postCapPracticeSplit,
    w2EmployerFicaPct: sc.w2EmployerFicaPct,
    futaSutaPct: sc.futaSutaPct,
    workersCompPct: sc.workersCompPct,
    otherEmployerBurdenPct: sc.otherEmployerBurdenPct,
    notes: sc.notes ?? "",
  };
}

function NumField({ label, name, value, onChange, step, tooltip }: {
  label: string; name: string; value: number;
  onChange: (n: string, v: number) => void; step?: number; tooltip?: string;
}) {
  return (
    <div className="space-y-1">
      <Label htmlFor={name} title={tooltip}>{label}</Label>
      <Input id={name} type="number" min={0} step={step ?? 1} value={value}
        onChange={e => onChange(name, Number(e.target.value))} />
    </div>
  );
}

function ClinicianEditDialog({
  open, onClose, initial, onSave, title
}: {
  open: boolean; onClose: () => void;
  initial: ScenClxForm; onSave: (f: ScenClxForm) => void; title: string;
}) {
  const [form, setForm] = useState<ScenClxForm>(initial);
  const setField = (n: string, v: unknown) =>
    setForm(f => {
      const update: Partial<typeof f> = { [n]: v };
      const num = Number(v);
      const clamped = Math.min(100, Math.max(0, num));
      if (n === "preCapClinicianSplit")  update.preCapPracticeSplit  = Math.round((100 - clamped) * 10) / 10;
      if (n === "preCapPracticeSplit")   update.preCapClinicianSplit = Math.round((100 - clamped) * 10) / 10;
      if (n === "postCapClinicianSplit") update.postCapPracticeSplit = Math.round((100 - clamped) * 10) / 10;
      if (n === "postCapPracticeSplit")  update.postCapClinicianSplit = Math.round((100 - clamped) * 10) / 10;
      return { ...f, ...update };
    });
  const metrics = calculateClinicianMetrics(form);

  return (
    <Dialog open={open} onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent className="w-[95vw] sm:max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{title}</DialogTitle></DialogHeader>
        <div className="space-y-5 py-2">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2 space-y-1">
              <Label>Name / Label</Label>
              <Input value={form.label} onChange={e => setField("label", e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Role Type</Label>
              <Select value={form.roleType} onValueChange={v => setField("roleType", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="associate">Associate</SelectItem>
                  <SelectItem value="contractor">Contractor</SelectItem>
                  <SelectItem value="owner">Owner</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Classification</Label>
              <Select value={form.classification} onValueChange={v => setField("classification", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="w2">W2 Employee</SelectItem>
                  <SelectItem value="1099">1099 Contractor</SelectItem>
                  <SelectItem value="owner">Owner</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Productivity</p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <NumField label="Session Rate ($)" name="sessionRate" value={form.sessionRate} onChange={setField} />
              <NumField label="Sessions/Wk" name="sessionsPerWeek" value={form.sessionsPerWeek} onChange={setField} />
              <NumField label="Weeks/Yr" name="weeksWorkedPerYear" value={form.weeksWorkedPerYear} onChange={setField} />
            </div>
          </div>
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Revenue Split</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <NumField label="Pre-Cap Clinician %" name="preCapClinicianSplit" value={form.preCapClinicianSplit} onChange={setField} step={0.1} />
              <NumField label="Pre-Cap Practice %" name="preCapPracticeSplit" value={form.preCapPracticeSplit} onChange={setField} step={0.1} />
              <div className="sm:col-span-2 flex items-center gap-3">
                <Switch checked={form.capEnabled} onCheckedChange={v => setField("capEnabled", v)} />
                <Label>Enable cap</Label>
              </div>
              {form.capEnabled && <>
                <NumField label="Cap Amount ($)" name="capAmount" value={form.capAmount} onChange={setField} />
                <div />
                <NumField label="Post-Cap Clinician %" name="postCapClinicianSplit" value={form.postCapClinicianSplit} onChange={setField} step={0.1} />
                <NumField label="Post-Cap Practice %" name="postCapPracticeSplit" value={form.postCapPracticeSplit} onChange={setField} step={0.1} />
              </>}
            </div>
          </div>
          {form.classification === "w2" && (
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">W2 Employer Burden</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <NumField label="Employer FICA (%)" name="w2EmployerFicaPct" value={form.w2EmployerFicaPct} onChange={setField} step={0.01} />
                <NumField label="FUTA/SUTA (%)" name="futaSutaPct" value={form.futaSutaPct} onChange={setField} step={0.01} />
                <NumField label="Workers' Comp (%)" name="workersCompPct" value={form.workersCompPct} onChange={setField} step={0.01} />
                <NumField label="Other Burden (%)" name="otherEmployerBurdenPct" value={form.otherEmployerBurdenPct} onChange={setField} step={0.01} />
              </div>
            </div>
          )}
          <div className="rounded-lg bg-muted/50 p-3 border text-sm">
            <p className="text-xs font-medium mb-2">Live Preview</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <div><span className="text-muted-foreground text-xs">Annual Production</span><p className="font-semibold">{formatCurrency(metrics.annualProduction)}</p></div>
              <div><span className="text-muted-foreground text-xs">Clinician Comp</span><p className="font-semibold text-green-600">{formatCurrency(metrics.clinicianCompensation)}</p></div>
              <div><span className="text-muted-foreground text-xs">Employer Burden</span><p className="font-semibold text-amber-600">{formatCurrency(metrics.employerObligations)}</p></div>
              <div><span className="text-muted-foreground text-xs">Practice Net</span><p className="font-semibold text-primary">{formatCurrency(metrics.practiceNetBeforeOverhead)}</p></div>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => onSave(form)}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ScenarioDetail({ scenarioId, onBack }: { scenarioId: number; onBack: () => void }) {
  const { data: scenario, isLoading } = useGetScenario(scenarioId);
  const { data: allClinicians } = useListClinicians();
  const { data: allStaff } = useListStaffMembers();
  const { data: goals } = useListBusinessGoals();
  const addClinician = useAddScenarioClinician();
  const updateClinician = useUpdateScenarioClinician();
  const removeClinician = useRemoveScenarioClinician();
  const duplicateClinician = useDuplicateScenarioClinician();
  const addStaff = useAddScenarioStaffMember();
  const updateStaff = useUpdateScenarioStaffMember();
  const removeStaff = useRemoveScenarioStaffMember();
  const updateScenario = useUpdateScenario();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [editScen, setEditScen] = useState(false);
  const [scenName, setScenName] = useState("");
  const [scenNotes, setScenNotes] = useState("");
  const [scenGoalId, setScenGoalId] = useState<string>("");
  const [editClx, setEditClx] = useState<ScenarioClinician | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [addSource, setAddSource] = useState<Clinician | null>(null);
  const [addStaffOpen, setAddStaffOpen] = useState(false);
  const [editStaff, setEditStaff] = useState<ScenarioStaffMember | null>(null);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: getGetScenarioQueryKey(scenarioId) });

  const openEditScenario = () => {
    if (!scenario) return;
    setScenName(scenario.name);
    setScenNotes(scenario.notes ?? "");
    setScenGoalId(scenario.businessGoalId ? String(scenario.businessGoalId) : "none");
    setEditScen(true);
  };

  const handleSaveScenario = () => {
    updateScenario.mutate({
      id: scenarioId,
      data: {
        name: scenName,
        notes: scenNotes,
        businessGoalId: scenGoalId && scenGoalId !== "none" ? Number(scenGoalId) : null
      } as never
    }, {
      onSuccess: () => {
        invalidate();
        queryClient.invalidateQueries({ queryKey: getListScenariosQueryKey() });
        setEditScen(false);
        toast({ title: "Scenario saved", description: `"${scenName}" has been updated.` });
      },
      onError: () => toast({ title: "Save failed", description: "Could not save scenario.", variant: "destructive" }),
    });
  };

  const handleAddFromTemplate = (c: Clinician) => {
    addClinician.mutate({
      scenarioId,
      data: { ...scToForm(c), sourceClinicianId: c.id } as never
    }, {
      onSuccess: () => {
        invalidate(); setAddOpen(false); setAddSource(null);
        toast({ title: "Clinician added", description: `"${c.label}" copied into scenario.` });
      },
      onError: () => toast({ title: "Add failed", variant: "destructive" }),
    });
  };

  const handleAddBlank = () => {
    const blank: ScenClxForm = {
      label: "New Clinician", roleType: "associate", classification: "w2",
      sessionRate: 175, sessionsPerWeek: 20, weeksWorkedPerYear: 48,
      preCapClinicianSplit: 60, preCapPracticeSplit: 40, capEnabled: true,
      capAmount: 50000, postCapClinicianSplit: 75, postCapPracticeSplit: 25,
      w2EmployerFicaPct: 7.65, futaSutaPct: 1, workersCompPct: 0.5,
      otherEmployerBurdenPct: 0, notes: ""
    };
    addClinician.mutate({ scenarioId, data: blank as never }, {
      onSuccess: () => { invalidate(); toast({ title: "Clinician added", description: "Edit the details to configure this clinician." }); },
      onError: () => toast({ title: "Add failed", variant: "destructive" }),
    });
  };

  const handleSaveClx = (form: ScenClxForm) => {
    if (!editClx) return;
    updateClinician.mutate({
      scenarioId, id: editClx.id, data: form as never
    }, {
      onSuccess: () => {
        invalidate(); setEditClx(null);
        toast({ title: "Clinician saved", description: `"${form.label}" has been updated.` });
      },
      onError: () => toast({ title: "Save failed", description: "Could not save clinician.", variant: "destructive" }),
    });
  };

  const handleDuplicateClx = (id: number) => {
    duplicateClinician.mutate({ scenarioId, id }, {
      onSuccess: () => { invalidate(); toast({ title: "Clinician duplicated" }); },
      onError: () => toast({ title: "Duplicate failed", variant: "destructive" }),
    });
  };

  const handleRemoveClx = (id: number) => {
    removeClinician.mutate({ scenarioId, id }, {
      onSuccess: () => { invalidate(); toast({ title: "Clinician removed" }); },
      onError: () => toast({ title: "Remove failed", variant: "destructive" }),
    });
  };

  if (isLoading || !scenario) return <div className="p-8 text-muted-foreground">Loading scenario...</div>;

  const handleAddStaffFromTemplate = (s: StaffMember) => {
    addStaff.mutate({
      scenarioId,
      data: {
        label: s.label,
        roleType: s.roleType,
        classification: s.classification,
        annualSalary: s.annualSalary ?? undefined,
        hourlyRate: s.hourlyRate ?? undefined,
        hoursPerWeek: s.hoursPerWeek ?? undefined,
        weeksPerYear: s.weeksPerYear,
        w2EmployerFicaPct: s.w2EmployerFicaPct,
        futaSutaPct: s.futaSutaPct,
        workersCompPct: s.workersCompPct,
        otherEmployerBurdenPct: s.otherEmployerBurdenPct,
        sourceStaffMemberId: s.id,
      } as never
    }, {
      onSuccess: () => { invalidate(); setAddStaffOpen(false); toast({ title: "Staff added", description: `"${s.label}" added to scenario.` }); },
      onError: () => toast({ title: "Add failed", variant: "destructive" }),
    });
  };

  const handleRemoveStaff = (id: number) => {
    removeStaff.mutate({ scenarioId, id }, {
      onSuccess: () => { invalidate(); toast({ title: "Staff removed" }); },
      onError: () => toast({ title: "Remove failed", variant: "destructive" }),
    });
  };

  const handleSaveStaff = (form: ScenStaffForm) => {
    if (!editStaff) return;
    updateStaff.mutate({
      scenarioId,
      id: editStaff.id,
      data: {
        label: form.label,
        roleType: form.roleType as never,
        classification: form.classification as never,
        annualSalary: form.annualSalary,
        hourlyRate: form.hourlyRate,
        hoursPerWeek: form.hoursPerWeek,
        weeksPerYear: form.weeksPerYear,
        w2EmployerFicaPct: form.w2EmployerFicaPct,
        futaSutaPct: form.futaSutaPct,
        workersCompPct: form.workersCompPct,
        otherEmployerBurdenPct: form.otherEmployerBurdenPct,
      } as never,
    }, {
      onSuccess: () => {
        invalidate();
        setEditStaff(null);
        toast({ title: "Staff member updated", description: `"${form.label}" has been updated.` });
      },
      onError: () => toast({ title: "Update failed", variant: "destructive" }),
    });
  };

  const clinicians = scenario.clinicians ?? [];
  const scenarioStaff = scenario.staffMembers ?? [];
  const totalProduction = clinicians.reduce((sum, c) => sum + calculateClinicianMetrics(c).annualProduction, 0);
  const totalComp = clinicians.reduce((sum, c) => sum + calculateClinicianMetrics(c).clinicianCompensation, 0);
  const totalBurden = clinicians.reduce((sum, c) => sum + calculateClinicianMetrics(c).employerObligations, 0);
  const totalPracticeNet = clinicians.reduce((sum, c) => sum + calculateClinicianMetrics(c).practiceNetBeforeOverhead, 0);
  const totalStaffCost = scenarioStaff.reduce((sum, s) => {
    const { totalAnnualCost } = calculateStaffMemberCost({
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
    return sum + totalAnnualCost;
  }, 0);

  const linkedGoal = goals?.find(g => g.id === scenario.businessGoalId);
  const goalOutputs = linkedGoal ? calculateBusinessGoalOutputs(linkedGoal) : null;
  const goalPct = goalOutputs && goalOutputs.totalAnnualBusinessNeed > 0
    ? totalPracticeNet / goalOutputs.totalAnnualBusinessNeed
    : null;
  const goalStatus = goalPct === null ? null
    : goalPct >= 1 ? "green"
    : goalPct >= 0.75 ? "yellow"
    : "red";

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start gap-3">
        <Button variant="ghost" size="sm" onClick={onBack} className="min-h-[44px]"><ChevronLeft className="h-4 w-4 mr-1" />Back</Button>
        <div className="flex-1 min-w-0">
          <h2 className="text-2xl font-bold tracking-tight">{scenario.name}</h2>
          {scenario.notes && <p className="text-muted-foreground text-sm">{scenario.notes}</p>}
        </div>
        <Button variant="outline" size="sm" onClick={openEditScenario} className="min-h-[44px]">
          <Pencil className="h-4 w-4 mr-1" />Edit
        </Button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card><CardContent className="pt-4">
          <span className="text-muted-foreground text-xs block">Total Production</span>
          <span className="text-xl font-bold">{formatCurrency(totalProduction)}</span>
        </CardContent></Card>
        <Card><CardContent className="pt-4">
          <span className="text-muted-foreground text-xs block">Total Comp Cost</span>
          <span className="text-xl font-bold text-amber-600">{formatCurrency(totalComp + totalBurden)}</span>
        </CardContent></Card>
        <Card><CardContent className="pt-4">
          <span className="text-muted-foreground text-xs block">Practice Net</span>
          <span className="text-xl font-bold text-primary">{formatCurrency(totalPracticeNet)}</span>
        </CardContent></Card>
        <Card><CardContent className="pt-4">
          <span className="text-muted-foreground text-xs block">Staff Overhead</span>
          <span className="text-xl font-bold text-rose-600">{formatCurrency(totalStaffCost)}</span>
          <span className="text-[10px] text-muted-foreground block mt-0.5">{scenarioStaff.length} member{scenarioStaff.length !== 1 ? "s" : ""}</span>
        </CardContent></Card>
      </div>

      {linkedGoal && goalOutputs && (
        <div className={`rounded-lg border p-3 text-sm flex flex-wrap items-center gap-2 ${
          goalStatus === "green" ? "border-green-500 bg-green-50"
          : goalStatus === "yellow" ? "border-amber-400 bg-amber-50"
          : "border-red-400 bg-red-50"
        }`}>
          <div className={`h-2 w-2 rounded-full shrink-0 ${
            goalStatus === "green" ? "bg-green-500"
            : goalStatus === "yellow" ? "bg-amber-500"
            : "bg-red-500"
          }`} />
          <span className="font-medium">Goal: {linkedGoal.name}</span>
          <span className="text-muted-foreground hidden sm:inline">—</span>
          <span className="text-xs sm:text-sm">Need {formatCurrency(goalOutputs.totalAnnualBusinessNeed)}, have {formatCurrency(totalPracticeNet)}</span>
          {goalStatus !== "green" && (
            <span className={`font-semibold sm:ml-auto ${goalStatus === "yellow" ? "text-amber-600" : "text-destructive"}`}>
              {formatCurrency(goalOutputs.totalAnnualBusinessNeed - totalPracticeNet)} gap
              {goalPct !== null && ` (${Math.round(goalPct * 100)}%)`}
            </span>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-lg font-semibold">Clinicians in this Scenario</h3>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setAddOpen(true)} className="min-h-[44px]">
            <UserPlus className="h-4 w-4 mr-1" />Import from Team
          </Button>
          <Button size="sm" onClick={handleAddBlank} className="min-h-[44px]">
            <Plus className="h-4 w-4 mr-1" />Add Blank
          </Button>
        </div>
      </div>

      {clinicians.length === 0 ? (
        <Card className="flex flex-col items-center justify-center p-10 text-center">
          <p className="text-muted-foreground">No clinicians in this scenario yet.</p>
          <Button className="mt-3" onClick={() => setAddOpen(true)}>Import from Team Builder</Button>
        </Card>
      ) : (
        <div className="space-y-3">
          {clinicians.map(c => {
            const m = calculateClinicianMetrics(c);
            return (
              <Card key={c.id}>
                <CardContent className="pt-4">
                  <div className="flex flex-col sm:flex-row sm:items-start gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2 mb-2">
                        <span className="font-semibold">{c.label}</span>
                        <Badge variant="secondary" className="text-[10px] uppercase">{c.roleType}</Badge>
                        <Badge variant={String(c.classification) === "w2" ? "default" : "outline"} className="text-[10px] uppercase">{c.classification}</Badge>
                      </div>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                        <div><span className="text-muted-foreground text-xs block">Production</span><span className="font-medium">{formatCurrency(m.annualProduction)}</span></div>
                        <div><span className="text-muted-foreground text-xs block">Clinician Comp</span><span className="font-medium text-green-600">{formatCurrency(m.clinicianCompensation)}</span></div>
                        <div><span className="text-muted-foreground text-xs block">Employer Burden</span><span className="font-medium text-amber-600">{formatCurrency(m.employerObligations)}</span></div>
                        <div><span className="text-muted-foreground text-xs block">Practice Net</span><span className="font-medium text-primary">{formatCurrency(m.practiceNetBeforeOverhead)}</span></div>
                      </div>
                    </div>
                    <div className="flex gap-1 sm:shrink-0">
                      <Button variant="ghost" size="icon" className="h-11 w-11 sm:h-8 sm:w-8" onClick={() => setEditClx(c)} title="Edit">
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-11 w-11 sm:h-8 sm:w-8" onClick={() => handleDuplicateClx(c.id)} title="Duplicate">
                        <Copy className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-11 w-11 sm:h-8 sm:w-8 text-destructive hover:bg-destructive/10" onClick={() => handleRemoveClx(c.id)} title="Remove">
                        <Trash className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {editClx && (
        <ClinicianEditDialog
          open={!!editClx}
          onClose={() => setEditClx(null)}
          initial={scToForm(editClx)}
          onSave={handleSaveClx}
          title={`Edit ${editClx.label}`}
        />
      )}

      {/* ── Non-Clinical Staff ── */}
      <Separator />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Users className="h-5 w-5 text-muted-foreground" />
          <h3 className="text-lg font-semibold">Non-Clinical Staff</h3>
          {scenarioStaff.length > 0 && (
            <span className="text-sm text-muted-foreground">— {formatCurrency(totalStaffCost)} / yr</span>
          )}
        </div>
        <Button variant="outline" size="sm" onClick={() => setAddStaffOpen(true)} className="min-h-[44px]">
          <UserPlus className="h-4 w-4 mr-1" />Import from Team
        </Button>
      </div>

      {scenarioStaff.length === 0 ? (
        <Card className="flex flex-col items-center justify-center p-8 text-center">
          <p className="text-muted-foreground text-sm">No staff in this scenario.</p>
          <Button className="mt-3" variant="outline" size="sm" onClick={() => setAddStaffOpen(true)}>Import from Team Builder</Button>
        </Card>
      ) : (
        <div className="space-y-2">
          {scenarioStaff.map(s => {
            const cost = calculateStaffMemberCost({
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
            return (
              <Card key={s.id}>
                <CardContent className="pt-4">
                  <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2 mb-2">
                        <span className="font-semibold">{s.label}</span>
                        <Badge variant="secondary" className="text-[10px]">{STAFF_ROLE_LABELS[String(s.roleType)] ?? s.roleType}</Badge>
                        <Badge variant={String(s.classification) === "w2" ? "default" : "outline"} className="text-[10px] uppercase">{s.classification}</Badge>
                      </div>
                      <div className="grid grid-cols-3 gap-3 text-sm">
                        <div><span className="text-muted-foreground text-xs block">Base Salary</span><span className="font-medium">{formatCurrency(cost.baseAnnualCost)}</span></div>
                        <div><span className="text-muted-foreground text-xs block">Employer Burden</span><span className="font-medium text-amber-600">{formatCurrency(cost.employerBurden)}</span></div>
                        <div><span className="text-muted-foreground text-xs block">Total Annual Cost</span><span className="font-medium text-rose-600">{formatCurrency(cost.totalAnnualCost)}</span></div>
                      </div>
                    </div>
                    <div className="flex gap-1 shrink-0">
                      <Button variant="ghost" size="icon" className="h-11 w-11 sm:h-8 sm:w-8" onClick={() => setEditStaff(s)} title="Edit">
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-11 w-11 sm:h-8 sm:w-8 text-destructive hover:bg-destructive/10" onClick={() => handleRemoveStaff(s.id)} title="Remove">
                        <Trash className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {editStaff && (
        <StaffEditDialog
          open={!!editStaff}
          onClose={() => setEditStaff(null)}
          initial={ssToForm(editStaff)}
          onSave={handleSaveStaff}
          title={`Edit ${editStaff.label}`}
        />
      )}

      <Dialog open={addStaffOpen} onOpenChange={setAddStaffOpen}>
        <DialogContent className="w-[95vw] sm:max-w-lg">
          <DialogHeader><DialogTitle>Import Staff from Team Builder</DialogTitle></DialogHeader>
          {!allStaff?.length ? (
            <p className="text-muted-foreground text-sm py-4">No staff in Team Builder. Add them there first.</p>
          ) : (
            <div className="space-y-2 py-2 max-h-80 overflow-y-auto">
              {allStaff.map(s => {
                const cost = calculateStaffMemberCost({
                  annualSalary: s.annualSalary, hourlyRate: s.hourlyRate, hoursPerWeek: s.hoursPerWeek,
                  weeksPerYear: s.weeksPerYear, classification: String(s.classification),
                  w2EmployerFicaPct: s.w2EmployerFicaPct, futaSutaPct: s.futaSutaPct,
                  workersCompPct: s.workersCompPct, otherEmployerBurdenPct: s.otherEmployerBurdenPct,
                });
                const alreadyAdded = scenarioStaff.some(ss => ss.sourceStaffMemberId === s.id);
                return (
                  <div key={s.id} className="flex items-center justify-between p-3 border rounded-lg hover:bg-muted/50">
                    <div>
                      <span className="font-medium">{s.label}</span>
                      <span className="text-muted-foreground text-xs ml-2">{STAFF_ROLE_LABELS[String(s.roleType)]} · {formatCurrency(cost.totalAnnualCost)}/yr</span>
                    </div>
                    <Button size="sm" onClick={() => handleAddStaffFromTemplate(s)} disabled={alreadyAdded}>
                      {alreadyAdded ? "Added" : "Import"}
                    </Button>
                  </div>
                );
              })}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddStaffOpen(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="w-[95vw] sm:max-w-lg">
          <DialogHeader><DialogTitle>Import Clinician from Team Builder</DialogTitle></DialogHeader>
          {!allClinicians?.length ? (
            <p className="text-muted-foreground text-sm py-4">No clinicians in Team Builder. Add them there first.</p>
          ) : (
            <div className="space-y-2 py-2 max-h-80 overflow-y-auto">
              {allClinicians.map(c => (
                <div key={c.id} className="flex items-center justify-between p-3 border rounded-lg hover:bg-muted/50">
                  <div>
                    <span className="font-medium">{c.label}</span>
                    <span className="text-muted-foreground text-xs ml-2">{c.classification} · {formatCurrency(c.sessionRate)}/session</span>
                  </div>
                  <Button size="sm" onClick={() => handleAddFromTemplate(c)}>Import</Button>
                </div>
              ))}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={editScen} onOpenChange={setEditScen}>
        <DialogContent className="w-[95vw] sm:max-w-md">
          <DialogHeader><DialogTitle>Edit Scenario</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1">
              <Label>Scenario Name</Label>
              <Input value={scenName} onChange={e => setScenName(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Linked Business Goal</Label>
              <Select value={scenGoalId} onValueChange={setScenGoalId}>
                <SelectTrigger><SelectValue placeholder="No goal linked" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  {goals?.map(g => <SelectItem key={g.id} value={String(g.id)}>{g.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Notes</Label>
              <Textarea value={scenNotes} onChange={e => setScenNotes(e.target.value)} rows={3} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditScen(false)}>Cancel</Button>
            <Button onClick={handleSaveScenario}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function ScenarioBuilderTab() {
  const { data: scenarios, isLoading } = useListScenarios();
  const createScenario = useCreateScenario();
  const deleteScenario = useDeleteScenario();
  const duplicateScenario = useDuplicateScenario();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [openScenarioId, setOpenScenarioId] = useState<number | null>(null);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: getListScenariosQueryKey() });

  const handleCreate = () => {
    createScenario.mutate({ data: { name: "New Scenario", notes: "" } as never }, {
      onSuccess: (s) => {
        invalidate(); setOpenScenarioId(s.id);
        toast({ title: "Scenario created", description: "Configure it below." });
      },
      onError: () => toast({ title: "Create failed", variant: "destructive" }),
    });
  };

  const handleDelete = (id: number) => deleteScenario.mutate({ id }, {
    onSuccess: () => { invalidate(); toast({ title: "Scenario deleted" }); },
    onError: () => toast({ title: "Delete failed", variant: "destructive" }),
  });
  const handleDuplicate = (id: number) => duplicateScenario.mutate({ id }, {
    onSuccess: () => { invalidate(); toast({ title: "Scenario duplicated" }); },
    onError: () => toast({ title: "Duplicate failed", variant: "destructive" }),
  });

  if (openScenarioId !== null) {
    return <ScenarioDetail scenarioId={openScenarioId} onBack={() => setOpenScenarioId(null)} />;
  }

  if (isLoading) return <div className="p-8 text-muted-foreground">Loading scenarios...</div>;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Scenario Builder</h2>
          <p className="text-muted-foreground">Create different practice configurations to compare.</p>
        </div>
        <Button onClick={handleCreate} className="min-h-[44px]">
          <Plus className="h-4 w-4 mr-2" />
          Create Scenario
        </Button>
      </div>

      {(!scenarios || scenarios.length === 0) ? (
        <Card className="flex flex-col items-center justify-center p-12 text-center">
          <div className="rounded-full bg-primary/10 p-4 mb-4">
            <GitMerge className="h-8 w-8 text-primary" />
          </div>
          <h3 className="text-lg font-medium">No Scenarios</h3>
          <p className="text-muted-foreground max-w-sm mt-2 mb-4">
            Create your first scenario to model different practice setups.
          </p>
          <Button onClick={handleCreate}>Create Scenario</Button>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {scenarios.map(s => (
            <Card key={s.id} className="flex flex-col">
              <CardHeader className="flex flex-row items-start justify-between pb-2">
                <div className="flex-1 min-w-0">
                  <CardTitle className="truncate">{s.name}</CardTitle>
                  <p className="text-xs text-muted-foreground mt-1">{new Date(s.updatedAt).toLocaleDateString()}</p>
                </div>
                <div className="flex gap-1 ml-2 shrink-0">
                  <Button variant="ghost" size="icon" className="h-10 w-10 sm:h-8 sm:w-8" onClick={() => handleDuplicate(s.id)} title="Duplicate">
                    <Copy className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-10 w-10 sm:h-8 sm:w-8 text-destructive hover:bg-destructive/10" onClick={() => handleDelete(s.id)}>
                    <Trash className="h-4 w-4" />
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="flex-1">
                <p className="text-sm text-muted-foreground">{s.notes || "No notes."}</p>
              </CardContent>
              <CardFooter className="bg-muted/50 border-t py-3">
                <Button variant="outline" className="w-full" onClick={() => setOpenScenarioId(s.id)}>Open Scenario</Button>
              </CardFooter>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
