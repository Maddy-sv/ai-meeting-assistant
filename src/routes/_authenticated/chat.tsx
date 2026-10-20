import { useEffect, useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bot, Loader2, Send, Sparkles, Trash2, User as UserIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ConfirmDialog, ErrorState, LoadingState, PageHeader } from "@/components/layout";
import { useUser } from "@/lib/auth";
import { askChat, clearChatMessages, dataKeys, listChatMessages } from "@/lib/rpc";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/chat")({
  head: () => ({ meta: [{ title: "AI Chat Bot — AI Powered Meeting Companion" }] }),
  component: ChatPage,
});

const MAX_MESSAGE_LENGTH = 4000;

const GREETING =
  "Hi, I'm AI Powered Meeting Companion. Ask me anything about your meetings — decisions, action items, discussions or people.";

const SUGGESTIONS = [
  "What was discussed yesterday?",
  "What decisions were made?",
  "Which tasks are still open?",
  "What deadlines are coming up?",
];

function ChatPage() {
  const user = useUser();
  const userId = user?.id ?? "";
  const queryClient = useQueryClient();
  const [input, setInput] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const history = useQuery({
    queryKey: dataKeys.chat(userId),
    queryFn: () => listChatMessages(userId),
    enabled: !!user,
  });
  const messages = history.data ?? [];

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length, pending]);

  async function send(text?: string) {
    const message = (text ?? input).trim();
    if (!message || pending) return;
    if (message.length > MAX_MESSAGE_LENGTH) {
      toast.error(`Messages can be at most ${MAX_MESSAGE_LENGTH} characters.`);
      return;
    }
    setInput("");
    setPending(message);
    try {
      await askChat(message);

      await queryClient.invalidateQueries({ queryKey: dataKeys.chat(userId) });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not send your message.");
      setInput(message);
    } finally {
      setPending(null);
      inputRef.current?.focus();
    }
  }

  async function clearHistory() {
    await clearChatMessages(userId);
    await queryClient.invalidateQueries({ queryKey: dataKeys.chat(userId) });
    toast.success("Chat history cleared.");
  }

  return (
    <div className="mx-auto flex h-[calc(100dvh-8.5rem)] max-w-3xl flex-col gap-4 lg:h-[calc(100dvh-10rem)]">
      <PageHeader
        title="AI Chat Bot"
        description="Ask AI Powered Meeting Companion. Answers come only from your own meetings, summaries, tasks and decisions."
        actions={
          messages.length > 0 && (
            <ConfirmDialog
              title="Clear chat history?"
              description="All of your messages and answers in this chat will be deleted. Your meetings are not affected."
              confirmLabel="Clear history"
              destructive
              onConfirm={clearHistory}
              trigger={
                <Button variant="glass" size="sm" disabled={!!pending}>
                  <Trash2 /> Clear history
                </Button>
              }
            />
          )
        }
      />

      <div className="glass min-h-0 flex-1 overflow-y-auto rounded-2xl p-4">
        {history.isLoading && <LoadingState variant="list" rows={3} label="Loading chat…" />}
        {history.isError && (
          <ErrorState message={history.error.message} onRetry={() => history.refetch()} />
        )}
        <ol aria-live="polite" aria-label="Chat messages" className="space-y-3">
          {history.isSuccess && messages.length === 0 && (
            <Bubble role="assistant" content={GREETING} />
          )}
          {messages.map((m) => (
            <Bubble key={m.id} role={m.role} content={m.content} />
          ))}
          {pending && <Bubble role="user" content={pending} />}
          {pending && (
            <li className="flex gap-3">
              <BotAvatar />
              <div className="glass rounded-2xl px-4 py-3" role="status">
                <span className="sr-only">The assistant is typing…</span>
                <span className="inline-flex gap-1" aria-hidden>
                  <span className="h-1.5 w-1.5 rounded-full bg-primary motion-safe:animate-bounce" />
                  <span className="h-1.5 w-1.5 rounded-full bg-primary motion-safe:animate-bounce [animation-delay:100ms]" />
                  <span className="h-1.5 w-1.5 rounded-full bg-primary motion-safe:animate-bounce [animation-delay:200ms]" />
                </span>
              </div>
            </li>
          )}
        </ol>
        <div ref={endRef} />
      </div>

      {history.isSuccess && (
        <div className="flex flex-wrap gap-2" role="group" aria-label="Suggested questions">
          {SUGGESTIONS.map((s) => (
            <Button
              key={s}
              variant="glass"
              size="sm"
              disabled={!!pending || !history.isSuccess}
              onClick={() => send(s)}
              className="h-auto whitespace-normal py-1.5 text-left"
            >
              <Sparkles /> {s}
            </Button>
          ))}
        </div>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
        className="flex gap-2"
      >
        <label htmlFor="chat-input" className="sr-only">
          Your question
        </label>
        <Input
          id="chat-input"
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask about a meeting…"
          maxLength={MAX_MESSAGE_LENGTH}
          disabled={!!pending}
          autoComplete="off"
        />
        <Button
          type="submit"
          variant="brand"
          size="icon"
          aria-label="Send message"
          disabled={!!pending || !input.trim()}
        >
          {pending ? <Loader2 className="animate-spin" /> : <Send />}
        </Button>
      </form>
    </div>
  );
}

function BotAvatar() {
  return (
    <div className="gradient-bg grid h-8 w-8 shrink-0 place-items-center rounded-lg" aria-hidden>
      <Bot className="h-4 w-4 text-primary-foreground" />
    </div>
  );
}

function Bubble({ role, content }: { role: "user" | "assistant"; content: string }) {
  const isUser = role === "user";
  return (
    <li className={cn("flex gap-3", isUser && "justify-end")}>
      {!isUser && <BotAvatar />}
      <div
        className={cn(
          "max-w-[85%] whitespace-pre-wrap break-words rounded-2xl px-4 py-2 text-sm",
          isUser ? "gradient-bg text-primary-foreground" : "glass",
        )}
      >
        <span className="sr-only">{isUser ? "You: " : "Assistant: "}</span>
        {content}
      </div>
      {isUser && (
        <div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-muted" aria-hidden>
          <UserIcon className="h-4 w-4" />
        </div>
      )}
    </li>
  );
}
