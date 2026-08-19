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
      classification,
      exam,
      checkingMode,
      descriptiveMaximum
    } = req.body;

    // Required fields
    if (!filename || !data) {
      return res.status(400).json({
        error: "File data missing"
      });
    }

    if (!studentName) {
      return res.status(400).json({
        error: "Student name is required"
      });
    }

    if (!registrationNumber) {
      return res.status(400).json({
        error: "Registration number is required"
      });
    }

    if (!subject || !subjectKey) {
      return res.status(400).json({
        error: "Subject information is required"
      });
    }

    if (!classification) {
      return res.status(400).json({
        error: "Paper classification is required"
      });
    }

    if (!exam) {
      return res.status(400).json({
        error: "Exam/Test name is required"
      });
    }

    // Allowed paper classifications
    const allowedClassifications = [
      "MTP",
      "RTP",
      "Model Test Paper",
      "Other"
    ];

    if (!allowedClassifications.includes(classification)) {
      return res.status(400).json({
        error: "Invalid paper classification"
      });
    }

    // Convert Base64 to Buffer
    const buffer = Buffer.from(data, "base64");

    // Safe filename
    const safeFilename = String(filename)
      .replace(/[^a-zA-Z0-9._-]/g, "-");

    // Upload answer sheet
    const blob = await put(
      `answer-sheets/${subjectKey}/${classification}/${Date.now()}-${safeFilename}`,
      buffer,
      {
        access: "private",
        contentType: contentType || "application/pdf"
      }
    );

    // Return complete metadata
    return res.status(200).json({
      success: true,

      url: blob.url,

      pathname: blob.pathname,

      student: {
        name: studentName,
        registrationNumber: registrationNumber
      },

      test: {
        subject: subject,
        subjectKey: subjectKey,
        classification: classification,
        exam: exam
      },

      checking: {
        mode: checkingMode || "strict",
        descriptiveMaximum:
          descriptiveMaximum || null
      },

      message:
        "Answer sheet uploaded successfully with complete test metadata."
    });

  } catch (error) {

    console.error("UPLOAD ERROR:", error);

    return res.status(500).json({
      error: "Upload failed"
    });
  }
}
