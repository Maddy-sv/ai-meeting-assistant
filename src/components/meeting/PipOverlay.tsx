import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { Circle, Pause, Play, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { MeetingRecording } from "@/hooks/use-meeting-recording";
import type { Transcript } from "./types";
import { formatDuration, formatTime, getInitials, isSameName, speakerTone } from "./utils";

/** Compact live transcript rendered into the floating Picture-in-Picture window. */
export function PipOverlay({
  pipWindow,
  transcripts,
  hostName,
  recording,
}: {
  pipWindow: Window;
  transcripts: Transcript[];
  hostName: string;
  recording: MeetingRecording;
}) {
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [transcripts.length, recording.interim]);

  return createPortal(
    <div className="flex h-screen flex-col bg-background text-foreground">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-3 py-2 text-xs">
        <div className="flex items-center gap-2 font-semibold">
          <Circle
            className={`h-2.5 w-2.5 fill-current ${recording.live && !recording.paused ? "text-destructive" : "text-muted-foreground"}`}
            aria-hidden
          />
          {recording.live ? (recording.paused ? "Paused" : "Recording") : "Not recording"}
          <span className="font-normal text-muted-foreground">
            {formatDuration(recording.elapsed)}
          </span>
        </div>
        {recording.live && (
          <div className="flex items-center gap-1.5">
            <Button
              size="sm"
              variant="outline"
              className="h-7 rounded-full text-xs"
              onClick={() => recording.setPaused(!recording.paused)}
            >
              {recording.paused ? <Play className="h-3 w-3" /> : <Pause className="h-3 w-3" />}
              {recording.paused ? "Resume" : "Pause"}
            </Button>
            <Button
              size="sm"
              variant="destructive"
              className="h-7 rounded-full text-xs"
              onClick={() => void recording.endMeeting()}
              disabled={recording.ending}
            >
              <Square className="h-3 w-3" /> End
            </Button>
          </div>
        )}
      </div>
      <div ref={listRef} className="flex-1 space-y-2.5 overflow-y-auto p-3" aria-live="polite">
        {transcripts.length === 0 && !recording.interim && (
          <p className="pt-10 text-center text-xs text-muted-foreground">
            The live transcript will appear here.
          </p>
        )}
        {transcripts.map((t) => {
          const host = isSameName(t.speaker, hostName);
          return (
            <div key={t.id} className="flex items-start gap-2">
              <div
                aria-hidden
                className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${speakerTone(t.speaker, host)}`}
              >
                {getInitials(t.speaker)}
              </div>
              <div className="min-w-0 rounded-xl bg-surface-2 px-3 py-2 text-sm">
                <p className="text-xs font-semibold">
                  {t.speaker}{" "}
                  <span className="font-normal text-muted-foreground">
                    {formatTime(t.spoken_at)}
                  </span>
                </p>
                <p className="whitespace-pre-wrap">{t.content}</p>
              </div>
            </div>
          );
        })}
        {recording.live && recording.interim && (
          <p className="rounded-xl border border-primary/30 bg-primary/5 px-3 py-2 text-sm italic text-muted-foreground">
            {recording.interim}
          </p>
        )}
      </div>
    </div>,
    pipWindow.document.body,
  );
}
