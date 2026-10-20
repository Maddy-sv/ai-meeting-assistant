import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { AlertTriangle, ListTodo } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { isSameName } from "@/components/meeting/utils";
import { CreateTaskDialog } from "@/components/todo/CreateTaskDialog";
import { KanbanBoard } from "@/components/todo/KanbanBoard";
import { TaskDetailDialog } from "@/components/todo/TaskDetailDialog";
import { TaskFilters, type TaskScope } from "@/components/todo/TaskFilters";
import { useTodoTasks } from "@/hooks/use-todo-tasks";

export const Route = createFileRoute("/_authenticated/todo")({
  head: () => ({ meta: [{ title: "Tasks & Action Items — AI Powered Meeting Companion" }] }),
  component: TodoPage,
});

function TodoPage() {
  const todo = useTodoTasks();
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<TaskScope>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const mine = useMemo(
    () =>
      todo.tasks.filter(
        (t) =>
          (todo.userId && t.assignee_user_id === todo.userId) ||
          isSameName(t.assignee, todo.userName),
      ),
    [todo.tasks, todo.userId, todo.userName],
  );

  const visible = useMemo(() => {
    const base = scope === "mine" ? mine : todo.tasks;
    const q = query.trim().toLowerCase();
    if (!q) return base;
    return base.filter((t) => {
      const meetingTitle = t.meeting_id ? todo.meetingsById.get(t.meeting_id)?.title : "";
      return [t.title, t.assignee, meetingTitle].some((v) => (v || "").toLowerCase().includes(q));
    });
  }, [scope, mine, todo.tasks, todo.meetingsById, query]);

  const selected = selectedId ? (todo.tasks.find((t) => t.id === selectedId) ?? null) : null;

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
        <div>
          <h1 className="text-3xl font-black tracking-tight">To-do</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Action items from your meetings and tasks assigned to you.
          </p>
        </div>
        <CreateTaskDialog meetings={todo.meetings} onCreate={todo.createTask} />
      </div>

      <TaskFilters
        query={query}
        onQueryChange={setQuery}
        scope={scope}
        onScopeChange={setScope}
        counts={{ mine: mine.length, all: todo.tasks.length }}
      />

      {todo.loading ? (
        <div
          className="grid gap-4 md:grid-cols-3 md:gap-6"
          role="status"
          aria-label="Loading tasks"
        >
          {[0, 1, 2].map((i) => (
            <Skeleton
              key={i}
              className={`h-[50vh] rounded-3xl ${i > 0 ? "hidden md:block" : ""}`}
            />
          ))}
        </div>
      ) : todo.error ? (
        <div className="glass mx-auto flex max-w-md flex-col items-center gap-3 rounded-3xl p-8 text-center">
          <AlertTriangle className="h-8 w-8 text-destructive" aria-hidden />
          <p className="text-sm">{todo.error}</p>
          <Button variant="outline" className="rounded-full" onClick={() => void todo.reload()}>
            Try again
          </Button>
        </div>
      ) : todo.tasks.length === 0 ? (
        <div className="glass mx-auto flex max-w-md flex-col items-center gap-3 rounded-3xl p-8 text-center">
          <ListTodo className="h-8 w-8 text-primary" aria-hidden />
          <h2 className="text-lg font-semibold">No tasks yet</h2>
          <p className="text-sm text-muted-foreground">
            Tasks appear here when you extract action items from a meeting or create one with New
            task.
          </p>
        </div>
      ) : (
        <>
          {visible.length === 0 && (
            <p className="text-sm text-muted-foreground" role="status">
              No tasks match these filters.
            </p>
          )}
          <KanbanBoard
            tasks={visible}
            meetingsById={todo.meetingsById}
            onOpen={(t) => setSelectedId(t.id)}
            onMove={(id, status) => void todo.updateStatus(id, status)}
            onDelete={(id) => void todo.deleteTask(id)}
          />
        </>
      )}

      <TaskDetailDialog
        task={selected}
        meeting={selected?.meeting_id ? todo.meetingsById.get(selected.meeting_id) : undefined}
        onClose={() => setSelectedId(null)}
        onMove={(id, status) => void todo.updateStatus(id, status)}
        onDelete={(id) => void todo.deleteTask(id)}
      />
    </div>
  );
}
