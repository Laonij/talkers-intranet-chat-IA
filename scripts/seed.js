require("dotenv").config();
const bcrypt = require("bcryptjs");
const { migrate, get, run } = require("../db");

(async () => {
  try {
    migrate();

    const email = String(process.env.ADMIN_EMAIL || "admin@local").trim().toLowerCase();
    const password = String(process.env.ADMIN_PASSWORD || "Admin#1234");

    if (!email || !password) {
      console.log("❌ ADMIN_EMAIL ou ADMIN_PASSWORD não definidos.");
      process.exit(1);
    }

    const existing = await get("SELECT id, email FROM users WHERE email=?", [email]);

    const hash = await bcrypt.hash(password, 10);

    if (!existing) {
      await run(
        "INSERT INTO users (email, name, password_hash, role) VALUES (?, ?, ?, ?)",
        [email, "Admin", hash, "admin"]
      );
      console.log("✅ Admin criado");
      console.log("Email:", email);
      console.log("Senha:", password);
    } else {
      await run("UPDATE users SET password_hash=?, role='admin' WHERE email=?", [hash, email]);
      console.log("✅ Admin já existe (senha atualizada)");
      console.log("Email:", email);
    }

    process.exit(0);
  } catch (e) {
    console.error("❌ Seed falhou:", e);
    process.exit(1);
  }
})();
