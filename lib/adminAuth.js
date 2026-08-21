import crypto from "crypto";

const COOKIE_NAME = "ca_admin_session";

function getCookie(req, name) {
  const raw = req.headers?.cookie || "";

  const parts = raw.split(";");

  for (const part of parts) {
    const [key, ...rest] = part.trim().split("=");

    if (key === name) {
      return decodeURIComponent(rest.join("="));
    }
  }

  return "";
}

function sessionValue() {
  const password = process.env.ADMIN_PASSWORD || "";

  // Supports both names:
  // ADMIN_SESSION_SECRET
  // ADMIN_SECRET
  const secret =
    process.env.ADMIN_SESSION_SECRET ||
    process.env.ADMIN_SECRET ||
    password;

  if (!password || !secret) {
    return "";
  }

  return crypto
    .createHmac("sha256", secret)
    .update(password)
    .digest("hex");
}

export function isAdminAuthenticated(req) {
  const expected = sessionValue();
  const actual = getCookie(req, COOKIE_NAME);

  if (!expected || !actual) {
    return false;
  }

  const a = Buffer.from(expected);
  const b = Buffer.from(actual);

  return (
    a.length === b.length &&
    crypto.timingSafeEqual(a, b)
  );
}

export function setAdminCookie(res) {
  const value = sessionValue();

  if (!value) {
    throw new Error(
      "ADMIN_PASSWORD is not configured."
    );
  }

  res.setHeader(
    "Set-Cookie",
    `${COOKIE_NAME}=${encodeURIComponent(
      value
    )}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=43200`
  );
}

export function clearAdminCookie(res) {
  res.setHeader(
    "Set-Cookie",
    `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`
  );
}
