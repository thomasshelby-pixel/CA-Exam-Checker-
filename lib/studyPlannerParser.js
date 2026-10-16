export const SUBJECTS = {
  CA_FOUNDATION: [
    "Accounting", "Business Laws", "Quantitative Aptitude", "Business Economics"
  ],
  CA_INTERMEDIATE: [
    "Advanced Accounting", "Corporate and Other Laws", "Taxation",
    "Cost and Management Accounting", "Auditing and Ethics",
    "Financial Management and Strategic Management"
  ]
};

export const PARSER_KEYS = [
  "intent", "course", "subjects", "duration_minutes", "focus_text",
  "date_text", "schedule_mode", "class_time_text", "performance_data",
  "missing_info", "should_call_planner"
];

const VALID_INTENTS = new Set([
  "create_study_plan", "update_class_schedule", "prioritize_chapters",
  "log_study_progress", "general_guidance", "clarify", "out_of_scope"
]);
const VALID_MODES = new Set(["none", "one_time", "weekly_recurring", "date_override"]);
const MONTHS = "January|February|March|April|May|June|July|August|September|October|November|December";

function emptyResult(course = null) {
  return {
    intent: "clarify", course, subjects: [], duration_minutes: null,
    focus_text: "", date_text: null, schedule_mode: "none",
    class_time_text: null, performance_data: [], missing_info: [],
    should_call_planner: false
  };
}

function normalizeCourse(value) {
  const v = String(value || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (["ca_foundation", "foundation", "found"].includes(v)) return "CA_FOUNDATION";
  if (["ca_intermediate", "intermediate", "inter", "ca_inter"].includes(v)) return "CA_INTERMEDIATE";
  if (["ca_final", "final"].includes(v)) return "CA_FINAL";
  return null;
}

function detectExplicitCourse(text) {
  if (/\bca\s*final\b|\bca final preparation\b/i.test(text)) return "CA_FINAL";
  if (/\bca\s*foundation\b|\bfoundation student\b|\bfoundation exam\b/i.test(text)) return "CA_FOUNDATION";
  if (/\bca\s*(?:intermediate|inter)\b|\bintermediate student\b|\bintermediate exam\b/i.test(text)) return "CA_INTERMEDIATE";
  return null;
}

function detectDateText(message) {
  const exact = message.match(new RegExp("\\b(\\d{1,2})\\s+(" + MONTHS + ")\\b", "i"));
  if (exact) return `${Number(exact[1])} ${exact[2][0].toUpperCase()}${exact[2].slice(1).toLowerCase()}`;
  if (/\btoday\b/i.test(message)) return "today";
  if (/\btomorrow\b/i.test(message)) return "tomorrow";
  if (/\bnext week\b/i.test(message)) return "next week";
  const month = message.match(new RegExp("\\b(" + MONTHS + ")\\b", "i"));
  if (month) return month[1][0].toUpperCase() + month[1].slice(1).toLowerCase();
  return null;
}

function toMinutes(hour, minute, period) {
  let h = Number(hour) % 12;
  if (String(period).toUpperCase() === "PM") h += 12;
  return h * 60 + Number(minute || 0);
}

function formatClock(hour, minute, period) {
  if (minute !== undefined && minute !== null && minute !== "") {
    return `${Number(hour)}:${String(Number(minute)).padStart(2, "0")} ${String(period).toUpperCase()}`;
  }
  return `${Number(hour)} ${String(period).toUpperCase()}`;
}

function detectTimeRange(message) {
  const match = message.match(/\b(?:from\s+)?(\d{1,2})(?::(\d{2}))?\s*(AM|PM)\s+(?:to|until|–|-)\s+(\d{1,2})(?::(\d{2}))?\s*(AM|PM)\b/i);
  if (!match) return null;
  const start = toMinutes(match[1], match[2], match[3]);
  let end = toMinutes(match[4], match[5], match[6]);
  if (end <= start) end += 24 * 60;
  return {
    duration: end - start,
    startText: formatClock(match[1], match[2], match[3]),
    endText: formatClock(match[4], match[5], match[6])
  };
}

function detectDurationMinutes(message) {
  const explicit = message.match(/\b(\d+(?:\.\d+)?)\s*-?\s*(minutes?|mins?|hours?|hrs?|hr|h)\b/i);
  if (explicit) {
    const amount = Number(explicit[1]);
    return Math.round(amount * (explicit[2].toLowerCase().startsWith("m") ? 1 : 60));
  }
  const words = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8 };
  const wordMatch = message.match(/\b(one|two|three|four|five|six|seven|eight)(?:\s*-?\s+)hours?\b/i);
  if (wordMatch) return words[wordMatch[1].toLowerCase()] * 60;
  if (/\bhalf an hour\b/i.test(message)) return 30;
  const range = detectTimeRange(message);
  return range ? range.duration : null;
}

function detectSubjectMentions(text, course) {
  text = String(text || "").toLowerCase();
  const aliases = course === "CA_FOUNDATION"
    ? [
        [/\bquantitative aptitude\b/g, "Quantitative Aptitude"],
        [/\bratio and proportion(?:s)?\b/g, "Quantitative Aptitude"],
        [/\bstatistics\b/g, "Quantitative Aptitude"],
        [/\bbusiness laws?\b/g, "Business Laws"],
        [/\bbusiness economics\b/g, "Business Economics"],
        [/\baccounting\b/g, "Accounting"]
      ]
    : course === "CA_INTERMEDIATE"
    ? [
        [/\bfinancial management and strategic management\b/g, "Financial Management and Strategic Management"],
        [/\bfinancial management\b|\bstrategic management\b|\bfm\b|\bsm\b/g, "Financial Management and Strategic Management"],
        [/\badvanced accounting\b/g, "Advanced Accounting"],
        [/\bcost and management accounting\b|\bcosting\b/g, "Cost and Management Accounting"],
        [/\bcorporate and other laws?\b|\bbusiness laws?\b|\blaw\b/g, "Corporate and Other Laws"],
        [/\bauditing and ethics\b|\bauditing\b|\baudit\b/g, "Auditing and Ethics"],
        [/\btaxation\b|\btax\b|\bgst\b/g, "Taxation"],
        [/\baccounting\b/g, "Advanced Accounting"]
      ]
    : [];

  const matches = [];
  for (const [pattern, subject] of aliases) {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(text)) !== null) {
      matches.push({ start: match.index, end: match.index + match[0].length, subject });
      if (match[0].length === 0) pattern.lastIndex++;
    }
  }
  matches.sort((a, b) => a.start - b.start || (b.end - b.start) - (a.end - a.start));

  const subjects = [];
  let occupiedUntil = -1;
  for (const match of matches) {
    if (match.start < occupiedUntil) continue;
    occupiedUntil = match.end;
    if (!subjects.includes(match.subject)) subjects.push(match.subject);
  }
  return subjects;
}

function detectDays(message) {
  const matches = message.match(/\bMonday\b|\bTuesday\b|\bWednesday\b|\bThursday\b|\bFriday\b|\bSaturday\b|\bSunday\b/gi) || [];
  return [...new Set(matches.map(day => day[0].toUpperCase() + day.slice(1).toLowerCase()))];
}

function detectPerformanceData(message, subjects) {
  const score = message.match(/\b(?:scored|score)\s+(\d{1,3})\s+out of\s+(\d{1,3})\b/i)
    || message.match(/\b(\d{1,3})\s*\/\s*(\d{1,3})\b/);
  if (!score || !subjects.length) return [];
  const value = Number(score[1]);
  const max = Number(score[2]);
  if (!Number.isFinite(value) || !Number.isFinite(max) || max <= 0 || value > max) return [];
  return [{ subject: subjects[0], score: value, max_score: max }];
}

function detectWeakTopics(message) {
  const candidates = ["Ratio and Proportion", "Statistics", "House Property", "Capital Gains", "Salary", "Marginal Costing"];
  return candidates.filter(topic => {
    const escaped = topic.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`\\b${escaped}\\b`, "i").test(message)
      && /\bweak\b|\bstruggling\b|\bdifficult\b/i.test(message);
  });
}

function detectClassTime(message) {
  const range = detectTimeRange(message);
  if (range) return range;
  const moveTo = message.match(/\bto\s+(\d{1,2})(?::(\d{2}))?\s*(AM|PM)\b/i);
  if (moveTo) return { duration: null, startText: null, endText: formatClock(moveTo[1], moveTo[2], moveTo[3]) };
  return null;
}

export function parseStudyPlannerRequest(message, selectedCourse = null) {
  const raw = String(message || "").trim();
  const text = raw.toLowerCase();
  const result = emptyResult();
  if (!raw) {
    result.missing_info = ["study goal"];
    return result;
  }

  const explicitCourse = detectExplicitCourse(raw);
  const selected = normalizeCourse(selectedCourse);
  if (explicitCourse === "CA_FINAL" || selected === "CA_FINAL") {
    result.intent = "out_of_scope";
    result.course = "CA_FINAL";
    return result;
  }
  if (explicitCourse && selected && explicitCourse !== selected) {
    result.course = explicitCourse;
    result.missing_info = ["confirm the selected CA course"];
    return result;
  }

  const course = explicitCourse || selected;
  result.course = course;
  result.date_text = detectDateText(raw);
  result.duration_minutes = detectDurationMinutes(raw);
  result.subjects = detectSubjectMentions(raw, course);

  const weakTopics = detectWeakTopics(raw);
  if (weakTopics.length) result.focus_text = weakTopics.map(topic => `weak chapter: ${topic}`).join("; ");

  const invalidFoundationMatch = course === "CA_FOUNDATION"
    ? raw.match(/\b(Costing|GST|Taxation|Audit|Auditing|Advanced Accounting)\b/i)
    : null;
  if (invalidFoundationMatch) {
    result.subjects = [];
    result.focus_text = invalidFoundationMatch[1];
  }

  const classMention = /\bclass(?:es)?\b/i.test(raw);
  const recurringDay = /\bevery\s+(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\b/i.test(raw);
  const classAction = /\b(schedule|move|reschedule|change|put my|set up|add)\b/i.test(raw);
  const classRequest = classMention && (classAction || recurringDay);
  const negativePlan = /\b(?:don't|do not|without)\b.{0,70}\b(?:create|make|need|want)\b.{0,35}\b(?:timetable|study schedule|study plan)\b/i.test(raw);
  const generalAdvice = /\bgeneral advice\b|\bspaced revision\b/i.test(raw) && (negativePlan || /\bgeneral advice\b/i.test(raw));
  const progressRequest = /\b(log|record|track|save)\b.{0,40}\b(progress|study time|revision)\b/i.test(raw);
  const revisionAction = /\b(study|studying|revision|revise|review|timetable|study plan|study schedule|plan my study|plan my revision)\b/i.test(raw);
  const priorityAction = /\b(prioriti[sz]e|rank my|which subject should i revise first|what should i study first)\b/i.test(raw);

  const classTime = classRequest ? detectClassTime(raw) : null;

  if (classRequest) {
    result.intent = "update_class_schedule";
    if (/\b(move|reschedule|change)\b/i.test(raw) && result.date_text) {
      result.schedule_mode = "date_override";
      if (classTime?.endText) result.class_time_text = classTime.endText;
    } else if (recurringDay && classTime?.startText && classTime?.endText) {
      result.schedule_mode = "weekly_recurring";
      result.class_time_text = `${detectDays(raw).join(" and ")}, ${classTime.startText} to ${classTime.endText}`;
      result.duration_minutes = classTime.duration;
    }
    if (!course || !SUBJECTS[course]) result.missing_info.push("CA course");
    if (!result.subjects.length) result.missing_info.push("class subject");
    if (!result.class_time_text || result.schedule_mode === "none") result.missing_info.push("class days and time");
    result.should_call_planner = Boolean(course && SUBJECTS[course] && result.subjects.length && result.class_time_text && result.schedule_mode !== "none");
    if (!result.should_call_planner) result.intent = "clarify";
    return result;
  }

  if (generalAdvice && !progressRequest) {
    result.intent = "general_guidance";
    result.subjects = [];
    return result;
  }

  if (progressRequest) {
    result.intent = "log_study_progress";
    if (!course || !SUBJECTS[course]) result.missing_info.push("CA course");
    if (!result.subjects.length) result.missing_info.push("subject");
    if (!result.duration_minutes) result.missing_info.push("study duration");
    result.should_call_planner = result.missing_info.length === 0;
    if (!result.should_call_planner) result.intent = "clarify";
    return result;
  }

  if (priorityAction) {
    result.intent = "prioritize_chapters";
    result.performance_data = detectPerformanceData(raw, result.subjects);
    if (!course || !SUBJECTS[course]) result.missing_info.push("CA course");
    if (!result.subjects.length) result.missing_info.push("subject");
    if (!result.performance_data.length && !result.focus_text) result.missing_info.push("mock score or self-assessed weak chapters");
    result.should_call_planner = result.missing_info.length === 0;
    if (!result.should_call_planner) result.intent = "clarify";
    return result;
  }

  if (negativePlan && generalAdvice) {
    result.intent = "general_guidance";
    result.subjects = [];
    return result;
  }

  if (revisionAction || /\bplan\b/i.test(raw)) {
    if (!course || !SUBJECTS[course]) {
      result.missing_info = ["CA course", "subject or study goal"];
      return result;
    }
    if (invalidFoundationMatch) {
      result.missing_info = ["a valid CA Foundation subject"];
      return result;
    }
    if (!result.subjects.length) {
      result.missing_info = ["subject or study goal"];
      return result;
    }
    if (!result.duration_minutes) {
      result.schedule_mode = result.date_text ? "one_time" : "none";
      result.missing_info = ["available study time"];
      return result;
    }
    result.intent = "create_study_plan";
    result.schedule_mode = "one_time";
    result.missing_info = [];
    result.should_call_planner = true;
    return result;
  }

  result.intent = "clarify";
  if (!course) result.missing_info.push("CA course");
  if (!result.subjects.length) result.missing_info.push("subject or study goal");
  return result;
}

function splitMinutes(total, count) {
  const base = Math.floor(total / count);
  const remainder = total % count;
  return Array.from({ length: count }, (_, i) => base + (i < remainder ? 1 : 0));
}

export function createStudyPlanDraft(parsed) {
  if (!parsed || parsed.intent !== "create_study_plan" || parsed.should_call_planner !== true
    || !Number.isInteger(parsed.duration_minutes) || parsed.duration_minutes <= 0
    || !Array.isArray(parsed.subjects) || parsed.subjects.length === 0) return null;

  const subjectMinutes = splitMinutes(parsed.duration_minutes, parsed.subjects.length);
  const sessions = [];
  let order = 1;

  parsed.subjects.forEach((subject, index) => {
    const total = subjectMinutes[index];
    const concept = Math.floor(total * 0.5);
    const practice = Math.floor(total / 3);
    const recall = total - concept - practice;
    const activities = [
      { label: "Concept review and theory", minutes: concept, instruction: `Review key concepts and class notes for ${subject}.` },
      { label: "Practice questions", minutes: practice, instruction: `Solve relevant module and practice questions for ${subject}.` },
      { label: "Active recall and recap", minutes: recall, instruction: `Recall key rules, formulas, provisions and summaries for ${subject}.` }
    ];
    for (const activity of activities) {
      if (activity.minutes <= 0) continue;
      sessions.push({ order: order++, subject, ...activity });
    }
  });

  return {
    title: parsed.date_text ? `Study plan for ${parsed.date_text}` : "Study plan draft",
    total_minutes: parsed.duration_minutes,
    subjects: parsed.subjects,
    sessions,
    saved: false,
    note: "Draft only. This plan has not been saved to a student account or calendar."
  };
}

export function getParserMetadata() {
  return {
    version: "1.0.0",
    supportedCourses: ["CA_FOUNDATION", "CA_INTERMEDIATE"],
    modelUsed: false,
    persistentStorage: false
  };
}
