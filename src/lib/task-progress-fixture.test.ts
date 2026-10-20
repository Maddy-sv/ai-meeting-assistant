import { describe, it } from "node:test";
import assert from "node:assert";
import {
  assessTaskStatus,
  planTaskProgressUpdates,
  resolveTaskAssignee,
  taskTitlesMatch,
} from "./continuous-memory.ts";

const PLANNING_TRANSCRIPT = [
  "Host Person: Good morning. Today we need to discuss our AI meeting companion project and assign the remaining tasks.",
  "Remote Participant: Yes, good morning. What should we cover first?",
  "Host Person: We need to finish the dashboard by Wednesday. I will take responsibility for completing it.",
  "Remote Participant: Okay. I will improve the user interface and fix the remaining design issues by Tuesday evening, okay?",
  "Host Person: We also need to test the meeting summary and action items features before Friday.",
  "Remote Participant: I'll test the summary and action items features on Thursday and share the results with you.",
  "Host Person: Agreed. We will review the dashboard, interface improvements, and test results together on Friday.",
  "Remote Participant: Let me recap: you will finish the dashboard by Wednesday, I will complete the UI improvements by Tuesday evening, and test the summary and action items features on Thursday.",
  "Host Person: Correct. We will review everything on Friday. Thank you, goodbye.",
].join("\n");

const FOLLOW_UP_TRANSCRIPT = [
  "Host Person: Yes, now we start our meeting. Good morning, let's review our previous meeting's tasks. I completed the dashboard yesterday. Did you finish the UI improvements?",
  "Remote Person: Good morning. Yes, I completed the UI improvements yesterday evening. I also tested the meeting summary features, but the action items feature still needs one more test.",
  "Host Person: Please complete the remaining action items test today and share the results with me.",
  "Remote Person: I'll finish the test and send you the results by 3:00 p.m. today.",
  "Host Person: We had planned to review everything together on Friday. Let's keep that review and include the final test results.",
  "Remote Person: To recap: the dashboard and UI improvements are complete. I will finish the remaining action items test by 3:00 p.m. today, and we will review everything on Friday.",
  "Host Person: Correct. Thank you for the update, have a good day.",
  "Remote Person: Okay, thank you, goodbye.",
].join("\n");

const NAMES = ["Host Person", "Remote Participant", "Remote Person"];

const MEETINGS = [
  { id: "follow-up", date: "2026-10-11T09:28:15Z", text: FOLLOW_UP_TRANSCRIPT },
  { id: "planning", date: "2026-10-11T08:36:34Z", text: PLANNING_TRANSCRIPT },
];

const PLANNING_TASKS = [
  { id: "dashboard", meeting_id: "planning", title: "Finalize the dashboard", status: "pending" },
  {
    id: "ui",
    meeting_id: "planning",
    title: "Improve user interface and resolve design issues",
    status: "pending",
  },
  {
    id: "testing",
    meeting_id: "planning",
    title: "Test the meeting summary and action items features",
    status: "pending",
  },
  {
    id: "review",
    meeting_id: "planning",
    title: "Review the dashboard, interface improvements and test results together",
    status: "pending",
  },
];

const FOLLOW_UP_TASKS = [
  {
    id: "remaining-test",
    meeting_id: "follow-up",
    title: "Complete the remaining action items test and share results",
    status: "pending",
  },
];

function statusesAfter(tasks: typeof PLANNING_TASKS) {
  const updates = new Map(
    planTaskProgressUpdates(MEETINGS, tasks, NAMES).map((u) => [u.id, u.status]),
  );
  return Object.fromEntries(tasks.map((t) => [t.id, updates.get(t.id) ?? t.status]));
}

describe("Cross-meeting progress on a recorded planning and follow-up meeting", () => {
  it("moves the planning meeting's tasks forward from the follow-up transcript alone", () => {
    assert.deepStrictEqual(statusesAfter([...PLANNING_TASKS, ...FOLLOW_UP_TASKS]), {
      dashboard: "done",
      ui: "done",
      testing: "in_progress",
      review: "pending",
      "remaining-test": "pending",
    });
  });

  it("does not mark anything from the planning meeting's own words", () => {
    for (const t of PLANNING_TASKS) {
      assert.strictEqual(assessTaskStatus(PLANNING_TRANSCRIPT, t.title, NAMES), "pending", t.title);
    }
  });

  it("keeps the new follow-up task pending in its own meeting", () => {
    assert.strictEqual(
      assessTaskStatus(FOLLOW_UP_TRANSCRIPT, FOLLOW_UP_TASKS[0].title, NAMES),
      "pending",
    );
  });

  it("matches abbreviations, synonyms and word forms", () => {
    assert.strictEqual(
      assessTaskStatus("I completed the UI improvements.", "Improve the user interface"),
      "done",
    );
    assert.strictEqual(
      assessTaskStatus("The user experience review is finished.", "UX reviews"),
      "done",
    );
    assert.strictEqual(
      assessTaskStatus("Jo: I finalised the API docs.", "Write API documentation"),
      "done",
    );
    assert.strictEqual(taskTitlesMatch("Finish the dashboard", "Complete the dashboards"), true);
    assert.strictEqual(taskTitlesMatch("Finish the dashboard", "Share the budget"), false);
  });

  it("treats partly finished work as in progress", () => {
    assert.strictEqual(
      assessTaskStatus(
        "I tested the login page, but the signup page still needs one more test.",
        "Test the login page and signup page",
      ),
      "in_progress",
    );
    assert.strictEqual(
      assessTaskStatus(
        "The login page is still pending. I have now tested the login page and the signup page.",
        "Test the login page and signup page",
      ),
      "done",
    );
  });

  it("ignores questions, requests and unrelated completions", () => {
    assert.strictEqual(
      assessTaskStatus("Did you finish the UI improvements?", "Improve user interface"),
      "pending",
    );
    assert.strictEqual(
      assessTaskStatus("Please complete the UI improvements today.", "Improve user interface"),
      "pending",
    );
    assert.strictEqual(
      assessTaskStatus("I completed the dashboard.", "Share the completed dashboard for review"),
      "pending",
    );
  });
});

describe("resolveTaskAssignee", () => {
  const participants = ["Host Person", "Remote Person"];

  it("keeps the speaker who committed to the task", () => {
    assert.strictEqual(
      resolveTaskAssignee("Remote Participant", "Host Person", participants),
      "Remote Person",
    );
    assert.strictEqual(
      resolveTaskAssignee("Remote Participant", "Host Person", [
        "Host Person",
        "Remote Participant",
      ]),
      "Remote Participant",
    );
    assert.strictEqual(
      resolveTaskAssignee("Remote Participant", "Host Person", ["Host Person", "Avery", "Blake"]),
      "Remote Participant",
    );
  });

  it("defaults to nobody only when no assignee was given", () => {
    assert.strictEqual(resolveTaskAssignee(null, "Host Person", participants), null);
    assert.strictEqual(resolveTaskAssignee("  ", "Host Person", participants), null);
    assert.strictEqual(resolveTaskAssignee("unassigned", "Host Person", participants), null);
    assert.strictEqual(resolveTaskAssignee("me", "Host Person", participants), "Host Person");
  });

  it("lists everyone on a joint commitment", () => {
    assert.strictEqual(
      resolveTaskAssignee("Host Person and Remote Participant", "Host Person", participants),
      "Host Person and Remote Person",
    );
    assert.strictEqual(
      resolveTaskAssignee("Host Person, Host Person & Avery", "Host Person", participants),
      "Host Person and Avery",
    );
  });
});
