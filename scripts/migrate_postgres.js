require("dotenv").config();
const { DB_CLIENT, migrate } = require("../db");

(async () => {
  await migrate();
  console.log(`Migracao concluida. Banco ativo: ${DB_CLIENT}`);
  process.exit(0);
})().catch((err) => {
  console.error("Erro na migracao para Postgres:", err);
  process.exit(1);
});
