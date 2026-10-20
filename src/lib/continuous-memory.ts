/**
 * Continuous Meeting Memory (CMM)
 *
 * Deterministic, data-agnostic helpers that track tasks across a series of
 * meetings:
 * 1. Persisted meeting records and action items are the source of truth.
 * 2. Tasks are matched across meetings by a canonical key (stored in
 *    action_items.canonical_key, or derived from the title).
 * 3. A later meeting that confirms completion marks the reconciled task done,
 *    while each meeting's own records stay untouched.
 * 4. Pending tasks stay pending until a record or discussion confirms them.
 * 5. Decisions are deduplicated by normalised text; distinct ones are kept.
 * 6. Cumulative summaries contain only facts from the records.
 * 7. Conflicting deadlines/assignees are flagged with evidence, never
 *    silently overwritten.
 */

export type TaskStatus = "pending" | "in_progress" | "done";

export interface ActionItemRecord {
  id?: string;
  meeting_id: string;
  title: string;
  assignee?: string | null;
  deadline?: string | null;
  status: string;
  canonical_key?: string | null;
  created_at?: string;
}

export interface DecisionRecord {
  id?: string;
  meeting_id?: string;
  description: string;
  made_by?: string | null;
  created_at?: string;
}

export interface ConflictRecord {
  task_key?: string;
  field: "deadline" | "status" | "assignee";
  description: string;
  evidence: Array<{
    source: string;
    value: string | null;
  }>;
}

export interface ReconciledTask {
  /** id of the most recent action_items row for this task (or the key if none) */
  id: string;
  canonical_key: string;
  title: string;
  assignee: string | null;
  deadline: string | null;
  status: TaskStatus;
  origin_meeting_id: string;
  last_confirmed_meeting_id: string;
  is_commitment: boolean;
  conflicts: ConflictRecord[];
  history: Array<{
    meeting_id: string;
    meeting_title?: string;
    status: string;
    deadline?: string | null;
    assignee?: string | null;
  }>;
}

export interface MeetingRef {
  id: string;
  title: string;
  scheduled_at?: string | null;
}

export interface MeetingContextText {
  summary?: string;
  transcript?: string;
  key_points?: string[];
}

export interface CumulativeSummaryResult {
  progress_report: string;
  suggested_agenda: string[];
  verified_completed: ReconciledTask[];
  verified_pending: ReconciledTask[];
  verified_decisions: DecisionRecord[];
  conflicts: ConflictRecord[];
}

// ---------------------------------------------------------------------------
// Canonical task keys
// ---------------------------------------------------------------------------

const STOPWORDS = new Set([
  "a",
  "an",
  "the",
  "and",
  "or",
  "of",
  "for",
  "to",
  "with",
  "by",
  "on",
  "in",
  "at",
  "all",
  "any",
  "our",
  "your",
  "their",
  "his",
  "her",
  "its",
  "this",
  "that",
  "these",
  "those",
  "be",
  "is",
  "are",
  "will",
  "it",
  "up",
]);

/** Very small suffix stripper so "share"/"shared"/"sharing" compare equal. */
function stem(word: string): string {
  let w = word;
  if (w.length > 5 && w.endsWith("ing")) w = w.slice(0, -3);
  else if (w.length > 4 && w.endsWith("ies")) w = w.slice(0, -3) + "y";
  else if (w.length > 4 && w.endsWith("ed")) w = w.slice(0, -2);
  else if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss")) w = w.slice(0, -1);
  if (w.length > 3 && w.endsWith("e")) w = w.slice(0, -1);
  return w;
}

/** Significant, stemmed words of a text (used for keys and matching). */
export function significantWords(text: string, ignore: string[] = []): string[] {
  const ignored = new Set(
    ignore
      .flatMap((n) => n.toLowerCase().split(/[^a-z0-9]+/))
      .filter(Boolean)
      .map(stem),
  );
  return (text || "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w && !STOPWORDS.has(w))
    .map(stem)
    .filter((w) => !ignored.has(w));
}

/**
 * Derives a stable canonical key for a task title, e.g.
 * "Finalize the project dashboard" -> "task:finalize-project-dashboard".
 * Words in `ignore` (typically participant names) are left out so the same
 * task assigned to differently-named people still matches.
 */
export function canonicalTaskKey(title: string, ignore: string[] = []): string {
  const words = significantWords(title, ignore);
  const slug = words.join("-").slice(0, 64).replace(/-+$/, "");
  return `task:${slug || "untitled"}`;
}

function keyOf(a: ActionItemRecord, ignore: string[] = []): string {
  const stored = (a.canonical_key || "").trim();
  return stored || canonicalTaskKey(a.title, ignore);
}

// ---------------------------------------------------------------------------
// Deadlines
// ---------------------------------------------------------------------------

const WEEKDAYS: Record<string, number> = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
};

const WEEKDAY_RE =
  /\b(sunday|monday|tuesday|wednesday|thursday|friday|saturday)(\s+(morning|afternoon|evening|night))?\b/i;

/**
 * Resolves a deadline ("Wednesday", "Tuesday evening", "2026-11-05", an ISO
 * timestamp) to a Date. Weekdays resolve to their next occurrence on or after
 * `referenceDate`. Returns null when the value cannot be understood.
 */
export function resolveDeadlineToDate(
  val?: string | null,
  referenceDate?: string | Date | null,
): Date | null {
  if (!val) return null;
  const str = String(val).trim();
  if (!str) return null;

  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(str);
  if (dateOnly) {
    const d = new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]), 17);
    return isNaN(d.getTime()) ? null : d;
  }

  const weekday = WEEKDAY_RE.exec(str);
  if (!weekday || /\d/.test(str)) {
    const parsed = new Date(str);
    if (!isNaN(parsed.getTime())) return parsed;
  }
  if (!weekday) return null;

  const ref = referenceDate ? new Date(referenceDate) : new Date();
  const base = isNaN(ref.getTime()) ? new Date() : ref;
  const target = new Date(base);
  const diff = (WEEKDAYS[weekday[1].toLowerCase()] - base.getDay() + 7) % 7;
  target.setDate(base.getDate() + diff);
  const part = (weekday[3] || "").toLowerCase();
  const hour = part === "morning" ? 9 : part === "afternoon" ? 14 : part ? 18 : 17;
  target.setHours(hour, 0, 0, 0);
  return target;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** Converts a deadline to a local calendar date string YYYY-MM-DD, or null. */
export function resolveDeadlineToISODate(
  val?: string | null,
  referenceDate?: string | Date | null,
): string | null {
  const d = resolveDeadlineToDate(val, referenceDate);
  if (!d || isNaN(d.getTime())) return null;
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Human-readable deadline, e.g. "21 Oct 2026". */
export function safeFormatDeadline(
  val?: string | null,
  referenceDate?: string | Date | null,
  includeYear = true,
): string {
  if (!val) return "No deadline";
  const d = resolveDeadlineToDate(val, referenceDate);
  if (d && !isNaN(d.getTime())) {
    return includeYear
      ? d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
      : d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  }
  return String(val);
}

// ---------------------------------------------------------------------------
// Decisions
// ---------------------------------------------------------------------------

export function normalizeDecisionText(text: string): string {
  if (!text) return "";
  return text
    .toLowerCase()
    .replace(/[.,/#!$%^&*;:{}=\-_`~()?"']/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Removes decisions with identical normalised text; keeps distinct ones. */
export function deduplicateDecisions<T extends DecisionRecord>(decisions: T[]): T[] {
  const seen = new Map<string, T>();
  for (const d of decisions) {
    const norm = normalizeDecisionText(d.description);
    if (!norm) continue;
    const existing = seen.get(norm);
    if (!existing) {
      seen.set(norm, { ...d, description: d.description.trim() });
    } else if (!existing.made_by && d.made_by) {
      existing.made_by = d.made_by;
    }
  }
  return Array.from(seen.values());
}

// ---------------------------------------------------------------------------
// Assignees
// ---------------------------------------------------------------------------

const PLACEHOLDER_ASSIGNEE =
  /^(remote( participant)?|participant( \d+)?|speaker( \d+)?|unknown|unassigned|someone|tbd|n\/a)$/i;

/** True for generic speaker labels such as "Remote Participant" or "Speaker 2". */
export function isPlaceholderAssignee(name?: string | null): boolean {
  const n = (name || "").trim();
  return !n || PLACEHOLDER_ASSIGNEE.test(n);
}

/** Trims an assignee; empty values become null. */
export function normalizeAssignee(raw?: string | null): string | null {
  const clean = (raw || "").replace(/\s+/g, " ").trim();
  return clean || null;
}

// ---------------------------------------------------------------------------
// Completion detection
// ---------------------------------------------------------------------------

const COMPLETION_RE =
  /\b(completed?|finished|done|shipped|delivered|wrapped up|closed|resolved|implemented|deployed|merged)\b/i;
// Sentences that negate, defer or make completion conditional are ignored.
const NEGATION_RE =
  /(\b(not|never|yet to|still|pending|in progress|remain\w*|left|outstanding|incomplete|will|shall|going to|plan to|planning to|should|need to|needs to|once|after|when|until|before|let's|lets)\b|n't\b|'ll\b)/i;

function splitSentences(text: string): string[] {
  return (text || "")
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function mentionsTask(sentence: string, taskWords: string[]): boolean {
  if (taskWords.length === 0) return false;
  const words = new Set(significantWords(sentence));
  const hits = taskWords.filter((w) => words.has(w)).length;
  const needed = taskWords.length <= 2 ? taskWords.length : Math.ceil(taskWords.length * 0.6);
  return hits >= needed;
}

/** Words that describe the work itself; completion verbs are excluded. */
function taskSubjectWords(title: string, ignore: string[] = []): string[] {
  const generic = new Set(
    significantWords(
      "complete completed finish finished finalize do done handle work task make prepare get",
    ),
  );
  return Array.from(new Set(significantWords(title, ignore).filter((w) => !generic.has(w))));
}

/**
 * Returns true if `text` contains a sentence that refers to the task and
 * states that it is complete (and is not negated or future tense).
 */
export function confirmsCompletion(
  text: string,
  taskTitle: string,
  ignore: string[] = [],
): boolean {
  const subject = taskSubjectWords(taskTitle, ignore);
  return splitSentences(text).some(
    (s) => COMPLETION_RE.test(s) && !NEGATION_RE.test(s) && mentionsTask(s, subject),
  );
}

/** Finds a deadline phrase stated for the task in the discussion text. */
export function deadlineMentionedFor(
  text: string,
  taskTitle: string,
  ignore: string[] = [],
): string | null {
  const subject = taskSubjectWords(taskTitle, ignore);
  for (const s of splitSentences(text)) {
    if (!mentionsTask(s, subject)) continue;
    const iso = /\b\d{4}-\d{2}-\d{2}\b/.exec(s);
    if (iso) return iso[0];
    const wd = WEEKDAY_RE.exec(s);
    if (wd) {
      const phrase = wd[0].toLowerCase();
      return phrase.charAt(0).toUpperCase() + phrase.slice(1);
    }
  }
  return null;
}

function normalizeStatus(raw: string): TaskStatus {
  const s = (raw || "").toLowerCase().trim();
  if (s === "done" || s === "completed" || s === "complete") return "done";
  if (s === "in_progress" || s === "in-progress" || s === "in progress") return "in_progress";
  return "pending";
}

function sameDeadline(a: string | null, b: string | null, ref?: string | null): boolean {
  if (!a || !b) return true;
  const da = resolveDeadlineToISODate(a, ref);
  const db = resolveDeadlineToISODate(b, ref);
  if (da && db) return da === db;
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

// ---------------------------------------------------------------------------
// Reconciliation
// ---------------------------------------------------------------------------

/**
 * Reconciles tasks across meetings in chronological order.
 * - Keeps each meeting's records intact (historicalRecords).
 * - Marks a task done when a later record or discussion confirms completion.
 * - Flags deadline/assignee conflicts with evidence instead of overwriting.
 *
 * `ignoreWords` (e.g. participant names) are excluded from derived keys.
 */
export function reconcileCrossMeetingTasks(
  meetings: MeetingRef[],
  meetingActions: Record<string, ActionItemRecord[]>,
  meetingContexts: Record<string, MeetingContextText> = {},
  ignoreWords: string[] = [],
): {
  reconciledTasks: ReconciledTask[];
  conflicts: ConflictRecord[];
  historicalRecords: Record<string, ActionItemRecord[]>;
} {
  const sorted = [...meetings].sort((a, b) => {
    const da = a.scheduled_at ? new Date(a.scheduled_at).getTime() : 0;
    const db = b.scheduled_at ? new Date(b.scheduled_at).getTime() : 0;
    return da - db;
  });

  const taskMap = new Map<string, ReconciledTask>();
  const allConflicts: ConflictRecord[] = [];
  const historicalRecords: Record<string, ActionItemRecord[]> = {};

  for (const meeting of sorted) {
    const actions = meetingActions[meeting.id] || [];
    const ctx = meetingContexts[meeting.id] || {};
    const contextText = [ctx.summary || "", ctx.transcript || "", ...(ctx.key_points || [])].join(
      "\n",
    );
    historicalRecords[meeting.id] = actions.map((a) => ({ ...a }));

    for (const a of actions) {
      const key = keyOf(a, ignoreWords);
      const assignee = normalizeAssignee(a.assignee);
      const deadline = a.deadline || null;
      let status = normalizeStatus(a.status);
      if (status !== "done" && confirmsCompletion(contextText, a.title, ignoreWords)) {
        status = "done";
      }

      const existing = taskMap.get(key);
      if (!existing) {
        const task: ReconciledTask = {
          id: a.id || key,
          canonical_key: key,
          title: a.title,
          assignee,
          deadline,
          status,
          origin_meeting_id: meeting.id,
          last_confirmed_meeting_id: meeting.id,
          is_commitment: /\breview\b/i.test(a.title),
          conflicts: [],
          history: [
            { meeting_id: meeting.id, meeting_title: meeting.title, status, deadline, assignee },
          ],
        };

        const discussed = deadlineMentionedFor(contextText, a.title, ignoreWords);
        if (discussed && deadline && !sameDeadline(discussed, deadline, meeting.scheduled_at)) {
          const conflict: ConflictRecord = {
            task_key: key,
            field: "deadline",
            description: `Deadline for "${a.title}" differs: the discussion says "${discussed}" but the action item says "${deadline}".`,
            evidence: [
              { source: `${meeting.title} discussion`, value: discussed },
              { source: `${meeting.title} action item`, value: deadline },
            ],
          };
          task.conflicts.push(conflict);
          allConflicts.push(conflict);
        }

        taskMap.set(key, task);
        continue;
      }

      // Same task seen again in a later meeting.
      if (a.id) existing.id = a.id;
      if (existing.status !== "done" && status !== "pending") {
        existing.status = status;
        existing.last_confirmed_meeting_id = meeting.id;
      }

      if (assignee && assignee !== existing.assignee) {
        if (isPlaceholderAssignee(existing.assignee)) {
          existing.assignee = assignee; // a real name replaces a placeholder
        } else if (!isPlaceholderAssignee(assignee)) {
          const conflict: ConflictRecord = {
            task_key: key,
            field: "assignee",
            description: `Assignee for "${existing.title}" changed from "${existing.assignee}" to "${assignee}".`,
            evidence: [
              { source: "Earlier meeting", value: existing.assignee },
              { source: meeting.title, value: assignee },
            ],
          };
          existing.conflicts.push(conflict);
          allConflicts.push(conflict);
          existing.assignee = assignee;
        }
      }

      if (deadline && !sameDeadline(deadline, existing.deadline, meeting.scheduled_at)) {
        const conflict: ConflictRecord = {
          task_key: key,
          field: "deadline",
          description: `Deadline for "${existing.title}" changed from "${existing.deadline}" to "${deadline}".`,
          evidence: [
            { source: "Earlier meeting", value: existing.deadline },
            { source: meeting.title, value: deadline },
          ],
        };
        existing.conflicts.push(conflict);
        allConflicts.push(conflict);
        existing.deadline = deadline;
      }

      existing.history.push({
        meeting_id: meeting.id,
        meeting_title: meeting.title,
        status,
        deadline: deadline || existing.deadline,
        assignee: assignee || existing.assignee,
      });
    }

    // A later discussion may confirm a task from an earlier meeting.
    for (const task of taskMap.values()) {
      if (task.status === "done" || task.origin_meeting_id === meeting.id) continue;
      if (confirmsCompletion(contextText, task.title, ignoreWords)) {
        task.status = "done";
        task.last_confirmed_meeting_id = meeting.id;
        task.history.push({
          meeting_id: meeting.id,
          meeting_title: meeting.title,
          status: "done",
          deadline: task.deadline,
          assignee: task.assignee,
        });
      }
    }
  }

  return {
    reconciledTasks: Array.from(taskMap.values()),
    conflicts: allConflicts,
    historicalRecords,
  };
}

/**
 * Builds a grounded cumulative summary of a series of meetings from the
 * persisted records only.
 */
export function buildVerifiedCumulativeSummary(
  project: { id: string; name: string },
  meetings: MeetingRef[],
  summaries: Array<{
    meeting_id: string;
    executive_summary?: string | null;
    key_points?: unknown;
  }>,
  actions: ActionItemRecord[],
  decisions: DecisionRecord[],
  transcripts: Array<{ meeting_id: string; speaker: string; content: string }> = [],
  ignoreWords: string[] = [],
): CumulativeSummaryResult {
  const meetingActions: Record<string, ActionItemRecord[]> = {};
  for (const a of actions) {
    (meetingActions[a.meeting_id] ||= []).push(a);
  }

  const meetingContexts: Record<string, MeetingContextText> = {};
  for (const m of meetings) {
    const s = summaries.find((x) => x.meeting_id === m.id);
    meetingContexts[m.id] = {
      summary: s?.executive_summary || "",
      key_points: Array.isArray(s?.key_points)
        ? (s.key_points as unknown[]).filter((k): k is string => typeof k === "string")
        : [],
      transcript: transcripts
        .filter((t) => t.meeting_id === m.id)
        .map((t) => `${t.speaker}: ${t.content}`)
        .join("\n"),
    };
  }

  const { reconciledTasks, conflicts } = reconcileCrossMeetingTasks(
    meetings,
    meetingActions,
    meetingContexts,
    ignoreWords,
  );

  const verifiedCompleted = reconciledTasks.filter((t) => t.status === "done");
  const verifiedPending = reconciledTasks.filter((t) => t.status !== "done");
  const verifiedDecisions = deduplicateDecisions(decisions);

  const lines: string[] = [];
  lines.push(`### Cumulative progress for ${project.name}`);
  lines.push(
    `Based on ${meetings.length} recorded meeting${meetings.length === 1 ? "" : "s"}. Only facts from saved meeting records are included.`,
  );

  lines.push(`\n#### Completed`);
  if (verifiedCompleted.length > 0) {
    for (const t of verifiedCompleted) {
      lines.push(`- **${t.title}**${t.assignee ? ` (${t.assignee})` : ""}`);
    }
  } else {
    lines.push(`- Nothing has been confirmed as completed yet.`);
  }

  lines.push(`\n#### Outstanding`);
  if (verifiedPending.length > 0) {
    for (const t of verifiedPending) {
      const due = t.deadline ? `, due ${safeFormatDeadline(t.deadline)}` : "";
      const state = t.status === "in_progress" ? " (in progress)" : "";
      lines.push(`- **${t.title}**${state}: ${t.assignee || "Unassigned"}${due}`);
    }
  } else {
    lines.push(`- No outstanding tasks.`);
  }

  if (verifiedDecisions.length > 0) {
    lines.push(`\n#### Decisions`);
    for (const d of verifiedDecisions) {
      lines.push(`- ${d.description}${d.made_by ? ` (${d.made_by})` : ""}`);
    }
  }

  if (conflicts.length > 0) {
    lines.push(`\n#### Discrepancies to check`);
    for (const c of conflicts) {
      const evidence = c.evidence.map((e) => `${e.source}: "${e.value ?? "none"}"`).join(" vs ");
      lines.push(`- ${c.description} (${evidence})`);
    }
  }

  const agenda: string[] = [];
  for (const t of verifiedPending) {
    agenda.push(
      `Review progress on ${t.title}${t.deadline ? ` (due ${safeFormatDeadline(t.deadline)})` : ""}`,
    );
  }
  for (const c of conflicts) {
    agenda.push(`Clarify ${c.field}: ${c.description}`);
  }

  return {
    progress_report: lines.join("\n"),
    suggested_agenda: agenda.slice(0, 5),
    verified_completed: verifiedCompleted,
    verified_pending: verifiedPending,
    verified_decisions: verifiedDecisions,
    conflicts,
  };
}
