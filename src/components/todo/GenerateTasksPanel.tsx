import { useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { supabase } from "@/integrations/supabase/client";
import { reconcileProjectTasks, syncMeetingActionItems } from "@/lib/ai.functions";
import { errorMessage } from "@/components/meeting/utils";

type SourceMeeting = { id: string; title: string; date: string };

type RunState = {
  stage: "find" | "sync" | "reconcile";
  current: number;
  total: number;
  title: string;
  cancelling: boolean;
};

async function loadMeetingsWithTranscripts(): Promise<SourceMeeting[]> {
  const { data: auth, error: authErr } = await supabase.auth.getUser();
  if (authErr || !auth.user) throw new Error("You need to sign in to generate tasks.");
  const { data, error } = await supabase
    .from("meetings")
    .select("id, title, scheduled_at, started_at, created_at, transcripts!inner(id)")
    .eq("host_id", auth.user.id)
    .limit(1, { referencedTable: "transcripts" });
  if (error) throw new Error("Could not load your meetings.");
  return (data ?? [])
    .map((m) => ({
      id: m.id,
      title: m.title,
      date: m.started_at ?? m.scheduled_at ?? m.created_at,
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

export function GenerateTasksPanel({ onFinished }: { onFinished: () => Promise<void> | void }) {
  const syncFn = useServerFn(syncMeetingActionItems);
  const reconcileFn = useServerFn(reconcileProjectTasks);
  const [run, setRun] = useState<RunState | null>(null);
  const cancelRef = useRef(false);

  async function generate() {
    cancelRef.current = false;
    setRun({ stage: "find", current: 0, total: 0, title: "", cancelling: false });
    try {
      const meetings = await loadMeetingsWithTranscripts();
      if (meetings.length === 0) {
        toast.info("None of your meetings has a transcript to generate tasks from yet.");
        return;
      }

      let taskCount = 0;
      let processed = 0;
      const failed: string[] = [];
      for (const [index, meeting] of meetings.entries()) {
        if (cancelRef.current) break;
        setRun((r) => ({
          stage: "sync",
          current: index + 1,
          total: meetings.length,
          title: meeting.title,
          cancelling: r?.cancelling ?? false,
        }));
        try {
          const res = await syncFn({ data: { meetingId: meeting.id } });
          taskCount += res.action_items.length;
          processed += 1;
        } catch (err) {
          failed.push(`${meeting.title} (${errorMessage(err, "failed")})`);
        }
      }

      let progressNote = "";
      setRun((r) => (r ? { ...r, stage: "reconcile" } : r));
      try {
        const progress = await reconcileFn();
        if (progress.updated > 0) {
          progressNote = ` ${progress.updated} moved forward from later meetings (${progress.done} done, ${progress.in_progress} in progress).`;
        }
      } catch (err) {
        failed.push(`Cross-meeting progress (${errorMessage(err, "failed")})`);
      }

      await onFinished();
      const stopped = cancelRef.current ? " Stopped early." : "";
      toast.success(
        `Created/updated ${taskCount} task${taskCount === 1 ? "" : "s"} from ${processed} meeting${processed === 1 ? "" : "s"}.${progressNote}${stopped}`,
      );
      if (failed.length > 0) {
        toast.warning(`Some meetings could not be processed: ${failed.join("; ")}`, {
          duration: 12000,
        });
      }
    } catch (err) {
      toast.error(errorMessage(err, "Could not generate tasks."));
    } finally {
      setRun(null);
    }
  }

  function cancel() {
    cancelRef.current = true;
    setRun((r) => (r ? { ...r, cancelling: true } : r));
  }

  const completed = !run ? 0 : run.stage === "reconcile" ? run.total : Math.max(run.current - 1, 0);
  const percent = run && run.total > 0 ? Math.round((completed / run.total) * 100) : 0;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          className="rounded-full"
          onClick={() => void generate()}
          disabled={run !== null}
          aria-busy={run !== null}
        >
          {run ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          ) : (
            <Sparkles className="h-4 w-4 text-primary" aria-hidden />
          )}
          Generate tasks from all meetings
        </Button>
        {run && (
          <Button
            variant="ghost"
            className="rounded-full"
            onClick={cancel}
            disabled={run.cancelling}
          >
            {run.cancelling ? "Stopping after this meeting…" : "Cancel"}
          </Button>
        )}
      </div>
      {run && (
        <div className="glass space-y-2 rounded-2xl p-4">
          <p className="text-sm" role="status" aria-live="polite">
            {run.stage === "find"
              ? "Finding meetings with transcripts…"
              : run.stage === "sync"
                ? `Generating tasks ${run.current}/${run.total} — ${run.title}`
                : "Checking later meetings for progress on earlier tasks…"}
          </p>
          <Progress
            value={percent}
            max={100}
            aria-label="Task generation progress"
            aria-valuenow={percent}
            aria-valuetext={
              run.total > 0 ? `${completed} of ${run.total} meetings processed` : undefined
            }
          />
        </div>
      )}
    </div>
  );
}
