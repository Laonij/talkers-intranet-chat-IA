// scripts/seed.js
// Seed "idempotente": cria admin se não existir e nunca derruba o deploy.

const bcrypt = require("bcryptjs");

function env(name, fallback = "") {
  return (process.env[name] || fallback).trim();
}

function resolveDbModule() {
  const mod = require("../db");

  // tenta achar init
  const init =
    mod.init ||
    mod.initDb ||
    mod.initialize ||
    (async () => {});

  // tenta achar a conexão db
  const db =
    mod.db ||
    (typeof mod.getDb === "function" ? mod.getDb() : null) ||
    mod.connection ||
    null;

  return { db, init, mod };
}

async function run() {
  const { db, init, mod } = resolveDbModule();

  // inicializa se existir init
  await init();

  // se não achou db, tenta novamente após init (alguns projetos criam db dentro do init)
  const { db: db2 } = resolveDbModule();
  const conn = db2 || db;

  if (!conn) {
    console.log("⚠️ seed: não consegui obter conexão do banco. Vou ignorar seed para não quebrar deploy.");
    return;
  }

  const ADMIN_EMAIL = env("ADMIN_EMAIL", "admin@local");
  const ADMIN_PASSWORD = env("ADMIN_PASSWORD", "Admin#1234");

  // tenta detectar tabela users (não quebra se não existir)
  try {
    const existing = conn
      .prepare("SELECT id, email FROM users WHERE email = ? LIMIT 1")
      .get(ADMIN_EMAIL);

    if (existing) {
      console.log("✅ Admin já existe");
      console.log("Email:", existing.email);
      return;
    }

    const hash = await bcrypt.hash(ADMIN_PASSWORD, 10);

    // tenta inserir com colunas comuns
    // ajuste se seu schema for diferente
    conn.prepare(
      "INSERT INTO users (email, password_hash, role, created_at) VALUES (?, ?, 'admin', datetime('now'))"
    ).run(ADMIN_EMAIL, hash);

    console.log("✅ Admin criado");
    console.log("Email:", ADMIN_EMAIL);
    console.log("Senha:", ADMIN_PASSWORD);
  } catch (e) {
    console.log("⚠️ seed: não consegui criar/verificar admin (schema pode ser diferente). Vou ignorar para não quebrar deploy.");
    console.log("Detalhe:", e?.message || e);
  }
}

run()
  .then(() => process.exit(0))
  .catch((err) => {
    console.log("⚠️ seed falhou, mas não vou quebrar o deploy:", err?.message || err);
    process.exit(0);
  });
