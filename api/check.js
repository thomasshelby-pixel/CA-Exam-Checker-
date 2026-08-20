import {
  list
} from "@vercel/blob";

const LEVELS = [
  "foundation",
  "inter",
  "final"
];

function safe(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-zA-Z0-9_-]/g, "_");
}

async function downloadBlob(
  blob,
  token
) {

  const response =
    await fetch(
      blob.url,
      {
        headers: {
          Authorization:
            `Bearer ${token}`
        }
      }
    );

  if (!response.ok) {

    throw new Error(
      `Unable to download ${blob.pathname}. HTTP ${response.status}`
    );

  }

  const arrayBuffer =
    await response.arrayBuffer();

  return Buffer
    .from(arrayBuffer)
    .toString("base64");
}

function findLatest(
  blobs,
  keyword
) {

  return blobs
    .filter(
      (blob) =>
        blob.pathname
          .toLowerCase()
          .includes(keyword)
    )
    .sort(
      (a, b) =>
        new Date(b.uploadedAt) -
        new Date(a.uploadedAt)
    )[0];

}

export default async function handler(
  req,
  res
) {

  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Method not allowed"
    });
  }

  try {

    const {

      answerSheetBase64,

      answerSheetName,

      level,

      group,

      subject,

      subjectKey,

      testType,

      modelType,

      subjects,

      checkingMode,

      descriptiveMaximum

    } = req.body || {};

    /*
      ================================
      ENVIRONMENT
      ================================
    */

    if (
      !process.env.AI_GATEWAY_API_KEY
    ) {

      return res.status(500).json({
        error:
          "AI_GATEWAY_API_KEY is not configured."
      });

    }

    if (
      !process.env.BLOB_READ_WRITE_TOKEN
    ) {

      return res.status(500).json({
        error:
          "BLOB_READ_WRITE_TOKEN is not configured."
      });

    }

    /*
      ================================
      BASIC VALIDATION
      ================================
    */

    if (!answerSheetBase64) {

      return res.status(400).json({
        error:
          "Answer sheet is missing."
      });

    }

    const safeLevel =
      safe(level);

    if (
      !LEVELS.includes(
        safeLevel
      )
    ) {

      return res.status(400).json({
        error:
          "Invalid level."
      });

    }

    if (!subjectKey) {

      return res.status(400).json({
        error:
          "Subject is missing."
      });

    }

    if (!testType) {

      return res.status(400).json({
        error:
          "Test type is missing."
      });

    }

    const maximumMarks =
      Number(
        descriptiveMaximum
      );

    if (
      !Number.isFinite(
        maximumMarks
      ) ||
      maximumMarks <= 0
    ) {

      return res.status(400).json({
        error:
          "Invalid descriptive maximum marks."
      });

    }

    /*
      ================================
      MATERIAL PATH
      ================================
    */

    const safeGroup =
      safe(group || "");

    const safeModelType =
      safe(modelType || "");

    /*
      For Model Test:
      foundation -> model_test
      inter/final -> group_1/group_2/other
    */

    let materialPrefix;

    if (
      testType === "MODEL_TEST"
    ) {

      materialPrefix =
        [
          "materials",
          safeLevel,
          safeModelType
        ].join("/") + "/";

    } else {

      materialPrefix =
        [
          "materials",
          safeLevel,
          safeModelType || "other"
        ].join("/") + "/";

    }

    /*
      ================================
      FIND MATERIALS
      ================================
    */

    const materialList =
      await list({

        prefix:
          materialPrefix,

        limit:
          1000,

        token:
          process.env.BLOB_READ_WRITE_TOKEN

      });

    const blobs =
      materialList?.blobs || [];

    console.log(
      "CHECK MATERIAL PREFIX:",
      materialPrefix
    );

    console.log(
      "AVAILABLE BLOBS:",
      blobs.map(
        (b) => b.pathname
      )
    );

    /*
      ================================
      MODEL TEST
      ================================
      One PDF = Question Paper +
      Suggested Answer
    */

    let questionPaper;
    let suggestedAnswer;

    if (
      testType === "MODEL_TEST"
    ) {

      const combined =
        findLatest(
          blobs,
          "/model-test-combined-"
        );

      if (!combined) {

        return res.status(404).json({

          error:
            "Model Test material is missing.",

          details:
            `No combined Model Test PDF found in ${materialPrefix}`,

          availableFiles:
            blobs.map(
              (b) => b.pathname
            )

        });

      }

      questionPaper =
        combined;

      suggestedAnswer =
        combined;

    } else {

      questionPaper =
        findLatest(
          blobs,
          "/question-paper-"
        );

      suggestedAnswer =
        findLatest(
          blobs,
          "/suggested-answer-"
        );

      if (!questionPaper) {

        return res.status(404).json({
          error:
            "Question Paper is missing.",
          availableFiles:
            blobs.map(
              (b) => b.pathname
            )
        });

      }

      if (!suggestedAnswer) {

        return res.status(404).json({
          error:
            "Suggested Answer is missing.",
          availableFiles:
            blobs.map(
              (b) => b.pathname
            )
        });

      }

    }

    /*
      ================================
      DOWNLOAD FILES
      ================================
    */

    const questionPaperBase64 =
      await downloadBlob(
        questionPaper,
        process.env.BLOB_READ_WRITE_TOKEN
      );

    let suggestedAnswerBase64;

    if (
      suggestedAnswer.pathname ===
      questionPaper.pathname
    ) {

      suggestedAnswerBase64 =
        questionPaperBase64;

    } else {

      suggestedAnswerBase64 =
        await downloadBlob(
          suggestedAnswer,
          process.env.BLOB_READ_WRITE_TOKEN
        );

    }

    /*
      ================================
      CHECKING MODE
      ================================
    */

    const checkingInstructions =
      checkingMode === "strict"

        ? `
STRICT ICAI-STYLE CHECKING:

- Be conservative with marks.
- Award marks only for demonstrated knowledge.
- Penalise wrong concepts and provisions.
- Penalise wrong calculations.
- Give step marks only for correct steps.
- Missing essential workings should lose marks.
- Theory requires provision, concept, application and conclusion.
`

        : `
MODERATE EXAMINER-STYLE CHECKING:

- Give reasonable step marking.
- Give credit for substantially correct approaches.
- Minor calculation errors may receive partial marks.
- Conceptual errors must still be penalised.
- Missing essential workings should affect marks.
`;

    /*
      ================================
      MODEL TEST NOTE
      ================================
    */

    const materialInstruction =
      testType === "MODEL_TEST"

        ? `
MODEL TEST MATERIAL:

The uploaded Model Test PDF contains BOTH:
1. Question Paper
2. Suggested Answer

Treat the first/appropriate section as the
Question Paper and the corresponding
Suggested Answer section as the reference.

Do NOT require a second Suggested Answer file.
`

        : `
NORMAL TEST MATERIAL:

Question Paper and Suggested Answer are
provided as separate files.
`;

    /*
      ================================
      SUBJECT CONTEXT
      ================================
    */

    const subjectList =
      Array.isArray(subjects)
        ? subjects.join(", ")
        : "";

    /*
      ================================
      PROMPT
      ================================
    */

    const prompt = `

You are an expert CA examination evaluator.

You are evaluating a CA examination answer sheet.

LEVEL:
${safeLevel}

GROUP:
${group || "Not applicable"}

SUBJECT:
${subject || subjectKey}

SUBJECT KEY:
${subjectKey}

TEST TYPE:
${testType}

MODEL TYPE:
${modelType || "Not applicable"}

SUBJECTS IN MATERIAL:
${subjectList || "Not specified"}

DESCRIPTIVE MAXIMUM:
${maximumMarks}

CHECKING MODE:
${
  checkingMode === "strict"
    ? "ICAI STRICT"
    : "MODERATE"
}

${checkingInstructions}

${materialInstruction}

========================================
SOURCE PRIORITY
========================================

Use the documents in this order:

1. Question Paper
2. Suggested Answer
3. Student Answer Sheet

The Question Paper is authoritative for:

- question numbers
- sub-parts
- marks
- question structure
- internal choices

The Suggested Answer is authoritative for:

- expected concepts
- provisions
- calculations
- workings
- conclusions
- important points

========================================
IMPORTANT RULES
========================================

1. Evaluate ONLY descriptive questions.

2. IGNORE MCQs completely.

3. Do not invent questions.

4. Do not invent marks.

5. Identify every descriptive question from
   the Question Paper.

6. Locate the corresponding student answer.

7. Compare the student answer directly with
   the Suggested Answer.

8. Give genuine partial marks.

9. A wrong final answer with substantially
   correct working can receive partial marks.

10. Wrong approach should not receive marks
    merely because some numbers or keywords
    match.

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

14. If handwriting/content is genuinely
    impossible to read:

    status = "unclear"

15. Never award more than marks_available.

16. Never award negative marks.

17. Include every descriptive question.

18. Exclude MCQs.

19. Handle internal choices correctly.

20. Do not double-count internally chosen
    alternatives.

21. Remarks must explain actual lost marks.

22. Do not give generic praise.

23. Do not reveal hidden reasoning.

24. Keep question numbering exactly as
    found in the Question Paper.

========================================
FINAL VALIDATION
========================================

Verify:

- Every descriptive question included.
- MCQs excluded.
- Correct marks available.
- Correct marks awarded.
- Total is mathematically correct.
- Total does not exceed ${maximumMarks}.
- Percentage is mathematically correct.

Return ONLY valid JSON.
`;

    /*
      ================================
      AI REQUEST
      ================================
    */

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

          body:
            JSON.stringify({

              model:
                "openai/gpt-5.2",

              reasoning: {
                effort: "high"
              },

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
                        "input_file",

                      filename:
                        questionPaper.pathname
                          .split("/")
                          .pop(),

                      file_data:
                        `data:application/pdf;base64,${questionPaperBase64}`
                    },

                    {
                      type:
                        "input_file",

                      filename:
                        suggestedAnswer.pathname
                          .split("/")
                          .pop(),

                      file_data:
                        `data:application/pdf;base64,${suggestedAnswerBase64}`
                    },

                    {
                      type:
                        "input_file",

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

    /*
      ================================
      READ AI RESPONSE
      ================================
    */

    const rawResult =
      await aiResponse.json();

    if (!aiResponse.ok) {

      console.error(
        "AI GATEWAY ERROR:",
        rawResult
      );

      return res.status(
        aiResponse.status
      ).json({

        error:
          "AI evaluation failed.",

        details:
          rawResult?.error?.message ||
          rawResult?.message ||
          JSON.stringify(
            rawResult
          )

      });

    }

    /*
      ================================
      EXTRACT TEXT
      ================================
    */

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

      return res.status(500).json({

        error:
          "AI returned an empty evaluation.",

        details:
          JSON.stringify(
            rawResult
          ).slice(
            0,
            4000
          )

      });

    }

    /*
      ================================
      PARSE JSON
      ================================
    */

    let evaluation;

    try {

      evaluation =
        JSON.parse(
          outputText
        );

    } catch {

      return res.status(500).json({

        error:
          "AI returned invalid JSON.",

        details:
          outputText.slice(
            0,
            3000
          )

      });

    }

    /*
      ================================
      VALIDATION
      ================================
    */

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

    /*
      ================================
      SERVER-SIDE SCORE
      ================================
    */

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
        )
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

    evaluation.total_marks =
      total;

    evaluation.maximum_marks =
      maximumMarks;

    evaluation.percentage =
      percentage;

    /*
      ================================
      FINAL RESPONSE
      ================================
    */

    return res.status(200).json({

      success:
        true,

      evaluation,

      metadata: {

        level:
          safeLevel,

        group:
          group || null,

        subject:
          subject || subjectKey,

        subjectKey,

        testType,

        modelType:
          modelType || null,

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

        combinedModelTest:
          testType === "MODEL_TEST",

        answerSheet:
          answerSheetName ||
          "answer-sheet.pdf"

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
        error?.message ||
        "Unknown error"

    });

  }

}
