import { describe, it } from "node:test";
import assert from "node:assert";
import {
  canonicalTaskKey,
  normalizeDecisionText,
  deduplicateDecisions,
  reconcileCrossMeetingTasks,
  buildVerifiedCumulativeSummary,
  confirmsCompletion,
  deadlineMentionedFor,
  isPlaceholderAssignee,
  normalizeAssignee,
  safeFormatDeadline,
  resolveDeadlineToDate,
  resolveDeadlineToISODate,
  type ActionItemRecord,
  type DecisionRecord,
} from "./continuous-memory.ts";

const M1 = { id: "m1", title: "Sync 1", scheduled_at: "2026-10-01T10:00:00Z" };
const M2 = { id: "m2", title: "Sync 2", scheduled_at: "2026-10-03T10:00:00Z" };

describe("canonicalTaskKey", () => {
  it("is stable across case, punctuation, stopwords and simple plurals", () => {
    assert.strictEqual(
      canonicalTaskKey("Finalize the project dashboard!"),
      canonicalTaskKey("finalize project dashboards"),
    );
    assert.strictEqual(
      canonicalTaskKey("Share the dashboard"),
      canonicalTaskKey("Shared dashboard"),
    );
    assert.match(canonicalTaskKey("Write API docs"), /^task:[a-z0-9-]+$/);
  });

  it("can ignore participant names so reassigned tasks still match", () => {
    assert.strictEqual(
      canonicalTaskKey("Send report to Remote Participant", ["Remote Participant"]),
      canonicalTaskKey("Send report to Jamie Doe", ["Jamie Doe"]),
    );
  });

  it("never returns an empty key", () => {
    assert.strictEqual(canonicalTaskKey("   "), "task:untitled");
  });
});

describe("Task completion across sequential meetings", () => {
  it("marks a task done when a later meeting's record says done, keeping history intact", () => {
    const meetingActions: Record<string, ActionItemRecord[]> = {
      m1: [
        {
          id: "row-1",
          meeting_id: "m1",
          title: "Finalize project dashboard",
          assignee: "Host",
          deadline: "Wednesday",
          status: "pending",
          canonical_key: "task:dashboard",
        },
        {
          id: "row-2",
          meeting_id: "m1",
          title: "UI improvements and QA testing",
          assignee: "Remote Participant",
          deadline: "Friday",
          status: "pending",
          canonical_key: "task:ui",
        },
      ],
      m2: [
        {
          id: "row-3",
          meeting_id: "m2",
          title: "Finalize project dashboard",
          assignee: "Host",
          deadline: "Wednesday",
          status: "done",
          canonical_key: "task:dashboard",
        },
        {
          id: "row-4",
          meeting_id: "m2",
          title: "UI improvements and QA testing",
          assignee: "Teammate",
          deadline: "Friday",
          status: "done",
          canonical_key: "task:ui",
        },
      ],
    };

    const { reconciledTasks, historicalRecords, conflicts } = reconcileCrossMeetingTasks(
      [M2, M1],
      meetingActions,
    );

    const dashboard = reconciledTasks.find((t) => t.canonical_key === "task:dashboard");
    const ui = reconciledTasks.find((t) => t.canonical_key === "task:ui");
    assert.ok(dashboard && ui);
    assert.strictEqual(reconciledTasks.length, 2);
    assert.strictEqual(dashboard.status, "done");
    assert.strictEqual(dashboard.id, "row-3", "id points at the latest row");
    assert.strictEqual(dashboard.last_confirmed_meeting_id, "m2");
    assert.strictEqual(ui.status, "done");
    assert.strictEqual(ui.assignee, "Teammate", "a real name replaces a placeholder");
    assert.strictEqual(conflicts.length, 0, "placeholder -> name is not a conflict");
    assert.strictEqual(historicalRecords.m1[0].status, "pending");
    assert.strictEqual(historicalRecords.m2[0].status, "done");
  });

  it("marks a task done when a later discussion confirms it", () => {
    const { reconciledTasks } = reconcileCrossMeetingTasks(
      [M1, M2],
      {
        m1: [
          {
            meeting_id: "m1",
            title: "Complete the project dashboard",
            assignee: "Host",
            status: "pending",
          },
        ],
        m2: [],
      },
      {
        m1: { summary: "The host will work on the project dashboard." },
        m2: { summary: "The project dashboard has been completed and verified." },
      },
    );
    assert.strictEqual(reconciledTasks[0].status, "done");
    assert.strictEqual(reconciledTasks[0].last_confirmed_meeting_id, "m2");
  });

  it("does not treat negated or future statements as completion", () => {
    assert.strictEqual(
      confirmsCompletion("The dashboard is not completed yet.", "Finish dashboard"),
      false,
    );
    assert.strictEqual(
      confirmsCompletion("We'll review once the dashboard is done.", "Finish dashboard"),
      false,
    );
    assert.strictEqual(
      confirmsCompletion("The only thing left is the review of completed work.", "Joint review"),
      false,
    );
    assert.strictEqual(
      confirmsCompletion("Yes, the dashboard has been completed.", "Finish dashboard"),
      true,
    );
    assert.strictEqual(
      confirmsCompletion("The budget report has been completed.", "Finish dashboard"),
      false,
      "unrelated tasks are not matched",
    );
  });

  it("keeps a pending task pending until something confirms it", () => {
    const { reconciledTasks } = reconcileCrossMeetingTasks(
      [M1, M2],
      {
        m1: [
          {
            meeting_id: "m1",
            title: "Joint review of deliverables",
            assignee: "Host",
            deadline: "Friday",
            status: "pending",
          },
        ],
        m2: [],
      },
      { m2: { summary: "Discussed the release plan." } },
    );
    assert.strictEqual(reconciledTasks.length, 1);
    assert.strictEqual(reconciledTasks[0].status, "pending");
    assert.strictEqual(reconciledTasks[0].deadline, "Friday");
    assert.strictEqual(reconciledTasks[0].is_commitment, true);
  });

  it("unifies rows without stored keys by their derived key", () => {
    const { reconciledTasks } = reconcileCrossMeetingTasks([M1, M2], {
      m1: [{ meeting_id: "m1", title: "Prepare the release notes", status: "pending" }],
      m2: [{ meeting_id: "m2", title: "prepare release notes", status: "done" }],
    });
    assert.strictEqual(reconciledTasks.length, 1);
    assert.strictEqual(reconciledTasks[0].status, "done");
  });
});

describe("Conflict detection", () => {
  it("flags a deadline that differs between discussion and record without overwriting it", () => {
    const { reconciledTasks, conflicts } = reconcileCrossMeetingTasks(
      [M1],
      {
        m1: [
          {
            meeting_id: "m1",
            title: "UI improvements and QA testing",
            assignee: "Remote Participant",
            deadline: "Friday",
            status: "pending",
          },
        ],
      },
      {
        m1: {
          summary: "The team agreed the UI improvements and QA testing are due Tuesday evening.",
        },
      },
    );
    assert.strictEqual(conflicts.length, 1);
    assert.strictEqual(conflicts[0].field, "deadline");
    assert.deepStrictEqual(
      conflicts[0].evidence.map((e) => e.value),
      ["Tuesday evening", "Friday"],
    );
    assert.strictEqual(reconciledTasks[0].deadline, "Friday", "record is kept");
    assert.strictEqual(reconciledTasks[0].conflicts.length, 1);
  });

  it("flags an assignee change between two named people", () => {
    const { conflicts, reconciledTasks } = reconcileCrossMeetingTasks([M1, M2], {
      m1: [{ meeting_id: "m1", title: "Draft budget", assignee: "Avery", status: "pending" }],
      m2: [{ meeting_id: "m2", title: "Draft budget", assignee: "Blake", status: "pending" }],
    });
    assert.strictEqual(conflicts.length, 1);
    assert.strictEqual(conflicts[0].field, "assignee");
    assert.strictEqual(reconciledTasks[0].assignee, "Blake");
  });

  it("finds the deadline stated for a task in discussion text", () => {
    assert.strictEqual(
      deadlineMentionedFor("We will ship the landing page by Thursday.", "Ship landing page"),
      "Thursday",
    );
    assert.strictEqual(deadlineMentionedFor("No dates were set.", "Ship landing page"), null);
  });
});

describe("Decision deduplication", () => {
  it("removes duplicates and keeps distinct decisions", () => {
    const raw: DecisionRecord[] = [
      { id: "d1", description: "Prioritize the dashboard by Wednesday." },
      { id: "d2", description: "prioritize the dashboard by Wednesday" },
      { id: "d3", description: "Finish QA testing by Friday." },
      { id: "d4", description: "Prioritize the dashboard by Wednesday.", made_by: "Team" },
    ];
    const result = deduplicateDecisions(raw);
    assert.strictEqual(result.length, 2);
    assert.strictEqual(result[0].made_by, "Team", "made_by is enriched from a duplicate");
  });

  it("keeps similarly worded but different decisions", () => {
    const result = deduplicateDecisions([
      { description: "Review frontend changes on Wednesday" },
      { description: "Review backend changes on Wednesday" },
    ]);
    assert.strictEqual(result.length, 2);
    assert.strictEqual(normalizeDecisionText("  Hello, World! "), "hello world");
  });
});

describe("Grounded cumulative summary", () => {
  it("reports only what the records contain", () => {
    const actions: ActionItemRecord[] = [
      { meeting_id: "m1", title: "Finalize dashboard", assignee: "Host", status: "pending" },
      { meeting_id: "m2", title: "Finalize dashboard", assignee: "Host", status: "done" },
      {
        meeting_id: "m2",
        title: "Joint review of deliverables",
        assignee: "Host",
        deadline: "2026-10-09",
        status: "pending",
      },
    ];
    const decisions: DecisionRecord[] = [
      { meeting_id: "m1", description: "Ship on Friday" },
      { meeting_id: "m2", description: "Ship on Friday" },
    ];
    const s = buildVerifiedCumulativeSummary(
      { id: "p1", name: "Website" },
      [M1, M2],
      [{ meeting_id: "m1", executive_summary: "Planning." }],
      actions,
      decisions,
    );
    assert.strictEqual(s.verified_completed.length, 1);
    assert.strictEqual(s.verified_pending.length, 1);
    assert.strictEqual(s.verified_decisions.length, 1);
    assert.ok(s.progress_report.includes("Finalize dashboard"));
    assert.ok(s.progress_report.includes("Joint review of deliverables"));
    assert.ok(s.suggested_agenda[0].includes("Joint review of deliverables"));
  });

  it("does not invent tasks when there are none", () => {
    const s = buildVerifiedCumulativeSummary({ id: "p1", name: "Empty" }, [M1], [], [], []);
    assert.strictEqual(s.verified_pending.length, 0);
    assert.strictEqual(s.verified_completed.length, 0);
    assert.strictEqual(s.suggested_agenda.length, 0);
  });
});

describe("Assignees", () => {
  it("recognises placeholders and normalises names", () => {
    assert.strictEqual(isPlaceholderAssignee("Remote Participant"), true);
    assert.strictEqual(isPlaceholderAssignee("Speaker 2"), true);
    assert.strictEqual(isPlaceholderAssignee("Avery"), false);
    assert.strictEqual(normalizeAssignee("  Avery   Lee "), "Avery Lee");
    assert.strictEqual(normalizeAssignee("   "), null);
  });
});

describe("Deadline resolution", () => {
  const ref = "2026-10-16T10:00:00Z"; // a Friday

  it("turns weekday names into calendar dates", () => {
    assert.strictEqual(safeFormatDeadline("Wednesday", ref), "21 Oct 2026");
    assert.strictEqual(safeFormatDeadline("Friday", ref), "16 Oct 2026");
    assert.strictEqual(safeFormatDeadline("Tuesday evening", ref), "20 Oct 2026");
    assert.strictEqual(safeFormatDeadline("2026-11-05", ref), "5 Nov 2026");
    assert.strictEqual(safeFormatDeadline(null, ref), "No deadline");
    assert.strictEqual(safeFormatDeadline("someday", ref), "someday");
  });

  it("produces YYYY-MM-DD dates", () => {
    assert.strictEqual(resolveDeadlineToISODate("Wednesday", ref), "2026-10-21");
    assert.strictEqual(resolveDeadlineToISODate("Friday", ref), "2026-10-16");
    assert.strictEqual(resolveDeadlineToISODate("Tuesday evening", ref), "2026-10-20");
    assert.strictEqual(resolveDeadlineToISODate("2026-11-05", ref), "2026-11-05");
    assert.strictEqual(resolveDeadlineToISODate("not a date", ref), null);
    assert.strictEqual(resolveDeadlineToDate("Tuesday evening", ref)?.getHours(), 18);
  });
});
