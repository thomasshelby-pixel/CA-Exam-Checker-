export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Method not allowed"
    });
  }

  try {
    const {
      answerSheetBase64,
      answerSheetName,
      questionPaperBase64,
      questionPaperName,
      suggestedAnswerBase64,
      suggestedAnswerName,
      subject,
      testType,
      checkingMode,
      descriptiveMaximum
    } = req.body || {};

    /* ==================================================
       VALIDATION
    ================================================== */

    if (
      !answerSheetBase64 ||
      !questionPaperBase64 ||
      !suggestedAnswerBase64
    ) {
      return res.status(400).json({
        error:
          "Answer sheet, question paper and suggested answer are required."
      });
    }

    if (!subject) {
      return res.status(400).json({
        error: "Subject is required."
      });
    }

    if (!testType) {
      return res.status(400).json({
        error: "Test type is required."
      });
    }

    const maximumMarks = Number(descriptiveMaximum);

    if (!Number.isFinite(maximumMarks) || maximumMarks <= 0) {
      return res.status(400).json({
        error: "Invalid descriptive maximum marks."
      });
    }

    if (!process.env.AI_GATEWAY_API_KEY) {
      return res.status(500).json({
        error: "AI Gateway API key is not configured."
      });
    }

    /* ==================================================
       TEST TYPE
    ================================================== */

    const formattedTestType =
      testType === "MODEL_TEST"
        ? "Model Test"
        : testType === "OTHER"
        ? "Other"
        : testType;

    /* ==================================================
       CHECKING STANDARD
    ================================================== */

    const checkingInstructions =
      checkingMode === "strict"
        ? `
STRICT ICAI-STYLE CHECKING:

- Be conservative with marks.
- Award marks only where the student has actually demonstrated the required knowledge.
- Penalise wrong concepts, wrong provisions, wrong calculations and unsupported conclusions.
- Give step marks only for genuinely correct steps.
- Do not give marks merely for writing more.
- Missing working notes should lose marks where workings are required.
- For theory questions, check provision/concept + application + conclusion.
`
        : `
MODERATE EXAMINER-STYLE CHECKING:

- Give reasonable step marking.
- Award credit for substantially correct approaches even if a minor error affects the final answer.
- Still penalise conceptual mistakes.
- Do not award marks simply because an answer is lengthy.
- Missing essential workings should still affect marks.
`;

    /* ==================================================
       MAIN EXAMINER PROMPT
    ================================================== */

    const prompt = `
You are an expert CA Intermediate examiner.

Your job is to evaluate a student's answer sheet against the supplied:

1. Official Question Paper
2. Official / Reference Suggested Answer
3. Student Answer Sheet

Do NOT evaluate the answer sheet from the student's writing alone.

First identify the questions from the Question Paper.

Then locate the student's corresponding answer.

Then compare it with the Suggested Answer and the requirements of the Question Paper.

==================================================
EXAM INFORMATION
==================================================

SUBJECT:
${subject}

TEST / PAPER TYPE:
${formattedTestType}

DESCRIPTIVE MAXIMUM:
${maximumMarks}

CHECKING MODE:
${checkingMode === "strict" ? "ICAI STRICT" : "MODERATE"}

${checkingInstructions}

==================================================
IMPORTANT RULES
==================================================

1. Evaluate ONLY descriptive questions.

2. IGNORE ALL MCQs completely.
   Do not include MCQ marks in the descriptive total.

3. Do not invent questions.

4. Do not invent marks.

5. Use the Question Paper as the authority for:
   - question numbers
   - sub-parts
   - marks available
   - whether a question is descriptive

6. Use the Suggested Answer as the main reference for:
   - expected answer
   - calculations
   - provisions
   - concepts
   - working notes
   - conclusions

7. Compare the student's answer directly with the expected answer.

8. Give partial / step marks only when the student's work genuinely deserves them.

9. If the final answer is wrong but the working is substantially correct,
   award appropriate partial marks.

10. If the approach is wrong, do not award marks merely because some
    numbers or keywords happen to appear.

11. For theory answers:
    Check:
    - relevant provision
    - legal/accounting/tax concept
    - application
    - conclusion
    - important keywords

12. For practical questions:
    Check:
    - formula
    - working
    - calculation
    - adjustments
    - final answer

13. If a question is not attempted:
    marks_awarded = 0
    status = "not_attempted"

14. If the student's answer is unreadable or genuinely ambiguous:
    status = "unclear"
    Do not confidently invent what the student intended.

15. Never award more than marks_available.

16. Never award negative marks.

17. The sum of all question marks must equal total_marks.

18. total_marks must never exceed ${maximumMarks}.

19. maximum_marks MUST be ${maximumMarks}.

20. percentage must be calculated as:

   total_marks / maximum_marks * 100

   Round percentage to TWO decimal places.

21. Include every descriptive question found in the Question Paper,
   including unanswered descriptive questions.

22. Do not include MCQs.

23. If the Question Paper contains internal choices, do not penalise the
   student for not answering a question that was an optional alternative.
   Identify the question structure carefully.

24. If a question has sub-parts, you may represent it as:
   Q1(a), Q1(b), Q1(c), etc.

25. Remarks must be concise but useful to the student.
   Mention the actual reason for lost marks.

26. Do not provide generic praise.

27. Do not fabricate examiner comments.

28. Do not reveal hidden reasoning or chain-of-thought.

==================================================
FINAL QUALITY CHECK
==================================================

Before returning the JSON:

- Verify every question against the Question Paper.
- Verify marks available.
- Verify awarded marks.
- Verify unanswered questions.
- Verify MCQs are excluded.
- Verify total_marks mathematically.
- Verify percentage mathematically.
- Verify total_marks <= ${maximumMarks}.

Return ONLY the requested JSON.
`;

    /* ==================================================
       AI REQUEST
    ================================================== */

    const response = await fetch(
      "https://ai-gateway.vercel.sh/v1/responses",
      {
        method: "POST",

        headers: {
          "Content-Type": "application/json",
          Authorization:
            `Bearer ${process.env.AI_GATEWAY_API_KEY}`
        },

        body: JSON.stringify({
          model: "openai/gpt-5.6-sol",

          reasoning: {
            effort: "high"
          },

          input: [
            {
              type: "message",
              role: "user",

              content: [

                {
                  type: "input_text",
                  text: prompt
                },

                {
                  type: "input_text",
                  text:
                    `QUESTION PAPER FILE: ${questionPaperName}`
                },

                {
                  type: "input_file",
                  filename: questionPaperName || "question-paper.pdf",
                  file_data:
                    `data:application/pdf;base64,${questionPaperBase64}`
                },

                {
                  type: "input_text",
                  text:
                    `SUGGESTED ANSWER FILE: ${suggestedAnswerName}`
                },

                {
                  type: "input_file",
                  filename: suggestedAnswerName || "suggested-answer.pdf",
                  file_data:
                    `data:application/pdf;base64,${suggestedAnswerBase64}`
                },

                {
                  type: "input_text",
                  text:
                    `STUDENT ANSWER SHEET: ${answerSheetName}`
                },

                {
                  type: "input_file",
                  filename: answerSheetName || "answer-sheet.pdf",
                  file_data:
                    `data:application/pdf;base64,${answerSheetBase64}`
                }

              ]
            }
          ],

          text: {
            format: {
              type: "json_schema",

              name: "ca_exam_evaluation",

              strict: true,

              schema: {

                type: "object",

                properties: {

                  overall_summary: {
                    type: "string"
                  },

                  questions: {

                    type: "array",

                    items: {

                      type: "object",

                      properties: {

                        question_number: {
                          type: "string"
                        },

                        marks_available: {
                          type: "number"
                        },

                        marks_awarded: {
                          type: "number"
                        },

                        status: {

                          type: "string",

                          enum: [
                            "correct",
                            "partially_correct",
                            "incorrect",
                            "not_attempted",
                            "unclear"
                          ]

                        },

                        remarks: {
                          type: "string"
                        }

                      },

                      required: [
                        "question_number",
                        "marks_available",
                        "marks_awarded",
                        "status",
                        "remarks"
                      ],

                      additionalProperties: false

                    }

                  },

                  total_marks: {
                    type: "number"
                  },

                  maximum_marks: {
                    type: "number"
                  },

                  percentage: {
                    type: "number"
                  }

                },

                required: [
                  "overall_summary",
                  "questions",
                  "total_marks",
                  "maximum_marks",
                  "percentage"
                ],

                additionalProperties: false

              }

            }
          }
        })
      }
    );

    /* ==================================================
       READ AI RESPONSE
    ================================================== */

    const rawResult = await response.json();

    if (!response.ok) {

      console.error(
        "AI Gateway error:",
        rawResult
      );

      return res.status(500).json({
        error: "AI evaluation failed.",
        details:
          rawResult?.error?.message ||
          rawResult?.message ||
          "Unknown AI Gateway error."
      });

    }

    /* ==================================================
       EXTRACT OUTPUT TEXT
    ================================================== */

    let outputText = "";

    if (typeof rawResult.output_text === "string") {

      outputText =
        rawResult.output_text;

    } else if (Array.isArray(rawResult.output)) {

      for (
        const outputItem
        of rawResult.output
      ) {

        if (
          !Array.isArray(
            outputItem.content
          )
        ) {
          continue;
        }

        for (
          const contentItem
          of outputItem.content
        ) {

          if (
            typeof contentItem.text ===
            "string"
          ) {

            outputText +=
              contentItem.text;

          }

        }

      }

    }

    if (!outputText) {

      console.error(
        "AI response contained no text:",
        rawResult
      );

      return res.status(500).json({
        error:
          "AI returned an empty evaluation."
      });

    }

    /* ==================================================
       PARSE JSON
    ================================================== */

    let evaluation;

    try {

      evaluation =
        JSON.parse(outputText);

    } catch (error) {

      console.error(
        "Invalid AI JSON:",
        outputText
      );

      return res.status(500).json({
        error:
          "AI returned invalid evaluation format."
      });

    }

    /* ==================================================
       SERVER-SIDE SCORE VALIDATION
    ================================================== */

    if (
      !evaluation ||
      !Array.isArray(
        evaluation.questions
      )
    ) {

      return res.status(500).json({
        error:
          "AI evaluation structure is invalid."
      });

    }

    let calculatedTotal = 0;

    for (
      const question
      of evaluation.questions
    ) {

      const available =
        Number(
          question.marks_available
        );

      let awarded =
        Number(
          question.marks_awarded
        );

      if (!Number.isFinite(available)) {
        return res.status(500).json({
          error:
            "Invalid marks_available returned by AI."
        });
      }

      if (!Number.isFinite(awarded)) {
        awarded = 0;
      }

      /* Never allow negative marks. */

      if (awarded < 0) {
        awarded = 0;
      }

      /* Never allow more than question maximum. */

      if (awarded > available) {
        awarded = available;
      }

      /* Round to 2 decimals. */

      awarded =
        Math.round(
          awarded * 100
        ) / 100;

      question.marks_awarded =
        awarded;

      calculatedTotal +=
        awarded;

    }

    calculatedTotal =
      Math.round(
        calculatedTotal * 100
      ) / 100;

    /* Hard cap against descriptive maximum. */

    if (
      calculatedTotal >
      maximumMarks
    ) {

      calculatedTotal =
        maximumMarks;

    }

    const calculatedPercentage =
      Math.round(
        (
          calculatedTotal /
          maximumMarks
        ) *
        10000
      ) / 100;

    evaluation.total_marks =
      calculatedTotal;

    evaluation.maximum_marks =
      maximumMarks;

    evaluation.percentage =
      calculatedPercentage;

    /* ==================================================
       RETURN FINAL RESULT
    ================================================== */

    return res.status(200).json({

      success: true,

      evaluation,

      metadata: {

        subject,

        testType:
          formattedTestType,

        checkingMode:
          checkingMode === "strict"
            ? "ICAI Strict"
            : "Moderate",

        descriptiveMaximum:
          maximumMarks,

        questionPaper:
          questionPaperName,

        suggestedAnswer:
          suggestedAnswerName,

        answerSheet:
          answerSheetName

      }

    });

  } catch (error) {

    console.error(
      "CHECK ERROR:",
      error
    );

    return res.status(500).json({
      error:
        "Unable to evaluate answer sheet.",
      details:
        error?.message || "Unknown error"
    });

  }
}
