import { list } from "@vercel/blob";

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
      subject,
      subjectKey,
      testType,
      checkingMode,
      descriptiveMaximum
    } = req.body || {};

    // -----------------------------
    // VALIDATION
    // -----------------------------

    if (!answerSheetBase64) {
      return res.status(400).json({
        error: "Answer sheet is missing."
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

    const maximumMarks = Number(descriptiveMaximum);

    if (!Number.isFinite(maximumMarks) || maximumMarks <= 0) {
      return res.status(400).json({
        error: "Invalid descriptive maximum marks."
      });
    }

    if (!process.env.AI_GATEWAY_API_KEY) {
      return res.status(500).json({
        error: "AI_GATEWAY_API_KEY is not configured."
      });
    }

    if (!process.env.BLOB_READ_WRITE_TOKEN) {
      return res.status(500).json({
        error: "BLOB_READ_WRITE_TOKEN is not configured."
      });
    }

    // -----------------------------
    // MATERIAL PATH
    // -----------------------------

    const safeSubject = String(subjectKey)
      .replace(/[^a-zA-Z0-9_-]/g, "_");

    const safeTestType = String(testType)
      .replace(/[^a-zA-Z0-9_-]/g, "_");

    const materialPrefix =
      `materials/${safeSubject}/${safeTestType}/`;

    // -----------------------------
    // FIND MATERIALS
    // -----------------------------

    const materialList = await list({
      prefix: materialPrefix,
      token: process.env.BLOB_READ_WRITE_TOKEN
    });

    const blobs = materialList?.blobs || [];

    console.log("CHECK MATERIAL PREFIX:", materialPrefix);
    console.log(
      "CHECK FOUND FILES:",
      blobs.map(b => b.pathname)
    );

    const questionPapers = blobs
      .filter(blob =>
        blob.pathname.toLowerCase().includes("/question-paper-")
      )
      .sort(
        (a, b) =>
          new Date(b.uploadedAt) -
          new Date(a.uploadedAt)
      );

    const suggestedAnswers = blobs
      .filter(blob =>
        blob.pathname.toLowerCase().includes("/suggested-answer-")
      )
      .sort(
        (a, b) =>
          new Date(b.uploadedAt) -
          new Date(a.uploadedAt)
      );

    if (!questionPapers.length) {
      return res.status(404).json({
        error: "Question Paper is missing.",
        details:
          `No Question Paper found inside ${materialPrefix}`,
        availableFiles:
          blobs.map(blob => blob.pathname)
      });
    }

    if (!suggestedAnswers.length) {
      return res.status(404).json({
        error: "Suggested Answer is missing.",
        details:
          `No Suggested Answer found inside ${materialPrefix}`,
        availableFiles:
          blobs.map(blob => blob.pathname)
      });
    }

    const questionPaper = questionPapers[0];
    const suggestedAnswer = suggestedAnswers[0];

    console.log(
      "USING QUESTION PAPER:",
      questionPaper.pathname
    );

    console.log(
      "USING SUGGESTED ANSWER:",
      suggestedAnswer.pathname
    );

    // -----------------------------
    // DOWNLOAD BLOB
    // -----------------------------

    async function downloadBlob(blob) {
      const response = await fetch(blob.url, {
        headers: {
          Authorization:
            `Bearer ${process.env.BLOB_READ_WRITE_TOKEN}`
        }
      });

      if (!response.ok) {
        throw new Error(
          `Unable to download ${blob.pathname}. HTTP ${response.status}`
        );
      }

      const buffer = Buffer.from(
        await response.arrayBuffer()
      );

      return buffer.toString("base64");
    }

    const questionPaperBase64 =
      await downloadBlob(questionPaper);

    const suggestedAnswerBase64 =
      await downloadBlob(suggestedAnswer);

    // -----------------------------
    // TEST TYPE
    // -----------------------------

    const formattedTestType =
      testType === "MODEL_TEST"
        ? "Model Test"
        : testType === "OTHER"
        ? "Other"
        : testType;

    // -----------------------------
    // CHECKING MODE
    // -----------------------------

    const checkingInstructions =
      checkingMode === "strict"
        ? `
STRICT ICAI-STYLE CHECKING:

- Be conservative with marks.
- Award marks only for demonstrated knowledge.
- Penalise wrong concepts, provisions and calculations.
- Give step marks only for genuinely correct steps.
- Missing workings should lose marks where relevant.
- For theory, check provision, concept, application and conclusion.
`
        : `
MODERATE EXAMINER-STYLE CHECKING:

- Give reasonable step marking.
- Give credit for substantially correct approaches.
- Minor calculation errors may receive partial marks.
- Conceptual errors must be penalised.
- Missing essential workings should affect marks.
`;

    // -----------------------------
    // PROMPT
    // -----------------------------

    const prompt = `
You are an expert CA Intermediate examiner.

Evaluate the student's answer sheet against:

1. Official Question Paper
2. Official/reference Suggested Answer
3. Student Answer Sheet

You MUST use the Question Paper and Suggested Answer.

First identify every descriptive question from the Question Paper.

Then locate the corresponding student answers.

Then compare each answer directly with the Suggested Answer.

========================================
EXAM INFORMATION
========================================

SUBJECT:
${subject}

TEST TYPE:
${formattedTestType}

DESCRIPTIVE MAXIMUM:
${maximumMarks}

CHECKING MODE:
${checkingMode === "strict"
  ? "ICAI STRICT"
  : "MODERATE"}

${checkingInstructions}

========================================
IMPORTANT RULES
========================================

1. Evaluate ONLY descriptive questions.

2. IGNORE MCQs completely.

3. Do not invent questions.

4. Do not invent marks.

5. Question Paper is authoritative for:
   - question numbers
   - sub-parts
   - marks
   - question structure

6. Suggested Answer is the main reference for:
   - expected answer
   - calculations
   - provisions
   - concepts
   - workings
   - conclusions

7. Compare the student's answer directly.

8. Give genuine partial/step marks.

9. Wrong final answer with substantially correct working
   may receive appropriate partial marks.

10. Wrong approach should not receive marks merely
    for containing similar numbers or keywords.

11. Theory questions must be checked for:
    - relevant provision
    - concept
    - application
    - conclusion
    - important keywords

12. Practical questions must be checked for:
    - formula
    - working
    - calculations
    - adjustments
    - final answer

13. Unattempted:
    marks_awarded = 0
    status = "not_attempted"

14. Unclear handwriting:
    status = "unclear"

15. Never award more than marks_available.

16. Never award negative marks.

17. Include every descriptive question.

18. Exclude MCQs.

19. Handle internal choices carefully.

20. Remarks must explain actual lost marks.

21. Do not give generic praise.

22. Do not reveal hidden reasoning.

========================================
FINAL CHECK
========================================

Verify:

- Every descriptive question is included.
- MCQs are excluded.
- Marks available are correct.
- Awarded marks are correct.
- Total marks are mathematically correct.
- Total does not exceed ${maximumMarks}.
- Percentage is mathematically correct.

Return ONLY valid JSON.
`;

    // -----------------------------
    // AI GATEWAY
    // -----------------------------

    const aiResponse = await fetch(
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
              role: "user",

              content: [
                {
                  type: "input_text",
                  text: prompt
                },

                {
                  type: "input_file",

                  filename:
                    questionPaper.pathname
                      .split("/")
                      .pop(),

                  file_data:
                    `data:application/pdf;base64,${questionPaperBase64}`
                },

                {
                  type: "input_file",

                  filename:
                    suggestedAnswer.pathname
                      .split("/")
                      .pop(),

                  file_data:
                    `data:application/pdf;base64,${suggestedAnswerBase64}`
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

    // -----------------------------
    // READ AI RESPONSE
    // -----------------------------

    const rawResult = await aiResponse.json();

    console.log(
      "AI STATUS:",
      aiResponse.status
    );

    console.log(
      "AI RESPONSE:",
      JSON.stringify(rawResult).slice(0, 5000)
    );

    if (!aiResponse.ok) {
      return res.status(aiResponse.status).json({
        error: "AI evaluation failed.",
        details:
          rawResult?.error?.message ||
          rawResult?.error ||
          rawResult?.message ||
          JSON.stringify(rawResult)
      });
    }

    // -----------------------------
    // EXTRACT OUTPUT
    // -----------------------------

    let outputText = "";

    if (
      typeof rawResult.output_text === "string"
    ) {
      outputText = rawResult.output_text;
    }

    if (
      !outputText &&
      Array.isArray(rawResult.output)
    ) {
      for (const item of rawResult.output) {
        if (!Array.isArray(item.content)) {
          continue;
        }

        for (const content of item.content) {
          if (
            typeof content.text === "string"
          ) {
            outputText += content.text;
          }
        }
      }
    }

    if (!outputText) {
      return res.status(500).json({
        error: "AI returned an empty evaluation.",
        details:
          JSON.stringify(rawResult).slice(0, 5000)
      });
    }

    // -----------------------------
    // PARSE JSON
    // -----------------------------

    let evaluation;

    try {
      evaluation = JSON.parse(outputText);
    } catch (error) {
      console.error(
        "JSON PARSE ERROR:",
        outputText
      );

      return res.status(500).json({
        error: "AI returned invalid JSON.",
        details:
          outputText.slice(0, 5000)
      });
    }

    // -----------------------------
    // VALIDATE
    // -----------------------------

    if (
      !evaluation ||
      !Array.isArray(evaluation.questions)
    ) {
      return res.status(500).json({
        error:
          "Invalid evaluation structure."
      });
    }

    // -----------------------------
    // CALCULATE SCORE SERVER-SIDE
    // -----------------------------

    let total = 0;

    for (
      const question
      of evaluation.questions
    ) {
      const available =
        Number(question.marks_available);

      let awarded =
        Number(question.marks_awarded);

      if (
        !Number.isFinite(available) ||
        available < 0
      ) {
        return res.status(500).json({
          error:
            "Invalid marks returned by AI."
        });
      }

      if (!Number.isFinite(awarded)) {
        awarded = 0;
      }

      if (awarded < 0) {
        awarded = 0;
      }

      if (awarded > available) {
        awarded = available;
      }

      awarded =
        Math.round(awarded * 100) / 100;

      question.marks_awarded = awarded;

      total += awarded;
    }

    total =
      Math.round(total * 100) / 100;

    if (total > maximumMarks) {
      total = maximumMarks;
    }

    const percentage =
      Math.round(
        (total / maximumMarks) * 10000
      ) / 100;

    evaluation.total_marks = total;
    evaluation.maximum_marks = maximumMarks;
    evaluation.percentage = percentage;

    // -----------------------------
    // SUCCESS
    // -----------------------------

    return res.status(200).json({
      success: true,

      evaluation,

      metadata: {
        subject,
        subjectKey,
        testType: formattedTestType,

        checkingMode:
          checkingMode === "strict"
            ? "ICAI Strict"
            : "Moderate",

        descriptiveMaximum:
          maximumMarks,

        questionPaper:
          questionPaper.pathname,

        suggestedAnswer:
          suggestedAnswer.pathname,

        answerSheet:
          answerSheetName ||
          "answer-sheet.pdf"
      }
    });

  } catch (error) {
    console.error(
      "CHECK FATAL ERROR:",
      error
    );

    return res.status(500).json({
      error:
        "Unable to evaluate answer sheet.",

      details:
        error?.message ||
        "Unknown error"
    });
  }
}
