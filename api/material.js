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
      testId,
      testName,
      paperType,
      subject,
      type
    } = req.body;

    // Required fields
    if (
      !filename ||
      !data ||
      !testId ||
      !testName ||
      !paperType ||
      !subject ||
      !type
    ) {
      return res.status(400).json({
        error:
          "filename, data, testId, testName, paperType, subject and type are required"
      });
    }

    // Allowed material types
    if (
      type !== "question-paper" &&
      type !== "suggested-answer"
    ) {
      return res.status(400).json({
        error: "Invalid material type"
      });
    }

    // Allowed paper types
    const allowedPaperTypes = [
      "MTP",
      "RTP",
      "MODEL_TEST",
      "OTHER"
    ];

    if (!allowedPaperTypes.includes(paperType)) {
      return res.status(400).json({
        error: "Invalid paper type"
      });
    }

    // Safe values for Blob pathname
    const safeTestId =
      String(testId)
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, "-");

    const safeSubject =
      String(subject)
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "");

    const safePaperType =
      String(paperType)
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, "-");

    const safeFilename =
      String(filename)
        .replace(/[^a-zA-Z0-9._-]/g, "-");

    // Convert Base64 to Buffer
    const buffer =
      Buffer.from(data, "base64");

    // Unique file name
    const timestamp = Date.now();

    /*
      IMPORTANT:

      Both Question Paper and Suggested Answer
      use the SAME testId.

      Example:

      MTP-MAY26-01/
        question-paper.pdf
        suggested-answer.pdf
    */

    const pathname =
      `test-material/${safeTestId}/${safeSubject}/${safePaperType}/${type}/${timestamp}-${safeFilename}`;

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

      testId: testId,

      testName: testName,

      paperType: paperType,

      subject: subject,

      type: type,

      url: blob.url,

      pathname: blob.pathname

    });

  } catch (error) {

    console.error(
      "Material upload error:",
      error
    );

    return res.status(500).json({
      error:
        error.message ||
        "Material upload failed"
    });
  }
}
