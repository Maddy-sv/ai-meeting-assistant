import { AlertTriangle, Mic, MonitorUp, MonitorX } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { MeetingRecording } from "@/hooks/use-meeting-recording";

export function LiveStatusBar({
  recording,
  meetingCompleted,
}: {
  recording: MeetingRecording;
  meetingCompleted: boolean;
}) {
  if (!recording.live) {
    if (meetingCompleted || recording.support !== "unsupported") return null;
    return (
      <Alert className="rounded-2xl border-warning/40 bg-warning/10">
        <AlertTriangle className="h-4 w-4 text-warning" />
        <AlertTitle>Live transcription is not available in this browser</AlertTitle>
        <AlertDescription className="text-muted-foreground">
          Recording uses the Web Speech API, which is only available in Chrome and Edge on desktop.
          Open this meeting in one of those browsers to record, or paste a transcript from the
          Transcript tab.
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div
      className="glass flex flex-col gap-3 rounded-2xl border-primary/20 bg-primary/5 p-4 text-sm sm:flex-row sm:items-center sm:justify-between"
      role="status"
      aria-live="polite"
    >
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <Mic
          aria-hidden
          className={`h-4 w-4 shrink-0 ${recording.paused ? "text-muted-foreground" : "animate-pulse text-primary motion-reduce:animate-none"}`}
        />
        <span className="shrink-0 font-medium text-muted-foreground">
          {recording.paused ? "Paused" : "Listening"}
        </span>
        <span className="truncate italic text-foreground/90">
          {recording.paused
            ? "Resume to keep transcribing."
            : recording.interim || "Speak now. The transcript appears as you talk."}
        </span>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        {recording.sharing ? (
          <>
            <Badge
              className={`border-transparent ${recording.hasTabAudio ? "bg-success/15 text-success" : "bg-warning/15 text-warning"}`}
            >
              <MonitorUp className="mr-1.5 h-3 w-3" />
              {recording.hasTabAudio ? "Tab Audio Synced" : "No tab audio shared"}
            </Badge>
            <Button
              size="sm"
              variant="outline"
              className="rounded-full"
              onClick={recording.stopSharing}
            >
              <MonitorX className="h-4 w-4" /> Stop sharing
            </Button>
          </>
        ) : (
          <Button
            size="sm"
            variant="outline"
            className="rounded-full"
            onClick={() => void recording.shareTabAudio()}
          >
            <MonitorUp className="h-4 w-4" /> Share call tab audio
          </Button>
        )}
      </div>
    </div>
  );
}
