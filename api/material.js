import { put } from "@vercel/blob";
import {
  isAdminAuthenticated
} from "../lib/adminAuth.js";

const LEVELS = [
  "foundation",
  "inter",
  "final"
];

const TYPES = [
  "MTP",
  "RTP",
  "PYQ",
  "MODEL_TEST",
  "OTHER"
];

const MODEL_TYPES = [
  "FOUNDATION",
  "GROUP_1",
  "GROUP_2",
  "OTHER"
];

function safe(value) {
  return String(value || "")
    .replace(/[^a-zA-Z0-9_-]/g, "_");
}

function safeAttempt(value) {
  return String(value || "")
    .trim()
    .replace(
      /[^a-zA-Z0-9._-]/g,
      "_"
    )
    .slice(0, 80);
}

function uniqueSorted(values) {
  return [
    ...new Set(
      values
        .filter(Boolean)
        .map(String)
    )
  ].sort();
}

export default async function handler(req, res) {

  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Method not allowed"
    });
  }

  if (!isAdminAuthenticated(req)) {
    return res.status(403).json({
      error:
        "Admin authentication required."
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
      level,
      testType,
      modelType,
      subjects,
      pyqAttempt,
      type
    } = req.body || {};

    if (!filename || !data) {
      return res.status(400).json({
        error: "File is missing."
      });
    }

    if (!LEVELS.includes(level)) {
      return res.status(400).json({
        error:
          "Invalid CA level."
      });
    }

    if (!TYPES.includes(testType)) {
      return res.status(400).json({
        error:
          "Invalid test type."
      });
    }

    const subjectList =
      uniqueSorted(
        Array.isArray(subjects)
          ? subjects
          : []
      );

    /*
      MTP / RTP / PYQ
      ----------------
      Exactly one subject.
    */

    if (
      ["MTP", "RTP", "PYQ"]
        .includes(testType) &&
      subjectList.length !== 1
    ) {
      return res.status(400).json({
        error:
          `${testType} requires exactly one subject.`
      });
    }

    /*
      PYQ
      ----------------
      Attempt mandatory.
    */

    if (
      testType === "PYQ" &&
      !safeAttempt(pyqAttempt)
    ) {
      return res.status(400).json({
        error:
          "PYQ Attempt is required."
      });
    }

    /*
      MODEL TEST
      ----------------
      Foundation:
        FOUNDATION

      Inter / Final:
        GROUP_1
        GROUP_2
        OTHER

      Group 1/2 = combined PDF.
      No subject selection.

      Other = admin selects subjects.
    */

    if (testType === "MODEL_TEST") {

      const validModel =
        level === "foundation"
          ? modelType === "FOUNDATION"
          : [
              "GROUP_1",
              "GROUP_2",
              "OTHER"
            ].includes(modelType);

      if (!validModel) {
        return res.status(400).json({
          error:
            "Invalid Model Test Type for the selected level."
        });
      }

      if (
        modelType === "OTHER" &&
        subjectList.length === 0
      ) {
        return res.status(400).json({
          error:
            "Model Test Other requires at least one subject."
        });
      }

      if (
        modelType !== "OTHER" &&
        subjectList.length !== 0
      ) {
        return res.status(400).json({
          error:
            "Group/Foundation Model Test must not have subject selection."
        });
      }
    }

    /*
      OTHER MATERIAL
    */

    if (
      testType === "OTHER" &&
      subjectList.length === 0
    ) {
      return res.status(400).json({
        error:
          "Other material requires at least one subject."
      });
    }

    const buffer =
      Buffer.from(
        data,
        "base64"
      );

    if (
      buffer.length >
      15 * 1024 * 1024
    ) {
      return res.status(400).json({
        error:
          "Material PDF must be smaller than 15 MB."
      });
    }

    const stamp =
      Date.now();

    const filenameSafe =
      safe(filename)
        .replace(
          /_pdf$/i,
          ".pdf"
        );

    const finalName =
      `${
        type ||
        (
          testType === "MODEL_TEST"
            ? "model-test"
            : "question-paper"
        )
      }-${stamp}-${filenameSafe}`;

    let pathname;

    /*
      MODEL TEST
    */

    if (
      testType === "MODEL_TEST"
    ) {

      const mt =
        safe(modelType);

      const folder =
        modelType === "OTHER"
          ? subjectList
              .map(safe)
              .sort()
              .join("__")
          : "ALL";

      pathname =
        `materials/${safe(level)}/MODEL_TEST/${mt}/${folder}/${finalName}`;

    }

    /*
      MTP / RTP / PYQ / OTHER
    */

    else {

      const subject =
        safe(
          subjectList[0] ||
          "general"
        );

      const attemptFolder =
        testType === "PYQ"
          ? `attempt-${safeAttempt(pyqAttempt)}`
          : "NONE";

      pathname =
        `materials/${safe(level)}/${safe(testType)}/NONE/${subject}/${attemptFolder}/${finalName}`;
    }

    const blob =
      await put(
        pathname,
        buffer,
        {
          access: "private",

          contentType:
            contentType ||
            "application/pdf",

          token:
            process.env
              .BLOB_READ_WRITE_TOKEN,

          addRandomSuffix:
            false,

          metadata: {
            level,
            testType,
            modelType:
              modelType || "",
            subjects:
              subjectList.join(","),
            pyqAttempt:
              pyqAttempt || "",
            type:
              type || ""
          }
        }
      );

    return res.status(200).json({
      success: true,
      pathname:
        blob.pathname,
      url:
        blob.url
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
