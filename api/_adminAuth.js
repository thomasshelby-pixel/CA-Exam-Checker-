import {
  createHmac,
  timingSafeEqual
} from "crypto";

const COOKIE_NAME = "ca_admin_session";

const SESSION_DURATION =
  8 * 60 * 60 * 1000; // 8 hours


function getSecret() {

  const secret =
    process.env.ADMIN_PASSWORD;

  if (!secret) {
    throw new Error(
      "ADMIN_PASSWORD environment variable is not configured."
    );
  }

  return secret;

}


function createSignature(
  expires
) {

  return createHmac(
    "sha256",
    getSecret()
  )
    .update(String(expires))
    .digest("base64url");

}


function safeCompare(
  a,
  b
) {

  const aBuffer =
    Buffer.from(a);

  const bBuffer =
    Buffer.from(b);

  if (
    aBuffer.length !==
    bBuffer.length
  ) {
    return false;
  }

  return timingSafeEqual(
    aBuffer,
    bBuffer
  );

}


export function createAdminToken() {

  const expires =
    Date.now() +
    SESSION_DURATION;

  const signature =
    createSignature(expires);

  return `${expires}.${signature}`;

}


export function isAdminAuthenticated(
  req
) {

  try {

    const cookieHeader =
      req.headers.cookie || "";

    const cookies =
      cookieHeader
        .split(";")
        .map(v => v.trim());

    const adminCookie =
      cookies.find(
        cookie =>
          cookie.startsWith(
            `${COOKIE_NAME}=`
          )
      );

    if (!adminCookie) {
      return false;
    }

    const token =
      decodeURIComponent(
        adminCookie.substring(
          COOKIE_NAME.length + 1
        )
      );

    const parts =
      token.split(".");

    if (parts.length !== 2) {
      return false;
    }

    const expires =
      Number(parts[0]);

    const signature =
      parts[1];

    if (
      !Number.isFinite(expires)
    ) {
      return false;
    }

    if (
      Date.now() > expires
    ) {
      return false;
    }

    const expectedSignature =
      createSignature(expires);

    return safeCompare(
      signature,
      expectedSignature
    );

  } catch (error) {

    console.error(
      "Admin authentication error:",
      error
    );

    return false;

  }

}


export function getAdminCookie(
  token
) {

  return [
    `${COOKIE_NAME}=${encodeURIComponent(token)}`,
    "HttpOnly",
    "Secure",
    "SameSite=Strict",
    "Path=/",
    `Max-Age=${SESSION_DURATION / 1000}`
  ].join("; ");

}


export function getClearAdminCookie() {

  return [
    `${COOKIE_NAME}=`,
    "HttpOnly",
    "Secure",
    "SameSite=Strict",
    "Path=/",
    "Max-Age=0"
  ].join("; ");

}
