require("dotenv").config();
const bcrypt = require("bcryptjs");
const { migrate, get, run } = require("../db");

(async () => {
  migrate();

  const email = String(process.env.ADMIN_EMAIL || "admin@local").trim().toLowerCase();
  const password = String(process.env.ADMIN_PASSWORD || "Admin#1234");
  const name = String(process.env.ADMIN_NAME || "Admin").trim() || "Admin";

  const exists = await get("SELECT id FROM users WHERE email=?", [email]);

  if (exists) {
    console.log("✅ Admin já existe");
    console.log("Email:", email);
    process.exit(0);
  }

  const hash = await bcrypt.hash(password, 10);

  await run(
    "INSERT INTO users (email, name, password_hash, role) VALUES (?, ?, ?, ?)",
    [email, name, hash, "admin"]
  );

  console.log("✅ Admin criado");
  console.log("Email:", email);
  console.log("Senha:", password);
  process.exit(0);
})().catch((e) => {
  console.error("Seed error:", e);
  process.exit(1);
});
