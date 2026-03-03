// scripts/seed.js
const { getDb } = require("../db");
const { hashPassword } = require("../auth");

(async () => {
  const db = getDb();

  const email = (process.env.ADMIN_EMAIL || "admin@local").trim();
  const password = (process.env.ADMIN_PASSWORD || "Admin#1234").trim();

  const password_hash = await hashPassword(password);

  // Cria ou atualiza (reset) o admin SEMPRE
  const existing = db.prepare("SELECT id FROM users WHERE email = ?").get(email);

  if (existing) {
    db.prepare("UPDATE users SET password_hash = ? WHERE id = ?")
      .run(password_hash, existing.id);

    console.log("✅ Admin atualizado (senha resetada)");
  } else {
    db.prepare("INSERT INTO users (email, password_hash, role) VALUES (?, ?, 'admin')")
      .run(email, password_hash);

    console.log("✅ Admin criado");
  }

  console.log("Email:", email);
  console.log("Senha:", password);
})();
