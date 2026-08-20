import { put } from "@vercel/blob";
import { isAdminAuthenticated } from "./_adminAuth.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Method not allowed"
    });
  }

  if (!isAdminAuthenticated(req)) {
    return res.status(403).json({
      error: "Admin authentication required."
    });
  }

  try {
    if (!process.env.BLOB_READ_WRITE_TOKEN) {
      return res.status(500).json({
        error: "BLOB_READ_WRITE_TOKEN is not configured."
      });
    }

    const {
      filename,
      data,
      contentType,
      level,
      testType,
      modelType,
      subjects,
      type
    } = req.body || {};

    if (!filename || !data) {
      return res.status(400).json({
        error: "File is missing."
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

    const subjectList = Array.isArray(subjects)
      ? subjects.filter(Boolean)
      : [];

    if (
      testType !== "MODEL_TEST" &&
      subjectList.length === 0
    ) {
      return res.status(400).json({
        error: "At least one subject is required."
      });
    }

    if (
      testType === "MODEL_TEST" &&
      !modelType
    ) {
      return res.status(400).json({
        error: "Model Test Type is required."
      });
    }

    if (
      testType === "MODEL_TEST" &&
      modelType !== "FOUNDATION" &&
      subjectList.length === 0
    ) {
      return res.status(400).json({
        error:
          "At least one subject must be selected for this Model Test."
      });
    }

    if (
      !type ||
      ![
        "question-paper",
        "suggested-answer",
        "model-test"
      ].includes(type)
    ) {
      return res.status(400).json({
        error: "Invalid material type."
      });
    }

    const safe = (value) =>
      String(value)
        .trim()
        .replace(/[^a-zA-Z0-9_-]/g, "_");

    const safeLevel = safe(level);
    const safeTestType = safe(testType);
    const safeModelType = safe(modelType || "NONE");

    const safeFilename = safe(filename);

    const buffer = Buffer.from(data, "base64");

    if (buffer.length > 20 * 1024 * 1024) {
      return res.status(400).json({
        error: "File must be smaller than 20 MB."
      });
    }

    let pathname;

    /*
     * MODEL TEST
     *
     * One PDF can represent multiple subjects.
     *
     * Storage:
     * materials/
     *   level/
     *     model-test/
     *       modelType/
     *         combined/
     */

    if (testType === "MODEL_TEST") {
      pathname =
        `materials/${safeLevel}/MODEL_TEST/${safeModelType}/` +
        `model-test-${Date.now()}-${safeFilename}`;
    }

    /*
     * NORMAL PAPERS
     *
     * One subject per material upload.
     *
     * Storage:
     * materials/
     *   level/
     *     subject/
     *       testType/
     *         question-paper / suggested-answer
     */

    else {
      const primarySubject = safe(subjectList[0]);

      pathname =
        `materials/${safeLevel}/${primarySubject}/${safeTestType}/` +
        `${safe(type)}-${Date.now()}-${safeFilename}`;
    }

    const blob = await put(
      pathname,
      buffer,
      {
        access: "private",

        token:
          process.env.BLOB_READ_WRITE_TOKEN,

        contentType:
          contentType || "application/pdf",

        addRandomSuffix: false
      }
    );

    console.log(
      "MATERIAL UPLOADED:",
      pathname
    );

    return res.status(200).json({
      success: true,

      pathname:
        blob.pathname,

      url:
        blob.url,

      metadata: {
        level,
        testType,
        modelType: modelType || null,
        subjects: subjectList,
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
        error?.message ||
        "Material upload failed."
    });
  }
}
