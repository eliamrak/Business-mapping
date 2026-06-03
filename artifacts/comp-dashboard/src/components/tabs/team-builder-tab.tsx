import { useState } from "react";
import {
  useListClinicians, useCreateClinician, useDeleteClinician,
  useUpdateClinician, useDuplicateClinician,
  getListCliniciansQueryKey
} from "@workspace/api-client-react";
import type { Clinician } from "@workspace/api-client-react";
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Plus, Trash, User, Copy } from "lucide-react";
import { calculateClinicianMetrics } from "@/lib/calculations";
import { formatCurrency } from "@/lib/format";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";

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

const defaultForm: ClinicianForm = {
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

export default function TeamBuilderTab() {
  const { data: clinicians, isLoading } = useListClinicians();
  const createClinician = useCreateClinician();
  const updateClinician = useUpdateClinician();
  const deleteClinician = useDeleteClinician();
  const duplicateClinician = useDuplicateClinician();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [editClinician, setEditClinician] = useState<Clinician | null>(null);
  const [form, setForm] = useState<ClinicianForm>(defaultForm);
  const [saving, setSaving] = useState(false);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: getListCliniciansQueryKey() });

  const openEdit = (c: Clinician) => {
    setEditClinician(c);
    setForm(clinicianToForm(c));
  };

  const setField = (name: string, value: unknown) =>
    setForm(f => {
      const update: Partial<typeof f> = { [name]: value };
      const v = Number(value);
      const clamped = Math.min(100, Math.max(0, v));
      if (name === "preCapClinicianSplit")  update.preCapPracticeSplit  = Math.round((100 - clamped) * 10) / 10;
      if (name === "preCapPracticeSplit")   update.preCapClinicianSplit = Math.round((100 - clamped) * 10) / 10;
      if (name === "postCapClinicianSplit") update.postCapPracticeSplit = Math.round((100 - clamped) * 10) / 10;
      if (name === "postCapPracticeSplit")  update.postCapClinicianSplit = Math.round((100 - clamped) * 10) / 10;
      return { ...f, ...update };
    });

  const handleSave = () => {
    if (!editClinician) return;
    setSaving(true);
    updateClinician.mutate({ id: editClinician.id, data: form as never }, {
      onSuccess: () => {
        invalidate(); setEditClinician(null); setSaving(false);
        toast({ title: "Clinician saved", description: `"${form.label}" has been updated.` });
      },
      onError: () => {
        setSaving(false);
        toast({ title: "Save failed", description: "Could not save clinician. Please try again.", variant: "destructive" });
      },
    });
  };

  const handleCreate = () => {
    createClinician.mutate({ data: defaultForm as never }, {
      onSuccess: (c) => {
        invalidate(); openEdit(c);
        toast({ title: "Clinician added", description: "Edit the details below and save." });
      },
      onError: () => toast({ title: "Create failed", description: "Could not add clinician.", variant: "destructive" }),
    });
  };

  const handleDelete = (id: number) => deleteClinician.mutate({ id }, {
    onSuccess: () => { invalidate(); toast({ title: "Clinician deleted" }); },
    onError: () => toast({ title: "Delete failed", variant: "destructive" }),
  });
  const handleDuplicate = (id: number) => duplicateClinician.mutate({ id }, {
    onSuccess: () => { invalidate(); toast({ title: "Clinician duplicated" }); },
    onError: () => toast({ title: "Duplicate failed", variant: "destructive" }),
  });

  if (isLoading) return <div className="p-8 text-muted-foreground">Loading clinicians...</div>;

  const metrics = form ? calculateClinicianMetrics({ ...form }) : null;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Team Builder</h2>
          <p className="text-muted-foreground">Manage clinician profiles and compensation models.</p>
        </div>
        <Button onClick={handleCreate}>
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
          <Button onClick={handleCreate}>Add Clinician</Button>
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
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleDuplicate(c.id)} title="Duplicate">
                      <Copy className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:bg-destructive/10" onClick={() => handleDelete(c.id)}>
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
                  <Button variant="outline" className="w-full" onClick={() => openEdit(c)}>Edit Profile</Button>
                </CardFooter>
              </Card>
            );
          })}
        </div>
      )}

      <Dialog open={!!editClinician} onOpenChange={open => { if (!open) setEditClinician(null); }}>
        <DialogContent className="w-[95vw] sm:max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit Clinician Profile</DialogTitle>
          </DialogHeader>
          <div className="space-y-6 py-2">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="sm:col-span-2 space-y-1">
                <Label htmlFor="c-label">Clinician Name / Label</Label>
                <Input id="c-label" value={form.label} onChange={e => setField("label", e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="c-role">Role Type</Label>
                <Select value={form.roleType} onValueChange={v => setField("roleType", v)}>
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
                <Select value={form.classification} onValueChange={v => setField("classification", v)}>
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
                <NumField label="Session Rate ($)" name="sessionRate" value={form.sessionRate} onChange={setField} tooltip="Billed rate per session" />
                <NumField label="Sessions / Week" name="sessionsPerWeek" value={form.sessionsPerWeek} onChange={setField} />
                <NumField label="Weeks / Year" name="weeksWorkedPerYear" value={form.weeksWorkedPerYear} onChange={setField} />
              </div>
            </div>

            <div>
              <h4 className="text-sm font-semibold mb-3 text-muted-foreground uppercase tracking-wider">Revenue Split</h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <NumField label="Pre-Cap Clinician Split (%)" name="preCapClinicianSplit" value={form.preCapClinicianSplit} onChange={setField} step={0.1} tooltip="Clinician's share of each session before reaching the cap" />
                <NumField label="Pre-Cap Practice Split (%)" name="preCapPracticeSplit" value={form.preCapPracticeSplit} onChange={setField} step={0.1} />
                <div className="sm:col-span-2 flex items-center gap-3">
                  <Switch id="cap-enabled" checked={form.capEnabled} onCheckedChange={v => setField("capEnabled", v)} />
                  <Label htmlFor="cap-enabled">Enable revenue cap</Label>
                </div>
                {form.capEnabled && <>
                  <NumField label="Cap Amount ($)" name="capAmount" value={form.capAmount} onChange={setField} tooltip="Practice revenue target that triggers the split change" />
                  <div />
                  <NumField label="Post-Cap Clinician Split (%)" name="postCapClinicianSplit" value={form.postCapClinicianSplit} onChange={setField} step={0.1} tooltip="Clinician's share after the practice hits the cap" />
                  <NumField label="Post-Cap Practice Split (%)" name="postCapPracticeSplit" value={form.postCapPracticeSplit} onChange={setField} step={0.1} />
                </>}
              </div>
            </div>

            {form.classification === "w2" && (
              <div>
                <h4 className="text-sm font-semibold mb-3 text-muted-foreground uppercase tracking-wider">W2 Employer Burden</h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <NumField label="Employer FICA (%)" name="w2EmployerFicaPct" value={form.w2EmployerFicaPct} onChange={setField} step={0.01} tooltip="Federal payroll tax — employer's share of Social Security & Medicare (7.65%)" />
                  <NumField label="FUTA/SUTA (%)" name="futaSutaPct" value={form.futaSutaPct} onChange={setField} step={0.01} tooltip="Federal and state unemployment insurance taxes" />
                  <NumField label="Workers' Comp (%)" name="workersCompPct" value={form.workersCompPct} onChange={setField} step={0.01} tooltip="Workers' compensation insurance premium rate" />
                  <NumField label="Other Employer Burden (%)" name="otherEmployerBurdenPct" value={form.otherEmployerBurdenPct} onChange={setField} step={0.01} tooltip="Health insurance, retirement match, or other benefits" />
                </div>
              </div>
            )}

            {metrics && (
              <div className="rounded-lg bg-muted/50 p-4 border">
                <p className="text-sm font-medium mb-2">Live Preview</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                  <div><span className="text-muted-foreground block text-xs">Annual Production</span><span className="font-semibold">{formatCurrency(metrics.annualProduction)}</span></div>
                  <div><span className="text-muted-foreground block text-xs">Clinician Comp</span><span className="font-semibold text-green-600">{formatCurrency(metrics.clinicianCompensation)}</span></div>
                  <div><span className="text-muted-foreground block text-xs">Employer Obligations (W2)</span><span className="font-semibold text-amber-600">{formatCurrency(metrics.employerObligations)}</span></div>
                  <div><span className="text-muted-foreground block text-xs">Practice Net</span><span className="font-semibold text-primary">{formatCurrency(metrics.practiceNetBeforeOverhead)}</span></div>
                  <div><span className="text-muted-foreground block text-xs">Est. Take-Home (after payroll tax)</span><span className="font-semibold">{formatCurrency(metrics.estimatedCompAfterPayrollTaxes)}</span></div>
                  <div><span className="text-muted-foreground block text-xs">Est. Payroll Tax</span><span className="font-semibold text-amber-600">{formatCurrency(metrics.clinicianPayrollTaxEstimate)}</span></div>
                  {form.capEnabled && <div><span className="text-muted-foreground block text-xs">Sessions to Cap</span><span className="font-semibold">{Math.round(metrics.sessionsToCAP)}</span></div>}
                </div>
              </div>
            )}

            <div className="space-y-1">
              <Label htmlFor="c-notes">Notes</Label>
              <Textarea id="c-notes" value={form.notes} onChange={e => setField("notes", e.target.value)} rows={2} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditClinician(null)}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving}>{saving ? "Saving…" : "Save Changes"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
