export default async function handler(req, res) {

  if (req.method !== "POST") {
    return res.status(405).json({
      success: false,
      error: "Method not allowed"
    });
  }

  try {

    // Clear admin authentication cookie
    res.setHeader(
      "Set-Cookie",
      "admin_session=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0"
    );

    return res.status(200).json({
      success: true,
      message: "Admin logged out successfully."
    });

  } catch (error) {

    console.error(
      "ADMIN LOGOUT ERROR:",
      error
    );

    return res.status(500).json({
      success: false,
      error: "Unable to logout admin."
    });

  }

}
