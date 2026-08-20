import { put } from "@vercel/blob";

function safe(value) {
  return String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, "_");
}

export default async function handler(req, res) {

  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Method not allowed"
    });
  }

  try {

    if (!process.env.BLOB_READ_WRITE_TOKEN) {
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
      checkingMode
    } = req.body || {};

    if (!data) {
      return res.status(400).json({
        error:
          "Answer sheet data is missing."
      });
    }

    if (!filename) {
      return res.status(400).json({
        error:
          "Answer sheet filename is missing."
      });
    }

    if (
      !String(filename)
        .toLowerCase()
        .endsWith(".pdf")
    ) {
      return res.status(400).json({
        error:
          "Only PDF answer sheets are allowed."
      });
    }

    let cleanBase64 =
      String(data);

    if (
      cleanBase64.includes(",")
    ) {
      cleanBase64 =
        cleanBase64.split(",").pop();
    }

    const buffer =
      Buffer.from(
        cleanBase64,
        "base64"
      );

    if (!buffer.length) {
      return res.status(400).json({
        error:
          "Invalid PDF data."
      });
    }

    /*
      Keep student files private.
    */

    const pathname =
      [
        "answer-sheets",
        safe(level || "unknown"),
        safe(subjectKey || "unknown"),
        safe(testType || "unknown"),
        `${Date.now()}-${safe(
          studentName || "student"
        )}-${safe(
          registrationNumber || "unknown"
        )}-${safe(filename)}`
      ].join("/");

    const blob =
      await put(
        pathname,
        buffer,
        {
          access: "private",

          token:
            process.env.BLOB_READ_WRITE_TOKEN,

          contentType:
            contentType ||
            "application/pdf",

          addRandomSuffix: false
        }
      );

    return res.status(200).json({

      success: true,

      message:
        "Answer sheet uploaded successfully.",

      pathname:
        blob.pathname,

      metadata: {
        studentName:
          studentName || "",

        registrationNumber:
          registrationNumber || "",

        level:
          level || "",

        subject:
          subject || "",

        subjectKey:
          subjectKey || "",

        testType:
          testType || "",

        checkingMode:
          checkingMode || ""
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
