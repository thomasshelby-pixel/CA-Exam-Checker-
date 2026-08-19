import { put } from "@vercel/blob";

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
      contentType,
      studentName,
      registrationNumber,
      subject,
      subjectKey,
      testType,
      checkingMode,
      descriptiveMaximum
    } = req.body;

    if (!filename || !data) {
      return res.status(400).json({
        error: "File data missing"
      });
    }

    const safeSubject =
      String(subjectKey || "unknown")
        .replace(/[^a-zA-Z0-9_-]/g, "_");

    const safeTestType =
      String(testType || "OTHER")
        .replace(/[^a-zA-Z0-9_-]/g, "_");

    const safeFilename =
      String(filename)
        .replace(/[^a-zA-Z0-9._-]/g, "_");

    const timestamp = Date.now();

    const buffer =
      Buffer.from(data, "base64");

    const pathname =
      `answer-sheets/${safeSubject}/${safeTestType}/${timestamp}-${safeFilename}`;

    const blob =
      await put(
        pathname,
        buffer,
        {
          access: "private",
          contentType:
            contentType || "application/pdf"
        }
      );

    return res.status(200).json({

      success: true,

      url: blob.url,

      pathname: blob.pathname,

      metadata: {
        studentName:
          studentName || "",

        registrationNumber:
          registrationNumber || "",

        subject:
          subject || "",

        subjectKey:
          subjectKey || "",

        testType:
          testType || "OTHER",

        checkingMode:
          checkingMode || "strict",

        descriptiveMaximum:
          descriptiveMaximum || null
      }

    });

  } catch (error) {

    console.error(error);

    return res.status(500).json({
      error:
        error.message ||
        "Upload failed"
    });

  }

}
