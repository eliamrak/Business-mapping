import { useState } from "react";
import {
  useListScenarios, useCreateScenario, useDeleteScenario,
  useUpdateScenario, useDuplicateScenario,
  useGetScenario, useAddScenarioClinician, useUpdateScenarioClinician, useRemoveScenarioClinician,
  useDuplicateScenarioClinician,
  useListBusinessGoals, useListClinicians,
  getListScenariosQueryKey, getGetScenarioQueryKey
} from "@workspace/api-client-react";
import type { Scenario, ScenarioClinician, Clinician } from "@workspace/api-client-react";
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
import { Plus, Trash, Copy, ChevronLeft, GitMerge, UserPlus, Pencil } from "lucide-react";
import { calculateClinicianMetrics, calculateBusinessGoalOutputs } from "@/lib/calculations";
import { formatCurrency } from "@/lib/format";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";

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
      <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{title}</DialogTitle></DialogHeader>
        <div className="space-y-5 py-2">
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2 space-y-1">
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
            <div className="grid grid-cols-3 gap-3">
              <NumField label="Session Rate ($)" name="sessionRate" value={form.sessionRate} onChange={setField} />
              <NumField label="Sessions/Wk" name="sessionsPerWeek" value={form.sessionsPerWeek} onChange={setField} />
              <NumField label="Weeks/Yr" name="weeksWorkedPerYear" value={form.weeksWorkedPerYear} onChange={setField} />
            </div>
          </div>
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Revenue Split</p>
            <div className="grid grid-cols-2 gap-3">
              <NumField label="Pre-Cap Clinician %" name="preCapClinicianSplit" value={form.preCapClinicianSplit} onChange={setField} step={0.1} />
              <NumField label="Pre-Cap Practice %" name="preCapPracticeSplit" value={form.preCapPracticeSplit} onChange={setField} step={0.1} />
              <div className="col-span-2 flex items-center gap-3">
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
              <div className="grid grid-cols-2 gap-3">
                <NumField label="Employer FICA (%)" name="w2EmployerFicaPct" value={form.w2EmployerFicaPct} onChange={setField} step={0.01} />
                <NumField label="FUTA/SUTA (%)" name="futaSutaPct" value={form.futaSutaPct} onChange={setField} step={0.01} />
                <NumField label="Workers' Comp (%)" name="workersCompPct" value={form.workersCompPct} onChange={setField} step={0.01} />
                <NumField label="Other Burden (%)" name="otherEmployerBurdenPct" value={form.otherEmployerBurdenPct} onChange={setField} step={0.01} />
              </div>
            </div>
          )}
          <div className="rounded-lg bg-muted/50 p-3 border text-sm">
            <p className="text-xs font-medium mb-2">Live Preview</p>
            <div className="grid grid-cols-2 gap-2">
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
  const { data: goals } = useListBusinessGoals();
  const addClinician = useAddScenarioClinician();
  const updateClinician = useUpdateScenarioClinician();
  const removeClinician = useRemoveScenarioClinician();
  const duplicateClinician = useDuplicateScenarioClinician();
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

  const clinicians = scenario.clinicians ?? [];
  const totalProduction = clinicians.reduce((sum, c) => sum + calculateClinicianMetrics(c).annualProduction, 0);
  const totalComp = clinicians.reduce((sum, c) => sum + calculateClinicianMetrics(c).clinicianCompensation, 0);
  const totalBurden = clinicians.reduce((sum, c) => sum + calculateClinicianMetrics(c).employerObligations, 0);
  const totalPracticeNet = clinicians.reduce((sum, c) => sum + calculateClinicianMetrics(c).practiceNetBeforeOverhead, 0);

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
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={onBack}><ChevronLeft className="h-4 w-4 mr-1" />Back</Button>
        <div className="flex-1">
          <h2 className="text-2xl font-bold tracking-tight">{scenario.name}</h2>
          {scenario.notes && <p className="text-muted-foreground text-sm">{scenario.notes}</p>}
        </div>
        <Button variant="outline" size="sm" onClick={openEditScenario}>
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
          <span className="text-muted-foreground text-xs block">Clinicians</span>
          <span className="text-xl font-bold">{clinicians.length}</span>
          {goalStatus && (
            <Badge className="mt-1 text-[10px]"
              style={{
                backgroundColor: goalStatus === "green" ? "#16a34a" : goalStatus === "yellow" ? "#d97706" : "#dc2626",
                color: "white"
              }}>
              {goalStatus === "green" ? "On Track" : goalStatus === "yellow" ? "Near Goal" : "Below Goal"}
            </Badge>
          )}
        </CardContent></Card>
      </div>

      {linkedGoal && goalOutputs && (
        <div className={`rounded-lg border p-3 text-sm flex items-center gap-3 ${
          goalStatus === "green" ? "border-green-500 bg-green-50"
          : goalStatus === "yellow" ? "border-amber-400 bg-amber-50"
          : "border-red-400 bg-red-50"
        }`}>
          <div className={`h-2 w-2 rounded-full ${
            goalStatus === "green" ? "bg-green-500"
            : goalStatus === "yellow" ? "bg-amber-500"
            : "bg-red-500"
          }`} />
          <span className="font-medium">Goal: {linkedGoal.name}</span>
          <span className="text-muted-foreground">—</span>
          <span>Need {formatCurrency(goalOutputs.totalAnnualBusinessNeed)}, have {formatCurrency(totalPracticeNet)}</span>
          {goalStatus !== "green" && (
            <span className={`font-semibold ml-auto ${goalStatus === "yellow" ? "text-amber-600" : "text-destructive"}`}>
              {formatCurrency(goalOutputs.totalAnnualBusinessNeed - totalPracticeNet)} gap
              {goalPct !== null && ` (${Math.round(goalPct * 100)}%)`}
            </span>
          )}
        </div>
      )}

      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">Clinicians in this Scenario</h3>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setAddOpen(true)}>
            <UserPlus className="h-4 w-4 mr-1" />Import from Team
          </Button>
          <Button size="sm" onClick={handleAddBlank}>
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
                  <div className="flex items-start gap-4">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-2">
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
                    <div className="flex gap-1">
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setEditClx(c)} title="Edit">
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleDuplicateClx(c.id)} title="Duplicate">
                        <Copy className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:bg-destructive/10" onClick={() => handleRemoveClx(c.id)} title="Remove">
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

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="max-w-lg">
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
        <DialogContent className="max-w-md">
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
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Scenario Builder</h2>
          <p className="text-muted-foreground">Create different practice configurations to compare.</p>
        </div>
        <Button onClick={handleCreate}>
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
                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleDuplicate(s.id)} title="Duplicate">
                    <Copy className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:bg-destructive/10" onClick={() => handleDelete(s.id)}>
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
