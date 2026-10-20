import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { cleanAndAlignTranscripts } from "@/lib/ai.functions";
import type { Participant } from "@/components/meeting/types";
import { errorMessage, isSameName, mutationError } from "@/components/meeting/utils";
import type { MeetingData } from "./use-meeting-data";

export type NewParticipantInput = { name: string; email: string; role: string };

export function useMeetingTranscriptEdits(data: MeetingData) {
  const {
    meetingId,
    transcripts,
    setTranscripts,
    participants,
    setParticipants,
    setMeeting,
    reload,
  } = data;
  const cleanFn = useServerFn(cleanAndAlignTranscripts);
  const [cleaning, setCleaning] = useState(false);

  async function setSpeaker(transcriptId: string, speaker: string) {
    const snapshot = transcripts;
    setTranscripts((prev) => prev.map((t) => (t.id === transcriptId ? { ...t, speaker } : t)));
    const problem = mutationError(
      await supabase.from("transcripts").update({ speaker }).eq("id", transcriptId).select("id"),
      "Could not change the speaker.",
    );
    if (problem) {
      setTranscripts(snapshot);
      toast.error(problem);
    } else {
      toast.success(`Assigned to ${speaker}.`);
    }
  }

  async function splitMessage(transcriptId: string) {
    const target = transcripts.find((t) => t.id === transcriptId);
    if (!target) return;
    const lines = target.content
      .split(/\n+/)
      .map((l) => l.trim())
      .filter(Boolean);
    if (lines.length <= 1) {
      toast.info("This message is already a single line.");
      return;
    }
    const base = new Date(target.spoken_at).getTime() || Date.now();
    const extra = lines.slice(1).map((content, idx) => ({
      meeting_id: meetingId,
      speaker: target.speaker,
      content,
      segment_index: target.segment_index,
      spoken_at: new Date(base + idx + 1).toISOString(),
    }));
    const updProblem = mutationError(
      await supabase
        .from("transcripts")
        .update({ content: lines[0] })
        .eq("id", transcriptId)
        .select("id"),
      "Could not split the message.",
    );
    if (updProblem) {
      toast.error(updProblem);
      return;
    }
    const { error: insErr } = await supabase.from("transcripts").insert(extra);
    if (insErr) {
      await supabase.from("transcripts").update({ content: target.content }).eq("id", transcriptId);
      toast.error(insErr.message || "Could not split the message.");
      return;
    }
    await reload();
    toast.success(`Split into ${lines.length} messages.`);
  }

  async function deleteMessage(transcriptId: string) {
    const snapshot = transcripts;
    setTranscripts((prev) => prev.filter((t) => t.id !== transcriptId));
    const problem = mutationError(
      await supabase.from("transcripts").delete().eq("id", transcriptId).select("id"),
      "Could not delete the message.",
    );
    if (problem) {
      setTranscripts(snapshot);
      toast.error(problem);
    } else {
      toast.success("Message deleted.");
    }
  }

  async function cleanTranscript(rawText?: string): Promise<boolean> {
    setCleaning(true);
    try {
      const res = await cleanFn({ data: { meetingId, rawText: rawText?.trim() || undefined } });
      if (res && Array.isArray(res.transcripts) && res.transcripts.length > 0) {
        await reload();
        toast.success("Transcript cleaned and speakers re-aligned.");
        return true;
      }
      toast.error("The transcript could not be cleaned. Try again.");
      return false;
    } catch (err) {
      toast.error(errorMessage(err, "Could not clean the transcript."));
      return false;
    } finally {
      setCleaning(false);
    }
  }

  async function addParticipant(input: NewParticipantInput): Promise<boolean> {
    const name = input.name.trim();
    if (!name) {
      toast.error("Enter the participant's name.");
      return false;
    }
    if (participants.some((p) => isSameName(p.name, name))) {
      toast.info(`${name} is already a participant.`);
      return false;
    }
    const { data: row, error } = await supabase
      .from("participants")
      .insert({
        meeting_id: meetingId,
        name,
        email: input.email.trim() || null,
        role: input.role || "participant",
      })
      .select()
      .single();
    if (error || !row) {
      toast.error(error?.message || "Could not add the participant.");
      return false;
    }
    setParticipants((prev) => [...prev, row as Participant]);
    toast.success(`Added ${name}.`);
    return true;
  }

  async function renameParticipant(participant: Participant, newName: string) {
    const name = newName.trim();
    if (!name || name === participant.name) return;
    const pSnapshot = participants;
    const tSnapshot = transcripts;
    setParticipants((prev) => prev.map((p) => (p.id === participant.id ? { ...p, name } : p)));
    setTranscripts((prev) =>
      prev.map((t) => (t.speaker === participant.name ? { ...t, speaker: name } : t)),
    );
    const pProblem = mutationError(
      await supabase.from("participants").update({ name }).eq("id", participant.id).select("id"),
      "Could not rename the participant.",
    );

    const { error: tErr } = pProblem
      ? { error: null }
      : await supabase
          .from("transcripts")
          .update({ speaker: name })
          .eq("meeting_id", meetingId)
          .eq("speaker", participant.name);
    if (pProblem || tErr) {
      setParticipants(pSnapshot);
      setTranscripts(tSnapshot);
      toast.error(pProblem || tErr?.message || "Could not rename the participant.");
      if (tErr) await reload();
      return;
    }
    toast.success(`Renamed ${participant.name} to ${name}.`);
  }

  async function removeParticipant(participant: Participant) {
    const snapshot = participants;
    setParticipants((prev) => prev.filter((p) => p.id !== participant.id));
    const problem = mutationError(
      await supabase.from("participants").delete().eq("id", participant.id).select("id"),
      "Could not remove the participant.",
    );
    if (problem) {
      setParticipants(snapshot);
      toast.error(problem);
    } else {
      toast.success(`Removed ${participant.name}.`);
    }
  }

  async function saveMeetingLink(link: string): Promise<boolean> {
    const value = link.trim();
    try {
      const url = new URL(value);
      if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("bad scheme");
    } catch {
      toast.error("Enter a valid http(s) meeting link.");
      return false;
    }
    const problem = mutationError(
      await supabase
        .from("meetings")
        .update({ meeting_link: value })
        .eq("id", meetingId)
        .select("id"),
      "Could not save the link.",
    );
    if (problem) {
      toast.error(problem);
      return false;
    }
    setMeeting((prev) => (prev ? { ...prev, meeting_link: value } : prev));
    toast.success("Meeting link saved.");
    return true;
  }

  return {
    cleaning,
    setSpeaker,
    splitMessage,
    deleteMessage,
    cleanTranscript,
    addParticipant,
    renameParticipant,
    removeParticipant,
    saveMeetingLink,
  };
}

export type MeetingTranscriptEdits = ReturnType<typeof useMeetingTranscriptEdits>;
