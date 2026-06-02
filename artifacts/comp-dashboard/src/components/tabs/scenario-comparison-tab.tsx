import { useState } from "react";
import { useListScenarios, useGetScenario, useListBusinessGoals, getGetScenarioQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { calculateClinicianMetrics, calculateBusinessGoalOutputs } from "@/lib/calculations";
import { formatCurrency, formatPercent } from "@/lib/format";
import { GitCompare } from "lucide-react";

function useScenarioMetrics(id: number | null) {
  const { data, isLoading } = useGetScenario(id ?? 0, {
    query: { queryKey: getGetScenarioQueryKey(id ?? 0), enabled: id !== null && id > 0 }
  });

  if (!data || !id) return { data: null, isLoading, metrics: null };

  const clinicians = data.clinicians ?? [];
  const totalProduction = clinicians.reduce((s, c) => s + calculateClinicianMetrics(c).annualProduction, 0);
  const totalComp = clinicians.reduce((s, c) => s + calculateClinicianMetrics(c).clinicianCompensation, 0);
  const totalBurden = clinicians.reduce((s, c) => s + calculateClinicianMetrics(c).employerObligations, 0);
  const totalPracticeNet = clinicians.reduce((s, c) => s + calculateClinicianMetrics(c).practiceNetBeforeOverhead, 0);
  const avgComp = clinicians.length > 0 ? totalComp / clinicians.length : 0;
  const w2Count = clinicians.filter(c => String(c.classification) === "w2").length;
  const c1099Count = clinicians.length - w2Count;

  return {
    data,
    isLoading,
    metrics: {
      totalProduction,
      totalComp,
      totalBurden,
      totalCost: totalComp + totalBurden,
      totalPracticeNet,
      avgComp,
      clinicianCount: clinicians.length,
      w2Count,
      c1099Count,
    }
  };
}

function MetricRow({ label, aVal, bVal, higherIsBetter = true, format = "currency" }: {
  label: string;
  aVal: number; bVal: number;
  higherIsBetter?: boolean;
  format?: "currency" | "number" | "percent";
}) {
  const fmt = (v: number) => format === "currency" ? formatCurrency(v) : format === "percent" ? formatPercent(v) : v.toFixed(0);
  const aBetter = higherIsBetter ? aVal >= bVal : aVal <= bVal;
  const bBetter = higherIsBetter ? bVal >= aVal : bVal <= aVal;
  const tied = aVal === bVal;

  return (
    <div className="grid grid-cols-3 gap-2 py-2 border-b last:border-0 items-center text-sm">
      <span className="text-muted-foreground text-xs">{label}</span>
      <span className={`font-semibold text-center ${!tied && aBetter ? "text-green-600" : ""}`}>
        {fmt(aVal)}
        {!tied && aBetter && <span className="ml-1 text-green-600 text-xs">✓</span>}
      </span>
      <span className={`font-semibold text-center ${!tied && bBetter ? "text-green-600" : ""}`}>
        {fmt(bVal)}
        {!tied && bBetter && <span className="ml-1 text-green-600 text-xs">✓</span>}
      </span>
    </div>
  );
}

export default function ScenarioComparisonTab() {
  const { data: scenarios } = useListScenarios();
  const { data: goals } = useListBusinessGoals();

  const [idA, setIdA] = useState<number | null>(null);
  const [idB, setIdB] = useState<number | null>(null);

  const a = useScenarioMetrics(idA);
  const b = useScenarioMetrics(idB);

  const goalA = goals?.find(g => a.data?.businessGoalId === g.id);
  const goalB = goals?.find(g => b.data?.businessGoalId === g.id);
  const goalOutputsA = goalA ? calculateBusinessGoalOutputs(goalA) : null;
  const goalOutputsB = goalB ? calculateBusinessGoalOutputs(goalB) : null;

  const hasData = a.metrics && b.metrics;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Scenario Comparison</h2>
        <p className="text-muted-foreground">Compare two scenarios side-by-side to find the best fit.</p>
      </div>

      <div className="grid grid-cols-2 gap-4 max-w-lg">
        <div className="space-y-1">
          <label className="text-sm font-medium">Scenario A</label>
          <Select value={idA?.toString() ?? ""} onValueChange={v => setIdA(Number(v))}>
            <SelectTrigger><SelectValue placeholder="Select scenario…" /></SelectTrigger>
            <SelectContent>
              {scenarios?.map(s => <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <label className="text-sm font-medium">Scenario B</label>
          <Select value={idB?.toString() ?? ""} onValueChange={v => setIdB(Number(v))}>
            <SelectTrigger><SelectValue placeholder="Select scenario…" /></SelectTrigger>
            <SelectContent>
              {scenarios?.map(s => <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      {!hasData && (
        <Card className="flex flex-col items-center justify-center p-12 text-center">
          <div className="rounded-full bg-primary/10 p-4 mb-4">
            <GitCompare className="h-8 w-8 text-primary" />
          </div>
          <h3 className="text-lg font-medium">Select Two Scenarios</h3>
          <p className="text-muted-foreground max-w-sm mt-2">
            Choose a scenario for each column above to see a detailed side-by-side comparison.
          </p>
        </Card>
      )}

      {hasData && a.metrics && b.metrics && (
        <div className="space-y-6">
          <div className="grid grid-cols-3 gap-2">
            <div />
            <Card className="border-primary/50">
              <CardContent className="pt-4 text-center">
                <p className="font-bold text-primary">{a.data?.name}</p>
                {goalA && <p className="text-xs text-muted-foreground mt-1">Goal: {goalA.name}</p>}
                {goalOutputsA && (
                  <Badge className="mt-2 text-[10px]" variant={a.metrics.totalPracticeNet >= goalOutputsA.totalAnnualBusinessNeed ? "default" : "destructive"}>
                    {a.metrics.totalPracticeNet >= goalOutputsA.totalAnnualBusinessNeed ? "Goal Met" : "Below Goal"}
                  </Badge>
                )}
              </CardContent>
            </Card>
            <Card className="border-secondary/50">
              <CardContent className="pt-4 text-center">
                <p className="font-bold">{b.data?.name}</p>
                {goalB && <p className="text-xs text-muted-foreground mt-1">Goal: {goalB.name}</p>}
                {goalOutputsB && (
                  <Badge className="mt-2 text-[10px]" variant={b.metrics.totalPracticeNet >= goalOutputsB.totalAnnualBusinessNeed ? "default" : "destructive"}>
                    {b.metrics.totalPracticeNet >= goalOutputsB.totalAnnualBusinessNeed ? "Goal Met" : "Below Goal"}
                  </Badge>
                )}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader><CardTitle className="text-base">Practice Financials</CardTitle></CardHeader>
            <CardContent>
              <div className="grid grid-cols-3 gap-2 py-2 mb-2">
                <div />
                <p className="text-xs font-semibold text-center text-muted-foreground uppercase tracking-wider">{a.data?.name}</p>
                <p className="text-xs font-semibold text-center text-muted-foreground uppercase tracking-wider">{b.data?.name}</p>
              </div>
              <MetricRow label="Total Annual Production" aVal={a.metrics.totalProduction} bVal={b.metrics.totalProduction} />
              <MetricRow label="Total Clinician Comp" aVal={a.metrics.totalComp} bVal={b.metrics.totalComp} higherIsBetter={false} />
              <MetricRow label="Total Employer Burden" aVal={a.metrics.totalBurden} bVal={b.metrics.totalBurden} higherIsBetter={false} />
              <MetricRow label="Total Comp Cost (Comp + Burden)" aVal={a.metrics.totalCost} bVal={b.metrics.totalCost} higherIsBetter={false} />
              <MetricRow label="Practice Net (before overhead)" aVal={a.metrics.totalPracticeNet} bVal={b.metrics.totalPracticeNet} />
              {goalOutputsA && goalOutputsB && (
                <MetricRow
                  label="% of Goal Achieved"
                  aVal={goalOutputsA.totalAnnualBusinessNeed > 0 ? (a.metrics.totalPracticeNet / goalOutputsA.totalAnnualBusinessNeed) * 100 : 0}
                  bVal={goalOutputsB.totalAnnualBusinessNeed > 0 ? (b.metrics.totalPracticeNet / goalOutputsB.totalAnnualBusinessNeed) * 100 : 0}
                  format="percent"
                />
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-base">Team Composition</CardTitle></CardHeader>
            <CardContent>
              <div className="grid grid-cols-3 gap-2 py-2 mb-2">
                <div />
                <p className="text-xs font-semibold text-center text-muted-foreground uppercase tracking-wider">{a.data?.name}</p>
                <p className="text-xs font-semibold text-center text-muted-foreground uppercase tracking-wider">{b.data?.name}</p>
              </div>
              <MetricRow label="Clinician Count" aVal={a.metrics.clinicianCount} bVal={b.metrics.clinicianCount} format="number" />
              <MetricRow label="W2 Employees" aVal={a.metrics.w2Count} bVal={b.metrics.w2Count} format="number" higherIsBetter={false} />
              <MetricRow label="1099 Contractors" aVal={a.metrics.c1099Count} bVal={b.metrics.c1099Count} format="number" />
              <MetricRow label="Avg Clinician Comp" aVal={a.metrics.avgComp} bVal={b.metrics.avgComp} />
            </CardContent>
          </Card>

          {(goalOutputsA || goalOutputsB) && (
            <Card>
              <CardHeader><CardTitle className="text-base">Goal Progress</CardTitle></CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-4 text-sm">
                  {goalOutputsA && (
                    <div className={`rounded-lg p-4 border ${a.metrics.totalPracticeNet >= goalOutputsA.totalAnnualBusinessNeed ? "border-green-400 bg-green-50" : "border-amber-400 bg-amber-50"}`}>
                      <p className="font-medium">{a.data?.name}</p>
                      <p className="text-muted-foreground text-xs mt-1">Goal: {goalA?.name}</p>
                      <p className="mt-2">Need: <strong>{formatCurrency(goalOutputsA.totalAnnualBusinessNeed)}</strong></p>
                      <p>Have: <strong>{formatCurrency(a.metrics.totalPracticeNet)}</strong></p>
                      {a.metrics.totalPracticeNet < goalOutputsA.totalAnnualBusinessNeed && (
                        <p className="text-destructive font-semibold mt-1">Gap: {formatCurrency(goalOutputsA.totalAnnualBusinessNeed - a.metrics.totalPracticeNet)}</p>
                      )}
                    </div>
                  )}
                  {goalOutputsB && (
                    <div className={`rounded-lg p-4 border ${b.metrics.totalPracticeNet >= goalOutputsB.totalAnnualBusinessNeed ? "border-green-400 bg-green-50" : "border-amber-400 bg-amber-50"}`}>
                      <p className="font-medium">{b.data?.name}</p>
                      <p className="text-muted-foreground text-xs mt-1">Goal: {goalB?.name}</p>
                      <p className="mt-2">Need: <strong>{formatCurrency(goalOutputsB.totalAnnualBusinessNeed)}</strong></p>
                      <p>Have: <strong>{formatCurrency(b.metrics.totalPracticeNet)}</strong></p>
                      {b.metrics.totalPracticeNet < goalOutputsB.totalAnnualBusinessNeed && (
                        <p className="text-destructive font-semibold mt-1">Gap: {formatCurrency(goalOutputsB.totalAnnualBusinessNeed - b.metrics.totalPracticeNet)}</p>
                      )}
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
