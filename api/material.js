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
      type
    } = req.body;

    if (!filename || !data || !subject || !type) {
      return res.status(400).json({
        error: "filename, data, subject and type are required"
      });
    }

    if (
      type !== "question-paper" &&
      type !== "suggested-answer"
    ) {
      return res.status(400).json({
        error: "Invalid material type"
      });
    }

    const safeSubject =
      String(subject)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "");

    const safeFilename =
      String(filename)
        .replace(/[^a-zA-Z0-9._-]/g, "-");

    const buffer =
      Buffer.from(data, "base64");

    const blob =
      await put(
        `test-material/${safeSubject}/${type}/${Date.now()}-${safeFilename}`,
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
      subject: subject,
      type: type
    });

  } catch (error) {

    console.error(error);

    return res.status(500).json({
      error: "Material upload failed"
    });

  }
}
