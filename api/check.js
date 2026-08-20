import { list } from "@vercel/blob";


export default async function handler(req,res){

  if(req.method !== "POST"){

    return res.status(405).json({
      error:"Method not allowed"
    });

  }


  try{

    const {

      answerSheetBase64,

      answerSheetName,

      level,

      group,

      subject,

      subjectKey,

      testType,

      modelTestNumber,

      checkingMode,

      descriptiveMaximum

    } = req.body || {};


    /* ================================================
       VALIDATION
    ================================================ */

    if(!answerSheetBase64){

      return res.status(400).json({
        error:"Answer sheet is missing."
      });

    }

    if(!level){

      return res.status(400).json({
        error:"CA Level is missing."
      });

    }

    if(!group){

      return res.status(400).json({
        error:"Group is missing."
      });

    }

    if(!subjectKey){

      return res.status(400).json({
        error:"Subject is missing."
      });

    }

    if(!testType){

      return res.status(400).json({
        error:"Test type is missing."
      });

    }


    if(
      testType === "MODEL_TEST" &&
      !modelTestNumber
    ){

      return res.status(400).json({
        error:"Model Test number is missing."
      });

    }


    const maximumMarks =
      Number(descriptiveMaximum);


    if(
      !Number.isFinite(maximumMarks) ||
      maximumMarks <= 0
    ){

      return res.status(400).json({
        error:
          "Invalid descriptive maximum marks."
      });

    }


    if(!process.env.AI_GATEWAY_API_KEY){

      return res.status(500).json({
        error:
          "AI_GATEWAY_API_KEY is not configured."
      });

    }


    if(!process.env.BLOB_READ_WRITE_TOKEN){

      return res.status(500).json({
        error:
          "BLOB_READ_WRITE_TOKEN is not configured."
      });

    }


    /* ================================================
       SAFE PATH
    ================================================ */

    function safe(value){

      return String(value)
        .trim()
        .replace(/[^a-zA-Z0-9_-]/g,"_");

    }


    const safeLevel =
      safe(level);

    const safeGroup =
      safe(group);


    let materialPrefix;


    /* ================================================
       MODEL TEST MATERIAL
    ================================================ */

    if(testType === "MODEL_TEST"){

      materialPrefix =
        `materials/${safeLevel}/${safeGroup}/model-test-${safe(modelTestNumber)}/`;

    }


    /* ================================================
       NORMAL MATERIAL
    ================================================ */

    else{

      materialPrefix =
        `materials/${safeLevel}/${safeGroup}/${safe(subjectKey)}/${safe(testType)}/`;

    }


    /* ================================================
       FIND MATERIALS
    ================================================ */

    const materialList =
      await list({

        prefix:
          materialPrefix,

        token:
          process.env.BLOB_READ_WRITE_TOKEN

      });


    const blobs =
      materialList?.blobs || [];


    console.log(
      "MATERIAL PREFIX:",
      materialPrefix
    );


    console.log(
      "FOUND BLOBS:",
      blobs.map(
        blob => blob.pathname
      )
    );


    let questionPaper;
    let suggestedAnswer;
    let modelTestPDF;


    /* ================================================
       MODEL TEST
    ================================================ */

    if(testType === "MODEL_TEST"){

      const modelFiles =
        blobs
          .filter(blob =>
            blob.pathname
              .toLowerCase()
              .includes("/model-test-")
          )
          .sort(
            (a,b) =>
              new Date(b.uploadedAt) -
              new Date(a.uploadedAt)
          );


      if(!modelFiles.length){

        return res.status(404).json({

          error:
            "Model Test PDF is missing.",

          details:
            `No Model Test found inside ${materialPrefix}`,

          availableFiles:
            blobs.map(
              blob => blob.pathname
            )

        });

      }


      modelTestPDF =
        modelFiles[0];

    }


    /* ================================================
       NORMAL TEST
    ================================================ */

    else{

      const questionPapers =
        blobs
          .filter(blob =>
            blob.pathname
              .toLowerCase()
              .includes(
                "/question-paper-"
              )
          )
          .sort(
            (a,b) =>
              new Date(b.uploadedAt) -
              new Date(a.uploadedAt)
          );


      const suggestedAnswers =
        blobs
          .filter(blob =>
            blob.pathname
              .toLowerCase()
              .includes(
                "/suggested-answer-"
              )
          )
          .sort(
            (a,b) =>
              new Date(b.uploadedAt) -
              new Date(a.uploadedAt)
          );


      if(!questionPapers.length){

        return res.status(404).json({

          error:
            "Question Paper is missing.",

          details:
            `No Question Paper found inside ${materialPrefix}`,

          availableFiles:
            blobs.map(
              blob => blob.pathname
            )

        });

      }


      if(!suggestedAnswers.length){

        return res.status(404).json({

          error:
            "Suggested Answer is missing.",

          details:
            `No Suggested Answer found inside ${materialPrefix}`,

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


    /* ================================================
       DOWNLOAD PRIVATE BLOB
    ================================================ */

    async function downloadBlob(blob){

      const response =
        await fetch(
          blob.url
        );


      if(!response.ok){

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


    let questionPaperBase64;
    let suggestedAnswerBase64;
    let modelTestBase64;


    if(testType === "MODEL_TEST"){

      modelTestBase64 =
        await downloadBlob(
          modelTestPDF
        );

    }else{

      questionPaperBase64 =
        await downloadBlob(
          questionPaper
        );


      suggestedAnswerBase64 =
        await downloadBlob(
          suggestedAnswer
        );

    }


    /* ================================================
       TEST TYPE
    ================================================ */

    const formattedTestType =
      testType === "MODEL_TEST"
      ? `Model Test ${modelTestNumber}`
      : testType;


    /* ================================================
       CHECKING MODE
    ================================================ */

    const checkingInstructions =

      checkingMode === "strict"

      ?

`STRICT ICAI-STYLE CHECKING:

- Be conservative with marks.
- Award marks only where the student demonstrates required knowledge.
- Penalise wrong concepts, provisions and calculations.
- Give step marks only for genuinely correct steps.
- Missing workings should lose marks where required.
- Theory must be checked for provision, concept, application and conclusion.`

      :

`MODERATE EXAMINER-STYLE CHECKING:

- Give reasonable step marking.
- Give credit for substantially correct approaches.
- Minor calculation errors may receive partial marks.
- Conceptual errors must be penalised.
- Missing essential workings should affect marks.`;


    /* ================================================
       MODEL TEST SPECIAL INSTRUCTION
    ================================================ */

    const modelTestInstruction =

      testType === "MODEL_TEST"

      ?

`THIS IS A COMBINED MODEL TEST PDF.

The uploaded Model Test PDF contains:

- Question Papers for multiple subjects in this group.
- Suggested Answers for multiple subjects in this group.

The selected student subject is:

SUBJECT:
${subject}

SUBJECT KEY:
${subjectKey}

You MUST locate ONLY the Question Paper and Suggested Answer belonging to the selected subject.

Ignore all other subjects.

Do NOT mix another subject's questions or suggested answers with the selected subject.

The Model Test PDF is the authority for identifying the relevant subject, questions, sub-parts and marks.`

      :

`THIS IS A NORMAL TEST.

Question Paper and Suggested Answer are separate PDFs.

Use the Question Paper as the authority for question numbers, sub-parts and marks.

Use the Suggested Answer as the reference for expected answers, calculations, provisions, concepts and conclusions.`;


    /* ================================================
       PROMPT
    ================================================ */

    const prompt = `

You are an expert CA examination evaluator.

Evaluate the student's answer sheet against the official/reference examination material.

==================================================
STUDENT EXAM INFORMATION
==================================================

CA LEVEL:
${level}

GROUP:
${group}

SUBJECT:
${subject}

SUBJECT KEY:
${subjectKey}

TEST TYPE:
${formattedTestType}

DESCRIPTIVE MAXIMUM:
${maximumMarks}

CHECKING MODE:
${checkingMode === "strict"
  ? "ICAI STRICT"
  : "MODERATE"}

==================================================
MATERIAL STRUCTURE
==================================================

${modelTestInstruction}

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

7. Compare the student's answer directly with the relevant expected answer.

8. Give genuine partial/step marks.

9. Wrong final answer with substantially correct working may receive appropriate partial marks.

10. Wrong approach should not receive marks merely because it contains similar numbers or keywords.

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

15. Never award more than marks_available.

16. Never award negative marks.

17. Include every descriptive question for the selected subject.

18. Exclude MCQs.

19. Handle internal choices carefully.

20. Do not count both alternatives of an internal choice.

21. Remarks must explain actual lost marks.

22. Do not give generic praise.

23. Do not reveal hidden reasoning.

==================================================
FINAL VERIFICATION
==================================================

Verify:

- Every descriptive question for the selected subject is included.
- MCQs are excluded.
- Marks available are correct.
- Awarded marks are correct.
- Total marks are mathematically correct.
- Total does not exceed ${maximumMarks}.
- Percentage is mathematically correct.

Return ONLY valid JSON.
`;


    /* ================================================
       AI CONTENT
    ================================================ */

    const content = [

      {
        type:"input_text",
        text:prompt
      }

    ];


    if(testType === "MODEL_TEST"){

      content.push({

        type:"input_file",

        filename:
          modelTestPDF.pathname
            .split("/")
            .pop(),

        file_data:
          `data:application/pdf;base64,${modelTestBase64}`

      });

    }else{

      content.push({

        type:"input_file",

        filename:
          questionPaper.pathname
            .split("/")
            .pop(),

        file_data:
          `data:application/pdf;base64,${questionPaperBase64}`

      });


      content.push({

        type:"input_file",

        filename:
          suggestedAnswer.pathname
            .split("/")
            .pop(),

        file_data:
          `data:application/pdf;base64,${suggestedAnswerBase64}`

      });

    }


    content.push({

      type:"input_file",

      filename:
        answerSheetName ||
        "answer-sheet.pdf",

      file_data:
        `data:application/pdf;base64,${answerSheetBase64}`

    });


    /* ================================================
       AI REQUEST
    ================================================ */

    const aiResponse =
      await fetch(
        "https://ai-gateway.vercel.sh/v1/responses",
        {

          method:"POST",

          headers:{

            "Content-Type":
              "application/json",

            Authorization:
              `Bearer ${process.env.AI_GATEWAY_API_KEY}`

          },

          body:JSON.stringify({

            model:
              "openai/gpt-5.6-sol",

            reasoning:{
              effort:"high"
            },

            input:[{

              type:"message",

              role:"user",

              content

            }],


            text:{

              format:{

                type:"json_schema",

                name:
                  "ca_exam_evaluation",

                strict:true,

                schema:{

                  type:"object",

                  properties:{

                    overall_summary:{
                      type:"string"
                    },

                    questions:{

                      type:"array",

                      items:{

                        type:"object",

                        properties:{

                          question_number:{
                            type:"string"
                          },

                          marks_available:{
                            type:"number"
                          },

                          marks_awarded:{
                            type:"number"
                          },

                          status:{

                            type:"string",

                            enum:[

                              "correct",
                              "partially_correct",
                              "incorrect",
                              "not_attempted",
                              "unclear"

                            ]

                          },

                          remarks:{
                            type:"string"
                          }

                        },

                        required:[

                          "question_number",
                          "marks_available",
                          "marks_awarded",
                          "status",
                          "remarks"

                        ],

                        additionalProperties:false

                      }

                    },

                    total_marks:{
                      type:"number"
                    },

                    maximum_marks:{
                      type:"number"
                    },

                    percentage:{
                      type:"number"
                    }

                  },

                  required:[

                    "overall_summary",
                    "questions",
                    "total_marks",
                    "maximum_marks",
                    "percentage"

                  ],

                  additionalProperties:false

                }

              }

            }

          })

        }

      );


    /* ================================================
       AI RESPONSE
    ================================================ */

    const rawResult =
      await aiResponse.json();


    if(!aiResponse.ok){

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
          JSON.stringify(rawResult)

      });

    }


    /* ================================================
       EXTRACT TEXT
    ================================================ */

    let outputText = "";


    if(
      typeof rawResult.output_text ===
      "string"
    ){

      outputText =
        rawResult.output_text;

    }


    if(
      !outputText &&
      Array.isArray(rawResult.output)
    ){

      for(
        const item of rawResult.output
      ){

        if(
          !Array.isArray(item.content)
        )
          continue;


        for(
          const contentItem
          of item.content
        ){

          if(
            typeof contentItem.text ===
            "string"
          ){

            outputText +=
              contentItem.text;

          }

        }

      }

    }


    if(!outputText){

      return res.status(500).json({

        error:
          "AI returned an empty evaluation.",

        details:
          JSON.stringify(rawResult)

      });

    }


    /* ================================================
       PARSE JSON
    ================================================ */

    let evaluation;


    try{

      evaluation =
        JSON.parse(outputText);

    }catch(error){

      return res.status(500).json({

        error:
          "AI returned invalid JSON.",

        details:
          outputText.slice(0,3000)

      });

    }


    if(
      !evaluation ||
      !Array.isArray(evaluation.questions)
    ){

      return res.status(500).json({

        error:
          "Invalid evaluation structure."

      });

    }


    /* ================================================
       FINAL SCORE
    ================================================ */

    let total = 0;


    for(
      const question
      of evaluation.questions
    ){

      const available =
        Number(
          question.marks_available
        );


      let awarded =
        Number(
          question.marks_awarded
        );


      if(
        !Number.isFinite(available)
      ){

        return res.status(500).json({

          error:
            "Invalid marks returned by AI."

        });

      }


      if(
        !Number.isFinite(awarded)
      ){

        awarded = 0;

      }


      if(awarded < 0)
        awarded = 0;


      if(awarded > available)
        awarded = available;


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


    if(total > maximumMarks)
      total = maximumMarks;


    const percentage =
      Math.round(
        (total / maximumMarks) *
        10000
      ) / 100;


    evaluation.total_marks =
      total;

    evaluation.maximum_marks =
      maximumMarks;

    evaluation.percentage =
      percentage;


    /* ================================================
       RESPONSE
    ================================================ */

    return res.status(200).json({

      success:true,

      evaluation,

      metadata:{

        level,

        group,

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

        materialType:
          testType === "MODEL_TEST"
          ? "Combined Model Test PDF"
          : "Separate Question Paper + Suggested Answer"

      }

    });


  }catch(error){

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
