import { list } from "@vercel/blob";

export default async function handler(req, res) {

  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Method not allowed"
    });
  }

  try {

    const {
      answerSheetUrl,
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

    if (!answerSheetUrl) {
      return res.status(400).json({
        error: "Uploaded answer sheet URL is required."
      });
    }

    if (!subjectKey) {
      return res.status(400).json({
        error: "Subject is required."
      });
    }

    if (!testType) {
      return res.status(400).json({
        error: "Test type is required."
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
        error: "AI Gateway API key is not configured."
      });
    }

    if (!process.env.BLOB_READ_WRITE_TOKEN) {
      return res.status(500).json({
        error: "Vercel Blob token is not configured."
      });
    }

    /* ==================================================
       SAFE PATH
    ================================================== */

    const safeSubject =
      String(subjectKey)
        .replace(/[^a-zA-Z0-9_-]/g, "_");

    const safeTestType =
      String(testType)
        .replace(/[^a-zA-Z0-9_-]/g, "_");

    /* ==================================================
       FIND TEST MATERIAL
    ================================================== */

    const materialPrefix =
      `materials/${safeSubject}/${safeTestType}/`;

    const materialList =
      await list({
        prefix: materialPrefix,
        token:
          process.env.BLOB_READ_WRITE_TOKEN
      });

    const blobs =
      materialList.blobs || [];

    const questionPapers =
      blobs
        .filter(blob =>
          blob.pathname.includes(
            "/question-paper-"
          )
        )
        .sort(
          (a, b) =>
            new Date(b.uploadedAt) -
            new Date(a.uploadedAt)
        );

    const suggestedAnswers =
      blobs
        .filter(blob =>
          blob.pathname.includes(
            "/suggested-answer-"
          )
        )
        .sort(
          (a, b) =>
            new Date(b.uploadedAt) -
            new Date(a.uploadedAt)
        );

    if (!questionPapers.length) {

      return res.status(404).json({
        error:
          `No Question Paper found for ${subject} - ${testType}.`
      });

    }

    if (!suggestedAnswers.length) {

      return res.status(404).json({
        error:
          `No Suggested Answer found for ${subject} - ${testType}.`
      });

    }

    const questionPaper =
      questionPapers[0];

    const suggestedAnswer =
      suggestedAnswers[0];

    /* ==================================================
       DOWNLOAD BLOBS SERVER-SIDE
       IMPORTANT:
       These files are NOT sent through the browser
       to /api/check.
    ================================================== */

    async function downloadBlob(blobUrl) {

      const response =
        await fetch(
          blobUrl,
          {
            headers: {
              Authorization:
                `Bearer ${process.env.BLOB_READ_WRITE_TOKEN}`
            }
          }
        );

      if (!response.ok) {

        throw new Error(
          `Unable to download blob: ${response.status}`
        );

      }

      const arrayBuffer =
        await response.arrayBuffer();

      return Buffer
        .from(arrayBuffer)
        .toString("base64");

    }

    /* ==================================================
       DOWNLOAD QUESTION PAPER
    ================================================== */

    const questionPaperBase64 =
      await downloadBlob(
        questionPaper.url
      );

    /* ==================================================
       DOWNLOAD SUGGESTED ANSWER
    ================================================== */

    const suggestedAnswerBase64 =
      await downloadBlob(
        suggestedAnswer.url
      );

    /* ==================================================
       DOWNLOAD STUDENT ANSWER SHEET
       FROM URL STORED AFTER UPLOAD
    ================================================== */

    const answerSheetBase64 =
      await downloadBlob(
        answerSheetUrl
      );

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
- Award marks only where the student demonstrates the required knowledge.
- Penalise wrong concepts, provisions and calculations.
- Give step marks only for genuinely correct steps.
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

1. The official Question Paper
2. The official/reference Suggested Answer
3. The Student Answer Sheet

Do not evaluate from the student's answer alone.

First identify the descriptive questions from the Question Paper.

Then locate the student's corresponding answers.

Then compare those answers with the Suggested Answer.

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
${checkingMode === "strict"
  ? "ICAI STRICT"
  : "MODERATE"}

${checkingInstructions}

==================================================
IMPORTANT RULES
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

7. Compare the student's answer directly.

8. Give genuine partial/step marks.

9. Wrong final answer with substantially correct working may receive
   appropriate partial marks.

10. Wrong approach should not receive marks merely for containing
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

14. Unclear handwriting:
    status = "unclear"
    Do not confidently guess.

15. Never award more than marks_available.

16. Never award negative marks.

17. Include every descriptive question found.

18. Exclude MCQs.

19. Handle internal choices carefully.

20. Remarks must explain actual lost marks.

21. Do not give generic praise.

22. Do not reveal hidden reasoning.

==================================================
FINAL CHECK
==================================================

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

    /* ==================================================
       AI REQUEST
    ================================================== */

    const aiResponse =
      await fetch(
        "https://ai-gateway.vercel.sh/v1/responses",
        {
          method: "POST",

          headers: {
            "Content-Type":
              "application/json",

            Authorization:
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
                      `QUESTION PAPER: ${questionPaper.pathname}`
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
                    type: "input_text",

                    text:
                      `SUGGESTED ANSWER: ${suggestedAnswer.pathname}`
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
                    type: "input_text",

                    text:
                      `STUDENT ANSWER SHEET: ${answerSheetName || "answer-sheet.pdf"}`
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
       READ AI RESPONSE SAFELY
    ================================================== */

    const responseText =
      await aiResponse.text();

    let rawResult;

    try {

      rawResult =
        JSON.parse(
          responseText
        );

    } catch {

      console.error(
        "AI Gateway returned non-JSON:",
        responseText.slice(0, 2000)
      );

      return res.status(502).json({

        error:
          "AI Gateway returned an invalid response.",

        details:
          responseText.slice(0, 500)

      });

    }

    /* ==================================================
       AI ERROR
    ================================================== */

    if (!aiResponse.ok) {

      console.error(
        "AI Gateway error:",
        rawResult
      );

      return res.status(
        aiResponse.status >= 400 &&
        aiResponse.status < 600
          ? aiResponse.status
          : 500
      ).json({

        error:
          rawResult?.error?.message ||
          rawResult?.message ||
          "AI evaluation failed."

      });

    }

    /* ==================================================
       EXTRACT OUTPUT
    ================================================== */

    let outputText = "";

    if (
      typeof rawResult.output_text ===
      "string"
    ) {

      outputText =
        rawResult.output_text;

    }

    else if (
      Array.isArray(
        rawResult.output
      )
    ) {

      for (
        const item
        of rawResult.output
      ) {

        if (
          !Array.isArray(
            item.content
          )
        ) continue;

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

      return res.status(502).json({
        error:
          "AI returned an empty evaluation."
      });

    }

    /* ==================================================
       PARSE AI JSON
    ================================================== */

    let evaluation;

    try {

      evaluation =
        JSON.parse(
          outputText
        );

    } catch {

      console.error(
        "Invalid AI evaluation JSON:",
        outputText
      );

      return res.status(502).json({
        error:
          "AI returned invalid evaluation format."
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

      return res.status(502).json({
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

        return res.status(502).json({
          error:
            "Invalid marks returned by AI."
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

      if (
        awarded >
        available
      ) {

        awarded =
          available;

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
       FINAL RESPONSE
    ================================================== */

    return res.status(200).json({

      success: true,

      evaluation,

      metadata: {

        subject,

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

        answerSheet:
          answerSheetName ||
          "answer-sheet.pdf"

      }

    });

  }

  catch (error) {

    console.error(
      "CHECK ERROR:",
      error
    );

    return res.status(500).json({

      error:
        "Unable to evaluate answer sheet.",

      details:
        error?.message ||
        "Unknown server error"

    });

  }

}
