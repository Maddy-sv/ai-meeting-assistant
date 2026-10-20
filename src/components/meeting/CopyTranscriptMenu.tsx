import { useState } from "react";
import { ClipboardCheck, Copy, Download, FileText } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { CopyFormat, Meeting, Transcript } from "./types";
import { copyText, downloadTranscript, formatTranscripts } from "./utils";

const FORMATS: { format: CopyFormat; label: string }[] = [
  { format: "formatted", label: "With timestamps" },
  { format: "plain", label: "Plain text" },
  { format: "markdown", label: "Markdown" },
  { format: "json", label: "JSON" },
];

export function CopyTranscriptMenu({
  meeting,
  transcripts,
  size = "default",
  label = "Copy Transcripts",
}: {
  meeting: Meeting | null;
  transcripts: Transcript[];
  size?: "default" | "sm";
  label?: string;
}) {
  const [copied, setCopied] = useState(false);
  const empty = transcripts.length === 0;

  async function copy(format: CopyFormat) {
    if (empty) {
      toast.info("There is no transcript to copy yet.");
      return;
    }
    const ok = await copyText(formatTranscripts(transcripts, format, meeting));
    if (!ok) {
      toast.error("Could not copy to the clipboard.");
      return;
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    toast.success("Transcript copied to clipboard.");
  }

  function download() {
    if (!downloadTranscript(meeting, transcripts)) {
      toast.info("There is no transcript to download yet.");
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size={size} className="rounded-full">
          {copied ? (
            <ClipboardCheck className="h-4 w-4 text-success" />
          ) : (
            <Copy className="h-4 w-4" />
          )}
          {copied ? "Copied All!" : label}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        {FORMATS.map((f) => (
          <DropdownMenuItem key={f.format} onSelect={() => void copy(f.format)}>
            <FileText className="mr-2 h-4 w-4 text-muted-foreground" />
            Copy {f.label.toLowerCase()}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={download}>
          <Download className="mr-2 h-4 w-4 text-muted-foreground" />
          Download .txt
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
