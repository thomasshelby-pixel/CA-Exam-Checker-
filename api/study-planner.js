import {
  createStudyPlanDraft,
  getParserMetadata,
  parseStudyPlannerRequest,
} from "../lib/studyPlannerParser.js";

const MAX_MESSAGE_LENGTH = 1200;
const ALLOWED_COURSES = new Set([
  "", "CA_FOUNDATION", "CA_INTERMEDIATE", "CA_FINAL",
  "foundation", "inter", "intermediate", "final"
]);

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed." });
  }

  try {
    const body = req.body && typeof req.body === "object" ? req.body : {};
    const message = typeof body.message === "string" ? body.message.trim() : "";
    const course = typeof body.course === "string" ? body.course.trim() : "";

    if (!message) {
      return res.status(400).json({ error: "Enter your study request first." });
    }
    if (message.length > MAX_MESSAGE_LENGTH) {
      return res.status(413).json({ error: `Please keep the request under ${MAX_MESSAGE_LENGTH} characters.` });
    }
    if (!ALLOWED_COURSES.has(course)) {
      return res.status(400).json({ error: "Select a valid CA level." });
    }

    const parsed = parseStudyPlannerRequest(message, course || null);
    const plan = createStudyPlanDraft(parsed);

    let status = "request_parsed";
    let responseMessage = "Request parsed. This beta does not save class changes, study progress, or chapter priorities yet.";

    if (parsed.intent === "out_of_scope") {
      status = "unsupported_course";
      responseMessage = "CA Final is not supported by this planner beta yet. Your request was not executed.";
    } else if (parsed.intent === "clarify") {
      status = "needs_clarification";
      responseMessage = "A few details are needed before a study-plan draft can be created.";
    } else if (parsed.intent === "create_study_plan" && plan) {
      status = "plan_draft_ready";
      responseMessage = "Your draft plan is ready. It has not been saved to a student account or calendar.";
    } else if (parsed.intent === "general_guidance") {
      responseMessage = "General-guidance request recognised. This beta currently parses requests and creates study-plan drafts; it does not generate advice text.";
    } else if (parsed.intent === "prioritize_chapters") {
      responseMessage = "Priority request parsed. Chapter ranking is not calculated or saved in this beta yet.";
    } else if (parsed.intent === "update_class_schedule") {
      responseMessage = "Class-schedule details parsed. No class was changed or saved.";
    } else if (parsed.intent === "log_study_progress") {
      responseMessage = "Study-progress details parsed. No progress entry was saved.";
    }

    return res.status(200).json({
      success: true,
      status,
      message: responseMessage,
      parsed,
      plan,
      metadata: getParserMetadata(),
    });
  } catch (error) {
    console.error("STUDY PLANNER PARSE ERROR:", error);
    return res.status(500).json({ error: "Unable to process the study request right now." });
  }
}
