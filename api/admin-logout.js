import {
  clearAdminCookie
} from "../lib/adminAuth.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Method not allowed"
    });
  }

  clearAdminCookie(res);

  return res.status(200).json({
    success: true
  });
}
