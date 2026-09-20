import { useState } from "react";
import { useListClinicians, useGetScenario, useListScenarios, useListStaffMembers, getGetScenarioQueryKey } from "@workspace/api-client-react";
import type { Clinician, ScenarioClinician } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { calculateClinicianMetrics, calculateStaffMemberCost } from "@/lib/calculations";
import { formatCurrency, formatPercent } from "@/lib/format";
import { Users, TrendingUp, TrendingDown } from "lucide-react";

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

function ClassificationDeltaBadge({ clinician }: { clinician: Clinician }) {
  const isW2 = String(clinician.classification) === "w2";
  const actual = calculateClinicianMetrics(clinician);
  const alt = calculateClinicianMetrics({ ...clinician, classification: isW2 ? "1099" : "w2" });
  const takehomeDelta = actual.estimatedCompAfterPayrollTaxes - alt.estimatedCompAfterPayrollTaxes;
  const practiceNetDelta = actual.practiceNetBeforeOverhead - alt.practiceNetBeforeOverhead;

  return (
    <div className="flex gap-2 flex-wrap mt-2 text-[11px]">
      <span className="text-muted-foreground">vs {isW2 ? "1099" : "W2"}:</span>
      <span className={`inline-flex items-center gap-0.5 font-medium ${takehomeDelta >= 0 ? "text-green-600" : "text-destructive"}`}>
        {takehomeDelta >= 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
        clinician {takehomeDelta >= 0 ? "+" : ""}{formatCurrency(takehomeDelta)} take-home
      </span>
      <span className={`inline-flex items-center gap-0.5 font-medium ${practiceNetDelta >= 0 ? "text-green-600" : "text-amber-600"}`}>
        {practiceNetDelta >= 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
        practice {practiceNetDelta >= 0 ? "+" : ""}{formatCurrency(practiceNetDelta)} net
      </span>
    </div>
  );
}

function TeamRosterSection({ clinicians, totalStaffCost }: { clinicians: Clinician[]; totalStaffCost?: number }) {
  const rows = clinicians.map(c => ({
    clinician: c,
    metrics: calculateClinicianMetrics(c),
  }));

  const totalProduction = rows.reduce((s, r) => s + r.metrics.annualProduction, 0);
  const totalComp = rows.reduce((s, r) => s + r.metrics.clinicianCompensation, 0);
  const totalBurden = rows.reduce((s, r) => s + r.metrics.employerObligations, 0);
  const totalTakeHome = rows.reduce((s, r) => s + r.metrics.estimatedCompAfterPayrollTaxes, 0);
  const totalPracticeNet = rows.reduce((s, r) => s + r.metrics.practiceNetBeforeOverhead, 0);
  const staffCost = totalStaffCost ?? 0;
  const netAfterStaff = totalPracticeNet - staffCost;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">All Clinicians — Production & Compensation</CardTitle>
      </CardHeader>
      <CardContent className="p-0">

        {/* ── Mobile card view (< 640px) ── */}
        <div className="sm:hidden divide-y">
          {rows.map(({ clinician: c, metrics: m }) => {
            const isW2 = String(c.classification) === "w2";
            const compPct = m.annualProduction > 0 ? (m.clinicianCompensation / m.annualProduction) * 100 : 0;
            return (
              <div key={c.id} className="px-4 py-4 space-y-3">
                {/* Name / badge row */}
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-sm">{c.label}</span>
                  <div className="flex items-center gap-1 shrink-0">
                    <Badge variant={isW2 ? "default" : "outline"} className="text-[10px] uppercase px-1.5 py-0">
                      {c.classification}
                    </Badge>
                    <Badge variant="secondary" className="text-[10px] px-1.5 py-0">{c.roleType}</Badge>
                  </div>
                </div>
                <p className="text-[10px] text-muted-foreground -mt-1">
                  {c.sessionsPerWeek}/wk · {formatCurrency(c.sessionRate)}/session
                </p>

                {/* Metrics grid */}
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="rounded-lg bg-muted/50 p-2.5 space-y-0.5">
                    <p className="text-[10px] text-muted-foreground">Annual Production</p>
                    <p className="font-semibold">{formatCurrency(m.annualProduction)}</p>
                    <p className="text-[10px] text-muted-foreground">{m.annualSessions} sessions</p>
                  </div>

                  <div className="rounded-lg bg-muted/50 p-2.5 space-y-0.5">
                    <p className="text-[10px] text-muted-foreground">Gross Comp</p>
                    <p className="font-semibold text-green-600">{formatCurrency(m.clinicianCompensation)}</p>
                    <p className="text-[10px] text-muted-foreground">{formatPercent(compPct, 0)} of prod.</p>
                  </div>

                  {isW2 && (
                    <div className="rounded-lg bg-muted/50 p-2.5 space-y-0.5">
                      <p className="text-[10px] text-muted-foreground">Employer Burden</p>
                      <p className="font-semibold text-amber-600">{formatCurrency(m.employerObligations)}</p>
                      <p className="text-[10px] text-muted-foreground">FICA + FUTA/SUTA</p>
                    </div>
                  )}

                  <div className="rounded-lg bg-muted/50 p-2.5 space-y-0.5">
                    <p className="text-[10px] text-muted-foreground">Est. Take-Home</p>
                    <p className="font-semibold">{formatCurrency(m.estimatedCompAfterPayrollTaxes)}</p>
                    <p className="text-[10px] text-muted-foreground">after payroll tax</p>
                  </div>

                  <div className="rounded-lg bg-muted/50 p-2.5 space-y-0.5">
                    <p className="text-[10px] text-muted-foreground">Practice Net</p>
                    <p className="font-semibold text-primary">{formatCurrency(m.practiceNetBeforeOverhead)}</p>
                    <p className="text-[10px] text-muted-foreground">before overhead</p>
                  </div>
                </div>
              </div>
            );
          })}

          {/* Mobile totals row */}
          <div className="px-4 py-4 bg-muted/30 space-y-3">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Team Total ({clinicians.length} clinicians)
            </p>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="rounded-lg bg-background p-2.5 space-y-0.5">
                <p className="text-[10px] text-muted-foreground">Annual Production</p>
                <p className="font-bold">{formatCurrency(totalProduction)}</p>
              </div>
              <div className="rounded-lg bg-background p-2.5 space-y-0.5">
                <p className="text-[10px] text-muted-foreground">Gross Comp</p>
                <p className="font-bold text-green-600">{formatCurrency(totalComp)}</p>
              </div>
              <div className="rounded-lg bg-background p-2.5 space-y-0.5">
                <p className="text-[10px] text-muted-foreground">Employer Burden</p>
                <p className="font-bold text-amber-600">{formatCurrency(totalBurden)}</p>
              </div>
              <div className="rounded-lg bg-background p-2.5 space-y-0.5">
                <p className="text-[10px] text-muted-foreground">Est. Take-Home</p>
                <p className="font-bold">{formatCurrency(totalTakeHome)}</p>
              </div>
              <div className="rounded-lg bg-background p-2.5 space-y-0.5">
                <p className="text-[10px] text-muted-foreground">Practice Net</p>
                <p className="font-bold text-primary">{formatCurrency(totalPracticeNet)}</p>
              </div>
            </div>
          </div>
        </div>

        {/* ── Desktop table view (≥ 640px) ── */}
        <div className="hidden sm:block overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/40">
                <th className="text-left text-xs font-semibold text-muted-foreground py-3 pl-6 pr-3">Clinician</th>
                <th className="text-right text-xs font-semibold text-muted-foreground py-3 px-3">Annual Production</th>
                <th className="text-right text-xs font-semibold text-muted-foreground py-3 px-3">Gross Comp</th>
                <th className="text-right text-xs font-semibold text-muted-foreground py-3 px-3">Employer Burden</th>
                <th className="text-right text-xs font-semibold text-muted-foreground py-3 px-3">Est. Take-Home</th>
                <th className="text-right text-xs font-semibold text-muted-foreground py-3 pl-3 pr-6">Practice Net</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ clinician: c, metrics: m }) => {
                const isW2 = String(c.classification) === "w2";
                const compPct = m.annualProduction > 0 ? (m.clinicianCompensation / m.annualProduction) * 100 : 0;
                return (
                  <tr key={c.id} className="border-b last:border-0 hover:bg-muted/20 transition-colors">
                    <td className="py-3 pl-6 pr-3">
                      <div className="flex items-center gap-2">
                        <div>
                          <p className="font-medium">{c.label}</p>
                          <div className="flex items-center gap-1 mt-0.5">
                            <Badge
                              variant={isW2 ? "default" : "outline"}
                              className="text-[10px] uppercase px-1.5 py-0"
                            >
                              {c.classification}
                            </Badge>
                            <Badge variant="secondary" className="text-[10px] px-1.5 py-0">{c.roleType}</Badge>
                            <span className="text-[10px] text-muted-foreground">
                              {c.sessionsPerWeek}/wk · {formatCurrency(c.sessionRate)}
                            </span>
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="py-3 px-3 text-right">
                      <span className="font-medium">{formatCurrency(m.annualProduction)}</span>
                      <span className="text-muted-foreground text-[10px] block">{m.annualSessions} sessions</span>
                    </td>
                    <td className="py-3 px-3 text-right">
                      <span className="font-semibold text-green-600">{formatCurrency(m.clinicianCompensation)}</span>
                      <span className="text-muted-foreground text-[10px] block">{formatPercent(compPct, 0)} of prod.</span>
                    </td>
                    <td className="py-3 px-3 text-right">
                      {isW2 ? (
                        <>
                          <span className="font-medium text-amber-600">{formatCurrency(m.employerObligations)}</span>
                          <span className="text-muted-foreground text-[10px] block">FICA + FUTA/SUTA</span>
                        </>
                      ) : (
                        <span className="text-muted-foreground text-xs">—</span>
                      )}
                    </td>
                    <td className="py-3 px-3 text-right">
                      <span className="font-medium">{formatCurrency(m.estimatedCompAfterPayrollTaxes)}</span>
                      <span className="text-muted-foreground text-[10px] block">after payroll tax</span>
                    </td>
                    <td className="py-3 pl-3 pr-6 text-right">
                      <span className="font-semibold text-primary">{formatCurrency(m.practiceNetBeforeOverhead)}</span>
                      <span className="text-muted-foreground text-[10px] block">before overhead</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="border-t-2 bg-muted/30">
                <td className="py-3 pl-6 pr-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  Team Total ({clinicians.length} clinicians)
                </td>
                <td className="py-3 px-3 text-right font-bold">{formatCurrency(totalProduction)}</td>
                <td className="py-3 px-3 text-right font-bold text-green-600">{formatCurrency(totalComp)}</td>
                <td className="py-3 px-3 text-right font-bold text-amber-600">{formatCurrency(totalBurden)}</td>
                <td className="py-3 px-3 text-right font-bold">{formatCurrency(totalTakeHome)}</td>
                <td className="py-3 pl-3 pr-6 text-right font-bold text-primary">{formatCurrency(totalPracticeNet)}</td>
              </tr>
              {staffCost > 0 && (
                <>
                  <tr className="bg-muted/20 border-t">
                    <td className="py-2 pl-6 pr-3 text-xs text-muted-foreground" colSpan={5}>
                      Non-clinical staff overhead
                    </td>
                    <td className="py-2 pl-3 pr-6 text-right text-xs font-medium text-rose-600">
                      −{formatCurrency(staffCost)}
                    </td>
                  </tr>
                  <tr className="bg-primary/5 border-t">
                    <td className="py-2 pl-6 pr-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider" colSpan={5}>
                      Net After Staff Overhead
                    </td>
                    <td className="py-2 pl-3 pr-6 text-right font-bold text-primary">
                      {formatCurrency(netAfterStaff)}
                    </td>
                  </tr>
                </>
              )}
            </tfoot>
          </table>
        </div>

      </CardContent>
    </Card>
  );
}

function W2vs1099SummarySection({ clinicians }: { clinicians: Clinician[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">W2 vs 1099 Classification Impact</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <p className="text-xs text-muted-foreground px-4 sm:px-6 pb-3">
          How each clinician's take-home and the practice's net would change under the opposite classification.
          Same session volume and split — only payroll tax treatment differs.
        </p>

        {/* ── Mobile card view (< 640px) ── */}
        <div className="sm:hidden divide-y">
          {clinicians.map(c => {
            const isW2 = String(c.classification) === "w2";
            const actual = calculateClinicianMetrics(c);
            const alt = calculateClinicianMetrics({ ...c, classification: isW2 ? "1099" : "w2" });
            const takehomeDelta = alt.estimatedCompAfterPayrollTaxes - actual.estimatedCompAfterPayrollTaxes;
            const netDelta = alt.practiceNetBeforeOverhead - actual.practiceNetBeforeOverhead;
            const altLabel = isW2 ? "1099" : "W2";

            return (
              <div key={c.id} className="px-4 py-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-sm">{c.label}</span>
                  <Badge variant={isW2 ? "default" : "outline"} className="text-[10px] uppercase shrink-0">
                    {c.classification}
                  </Badge>
                </div>

                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="rounded-lg bg-muted/50 p-2.5 space-y-2">
                    <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                      Current ({String(c.classification).toUpperCase()})
                    </p>
                    <div>
                      <span className="text-[10px] text-muted-foreground block">Take-Home</span>
                      <span className="font-semibold">{formatCurrency(actual.estimatedCompAfterPayrollTaxes)}</span>
                    </div>
                    <div>
                      <span className="text-[10px] text-muted-foreground block">Employer Burden</span>
                      {isW2
                        ? <span className="font-medium text-amber-600">{formatCurrency(actual.employerObligations)}</span>
                        : <span className="text-muted-foreground">—</span>
                      }
                    </div>
                    <div>
                      <span className="text-[10px] text-muted-foreground block">Practice Net</span>
                      <span className="font-semibold text-primary">{formatCurrency(actual.practiceNetBeforeOverhead)}</span>
                    </div>
                  </div>

                  <div className="rounded-lg border border-dashed bg-muted/20 p-2.5 space-y-2">
                    <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                      If {altLabel}
                    </p>
                    <div>
                      <span className="text-[10px] text-muted-foreground block">Take-Home</span>
                      <span className={`font-semibold ${takehomeDelta > 0 ? "text-green-600" : takehomeDelta < 0 ? "text-destructive" : ""}`}>
                        {formatCurrency(alt.estimatedCompAfterPayrollTaxes)}
                      </span>
                      <span className={`text-[10px] font-medium block ${takehomeDelta >= 0 ? "text-green-600" : "text-destructive"}`}>
                        {takehomeDelta >= 0 ? "+" : ""}{formatCurrency(takehomeDelta)}
                      </span>
                    </div>
                    <div>
                      <span className="text-[10px] text-muted-foreground block">Employer Burden</span>
                      {!isW2
                        ? <span className="font-medium text-amber-600">{formatCurrency(alt.employerObligations)}</span>
                        : <span className="text-muted-foreground">—</span>
                      }
                    </div>
                    <div>
                      <span className="text-[10px] text-muted-foreground block">Practice Net</span>
                      <span className={`font-semibold ${netDelta > 0 ? "text-green-600" : netDelta < 0 ? "text-destructive" : "text-primary"}`}>
                        {formatCurrency(alt.practiceNetBeforeOverhead)}
                      </span>
                      <span className={`text-[10px] font-medium block ${netDelta >= 0 ? "text-green-600" : "text-destructive"}`}>
                        {netDelta >= 0 ? "+" : ""}{formatCurrency(netDelta)}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* ── Desktop table (≥ 640px) ── */}
        <div className="hidden sm:block overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/40">
                <th className="text-left text-xs font-semibold text-muted-foreground py-3 pl-6 pr-3">Clinician</th>
                <th className="text-right text-xs font-semibold text-muted-foreground py-3 px-3">Current Class.</th>
                <th className="text-right text-xs font-semibold text-muted-foreground py-3 px-3">Clinician Take-Home</th>
                <th className="text-right text-xs font-semibold text-muted-foreground py-3 px-3">Employer Burden</th>
                <th className="text-right text-xs font-semibold text-muted-foreground py-3 px-3">Practice Net</th>
                <th className="text-right text-xs font-semibold text-muted-foreground py-3 px-3">Alt. Class.</th>
                <th className="text-right text-xs font-semibold text-muted-foreground py-3 px-3">Alt. Take-Home</th>
                <th className="text-right text-xs font-semibold text-muted-foreground py-3 px-3">Alt. Employer Burden</th>
                <th className="text-right text-xs font-semibold text-muted-foreground py-3 pl-3 pr-6">Alt. Practice Net</th>
              </tr>
            </thead>
            <tbody>
              {clinicians.map(c => {
                const isW2 = String(c.classification) === "w2";
                const actual = calculateClinicianMetrics(c);
                const alt = calculateClinicianMetrics({ ...c, classification: isW2 ? "1099" : "w2" });
                const takehomeDelta = alt.estimatedCompAfterPayrollTaxes - actual.estimatedCompAfterPayrollTaxes;
                const netDelta = alt.practiceNetBeforeOverhead - actual.practiceNetBeforeOverhead;

                return (
                  <tr key={c.id} className="border-b last:border-0 hover:bg-muted/20 transition-colors">
                    <td className="py-3 pl-6 pr-3 font-medium">{c.label}</td>
                    <td className="py-3 px-3 text-right">
                      <Badge variant={isW2 ? "default" : "outline"} className="text-[10px] uppercase">{c.classification}</Badge>
                    </td>
                    <td className="py-3 px-3 text-right font-medium">{formatCurrency(actual.estimatedCompAfterPayrollTaxes)}</td>
                    <td className="py-3 px-3 text-right">
                      {isW2 ? <span className="text-amber-600 font-medium">{formatCurrency(actual.employerObligations)}</span> : <span className="text-muted-foreground">—</span>}
                    </td>
                    <td className="py-3 px-3 text-right font-medium text-primary">{formatCurrency(actual.practiceNetBeforeOverhead)}</td>
                    <td className="py-3 px-3 text-right">
                      <Badge variant={isW2 ? "outline" : "default"} className="text-[10px] uppercase">{isW2 ? "1099" : "W2"}</Badge>
                    </td>
                    <td className="py-3 px-3 text-right">
                      <span className={`font-medium ${takehomeDelta > 0 ? "text-green-600" : takehomeDelta < 0 ? "text-destructive" : ""}`}>
                        {formatCurrency(alt.estimatedCompAfterPayrollTaxes)}
                      </span>
                      <span className={`block text-[10px] ${takehomeDelta >= 0 ? "text-green-600" : "text-destructive"}`}>
                        {takehomeDelta >= 0 ? "+" : ""}{formatCurrency(takehomeDelta)}
                      </span>
                    </td>
                    <td className="py-3 px-3 text-right">
                      {!isW2 ? <span className="text-amber-600 font-medium">{formatCurrency(alt.employerObligations)}</span> : <span className="text-muted-foreground">—</span>}
                    </td>
                    <td className="py-3 pl-3 pr-6 text-right">
                      <span className={`font-medium ${netDelta > 0 ? "text-green-600" : netDelta < 0 ? "text-destructive" : "text-primary"}`}>
                        {formatCurrency(alt.practiceNetBeforeOverhead)}
                      </span>
                      <span className={`block text-[10px] ${netDelta >= 0 ? "text-green-600" : "text-destructive"}`}>
                        {netDelta >= 0 ? "+" : ""}{formatCurrency(netDelta)}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="px-4 sm:px-6 py-3 border-t bg-muted/20 text-xs text-muted-foreground">
          W2: employer absorbs ~7.65% FICA match + FUTA/SUTA + workers' comp; employee pays 7.65% payroll tax. ·
          1099: no employer burden; contractor pays 15.3% self-employment tax.
        </div>
      </CardContent>
    </Card>
  );
}

export default function ClinicianImpactViewTab() {
  const { data: clinicians, isLoading: isLoadingClinicians } = useListClinicians();
  const { data: scenarios, isLoading: isLoadingScenarios } = useListScenarios();
  const { data: staffMembers } = useListStaffMembers();

  const totalStaffCost = staffMembers?.reduce((sum, s) => {
    const { totalAnnualCost } = calculateStaffMemberCost({
      annualSalary: s.annualSalary, hourlyRate: s.hourlyRate, hoursPerWeek: s.hoursPerWeek,
      weeksPerYear: s.weeksPerYear, classification: String(s.classification),
      w2EmployerFicaPct: s.w2EmployerFicaPct, futaSutaPct: s.futaSutaPct,
      workersCompPct: s.workersCompPct, otherEmployerBurdenPct: s.otherEmployerBurdenPct,
    });
    return sum + totalAnnualCost;
  }, 0) ?? 0;

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
          <p className="text-muted-foreground">See every clinician's production, compensation, and W2 vs 1099 impact.</p>
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
          Every clinician's production, compensation, employer burden, and classification impact — plus scenario comparison.
        </p>
      </div>

      {/* ── Section 1: All Clinicians Roster ── */}
      <TeamRosterSection clinicians={clinicians} totalStaffCost={totalStaffCost} />

      {/* ── Section 2: W2 vs 1099 Summary ── */}
      <W2vs1099SummarySection clinicians={clinicians} />

      {/* ── Section 3: Cross-Scenario Comparison ── */}
      <div className="space-y-4">
        <div>
          <h3 className="text-lg font-semibold">Per-Clinician Scenario Comparison</h3>
          <p className="text-sm text-muted-foreground">
            Select one clinician and two scenarios to compare their compensation outcomes side-by-side.
          </p>
        </div>

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
            Choose a clinician and two scenarios above to see a side-by-side comparison. The clinician must appear in both scenarios (imported or added with the same name).
          </div>
        )}

        {hasComparison && selectedClinician && (
          <div className="space-y-4">
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
                <ClassificationDeltaBadge clinician={selectedClinician} />
              </CardContent>
            </Card>

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
    </div>
  );
}
