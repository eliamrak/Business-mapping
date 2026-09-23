import { useState } from "react";
import {
  useListClinicians, useCreateClinician, useDeleteClinician,
  useUpdateClinician, useDuplicateClinician,
  getListCliniciansQueryKey,
  useListStaffMembers, useCreateStaffMember, useUpdateStaffMember, useDeleteStaffMember,
  getListStaffMembersQueryKey,
  useListBusinessGoals,
} from "@workspace/api-client-react";
import type { Clinician, StaffMember } from "@workspace/api-client-react";
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Plus, Trash, User, Copy, Users, ChevronDown, ChevronRight } from "lucide-react";
import { calculateClinicianMetrics, calculateStaffMemberCost } from "@/lib/calculations";
import { formatCurrency } from "@/lib/format";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";

// ─── Clinician Section ────────────────────────────────────────────────────────

type ClinicianForm = {
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

function clinicianToForm(c: Clinician): ClinicianForm {
  return {
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
  };
}

const defaultClinicianForm: ClinicianForm = {
  label: "New Clinician",
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

// ─── Staff Member Section ─────────────────────────────────────────────────────

type StaffForm = {
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
};

function staffToForm(s: StaffMember): StaffForm {
  return {
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
  };
}

const defaultStaffForm: StaffForm = {
  label: "New Staff Member",
  roleType: "admin",
  classification: "w2",
  annualSalary: 45000,
  hourlyRate: null,
  hoursPerWeek: null,
  weeksPerYear: 52,
  w2EmployerFicaPct: 7.65,
  futaSutaPct: 1.0,
  workersCompPct: 0.5,
  otherEmployerBurdenPct: 0,
  notes: "",
  payMode: "salary",
};

const ROLE_LABELS: Record<string, string> = {
  admin: "Admin",
  billing: "Billing",
  front_desk: "Front Desk",
  other: "Other",
};

function StaffMemberDialog({
  open, title, initial, onClose, onSave, saving
}: {
  open: boolean; title: string; initial: StaffForm;
  onClose: () => void; onSave: (f: StaffForm) => void; saving: boolean;
}) {
  const [form, setForm] = useState<StaffForm>(initial);

  const setField = (name: string, value: unknown) =>
    setForm(f => ({ ...f, [name]: value }));

  const metrics = calculateStaffMemberCost({
    annualSalary: form.payMode === "salary" ? form.annualSalary : null,
    hourlyRate: form.payMode === "hourly" ? form.hourlyRate : null,
    hoursPerWeek: form.payMode === "hourly" ? form.hoursPerWeek : null,
    weeksPerYear: form.weeksPerYear,
    classification: form.classification,
    w2EmployerFicaPct: form.w2EmployerFicaPct,
    futaSutaPct: form.futaSutaPct,
    workersCompPct: form.workersCompPct,
    otherEmployerBurdenPct: form.otherEmployerBurdenPct,
  });

  const handleSave = () => {
    const payload: StaffForm = {
      ...form,
      annualSalary: form.payMode === "salary" ? form.annualSalary : null,
      hourlyRate: form.payMode === "hourly" ? form.hourlyRate : null,
      hoursPerWeek: form.payMode === "hourly" ? form.hoursPerWeek : null,
    };
    onSave(payload);
  };

  return (
    <Dialog open={open} onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent className="w-[95vw] sm:max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="space-y-5 py-2">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2 space-y-1">
              <Label>Name / Label</Label>
              <Input value={form.label} onChange={e => setField("label", e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Role</Label>
              <Select value={form.roleType} onValueChange={v => setField("roleType", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="admin">Admin / Office Manager</SelectItem>
                  <SelectItem value="billing">Billing Coordinator</SelectItem>
                  <SelectItem value="front_desk">Front Desk</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Classification</Label>
              <Select value={form.classification} onValueChange={v => setField("classification", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="w2">W2 Employee</SelectItem>
                  <SelectItem value="contractor">Contractor (1099)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Compensation</p>
            <div className="flex gap-2 mb-3">
              <Button
                type="button"
                size="sm"
                variant={form.payMode === "salary" ? "default" : "outline"}
                onClick={() => setField("payMode", "salary")}
              >Annual Salary</Button>
              <Button
                type="button"
                size="sm"
                variant={form.payMode === "hourly" ? "default" : "outline"}
                onClick={() => setField("payMode", "hourly")}
              >Hourly Rate</Button>
            </div>
            {form.payMode === "salary" ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label>Annual Salary ($)</Label>
                  <Input type="number" min={0} value={form.annualSalary ?? ""} onChange={e => setField("annualSalary", Number(e.target.value))} />
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="space-y-1">
                  <Label>Hourly Rate ($)</Label>
                  <Input type="number" min={0} step={0.01} value={form.hourlyRate ?? ""} onChange={e => setField("hourlyRate", Number(e.target.value))} />
                </div>
                <div className="space-y-1">
                  <Label>Hours / Week</Label>
                  <Input type="number" min={0} step={0.5} value={form.hoursPerWeek ?? ""} onChange={e => setField("hoursPerWeek", Number(e.target.value))} />
                </div>
                <div className="space-y-1">
                  <Label>Weeks / Year</Label>
                  <Input type="number" min={0} value={form.weeksPerYear} onChange={e => setField("weeksPerYear", Number(e.target.value))} />
                </div>
              </div>
            )}
          </div>

          {form.classification === "w2" && (
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">W2 Employer Burden</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label title="Employer's share of Social Security & Medicare (7.65%)">Employer FICA (%)</Label>
                  <Input type="number" min={0} step={0.01} value={form.w2EmployerFicaPct} onChange={e => setField("w2EmployerFicaPct", Number(e.target.value))} />
                </div>
                <div className="space-y-1">
                  <Label>FUTA/SUTA (%)</Label>
                  <Input type="number" min={0} step={0.01} value={form.futaSutaPct} onChange={e => setField("futaSutaPct", Number(e.target.value))} />
                </div>
                <div className="space-y-1">
                  <Label>Workers' Comp (%)</Label>
                  <Input type="number" min={0} step={0.01} value={form.workersCompPct} onChange={e => setField("workersCompPct", Number(e.target.value))} />
                </div>
                <div className="space-y-1">
                  <Label title="Health insurance, retirement match, or other benefits">Other Burden (%)</Label>
                  <Input type="number" min={0} step={0.01} value={form.otherEmployerBurdenPct} onChange={e => setField("otherEmployerBurdenPct", Number(e.target.value))} />
                </div>
              </div>
            </div>
          )}

          <div className="rounded-lg bg-muted/50 p-4 border">
            <p className="text-sm font-medium mb-2">Live Preview</p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
              <div><span className="text-muted-foreground block text-xs">Base Annual Cost</span><span className="font-semibold">{formatCurrency(metrics.baseAnnualCost)}</span></div>
              <div><span className="text-muted-foreground block text-xs">Employer Burden</span><span className="font-semibold text-amber-600">{formatCurrency(metrics.employerBurden)}</span></div>
              <div><span className="text-muted-foreground block text-xs">Total Annual Cost</span><span className="font-semibold text-primary">{formatCurrency(metrics.totalAnnualCost)}</span></div>
            </div>
          </div>

          <div className="space-y-1">
            <Label>Notes</Label>
            <Textarea value={form.notes} onChange={e => setField("notes", e.target.value)} rows={2} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving}>{saving ? "Saving…" : "Save Changes"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function TeamBuilderTab({ teamId }: { teamId?: number | null } = {}) {
  const { data: allClinicians, isLoading: clinLoading } = useListClinicians();
  const { data: businessGoals } = useListBusinessGoals();
  const createClinician = useCreateClinician();
  const updateClinician = useUpdateClinician();
  const deleteClinician = useDeleteClinician();
  const duplicateClinician = useDuplicateClinician();

  const { data: allStaffMembers, isLoading: staffLoading } = useListStaffMembers();
  const clinicians = teamId === undefined ? allClinicians : allClinicians?.filter(c => (c.goalId ?? null) === teamId);
  const staffMembers = teamId === undefined ? allStaffMembers : allStaffMembers?.filter(s => (s.goalId ?? null) === teamId);
  const staffGoalId = teamId === undefined ? (businessGoals?.[0]?.id ?? null) : teamId;
  const createStaff = useCreateStaffMember();
  const updateStaff = useUpdateStaffMember();
  const deleteStaff = useDeleteStaffMember();

  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [editClinician, setEditClinician] = useState<Clinician | null>(null);
  const [clinForm, setClinForm] = useState<ClinicianForm>(defaultClinicianForm);
  const [clinSaving, setClinSaving] = useState(false);

  const [staffOpen, setStaffOpen] = useState(false);
  const [editStaff, setEditStaff] = useState<StaffMember | null>(null);
  const [staffSaving, setStaffSaving] = useState(false);
  const [staffExpanded, setStaffExpanded] = useState(true);

  const invalidateClinicians = () => queryClient.invalidateQueries({ queryKey: getListCliniciansQueryKey() });
  const invalidateStaff = () => queryClient.invalidateQueries({ queryKey: getListStaffMembersQueryKey() });

  const openEditClinician = (c: Clinician) => {
    setEditClinician(c);
    setClinForm(clinicianToForm(c));
  };

  const setClinField = (name: string, value: unknown) =>
    setClinForm(f => {
      const update: Partial<typeof f> = { [name]: value };
      const v = Number(value);
      const clamped = Math.min(100, Math.max(0, v));
      if (name === "preCapClinicianSplit")  update.preCapPracticeSplit  = Math.round((100 - clamped) * 10) / 10;
      if (name === "preCapPracticeSplit")   update.preCapClinicianSplit = Math.round((100 - clamped) * 10) / 10;
      if (name === "postCapClinicianSplit") update.postCapPracticeSplit = Math.round((100 - clamped) * 10) / 10;
      if (name === "postCapPracticeSplit")  update.postCapClinicianSplit = Math.round((100 - clamped) * 10) / 10;
      return { ...f, ...update };
    });

  const handleSaveClinician = () => {
    if (!editClinician) return;
    setClinSaving(true);
    updateClinician.mutate({ id: editClinician.id, data: clinForm as never }, {
      onSuccess: () => {
        invalidateClinicians(); setEditClinician(null); setClinSaving(false);
        toast({ title: "Clinician saved", description: `"${clinForm.label}" has been updated.` });
      },
      onError: () => { setClinSaving(false); toast({ title: "Save failed", variant: "destructive" }); },
    });
  };

  const handleCreateClinician = () => {
    createClinician.mutate({ data: { ...defaultClinicianForm, ...(teamId !== undefined ? { goalId: teamId } : {}) } as never }, {
      onSuccess: (c) => { invalidateClinicians(); openEditClinician(c); toast({ title: "Clinician added" }); },
      onError: () => toast({ title: "Create failed", variant: "destructive" }),
    });
  };

  const handleDeleteClinician = (id: number) => deleteClinician.mutate({ id }, {
    onSuccess: () => { invalidateClinicians(); toast({ title: "Clinician deleted" }); },
    onError: () => toast({ title: "Delete failed", variant: "destructive" }),
  });

  const handleDuplicateClinician = (id: number) => duplicateClinician.mutate({ id }, {
    onSuccess: () => { invalidateClinicians(); toast({ title: "Clinician duplicated" }); },
    onError: () => toast({ title: "Duplicate failed", variant: "destructive" }),
  });

  const handleCreateStaff = () => {
    if (staffGoalId === null) {
      toast({ title: "Choose a practice team before adding staff", variant: "destructive" });
      return;
    }
    createStaff.mutate({ data: { label: "New Staff Member", roleType: "admin", classification: "w2", annualSalary: 45000, goalId: staffGoalId } as never }, {
      onSuccess: (s) => {
        invalidateStaff();
        setEditStaff(s);
        setStaffOpen(true);
        toast({ title: "Staff member added" });
      },
      onError: () => toast({ title: "Create failed", variant: "destructive" }),
    });
  };

  const handleSaveStaff = (form: StaffForm) => {
    if (!editStaff) return;
    setStaffSaving(true);
    updateStaff.mutate({
      id: editStaff.id,
      data: {
        label: form.label,
        roleType: form.roleType,
        classification: form.classification,
        annualSalary: form.payMode === "salary" ? (form.annualSalary ?? undefined) : undefined,
        hourlyRate: form.payMode === "hourly" ? (form.hourlyRate ?? undefined) : undefined,
        hoursPerWeek: form.payMode === "hourly" ? (form.hoursPerWeek ?? undefined) : undefined,
        weeksPerYear: form.weeksPerYear,
        w2EmployerFicaPct: form.w2EmployerFicaPct,
        futaSutaPct: form.futaSutaPct,
        workersCompPct: form.workersCompPct,
        otherEmployerBurdenPct: form.otherEmployerBurdenPct,
        notes: form.notes || undefined,
      } as never
    }, {
      onSuccess: () => {
        invalidateStaff(); setStaffOpen(false); setEditStaff(null); setStaffSaving(false);
        toast({ title: "Staff member saved", description: `"${form.label}" has been updated.` });
      },
      onError: () => { setStaffSaving(false); toast({ title: "Save failed", variant: "destructive" }); },
    });
  };

  const handleDeleteStaff = (id: number) => deleteStaff.mutate({ id }, {
    onSuccess: () => { invalidateStaff(); toast({ title: "Staff member deleted" }); },
    onError: () => toast({ title: "Delete failed", variant: "destructive" }),
  });

  const isLoading = clinLoading || staffLoading;
  if (isLoading) return <div className="p-8 text-muted-foreground">Loading team...</div>;

  const clinMetrics = clinForm ? calculateClinicianMetrics({ ...clinForm }) : null;

  return (
    <div className="space-y-8">
      {/* ── Clinicians Section ── */}
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-2xl font-bold tracking-tight">Team Builder</h2>
            <p className="text-muted-foreground">Manage clinician profiles and compensation models.</p>
          </div>
          <Button onClick={handleCreateClinician} className="min-h-[44px]">
            <Plus className="h-4 w-4 mr-2" />
            Add Clinician
          </Button>
        </div>

        {(!clinicians || clinicians.length === 0) ? (
          <Card className="flex flex-col items-center justify-center p-12 text-center">
            <div className="rounded-full bg-primary/10 p-4 mb-4">
              <User className="h-8 w-8 text-primary" />
            </div>
            <h3 className="text-lg font-medium">No Clinicians</h3>
            <p className="text-muted-foreground max-w-sm mt-2 mb-4">Build your team by adding clinician profiles.</p>
            <Button onClick={handleCreateClinician}>Add Clinician</Button>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {clinicians.map(c => {
              const m = calculateClinicianMetrics({ ...c, classification: String(c.classification) });
              return (
                <Card key={c.id} className="flex flex-col">
                  <CardHeader className="flex flex-row items-start justify-between pb-2">
                    <div className="flex-1 min-w-0">
                      <CardTitle className="truncate">{c.label}</CardTitle>
                      <div className="flex gap-2 mt-2">
                        <Badge variant="secondary" className="uppercase text-[10px]">{c.roleType}</Badge>
                        <Badge variant={String(c.classification) === "w2" ? "default" : "outline"} className="uppercase text-[10px]">{c.classification}</Badge>
                      </div>
                    </div>
                    <div className="flex gap-1 ml-2 shrink-0">
                      <Button variant="ghost" size="icon" className="h-10 w-10 sm:h-8 sm:w-8" onClick={() => handleDuplicateClinician(c.id)} title="Duplicate">
                        <Copy className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-10 w-10 sm:h-8 sm:w-8 text-destructive hover:bg-destructive/10" onClick={() => handleDeleteClinician(c.id)}>
                        <Trash className="h-4 w-4" />
                      </Button>
                    </div>
                  </CardHeader>
                  <CardContent className="flex-1">
                    <div className="grid grid-cols-2 gap-y-3 gap-x-2 text-sm mt-2">
                      <div>
                        <span className="text-muted-foreground block text-xs">Annual Production</span>
                        <span className="font-semibold">{formatCurrency(m.annualProduction)}</span>
                      </div>
                      <div>
                        <span className="text-muted-foreground block text-xs">Clinician Comp</span>
                        <span className="font-semibold text-green-600">{formatCurrency(m.clinicianCompensation)}</span>
                      </div>
                      <div>
                        <span className="text-muted-foreground block text-xs">Practice Net</span>
                        <span className="font-semibold text-primary">{formatCurrency(m.practiceNetBeforeOverhead)}</span>
                      </div>
                      <div>
                        <span className="text-muted-foreground block text-xs">Session Rate</span>
                        <span className="font-semibold">{formatCurrency(c.sessionRate)}</span>
                      </div>
                      {c.capEnabled && (
                        <div>
                          <span className="text-muted-foreground block text-xs">Sessions to Cap</span>
                          <span className="font-semibold">{Math.round(m.sessionsToCAP)}</span>
                        </div>
                      )}
                      <div className="col-span-2">
                        <span className="text-muted-foreground block text-xs">Split (Pre → Post Cap)</span>
                        <span className="font-mono text-xs">
                          {c.preCapClinicianSplit}/{c.preCapPracticeSplit}
                          {c.capEnabled ? ` → ${c.postCapClinicianSplit}/${c.postCapPracticeSplit} (cap: ${formatCurrency(c.capAmount)})` : " (no cap)"}
                        </span>
                      </div>
                    </div>
                  </CardContent>
                  <CardFooter className="bg-muted/50 border-t py-3">
                    <Button variant="outline" className="w-full" onClick={() => openEditClinician(c)}>Edit Profile</Button>
                  </CardFooter>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Non-Clinical Staff Section ── */}
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <button
            className="flex items-center gap-2 text-left group"
            onClick={() => setStaffExpanded(e => !e)}
          >
            <Users className="h-5 w-5 text-muted-foreground" />
            <div>
              <h3 className="text-xl font-bold tracking-tight group-hover:text-primary transition-colors">
                Non-Clinical Staff
              </h3>
              <p className="text-muted-foreground text-sm">
                Admin, billing, front desk, and other staff costs.
                {staffMembers && staffMembers.length > 0 && (
                  <span className="ml-2 text-primary font-medium">
                    ({staffMembers.length} member{staffMembers.length !== 1 ? "s" : ""})
                  </span>
                )}
              </p>
            </div>
            {staffExpanded
              ? <ChevronDown className="h-4 w-4 text-muted-foreground ml-2 shrink-0" />
              : <ChevronRight className="h-4 w-4 text-muted-foreground ml-2 shrink-0" />}
          </button>
          <Button onClick={handleCreateStaff} disabled={staffGoalId === null} variant="outline" className="min-h-[44px]">
            <Plus className="h-4 w-4 mr-2" />
            Add Staff Member
          </Button>
        </div>

        {staffGoalId === null && (
          <p className="text-sm text-muted-foreground">Select a compensation team before adding staff.</p>
        )}

        {staffExpanded && (
          <>
            {(!staffMembers || staffMembers.length === 0) ? (
              <Card className="flex flex-col items-center justify-center p-10 text-center">
                <div className="rounded-full bg-muted p-4 mb-4">
                  <Users className="h-7 w-7 text-muted-foreground" />
                </div>
                <h4 className="text-base font-medium">No Staff Members</h4>
                <p className="text-muted-foreground max-w-sm mt-2 mb-4 text-sm">
                  Add office managers, billing coordinators, front desk staff, and other non-clinical team members.
                </p>
                <Button variant="outline" onClick={handleCreateStaff} disabled={staffGoalId === null}>Add Staff Member</Button>
              </Card>
            ) : (
              <>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {staffMembers.map(s => {
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
                      <Card key={s.id} className="flex flex-col">
                        <CardHeader className="flex flex-row items-start justify-between pb-2">
                          <div className="flex-1 min-w-0">
                            <CardTitle className="truncate text-base">{s.label}</CardTitle>
                            <div className="flex gap-2 mt-2">
                              <Badge variant="secondary" className="text-[10px]">{ROLE_LABELS[String(s.roleType)] ?? s.roleType}</Badge>
                              <Badge variant={String(s.classification) === "w2" ? "default" : "outline"} className="uppercase text-[10px]">{s.classification}</Badge>
                            </div>
                          </div>
                          <Button variant="ghost" size="icon" className="h-10 w-10 sm:h-8 sm:w-8 text-destructive hover:bg-destructive/10 ml-2 shrink-0" onClick={() => handleDeleteStaff(s.id)}>
                            <Trash className="h-4 w-4" />
                          </Button>
                        </CardHeader>
                        <CardContent className="flex-1">
                          <div className="grid grid-cols-2 gap-y-3 gap-x-2 text-sm mt-1">
                            <div>
                              <span className="text-muted-foreground block text-xs">Base Salary</span>
                              <span className="font-semibold">{formatCurrency(cost.baseAnnualCost)}</span>
                            </div>
                            <div>
                              <span className="text-muted-foreground block text-xs">Employer Burden</span>
                              <span className="font-semibold text-amber-600">{formatCurrency(cost.employerBurden)}</span>
                            </div>
                            <div className="col-span-2">
                              <span className="text-muted-foreground block text-xs">Total Annual Cost</span>
                              <span className="font-semibold text-primary text-base">{formatCurrency(cost.totalAnnualCost)}</span>
                            </div>
                          </div>
                        </CardContent>
                        <CardFooter className="bg-muted/50 border-t py-3">
                          <Button variant="outline" className="w-full" onClick={() => { setEditStaff(s); setStaffOpen(true); }}>
                            Edit
                          </Button>
                        </CardFooter>
                      </Card>
                    );
                  })}
                </div>
                <div className="flex justify-end">
                  <div className="bg-muted/50 border rounded-lg px-4 py-3 text-sm">
                    <span className="text-muted-foreground">Total Staff Cost (annual): </span>
                    <span className="font-bold text-primary">
                      {formatCurrency(staffMembers.reduce((sum, s) => {
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
                      }, 0))}
                    </span>
                  </div>
                </div>
              </>
            )}
          </>
        )}
      </div>

      {/* ── Clinician Edit Dialog ── */}
      <Dialog open={!!editClinician} onOpenChange={open => { if (!open) setEditClinician(null); }}>
        <DialogContent className="w-[95vw] sm:max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit Clinician Profile</DialogTitle>
          </DialogHeader>
          <div className="space-y-6 py-2">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="sm:col-span-2 space-y-1">
                <Label htmlFor="c-label">Clinician Name / Label</Label>
                <Input id="c-label" value={clinForm.label} onChange={e => setClinField("label", e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="c-role">Role Type</Label>
                <Select value={clinForm.roleType} onValueChange={v => setClinField("roleType", v)}>
                  <SelectTrigger id="c-role"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="associate">Associate</SelectItem>
                    <SelectItem value="contractor">Contractor</SelectItem>
                    <SelectItem value="owner">Owner</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="c-class">Classification</Label>
                <Select value={clinForm.classification} onValueChange={v => setClinField("classification", v)}>
                  <SelectTrigger id="c-class"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="w2">W2 Employee</SelectItem>
                    <SelectItem value="1099">1099 Contractor</SelectItem>
                    <SelectItem value="owner">Owner</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div>
              <h4 className="text-sm font-semibold mb-3 text-muted-foreground uppercase tracking-wider">Productivity</h4>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <NumField label="Session Rate ($)" name="sessionRate" value={clinForm.sessionRate} onChange={setClinField} tooltip="Billed rate per session" />
                <NumField label="Sessions / Week" name="sessionsPerWeek" value={clinForm.sessionsPerWeek} onChange={setClinField} />
                <NumField label="Weeks / Year" name="weeksWorkedPerYear" value={clinForm.weeksWorkedPerYear} onChange={setClinField} />
              </div>
            </div>

            <div>
              <h4 className="text-sm font-semibold mb-3 text-muted-foreground uppercase tracking-wider">Revenue Split</h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <NumField label="Pre-Cap Clinician Split (%)" name="preCapClinicianSplit" value={clinForm.preCapClinicianSplit} onChange={setClinField} step={0.1} />
                <NumField label="Pre-Cap Practice Split (%)" name="preCapPracticeSplit" value={clinForm.preCapPracticeSplit} onChange={setClinField} step={0.1} />
                <div className="sm:col-span-2 flex items-center gap-3">
                  <Switch id="cap-enabled" checked={clinForm.capEnabled} onCheckedChange={v => setClinField("capEnabled", v)} />
                  <Label htmlFor="cap-enabled">Enable revenue cap</Label>
                </div>
                {clinForm.capEnabled && <>
                  <NumField label="Cap Amount ($)" name="capAmount" value={clinForm.capAmount} onChange={setClinField} />
                  <div />
                  <NumField label="Post-Cap Clinician Split (%)" name="postCapClinicianSplit" value={clinForm.postCapClinicianSplit} onChange={setClinField} step={0.1} />
                  <NumField label="Post-Cap Practice Split (%)" name="postCapPracticeSplit" value={clinForm.postCapPracticeSplit} onChange={setClinField} step={0.1} />
                </>}
              </div>
            </div>

            {clinForm.classification === "w2" && (
              <div>
                <h4 className="text-sm font-semibold mb-3 text-muted-foreground uppercase tracking-wider">W2 Employer Burden</h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <NumField label="Employer FICA (%)" name="w2EmployerFicaPct" value={clinForm.w2EmployerFicaPct} onChange={setClinField} step={0.01} tooltip="Federal payroll tax — employer's share of Social Security & Medicare (7.65%)" />
                  <NumField label="FUTA/SUTA (%)" name="futaSutaPct" value={clinForm.futaSutaPct} onChange={setClinField} step={0.01} />
                  <NumField label="Workers' Comp (%)" name="workersCompPct" value={clinForm.workersCompPct} onChange={setClinField} step={0.01} />
                  <NumField label="Other Employer Burden (%)" name="otherEmployerBurdenPct" value={clinForm.otherEmployerBurdenPct} onChange={setClinField} step={0.01} />
                </div>
              </div>
            )}

            {clinMetrics && (
              <div className="rounded-lg bg-muted/50 p-4 border">
                <p className="text-sm font-medium mb-2">Live Preview</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                  <div><span className="text-muted-foreground block text-xs">Annual Production</span><span className="font-semibold">{formatCurrency(clinMetrics.annualProduction)}</span></div>
                  <div><span className="text-muted-foreground block text-xs">Clinician Comp</span><span className="font-semibold text-green-600">{formatCurrency(clinMetrics.clinicianCompensation)}</span></div>
                  <div><span className="text-muted-foreground block text-xs">Employer Obligations (W2)</span><span className="font-semibold text-amber-600">{formatCurrency(clinMetrics.employerObligations)}</span></div>
                  <div><span className="text-muted-foreground block text-xs">Practice Net</span><span className="font-semibold text-primary">{formatCurrency(clinMetrics.practiceNetBeforeOverhead)}</span></div>
                  <div><span className="text-muted-foreground block text-xs">Est. Take-Home (after payroll tax)</span><span className="font-semibold">{formatCurrency(clinMetrics.estimatedCompAfterPayrollTaxes)}</span></div>
                  <div><span className="text-muted-foreground block text-xs">Est. Payroll Tax</span><span className="font-semibold text-amber-600">{formatCurrency(clinMetrics.clinicianPayrollTaxEstimate)}</span></div>
                  {clinForm.capEnabled && <div><span className="text-muted-foreground block text-xs">Sessions to Cap</span><span className="font-semibold">{Math.round(clinMetrics.sessionsToCAP)}</span></div>}
                </div>
              </div>
            )}

            <div className="space-y-1">
              <Label htmlFor="c-notes">Notes</Label>
              <Textarea id="c-notes" value={clinForm.notes} onChange={e => setClinField("notes", e.target.value)} rows={2} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditClinician(null)}>Cancel</Button>
            <Button onClick={handleSaveClinician} disabled={clinSaving}>{clinSaving ? "Saving…" : "Save Changes"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Staff Edit Dialog ── */}
      {staffOpen && editStaff && (
        <StaffMemberDialog
          open={staffOpen}
          title={`Edit ${editStaff.label}`}
          initial={staffToForm(editStaff)}
          onClose={() => { setStaffOpen(false); setEditStaff(null); }}
          onSave={handleSaveStaff}
          saving={staffSaving}
        />
      )}
    </div>
  );
}
