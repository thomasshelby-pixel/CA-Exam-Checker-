import {
  createAdminToken,
  getAdminCookie
} from "./_adminAuth.js";

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

    if (!password) {

      return res.status(400).json({
        error: "Password required"
      });

    }

    const adminPassword =
      process.env.ADMIN_PASSWORD;

    if (!adminPassword) {

      console.error(
        "ADMIN_PASSWORD is missing."
      );

      return res.status(500).json({
        error:
          "Admin authentication is not configured."
      });

    }

    if (
      password !==
      adminPassword
    ) {

      return res.status(401).json({
        error:
          "Invalid admin password."
      });

    }

    const token =
      createAdminToken();

    res.setHeader(
      "Set-Cookie",
      getAdminCookie(token)
    );

    res.setHeader(
      "Cache-Control",
      "no-store"
    );

    return res.status(200).json({
      success: true
    });

  } catch (error) {

    console.error(
      "Admin login error:",
      error
    );

    return res.status(500).json({
      error:
        "Admin login failed."
    });

  }

}
