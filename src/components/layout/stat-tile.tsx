import type { ComponentType, ReactNode } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export interface StatTileProps {
  label: ReactNode;
  value: ReactNode;
  icon?: ComponentType<{ className?: string }>;

  hint?: ReactNode;

  loading?: boolean;
  className?: string;
}

export function StatTile({ label, value, icon: Icon, hint, loading, className }: StatTileProps) {
  return (
    <div className={cn("glass rounded-2xl p-5 shadow-soft", className)}>
      <div className="flex items-start justify-between gap-2">
        <span className="text-xs uppercase tracking-widest text-muted-foreground">{label}</span>
        {Icon && (
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-primary/15 text-primary">
            <Icon className="h-4 w-4" />
          </span>
        )}
      </div>
      <div className="mt-3 text-3xl font-black tabular-nums tracking-tight">
        {loading ? <Skeleton className="h-8 w-16 bg-muted" /> : value}
      </div>
      {hint && !loading && <div className="mt-1 text-xs text-muted-foreground">{hint}</div>}
    </div>
  );
}
