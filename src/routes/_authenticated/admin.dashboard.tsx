import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  ShieldAlert,
  Users,
  Video,
  Activity,
  HardDrive,
  Database,
  Server,
  Zap,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Search,
} from "lucide-react";

export const Route = createFileRoute("/_authenticated/admin/dashboard")({
  head: () => ({ meta: [{ title: "Admin Control Center — AI Powered Meeting Companion" }] }),
  component: AdminDashboard,
});

type UserStat = { id: string; name: string; email: string; role: string; registered_at: string };
type MeetingStat = {
  id: string;
  title: string;
  host: string;
  duration: number;
  status: string;
  ai_status: string;
};

function AdminDashboard() {
  const [stats, setStats] = useState({
    users: 0,
    active: 0,
    meetings: 0,
    today: 0,
    ai_requests: 0,
  });
  const [users, setUsers] = useState<UserStat[]>([]);
  const [meetings, setMeetings] = useState<MeetingStat[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // In a real app, this would hit an admin API.
    // Here we query what we can via Supabase and mock the rest for the UI.
    (async () => {
      const [{ count: meetingCount }, { count: todayCount }] = await Promise.all([
        supabase.from("meetings").select("*", { count: "exact", head: true }),
        supabase
          .from("meetings")
          .select("*", { count: "exact", head: true })
          .gte("created_at", new Date().toISOString().split("T")[0]),
      ]);

      // Mock user fetching since auth.users isn't readable by public clients without edge functions
      const mockUsers: UserStat[] = [
        {
          id: "1",
          name: "Sumeet M",
          email: "sumeetmadesm@gmail.com",
          role: "admin",
          registered_at: "2026-08-20",
        },
        {
          id: "2",
          name: "Jane Doe",
          email: "jane.doe@example.com",
          role: "user",
          registered_at: "2026-08-19",
        },
        {
          id: "3",
          name: "John Smith",
          email: "john@example.com",
          role: "user",
          registered_at: "2026-08-18",
        },
      ];

      // Mock meetings
      const mockMeetings: MeetingStat[] = [
        {
          id: "m1",
          title: "Product Sync",
          host: "Sumeet M",
          duration: 1800,
          status: "completed",
          ai_status: "processed",
        },
        {
          id: "m2",
          title: "Marketing Kickoff",
          host: "Jane Doe",
          duration: 3600,
          status: "completed",
          ai_status: "processed",
        },
        {
          id: "m3",
          title: "Design Review",
          host: "John Smith",
          duration: 0,
          status: "upcoming",
          ai_status: "pending",
        },
      ];

      setStats({
        users: 142,
        active: 89,
        meetings: meetingCount || 0,
        today: todayCount || 0,
        ai_requests: 1254,
      });
      setUsers(mockUsers);
      setMeetings(mockMeetings);
      setLoading(false);
    })();
  }, []);

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <header className="border-b border-white/5 pb-6">
        <h1 className="text-3xl font-black tracking-tight flex items-center gap-3">
          <ShieldAlert className="h-8 w-8 text-red-500" />
          Admin Control Center
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Monitor and manage the AI-Powered Meeting Companion.
        </p>
      </header>

      {/* System Statistics */}
      <section className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6">
        <StatCard label="Total Users" value={stats.users} icon={Users} loading={loading} />
        <StatCard label="Active Users" value={stats.active} icon={Activity} loading={loading} />
        <StatCard label="Total Meetings" value={stats.meetings} icon={Video} loading={loading} />
        <StatCard label="Meetings Today" value={stats.today} icon={Video} loading={loading} />
        <StatCard label="AI Requests" value={stats.ai_requests} icon={Zap} loading={loading} />
        <div className="glass rounded-xl p-4 flex flex-col justify-between border-green-500/20 bg-green-500/5">
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
            System Health
          </div>
          <div className="text-xl font-black text-green-500 flex items-center gap-2">
            <CheckCircle2 className="h-5 w-5" /> 99.9%
          </div>
        </div>
      </section>

      <div className="grid gap-6 xl:grid-cols-3">
        {/* User Management */}
        <section className="xl:col-span-2 space-y-4">
          <div className="glass rounded-2xl p-6">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-lg font-bold">User Management</h2>
              <div className="flex bg-black/20 rounded-lg px-3 py-1.5 items-center gap-2 border border-white/5">
                <Search className="h-4 w-4 text-muted-foreground" />
                <input
                  placeholder="Search users..."
                  className="bg-transparent text-sm outline-none w-48"
                />
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead className="text-xs uppercase bg-white/5 text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3 rounded-tl-lg">User</th>
                    <th className="px-4 py-3">Role</th>
                    <th className="px-4 py-3">Registered</th>
                    <th className="px-4 py-3 text-right rounded-tr-lg">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => (
                    <tr
                      key={u.id}
                      className="border-b border-white/5 hover:bg-white/5 transition-colors"
                    >
                      <td className="px-4 py-3">
                        <div className="font-medium text-foreground">{u.name}</div>
                        <div className="text-xs text-muted-foreground">{u.email}</div>
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`px-2 py-1 rounded-md text-[10px] font-bold uppercase ${u.role === "admin" ? "bg-red-500/20 text-red-500" : "bg-white/10"}`}
                        >
                          {u.role}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">{u.registered_at}</td>
                      <td className="px-4 py-3 text-right">
                        <button className="text-blue-400 hover:text-blue-300 mr-3 text-xs">
                          Edit
                        </button>
                        <button className="text-red-400 hover:text-red-300 text-xs">Disable</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Meeting Management */}
          <div className="glass rounded-2xl p-6">
            <h2 className="text-lg font-bold mb-4">Recent Meetings</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead className="text-xs uppercase bg-white/5 text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3 rounded-tl-lg">Meeting</th>
                    <th className="px-4 py-3">Host</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3 rounded-tr-lg">AI Status</th>
                  </tr>
                </thead>
                <tbody>
                  {meetings.map((m) => (
                    <tr
                      key={m.id}
                      className="border-b border-white/5 hover:bg-white/5 transition-colors"
                    >
                      <td className="px-4 py-3 font-medium">{m.title}</td>
                      <td className="px-4 py-3 text-muted-foreground">{m.host}</td>
                      <td className="px-4 py-3">
                        <span className="capitalize text-xs text-muted-foreground">{m.status}</span>
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`text-xs flex items-center gap-1 ${m.ai_status === "processed" ? "text-green-500" : "text-amber-500"}`}
                        >
                          {m.ai_status === "processed" ? (
                            <CheckCircle2 className="h-3 w-3" />
                          ) : (
                            <Activity className="h-3 w-3" />
                          )}
                          <span className="capitalize">{m.ai_status}</span>
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        <section className="space-y-6">
          {/* AI Monitoring */}
          <div className="glass rounded-2xl p-6 border-blue-500/10">
            <h2 className="text-lg font-bold mb-4 flex items-center gap-2">
              <Zap className="h-5 w-5 text-blue-400" /> AI Processing Monitor
            </h2>
            <div className="space-y-4">
              <div className="flex justify-between items-center text-sm">
                <span className="text-muted-foreground">Transcription Requests</span>
                <span className="font-mono">842</span>
              </div>
              <div className="flex justify-between items-center text-sm">
                <span className="text-muted-foreground">Summary Generation</span>
                <span className="font-mono">412</span>
              </div>
              <div className="flex justify-between items-center text-sm">
                <span className="text-muted-foreground">Average Processing Time</span>
                <span className="font-mono text-green-400">1.2s</span>
              </div>
              <div className="w-full bg-white/5 rounded-full h-2 mt-2 overflow-hidden">
                <div className="bg-blue-500 h-2 rounded-full" style={{ width: "92%" }}></div>
              </div>
              <div className="text-[10px] text-right text-muted-foreground">92% Success Rate</div>
            </div>
          </div>

          {/* System Health */}
          <div className="glass rounded-2xl p-6">
            <h2 className="text-lg font-bold mb-4">System Health</h2>
            <div className="space-y-3">
              <HealthRow label="API Status" icon={Server} status="operational" />
              <HealthRow label="Database Status" icon={Database} status="operational" />
              <HealthRow label="AI Service Status" icon={Zap} status="warning" />
              <HealthRow label="Storage Status" icon={HardDrive} status="operational" />
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

function StatCard({ label, value, icon: Icon, loading }: any) {
  return (
    <div className="glass rounded-xl p-4 flex flex-col justify-between border-white/5 bg-black/20">
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className="mt-2 flex items-center justify-between">
        <div className="text-2xl font-black">{loading ? "—" : value}</div>
        <Icon className="h-5 w-5 text-muted-foreground/30" />
      </div>
    </div>
  );
}

function HealthRow({
  label,
  icon: Icon,
  status,
}: {
  label: string;
  icon: any;
  status: "operational" | "warning" | "error";
}) {
  return (
    <div className="flex items-center justify-between p-2 rounded-lg bg-white/5">
      <div className="flex items-center gap-3 text-sm">
        <Icon className="h-4 w-4 text-muted-foreground" />
        <span>{label}</span>
      </div>
      {status === "operational" && (
        <span className="flex items-center gap-1 text-[10px] uppercase text-green-500 font-bold">
          <CheckCircle2 className="h-3 w-3" /> Operational
        </span>
      )}
      {status === "warning" && (
        <span className="flex items-center gap-1 text-[10px] uppercase text-amber-500 font-bold">
          <AlertTriangle className="h-3 w-3" /> Warning
        </span>
      )}
      {status === "error" && (
        <span className="flex items-center gap-1 text-[10px] uppercase text-red-500 font-bold">
          <XCircle className="h-3 w-3" /> Error
        </span>
      )}
    </div>
  );
}
