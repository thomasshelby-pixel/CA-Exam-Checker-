import { list } from "@vercel/blob";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Method not allowed",
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
      descriptiveMaximum,
    } = req.body || {};

    /* ==================================================
       VALIDATION
    ================================================== */

    if (!answerSheetBase64) {
      return res.status(400).json({
        error: "Answer sheet is required.",
      });
    }

    if (!subjectKey) {
      return res.status(400).json({
        error: "Subject is required.",
      });
    }

    if (!testType) {
      return res.status(400).json({
        error: "Test type is required.",
      });
    }

    const maximumMarks = Number(descriptiveMaximum);

    if (!Number.isFinite(maximumMarks) || maximumMarks <= 0) {
      return res.status(400).json({
        error: "Invalid descriptive maximum marks.",
      });
    }

    /* ==================================================
       ENVIRONMENT VARIABLES
    ================================================== */

    const gatewayKey = process.env.AI_GATEWAY_API_KEY;
    const blobToken = process.env.BLOB_READ_WRITE_TOKEN;

    if (!gatewayKey) {
      return res.status(500).json({
        error: "AI Gateway API key is not configured.",
        code: "MISSING_AI_GATEWAY_API_KEY",
      });
    }

    if (!blobToken) {
      return res.status(500).json({
        error: "Vercel Blob token is not configured.",
        code: "MISSING_BLOB_READ_WRITE_TOKEN",
      });
    }

    /* ==================================================
       SAFE PATH
    ================================================== */

    const safeSubject = String(subjectKey).replace(
      /[^a-zA-Z0-9_-]/g,
      "_"
    );

    const safeTestType = String(testType).replace(
      /[^a-zA-Z0-9_-]/g,
      "_"
    );

    /* ==================================================
       FIND MATERIALS
    ================================================== */

    const materialPrefix =
      `materials/${safeSubject}/${safeTestType}/`;

    const materialList = await list({
      prefix: materialPrefix,
      token: blobToken,
    });

    const blobs = materialList?.blobs || [];

    const questionPapers = blobs
      .filter((blob) =>
        String(blob.pathname).includes("/question-paper-")
      )
      .sort(
        (a, b) =>
          new Date(b.uploadedAt).getTime() -
          new Date(a.uploadedAt).getTime()
      );

    const suggestedAnswers = blobs
      .filter((blob) =>
        String(blob.pathname).includes("/suggested-answer-")
      )
      .sort(
        (a, b) =>
          new Date(b.uploadedAt).getTime() -
          new Date(a.uploadedAt).getTime()
      );

    if (!questionPapers.length) {
      return res.status(404).json({
        error:
          `No Question Paper found for ${subject || subjectKey} - ${testType}.`,
        code: "QUESTION_PAPER_NOT_FOUND",
      });
    }

    if (!suggestedAnswers.length) {
      return res.status(404).json({
        error:
          `No Suggested Answer found for ${subject || subjectKey} - ${testType}.`,
        code: "SUGGESTED_ANSWER_NOT_FOUND",
      });
    }

    const questionPaper = questionPapers[0];
    const suggestedAnswer = suggestedAnswers[0];

    /* ==================================================
       DOWNLOAD PRIVATE BLOBS
    ================================================== */

    async function downloadBlob(blob) {
      const response = await fetch(blob.url, {
        headers: {
          Authorization: `Bearer ${blobToken}`,
        },
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => "");

        throw new Error(
          `Unable to download ${blob.pathname}. ` +
          `HTTP ${response.status}. ${errorText.slice(0, 500)}`
        );
      }

      const arrayBuffer = await response.arrayBuffer();

      return Buffer.from(arrayBuffer).toString("base64");
    }

    const [questionPaperBase64, suggestedAnswerBase64] =
      await Promise.all([
        downloadBlob(questionPaper),
        downloadBlob(suggestedAnswer),
      ]);

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

    const isStrict = checkingMode === "strict";

    const checkingInstructions = isStrict
      ? `
STRICT ICAI-STYLE CHECKING:

- Be conservative with marks.
- Award marks only where the student demonstrates the required knowledge.
- Penalise wrong concepts, provisions and calculations.
- Award step marks only for genuinely correct steps.
- Missing workings should lose marks where workings are required.
- Theory answers must contain relevant provision/concept, application and conclusion.
- Do not award marks merely because the student's answer contains similar words.
`
      : `
MODERATE EXAMINER-STYLE CHECKING:

- Give reasonable step marking.
- Give credit for substantially correct approaches.
- Minor calculation errors may still receive partial marks.
- Conceptual errors must be penalised.
- Missing essential workings should affect marks.
- Do not award marks merely because the answer contains similar keywords.
`;

    /* ==================================================
       AI PROMPT
    ================================================== */

    const prompt = `
You are an expert CA Intermediate examiner.

Your task is to evaluate the student's answer sheet by comparing it
directly against BOTH:

1. The official Question Paper
2. The official/reference Suggested Answer
3. The Student Answer Sheet

The Question Paper determines:
- question numbers
- sub-parts
- marks available
- question structure
- internal choices

The Suggested Answer determines:
- expected answer
- concepts
- provisions
- calculations
- workings
- conclusions

The Student Answer Sheet determines:
- what the student actually attempted
- what is correct
- what is missing
- what is wrong
- what is unclear

==================================================
EXAM INFORMATION
==================================================

SUBJECT:
${subject || "Not specified"}

SUBJECT KEY:
${subjectKey}

TEST / PAPER TYPE:
${formattedTestType}

DESCRIPTIVE MAXIMUM:
${maximumMarks}

CHECKING MODE:
${isStrict ? "ICAI STRICT" : "MODERATE"}

${checkingInstructions}

==================================================
CORE EVALUATION RULES
==================================================

1. Evaluate ONLY descriptive questions.

2. IGNORE MCQs completely.

3. Do not invent questions.

4. Do not invent marks.

5. The Question Paper is the authority for marks available.

6. The Suggested Answer is the primary reference for expected content.

7. Compare the student's answer with the actual expected answer.

8. Give genuine partial and step marks.

9. A wrong final answer with substantially correct working may receive
   appropriate partial marks.

10. A wrong approach must NOT receive marks simply because some numbers
    or keywords happen to match.

11. Theory questions must be checked for:
    - relevant provision
    - correct concept
    - application to facts
    - conclusion
    - important required points

12. Practical questions must be checked for:
    - formula
    - working
    - calculations
    - adjustments
    - treatment
    - final answer

13. If a question is not attempted:
    marks_awarded = 0
    status = "not_attempted"

14. If handwriting/content is genuinely impossible to read:
    status = "unclear"
    marks_awarded should reflect only what can actually be established.
    Never confidently guess missing content.

15. Never award more than marks_available.

16. Never award negative marks.

17. Include every descriptive question appearing in the Question Paper.

18. Exclude all MCQs.

19. Handle internal choices correctly.

20. Do not double-count questions from internal choices.

21. Remarks must explain the actual reason for marks lost.

22. Do not give generic praise.

23. Do not reveal hidden reasoning or chain-of-thought.

24. Do not assume that an answer is correct merely because it is lengthy.

25. Do not assume that an answer is wrong merely because the wording differs
    from the Suggested Answer if the student's underlying concept is correct.

26. For alternative valid methods in practical questions, give credit when
    the method is mathematically and conceptually valid.

27. For theory questions, equivalent legally/correctly stated concepts may
    receive credit even if wording differs from the Suggested Answer.

==================================================
QUESTION MATCHING
==================================================

Before awarding marks:

A. Identify all descriptive questions in the Question Paper.
B. Identify their marks.
C. Identify internal choices.
D. Locate the corresponding student answers.
E. Compare each attempted answer with the Suggested Answer.
F. Then award marks.

Do NOT use the student's answer sheet to determine what questions exist.

==================================================
FINAL VALIDATION
==================================================

Before returning the result, verify:

- Every descriptive question is included.
- MCQs are excluded.
- Question numbers match the Question Paper.
- Marks available match the Question Paper.
- No question exceeds its available marks.
- No negative marks exist.
- Total marks are mathematically correct.
- Total does not exceed the descriptive maximum.
- Percentage is mathematically correct.

Return ONLY valid JSON matching the supplied JSON schema.
`;

    /* ==================================================
       AI REQUEST
    ================================================== */

    const aiPayload = {
      model: "openai/gpt-5.6-sol",

      reasoning: {
        effort: "high",
      },

      input: [
        {
          type: "message",
          role: "user",
          content: [
            {
              type: "input_text",
              text: prompt,
            },

            {
              type: "input_text",
              text:
                `QUESTION PAPER FILE: ${questionPaper.pathname}`,
            },

            {
              type: "input_file",
              filename:
                questionPaper.pathname
                  .split("/")
                  .pop() || "question-paper.pdf",
              file_data:
                `data:application/pdf;base64,${questionPaperBase64}`,
            },

            {
              type: "input_text",
              text:
                `SUGGESTED ANSWER FILE: ${suggestedAnswer.pathname}`,
            },

            {
              type: "input_file",
              filename:
                suggestedAnswer.pathname
                  .split("/")
                  .pop() || "suggested-answer.pdf",
              file_data:
                `data:application/pdf;base64,${suggestedAnswerBase64}`,
            },

            {
              type: "input_text",
              text:
                `STUDENT ANSWER SHEET: ${
                  answerSheetName || "answer-sheet.pdf"
                }`,
            },

            {
              type: "input_file",
              filename:
                answerSheetName || "answer-sheet.pdf",
              file_data:
                `data:application/pdf;base64,${answerSheetBase64}`,
            },
          ],
        },
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
                type: "string",
              },

              questions: {
                type: "array",

                items: {
                  type: "object",

                  properties: {
                    question_number: {
                      type: "string",
                    },

                    marks_available: {
                      type: "number",
                    },

                    marks_awarded: {
                      type: "number",
                    },

                    status: {
                      type: "string",

                      enum: [
                        "correct",
                        "partially_correct",
                        "incorrect",
                        "not_attempted",
                        "unclear",
                      ],
                    },

                    remarks: {
                      type: "string",
                    },
                  },

                  required: [
                    "question_number",
                    "marks_available",
                    "marks_awarded",
                    "status",
                    "remarks",
                  ],

                  additionalProperties: false,
                },
              },

              total_marks: {
                type: "number",
              },

              maximum_marks: {
                type: "number",
              },

              percentage: {
                type: "number",
              },
            },

            required: [
              "overall_summary",
              "questions",
              "total_marks",
              "maximum_marks",
              "percentage",
            ],

            additionalProperties: false,
          },
        },
      },
    };

    /* ==================================================
       CALL AI GATEWAY
    ================================================== */

    let aiResponse;

    try {
      aiResponse = await fetch(
        "https://ai-gateway.vercel.sh/v1/responses",
        {
          method: "POST",

          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${gatewayKey}`,
          },

          body: JSON.stringify(aiPayload),
        }
      );
    } catch (gatewayNetworkError) {
      console.error(
        "AI GATEWAY NETWORK ERROR:",
        gatewayNetworkError
      );

      return res.status(502).json({
        error: "Unable to connect to AI Gateway.",
        code: "AI_GATEWAY_NETWORK_ERROR",
        details:
          gatewayNetworkError?.message ||
          "Network request failed.",
      });
    }

    /* ==================================================
       READ AI RESPONSE SAFELY
    ================================================== */

    const responseContentType =
      aiResponse.headers.get("content-type") || "";

    let rawResult = null;
    let rawResponseText = "";

    try {
      rawResponseText = await aiResponse.text();

      if (rawResponseText) {
        try {
          rawResult = JSON.parse(rawResponseText);
        } catch {
          rawResult = null;
        }
      }
    } catch (readError) {
      console.error(
        "AI RESPONSE READ ERROR:",
        readError
      );

      return res.status(502).json({
        error: "Unable to read AI Gateway response.",
        code: "AI_GATEWAY_RESPONSE_READ_ERROR",
        details:
          readError?.message ||
          "Unable to read response.",
      });
    }

    /* ==================================================
       AI ERROR
    ================================================== */

    if (!aiResponse.ok) {
      console.error(
        "AI GATEWAY ERROR:",
        {
          status: aiResponse.status,
          statusText: aiResponse.statusText,
          contentType: responseContentType,
          body: rawResult || rawResponseText,
        }
      );

      const gatewayMessage =
        rawResult?.error?.message ||
        rawResult?.message ||
        rawResult?.error ||
        rawResponseText ||
        "Unknown AI Gateway error.";

      return res.status(502).json({
        error: "AI evaluation failed.",
        code: "AI_GATEWAY_ERROR",
        gatewayStatus: aiResponse.status,
        gatewayStatusText: aiResponse.statusText,
        details:
          typeof gatewayMessage === "string"
            ? gatewayMessage.slice(0, 3000)
            : JSON.stringify(gatewayMessage).slice(0, 3000),
      });
    }

    if (!rawResult) {
      console.error(
        "AI GATEWAY RETURNED NON-JSON SUCCESS:",
        rawResponseText
      );

      return res.status(502).json({
        error: "AI Gateway returned an invalid response.",
        code: "AI_GATEWAY_INVALID_RESPONSE",
        details: rawResponseText.slice(0, 3000),
      });
    }

    /* ==================================================
       EXTRACT OUTPUT TEXT
    ================================================== */

    let outputText = "";

    if (typeof rawResult.output_text === "string") {
      outputText = rawResult.output_text;
    }

    if (!outputText && Array.isArray(rawResult.output)) {
      for (const item of rawResult.output) {
        if (!Array.isArray(item?.content)) {
          continue;
        }

        for (const content of item.content) {
          if (typeof content?.text === "string") {
            outputText += content.text;
          }

          if (
            typeof content?.output_text === "string"
          ) {
            outputText += content.output_text;
          }
        }
      }
    }

    outputText = outputText.trim();

    if (!outputText) {
      console.error(
        "AI RETURNED EMPTY OUTPUT:",
        rawResult
      );

      return res.status(502).json({
        error: "AI returned an empty evaluation.",
        code: "AI_EMPTY_OUTPUT",
        details: JSON.stringify(rawResult).slice(0, 3000),
      });
    }

    /* ==================================================
       PARSE AI JSON
    ================================================== */

    let evaluation;

    try {
      evaluation = JSON.parse(outputText);
    } catch (parseError) {
      console.error(
        "AI JSON PARSE ERROR:",
        {
          error: parseError,
          outputText,
        }
      );

      return res.status(502).json({
        error: "AI returned invalid evaluation JSON.",
        code: "AI_INVALID_JSON",
        details: outputText.slice(0, 3000),
      });
    }

    /* ==================================================
       STRUCTURE VALIDATION
    ================================================== */

    if (
      !evaluation ||
      typeof evaluation !== "object" ||
      !Array.isArray(evaluation.questions)
    ) {
      return res.status(502).json({
        error: "Invalid evaluation structure.",
        code: "INVALID_EVALUATION_STRUCTURE",
      });
    }

    /* ==================================================
       SCORE VALIDATION
    ================================================== */

    let total = 0;

    for (const question of evaluation.questions) {
      const available = Number(
        question?.marks_available
      );

      let awarded = Number(
        question?.marks_awarded
      );

      if (!Number.isFinite(available) || available < 0) {
        return res.status(502).json({
          error: "Invalid marks returned by AI.",
          code: "INVALID_AVAILABLE_MARKS",
          question:
            question?.question_number || "unknown",
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

      question.marks_available =
        Math.round(available * 100) / 100;

      question.marks_awarded = awarded;

      total += awarded;
    }

    total =
      Math.round(total * 100) / 100;

    /* ==================================================
       MAXIMUM MARK PROTECTION
    ================================================== */

    if (total > maximumMarks) {
      total = maximumMarks;
    }

    const percentage =
      maximumMarks > 0
        ? Math.round(
            (total / maximumMarks) * 10000
          ) / 100
        : 0;

    evaluation.total_marks = total;
    evaluation.maximum_marks = maximumMarks;
    evaluation.percentage = percentage;

    /* ==================================================
       FINAL RESPONSE
    ================================================== */

    return res.status(200).json({
      success: true,

      evaluation,

      metadata: {
        subject: subject || "",
        subjectKey,
        testType: formattedTestType,

        checkingMode: isStrict
          ? "ICAI Strict"
          : "Moderate",

        descriptiveMaximum: maximumMarks,

        questionPaper:
          questionPaper.pathname,

        suggestedAnswer:
          suggestedAnswer.pathname,

        answerSheet:
          answerSheetName ||
          "answer-sheet.pdf",
      },
    });
  } catch (error) {
    console.error(
      "CHECK ERROR:",
      error
    );

    return res.status(500).json({
      error:
        "Unable to evaluate answer sheet.",

      code:
        "CHECK_HANDLER_ERROR",

      details:
        error?.message ||
        "Unknown server error.",
    });
  }
}
