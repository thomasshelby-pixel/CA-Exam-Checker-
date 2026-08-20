import { list } from "@vercel/blob";

/*
===========================================================
CA EXAM CHECKER
FINAL CHECK API
===========================================================

IMPORTANT ENV VARIABLES:

AI_GATEWAY_API_KEY
BLOB_READ_WRITE_TOKEN

This code also accepts:
AI_Gateway_API_KEY

as a compatibility fallback.
*/

export default async function handler(req, res) {

  if (req.method !== "POST") {
    return res.status(405).json({
      success: false,
      error: "Method not allowed"
    });
  }

  try {

    /* =====================================================
       ENVIRONMENT
    ===================================================== */

    const AI_GATEWAY_KEY =
      process.env.AI_GATEWAY_API_KEY ||
      process.env.AI_Gateway_API_KEY ||
      process.env.VERCEL_OIDC_TOKEN;

    const BLOB_TOKEN =
      process.env.BLOB_READ_WRITE_TOKEN;

    if (!AI_GATEWAY_KEY) {

      return res.status(500).json({
        success: false,
        error: "AI Gateway API key is not configured.",
        hint:
          "Add AI_GATEWAY_API_KEY in Vercel Environment Variables and redeploy."
      });

    }

    if (!BLOB_TOKEN) {

      return res.status(500).json({
        success: false,
        error: "Vercel Blob token is not configured.",
        hint:
          "Add BLOB_READ_WRITE_TOKEN in Vercel Environment Variables."
      });

    }

    /* =====================================================
       REQUEST DATA
    ===================================================== */

    const {
      answerSheetBase64,
      answerSheetName,
      subject,
      subjectKey,
      testType,
      checkingMode,
      descriptiveMaximum
    } = req.body || {};

    /* =====================================================
       VALIDATION
    ===================================================== */

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

    const maximumMarks =
      Number(descriptiveMaximum);

    if (
      !Number.isFinite(maximumMarks) ||
      maximumMarks <= 0
    ) {

      return res.status(400).json({
        success: false,
        error: "Invalid descriptive maximum marks."
      });

    }

    /* =====================================================
       BASE64 NORMALIZER
    ===================================================== */

    function cleanBase64(value) {

      if (
        typeof value !== "string"
      ) {
        return "";
      }

      return value
        .replace(
          /^data:application\/pdf;base64,/i,
          ""
        )
        .replace(
          /^data:.*?;base64,/i,
          ""
        )
        .replace(/\s/g, "");

    }

    const studentPDF =
      cleanBase64(
        answerSheetBase64
      );

    if (!studentPDF) {

      return res.status(400).json({
        success: false,
        error: "Invalid answer sheet PDF data."
      });

    }

    /* =====================================================
       SAFE PATH
    ===================================================== */

    const safeSubject =
      String(subjectKey)
        .replace(
          /[^a-zA-Z0-9_-]/g,
          "_"
        );

    const safeTestType =
      String(testType)
        .replace(
          /[^a-zA-Z0-9_-]/g,
          "_"
        );

    /* =====================================================
       FIND MATERIALS
    ===================================================== */

    const materialPrefix =
      `materials/${safeSubject}/${safeTestType}/`;

    console.log(
      "Searching materials:",
      materialPrefix
    );

    const materialList =
      await list({
        prefix: materialPrefix,
        token: BLOB_TOKEN
      });

    const blobs =
      Array.isArray(
        materialList?.blobs
      )
        ? materialList.blobs
        : [];

    /* =====================================================
       QUESTION PAPERS
    ===================================================== */

    const questionPapers =
      blobs
        .filter(
          blob =>
            blob?.pathname &&
            blob.pathname.includes(
              "/question-paper-"
            )
        )
        .sort(
          (a, b) =>
            new Date(
              b.uploadedAt || 0
            ) -
            new Date(
              a.uploadedAt || 0
            )
        );

    /* =====================================================
       SUGGESTED ANSWERS
    ===================================================== */

    const suggestedAnswers =
      blobs
        .filter(
          blob =>
            blob?.pathname &&
            blob.pathname.includes(
              "/suggested-answer-"
            )
        )
        .sort(
          (a, b) =>
            new Date(
              b.uploadedAt || 0
            ) -
            new Date(
              a.uploadedAt || 0
            )
        );

    if (
      !questionPapers.length
    ) {

      return res.status(404).json({
        success: false,
        error:
          `No Question Paper found for ${subject} - ${testType}.`,
        prefix: materialPrefix
      });

    }

    if (
      !suggestedAnswers.length
    ) {

      return res.status(404).json({
        success: false,
        error:
          `No Suggested Answer found for ${subject} - ${testType}.`,
        prefix: materialPrefix
      });

    }

    const questionPaper =
      questionPapers[0];

    const suggestedAnswer =
      suggestedAnswers[0];

    console.log(
      "Question Paper:",
      questionPaper.pathname
    );

    console.log(
      "Suggested Answer:",
      suggestedAnswer.pathname
    );

    /* =====================================================
       DOWNLOAD PRIVATE BLOB
    ===================================================== */

    async function downloadBlob(blob) {

      const response =
        await fetch(
          blob.url,
          {
            method: "GET",
            headers: {
              Authorization:
                `Bearer ${BLOB_TOKEN}`
            }
          }
        );

      if (!response.ok) {

        const errorText =
          await response
            .text()
            .catch(
              () => ""
            );

        throw new Error(
          `Unable to download ${blob.pathname}. HTTP ${response.status}. ${errorText}`
        );

      }

      const arrayBuffer =
        await response.arrayBuffer();

      return Buffer
        .from(arrayBuffer)
        .toString("base64");

    }

    /* =====================================================
       DOWNLOAD BOTH MATERIALS
    ===================================================== */

    const questionPaperBase64 =
      await downloadBlob(
        questionPaper
      );

    const suggestedAnswerBase64 =
      await downloadBlob(
        suggestedAnswer
      );

    /* =====================================================
       TEST TYPE
    ===================================================== */

    let formattedTestType =
      testType;

    if (
      testType === "MODEL_TEST"
    ) {

      formattedTestType =
        "Model Test";

    } else if (
      testType === "OTHER"
    ) {

      formattedTestType =
        "Other";

    }

    /* =====================================================
       CHECKING MODE
    ===================================================== */

    const isStrict =
      checkingMode === "strict";

    const checkingInstructions =
      isStrict

        ? `
STRICT ICAI-STYLE CHECKING

- Be conservative with marks.
- Award marks only for demonstrated knowledge.
- Penalise wrong concepts, provisions and calculations.
- Award step marks only for genuinely correct steps.
- Missing workings should lose marks where required.
- Theory must contain the relevant provision/concept.
- Application and conclusion must be checked.
- Do not award marks merely because keywords appear.
`

        : `
MODERATE EXAMINER-STYLE CHECKING

- Give reasonable step marking.
- Give credit for substantially correct approaches.
- Minor calculation errors may receive partial marks.
- Major conceptual errors must be penalised.
- Missing essential workings should affect marks.
- Theory should receive marks according to correctness and completeness.
`;

    /* =====================================================
       MAIN AI PROMPT
    ===================================================== */

    const prompt = `
You are an expert CA Intermediate examiner.

Your job is to evaluate a student's answer sheet.

You have THREE documents:

1. Official Question Paper
2. Official / Reference Suggested Answer
3. Student Answer Sheet

The Question Paper determines:
- question numbers
- sub-parts
- marks
- question structure
- internal choices

The Suggested Answer determines:
- expected concepts
- provisions
- calculations
- workings
- conclusions
- answer approach

The Student Answer Sheet determines:
- what the student actually attempted
- what is correct
- what is wrong
- what is missing
- what is unclear

==================================================
EXAM INFORMATION
==================================================

SUBJECT:
${subject}

TEST TYPE:
${formattedTestType}

DESCRIPTIVE MAXIMUM:
${maximumMarks}

CHECKING MODE:
${isStrict ? "ICAI STRICT" : "MODERATE"}

${checkingInstructions}

==================================================
CORE RULES
==================================================

1. Evaluate ONLY descriptive questions.

2. IGNORE ALL MCQs.

3. Do NOT invent questions.

4. Do NOT invent marks.

5. Use the Question Paper as the authority for marks.

6. Use the Suggested Answer as the main reference answer.

7. Match the student's answer with the correct question.

8. Do not assume an answer belongs to a question merely because it
   appears on the same page.

9. Give genuine partial marks.

10. A wrong final answer may receive partial marks if the working/
    reasoning is substantially correct.

11. A correct final number with an incorrect method must NOT receive
    full marks.

12. Wrong approach must be penalised.

13. Similar keywords alone do NOT justify marks.

14. Theory questions must be checked for:
    - relevant provision
    - concept
    - application
    - conclusion
    - important points/keywords

15. Practical questions must be checked for:
    - formula
    - working
    - adjustments
    - calculations
    - final answer

16. Unattempted question:
    marks_awarded = 0
    status = "not_attempted"

17. If handwriting/content is genuinely unreadable:
    status = "unclear"
    Do not guess.

18. Never award more than marks_available.

19. Never award negative marks.

20. Include every descriptive question.

21. Exclude MCQs completely.

22. Handle internal choices correctly.

23. Do not double-count answers from internal choices.

24. Remarks must explain the actual reason for lost marks.

25. Do not provide generic praise.

26. Do not reveal hidden reasoning or chain-of-thought.

==================================================
SCORING
==================================================

For every descriptive question return:

question_number
marks_available
marks_awarded
status
remarks

Allowed status values:

correct
partially_correct
incorrect
not_attempted
unclear

==================================================
FINAL VALIDATION
==================================================

Before returning the answer verify:

- Every descriptive question is included.
- MCQs are excluded.
- Internal choices are handled correctly.
- Marks available match the Question Paper.
- Marks awarded are correct.
- No question exceeds its available marks.
- Total marks are mathematically correct.
- Total marks do not exceed ${maximumMarks}.
- Percentage is mathematically correct.

Return ONLY JSON matching the supplied schema.
`;

    /* =====================================================
       FILE HELPERS
    ===================================================== */

    function pdfData(
      base64,
      filename
    ) {

      return {
        type: "input_file",
        filename:
          filename || "document.pdf",
        file_data:
          `data:application/pdf;base64,${base64}`
      };

    }

    /* =====================================================
       AI REQUEST FUNCTION
    ===================================================== */

    async function callAI(
      model
    ) {

      console.log(
        "Calling AI Gateway:",
        model
      );

      const response =
        await fetch(
          "https://ai-gateway.vercel.sh/v1/responses",
          {
            method: "POST",

            headers: {
              "Content-Type":
                "application/json",

              Authorization:
                `Bearer ${AI_GATEWAY_KEY}`
            },

            body:
              JSON.stringify({

                model,

                reasoning: {
                  effort: "medium"
                },

                max_output_tokens:
                  16000,

                input: [

                  {
                    type: "message",

                    role: "user",

                    content: [

                      {
                        type:
                          "input_text",

                        text:
                          prompt
                      },

                      {
                        type:
                          "input_text",

                        text:
                          `OFFICIAL QUESTION PAPER: ${questionPaper.pathname}`
                      },

                      pdfData(
                        questionPaperBase64,
                        questionPaper.pathname
                          .split("/")
                          .pop()
                      ),

                      {
                        type:
                          "input_text",

                        text:
                          `OFFICIAL SUGGESTED ANSWER: ${suggestedAnswer.pathname}`
                      },

                      pdfData(
                        suggestedAnswerBase64,
                        suggestedAnswer.pathname
                          .split("/")
                          .pop()
                      ),

                      {
                        type:
                          "input_text",

                        text:
                          `STUDENT ANSWER SHEET: ${answerSheetName || "answer-sheet.pdf"}`
                      },

                      pdfData(
                        studentPDF,
                        answerSheetName ||
                          "answer-sheet.pdf"
                      )

                    ]
                  }

                ],

                text: {

                  format: {

                    type:
                      "json_schema",

                    name:
                      "ca_exam_evaluation",

                    strict:
                      true,

                    schema: {

                      type:
                        "object",

                      properties: {

                        overall_summary: {
                          type:
                            "string"
                        },

                        questions: {

                          type:
                            "array",

                          items: {

                            type:
                              "object",

                            properties: {

                              question_number: {
                                type:
                                  "string"
                              },

                              marks_available: {
                                type:
                                  "number"
                              },

                              marks_awarded: {
                                type:
                                  "number"
                              },

                              status: {

                                type:
                                  "string",

                                enum: [
                                  "correct",
                                  "partially_correct",
                                  "incorrect",
                                  "not_attempted",
                                  "unclear"
                                ]

                              },

                              remarks: {
                                type:
                                  "string"
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
                          type:
                            "number"
                        },

                        maximum_marks: {
                          type:
                            "number"
                        },

                        percentage: {
                          type:
                            "number"
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

      const rawText =
        await response.text();

      let rawResult;

      try {

        rawResult =
          JSON.parse(
            rawText
          );

      } catch {

        rawResult = {
          raw_text:
            rawText
        };

      }

      if (!response.ok) {

        console.error(
          "AI GATEWAY FAILED",
          {
            status:
              response.status,

            statusText:
              response.statusText,

            response:
              rawResult
          }
        );

        const gatewayMessage =
          rawResult?.error?.message ||
          rawResult?.message ||
          rawResult?.error ||
          rawResult?.raw_text ||
          `AI Gateway HTTP ${response.status}`;

        throw new Error(
          `AI Gateway HTTP ${response.status}: ${gatewayMessage}`
        );

      }

      return rawResult;

    }

    /* =====================================================
       AI MODEL + FALLBACK
    ===================================================== */

    let rawResult;

    try {

      rawResult =
        await callAI(
          "openai/gpt-5.6-luna"
        );

    } catch (firstError) {

      console.error(
        "GPT-5.6 Luna failed:",
        firstError
      );

      try {

        console.log(
          "Trying fallback model: openai/gpt-5.4"
        );

        rawResult =
          await callAI(
            "openai/gpt-5.4"
          );

      } catch (secondError) {

        console.error(
          "Fallback AI model also failed:",
          secondError
        );

        return res.status(502).json({

          success: false,

          error:
            "AI evaluation failed.",

          details:
            secondError?.message ||
            firstError?.message ||
            "Unknown AI Gateway error.",

          primary_model:
            "openai/gpt-5.6-luna",

          fallback_model:
            "openai/gpt-5.4"

        });

      }

    }

    /* =====================================================
       EXTRACT OUTPUT TEXT
    ===================================================== */

    let outputText = "";

    if (
      typeof rawResult?.output_text ===
      "string"
    ) {

      outputText =
        rawResult.output_text;

    }

    if (
      !outputText &&
      Array.isArray(
        rawResult?.output
      )
    ) {

      for (
        const item
        of rawResult.output
      ) {

        if (
          !Array.isArray(
            item?.content
          )
        ) {
          continue;
        }

        for (
          const content
          of item.content
        ) {

          if (
            typeof content?.text ===
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
        "AI returned no output text:",
        rawResult
      );

      return res.status(502).json({

        success: false,

        error:
          "AI returned an empty evaluation.",

        details:
          rawResult?.error?.message ||
          "No output_text found.",

        rawResponse:
          rawResult

      });

    }

    /* =====================================================
       PARSE JSON
    ===================================================== */

    let evaluation;

    try {

      evaluation =
        JSON.parse(
          outputText
            .trim()
        );

    } catch (parseError) {

      console.error(
        "AI JSON PARSE ERROR:",
        parseError
      );

      console.error(
        "AI OUTPUT:",
        outputText
      );

      return res.status(502).json({

        success: false,

        error:
          "AI returned invalid evaluation JSON.",

        details:
          parseError?.message ||
          "JSON parsing failed.",

        ai_output:
          outputText.substring(
            0,
            5000
          )

      });

    }

    /* =====================================================
       STRUCTURE VALIDATION
    ===================================================== */

    if (
      !evaluation ||
      !Array.isArray(
        evaluation.questions
      )
    ) {

      return res.status(502).json({

        success: false,

        error:
          "Invalid evaluation structure returned by AI."

      });

    }

    /* =====================================================
       SCORE VALIDATION
    ===================================================== */

    let total =
      0;

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
        )
      ) {

        return res.status(502).json({

          success: false,

          error:
            "AI returned invalid marks_available."

        });

      }

      if (
        !Number.isFinite(
          awarded
        )
      ) {

        awarded =
          0;

      }

      if (
        awarded < 0
      ) {

        awarded =
          0;

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

      total +=
        awarded;

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

    /* =====================================================
       FINAL EVALUATION
    ===================================================== */

    evaluation.total_marks =
      total;

    evaluation.maximum_marks =
      maximumMarks;

    evaluation.percentage =
      percentage;

    /* =====================================================
       SUCCESS RESPONSE
    ===================================================== */

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
          isStrict
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
      "================================="
    );

    console.error(
      "CHECK API ERROR"
    );

    console.error(
      error
    );

    console.error(
      "================================="
    );

    return res.status(500).json({

      success: false,

      error:
        "Unable to evaluate answer sheet.",

      details:
        error?.message ||
        "Unknown server error."

    });

  }

}
