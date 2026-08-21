import { setAdminCookie } from "../lib/adminAuth.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Method not allowed"
    });
  }

  try {
    const { password } = req.body || {};

    if (!process.env.ADMIN_PASSWORD) {
      return res.status(500).json({
        error:
          "ADMIN_PASSWORD is not configured in Vercel."
      });
    }

    if (!password) {
      return res.status(400).json({
        error: "Admin password is required."
      });
    }

    if (
      String(password) !==
      String(process.env.ADMIN_PASSWORD)
    ) {
      return res.status(401).json({
        error: "Invalid admin password."
      });
    }

    setAdminCookie(res);

    return res.status(200).json({
      success: true,
      message: "Admin login successful."
    });

  } catch (error) {
    console.error(
      "ADMIN LOGIN ERROR:",
      error
    );

    return res.status(500).json({
      error:
        error?.message ||
        "Admin login failed."
    });
  }
}
