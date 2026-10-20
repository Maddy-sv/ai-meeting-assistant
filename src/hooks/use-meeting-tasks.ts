import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  createActionItemServer,
  deleteActionItemServer,
  generateMeetingRecaps,
  summarizeMeeting,
  syncMeetingActionItems,
  updateActionItemStatus,
} from "@/lib/ai.functions";
import { normalizeTaskStatus } from "@/components/meeting/status";
import type { ActionItem, Decision, ParticipantRecap } from "@/components/meeting/types";
import { errorMessage } from "@/components/meeting/utils";
import type { MeetingData } from "./use-meeting-data";

export type NewTaskInput = { title: string; assignee: string; deadline: string };
export type NewDecisionInput = { description: string; madeBy: string };

/** Accepts both `{ task }` and a bare row from createActionItemServer. */
function extractCreatedRow(res: unknown): ActionItem | null {
  if (!res || typeof res !== "object") return null;
  const maybe = (res as { task?: unknown }).task ?? res;
  if (maybe && typeof maybe === "object" && "id" in maybe && "title" in maybe) {
    return maybe as ActionItem;
  }
  return null;
}

/**
 * Task, decision and AI actions for one meeting. Every mutation reports success or
 * failure with a toast, and optimistic changes are rolled back if the server rejects them.
 */
export function useMeetingTasks(data: MeetingData) {
  const { meetingId, actions, setActions, setDecisions, reload } = data;
  const summarizeFn = useServerFn(summarizeMeeting);
  const syncFn = useServerFn(syncMeetingActionItems);
  const recapsFn = useServerFn(generateMeetingRecaps);
  const createFn = useServerFn(createActionItemServer);
  const updateStatusFn = useServerFn(updateActionItemStatus);
  const deleteFn = useServerFn(deleteActionItemServer);

  const [summarizing, setSummarizing] = useState(false);
  const [syncingTasks, setSyncingTasks] = useState(false);
  const [generatingRecaps, setGeneratingRecaps] = useState(false);
  const [recaps, setRecaps] = useState<ParticipantRecap[]>([]);

  async function generateSummary(screenshots: string[] = []): Promise<boolean> {
    setSummarizing(true);
    try {
      await summarizeFn({ data: { meetingId, screenshots: screenshots.slice(-2) } });
      toast.success("Summary generated from the transcript.");
      return true;
    } catch (err) {
      toast.error(errorMessage(err, "Could not generate the summary."));
      return false;
    } finally {
      setSummarizing(false);
      await reload();
    }
  }

  async function syncTasks() {
    setSyncingTasks(true);
    try {
      const res = await syncFn({ data: { meetingId } });
      const items = (res?.action_items ?? []) as ActionItem[];
      setActions(items);
      setDecisions((res?.decisions ?? []) as Decision[]);
      if (items.length > 0) toast.success(`Extracted ${items.length} action item(s).`);
      else toast.info("No action items were found in this meeting.");
    } catch (err) {
      toast.error(errorMessage(err, "Could not extract action items."));
    } finally {
      setSyncingTasks(false);
    }
  }

  async function generateRecaps() {
    setGeneratingRecaps(true);
    try {
      const res = await recapsFn({ data: { meetingId } });
      const list = (Array.isArray(res) ? res : []) as ParticipantRecap[];
      setRecaps(list);
      if (list.length > 0) toast.success(`Generated ${list.length} participant recap(s).`);
      else toast.info("Add participants to generate individual recaps.");
    } catch (err) {
      toast.error(errorMessage(err, "Could not generate recaps."));
    } finally {
      setGeneratingRecaps(false);
    }
  }

  async function createTask(input: NewTaskInput): Promise<boolean> {
    try {
      const res = await createFn({
        data: {
          title: input.title.trim(),
          assignee: input.assignee.trim() || null,
          meetingId,
          deadline: input.deadline || null,
          status: "pending",
        },
      });
      const row = extractCreatedRow(res);
      if (row) {
        setActions((prev) => (prev.some((a) => a.id === row.id) ? prev : [...prev, row]));
      } else {
        await reload();
      }
      toast.success("Action item added.");
      return true;
    } catch (err) {
      toast.error(errorMessage(err, "Could not add the action item."));
      return false;
    }
  }

  async function setTaskStatus(actionId: string, nextStatus: "pending" | "in_progress" | "done") {
    const previous = actions.find((a) => a.id === actionId)?.status;
    setActions((prev) => prev.map((a) => (a.id === actionId ? { ...a, status: nextStatus } : a)));
    try {
      await updateStatusFn({ data: { actionId, status: nextStatus } });
      toast.success(nextStatus === "done" ? "Task marked as done." : "Task reopened.");
    } catch (err) {
      setActions((prev) =>
        prev.map((a) => (a.id === actionId ? { ...a, status: previous ?? a.status } : a)),
      );
      toast.error(errorMessage(err, "Could not update the task."));
    }
  }

  function toggleTask(action: ActionItem) {
    const next = normalizeTaskStatus(action.status) === "done" ? "pending" : "done";
    return setTaskStatus(action.id, next);
  }

  async function deleteTask(actionId: string) {
    const snapshot = actions;
    setActions((prev) => prev.filter((a) => a.id !== actionId));
    try {
      await deleteFn({ data: { actionId } });
      toast.success("Action item removed.");
    } catch (err) {
      setActions(snapshot);
      toast.error(errorMessage(err, "Could not remove the action item."));
    }
  }

  async function createDecision(input: NewDecisionInput): Promise<boolean> {
    const { data: row, error } = await supabase
      .from("decisions")
      .insert({
        meeting_id: meetingId,
        description: input.description.trim(),
        made_by: input.madeBy.trim() || null,
      })
      .select()
      .single();
    if (error || !row) {
      toast.error(error?.message || "Could not save the decision.");
      return false;
    }
    setDecisions((prev) => [...prev, row as Decision]);
    toast.success("Decision saved.");
    return true;
  }

  async function deleteDecision(decisionId: string) {
    let snapshot: Decision[] = [];
    setDecisions((prev) => {
      snapshot = prev;
      return prev.filter((d) => d.id !== decisionId);
    });
    const { error } = await supabase.from("decisions").delete().eq("id", decisionId);
    if (error) {
      setDecisions(snapshot);
      toast.error(error.message || "Could not remove the decision.");
    } else {
      toast.success("Decision removed.");
    }
  }

  return {
    summarizing,
    syncingTasks,
    generatingRecaps,
    recaps,
    generateSummary,
    syncTasks,
    generateRecaps,
    createTask,
    toggleTask,
    deleteTask,
    createDecision,
    deleteDecision,
  };
}

export type MeetingTasks = ReturnType<typeof useMeetingTasks>;
