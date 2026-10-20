import { useState } from "react";
import { useRouter } from "@tanstack/react-router";
import {
  ArrowLeft,
  Circle,
  ExternalLink,
  Link2,
  Loader2,
  Mail,
  Maximize2,
  Pause,
  Play,
  Square,
  Video,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { MeetingRecording } from "@/hooks/use-meeting-recording";
import { CopyTranscriptMenu } from "./CopyTranscriptMenu";
import { meetingStatusClass, meetingStatusLabel } from "./status";
import type { Meeting, Transcript } from "./types";
import { formatDateTime, formatDuration } from "./utils";

function AddMeetingLinkDialog({ onSave }: { onSave: (link: string) => Promise<boolean> }) {
  const [open, setOpen] = useState(false);
  const [link, setLink] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    const ok = await onSave(link);
    setSaving(false);
    if (ok) {
      setOpen(false);
      setLink("");
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" className="rounded-full">
          <Link2 className="h-4 w-4" /> Add meeting link
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add meeting link</DialogTitle>
          <DialogDescription>Paste the link so you can join the call from here.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="meeting-link">Meeting link</Label>
            <Input
              id="meeting-link"
              type="url"
              required
              value={link}
              onChange={(e) => setLink(e.target.value)}
              placeholder="https://"
            />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={saving || !link.trim()} className="rounded-full">
              {saving && <Loader2 className="h-4 w-4 animate-spin" />} Save link
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function MeetingHeader({
  meeting,
  transcripts,
  recording,
  summarizing,
  onOpenPip,
  onShareEmail,
  onSaveLink,
  readOnly = false,
}: {
  meeting: Meeting;
  transcripts: Transcript[];
  recording: MeetingRecording;
  summarizing: boolean;
  onOpenPip: () => void;
  onShareEmail: () => void;
  onSaveLink: (link: string) => Promise<boolean>;
  /** Hide every control that would change the meeting (viewer is not the host). */
  readOnly?: boolean;
}) {
  const router = useRouter();
  const { live, paused, elapsed } = recording;
  const completed = meeting.status === "completed";
  const platform = (meeting.platform || "").replace(/_/g, " ");

  let timing = "Not started";
  if (live) timing = formatDuration(elapsed);
  else if (meeting.duration_seconds) timing = formatDuration(meeting.duration_seconds);

  return (
    <div className="space-y-4">
      <Button
        variant="outline"
        size="sm"
        className="rounded-full"
        onClick={() => router.history.back()}
      >
        <ArrowLeft className="h-4 w-4" /> Back
      </Button>

      <header className="glass flex flex-col gap-4 rounded-3xl p-5 sm:p-6 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            {platform && (
              <Badge variant="outline" className="uppercase">
                {platform}
              </Badge>
            )}
            <Badge className={`border-transparent ${meetingStatusClass(meeting.status)}`}>
              {meetingStatusLabel(meeting.status)}
            </Badge>
            {live && (
              <Badge className="border-transparent bg-destructive/15 text-destructive">
                <Circle className="mr-1 h-2 w-2 animate-pulse fill-current motion-reduce:animate-none" />
                {paused ? "Paused" : "Recording"}
              </Badge>
            )}
          </div>
          <h1 className="mt-2 break-words text-2xl font-black tracking-tight sm:text-3xl">
            {meeting.title || "Untitled meeting"}
          </h1>
          <p className="mt-1 text-xs text-muted-foreground">
            {meeting.started_at && <>Started {formatDateTime(meeting.started_at)} · </>}
            {!meeting.started_at && meeting.scheduled_at && (
              <>Scheduled {formatDateTime(meeting.scheduled_at)} · </>
            )}
            {timing}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {!completed && !live && (
            <>
              {meeting.meeting_link ? (
                <Button
                  variant="outline"
                  className="rounded-full"
                  onClick={() =>
                    window.open(meeting.meeting_link!, "_blank", "noopener,noreferrer")
                  }
                >
                  <ExternalLink className="h-4 w-4" /> Open link
                </Button>
              ) : (
                !readOnly && <AddMeetingLinkDialog onSave={onSaveLink} />
              )}
              {!readOnly && (
                <Button
                  onClick={() => void recording.startRecording()}
                  disabled={recording.support === "unsupported"}
                  className="gradient-bg rounded-full text-primary-foreground shadow-glow"
                >
                  <Video className="h-4 w-4" /> Start recording
                </Button>
              )}
            </>
          )}
          {live && (
            <>
              <Button
                variant="outline"
                className="rounded-full"
                onClick={() => recording.setPaused(!paused)}
              >
                {paused ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
                {paused ? "Resume" : "Pause"}
              </Button>
              <Button
                variant="destructive"
                className="rounded-full"
                onClick={() => void recording.endMeeting()}
                disabled={recording.ending || summarizing}
              >
                {recording.ending || summarizing ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Square className="h-4 w-4" />
                )}
                End meeting
              </Button>
              <Button variant="outline" className="rounded-full" onClick={onOpenPip}>
                <Maximize2 className="h-4 w-4" /> Floating window
              </Button>
            </>
          )}
          <CopyTranscriptMenu meeting={meeting} transcripts={transcripts} />
          {completed && !readOnly && (
            <Button
              onClick={onShareEmail}
              className="gradient-bg rounded-full text-primary-foreground shadow-glow"
            >
              <Mail className="h-4 w-4" /> Share by email
            </Button>
          )}
        </div>
      </header>
    </div>
  );
}
