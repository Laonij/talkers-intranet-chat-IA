const jwt = require("jsonwebtoken");
const { createLogger } = require("./lib/appLogger");

const authLogger = createLogger("auth");
const JWT_ALGORITHM = "HS256";

function ensureJwtSecret(jwtSecret) {
  const safeSecret = String(jwtSecret || "").trim();
  if (!safeSecret) {
    throw new Error("jwt_secret_missing");
  }
  return safeSecret;
}

function signSession(user, jwtSecret) {
  const safeSecret = ensureJwtSecret(jwtSecret);

  return jwt.sign(
    {
      sub: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      department: user.department || "",
      departments: Array.isArray(user.departments) ? user.departments : [],
      can_access_intranet: Boolean(user.can_access_intranet),
      preferred_locale: user.preferred_locale || "pt-BR",
      additional_permissions: user.additional_permissions || {},
      additional_permissions_json: user.additional_permissions_json || "",
      job_title: user.job_title || "",
      unit_name: user.unit_name || "",
    },
    safeSecret,
    {
      expiresIn: "7d",
      algorithm: JWT_ALGORITHM,
    }
  );
}

function requireAuth(jwtSecret) {
  const configuredSecret = String(jwtSecret || "").trim();

  return (req, res, next) => {
    if (!configuredSecret) {
      authLogger.error("Tentativa de autenticar sem JWT_SECRET configurado.");
      return res.status(503).json({ error: "auth_unavailable" });
    }

    const token = req.cookies?.session;
    if (!token) return res.status(401).json({ error: "not_authenticated" });

    try {
      req.user = jwt.verify(token, configuredSecret, { algorithms: [JWT_ALGORITHM] });
      next();
    } catch (err) {
      authLogger.warn("Sessao JWT invalida.", {
        message: err?.message || String(err || "invalid_session"),
        name: err?.name || "",
      });
      return res.status(401).json({ error: "invalid_session" });
    }
  };
}

function requireRole(role) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: "not_authenticated" });
    if (req.user.role !== role) return res.status(403).json({ error: "forbidden" });
    next();
  };
}

module.exports = { signSession, requireAuth, requireRole };
