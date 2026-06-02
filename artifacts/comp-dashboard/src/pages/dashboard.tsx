import { useLocation } from "wouter";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { LayoutDashboard, Target, Users, GitMerge, FileBarChart, Presentation, Download } from "lucide-react";
import { useState } from "react";

import BusinessGoalsTab from "@/components/tabs/business-goals-tab";
import TeamBuilderTab from "@/components/tabs/team-builder-tab";
import ScenarioBuilderTab from "@/components/tabs/scenario-builder-tab";
import CurrentRealityTab from "@/components/tabs/current-reality-tab";
import ScenarioComparisonTab from "@/components/tabs/scenario-comparison-tab";
import ClinicianImpactViewTab from "@/components/tabs/clinician-impact-tab";
import PDFExportTab from "@/components/tabs/export-tab";

const tabs = [
  { id: "goals", label: "Business Goals", icon: Target, component: BusinessGoalsTab },
  { id: "reality", label: "Current Reality", icon: LayoutDashboard, component: CurrentRealityTab },
  { id: "team", label: "Team Builder", icon: Users, component: TeamBuilderTab },
  { id: "scenarios", label: "Scenario Builder", icon: GitMerge, component: ScenarioBuilderTab },
  { id: "compare", label: "Comparison", icon: FileBarChart, component: ScenarioComparisonTab },
  { id: "impact", label: "Clinician Impact", icon: Presentation, component: ClinicianImpactViewTab },
  { id: "export", label: "Export", icon: Download, component: PDFExportTab },
];

export default function Dashboard() {
  const [activeTab, setActiveTab] = useState("goals");

  return (
    <div className="min-h-screen bg-background flex flex-col font-sans">
      <header className="border-b bg-card shadow-sm sticky top-0 z-10">
        <div className="container mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3 text-primary">
            <div className="bg-primary/10 p-2 rounded-md">
              <LayoutDashboard className="h-5 w-5 text-primary" />
            </div>
            <h1 className="text-xl font-semibold tracking-tight text-foreground">Comp Strategy Dashboard</h1>
          </div>
        </div>
      </header>

      <main className="flex-1 container mx-auto px-6 py-8">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="w-full justify-start border-b border-border bg-transparent rounded-none p-0 h-auto gap-6 overflow-x-auto overflow-y-hidden hide-scrollbar flex-nowrap mb-8">
            {tabs.map((tab) => {
              const Icon = tab.icon;
              return (
                <TabsTrigger
                  key={tab.id}
                  value={tab.id}
                  className="data-[state=active]:bg-transparent data-[state=active]:text-primary data-[state=active]:border-b-2 data-[state=active]:border-primary data-[state=active]:shadow-none rounded-none py-3 px-1 text-muted-foreground hover:text-foreground transition-colors whitespace-nowrap"
                >
                  <Icon className="h-4 w-4 mr-2" />
                  {tab.label}
                </TabsTrigger>
              );
            })}
          </TabsList>
          
          <div className="mt-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
            {tabs.map((tab) => {
              const Component = tab.component;
              return (
                <TabsContent key={tab.id} value={tab.id} className="m-0 focus-visible:outline-none">
                  <Component />
                </TabsContent>
              );
            })}
          </div>
        </Tabs>
      </main>
    </div>
  );
}
