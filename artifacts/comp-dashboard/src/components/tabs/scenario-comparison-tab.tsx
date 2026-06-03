import { useState, useEffect } from "react";
import { useListScenarios, useGetScenario, useListBusinessGoals, getGetScenarioQueryKey, useGetCurrentReality } from "@workspace/api-client-react";
import type { ScenarioDetail, BusinessGoal, Scenario } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { calculateClinicianMetrics, calculateBusinessGoalOutputs } from "@/lib/calculations";
import { formatCurrency, formatPercent } from "@/lib/format";
import { GitCompare, Plus, X } from "lucide-react";

const MAX_SCENARIOS = 4;

function useScenarioData(id: number | null) {
  return useGetScenario(id ?? 0, {
    query: { queryKey: getGetScenarioQueryKey(id ?? 0), enabled: id !== null && id > 0 }
  });
}

function computeMetrics(scenario: ScenarioDetail | undefined) {
  if (!scenario) return null;
  const cl = scenario.clinicians ?? [];
  const totalProduction = cl.reduce((s, c) => s + calculateClinicianMetrics(c).annualProduction, 0);
  const totalComp = cl.reduce((s, c) => s + calculateClinicianMetrics(c).clinicianCompensation, 0);
  const totalBurden = cl.reduce((s, c) => s + calculateClinicianMetrics(c).employerObligations, 0);
  const totalPracticeNet = cl.reduce((s, c) => s + calculateClinicianMetrics(c).practiceNetBeforeOverhead, 0);
  const w2Count = cl.filter(c => String(c.classification) === "w2").length;
  return {
    totalProduction,
    totalComp,
    totalBurden,
    totalCost: totalComp + totalBurden,
    totalPracticeNet,
    clinicianCount: cl.length,
    w2Count,
    c1099Count: cl.length - w2Count,
    avgComp: cl.length > 0 ? totalComp / cl.length : 0,
  };
}

interface MetricRowProps {
  label: string;
  values: (number | null)[];
  higherIsBetter?: boolean;
  format?: "currency" | "number" | "percent";
  bold?: boolean;
  highlight?: boolean;
}

function MetricRow({ label, values, higherIsBetter = true, format = "currency", bold, highlight }: MetricRowProps) {
  const fmt = (v: number | null) => {
    if (v === null) return "—";
    if (format === "currency") return formatCurrency(v);
    if (format === "percent") return formatPercent(v);
    return v.toFixed(0);
  };
  const validValues = values.filter((v): v is number => v !== null);
  const best = validValues.length > 0
    ? (higherIsBetter ? Math.max(...validValues) : Math.min(...validValues))
    : null;
  return (
    <div
      className={`grid py-2 border-b last:border-0 items-center text-sm ${highlight ? "bg-primary/5 rounded -mx-2 px-2" : ""}`}
      style={{ gridTemplateColumns: `1fr repeat(${values.length}, 1fr)` }}
    >
      <span className={`text-muted-foreground text-xs ${bold ? "font-semibold text-foreground" : ""}`}>{label}</span>
      {values.map((v, i) => (
        <span key={i} className={`text-center ${bold ? "font-bold" : "font-medium"} ${v !== null && v === best && best !== null && validValues.filter(x => x === best).length < validValues.length ? "text-green-600" : ""}`}>
          {fmt(v)}
          {v !== null && v === best && best !== null && validValues.filter(x => x === best).length < validValues.length && <span className="ml-1 text-[10px]">✓</span>}
        </span>
      ))}
    </div>
  );
}

function useAllScenarioData(ids: number[], goals: BusinessGoal[] | undefined) {
  const s0 = useScenarioData(ids[0] ?? null);
  const s1 = useScenarioData(ids[1] ?? null);
  const s2 = useScenarioData(ids[2] ?? null);
  const s3 = useScenarioData(ids[3] ?? null);
  const all = [s0, s1, s2, s3].slice(0, ids.length);

  return all.map((r, i) => {
    const data = ids[i] ? r.data : undefined;
    const m = computeMetrics(data);
    const linkedGoal = goals?.find(g => g.id === data?.businessGoalId);
    const goalOutputs = linkedGoal ? calculateBusinessGoalOutputs(linkedGoal) : null;
    return { data, metrics: m, linkedGoal, goalOutputs };
  });
}

export default function ScenarioComparisonTab() {
  const { data: scenarios } = useListScenarios();
  const { data: goals } = useListBusinessGoals();
  const { data: currentReality } = useGetCurrentReality();

  const firstTwo = scenarios ? [scenarios[0]?.id, scenarios[1]?.id].filter(Boolean) as number[] : [];
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [overheadInput, setOverheadInput] = useState<string>("");
  const [overheadSeeded, setOverheadSeeded] = useState(false);

  useEffect(() => {
    if (!overheadSeeded && currentReality?.currentAnnualOverhead != null && currentReality.currentAnnualOverhead > 0) {
      setOverheadInput(String(currentReality.currentAnnualOverhead));
      setOverheadSeeded(true);
    }
  }, [currentReality, overheadSeeded]);

  const annualOverhead = parseFloat(overheadInput.replace(/,/g, "")) || 0;

  const activeIds = selectedIds.length >= 2 ? selectedIds : firstTwo.slice(0, 2);

  const allData = useAllScenarioData(activeIds, goals);
  const hasData = activeIds.length >= 2 && allData.every(d => d.data !== undefined);

  const handleAdd = (id: number) => setSelectedIds(prev => [...(prev.length >= 2 ? prev : firstTwo), id].filter((v, i, a) => a.indexOf(v) === i));
  const handleRemove = (idx: number) => {
    const next = (selectedIds.length >= 2 ? selectedIds : firstTwo).filter((_, i) => i !== idx);
    setSelectedIds(next);
  };
  const handleSelect = (idx: number, id: number) => {
    const base = selectedIds.length >= 2 ? [...selectedIds] : [...firstTwo];
    base[idx] = id;
    setSelectedIds(base);
  };

  const initIds = selectedIds.length >= 2 ? selectedIds : firstTwo;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Scenario Comparison</h2>
        <p className="text-muted-foreground">Compare 2–4 scenarios side-by-side to find the best fit for your practice goals.</p>
      </div>

      {(!scenarios || scenarios.length < 2) ? (
        <Card className="flex flex-col items-center justify-center p-12 text-center">
          <div className="rounded-full bg-primary/10 p-4 mb-4">
            <GitCompare className="h-8 w-8 text-primary" />
          </div>
          <h3 className="text-lg font-medium">Build at Least Two Scenarios</h3>
          <p className="text-muted-foreground max-w-sm mt-2">
            Create scenarios in the Scenario Builder tab first, then return here to compare them.
          </p>
        </Card>
      ) : (
        <>
          {/* Controls row: scenario selectors + overhead input */}
          <div className="flex flex-wrap gap-4 items-end">
            {initIds.map((id, idx) => {
              const used = new Set(initIds.filter((_, i) => i !== idx));
              const available = scenarios?.filter(s => !used.has(s.id)) ?? [];
              return (
                <div key={idx} className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">Scenario {idx + 1}</label>
                  <div className="flex items-center gap-1">
                    <Select value={String(id)} onValueChange={v => handleSelect(idx, Number(v))}>
                      <SelectTrigger className="w-44">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {available.map(s => <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>)}
                        <SelectItem value={String(id)}>{scenarios?.find(s => s.id === id)?.name ?? "…"}</SelectItem>
                      </SelectContent>
                    </Select>
                    {initIds.length > 2 && (
                      <Button variant="ghost" size="icon" className="h-9 w-9" onClick={() => handleRemove(idx)}>
                        <X className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
            {initIds.length < MAX_SCENARIOS && (() => {
              const used = new Set(initIds);
              const available = scenarios?.filter(s => !used.has(s.id)) ?? [];
              return available.length > 0 ? (
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground invisible">add</label>
                  <Select onValueChange={v => {
                    setSelectedIds([...initIds, Number(v)]);
                  }}>
                    <SelectTrigger className="w-36">
                      <Plus className="h-3 w-3 mr-1" /><SelectValue placeholder="Add scenario" />
                    </SelectTrigger>
                    <SelectContent>
                      {available.map(s => <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              ) : null;
            })()}

            {/* Annual overhead input */}
            <div className="space-y-1 ml-auto">
              <Label className="text-xs font-medium text-muted-foreground">Annual Overhead</Label>
              <div className="flex items-center gap-1.5">
                <span className="text-sm text-muted-foreground">$</span>
                <Input
                  className="w-40 h-9"
                  placeholder="0"
                  value={overheadInput}
                  onChange={e => setOverheadInput(e.target.value)}
                />
              </div>
              {currentReality?.currentAnnualOverhead != null && currentReality.currentAnnualOverhead > 0 && (
                <p className="text-[10px] text-muted-foreground">
                  Defaulted from Current Reality ({formatCurrency(currentReality.currentAnnualOverhead)})
                </p>
              )}
            </div>
          </div>

          {hasData && (
            <div className="space-y-6">
              {/* Header row */}
              <div className="grid gap-2" style={{ gridTemplateColumns: `1fr repeat(${activeIds.length}, 1fr)` }}>
                <div />
                {allData.map((d, i) => {
                  const netAfterOverhead = (d.metrics?.totalPracticeNet ?? 0) - annualOverhead;
                  const goalMet = d.goalOutputs && d.metrics
                    ? netAfterOverhead >= d.goalOutputs.totalAnnualBusinessNeed
                    : null;
                  return (
                    <Card key={i} className={i === 0 ? "border-primary/60" : ""}>
                      <CardContent className="pt-4 text-center">
                        <p className={`font-bold ${i === 0 ? "text-primary" : ""}`}>{d.data?.name}</p>
                        {d.linkedGoal && <p className="text-xs text-muted-foreground mt-1">Goal: {d.linkedGoal.name}</p>}
                        {goalMet !== null && (
                          <Badge className="mt-2 text-[10px]" variant={goalMet ? "default" : "destructive"}>
                            {goalMet ? "Goal Met" : "Below Goal"}
                          </Badge>
                        )}
                      </CardContent>
                    </Card>
                  );
                })}
              </div>

              {/* Practice Financials */}
              <Card>
                <CardHeader><CardTitle className="text-base">Practice Financials</CardTitle></CardHeader>
                <CardContent>
                  <div className="grid py-2 mb-1" style={{ gridTemplateColumns: `1fr repeat(${activeIds.length}, 1fr)` }}>
                    <div />
                    {allData.map((d, i) => (
                      <p key={i} className="text-xs font-semibold text-center text-muted-foreground uppercase tracking-wider truncate">{d.data?.name}</p>
                    ))}
                  </div>
                  <MetricRow label="Total Annual Production" values={allData.map(d => d.metrics?.totalProduction ?? null)} />
                  <MetricRow label="Total Clinician Comp" values={allData.map(d => d.metrics?.totalComp ?? null)} higherIsBetter={false} />
                  <MetricRow label="Total Employer Burden (W2)" values={allData.map(d => d.metrics?.totalBurden ?? null)} higherIsBetter={false} />
                  <MetricRow label="Total Comp Cost" values={allData.map(d => d.metrics?.totalCost ?? null)} higherIsBetter={false} />
                  <MetricRow label="Practice Net (before overhead)" values={allData.map(d => d.metrics?.totalPracticeNet ?? null)} bold />
                  <MetricRow
                    label={`Practice Net (after overhead${annualOverhead > 0 ? ` – ${formatCurrency(annualOverhead)}` : ""})`}
                    values={allData.map(d => d.metrics != null ? d.metrics.totalPracticeNet - annualOverhead : null)}
                    bold
                    highlight
                  />
                  {allData.some(d => d.goalOutputs) && (
                    <MetricRow
                      label="% of Goal Achieved (after overhead)"
                      values={allData.map(d => d.goalOutputs && d.metrics
                        ? (d.goalOutputs.totalAnnualBusinessNeed > 0
                          ? ((d.metrics.totalPracticeNet - annualOverhead) / d.goalOutputs.totalAnnualBusinessNeed) * 100
                          : null)
                        : null)}
                      format="percent"
                    />
                  )}
                </CardContent>
              </Card>

              {/* Team Composition */}
              <Card>
                <CardHeader><CardTitle className="text-base">Team Composition</CardTitle></CardHeader>
                <CardContent>
                  <div className="grid py-2 mb-1" style={{ gridTemplateColumns: `1fr repeat(${activeIds.length}, 1fr)` }}>
                    <div />
                    {allData.map((d, i) => (
                      <p key={i} className="text-xs font-semibold text-center text-muted-foreground uppercase tracking-wider truncate">{d.data?.name}</p>
                    ))}
                  </div>
                  <MetricRow label="Clinician Count" values={allData.map(d => d.metrics?.clinicianCount ?? null)} format="number" />
                  <MetricRow label="W2 Employees" values={allData.map(d => d.metrics?.w2Count ?? null)} format="number" higherIsBetter={false} />
                  <MetricRow label="1099 Contractors" values={allData.map(d => d.metrics?.c1099Count ?? null)} format="number" />
                  <MetricRow label="Avg Clinician Comp" values={allData.map(d => d.metrics?.avgComp ?? null)} />
                </CardContent>
              </Card>

              {/* Clinician-Level Cross-Scenario Table */}
              {(() => {
                const allLabels = Array.from(new Set(
                  allData.flatMap(d => (d.data?.clinicians ?? []).map(c => c.label))
                )).sort();

                if (allLabels.length === 0) return null;

                return (
                  <Card>
                    <CardHeader><CardTitle className="text-base">Clinician-Level Comparison</CardTitle></CardHeader>
                    <CardContent>
                      <p className="text-xs text-muted-foreground mb-4">
                        Compensation per clinician across each scenario. Clinicians matched by name. "—" = not in that scenario.
                      </p>
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b">
                              <th className="text-left text-xs font-semibold text-muted-foreground pb-2 pr-4">Clinician</th>
                              {allData.map((d, i) => (
                                <th key={i} className="text-center text-xs font-semibold text-muted-foreground pb-2 px-2 truncate max-w-28">{d.data?.name}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {allLabels.map(label => (
                              <>
                                <tr key={`${label}-prod`} className="border-b border-dashed">
                                  <td className="py-2 pr-4">
                                    <span className="font-medium">{label}</span>
                                    <span className="text-muted-foreground text-[10px] block">Production / Comp / Net</span>
                                  </td>
                                  {allData.map((d, i) => {
                                    const c = (d.data?.clinicians ?? []).find(x => x.label === label);
                                    if (!c) return <td key={i} className="text-center py-2 px-2 text-muted-foreground">—</td>;
                                    const m = calculateClinicianMetrics(c);
                                    return (
                                      <td key={i} className="text-center py-2 px-2">
                                        <span className="block text-xs text-muted-foreground">{formatCurrency(m.annualProduction)}</span>
                                        <span className="block text-xs font-semibold text-green-600">{formatCurrency(m.clinicianCompensation)}</span>
                                        <span className="block text-xs text-primary">{formatCurrency(m.practiceNetBeforeOverhead)}</span>
                                      </td>
                                    );
                                  })}
                                </tr>
                              </>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </CardContent>
                  </Card>
                );
              })()}

              {/* Goal Progress Cards */}
              {allData.some(d => d.goalOutputs) && (
                <Card>
                  <CardHeader><CardTitle className="text-base">Goal Progress</CardTitle></CardHeader>
                  <CardContent>
                    <div className="overflow-x-auto">
                    <div className="grid gap-4 min-w-[400px]" style={{ gridTemplateColumns: `repeat(${activeIds.length}, 1fr)` }}>
                      {allData.map((d, i) => {
                        if (!d.goalOutputs || !d.metrics) return (
                          <div key={i} className="rounded-lg border p-4 text-sm text-muted-foreground">
                            <p className="font-medium">{d.data?.name}</p>
                            <p className="mt-1">No goal linked</p>
                          </div>
                        );
                        const netAfterOverhead = d.metrics.totalPracticeNet - annualOverhead;
                        const met = netAfterOverhead >= d.goalOutputs.totalAnnualBusinessNeed;
                        return (
                          <div key={i} className={`rounded-lg border p-4 text-sm ${met ? "border-green-400 bg-green-50" : "border-amber-400 bg-amber-50"}`}>
                            <p className="font-bold">{d.data?.name}</p>
                            <p className="text-muted-foreground text-xs mt-1">Goal: {d.linkedGoal?.name}</p>
                            <p className="mt-2">Need: <strong>{formatCurrency(d.goalOutputs.totalAnnualBusinessNeed)}</strong></p>
                            <p className="text-muted-foreground text-xs">Before overhead: <span className="font-medium text-foreground">{formatCurrency(d.metrics.totalPracticeNet)}</span></p>
                            {annualOverhead > 0 && (
                              <p className="text-muted-foreground text-xs">Overhead: <span className="font-medium text-foreground">−{formatCurrency(annualOverhead)}</span></p>
                            )}
                            <p className="mt-1">After overhead: <strong>{formatCurrency(netAfterOverhead)}</strong></p>
                            {!met && (
                              <p className="text-destructive font-semibold mt-1">
                                Gap: {formatCurrency(d.goalOutputs.totalAnnualBusinessNeed - netAfterOverhead)}
                              </p>
                            )}
                            {met && <p className="text-green-600 font-semibold mt-1">Goal met ✓</p>}
                          </div>
                        );
                      })}
                    </div>
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
