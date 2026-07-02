import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Send, Sparkles, Bot, User as UserIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export const Route = createFileRoute("/_authenticated/chat")({
  head: () => ({ meta: [{ title: "AI Chat — Zeta" }] }),
  component: ChatPage,
});

type Msg = { role: "user" | "assistant"; content: string };

const SUGGESTIONS = [
  "What was discussed yesterday?",
  "What decisions were made?",
  "Who is responsible for the auth migration?",
  "Show meetings about authentication",
];

function ChatPage() {
  const [messages, setMessages] = useState<Msg[]>([
    { role: "assistant", content: "Hi, I'm Zeta. Ask me anything about your meetings — decisions, action items, discussions or people." },
  ]);
  const [input, setInput] = useState("");
  const [thinking, setThinking] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, thinking]);

  async function answer(q: string): Promise<string> {
    const lc = q.toLowerCase();
    const { data: meetings } = await supabase.from("meetings").select("*").order("created_at", { ascending: false });
    const { data: summaries } = await supabase.from("ai_summaries").select("*");
    const { data: actions } = await supabase.from("action_items").select("*");
    const { data: decisions } = await supabase.from("decisions").select("*");
    const { data: transcripts } = await supabase.from("transcripts").select("*").limit(200);

    if (lc.includes("decision")) {
      if (!decisions || decisions.length === 0) return "No decisions have been logged yet.";
      return "Recent decisions:\n" + decisions.slice(0, 5).map((d: any) => `• ${d.description}${d.made_by ? ` (${d.made_by})` : ""}`).join("\n");
    }
    if (lc.includes("responsible") || lc.includes("who") || lc.includes("owner") || lc.includes("assign")) {
      if (!actions || actions.length === 0) return "No action items yet.";
      return "Owners and action items:\n" + actions.slice(0, 8).map((a: any) => `• ${a.title} — ${a.assignee ?? "unassigned"}`).join("\n");
    }
    if (lc.includes("yesterday") || lc.includes("last")) {
      const past = (meetings ?? []).filter((m: any) => m.status === "completed");
      if (past.length === 0) return "No past meetings on record.";
      const sum = (summaries ?? []).find((s: any) => s.meeting_id === past[0].id);
      return `Last meeting: "${past[0].title}".\n\n${sum?.executive_summary ?? "No summary available."}`;
    }
    if (lc.includes("meeting") || lc.includes("show")) {
      const matches = (transcripts ?? []).filter((t: any) => q.split(" ").some((w) => w.length > 3 && t.content.toLowerCase().includes(w.toLowerCase())));
      if (matches.length > 0) {
        const ids = Array.from(new Set(matches.map((t: any) => t.meeting_id)));
        const named = ids.map((id) => (meetings ?? []).find((m: any) => m.id === id)?.title).filter(Boolean);
        return `Found ${matches.length} mentions across ${named.length} meeting(s):\n` + named.map((n) => `• ${n}`).join("\n");
      }
      return "I couldn't find matching mentions in your meeting history.";
    }
    if (summaries && summaries.length) {
      return `Here's what I know from recent meetings:\n\n${summaries.slice(0, 2).map((s: any) => `• ${s.executive_summary}`).join("\n\n")}`;
    }
    return "I don't have enough context yet. Try running a meeting first and I'll build memory.";
  }

  async function send(text?: string) {
    const q = (text ?? input).trim();
    if (!q) return;
    setInput("");
    setMessages((m) => [...m, { role: "user", content: q }]);
    setThinking(true);
    const reply = await answer(q);
    await new Promise((r) => setTimeout(r, 400));
    setMessages((m) => [...m, { role: "assistant", content: reply }]);
    setThinking(false);
  }

  return (
    <div className="mx-auto flex h-[calc(100vh-160px)] max-w-3xl flex-col">
      <header className="mb-4">
        <h1 className="text-2xl font-black tracking-tight">Ask Zeta</h1>
        <p className="text-sm text-muted-foreground">Semantic search across every meeting, decision and transcript.</p>
      </header>

      <div className="glass flex-1 overflow-y-auto rounded-2xl p-4">
        <div className="space-y-3">
          {messages.map((m, i) => (
            <div key={i} className={"flex gap-3 " + (m.role === "user" ? "justify-end" : "")}>
              {m.role === "assistant" && <div className="gradient-bg grid h-8 w-8 shrink-0 place-items-center rounded-lg"><Bot className="h-4 w-4 text-primary-foreground" /></div>}
              <div className={"max-w-[80%] whitespace-pre-wrap rounded-2xl px-4 py-2 text-sm " + (m.role === "user" ? "gradient-bg text-primary-foreground" : "glass")}>{m.content}</div>
              {m.role === "user" && <div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-white/10"><UserIcon className="h-4 w-4" /></div>}
            </div>
          ))}
          {thinking && (
            <div className="flex gap-3">
              <div className="gradient-bg grid h-8 w-8 shrink-0 place-items-center rounded-lg"><Bot className="h-4 w-4 text-primary-foreground" /></div>
              <div className="glass rounded-2xl px-4 py-2 text-sm">
                <span className="inline-flex gap-1">
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-primary" />
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-primary [animation-delay:100ms]" />
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-primary [animation-delay:200ms]" />
                </span>
              </div>
            </div>
          )}
          <div ref={endRef} />
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        {SUGGESTIONS.map((s) => (
          <button key={s} onClick={() => send(s)} className="glass rounded-full px-3 py-1 text-xs text-muted-foreground hover:text-foreground">
            <Sparkles className="mr-1 inline h-3 w-3" />{s}
          </button>
        ))}
      </div>

      <form onSubmit={(e) => { e.preventDefault(); send(); }} className="mt-3 flex gap-2">
        <Input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Ask about a meeting…" className="glass border-white/10" />
        <Button type="submit" className="gradient-bg rounded-full shadow-glow"><Send className="h-4 w-4" /></Button>
      </form>
    </div>
  );
}
