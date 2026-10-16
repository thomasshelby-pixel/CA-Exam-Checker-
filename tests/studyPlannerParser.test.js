import test from "node:test";
import assert from "node:assert/strict";
import { parseStudyPlannerRequest, createStudyPlanDraft, PARSER_KEYS } from "../lib/studyPlannerParser.js";

const cases = [
  {
    name: "Foundation study plan with explicit course",
    message: "I'm a CA Foundation student. Give me 60 minutes of Accounting revision tomorrow.",
    course: null,
    expected: { intent: "create_study_plan", course: "CA_FOUNDATION", subjects: ["Accounting"], duration_minutes: 60, date_text: "tomorrow", schedule_mode: "one_time", should_call_planner: true }
  },
  {
    name: "Foundation course selected in UI",
    message: "Set up a 45-minute Business Economics timetable for today.",
    course: "CA_FOUNDATION",
    expected: { intent: "create_study_plan", course: "CA_FOUNDATION", subjects: ["Business Economics"], duration_minutes: 45, date_text: "today", schedule_mode: "one_time", should_call_planner: true }
  },
  {
    name: "GST maps to Intermediate Taxation",
    message: "I'd like 1.5 hours of GST revision today.",
    course: "CA_INTERMEDIATE",
    expected: { intent: "create_study_plan", course: "CA_INTERMEDIATE", subjects: ["Taxation"], duration_minutes: 90, date_text: "today", should_call_planner: true }
  },
  {
    name: "Multiple subjects remain in message order",
    message: "Make a 2-hour study plan for Taxation and Advanced Accounting tomorrow.",
    course: "CA_INTERMEDIATE",
    expected: { intent: "create_study_plan", subjects: ["Taxation", "Advanced Accounting"], duration_minutes: 120, date_text: "tomorrow", should_call_planner: true }
  },
  {
    name: "Recurring class schedule",
    message: "Put my Taxation class every Monday from 6 PM to 7 PM.",
    course: "CA_INTERMEDIATE",
    expected: { intent: "update_class_schedule", subjects: ["Taxation"], duration_minutes: 60, schedule_mode: "weekly_recurring", class_time_text: "Monday, 6 PM to 7 PM", should_call_planner: true }
  },
  {
    name: "Two day recurring class schedule",
    message: "Schedule Taxation classes every Tuesday and Thursday from 6 PM to 7:30 PM.",
    course: "CA_INTERMEDIATE",
    expected: { intent: "update_class_schedule", subjects: ["Taxation"], duration_minutes: 90, schedule_mode: "weekly_recurring", class_time_text: "Tuesday and Thursday, 6 PM to 7:30 PM", should_call_planner: true }
  },
  {
    name: "Date override",
    message: "Move my Advanced Accounting class on 27 October to 8 PM.",
    course: "CA_INTERMEDIATE",
    expected: { intent: "update_class_schedule", subjects: ["Advanced Accounting"], date_text: "27 October", schedule_mode: "date_override", class_time_text: "8 PM", should_call_planner: true }
  },
  {
    name: "Unsupported Foundation subject safely clarifies",
    message: "Create a 60-minute Costing revision plan tomorrow.",
    course: "CA_FOUNDATION",
    expected: { intent: "clarify", subjects: [], duration_minutes: 60, focus_text: "Costing", should_call_planner: false }
  },
  {
    name: "Missing level and subject clarifies",
    message: "Please plan my study for tomorrow. I can study for two hours.",
    course: null,
    expected: { intent: "clarify", course: null, duration_minutes: 120, date_text: "tomorrow", should_call_planner: false }
  },
  {
    name: "CA Final is out of scope",
    message: "I'm preparing for CA Final. Create a three-hour Audit revision plan.",
    course: null,
    expected: { intent: "out_of_scope", course: "CA_FINAL", should_call_planner: false }
  },
  {
    name: "General advice doesn't create a plan",
    message: "I'm a CA Intermediate student. Give me general advice on spaced revision, but don't create a timetable.",
    course: null,
    expected: { intent: "general_guidance", course: "CA_INTERMEDIATE", should_call_planner: false }
  },
  {
    name: "Mock slash format",
    message: "I scored 35/50 in my Taxation mock. Please prioritise revision.",
    course: "CA_INTERMEDIATE",
    expected: { intent: "prioritize_chapters", subjects: ["Taxation"], performance_data: [{ subject: "Taxation", score: 35, max_score: 50 }], should_call_planner: true }
  },
  {
    name: "Study progress request parses but isn't saved here",
    message: "I revised Accounting for one hour. Log my progress.",
    course: "CA_FOUNDATION",
    expected: { intent: "log_study_progress", subjects: ["Accounting"], duration_minutes: 60, should_call_planner: true }
  },
  {
    name: "Conflicting course selection clarifies",
    message: "I'm a CA Intermediate student. Make a 60-minute Taxation revision plan.",
    course: "CA_FOUNDATION",
    expected: { intent: "clarify", course: "CA_INTERMEDIATE", should_call_planner: false }
  }
];

for (const item of cases) {
  test(item.name, () => {
    const actual = parseStudyPlannerRequest(item.message, item.course);
    assert.deepEqual(Object.keys(actual).sort(), [...PARSER_KEYS].sort());
    for (const [key, value] of Object.entries(item.expected)) {
      assert.deepEqual(actual[key], value, `${key} mismatch`);
    }
    if (["clarify", "out_of_scope", "general_guidance"].includes(actual.intent)) {
      assert.equal(actual.should_call_planner, false);
    }
  });
}

test("Study plan draft allocations sum to requested duration and are not persisted", () => {
  const parsed = parseStudyPlannerRequest(
    "Make a 2-hour study plan for Taxation and Advanced Accounting tomorrow.",
    "CA_INTERMEDIATE"
  );
  const plan = createStudyPlanDraft(parsed);
  assert.ok(plan);
  assert.equal(plan.sessions.reduce((sum, s) => sum + s.minutes, 0), 120);
  assert.equal(plan.saved, false);
});
