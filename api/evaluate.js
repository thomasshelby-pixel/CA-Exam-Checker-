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
      questionPaperBase64,
      questionPaperName,
      suggestedAnswerBase64,
      suggestedAnswerName,
      subject,
      testType,
      checkingMode,
      descriptiveMaximum
    } = req.body || {};

    /* ==================================================
       VALIDATION
    ================================================== */

    if (!process.env.AI_GATEWAY_API_KEY) {
      return res.status(500).json({
        error: "AI_GATEWAY_API_KEY is not configured in Vercel."
      });
    }

    if (!answerSheetBase64) {
      return res.status(400).json({
        error: "Student answer sheet is missing."
      });
    }

    if (!questionPaperBase64) {
      return res.status(400).json({
        error: "Question Paper is missing."
      });
    }

    if (!suggestedAnswerBase64) {
      return res.status(400).json({
        error: "Suggested Answer is missing."
      });
    }

    if (!subject) {
      return res.status(400).json({
        error: "Subject is missing."
      });
    }

    const maximumMarks = Number(descriptiveMaximum);

    if (
      !Number.isFinite(maximumMarks) ||
      maximumMarks <= 0
    ) {
      return res.status(400).json({
        error: "Invalid descriptive maximum marks."
      });
    }


    /* ==================================================
       SAFE FILE NAMES
    ================================================== */

    const cleanFilename = (name, fallback) => {

      return String(name || fallback)
        .replace(/[^a-zA-Z0-9._-]/g, "_");

    };


    const studentFilename =
      cleanFilename(
        answerSheetName,
        "answer-sheet.pdf"
      );

    const qpFilename =
      cleanFilename(
        questionPaperName,
        "question-paper.pdf"
      );

    const suggestedFilename =
      cleanFilename(
        suggestedAnswerName,
        "suggested-answer.pdf"
      );


    /* ==================================================
       TEST TYPE
    ================================================== */

    let formattedTestType = testType || "OTHER";

    if (testType === "MODEL_TEST") {
      formattedTestType = "Model Test";
    }

    if (testType === "MTP") {
      formattedTestType = "MTP";
    }

    if (testType === "RTP") {
      formattedTestType = "RTP";
    }

    if (testType === "OTHER") {
      formattedTestType = "Other";
    }


    /* ==================================================
       CHECKING MODE
    ================================================== */

    const strict =
      checkingMode === "strict";

    const checkingInstructions =
      strict
        ? `
STRICT ICAI-STYLE CHECKING:

- Be conservative while awarding marks.
- Do not award marks merely because keywords are present.
- Check whether the actual concept is correct.
- Check provisions carefully.
- Check calculations and workings.
- Give step marks only for genuinely correct steps.
- Penalise incorrect treatment.
- Penalise missing essential workings.
- Penalise wrong conclusions.
- For theory, check provision, explanation, application and conclusion.
- For practical questions, check formula, working, adjustments and final answer.
- Do not be unnecessarily generous.
`
        : `
MODERATE EXAMINER-STYLE CHECKING:

- Award reasonable step marks.
- Give credit for substantially correct approaches.
- Minor arithmetic mistakes may receive partial marks where the method is correct.
- Conceptual mistakes must still be penalised.
- Missing essential workings should affect marks.
- Do not award marks simply because the answer contains similar keywords.
`;


    /* ==================================================
       AI PROMPT
    ================================================== */

    const prompt = `

You are an expert CA Intermediate examiner.

Your task is to evaluate a student's answer sheet.

You have THREE documents:

DOCUMENT 1:
Official / Reference Question Paper

DOCUMENT 2:
Official / Reference Suggested Answer

DOCUMENT 3:
Student Answer Sheet

You MUST compare the student's answers against both the Question Paper
and the Suggested Answer.

Do NOT evaluate the student's answer sheet independently.

==================================================
EXAM INFORMATION
==================================================

SUBJECT:
${subject}

TEST TYPE:
${formattedTestType}

DESCRIPTIVE MAXIMUM:
${maximumMarks}

CHECKING STANDARD:
${strict ? "ICAI STRICT" : "MODERATE"}

${checkingInstructions}

==================================================
QUESTION PAPER RULE
==================================================

The Question Paper is the authority for:

- Question numbers
- Sub-question numbers
- Marks available
- Question structure
- Internal choices
- Which questions are descriptive

The Suggested Answer is the primary reference for:

- Correct concepts
- Correct provisions
- Correct calculations
- Correct workings
- Correct adjustments
- Correct conclusions
- Expected answer structure

==================================================
MCQ RULE
==================================================

IGNORE MCQs COMPLETELY.

Do NOT include MCQs in the result.

Only descriptive questions should appear in the
questions array.

==================================================
QUESTION IDENTIFICATION
==================================================

First identify ALL descriptive questions from the Question Paper.

Then locate the student's corresponding answer.

Then compare that answer against the Suggested Answer.

Do not invent questions.

Do not invent marks.

Do not assume a question exists if it is not present in the Question Paper.

==================================================
MARKING RULES
==================================================

1. Never award more than marks_available.

2. Never award negative marks.

3. Unattempted question:

marks_awarded = 0

status = "not_attempted"

4. If handwriting/content is genuinely impossible to read:

status = "unclear"

Do not confidently guess what the student wrote.

5. Correct answer:

Award marks according to the actual correctness.

6. Partially correct answer:

Award only the marks justified by the correct portions.

7. Wrong final answer:

If the working/method is substantially correct,
give appropriate step marks.

8. Wrong approach:

Do NOT award marks simply because some numbers,
keywords or phrases resemble the Suggested Answer.

9. Theory questions:

Check:

- Relevant provision
- Correct concept
- Explanation
- Application
- Conclusion
- Important keywords

10. Practical questions:

Check:

- Formula
- Working notes
- Calculations
- Adjustments
- Presentation
- Final answer

11. Remarks must explain WHY marks were lost.

Avoid generic comments such as:

"Good attempt."

"Needs improvement."

Instead write specific remarks such as:

"Correct provision identified, but the exception was not applied."

or

"Working is correct up to the depreciation calculation, but the final
adjustment has been omitted."

12. Handle internal choices carefully.

If the student attempted one option, evaluate the attempted option.

Do not award marks for an unattempted alternative.

==================================================
VERY IMPORTANT
==================================================

Do NOT assume that the student's question numbering perfectly matches
the Question Paper.

Use the actual question text/content where necessary to identify the
corresponding answer.

If a question is genuinely not found in the student's answer sheet,
mark it as:

not_attempted

==================================================
FINAL VALIDATION
==================================================

Before returning the result:

- Include every descriptive question.
- Exclude every MCQ.
- Use the Question Paper for marks available.
- Use the Suggested Answer for correctness.
- Do not exceed the maximum marks.
- Calculate total marks yourself.
- Calculate percentage yourself.
- Make sure the percentage is based on descriptive maximum.
- Do not reveal hidden reasoning.

Return ONLY the requested JSON object.
`;


    /* ==================================================
       AI REQUEST
    ================================================== */

    const aiResponse = await fetch(
      "https://ai-gateway.vercel.sh/v1/responses",
      {
        method: "POST",

        headers: {
          "Content-Type": "application/json",

          "Authorization":
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
              role: "user",

              content: [

                {
                  type: "input_text",
                  text: prompt
                },

                {
                  type: "input_text",
                  text:
                    `OFFICIAL QUESTION PAPER: ${qpFilename}`
                },

                {
                  type: "input_file",

                  filename:
                    qpFilename,

                  file_data:
                    `data:application/pdf;base64,${questionPaperBase64}`
                },

                {
                  type: "input_text",

                  text:
                    `SUGGESTED ANSWER: ${suggestedFilename}`
                },

                {
                  type: "input_file",

                  filename:
                    suggestedFilename,

                  file_data:
                    `data:application/pdf;base64,${suggestedAnswerBase64}`
                },

                {
                  type: "input_text",

                  text:
                    `STUDENT ANSWER SHEET: ${studentFilename}`
                },

                {
                  type: "input_file",

                  filename:
                    studentFilename,

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

                additionalProperties: false,

                properties: {

                  overall_summary: {
                    type: "string"
                  },

                  questions: {

                    type: "array",

                    items: {

                      type: "object",

                      additionalProperties: false,

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
                      ]

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
                ]

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
        "AI GATEWAY ERROR:",
        rawResult
      );

      return res.status(
        aiResponse.status >= 400 &&
        aiResponse.status < 500
          ? aiResponse.status
          : 500
      ).json({

        error:
          "AI evaluation failed.",

        details:
          rawResult?.error?.message ||
          rawResult?.message ||
          "Unknown AI Gateway error."

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


    if (
      !outputText &&
      Array.isArray(rawResult.output)
    ) {

      for (
        const item
        of rawResult.output
      ) {

        if (
          !Array.isArray(item.content)
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

      console.error(
        "EMPTY AI RESPONSE:",
        rawResult
      );

      return res.status(500).json({

        error:
          "AI returned an empty evaluation."

      });

    }


    /* ==================================================
       PARSE JSON
    ================================================== */

    let evaluation;

    try {

      evaluation =
        JSON.parse(
          outputText.trim()
        );

    } catch (error) {

      console.error(
        "INVALID AI JSON:",
        outputText
      );

      return res.status(500).json({

        error:
          "AI returned invalid evaluation JSON.",

        details:
          error.message

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

      return res.status(500).json({

        error:
          "AI returned an invalid evaluation structure."

      });

    }


    /* ==================================================
       SERVER-SIDE SCORE CALCULATION
    ================================================== */

    let totalMarks = 0;

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
        !Number.isFinite(available) ||
        available < 0
      ) {

        return res.status(500).json({

          error:
            `Invalid marks_available for question ${question.question_number}.`

        });

      }


      if (
        !Number.isFinite(awarded)
      ) {

        awarded = 0;

      }


      if (awarded < 0) {

        awarded = 0;

      }


      if (
        awarded > available
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


      totalMarks +=
        awarded;

    }


    totalMarks =
      Math.round(
        totalMarks * 100
      ) / 100;


    if (
      totalMarks >
      maximumMarks
    ) {

      totalMarks =
        maximumMarks;

    }


    const percentage =
      Math.round(
        (
          totalMarks /
          maximumMarks
        ) *
        10000
      ) / 100;


    evaluation.total_marks =
      totalMarks;

    evaluation.maximum_marks =
      maximumMarks;

    evaluation.percentage =
      percentage;


    /* ==================================================
       FINAL RESPONSE
       Compatible with frontend:
       checkResult.evaluation
    ================================================== */

    return res.status(200).json({

      success: true,

      evaluation,

      metadata: {

        subject,

        testType:
          formattedTestType,

        checkingMode:
          strict
            ? "ICAI Strict"
            : "Moderate",

        descriptiveMaximum:
          maximumMarks,

        answerSheet:
          studentFilename,

        questionPaper:
          qpFilename,

        suggestedAnswer:
          suggestedFilename

      }

    });


  } catch (error) {

    console.error(
      "EVALUATE ERROR:",
      error
    );

    return res.status(500).json({

      error:
        "Unable to evaluate answer sheet.",

      details:
        error?.message ||
        "Unknown server error."

    });

  }

}
