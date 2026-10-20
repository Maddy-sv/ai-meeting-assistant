import { createFileRoute } from "@tanstack/react-router";
import { Zap, Activity, CheckCircle2, AlertTriangle, XCircle } from "lucide-react";

export const Route = createFileRoute("/_authenticated/admin/ai")({
  head: () => ({ meta: [{ title: "AI Processing — Admin Control Center" }] }),
  component: AdminAI,
});

function AdminAI() {
  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <header className="border-b border-white/5 pb-6">
        <h1 className="text-3xl font-black tracking-tight flex items-center gap-3">
          <Zap className="h-8 w-8 text-red-500" />
          AI Processing Monitor
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Detailed metrics on transcription and AI generation services.
        </p>
      </header>

      <div className="grid md:grid-cols-3 gap-6">
        <div className="glass rounded-2xl p-6 border-blue-500/10">
          <h2 className="text-lg font-bold mb-4 flex items-center gap-2">
            <Activity className="h-5 w-5 text-blue-400" /> Transcription Engine
          </h2>
          <div className="space-y-4">
            <StatRow label="Jobs Processed" value="1,248" />
            <StatRow label="Total Audio Hours" value="842h" />
            <StatRow label="Avg Latency" value="0.8s" color="text-green-400" />
            <StatRow label="Success Rate" value="99.8%" color="text-green-400" />
          </div>
        </div>

        <div className="glass rounded-2xl p-6 border-purple-500/10">
          <h2 className="text-lg font-bold mb-4 flex items-center gap-2">
            <Zap className="h-5 w-5 text-purple-400" /> Summarization LLM
          </h2>
          <div className="space-y-4">
            <StatRow label="Summaries Generated" value="1,102" />
            <StatRow label="Tokens Processed" value="4.2M" />
            <StatRow label="Avg Latency" value="2.4s" color="text-amber-400" />
            <StatRow label="Success Rate" value="95.2%" color="text-amber-400" />
          </div>
        </div>

        <div className="glass rounded-2xl p-6">
          <h2 className="text-lg font-bold mb-4">Service Health</h2>
          <div className="space-y-3">
            <HealthRow label="Google Cloud STT" status="operational" />
            <HealthRow label="OpenAI GPT-4" status="operational" />
            <HealthRow label="Anthropic Claude" status="warning" />
            <HealthRow label="Webhook Receiver" status="operational" />
          </div>
        </div>
      </div>
    </div>
  );
}

function StatRow({ label, value, color = "text-foreground" }: any) {
  return (
    <div className="flex justify-between items-center text-sm border-b border-white/5 pb-2 last:border-0 last:pb-0">
      <span className="text-muted-foreground">{label}</span>
      <span className={`font-mono font-bold ${color}`}>{value}</span>
    </div>
  );
}

function HealthRow({
  label,
  status,
}: {
  label: string;
  status: "operational" | "warning" | "error";
}) {
  return (
    <div className="flex items-center justify-between p-3 rounded-lg bg-white/5">
      <span className="text-sm font-medium">{label}</span>
      {status === "operational" && (
        <span className="flex items-center gap-1 text-[10px] uppercase text-green-500 font-bold">
          <CheckCircle2 className="h-3 w-3" /> OK
        </span>
      )}
      {status === "warning" && (
        <span className="flex items-center gap-1 text-[10px] uppercase text-amber-500 font-bold">
          <AlertTriangle className="h-3 w-3" /> Degraded
        </span>
      )}
      {status === "error" && (
        <span className="flex items-center gap-1 text-[10px] uppercase text-red-500 font-bold">
          <XCircle className="h-3 w-3" /> Offline
        </span>
      )}
    </div>
  );
}
