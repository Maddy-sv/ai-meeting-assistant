import { createFileRoute } from "@tanstack/react-router";
import { Users, Search, ShieldAlert } from "lucide-react";

export const Route = createFileRoute("/_authenticated/admin/users")({
  head: () => ({ meta: [{ title: "User Management — Admin Control Center" }] }),
  component: AdminUsers,
});

function AdminUsers() {
  const dummyUsers = [
    { id: "1", name: "Sumeet M", email: "sumeetmadesm@gmail.com", role: "admin", meetings: 12, status: "Active", joined: "2026-08-20" },
    { id: "2", name: "Sarah Connor", email: "sarah@example.com", role: "user", meetings: 4, status: "Active", joined: "2026-08-19" },
    { id: "3", name: "John Doe", email: "john@example.com", role: "user", meetings: 1, status: "Inactive", joined: "2026-08-15" },
    { id: "4", name: "Emily Chen", email: "emily@example.com", role: "user", meetings: 24, status: "Active", joined: "2026-07-22" },
    { id: "5", name: "Michael Scott", email: "michael@example.com", role: "user", meetings: 89, status: "Active", joined: "2026-06-11" },
  ];

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <header className="border-b border-white/5 pb-6">
        <h1 className="text-3xl font-black tracking-tight flex items-center gap-3">
          <Users className="h-8 w-8 text-red-500" />
          User Management
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">Manage accounts, roles, and platform access.</p>
      </header>

      <div className="glass rounded-2xl p-6 border-red-500/10">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-lg font-bold">Platform Users</h2>
          <div className="flex bg-black/20 rounded-lg px-3 py-1.5 items-center gap-2 border border-white/5">
            <Search className="h-4 w-4 text-muted-foreground" />
            <input placeholder="Search users by name or email..." className="bg-transparent text-sm outline-none w-64" />
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="text-xs uppercase bg-white/5 text-muted-foreground">
              <tr>
                <th className="px-4 py-3 rounded-tl-lg">User</th>
                <th className="px-4 py-3">Role</th>
                <th className="px-4 py-3">Meetings Hosted</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Registered</th>
                <th className="px-4 py-3 text-right rounded-tr-lg">Actions</th>
              </tr>
            </thead>
            <tbody>
              {dummyUsers.map(u => (
                <tr key={u.id} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                  <td className="px-4 py-3 flex items-center gap-3">
                    <div className="h-8 w-8 rounded-full bg-white/10 grid place-items-center text-xs font-bold">{u.name.charAt(0)}</div>
                    <div>
                      <div className="font-medium text-foreground">{u.name}</div>
                      <div className="text-xs text-muted-foreground">{u.email}</div>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-1 rounded-md text-[10px] font-bold uppercase ${u.role === 'admin' ? 'bg-red-500/20 text-red-500 flex items-center w-fit gap-1' : 'bg-white/10 w-fit'}`}>
                      {u.role === 'admin' && <ShieldAlert className="h-3 w-3" />} {u.role}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-mono">{u.meetings}</td>
                  <td className="px-4 py-3">
                    <span className={`flex items-center gap-2 ${u.status === 'Active' ? 'text-green-400' : 'text-muted-foreground'}`}>
                      <div className={`h-2 w-2 rounded-full ${u.status === 'Active' ? 'bg-green-400' : 'bg-muted-foreground'}`} />
                      {u.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{u.joined}</td>
                  <td className="px-4 py-3 text-right">
                    <button className="text-blue-400 hover:text-blue-300 mr-3 text-xs">Edit</button>
                    <button className="text-red-400 hover:text-red-300 text-xs">Disable</button>
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
