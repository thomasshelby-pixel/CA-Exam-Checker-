export default async function handler(req, res) {

  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Method not allowed"
    });
  }

  return res.status(410).json({
    error:
      "Evaluation endpoint has been replaced.",
    message:
      "Use /api/check for answer-sheet evaluation."
  });

}
