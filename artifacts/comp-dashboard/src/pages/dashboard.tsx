import { useState } from "react";
import { LayoutDashboard, Download, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import SandboxView from "@/components/sandbox-view";
import PDFExportTab from "@/components/tabs/export-tab";
import BusinessGoalsTab from "@/components/tabs/business-goals-tab";
import TeamBuilderTab from "@/components/tabs/team-builder-tab";
import ScenarioBuilderTab from "@/components/tabs/scenario-builder-tab";
import ScenarioComparisonTab from "@/components/tabs/scenario-comparison-tab";
import ClinicianImpactViewTab from "@/components/tabs/clinician-impact-tab";
import CurrentRealityTab from "@/components/tabs/current-reality-tab";

const ADVANCED_TABS = [
  { id: "goals", label: "Business Goals", component: BusinessGoalsTab },
  { id: "reality", label: "Current Reality", component: CurrentRealityTab },
  { id: "team", label: "Team Builder", component: TeamBuilderTab },
  { id: "scenarios", label: "Scenario Builder", component: ScenarioBuilderTab },
  { id: "compare", label: "Comparison", component: ScenarioComparisonTab },
  { id: "impact", label: "Clinician Impact", component: ClinicianImpactViewTab },
];

export default function Dashboard() {
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [advancedTab, setAdvancedTab] = useState("goals");
  const [exportOpen, setExportOpen] = useState(false);

  const ActiveAdvancedTab = ADVANCED_TABS.find(t => t.id === advancedTab)?.component ?? BusinessGoalsTab;

  return (
    <div className="min-h-screen bg-background flex flex-col font-sans">
      <header className="border-b bg-card shadow-sm sticky top-0 z-10">
        <div className="container mx-auto px-3 sm:px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3 text-primary">
            <div className="bg-primary/10 p-1.5 rounded-md shrink-0">
              <LayoutDashboard className="h-4 w-4 text-primary" />
            </div>
            <h1 className="text-base sm:text-lg font-semibold tracking-tight text-foreground truncate">
              <span className="hidden sm:inline">Comp Strategy Dashboard</span>
              <span className="sm:hidden">Comp Dashboard</span>
            </h1>
          </div>

          <Button
            variant="ghost"
            size="sm"
            className="h-8 text-xs text-muted-foreground gap-1.5"
            onClick={() => setExportOpen(true)}
          >
            <Download className="h-3.5 w-3.5" />
            Export PDF
          </Button>
        </div>
      </header>

      <main className="flex-1 container mx-auto px-3 sm:px-6 py-4 sm:py-6">
        <SandboxView onShowAdvanced={() => setAdvancedOpen(true)} />
      </main>

      <Dialog open={exportOpen} onOpenChange={setExportOpen}>
        <DialogContent className="w-[95vw] sm:max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Export PDF Reports</DialogTitle>
          </DialogHeader>
          <PDFExportTab />
        </DialogContent>
      </Dialog>

      <Dialog open={advancedOpen} onOpenChange={setAdvancedOpen}>
        <DialogContent className="w-[95vw] sm:max-w-5xl max-h-[90vh] flex flex-col p-0">
          <div className="flex items-center justify-between px-6 py-4 border-b shrink-0">
            <h2 className="text-lg font-semibold">Advanced View</h2>
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setAdvancedOpen(false)}>
              <X className="h-4 w-4" />
            </Button>
          </div>
          <div className="flex flex-col flex-1 min-h-0">
            <div className="flex gap-1 px-6 pt-3 border-b overflow-x-auto flex-nowrap hide-scrollbar shrink-0">
              {ADVANCED_TABS.map(tab => (
                <button
                  key={tab.id}
                  onClick={() => setAdvancedTab(tab.id)}
                  className={`text-xs px-3 py-2 rounded-t whitespace-nowrap transition-colors ${
                    advancedTab === tab.id
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
            <div className="flex-1 overflow-y-auto px-6 py-4">
              <ActiveAdvancedTab />
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
