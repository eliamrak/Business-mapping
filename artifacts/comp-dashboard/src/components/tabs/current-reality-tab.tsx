import { useState, useEffect } from "react";
import { useGetCurrentReality, useUpsertCurrentReality, useListBusinessGoals, getGetCurrentRealityQueryKey } from "@workspace/api-client-react";
import type { CurrentReality } from "@workspace/api-client-react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Info, Pencil } from "lucide-react";
import { formatCurrency, formatPercent } from "@/lib/format";
import { calculateCurrentRealityGap } from "@/lib/calculations";
import { useQueryClient } from "@tanstack/react-query";

type RealityForm = {
  currentOwnerPay: number;
  currentSecondOwnerPay: number;
  currentAnnualOverhead: number;
  currentBusinessProfit: number;
  currentCashReserve: number;
  currentBuildingFund: number;
  currentCliniciansCount: number;
  currentAvgSessionRate: number;
  currentAvgSessionsPerWeek: number;
  currentAvgWeeksWorkedPerYear: number;
};

const emptyForm: RealityForm = {
  currentOwnerPay: 0,
  currentSecondOwnerPay: 0,
  currentAnnualOverhead: 0,
  currentBusinessProfit: 0,
  currentCashReserve: 0,
  currentBuildingFund: 0,
  currentCliniciansCount: 1,
  currentAvgSessionRate: 150,
  currentAvgSessionsPerWeek: 15,
  currentAvgWeeksWorkedPerYear: 48,
};

function realityToForm(r: CurrentReality): RealityForm {
  return {
    currentOwnerPay: r.currentOwnerPay,
    currentSecondOwnerPay: r.currentSecondOwnerPay,
    currentAnnualOverhead: r.currentAnnualOverhead,
    currentBusinessProfit: r.currentBusinessProfit,
    currentCashReserve: r.currentCashReserve,
    currentBuildingFund: r.currentBuildingFund,
    currentCliniciansCount: r.currentCliniciansCount,
    currentAvgSessionRate: r.currentAvgSessionRate,
    currentAvgSessionsPerWeek: r.currentAvgSessionsPerWeek,
    currentAvgWeeksWorkedPerYear: r.currentAvgWeeksWorkedPerYear,
  };
}

function NumField({ label, name, value, onChange, tooltip }: {
  label: string; name: string; value: number;
  onChange: (n: string, v: number) => void; tooltip?: string;
}) {
  return (
    <div className="space-y-1">
      <Label htmlFor={name} title={tooltip}>{label}</Label>
      <Input id={name} type="number" min={0} value={value}
        onChange={e => onChange(name, Number(e.target.value))} />
    </div>
  );
}

export default function CurrentRealityTab() {
  const { data: currentReality, isLoading: isLoadingReality } = useGetCurrentReality();
  const { data: goals, isLoading: isLoadingGoals } = useListBusinessGoals();
  const upsertReality = useUpsertCurrentReality();
  const queryClient = useQueryClient();

  const [selectedGoalId, setSelectedGoalId] = useState<string>("");
  const [editOpen, setEditOpen] = useState(false);
  const [form, setForm] = useState<RealityForm>(emptyForm);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (currentReality) setForm(realityToForm(currentReality));
  }, [currentReality]);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: getGetCurrentRealityQueryKey() });

  const setField = (name: string, value: number) => setForm(f => ({ ...f, [name]: value }));

  const handleSave = () => {
    setSaving(true);
    upsertReality.mutate({ data: form as never }, {
      onSuccess: () => { invalidate(); setEditOpen(false); setSaving(false); },
      onError: () => setSaving(false),
    });
  };

  const handleInitialize = () => {
    upsertReality.mutate({ data: emptyForm as never }, {
      onSuccess: () => { invalidate(); setEditOpen(true); },
    });
  };

  if (isLoadingReality || isLoadingGoals) return <div className="p-8 text-muted-foreground">Loading...</div>;

  const selectedGoal = goals?.find(g => g.id.toString() === selectedGoalId);
  const gapAnalysis = currentReality ? calculateCurrentRealityGap(currentReality, selectedGoal) : null;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Current Reality</h2>
          <p className="text-muted-foreground">Log your current practice metrics and compare them against goals.</p>
        </div>
        {currentReality && (
          <Button onClick={() => { setForm(realityToForm(currentReality)); setEditOpen(true); }}>
            <Pencil className="h-4 w-4 mr-2" />
            Edit Metrics
          </Button>
        )}
      </div>

      {!currentReality ? (
        <Card className="flex flex-col items-center justify-center p-12 text-center">
          <h3 className="text-lg font-medium">No Current Reality Profile</h3>
          <p className="text-muted-foreground max-w-sm mt-2 mb-4">
            Set up your current practice metrics to establish a baseline.
          </p>
          <Button onClick={handleInitialize}>Initialize Current Reality</Button>
        </Card>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Practice Baseline</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div><span className="text-muted-foreground block text-xs">Current Clinicians</span><span className="font-semibold">{currentReality.currentCliniciansCount}</span></div>
                <div><span className="text-muted-foreground block text-xs">Avg Session Rate</span><span className="font-semibold">{formatCurrency(currentReality.currentAvgSessionRate)}</span></div>
                <div><span className="text-muted-foreground block text-xs">Sessions / Week</span><span className="font-semibold">{currentReality.currentAvgSessionsPerWeek}</span></div>
                <div><span className="text-muted-foreground block text-xs">Weeks / Year</span><span className="font-semibold">{currentReality.currentAvgWeeksWorkedPerYear}</span></div>
                <div><span className="text-muted-foreground block text-xs">Owner Pay (Current)</span><span className="font-semibold">{formatCurrency(currentReality.currentOwnerPay)}</span></div>
                <div><span className="text-muted-foreground block text-xs">2nd Owner Pay</span><span className="font-semibold">{formatCurrency(currentReality.currentSecondOwnerPay)}</span></div>
                <div><span className="text-muted-foreground block text-xs">Annual Overhead</span><span className="font-semibold">{formatCurrency(currentReality.currentAnnualOverhead)}</span></div>
                <div><span className="text-muted-foreground block text-xs">Business Profit</span><span className="font-semibold">{formatCurrency(currentReality.currentBusinessProfit)}</span></div>
                <div><span className="text-muted-foreground block text-xs">Cash Reserve</span><span className="font-semibold">{formatCurrency(currentReality.currentCashReserve)}</span></div>
                <div><span className="text-muted-foreground block text-xs">Building Fund</span><span className="font-semibold">{formatCurrency(currentReality.currentBuildingFund)}</span></div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Goal Comparison</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {goals && goals.length > 0 ? (
                <div className="space-y-4">
                  <Select value={selectedGoalId} onValueChange={setSelectedGoalId}>
                    <SelectTrigger><SelectValue placeholder="Select a goal to compare" /></SelectTrigger>
                    <SelectContent>
                      {goals.map(g => (
                        <SelectItem key={g.id} value={g.id.toString()}>{g.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  {selectedGoal && gapAnalysis && (
                    <div className="space-y-3 pt-4 border-t">
                      <div className="grid grid-cols-2 gap-3 text-sm">
                        <div><span className="text-muted-foreground block text-xs">Current Production Est.</span><span className="font-semibold">{formatCurrency(gapAnalysis.currentAnnualProductionEstimate)}</span></div>
                        <div><span className="text-muted-foreground block text-xs">Current Net / Clinician</span><span className="font-semibold">{formatCurrency(gapAnalysis.currentNetPerClinicianEstimate)}</span></div>
                        <div>
                          <span className="text-muted-foreground block text-xs">Gap to Goal</span>
                          <span className={`font-semibold ${gapAnalysis.gapToGoal > 0 ? "text-destructive" : "text-green-600"}`}>
                            {gapAnalysis.gapToGoal > 0 ? "-" : "+"}{formatCurrency(Math.abs(gapAnalysis.gapToGoal))}
                          </span>
                        </div>
                        <div>
                          <span className="text-muted-foreground block text-xs">Goal Achieved</span>
                          <span className={`font-semibold ${gapAnalysis.percentAchieved >= 100 ? "text-green-600" : "text-amber-600"}`}>
                            {formatPercent(gapAnalysis.percentAchieved)}
                          </span>
                        </div>
                      </div>
                      <div className="mt-2 rounded bg-muted p-3 text-xs text-muted-foreground">
                        <strong>Gap</strong> = Goal's total annual business need minus your current tracked actuals (owner pay + overhead + profit + building fund + cash reserve).
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <Alert>
                  <Info className="h-4 w-4" />
                  <AlertTitle>No goals found</AlertTitle>
                  <AlertDescription>Create a business goal first to compare against your current reality.</AlertDescription>
                </Alert>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit Current Reality Metrics</DialogTitle>
          </DialogHeader>
          <div className="space-y-6 py-2">
            <div>
              <h4 className="text-sm font-semibold mb-3 text-muted-foreground uppercase tracking-wider">Team Productivity</h4>
              <div className="grid grid-cols-2 gap-4">
                <NumField label="Number of Clinicians" name="currentCliniciansCount" value={form.currentCliniciansCount} onChange={setField} />
                <NumField label="Avg Session Rate ($)" name="currentAvgSessionRate" value={form.currentAvgSessionRate} onChange={setField} />
                <NumField label="Avg Sessions / Week" name="currentAvgSessionsPerWeek" value={form.currentAvgSessionsPerWeek} onChange={setField} />
                <NumField label="Avg Weeks / Year" name="currentAvgWeeksWorkedPerYear" value={form.currentAvgWeeksWorkedPerYear} onChange={setField} />
              </div>
            </div>
            <div>
              <h4 className="text-sm font-semibold mb-3 text-muted-foreground uppercase tracking-wider">Financial Actuals</h4>
              <div className="grid grid-cols-2 gap-4">
                <NumField label="Owner Pay ($)" name="currentOwnerPay" value={form.currentOwnerPay} onChange={setField} />
                <NumField label="2nd Owner Pay ($)" name="currentSecondOwnerPay" value={form.currentSecondOwnerPay} onChange={setField} />
                <NumField label="Annual Overhead ($)" name="currentAnnualOverhead" value={form.currentAnnualOverhead} onChange={setField} />
                <NumField label="Business Profit ($)" name="currentBusinessProfit" value={form.currentBusinessProfit} onChange={setField} />
                <NumField label="Cash Reserve ($)" name="currentCashReserve" value={form.currentCashReserve} onChange={setField} />
                <NumField label="Building Fund ($)" name="currentBuildingFund" value={form.currentBuildingFund} onChange={setField} />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving}>{saving ? "Saving…" : "Save Changes"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
