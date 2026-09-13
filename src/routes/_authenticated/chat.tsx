import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Send, Sparkles, Bot, User as UserIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { askChatBot } from "@/lib/ai.functions";

export const Route = createFileRoute("/_authenticated/chat")({
  head: () => ({ meta: [{ title: "AI Chat Bot — AI Powered Meeting Companion" }] }),
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
    { role: "assistant", content: "Hi, I'm AI Powered Meeting Companion. Ask me anything about your meetings — decisions, action items, discussions or people." },
  ]);
  const [input, setInput] = useState("");
  const [thinking, setThinking] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, thinking]);

  async function send(text?: string) {
    const q = (text ?? input).trim();
    if (!q) return;
    setInput("");
    
    const newMessages: Msg[] = [...messages, { role: "user", content: q }];
    setMessages(newMessages);
    setThinking(true);
    
    try {
      const reply = await askChatBot({ data: { messages: newMessages } });
      setMessages((m) => [...m, { role: "assistant", content: reply }]);
    } catch (err: any) {
      setMessages((m) => [...m, { role: "assistant", content: "Sorry, I ran into an error connecting to my brain. Please try again." }]);
    } finally {
      setThinking(false);
    }
  }

  return (
    <div className="mx-auto flex h-[calc(100vh-160px)] max-w-3xl flex-col">
      <header className="mb-4">
        <h1 className="text-2xl font-black tracking-tight">Ask AI Powered Meeting Companion</h1>
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
