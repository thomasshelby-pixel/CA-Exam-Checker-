import { list } from "@vercel/blob";

/* =====================================================
   HELPERS
===================================================== */

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


async function downloadBlob(
  blob
) {

  /*
    Blob is public, therefore normal
    fetch is sufficient.
  */

  const response =
    await fetch(
      blob.url
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


/* =====================================================
   HANDLER
===================================================== */

export default async function handler(
  req,
  res
) {

  if (
    req.method !== "POST"
  ) {

    return res.status(405).json({
      error:
        "Method not allowed"
    });

  }


  try {

    const {

      answerSheetBase64,

      answerSheetName =
        "answer-sheet.pdf",

      level,

      subject =
        "Combined Model Test",

      subjectKey =
        "combined",

      testType,

      modelType = "",

      pyqAttempt = "",

      checkingMode =
        "strict",

      descriptiveMaximum

    } = req.body || {};


    /* =================================================
       ENVIRONMENT
    ================================================= */

    const blobToken =
      process.env
        .BLOB_READ_WRITE_TOKEN;

    const aiKey =
      process.env
        .AI_GATEWAY_API_KEY;


    if (!blobToken) {

      return res.status(500).json({
        error:
          "BLOB_READ_WRITE_TOKEN is not configured."
      });

    }


    if (!aiKey) {

      return res.status(500).json({
        error:
          "AI_GATEWAY_API_KEY is not configured."
      });

    }


    /* =================================================
       VALIDATION
    ================================================= */

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


    const maximum =
      Number(
        descriptiveMaximum
      );


    if (
      !Number.isFinite(
        maximum
      ) ||
      maximum < 0
    ) {

      return res.status(400).json({
        error:
          "Invalid descriptive maximum marks."
      });

    }


    /* =================================================
       MATERIAL PATH
    ================================================= */

    let materialPrefix;


    /*
      MODEL TEST

      Example:

      materials/
      inter/
      MODEL_TEST/
      model-GROUP_1/
      NA/
    */

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


      materialPrefix =
        `materials/` +
        `${safe(level)}/` +
        `MODEL_TEST/` +
        `model-${safe(modelType)}/` +
        `NA/`;

    }

    /*
      NORMAL TEST
    */

    else {

      if (!subjectKey) {

        return res.status(400).json({
          error:
            "Subject is required."
        });

      }


      /*
        PYQ requires attempt
      */

      if (
        testType ===
        "PYQ"
      ) {

        if (!pyqAttempt) {

          return res.status(400).json({
            error:
              "PYQ attempt is required."
          });

        }

      }


      const attempt =
        testType ===
        "PYQ"

          ? safe(pyqAttempt)

          : "NA";


      materialPrefix =
        `materials/` +
        `${safe(level)}/` +
        `${safe(testType)}/` +
        `${safe(subjectKey)}/` +
        `${attempt}/`;

    }


    console.log(
      "MATERIAL PREFIX:",
      materialPrefix
    );


    /* =================================================
       FIND MATERIALS
    ================================================= */

    const materialResult =
      await list({

        prefix:
          materialPrefix,

        token:
          blobToken

      });


    const blobs =
      materialResult?.blobs ||
      [];


    console.log(
      "FOUND BLOBS:",
      blobs.map(
        blob =>
          blob.pathname
      )
    );


    if (!blobs.length) {

      return res.status(404).json({

        error:
          "Test material not found.",

        details:
          `No material found inside ${materialPrefix}`,

        availableFiles:
          []

      });

    }


    /* =================================================
       FIND QUESTION PAPER
    ================================================= */

    let questionPaper;

    let suggestedAnswer;


    /*
      MODEL TEST

      ONE PDF contains both
      question paper and
      suggested answer.
    */

    if (
      testType ===
      "MODEL_TEST"
    ) {

      questionPaper =
        latest(
          blobs,
          "/model-test-"
        );


      suggestedAnswer =
        questionPaper;


      if (!questionPaper) {

        return res.status(404).json({

          error:
            "Model Test PDF is missing.",

          details:
            materialPrefix,

          availableFiles:
            blobs.map(
              blob =>
                blob.pathname
            )

        });

      }

    }

    /*
      MTP / RTP / PYQ / OTHER
    */

    else {

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


      if (!questionPaper) {

        return res.status(404).json({

          error:
            "Question Paper is missing.",

          details:
            materialPrefix,

          availableFiles:
            blobs.map(
              blob =>
                blob.pathname
            )

        });

      }


      if (!suggestedAnswer) {

        return res.status(404).json({

          error:
            "Suggested Answer is missing.",

          details:
            materialPrefix,

          availableFiles:
            blobs.map(
              blob =>
                blob.pathname
            )

        });

      }

    }


    /* =================================================
       DOWNLOAD MATERIAL
    ================================================= */

    const questionPaperBase64 =
      await downloadBlob(
        questionPaper
      );


    const suggestedAnswerBase64 =
      await downloadBlob(
        suggestedAnswer
      );


    /* =================================================
       CHECKING MODE
    ================================================= */

    const checkingInstructions =

      checkingMode ===
      "strict"

        ? `
STRICT ICAI-STYLE CHECKING:

- Be conservative with marks.
- Award marks only for demonstrated knowledge.
- Penalise wrong concepts.
- Penalise wrong provisions.
- Penalise incorrect calculations.
- Give step marks only for genuinely correct steps.
- Missing required workings should lose marks.
- Theory must contain relevant provision,
  concept, application and conclusion.
`

        : `
MODERATE EXAMINER-STYLE CHECKING:

- Give reasonable step marking.
- Give credit for substantially correct approaches.
- Minor calculation mistakes may receive partial marks.
- Major conceptual errors must be penalised.
- Missing essential workings should affect marks.
`;


    /* =================================================
       MODEL TEST INSTRUCTION
    ================================================= */

    const modelInstruction =

      testType ===
      "MODEL_TEST"

        ? `
MODEL TEST STRUCTURE:

The uploaded Model Test PDF is ONE PDF.

The same PDF contains:

1. Question Paper
2. Suggested Answer

Identify the Question Paper section
and Suggested Answer section inside
the same PDF.

Do NOT expect a separate Suggested Answer PDF.
`

        : "";


    /* =================================================
       PYQ INSTRUCTION
    ================================================= */

    const pyqInstruction =

      testType ===
      "PYQ"

        ? `
PYQ ATTEMPT:

This evaluation is specifically for:

${pyqAttempt}

Use ONLY the material belonging to this
exact PYQ attempt.

Do not substitute another attempt.
`

        : "";


    /* =================================================
       AI PROMPT
    ================================================= */

    const prompt = `

You are an expert CA examination checker.

Evaluate the student's answer sheet against
the supplied official/reference material.

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

${checkingInstructions}

${modelInstruction}

${pyqInstruction}


==================================================
CORE RULES
==================================================

1. Evaluate ONLY descriptive questions.

2. IGNORE MCQs completely.

3. Do not invent questions.

4. Do not invent marks.

5. Question Paper determines:
   - question number
   - sub-part
   - marks
   - question structure

6. Suggested Answer determines:
   - expected answer
   - calculations
   - provisions
   - concepts
   - workings
   - conclusions

7. Compare student's answer directly
   against the expected answer.

8. Award genuine partial marks.

9. Correct method with wrong final answer
   may receive appropriate step marks.

10. Wrong approach must not receive marks
    merely because some keywords or numbers
    are similar.

11. Theory questions must be checked for:
    - provision
    - concept
    - application
    - conclusion
    - relevant keywords

12. Practical questions must be checked for:
    - formula
    - working
    - calculation
    - adjustment
    - final answer

13. Unattempted:
    marks_awarded = 0
    status = "not_attempted"

14. Unclear handwriting:
    status = "unclear"

15. Never award more than available marks.

16. Never award negative marks.

17. Include every descriptive question.

18. Exclude MCQs.

19. Handle internal choices correctly.

20. Do not award marks twice for an internal choice.

21. Remarks must explain actual lost marks.

22. Do not give generic praise.

23. Do not reveal hidden reasoning.

24. Total must be mathematically correct.

25. Maximum marks must equal:
    ${maximum}

26. Percentage must be calculated mathematically.

27. If a question is descriptive but the
    student did not attempt it, include it
    as not_attempted with zero marks.


==================================================
FOUNDATION MCQ RULE
==================================================

If the subject is:

Quantitative Aptitude
OR
Business Economics

the paper may be entirely MCQ.

Ignore all MCQs for descriptive evaluation.

Do NOT apply negative marking to the
descriptive evaluation score.

The frontend/backend descriptive maximum
must represent only descriptive marks.


==================================================
FINAL VERIFICATION
==================================================

Before returning the result verify:

- Every descriptive question included
- MCQs excluded
- Correct marks available
- Correct awarded marks
- No negative marks
- No awarded marks above available marks
- Correct total
- Correct maximum
- Correct percentage


Return ONLY valid JSON.
`;


    /* =================================================
       AI REQUEST
    ================================================= */

    const aiPayload = {

      model:
        "openai/gpt-5.6-sol",

      reasoning: {
        effort:
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
                questionPaper
                  .pathname
                  .split("/")
                  .pop(),

              file_data:
                `data:application/pdf;base64,${questionPaperBase64}`

            },

            {
              type:
                "input_file",

              filename:
                suggestedAnswer
                  .pathname
                  .split("/")
                  .pop(),

              file_data:
                `data:application/pdf;base64,${suggestedAnswerBase64}`

            },

            {
              type:
                "input_file",

              filename:
                answerSheetName,

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

    };


    console.log(
      "Sending evaluation request to AI..."
    );


    const aiResponse =
      await fetch(

        "https://ai-gateway.vercel.sh/v1/responses",

        {

          method:
            "POST",

          headers: {

            "Content-Type":
              "application/json",

            "Authorization":
              `Bearer ${aiKey}`

          },

          body:
            JSON.stringify(
              aiPayload
            )

        }

      );


    /* =================================================
       AI RESPONSE
    ================================================= */

    const rawResult =
      await aiResponse.json();


    console.log(
      "AI STATUS:",
      aiResponse.status
    );


    if (
      !aiResponse.ok
    ) {

      console.error(
        "AI GATEWAY ERROR:",
        JSON.stringify(
          rawResult,
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
          rawResult?.error?.message ||
          rawResult?.error?.details ||
          rawResult?.message ||
          JSON.stringify(
            rawResult
          )

      });

    }


    /* =================================================
       EXTRACT OUTPUT
    ================================================= */

    let outputText =
      "";


    if (
      typeof
      rawResult.output_text ===
      "string"
    ) {

      outputText =
        rawResult.output_text;

    }


    /*
      Fallback:
      Responses API output array
    */

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
            typeof
            content.text ===
            "string"
          ) {

            outputText +=
              content.text;

          }

        }

      }

    }


    /*
      Additional fallback
    */

    if (
      !outputText &&
      rawResult.output &&
      typeof rawResult.output ===
        "string"
    ) {

      outputText =
        rawResult.output;

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
            5000
          )

      });

    }


    /* =================================================
       PARSE JSON
    ================================================= */

    let evaluation;


    try {

      evaluation =
        JSON.parse(
          outputText
        );

    } catch (error) {

      console.error(
        "JSON PARSE ERROR:",
        outputText
      );


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


    /* =================================================
       VALIDATE STRUCTURE
    ================================================= */

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


    /* =================================================
       SCORE
    ================================================= */

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


      /*
        Never negative
      */

      awarded =
        Math.max(
          0,
          awarded
        );


      /*
        Never above question marks
      */

      awarded =
        Math.min(
          available,
          awarded
        );


      /*
        Round to 2 decimals
      */

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


    /*
      Never exceed maximum
    */

    total =
      Math.min(
        total,
        maximum
      );


    const percentage =
      maximum > 0

        ? Math.round(
            (
              total /
              maximum
            ) *
            10000
          ) / 100

        : 0;


    evaluation.total_marks =
      total;


    evaluation.maximum_marks =
      maximum;


    evaluation.percentage =
      percentage;


    /* =================================================
       FINAL RESPONSE
    ================================================= */

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

        materialPrefix,

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
