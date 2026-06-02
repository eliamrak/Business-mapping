import { useState } from "react";
import { useListClinicians, useListScenarios, useGetScenario, useListBusinessGoals, useGetCurrentReality, getGetScenarioQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Download, FileText, Loader2 } from "lucide-react";
import { calculateClinicianMetrics, calculateBusinessGoalOutputs, calculateCurrentRealityGap } from "@/lib/calculations";
import { formatCurrency } from "@/lib/format";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

const BRAND_COLOR: [number, number, number] = [30, 64, 175];
const HEADER_GRAY: [number, number, number] = [243, 244, 246];

function addPageHeader(doc: jsPDF, practiceName: string, title: string, subtitle: string) {
  doc.setFillColor(...BRAND_COLOR);
  doc.rect(0, 0, 210, 20, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(8);
  doc.setFont("helvetica", "normal");
  if (practiceName) {
    doc.text(practiceName.toUpperCase(), 14, 7);
  }
  doc.setFontSize(13);
  doc.setFont("helvetica", "bold");
  doc.text(title, 14, practiceName ? 14 : 11);
  doc.setFontSize(8);
  doc.setFont("helvetica", "normal");
  doc.text(subtitle, 14, practiceName ? 19 : 16);
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

  const [practiceName, setPracticeName] = useState("");
  const [selectedScenarioId, setSelectedScenarioId] = useState<number | null>(null);
  const [loading, setLoading] = useState<string | null>(null);

  const { data: selectedScenario } = useScenarioForExport(selectedScenarioId);

  const generateInternalReport = () => {
    setLoading("internal");
    setTimeout(() => {
      try {
        const doc = new jsPDF();
        const date = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
        addPageHeader(doc, practiceName, "Compensation Strategy — Internal Report", `Generated ${date}`);

        const startY = 28;

        if (goals && goals.length > 0) {
          addSectionTitle(doc, "Business Goals", startY);
          autoTable(doc, {
            startY: startY + 4,
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
          const linkedGoal = goals?.[0];
          const gap = calculateCurrentRealityGap(currentReality, linkedGoal);

          const y = sectionY(doc) + 8;
          addSectionTitle(doc, "Current Reality — Practice Overview", y);
          autoTable(doc, {
            startY: y + 4,
            head: [["Metric", "Value"]],
            body: [
              ["Current Clinicians", currentReality.currentCliniciansCount],
              ["Avg Session Rate", formatCurrency(currentReality.currentAvgSessionRate)],
              ["Avg Sessions/Week", currentReality.currentAvgSessionsPerWeek],
              ["Avg Weeks Worked/Year", currentReality.currentAvgWeeksWorkedPerYear],
              ...(gap ? [["Est. Annual Production", formatCurrency(gap.currentAnnualProductionEstimate)]] : []),
              ...(gap && linkedGoal ? [
                ["Gap to Goal (" + linkedGoal.name + ")", formatCurrency(gap.gapToGoal)],
                ["Goal Achieved %", gap.percentAchieved.toFixed(1) + "%"],
              ] : []),
            ],
            styles: { fontSize: 8 },
            headStyles: { fillColor: HEADER_GRAY as [number, number, number], textColor: [0, 0, 0] as [number, number, number] },
            columnStyles: { 0: { fontStyle: "bold" } },
          });

          const obY = sectionY(doc) + 8;
          if (obY > 220) doc.addPage();
          const obTitleY = obY > 220 ? 28 : obY;
          addSectionTitle(doc, "Overhead & Financial Breakdown — Goal vs. Current", obTitleY);
          const goalRow = linkedGoal ?? null;
          autoTable(doc, {
            startY: obTitleY + 4,
            head: [["Financial Component", "Goal", "Current", "Gap"]],
            body: [
              [
                "Owner Pay",
                goalRow ? formatCurrency(goalRow.ownerPayGoal) : "—",
                formatCurrency(currentReality.currentOwnerPay),
                goalRow ? formatCurrency((goalRow.ownerPayGoal || 0) - currentReality.currentOwnerPay) : "—",
              ],
              [
                "2nd Owner Pay",
                goalRow ? formatCurrency(goalRow.secondOwnerPayGoal) : "—",
                formatCurrency(currentReality.currentSecondOwnerPay),
                goalRow ? formatCurrency((goalRow.secondOwnerPayGoal || 0) - currentReality.currentSecondOwnerPay) : "—",
              ],
              [
                "Annual Overhead",
                goalRow ? formatCurrency(goalRow.annualOverheadGoal) : "—",
                formatCurrency(currentReality.currentAnnualOverhead),
                goalRow ? formatCurrency((goalRow.annualOverheadGoal || 0) - currentReality.currentAnnualOverhead) : "—",
              ],
              [
                "Business Profit",
                goalRow ? formatCurrency(goalRow.businessProfitGoal) : "—",
                formatCurrency(currentReality.currentBusinessProfit),
                goalRow ? formatCurrency((goalRow.businessProfitGoal || 0) - currentReality.currentBusinessProfit) : "—",
              ],
              [
                "Building Fund",
                goalRow ? formatCurrency(goalRow.buildingFundGoal) : "—",
                formatCurrency(currentReality.currentBuildingFund),
                goalRow ? formatCurrency((goalRow.buildingFundGoal || 0) - currentReality.currentBuildingFund) : "—",
              ],
              [
                "Emergency Reserve",
                goalRow ? formatCurrency(goalRow.emergencyReserveGoal) : "—",
                formatCurrency(currentReality.currentCashReserve),
                goalRow ? formatCurrency((goalRow.emergencyReserveGoal || 0) - currentReality.currentCashReserve) : "—",
              ],
              [
                "Growth Fund",
                goalRow ? formatCurrency(goalRow.growthFundGoal) : "—",
                "—",
                goalRow ? formatCurrency(goalRow.growthFundGoal || 0) : "—",
              ],
            ],
            styles: { fontSize: 8 },
            headStyles: { fillColor: BRAND_COLOR },
            columnStyles: { 0: { fontStyle: "bold" } },
            foot: goalRow ? [[
              "TOTAL",
              formatCurrency(calculateBusinessGoalOutputs(goalRow).totalAnnualBusinessNeed),
              formatCurrency(
                (currentReality.currentOwnerPay || 0) +
                (currentReality.currentSecondOwnerPay || 0) +
                (currentReality.currentAnnualOverhead || 0) +
                (currentReality.currentBusinessProfit || 0) +
                (currentReality.currentBuildingFund || 0) +
                (currentReality.currentCashReserve || 0)
              ),
              gap ? formatCurrency(gap.gapToGoal) : "—",
            ]] : undefined,
            footStyles: { fillColor: HEADER_GRAY as [number, number, number], textColor: [0, 0, 0] as [number, number, number], fontStyle: "bold" },
          });
        }

        if (clinicians && clinicians.length > 0) {
          const y = sectionY(doc) + 8;
          if (y > 240) doc.addPage();
          const titleY = y > 240 ? 28 : y;
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
              formatCurrency(clinicians.reduce((s, c) => s + calculateClinicianMetrics({ ...c, classification: String(c.classification) }).annualProduction, 0)),
              formatCurrency(clinicians.reduce((s, c) => s + calculateClinicianMetrics({ ...c, classification: String(c.classification) }).clinicianCompensation, 0)),
              formatCurrency(clinicians.reduce((s, c) => s + calculateClinicianMetrics({ ...c, classification: String(c.classification) }).employerObligations, 0)),
              formatCurrency(clinicians.reduce((s, c) => s + calculateClinicianMetrics({ ...c, classification: String(c.classification) }).practiceNetBeforeOverhead, 0)),
            ]],
            footStyles: { fillColor: HEADER_GRAY as [number, number, number], textColor: [0, 0, 0] as [number, number, number], fontStyle: "bold" },
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
        addPageHeader(doc, practiceName, "Clinician Compensation Sheet", `Prepared ${date}`);

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

        doc.save(`clinician-compensation-sheet-${Date.now()}.pdf`);
      } finally { setLoading(null); }
    }, 50);
  };

  const generatePracticeFinancialSummary = () => {
    setLoading("financial");
    setTimeout(() => {
      try {
        const doc = new jsPDF();
        const date = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
        addPageHeader(doc, practiceName, "Practice Financial Summary", `Generated ${date}`);

        const startY = 28;

        if (goals && goals.length > 0 && currentReality) {
          addSectionTitle(doc, "Goal vs. Current Reality", startY);
          const rows = goals.map(g => {
            const o = calculateBusinessGoalOutputs(g);
            const gap = calculateCurrentRealityGap(currentReality, g);
            return [
              g.name,
              g.timeHorizon,
              formatCurrency(o.totalAnnualBusinessNeed),
              formatCurrency(o.requiredNetPerClinician),
              gap ? gap.percentAchieved.toFixed(1) + "%" : "—",
              gap ? formatCurrency(gap.gapToGoal) : "—",
            ];
          });
          autoTable(doc, {
            startY: startY + 4,
            head: [["Goal", "Horizon", "Total Need", "Net/Clinician Needed", "% Achieved", "Gap"]],
            body: rows,
            styles: { fontSize: 8 },
            headStyles: { fillColor: BRAND_COLOR },
          });
        } else if (goals && goals.length > 0) {
          addSectionTitle(doc, "Business Goals", startY);
          autoTable(doc, {
            startY: startY + 4,
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
          addSectionTitle(doc, "Current Practice Financials", y);
          autoTable(doc, {
            startY: y + 4,
            head: [["Financial Component", "Current Annual"]],
            body: [
              ["Owner Pay", formatCurrency(currentReality.currentOwnerPay)],
              ["2nd Owner Pay", formatCurrency(currentReality.currentSecondOwnerPay)],
              ["Annual Overhead", formatCurrency(currentReality.currentAnnualOverhead)],
              ["Business Profit", formatCurrency(currentReality.currentBusinessProfit)],
              ["Building Fund", formatCurrency(currentReality.currentBuildingFund)],
              ["Cash Reserve", formatCurrency(currentReality.currentCashReserve)],
            ],
            styles: { fontSize: 8 },
            headStyles: { fillColor: HEADER_GRAY as [number, number, number], textColor: [0, 0, 0] as [number, number, number] },
            columnStyles: { 0: { fontStyle: "bold" } },
            foot: [[
              "TOTAL",
              formatCurrency(
                (currentReality.currentOwnerPay || 0) +
                (currentReality.currentSecondOwnerPay || 0) +
                (currentReality.currentAnnualOverhead || 0) +
                (currentReality.currentBusinessProfit || 0) +
                (currentReality.currentBuildingFund || 0) +
                (currentReality.currentCashReserve || 0)
              ),
            ]],
            footStyles: { fillColor: HEADER_GRAY as [number, number, number], textColor: [0, 0, 0] as [number, number, number], fontStyle: "bold" },
          });
        }

        if (clinicians && clinicians.length > 0) {
          const y = sectionY(doc) + 8;
          if (y > 220) doc.addPage();
          const titleY = y > 220 ? 28 : y;

          const totalProduction = clinicians.reduce((s, c) => s + calculateClinicianMetrics({ ...c, classification: String(c.classification) }).annualProduction, 0);
          const totalComp = clinicians.reduce((s, c) => s + calculateClinicianMetrics({ ...c, classification: String(c.classification) }).clinicianCompensation, 0);
          const totalBurden = clinicians.reduce((s, c) => s + calculateClinicianMetrics({ ...c, classification: String(c.classification) }).employerObligations, 0);
          const totalPracticeNet = clinicians.reduce((s, c) => s + calculateClinicianMetrics({ ...c, classification: String(c.classification) }).practiceNetBeforeOverhead, 0);
          const netAfterOverhead = currentReality
            ? totalPracticeNet - (currentReality.currentAnnualOverhead || 0)
            : null;

          addSectionTitle(doc, "Net Revenue Projections (Team Builder)", titleY);
          autoTable(doc, {
            startY: titleY + 4,
            head: [["Metric", "Projected Annual"]],
            body: [
              ["Total Gross Production", formatCurrency(totalProduction)],
              ["Total Clinician Compensation", formatCurrency(totalComp)],
              ["Total Employer Burden (W2)", formatCurrency(totalBurden)],
              ["Practice Net (before overhead)", formatCurrency(totalPracticeNet)],
              ["Annual Overhead (current)", currentReality ? formatCurrency(currentReality.currentAnnualOverhead) : "—"],
              ["Projected Net After Overhead", netAfterOverhead !== null ? formatCurrency(netAfterOverhead) : "—"],
            ],
            styles: { fontSize: 8 },
            headStyles: { fillColor: BRAND_COLOR },
            columnStyles: { 0: { fontStyle: "bold" } },
          });

          if (goals && goals.length > 0) {
            const projY = sectionY(doc) + 8;
            if (projY > 220) doc.addPage();
            const projTitleY = projY > 220 ? 28 : projY;
            addSectionTitle(doc, "Goal Achievement Outlook", projTitleY);
            autoTable(doc, {
              startY: projTitleY + 4,
              head: [["Goal", "Business Need", "Projected Net After Overhead", "Surplus / Shortfall"]],
              body: goals.map(g => {
                const o = calculateBusinessGoalOutputs(g);
                const surplus = netAfterOverhead !== null
                  ? netAfterOverhead - o.totalAnnualBusinessNeed
                  : null;
                return [
                  g.name,
                  formatCurrency(o.totalAnnualBusinessNeed),
                  netAfterOverhead !== null ? formatCurrency(netAfterOverhead) : "—",
                  surplus !== null ? formatCurrency(surplus) : "—",
                ];
              }),
              styles: { fontSize: 8 },
              headStyles: { fillColor: BRAND_COLOR },
            });
          }
        }

        doc.save(`practice-financial-summary-${Date.now()}.pdf`);
      } finally { setLoading(null); }
    }, 50);
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Export Reports</h2>
        <p className="text-muted-foreground">Generate professional PDF summaries for internal use or clinician communication.</p>
      </div>

      <div className="max-w-sm space-y-1">
        <Label htmlFor="practice-name" className="text-sm font-medium">Practice Name (for PDF headers)</Label>
        <Input
          id="practice-name"
          placeholder="e.g. Sunrise Counseling"
          value={practiceName}
          onChange={e => setPracticeName(e.target.value)}
        />
        <p className="text-xs text-muted-foreground">Appears in the header of every exported PDF.</p>
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
              Comprehensive internal report with all business goals, overhead breakdown, and per-clinician compensation.
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
              Clinician Communication Sheet
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
              Practice Financial Summary
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Goal vs. reality comparison with net revenue projections — ideal for your accountant or financial review.
            </p>
            <Button className="w-full" onClick={generatePracticeFinancialSummary} disabled={loading === "financial"}>
              {loading === "financial" ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Download className="h-4 w-4 mr-2" />}
              Generate PDF
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
