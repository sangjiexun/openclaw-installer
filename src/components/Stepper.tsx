import { Check, Circle, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

export interface Step {
  id: string;
  title: string;
  description: string;
}

interface StepperProps {
  steps: Step[];
  currentStep: number;
  completedSteps: Set<number>;
}

export function Stepper({ steps, currentStep, completedSteps }: StepperProps) {
  return (
    <nav className="space-y-1">
      {steps.map((step, index) => {
        const isCompleted = completedSteps.has(index);
        const isCurrent = index === currentStep;
        const isPending = !isCompleted && !isCurrent;

        return (
          <div
            key={step.id}
            className={cn(
              "flex items-start gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors",
              isCurrent && "bg-accent",
              isPending && "opacity-50"
            )}
          >
            <div className="mt-0.5 shrink-0">
              {isCompleted ? (
                <div className="flex h-5 w-5 items-center justify-center rounded-full bg-success/20">
                  <Check className="h-3 w-3 text-success" />
                </div>
              ) : isCurrent ? (
                <div className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/20">
                  <Loader2 className="h-3 w-3 text-primary animate-spin" />
                </div>
              ) : (
                <div className="flex h-5 w-5 items-center justify-center rounded-full border border-muted-foreground/30">
                  <Circle className="h-2 w-2 text-muted-foreground/50" />
                </div>
              )}
            </div>
            <div className="min-w-0">
              <p className={cn("font-medium", isCurrent && "text-foreground", isPending && "text-muted-foreground")}>
                {step.title}
              </p>
              <p className="text-xs text-muted-foreground truncate">{step.description}</p>
            </div>
          </div>
        );
      })}
    </nav>
  );
}
