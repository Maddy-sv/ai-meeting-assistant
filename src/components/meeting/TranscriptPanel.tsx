import { useEffect, useRef } from "react";
import { Download, Loader2, Maximize2, Mic, MessageSquareText, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import type { MeetingRecording } from "@/hooks/use-meeting-recording";
import type { MeetingTranscriptEdits } from "@/hooks/use-meeting-transcript-edits";
import { CopyTranscriptMenu } from "./CopyTranscriptMenu";
import { EditTranscriptDialog } from "./EditTranscriptDialog";
import { TranscriptMessage } from "./TranscriptMessage";
import type { Meeting, Participant, Transcript } from "./types";
import { REMOTE_PARTICIPANT_LABEL, downloadTranscript, isGenericRemote, isSameName } from "./utils";

export function TranscriptPanel({
  meeting,
  transcripts,
  participants,
  hostName,
  recording,
  edits,
  onOpenPip,
  readOnly = false,
}: {
  meeting: Meeting;
  transcripts: Transcript[];
  participants: Participant[];
  hostName: string;
  recording: MeetingRecording;
  edits: MeetingTranscriptEdits;
  onOpenPip: () => void;
  readOnly?: boolean;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const { live, interim } = recording;

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [transcripts.length, interim]);

  const isHost = (speaker: string) =>
    isSameName(speaker, hostName) || ["you", "host"].includes(speaker.trim().toLowerCase());

  const remotes = participants.filter((p) => !isHost(p.name) && p.role !== "host");
  const remoteName =
    remotes.find((p) => !isGenericRemote(p.name))?.name ||
    remotes[0]?.name ||
    REMOTE_PARTICIPANT_LABEL;

  function download() {
    if (!downloadTranscript(meeting, transcripts)) {
      toast.info("There is no transcript to download yet.");
    }
  }

  return (
    <section
      aria-labelledby="transcript-heading"
      className="glass flex h-[65vh] min-h-[420px] flex-col rounded-3xl p-4 sm:p-6"
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 border-b border-border pb-3">
        <div className="flex items-center gap-2">
          <MessageSquareText className="h-4 w-4 text-primary" aria-hidden />
          <h2 id="transcript-heading" className="text-sm font-semibold">
            {live ? "Live Chat Transcription" : "Transcript"}
          </h2>
          <span className="text-xs text-muted-foreground">
            {transcripts.length} message{transcripts.length === 1 ? "" : "s"}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {!readOnly && (
            <>
              <Button
                variant="outline"
                size="sm"
                className="rounded-full"
                onClick={() => void edits.cleanTranscript()}
                disabled={edits.cleaning || transcripts.length === 0 || live}
              >
                {edits.cleaning ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Wand2 className="h-4 w-4" />
                )}
                {edits.cleaning ? "Cleaning..." : "AI Clean & Fix"}
              </Button>
              <EditTranscriptDialog
                transcripts={transcripts}
                cleaning={edits.cleaning}
                onSubmit={edits.cleanTranscript}
              />
            </>
          )}
          <CopyTranscriptMenu
            meeting={meeting}
            transcripts={transcripts}
            size="sm"
            label="Copy All"
          />
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8 rounded-full"
            onClick={download}
            aria-label="Download transcript"
            title="Download transcript"
          >
            <Download className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="rounded-full"
            onClick={onOpenPip}
            aria-label="Pop out floating transcript window"
            title="Open an always-on-top floating window over your meeting tab"
          >
            <Maximize2 className="h-4 w-4" /> Pop-out
          </Button>
        </div>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto pr-1">
        {transcripts.length === 0 && !interim ? (
          <div className="flex h-full flex-col items-center justify-center p-6 text-center">
            <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
              <Mic className="h-6 w-6 text-primary" aria-hidden />
            </div>
            <p className="text-sm font-medium">No transcript yet</p>
            <p className="mt-1 max-w-sm text-xs text-muted-foreground">
              {readOnly
                ? "No transcript has been recorded for this meeting."
                : live
                  ? "Start speaking. Each finished sentence is saved here."
                  : meeting.status === "completed"
                    ? "Nothing was recorded for this meeting. You can paste a transcript with Edit Script."
                    : "Click Join as AI Assistant above to begin, or paste a transcript with Edit Script. Spoken words from you and remote participants appear here as chat bubbles."}
            </p>
          </div>
        ) : (
          <ol className="space-y-4" aria-label="Transcript messages">
            {transcripts.map((t) => (
              <TranscriptMessage
                key={t.id}
                t={t}
                isHost={isHost(t.speaker)}
                hostName={hostName}
                participants={participants}
                swapTarget={isHost(t.speaker) ? remoteName : hostName}
                onSetSpeaker={edits.setSpeaker}
                onSplit={edits.splitMessage}
                onDelete={edits.deleteMessage}
                readOnly={readOnly}
              />
            ))}
            {live && interim && (
              <li className="flex justify-end">
                <div className="max-w-[85%] rounded-2xl rounded-tr-sm border border-primary/30 bg-primary/5 px-4 py-3 sm:max-w-[75%]">
                  <p className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-primary">
                    <Mic className="h-3.5 w-3.5" aria-hidden /> {hostName} is speaking
                  </p>
                  <p className="whitespace-pre-wrap text-sm italic text-muted-foreground">
                    {interim}
                  </p>
                </div>
              </li>
            )}
          </ol>
        )}
      </div>
    </section>
  );
}
