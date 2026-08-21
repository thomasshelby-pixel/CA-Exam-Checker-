import {
  put
} from "@vercel/blob";

import {
  isAdmin
} from "./auth.js";


function safe(value) {

  return String(value ?? "")
    .trim()
    .replace(
      /[^a-zA-Z0-9._-]/g,
      "_"
    );

}


export default async function handler(
  req,
  res
) {

  if (req.method !== "POST") {

    return res.status(405).json({
      error:
        "Method not allowed"
    });

  }


  /* =========================
     ADMIN LOCK
  ========================= */

  if (!isAdmin(req)) {

    return res.status(403).json({

      error:
        "Admin login required."

    });

  }


  try {

    const token =
      process.env
        .BLOB_READ_WRITE_TOKEN;


    if (!token) {

      return res.status(500).json({
        error:
          "BLOB_READ_WRITE_TOKEN is not configured."
      });

    }


    const {

      filename,

      data,

      contentType =
        "application/pdf",

      level,

      testType,

      modelType = "",

      pyqAttempt = "",

      subjects = [],

      type

    } = req.body || {};


    if (!filename || !data) {

      return res.status(400).json({
        error:
          "File is missing."
      });

    }


    if (
      !level ||
      !testType ||
      !type
    ) {

      return res.status(400).json({
        error:
          "Level, test type and material type are required."
      });

    }


    /* =========================
       PYQ ATTEMPT
    ========================= */

    if (
      testType === "PYQ" &&
      !pyqAttempt
    ) {

      return res.status(400).json({
        error:
          "PYQ attempt is required."
      });

    }


    /* =========================
       MODEL TYPE
    ========================= */

    if (
      testType === "MODEL_TEST" &&
      !modelType
    ) {

      return res.status(400).json({
        error:
          "Model Test type is required."
      });

    }


    const cleanSubjects =
      Array.isArray(subjects)

        ? subjects
            .map(s => safe(s))
            .filter(Boolean)

        : [];


    /*
      Normal papers:
      exactly one subject
    */

    if (
      testType !== "MODEL_TEST" &&
      cleanSubjects.length !== 1
    ) {

      return res.status(400).json({
        error:
          "Exactly one subject is required."
      });

    }


    /*
      Model Test:
      subject is represented by
      model group.
    */

    const materialKey =

      testType === "MODEL_TEST"

        ? `model-${safe(modelType)}`

        : safe(cleanSubjects[0]);


    const attempt =

      testType === "PYQ"

        ? safe(pyqAttempt)

        : "NA";


    /*
      FINAL PATH
    */

    const pathname =
      `materials/` +
      `${safe(level)}/` +
      `${safe(testType)}/` +
      `${materialKey}/` +
      `${attempt}/` +
      `${safe(type)}-` +
      `${Date.now()}-` +
      `${safe(filename)}`;


    const blob =
      await put(
        pathname,
        Buffer.from(
          data,
          "base64"
        ),
        {

          access:
            "public",

          token,

          contentType,

          addRandomSuffix:
            true

        }
      );


    return res.status(200).json({

      success:
        true,

      pathname:
        blob.pathname,

      url:
        blob.url

    });


  } catch (error) {

    console.error(
      "MATERIAL ERROR:",
      error
    );


    return res.status(500).json({

      error:
        "Material upload failed.",

      details:
        error?.message ||
        "Unknown error"

    });

  }

}
