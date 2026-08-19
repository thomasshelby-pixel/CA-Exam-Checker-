import { put } from "@vercel/blob";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { filename, data, contentType } = req.body;

    if (!filename || !data) {
      return res.status(400).json({
        error: "File data missing"
      });
    }

    const buffer = Buffer.from(data, "base64");

    const blob = await put(
      `answer-sheets/${Date.now()}-${filename}`,
      buffer,
      {
        access: "private",
        contentType: contentType || "application/pdf",
      }
    );

    return res.status(200).json({
      success: true,
      url: blob.url,
      pathname: blob.pathname
    });

  } catch (error) {
    console.error(error);

    return res.status(500).json({
      error: "Upload failed"
    });
  }
}
