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
      level,
      subject,
      subjectKey,
      testType,
      modelType,
      checkingMode,
      descriptiveMaximum
    } = req.body || {};

    if (!answerSheetBase64) {
      return res.status(400).json({
        error: "Answer sheet is missing."
      });
    }

    if (!level) {
      return res.status(400).json({
        error: "Level is missing."
      });
    }

    if (!testType) {
      return res.status(400).json({
        error: "Test type is missing."
      });
    }

    const isFoundationCombinedModel =
      testType === "MODEL_TEST" &&
      level === "foundation";

    if (
      !isFoundationCombinedModel &&
      !subjectKey
    ) {
      return res.status(400).json({
        error: "Subject is required."
      });
    }

    if (
      testType === "MODEL_TEST" &&
      !modelType
    ) {
      return res.status(400).json({
        error: "Model Test Type is required."
      });
    }

    const maximumMarks =
      Number(descriptiveMaximum);

    if (
      !Number.isFinite(maximumMarks) ||
      maximumMarks <= 0
    ) {
      return res.status(400).json({
        error:
          "Invalid descriptive maximum marks."
      });
    }

    if (!process.env.AI_GATEWAY_API_KEY) {
      return res.status(500).json({
        error:
          "AI_GATEWAY_API_KEY is not configured."
      });
    }

    if (!process.env.BLOB_READ_WRITE_TOKEN) {
      return res.status(500).json({
        error:
          "BLOB_READ_WRITE_TOKEN is not configured."
      });
    }

    const safe = (value) =>
      String(value)
        .trim()
        .replace(/[^a-zA-Z0-9_-]/g, "_");

    let prefix;

    /*
     * MODEL TEST
     */

    if (testType === "MODEL_TEST") {
      prefix =
        `materials/${safe(level)}/MODEL_TEST/${safe(modelType)}/`;
    }

    /*
     * NORMAL TEST
     */

    else {
      prefix =
        `materials/${safe(level)}/${safe(subjectKey)}/${safe(testType)}/`;
    }

    console.log(
      "CHECK PREFIX:",
      prefix
    );

    const materialList = await list({
      prefix,
      token:
        process.env.BLOB_READ_WRITE_TOKEN
    });

    const blobs =
      materialList?.blobs || [];

    console.log(
      "AVAILABLE FILES:",
      blobs.map(
        blob => blob.pathname
      )
    );

    let modelFile = null;
    let questionPaper = null;
    let suggestedAnswer = null;

    /*
     * MODEL TEST
     */

    if (testType === "MODEL_TEST") {
      const modelFiles =
        blobs
          .filter(blob =>
            blob.pathname
              .toLowerCase()
              .includes("model-test-")
          )
          .sort(
            (a, b) =>
              new Date(b.uploadedAt) -
              new Date(a.uploadedAt)
          );

      if (!modelFiles.length) {
        return res.status(404).json({
          error:
            "Model Test material is missing.",
          details:
            `No Model Test found inside ${prefix}`,
          availableFiles:
            blobs.map(
              blob => blob.pathname
            )
        });
      }

      modelFile = modelFiles[0];
    }

    /*
     * NORMAL PAPER
     */

    else {
      const questionPapers =
        blobs
          .filter(blob =>
            blob.pathname
              .toLowerCase()
              .includes(
                "question-paper-"
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
            blob.pathname
              .toLowerCase()
              .includes(
                "suggested-answer-"
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
            "Question Paper is missing.",
          details:
            `No Question Paper found inside ${prefix}`,
          availableFiles:
            blobs.map(
              blob => blob.pathname
            )
        });
      }

      if (!suggestedAnswers.length) {
        return res.status(404).json({
          error:
            "Suggested Answer is missing.",
          details:
            `No Suggested Answer found inside ${prefix}`,
          availableFiles:
            blobs.map(
              blob => blob.pathname
            )
        });
      }

      questionPaper =
        questionPapers[0];

      suggestedAnswer =
        suggestedAnswers[0];
    }

    async function downloadBlob(blob) {
      const response =
        await fetch(blob.url, {
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

      const arrayBuffer =
        await response.arrayBuffer();

      return Buffer
        .from(arrayBuffer)
        .toString("base64");
    }

    let combinedBase64 = null;
    let questionPaperBase64 = null;
    let suggestedAnswerBase64 = null;

    if (testType === "MODEL_TEST") {
      combinedBase64 =
        await downloadBlob(modelFile);
    } else {
      questionPaperBase64 =
        await downloadBlob(
          questionPaper
        );

      suggestedAnswerBase64 =
        await downloadBlob(
          suggestedAnswer
        );
    }

    /*
     * AI PROMPT
     */

    const formattedTestType =
      testType === "MODEL_TEST"
        ? "Model Test"
        : testType === "PYQ"
        ? "Previous Year Question Paper"
        : testType;

    const formattedModelType =
      modelType === "GROUP_1"
        ? "Group 1"
        : modelType === "GROUP_2"
        ? "Group 2"
        : modelType === "OTHER"
        ? "Other"
        : modelType === "FOUNDATION"
        ? "Foundation Combined"
        : "";

    const checkingInstructions =
      checkingMode === "strict"
        ? `
STRICT ICAI-STYLE CHECKING:

- Be conservative with marks.
- Award marks only for demonstrated knowledge.
- Penalise wrong concepts, provisions and calculations.
- Give genuine step marks.
- Missing workings should lose marks where required.
- Theory must contain relevant provision/concept, application and conclusion.
`
        : `
MODERATE EXAMINER-STYLE CHECKING:

- Give reasonable step marking.
- Give credit for substantially correct approaches.
- Minor calculation errors may receive partial marks.
- Conceptual errors must be penalised.
- Missing essential workings should affect marks.
`;

    const modelInstructions =
      testType === "MODEL_TEST"
        ? `
THIS IS A COMBINED MODEL TEST PDF.

The supplied PDF contains material for one or more subjects.

Selected CA Level:
${level}

Selected Model Test Type:
${formattedModelType}

Selected Subject:
${subject || "Combined Foundation Model Test"}

IMPORTANT:

1. Locate ONLY the section belonging to the selected subject.
2. Ignore other subjects.
3. Identify that subject's Question Paper section.
4. Identify that subject's Suggested Answer/reference section.
5. Compare the student's answers ONLY against that subject.
6. Do NOT mix another subject's marks, questions or answers.
`
        : `
THIS IS A NORMAL PAPER.

The Question Paper and Suggested Answer are separate files.

Use the Question Paper for:
- question numbers
- sub-parts
- marks
- structure

Use the Suggested Answer for:
- expected answers
- calculations
- concepts
- provisions
- workings
- conclusions
`;

    const prompt = `
You are an expert CA examination evaluator.

Evaluate the student's answer sheet against the official/reference examination material.

==================================================
EXAM INFORMATION
==================================================

CA LEVEL:
${level}

SUBJECT:
${subject || "Combined Foundation Model Test"}

SUBJECT KEY:
${subjectKey || "combined"}

TEST TYPE:
${formattedTestType}

MODEL TEST TYPE:
${formattedModelType || "Not Applicable"}

DESCRIPTIVE MAXIMUM:
${maximumMarks}

CHECKING MODE:
${
  checkingMode === "strict"
    ? "ICAI STRICT"
    : "MODERATE"
}

==================================================
MODEL / MATERIAL RULES
==================================================

${modelInstructions}

==================================================
CHECKING STANDARD
==================================================

${checkingInstructions}

==================================================
MANDATORY RULES
==================================================

1. Evaluate ONLY descriptive questions.

2. IGNORE MCQs completely.

3. Do not invent questions.

4. Do not invent marks.

5. Use the Question Paper as authority for:
   - question numbers
   - sub-parts
   - available marks
   - question structure

6. Use the Suggested Answer as the primary reference for:
   - expected answer
   - calculations
   - provisions
   - concepts
   - workings
   - conclusions

7. Give genuine partial/step marks.

8. Wrong final answer with substantially correct working may receive partial marks.

9. Wrong approach should not receive marks merely for similar numbers or keywords.

10. Theory must be checked for:
    - relevant provision
    - concept
    - application
    - conclusion
    - important keywords

11. Practical questions must be checked for:
    - formula
    - working
    - calculations
    - adjustments
    - final answer

12. Unattempted:
    marks_awarded = 0
    status = "not_attempted"

13. Unclear handwriting:
    status = "unclear"

14. Never award more than marks_available.

15. Never award negative marks.

16. Include every descriptive question for the selected subject.

17. Exclude MCQs.

18. Handle internal choices correctly.

19. Do not count both alternatives of an internal choice.

20. Remarks must explain actual lost marks.

21. Do not give generic praise.

22. Do not reveal hidden reasoning.

==================================================
FINAL CHECK
==================================================

Verify:

- Correct subject selected.
- Correct level selected.
- Correct Model Test section selected when applicable.
- Every relevant descriptive question included.
- MCQs excluded.
- Marks available correct.
- Awarded marks correct.
- Total mathematically correct.
- Total <= ${maximumMarks}.
- Percentage mathematically correct.

Return ONLY valid JSON.
`;

    const content = [
      {
        type: "input_text",
        text: prompt
      }
    ];

    /*
     * Combined Model Test PDF
     */

    if (testType === "MODEL_TEST") {
      content.push({
        type: "input_file",
        filename:
          modelFile.pathname
            .split("/")
            .pop(),
        file_data:
          `data:application/pdf;base64,${combinedBase64}`
      });
    }

    /*
     * Normal Question Paper
     */

    else {
      content.push({
        type: "input_file",
        filename:
          questionPaper.pathname
            .split("/")
            .pop(),
        file_data:
          `data:application/pdf;base64,${questionPaperBase64}`
      });

      content.push({
        type: "input_file",
        filename:
          suggestedAnswer.pathname
            .split("/")
            .pop(),
        file_data:
          `data:application/pdf;base64,${suggestedAnswerBase64}`
      });
    }

    /*
     * Student Answer Sheet
     */

    content.push({
      type: "input_file",
      filename:
        answerSheetName ||
        "answer-sheet.pdf",
      file_data:
        `data:application/pdf;base64,${answerSheetBase64}`
    });

    /*
     * AI GATEWAY
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

          body: JSON.stringify({
            model:
              process.env.AI_MODEL ||
              "openai/gpt-5.6-sol",

            reasoning: {
              effort: "high"
            },

            input: [
              {
                type: "message",
                role: "user",
                content
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

    const rawResult =
      await aiResponse.json();

    console.log(
      "AI STATUS:",
      aiResponse.status
    );

    console.log(
      "AI RESPONSE:",
      JSON.stringify(
        rawResult
      ).slice(0, 6000)
    );

    if (!aiResponse.ok) {
      return res.status(
        aiResponse.status
      ).json({
        error:
          "AI evaluation failed.",

        details:
          rawResult?.error?.message ||
          rawResult?.message ||
          JSON.stringify(rawResult)
      });
    }

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
          const itemContent
          of item.content
        ) {
          if (
            typeof itemContent.text ===
            "string"
          ) {
            outputText +=
              itemContent.text;
          }
        }
      }
    }

    if (!outputText) {
      return res.status(500).json({
        error:
          "AI returned an empty evaluation.",
        details:
          JSON.stringify(rawResult)
      });
    }

    let evaluation;

    try {
      evaluation =
        JSON.parse(
          outputText
        );
    } catch (error) {
      console.error(
        "AI JSON PARSE ERROR:",
        outputText
      );

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

      question.marks_awarded =
        awarded;

      total += awarded;
    }

    total =
      Math.round(
        total * 100
      ) / 100;

    total =
      Math.min(
        total,
        maximumMarks
      );

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

    return res.status(200).json({
      success: true,

      evaluation,

      metadata: {
        level,

        subject:
          subject ||
          "Combined Foundation Model Test",

        subjectKey:
          subjectKey ||
          "combined",

        testType:
          formattedTestType,

        modelType:
          formattedModelType,

        checkingMode:
          checkingMode === "strict"
            ? "ICAI Strict"
            : "Moderate",

        descriptiveMaximum:
          maximumMarks
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
