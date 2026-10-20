import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type {
  ActionItem,
  Decision,
  Meeting,
  Participant,
  Summary,
  Transcript,
} from "@/components/meeting/types";

export type MeetingData = ReturnType<typeof useMeetingData>;

export function useMeetingData(meetingId: string) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [meeting, setMeeting] = useState<Meeting | null>(null);
  const [transcripts, setTranscripts] = useState<Transcript[]>([]);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [actions, setActions] = useState<ActionItem[]>([]);
  const [decisions, setDecisions] = useState<Decision[]>([]);
  const [hostName, setHostName] = useState("You");
  const [hostEmail, setHostEmail] = useState<string | null>(null);

  const [currentUserId, setCurrentUserId] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setError(null);
    try {
      const [auth, mm, tt, pp, ss, aa, dd] = await Promise.all([
        supabase.auth.getSession(),
        supabase.from("meetings").select("*").eq("id", meetingId).maybeSingle(),
        supabase
          .from("transcripts")
          .select("*")
          .eq("meeting_id", meetingId)
          .order("segment_index")
          .order("spoken_at"),
        supabase.from("participants").select("*").eq("meeting_id", meetingId).order("created_at"),
        supabase.from("ai_summaries").select("*").eq("meeting_id", meetingId).maybeSingle(),
        supabase.from("action_items").select("*").eq("meeting_id", meetingId).order("created_at"),
        supabase.from("decisions").select("*").eq("meeting_id", meetingId).order("created_at"),
      ]);
      const firstError = [mm, tt, pp, ss, aa, dd].find((r) => r.error)?.error;
      if (firstError) throw new Error(firstError.message);

      setCurrentUserId(auth.data.session?.user.id ?? null);
      setMeeting((mm.data as Meeting | null) ?? null);
      setTranscripts((tt.data as Transcript[]) ?? []);
      setParticipants((pp.data as Participant[]) ?? []);
      setSummary((ss.data as Summary | null) ?? null);
      setActions((aa.data as ActionItem[]) ?? []);
      setDecisions((dd.data as Decision[]) ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load this meeting.");
    } finally {
      setLoading(false);
    }
  }, [meetingId]);

  const reloadParticipants = useCallback(async () => {
    const { data, error: pErr } = await supabase
      .from("participants")
      .select("*")
      .eq("meeting_id", meetingId)
      .order("created_at");
    if (!pErr && data) setParticipants(data as Participant[]);
  }, [meetingId]);

  useEffect(() => {
    setLoading(true);
    void reload();
  }, [reload]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase.auth.getUser();
      const user = data?.user;
      if (!user || cancelled) return;
      const { data: prof } = await supabase
        .from("profiles")
        .select("full_name")
        .eq("id", user.id)
        .maybeSingle();
      if (cancelled) return;
      const name = prof?.full_name?.trim() || user.email?.split("@")[0] || "You";
      setHostName(name);
      setHostEmail(user.email ?? null);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const channel = supabase
      .channel(`meeting_actions_${meetingId}`)
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "action_items" },
        (payload) => {
          const oldId = (payload.old as { id?: string }).id;
          if (!oldId) return;
          setActions((prev) =>
            prev.some((a) => a.id === oldId) ? prev.filter((a) => a.id !== oldId) : prev,
          );
        },
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "action_items",
          filter: `meeting_id=eq.${meetingId}`,
        },
        (payload) => {
          if (payload.eventType === "UPDATE") {
            const row = payload.new as ActionItem;
            setActions((prev) => prev.map((a) => (a.id === row.id ? { ...a, ...row } : a)));
          } else if (payload.eventType === "INSERT") {
            const row = payload.new as ActionItem;
            setActions((prev) => (prev.some((a) => a.id === row.id) ? prev : [...prev, row]));
          }
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [meetingId]);

  return {
    meetingId,
    loading,
    error,
    meeting,
    setMeeting,
    transcripts,
    setTranscripts,
    participants,
    setParticipants,
    summary,
    setSummary,
    actions,
    setActions,
    decisions,
    setDecisions,
    hostName,
    hostEmail,
    currentUserId,
    reload,
    reloadParticipants,
  };
}
