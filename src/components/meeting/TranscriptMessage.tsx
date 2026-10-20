import { useState } from "react";
import { Check, ChevronDown, Copy, Scissors, Trash2, UserRound } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { Participant, Transcript } from "./types";
import { copyText, formatTime, getInitials, isSameName, speakerTone } from "./utils";

export function TranscriptMessage({
  t,
  isHost,
  hostName,
  participants,
  onSetSpeaker,
  onSplit,
  onDelete,
  readOnly = false,
}: {
  t: Transcript;
  isHost: boolean;
  hostName: string;
  participants: Participant[];
  onSetSpeaker: (id: string, speaker: string) => void;
  onSplit: (id: string) => void;
  onDelete: (id: string) => void;
  readOnly?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const multiLine = t.content.includes("\n");
  const speakerOptions = Array.from(
    new Set([hostName, ...participants.map((p) => p.name)].filter(Boolean)),
  ).filter((name) => !isSameName(name, t.speaker));

  async function copy() {
    const ok = await copyText(`[${formatTime(t.spoken_at)}] ${t.speaker}: ${t.content}`);
    if (!ok) {
      toast.error("Could not copy to the clipboard.");
      return;
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const avatar = (
    <div
      aria-hidden
      className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold ${speakerTone(t.speaker, isHost)}`}
    >
      {getInitials(t.speaker)}
    </div>
  );

  return (
    <li className={`flex items-start gap-2.5 ${isHost ? "justify-end" : "justify-start"}`}>
      {!isHost && avatar}
      <div
        className={`max-w-[85%] rounded-2xl border px-4 py-3 sm:max-w-[75%] ${
          isHost
            ? "rounded-tr-sm border-primary/20 bg-primary/10"
            : "rounded-tl-sm border-border bg-surface-2"
        }`}
      >
        <div className="mb-1.5 flex items-center justify-between gap-3 text-xs">
          {readOnly ? (
            <span className="font-semibold text-foreground">{t.speaker}</span>
          ) : (
            <DropdownMenu>
              <DropdownMenuTrigger
                className="inline-flex items-center gap-1 rounded font-semibold text-foreground hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                aria-label={`Message options. Speaker: ${t.speaker}`}
              >
                {t.speaker}
                {isHost && <span className="font-normal text-muted-foreground">(you)</span>}
                <ChevronDown className="h-3 w-3 text-muted-foreground" aria-hidden />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-56">
                {speakerOptions.length > 0 && <DropdownMenuLabel>Change speaker</DropdownMenuLabel>}
                {speakerOptions.map((name) => (
                  <DropdownMenuItem key={name} onSelect={() => onSetSpeaker(t.id, name)}>
                    <UserRound className="mr-2 h-4 w-4 text-muted-foreground" />
                    {name}
                    {isSameName(name, hostName) && " (you)"}
                  </DropdownMenuItem>
                ))}
                {speakerOptions.length > 0 && <DropdownMenuSeparator />}
                {multiLine && (
                  <DropdownMenuItem onSelect={() => onSplit(t.id)}>
                    <Scissors className="mr-2 h-4 w-4 text-muted-foreground" />
                    Split into separate lines
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem
                  onSelect={() => onDelete(t.id)}
                  className="text-destructive focus:text-destructive"
                >
                  <Trash2 className="mr-2 h-4 w-4" />
                  Delete message
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 text-muted-foreground"
            onClick={() => void copy()}
            aria-label="Copy message"
          >
            {copied ? (
              <Check className="h-3.5 w-3.5 text-success" />
            ) : (
              <Copy className="h-3.5 w-3.5" />
            )}
          </Button>
        </div>
        <p className="whitespace-pre-wrap text-sm leading-relaxed">{t.content}</p>
        <p className="mt-1.5 text-right text-xs text-muted-foreground">
          <time dateTime={t.spoken_at}>{formatTime(t.spoken_at)}</time>
        </p>
      </div>
      {isHost && avatar}
    </li>
  );
}
