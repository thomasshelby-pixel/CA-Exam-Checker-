import {
  list
} from "@vercel/blob";


function safe(value) {

  return String(value ?? "")
    .trim()
    .replace(
      /[^a-zA-Z0-9._-]/g,
      "_"
    );

}


function latest(
  blobs,
  keyword
) {

  return blobs

    .filter(blob =>
      blob.pathname
        .toLowerCase()
        .includes(
          keyword.toLowerCase()
        )
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
      error:
        "Method not allowed"
    });

  }


  try {

    const aiKey =
      process.env
        .AI_GATEWAY_API_KEY;

    const blobToken =
      process.env
        .BLOB_READ_WRITE_TOKEN;


    if (!aiKey) {

      return res.status(500).json({
        error:
          "AI_GATEWAY_API_KEY is not configured."
      });

    }


    if (!blobToken) {

      return res.status(500).json({
        error:
          "BLOB_READ_WRITE_TOKEN is not configured."
      });

    }


    const {

      answerSheetUrl,

      answerSheetName =
        "answer-sheet.pdf",

      level,

      subject =
        "Combined Model Test",

      subjectKey = "",

      testType,

      modelType = "",

      pyqAttempt = "",

      checkingMode =
        "strict",

      descriptiveMaximum

    } = req.body || {};


    const maximum =
      Number(
        descriptiveMaximum
      );


    if (!answerSheetUrl) {

      return res.status(400).json({
        error:
          "Answer sheet URL is missing."
      });

    }


    if (!level || !testType) {

      return res.status(400).json({
        error:
          "Level and test type are required."
      });

    }


    if (
      !Number.isFinite(maximum) ||
      maximum < 0
    ) {

      return res.status(400).json({
        error:
          "Invalid descriptive maximum marks."
      });

    }


    /* =========================
       MATERIAL PATH
    ========================= */

    let prefix;


    if (
      testType ===
      "MODEL_TEST"
    ) {

      if (!modelType) {

        return res.status(400).json({
          error:
            "Model Test type is required."
        });

      }


      prefix =
        `materials/` +
        `${safe(level)}/` +
        `MODEL_TEST/` +
        `model-${safe(modelType)}/` +
        `NA/`;

    } else {

      if (!subjectKey) {

        return res.status(400).json({
          error:
            "Subject is required."
        });

      }


      if (
        testType === "PYQ" &&
        !pyqAttempt
      ) {

        return res.status(400).json({
          error:
            "PYQ attempt is required."
        });

      }


      prefix =
        `materials/` +
        `${safe(level)}/` +
        `${safe(testType)}/` +
        `${safe(subjectKey)}/` +
        `${
          testType === "PYQ"
            ? safe(pyqAttempt)
            : "NA"
        }/`;

    }


    console.log(
      "MATERIAL PREFIX:",
      prefix
    );


    /* =========================
       FIND MATERIAL
    ========================= */

    const result =
      await list({

        prefix,

        token:
          blobToken,

        limit:
          1000

      });


    const blobs =
      result?.blobs || [];


    if (!blobs.length) {

      return res.status(404).json({

        error:
          "Test material not found.",

        details:
          `No material found inside ${prefix}`,

        availableFiles:
          []

      });

    }


    let questionPaper;

    let suggestedAnswer;


    /* =========================
       MODEL TEST
    ========================= */

    if (
      testType ===
      "MODEL_TEST"
    ) {

      questionPaper =
        latest(
          blobs,
          "/model-test-"
        );

      /*
        SAME PDF contains
        question + suggested answer.
      */

      suggestedAnswer =
        questionPaper;


    } else {

      questionPaper =
        latest(
          blobs,
          "/question-paper-"
        );

      suggestedAnswer =
        latest(
          blobs,
          "/suggested-answer-"
        );

    }


    if (!questionPaper) {

      return res.status(404).json({

        error:
          "Question Paper is missing.",

        details:
          prefix,

        availableFiles:
          blobs.map(
            b => b.pathname
          )

      });

    }


    if (!suggestedAnswer) {

      return res.status(404).json({

        error:
          "Suggested Answer is missing.",

        details:
          prefix,

        availableFiles:
          blobs.map(
            b => b.pathname
          )

      });

    }


    /* =========================
       PROMPT
    ========================= */

    const prompt = `

You are an expert CA examination checker.

Evaluate the student's answer sheet against
the supplied Question Paper and Suggested Answer.

LEVEL:
${level}

SUBJECT:
${subject}

TEST TYPE:
${testType}

MODEL TEST TYPE:
${modelType || "N/A"}

PYQ ATTEMPT:
${pyqAttempt || "N/A"}

DESCRIPTIVE MAXIMUM:
${maximum}

CHECKING MODE:
${checkingMode}


IMPORTANT:

Evaluate ONLY descriptive questions.

IGNORE MCQs completely.

Do not invent questions.

Do not invent marks.

Question Paper is authoritative for:

- question numbers
- sub-parts
- marks
- question structure

Suggested Answer is authoritative for:

- concepts
- provisions
- calculations
- workings
- conclusions

Give genuine partial marks.

Correct working with wrong final answer
may receive appropriate step marks.

Wrong approach must be penalised.

Theory must be checked for:

- provision
- concept
- application
- conclusion
- keywords

Practical questions must be checked for:

- formula
- workings
- calculations
- adjustments
- final answer

Unattempted:

marks_awarded = 0

status = "not_attempted"

Unclear handwriting:

status = "unclear"

Never award more than available marks.

Never award negative marks.

Include every descriptive question.

Exclude MCQs.

Handle internal choices correctly.

Do not award both alternatives of an
internal choice.

Remarks must explain actual lost marks.

Do not reveal hidden reasoning.

Return ONLY valid JSON.


MODEL TEST:

If this is a Model Test, the SAME PDF
contains Question Paper and Suggested Answer.
Identify both sections inside that PDF.


PYQ:

If this is PYQ, use ONLY the exact attempt:

${pyqAttempt || "N/A"}

Do not substitute another attempt.

`;


    /* =========================
       AI REQUEST
    ========================= */

    const payload = {

      model:
        "openai/gpt-5.6-sol",

      reasoning: {
        effort:
          "high"
      },

      input: [

        {

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

              file_url:
                questionPaper.url,

              filename:
                questionPaper.pathname
                  .split("/")
                  .pop()

            },

            {

              type:
                "input_file",

              file_url:
                suggestedAnswer.url,

              filename:
                suggestedAnswer.pathname
                  .split("/")
                  .pop()

            },

            {

              type:
                "input_file",

              file_url:
                answerSheetUrl,

              filename:
                answerSheetName

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

    };


    /* =========================
       CALL AI
    ========================= */

    const aiResponse =
      await fetch(

        "https://ai-gateway.vercel.sh/v1/responses",

        {

          method:
            "POST",

          headers: {

            "Content-Type":
              "application/json",

            Authorization:
              `Bearer ${aiKey}`

          },

          body:
            JSON.stringify(
              payload
            )

        }

      );


    const raw =
      await aiResponse.json();


    console.log(
      "AI STATUS:",
      aiResponse.status
    );


    if (!aiResponse.ok) {

      console.error(
        "AI GATEWAY ERROR:",
        JSON.stringify(
          raw,
          null,
          2
        )
      );


      return res.status(
        aiResponse.status
      ).json({

        error:
          "AI evaluation failed.",

        details:
          raw?.error?.message ||
          raw?.message ||
          JSON.stringify(raw)

      });

    }


    /* =========================
       EXTRACT
    ========================= */

    let outputText =
      "";


    if (
      typeof raw.output_text ===
      "string"
    ) {

      outputText =
        raw.output_text;

    }


    if (
      !outputText &&
      Array.isArray(
        raw.output
      )
    ) {

      for (
        const item
        of raw.output
      ) {

        for (
          const content
          of (
            item.content || []
          )
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
          JSON.stringify(raw)
            .slice(
              0,
              5000
            )

      });

    }


    /* =========================
       PARSE
    ========================= */

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
            5000
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


    /* =========================
       SCORE
    ========================= */

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

        awarded =
          0;

      }


      awarded =
        Math.max(
          0,
          awarded
        );


      awarded =
        Math.min(
          available,
          awarded
        );


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
        Math.min(
          maximum,
          total
        ) * 100
      ) / 100;


    evaluation.total_marks =
      total;


    evaluation.maximum_marks =
      maximum;


    evaluation.percentage =
      maximum > 0

        ? Math.round(
            (
              total /
              maximum
            ) *
            10000
          ) / 100

        : 0;


    /* =========================
       RESPONSE
    ========================= */

    return res.status(200).json({

      success:
        true,

      evaluation,

      metadata: {

        level,

        subject,

        subjectKey,

        testType,

        modelType,

        pyqAttempt,

        checkingMode,

        descriptiveMaximum:
          maximum,

        materialPrefix:
          prefix,

        questionPaper:
          questionPaper.pathname,

        suggestedAnswer:
          suggestedAnswer.pathname,

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
        error?.message ||
        "Unknown error"

    });

  }

}
