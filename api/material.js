import { put } from "@vercel/blob";
import {
  isAdminAuthenticated
} from "./_adminAuth.js";

const LEVELS = {
  foundation: "Foundation",
  inter: "Intermediate",
  final: "Final"
};

const SUBJECTS = {
  foundation: [
    "accounting",
    "business_laws",
    "quantitative_aptitude",
    "business_economics"
  ],

  inter: [
    "advanced_accounts",
    "law",
    "taxation",
    "costing",
    "audit",
    "fm",
    "sm"
  ],

  final: [
    "financial_reporting",
    "advanced_financial_management",
    "advanced_auditing",
    "direct_tax",
    "indirect_tax",
    "international_tax",
    "strategic_cost_management",
    "multidisciplinary_case_study"
  ]
};

function safe(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-zA-Z0-9_-]/g, "_");
}

function validateModelType(
  level,
  modelType
) {

  if (level === "foundation") {

    return [
      "model_test",
      "other"
    ].includes(modelType);

  }

  if (
    level === "inter" ||
    level === "final"
  ) {

    return [
      "group_1",
      "group_2",
      "other"
    ].includes(modelType);

  }

  return false;
}

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

    const {
      filename,
      data,
      contentType,
      level,
      modelType,
      subjects,
      subjectKey,
      testType,
      type
    } = req.body || {};

    if (!process.env.BLOB_READ_WRITE_TOKEN) {
      return res.status(500).json({
        error:
          "BLOB_READ_WRITE_TOKEN is not configured."
      });
    }

    if (!filename || !data) {
      return res.status(400).json({
        error: "File data is missing."
      });
    }

    const safeLevel = safe(level);

    if (!LEVELS[safeLevel]) {
      return res.status(400).json({
        error:
          "Invalid level. Use foundation, inter or final."
      });
    }

    const safeModelType = safe(modelType);

    if (
      !validateModelType(
        safeLevel,
        safeModelType
      )
    ) {

      return res.status(400).json({
        error:
          "Invalid Model Test type for selected level."
      });

    }

    const isModelTest =
      testType === "MODEL_TEST";

    const isSpecificOther =
      safeModelType === "other";

    let selectedSubjects = [];

    if (Array.isArray(subjects)) {

      selectedSubjects =
        subjects
          .map((item) => safe(item))
          .filter(Boolean);

    }

    /*
      For Model Test:
      Admin must specify subjects.

      Foundation:
      Model Test = all 4 subjects can be selected.

      Inter / Final:
      Group 1 / Group 2 / Other
    */

    if (
      isModelTest ||
      isSpecificOther
    ) {

      if (!selectedSubjects.length) {

        return res.status(400).json({
          error:
            "Please specify at least one subject."
        });

      }

    }

    /*
      Validate subjects for the selected level.
    */

    if (
      selectedSubjects.length &&
      LEVELS[safeLevel]
    ) {

      const allowed =
        SUBJECTS[safeLevel] || [];

      const invalid =
        selectedSubjects.filter(
          (item) =>
            !allowed.includes(item)
        );

      if (invalid.length) {

        return res.status(400).json({
          error:
            "Invalid subject(s) for selected level.",
          invalid
        });

      }

    }

    /*
      File type
    */

    const lowerName =
      String(filename).toLowerCase();

    if (
      !lowerName.endsWith(".pdf")
    ) {

      return res.status(400).json({
        error:
          "Only PDF files are allowed."
      });

    }

    /*
      Convert base64 to Buffer
    */

    let cleanBase64 = String(data);

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
      Model Test:
      One PDF contains both Question Paper
      and Suggested Answer.
    */

    let materialType = type;

    if (isModelTest) {

      materialType =
        "model-test-combined";

    } else if (
      type === "question-paper"
    ) {

      materialType =
        "question-paper";

    } else if (
      type === "suggested-answer"
    ) {

      materialType =
        "suggested-answer";

    } else {

      materialType =
        "question-paper";

    }

    /*
      Create subject path.
    */

    const subjectFolder =
      selectedSubjects.length
        ? selectedSubjects.join("+")
        : safe(subjectKey || "general");

    const timestamp =
      Date.now();

    const safeFilename =
      lowerName
        .replace(
          /[^a-z0-9._-]/g,
          "_"
        );

    const pathname =
      [
        "materials",
        safeLevel,
        safeModelType,
        subjectFolder,
        `${materialType}-${timestamp}-${safeFilename}`
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
        isModelTest
          ? "Combined Model Test uploaded successfully."
          : "Material uploaded successfully.",

      material: {

        level:
          LEVELS[safeLevel],

        levelKey:
          safeLevel,

        modelType:
          safeModelType,

        testType:
          testType || null,

        subjects:
          selectedSubjects,

        type:
          materialType,

        pathname:
          blob.pathname

      }

    });

  } catch (error) {

    console.error(
      "MATERIAL ERROR:",
      error
    );

    return res.status(500).json({

      error:
        "Material upload failed.",

      details:
        error?.message ||
        "Unknown error"

    });

  }

}
