import { Skeleton } from "@/components/ui/skeleton";

export interface LoadingStateProps {
  /** `list` = stacked rows, `cards` = card grid, `table` = header + rows, `stats` = stat tiles. */
  variant?: "list" | "cards" | "table" | "stats";
  /** Number of placeholder items. */
  rows?: number;
  /** Accessible label announced to screen readers. */
  label?: string;
  className?: string;
}

/** Skeleton placeholder shown while an async view loads. */
export function LoadingState({
  variant = "list",
  rows = 4,
  label = "Loading…",
  className,
}: LoadingStateProps) {
  const items = Array.from({ length: rows }, (_, i) => i);
  return (
    <div role="status" aria-live="polite" className={className}>
      <span className="sr-only">{label}</span>
      {variant === "stats" && (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {items.map((i) => (
            <Skeleton key={i} className="h-28 rounded-2xl bg-muted" />
          ))}
        </div>
      )}
      {variant === "cards" && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((i) => (
            <Skeleton key={i} className="h-40 rounded-2xl bg-muted" />
          ))}
        </div>
      )}
      {variant === "table" && (
        <div className="glass space-y-3 rounded-2xl p-4">
          <Skeleton className="h-6 w-1/3 bg-muted" />
          {items.map((i) => (
            <Skeleton key={i} className="h-10 w-full bg-muted" />
          ))}
        </div>
      )}
      {variant === "list" && (
        <div className="space-y-3">
          {items.map((i) => (
            <Skeleton key={i} className="h-16 w-full rounded-2xl bg-muted" />
          ))}
        </div>
      )}
    </div>
  );
}
