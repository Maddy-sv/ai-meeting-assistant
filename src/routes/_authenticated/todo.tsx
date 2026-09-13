import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { CheckCircle2, Clock, AlertCircle } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/todo")({
  head: () => ({ meta: [{ title: "Tasks — AI Powered Meeting Companion" }] }),
  component: TodoPage,
});

type ActionItem = {
  id: string;
  meeting_id: string | null;
  title: string;
  assignee: string | null;
  deadline: string | null;
  status: string;
  created_at: string;
};

function TodoPage() {
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [tasks, setTasks] = useState<ActionItem[]>([]);
  const [loading, setLoading] = useState(true);

  async function fetchTasks() {
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) return;
    
    const meta = u.user.user_metadata;
    const fName = meta?.full_name || meta?.name || u.user.email?.split("@")[0] || "";

    const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", u.user.id);
    const admin = (roles ?? []).some((r: any) => r.role === "admin");
    setIsAdmin(admin);

    if (admin) {
      const { data: allTasks } = await supabase.from("action_items").select("*").order("created_at", { ascending: false });
      setTasks((allTasks as ActionItem[]) ?? []);
    } else {
      const firstName = fName.split(" ")[0];
      const { data: myTasks } = await supabase
        .from("action_items")
        .select("*")
        .ilike("assignee", `%${firstName}%`)
        .order("created_at", { ascending: false });
      
      setTasks((myTasks as ActionItem[]) ?? []);
    }
  }

  useEffect(() => {
    fetchTasks().finally(() => setLoading(false));
  }, []);

  function handleDragStart(e: React.DragEvent, taskId: string) {
    e.dataTransfer.setData("taskId", taskId);
  }

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault(); // Required for drop to work
  }

  async function handleDrop(e: React.DragEvent, newStatus: string) {
    e.preventDefault();
    const taskId = e.dataTransfer.getData("taskId");
    if (!taskId) return;
    
    setTasks(prev => prev.map(t => t.id === taskId ? { ...t, status: newStatus } : t));
    
    const { error } = await supabase.from("action_items").update({ status: newStatus }).eq("id", taskId);
    if (error) {
      toast.error("Failed to move task");
      fetchTasks();
    }
  }

  if (loading) return <p className="text-sm text-muted-foreground p-8">Loading tasks...</p>;

  const todoTasks = tasks.filter(t => t.status === "pending");
  const inProgressTasks = tasks.filter(t => t.status === "in_progress");
  const doneTasks = tasks.filter(t => t.status === "done");

  return (
    <div className="space-y-8 flex flex-col h-full">
      <header>
        <h1 className="text-3xl font-black tracking-tight">My Tasks</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {isAdmin ? "Workspace Overview: Manage all action items." : "Manage your action items extracted from meetings."}
        </p>
      </header>

      <div className="flex gap-6 overflow-x-auto pb-6 flex-1 items-start">
        <Column 
          title="To Do" 
          status="pending" 
          tasks={todoTasks} 
          colorClass="bg-slate-400"
          onDragStart={handleDragStart}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
        />
        <Column 
          title="In Progress" 
          status="in_progress" 
          tasks={inProgressTasks} 
          colorClass="bg-blue-500"
          onDragStart={handleDragStart}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
        />
        <Column 
          title="Completed" 
          status="done" 
          tasks={doneTasks} 
          colorClass="bg-emerald-500"
          onDragStart={handleDragStart}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
        />
      </div>
    </div>
  );
}

function Column({ title, status, tasks, colorClass, onDragStart, onDragOver, onDrop }: any) {
  return (
    <div 
      className="flex flex-col rounded-2xl border border-white/5 bg-[#12151c] p-5 w-[340px] shrink-0 min-h-[60vh] shadow-lg"
      onDragOver={onDragOver}
      onDrop={(e) => onDrop(e, status)}
    >
      <div className="mb-5 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className={`h-5 w-1 rounded-full ${colorClass}`} />
          <h2 className="text-base font-bold tracking-wide">{title}</h2>
        </div>
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-white/5 text-[11px] font-bold text-muted-foreground">
          {tasks.length}
        </span>
      </div>

      <div className="flex flex-col gap-3">
        {tasks.map((t: ActionItem) => (
          <div 
            key={t.id}
            draggable
            onDragStart={(e) => onDragStart(e, t.id)}
            className="group cursor-grab active:cursor-grabbing rounded-2xl border border-white/5 bg-[#1c202a] p-5 transition-all hover:bg-[#232834] hover:border-white/10 hover:-translate-y-0.5 shadow-sm"
          >
            <div className="flex items-start justify-between gap-3">
              <h3 className="text-sm font-semibold leading-snug text-white/90">{t.title}</h3>
              {status === 'done' ? (
                <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" />
              ) : status === 'in_progress' ? (
                <Clock className="h-4 w-4 shrink-0 text-amber-500" />
              ) : (
                <AlertCircle className="h-4 w-4 shrink-0 text-red-500" />
              )}
            </div>
            
            <div className="mt-8 flex items-center justify-between">
              <div className="flex h-6 px-2 items-center justify-center rounded-md bg-white/5 text-[10px] font-bold text-muted-foreground uppercase">
                {t.meeting_id ? "M" + t.meeting_id.slice(0, 1) : "T1"}
              </div>
              <div className="text-[11px] font-medium text-muted-foreground">
                {t.deadline ? new Date(t.deadline).toLocaleDateString('en-GB') : "No date"}
              </div>
            </div>
          </div>
        ))}
        
        {tasks.length === 0 && (
          <div className="rounded-2xl border-2 border-dashed border-white/5 p-8 text-center text-xs font-medium text-muted-foreground">
            Drop tasks here
          </div>
        )}
      </div>
    </div>
  );
}
