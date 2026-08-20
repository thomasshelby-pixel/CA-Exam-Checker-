import { put } from "@vercel/blob";

function safe(value) {
  return String(value ?? "")
    .trim()
    .replace(/[^a-zA-Z0-9._-]/g, "_");
}

export default async function handler(req, res) {

  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Method not allowed"
    });
  }

  try {

    const {
      filename,
      data,
      contentType = "application/pdf",

      level,
      testType,
      modelType = "",
      pyqAttempt = "",

      subjects = [],
      type
    } = req.body || {};

    /* ================================
       ENV
    ================================= */

    const token =
      process.env.BLOB_READ_WRITE_TOKEN;

    if (!token) {
      return res.status(500).json({
        error:
          "BLOB_READ_WRITE_TOKEN is not configured."
      });
    }

    /* ================================
       VALIDATION
    ================================= */

    if (!filename || !data) {
      return res.status(400).json({
        error: "File data is missing."
      });
    }

    if (!level) {
      return res.status(400).json({
        error: "Level is required."
      });
    }

    if (!testType) {
      return res.status(400).json({
        error: "Test type is required."
      });
    }

    if (!type) {
      return res.status(400).json({
        error: "Material type is required."
      });
    }

    /* ================================
       PYQ
    ================================= */

    if (
      testType === "PYQ" &&
      !pyqAttempt
    ) {
      return res.status(400).json({
        error:
          "PYQ attempt is required."
      });
    }

    /* ================================
       MODEL TEST
    ================================= */

    if (
      testType === "MODEL_TEST" &&
      !modelType
    ) {
      return res.status(400).json({
        error:
          "Model Test type is required."
      });
    }

    /* ================================
       SUBJECTS
    ================================= */

    const cleanSubjects =
      Array.isArray(subjects)
        ? subjects
            .map(s => safe(s))
            .filter(Boolean)
        : [];

    /*
      Normal MTP/RTP/PYQ/OTHER:
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
      subject is determined by
      Group 1 / Group 2 / Other
    */

    let materialKey;

    if (testType === "MODEL_TEST") {

      materialKey =
        `model-${safe(modelType)}`;

    } else {

      materialKey =
        safe(cleanSubjects[0]);

    }

    /* ================================
       ATTEMPT
    ================================= */

    const attempt =
      testType === "PYQ"
        ? safe(pyqAttempt)
        : "NA";

    /* ================================
       TYPE
    ================================= */

    const cleanType =
      safe(type);

    /*
      Expected paths:

      MODEL:
      materials/inter/MODEL_TEST/
      model-GROUP_1/NA/model-test-...

      PYQ:
      materials/inter/PYQ/
      taxation/MAY_2026/question-paper-...

      MTP:
      materials/inter/MTP/
      taxation/NA/question-paper-...
    */

    const pathname =
      `materials/` +
      `${safe(level)}/` +
      `${safe(testType)}/` +
      `${materialKey}/` +
      `${attempt}/` +
      `${cleanType}-` +
      `${Date.now()}-` +
      `${safe(filename)}`;

    /* ================================
       UPLOAD
    ================================= */

    const blob =
      await put(
        pathname,
        Buffer.from(
          data,
          "base64"
        ),
        {
          access: "public",

          token,

          contentType
        }
      );

    /* ================================
       RESPONSE
    ================================= */

    return res.status(200).json({

      success: true,

      pathname:
        blob.pathname,

      url:
        blob.url

    });

  } catch (error) {

    console.error(
      "MATERIAL UPLOAD ERROR:",
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
