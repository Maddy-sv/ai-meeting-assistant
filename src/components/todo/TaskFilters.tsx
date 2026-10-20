import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

export type TaskScope = "mine" | "all";

export function TaskFilters({
  query,
  onQueryChange,
  scope,
  onScopeChange,
  counts,
}: {
  query: string;
  onQueryChange: (q: string) => void;
  scope: TaskScope;
  onScopeChange: (s: TaskScope) => void;
  counts: { mine: number; all: number };
}) {
  return (
    <div className="glass flex flex-col gap-3 rounded-2xl p-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="relative w-full sm:max-w-sm">
        <Label htmlFor="task-search" className="sr-only">
          Search tasks
        </Label>
        <Search
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <Input
          id="task-search"
          type="search"
          placeholder="Search tasks, meetings or assignees"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          className="h-9 rounded-full pl-9"
        />
      </div>
      <ToggleGroup
        type="single"
        value={scope}
        onValueChange={(v) => v && onScopeChange(v as TaskScope)}
        className="rounded-full border border-border bg-card p-1"
        aria-label="Which tasks to show"
      >
        <ToggleGroupItem
          value="mine"
          className="rounded-full px-3 text-xs data-[state=on]:bg-primary data-[state=on]:text-primary-foreground"
        >
          Assigned to me ({counts.mine})
        </ToggleGroupItem>
        <ToggleGroupItem
          value="all"
          className="rounded-full px-3 text-xs data-[state=on]:bg-primary data-[state=on]:text-primary-foreground"
        >
          All my meetings ({counts.all})
        </ToggleGroupItem>
      </ToggleGroup>
    </div>
  );
}
