import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Download, FileText } from "lucide-react";

export default function PDFExportTab() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Export Reports</h2>
          <p className="text-muted-foreground">Generate professional PDF summaries.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5 text-primary" />
              Internal Scenario Report
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground mb-4">
              Comprehensive report detailing practice financials, overhead, and clinician breakdown for internal review.
            </p>
            <Button className="w-full" disabled>
              <Download className="h-4 w-4 mr-2" />
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
          <CardContent>
            <p className="text-sm text-muted-foreground mb-4">
              Clean summary intended for clinicians, hiding sensitive practice goals and overhead metrics.
            </p>
            <Button className="w-full" disabled>
              <Download className="h-4 w-4 mr-2" />
              Generate PDF
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5 text-primary" />
              Comparison Report
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground mb-4">
              Side-by-side comparison of selected scenarios, highlighting the differences in outcomes.
            </p>
            <Button className="w-full" disabled>
              <Download className="h-4 w-4 mr-2" />
              Generate PDF
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
