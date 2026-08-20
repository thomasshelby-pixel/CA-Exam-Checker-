import { put } from "@vercel/blob";

export default async function handler(req,res){

  if(req.method!=="POST"){
    return res.status(405).json({
      error:"Method not allowed"
    });
  }

  try{

    if(!process.env.BLOB_READ_WRITE_TOKEN){
      return res.status(500).json({
        error:
          "BLOB_READ_WRITE_TOKEN is not configured."
      });
    }

    const {
      filename,
      data,
      contentType,

      studentName,
      registrationNumber,

      level,
      subject,
      subjectKey,

      testType,
      modelType,

      checkingMode,
      descriptiveMaximum

    } = req.body || {};

    if(!data){
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

    const buffer =
      Buffer.from(data,"base64");

    if(buffer.length > 4 * 1024 * 1024){
      return res.status(400).json({
        error:
          "Answer sheet must be smaller than 4 MB."
      });
    }

    const safeLevel =
      String(level)
        .replace(/[^a-zA-Z0-9_-]/g,"_");

    const safeTestType =
      String(testType)
        .replace(/[^a-zA-Z0-9_-]/g,"_");

    const timestamp =
      Date.now();

    const safeFilename =
      String(filename || "answer-sheet.pdf")
        .replace(/[^a-zA-Z0-9._-]/g,"_");

    const pathname =
      `answers/${safeLevel}/${safeTestType}/${timestamp}-${safeFilename}`;

    const blob =
      await put(
        pathname,
        buffer,
        {
          access:"private",

          contentType:
            contentType ||
            "application/pdf",

          token:
            process.env.BLOB_READ_WRITE_TOKEN,

          addRandomSuffix:false,

          metadata:{
            studentName:
              studentName || "",

            registrationNumber:
              registrationNumber || "",

            level,

            subject:
              subject || "",

            subjectKey:
              subjectKey || "",

            testType,

            modelType:
              modelType || "",

            checkingMode:
              checkingMode || "",

            descriptiveMaximum:
              String(
                descriptiveMaximum || ""
              )
          }
        }
      );

    return res.status(200).json({

      success:true,

      pathname:
        blob.pathname,

      url:
        blob.url

    });

  }catch(error){

    console.error(
      "ANSWER UPLOAD ERROR:",
      error
    );

    return res.status(500).json({
      error:
        error?.message ||
        "Answer sheet upload failed."
    });
  }
}
