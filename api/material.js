import { put } from "@vercel/blob";

import {
  isAdminAuthenticated
} from "./_adminAuth.js";

export default async function handler(req,res){

  if(req.method!=="POST"){
    return res.status(405).json({
      error:"Method not allowed"
    });
  }

  if(!isAdminAuthenticated(req)){
    return res.status(403).json({
      error:"Admin authentication required."
    });
  }

  try{

    if(!process.env.BLOB_READ_WRITE_TOKEN){
      return res.status(500).json({
        error:"BLOB_READ_WRITE_TOKEN is not configured."
      });
    }

    const {
      filename,
      data,
      contentType,
      level,
      testType,
      modelType,
      subjects,
      type
    } = req.body || {};

    if(!filename || !data){
      return res.status(400).json({
        error:"File is missing."
      });
    }

    if(!level){
      return res.status(400).json({
        error:"Level is required."
      });
    }

    if(!testType){
      return res.status(400).json({
        error:"Test type is required."
      });
    }

    const safeLevel =
      String(level)
        .replace(/[^a-zA-Z0-9_-]/g,"_");

    const safeTestType =
      String(testType)
        .replace(/[^a-zA-Z0-9_-]/g,"_");

    const safeModelType =
      String(modelType || "NONE")
        .replace(/[^a-zA-Z0-9_-]/g,"_");

    const safeType =
      String(type)
        .replace(/[^a-zA-Z0-9_-]/g,"_");

    const timestamp =
      Date.now();

    const safeFilename =
      String(filename)
        .replace(/[^a-zA-Z0-9._-]/g,"_");

    const prefix =
      `materials/${safeLevel}/${safeTestType}/${safeModelType}`;

    const pathname =
      `${prefix}/${safeType}-${timestamp}-${safeFilename}`;

    const buffer =
      Buffer.from(data,"base64");

    if(buffer.length > 10 * 1024 * 1024){
      return res.status(400).json({
        error:"File must be smaller than 10 MB."
      });
    }

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
            level,
            testType,
            modelType:
              modelType || "",

            subjects:
              Array.isArray(subjects)
              ?subjects.join(",")
              :"",

            materialType:type
          }
        }
      );

    return res.status(200).json({

      success:true,

      pathname:
        blob.pathname,

      url:
        blob.url,

      metadata:{
        level,
        testType,
        modelType,
        subjects,
        type
      }

    });

  }catch(error){

    console.error(
      "MATERIAL UPLOAD ERROR:",
      error
    );

    return res.status(500).json({
      error:
        error?.message ||
        "Material upload failed."
    });
  }
}
