import {
  adminCookieHeader
} from "./auth.js";

export default async function handler(
  req,
  res
) {

  if (req.method !== "POST") {

    return res.status(405).json({
      error: "Method not allowed"
    });

  }

  try {

    const {
      password
    } = req.body || {};

    const expected =
      process.env.ADMIN_PASSWORD;

    const secret =
      process.env.ADMIN_SESSION_SECRET;

    if (!expected || !secret) {

      return res.status(500).json({
        error:
          "ADMIN_PASSWORD and ADMIN_SESSION_SECRET must be configured in Vercel."
      });

    }

    if (
      !password ||
      password !== expected
    ) {

      return res.status(401).json({
        error:
          "Invalid admin password."
      });

    }

    res.setHeader(
      "Set-Cookie",
      adminCookieHeader(secret)
    );

    return res.status(200).json({
      success: true
    });

  } catch (error) {

    return res.status(500).json({
      error:
        "Admin login failed.",
      details:
        error?.message ||
        "Unknown error"
    });

  }
}
