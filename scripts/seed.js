require("dotenv").config();
const bcrypt = require("bcryptjs");
const { migrate, get, run } = require("../db");

const NODE_ENV = String(process.env.NODE_ENV || "development").trim().toLowerCase();
const IS_PRODUCTION = NODE_ENV === "production";
const DEFAULT_ADMIN_EMAIL = "admin@local";
const DEFAULT_ADMIN_NAME = "Admin";
const DEFAULT_ADMIN_PASSWORD = "Admin#1234";

(async () => {
  await migrate();

  const email = String(process.env.ADMIN_EMAIL || DEFAULT_ADMIN_EMAIL).trim().toLowerCase();
  const password = String(process.env.ADMIN_PASSWORD || (IS_PRODUCTION ? "" : DEFAULT_ADMIN_PASSWORD));
  const name = String(process.env.ADMIN_NAME || DEFAULT_ADMIN_NAME).trim() || DEFAULT_ADMIN_NAME;

  if (!email || !password) {
    console.error("Configure ADMIN_EMAIL e ADMIN_PASSWORD antes de rodar o seed.");
    process.exit(1);
  }

  if (IS_PRODUCTION && password === DEFAULT_ADMIN_PASSWORD) {
    console.error("ADMIN_PASSWORD padrao nao pode ser usado em producao.");
    process.exit(1);
  }

  const exists = await get("SELECT id FROM users WHERE email=?", [email]);

  if (exists) {
    console.log("Admin ja existe");
    console.log("Email:", email);
    process.exit(0);
  }

  const hash = await bcrypt.hash(password, 10);

  await run(
    "INSERT INTO users (email, name, password_hash, role) VALUES (?, ?, ?, ?)",
    [email, name, hash, "admin"]
  );

  console.log("Admin criado");
  console.log("Email:", email);
  process.exit(0);
})().catch((err) => {
  console.error("Seed error:", err);
  process.exit(1);
});
