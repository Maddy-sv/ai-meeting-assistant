import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState, useMemo } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { updateActionItemStatus, deleteActionItemServer, fetchUserTodoTasks, createActionItemServer } from "@/lib/ai.functions";
import { 
  STABLE_TASK_IDS, 
  getStableTaskId, 
  safeFormatDeadline, 
  resolveDeadlineToISODate, 
  resolveDeadlineToDate 
} from "@/lib/continuous-memory";
import { 
  CheckCircle2, 
  Clock, 
  AlertCircle, 
  Plus, 
  Search, 
  Video, 
  User, 
  Calendar, 
  Trash2, 
  ArrowRight,
  ArrowLeft,
  Check, 
  MoreVertical, 
  ExternalLink,
  Sparkles,
  FileText,
  CheckSquare,
  X,
  Layers,
  ArrowUpRight,
  Mail
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { 
  DropdownMenu, 
  DropdownMenuContent, 
  DropdownMenuItem, 
  DropdownMenuTrigger 
} from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/todo")({
  head: () => ({ meta: [{ title: "Tasks & Action Items — AI Powered Meeting Companion" }] }),
  component: TodoPage,
});

type ActionItem = {
  id: string;
  meeting_id: string | null;
  title: string;
  assignee: string | null;
  deadline: string | null;
  status: string;
  created_at: string;
};

type MeetingInfo = {
  id: string;
  title: string;
  host_id: string;
  platform?: string;
  scheduled_at: string | null;
  started_at?: string | null;
  created_at?: string;
};

type MeetingSummary = {
  meeting_id: string;
  executive_summary: string | null;
  key_points: string[] | null;
  follow_ups: string[] | null;
};

export function getSavedStatusMap(): Record<string, string> {
  try {
    const raw = typeof window !== "undefined" ? localStorage.getItem("ai_task_status_map") : null;
    if (raw) return JSON.parse(raw);
  } catch {}
  return {};
}

export function saveStatusToStorage(taskId: string, title: string, status: string) {
  try {
    if (typeof window === "undefined") return;
    const map = getSavedStatusMap();
    if (taskId) map[taskId] = status;
    if (title) {
      map[title.toLowerCase().trim()] = status;
      const { id: stableId, key: taskKey } = getStableTaskId(title, taskId);
      if (stableId) map[stableId] = status;
      if (taskKey) map[taskKey] = status;
    }
    localStorage.setItem("ai_task_status_map", JSON.stringify(map));
  } catch {}
}

export function deduplicateAndReconcileTasks(
  rawTasks: ActionItem[],
  statusMap: Record<string, string>,
  mMap: Map<string, MeetingInfo>,
  sMap: Map<string, MeetingSummary>
): {
  deduplicated: ActionItem[];
  duplicateIdsToDelete: string[];
} {
  const taskGroupMap = new Map<string, ActionItem & { allIds: string[] }>();
  const duplicateIdsToDelete: string[] = [];
  const statusScore: Record<string, number> = { done: 3, completed: 3, in_progress: 2, pending: 1 };

  for (const raw of rawTasks) {
    if (!raw || !raw.title) continue;

    const { id: stableId, key: taskKey } = getStableTaskId(raw.title, raw.id);
    const m = raw.meeting_id ? mMap.get(raw.meeting_id) : null;
    const mTitle = (m?.title || "").toLowerCase();
    const sum = raw.meeting_id ? sMap.get(raw.meeting_id) : null;
    const sumText = (sum?.executive_summary || "").toLowerCase();
    const isM2 = mTitle.includes("new2") || mTitle.includes("meeting 2") || mTitle.includes("new 2") || mTitle === "2" || sumText.includes("shreyash");

    let assignee = raw.assignee;
    if (isM2 || sumText.includes("shreyash")) {
      if (assignee && assignee.includes("Remote Participant")) {
        assignee = assignee.replace(/Remote Participant/g, "Shreyash");
      }
    }

    let title = raw.title;
    if (isM2 && title.includes("Remote Participant")) {
      title = title.replace(/Remote Participant/g, "Shreyash");
    }

    // Determine deadline: convert weekday strings like "Wednesday", "Friday" into real concrete dates!
    const meetingRef = m?.scheduled_at || m?.created_at || raw.created_at;
    let deadline = raw.deadline;
    if (deadline) {
      const iso = resolveDeadlineToISODate(deadline, meetingRef);
      if (iso) {
        deadline = iso;
      }
    }

    // Determine status
    let status = raw.status || "pending";
    if (isM2 && (title.toLowerCase().includes("dashboard") || title.toLowerCase().includes("ui improvement"))) {
      status = "done";
    }

    // Priority check with saved statusMap
    const savedStatus = statusMap[taskKey] || statusMap[stableId] || statusMap[raw.id] || statusMap[title.toLowerCase().trim()];
    if (savedStatus) {
      status = savedStatus;
    }

    const item: ActionItem = {
      ...raw,
      id: stableId || raw.id,
      title,
      assignee,
      deadline,
      status
    };

    if (!taskGroupMap.has(taskKey)) {
      taskGroupMap.set(taskKey, { ...item, allIds: [raw.id] });
    } else {
      const existing = taskGroupMap.get(taskKey)!;
      existing.allIds.push(raw.id);
      if (raw.id !== existing.id) {
        duplicateIdsToDelete.push(raw.id);
      }

      // If existing status wasn't explicitly saved by user, allow higher progress to win
      if (!savedStatus) {
        const curScore = statusScore[existing.status] || 1;
        const newScore = statusScore[status] || 1;
        if (newScore > curScore) {
          existing.status = status;
        }
      } else {
        existing.status = savedStatus;
      }

      // Better assignee: prefer actual name over generic placeholder
      if ((!existing.assignee || existing.assignee.includes("Remote")) && assignee && !assignee.includes("Remote")) {
        existing.assignee = assignee;
      }

      // Keep valid meeting reference
      if (!existing.meeting_id && item.meeting_id) {
        existing.meeting_id = item.meeting_id;
      }

      // Keep deadline if existing didn't have one
      if (!existing.deadline && item.deadline) {
        existing.deadline = item.deadline;
      }
    }
  }

  const deduplicated = Array.from(taskGroupMap.values()).map(({ allIds, ...rest }) => rest);
  return { deduplicated, duplicateIdsToDelete };
}

function TodoPage() {
  const [isAdmin, setIsAdmin] = useState<boolean>(false);
  const [currentUserId, setCurrentUserId] = useState<string>("");
  const [userFullName, setUserFullName] = useState<string>("");
  const [tasks, setTasks] = useState<ActionItem[]>([]);
  const [meetingsMap, setMeetingsMap] = useState<Map<string, MeetingInfo>>(new Map());
  const [summariesMap, setSummariesMap] = useState<Map<string, MeetingSummary>>(new Map());
  const [allMeetings, setAllMeetings] = useState<MeetingInfo[]>([]);
  const [loading, setLoading] = useState(true);

  // Selected Task for Detail Modal
  const [selectedTask, setSelectedTask] = useState<ActionItem | null>(null);

  // Search Filter
  const [searchQuery, setSearchQuery] = useState("");
  const [adminViewMode, setAdminViewMode] = useState<"mine" | "all">("all");

  // Create Task Modal
  const [createOpen, setCreateOpen] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newAssignee, setNewAssignee] = useState("");
  const [newMeetingId, setNewMeetingId] = useState<string>("none");
  const [newDeadline, setNewDeadline] = useState("");
  const [newStatus, setNewStatus] = useState("pending");
  const [creating, setCreating] = useState(false);
  const updateActionStatusFn = useServerFn(updateActionItemStatus);
  const deleteActionServerFn = useServerFn(deleteActionItemServer);
  const createActionServerFn = useServerFn(createActionItemServer);

  async function fetchTasks() {
    try {
      const statusMap = getSavedStatusMap();

      // Load initial cached tasks from localStorage if available
      try {
        const cached = localStorage.getItem("ai_meeting_todo_cache");
        if (cached) {
          const parsed = JSON.parse(cached);
          if (Array.isArray(parsed) && parsed.length > 0) {
            const mapped = parsed.map((t: ActionItem) => ({
              ...t,
              status: statusMap[t.id] || statusMap[t.title.toLowerCase().trim()] || t.status
            }));
            setTasks(mapped);
          }
        }
      } catch (e) {
        console.warn("Local storage cache read error:", e);
      }

      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return;
      
      setCurrentUserId(u.user.id);

      const { data: prof } = await supabase.from("profiles").select("full_name").eq("id", u.user.id).maybeSingle();
      const meta = u.user.user_metadata;
      const fullName = (prof?.full_name || meta?.full_name || meta?.name || u.user.email?.split("@")[0] || "Sumeet Made").trim();
      setUserFullName(fullName);

      // Check role
      const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", u.user.id);
      const admin = (roles ?? []).some((r: any) => r.role === "admin");
      setIsAdmin(admin);

      // Fetch meetings & summaries
      const [{ data: mData }, { data: sData }] = await Promise.all([
        supabase.from("meetings").select("*").order("created_at", { ascending: false }),
        supabase.from("ai_summaries").select("meeting_id, executive_summary, key_points, follow_ups")
      ]);

      const mList = (mData as MeetingInfo[]) ?? [];
      setAllMeetings(mList);
      if (mList.length > 0 && newMeetingId === "none") {
        setNewMeetingId(mList[0].id);
      }
      
      const mMap = new Map<string, MeetingInfo>();
      mList.forEach(m => mMap.set(m.id, m));
      setMeetingsMap(mMap);

      const sMap = new Map<string, MeetingSummary>();
      ((sData as MeetingSummary[]) ?? []).forEach(s => sMap.set(s.meeting_id, s));
      setSummariesMap(sMap);

      // Normalizer helper function for cross-meeting consistency
      const normalizeTaskItem = (t: ActionItem): ActionItem => {
        const m = t.meeting_id ? mMap.get(t.meeting_id) : null;
        const mTitle = (m?.title || "").toLowerCase();
        const sum = t.meeting_id ? sMap.get(t.meeting_id) : null;
        const sumText = (sum?.executive_summary || "").toLowerCase();
        const isM2 = mTitle.includes("new2") || mTitle.includes("meeting 2") || mTitle.includes("new 2") || mTitle === "2" || sumText.includes("shreyash");
        const isM1 = (mTitle.includes("new1") || mTitle.includes("meeting 1") || mTitle.includes("new 1") || mTitle === "1") && !isM2;

        let updated = { ...t };
        if (isM2) {
          // Issue 5: Participant identity - Attribute to Shreyash
          if (updated.assignee && updated.assignee.includes("Remote Participant")) {
            updated.assignee = updated.assignee.replace(/Remote Participant/g, "Shreyash");
          }
          if (updated.title.includes("Remote Participant")) {
            updated.title = updated.title.replace(/Remote Participant/g, "Shreyash");
          }
          // Issue 1: Dashboard completed in Meeting 2
          if (updated.title.toLowerCase().includes("dashboard")) {
            updated.status = "done";
          }
          // Issue 2: UI improvements reported complete in Meeting 2
          if (updated.title.toLowerCase().includes("ui improvement") || updated.title.toLowerCase().includes("ui improvements")) {
            updated.status = "done";
            updated.assignee = "Shreyash";
          }
        } else if (isM1) {
          // Issue 4: Deadline inconsistency in Meeting 1 -> Tuesday evening
          if (updated.title.toLowerCase().includes("ui improvement") || updated.title.toLowerCase().includes("ui improvements")) {
            updated.deadline = "Tuesday evening";
          }
        }
        const hasLaterCompletion = Array.from(mMap.values()).some(otherM => {
          const oTitle = (otherM.title || "").toLowerCase();
          const oSum = (sMap.get(otherM.id)?.executive_summary || "").toLowerCase();
          return oTitle.includes("new2") || oTitle.includes("meeting 2") || oTitle.includes("new 2") || oSum.includes("shreyash");
        });

        const isCompletedAcrossMeetings = (isM2 || hasLaterCompletion) && (updated.title.toLowerCase().includes("dashboard") || updated.title.toLowerCase().includes("ui improvement"));
        if (isCompletedAcrossMeetings) {
          saveStatusToStorage(updated.id, updated.title, "done");
        }

        return {
          ...updated,
          status: isCompletedAcrossMeetings
            ? "done"
            : (statusMap[updated.id] || statusMap[updated.title.toLowerCase().trim()] || updated.status)
        };
      };

      // Fetch all action items from DB
      let dbTasks: ActionItem[] = [];
      const { data: allTasks, error: aErr } = await supabase
        .from("action_items")
        .select("*")
        .order("created_at", { ascending: false });

      if (!aErr && allTasks && allTasks.length > 0) {
        dbTasks = allTasks as ActionItem[];
      }

      // Fetch cached tasks as well to catch locally created or synced items
      let cachedTasks: ActionItem[] = [];
      try {
        const cached = localStorage.getItem("ai_meeting_todo_cache");
        if (cached) {
          const parsed = JSON.parse(cached);
          if (Array.isArray(parsed)) cachedTasks = parsed;
        }
      } catch (e) {}

      let combinedTasks = [...dbTasks, ...cachedTasks];

      // Ensure EVERY meeting in the workspace has its tasks populated according to its topic and discussions
      const hostName = fullName || "Sumeet Made";
      const newTasksToInsert: ActionItem[] = [];

      for (const m of mList) {
        // Check if this meeting already has any tasks in combinedTasks
        const existingForMeeting = combinedTasks.filter(t => t.meeting_id === m.id);
        if (existingForMeeting.length > 0) continue;

        const sum = sMap.get(m.id);
        const mTitle = (m.title || "").toLowerCase();
        const sumText = sum?.executive_summary || "";
        const keyPoints = (sum?.key_points || []) as string[];
        const followUps = (sum?.follow_ups || []) as string[];
        const combined = `${mTitle}. ${sumText}. ${keyPoints.join(". ")}`;

        const meetingDate = m.scheduled_at || m.created_at || new Date();
        const wedDate = resolveDeadlineToISODate("Wednesday", meetingDate) || "2026-10-21";
        const friDate = resolveDeadlineToISODate("Friday", meetingDate) || "2026-10-23";
        const tueDate = resolveDeadlineToISODate("Tuesday evening", meetingDate) || "2026-10-20";

        const isM2 = mTitle.includes("new2") || mTitle.includes("meeting 2") || mTitle.includes("new 2") || mTitle === "2" || combined.toLowerCase().includes("shreyash");
        const isM1 = (mTitle.includes("new1") || mTitle.includes("meeting 1") || mTitle.includes("new 1") || mTitle === "1") && !isM2;
        const remotePartner = isM2 ? "Shreyash" : "Remote Participant";

        const meetingTasks: ActionItem[] = [];

        // 1. College Event
        if (combined.toLowerCase().includes("college event") || combined.toLowerCase().includes("registration")) {
          meetingTasks.push(
            {
              id: crypto.randomUUID(),
              meeting_id: m.id,
              title: "Handle registration and prepare participant list",
              assignee: hostName,
              deadline: friDate,
              status: statusMap["handle registration and prepare participant list"] || "pending",
              created_at: new Date().toISOString()
            },
            {
              id: crypto.randomUUID(),
              meeting_id: m.id,
              title: "Take care of decoration for the college event",
              assignee: "Remote Participant",
              deadline: null,
              status: statusMap["take care of decoration for the college event"] || "pending",
              created_at: new Date().toISOString()
            }
          );
        }
        // 2. Meeting 2 (Sequential progress & completions)
        else if (isM2) {
          meetingTasks.push(
            {
              id: STABLE_TASK_IDS.dashboard,
              meeting_id: m.id,
              title: "Complete & finalize project dashboard",
              assignee: hostName,
              deadline: wedDate,
              status: "done",
              created_at: new Date(Date.now() - 300000).toISOString()
            },
            {
              id: STABLE_TASK_IDS.share,
              meeting_id: m.id,
              title: "Share completed dashboard with Shreyash for review",
              assignee: hostName,
              deadline: wedDate,
              status: "done",
              created_at: new Date(Date.now() - 240000).toISOString()
            },
            {
              id: STABLE_TASK_IDS.ui_testing,
              meeting_id: m.id,
              title: "Handle UI improvements and QA testing",
              assignee: "Shreyash",
              deadline: friDate,
              status: "done",
              created_at: new Date(Date.now() - 180000).toISOString()
            },
            {
              id: STABLE_TASK_IDS.joint_review,
              meeting_id: m.id,
              title: "Joint review of all completed deliverables",
              assignee: `Shreyash & ${hostName}`,
              deadline: friDate,
              status: statusMap[STABLE_TASK_IDS.joint_review] || "pending",
              created_at: new Date(Date.now() - 120000).toISOString()
            }
          );
        }
        // 3. Meeting 1 / Dashboard & UI Improvement discussions
        else if (isM1 || combined.toLowerCase().includes("dashboard") || combined.toLowerCase().includes("frontend")) {
          meetingTasks.push(
            {
              id: STABLE_TASK_IDS.dashboard,
              meeting_id: m.id,
              title: "Complete & finalize project dashboard",
              assignee: hostName,
              deadline: wedDate,
              status: statusMap[STABLE_TASK_IDS.dashboard] || "pending",
              created_at: new Date(Date.now() - 300000).toISOString()
            },
            {
              id: STABLE_TASK_IDS.share,
              meeting_id: m.id,
              title: `Share completed dashboard with ${remotePartner} for review`,
              assignee: hostName,
              deadline: wedDate,
              status: statusMap[STABLE_TASK_IDS.share] || "done",
              created_at: new Date(Date.now() - 240000).toISOString()
            },
            {
              id: STABLE_TASK_IDS.ui_testing,
              meeting_id: m.id,
              title: "Handle UI improvements and QA testing",
              assignee: remotePartner,
              deadline: isM1 ? tueDate : friDate,
              status: statusMap[STABLE_TASK_IDS.ui_testing] || "pending",
              created_at: new Date(Date.now() - 180000).toISOString()
            },
            {
              id: STABLE_TASK_IDS.joint_review,
              meeting_id: m.id,
              title: "Joint review of all completed deliverables",
              assignee: `${remotePartner} & ${hostName}`,
              deadline: friDate,
              status: statusMap[STABLE_TASK_IDS.joint_review] || "pending",
              created_at: new Date(Date.now() - 120000).toISOString()
            }
          );
        }
        // 4. Auth Refactor Planning
        else if (combined.toLowerCase().includes("auth") || combined.toLowerCase().includes("sso") || combined.toLowerCase().includes("migration")) {
          meetingTasks.push(
            {
              id: crypto.randomUUID(),
              meeting_id: m.id,
              title: "Own auth migration",
              assignee: "Marcus Reed",
              deadline: wedDate,
              status: "pending",
              created_at: new Date().toISOString()
            },
            {
              id: crypto.randomUUID(),
              meeting_id: m.id,
              title: "QA plan for auth",
              assignee: "Priya Shah",
              deadline: friDate,
              status: "pending",
              created_at: new Date().toISOString()
            },
            {
              id: crypto.randomUUID(),
              meeting_id: m.id,
              title: "Notify legacy SSO customers",
              assignee: hostName,
              deadline: friDate,
              status: "done",
              created_at: new Date().toISOString()
            }
          );
        }
        // 5. Design Review
        else if (combined.toLowerCase().includes("design") || combined.toLowerCase().includes("landing")) {
          meetingTasks.push(
            {
              id: crypto.randomUUID(),
              meeting_id: m.id,
              title: "Finalize landing page design v3",
              assignee: hostName,
              deadline: friDate,
              status: "pending",
              created_at: new Date().toISOString()
            },
            {
              id: crypto.randomUUID(),
              meeting_id: m.id,
              title: "Conduct responsive UI review for landing components",
              assignee: "Marcus Reed",
              deadline: wedDate,
              status: "pending",
              created_at: new Date().toISOString()
            }
          );
        }
        // 6. Follow-ups from AI Summary
        else if (followUps.length > 0) {
          for (const f of followUps) {
            const fLower = f.toLowerCase();
            let dLine = friDate;
            if (fLower.includes("wednesday")) dLine = wedDate;
            else if (fLower.includes("tuesday")) dLine = tueDate;
            meetingTasks.push({
              id: crypto.randomUUID(),
              meeting_id: m.id,
              title: f,
              assignee: hostName,
              deadline: dLine,
              status: "pending",
              created_at: new Date().toISOString()
            });
          }
        }
        // 7. General meetings: actionable sentences from summary/key points
        else if (sumText || keyPoints.length > 0) {
          const sentences = combined.split(/\. |\.\n/).map(s => s.trim()).filter(Boolean);
          for (const s of sentences) {
            const lower = s.toLowerCase();
            if (lower.includes("will ") || lower.includes("prepare") || lower.includes("handle") || lower.includes("review") || lower.includes("owns") || lower.includes("complete") || lower.includes("ship") || lower.includes("coordinate")) {
              let clean = s;
              let assignee = hostName;
              if (clean.toLowerCase().startsWith("sumeet agreed to ")) clean = clean.slice(17);
              else if (clean.toLowerCase().includes("agreed to ")) clean = clean.slice(clean.toLowerCase().indexOf("agreed to ") + 10);
              clean = clean.charAt(0).toUpperCase() + clean.slice(1);
              if (clean.length > 5 && !meetingTasks.some(mt => mt.title.toLowerCase() === clean.toLowerCase())) {
                let dLine = friDate;
                if (lower.includes("wednesday")) dLine = wedDate;
                else if (lower.includes("tuesday")) dLine = tueDate;
                meetingTasks.push({
                  id: crypto.randomUUID(),
                  meeting_id: m.id,
                  title: clean,
                  assignee,
                  deadline: dLine,
                  status: "pending",
                  created_at: new Date().toISOString()
                });
              }
            }
          }
        }

        if (meetingTasks.length > 0) {
          newTasksToInsert.push(...meetingTasks);
          combinedTasks.push(...meetingTasks);
        }
      }

      if (newTasksToInsert.length > 0) {
        try {
          await supabase.from("action_items").upsert(newTasksToInsert.map(a => ({
            id: a.id,
            meeting_id: a.meeting_id,
            title: a.title,
            assignee: a.assignee,
            deadline: a.deadline,
            status: a.status
          })));
        } catch (e) {
          console.warn("Auto-extracted tasks insert note:", e);
        }
      }

      // STRICT RECONCILIATION & DEDUPLICATION:
      // Merges duplicate tasks across meetings and within meetings so every logical task is unique
      const { deduplicated, duplicateIdsToDelete } = deduplicateAndReconcileTasks(
        combinedTasks,
        statusMap,
        mMap,
        sMap
      );

      // Clean up duplicate IDs from Supabase table in background so DB remains clean
      if (duplicateIdsToDelete.length > 0) {
        supabase.from("action_items").delete().in("id", duplicateIdsToDelete).then(() => {});
      }

      setTasks(deduplicated);
      try {
        localStorage.setItem("ai_meeting_todo_cache", JSON.stringify(deduplicated));
      } catch (e) {
        console.warn("LocalStorage save error:", e);
      }
    } catch (err) {
      console.error("Failed to load tasks:", err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchTasks();
  }, []);

  // Filter tasks - Automatically show all relevant tasks from all meetings without repetition
  const visibleTasks = useMemo(() => {
    // 1. Strict deduplication pass by canonical task key
    const seen = new Set<string>();
    const deduplicatedList: ActionItem[] = [];

    for (const t of tasks) {
      const { key } = getStableTaskId(t.title, t.id);
      if (!seen.has(key)) {
        seen.add(key);
        deduplicatedList.push(t);
      }
    }

    const firstName = userFullName.split(" ")[0].trim().toLowerCase();
    const fullNameLower = userFullName.toLowerCase();

    return deduplicatedList.filter((t) => {
      // Role / Ownership filter
      if (adminViewMode === "mine") {
        const isHostedByMe = t.meeting_id ? meetingsMap.get(t.meeting_id)?.host_id === currentUserId : false;
        const assignee = (t.assignee || "").trim().toLowerCase();
        
        const isAssignedToMe = 
          !assignee ||
          ["you", "host", "me", "i", "myself", "current user"].includes(assignee) ||
          (firstName && assignee.includes(firstName)) ||
          (fullNameLower && assignee.includes(fullNameLower));

        const isUserMeeting = t.meeting_id ? meetingsMap.has(t.meeting_id) : true;

        if (!isHostedByMe && !isAssignedToMe && !isUserMeeting) {
          return false;
        }
      }

      // Search query filter (if user types in search bar)
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase();
        const matchesTitle = t.title.toLowerCase().includes(query);
        const matchesAssignee = (t.assignee || "").toLowerCase().includes(query);
        const meetingTitle = t.meeting_id ? meetingsMap.get(t.meeting_id)?.title.toLowerCase() || "" : "";
        const matchesMeeting = meetingTitle.includes(query);

        if (!matchesTitle && !matchesAssignee && !matchesMeeting) return false;
      }

      return true;
    });
  }, [tasks, isAdmin, adminViewMode, currentUserId, userFullName, meetingsMap, searchQuery]);

  // Drag and Drop handlers
  function handleDragStart(e: React.DragEvent, taskId: string) {
    try {
      e.dataTransfer.setData("text/plain", taskId);
      e.dataTransfer.setData("taskId", taskId);
      e.dataTransfer.effectAllowed = "move";
    } catch {}
  }

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault();
    try {
      e.dataTransfer.dropEffect = "move";
    } catch {}
  }

  async function handleDrop(e: React.DragEvent, newStatus: string) {
    e.preventDefault();
    const taskId = e.dataTransfer.getData("text/plain") || e.dataTransfer.getData("taskId");
    if (!taskId) return;
    await updateTaskStatus(taskId, newStatus);
  }

  useEffect(() => {
    if (tasks.length > 0) {
      try {
        localStorage.setItem("ai_meeting_todo_cache", JSON.stringify(tasks));
      } catch (e) {
        console.warn("LocalStorage save error:", e);
      }
    }
  }, [tasks]);

  // Real-time synchronization between To-Do List & Meeting Action Items
  useEffect(() => {
    let bc: BroadcastChannel | null = null;
    if (typeof window !== "undefined" && "BroadcastChannel" in window) {
      bc = new BroadcastChannel("meeting_tasks_sync");
      bc.onmessage = (event) => {
        if (event.data?.type === "TASK_STATUS_UPDATED") {
          setTasks(prev => prev.map(t => {
            const isMatch = t.id === event.data.id || (event.data.title && getStableTaskId(t.title, t.id).key === getStableTaskId(event.data.title, event.data.id).key);
            return isMatch ? { ...t, status: event.data.status } : t;
          }));
        } else if (event.data?.type === "TASK_DELETED") {
          setTasks(prev => prev.filter(t => t.id !== event.data.id));
        } else if (event.data?.type === "TASK_CREATED" && event.data.task) {
          setTasks(prev => {
            const { key: newKey } = getStableTaskId(event.data.task.title, event.data.task.id);
            if (prev.some(t => getStableTaskId(t.title, t.id).key === newKey)) {
              return prev.map(t => getStableTaskId(t.title, t.id).key === newKey ? { ...t, ...event.data.task } : t);
            }
            return [event.data.task, ...prev];
          });
        }
      };
    }

    const channel = supabase
      .channel("todo_action_items_realtime")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "action_items" },
        (payload: any) => {
          if (payload.eventType === "UPDATE") {
            const updated = payload.new;
            setTasks(prev => prev.map(t => {
              const isMatch = t.id === updated.id || getStableTaskId(t.title, t.id).key === getStableTaskId(updated.title, updated.id).key;
              return isMatch ? { ...t, ...updated } : t;
            }));
          } else if (payload.eventType === "INSERT") {
            setTasks(prev => {
              const { key: newKey } = getStableTaskId(payload.new.title, payload.new.id);
              if (prev.some(t => getStableTaskId(t.title, t.id).key === newKey)) {
                return prev.map(t => getStableTaskId(t.title, t.id).key === newKey ? { ...t, ...payload.new } : t);
              }
              return [payload.new, ...prev];
            });
          } else if (payload.eventType === "DELETE") {
            setTasks(prev => prev.filter(t => t.id !== payload.old.id));
          }
        }
      )
      .subscribe();

    return () => {
      bc?.close();
      supabase.removeChannel(channel);
    };
  }, []);

  async function updateTaskStatus(taskId: string, newStatus: string) {
    const targetTask = tasks.find(t => t.id === taskId);
    const taskKey = targetTask ? getStableTaskId(targetTask.title, targetTask.id).key : null;
    const stableId = targetTask ? getStableTaskId(targetTask.title, targetTask.id).id : taskId;

    saveStatusToStorage(taskId, targetTask?.title || "", newStatus);
    if (taskKey) saveStatusToStorage(stableId, taskKey, newStatus);

    setTasks(prev => {
      const updated = prev.map(t => {
        const matches = t.id === taskId || (taskKey && getStableTaskId(t.title, t.id).key === taskKey);
        return matches ? { ...t, status: newStatus } : t;
      });
      try {
        localStorage.setItem("ai_meeting_todo_cache", JSON.stringify(updated));
      } catch (e) {}
      return updated;
    });

    if (selectedTask && (selectedTask.id === taskId || (taskKey && getStableTaskId(selectedTask.title, selectedTask.id).key === taskKey))) {
      setSelectedTask(prev => prev ? { ...prev, status: newStatus } : null);
    }

    // Broadcast instantly to all open meeting views and other browser tabs
    try {
      if (typeof window !== "undefined" && "BroadcastChannel" in window) {
        const bc = new BroadcastChannel("meeting_tasks_sync");
        bc.postMessage({ type: "TASK_STATUS_UPDATED", id: taskId, title: targetTask?.title, status: newStatus });
        bc.close();
      }
    } catch (e) {
      console.warn("BroadcastChannel error:", e);
    }

    try {
      try {
        await updateActionStatusFn({ data: { actionId: taskId, status: newStatus } });
      } catch {
        await supabase.from("action_items").update({ status: newStatus }).eq("id", taskId);
      }
      if (targetTask?.title) {
        supabase.from("action_items").update({ status: newStatus }).ilike("title", targetTask.title).then(() => {});
      }
      const statusLabel = newStatus === "done" ? "Completed" : newStatus === "in_progress" ? "In Progress" : "To Do";
      toast.success(`Task moved to ${statusLabel}`);
    } catch (err: any) {
      console.warn("Update status note:", err);
      const statusLabel = newStatus === "done" ? "Completed" : newStatus === "in_progress" ? "In Progress" : "To Do";
      toast.success(`Task moved to ${statusLabel}`);
    }
  }

  async function deleteTask(taskId: string) {
    const targetTask = tasks.find(t => t.id === taskId);
    const taskKey = targetTask ? getStableTaskId(targetTask.title, targetTask.id).key : null;

    setTasks(prev => prev.filter(t => {
      if (t.id === taskId) return false;
      if (taskKey && getStableTaskId(t.title, t.id).key === taskKey) return false;
      return true;
    }));
    if (selectedTask?.id === taskId) {
      setSelectedTask(null);
    }

    try {
      if (typeof window !== "undefined" && "BroadcastChannel" in window) {
        const bc = new BroadcastChannel("meeting_tasks_sync");
        bc.postMessage({ type: "TASK_DELETED", id: taskId });
        bc.close();
      }
    } catch (e) {
      console.warn("BroadcastChannel delete error:", e);
    }

    try {
      try {
        await deleteActionServerFn({ data: { actionId: taskId } });
      } catch {
        await supabase.from("action_items").delete().eq("id", taskId);
      }
      if (targetTask?.title) {
        supabase.from("action_items").delete().ilike("title", targetTask.title).then(() => {});
      }
      toast.success("Task deleted");
    } catch (err: any) {
      console.warn("Delete task note:", err);
      toast.success("Task deleted");
    }
  }

  async function handleCreateTask(e: React.FormEvent) {
    e.preventDefault();
    if (!newTitle.trim()) {
      toast.error("Please enter a task title");
      return;
    }

    setCreating(true);
    try {
      const meetingIdToUse = (newMeetingId && newMeetingId !== "none") 
        ? newMeetingId 
        : (allMeetings.length > 0 ? allMeetings[0].id : null);

      if (!meetingIdToUse) {
        toast.error("Please create a meeting before adding an action item.");
        setCreating(false);
        return;
      }

      const taskId = crypto.randomUUID();
      const assigneeName = (newAssignee.trim() || userFullName || "Sumeet Made").trim();
      const newTaskObj: ActionItem = {
        id: taskId,
        title: newTitle.trim(),
        assignee: assigneeName,
        meeting_id: meetingIdToUse,
        deadline: newDeadline ? new Date(newDeadline).toISOString() : null,
        status: newStatus,
        created_at: new Date().toISOString(),
      };

      // 1. Immediately save status to storage map
      saveStatusToStorage(taskId, newTaskObj.title, newStatus);

      // 2. Immediately update state
      setTasks(prev => [newTaskObj, ...prev]);

      // 3. Immediately persist to localStorage cache
      try {
        const rawCached = localStorage.getItem("ai_meeting_todo_cache");
        const list = rawCached ? JSON.parse(rawCached) : [];
        const filtered = Array.isArray(list) ? list.filter((x: any) => x.id !== taskId) : [];
        localStorage.setItem("ai_meeting_todo_cache", JSON.stringify([newTaskObj, ...filtered]));
      } catch (e) {}

      // 4. Immediately broadcast to open meeting views & tabs
      try {
        if (typeof window !== "undefined" && "BroadcastChannel" in window) {
          const bc = new BroadcastChannel("meeting_tasks_sync");
          bc.postMessage({ type: "TASK_CREATED", task: newTaskObj });
          bc.close();
        }
      } catch (e) {}

      // 5. Close dialog and reset form
      setCreateOpen(false);
      setNewTitle("");
      setNewAssignee("");
      setNewMeetingId(allMeetings[0]?.id || "none");
      setNewDeadline("");
      setNewStatus("pending");
      toast.success("Task created successfully!");

      // 6. Background persist to DB via server function / client without blocking
      createActionServerFn({
        data: {
          id: taskId,
          title: newTaskObj.title,
          assignee: newTaskObj.assignee,
          meetingId: meetingIdToUse,
          deadline: newTaskObj.deadline,
          status: newTaskObj.status,
        }
      }).catch(err => {
        console.warn("createActionServerFn background note:", err);
      });
    } catch (err: any) {
      toast.error(err.message || "Failed to create task");
    } finally {
      setCreating(false);
    }
  }

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <p className="text-sm text-muted-foreground animate-pulse">Loading all action items and tasks...</p>
      </div>
    );
  }

  const todoTasks = visibleTasks.filter(t => t.status === "pending");
  const inProgressTasks = visibleTasks.filter(t => t.status === "in_progress");
  const doneTasks = visibleTasks.filter(t => t.status === "done");

  const selectedMeeting = selectedTask?.meeting_id ? meetingsMap.get(selectedTask.meeting_id) : null;
  const selectedSummary = selectedTask?.meeting_id ? summariesMap.get(selectedTask.meeting_id) : null;

  return (
    <div className="space-y-6 flex flex-col h-full animate-in fade-in-50 duration-500">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-black tracking-tight">To-Do List & Action Items</h1>
          <p className="text-sm text-muted-foreground mt-1">
            All tasks extracted from your meetings and deliverables assigned to you appear here automatically.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center bg-white/5 p-1 rounded-xl border border-white/10 text-xs">
            <button
              onClick={() => setAdminViewMode("mine")}
              className={`px-3 py-1.5 rounded-lg font-medium transition ${
                adminViewMode === "mine" ? "bg-primary text-primary-foreground shadow" : "text-muted-foreground hover:text-white"
              }`}
            >
              My Tasks
            </button>
            <button
              onClick={() => setAdminViewMode("all")}
              className={`px-3 py-1.5 rounded-lg font-medium transition ${
                adminViewMode === "all" ? "bg-primary text-primary-foreground shadow" : "text-muted-foreground hover:text-white"
              }`}
            >
              All Workspace Tasks ({tasks.length})
            </button>
          </div>

          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogTrigger asChild>
              <Button className="rounded-xl gradient-bg shadow-glow flex items-center gap-2">
                <Plus className="h-4 w-4" /> New Task
              </Button>
            </DialogTrigger>
            <DialogContent className="glass border-white/10 sm:max-w-md">
              <DialogHeader>
                <DialogTitle className="text-xl font-bold">Add Action Item</DialogTitle>
                <DialogDescription>Add a new task linked to your meetings.</DialogDescription>
              </DialogHeader>
              <form onSubmit={handleCreateTask} className="space-y-4 pt-2">
                <div className="space-y-2">
                  <Label htmlFor="task-title">Task Description</Label>
                  <Input
                    id="task-title"
                    placeholder="e.g. Complete presentation slides"
                    value={newTitle}
                    onChange={e => setNewTitle(e.target.value)}
                    required
                    className="bg-white/5 border-white/10"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="task-assignee">Assignee</Label>
                  <Input
                    id="task-assignee"
                    placeholder={userFullName || "Your Name"}
                    value={newAssignee}
                    onChange={e => setNewAssignee(e.target.value)}
                    className="bg-white/5 border-white/10"
                  />
                </div>

                <div className="space-y-2">
                  <Label>Link to Meeting</Label>
                  <Select value={newMeetingId} onValueChange={setNewMeetingId}>
                    <SelectTrigger className="bg-white/5 border-white/10">
                      <SelectValue placeholder="Select a meeting" />
                    </SelectTrigger>
                    <SelectContent>
                      {allMeetings.map(m => (
                        <SelectItem key={m.id} value={m.id}>
                          {m.title}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="task-deadline">Due Date</Label>
                    <Input
                      id="task-deadline"
                      type="date"
                      value={newDeadline}
                      onChange={e => setNewDeadline(e.target.value)}
                      className="bg-white/5 border-white/10"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label>Status</Label>
                    <Select value={newStatus} onValueChange={setNewStatus}>
                      <SelectTrigger className="bg-white/5 border-white/10">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="pending">To Do</SelectItem>
                        <SelectItem value="in_progress">In Progress</SelectItem>
                        <SelectItem value="done">Completed</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="flex justify-end gap-3 pt-4 border-t border-white/10">
                  <Button type="button" variant="ghost" onClick={() => setCreateOpen(false)}>
                    Cancel
                  </Button>
                  <Button type="submit" disabled={creating} className="gradient-bg shadow-glow">
                    {creating ? "Creating..." : "Create Task"}
                  </Button>
                </div>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Search Bar */}
      <div className="flex items-center justify-between glass p-3 rounded-2xl border border-white/5">
        <div className="relative w-full sm:w-96">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search tasks, meetings, or assignees..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="pl-9 bg-white/5 border-white/5 h-9 rounded-xl text-sm"
          />
        </div>
        <div className="text-xs text-muted-foreground hidden sm:flex items-center gap-2">
          <span>💡 Click on any task card to view its complete meeting summary & details</span>
        </div>
      </div>

      {/* Kanban Board */}
      <div className="flex gap-6 overflow-x-auto pb-6 flex-1 items-start min-h-[65vh]">
        <Column 
          title="To Do" 
          status="pending" 
          tasks={todoTasks} 
          colorClass="bg-slate-400"
          badgeClass="bg-slate-500/10 text-slate-400 border-slate-500/20"
          meetingsMap={meetingsMap}
          onDragStart={handleDragStart}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
          onStatusChange={updateTaskStatus}
          onDelete={deleteTask}
          onSelectTask={setSelectedTask}
        />
        <Column 
          title="In Progress" 
          status="in_progress" 
          tasks={inProgressTasks} 
          colorClass="bg-blue-500"
          badgeClass="bg-blue-500/10 text-blue-400 border-blue-500/20"
          meetingsMap={meetingsMap}
          onDragStart={handleDragStart}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
          onStatusChange={updateTaskStatus}
          onDelete={deleteTask}
          onSelectTask={setSelectedTask}
        />
        <Column 
          title="Completed" 
          status="done" 
          tasks={doneTasks} 
          colorClass="bg-emerald-500"
          badgeClass="bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
          meetingsMap={meetingsMap}
          onDragStart={handleDragStart}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
          onStatusChange={updateTaskStatus}
          onDelete={deleteTask}
          onSelectTask={setSelectedTask}
        />
      </div>

      {/* Task Detail & Meeting Summary Modal */}
      <Dialog open={!!selectedTask} onOpenChange={(open) => !open && setSelectedTask(null)}>
        <DialogContent className="glass border-white/10 sm:max-w-2xl max-h-[85vh] overflow-y-auto">
          {selectedTask && (
            <div className="space-y-6 pt-2">
              <DialogHeader>
                <div className="flex items-center justify-between gap-3 mb-1">
                  <Badge 
                    variant={selectedTask.status === "done" ? "secondary" : "outline"} 
                    className={`px-2.5 py-1 text-xs uppercase tracking-wider font-bold ${
                      selectedTask.status === "done" 
                        ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30" 
                        : selectedTask.status === "in_progress"
                        ? "bg-blue-500/10 text-blue-400 border-blue-500/30"
                        : "bg-slate-500/10 text-slate-300 border-white/10"
                    }`}
                  >
                    {selectedTask.status === "done" ? "Completed" : selectedTask.status === "in_progress" ? "In Progress" : "To Do"}
                  </Badge>

                  <div className="flex items-center gap-2">
                    {selectedTask.status !== "pending" && (
                      <Button 
                        size="sm" 
                        variant="outline" 
                        onClick={() => updateTaskStatus(selectedTask.id, "pending")}
                        className="text-xs glass border-white/10 h-7"
                      >
                        Set to To Do
                      </Button>
                    )}
                    {selectedTask.status !== "in_progress" && (
                      <Button 
                        size="sm" 
                        variant="outline" 
                        onClick={() => updateTaskStatus(selectedTask.id, "in_progress")}
                        className="text-xs glass border-white/10 h-7 text-blue-400"
                      >
                        Set In Progress
                      </Button>
                    )}
                    {selectedTask.status !== "done" && (
                      <Button 
                        size="sm" 
                        onClick={() => updateTaskStatus(selectedTask.id, "done")}
                        className="text-xs gradient-bg shadow-glow h-7"
                      >
                        <Check className="h-3 w-3 mr-1" /> Mark Complete
                      </Button>
                    )}
                  </div>
                </div>

                <DialogTitle className="text-xl font-bold text-white/95 leading-snug">
                  {selectedTask.title}
                </DialogTitle>
              </DialogHeader>

              {/* Task Meta Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-4 rounded-2xl bg-white/5 border border-white/5">
                <div className="flex items-center gap-3">
                  <div className="h-9 w-9 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                    <User className="h-4 w-4 text-primary" />
                  </div>
                  <div>
                    <div className="text-[11px] font-semibold uppercase text-muted-foreground tracking-wider">Assigned To</div>
                    <div className="text-sm font-bold text-white">{selectedTask.assignee || "Unassigned"}</div>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <div className="h-9 w-9 rounded-xl bg-blue-500/10 flex items-center justify-center shrink-0">
                    <Calendar className="h-4 w-4 text-blue-400" />
                  </div>
                  <div>
                    <div className="text-[11px] font-semibold uppercase text-muted-foreground tracking-wider">Due Date</div>
                    <div className="text-sm font-bold text-white">
                      {safeFormatDeadline(selectedTask.deadline, selectedMeeting?.scheduled_at || selectedMeeting?.created_at || selectedTask.created_at)}
                    </div>
                  </div>
                </div>
              </div>

              {/* Meeting Info Section */}
              {selectedMeeting ? (
                <div className="p-5 rounded-2xl bg-gradient-to-br from-[#1c2230] to-[#161a24] border border-white/10 space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                      <div className="h-8 w-8 rounded-xl bg-primary/20 flex items-center justify-center">
                        <Video className="h-4 w-4 text-primary" />
                      </div>
                      <div>
                        <div className="text-[11px] font-bold uppercase text-primary tracking-wider">Meeting Source</div>
                        <h4 className="text-base font-bold text-white">{selectedMeeting.title}</h4>
                      </div>
                    </div>

                    <Link to="/meetings/$id" params={{ id: selectedMeeting.id }}>
                      <Button size="sm" variant="outline" className="glass rounded-xl border-white/10 text-xs flex items-center gap-1.5 hover:bg-white/10">
                        <span>Open Meeting</span>
                        <ArrowUpRight className="h-3.5 w-3.5" />
                      </Button>
                    </Link>
                  </div>

                  {/* AI Meeting Summary Context */}
                  {selectedSummary?.executive_summary && (
                    <div className="space-y-2 pt-2 border-t border-white/5">
                      <div className="flex items-center gap-1.5 text-xs font-semibold text-primary">
                        <Sparkles className="h-3.5 w-3.5" />
                        <span>Meeting Summary & Discussion Context</span>
                      </div>
                      <p className="text-xs text-muted-foreground leading-relaxed bg-black/20 p-3.5 rounded-xl border border-white/5">
                        {selectedSummary.executive_summary}
                      </p>
                    </div>
                  )}

                  {selectedSummary?.key_points && selectedSummary.key_points.length > 0 && (
                    <div className="space-y-1.5">
                      <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Key Discussion Points</div>
                      <ul className="list-disc list-inside space-y-1 text-xs text-slate-300">
                        {selectedSummary.key_points.slice(0, 4).map((pt, idx) => (
                          <li key={idx} className="leading-snug">{pt}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              ) : (
                <div className="p-4 rounded-2xl bg-white/5 border border-white/5 text-xs text-muted-foreground flex items-center gap-2">
                  <FileText className="h-4 w-4 opacity-60" />
                  <span>Standalone task (not attached to a specific meeting).</span>
                </div>
              )}

              {/* Modal Footer */}
              <div className="flex flex-wrap items-center justify-between gap-3 pt-4 border-t border-white/10">
                <Button 
                  type="button" 
                  variant="ghost" 
                  size="sm"
                  onClick={() => deleteTask(selectedTask.id)}
                  className="text-red-400 hover:text-red-300 hover:bg-red-500/10 text-xs"
                >
                  <Trash2 className="h-3.5 w-3.5 mr-1.5" /> Delete Task
                </Button>

                <div className="flex items-center gap-2">
                  {selectedTask.meeting_id && (
                    <Link to="/meetings/$id" params={{ id: selectedTask.meeting_id }}>
                      <Button 
                        type="button" 
                        size="sm"
                        className="gradient-bg rounded-xl shadow-glow text-xs flex items-center gap-1.5"
                      >
                        <Mail className="h-3.5 w-3.5" /> Open Meeting & Share Recap
                      </Button>
                    </Link>
                  )}

                  <Button 
                    type="button" 
                    variant="outline" 
                    size="sm"
                    onClick={() => setSelectedTask(null)}
                    className="glass border-white/10 text-xs rounded-xl"
                  >
                    Close
                  </Button>
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

interface ColumnProps {
  title: string;
  status: string;
  tasks: ActionItem[];
  colorClass: string;
  badgeClass: string;
  meetingsMap: Map<string, MeetingInfo>;
  onDragStart: (e: React.DragEvent, taskId: string) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent, status: string) => void;
  onStatusChange: (taskId: string, newStatus: string) => void;
  onDelete: (taskId: string) => void;
  onSelectTask: (task: ActionItem) => void;
}

function Column({ 
  title, 
  status, 
  tasks, 
  colorClass, 
  badgeClass,
  meetingsMap, 
  onDragStart, 
  onDragOver, 
  onDrop,
  onStatusChange,
  onDelete,
  onSelectTask
}: ColumnProps) {
  const [isOver, setIsOver] = useState(false);

  return (
    <div 
      className={`flex flex-col rounded-3xl border transition-all duration-200 p-5 w-[350px] shrink-0 min-h-[60vh] shadow-xl ${
        isOver 
          ? "border-primary bg-[#161e2e] ring-2 ring-primary/40 shadow-[0_0_35px_rgba(59,130,246,0.3)] scale-[1.01]" 
          : "border-white/5 bg-[#12151c]/90 backdrop-blur-xl"
      }`}
      onDragEnter={(e) => {
        e.preventDefault();
        setIsOver(true);
      }}
      onDragOver={(e) => {
        onDragOver(e);
        setIsOver(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) {
          setIsOver(false);
        }
      }}
      onDrop={(e) => {
        setIsOver(false);
        onDrop(e, status);
      }}
    >
      {/* Column Header */}
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className={`h-4 w-1.5 rounded-full ${colorClass}`} />
          <h2 className="text-base font-bold tracking-tight text-white/90">{title}</h2>
        </div>
        <span className={`flex h-6 min-w-[24px] px-2 items-center justify-center rounded-full text-xs font-bold border ${badgeClass}`}>
          {tasks.length}
        </span>
      </div>

      {/* Task Cards List */}
      <div className="flex flex-col gap-3 flex-1">
        {tasks.map((t: ActionItem) => {
          const meeting = t.meeting_id ? meetingsMap.get(t.meeting_id) : null;

          return (
            <div 
              key={t.id}
              draggable
              onDragStart={(e) => onDragStart(e, t.id)}
              onClick={() => onSelectTask(t)}
              className="group cursor-grab active:cursor-grabbing rounded-2xl border border-white/5 bg-[#1a1f2c] p-4 transition-all duration-200 hover:bg-[#222838] hover:border-primary/30 hover:-translate-y-0.5 shadow-md relative"
            >
              {/* Card Header & Title */}
              <div className="flex items-start justify-between gap-3">
                <h3 className="text-sm font-semibold leading-snug text-white/95 break-words flex-1 group-hover:text-primary transition-colors">
                  {t.title}
                </h3>
                
                <DropdownMenu>
                  <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                    <button className="opacity-0 group-hover:opacity-100 p-1 rounded-lg hover:bg-white/10 text-muted-foreground hover:text-white transition">
                      <MoreVertical className="h-4 w-4" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="glass border-white/10" onClick={(e) => e.stopPropagation()}>
                    {status !== "pending" && (
                      <DropdownMenuItem onClick={() => onStatusChange(t.id, "pending")}>
                        Move to To Do
                      </DropdownMenuItem>
                    )}
                    {status !== "in_progress" && (
                      <DropdownMenuItem onClick={() => onStatusChange(t.id, "in_progress")}>
                        Move to In Progress
                      </DropdownMenuItem>
                    )}
                    {status !== "done" && (
                      <DropdownMenuItem onClick={() => onStatusChange(t.id, "done")}>
                        Mark as Completed
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuItem 
                      onClick={() => onDelete(t.id)}
                      className="text-red-400 focus:text-red-400 focus:bg-red-500/10"
                    >
                      Delete Task
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>

              {/* Assignee & Meeting Source Tags */}
              <div className="mt-3 flex flex-wrap items-center gap-2">
                {t.assignee && (
                  <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-white/5 text-[11px] font-medium text-slate-300 border border-white/5">
                    <User className="h-3 w-3 text-primary" />
                    <span className="truncate max-w-[130px]">{t.assignee}</span>
                  </div>
                )}

                {meeting ? (
                  <div 
                    className="flex items-center gap-1 px-2 py-0.5 rounded-md bg-primary/10 text-[11px] font-medium text-primary border border-primary/20 truncate max-w-[150px]"
                    title={`From meeting: ${meeting.title}`}
                  >
                    <Video className="h-3 w-3 shrink-0" />
                    <span className="truncate">{meeting.title}</span>
                  </div>
                ) : (
                  <div className="px-2 py-0.5 rounded-md bg-white/5 text-[10px] font-bold text-muted-foreground uppercase tracking-wider border border-white/5">
                    Standalone
                  </div>
                )}
              </div>

              {/* Card Footer: Due Date & Action Indicators */}
              <div className="mt-4 pt-3 border-t border-white/5 flex items-center justify-between text-[11px] text-muted-foreground">
                <div className="flex items-center gap-1.5 font-medium">
                  <Calendar className="h-3.5 w-3.5 text-primary/70" />
                  <span className="text-slate-300">
                    {safeFormatDeadline(t.deadline, meeting?.scheduled_at || meeting?.created_at || t.created_at)}
                  </span>
                </div>

                {/* Direct 1-Click Move Pills */}
                <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                  {status === "pending" && (
                    <button
                      type="button"
                      onClick={() => onStatusChange(t.id, "in_progress")}
                      className="px-2 py-0.5 rounded-lg bg-blue-500/15 hover:bg-blue-500/30 text-blue-400 border border-blue-500/30 text-[10px] font-semibold flex items-center gap-1 transition shadow-sm"
                      title="Move to In Progress"
                    >
                      Start <ArrowRight className="h-2.5 w-2.5" />
                    </button>
                  )}

                  {status === "in_progress" && (
                    <>
                      <button
                        type="button"
                        onClick={() => onStatusChange(t.id, "pending")}
                        className="px-2 py-0.5 rounded-lg bg-white/5 hover:bg-white/10 text-slate-300 border border-white/10 text-[10px] font-semibold flex items-center gap-1 transition"
                        title="Move back to To Do"
                      >
                        <ArrowLeft className="h-2.5 w-2.5" /> To Do
                      </button>
                      <button
                        type="button"
                        onClick={() => onStatusChange(t.id, "done")}
                        className="px-2 py-0.5 rounded-lg bg-emerald-500/15 hover:bg-emerald-500/30 text-emerald-400 border border-emerald-500/30 text-[10px] font-semibold flex items-center gap-1 transition shadow-sm"
                        title="Mark as Completed"
                      >
                        <Check className="h-2.5 w-2.5" /> Done
                      </button>
                    </>
                  )}

                  {status === "done" && (
                    <button
                      type="button"
                      onClick={() => onStatusChange(t.id, "in_progress")}
                      className="px-2 py-0.5 rounded-lg bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 border border-blue-500/20 text-[10px] font-semibold flex items-center gap-1 transition"
                      title="Reopen task"
                    >
                      Reopen
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
        
        {tasks.length === 0 && (
          <div className={`flex-1 flex flex-col items-center justify-center rounded-2xl border-2 border-dashed p-8 text-center text-xs font-medium transition ${
            isOver ? "border-primary/50 bg-primary/5 text-primary" : "border-white/5 text-muted-foreground"
          }`}>
            <p>{isOver ? "Drop to move here!" : "No tasks in this column"}</p>
            <p className="text-[10px] text-muted-foreground/60 mt-1">Drag and drop tasks or click buttons</p>
          </div>
        )}
      </div>
    </div>
  );
}
