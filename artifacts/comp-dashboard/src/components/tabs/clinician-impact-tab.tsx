import { useState } from "react";
import { useListClinicians } from "@workspace/api-client-react";
import type { Clinician } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { calculateClinicianMetrics } from "@/lib/calculations";
import { formatCurrency, formatPercent } from "@/lib/format";
import { ChevronDown, ChevronUp, Users } from "lucide-react";

function W2vs1099Row({ label, w2Val, c1099Val, format = "currency", higherIsBetter = true }: {
  label: string; w2Val: number; c1099Val: number;
  format?: "currency" | "percent" | "number"; higherIsBetter?: boolean;
}) {
  const fmt = (v: number) => format === "currency" ? formatCurrency(v) : format === "percent" ? formatPercent(v) : v.toFixed(1);
  const w2Better = higherIsBetter ? w2Val > c1099Val : w2Val < c1099Val;
  const c1099Better = higherIsBetter ? c1099Val > w2Val : c1099Val < w2Val;
  return (
    <div className="grid grid-cols-3 text-sm py-2 border-b last:border-0 items-center">
      <span className="text-muted-foreground text-xs">{label}</span>
      <span className={`text-center font-medium ${w2Better ? "text-green-600" : ""}`}>{fmt(w2Val)}</span>
      <span className={`text-center font-medium ${c1099Better ? "text-green-600" : ""}`}>{fmt(c1099Val)}</span>
    </div>
  );
}

function ClinicianImpactCard({ clinician }: { clinician: Clinician }) {
  const [expanded, setExpanded] = useState(false);

  const asW2 = calculateClinicianMetrics({ ...clinician, classification: "w2" });
  const as1099 = calculateClinicianMetrics({ ...clinician, classification: "1099" });
  const actual = calculateClinicianMetrics({ ...clinician, classification: String(clinician.classification) });

  const isW2 = String(clinician.classification) === "w2";

  return (
    <Card>
      <CardContent className="pt-4">
        <div className="flex items-start gap-3">
          <div className="flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-semibold">{clinician.label}</span>
              <Badge variant={isW2 ? "default" : "outline"} className="text-[10px] uppercase">
                {clinician.classification} (current)
              </Badge>
              <Badge variant="secondary" className="text-[10px] uppercase">{clinician.roleType}</Badge>
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {formatCurrency(clinician.sessionRate)}/session · {clinician.sessionsPerWeek} sessions/wk · {clinician.weeksWorkedPerYear} wks/yr
            </p>
          </div>
          <Button variant="ghost" size="sm" onClick={() => setExpanded(e => !e)}>
            {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            {expanded ? "Less" : "W2 vs 1099"}
          </Button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4 text-sm">
          <div>
            <span className="text-muted-foreground text-xs block">Annual Production</span>
            <span className="font-semibold">{formatCurrency(actual.annualProduction)}</span>
          </div>
          <div>
            <span className="text-muted-foreground text-xs block">Clinician Comp</span>
            <span className="font-semibold text-green-600">{formatCurrency(actual.clinicianCompensation)}</span>
          </div>
          <div>
            <span className="text-muted-foreground text-xs block">Est. Take-Home</span>
            <span className="font-semibold">{formatCurrency(actual.estimatedCompAfterPayrollTaxes)}</span>
            <span className="text-muted-foreground text-[10px] block">(after est. payroll tax)</span>
          </div>
          <div>
            <span className="text-muted-foreground text-xs block">Practice Net</span>
            <span className="font-semibold text-primary">{formatCurrency(actual.practiceNetBeforeOverhead)}</span>
          </div>
        </div>

        {isW2 && (
          <div className="mt-3 p-3 bg-blue-50 border border-blue-200 rounded-lg text-sm">
            <p className="text-xs font-semibold text-blue-800 mb-1">W2 Employer Obligations</p>
            <div className="grid grid-cols-2 gap-2 text-xs text-blue-700">
              <span>Employer FICA: {formatCurrency(actual.clinicianCompensation * (clinician.w2EmployerFicaPct / 100))}</span>
              <span>Workers' Comp: {formatCurrency(actual.clinicianCompensation * (clinician.workersCompPct / 100))}</span>
              <span>FUTA/SUTA: {formatCurrency(actual.clinicianCompensation * (clinician.futaSutaPct / 100))}</span>
              <span className="font-semibold">Total: {formatCurrency(actual.employerObligations)}</span>
            </div>
          </div>
        )}

        {expanded && (
          <div className="mt-4 pt-4 border-t">
            <p className="text-sm font-medium mb-3">W2 vs 1099 Classification Comparison</p>
            <p className="text-xs text-muted-foreground mb-3">
              Using the same session rate and split structure — only the payroll tax treatment changes. Green = more favorable for that party.
            </p>
            <div className="grid grid-cols-3 py-2 mb-1">
              <div />
              <p className="text-xs font-semibold text-center text-muted-foreground uppercase tracking-wider">W2</p>
              <p className="text-xs font-semibold text-center text-muted-foreground uppercase tracking-wider">1099</p>
            </div>
            <W2vs1099Row label="Clinician Gross Comp" w2Val={asW2.clinicianCompensation} c1099Val={as1099.clinicianCompensation} />
            <W2vs1099Row label="Clinician Payroll Tax" w2Val={asW2.clinicianPayrollTaxEstimate} c1099Val={as1099.clinicianPayrollTaxEstimate} higherIsBetter={false} />
            <W2vs1099Row label="Clinician Est. Take-Home" w2Val={asW2.estimatedCompAfterPayrollTaxes} c1099Val={as1099.estimatedCompAfterPayrollTaxes} />
            <W2vs1099Row label="Employer Obligations" w2Val={asW2.employerObligations} c1099Val={as1099.employerObligations} higherIsBetter={false} />
            <W2vs1099Row label="Practice Net (before overhead)" w2Val={asW2.practiceNetBeforeOverhead} c1099Val={as1099.practiceNetBeforeOverhead} />

            <div className="mt-3 p-3 rounded-lg bg-muted/50 text-xs text-muted-foreground">
              <strong>Note:</strong> W2 employees pay 7.65% payroll tax; 1099 contractors pay 15.3% self-employment tax on gross earnings.
              Practice takes on FICA match, FUTA/SUTA, and workers' comp for W2 employees — increasing total cost but offering compliance clarity.
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function ClinicianImpactViewTab() {
  const { data: clinicians, isLoading } = useListClinicians();

  if (isLoading) return <div className="p-8 text-muted-foreground">Loading clinicians...</div>;

  const w2 = clinicians?.filter(c => String(c.classification) === "w2") ?? [];
  const c1099 = clinicians?.filter(c => String(c.classification) === "1099") ?? [];

  const allMetrics = clinicians?.map(c => calculateClinicianMetrics({ ...c, classification: String(c.classification) })) ?? [];
  const totalProduction = allMetrics.reduce((s, m) => s + m.annualProduction, 0);
  const totalComp = allMetrics.reduce((s, m) => s + m.clinicianCompensation, 0);
  const totalBurden = allMetrics.reduce((s, m) => s + m.employerObligations, 0);
  const totalPracticeNet = allMetrics.reduce((s, m) => s + m.practiceNetBeforeOverhead, 0);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Clinician Impact View</h2>
        <p className="text-muted-foreground">Per-clinician breakdown with W2 vs 1099 classification comparison.</p>
      </div>

      {(!clinicians || clinicians.length === 0) ? (
        <Card className="flex flex-col items-center justify-center p-12 text-center">
          <div className="rounded-full bg-primary/10 p-4 mb-4">
            <Users className="h-8 w-8 text-primary" />
          </div>
          <h3 className="text-lg font-medium">No Clinicians Found</h3>
          <p className="text-muted-foreground max-w-sm mt-2">
            Add clinicians in the Team Builder tab first.
          </p>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Card><CardContent className="pt-4">
              <span className="text-muted-foreground text-xs block">Total Production</span>
              <span className="text-xl font-bold">{formatCurrency(totalProduction)}</span>
              <span className="text-xs text-muted-foreground block">{clinicians.length} clinician{clinicians.length !== 1 ? "s" : ""}</span>
            </CardContent></Card>
            <Card><CardContent className="pt-4">
              <span className="text-muted-foreground text-xs block">Total Comp Paid Out</span>
              <span className="text-xl font-bold text-green-600">{formatCurrency(totalComp)}</span>
            </CardContent></Card>
            <Card><CardContent className="pt-4">
              <span className="text-muted-foreground text-xs block">Total Employer Burden</span>
              <span className="text-xl font-bold text-amber-600">{formatCurrency(totalBurden)}</span>
              <span className="text-xs text-muted-foreground block">{w2.length} W2, {c1099.length} 1099</span>
            </CardContent></Card>
            <Card><CardContent className="pt-4">
              <span className="text-muted-foreground text-xs block">Practice Net</span>
              <span className="text-xl font-bold text-primary">{formatCurrency(totalPracticeNet)}</span>
            </CardContent></Card>
          </div>

          <div className="space-y-4">
            {clinicians.map(c => <ClinicianImpactCard key={c.id} clinician={c} />)}
          </div>
        </>
      )}
    </div>
  );
}
