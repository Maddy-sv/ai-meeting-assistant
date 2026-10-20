import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface SectionProps {
  title?: ReactNode;
  description?: ReactNode;

  actions?: ReactNode;
  children: ReactNode;
  className?: string;

  card?: boolean;
}

export function Section({ title, description, actions, children, className, card }: SectionProps) {
  return (
    <section className={cn("space-y-4", className)}>
      {(title || actions) && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            {title && <h2 className="text-lg font-semibold">{title}</h2>}
            {description && <p className="text-sm text-muted-foreground">{description}</p>}
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </div>
      )}
      {card ? <div className="glass rounded-2xl p-5 shadow-soft">{children}</div> : children}
    </section>
  );
}
