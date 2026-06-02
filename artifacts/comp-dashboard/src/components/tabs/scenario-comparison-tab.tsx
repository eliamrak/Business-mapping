import { Card, CardContent } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Info } from "lucide-react";

export default function ScenarioComparisonTab() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Scenario Comparison</h2>
          <p className="text-muted-foreground">Compare multiple scenarios side-by-side.</p>
        </div>
      </div>
      
      <Card>
        <CardContent className="pt-6">
          <Alert>
            <Info className="h-4 w-4" />
            <AlertTitle>Under Construction</AlertTitle>
            <AlertDescription>
              Select multiple scenarios to compare total practice net, goal achievement, and clinician compensation averages.
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    </div>
  );
}
