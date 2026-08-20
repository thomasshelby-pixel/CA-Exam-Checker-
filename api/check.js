import { list } from "@vercel/blob";

export default async function handler(req,res){

  if(req.method!=="POST"){
    return res.status(405).json({
      error:"Method not allowed"
    });
  }

  try{

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

    if(!answerSheetBase64){
      return res.status(400).json({
        error:"Answer sheet is missing."
      });
    }

    if(!level){
      return res.status(400).json({
        error:"Level is missing."
      });
    }

    if(!testType){
      return res.status(400).json({
        error:"Test type is missing."
      });
    }

    const maximumMarks=
      Number(descriptiveMaximum);

    if(
      !Number.isFinite(maximumMarks)||
      maximumMarks<=0
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

    const safeLevel=
      String(level)
        .replace(/[^a-zA-Z0-9_-]/g,"_");

    const safeTestType=
      String(testType)
        .replace(/[^a-zA-Z0-9_-]/g,"_");

    const safeModelType=
      String(modelType || "NONE")
        .replace(/[^a-zA-Z0-9_-]/g,"_");

    const prefix=
      `materials/${safeLevel}/${safeTestType}/${safeModelType}/`;

    const materialList=
      await list({
        prefix,
        token:
          process.env.BLOB_READ_WRITE_TOKEN
      });

    const blobs=
      materialList?.blobs || [];

    console.log(
      "MATERIAL PREFIX:",
      prefix
    );

    console.log(
      "FOUND BLOBS:",
      blobs.map(
        blob=>blob.pathname
      )
    );

    /*
      MODEL TEST
      One PDF contains both QP + Suggested Answer.
    */

    if(testType==="MODEL_TEST"){

      const modelFiles=
        blobs
          .filter(blob=>
            blob.pathname
              .toLowerCase()
              .includes(
                "/model-test-"
              )
          )
          .sort(
            (a,b)=>
              new Date(b.uploadedAt)-
              new Date(a.uploadedAt)
          );

      if(!modelFiles.length){

        return res.status(404).json({

          error:
            "Model Test material is missing.",

          details:
            `No Model Test found inside ${prefix}`,

          availableFiles:
            blobs.map(
              blob=>blob.pathname
            )

        });
      }

      const modelFile=
        modelFiles[0];

      const modelBase64=
        await downloadBlob(
          modelFile
        );

      return await evaluateWithAI({

        req,
        res,

        answerSheetBase64,
        answerSheetName,

        level,

        subject,
        subjectKey,

        testType,
        modelType,

        checkingMode,
        maximumMarks,

        questionPaperBase64:
          modelBase64,

        suggestedAnswerBase64:
          modelBase64,

        questionPaperName:
          modelFile.pathname,

        suggestedAnswerName:
          modelFile.pathname

      });

    }

    /*
      NORMAL MTP / RTP / OTHER
      Question paper and suggested answer separate.
    */

    const questionPapers=
      blobs
        .filter(blob=>
          blob.pathname
            .toLowerCase()
            .includes(
              "/question-paper-"
            )
        )
        .sort(
          (a,b)=>
            new Date(b.uploadedAt)-
            new Date(a.uploadedAt)
        );

    const suggestedAnswers=
      blobs
        .filter(blob=>
          blob.pathname
            .toLowerCase()
            .includes(
              "/suggested-answer-"
            )
        )
        .sort(
          (a,b)=>
            new Date(b.uploadedAt)-
            new Date(a.uploadedAt)
        );

    if(!questionPapers.length){

      return res.status(404).json({
        error:
          "Question Paper is missing.",
        details:
          `No Question Paper found inside ${prefix}`
      });
    }

    if(!suggestedAnswers.length){

      return res.status(404).json({
        error:
          "Suggested Answer is missing.",
        details:
          `No Suggested Answer found inside ${prefix}`
      });
    }

    const questionPaper=
      questionPapers[0];

    const suggestedAnswer=
      suggestedAnswers[0];

    const questionPaperBase64=
      await downloadBlob(
        questionPaper
      );

    const suggestedAnswerBase64=
      await downloadBlob(
        suggestedAnswer
      );

    return await evaluateWithAI({

      req,
      res,

      answerSheetBase64,
      answerSheetName,

      level,

      subject,
      subjectKey,

      testType,
      modelType,

      checkingMode,
      maximumMarks,

      questionPaperBase64,
      suggestedAnswerBase64,

      questionPaperName:
        questionPaper.pathname,

      suggestedAnswerName:
        suggestedAnswer.pathname

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
        error?.message||
        "Unknown error"

    });
  }
}

async function downloadBlob(blob){

  const response=
    await fetch(
      blob.url,
      {
        headers:{
          Authorization:
            `Bearer ${process.env.BLOB_READ_WRITE_TOKEN}`
        }
      }
    );

  if(!response.ok){

    throw new Error(
      `Unable to download ${blob.pathname}. HTTP ${response.status}`
    );
  }

  const arrayBuffer=
    await response.arrayBuffer();

  return Buffer
    .from(arrayBuffer)
    .toString("base64");
}

async function evaluateWithAI({

  req,
  res,

  answerSheetBase64,
  answerSheetName,

  level,

  subject,
  subjectKey,

  testType,
  modelType,

  checkingMode,
  maximumMarks,

  questionPaperBase64,
  suggestedAnswerBase64,

  questionPaperName,
  suggestedAnswerName

}){

  const formattedTestType=
    testType==="MODEL_TEST"
      ?"Model Test"
      :testType==="MTP"
      ?"MTP"
      :testType==="RTP"
      ?"RTP"
      :"Other";

  const formattedModelType=
    modelType==="GROUP_1"
      ?"Group 1"
      :modelType==="GROUP_2"
      ?"Group 2"
      :modelType==="OTHER"
      ?"Other"
      :"Foundation Model Test";

  const checkingInstructions=
    checkingMode==="strict"
      ?`
STRICT ICAI-STYLE CHECKING:

- Be conservative with marks.
- Award marks only for demonstrated knowledge.
- Penalise wrong concepts and provisions.
- Give genuine step marks.
- Missing workings should lose marks where required.
- Theory must contain provision, concept, application and conclusion.
`
      :`
MODERATE EXAMINER-STYLE CHECKING:

- Give reasonable step marking.
- Give credit for substantially correct approaches.
- Minor calculation errors may receive partial marks.
- Conceptual errors must be penalised.
`;

  const prompt=`

You are an expert CA examiner.

Evaluate the student's answer sheet against the
official/reference examination material.

LEVEL:
${level}

SUBJECT:
${subject}

TEST TYPE:
${formattedTestType}

MODEL TEST TYPE:
${formattedModelType}

DESCRIPTIVE MAXIMUM:
${maximumMarks}

CHECKING MODE:
${checkingMode==="strict"
 ?"ICAI STRICT"
 :"MODERATE"}

${checkingInstructions}

IMPORTANT:

1. Evaluate ONLY descriptive questions.

2. Ignore MCQs completely.

3. Do not invent questions.

4. Do not invent marks.

5. The Question Paper determines:
   - question numbers
   - sub-parts
   - marks
   - question structure

6. The Suggested Answer determines:
   - expected answer
   - calculations
   - provisions
   - concepts
   - workings
   - conclusions

7. For Model Test, the SAME PDF contains both
   Question Paper and Suggested Answer.

8. Identify the Question Paper section and
   Suggested Answer/reference section within
   that PDF before evaluating.

9. Compare student's answer directly with the
   relevant expected answer.

10. Give genuine partial marks.

11. Wrong final answer with substantially correct
    working can receive partial marks.

12. Wrong approach should not receive marks.

13. Theory:
    - provision
    - concept
    - application
    - conclusion

14. Practical:
    - formula
    - working
    - calculation
    - adjustments
    - final answer

15. Unattempted:
    marks_awarded = 0
    status = "not_attempted"

16. Unclear handwriting:
    status = "unclear"

17. Never exceed marks_available.

18. Never give negative marks.

19. Include every descriptive question.

20. Exclude MCQs.

21. Handle internal choices carefully.

22. Remarks must explain actual lost marks.

23. Do not give generic praise.

24. Do not reveal hidden reasoning.

FINAL CHECK:

- Every descriptive question included.
- MCQs excluded.
- Marks available correct.
- Awarded marks correct.
- Total mathematically correct.
- Total <= ${maximumMarks}.
- Percentage mathematically correct.

Return ONLY valid JSON.
`;

  const aiResponse=
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
            process.env.AI_MODEL ||
            "openai/gpt-5.6",

          reasoning:{
            effort:"high"
          },

          input:[

            {
              type:"message",

              role:"user",

              content:[

                {
                  type:"input_text",
                  text:prompt
                },

                {
                  type:"input_file",

                  filename:
                    questionPaperName
                      .split("/")
                      .pop(),

                  file_data:
                    `data:application/pdf;base64,${questionPaperBase64}`
                },

                {
                  type:"input_file",

                  filename:
                    suggestedAnswerName
                      .split("/")
                      .pop(),

                  file_data:
                    `data:application/pdf;base64,${suggestedAnswerBase64}`
                },

                {
                  type:"input_file",

                  filename:
                    answerSheetName||
                    "answer-sheet.pdf",

                  file_data:
                    `data:application/pdf;base64,${answerSheetBase64}`
                }

              ]
            }

          ],

          text:{
            format:{

              type:"json_schema",

              name:"ca_exam_evaluation",

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

  const rawResult=
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
        rawResult?.error?.message||
        rawResult?.message||
        JSON.stringify(rawResult)

    });
  }

  let outputText="";

  if(
    typeof rawResult.output_text==="string"
  ){
    outputText=
      rawResult.output_text;
  }

  if(
    !outputText &&
    Array.isArray(rawResult.output)
  ){

    for(
      const item of rawResult.output
    ){

      if(!Array.isArray(item.content))
        continue;

      for(
        const content of item.content
      ){

        if(
          typeof content.text==="string"
        ){
          outputText+=content.text;
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

  let evaluation;

  try{

    evaluation=
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
    !evaluation||
    !Array.isArray(
      evaluation.questions
    )
  ){

    return res.status(500).json({
      error:
        "Invalid evaluation structure."
    });
  }

  let total=0;

  for(
    const question of evaluation.questions
  ){

    const available=
      Number(
        question.marks_available
      );

    let awarded=
      Number(
        question.marks_awarded
      );

    if(
      !Number.isFinite(available)||
      available<0
    ){

      return res.status(500).json({
        error:
          "Invalid marks returned by AI."
      });
    }

    if(!Number.isFinite(awarded)){
      awarded=0;
    }

    awarded=
      Math.max(
        0,
        Math.min(
          available,
          awarded
        )
      );

    awarded=
      Math.round(
        awarded*100
      )/100;

    question.marks_awarded=
      awarded;

    total+=awarded;
  }

  total=
    Math.round(
      total*100
    )/100;

  /*
    Safety cap.
  */

  total=
    Math.min(
      total,
      maximumMarks
    );

  const percentage=
    Math.round(
      (total/maximumMarks)*10000
    )/100;

  evaluation.total_marks=
    total;

  evaluation.maximum_marks=
    maximumMarks;

  evaluation.percentage=
    percentage;

  return res.status(200).json({

    success:true,

    evaluation,

    metadata:{

      level,

      subject,
      subjectKey,

      testType:
        formattedTestType,

      modelType:
        formattedModelType,

      checkingMode:
        checkingMode==="strict"
          ?"ICAI Strict"
          :"Moderate",

      descriptiveMaximum:
        maximumMarks,

      questionPaper:
        questionPaperName,

      suggestedAnswer:
        suggestedAnswerName,

      answerSheet:
        answerSheetName||
        "answer-sheet.pdf"

    }

  });
}
