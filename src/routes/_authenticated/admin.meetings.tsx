import { createFileRoute } from "@tanstack/react-router";
import { Video, Search, CheckCircle2, Activity } from "lucide-react";

export const Route = createFileRoute("/_authenticated/admin/meetings")({
  head: () => ({ meta: [{ title: "Meeting Management — Admin Control Center" }] }),
  component: AdminMeetings,
});

function AdminMeetings() {
  const dummyMeetings = [
    { id: "m1", title: "Product Sync", host: "Sumeet M", duration: "30m", status: "completed", ai_status: "processed", date: "2026-08-20" },
    { id: "m2", title: "Marketing Kickoff", host: "Jane Doe", duration: "1h 15m", status: "completed", ai_status: "processed", date: "2026-08-19" },
    { id: "m3", title: "Design Review", host: "John Smith", duration: "-", status: "upcoming", ai_status: "pending", date: "2026-08-21" },
    { id: "m4", title: "Weekly Standup", host: "Emily Chen", duration: "15m", status: "completed", ai_status: "failed", date: "2026-08-19" },
    { id: "m5", title: "Client Demo", host: "Michael Scott", duration: "45m", status: "live", ai_status: "processing", date: "2026-08-20" },
  ];

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <header className="border-b border-white/5 pb-6">
        <h1 className="text-3xl font-black tracking-tight flex items-center gap-3">
          <Video className="h-8 w-8 text-red-500" />
          Meeting Management
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">Monitor platform meetings and AI processing status.</p>
      </header>

      <div className="glass rounded-2xl p-6 border-red-500/10">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-lg font-bold">All Meetings</h2>
          <div className="flex bg-black/20 rounded-lg px-3 py-1.5 items-center gap-2 border border-white/5">
            <Search className="h-4 w-4 text-muted-foreground" />
            <input placeholder="Search meetings..." className="bg-transparent text-sm outline-none w-64" />
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="text-xs uppercase bg-white/5 text-muted-foreground">
              <tr>
                <th className="px-4 py-3 rounded-tl-lg">Meeting Title</th>
                <th className="px-4 py-3">Host</th>
                <th className="px-4 py-3">Date</th>
                <th className="px-4 py-3">Duration</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 rounded-tr-lg">AI Processing</th>
              </tr>
            </thead>
            <tbody>
              {dummyMeetings.map(m => (
                <tr key={m.id} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                  <td className="px-4 py-3 font-medium text-foreground">{m.title}</td>
                  <td className="px-4 py-3 text-muted-foreground">{m.host}</td>
                  <td className="px-4 py-3 text-muted-foreground">{m.date}</td>
                  <td className="px-4 py-3 text-muted-foreground">{m.duration}</td>
                  <td className="px-4 py-3">
                    <span className="capitalize text-[10px] font-bold tracking-wider px-2 py-1 rounded-full bg-white/5">
                      {m.status}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-xs flex items-center w-fit gap-1 px-2 py-1 rounded-full ${m.ai_status === 'processed' ? 'bg-green-500/20 text-green-400' : m.ai_status === 'failed' ? 'bg-red-500/20 text-red-400' : 'bg-amber-500/20 text-amber-400'}`}>
                      {m.ai_status === 'processed' ? <CheckCircle2 className="h-3 w-3" /> : <Activity className="h-3 w-3" />}
                      <span className="capitalize font-bold">{m.ai_status}</span>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
