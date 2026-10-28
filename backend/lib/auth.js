const crypto = require("crypto");
const { promisify } = require("util");
const pool = require("../config/db");

const scrypt = promisify(crypto.scrypt);
const sessionDurationSeconds = 8 * 60 * 60;
const allowedRoles = new Set(["admin", "trainer", "partner"]);
const isProduction = process.env.NODE_ENV === "production";
const sessionSecret = process.env.SESSION_SECRET || (
  isProduction ? "" : crypto.randomBytes(32).toString("hex")
);

if (sessionSecret.length < 32) {
  throw new Error("SESSION_SECRET must contain at least 32 characters.");
}

const sameSiteSetting = (process.env.COOKIE_SAME_SITE || "lax").toLowerCase();
const sameSiteValues = { lax: "Lax", strict: "Strict", none: "None" };

if (!sameSiteValues[sameSiteSetting]) {
  throw new Error("COOKIE_SAME_SITE must be lax, strict, or none.");
}

if (sameSiteSetting === "none" && !isProduction) {
  throw new Error("COOKIE_SAME_SITE=none requires HTTPS in production.");
}

function signPayload(payload) {
  return crypto
    .createHmac("sha256", sessionSecret)
    .update(payload)
    .digest("base64url");
}

function createSessionToken(user) {
  const payload = Buffer.from(JSON.stringify({
    id: user.user_id,
    username: user.username,
    role: user.role,
    exp: Math.floor(Date.now() / 1000) + sessionDurationSeconds,
  })).toString("base64url");

  return `${payload}.${signPayload(payload)}`;
}

function parseSessionToken(token) {
  if (!token || typeof token !== "string") return null;

  const [payload, signature, extra] = token.split(".");
  if (!payload || !signature || extra) return null;

  const expected = Buffer.from(signPayload(payload));
  const received = Buffer.from(signature);
  if (
    expected.length !== received.length ||
    !crypto.timingSafeEqual(expected, received)
  ) {
    return null;
  }

  try {
    const session = JSON.parse(Buffer.from(payload, "base64url").toString());
    if (
      !Number.isInteger(session.id) ||
      typeof session.username !== "string" ||
      !allowedRoles.has(session.role) ||
      !Number.isInteger(session.exp) ||
      session.exp <= Math.floor(Date.now() / 1000)
    ) {
      return null;
    }

    return session;
  } catch {
    return null;
  }
}

function getCookie(req, name) {
  const cookies = (req.headers.cookie || "").split(";");
  const entry = cookies.find((cookie) => cookie.trim().startsWith(`${name}=`));
  if (!entry) return "";

  try {
    return decodeURIComponent(entry.trim().slice(name.length + 1));
  } catch {
    return "";
  }
}

function sessionCookie(token, maxAge = sessionDurationSeconds) {
  const parts = [
    `session=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    `SameSite=${sameSiteValues[sameSiteSetting]}`,
    `Max-Age=${maxAge}`,
  ];

  if (isProduction || sameSiteSetting === "none") parts.push("Secure");
  return parts.join("; ");
}

async function requireAuth(req, res, next) {
  const session = parseSessionToken(getCookie(req, "session"));
  if (!session) {
    return res.status(401).json({ message: "Please sign in to continue." });
  }

  try {
    const [users] = await pool.execute(
      "SELECT user_id, username, role FROM `Users` WHERE user_id = ? AND is_active = 1 LIMIT 1",
      [session.id]
    );
    const user = users[0];
    if (!user) {
      return res.status(401).json({ message: "Your session is no longer active." });
    }

    req.user = {
      id: user.user_id,
      username: user.username,
      role: user.role,
    };
    next();
  } catch (error) {
    console.error("Session verification error:", error.message);
    res.status(503).json({ message: "Unable to verify your session." });
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ message: "You do not have permission for this action." });
    }

    next();
  };
}

async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const derivedKey = await scrypt(password, salt, 64);
  return `scrypt$${salt.toString("base64url")}$${derivedKey.toString("base64url")}`;
}

async function verifyPassword(password, storedHash) {
  if (typeof storedHash !== "string") return false;

  const [algorithm, saltValue, hashValue, extra] = storedHash.split("$");
  if (algorithm !== "scrypt" || !saltValue || !hashValue || extra) return false;

  try {
    const salt = Buffer.from(saltValue, "base64url");
    const expected = Buffer.from(hashValue, "base64url");
    const actual = await scrypt(password, salt, expected.length);
    return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

module.exports = {
  createSessionToken,
  hashPassword,
  parseSessionToken,
  requireAuth,
  requireRole,
  sessionCookie,
  sessionDurationSeconds,
  verifyPassword,
};