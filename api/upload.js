import {
  put
} from "@vercel/blob";

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

      studentName = "",

      registrationNumber = "",

      level,

      subjectKey = "",

      testType,

      modelType = "",

      pyqAttempt = ""

    } = req.body || {};


    if (!filename || !data) {

      return res.status(400).json({
        error:
          "Answer sheet is missing."
      });

    }

    if (!level || !testType) {

      return res.status(400).json({
        error:
          "Level and test type are required."
      });

    }


    const pathname =
      `answer-sheets/` +
      `${safe(level)}/` +
      `${safe(testType)}/` +
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

      url:
        blob.url,

      pathname:
        blob.pathname,

      metadata: {

        studentName,

        registrationNumber,

        level,

        subjectKey,

        testType,

        modelType,

        pyqAttempt

      }

    });

  } catch (error) {

    console.error(
      "UPLOAD ERROR:",
      error
    );

    return res.status(500).json({

      error:
        "Answer sheet upload failed.",

      details:
        error?.message ||
        "Unknown error"

    });

  }

}
