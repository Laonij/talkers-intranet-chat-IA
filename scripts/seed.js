require("dotenv").config();
const bcrypt = require("bcryptjs");
const { migrate, get, run, logEvent } = require("../db");

async function main() {
  migrate();

  const email = "admin@local";
  const existing = await get("SELECT id FROM users WHERE email=?", [email]);
  if (existing) {
    console.log("Admin já existe:", email);
    return;
  }

  const password = "Admin#1234";
  const password_hash = await bcrypt.hash(password, 10);

  const r = await run(
    "INSERT INTO users (email, name, password_hash, role) VALUES (?, ?, ?, ?)",
    [email, "Admin", password_hash, "admin"]
  );

  logEvent(r.lastID, "seed_admin_created", { email });
  console.log("✅ Admin criado");
  console.log("Email:", email);
  console.log("Senha:", password);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
