import { list } from "@vercel/blob";

const AI_URL =
  "https://ai-gateway.vercel.sh/v1/responses";

const DEFAULT_MODEL =
  "openai/gpt-5.6-luna";

function safe(value) {
  return String(value || "")
    .replace(
      /[^a-zA-Z0-9_-]/g,
      "_"
    );
}

function safeAttempt(value) {
  return String(value || "")
    .trim()
    .replace(
      /[^a-zA-Z0-9._-]/g,
      "_"
    )
    .slice(0, 80);
}

function formatTestType(type) {

  return ({
    MTP: "MTP",
    RTP: "RTP",
    PYQ: "PYQ",
    MODEL_TEST: "Model Test",
    OTHER: "Other"
  })[type] || type;
}

function formatModelType(type) {

  return ({
    FOUNDATION:
      "Foundation Model Test",

    GROUP_1:
      "Group 1",

    GROUP_2:
      "Group 2",

    OTHER:
      "Other"
  })[type] || type || "—";
}

async function downloadBlob(blob) {

  const response =
    await fetch(
      blob.url,
      {
        headers: {
          Authorization:
            `Bearer ${process.env.BLOB_READ_WRITE_TOKEN}`
        }
      }
    );

  if (!response.ok) {
    throw new Error(
      `Unable to download ${blob.pathname}. HTTP ${response.status}`
    );
  }

  const buffer =
    Buffer.from(
      await response.arrayBuffer()
    );

  return buffer.toString(
    "base64"
  );
}

async function latestMatching(
  blobs,
  marker
) {

  return [
    ...blobs
  ]
    .filter(
      blob =>
        blob.pathname
          .toLowerCase()
          .includes(
            marker.toLowerCase()
          )
    )
    .sort(
      (a, b) =>
        new Date(
          b.uploadedAt
        ) -
        new Date(
          a.uploadedAt
        )
    )[0] || null;
}

export default async function handler(
  req,
  res
) {

  if (req.method !== "POST") {
    return res.status(405).json({
      error:
        "Method not allowed"
    });
  }

  try {

    const {
      answerSheetBase64,
      answerSheetName,
      level,
      subject,
      subjectKey,
      testType,
      modelType,
      pyqAttempt,
      checkingMode,
      descriptiveMaximum
    } = req.body || {};

    if (!answerSheetBase64) {
      return res.status(400).json({
        error:
          "Answer sheet is missing."
      });
    }

    if (!level) {
      return res.status(400).json({
        error:
          "Level is missing."
      });
    }

    if (!testType) {
      return res.status(400).json({
        error:
          "Test type is missing."
      });
    }

    if (
      !process.env
        .BLOB_READ_WRITE_TOKEN
    ) {
      return res.status(500).json({
        error:
          "BLOB_READ_WRITE_TOKEN is not configured."
      });
    }

    if (
      !process.env
        .AI_GATEWAY_API_KEY
    ) {
      return res.status(500).json({
        error:
          "AI_GATEWAY_API_KEY is not configured."
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
      maximumMarks < 0
    ) {
      return res.status(400).json({
        error:
          "Invalid descriptive maximum marks."
      });
    }

    /*
      FOUNDATION MCQ PAPERS
      ---------------------
      QA + Business Economics
      are objective papers.

      Current AI checker evaluates
      descriptive answers only.
    */

    if (maximumMarks === 0) {

      return res.status(200).json({

        success: true,

        evaluation: {

          overall_summary:
            "This paper is MCQ-only. The current checker evaluates descriptive answers only, so no descriptive marks were evaluated. Foundation objective papers carry 0.25 negative marking for wrong answers, but MCQ scoring is not performed by this descriptive checker.",

          questions: [],

          total_marks: 0,

          maximum_marks: 0,

          percentage: 0
        },

        metadata: {
          level,
          subject,
          subjectKey,

          testType:
            formatTestType(
              testType
            ),

          modelType:
            formatModelType(
              modelType
            ),

          pyqAttempt:
            pyqAttempt || "",

          checkingMode
        }
      });
    }

    let questionPaperBlob;
    let suggestedAnswerBlob;

    /*
      MODEL TEST
      --------------------
      ONE PDF ONLY.

      That same PDF contains:
      Question Paper
      +
      Suggested Answer
    */

    if (
      testType ===
      "MODEL_TEST"
    ) {

      if (!modelType) {
        return res.status(400).json({
          error:
            "Model Test Type is required."
        });
      }

      if (
        level ===
          "foundation" &&
        modelType !==
          "FOUNDATION"
      ) {
        return res.status(400).json({
          error:
            "Foundation only supports Foundation Model Test."
        });
      }

      if (
        level !==
          "foundation" &&
        ![
          "GROUP_1",
          "GROUP_2",
          "OTHER"
        ].includes(modelType)
      ) {
        return res.status(400).json({
          error:
            "Invalid Model Test Type."
        });
      }

      let prefix =
        `materials/${safe(level)}/MODEL_TEST/${safe(modelType)}/`;

      let result =
        await list({
          prefix,
          token:
            process.env
              .BLOB_READ_WRITE_TOKEN
        });

      let blobs =
        result.blobs || [];

      /*
        Old Foundation compatibility
      */

      if (
        level ===
          "foundation" &&
        modelType ===
          "FOUNDATION" &&
        !blobs.length
      ) {

        prefix =
          `materials/${safe(level)}/MODEL_TEST/MODEL_TEST/`;

        result =
          await list({
            prefix,
            token:
              process.env
                .BLOB_READ_WRITE_TOKEN
          });

        blobs =
          result.blobs || [];
      }

      /*
        MODEL TEST OTHER
      */

      if (
        modelType ===
        "OTHER"
      ) {

        if (
          !subjectKey ||
          subjectKey ===
            "combined"
        ) {
          return res.status(400).json({
            error:
              "Subject is required for Model Test Other."
          });
        }

        const selected =
          safe(subjectKey);

        const matches =
          blobs.filter(
            blob => {

              const parts =
                blob.pathname
                  .split("/");

              const folder =
                parts[4] || "";

              return (
                blob.pathname
                  .toLowerCase()
                  .includes(
                    "/model-test-"
                  ) &&
                folder
                  .split("__")
                  .includes(
                    selected
                  )
              );
            }
          );

        questionPaperBlob =
          await latestMatching(
            matches,
            "/model-test-"
          );

      } else {

        /*
          Group 1 / Group 2 /
          Foundation
        */

        questionPaperBlob =
          await latestMatching(
            blobs,
            "/model-test-"
          );
      }

      if (!questionPaperBlob) {

        return res.status(404).json({
          error:
            "Model Test material is missing.",

          details:
            `No Model Test found for ${level} / ${formatModelType(modelType)}.`
        });
      }

      /*
        SAME PDF is used as:
        Question Paper
        +
        Suggested Answer
      */

      suggestedAnswerBlob =
        questionPaperBlob;

    } else {

      /*
        ALL OTHER TEST TYPES
        --------------------

        MTP
        RTP
        PYQ
        OTHER
      */

      if (
        !subjectKey ||
        subjectKey ===
          "combined"
      ) {
        return res.status(400).json({
          error:
            "Subject is required for this test type."
        });
      }

      let prefix;

      if (
        testType ===
        "PYQ"
      ) {

        if (
          !safeAttempt(
            pyqAttempt
          )
        ) {
          return res.status(400).json({
            error:
              "PYQ Attempt is required."
          });
        }

        prefix =
          `materials/${safe(level)}/PYQ/NONE/${safe(subjectKey)}/attempt-${safeAttempt(pyqAttempt)}/`;

      } else {

        prefix =
          `materials/${safe(level)}/${safe(testType)}/NONE/${safe(subjectKey)}/`;
      }

      const result =
        await list({
          prefix,
          token:
            process.env
              .BLOB_READ_WRITE_TOKEN
        });

      const blobs =
        result.blobs || [];

      questionPaperBlob =
        await latestMatching(
          blobs,
          "/question-paper-"
        );

      suggestedAnswerBlob =
        await latestMatching(
          blobs,
          "/suggested-answer-"
        );

      if (
        !questionPaperBlob
      ) {

        return res.status(404).json({

          error:
            `${formatTestType(testType)} Question Paper is missing.`,

          details:
            `No Question Paper found inside ${prefix}`,

          availableFiles:
            blobs.map(
              b => b.pathname
            )
        });
      }

      if (
        !suggestedAnswerBlob
      ) {

        return res.status(404).json({

          error:
            `${formatTestType(testType)} Suggested Answer is missing.`,

          details:
            `No Suggested Answer found inside ${prefix}`,

          availableFiles:
            blobs.map(
              b => b.pathname
            )
        });
      }
    }

    const questionPaperBase64 =
      await downloadBlob(
        questionPaperBlob
      );

    const suggestedAnswerBase64 =
      await downloadBlob(
        suggestedAnswerBlob
      );

    return await evaluateWithAI({

      res,

      answerSheetBase64,

      answerSheetName,

      level,

      subject,

      subjectKey,

      testType,

      modelType,

      pyqAttempt,

      checkingMode,

      maximumMarks,

      questionPaperBase64,

      suggestedAnswerBase64,

      questionPaperName:
        questionPaperBlob.pathname,

      suggestedAnswerName:
        suggestedAnswerBlob.pathname
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

async function evaluateWithAI({

  res,

  answerSheetBase64,

  answerSheetName,

  level,

  subject,

  subjectKey,

  testType,

  modelType,

  pyqAttempt,

  checkingMode,

  maximumMarks,

  questionPaperBase64,

  suggestedAnswerBase64,

  questionPaperName,

  suggestedAnswerName

}) {

  const checkingInstructions =
    checkingMode === "strict"

      ? `
STRICT ICAI-STYLE CHECKING:

- Be conservative with marks.
- Award marks only for demonstrated knowledge.
- Penalise wrong concepts, provisions and calculations.
- Give genuine step marks only for correct steps.
- Missing essential workings should lose marks.
- Theory requires provision/concept, application and conclusion where applicable.
`

      : `
MODERATE EXAMINER-STYLE CHECKING:

- Give reasonable step marking.
- Give credit for substantially correct approaches.
- Minor calculation errors may receive partial marks.
- Conceptual errors must be penalised.
- Do not award marks for unsupported claims.
`;

  const modelTestNote =
    testType ===
    "MODEL_TEST"

      ? `
The Model Test is ONE PDF containing the question paper and suggested/reference answer.

Identify both sections inside the same PDF before checking.
`

      : `
For ${formatTestType(testType)}, the Question Paper and Suggested Answer are separate PDFs.
`;

  const prompt = `

You are an expert CA examiner checking a student's answer sheet.

EXAM LEVEL:
${level}

SUBJECT:
${subject || "Combined paper"}

TEST TYPE:
${formatTestType(testType)}

MODEL TYPE:
${formatModelType(modelType)}

PYQ ATTEMPT:
${pyqAttempt || "N/A"}

DESCRIPTIVE MAXIMUM:
${maximumMarks}

CHECKING MODE:
${
  checkingMode === "strict"
    ? "ICAI STRICT"
    : "MODERATE"
}

${checkingInstructions}

${modelTestNote}

CORE RULES:

1. Use the official/reference Question Paper to determine question numbers, sub-parts and marks.

2. Use the official/reference Suggested Answer to determine expected concepts, provisions, calculations, workings and conclusions.

3. Locate every descriptive question in the Question Paper and compare it with the student's corresponding answer.

4. Evaluate ONLY descriptive questions. Ignore MCQs completely.

5. Never invent a question, mark allocation, answer or student response.

6. Award genuine partial/step marks when the student's approach is materially correct.

7. A wrong final answer can still receive partial marks when the working is substantially correct.

8. A wrong approach must not receive marks merely because some keywords/numbers match.

9. For theory, check provision/concept, application, conclusion and important relevant keywords.

10. For practical questions, check formula, workings, calculations, adjustments and final answer.

11. Unattempted question = 0 marks and status not_attempted.

12. If handwriting/content cannot be reliably read = status unclear and award only marks that can be justified.

13. Never award negative marks in descriptive evaluation.

14. Never exceed marks_available for any question.

15. Handle internal choices carefully.

16. Do not penalise a student for not attempting a question that was an internal alternative to another attempted question.

17. Remarks must state the actual reason for lost marks.

18. Do not give generic praise.

19. Do not reveal hidden reasoning.

20. The supplied descriptive maximum is a hard ceiling.

21. The total must equal the sum of awarded question marks.

22. Total must not exceed ${maximumMarks}.

23. Percentage =
total_marks / maximum_marks * 100.

24. Round percentage to two decimals.

FOUNDATION NOTE:

Foundation Accounting and Business Laws are descriptive papers.

Foundation Quantitative Aptitude and Business Economics are objective/MCQ papers with 0.25 negative marking per wrong answer.

This checker does NOT score those MCQs.

FINAL CHECK:

- Include every descriptive question.
- Exclude MCQs.
- Correct marks available.
- Correct awarded marks.
- Correct total.
- Correct percentage.
- Total <= ${maximumMarks}.

Return ONLY JSON matching the supplied schema.
`;

  const aiResponse =
    await fetch(
      AI_URL,
      {
        method:
          "POST",

        headers: {
          "Content-Type":
            "application/json",

          Authorization:
            `Bearer ${process.env.AI_GATEWAY_API_KEY}`
        },

        body:
          JSON.stringify({

            model:
              process.env.AI_MODEL ||
              DEFAULT_MODEL,

            reasoning: {
              effort:
                process.env.AI_REASONING ||
                "high"
            },

            input: [

              {
                type:
                  "message",

                role:
                  "user",

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
                      questionPaperName
                        .split("/")
                        .pop(),

                    file_data:
                      `data:application/pdf;base64,${questionPaperBase64}`
                  },

                  {
                    type:
                      "input_file",

                    filename:
                      suggestedAnswerName
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
    IMPORTANT:
    Read text first instead of directly
    calling response.json().

    This prevents:
    Unexpected token 'A'...
  */

  const rawText =
    await aiResponse.text();

  let rawResult;

  try {

    rawResult =
      JSON.parse(
        rawText
      );

  } catch {

    rawResult = {
      raw:
        rawText
    };
  }

  if (!aiResponse.ok) {

    console.error(
      "AI GATEWAY ERROR:",
      rawResult
    );

    const details =
      rawResult?.error?.message ||
      rawResult?.message ||
      rawResult?.raw ||
      JSON.stringify(
        rawResult
      );

    return res.status(
      aiResponse.status
    ).json({

      error:
        "AI evaluation failed.",

      details
    });
  }

  let outputText =
    typeof rawResult.output_text ===
    "string"
      ? rawResult.output_text
      : "";

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
          4000
        )
    });
  }

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

  let total = 0;

  for (
    const q
    of evaluation.questions
  ) {

    const available =
      Number(
        q.marks_available
      );

    if (
      !Number.isFinite(
        available
      ) ||
      available < 0
    ) {

      return res.status(500).json({
        error:
          "Invalid marks returned by AI."
      });
    }

    let awarded =
      Number(
        q.marks_awarded
      );

    if (
      !Number.isFinite(
        awarded
      )
    ) {
      awarded = 0;
    }

    awarded =
      Math.max(
        0,
        Math.min(
          available,
          awarded
        )
      );

    awarded =
      Math.round(
        awarded * 100
      ) / 100;

    q.marks_awarded =
      awarded;

    total +=
      awarded;
  }

  total =
    Math.round(
      Math.min(
        total,
        maximumMarks
      ) * 100
    ) / 100;

  evaluation.total_marks =
    total;

  evaluation.maximum_marks =
    maximumMarks;

  evaluation.percentage =
    maximumMarks > 0
      ? Math.round(
          (
            total /
            maximumMarks
          ) * 10000
        ) / 100
      : 0;

  return res.status(200).json({

    success:
      true,

    evaluation,

    metadata: {

      level,

      subject,

      subjectKey,

      testType:
        formatTestType(
          testType
        ),

      modelType:
        formatModelType(
          modelType
        ),

      pyqAttempt:
        pyqAttempt || "",

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
        answerSheetName ||
        "answer-sheet.pdf"
    }
  });
}
