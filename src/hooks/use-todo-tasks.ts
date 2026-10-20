import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  createActionItemServer,
  deleteActionItemServer,
  updateActionItemStatus,
} from "@/lib/ai.functions";
import {
  normalizeTaskStatus,
  type TaskStatus,
  TASK_STATUS_LABEL,
} from "@/components/meeting/status";
import { errorMessage } from "@/components/meeting/utils";

export type TodoTask = {
  id: string;
  meeting_id: string | null;
  title: string;
  assignee: string | null;
  assignee_user_id?: string | null;
  deadline: string | null;
  status: TaskStatus;
  created_at: string;
};

export type TodoMeeting = {
  id: string;
  title: string;
  scheduled_at: string | null;
  created_at: string;
};

export type NewTodoInput = {
  title: string;
  assignee: string;
  meetingId: string;
  deadline: string;
  status: TaskStatus;
};

type RawTask = Omit<TodoTask, "status"> & { status: string };

function normalize(row: RawTask): TodoTask {
  return { ...row, status: normalizeTaskStatus(row.status) };
}

function extractRow(res: unknown): RawTask | null {
  if (!res || typeof res !== "object") return null;
  const maybe = (res as { task?: unknown }).task ?? res;
  if (maybe && typeof maybe === "object" && "id" in maybe && "title" in maybe) {
    return maybe as RawTask;
  }
  return null;
}

export function useTodoTasks() {
  const [userId, setUserId] = useState<string | null>(null);
  const [userName, setUserName] = useState("");
  const [tasks, setTasks] = useState<TodoTask[]>([]);
  const [meetings, setMeetings] = useState<TodoMeeting[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const meetingIdsRef = useRef<Set<string>>(new Set());
  const tasksRef = useRef<TodoTask[]>([]);
  useEffect(() => {
    tasksRef.current = tasks;
  }, [tasks]);

  const createFn = useServerFn(createActionItemServer);
  const updateFn = useServerFn(updateActionItemStatus);
  const deleteFn = useServerFn(deleteActionItemServer);

  const load = useCallback(async () => {
    setError(null);
    try {
      const { data: auth, error: authErr } = await supabase.auth.getUser();
      if (authErr || !auth.user) throw new Error("You need to sign in to see your tasks.");
      const uid = auth.user.id;
      setUserId(uid);

      const [{ data: prof }, { data: mData, error: mErr }] = await Promise.all([
        supabase.from("profiles").select("full_name").eq("id", uid).maybeSingle(),
        supabase
          .from("meetings")
          .select("id, title, scheduled_at, created_at")
          .eq("host_id", uid)
          .order("created_at", { ascending: false }),
      ]);
      if (mErr) throw new Error(mErr.message);
      setUserName(prof?.full_name?.trim() || auth.user.email?.split("@")[0] || "");
      const meetingList = (mData ?? []) as TodoMeeting[];
      setMeetings(meetingList);
      meetingIdsRef.current = new Set(meetingList.map((m) => m.id));

      const own = await supabase
        .from("action_items")
        .select("*, meetings!inner(host_id)")
        .eq("meetings.host_id", uid)
        .order("created_at", { ascending: false });
      if (own.error) throw new Error(own.error.message);

      const assigned = await supabase
        .from("action_items")
        .select("*")
        .eq("assignee_user_id", uid)
        .order("created_at", { ascending: false });
      if (assigned.error) {
        toast.error(
          `Tasks assigned to you by others could not be loaded: ${assigned.error.message}`,
          {
            id: "todo-assigned-error",
          },
        );
      }

      const byId = new Map<string, TodoTask>();
      const ownRows = (own.data ?? []).map(({ meetings: _meeting, ...row }) => row as RawTask);
      for (const row of [...ownRows, ...((assigned.data ?? []) as RawTask[])]) {
        byId.set(row.id, normalize(row));
      }
      setTasks(Array.from(byId.values()));
    } catch (err) {
      setError(errorMessage(err, "Could not load your tasks."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!userId) return;
    const belongsToUser = (row: RawTask) =>
      (row.meeting_id && meetingIdsRef.current.has(row.meeting_id)) ||
      row.assignee_user_id === userId;
    const channel = supabase
      .channel(`todo_action_items_${userId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "action_items" },
        (payload) => {
          if (payload.eventType === "DELETE") {
            const oldId = (payload.old as { id?: string }).id;
            setTasks((prev) => prev.filter((t) => t.id !== oldId));
            return;
          }
          const row = payload.new as RawTask;
          if (!belongsToUser(row)) return;
          setTasks((prev) =>
            prev.some((t) => t.id === row.id)
              ? prev.map((t) => (t.id === row.id ? normalize({ ...t, ...row }) : t))
              : [normalize(row), ...prev],
          );
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [userId]);

  const meetingsById = useMemo(() => new Map(meetings.map((m) => [m.id, m])), [meetings]);

  async function updateStatus(taskId: string, status: TaskStatus) {
    const previous = tasksRef.current.find((t) => t.id === taskId)?.status;
    if (!previous || previous === status) return;
    setTasks((prev) => prev.map((t) => (t.id === taskId ? { ...t, status } : t)));
    try {
      await updateFn({ data: { actionId: taskId, status } });
      toast.success(`Moved to ${TASK_STATUS_LABEL[status]}.`);
    } catch (err) {
      setTasks((prev) => prev.map((t) => (t.id === taskId ? { ...t, status: previous } : t)));
      toast.error(errorMessage(err, "Could not update the task."));
    }
  }

  async function deleteTask(taskId: string) {
    const snapshot = tasksRef.current;
    setTasks((prev) => prev.filter((t) => t.id !== taskId));
    try {
      await deleteFn({ data: { actionId: taskId } });
      toast.success("Task deleted.");
    } catch (err) {
      setTasks(snapshot);
      toast.error(errorMessage(err, "Could not delete the task."));
    }
  }

  async function createTask(input: NewTodoInput): Promise<boolean> {
    try {
      const res = await createFn({
        data: {
          title: input.title.trim(),
          assignee: input.assignee.trim() || null,
          meetingId: input.meetingId,
          deadline: input.deadline || null,
          status: input.status,
        },
      });
      const row = extractRow(res);
      if (row) {
        setTasks((prev) => (prev.some((t) => t.id === row.id) ? prev : [normalize(row), ...prev]));
      } else {
        await load();
      }
      toast.success("Task created.");
      return true;
    } catch (err) {
      toast.error(errorMessage(err, "Could not create the task."));
      return false;
    }
  }

  return {
    userId,
    userName,
    tasks,
    meetings,
    meetingsById,
    loading,
    error,
    reload: load,
    updateStatus,
    deleteTask,
    createTask,
  };
}

export type TodoTasksApi = ReturnType<typeof useTodoTasks>;
