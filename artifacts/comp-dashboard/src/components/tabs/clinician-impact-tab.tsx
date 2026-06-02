import { Card, CardContent } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Info } from "lucide-react";

export default function ClinicianImpactViewTab() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Clinician Impact View</h2>
          <p className="text-muted-foreground">Review W2 vs 1099 breakdown for specific clinicians.</p>
        </div>
      </div>

      <Card>
        <CardContent className="pt-6">
          <Alert>
            <Info className="h-4 w-4" />
            <AlertTitle>Under Construction</AlertTitle>
            <AlertDescription>
              This view provides a clean comparison suitable for showing directly to clinicians.
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    </div>
  );
}
