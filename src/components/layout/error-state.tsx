import { AlertTriangle, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface ErrorStateProps {
  title?: string;
  /** User-friendly message; pass `error.message` from a thrown server error. */
  message?: string;
  /** When given, shows a "Try again" button. */
  onRetry?: () => void;
  className?: string;
}

/** Inline error panel for a failed async view, with an optional retry. */
export function ErrorState({
  title = "Something went wrong",
  message = "We couldn't load this right now. Please try again.",
  onRetry,
  className,
}: ErrorStateProps) {
  return (
    <div
      role="alert"
      className={cn(
        "glass flex flex-col items-center justify-center gap-3 rounded-2xl px-6 py-10 text-center",
        className,
      )}
    >
      <div className="grid h-12 w-12 place-items-center rounded-2xl bg-destructive/15 text-destructive">
        <AlertTriangle className="h-6 w-6" />
      </div>
      <h3 className="text-lg font-semibold">{title}</h3>
      <p className="max-w-md text-sm text-muted-foreground">{message}</p>
      {onRetry && (
        <Button variant="glass" size="sm" onClick={onRetry} className="mt-2">
          <RotateCw /> Try again
        </Button>
      )}
    </div>
  );
}
