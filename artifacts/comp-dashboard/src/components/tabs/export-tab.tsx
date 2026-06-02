import { useState } from "react";
import { useListClinicians, useListScenarios, useGetScenario, useListBusinessGoals, useGetCurrentReality, getGetScenarioQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Download, FileText, Loader2 } from "lucide-react";
import { calculateClinicianMetrics, calculateBusinessGoalOutputs, calculateCurrentRealityGap } from "@/lib/calculations";
import { formatCurrency } from "@/lib/format";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

const BRAND_COLOR: [number, number, number] = [30, 64, 175];
const HEADER_GRAY: [number, number, number] = [243, 244, 246];

function addPageHeader(doc: jsPDF, title: string, subtitle: string) {
  doc.setFillColor(...BRAND_COLOR);
  doc.rect(0, 0, 210, 18, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(13);
  doc.setFont("helvetica", "bold");
  doc.text(title, 14, 11);
  doc.setFontSize(8);
  doc.setFont("helvetica", "normal");
  doc.text(subtitle, 14, 16);
  doc.setTextColor(0, 0, 0);
}

function addSectionTitle(doc: jsPDF, title: string, y: number) {
  doc.setFontSize(10);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(...BRAND_COLOR);
  doc.text(title, 14, y);
  doc.setTextColor(0, 0, 0);
  doc.setFont("helvetica", "normal");
}

function sectionY(doc: jsPDF) {
  return (doc as jsPDF & { lastAutoTable: { finalY: number } }).lastAutoTable?.finalY ?? 0;
}

function useScenarioForExport(id: number | null) {
  return useGetScenario(id ?? 0, { query: { queryKey: getGetScenarioQueryKey(id ?? 0), enabled: id !== null && id > 0 } });
}

export default function PDFExportTab() {
  const { data: clinicians } = useListClinicians();
  const { data: scenarios } = useListScenarios();
  const { data: goals } = useListBusinessGoals();
  const { data: currentReality } = useGetCurrentReality();

  const [selectedScenarioId, setSelectedScenarioId] = useState<number | null>(null);
  const [compScenA, setCompScenA] = useState<number | null>(null);
  const [compScenB, setCompScenB] = useState<number | null>(null);
  const [loading, setLoading] = useState<string | null>(null);

  const { data: selectedScenario } = useScenarioForExport(selectedScenarioId);
  const { data: scenA } = useScenarioForExport(compScenA);
  const { data: scenB } = useScenarioForExport(compScenB);

  const generateInternalReport = () => {
    setLoading("internal");
    setTimeout(() => {
      try {
        const doc = new jsPDF();
        const date = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
        addPageHeader(doc, "Compensation Strategy — Internal Report", `Generated ${date}`);

        if (goals && goals.length > 0) {
          addSectionTitle(doc, "Business Goals", 28);
          autoTable(doc, {
            startY: 32,
            head: [["Goal Name", "Horizon", "Total Business Need", "Req. Net / Clinician", "Desired Clinicians"]],
            body: goals.map(g => {
              const o = calculateBusinessGoalOutputs(g);
              return [g.name, g.timeHorizon, formatCurrency(o.totalAnnualBusinessNeed), formatCurrency(o.requiredNetPerClinician), g.desiredCliniciansCount];
            }),
            styles: { fontSize: 8 },
            headStyles: { fillColor: BRAND_COLOR },
          });
        }

        if (currentReality) {
          const y = sectionY(doc) + 8;
          addSectionTitle(doc, "Current Reality", y);
          const linkedGoal = goals?.[0];
          const gap = calculateCurrentRealityGap(currentReality, linkedGoal);
          autoTable(doc, {
            startY: y + 4,
            head: [["Metric", "Value"]],
            body: [
              ["Current Clinicians", currentReality.currentCliniciansCount],
              ["Avg Session Rate", formatCurrency(currentReality.currentAvgSessionRate)],
              ["Avg Sessions/Week", currentReality.currentAvgSessionsPerWeek],
              ["Owner Pay", formatCurrency(currentReality.currentOwnerPay)],
              ["Annual Overhead", formatCurrency(currentReality.currentAnnualOverhead)],
              ["Business Profit", formatCurrency(currentReality.currentBusinessProfit)],
              ...(gap && linkedGoal ? [
                ["Est. Annual Production", formatCurrency(gap.currentAnnualProductionEstimate)],
                ["Gap to Goal (" + linkedGoal.name + ")", formatCurrency(gap.gapToGoal)],
                ["Goal Achieved %", gap.percentAchieved.toFixed(1) + "%"],
              ] : []),
            ],
            styles: { fontSize: 8 },
            headStyles: { fillColor: HEADER_GRAY as [number,number,number], textColor: [0,0,0] as [number,number,number] },
            columnStyles: { 0: { fontStyle: "bold" } },
          });
        }

        if (clinicians && clinicians.length > 0) {
          const y = sectionY(doc) + 8;
          if (y > 240) doc.addPage();
          const titleY = y > 240 ? 22 : y;
          addSectionTitle(doc, "Clinician Compensation Summary", titleY);
          autoTable(doc, {
            startY: titleY + 4,
            head: [["Name", "Type", "Classification", "Annual Production", "Comp", "Employer Burden", "Practice Net"]],
            body: clinicians.map(c => {
              const m = calculateClinicianMetrics({ ...c, classification: String(c.classification) });
              return [c.label, c.roleType, c.classification, formatCurrency(m.annualProduction), formatCurrency(m.clinicianCompensation), formatCurrency(m.employerObligations), formatCurrency(m.practiceNetBeforeOverhead)];
            }),
            styles: { fontSize: 7 },
            headStyles: { fillColor: BRAND_COLOR },
            foot: [["", "", "TOTALS",
              formatCurrency(clinicians.reduce((s,c) => s + calculateClinicianMetrics({...c,classification:String(c.classification)}).annualProduction, 0)),
              formatCurrency(clinicians.reduce((s,c) => s + calculateClinicianMetrics({...c,classification:String(c.classification)}).clinicianCompensation, 0)),
              formatCurrency(clinicians.reduce((s,c) => s + calculateClinicianMetrics({...c,classification:String(c.classification)}).employerObligations, 0)),
              formatCurrency(clinicians.reduce((s,c) => s + calculateClinicianMetrics({...c,classification:String(c.classification)}).practiceNetBeforeOverhead, 0)),
            ]],
            footStyles: { fillColor: HEADER_GRAY as [number,number,number], textColor: [0,0,0] as [number,number,number], fontStyle: "bold" },
          });
        }

        doc.save(`compensation-internal-report-${Date.now()}.pdf`);
      } finally { setLoading(null); }
    }, 50);
  };

  const generateClinicianSummary = () => {
    if (!selectedScenario && !clinicians?.length) return;
    setLoading("clinician");
    setTimeout(() => {
      try {
        const doc = new jsPDF();
        const date = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
        addPageHeader(doc, "Clinician Offer Summary", `Prepared ${date}`);

        const clxList = selectedScenario?.clinicians ?? clinicians ?? [];

        addSectionTitle(doc, "Compensation Overview", 28);
        autoTable(doc, {
          startY: 32,
          head: [["Clinician", "Classification", "Session Rate", "Split (Pre→Post Cap)", "Annual Comp Est.", "Est. Take-Home"]],
          body: clxList.map(c => {
            const m = calculateClinicianMetrics({ ...c, classification: String(c.classification) });
            const split = c.capEnabled
              ? `${c.preCapClinicianSplit}% → ${c.postCapClinicianSplit}%`
              : `${c.preCapClinicianSplit}%`;
            return [
              c.label,
              String(c.classification).toUpperCase(),
              formatCurrency(c.sessionRate),
              split,
              formatCurrency(m.clinicianCompensation),
              formatCurrency(m.estimatedCompAfterPayrollTaxes),
            ];
          }),
          styles: { fontSize: 8 },
          headStyles: { fillColor: BRAND_COLOR },
        });

        const y = sectionY(doc) + 8;
        doc.setFontSize(8);
        doc.setTextColor(120, 120, 120);
        doc.text("Estimates are based on projected session volume. Actual compensation may vary. Practice overhead and goals are not shown in this summary.", 14, y);
        doc.text("W2 employees pay ~7.65% payroll tax. 1099 contractors pay ~15.3% self-employment tax. Consult a tax professional for guidance.", 14, y + 5);

        doc.save(`clinician-offer-summary-${Date.now()}.pdf`);
      } finally { setLoading(null); }
    }, 50);
  };

  const generateComparisonReport = () => {
    if (!scenA || !scenB) return;
    setLoading("comparison");
    setTimeout(() => {
      try {
        const doc = new jsPDF();
        const date = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
        addPageHeader(doc, "Scenario Comparison Report", `Generated ${date}`);

        const metricsFor = (scen: typeof scenA) => {
          const cl = scen?.clinicians ?? [];
          return {
            production: cl.reduce((s, c) => s + calculateClinicianMetrics(c).annualProduction, 0),
            comp: cl.reduce((s, c) => s + calculateClinicianMetrics(c).clinicianCompensation, 0),
            burden: cl.reduce((s, c) => s + calculateClinicianMetrics(c).employerObligations, 0),
            net: cl.reduce((s, c) => s + calculateClinicianMetrics(c).practiceNetBeforeOverhead, 0),
            count: cl.length,
          };
        };

        const mA = metricsFor(scenA);
        const mB = metricsFor(scenB);

        addSectionTitle(doc, "Summary Comparison", 28);
        autoTable(doc, {
          startY: 32,
          head: [["Metric", scenA.name, scenB.name, "Difference"]],
          body: [
            ["Total Annual Production", formatCurrency(mA.production), formatCurrency(mB.production), formatCurrency(mB.production - mA.production)],
            ["Total Clinician Comp", formatCurrency(mA.comp), formatCurrency(mB.comp), formatCurrency(mB.comp - mA.comp)],
            ["Total Employer Burden", formatCurrency(mA.burden), formatCurrency(mB.burden), formatCurrency(mB.burden - mA.burden)],
            ["Total Comp Cost", formatCurrency(mA.comp + mA.burden), formatCurrency(mB.comp + mB.burden), formatCurrency((mB.comp + mB.burden) - (mA.comp + mA.burden))],
            ["Practice Net (before overhead)", formatCurrency(mA.net), formatCurrency(mB.net), formatCurrency(mB.net - mA.net)],
            ["Clinician Count", mA.count, mB.count, mB.count - mA.count],
          ],
          styles: { fontSize: 8 },
          headStyles: { fillColor: BRAND_COLOR },
          columnStyles: { 3: { fontStyle: "italic" } },
        });

        const yA = sectionY(doc) + 8;
        addSectionTitle(doc, `${scenA.name} — Clinician Detail`, yA);
        autoTable(doc, {
          startY: yA + 4,
          head: [["Name", "Type", "Session Rate", "Annual Comp", "Practice Net"]],
          body: (scenA.clinicians ?? []).map(c => {
            const m = calculateClinicianMetrics(c);
            return [c.label, String(c.classification).toUpperCase(), formatCurrency(c.sessionRate), formatCurrency(m.clinicianCompensation), formatCurrency(m.practiceNetBeforeOverhead)];
          }),
          styles: { fontSize: 7 },
          headStyles: { fillColor: [59, 130, 246] as [number,number,number] },
        });

        const yB = sectionY(doc) + 8;
        if (yB > 220) doc.addPage();
        const titleYB = yB > 220 ? 22 : yB;
        addSectionTitle(doc, `${scenB.name} — Clinician Detail`, titleYB);
        autoTable(doc, {
          startY: titleYB + 4,
          head: [["Name", "Type", "Session Rate", "Annual Comp", "Practice Net"]],
          body: (scenB.clinicians ?? []).map(c => {
            const m = calculateClinicianMetrics(c);
            return [c.label, String(c.classification).toUpperCase(), formatCurrency(c.sessionRate), formatCurrency(m.clinicianCompensation), formatCurrency(m.practiceNetBeforeOverhead)];
          }),
          styles: { fontSize: 7 },
          headStyles: { fillColor: [107, 114, 128] as [number,number,number] },
        });

        doc.save(`scenario-comparison-${Date.now()}.pdf`);
      } finally { setLoading(null); }
    }, 50);
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Export Reports</h2>
        <p className="text-muted-foreground">Generate professional PDF summaries for internal use or clinician communication.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5 text-primary" />
              Internal Scenario Report
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Comprehensive report with all business goals, current reality, and per-clinician compensation breakdown.
              Uses all data from Team Builder.
            </p>
            <Button className="w-full" onClick={generateInternalReport} disabled={loading === "internal"}>
              {loading === "internal" ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Download className="h-4 w-4 mr-2" />}
              Generate PDF
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5 text-primary" />
              Clinician Offer Summary
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Clean summary for clinicians — shows comp estimates and split structure without internal practice financials.
            </p>
            <div className="space-y-2">
              <Label className="text-xs">Optional: Limit to a specific scenario</Label>
              <Select
                value={selectedScenarioId?.toString() ?? "all"}
                onValueChange={v => setSelectedScenarioId(v === "all" ? null : Number(v))}
              >
                <SelectTrigger><SelectValue placeholder="All clinicians (Team Builder)" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All clinicians (Team Builder)</SelectItem>
                  {scenarios?.map(s => <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <Button className="w-full" onClick={generateClinicianSummary} disabled={loading === "clinician"}>
              {loading === "clinician" ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Download className="h-4 w-4 mr-2" />}
              Generate PDF
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5 text-primary" />
              Scenario Comparison Report
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Side-by-side comparison of two scenarios with clinician detail tables and net revenue deltas.
            </p>
            <div className="space-y-2">
              <Label className="text-xs">Scenario A</Label>
              <Select
                value={compScenA?.toString() ?? ""}
                onValueChange={v => setCompScenA(Number(v))}
              >
                <SelectTrigger><SelectValue placeholder="Select scenario A…" /></SelectTrigger>
                <SelectContent>
                  {scenarios?.map(s => <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>)}
                </SelectContent>
              </Select>
              <Label className="text-xs">Scenario B</Label>
              <Select
                value={compScenB?.toString() ?? ""}
                onValueChange={v => setCompScenB(Number(v))}
              >
                <SelectTrigger><SelectValue placeholder="Select scenario B…" /></SelectTrigger>
                <SelectContent>
                  {scenarios?.map(s => <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <Button
              className="w-full"
              onClick={generateComparisonReport}
              disabled={loading === "comparison" || !compScenA || !compScenB || !scenA || !scenB}
            >
              {loading === "comparison" ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Download className="h-4 w-4 mr-2" />}
              Generate PDF
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
