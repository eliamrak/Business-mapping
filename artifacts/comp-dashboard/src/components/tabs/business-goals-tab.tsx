import { useState } from "react";
import {
  useListBusinessGoals, useCreateBusinessGoal, useDeleteBusinessGoal,
  useUpdateBusinessGoal, useDuplicateBusinessGoal,
  getListBusinessGoalsQueryKey
} from "@workspace/api-client-react";
import type { BusinessGoal } from "@workspace/api-client-react";
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Plus, Trash, Copy } from "lucide-react";
import type { BusinessGoal as BG } from "@workspace/api-client-react";
import { calculateBusinessGoalOutputs } from "@/lib/calculations";
import { formatCurrency } from "@/lib/format";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";

type GoalForm = {
  name: string;
  timeHorizon: string;
  ownerPayGoal: number;
  secondOwnerPayGoal: number;
  annualOverheadGoal: number;
  businessProfitGoal: number;
  buildingFundGoal: number;
  emergencyReserveGoal: number;
  growthFundGoal: number;
  desiredCliniciansCount: number;
  desiredOwnerClinicalCaseload: number;
  notes: string;
};

function goalToForm(g: BusinessGoal): GoalForm {
  return {
    name: g.name,
    timeHorizon: g.timeHorizon,
    ownerPayGoal: g.ownerPayGoal,
    secondOwnerPayGoal: g.secondOwnerPayGoal,
    annualOverheadGoal: g.annualOverheadGoal,
    businessProfitGoal: g.businessProfitGoal,
    buildingFundGoal: g.buildingFundGoal,
    emergencyReserveGoal: g.emergencyReserveGoal,
    growthFundGoal: g.growthFundGoal,
    desiredCliniciansCount: g.desiredCliniciansCount,
    desiredOwnerClinicalCaseload: g.desiredOwnerClinicalCaseload,
    notes: g.notes ?? "",
  };
}

const defaultForm: GoalForm = {
  name: "New Business Goal",
  timeHorizon: "1year",
  ownerPayGoal: 100000,
  secondOwnerPayGoal: 0,
  annualOverheadGoal: 50000,
  businessProfitGoal: 20000,
  buildingFundGoal: 0,
  emergencyReserveGoal: 10000,
  growthFundGoal: 0,
  desiredCliniciansCount: 5,
  desiredOwnerClinicalCaseload: 10,
  notes: "",
};

function NumInput({ label, name, value, onChange, tooltip }: {
  label: string; name: string; value: number;
  onChange: (n: string, v: number) => void; tooltip?: string;
}) {
  return (
    <div className="space-y-1">
      <Label htmlFor={name} title={tooltip}>{label}</Label>
      <Input
        id={name}
        type="number"
        min={0}
        value={value}
        onChange={e => onChange(name, Number(e.target.value))}
      />
    </div>
  );
}

export default function BusinessGoalsTab() {
  const { data: goals, isLoading } = useListBusinessGoals();
  const createGoal = useCreateBusinessGoal();
  const updateGoal = useUpdateBusinessGoal();
  const deleteGoal = useDeleteBusinessGoal();
  const duplicateGoal = useDuplicateBusinessGoal();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [editGoal, setEditGoal] = useState<BusinessGoal | null>(null);
  const [form, setForm] = useState<GoalForm>(defaultForm);
  const [saving, setSaving] = useState(false);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: getListBusinessGoalsQueryKey() });

  const openEdit = (g: BusinessGoal) => {
    setEditGoal(g);
    setForm(goalToForm(g));
  };

  const setField = (name: string, value: unknown) =>
    setForm(f => ({ ...f, [name]: value }));

  const handleSave = () => {
    if (!editGoal) return;
    setSaving(true);
    updateGoal.mutate({ id: editGoal.id, data: form as never }, {
      onSuccess: () => {
        invalidate(); setEditGoal(null); setSaving(false);
        toast({ title: "Goal saved", description: `"${form.name}" has been updated.` });
      },
      onError: () => {
        setSaving(false);
        toast({ title: "Save failed", description: "Could not save goal. Please try again.", variant: "destructive" });
      },
    });
  };

  const handleCreate = () => {
    createGoal.mutate({ data: defaultForm as never }, {
      onSuccess: (newGoal) => {
        invalidate(); openEdit(newGoal);
        toast({ title: "Goal created", description: "Edit the details below and save." });
      },
      onError: () => toast({ title: "Create failed", description: "Could not create goal.", variant: "destructive" }),
    });
  };

  const handleDelete = (id: number) => {
    deleteGoal.mutate({ id }, {
      onSuccess: () => { invalidate(); toast({ title: "Goal deleted" }); },
      onError: () => toast({ title: "Delete failed", variant: "destructive" }),
    });
  };

  const handleDuplicate = (id: number) => {
    duplicateGoal.mutate({ id }, {
      onSuccess: () => { invalidate(); toast({ title: "Goal duplicated" }); },
      onError: () => toast({ title: "Duplicate failed", variant: "destructive" }),
    });
  };

  if (isLoading) return <div className="p-8 text-muted-foreground">Loading goals...</div>;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Business Goals</h2>
          <p className="text-muted-foreground">Define and compare financial targets for the practice.</p>
        </div>
        <Button onClick={handleCreate} className="min-h-[44px]">
          <Plus className="h-4 w-4 mr-2" />
          Create Goal
        </Button>
      </div>

      {(!goals || goals.length === 0) ? (
        <Card className="flex flex-col items-center justify-center p-12 text-center">
          <div className="rounded-full bg-primary/10 p-4 mb-4">
            <Plus className="h-8 w-8 text-primary" />
          </div>
          <h3 className="text-lg font-medium">No Business Goals</h3>
          <p className="text-muted-foreground max-w-sm mt-2 mb-4">
            Create your first business goal to start planning your compensation strategy.
          </p>
          <Button onClick={handleCreate}>Create Business Goal</Button>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {goals.map(goal => {
            const outputs = calculateBusinessGoalOutputs(goal);
            return (
              <Card key={goal.id} className="flex flex-col">
                <CardHeader className="flex flex-row items-start justify-between pb-2">
                  <div className="space-y-1 flex-1 min-w-0">
                    <CardTitle className="truncate">{goal.name}</CardTitle>
                    <p className="text-xs text-muted-foreground font-mono">{goal.timeHorizon} horizon</p>
                  </div>
                  <div className="flex gap-1 ml-2 shrink-0">
                    <Button variant="ghost" size="icon" className="h-10 w-10 sm:h-8 sm:w-8" onClick={() => handleDuplicate(goal.id)} title="Duplicate">
                      <Copy className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-10 w-10 sm:h-8 sm:w-8 text-destructive hover:bg-destructive/10" onClick={() => handleDelete(goal.id)} title="Delete">
                      <Trash className="h-4 w-4" />
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="flex-1 space-y-4">
                  <div className="grid grid-cols-2 gap-4 text-sm mt-2">
                    <div>
                      <span className="text-muted-foreground block text-xs">Annual Business Need</span>
                      <span className="font-semibold block">{formatCurrency(outputs.totalAnnualBusinessNeed)}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground block text-xs">Required Net / Clinician</span>
                      <span className="font-semibold block">{formatCurrency(outputs.requiredNetPerClinician)}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground block text-xs">Desired Clinicians</span>
                      <span className="font-semibold block">{goal.desiredCliniciansCount}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground block text-xs">Owner Pay Goal</span>
                      <span className="font-semibold block">{formatCurrency(goal.ownerPayGoal)}</span>
                    </div>
                  </div>
                </CardContent>
                <CardFooter className="bg-muted/50 border-t py-3">
                  <Button variant="outline" className="w-full" onClick={() => openEdit(goal)}>Edit Details</Button>
                </CardFooter>
              </Card>
            );
          })}
        </div>
      )}

      <Dialog open={!!editGoal} onOpenChange={open => { if (!open) setEditGoal(null); }}>
        <DialogContent className="w-[95vw] sm:max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit Business Goal</DialogTitle>
          </DialogHeader>
          <div className="space-y-6 py-2">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="sm:col-span-2 space-y-1">
                <Label htmlFor="goal-name">Goal Name</Label>
                <Input id="goal-name" value={form.name} onChange={e => setField("name", e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="time-horizon">Time Horizon</Label>
                <Select value={form.timeHorizon} onValueChange={v => setField("timeHorizon", v)}>
                  <SelectTrigger id="time-horizon"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1year">1 Year</SelectItem>
                    <SelectItem value="3year">3 Years</SelectItem>
                    <SelectItem value="5year">5 Years</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <NumInput label="Desired Clinicians" name="desiredCliniciansCount" value={form.desiredCliniciansCount} onChange={setField} />
            </div>

            <div>
              <h4 className="text-sm font-semibold mb-3 text-muted-foreground uppercase tracking-wider">Owner Compensation</h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <NumInput label="Owner Pay Goal ($)" name="ownerPayGoal" value={form.ownerPayGoal} onChange={setField} tooltip="Annual compensation goal for primary owner" />
                <NumInput label="Second Owner Pay Goal ($)" name="secondOwnerPayGoal" value={form.secondOwnerPayGoal} onChange={setField} tooltip="Annual compensation goal for second owner (0 if single owner)" />
                <NumInput label="Desired Owner Clinical Caseload" name="desiredOwnerClinicalCaseload" value={form.desiredOwnerClinicalCaseload} onChange={setField} tooltip="How many clinical sessions per week the owner plans to see" />
              </div>
            </div>

            <div>
              <h4 className="text-sm font-semibold mb-3 text-muted-foreground uppercase tracking-wider">Practice Financials</h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <NumInput label="Annual Overhead Goal ($)" name="annualOverheadGoal" value={form.annualOverheadGoal} onChange={setField} tooltip="Rent, utilities, software, admin — all non-compensation overhead" />
                <NumInput label="Business Profit Goal ($)" name="businessProfitGoal" value={form.businessProfitGoal} onChange={setField} tooltip="Net profit retained in the business after all expenses" />
                <NumInput label="Building Fund Goal ($)" name="buildingFundGoal" value={form.buildingFundGoal} onChange={setField} tooltip="Savings earmarked for purchasing or renovating a building" />
                <NumInput label="Emergency Reserve Goal ($)" name="emergencyReserveGoal" value={form.emergencyReserveGoal} onChange={setField} tooltip="Operating reserve to cover 3–6 months of expenses" />
                <NumInput label="Growth Fund Goal ($)" name="growthFundGoal" value={form.growthFundGoal} onChange={setField} tooltip="Capital set aside for hiring, marketing, or expansion" />
              </div>
            </div>

            <div className="space-y-1">
              <Label htmlFor="goal-notes">Notes</Label>
              <Textarea id="goal-notes" value={form.notes} onChange={e => setField("notes", e.target.value)} rows={3} />
            </div>

            <div className="rounded-lg bg-muted/50 p-4 border">
              <p className="text-sm font-medium mb-2">Calculated Totals</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                {(() => {
                  const o = calculateBusinessGoalOutputs(form as Partial<BG>);
                  return <>
                    <div>
                      <span className="text-muted-foreground block text-xs">Total Annual Business Need</span>
                      <span className="font-semibold">{formatCurrency(o.totalAnnualBusinessNeed)}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground block text-xs">Required Net / Clinician / Year</span>
                      <span className="font-semibold">{formatCurrency(o.requiredNetPerClinician)}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground block text-xs">Required Monthly Business Need</span>
                      <span className="font-semibold">{formatCurrency(o.requiredMonthlyBusinessNeed)}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground block text-xs">Required Monthly Net / Clinician</span>
                      <span className="font-semibold">{formatCurrency(o.requiredMonthlyNetPerClinician)}</span>
                    </div>
                  </>;
                })()}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditGoal(null)}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving}>{saving ? "Saving…" : "Save Changes"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
