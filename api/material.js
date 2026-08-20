import { put } from "@vercel/blob";

export default async function handler(req, res) {

  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Method not allowed"
    });
  }

  try {

    /*
     * IMPORTANT:
     * Admin authentication is handled by the existing
     * admin-login/admin-logout system.
     *
     * If your existing material.js already has a working
     * admin-session verification helper, keep that helper
     * and place it before this upload section.
     */

    const {
      filename,
      data,
      contentType,

      level,
      group,

      subjectKey,

      testType,

      modelTestNumber,

      type

    } = req.body || {};


    /* ================================================
       VALIDATION
    ================================================ */

    if (!filename || !data) {
      return res.status(400).json({
        error: "File data is missing."
      });
    }

    if (!level) {
      return res.status(400).json({
        error: "CA Level is missing."
      });
    }

    if (!group) {
      return res.status(400).json({
        error: "Group is missing."
      });
    }

    if (!testType) {
      return res.status(400).json({
        error: "Test Type is missing."
      });
    }

    if (testType === "MODEL_TEST") {

      if (!modelTestNumber) {
        return res.status(400).json({
          error: "Model Test number is missing."
        });
      }

      if (type !== "model-test") {
        return res.status(400).json({
          error: "Invalid Model Test upload type."
        });
      }

    } else {

      if (!subjectKey) {
        return res.status(400).json({
          error: "Subject is missing."
        });
      }

      if (
        type !== "question-paper" &&
        type !== "suggested-answer"
      ) {
        return res.status(400).json({
          error: "Invalid material type."
        });
      }

    }


    if (!process.env.BLOB_READ_WRITE_TOKEN) {
      return res.status(500).json({
        error:
          "BLOB_READ_WRITE_TOKEN is not configured."
      });
    }


    /* ================================================
       SAFE VALUES
    ================================================ */

    function safe(value) {

      return String(value)
        .trim()
        .replace(/[^a-zA-Z0-9_-]/g, "_");

    }


    const safeLevel =
      safe(level);

    const safeGroup =
      safe(group);

    const safeTestType =
      safe(testType);


    let pathname;


    /* ================================================
       MODEL TEST
       ONE PDF = QUESTION + SUGGESTED ANSWER
    ================================================ */

    if (testType === "MODEL_TEST") {

      const safeModel =
        safe(modelTestNumber);

      pathname =
        `materials/${safeLevel}/${safeGroup}/model-test-${safeModel}/model-test-${Date.now()}-${safe(filename)}`;

    }


    /* ================================================
       NORMAL MATERIAL
    ================================================ */

    else {

      const safeSubject =
        safe(subjectKey);

      pathname =
        `materials/${safeLevel}/${safeGroup}/${safeSubject}/${safeTestType}/${safe(type)}-${Date.now()}-${safe(filename)}`;

    }


    /* ================================================
       BASE64 → BUFFER
    ================================================ */

    const buffer =
      Buffer.from(data, "base64");


    /* ================================================
       UPLOAD
    ================================================ */

    const blob =
      await put(
        pathname,
        buffer,
        {
          access: "public",

          token:
            process.env.BLOB_READ_WRITE_TOKEN,

          contentType:
            contentType ||
            "application/pdf",

          addRandomSuffix: false
        }
      );


    console.log(
      "MATERIAL UPLOADED:",
      blob.pathname
    );


    return res.status(200).json({

      success: true,

      pathname:
        blob.pathname,

      url:
        blob.url,

      metadata: {

        level,

        group,

        subjectKey:
          subjectKey || null,

        testType,

        modelTestNumber:
          modelTestNumber || null,

        type

      }

    });


  } catch (error) {

    console.error(
      "MATERIAL UPLOAD ERROR:",
      error
    );

    return res.status(500).json({

      error:
        "Unable to upload material.",

      details:
        error?.message ||
        "Unknown error"

    });

  }

}
