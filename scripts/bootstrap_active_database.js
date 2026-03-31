require("dotenv").config();

const {
  DB_CLIENT,
  DB_RUNTIME_CONFIG,
  DATABASE_URL_PRESENT,
  DATA_DIR,
  sqlitePath,
  migrate,
  importLegacySqliteIntoPostgres,
  get,
} = require("../db");
const { seedDemoSchoolData } = require("./seed_demo_school_data");

const TABLES_TO_REPORT = [
  "students",
  "enrollments",
  "classes",
  "class_schedules",
  "teacher_profiles",
  "sales_records",
  "financial_contracts",
  "financial_installments",
  "student_guardians",
  "student_timeline",
  "attendance_records",
];

async function collectCounts() {
  const result = {};
  for (const table of TABLES_TO_REPORT) {
    const row = await get(`SELECT COUNT(*) AS total FROM ${table}`);
    result[table] = Number(row?.total || 0);
  }
  return result;
}

async function main() {
  await migrate();

  const before = await collectCounts();
  let importedLegacy = false;

  if (DB_CLIENT === "postgres") {
    importedLegacy = await importLegacySqliteIntoPostgres();
  }

  const afterImport = await collectCounts();
  const shouldSeedDemo = (
    Number(afterImport.students || 0) > 0
    && (
      Number(afterImport.student_guardians || 0) === 0
      || Number(afterImport.financial_installments || 0) === 0
      || Number(afterImport.attendance_records || 0) === 0
    )
  );

  if (shouldSeedDemo) {
    await seedDemoSchoolData();
  }

  const finalCounts = await collectCounts();
  console.log(JSON.stringify({
    db_runtime: DB_RUNTIME_CONFIG,
    db_client: DB_CLIENT,
    database_url_present: DATABASE_URL_PRESENT,
    data_dir: DATA_DIR,
    sqlite_path: sqlitePath,
    imported_legacy_sqlite: importedLegacy,
    seeded_demo_data: shouldSeedDemo,
    counts_before: before,
    counts_after_import: afterImport,
    counts_final: finalCounts,
  }, null, 2));
}

main().catch((err) => {
  console.error("[bootstrap-active-db] failed", err?.stack || err?.message || err);
  process.exit(1);
});
