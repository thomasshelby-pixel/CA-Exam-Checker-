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
      subject,
      subjectKey,
      testType,
      checkingMode,
      descriptiveMaximum
    } = req.body || {};

    /* =========================================================
       VALIDATION
    ========================================================= */

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

    const maximumMarks = Number(descriptiveMaximum);

    if (!Number.isFinite(maximumMarks) || maximumMarks <= 0) {
      return res.status(400).json({
        error: "Invalid descriptive maximum marks."
      });
    }

    if (!process.env.AI_GATEWAY_API_KEY) {
      return res.status(500).json({
        error: "AI Gateway API key is not configured."
      });
    }

    if (!process.env.BLOB_READ_WRITE_TOKEN) {
      return res.status(500).json({
        error: "Vercel Blob token is not configured."
      });
    }

    /* =========================================================
       SAFE VALUES
    ========================================================= */

    const safeSubject = String(subjectKey)
      .replace(/[^a-zA-Z0-9_-]/g, "_");

    const safeTestType = String(testType)
      .replace(/[^a-zA-Z0-9_-]/g, "_");

    /* =========================================================
       FIND MATERIALS
    ========================================================= */

    const materialPrefix =
      `materials/${safeSubject}/${safeTestType}/`;

    const materialList = await list({
      prefix: materialPrefix,
      token: process.env.BLOB_READ_WRITE_TOKEN
    });

    const blobs = materialList.blobs || [];

    const questionPapers = blobs
      .filter((blob) =>
        blob.pathname.includes("/question-paper-")
      )
      .sort(
        (a, b) =>
          new Date(b.uploadedAt) -
          new Date(a.uploadedAt)
      );

    const suggestedAnswers = blobs
      .filter((blob) =>
        blob.pathname.includes("/suggested-answer-")
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

    const questionPaper = questionPapers[0];
    const suggestedAnswer = suggestedAnswers[0];

    /* =========================================================
       DOWNLOAD BLOBS
    ========================================================= */

    async function downloadBlob(blob) {
      const response = await fetch(blob.url, {
        headers: {
          Authorization:
            `Bearer ${process.env.BLOB_READ_WRITE_TOKEN}`
        }
      });

      if (!response.ok) {
        throw new Error(
          `Unable to download ${blob.pathname}`
        );
      }

      const arrayBuffer = await response.arrayBuffer();

      return Buffer.from(arrayBuffer).toString("base64");
    }

    const [
      questionPaperBase64,
      suggestedAnswerBase64
    ] = await Promise.all([
      downloadBlob(questionPaper),
      downloadBlob(suggestedAnswer)
    ]);

    /* =========================================================
       TEST TYPE
    ========================================================= */

    const formattedTestType =
      testType === "MODEL_TEST"
        ? "Model Test"
        : testType === "OTHER"
        ? "Other"
        : testType;

    /* =========================================================
       CHECKING MODE
    ========================================================= */

    const checkingInstructions =
      checkingMode === "strict"
        ? `
STRICT ICAI-STYLE CHECKING:

- Be conservative with marks.
- Award marks only for demonstrated knowledge.
- Penalise wrong concepts, provisions and calculations.
- Give step marks only for genuinely correct steps.
- Missing workings should lose marks where required.
- For theory, check provision, concept, application and conclusion.
`
        : `
MODERATE EXAMINER-STYLE CHECKING:

- Give reasonable step marking.
- Give credit for substantially correct approaches.
- Minor calculation errors may receive partial marks.
- Conceptual errors must be penalised.
- Missing essential workings should affect marks.
`;

    /* =========================================================
       PROMPT
    ========================================================= */

    const prompt = `
You are an expert CA Intermediate examiner.

Evaluate the student's answer sheet using BOTH:

1. Official Question Paper
2. Official/Reference Suggested Answer
3. Student Answer Sheet

The Question Paper determines:
- question numbers
- sub-parts
- marks
- question structure

The Suggested Answer determines:
- expected answer
- concepts
- provisions
- calculations
- workings
- conclusions

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
${checkingMode === "strict"
  ? "ICAI STRICT"
  : "MODERATE"}

${checkingInstructions}

==================================================
MANDATORY RULES
==================================================

1. Evaluate ONLY descriptive questions.

2. IGNORE MCQs completely.

3. Do not invent questions.

4. Do not invent marks.

5. Include every descriptive question found in the Question Paper.

6. Correct question numbering must come from the Question Paper.

7. Handle internal choices carefully.

8. If a question was not attempted:
   marks_awarded = 0
   status = "not_attempted"

9. If handwriting/content is genuinely unreadable:
   status = "unclear"

10. Never award more than marks_available.

11. Never award negative marks.

12. Wrong final answer with substantially correct working may receive
    appropriate partial/step marks.

13. Wrong approach must not receive marks simply because some numbers
    or keywords appear similar.

14. Theory answers must be checked for:
    - provision
    - concept
    - application
    - conclusion

15. Practical answers must be checked for:
    - formula
    - workings
    - calculations
    - adjustments
    - final answer

16. Remarks must explain the actual reason for marks lost.

17. Do not give generic praise.

18. Do not reveal hidden reasoning.

==================================================
OUTPUT FORMAT
==================================================

Return ONLY valid JSON.

Use exactly this structure:

{
  "overall_summary": "short examiner summary",
  "questions": [
    {
      "question_number": "1(a)",
      "marks_available": 4,
      "marks_awarded": 3,
      "status": "partially_correct",
      "remarks": "Specific reason for marks awarded/lost."
    }
  ],
  "total_marks": 0,
  "maximum_marks": ${maximumMarks},
  "percentage": 0
}

The JSON must contain no markdown.
The JSON must contain no explanation outside the JSON.

Before returning:
- verify every descriptive question
- exclude every MCQ
- verify marks
- calculate total
- calculate percentage
`;

    /* =========================================================
       FILE DATA
       ========================================================= */

    const questionPaperFile =
      `data:application/pdf;base64,${questionPaperBase64}`;

    const suggestedAnswerFile =
      `data:application/pdf;base64,${suggestedAnswerBase64}`;

    const studentAnswerFile =
      `data:application/pdf;base64,${answerSheetBase64}`;

    /* =========================================================
       AI REQUEST
       ========================================================= */

    const gatewayBody = {
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
              text:
                `QUESTION PAPER FILE: ${questionPaper.pathname}`
            },

            {
              type: "input_file",
              filename:
                questionPaper.pathname
                  .split("/")
                  .pop() || "question-paper.pdf",
              file_data: questionPaperFile
            },

            {
              type: "input_text",
              text:
                `SUGGESTED ANSWER FILE: ${suggestedAnswer.pathname}`
            },

            {
              type: "input_file",
              filename:
                suggestedAnswer.pathname
                  .split("/")
                  .pop() || "suggested-answer.pdf",
              file_data: suggestedAnswerFile
            },

            {
              type: "input_text",
              text:
                `STUDENT ANSWER SHEET: ${answerSheetName || "answer-sheet.pdf"}`
            },

            {
              type: "input_file",
              filename:
                answerSheetName || "answer-sheet.pdf",
              file_data: studentAnswerFile
            }
          ]
        }
      ],

      reasoning: {
        effort: "medium"
      },

      max_output_tokens: 12000,

      providerOptions: {
        gateway: {
          models: [
            "openai/gpt-5.6-sol",
            "openai/gpt-5.6-terra",
            "openai/gpt-5.6-luna"
          ]
        }
      }
    };

    /* =========================================================
       CALL AI GATEWAY
       ========================================================= */

    const aiResponse = await fetch(
      "https://ai-gateway.vercel.sh/v1/responses",
      {
        method: "POST",

        headers: {
          "Content-Type": "application/json",
          Authorization:
            `Bearer ${process.env.AI_GATEWAY_API_KEY}`
        },

        body: JSON.stringify(gatewayBody)
      }
    );

    const rawText = await aiResponse.text();

    let rawResult;

    try {
      rawResult = JSON.parse(rawText);
    } catch {
      rawResult = {
        raw: rawText
      };
    }

    /* =========================================================
       AI ERROR — SHOW REAL ERROR
       ========================================================= */

    if (!aiResponse.ok) {
      console.error(
        "AI GATEWAY FAILED",
        {
          status: aiResponse.status,
          statusText: aiResponse.statusText,
          response: rawResult
        }
      );

      const gatewayMessage =
        rawResult?.error?.message ||
        rawResult?.message ||
        rawResult?.raw ||
        "Unknown AI Gateway error.";

      return res.status(502).json({
        error: "AI evaluation failed.",
        gatewayStatus: aiResponse.status,
        details: gatewayMessage
      });
    }

    /* =========================================================
       EXTRACT OUTPUT TEXT
       ========================================================= */

    let outputText = "";

    if (
      typeof rawResult?.output_text === "string"
    ) {
      outputText =
        rawResult.output_text;
    }

    if (
      !outputText &&
      Array.isArray(rawResult?.output)
    ) {
      for (const item of rawResult.output) {
        if (!Array.isArray(item?.content)) {
          continue;
        }

        for (const content of item.content) {
          if (
            typeof content?.text === "string"
          ) {
            outputText += content.text;
          }
        }
      }
    }

    outputText = outputText.trim();

    if (!outputText) {
      console.error(
        "EMPTY AI RESPONSE",
        rawResult
      );

      return res.status(502).json({
        error:
          "AI returned an empty evaluation.",
        details:
          "Gateway request succeeded but no output text was returned."
      });
    }

    /* =========================================================
       CLEAN JSON
       ========================================================= */

    function extractJson(text) {
      let cleaned = text.trim();

      cleaned = cleaned
        .replace(/^```json\s*/i, "")
        .replace(/^```\s*/i, "")
        .replace(/\s*```$/i, "")
        .trim();

      try {
        return JSON.parse(cleaned);
      } catch {}

      const firstBrace =
        cleaned.indexOf("{");

      const lastBrace =
        cleaned.lastIndexOf("}");

      if (
        firstBrace !== -1 &&
        lastBrace !== -1 &&
        lastBrace > firstBrace
      ) {
        const possibleJson =
          cleaned.slice(
            firstBrace,
            lastBrace + 1
          );

        return JSON.parse(possibleJson);
      }

      throw new Error(
        "AI response did not contain valid JSON."
      );
    }

    let evaluation;

    try {
      evaluation =
        extractJson(outputText);
    } catch (parseError) {
      console.error(
        "AI JSON PARSE FAILED",
        {
          outputText,
          parseError:
            parseError?.message
        }
      );

      return res.status(502).json({
        error:
          "AI returned invalid evaluation format.",
        details:
          parseError?.message ||
          "Invalid JSON returned by AI.",
        raw:
          outputText.slice(0, 3000)
      });
    }

    /* =========================================================
       BASIC STRUCTURE VALIDATION
       ========================================================= */

    if (
      !evaluation ||
      typeof evaluation !== "object" ||
      !Array.isArray(evaluation.questions)
    ) {
      return res.status(502).json({
        error:
          "Invalid evaluation structure.",
        details:
          "AI response did not contain a questions array."
      });
    }

    /* =========================================================
       SCORE VALIDATION
       ========================================================= */

    let total = 0;

    for (const question of evaluation.questions) {
      const available =
        Number(question.marks_available);

      let awarded =
        Number(question.marks_awarded);

      if (!Number.isFinite(available)) {
        return res.status(502).json({
          error:
            "Invalid marks returned by AI.",
          details:
            "A question contains invalid marks_available."
        });
      }

      if (!Number.isFinite(awarded)) {
        awarded = 0;
      }

      if (awarded < 0) {
        awarded = 0;
      }

      if (awarded > available) {
        awarded = available;
      }

      awarded =
        Math.round(awarded * 100) / 100;

      question.marks_awarded =
        awarded;

      total += awarded;
    }

    total =
      Math.round(total * 100) / 100;

    if (total > maximumMarks) {
      total = maximumMarks;
    }

    const percentage =
      Math.round(
        (total / maximumMarks) * 10000
      ) / 100;

    evaluation.total_marks =
      total;

    evaluation.maximum_marks =
      maximumMarks;

    evaluation.percentage =
      percentage;

    /* =========================================================
       FINAL RESPONSE
       ========================================================= */

    return res.status(200).json({
      success: true,

      evaluation,

      metadata: {
        subject,
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
    console.error(
      "CHECK API CRASHED",
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
