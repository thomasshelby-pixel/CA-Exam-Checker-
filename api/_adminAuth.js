import crypto from "crypto";

export function getCookie(req, name) {
  const raw = req.headers?.cookie || "";

  const parts = raw
    .split(";")
    .map(x => x.trim());

  const item = parts.find(
    x => x.startsWith(`${name}=`)
  );

  return item
    ? decodeURIComponent(
        item.slice(name.length + 1)
      )
    : "";
}

function sign(value, secret) {
  return crypto
    .createHmac("sha256", secret)
    .update(value)
    .digest("hex");
}

export function makeAdminCookie(secret) {

  const value =
    `${Date.now()}.${crypto.randomBytes(18).toString("hex")}`;

  return `${value}.${sign(value, secret)}`;
}

export function isAdmin(req) {

  const secret =
    process.env.ADMIN_SESSION_SECRET;

  if (!secret) return false;

  const cookie =
    getCookie(req, "ca_admin");

  if (!cookie) return false;

  const parts =
    cookie.split(".");

  if (parts.length !== 3) {
    return false;
  }

  const value =
    `${parts[0]}.${parts[1]}`;

  const expected =
    sign(value, secret);

  try {

    if (
      !crypto.timingSafeEqual(
        Buffer.from(parts[2]),
        Buffer.from(expected)
      )
    ) {
      return false;
    }

  } catch {

    return false;

  }

  const created =
    Number(parts[0]);

  return (
    Number.isFinite(created) &&
    Date.now() - created <
      1000 * 60 * 60 * 12
  );
}

export function adminCookieHeader(
  secret,
  maxAge = 60 * 60 * 12
) {

  const value =
    makeAdminCookie(secret);

  return (
    `ca_admin=${encodeURIComponent(value)}; ` +
    `Path=/; ` +
    `HttpOnly; ` +
    `Secure; ` +
    `SameSite=Lax; ` +
    `Max-Age=${maxAge}`
  );
}
