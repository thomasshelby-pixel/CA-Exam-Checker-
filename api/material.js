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
      subject,
      testType,
      type
    } = req.body;

    if (!filename || !data) {
      return res.status(400).json({
        error: "File data missing"
      });
    }

    if (!subject) {
      return res.status(400).json({
        error: "Subject missing"
      });
    }

    if (!testType) {
      return res.status(400).json({
        error: "Test type missing"
      });
    }

    if (!type) {
      return res.status(400).json({
        error: "Material type missing"
      });
    }

    const safeSubject =
      String(subject)
        .replace(/[^a-zA-Z0-9_-]/g, "_");

    const safeTestType =
      String(testType)
        .replace(/[^a-zA-Z0-9_-]/g, "_");

    const safeType =
      String(type)
        .replace(/[^a-zA-Z0-9_-]/g, "_");

    const safeFilename =
      String(filename)
        .replace(/[^a-zA-Z0-9._-]/g, "_");

    const buffer =
      Buffer.from(data, "base64");

    const pathname =
      `materials/${safeSubject}/${safeTestType}/${safeType}-${Date.now()}-${safeFilename}`;

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

      classification: {
        subject,
        testType,
        materialType: type
      }

    });

  } catch (error) {

    console.error(error);

    return res.status(500).json({
      error:
        error.message ||
        "Material upload failed"
    });

  }

}
