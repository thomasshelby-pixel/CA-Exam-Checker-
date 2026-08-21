import { put } from "@vercel/blob";

export const config = {
  api: {
    bodyParser: false,
    responseLimit: false
  }
};

function safe(value) {
  return String(value || "").replace(/[^a-zA-Z0-9_-]/g, "_");
}

function getHeader(req, name) {
  const value = req.headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : (value || "");
}

function decodeHeader(value) {
  try {
    return decodeURIComponent(String(value || ""));
  } catch {
    return String(value || "");
  }
}

async function readRawBody(req, maxBytes) {
  const chunks = [];
  let total = 0;

  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk)
      ? chunk
      : Buffer.from(chunk);

    total += buffer.length;

    if (total > maxBytes) {
      const error = new Error(
        "Answer sheet must be smaller than 4 MB."
      );

      error.statusCode = 413;
      throw error;
    }

    chunks.push(buffer);
  }

  return Buffer.concat(chunks);
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

    const contentType =
      getHeader(req, "content-type") ||
      "application/pdf";

    if (
      !contentType
        .toLowerCase()
        .includes("application/pdf")
    ) {
      return res.status(400).json({
        error:
          "Please upload a PDF answer sheet."
      });
    }

    const filename =
      decodeHeader(
        getHeader(req, "x-filename")
      ) ||
      "answer-sheet.pdf";

    const studentName =
      decodeHeader(
        getHeader(req, "x-student-name")
      );

    const registrationNumber =
      decodeHeader(
        getHeader(req, "x-registration-number")
      );

    const level =
      decodeHeader(
        getHeader(req, "x-level")
      );

    const subject =
      decodeHeader(
        getHeader(req, "x-subject")
      );

    const subjectKey =
      decodeHeader(
        getHeader(req, "x-subject-key")
      );

    const testType =
      decodeHeader(
        getHeader(req, "x-test-type")
      );

    const modelType =
      decodeHeader(
        getHeader(req, "x-model-type")
      );

    const pyqAttempt =
      decodeHeader(
        getHeader(req, "x-pyq-attempt")
      );

    const checkingMode =
      decodeHeader(
        getHeader(req, "x-checking-mode")
      );

    const descriptiveMaximum =
      decodeHeader(
        getHeader(req, "x-descriptive-maximum")
      );

    if (!level) {
      return res.status(400).json({
        error: "Level is missing."
      });
    }

    if (!testType) {
      return res.status(400).json({
        error: "Test type is missing."
      });
    }

    const buffer =
      await readRawBody(
        req,
        4 * 1024 * 1024
      );

    if (!buffer.length) {
      return res.status(400).json({
        error:
          "Answer sheet is empty."
      });
    }

    const safeFilename =
      String(filename)
        .replace(
          /[^a-zA-Z0-9._-]/g,
          "_"
        );

    const pathname =
      `answers/${safe(level)}/${safe(testType)}/${Date.now()}-${safeFilename}`;

    const blob =
      await put(
        pathname,
        buffer,
        {
          access: "private",

          contentType:
            "application/pdf",

          token:
            process.env.BLOB_READ_WRITE_TOKEN,

          addRandomSuffix:
            false,

          multipart:
            buffer.length >
            2 * 1024 * 1024,

          metadata: {
            studentName,
            registrationNumber,
            level,
            subject,
            subjectKey,
            testType,
            modelType,
            pyqAttempt,
            checkingMode,
            descriptiveMaximum
          }
        }
      );

    return res.status(200).json({

      success: true,

      pathname:
        blob.pathname,

      filename,

      size:
        buffer.length

    });

  } catch (error) {

    console.error(
      "ANSWER UPLOAD ERROR:",
      error
    );

    return res.status(
      error?.statusCode || 500
    ).json({

      error:
        error?.message ||
        "Answer sheet upload failed."

    });
  }
}
