import { list } from "@vercel/blob";

/*
==================================================
 VERCEL FUNCTION CONFIG
==================================================
*/
export const config = {
  maxDuration: 60
};

export default async function handler(req, res) {

  /*
  ==================================================
   ALWAYS RETURN JSON
  ==================================================
  */

  res.setHeader("Content-Type", "application/json");

  if (req.method !== "POST") {
    return res.status(405).json({
      success: false,
      error: "Method not allowed."
    });
  }

  try {

    /*
    ==================================================
     READ REQUEST
    ==================================================
    */

    const body = req.body || {};

    const {
      answerSheetBase64,
      answerSheetName,
      subject,
      subjectKey,
      testType,
      checkingMode,
      descriptiveMaximum
    } = body;

    /*
    ==================================================
     VALIDATION
    ==================================================
    */

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

    if (
      !Number.isFinite(maximumMarks) ||
      maximumMarks <= 0
    ) {
      return res.status(400).json({
        success: false,
        error: "Invalid descriptive maximum marks."
      });
    }

    /*
    ==================================================
     ENVIRONMENT VARIABLES
    ==================================================
    */

    const gatewayKey =
      process.env.AI_GATEWAY_API_KEY;

    const blobToken =
      process.env.BLOB_READ_WRITE_TOKEN;

    if (!gatewayKey) {
      console.error(
        "Missing AI_GATEWAY_API_KEY"
      );

      return res.status(500).json({
        success: false,
        error:
          "AI Gateway API key is not configured."
      });
    }

    if (!blobToken) {
      console.error(
        "Missing BLOB_READ_WRITE_TOKEN"
      );

      return res.status(500).json({
        success: false,
        error:
          "Vercel Blob token is not configured."
      });
    }

    /*
    ==================================================
     SAFE PATH VALUES
    ==================================================
    */

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

    /*
    ==================================================
     FIND MATERIALS
    ==================================================
    */

    const materialPrefix =
      `materials/${safeSubject}/${safeTestType}/`;

    console.log(
      "Looking for materials:",
      materialPrefix
    );

    const materialList =
      await list({
        prefix: materialPrefix,
        token: blobToken
      });

    const blobs =
      Array.isArray(materialList.blobs)
        ? materialList.blobs
        : [];

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

    console.log(
      "Question papers found:",
      questionPapers.length
    );

    console.log(
      "Suggested answers found:",
      suggestedAnswers.length
    );

    if (!questionPapers.length) {
      return res.status(404).json({
        success: false,
        error:
          `No Question Paper found for ${subject} - ${testType}.`
      });
    }

    if (!suggestedAnswers.length) {
      return res.status(404).json({
        success: false,
        error:
          `No Suggested Answer found for ${subject} - ${testType}.`
      });
    }

    const questionPaper =
      questionPapers[0];

    const suggestedAnswer =
      suggestedAnswers[0];

    /*
    ==================================================
     DOWNLOAD PRIVATE BLOBS
    ==================================================
    */

    async function downloadBlob(blob) {

      console.log(
        "Downloading:",
        blob.pathname
      );

      const response =
        await fetch(
          blob.url,
          {
            method: "GET",
            headers: {
              Authorization:
                `Bearer ${blobToken}`
            }
          }
        );

      if (!response.ok) {

        const errorText =
          await response.text()
            .catch(() => "");

        throw new Error(
          `Unable to download ${blob.pathname}. ` +
          `HTTP ${response.status}. ` +
          errorText.slice(0, 300)
        );
      }

      const arrayBuffer =
        await response.arrayBuffer();

      if (!arrayBuffer.byteLength) {
        throw new Error(
          `Downloaded file is empty: ${blob.pathname}`
        );
      }

      return Buffer
        .from(arrayBuffer)
        .toString("base64");
    }

    /*
    ==================================================
     DOWNLOAD QUESTION PAPER
    ==================================================
    */

    const questionPaperBase64 =
      await downloadBlob(
        questionPaper
      );

    /*
    ==================================================
     DOWNLOAD SUGGESTED ANSWER
    ==================================================
    */

    const suggestedAnswerBase64 =
      await downloadBlob(
        suggestedAnswer
      );

    /*
    ==================================================
     TEST TYPE
    ==================================================
    */

    const formattedTestType =
      testType === "MODEL_TEST"
        ? "Model Test"
        : testType === "OTHER"
        ? "Other"
        : testType;

    /*
    ==================================================
     CHECKING MODE
    ==================================================
    */

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
- Minor calculation errors may receive partial marks.
- Conceptual errors must be penalised.
- Missing essential workings should affect marks.
`;

    /*
    ==================================================
     AI PROMPT
    ==================================================
    */

    const prompt = `
You are an expert CA Intermediate examiner.

Evaluate the student's answer sheet against:

1. Official Question Paper
2. Official/reference Suggested Answer
3. Student Answer Sheet

Do not evaluate from the student's answer alone.

First identify every descriptive question from the Question Paper.

Then locate the student's corresponding answer.

Then compare it with the Suggested Answer.

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
  ? "ICAI Strict"
  : "Moderate"}

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

9. A wrong final answer with substantially correct working may receive
   appropriate partial marks.

10. A wrong approach should not receive marks merely because it contains
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

Before returning the result verify:

- Every descriptive question is included.
- MCQs are excluded.
- Marks available are correct.
- Awarded marks are correct.
- Total marks are mathematically correct.
- Total does not exceed ${maximumMarks}.
- Percentage is mathematically correct.

Return ONLY valid JSON.
`;

    /*
    ==================================================
     AI REQUEST
    ==================================================
    */

    console.log(
      "Sending evaluation request to AI Gateway..."
    );

    const controller =
      new AbortController();

    const timeout =
      setTimeout(
        () => controller.abort(),
        52000
      );

    let aiResponse;

    try {

      aiResponse =
        await fetch(
          "https://ai-gateway.vercel.sh/v1/responses",
          {
            method: "POST",

            headers: {
              "Content-Type":
                "application/json",

              Authorization:
                `Bearer ${gatewayKey}`
            },

            signal:
              controller.signal,

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

                      text:
                        prompt
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
                        answerSheetBase64
                          .startsWith("data:")
                          ? answerSheetBase64
                          : `data:application/pdf;base64,${answerSheetBase64}`
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

    } catch (error) {

      clearTimeout(timeout);

      if (
        error?.name ===
        "AbortError"
      ) {

        console.error(
          "AI Gateway request timed out."
        );

        return res.status(504).json({
          success: false,
          error:
            "AI evaluation timed out. Please try again."
        });

      }

      console.error(
        "AI Gateway network error:",
        error
      );

      return res.status(502).json({
        success: false,
        error:
          "Unable to connect to AI Gateway.",
        details:
          error?.message ||
          "Network error"
      });
    }

    clearTimeout(timeout);

    /*
    ==================================================
     READ AI RESPONSE
    ==================================================
    */

    let rawResult;

    try {

      rawResult =
        await aiResponse.json();

    } catch (error) {

      console.error(
        "AI response was not JSON:",
        error
      );

      return res.status(502).json({
        success: false,
        error:
          "AI Gateway returned an invalid response."
      });
    }

    /*
    ==================================================
     AI HTTP ERROR
    ==================================================
    */

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

    /*
    ==================================================
     EXTRACT OUTPUT TEXT
    ==================================================
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

    outputText =
      outputText.trim();

    if (!outputText) {

      console.error(
        "Empty AI output:",
        rawResult
      );

      return res.status(502).json({
        success: false,
        error:
          "AI returned an empty evaluation."
      });
    }

    /*
    ==================================================
     PARSE AI JSON
    ==================================================
    */

    let evaluation;

    try {

      evaluation =
        JSON.parse(
          outputText
        );

    } catch (error) {

      console.error(
        "AI returned invalid JSON:",
        outputText.slice(0, 2000)
      );

      return res.status(502).json({
        success: false,
        error:
          "AI returned an invalid evaluation format.",
        details:
          "The AI response was not valid JSON."
      });
    }

    /*
    ==================================================
     VALIDATE STRUCTURE
    ==================================================
    */

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

    /*
    ==================================================
     SCORE VALIDATION
    ==================================================
    */

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

        return res.status(502).json({
          success: false,
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

    /*
    ==================================================
     FINAL SCORE
    ==================================================
    */

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
    ==================================================
     SUCCESS
    ==================================================
    */

    console.log(
      "Evaluation completed:",
      total,
      "/",
      maximumMarks
    );

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

    /*
    ==================================================
     FINAL SAFETY NET
    ==================================================
    */

    console.error(
      "CHECK ERROR:",
      error
    );

    if (!res.headersSent) {

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

}
