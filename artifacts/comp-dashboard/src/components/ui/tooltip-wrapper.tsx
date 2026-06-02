import React from "react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Info } from "lucide-react";
import { cn } from "@/lib/utils";

export const tooltips = {
  annualProduction: "Total revenue generated before compensation split",
  clinicianCompensation: "Amount paid to clinician before income taxes",
  employerObligations: "Employment-related costs paid by the practice for W2 clinicians",
  practiceNet: "Practice revenue after clinician compensation and employer obligations, before general overhead",
  payrollTaxEstimate: "Estimate of payroll taxes only, not total tax liability",
  cap: "Amount the practice receives before post-cap split begins",
};

interface TooltipWrapperProps {
  content: string;
  children: React.ReactNode;
  icon?: boolean;
  className?: string;
}

export function TooltipWrapper({ content, children, icon = false, className }: TooltipWrapperProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className={cn("inline-flex items-center gap-1 cursor-help border-b border-dotted border-muted-foreground/30", className)}>
          {children}
          {icon && <Info className="h-3 w-3 text-muted-foreground" />}
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs text-sm">
        <p>{content}</p>
      </TooltipContent>
    </Tooltip>
  );
}
