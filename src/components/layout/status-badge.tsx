import { cn } from "@/lib/utils";
import { normalizeMeetingStatus, statusClasses, statusLabel } from "./status";

export interface StatusBadgeProps {
  status: string | null | undefined;

  kind?: "meeting" | "task";
  className?: string;
}

export function StatusBadge({ status: raw, kind, className }: StatusBadgeProps) {
  const status = kind === "meeting" ? normalizeMeetingStatus(raw) : raw;
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
