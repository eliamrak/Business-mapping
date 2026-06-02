import { useState } from "react";
import { useListClinicians, useGetScenario, useListScenarios, getGetScenarioQueryKey } from "@workspace/api-client-react";
import type { Clinician, ScenarioClinician } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { calculateClinicianMetrics } from "@/lib/calculations";
import { formatCurrency, formatPercent } from "@/lib/format";
import { Users } from "lucide-react";

function useScenarioData(id: number | null) {
  return useGetScenario(id ?? 0, {
    query: { queryKey: getGetScenarioQueryKey(id ?? 0), enabled: id !== null && id > 0 }
  });
}

function findInScenario(
  scenarioClinicians: ScenarioClinician[] | undefined,
  source: Clinician | null
): ScenarioClinician | undefined {
  if (!source || !scenarioClinicians) return undefined;
  return (
    scenarioClinicians.find(c => c.sourceClinicianId === source.id) ??
    scenarioClinicians.find(c => c.label === source.label)
  );
}

interface ComparisonRowProps {
  label: string;
  aVal: number | null;
  bVal: number | null;
  higherIsBetter?: boolean;
  format?: "currency" | "percent" | "number";
}

function ComparisonRow({ label, aVal, bVal, higherIsBetter = true, format = "currency" }: ComparisonRowProps) {
  const fmt = (v: number | null) => {
    if (v === null) return "—";
    if (format === "currency") return formatCurrency(v);
    if (format === "percent") return formatPercent(v);
    return v.toFixed(1);
  };
  const aBetter = aVal !== null && bVal !== null && (higherIsBetter ? aVal > bVal : aVal < bVal);
  const bBetter = aVal !== null && bVal !== null && (higherIsBetter ? bVal > aVal : bVal < aVal);

  return (
    <div className="grid grid-cols-3 py-2 border-b last:border-0 items-center text-sm">
      <span className="text-muted-foreground text-xs">{label}</span>
      <span className={`text-center font-medium ${aBetter ? "text-green-600" : ""}`}>
        {fmt(aVal)}{aBetter && <span className="ml-1 text-xs">✓</span>}
      </span>
      <span className={`text-center font-medium ${bBetter ? "text-green-600" : ""}`}>
        {fmt(bVal)}{bBetter && <span className="ml-1 text-xs">✓</span>}
      </span>
    </div>
  );
}

function W2vs1099Panel({ clinician }: { clinician: Clinician | ScenarioClinician }) {
  const asW2 = calculateClinicianMetrics({ ...clinician, classification: "w2" });
  const as1099 = calculateClinicianMetrics({ ...clinician, classification: "1099" });

  return (
    <div className="mt-4 pt-4 border-t">
      <p className="text-sm font-semibold mb-1">W2 vs 1099 Classification Impact</p>
      <p className="text-xs text-muted-foreground mb-3">
        Same session volume and split structure — only payroll tax treatment differs.
      </p>
      <div className="grid grid-cols-3 py-1 mb-1">
        <div />
        <p className="text-xs font-semibold text-center text-muted-foreground uppercase tracking-wider">W2</p>
        <p className="text-xs font-semibold text-center text-muted-foreground uppercase tracking-wider">1099</p>
      </div>
      <ComparisonRow label="Gross Comp" aVal={asW2.clinicianCompensation} bVal={as1099.clinicianCompensation} />
      <ComparisonRow label="Clinician Payroll Tax" aVal={asW2.clinicianPayrollTaxEstimate} bVal={as1099.clinicianPayrollTaxEstimate} higherIsBetter={false} />
      <ComparisonRow label="Clinician Est. Take-Home" aVal={asW2.estimatedCompAfterPayrollTaxes} bVal={as1099.estimatedCompAfterPayrollTaxes} />
      <ComparisonRow label="Employer Obligations" aVal={asW2.employerObligations} bVal={as1099.employerObligations} higherIsBetter={false} />
      <ComparisonRow label="Practice Net" aVal={asW2.practiceNetBeforeOverhead} bVal={as1099.practiceNetBeforeOverhead} />
      <p className="text-xs text-muted-foreground mt-3 bg-muted/50 rounded p-2">
        W2 employees pay ~7.65% payroll tax; 1099 contractors pay ~15.3% self-employment tax.
        The practice absorbs FICA match, FUTA/SUTA, and workers' comp for W2 employees.
      </p>
    </div>
  );
}

export default function ClinicianImpactViewTab() {
  const { data: clinicians, isLoading: isLoadingClinicians } = useListClinicians();
  const { data: scenarios, isLoading: isLoadingScenarios } = useListScenarios();

  const [selectedClinicianId, setSelectedClinicianId] = useState<number | null>(null);
  const [scenarioAId, setScenarioAId] = useState<number | null>(null);
  const [scenarioBId, setScenarioBId] = useState<number | null>(null);

  const { data: scenarioA } = useScenarioData(scenarioAId);
  const { data: scenarioB } = useScenarioData(scenarioBId);

  const selectedClinician = clinicians?.find(c => c.id === selectedClinicianId) ?? null;

  const clxInA = findInScenario(scenarioA?.clinicians, selectedClinician);
  const clxInB = findInScenario(scenarioB?.clinicians, selectedClinician);

  const metricsA = clxInA ? calculateClinicianMetrics(clxInA) : null;
  const metricsB = clxInB ? calculateClinicianMetrics(clxInB) : null;

  if (isLoadingClinicians || isLoadingScenarios) return <div className="p-8 text-muted-foreground">Loading...</div>;

  if (!clinicians?.length) {
    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Clinician Impact View</h2>
          <p className="text-muted-foreground">Compare how one clinician fares across two different scenarios.</p>
        </div>
        <Card className="flex flex-col items-center justify-center p-12 text-center">
          <div className="rounded-full bg-primary/10 p-4 mb-4">
            <Users className="h-8 w-8 text-primary" />
          </div>
          <h3 className="text-lg font-medium">No Clinicians Found</h3>
          <p className="text-muted-foreground max-w-sm mt-2">Add clinicians in the Team Builder tab first.</p>
        </Card>
      </div>
    );
  }

  const hasComparison = selectedClinician && scenarioAId && scenarioBId && scenarioA && scenarioB;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Clinician Impact View</h2>
        <p className="text-muted-foreground">
          Select one clinician and two scenarios to compare their compensation outcomes side-by-side.
        </p>
      </div>

      {/* Selection controls */}
      <Card>
        <CardContent className="pt-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-1">
              <label className="text-sm font-medium">Clinician</label>
              <Select
                value={selectedClinicianId?.toString() ?? ""}
                onValueChange={v => setSelectedClinicianId(Number(v))}
              >
                <SelectTrigger><SelectValue placeholder="Select clinician…" /></SelectTrigger>
                <SelectContent>
                  {clinicians.map(c => (
                    <SelectItem key={c.id} value={String(c.id)}>
                      {c.label} ({c.classification})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">Scenario A</label>
              <Select
                value={scenarioAId?.toString() ?? ""}
                onValueChange={v => setScenarioAId(Number(v))}
              >
                <SelectTrigger><SelectValue placeholder="Select scenario…" /></SelectTrigger>
                <SelectContent>
                  {scenarios?.map(s => <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">Scenario B</label>
              <Select
                value={scenarioBId?.toString() ?? ""}
                onValueChange={v => setScenarioBId(Number(v))}
              >
                <SelectTrigger><SelectValue placeholder="Select scenario…" /></SelectTrigger>
                <SelectContent>
                  {scenarios?.map(s => <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {!hasComparison && (
        <div className="text-sm text-muted-foreground bg-muted/50 rounded-lg p-4 border border-dashed">
          Choose a clinician and two scenarios above to see a comparison. The clinician must appear in both scenarios (imported or added with the same name).
        </div>
      )}

      {hasComparison && selectedClinician && (
        <div className="space-y-6">
          {/* Clinician profile summary */}
          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center gap-3 flex-wrap">
                <span className="text-lg font-bold">{selectedClinician.label}</span>
                <Badge variant={String(selectedClinician.classification) === "w2" ? "default" : "outline"} className="uppercase text-[10px]">
                  {selectedClinician.classification} (base)
                </Badge>
                <Badge variant="secondary" className="uppercase text-[10px]">{selectedClinician.roleType}</Badge>
                <span className="text-muted-foreground text-sm ml-auto">
                  Base: {formatCurrency(selectedClinician.sessionRate)}/session · {selectedClinician.sessionsPerWeek}/wk · {selectedClinician.weeksWorkedPerYear} wks
                </span>
              </div>
            </CardContent>
          </Card>

          {/* Cross-scenario comparison */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {[
              { label: scenarioA.name, clx: clxInA, metrics: metricsA, found: !!clxInA },
              { label: scenarioB.name, clx: clxInB, metrics: metricsB, found: !!clxInB },
            ].map(({ label, clx, metrics, found }, i) => (
              <Card key={i} className={i === 0 ? "border-primary/40" : ""}>
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <span className={i === 0 ? "text-primary" : ""}>{label}</span>
                    {!found && <Badge variant="outline" className="text-[10px]">Not in scenario</Badge>}
                    {found && clx && (
                      <Badge variant={String(clx.classification) === "w2" ? "default" : "outline"} className="uppercase text-[10px]">
                        {clx.classification}
                      </Badge>
                    )}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {!found || !clx || !metrics ? (
                    <p className="text-muted-foreground text-sm">
                      {selectedClinician.label} is not in this scenario. Open Scenario Builder and import this clinician to include them.
                    </p>
                  ) : (
                    <div className="space-y-3">
                      <div className="grid grid-cols-2 gap-3 text-sm">
                        <div><span className="text-muted-foreground text-xs block">Session Rate</span><span className="font-semibold">{formatCurrency(clx.sessionRate)}</span></div>
                        <div><span className="text-muted-foreground text-xs block">Sessions/Wk</span><span className="font-semibold">{clx.sessionsPerWeek}</span></div>
                        <div><span className="text-muted-foreground text-xs block">Annual Production</span><span className="font-semibold">{formatCurrency(metrics.annualProduction)}</span></div>
                        <div><span className="text-muted-foreground text-xs block">Gross Comp</span><span className="font-semibold text-green-600">{formatCurrency(metrics.clinicianCompensation)}</span></div>
                        <div><span className="text-muted-foreground text-xs block">Employer Burden</span><span className="font-semibold text-amber-600">{formatCurrency(metrics.employerObligations)}</span></div>
                        <div><span className="text-muted-foreground text-xs block">Practice Net</span><span className="font-semibold text-primary">{formatCurrency(metrics.practiceNetBeforeOverhead)}</span></div>
                        <div className="col-span-2"><span className="text-muted-foreground text-xs block">Est. Take-Home (after payroll tax)</span><span className="font-semibold">{formatCurrency(metrics.estimatedCompAfterPayrollTaxes)}</span></div>
                        <div className="col-span-2">
                          <span className="text-muted-foreground text-xs block">Split</span>
                          <span className="font-mono text-xs">
                            {clx.preCapClinicianSplit}/{clx.preCapPracticeSplit}
                            {clx.capEnabled ? ` → ${clx.postCapClinicianSplit}/${clx.postCapPracticeSplit} (cap: ${formatCurrency(clx.capAmount)})` : " (no cap)"}
                          </span>
                        </div>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Head-to-head comparison table */}
          {clxInA && clxInB && metricsA && metricsB && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Head-to-Head: {selectedClinician.label}</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-3 py-2 mb-1">
                  <div />
                  <p className="text-xs font-semibold text-center text-muted-foreground uppercase tracking-wider truncate">{scenarioA.name}</p>
                  <p className="text-xs font-semibold text-center text-muted-foreground uppercase tracking-wider truncate">{scenarioB.name}</p>
                </div>
                <ComparisonRow label="Annual Production" aVal={metricsA.annualProduction} bVal={metricsB.annualProduction} />
                <ComparisonRow label="Gross Compensation" aVal={metricsA.clinicianCompensation} bVal={metricsB.clinicianCompensation} />
                <ComparisonRow label="Employer Burden" aVal={metricsA.employerObligations} bVal={metricsB.employerObligations} higherIsBetter={false} />
                <ComparisonRow label="Est. Take-Home" aVal={metricsA.estimatedCompAfterPayrollTaxes} bVal={metricsB.estimatedCompAfterPayrollTaxes} />
                <ComparisonRow label="Practice Net" aVal={metricsA.practiceNetBeforeOverhead} bVal={metricsB.practiceNetBeforeOverhead} />
                <ComparisonRow
                  label="Comp as % of Production"
                  aVal={metricsA.annualProduction > 0 ? (metricsA.clinicianCompensation / metricsA.annualProduction) * 100 : null}
                  bVal={metricsB.annualProduction > 0 ? (metricsB.clinicianCompensation / metricsB.annualProduction) * 100 : null}
                  format="percent"
                  higherIsBetter={false}
                />

                {(String(clxInA.classification) !== String(clxInB.classification)) && (
                  <div className="mt-3 p-3 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-800">
                    <strong>Note:</strong> The classification differs between scenarios ({clxInA.classification} vs {clxInB.classification}).
                    This affects payroll tax and employer burden calculations.
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* W2 vs 1099 panel using the base clinician profile */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Classification Impact (Base Profile)</CardTitle>
            </CardHeader>
            <CardContent>
              <W2vs1099Panel clinician={selectedClinician} />
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
