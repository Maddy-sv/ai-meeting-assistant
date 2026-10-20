import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { AlertTriangle, ArrowLeft, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ActionItemsCard } from "@/components/meeting/ActionItemsCard";
import { DecisionsCard } from "@/components/meeting/DecisionsCard";
import { EmailComposerDialog } from "@/components/meeting/EmailComposerDialog";
import { EmailTab } from "@/components/meeting/EmailTab";
import { LiveStatusBar } from "@/components/meeting/LiveStatusBar";
import { MeetingHeader } from "@/components/meeting/MeetingHeader";
import { ParticipantsPanel } from "@/components/meeting/ParticipantsPanel";
import { PipOverlay } from "@/components/meeting/PipOverlay";
import { SummaryTab } from "@/components/meeting/SummaryTab";
import { TranscriptPanel } from "@/components/meeting/TranscriptPanel";
import { buildMeetingEmail } from "@/components/meeting/utils";
import { useMeetingData } from "@/hooks/use-meeting-data";
import { usePictureInPicture } from "@/hooks/use-meeting-pip";
import { useMeetingRecording } from "@/hooks/use-meeting-recording";
import { useMeetingTasks } from "@/hooks/use-meeting-tasks";
import { useMeetingTranscriptEdits } from "@/hooks/use-meeting-transcript-edits";

export const Route = createFileRoute("/_authenticated/meetings/$id")({
  head: () => ({ meta: [{ title: "Meeting — AI Powered Meeting Companion" }] }),
  component: MeetingDetail,
  errorComponent: ({ error, reset }) => (
    <MeetingProblem
      title="Unable to load meeting"
      message={error?.message || "An unexpected error occurred while loading this meeting."}
      onRetry={reset}
    />
  ),
});

function MeetingProblem({
  title,
  message,
  onRetry,
}: {
  title: string;
  message: string;
  onRetry?: () => void;
}) {
  return (
    <div className="flex min-h-[60vh] items-center justify-center px-4">
      <div className="glass max-w-md space-y-4 rounded-3xl p-8 text-center shadow-soft">
        <AlertTriangle className="mx-auto h-8 w-8 text-destructive" aria-hidden />
        <h2 className="text-xl font-bold">{title}</h2>
        <p className="text-sm text-muted-foreground">{message}</p>
        <div className="flex flex-wrap justify-center gap-3 pt-2">
          {onRetry && (
            <Button onClick={onRetry} variant="outline" className="rounded-full">
              Try again
            </Button>
          )}
          <Button asChild className="gradient-bg rounded-full text-primary-foreground shadow-glow">
            <Link to="/meetings">
              <ArrowLeft className="h-4 w-4" /> Back to meetings
            </Link>
          </Button>
        </div>
      </div>
    </div>
  );
}

function MeetingDetail() {
  const { id } = Route.useParams();
  const data = useMeetingData(id);
  const tasks = useMeetingTasks(data);
  const edits = useMeetingTranscriptEdits(data);
  const recording = useMeetingRecording(data, (shots) => tasks.generateSummary(shots));
  const pip = usePictureInPicture();
  const [emailOpen, setEmailOpen] = useState(false);
  const [tab, setTab] = useState<string | null>(null);

  const { meeting, transcripts, participants, summary, actions, decisions, hostName } = data;
  const emailDraft = useMemo(
    () => buildMeetingEmail(meeting, summary, actions, decisions, participants),
    [meeting, summary, actions, decisions, participants],
  );

  if (data.loading) {
    return (
      <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3" role="status">
        <Loader2 className="h-8 w-8 animate-spin text-primary" aria-hidden />
        <p className="text-sm text-muted-foreground">Loading meeting…</p>
      </div>
    );
  }
  if (data.error) {
    return (
      <MeetingProblem
        title="Unable to load meeting"
        message={data.error}
        onRetry={() => void data.reload()}
      />
    );
  }
  if (!meeting) {
    return (
      <MeetingProblem
        title="Meeting not found"
        message="This meeting does not exist or you do not have access to it."
      />
    );
  }

  const completed = meeting.status === "completed";
  const activeTab = tab ?? (completed ? "summary" : "transcript");
  const hasTranscript = transcripts.length > 0;

  async function openPip() {
    const ok = await pip.open();
    if (!ok) toast.error("Could not open the floating window. Allow pop-ups for this site.");
  }

  return (
    <div className="space-y-6">
      <MeetingHeader
        meeting={meeting}
        transcripts={transcripts}
        recording={recording}
        summarizing={tasks.summarizing}
        onOpenPip={() => void openPip()}
        onShareEmail={() => setEmailOpen(true)}
        onSaveLink={edits.saveMeetingLink}
      />
      <LiveStatusBar recording={recording} meetingCompleted={completed} />

      <Tabs value={activeTab} onValueChange={setTab}>
        <TabsList className="h-auto flex-wrap">
          {completed && <TabsTrigger value="summary">Summary</TabsTrigger>}
          {completed && <TabsTrigger value="actions">Actions & decisions</TabsTrigger>}
          {completed && <TabsTrigger value="email">Email & recaps</TabsTrigger>}
          <TabsTrigger value="transcript">Transcript</TabsTrigger>
        </TabsList>

        <TabsContent value="transcript">
          <div className="grid gap-6 lg:grid-cols-[1fr_300px]">
            <TranscriptPanel
              meeting={meeting}
              transcripts={transcripts}
              participants={participants}
              hostName={hostName}
              recording={recording}
              edits={edits}
              onOpenPip={() => void openPip()}
            />
            <ParticipantsPanel participants={participants} hostName={hostName} edits={edits} />
          </div>
        </TabsContent>

        <TabsContent value="summary">
          <SummaryTab
            summary={summary}
            hasTranscript={hasTranscript}
            summarizing={tasks.summarizing}
            onGenerate={() => void tasks.generateSummary()}
          />
        </TabsContent>

        <TabsContent value="actions" className="space-y-6">
          <ActionItemsCard
            actions={actions}
            participants={participants}
            hasSummary={!!summary}
            hasTranscript={hasTranscript}
            tasks={tasks}
          />
          <DecisionsCard decisions={decisions} tasks={tasks} />
        </TabsContent>

        <TabsContent value="email">
          <EmailTab
            draft={emailDraft}
            hasSummary={!!summary}
            hasParticipants={participants.length > 0}
            tasks={tasks}
            onCompose={() => setEmailOpen(true)}
          />
        </TabsContent>
      </Tabs>

      <EmailComposerDialog
        open={emailOpen}
        onOpenChange={setEmailOpen}
        draft={emailDraft}
        participants={participants}
      />

      {pip.pipWindow && (
        <PipOverlay
          pipWindow={pip.pipWindow}
          transcripts={transcripts}
          hostName={hostName}
          recording={recording}
        />
      )}
    </div>
  );
}
