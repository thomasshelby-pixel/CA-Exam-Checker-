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
      subjectKey,
      testType,
      checkingMode,
      descriptiveMaximum
    } = req.body || {};

    /* ==================================================
       VALIDATION
    ================================================== */

    if (!answerSheetBase64) {
      return res.status(400).json({
        error: "Answer sheet is missing."
      });
    }

    if (!questionPaperBase64) {
      return res.status(400).json({
        error: "Question Paper is missing."
      });
    }

    if (!suggestedAnswerBase64) {
      return res.status(400).json({
        error: "Suggested Answer is missing."
      });
    }

    if (!subjectKey) {
      return res.status(400).json({
        error: "Subject is missing."
      });
    }

    if (!testType) {
      return res.status(400).json({
        error: "Test type is missing."
      });
    }

    const maximumMarks =
      Number(descriptiveMaximum);

    if (
      !Number.isFinite(maximumMarks) ||
      maximumMarks <= 0
    ) {
      return res.status(400).json({
        error: "Invalid descriptive maximum marks."
      });
    }

    if (!process.env.AI_GATEWAY_API_KEY) {
      return res.status(500).json({
        error: "AI_GATEWAY_API_KEY is not configured."
      });
    }

    /* ==================================================
       FORMAT TEST TYPE
    ================================================== */

    const formattedTestType =
      testType === "MODEL_TEST"
        ? "Model Test"
        : testType === "OTHER"
        ? "Other"
        : testType;

    /* ==================================================
       CHECKING MODE
    ================================================== */

    const checkingInstructions =
      checkingMode === "strict"
        ? `
STRICT ICAI-STYLE CHECKING:

- Be conservative with marks.
- Award marks only for demonstrated knowledge.
- Penalise wrong concepts, provisions and calculations.
- Give step marks only for genuinely correct steps.
- Missing required workings should lose marks.
- Theory must contain relevant provision/concept,
  application and conclusion where applicable.
`
        : `
MODERATE EXAMINER-STYLE CHECKING:

- Give reasonable step marking.
- Give credit for substantially correct approaches.
- Minor calculation errors may receive partial marks.
- Conceptual errors must be penalised.
- Missing essential workings should affect marks.
`;

    /* ==================================================
       PROMPT
    ================================================== */

    const prompt = `
You are an expert CA Intermediate examiner.

Evaluate the student's answer sheet against:

1. Official Question Paper
2. Official/reference Suggested Answer
3. Student Answer Sheet

The Question Paper determines:
- question numbers
- sub-parts
- marks
- question structure
- which questions are descriptive

The Suggested Answer determines:
- expected concepts
- provisions
- calculations
- workings
- conclusions
- answer requirements

Do NOT evaluate from the student's answer alone.

==================================================
EXAM INFORMATION
==================================================

SUBJECT:
${subject || subjectKey}

TEST TYPE:
${formattedTestType}

DESCRIPTIVE MAXIMUM:
${maximumMarks}

CHECKING MODE:
${checkingMode === "strict"
  ? "ICAI STRICT"
  : "MODERATE"}

${checkingInstructions}

==================================================
MANDATORY RULES
==================================================

1. Evaluate ONLY descriptive questions.

2. IGNORE ALL MCQs COMPLETELY.

3. Do not invent questions.

4. Do not invent marks.

5. Include every descriptive question present in
   the Question Paper.

6. For every descriptive question, locate the
   corresponding student answer.

7. If a question is not attempted:
   marks_awarded = 0
   status = "not_attempted"

8. If handwriting/content cannot be confidently read:
   status = "unclear"

9. Never award more than marks_available.

10. Never award negative marks.

11. Wrong final answer with substantially correct
    working can receive appropriate partial marks.

12. Wrong approach should NOT receive marks simply
    because some numbers or keywords match.

13. Theory answers must be checked for:
    - provision
    - concept
    - application
    - conclusion
    - relevant keywords

14. Practical answers must be checked for:
    - formula
    - working
    - calculations
    - adjustments
    - final answer

15. Internal choices must be handled correctly.
    Do not award marks for both alternatives when
    only one was required.

16. Remarks must specifically explain why marks
    were awarded or lost.

17. Do not give generic praise.

18. Do not reveal hidden reasoning.

==================================================
FINAL VERIFICATION
==================================================

Before returning the answer verify:

- MCQs are excluded.
- Every descriptive question is included.
- Question marks match the Question Paper.
- Each awarded mark is <= available mark.
- Total marks equal the sum of awarded marks.
- Total does not exceed ${maximumMarks}.
- Percentage is mathematically correct.

Return ONLY the requested JSON structure.
`;

    /* ==================================================
       AI REQUEST
    ================================================== */

    const aiResponse =
      await fetch(
        "https://ai-gateway.vercel.sh/v1/responses",
        {
          method: "POST",

          headers: {
            "Content-Type": "application/json",
            "Authorization":
              `Bearer ${process.env.AI_GATEWAY_API_KEY}`
          },

          body: JSON.stringify({

            model:
              "openai/gpt-5.6-sol",

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
                      `QUESTION PAPER: ${
                        questionPaperName ||
                        "question-paper.pdf"
                      }`
                  },

                  {
                    type: "input_file",

                    filename:
                      questionPaperName ||
                      "question-paper.pdf",

                    file_data:
                      `data:application/pdf;base64,${questionPaperBase64}`
                  },

                  {
                    type: "input_text",
                    text:
                      `SUGGESTED ANSWER: ${
                        suggestedAnswerName ||
                        "suggested-answer.pdf"
                      }`
                  },

                  {
                    type: "input_file",

                    filename:
                      suggestedAnswerName ||
                      "suggested-answer.pdf",

                    file_data:
                      `data:application/pdf;base64,${suggestedAnswerBase64}`
                  },

                  {
                    type: "input_text",

                    text:
                      `STUDENT ANSWER SHEET: ${
                        answerSheetName ||
                        "answer-sheet.pdf"
                      }`
                  },

                  {
                    type: "input_file",

                    filename:
                      answerSheetName ||
                      "answer-sheet.pdf",

                    file_data:
                      `data:application/pdf;base64,${answerSheetBase64}`
                  }

                ]
              }

            ],

            text: {

              format: {

                type: "json_schema",

                name:
                  "ca_exam_evaluation",

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

                        additionalProperties:
                          false

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

                  additionalProperties:
                    false
                }

              }

            }

          })
        }
      );

    /* ==================================================
       READ AI RESPONSE
    ================================================== */

    const rawResult =
      await aiResponse.json();

    if (!aiResponse.ok) {

      console.error(
        "AI GATEWAY ERROR:",
        rawResult
      );

      return res.status(
        aiResponse.status >= 400 &&
        aiResponse.status < 600
          ? aiResponse.status
          : 500
      ).json({

        error:
          "AI evaluation failed.",

        details:
          rawResult?.error?.message ||
          rawResult?.error ||
          rawResult?.message ||
          JSON.stringify(rawResult)

      });

    }

    /* ==================================================
       EXTRACT OUTPUT TEXT
    ================================================== */

    let outputText = "";

    if (
      typeof rawResult.output_text ===
      "string"
    ) {

      outputText =
        rawResult.output_text;

    }

    if (
      !outputText &&
      Array.isArray(rawResult.output)
    ) {

      for (
        const item
        of rawResult.output
      ) {

        if (
          !Array.isArray(
            item.content
          )
        ) {
          continue;
        }

        for (
          const content
          of item.content
        ) {

          if (
            typeof content.text ===
            "string"
          ) {

            outputText +=
              content.text;

          }

        }

      }

    }

    if (!outputText) {

      console.error(
        "EMPTY AI RESPONSE:",
        rawResult
      );

      return res.status(500).json({

        error:
          "AI returned an empty evaluation.",

        details:
          JSON.stringify(rawResult)

      });

    }

    /* ==================================================
       PARSE JSON
    ================================================== */

    let evaluation;

    try {

      evaluation =
        JSON.parse(
          outputText
        );

    } catch (error) {

      console.error(
        "INVALID AI JSON:",
        outputText
      );

      return res.status(500).json({

        error:
          "AI returned invalid evaluation JSON.",

        details:
          outputText.slice(0, 2000)

      });

    }

    /* ==================================================
       VALIDATE STRUCTURE
    ================================================== */

    if (
      !evaluation ||
      !Array.isArray(
        evaluation.questions
      )
    ) {

      return res.status(500).json({

        error:
          "Invalid evaluation structure."

      });

    }

    /* ==================================================
       SCORE VALIDATION
    ================================================== */

    let total = 0;

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

      if (
        !Number.isFinite(
          available
        ) ||
        available < 0
      ) {

        return res.status(500).json({

          error:
            "Invalid marks_available returned by AI."

        });

      }

      if (
        !Number.isFinite(
          awarded
        )
      ) {

        awarded = 0;

      }

      if (awarded < 0) {
        awarded = 0;
      }

      if (awarded > available) {
        awarded = available;
      }

      awarded =
        Math.round(
          awarded * 100
        ) / 100;

      question.marks_awarded =
        awarded;

      total += awarded;

    }

    total =
      Math.round(
        total * 100
      ) / 100;

    if (
      total >
      maximumMarks
    ) {

      total =
        maximumMarks;

    }

    const percentage =
      Math.round(
        (
          total /
          maximumMarks
        ) *
        10000
      ) / 100;

    evaluation.total_marks =
      total;

    evaluation.maximum_marks =
      maximumMarks;

    evaluation.percentage =
      percentage;

    /* ==================================================
       SUCCESS
    ================================================== */

    return res.status(200).json({

      success: true,

      evaluation,

      metadata: {

        subject:
          subject || "",

        subjectKey,

        testType:
          formattedTestType,

        checkingMode:
          checkingMode === "strict"
            ? "ICAI Strict"
            : "Moderate",

        descriptiveMaximum:
          maximumMarks,

        questionPaper:
          questionPaperName ||
          "question-paper.pdf",

        suggestedAnswer:
          suggestedAnswerName ||
          "suggested-answer.pdf",

        answerSheet:
          answerSheetName ||
          "answer-sheet.pdf"

      }

    });

  } catch (error) {

    console.error(
      "CHECK ROUTE ERROR:",
      error
    );

    return res.status(500).json({

      error:
        "Unable to evaluate answer sheet.",

      details:
        error?.message ||
        String(error)

    });

  }

}
