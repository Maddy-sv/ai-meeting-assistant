import { cn } from "@/lib/utils";
import { statusClasses, statusLabel } from "./status";

export interface StatusBadgeProps {
  status: string | null | undefined;
  className?: string;
}

/** Pill showing a meeting or task status with the shared colour mapping. */
export function StatusBadge({ status, className }: StatusBadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold",
        statusClasses(status),
        className,
      )}
    >
      {status === "live" && (
        <span
          className="h-1.5 w-1.5 rounded-full bg-destructive motion-safe:animate-pulse"
          aria-hidden
        />
      )}
      {statusLabel(status)}
    </span>
  );
}
