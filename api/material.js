import { put } from "@vercel/blob";

import {
  isAdminAuthenticated
} from "./_adminAuth.js";


export default async function handler(req,res){

  if(req.method !== "POST"){

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
        error:
          "BLOB_READ_WRITE_TOKEN is not configured."
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


    const validLevels=[
      "foundation",
      "inter",
      "final"
    ];


    if(!validLevels.includes(level)){

      return res.status(400).json({
        error:"Invalid CA level."
      });

    }


    const validTestTypes=[
      "MTP",
      "RTP",
      "PYQ",
      "MODEL_TEST",
      "OTHER"
    ];


    if(!validTestTypes.includes(testType)){

      return res.status(400).json({
        error:"Invalid test type."
      });

    }


    const subjectList=
      Array.isArray(subjects)
      ?subjects
      :[];


    /*
     * MTP / RTP / PYQ
     * Exactly one subject.
     */

    if(
      testType==="MTP" ||
      testType==="RTP" ||
      testType==="PYQ"
    ){

      if(subjectList.length!==1){

        return res.status(400).json({
          error:
            `${testType} requires exactly one subject.`
        });

      }

    }


    /*
     * MODEL TEST
     */

    if(testType==="MODEL_TEST"){

      if(!modelType){

        return res.status(400).json({
          error:
            "Model Test Type is required."
        });

      }


      if(
        level==="foundation" &&
        modelType!=="MODEL_TEST"
      ){

        return res.status(400).json({
          error:
            "Foundation only supports Foundation Model Test."
        });

      }


      if(
        (
          level==="inter" ||
          level==="final"
        ) &&
        ![
          "GROUP_1",
          "GROUP_2",
          "OTHER"
        ].includes(modelType)
      ){

        return res.status(400).json({
          error:
            "Invalid Model Test Type."
        });

      }


      if(
        modelType==="OTHER" &&
        subjectList.length===0
      ){

        return res.status(400).json({
          error:
            "Model Test Other requires subjects."
        });

      }

    }


    /*
     * OTHER
     */

    if(
      testType==="OTHER" &&
      subjectList.length===0
    ){

      return res.status(400).json({
        error:
          "Other material requires at least one subject."
      });

    }


    const safeLevel=
      String(level)
        .replace(
          /[^a-zA-Z0-9_-]/g,
          "_"
        );


    const safeTestType=
      String(testType)
        .replace(
          /[^a-zA-Z0-9_-]/g,
          "_"
        );


    const safeModelType=
      String(modelType || "NONE")
        .replace(
          /[^a-zA-Z0-9_-]/g,
          "_"
        );


    /*
     * SUBJECT FOLDER
     *
     * For single subject:
     * subject key
     *
     * For multiple:
     * combined sorted subject keys
     */

    const subjectFolder=
      subjectList.length
      ?subjectList
        .map(
          s=>String(s)
            .replace(
              /[^a-zA-Z0-9_-]/g,
              "_"
            )
        )
        .sort()
        .join("__")
      :"ALL";


    const safeType=
      String(type || "material")
        .replace(
          /[^a-zA-Z0-9_-]/g,
          "_"
        );


    const timestamp=
      Date.now();


    const safeFilename=
      String(filename)
        .replace(
          /[^a-zA-Z0-9._-]/g,
          "_"
        );


    /*
     * FINAL BLOB STRUCTURE
     *
     * materials/
     *   inter/
     *     PYQ/
     *       NONE/
     *         costing/
     *
     *   inter/
     *     MODEL_TEST/
     *       GROUP_2/
     *         ALL/
     *
     *   inter/
     *     MODEL_TEST/
     *       OTHER/
     *         audit__costing/
     */

    const prefix=
      `materials/${safeLevel}/${safeTestType}/${safeModelType}/${subjectFolder}`;


    const pathname=
      `${prefix}/${safeType}-${timestamp}-${safeFilename}`;


    const buffer=
      Buffer.from(
        data,
        "base64"
      );


    if(
      buffer.length >
      10 * 1024 * 1024
    ){

      return res.status(400).json({
        error:
          "File must be smaller than 10 MB."
      });

    }


    const blob=
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
              subjectList.join(","),

            materialType:
              type || ""

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

        subjects:
          subjectList,

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
attempt
