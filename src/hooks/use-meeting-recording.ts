import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { transcribeRemoteAudio } from "@/lib/ai.functions";
import type { Transcript } from "@/components/meeting/types";
import {
  REMOTE_PARTICIPANT_LABEL,
  friendlyAiError,
  isGenericRemote,
  isSameName,
  mutationError,
} from "@/components/meeting/utils";
import type { MeetingData } from "./use-meeting-data";
import { useLiveTranscription } from "./use-meeting-live-transcription";
import { useScreenShareCapture, type ShareResult } from "./use-meeting-screen-capture";

const REMOTE_OVERLAP_MS = 4_500;

export function useMeetingRecording(
  data: MeetingData,
  onEnded: (screenshots: string[]) => Promise<unknown>,
) {
  const { meetingId, meeting, setMeeting, setTranscripts, hostName, hostEmail } = data;
  const transcribeRemote = useServerFn(transcribeRemoteAudio);
  const [ending, setEnding] = useState(false);
  const segmentRef = useRef(0);

  const pendingRef = useRef(new Set<Promise<unknown>>());
  const dataRef = useRef(data);
  useEffect(() => {
    dataRef.current = data;
  });

  useEffect(() => {
    const maxIdx = data.transcripts.reduce((m, t) => Math.max(m, t.segment_index || 0), 0);
    segmentRef.current = Math.max(segmentRef.current, maxIdx);
  }, [data.transcripts]);

  function track<T>(promise: Promise<T>): Promise<T> {
    pendingRef.current.add(promise);
    void promise.finally(() => pendingRef.current.delete(promise)).catch(() => undefined);
    return promise;
  }

  async function settlePending() {
    while (pendingRef.current.size > 0) {
      await Promise.allSettled(Array.from(pendingRef.current));
    }
  }

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
    const others = dataRef.current.participants.filter((p) => !isSameName(p.name, hostName));
    const named = others.find((p) => !isGenericRemote(p.name));
    return named?.name || others[0]?.name || REMOTE_PARTICIPANT_LABEL;
  }

  const live = useLiveTranscription({
    onFinalText: (text) => {
      const speaker = screen.remoteAudioActiveWithin(REMOTE_OVERLAP_MS)
        ? remoteSpeakerName()
        : hostName;
      void track(persistSegment(speaker, text));
    },
    onFatalError: (message) => toast.error(message),
  });

  const screen = useScreenShareCapture({
    isPaused: () => live.paused,
    onAudioChunk: async (dataUrl: string) => {
      try {
        const res = await transcribeRemote({
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
        });
        if (!res) return;
        const { renamed } = res;
        if (renamed) {
          setTranscripts((prev) =>
            prev.map((t) =>
              isGenericRemote(t.speaker) || isSameName(t.speaker, renamed.from)
                ? { ...t, speaker: renamed.to }
                : t,
            ),
          );
          toast.success(`Renamed ${renamed.from} to ${renamed.to} across all chat bubbles!`);
        }
        for (const seg of res.segments) {
          if (seg.content?.trim()) await persistSegment(seg.speaker, seg.content.trim());
        }
        await dataRef.current.reloadParticipants();
      } catch (err) {
        toast.error(friendlyAiError(err, "Remote audio could not be transcribed."), {
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

  function reportShare(result: ShareResult, automatic: boolean) {
    if (!result.ok) {
      if (automatic) {
        toast.info(
          "Screen sharing was skipped. Use Share call tab audio to transcribe remote participants.",
        );
      } else {
        toast.error("Screen sharing was cancelled or is not available in this browser.");
      }
      return;
    }
    if (result.audio) {
      toast.success("Screen & Tab Audio synced. Remote participants will be transcribed.");
    } else {
      toast.warning(
        "Screen shared without tab audio. Share again and tick Share tab audio to hear remote participants.",
      );
    }
  }

  async function startRecording() {
    const result = await live.start();
    if (!result.ok) {
      toast.error(result.reason);
      return;
    }
    const share = screen.start();
    const startedAt = meeting?.started_at || new Date().toISOString();
    const problem = mutationError(
      await supabase
        .from("meetings")
        .update({ status: "live", started_at: startedAt })
        .eq("id", meetingId)
        .select("id"),
      "Could not mark the meeting as live.",
    );
    if (problem) {
      live.stop();
      void share.then(() => screen.stop());
      toast.error(problem);
      return;
    }
    setMeeting((m) => (m ? { ...m, status: "live", started_at: startedAt } : m));
    await ensureHostParticipant();
    toast.success("Recording started. AI is listening.");
    reportShare(await share, true);
  }

  async function shareTabAudio() {
    reportShare(await screen.start(), false);
  }

  function stopCapture(): Promise<unknown> {
    live.stop();
    return screen.stop();
  }

  async function endMeeting() {
    if (ending) return;
    setEnding(true);
    try {
      const pending = live.takeInterim();
      if (pending) void track(persistSegment(hostName, pending));
      const duration = live.elapsed;

      await stopCapture();
      await settlePending();
      const endedAt = new Date().toISOString();
      const startedAt = meeting?.started_at || new Date(Date.now() - duration * 1000).toISOString();
      const problem = mutationError(
        await supabase
          .from("meetings")
          .update({
            status: "completed",
            ended_at: endedAt,
            duration_seconds: duration,
            started_at: startedAt,
          })
          .eq("id", meetingId)
          .select("id"),
        "Could not end the meeting.",
      );
      if (problem) {
        toast.error(problem);
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
      const { count, error: countError } = await supabase
        .from("transcripts")
        .select("id", { count: "exact", head: true })
        .eq("meeting_id", meetingId);
      if (!countError && (count ?? 0) === 0) {
        toast.info("No transcript was recorded, so no summary was generated.");
        return;
      }
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
    stopSharing: () => void screen.stop(),
    endMeeting,
  };
}

export type MeetingRecording = ReturnType<typeof useMeetingRecording>;
