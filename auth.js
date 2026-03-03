const jwt = require("jsonwebtoken");

function signSession(user, jwtSecret) {
  return jwt.sign(
    { sub: user.id, email: user.email, name: user.name, role: user.role },
    jwtSecret,
    { expiresIn: "7d" }
  );
}

function requireAuth(jwtSecret) {
  return (req, res, next) => {
    const token = req.cookies?.session;
    if (!token) return res.status(401).json({ error: "not_authenticated" });
    try {
      req.user = jwt.verify(token, jwtSecret);
      next();
    } catch (e) {
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
