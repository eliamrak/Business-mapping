import { CircleHelp } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

export function HelpBubble({ text, label = "Calculation help" }: { text: string; label?: string }) {
  return <TooltipProvider delayDuration={0}>
    <Popover>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <button type="button" aria-label={label}
              className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
              onClick={event => event.stopPropagation()}>
              <CircleHelp size={16} aria-hidden="true" />
            </button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent className="max-w-72 whitespace-normal leading-snug">{text}</TooltipContent>
      </Tooltip>
      <PopoverContent aria-label={label} style={{ maxWidth: "calc(100vw - 32px)" }}
        className="text-sm leading-relaxed" onClick={event => event.stopPropagation()}>
        {text}
      </PopoverContent>
    </Popover>
  </TooltipProvider>;
}
