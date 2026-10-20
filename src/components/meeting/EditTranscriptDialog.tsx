import { useState } from "react";
import { Loader2, Pencil, Wand2 } from "lucide-react";
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
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { Transcript } from "./types";

export function EditTranscriptDialog({
  transcripts,
  cleaning,
  onSubmit,
}: {
  transcripts: Transcript[];
  cleaning: boolean;
  onSubmit: (text: string) => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");

  function handleOpenChange(next: boolean) {
    if (next) setText(transcripts.map((t) => `${t.speaker}: ${t.content}`).join("\n"));
    setOpen(next);
  }

  async function submit() {
    const ok = await onSubmit(text);
    if (ok) setOpen(false);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="rounded-full">
          <Pencil className="h-4 w-4" /> Edit Script
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Edit / Paste Meeting Transcript</DialogTitle>
          <DialogDescription>
            Use one line per turn, written as <code>Speaker: text</code>. Gemini AI fixes
            speech-to-text typos, attributes each line to the right speaker and replaces the current
            transcript. The summary and action items are then refreshed.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="transcript-text">Transcript</Label>
          <Textarea
            id="transcript-text"
            rows={12}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Speaker name: what they said"
            className="font-mono text-xs leading-relaxed"
          />
        </div>
        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => void submit()}
            disabled={cleaning || !text.trim()}
            className="gradient-bg text-primary-foreground"
          >
            {cleaning ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Wand2 className="h-4 w-4" />
            )}
            Clean &amp; Re-align with AI
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
