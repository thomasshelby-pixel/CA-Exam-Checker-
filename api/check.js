export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
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
    } = req.body;

    if (
      !answerSheetBase64 ||
      !questionPaperBase64 ||
      !suggestedAnswerBase64
    ) {
      return res.status(400).json({
        error: "Answer sheet, question paper and suggested answer are required."
      });
    }

    const prompt = `
You are an expert CA Intermediate examiner.

Evaluate the student's answer sheet using the supplied Question Paper
and Suggested Answer.

SUBJECT:
${subject}

TEST TYPE:
${testType}

CHECKING MODE:
${checkingMode === "strict"
  ? "ICAI STRICT - award marks only for correct concepts, provisions, calculations, workings and relevant presentation."
  : "MODERATE - use reasonable examiner-style step marking while still penalising conceptual errors."
}

DESCRIPTIVE MAXIMUM:
${descriptiveMaximum}

IMPORTANT RULES:

1. Evaluate ONLY descriptive questions.
2. Ignore MCQs completely.
3. Do not invent questions or answers.
4. Compare the student's answer with the Question Paper and Suggested Answer.
5. Give step marks wherever genuinely earned.
6. Incorrect final answer with substantially correct working may receive appropriate partial marks.
7. Missing workings should affect marks where workings are required.
8. For theory answers, check relevant provisions, concepts, keywords and conclusion.
9. Do not award marks merely because an answer looks lengthy.
10. Do not exceed the marks available for a question.
11. Be conservative and examiner-like.
12. Return question-wise marks and concise remarks.
13. Calculate the final descriptive score accurately.
14. If a question is not attempted, give 0.
15. If the student's writing is unclear, do not guess confidently. Mark the issue as unclear.

Return ONLY valid JSON matching the requested structure.
`;

    const response = await fetch(
      "https://ai-gateway.vercel.sh/v1/responses",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.AI_GATEWAY_API_KEY}`
        },
        body: JSON.stringify({
          model: "openai/gpt-5.6-sol",

          input: [
            {
              type: "message",
              role: "user",
              content: [
                {
                  type: "input_text",
                  text: prompt
                },

                {
                  type: "input_text",
                  text: `QUESTION PAPER: ${questionPaperName}`
                },

                {
                  type: "input_file",
                  filename: questionPaperName,
                  file_data:
                    `data:application/pdf;base64,${questionPaperBase64}`
                },

                {
                  type: "input_text",
                  text: `SUGGESTED ANSWER: ${suggestedAnswerName}`
                },

                {
                  type: "input_file",
                  filename: suggestedAnswerName,
                  file_data:
                    `data:application/pdf;base64,${suggestedAnswerBase64}`
                },

                {
                  type: "input_text",
                  text: `STUDENT ANSWER SHEET: ${answerSheetName}`
                },

                {
                  type: "input_file",
                  filename: answerSheetName,
                  file_data:
                    `data:application/pdf;base64,${answerSheetBase64}`
                }
              ]
            }
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

                      additionalProperties: false
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

                additionalProperties: false
              }
            }
          }
        })
      }
    );

    const result = await response.json();

    if (!response.ok) {
      console.error("AI Gateway error:", result);

      return res.status(500).json({
        error: "AI evaluation failed",
        details: result
      });
    }

    let evaluation;

    try {
      evaluation = JSON.parse(result.output_text);
    } catch (error) {
      console.error("Invalid AI JSON:", result);

      return res.status(500).json({
        error: "AI returned invalid evaluation format"
      });
    }

    return res.status(200).json({
      success: true,
      evaluation
    });

  } catch (error) {
    console.error("CHECK ERROR:", error);

    return res.status(500).json({
      error: "Unable to evaluate answer sheet"
    });
  }
}
