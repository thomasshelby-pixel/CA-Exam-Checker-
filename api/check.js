import { list } from "@vercel/blob";

export const runtime = "nodejs";
export const maxDuration = 300;

export default async function handler(req, res) {

  /* ==================================================
     METHOD
  ================================================== */

  if (req.method !== "POST") {

    return res.status(405).json({
      error: "Method not allowed"
    });

  }


  try {

    /* ==================================================
       BODY
    ================================================== */

    const body = req.body || {};

    const {
      answerSheetBase64,
      answerSheetName,

      questionPaperBase64,
      questionPaperName,

      suggestedAnswerBase64,
      suggestedAnswerName,

      subject,
      subjectKey,
      testType,
      checkingMode,
      descriptiveMaximum
    } = body;


    /* ==================================================
       VALIDATION
    ================================================== */

    if (!answerSheetBase64) {

      return res.status(400).json({
        error: "Answer sheet is required."
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
        error:
          "Invalid descriptive maximum marks."
      });

    }


    /* ==================================================
       AI GATEWAY KEY
       
       Supports:
       1. AI_GATEWAY_API_KEY
       2. AI_Gateway_API_KEY
    ================================================== */

    const AI_GATEWAY_KEY =
      process.env.AI_GATEWAY_API_KEY ||
      process.env.AI_Gateway_API_KEY;


    if (!AI_GATEWAY_KEY) {

      return res.status(500).json({
        error:
          "AI Gateway API key is not configured.",
        hint:
          "Add AI_GATEWAY_API_KEY in Vercel Environment Variables and redeploy."
      });

    }


    /* ==================================================
       BLOB TOKEN
       
       Supports normal Vercel Blob token.
    ================================================== */

    const BLOB_TOKEN =
      process.env.BLOB_READ_WRITE_TOKEN ||
      process.env.BLOB_READ_WRITE_TOKEN;


    if (!BLOB_TOKEN) {

      return res.status(500).json({
        error:
          "Vercel Blob token is not configured."
      });

    }


    /* ==================================================
       SAFE PATH
    ================================================== */

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


    /* ==================================================
       FIND TEST MATERIAL
    ================================================== */

    let questionPaper = null;
    let suggestedAnswer = null;


    /*
      If frontend already supplied the files,
      we can use them directly.

      Otherwise find them from Vercel Blob.
    */

    if (
      questionPaperBase64 &&
      suggestedAnswerBase64
    ) {

      questionPaper = {

        pathname:
          questionPaperName ||
          "question-paper.pdf",

        base64:
          questionPaperBase64

      };


      suggestedAnswer = {

        pathname:
          suggestedAnswerName ||
          "suggested-answer.pdf",

        base64:
          suggestedAnswerBase64

      };

    } else {

      const materialPrefix =
        `materials/${safeSubject}/${safeTestType}/`;


      const materialList =
        await list({

          prefix:
            materialPrefix,

          token:
            BLOB_TOKEN

        });


      const blobs =
        materialList.blobs || [];


      const questionPapers =
        blobs
          .filter(
            blob =>
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
          .filter(
            blob =>
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


      questionPaper =
        questionPapers[0];


      suggestedAnswer =
        suggestedAnswers[0];

    }


    /* ==================================================
       DOWNLOAD BLOB
    ================================================== */

    async function downloadBlob(blob) {

      if (blob.base64) {

        return blob.base64;

      }


      const response =
        await fetch(
          blob.url,
          {
            headers: {

              Authorization:
                `Bearer ${BLOB_TOKEN}`

            }
          }
        );


      if (!response.ok) {

        throw new Error(
          `Unable to download ${blob.pathname}`
        );

      }


      const arrayBuffer =
        await response.arrayBuffer();


      return Buffer
        .from(arrayBuffer)
        .toString("base64");

    }


    /* ==================================================
       MATERIAL BASE64
    ================================================== */

    const finalQuestionPaperBase64 =
      await downloadBlob(
        questionPaper
      );


    const finalSuggestedAnswerBase64 =
      await downloadBlob(
        suggestedAnswer
      );


    /* ==================================================
       TEST TYPE
    ================================================== */

    let formattedTestType =
      testType;


    if (
      testType ===
      "MODEL_TEST"
    ) {

      formattedTestType =
        "Model Test";

    }


    if (
      testType ===
      "OTHER"
    ) {

      formattedTestType =
        "Other";

    }


    /* ==================================================
       CHECKING MODE
    ================================================== */

    const isStrict =
      checkingMode === "strict";


    const checkingInstructions =
      isStrict

        ? `

STRICT ICAI-STYLE CHECKING

- Be conservative with marks.
- Do not award marks merely for keywords.
- Penalise incorrect concepts.
- Penalise incorrect provisions.
- Penalise wrong calculations.
- Give step marks only for genuinely correct steps.
- Missing essential workings should lose marks.
- Theory answers must contain relevant provision/concept,
  application and conclusion where applicable.
- Presentation matters where it affects clarity.
- Do not give marks simply because the final answer happens
  to match.

`

        : `

MODERATE EXAMINER-STYLE CHECKING

- Give reasonable step marking.
- Give credit for substantially correct approaches.
- Minor calculation errors may receive partial marks.
- Conceptual errors must still be penalised.
- Missing essential workings should affect marks.
- Do not award marks for an incorrect approach merely because
  some keywords or numbers are present.

`;


    /* ==================================================
       AI PROMPT
    ================================================== */

    const prompt = `

You are an expert CA Intermediate examiner.

Your job is to evaluate the student's answer sheet exactly
like a professional CA Intermediate examiner.

You have THREE documents:

1. OFFICIAL QUESTION PAPER
2. OFFICIAL / REFERENCE SUGGESTED ANSWER
3. STUDENT ANSWER SHEET

The Question Paper determines:

- Question numbers
- Sub-parts
- Marks
- Question structure
- Internal choices
- Which questions are MCQs
- Which questions are descriptive

The Suggested Answer determines:

- Expected concepts
- Expected provisions
- Calculations
- Working notes
- Adjustments
- Final answers
- Relevant points

The Student Answer Sheet determines:

- What the student actually attempted
- What the student wrote
- What calculations were performed
- What workings were shown
- What conclusion was given

==================================================
EXAM INFORMATION
==================================================

SUBJECT:
${subject || "Not specified"}

TEST TYPE:
${formattedTestType}

CHECKING MODE:
${
  isStrict
    ? "ICAI STRICT"
    : "MODERATE"
}

DESCRIPTIVE MAXIMUM:
${maximumMarks}

==================================================
CHECKING INSTRUCTIONS
==================================================

${checkingInstructions}

==================================================
IMPORTANT RULES
==================================================

1. CHECK ONLY DESCRIPTIVE QUESTIONS.

2. COMPLETELY IGNORE MCQs.

3. Do not award marks to MCQs.

4. Do not invent questions.

5. Do not invent marks.

6. The Question Paper is the authority for marks.

7. The Suggested Answer is the primary reference
   for expected content.

8. Compare the student's actual answer with the
   expected answer.

9. Give genuine partial / step marks.

10. A correct method with a minor arithmetic error
    may receive substantial partial marks.

11. A wrong method must not receive marks merely
    because it contains similar numbers or keywords.

12. Theory questions should be checked for:

    - Relevant provision
    - Correct concept
    - Application
    - Analysis
    - Conclusion
    - Important legal/accounting/audit/tax terms

13. Practical questions should be checked for:

    - Formula
    - Working
    - Calculations
    - Adjustments
    - Treatment
    - Final answer

14. If a question is not attempted:

    marks_awarded = 0

    status = "not_attempted"

15. If handwriting/content is genuinely impossible
    to read:

    status = "unclear"

    Do NOT guess the student's answer.

16. Never award more than marks_available.

17. Never award negative marks.

18. Include EVERY descriptive question found
    in the Question Paper.

19. Exclude EVERY MCQ.

20. Handle internal choices carefully.

21. If a question contains multiple sub-parts,
    evaluate the relevant sub-parts and combine
    their marks correctly.

22. Remarks must explain WHY marks were lost.

23. Do not give generic praise.

24. Do not reveal hidden chain-of-thought or
    internal reasoning.

25. Do not create fake examiner comments.

26. If the student's answer is materially different
    from the suggested answer but is technically
    correct and supported by the question, award
    appropriate marks.

27. Do not penalise a student merely because their
    wording differs from the Suggested Answer.

28. For accounting / costing / FM / taxation questions,
    verify calculations carefully.

29. For law / audit / theory questions, verify the
    substance of the provision and application.

==================================================
FINAL VERIFICATION
==================================================

Before returning the result verify:

- Every descriptive question is included.
- MCQs are excluded.
- Question marks match the Question Paper.
- No question exceeds its available marks.
- Total marks equal the sum of awarded marks.
- Total marks do not exceed ${maximumMarks}.
- Percentage is mathematically correct.
- No negative marks exist.
- Every question has a status.
- Every question has meaningful remarks.

Return ONLY valid JSON.

`;


    /* ==================================================
       AI REQUEST
    ================================================== */

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
              `Bearer ${AI_GATEWAY_KEY}`

          },

          body:
            JSON.stringify({

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
                        "input_text",

                      text:
                        `QUESTION PAPER:
${questionPaper.pathname}`
                    },


                    {
                      type:
                        "input_file",

                      filename:
                        String(
                          questionPaper.pathname
                        )
                          .split("/")
                          .pop(),

                      file_data:
                        `data:application/pdf;base64,${finalQuestionPaperBase64}`
                    },


                    {
                      type:
                        "input_text",

                      text:
                        `SUGGESTED ANSWER:
${suggestedAnswer.pathname}`
                    },


                    {
                      type:
                        "input_file",

                      filename:
                        String(
                          suggestedAnswer.pathname
                        )
                          .split("/")
                          .pop(),

                      file_data:
                        `data:application/pdf;base64,${finalSuggestedAnswerBase64}`
                    },


                    {
                      type:
                        "input_text",

                      text:
                        `STUDENT ANSWER SHEET:
${answerSheetName || "answer-sheet.pdf"}`
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


    /* ==================================================
       READ AI RESPONSE
    ================================================== */

    const rawResult =
      await aiResponse.json();


    if (!aiResponse.ok) {

      console.error(
        "AI Gateway HTTP error:",
        rawResult
      );


      return res.status(
        aiResponse.status >= 400 &&
        aiResponse.status < 600
          ? aiResponse.status
          : 500
      ).json({

        error:
          "AI evaluation failed.",

        details:
          rawResult?.error?.message ||
          rawResult?.error ||
          rawResult?.message ||
          JSON.stringify(
            rawResult
          )

      });

    }


    /* ==================================================
       EXTRACT OUTPUT
    ================================================== */

    let outputText =
      "";


    if (
      typeof rawResult.output_text ===
      "string"
    ) {

      outputText =
        rawResult.output_text.trim();

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


      return res.status(500).json({

        error:
          "AI returned an empty evaluation.",

        details:
          "No output text was returned by AI Gateway."

      });

    }


    /* =====
