// scripts/seed.js
const bcrypt = require("bcryptjs");
const { getDb } = require("../db");

(async () => {
  const db = getDb();

  const email = (process.env.ADMIN_EMAIL || "admin@local").trim();
  const password = (process.env.ADMIN_PASSWORD || "Admin#1234").trim();

  if (!email || !password) {
    console.error("❌ ADMIN_EMAIL ou ADMIN_PASSWORD vazios.");
    process.exit(1);
  }

  const passHash = await bcrypt.hash(password, 10);

  // garante tabela
  db.prepare(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user',
      created_at TEXT NOT NULL
    )
  `).run();

  // UPSERT (cria ou atualiza a senha do admin sempre)
  db.prepare(`
    INSERT INTO users (id, email, password_hash, role, created_at)
    VALUES (@id, @email, @password_hash, 'admin', @created_at)
    ON CONFLICT(email) DO UPDATE SET
      password_hash = excluded.password_hash,
      role = 'admin'
  `).run({
    id: "admin",
    email,
    password_hash: passHash,
    created_at: new Date().toISOString(),
  });

  console.log("✅ Admin pronto (criado/atualizado)");
  console.log("Email:", email);
  console.log("Senha: (definida via ADMIN_PASSWORD no Render)");
})();
