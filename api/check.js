import { list } from "@vercel/blob";

export default async function handler(req, res) {
  /*
   * ALWAYS RETURN JSON
   */
  res.setHeader("Content-Type", "application/json");

  if (req.method !== "POST") {
    return res.status(405).json({
      success: false,
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

    /* ==================================================
       VALIDATION
    ================================================== */

    if (!answerSheetBase64) {
      return res.status(400).json({
        success: false,
        error: "Answer sheet is required."
      });
    }

    if (!subjectKey) {
      return res.status(400).json({
        success: false,
        error: "Subject is required."
      });
    }

    if (!testType) {
      return res.status(400).json({
        success: false,
        error: "Test type is required."
      });
    }

    const maximumMarks = Number(descriptiveMaximum);

    if (!Number.isFinite(maximumMarks) || maximumMarks <= 0) {
      return res.status(400).json({
        success: false,
        error: "Invalid descriptive maximum marks."
      });
    }

    /*
     * IMPORTANT:
     * Support BOTH names so your existing Vercel variable
     * AI_Gateway_API_KEY also works.
     */
    const AI_KEY =
      process.env.AI_GATEWAY_API_KEY ||
      process.env.AI_Gateway_API_KEY;

    const BLOB_TOKEN =
      process.env.BLOB_READ_WRITE_TOKEN ||
      process.env.BLOB_READ_WRITE_TOKEN;

    if (!AI_KEY) {
      return res.status(500).json({
        success: false,
        error:
          "AI Gateway API key is not configured. Add AI_GATEWAY_API_KEY in Vercel Environment Variables."
      });
    }

    if (!BLOB_TOKEN) {
      return res.status(500).json({
        success: false,
        error:
          "Vercel Blob token is not configured."
      });
    }

    /* ==================================================
       SAFE PATH
    ================================================== */

    const safeSubject = String(subjectKey)
      .replace(/[^a-zA-Z0-9_-]/g, "_");

    const safeTestType = String(testType)
      .replace(/[^a-zA-Z0-9_-]/g, "_");

    /* ==================================================
       FIND MATERIALS
    ================================================== */

    const materialPrefix =
      `materials/${safeSubject}/${safeTestType}/`;

    const materialList = await list({
      prefix: materialPrefix,
      token: BLOB_TOKEN
    });

    const blobs = Array.isArray(materialList?.blobs)
      ? materialList.blobs
      : [];

    const questionPapers = blobs
      .filter((blob) =>
        String(blob.pathname).includes("/question-paper-")
      )
      .sort(
        (a, b) =>
          new Date(b.uploadedAt || 0) -
          new Date(a.uploadedAt || 0)
      );

    const suggestedAnswers = blobs
      .filter((blob) =>
        String(blob.pathname).includes("/suggested-answer-")
      )
      .sort(
        (a, b) =>
          new Date(b.uploadedAt || 0) -
          new Date(a.uploadedAt || 0)
      );

    if (!questionPapers.length) {
      return res.status(404).json({
        success: false,
        error:
          `No Question Paper found for ${subject || subjectKey} - ${testType}.`
      });
    }

    if (!suggestedAnswers.length) {
      return res.status(404).json({
        success: false,
        error:
          `No Suggested Answer found for ${subject || subjectKey} - ${testType}.`
      });
    }

    const questionPaper = questionPapers[0];
    const suggestedAnswer = suggestedAnswers[0];

    /* ==================================================
       DOWNLOAD PRIVATE BLOBS
    ================================================== */

    async function downloadBlob(blob) {
      if (!blob?.url) {
        throw new Error(
          `Blob URL missing for ${blob?.pathname || "unknown file"}`
        );
      }

      const response = await fetch(blob.url, {
        headers: {
          Authorization: `Bearer ${BLOB_TOKEN}`
        }
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => "");

        throw new Error(
          `Unable to download ${blob.pathname}. HTTP ${response.status}. ${errorText.slice(0, 300)}`
        );
      }

      const arrayBuffer = await response.arrayBuffer();

      return Buffer.from(arrayBuffer).toString("base64");
    }

    const questionPaperBase64 =
      await downloadBlob(questionPaper);

    const suggestedAnswerBase64 =
      await downloadBlob(suggestedAnswer);

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
       CHECKING MODE
    ================================================== */

    const checkingInstructions =
      checkingMode === "strict"
        ? `
STRICT ICAI-STYLE CHECKING:

- Be conservative with marks.
- Award marks only where the student demonstrates the required knowledge.
- Penalise wrong concepts, provisions and calculations.
- Award step marks only for genuinely correct steps.
- Missing workings should lose marks where required.
- For theory, check provision/concept, application and conclusion.
`
        : `
MODERATE EXAMINER-STYLE CHECKING:

- Give reasonable step marking.
- Give credit for substantially correct approaches.
- Minor calculation errors may still receive partial marks.
- Conceptual errors must be penalised.
- Missing essential workings should affect marks.
`;

    /* ==================================================
       AI PROMPT
    ================================================== */

    const prompt = `
You are an expert CA Intermediate examiner.

Evaluate the student's answer sheet against:

1. Official Question Paper
2. Official/reference Suggested Answer
3. Student Answer Sheet

DO NOT evaluate the student answer independently.

First identify ALL descriptive questions from the Question Paper.

Then locate the student's corresponding answers.

Then compare each answer with the Suggested Answer.

==================================================
EXAM INFORMATION
==================================================

SUBJECT:
${subject || subjectKey}

TEST / PAPER TYPE:
${formattedTestType}

DESCRIPTIVE MAXIMUM:
${maximumMarks}

CHECKING MODE:
${checkingMode === "strict"
  ? "ICAI STRICT"
  : "MODERATE"}

${checkingInstructions}

==================================================
CORE RULES
==================================================

1. Evaluate ONLY descriptive questions.

2. IGNORE MCQs completely.

3. Do not invent questions.

4. Do not invent marks.

5. Question Paper is the authority for:
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

7. Compare the student's answer directly against the expected answer.

8. Award genuine partial and step marks.

9. A wrong final answer with substantially correct working may receive
   appropriate partial marks.

10. A wrong approach must NOT receive marks merely because it contains
    similar numbers or keywords.

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

13. Unattempted question:
    marks_awarded = 0
    status = "not_attempted"

14. If handwriting/content cannot be reliably understood:
    status = "unclear"
    Do NOT confidently guess.

15. Never award more than marks_available.

16. Never award negative marks.

17. Include every descriptive question found in the Question Paper.

18. Exclude MCQs.

19. Handle internal choices carefully.
    Only evaluate questions actually attempted by the student.
    Do not penalise an unselected internal choice.

20. Remarks must explain actual marks lost.

21. Do not give generic praise.

22. Do not reveal hidden reasoning.

==================================================
IMPORTANT MARKING
==================================================

Marks must be awarded question-by-question.

For each question:
marks_awarded <= marks_available

The sum of marks_awarded must equal total_marks.

Do NOT artificially force the student to receive the maximum.

==================================================
FINAL VERIFICATION
==================================================

Before returning JSON verify:

- Every descriptive question is included.
- MCQs are excluded.
- Question numbers are correct.
- Marks available are correct.
- Awarded marks are correct.
- Total marks are mathematically correct.
- Total does not exceed ${maximumMarks}.
- Percentage is mathematically correct.

Return ONLY valid JSON.
`;

    /* ==================================================
       AI REQUEST
    ================================================== */

    const aiResponse = await fetch(
      "https://ai-gateway.vercel.sh/v1/responses",
      {
        method: "POST",

        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${AI_KEY}`
        },

        body: JSON.stringify({
          model: "openai/gpt-5.6-sol",

          reasoning: {
            effort: "high"
          },

          max_output_tokens: 16000,

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
                    `QUESTION PAPER FILE: ${questionPaper.pathname}`
                },

                {
                  type: "input_file",

                  filename:
                    questionPaper.pathname
                      .split("/")
                      .pop() || "question-paper.pdf",

                  file_data:
                    `data:application/pdf;base64,${questionPaperBase64}`
                },

                {
                  type: "input_text",
                  text:
                    `SUGGESTED ANSWER FILE: ${suggestedAnswer.pathname}`
                },

                {
                  type: "input_file",

                  filename:
                    suggestedAnswer.pathname
                      .split("/")
                      .pop() || "suggested-answer.pdf",

                  file_data:
                    `data:application/pdf;base64,${suggestedAnswerBase64}`
                },

                {
                  type: "input_text",

                  text:
                    `STUDENT ANSWER SHEET: ${answerSheetName || "answer-sheet.pdf"}`
                },

                {
                  type: "input_file",

                  filename:
                    answerSheetName || "answer-sheet.pdf",

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
       READ AI RESPONSE SAFELY
    ================================================== */

    const responseText =
      await aiResponse.text();

    let rawResult = null;

    try {
      rawResult = responseText
        ? JSON.parse(responseText)
        : null;
    } catch {
      console.error(
        "AI Gateway returned non-JSON:",
        responseText?.slice(0, 2000)
      );

      return res.status(502).json({
        success: false,
        error:
          "AI Gateway returned an invalid response.",
        details:
          responseText?.slice(0, 1000) ||
          "Empty response"
      });
    }

    /* ==================================================
       AI HTTP ERROR
    ================================================== */

    if (!aiResponse.ok) {
      console.error(
        "AI Gateway HTTP error:",
        aiResponse.status,
        rawResult
      );

      return res.status(502).json({
        success: false,
        error:
          "AI evaluation failed.",
        details:
          rawResult?.error?.message ||
          rawResult?.message ||
          `AI Gateway HTTP ${aiResponse.status}`
      });
    }

    /* ==================================================
       EXTRACT OUTPUT TEXT
    ================================================== */

    let outputText = "";

    if (
      typeof rawResult?.output_text === "string"
    ) {
      outputText =
        rawResult.output_text.trim();
    }

    if (
      !outputText &&
      Array.isArray(rawResult?.output)
    ) {
      for (const item of rawResult.output) {
        if (!Array.isArray(item?.content)) {
          continue;
        }

        for (const content of item.content) {
          if (
            typeof content?.text === "string"
          ) {
            outputText += content.text;
          }
        }
      }

      outputText =
        outputText.trim();
    }

    /*
     * Some Responses API responses may expose
     * the structured JSON in output content.
     */
    if (!outputText && rawResult?.output) {
      try {
        const possibleJson =
          JSON.stringify(rawResult.output);

        if (
          possibleJson &&
          possibleJson !== "[]"
        ) {
          const match =
            possibleJson.match(
              /\{[\s\S]*\}/
            );

          if (match) {
            outputText =
              match[0];
          }
        }
      } catch {}
    }

    if (!outputText) {
      console.error(
        "Empty AI output:",
        JSON.stringify(rawResult).slice(0, 5000)
      );

      return res.status(502).json({
        success: false,
        error:
          "AI returned an empty evaluation."
      });
    }

    /* ==================================================
       PARSE EVALUATION JSON
    ================================================== */

    let evaluation;

    try {
      evaluation =
        JSON.parse(outputText);
    } catch {
      /*
       * Remove accidental markdown fences if model
       * ever returns them.
       */
      try {
        const cleaned =
          outputText
            .replace(/^```json\s*/i, "")
            .replace(/^```\s*/i, "")
            .replace(/\s*```$/i, "")
            .trim();

        evaluation =
          JSON.parse(cleaned);
      } catch {
        console.error(
          "Invalid AI JSON:",
          outputText.slice(0, 5000)
        );

        return res.status(502).json({
          success: false,
          error:
            "AI returned invalid evaluation format.",
          details:
            outputText.slice(0, 1000)
        });
      }
    }

    /* ==================================================
       STRUCTURE VALIDATION
    ================================================== */

    if (
      !evaluation ||
      !Array.isArray(
        evaluation.questions
      )
    ) {
      return res.status(502).json({
        success: false,
        error:
          "AI returned an invalid evaluation structure."
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
      let available =
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
        available = 0;
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

      question.marks_available =
        available;

      question.marks_awarded =
        awarded;

      total += awarded;
    }

    total =
      Math.round(
        total * 100
      ) / 100;

    /*
     * Never allow total above declared maximum.
     */
    if (total > maximumMarks) {
      total = maximumMarks;
    }

    const percentage =
      Math.round(
        (total / maximumMarks) *
          10000
      ) / 100;

    evaluation.total_marks =
      total;

    evaluation.maximum_marks =
      maximumMarks;

    evaluation.percentage =
      percentage;

    /* ==================================================
       FINAL RESPONSE
    ================================================== */

    return res.status(200).json({
      success: true,

      evaluation,

      metadata: {
        subject:
          subject || subjectKey,

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
          questionPaper.pathname,

        suggestedAnswer:
          suggestedAnswer.pathname,

   
