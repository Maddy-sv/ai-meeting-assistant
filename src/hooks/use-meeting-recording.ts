import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { transcribeRemoteAudio } from "@/lib/ai.functions";
import type { Transcript } from "@/components/meeting/types";
import { errorMessage, isSameName } from "@/components/meeting/utils";
import type { MeetingData } from "./use-meeting-data";
import { useLiveTranscription } from "./use-meeting-live-transcription";
import { useScreenShareCapture } from "./use-meeting-screen-capture";

/** Mic speech heard while the shared tab is playing sound is attributed to the remote side. */
const REMOTE_OVERLAP_MS = 4_500;
const REMOTE_FALLBACK_LABEL = "Remote participant";

type RemoteSegment = { speaker: string; content: string; spoken_at?: string };

/**
 * One recording session: microphone transcription, optional tab/screen audio capture,
 * persistence of every segment, and the meeting status lifecycle.
 */
export function useMeetingRecording(
  data: MeetingData,
  onEnded: (screenshots: string[]) => Promise<unknown>,
) {
  const { meetingId, meeting, setMeeting, setTranscripts, hostName, hostEmail } = data;
  const transcribeRemote = useServerFn(transcribeRemoteAudio);
  const [ending, setEnding] = useState(false);
  const segmentRef = useRef(0);
  const dataRef = useRef(data);
  useEffect(() => {
    dataRef.current = data;
  });

  useEffect(() => {
    const maxIdx = data.transcripts.reduce((m, t) => Math.max(m, t.segment_index || 0), 0);
    segmentRef.current = Math.max(segmentRef.current, maxIdx);
  }, [data.transcripts]);

  async function persistSegment(speaker: string, content: string, spokenAt?: string) {
    segmentRef.current += 1;
    const row = {
      meeting_id: meetingId,
      speaker,
      content,
      segment_index: segmentRef.current,
      spoken_at: spokenAt || new Date().toISOString(),
    };
    const { data: inserted, error } = await supabase
      .from("transcripts")
      .insert(row)
      .select()
      .single();
    if (error || !inserted) {
      toast.error(`Could not save part of the transcript: ${error?.message ?? "unknown error"}`, {
        id: "transcript-save-error",
      });
      return;
    }
    setTranscripts((prev) => [...prev, inserted as Transcript]);
  }

  function remoteSpeakerName() {
    const remote = dataRef.current.participants.find((p) => !isSameName(p.name, hostName));
    return remote?.name || REMOTE_FALLBACK_LABEL;
  }

  const live = useLiveTranscription({
    onFinalText: (text) => {
      const speaker = screen.remoteAudioActiveWithin(REMOTE_OVERLAP_MS)
        ? remoteSpeakerName()
        : hostName;
      void persistSegment(speaker, text);
    },
    onFatalError: (message) => toast.error(message),
  });

  const screen = useScreenShareCapture({
    isPaused: () => live.paused,
    onAudioChunk: async (dataUrl) => {
      try {
        const res = (await transcribeRemote({
          data: {
            meetingId,
            base64Audio: dataUrl,
            segmentIndex: segmentRef.current + 1,
            screenshotBase64: screen.getScreenshots().at(-1),
            knownParticipants: Array.from(
              new Set([hostName, ...dataRef.current.participants.map((p) => p.name)]),
            ),
            hostName,
          },
        })) as RemoteSegment[] | null;
        if (!Array.isArray(res) || res.length === 0) return;
        for (const seg of res) {
          if (seg.content?.trim()) await persistSegment(seg.speaker, seg.content.trim());
        }
        // The server registers newly heard speakers as participants.
        await dataRef.current.reloadParticipants();
      } catch (err) {
        toast.error(errorMessage(err, "Remote audio could not be transcribed."), {
          id: "remote-transcription-error",
        });
      }
    },
  });

  async function ensureHostParticipant() {
    if (dataRef.current.participants.some((p) => isSameName(p.name, hostName))) return;
    const { error } = await supabase
      .from("participants")
      .insert({ meeting_id: meetingId, name: hostName, email: hostEmail, role: "host" });
    if (error) toast.error(`Could not add you as a participant: ${error.message}`);
    else await dataRef.current.reloadParticipants();
  }

  async function startRecording() {
    const result = await live.start();
    if (!result.ok) {
      toast.error(result.reason);
      return;
    }
    const startedAt = meeting?.started_at || new Date().toISOString();
    const { error } = await supabase
      .from("meetings")
      .update({ status: "in_progress", started_at: startedAt })
      .eq("id", meetingId);
    if (error) toast.error(`Could not mark the meeting as live: ${error.message}`);
    else setMeeting((m) => (m ? { ...m, status: "in_progress", started_at: startedAt } : m));
    await ensureHostParticipant();
    toast.success("Recording started.");
  }

  async function shareTabAudio() {
    const ok = await screen.start();
    if (!ok) {
      toast.error("Screen sharing was cancelled or is not available in this browser.");
      return;
    }
    toast.success("Sharing started. Remote voices from the shared tab will be transcribed.");
  }

  function stopCapture() {
    screen.stop();
    live.stop();
  }

  async function endMeeting() {
    if (ending) return;
    setEnding(true);
    try {
      const pending = live.takeInterim();
      if (pending) await persistSegment(hostName, pending);
      const duration = live.elapsed;
      stopCapture();
      const endedAt = new Date().toISOString();
      const startedAt = meeting?.started_at || new Date(Date.now() - duration * 1000).toISOString();
      const { error } = await supabase
        .from("meetings")
        .update({
          status: "completed",
          ended_at: endedAt,
          duration_seconds: duration,
          started_at: startedAt,
        })
        .eq("id", meetingId);
      if (error) {
        toast.error(`Could not end the meeting: ${error.message}`);
        return;
      }
      setMeeting((m) =>
        m
          ? {
              ...m,
              status: "completed",
              ended_at: endedAt,
              duration_seconds: duration,
              started_at: startedAt,
            }
          : m,
      );
      await onEnded(screen.getScreenshots());
    } finally {
      setEnding(false);
    }
  }

  return {
    support: live.support,
    live: live.listening,
    paused: live.paused,
    setPaused: live.setPaused,
    interim: live.interim,
    elapsed: live.elapsed,
    sharing: screen.sharing,
    hasTabAudio: screen.hasTabAudio,
    ending,
    startRecording,
    shareTabAudio,
    stopSharing: screen.stop,
    endMeeting,
  };
}

export type MeetingRecording = ReturnType<typeof useMeetingRecording>;
