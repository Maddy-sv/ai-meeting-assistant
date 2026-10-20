import { describe, it } from "node:test";
import assert from "node:assert";
import {
  STABLE_TASK_IDS,
  getStableTaskId,
  normalizeDecisionText,
  deduplicateDecisions,
  reconcileCrossMeetingTasks,
  buildVerifiedCumulativeSummary,
  confirmsCompletion,
  safeFormatDeadline,
  resolveDeadlineToDate,
  resolveDeadlineToISODate,
  type ActionItemRecord,
  type DecisionRecord,
} from "./continuous-memory.ts";

describe("Continuous Meeting Memory & Cross-Meeting Task Synchronization", () => {
  describe("1. Task completion updates across sequential meetings", () => {
    it("updates status from pending in Meeting 1 to done when Meeting 2 confirms completion", () => {
      const meetings = [
        { id: "m1", title: "Sprint Sync New1", scheduled_at: "2026-10-01T10:00:00Z" },
        { id: "m2", title: "Sprint Review New2", scheduled_at: "2026-10-03T10:00:00Z" },
      ];

      // Meeting 1 assigned dashboard and UI testing as pending
      const meetingActions: Record<string, ActionItemRecord[]> = {
        m1: [
          {
            id: STABLE_TASK_IDS.dashboard,
            meeting_id: "m1",
            title: "Complete & finalize project dashboard",
            assignee: "Sumeet Made",
            deadline: "Wednesday",
            status: "pending",
          },
          {
            id: STABLE_TASK_IDS.ui_testing,
            meeting_id: "m1",
            title: "Handle UI improvements and QA testing",
            assignee: "Remote Participant",
            deadline: "Tuesday evening",
            status: "pending",
          },
        ],
        // In Meeting 2, explicit status is done
        m2: [
          {
            id: STABLE_TASK_IDS.dashboard,
            meeting_id: "m2",
            title: "Complete & finalize project dashboard",
            assignee: "Sumeet Made",
            deadline: "Wednesday",
            status: "done",
          },
          {
            id: STABLE_TASK_IDS.ui_testing,
            meeting_id: "m2",
            title: "Handle UI improvements and QA testing",
            assignee: "Shreyash",
            deadline: "Friday",
            status: "done",
          },
        ],
      };

      const { reconciledTasks, historicalRecords } = reconcileCrossMeetingTasks(
        meetings,
        meetingActions,
      );

      const dashboardTask = reconciledTasks.find((t) => t.id === STABLE_TASK_IDS.dashboard);
      const uiTask = reconciledTasks.find((t) => t.id === STABLE_TASK_IDS.ui_testing);

      // Current reconciled status must be updated to done
      assert.ok(dashboardTask, "Dashboard task should exist");
      assert.strictEqual(dashboardTask.status, "done", "Dashboard task should be marked done");

      assert.ok(uiTask, "UI task should exist");
      assert.strictEqual(uiTask.status, "done", "UI task should be marked done");
      assert.strictEqual(uiTask.assignee, "Shreyash", "Assignee should be resolved to Shreyash");

      // Crucial: Meeting 1 historical record remains intact (pending)
      assert.strictEqual(
        historicalRecords.m1[0].status,
        "pending",
        "Historical meeting 1 status must remain pending",
      );
      assert.strictEqual(
        historicalRecords.m2[0].status,
        "done",
        "Historical meeting 2 status is done",
      );
    });

    it("updates status to done when context/transcript confirms completion even if earlier item was pending", () => {
      const meetings = [
        { id: "m1", title: "New1", scheduled_at: "2026-10-01T10:00:00Z" },
        { id: "m2", title: "New2", scheduled_at: "2026-10-03T10:00:00Z" },
      ];

      const meetingActions = {
        m1: [
          {
            id: STABLE_TASK_IDS.dashboard,
            meeting_id: "m1",
            title: "Complete & finalize project dashboard",
            assignee: "Sumeet Made",
            deadline: "Wednesday",
            status: "pending",
          },
        ],
        m2: [], // no explicit action row in m2
      };

      const meetingContexts = {
        m1: { summary: "Sumeet will work on dashboard" },
        m2: { summary: "Project dashboard completed and verified with Shreyash" },
      };

      const { reconciledTasks } = reconcileCrossMeetingTasks(
        meetings,
        meetingActions,
        meetingContexts,
      );
      const dashboard = reconciledTasks.find((t) => t.id === STABLE_TASK_IDS.dashboard);
      assert.ok(dashboard);
      assert.strictEqual(
        dashboard.status,
        "done",
        "Should be updated to done based on meeting 2 verification",
      );
    });
  });

  describe("2. Pending-task retention (Friday review commitment)", () => {
    it("strictly preserves the Friday review commitment across subsequent meetings until completed", () => {
      const meetings = [
        { id: "m1", title: "New1", scheduled_at: "2026-10-01T10:00:00Z" },
        { id: "m2", title: "New2", scheduled_at: "2026-10-03T10:00:00Z" },
      ];

      const meetingActions = {
        m1: [
          {
            id: STABLE_TASK_IDS.joint_review,
            meeting_id: "m1",
            title: "Joint review of all completed deliverables",
            assignee: "Remote Participant & Sumeet Made",
            deadline: "Friday",
            status: "pending",
          },
        ],
        m2: [],
      };

      const { reconciledTasks } = reconcileCrossMeetingTasks(meetings, meetingActions);
      const reviewTask = reconciledTasks.find((t) => t.id === STABLE_TASK_IDS.joint_review);

      assert.ok(reviewTask, "Friday review task must be retained");
      assert.strictEqual(reviewTask.status, "pending", "Review commitment must remain pending");
      assert.strictEqual(reviewTask.deadline, "Friday", "Deadline Friday must be preserved");
      assert.strictEqual(reviewTask.is_commitment, true, "Must be flagged as active commitment");
    });

    it("retains Friday review in buildVerifiedCumulativeSummary even if omitted from explicit action list", () => {
      const meetings = [{ id: "m1", title: "New1", scheduled_at: "2026-10-01T10:00:00Z" }];
      const summaries = [{ meeting_id: "m1", executive_summary: "Discussed sprint plans" }];
      const actions: ActionItemRecord[] = [];
      const decisions: DecisionRecord[] = [];

      const result = buildVerifiedCumulativeSummary(
        { id: "p1", name: "AI Companion" },
        meetings,
        summaries,
        actions,
        decisions,
      );

      const pendingReview = result.verified_pending.find(
        (t) => t.canonical_key === "task:joint_review",
      );
      assert.ok(pendingReview, "Friday joint review must be included in pending deliverables");
      assert.strictEqual(pendingReview.deadline, "Friday");
      assert.ok(
        result.suggested_agenda.some(
          (a) => a.toLowerCase().includes("joint review") || a.toLowerCase().includes("friday"),
        ),
        "Suggested agenda must include the Friday review commitment",
      );
    });
  });

  describe("3. Deadline changes & conflict detection", () => {
    it("detects and flags conflicting deadlines between meeting discussion and action item", () => {
      const meetings = [{ id: "m1", title: "New1", scheduled_at: "2026-10-01T10:00:00Z" }];

      const meetingActions = {
        m1: [
          {
            id: STABLE_TASK_IDS.ui_testing,
            meeting_id: "m1",
            title: "Handle UI improvements and QA testing",
            assignee: "Remote Participant",
            deadline: "Friday", // Action item says Friday
            status: "pending",
          },
        ],
      };

      const meetingContexts = {
        m1: {
          summary:
            "Team agreed that Remote Participant will complete UI improvements by Tuesday evening.",
          key_points: ["UI improvements due by Tuesday evening"],
        },
      };

      const { reconciledTasks, conflicts } = reconcileCrossMeetingTasks(
        meetings,
        meetingActions,
        meetingContexts,
      );

      assert.ok(conflicts.length > 0, "Must detect at least one conflict");
      const deadlineConflict = conflicts.find((c) => c.field === "deadline");
      assert.ok(deadlineConflict, "Must detect deadline conflict");
      assert.strictEqual(
        deadlineConflict.evidence.length,
        2,
        "Must retain evidence from both sources",
      );
      assert.strictEqual(deadlineConflict.evidence[0].value, "Tuesday evening");
      assert.strictEqual(deadlineConflict.evidence[1].value, "Friday");

      // The task itself holds the conflict and adopts the latest confirmed discussion deadline
      const uiTask = reconciledTasks.find((t) => t.id === STABLE_TASK_IDS.ui_testing);
      assert.ok(uiTask);
      assert.strictEqual(uiTask.deadline, "Tuesday evening");
      assert.strictEqual(uiTask.conflicts.length, 1);
    });
  });

  describe("4. Strategic decision deduplication", () => {
    it("deduplicates identical decisions across meetings while preserving distinct decisions", () => {
      const rawDecisions: DecisionRecord[] = [
        {
          id: "d1",
          meeting_id: "m1",
          description: "Prioritize and complete the project dashboard by Wednesday.",
          made_by: "Both Participants",
        },
        // Duplicate with different punctuation/casing
        {
          id: "d2",
          meeting_id: "m1",
          description: "prioritize and complete the project dashboard by Wednesday",
          made_by: "Both Participants",
        },
        // Distinct decision 1
        {
          id: "d3",
          meeting_id: "m1",
          description: "Finalize UI improvements and QA testing by Tuesday evening.",
          made_by: "Both Participants",
        },
        // Duplicate in meeting 2
        {
          id: "d4",
          meeting_id: "m2",
          description: "Prioritize and complete the project dashboard by Wednesday.",
          made_by: "Both Participants",
        },
        // Distinct decision 2
        {
          id: "d5",
          meeting_id: "m2",
          description: "Perform joint QA verification and finalize all project deliverables.",
          made_by: "Both Participants",
        },
      ];

      const deduplicated = deduplicateDecisions(rawDecisions);

      // Should have exactly 3 distinct decisions:
      // 1. Prioritize dashboard by Wednesday
      // 2. Finalize UI improvements by Tuesday evening
      // 3. Perform joint QA verification and finalize all project deliverables
      assert.strictEqual(
        deduplicated.length,
        3,
        "Must reduce to exactly 3 unique strategic decisions",
      );

      const descList = deduplicated.map((d) => d.description);
      assert.ok(
        descList.some((d) => d.includes("dashboard")),
        "Must preserve dashboard decision",
      );
      assert.ok(
        descList.some((d) => d.includes("UI improvements")),
        "Must preserve UI improvements decision",
      );
      assert.ok(
        descList.some((d) => d.includes("joint QA verification")),
        "Must preserve QA verification decision",
      );
    });

    it("does not delete distinct decisions that have similar wording", () => {
      const decisions: DecisionRecord[] = [
        { id: "1", description: "Review project frontend changes on Wednesday" },
        { id: "2", description: "Review project backend changes on Wednesday" },
      ];

      const result = deduplicateDecisions(decisions);
      assert.strictEqual(
        result.length,
        2,
        "Distinct frontend vs backend decisions must both be preserved",
      );
    });
  });

  describe("5. Grounded cumulative summaries & anti-hallucination verification", () => {
    it("generates cumulative progress report containing only verified records", () => {
      const meetings = [
        { id: "m1", title: "New1", scheduled_at: "2026-10-01T10:00:00Z" },
        { id: "m2", title: "New2", scheduled_at: "2026-10-03T10:00:00Z" },
      ];

      const summaries = [
        {
          meeting_id: "m1",
          executive_summary: "Sumeet Made will prioritize dashboard; UI testing assigned.",
        },
        {
          meeting_id: "m2",
          executive_summary:
            "Project dashboard and UI improvements both confirmed complete with Shreyash.",
        },
      ];

      const actions: ActionItemRecord[] = [
        {
          id: STABLE_TASK_IDS.dashboard,
          meeting_id: "m1",
          title: "Complete & finalize project dashboard",
          assignee: "Sumeet Made",
          deadline: "Wednesday",
          status: "pending",
        },
        {
          id: STABLE_TASK_IDS.dashboard,
          meeting_id: "m2",
          title: "Complete & finalize project dashboard",
          assignee: "Sumeet Made",
          deadline: "Wednesday",
          status: "done",
        },
        {
          id: STABLE_TASK_IDS.ui_testing,
          meeting_id: "m2",
          title: "Handle UI improvements and QA testing",
          assignee: "Shreyash",
          deadline: "Friday",
          status: "done",
        },
        {
          id: STABLE_TASK_IDS.joint_review,
          meeting_id: "m1",
          title: "Joint review of all completed deliverables",
          assignee: "Shreyash & Sumeet Made",
          deadline: "Friday",
          status: "pending",
        },
      ];

      const decisions: DecisionRecord[] = [
        {
          id: "d1",
          meeting_id: "m1",
          description: "Prioritize dashboard by Wednesday",
        },
        {
          id: "d2",
          meeting_id: "m2",
          description: "Prioritize dashboard by Wednesday", // Duplicate
        },
      ];

      const summary = buildVerifiedCumulativeSummary(
        { id: "p1", name: "AI Meeting Companion" },
        meetings,
        summaries,
        actions,
        decisions,
      );

      // Verify Completed Deliverables
      assert.strictEqual(
        summary.verified_completed.length >= 2,
        true,
        "Must have at least 2 verified completed tasks",
      );
      assert.ok(
        summary.verified_completed.some((t) => t.id === STABLE_TASK_IDS.dashboard),
        "Dashboard must be verified completed",
      );
      assert.ok(
        summary.verified_completed.some((t) => t.id === STABLE_TASK_IDS.ui_testing),
        "UI testing must be verified completed",
      );

      // Verify Pending Deliverables
      assert.ok(
        summary.verified_pending.some((t) => t.id === STABLE_TASK_IDS.joint_review),
        "Joint review must remain verified pending",
      );

      // Verify Decisions
      assert.strictEqual(
        summary.verified_decisions.length,
        1,
        "Decision must be deduplicated to 1",
      );

      // Verify Report content
      assert.ok(summary.progress_report.includes("Verified Completed Deliverables:"));
      assert.ok(summary.progress_report.includes("Complete & finalize project dashboard"));
      assert.ok(summary.progress_report.includes("Outstanding Deliverables & Commitments:"));
      assert.ok(summary.progress_report.includes("Joint review of all completed deliverables"));

      // Verify Agenda
      assert.ok(summary.suggested_agenda.some((a) => a.toLowerCase().includes("joint review")));
    });
  });

  describe("6. Canonical task identification & deduplication across meetings", () => {
    it("correctly maps dashboard sharing tasks to STABLE_TASK_IDS.share rather than dashboard", () => {
      const shareTask = getStableTaskId(
        "Share completed dashboard with Remote Participant for review",
      );
      assert.strictEqual(shareTask.id, STABLE_TASK_IDS.share);
      assert.strictEqual(shareTask.key, "task:share");

      const dashboardTask = getStableTaskId("Complete & finalize project dashboard");
      assert.strictEqual(dashboardTask.id, STABLE_TASK_IDS.dashboard);
      assert.strictEqual(dashboardTask.key, "task:dashboard");
    });

    it("deduplicates duplicate task rows across meetings into single reconciled entity", () => {
      const meetings = [
        { id: "m1", title: "Sprint Meeting 1", scheduled_at: "2026-10-01T10:00:00Z" },
        { id: "m2", title: "Sprint Meeting 2", scheduled_at: "2026-10-03T10:00:00Z" },
      ];

      const meetingActions: Record<string, ActionItemRecord[]> = {
        m1: [
          {
            id: "uuid-row-1",
            meeting_id: "m1",
            title: "Share completed dashboard with Remote Participant for review",
            assignee: "Sumeet Made",
            deadline: "Wednesday",
            status: "pending",
          },
        ],
        m2: [
          {
            id: "uuid-row-2",
            meeting_id: "m2",
            title: "Share completed dashboard with Shreyash for review",
            assignee: "Sumeet Made",
            deadline: "Wednesday",
            status: "done",
          },
        ],
      };

      const { reconciledTasks } = reconcileCrossMeetingTasks(meetings, meetingActions);
      const shareTasks = reconciledTasks.filter((t) => t.canonical_key === "task:share");
      assert.strictEqual(
        shareTasks.length,
        1,
        "Duplicate share task rows must be unified into exactly 1 reconciled task",
      );
      assert.strictEqual(
        shareTasks[0].status,
        "done",
        "Status must reflect completion in Meeting 2",
      );
    });
  });

  describe("7. Concrete calendar date resolution for deadlines", () => {
    it("converts relative day names like Wednesday and Friday into real calendar dates", () => {
      const refDate = "2026-10-16T10:00:00Z"; // Friday 16 Oct 2026

      const wedFormatted = safeFormatDeadline("Wednesday", refDate);
      assert.strictEqual(wedFormatted, "21 Oct 2026", "Wednesday must be formatted as 21 Oct 2026");

      const friFormatted = safeFormatDeadline("Friday", refDate);
      assert.strictEqual(friFormatted, "16 Oct 2026", "Friday must be formatted as 16 Oct 2026");

      const tueFormatted = safeFormatDeadline("Tuesday evening", refDate);
      assert.strictEqual(
        tueFormatted,
        "20 Oct 2026",
        "Tuesday evening must be formatted as 20 Oct 2026",
      );

      const directFormatted = safeFormatDeadline("2026-11-05", refDate);
      assert.strictEqual(directFormatted, "5 Nov 2026", "Direct date must be formatted nicely");
    });

    it("converts weekday strings to ISO YYYY-MM-DD format for database and input fields", () => {
      const refDate = "2026-10-16T10:00:00Z"; // Friday 16 Oct 2026
      assert.strictEqual(resolveDeadlineToISODate("Wednesday", refDate), "2026-10-21");
      assert.strictEqual(resolveDeadlineToISODate("Friday", refDate), "2026-10-16");
      assert.strictEqual(resolveDeadlineToISODate("Tuesday evening", refDate), "2026-10-20");
    });
  });
});
