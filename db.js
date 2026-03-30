require("dotenv").config();

const fs = require("fs");
const path = require("path");
const sqlite3 = require("sqlite3").verbose();
const { Pool } = require("pg");
const { createLogger } = require("./lib/appLogger");
const {
  safeJsonStringifyForPostgres,
  sanitizeDbParams,
  sanitizeTextForPostgres,
} = require("./lib/postgresSanitizer");

const databaseLogger = createLogger("database");

const renderDiskCandidates = ["/var/data", "/data"];
const detectedRenderDiskDir = renderDiskCandidates.find((candidate) => fs.existsSync(candidate));
const defaultDataDir = detectedRenderDiskDir || path.join(__dirname, "data");
const fallbackTempDataDir = path.join(require("os").tmpdir(), "talkers-data");

function ensureDirWritable(targetPath) {
  const safePath = path.resolve(String(targetPath || "").trim() || ".");
  fs.mkdirSync(safePath, { recursive: true });
  const probePath = path.join(safePath, ".write-test");
  fs.writeFileSync(probePath, "ok");
  fs.unlinkSync(probePath);
  return safePath;
}

function resolveWritableDataDir() {
  const requestedPath = process.env.DATA_DIR
    ? path.resolve(process.env.DATA_DIR)
    : defaultDataDir;
  const candidates = [
    requestedPath,
    defaultDataDir,
    fallbackTempDataDir,
    path.join(__dirname, "data"),
  ];

  let lastError = null;
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      const resolved = ensureDirWritable(candidate);
      return {
        path: resolved,
        fallbackUsed: resolved !== requestedPath,
        requestedPath,
        error: null,
      };
    } catch (err) {
      lastError = err;
    }
  }

  throw lastError || new Error("data_dir_unavailable");
}

const dataDirResolution = resolveWritableDataDir();
const DATA_DIR = dataDirResolution.path;

if (dataDirResolution.fallbackUsed) {
  databaseLogger.warn("DATA_DIR configurado nao estava gravavel; fallback aplicado.", {
    requested_path: dataDirResolution.requestedPath,
    selected_path: DATA_DIR,
    message: dataDirResolution.error?.message || null,
  });
}

const uploadsDir = ensureDirWritable(path.join(DATA_DIR, "uploads"));
const kbDir = ensureDirWritable(path.join(DATA_DIR, "kb"));

const DATABASE_URL = String(process.env.DATABASE_URL || "").trim();
const DATABASE_URL_PRESENT = Boolean(DATABASE_URL);
const requestedDbClient = String(process.env.DB_CLIENT || "").trim().toLowerCase();
const REQUESTED_DB_CLIENT = requestedDbClient || null;
const DB_CLIENT = DATABASE_URL_PRESENT ? "postgres" : "sqlite";

const sqlitePath = process.env.SQLITE_PATH
  ? path.resolve(process.env.SQLITE_PATH)
  : path.join(DATA_DIR, "app.db");

function getPostgresHost(connectionString = "") {
  try {
    const parsed = new URL(String(connectionString || "").trim());
    return parsed.hostname || "";
  } catch {
    return "";
  }
}

const POSTGRES_HOST = DB_CLIENT === "postgres" ? getPostgresHost(DATABASE_URL) : "";
const DB_RUNTIME_CONFIG = {
  requested_client: REQUESTED_DB_CLIENT || (DATABASE_URL_PRESENT ? "postgres" : "sqlite"),
  selected_client: DB_CLIENT,
  database_url_present: DATABASE_URL_PRESENT,
  sqlite_path: sqlitePath,
  data_dir: DATA_DIR,
  postgres_host: POSTGRES_HOST || null,
};

let sqliteDb = null;
let pgPool = null;
let migratePromise = null;

function readPositiveIntEnv(name, fallback, minimum = 1) {
  const parsed = Number(process.env[name] || fallback);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(minimum, Math.floor(parsed));
}

if (DB_CLIENT === "sqlite") {
  sqliteDb = new sqlite3.Database(sqlitePath);
} else {
  if (!DATABASE_URL) {
    throw new Error("DATABASE_URL nao foi definido para usar Postgres.");
  }

  const sslMode = String(process.env.PGSSL || "").trim().toLowerCase();
  pgPool = new Pool({
    connectionString: DATABASE_URL,
    ssl: sslMode === "disable" ? false : { rejectUnauthorized: false },
    max: readPositiveIntEnv("PG_POOL_MAX", 12),
    idleTimeoutMillis: readPositiveIntEnv("PG_IDLE_TIMEOUT_MS", 30000, 1000),
    connectionTimeoutMillis: readPositiveIntEnv("PG_CONNECTION_TIMEOUT_MS", 10000, 1000),
    statement_timeout: readPositiveIntEnv("PG_STATEMENT_TIMEOUT_MS", 30000, 1000),
    query_timeout: readPositiveIntEnv("PG_QUERY_TIMEOUT_MS", 30000, 1000),
    allowExitOnIdle: true,
    application_name: "talkers-intranet-chat-ia",
  });

  pgPool.on("error", (err) => {
    databaseLogger.error("Pool Postgres emitiu erro.", {
      message: err?.message || String(err || "pg_pool_error"),
      code: err?.code || "",
      severity: err?.severity || "",
    });
  });
}

const db = DB_CLIENT === "postgres" ? pgPool : sqliteDb;

function quoteIdent(value) {
  return `"${String(value || "").replace(/"/g, '""')}"`;
}

function sanitizeText(value) {
  return sanitizeTextForPostgres(value);
}

function sanitizeLegacySqliteValue(value) {
  if (value === null || value === undefined) return null;
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) return Buffer.from(value);
  if (typeof value === "string") return sanitizeText(value);
  return value;
}

const ARTIFACT_SESSION_CANONICAL_COLUMNS = [
  "id",
  "conversation_id",
  "artifact_type",
  "intent_mode",
  "prompt",
  "resolved_prompt",
  "source_message_id",
  "input_files_json",
  "image_refs_json",
  "status",
  "created_at",
  "updated_at",
];

const LEGACY_ARTIFACT_SESSION_COLUMN_ALIASES = {
  conversationid: "conversation_id",
  artifacttype: "artifact_type",
  intentmode: "intent_mode",
  prompttext: "prompt",
  prompt_text: "prompt",
  resolvedprompt: "resolved_prompt",
  sourcemessageid: "source_message_id",
  source_messageid: "source_message_id",
  inputfilesjson: "input_files_json",
  image_refsjson: "image_refs_json",
  imagerefsjson: "image_refs_json",
  createdat: "created_at",
  updatedat: "updated_at",
};

function normalizeArtifactSessionStatus(status = "pending") {
  const safe = String(status || "pending").trim().toLowerCase();
  if (!safe) return "pending";
  if (safe === "done" || safe === "complete") return "completed";
  return safe;
}

function parseArtifactSessionJsonField(value, fallback = []) {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function parseArtifactSessionRow(row) {
  if (!row) return null;
  return {
    ...row,
    prompt: sanitizeText(row.prompt),
    resolved_prompt: sanitizeText(row.resolved_prompt || row.prompt || ""),
    input_files: parseArtifactSessionJsonField(row.input_files_json, []),
    image_refs: parseArtifactSessionJsonField(row.image_refs_json, []),
    status: normalizeArtifactSessionStatus(row.status),
  };
}

function normalizeArtifactSessionPayload(payload = {}) {
  const conversationId = Number(payload.conversationId || payload.conversation_id || 0) || null;
  const sourceMessageId = Number(payload.sourceMessageId || payload.source_message_id || 0) || null;
  const prompt = sanitizeText(payload.prompt || payload.promptText || "");
  const resolvedPrompt = sanitizeText(payload.resolvedPrompt || payload.resolved_prompt || prompt || "");
  return {
    conversation_id: conversationId,
    artifact_type: sanitizeText(payload.artifactType || payload.artifact_type || ""),
    intent_mode: sanitizeText(payload.intentMode || payload.intent_mode || null),
    prompt,
    resolved_prompt: resolvedPrompt || prompt,
    source_message_id: sourceMessageId,
    input_files_json: safeJsonStringifyForPostgres(Array.isArray(payload.inputFiles || payload.input_files) ? (payload.inputFiles || payload.input_files) : [], "[]"),
    image_refs_json: safeJsonStringifyForPostgres(Array.isArray(payload.imageRefs || payload.image_refs) ? (payload.imageRefs || payload.image_refs) : [], "[]"),
    status: normalizeArtifactSessionStatus(payload.status || "pending"),
  };
}

function normalizeLegacyArtifactSessionRow(row = {}) {
  const normalized = {};
  for (const [key, value] of Object.entries(row || {})) {
    const canonicalKey = LEGACY_ARTIFACT_SESSION_COLUMN_ALIASES[key] || key;
    if (!ARTIFACT_SESSION_CANONICAL_COLUMNS.includes(canonicalKey)) continue;
    normalized[canonicalKey] = sanitizeLegacySqliteValue(value);
  }

  normalized.prompt = sanitizeText(
    normalized.prompt
    || row.prompt
    || row.prompt_text
    || row.prompttext
    || ""
  );
  normalized.resolved_prompt = sanitizeText(
    normalized.resolved_prompt
    || row.resolved_prompt
    || row.resolvedprompt
    || normalized.prompt
    || ""
  );
  normalized.status = normalizeArtifactSessionStatus(normalized.status || row.status || "pending");
  normalized.input_files_json = typeof normalized.input_files_json === "string"
    ? sanitizeText(normalized.input_files_json)
    : safeJsonStringifyForPostgres([], "[]");
  normalized.image_refs_json = typeof normalized.image_refs_json === "string"
    ? sanitizeText(normalized.image_refs_json)
    : safeJsonStringifyForPostgres([], "[]");
  return normalized;
}

function translateSqliteNowExpression(kind, amountText, unitText) {
  const amount = Number(amountText || 0);
  const unit = String(unitText || "day").trim().toLowerCase();
  if (!Number.isFinite(amount) || !unit) {
    return kind === "date" ? "CURRENT_DATE" : "CURRENT_TIMESTAMP";
  }

  if (amount === 0) {
    return kind === "date" ? "CURRENT_DATE" : "CURRENT_TIMESTAMP";
  }

  const direction = amount < 0 ? "-" : "+";
  const absolute = Math.abs(amount);
  const intervalSql = `(CURRENT_TIMESTAMP ${direction} INTERVAL '${absolute} ${unit}')`;
  return kind === "date" ? `(${intervalSql})::date` : intervalSql;
}

function normalizeSqlForPostgres(sql) {
  return String(sql || "")
    .replace(
      /datetime\(\s*'now'\s*,\s*'([+-]?\d+)\s+(second|minute|hour|day|month|year)s?'\s*\)/gi,
      (_, amountText, unitText) => translateSqliteNowExpression("datetime", amountText, unitText)
    )
    .replace(
      /date\(\s*'now'\s*,\s*'([+-]?\d+)\s+(second|minute|hour|day|month|year)s?'\s*\)/gi,
      (_, amountText, unitText) => translateSqliteNowExpression("date", amountText, unitText)
    )
    .replace(/datetime\('now'\)/gi, "CURRENT_TIMESTAMP")
    .replace(/date\('now'\)/gi, "CURRENT_DATE")
    .replace(/datetime\(([^)]+)\)/gi, "$1");
}

function toPostgresSql(sql) {
  let index = 0;
  return normalizeSqlForPostgres(sql).replace(/\?/g, () => `$${++index}`);
}

function summarizeSql(sql = "") {
  return String(sql || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 320);
}

async function queryPostgres(sql, params = [], options = {}) {
  const translatedSql = options.skipTranslate ? String(sql || "") : toPostgresSql(sql);
  const safeParams = sanitizeDbParams(params);
  try {
    return await pgPool.query(translatedSql, safeParams);
  } catch (err) {
    databaseLogger.error("Falha em query Postgres.", {
      message: err?.message || String(err || "pg_query_failed"),
      code: err?.code || "",
      severity: err?.severity || "",
      detail: err?.detail || "",
      routine: err?.routine || "",
      sql: summarizeSql(translatedSql),
      param_count: safeParams.length,
    });
    throw err;
  }
}

function execSqlite(sql, params = []) {
  const safeParams = sanitizeDbParams(params);
  return new Promise((resolve, reject) => {
    sqliteDb.run(sql, safeParams, function onRun(err) {
      if (err) return reject(err);
      resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

function getSqlite(sql, params = []) {
  const safeParams = sanitizeDbParams(params);
  return new Promise((resolve, reject) => {
    sqliteDb.get(sql, safeParams, (err, row) => (err ? reject(err) : resolve(row)));
  });
}

function allSqlite(sql, params = []) {
  const safeParams = sanitizeDbParams(params);
  return new Promise((resolve, reject) => {
    sqliteDb.all(sql, safeParams, (err, rows) => (err ? reject(err) : resolve(rows)));
  });
}

function openLegacySqlite(filePath) {
  return new Promise((resolve, reject) => {
    const legacy = new sqlite3.Database(filePath, sqlite3.OPEN_READONLY, (err) => {
      if (err) return reject(err);
      resolve(legacy);
    });
  });
}

function sqliteAllFrom(dbConn, sql, params = []) {
  return new Promise((resolve, reject) => {
    dbConn.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows)));
  });
}

function sqliteGetFrom(dbConn, sql, params = []) {
  return new Promise((resolve, reject) => {
    dbConn.get(sql, params, (err, row) => (err ? reject(err) : resolve(row)));
  });
}

function closeSqlite(dbConn) {
  return new Promise((resolve, reject) => {
    dbConn.close((err) => (err ? reject(err) : resolve()));
  });
}

async function sqliteTableExists(tableName) {
  const row = await getSqlite(
    "SELECT name FROM sqlite_master WHERE type='table' AND lower(name)=lower(?) LIMIT 1",
    [tableName]
  );
  return Boolean(row?.name);
}

async function pgTableExists(tableName) {
  const result = await pgPool.query(
    `SELECT EXISTS (
       SELECT 1
         FROM information_schema.tables
        WHERE table_schema = current_schema()
          AND lower(table_name) = lower($1)
     ) AS exists`,
    [tableName]
  );
  return Boolean(result.rows[0]?.exists);
}

async function getSqliteTableColumns(tableName) {
  try {
    return await allSqlite(`PRAGMA table_info(${tableName})`);
  } catch {
    return [];
  }
}

async function getPostgresTableColumns(tableName) {
  const result = await pgPool.query(
    `SELECT column_name
       FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND lower(table_name) = lower($1)`,
    [tableName]
  );
  return result.rows.map((row) => row.column_name);
}

async function ensureArtifactSessionsSchemaSqlite() {
  const legacyExists = await sqliteTableExists("artifactsessions");
  const canonicalExists = await sqliteTableExists("artifact_sessions");
  if (legacyExists && !canonicalExists) {
    await execSqlite("ALTER TABLE artifactsessions RENAME TO artifact_sessions");
  }

  await execSqlite(`
    CREATE TABLE IF NOT EXISTS artifact_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      conversation_id INTEGER NOT NULL,
      artifact_type TEXT NOT NULL,
      intent_mode TEXT,
      prompt TEXT NOT NULL,
      resolved_prompt TEXT,
      source_message_id INTEGER,
      input_files_json TEXT,
      image_refs_json TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  const columns = await getSqliteTableColumns("artifact_sessions");
  const columnNames = new Set(columns.map((column) => column.name));

  if (legacyExists && canonicalExists) {
    const legacyRows = await allSqlite("SELECT * FROM artifactsessions ORDER BY id ASC");
    for (const legacyRow of legacyRows) {
      const normalizedRow = normalizeLegacyArtifactSessionRow(legacyRow);
      const entries = Object.entries(normalizedRow).filter(([, value]) => value !== undefined);
      if (!entries.length) continue;
      const insertColumns = entries.map(([key]) => key).join(", ");
      const placeholders = entries.map(() => "?").join(", ");
      const values = entries.map(([, value]) => value);
      try {
        await execSqlite(
          `INSERT OR IGNORE INTO artifact_sessions (${insertColumns}) VALUES (${placeholders})`,
          values
        );
      } catch (err) {
        console.error("Falha ao migrar artifact session legada no SQLite:", {
          row_id: legacyRow?.id || null,
          message: err?.message || String(err || "sqlite_artifact_session_migration_failed"),
        });
      }
    }
  }

  const addColumnSql = {
    conversation_id: "ALTER TABLE artifact_sessions ADD COLUMN conversation_id INTEGER;",
    artifact_type: "ALTER TABLE artifact_sessions ADD COLUMN artifact_type TEXT;",
    intent_mode: "ALTER TABLE artifact_sessions ADD COLUMN intent_mode TEXT;",
    prompt: "ALTER TABLE artifact_sessions ADD COLUMN prompt TEXT;",
    resolved_prompt: "ALTER TABLE artifact_sessions ADD COLUMN resolved_prompt TEXT;",
    source_message_id: "ALTER TABLE artifact_sessions ADD COLUMN source_message_id INTEGER;",
    input_files_json: "ALTER TABLE artifact_sessions ADD COLUMN input_files_json TEXT;",
    image_refs_json: "ALTER TABLE artifact_sessions ADD COLUMN image_refs_json TEXT;",
    status: "ALTER TABLE artifact_sessions ADD COLUMN status TEXT NOT NULL DEFAULT 'pending';",
    created_at: "ALTER TABLE artifact_sessions ADD COLUMN created_at TEXT;",
    updated_at: "ALTER TABLE artifact_sessions ADD COLUMN updated_at TEXT;",
  };

  for (const [columnName, sql] of Object.entries(addColumnSql)) {
    if (!columnNames.has(columnName)) {
      await execSqlite(sql);
      columnNames.add(columnName);
    }
  }

  const copyLegacyColumn = async (legacyName, canonicalName) => {
    if (!columnNames.has(legacyName) || !columnNames.has(canonicalName)) return;
    await execSqlite(
      `UPDATE artifact_sessions
          SET ${canonicalName} = COALESCE(${canonicalName}, ${legacyName})
        WHERE (${canonicalName} IS NULL OR ${canonicalName} = '')`
    );
  };

  await copyLegacyColumn("prompt_text", "prompt");
  await copyLegacyColumn("prompttext", "prompt");
  await copyLegacyColumn("resolvedprompt", "resolved_prompt");
  await copyLegacyColumn("conversationid", "conversation_id");
  await copyLegacyColumn("artifacttype", "artifact_type");
  await copyLegacyColumn("intentmode", "intent_mode");
  await copyLegacyColumn("source_messageid", "source_message_id");
  await copyLegacyColumn("sourcemessageid", "source_message_id");
  await copyLegacyColumn("inputfilesjson", "input_files_json");
  await copyLegacyColumn("imagerefsjson", "image_refs_json");
  await copyLegacyColumn("createdat", "created_at");
  await copyLegacyColumn("updatedat", "updated_at");

  await execSqlite("UPDATE artifact_sessions SET prompt = COALESCE(prompt, '') WHERE prompt IS NULL;");
  await execSqlite("UPDATE artifact_sessions SET artifact_type = COALESCE(artifact_type, 'artifact') WHERE artifact_type IS NULL OR artifact_type='';");
  await execSqlite("UPDATE artifact_sessions SET resolved_prompt = COALESCE(resolved_prompt, prompt, '') WHERE resolved_prompt IS NULL OR resolved_prompt='';");
  await execSqlite("UPDATE artifact_sessions SET status = COALESCE(NULLIF(status, ''), 'pending') WHERE status IS NULL OR status='';");
  await execSqlite("UPDATE artifact_sessions SET created_at = COALESCE(created_at, datetime('now')) WHERE created_at IS NULL OR created_at='';");
  await execSqlite("UPDATE artifact_sessions SET updated_at = COALESCE(updated_at, created_at, datetime('now')) WHERE updated_at IS NULL OR updated_at='';");
  await execSqlite("CREATE INDEX IF NOT EXISTS idx_artifact_sessions_conversation_id ON artifact_sessions(conversation_id, id DESC);");
}

async function ensureArtifactSessionsSchemaPostgres() {
  const legacyExists = await pgTableExists("artifactsessions");
  const canonicalExists = await pgTableExists("artifact_sessions");

  if (legacyExists && !canonicalExists) {
    await pgPool.query("ALTER TABLE IF EXISTS artifactsessions RENAME TO artifact_sessions");
  }

  await pgPool.query(`
    CREATE TABLE IF NOT EXISTS artifact_sessions (
      id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
      conversation_id INTEGER NOT NULL,
      artifact_type TEXT NOT NULL,
      intent_mode TEXT,
      prompt TEXT NOT NULL,
      resolved_prompt TEXT,
      source_message_id INTEGER,
      input_files_json TEXT,
      image_refs_json TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  let columnNames = new Set(await getPostgresTableColumns("artifact_sessions"));

  const renameColumnIfNeeded = async (legacyName, canonicalName) => {
    if (columnNames.has(canonicalName) || !columnNames.has(legacyName)) return;
    await pgPool.query(`ALTER TABLE artifact_sessions RENAME COLUMN ${quoteIdent(legacyName)} TO ${quoteIdent(canonicalName)}`);
    columnNames.delete(legacyName);
    columnNames.add(canonicalName);
  };

  await renameColumnIfNeeded("prompt_text", "prompt");
  await renameColumnIfNeeded("prompttext", "prompt");
  await renameColumnIfNeeded("resolvedprompt", "resolved_prompt");
  await renameColumnIfNeeded("source_messageid", "source_message_id");
  await renameColumnIfNeeded("sourcemessageid", "source_message_id");
  await renameColumnIfNeeded("inputfilesjson", "input_files_json");
  await renameColumnIfNeeded("imagerefsjson", "image_refs_json");
  await renameColumnIfNeeded("conversationid", "conversation_id");
  await renameColumnIfNeeded("artifacttype", "artifact_type");
  await renameColumnIfNeeded("intentmode", "intent_mode");
  await renameColumnIfNeeded("createdat", "created_at");
  await renameColumnIfNeeded("updatedat", "updated_at");

  await pgPool.query("ALTER TABLE artifact_sessions ADD COLUMN IF NOT EXISTS conversation_id INTEGER");
  await pgPool.query("ALTER TABLE artifact_sessions ADD COLUMN IF NOT EXISTS artifact_type TEXT");
  await pgPool.query("ALTER TABLE artifact_sessions ADD COLUMN IF NOT EXISTS intent_mode TEXT");
  await pgPool.query("ALTER TABLE artifact_sessions ADD COLUMN IF NOT EXISTS prompt TEXT");
  await pgPool.query("ALTER TABLE artifact_sessions ADD COLUMN IF NOT EXISTS resolved_prompt TEXT");
  await pgPool.query("ALTER TABLE artifact_sessions ADD COLUMN IF NOT EXISTS source_message_id INTEGER");
  await pgPool.query("ALTER TABLE artifact_sessions ADD COLUMN IF NOT EXISTS input_files_json TEXT");
  await pgPool.query("ALTER TABLE artifact_sessions ADD COLUMN IF NOT EXISTS image_refs_json TEXT");
  await pgPool.query("ALTER TABLE artifact_sessions ADD COLUMN IF NOT EXISTS status TEXT");
  await pgPool.query("ALTER TABLE artifact_sessions ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ");
  await pgPool.query("ALTER TABLE artifact_sessions ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ");

  columnNames = new Set(await getPostgresTableColumns("artifact_sessions"));

  const backfillLegacyColumn = async (legacyName, canonicalName) => {
    if (!columnNames.has(legacyName) || !columnNames.has(canonicalName)) return;
    await pgPool.query(
      `UPDATE artifact_sessions
          SET ${quoteIdent(canonicalName)} = COALESCE(${quoteIdent(canonicalName)}, ${quoteIdent(legacyName)})
        WHERE ${quoteIdent(canonicalName)} IS NULL`
    );
  };

  await backfillLegacyColumn("prompt_text", "prompt");
  await backfillLegacyColumn("prompttext", "prompt");
  await backfillLegacyColumn("resolvedprompt", "resolved_prompt");
  await backfillLegacyColumn("conversationid", "conversation_id");
  await backfillLegacyColumn("artifacttype", "artifact_type");
  await backfillLegacyColumn("intentmode", "intent_mode");
  await backfillLegacyColumn("source_messageid", "source_message_id");
  await backfillLegacyColumn("sourcemessageid", "source_message_id");
  await backfillLegacyColumn("inputfilesjson", "input_files_json");
  await backfillLegacyColumn("imagerefsjson", "image_refs_json");
  await backfillLegacyColumn("createdat", "created_at");
  await backfillLegacyColumn("updatedat", "updated_at");

  if (legacyExists && await pgTableExists("artifactsessions")) {
    const legacyColumns = new Set(await getPostgresTableColumns("artifactsessions"));
    const selectExpressions = [];
    const insertColumns = [];
    const expressionByColumn = {
      id: legacyColumns.has("id") ? "id" : null,
      conversation_id: legacyColumns.has("conversation_id")
        ? "conversation_id"
        : legacyColumns.has("conversationid")
          ? "conversationid"
          : null,
      artifact_type: legacyColumns.has("artifact_type")
        ? "artifact_type"
        : legacyColumns.has("artifacttype")
          ? "artifacttype"
          : null,
      intent_mode: legacyColumns.has("intent_mode")
        ? "intent_mode"
        : legacyColumns.has("intentmode")
          ? "intentmode"
          : null,
      prompt: legacyColumns.has("prompt")
        ? "prompt"
        : legacyColumns.has("prompt_text")
          ? "prompt_text"
          : legacyColumns.has("prompttext")
            ? "prompttext"
            : null,
      resolved_prompt: legacyColumns.has("resolved_prompt")
        ? "resolved_prompt"
        : legacyColumns.has("resolvedprompt")
          ? "resolvedprompt"
          : null,
      source_message_id: legacyColumns.has("source_message_id")
        ? "source_message_id"
        : legacyColumns.has("source_messageid")
          ? "source_messageid"
          : legacyColumns.has("sourcemessageid")
            ? "sourcemessageid"
            : null,
      input_files_json: legacyColumns.has("input_files_json")
        ? "input_files_json"
        : legacyColumns.has("inputfilesjson")
          ? "inputfilesjson"
          : null,
      image_refs_json: legacyColumns.has("image_refs_json")
        ? "image_refs_json"
        : legacyColumns.has("imagerefsjson")
          ? "imagerefsjson"
          : null,
      status: legacyColumns.has("status") ? "status" : "'pending'",
      created_at: legacyColumns.has("created_at")
        ? "created_at"
        : legacyColumns.has("createdat")
          ? "createdat"
          : "CURRENT_TIMESTAMP",
      updated_at: legacyColumns.has("updated_at")
        ? "updated_at"
        : legacyColumns.has("updatedat")
          ? "updatedat"
          : "CURRENT_TIMESTAMP",
    };

    for (const columnName of ARTIFACT_SESSION_CANONICAL_COLUMNS) {
      const expression = expressionByColumn[columnName];
      if (!expression) continue;
      insertColumns.push(quoteIdent(columnName));
      selectExpressions.push(expression.startsWith("'") || expression.includes("CURRENT_")
        ? expression
        : quoteIdent(expression));
    }

    if (insertColumns.length && selectExpressions.length) {
      await pgPool.query(
        `INSERT INTO artifact_sessions (${insertColumns.join(", ")})
         SELECT ${selectExpressions.join(", ")}
           FROM artifactsessions
          ON CONFLICT (id) DO NOTHING`
      );
    }
  }

  await pgPool.query("UPDATE artifact_sessions SET prompt = COALESCE(prompt, '') WHERE prompt IS NULL");
  await pgPool.query("UPDATE artifact_sessions SET artifact_type = COALESCE(NULLIF(artifact_type, ''), 'artifact') WHERE artifact_type IS NULL OR artifact_type = ''");
  await pgPool.query("UPDATE artifact_sessions SET resolved_prompt = COALESCE(NULLIF(resolved_prompt, ''), prompt, '') WHERE resolved_prompt IS NULL OR resolved_prompt = ''");
  await pgPool.query("UPDATE artifact_sessions SET status = COALESCE(NULLIF(status, ''), 'pending') WHERE status IS NULL OR status = ''");
  await pgPool.query("UPDATE artifact_sessions SET created_at = COALESCE(created_at, CURRENT_TIMESTAMP) WHERE created_at IS NULL");
  await pgPool.query("UPDATE artifact_sessions SET updated_at = COALESCE(updated_at, created_at, CURRENT_TIMESTAMP) WHERE updated_at IS NULL");
  await pgPool.query("ALTER TABLE artifact_sessions ALTER COLUMN prompt SET NOT NULL");
  await pgPool.query("ALTER TABLE artifact_sessions ALTER COLUMN artifact_type SET NOT NULL");
  await pgPool.query("ALTER TABLE artifact_sessions ALTER COLUMN status SET DEFAULT 'pending'");
  await pgPool.query("CREATE INDEX IF NOT EXISTS idx_artifact_sessions_conversation_id ON artifact_sessions(conversation_id, id DESC)");
}

async function ensureArtifactSessionsSchema() {
  if (DB_CLIENT === "postgres") {
    await ensureArtifactSessionsSchemaPostgres();
    return;
  }
  await ensureArtifactSessionsSchemaSqlite();
}

async function migrateSqlite() {
  await execSqlite("PRAGMA journal_mode = WAL;");

  await execSqlite(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user',
      department TEXT,
      can_access_intranet INTEGER NOT NULL DEFAULT 0,
      preferred_locale TEXT NOT NULL DEFAULT 'pt-BR',
      job_title TEXT,
      unit_name TEXT,
      additional_permissions_json TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  const userColumns = await allSqlite("PRAGMA table_info(users)");
  if (!userColumns.some((column) => column.name === "department")) {
    await execSqlite("ALTER TABLE users ADD COLUMN department TEXT;");
  }
  if (!userColumns.some((column) => column.name === "can_access_intranet")) {
    await execSqlite("ALTER TABLE users ADD COLUMN can_access_intranet INTEGER NOT NULL DEFAULT 0;");
  }
  if (!userColumns.some((column) => column.name === "preferred_locale")) {
    await execSqlite("ALTER TABLE users ADD COLUMN preferred_locale TEXT NOT NULL DEFAULT 'pt-BR';");
  }
  if (!userColumns.some((column) => column.name === "job_title")) {
    await execSqlite("ALTER TABLE users ADD COLUMN job_title TEXT;");
  }
  if (!userColumns.some((column) => column.name === "unit_name")) {
    await execSqlite("ALTER TABLE users ADD COLUMN unit_name TEXT;");
  }
  if (!userColumns.some((column) => column.name === "additional_permissions_json")) {
    await execSqlite("ALTER TABLE users ADD COLUMN additional_permissions_json TEXT;");
  }

  await execSqlite(`
    CREATE TABLE IF NOT EXISTS departments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slug TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL UNIQUE,
      description TEXT,
      icon TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      sort_order INTEGER NOT NULL DEFAULT 0,
      metadata_json TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  const departmentColumns = await allSqlite("PRAGMA table_info(departments)");
  if (!departmentColumns.some((column) => column.name === "is_active")) {
    await execSqlite("ALTER TABLE departments ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1;");
  }

  await execSqlite(`
    CREATE TABLE IF NOT EXISTS user_departments (
      user_id INTEGER NOT NULL,
      department_id INTEGER NOT NULL,
      access_level TEXT NOT NULL DEFAULT 'colaborador',
      is_primary INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(user_id, department_id)
    );
  `);

  await execSqlite(`
    CREATE TABLE IF NOT EXISTS department_submenus (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      department_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      slug TEXT NOT NULL,
      description TEXT,
      icon TEXT,
      view_key TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1,
      metadata_json TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(department_id, slug)
    );
  `);

  await execSqlite(`
    CREATE TABLE IF NOT EXISTS intranet_announcements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      content_text TEXT NOT NULL,
      summary_text TEXT,
      audience_scope TEXT NOT NULL DEFAULT 'all',
      department_ids_json TEXT,
      announcement_type TEXT NOT NULL DEFAULT 'announcement',
      priority TEXT NOT NULL DEFAULT 'normal',
      is_pinned INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1,
      starts_at TEXT,
      ends_at TEXT,
      author_user_id INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  await execSqlite(`
    CREATE TABLE IF NOT EXISTS conversations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      title TEXT NOT NULL DEFAULT 'Nova conversa',
      mode TEXT NOT NULL DEFAULT 'geral',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  await execSqlite(`
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      conversation_id INTEGER NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      meta_json TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  await execSqlite(`
    CREATE TABLE IF NOT EXISTS files (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      conversation_id INTEGER,
      uploaded_by INTEGER NOT NULL,
      original_name TEXT NOT NULL,
      stored_name TEXT NOT NULL,
      mime_type TEXT,
      size_bytes INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  await ensureArtifactSessionsSchemaSqlite();

  await execSqlite(`
    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      action TEXT NOT NULL,
      meta_json TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  await execSqlite(`
    CREATE TABLE IF NOT EXISTS documents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_path TEXT NOT NULL UNIQUE,
      rel_path TEXT NOT NULL,
      ext TEXT NOT NULL,
      size_bytes INTEGER,
      modified_ms INTEGER,
      extracted_text TEXT NOT NULL,
      mime_type TEXT,
      department_name TEXT,
      source_kind TEXT,
      language TEXT,
      translated_text TEXT,
      translated_language TEXT,
      content_hash TEXT,
      keywords TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  const documentColumns = await allSqlite("PRAGMA table_info(documents)");
  if (!documentColumns.some((column) => column.name === "mime_type")) {
    await execSqlite("ALTER TABLE documents ADD COLUMN mime_type TEXT;");
  }
  if (!documentColumns.some((column) => column.name === "department_name")) {
    await execSqlite("ALTER TABLE documents ADD COLUMN department_name TEXT;");
  }
  if (!documentColumns.some((column) => column.name === "source_kind")) {
    await execSqlite("ALTER TABLE documents ADD COLUMN source_kind TEXT;");
  }
  if (!documentColumns.some((column) => column.name === "language")) {
    await execSqlite("ALTER TABLE documents ADD COLUMN language TEXT;");
  }
  if (!documentColumns.some((column) => column.name === "translated_text")) {
    await execSqlite("ALTER TABLE documents ADD COLUMN translated_text TEXT;");
  }
  if (!documentColumns.some((column) => column.name === "translated_language")) {
    await execSqlite("ALTER TABLE documents ADD COLUMN translated_language TEXT;");
  }
  if (!documentColumns.some((column) => column.name === "content_hash")) {
    await execSqlite("ALTER TABLE documents ADD COLUMN content_hash TEXT;");
  }
  if (!documentColumns.some((column) => column.name === "keywords")) {
    await execSqlite("ALTER TABLE documents ADD COLUMN keywords TEXT;");
  }

  await execSqlite(`
    CREATE TABLE IF NOT EXISTS document_chunks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      document_id INTEGER NOT NULL,
      rel_path TEXT NOT NULL,
      chunk_index INTEGER NOT NULL,
      content_text TEXT NOT NULL,
      department_name TEXT,
      language TEXT,
      translated_text TEXT,
      translated_language TEXT,
      content_hash TEXT,
      keywords TEXT,
      embedding_json TEXT,
      embedding_model TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(document_id, chunk_index)
    );
  `);

  const chunkColumns = await allSqlite("PRAGMA table_info(document_chunks)");
  if (!chunkColumns.some((column) => column.name === "department_name")) {
    await execSqlite("ALTER TABLE document_chunks ADD COLUMN department_name TEXT;");
  }
  if (!chunkColumns.some((column) => column.name === "language")) {
    await execSqlite("ALTER TABLE document_chunks ADD COLUMN language TEXT;");
  }
  if (!chunkColumns.some((column) => column.name === "translated_text")) {
    await execSqlite("ALTER TABLE document_chunks ADD COLUMN translated_text TEXT;");
  }
  if (!chunkColumns.some((column) => column.name === "translated_language")) {
    await execSqlite("ALTER TABLE document_chunks ADD COLUMN translated_language TEXT;");
  }
  if (!chunkColumns.some((column) => column.name === "content_hash")) {
    await execSqlite("ALTER TABLE document_chunks ADD COLUMN content_hash TEXT;");
  }
  if (!chunkColumns.some((column) => column.name === "keywords")) {
    await execSqlite("ALTER TABLE document_chunks ADD COLUMN keywords TEXT;");
  }
  if (!chunkColumns.some((column) => column.name === "embedding_json")) {
    await execSqlite("ALTER TABLE document_chunks ADD COLUMN embedding_json TEXT;");
  }
  if (!chunkColumns.some((column) => column.name === "embedding_model")) {
    await execSqlite("ALTER TABLE document_chunks ADD COLUMN embedding_model TEXT;");
  }

  await execSqlite(`
    CREATE TABLE IF NOT EXISTS conversation_memories (
      conversation_id INTEGER PRIMARY KEY,
      summary_text TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  await execSqlite(`
    CREATE TABLE IF NOT EXISTS user_memories (
      user_id INTEGER PRIMARY KEY,
      summary_text TEXT NOT NULL DEFAULT '',
      topics_json TEXT,
      language TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  await execSqlite(`
    CREATE TABLE IF NOT EXISTS knowledge_sources (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      original_name TEXT NOT NULL,
      stored_name TEXT NOT NULL,
      mime_type TEXT,
      language TEXT,
      content_hash TEXT,
      department_name TEXT,
      source_kind TEXT NOT NULL DEFAULT 'manual_upload',
      sync_status TEXT NOT NULL DEFAULT 'local',
      openai_file_id TEXT,
      vector_store_file_id TEXT,
      uploaded_by INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  const knowledgeSourceColumns = await allSqlite("PRAGMA table_info(knowledge_sources)");
  if (!knowledgeSourceColumns.some((column) => column.name === "mime_type")) {
    await execSqlite("ALTER TABLE knowledge_sources ADD COLUMN mime_type TEXT;");
  }
  if (!knowledgeSourceColumns.some((column) => column.name === "language")) {
    await execSqlite("ALTER TABLE knowledge_sources ADD COLUMN language TEXT;");
  }
  if (!knowledgeSourceColumns.some((column) => column.name === "content_hash")) {
    await execSqlite("ALTER TABLE knowledge_sources ADD COLUMN content_hash TEXT;");
  }
  if (!knowledgeSourceColumns.some((column) => column.name === "department_name")) {
    await execSqlite("ALTER TABLE knowledge_sources ADD COLUMN department_name TEXT;");
  }
  if (!knowledgeSourceColumns.some((column) => column.name === "source_kind")) {
    await execSqlite("ALTER TABLE knowledge_sources ADD COLUMN source_kind TEXT NOT NULL DEFAULT 'manual_upload';");
  }
  if (!knowledgeSourceColumns.some((column) => column.name === "sync_status")) {
    await execSqlite("ALTER TABLE knowledge_sources ADD COLUMN sync_status TEXT NOT NULL DEFAULT 'local';");
  }
  if (!knowledgeSourceColumns.some((column) => column.name === "processing_state_json")) {
    await execSqlite("ALTER TABLE knowledge_sources ADD COLUMN processing_state_json TEXT;");
  }
  if (!knowledgeSourceColumns.some((column) => column.name === "updated_at")) {
    await execSqlite("ALTER TABLE knowledge_sources ADD COLUMN updated_at TEXT;");
  }
  await execSqlite("UPDATE knowledge_sources SET updated_at=COALESCE(updated_at, created_at, datetime('now')) WHERE updated_at IS NULL OR updated_at='';");

  await execSqlite(`
    CREATE TABLE IF NOT EXISTS knowledge_processing_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      knowledge_source_id INTEGER,
      stage_key TEXT NOT NULL,
      stage_status TEXT NOT NULL,
      message TEXT,
      detail_json TEXT,
      actor_user_id INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  await execSqlite(`
    CREATE TABLE IF NOT EXISTS memory_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      conversation_id INTEGER,
      knowledge_source_id INTEGER,
      memory_scope TEXT NOT NULL,
      memory_kind TEXT NOT NULL DEFAULT 'context',
      title TEXT,
      content_text TEXT NOT NULL,
      normalized_text TEXT,
      topics_json TEXT,
      language TEXT,
      source_message_ids_json TEXT,
      embedding_json TEXT,
      embedding_model TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  const memoryEntryColumns = await allSqlite("PRAGMA table_info(memory_entries)");
  if (!memoryEntryColumns.some((column) => column.name === "knowledge_source_id")) {
    await execSqlite("ALTER TABLE memory_entries ADD COLUMN knowledge_source_id INTEGER;");
  }

  await execSqlite(`
    CREATE TABLE IF NOT EXISTS ai_training_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      conversation_id INTEGER,
      knowledge_source_id INTEGER,
      event_type TEXT NOT NULL,
      event_status TEXT NOT NULL DEFAULT 'info',
      title TEXT,
      detail_text TEXT,
      meta_json TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  await execSqlite(`
    CREATE TABLE IF NOT EXISTS semantic_cache (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      scope_key TEXT,
      normalized_query TEXT NOT NULL,
      query_text TEXT NOT NULL,
      query_language TEXT,
      response_text TEXT NOT NULL,
      response_language TEXT,
      sources_json TEXT,
      embedding_json TEXT,
      knowledge_signature TEXT,
      hit_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  await execSqlite(`
    CREATE TABLE IF NOT EXISTS closers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      official_name TEXT NOT NULL UNIQUE,
      display_name TEXT,
      user_id INTEGER,
      status TEXT NOT NULL DEFAULT 'active',
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  await execSqlite(`
    CREATE TABLE IF NOT EXISTS closer_aliases (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      closer_id INTEGER NOT NULL,
      alias_name TEXT NOT NULL UNIQUE,
      origin TEXT NOT NULL DEFAULT 'manual',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  await execSqlite(`
    CREATE TABLE IF NOT EXISTS sales_import_sources (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_key TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      source_type TEXT NOT NULL DEFAULT 'manual_upload',
      sheet_name TEXT NOT NULL DEFAULT 'MATRICULAS NOVAS',
      post_sale_sheet_pattern TEXT,
      config_json TEXT,
      last_imported_at TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  await execSqlite(`
    CREATE TABLE IF NOT EXISTS sales_import_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_id INTEGER,
      origin_type TEXT NOT NULL DEFAULT 'manual_upload',
      source_workbook TEXT,
      post_sale_workbook TEXT,
      source_sheet TEXT NOT NULL DEFAULT 'MATRICULAS NOVAS',
      total_rows INTEGER NOT NULL DEFAULT 0,
      inserted_rows INTEGER NOT NULL DEFAULT 0,
      updated_rows INTEGER NOT NULL DEFAULT 0,
      duplicate_rows INTEGER NOT NULL DEFAULT 0,
      ignored_rows INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'completed',
      triggered_by INTEGER,
      summary_json TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  await execSqlite(`
    CREATE TABLE IF NOT EXISTS sales_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_id INTEGER,
      import_run_id INTEGER,
      origin_type TEXT NOT NULL DEFAULT 'spreadsheet_import',
      source_workbook TEXT,
      source_sheet TEXT,
      source_row_number INTEGER,
      source_row_identifier TEXT,
      dedupe_hash TEXT NOT NULL UNIQUE,
      row_hash TEXT,
      student_name TEXT NOT NULL,
      phone TEXT,
      course_name TEXT,
      level_name TEXT,
      teacher_name TEXT,
      attendant_name TEXT,
      sale_month TEXT,
      sale_date TEXT,
      semester_label TEXT,
      availability TEXT,
      modality TEXT,
      class_type TEXT,
      system_name TEXT,
      contract_status TEXT,
      language TEXT,
      closer_original TEXT,
      closer_normalized TEXT,
      closer_id INTEGER,
      user_id INTEGER,
      media_source TEXT,
      profession TEXT,
      indication TEXT,
      feedback TEXT,
      post_sale_rating TEXT,
      contact_email TEXT,
      lead_stage TEXT,
      interest_goal TEXT,
      negotiation_notes TEXT,
      first_contact_at TEXT,
      closed_at TEXT,
      lost_at TEXT,
      lost_reason TEXT,
      student_id INTEGER,
      enrollment_id INTEGER,
      financial_contract_id INTEGER,
      converted_at TIMESTAMPTZ,
      source_payload_json TEXT,
      operational_status TEXT NOT NULL DEFAULT 'Novo',
      follow_up_notes TEXT,
      next_action TEXT,
      next_action_date TEXT,
      observations TEXT,
      custom_fields_json TEXT,
      last_synced_at TEXT,
      last_modified_by INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  const salesRecordColumns = await allSqlite("PRAGMA table_info(sales_records)");
  const missingSalesRecordColumns = [
    ["phone", "TEXT"],
    ["level_name", "TEXT"],
    ["teacher_name", "TEXT"],
    ["attendant_name", "TEXT"],
    ["feedback", "TEXT"],
    ["post_sale_rating", "TEXT"],
    ["contact_email", "TEXT"],
    ["lead_stage", "TEXT"],
    ["interest_goal", "TEXT"],
    ["negotiation_notes", "TEXT"],
    ["first_contact_at", "TEXT"],
    ["closed_at", "TEXT"],
    ["lost_at", "TEXT"],
    ["lost_reason", "TEXT"],
    ["student_id", "INTEGER"],
    ["enrollment_id", "INTEGER"],
    ["financial_contract_id", "INTEGER"],
    ["converted_at", "TEXT"],
  ];
  for (const [columnName, columnType] of missingSalesRecordColumns) {
    if (!salesRecordColumns.some((column) => column.name === columnName)) {
      await execSqlite(`ALTER TABLE sales_records ADD COLUMN ${columnName} ${columnType};`);
    }
  }

  await execSqlite(`
    CREATE TABLE IF NOT EXISTS entity_change_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entity_type TEXT NOT NULL,
      entity_id INTEGER NOT NULL,
      action TEXT NOT NULL,
      field_name TEXT,
      old_value TEXT,
      new_value TEXT,
      actor_user_id INTEGER,
      closer_id INTEGER,
      origin TEXT NOT NULL DEFAULT 'system',
      detail_json TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  await execSqlite(`
    CREATE TABLE IF NOT EXISTS calendar_event_types (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_key TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL UNIQUE,
      description TEXT,
      color TEXT,
      icon TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  await execSqlite(`
    CREATE TABLE IF NOT EXISTS calendar_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      description TEXT,
      event_type_id INTEGER,
      meeting_mode TEXT NOT NULL DEFAULT 'online',
      start_at TEXT NOT NULL,
      end_at TEXT NOT NULL,
      all_day INTEGER NOT NULL DEFAULT 0,
      location TEXT,
      meeting_link TEXT,
      notes TEXT,
      reminder_settings_json TEXT,
      status TEXT NOT NULL DEFAULT 'scheduled',
      created_by INTEGER NOT NULL,
      last_updated_by INTEGER,
      cancelled_at TEXT,
      cancel_reason TEXT,
      metadata_json TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  await execSqlite(`
    CREATE TABLE IF NOT EXISTS calendar_event_participants (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      participant_role TEXT NOT NULL DEFAULT 'participant',
      response_status TEXT NOT NULL DEFAULT 'invited',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(event_id, user_id)
    );
  `);

  await execSqlite(`
    CREATE TABLE IF NOT EXISTS calendar_event_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id INTEGER NOT NULL,
      actor_user_id INTEGER,
      action TEXT NOT NULL,
      field_name TEXT,
      old_value TEXT,
      new_value TEXT,
      detail_json TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  await execSqlite(`
    CREATE TABLE IF NOT EXISTS marketing_influencers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      department_id INTEGER,
      name TEXT NOT NULL,
      influence_types_json TEXT,
      contract_type TEXT,
      photo_url TEXT,
      instagram_url TEXT,
      followers_count INTEGER NOT NULL DEFAULT 0,
      partnership_start_date TEXT,
      influencer_status TEXT NOT NULL DEFAULT 'ativo',
      notes TEXT,
      created_by INTEGER,
      updated_by INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  await execSqlite(`
    CREATE TABLE IF NOT EXISTS marketing_influencer_metrics (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      influencer_id INTEGER NOT NULL,
      period_type TEXT NOT NULL DEFAULT 'month',
      period_start TEXT NOT NULL,
      period_end TEXT,
      posts_count INTEGER NOT NULL DEFAULT 0,
      reels_count INTEGER NOT NULL DEFAULT 0,
      stories_count INTEGER NOT NULL DEFAULT 0,
      views_count INTEGER NOT NULL DEFAULT 0,
      enrollments_count INTEGER NOT NULL DEFAULT 0,
      performance_score REAL,
      notes TEXT,
      source_type TEXT NOT NULL DEFAULT 'manual',
      created_by INTEGER,
      updated_by INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  await execSqlite(`
    CREATE TABLE IF NOT EXISTS marketing_indicator_tabs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      department_id INTEGER,
      sheet_key TEXT NOT NULL,
      title TEXT NOT NULL,
      slug TEXT NOT NULL,
      indicator_kind TEXT NOT NULL DEFAULT 'generic',
      owner_name TEXT,
      owner_photo_url TEXT,
      columns_json TEXT NOT NULL DEFAULT '[]',
      series_keys_json TEXT NOT NULL DEFAULT '[]',
      metadata_json TEXT NOT NULL DEFAULT '{}',
      chart_type TEXT NOT NULL DEFAULT 'line',
      sort_order INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_by INTEGER,
      updated_by INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(department_id, sheet_key)
    );
  `);

  await execSqlite(`
    CREATE TABLE IF NOT EXISTS marketing_indicator_rows (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tab_id INTEGER NOT NULL,
      row_order INTEGER NOT NULL DEFAULT 0,
      row_label TEXT,
      values_json TEXT NOT NULL DEFAULT '{}',
      source_type TEXT NOT NULL DEFAULT 'manual',
      created_by INTEGER,
      updated_by INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  await execSqlite(`
    CREATE TABLE IF NOT EXISTS pedagogical_whatsapp_groups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      department_id INTEGER,
      internal_code TEXT,
      name TEXT NOT NULL,
      group_link TEXT,
      category TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      notes TEXT,
      metadata_json TEXT,
      created_by INTEGER,
      updated_by INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  await execSqlite(`
    CREATE TABLE IF NOT EXISTS pedagogical_whatsapp_campaigns (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      department_id INTEGER,
      name TEXT NOT NULL,
      image_url TEXT,
      message_text TEXT NOT NULL,
      campaign_link TEXT,
      interval_seconds INTEGER NOT NULL DEFAULT 30,
      status TEXT NOT NULL DEFAULT 'draft',
      execution_mode TEXT NOT NULL DEFAULT 'prepared',
      integration_status TEXT NOT NULL DEFAULT 'pending_provider',
      scheduled_at TEXT,
      started_at TEXT,
      finished_at TEXT,
      total_groups INTEGER NOT NULL DEFAULT 0,
      total_sent INTEGER NOT NULL DEFAULT 0,
      total_pending INTEGER NOT NULL DEFAULT 0,
      total_error INTEGER NOT NULL DEFAULT 0,
      last_error TEXT,
      metadata_json TEXT,
      created_by INTEGER,
      updated_by INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  await execSqlite(`
    CREATE TABLE IF NOT EXISTS pedagogical_whatsapp_campaign_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      campaign_id INTEGER NOT NULL,
      group_id INTEGER NOT NULL,
      queue_order INTEGER NOT NULL DEFAULT 0,
      send_status TEXT NOT NULL DEFAULT 'queued',
      provider_message_id TEXT,
      error_message TEXT,
      last_attempt_at TEXT,
      sent_at TEXT,
      attempt_count INTEGER NOT NULL DEFAULT 0,
      metadata_json TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(campaign_id, group_id)
    );
  `);

  await execSqlite(`
    CREATE TABLE IF NOT EXISTS pedagogical_whatsapp_campaign_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      campaign_id INTEGER,
      campaign_item_id INTEGER,
      group_id INTEGER,
      action TEXT NOT NULL,
      detail_json TEXT,
      actor_user_id INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  await execSqlite(`
    CREATE TABLE IF NOT EXISTS pedagogical_whatsapp_settings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      setting_key TEXT NOT NULL UNIQUE,
      setting_value TEXT,
      metadata_json TEXT,
      updated_by INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  await execSqlite(`
    CREATE TABLE IF NOT EXISTS students (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      full_name TEXT NOT NULL,
      normalized_name TEXT,
      preferred_name TEXT,
      birth_date TEXT,
      age INTEGER,
      gender TEXT,
      cpf TEXT,
      rg TEXT,
      email TEXT,
      phone TEXT,
      whatsapp TEXT,
      emergency_contact_name TEXT,
      emergency_contact_phone TEXT,
      address_zipcode TEXT,
      address_street TEXT,
      address_number TEXT,
      address_complement TEXT,
      address_neighborhood TEXT,
      address_city TEXT,
      address_state TEXT,
      notes TEXT,
      allergies TEXT,
      medical_notes TEXT,
      school_name TEXT,
      school_grade TEXT,
      status TEXT NOT NULL DEFAULT 'ativo',
      source_workbook TEXT,
      source_sheet TEXT,
      source_row_identifier TEXT,
      source_payload_json TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  await execSqlite(`
    CREATE TABLE IF NOT EXISTS student_guardians (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      student_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      relation_type TEXT,
      cpf TEXT,
      phone TEXT,
      whatsapp TEXT,
      email TEXT,
      financial_responsible INTEGER NOT NULL DEFAULT 0,
      pedagogical_responsible INTEGER NOT NULL DEFAULT 0,
      receives_notifications INTEGER NOT NULL DEFAULT 1,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  const studentGuardianColumns = await allSqlite("PRAGMA table_info(student_guardians)");
  if (!studentGuardianColumns.some((column) => column.name === "cpf")) {
    await execSqlite("ALTER TABLE student_guardians ADD COLUMN cpf TEXT;");
  }

  await execSqlite(`
    CREATE TABLE IF NOT EXISTS academic_programs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      language TEXT,
      program_name TEXT NOT NULL,
      level_name TEXT,
      stage_name TEXT,
      semester_label TEXT,
      modality TEXT,
      material_name TEXT,
      workload_hours REAL,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  await execSqlite(`
    CREATE TABLE IF NOT EXISTS school_terms (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      code TEXT NOT NULL UNIQUE,
      start_date TEXT,
      end_date TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  await execSqlite(`
    CREATE TABLE IF NOT EXISTS classes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT UNIQUE,
      name TEXT NOT NULL,
      school_term_id INTEGER,
      academic_program_id INTEGER,
      language TEXT,
      modality TEXT,
      level_name TEXT,
      semester_label TEXT,
      age_group TEXT,
      whatsapp_group_id INTEGER,
      capacity INTEGER,
      min_students INTEGER,
      status TEXT NOT NULL DEFAULT 'planejada',
      room_name TEXT,
      unit_name TEXT,
      notes TEXT,
      class_kind TEXT NOT NULL DEFAULT 'regular',
      source_workbook TEXT,
      source_sheet TEXT,
      source_block_ref TEXT,
      metadata_json TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  await execSqlite(`
    CREATE TABLE IF NOT EXISTS class_schedules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      class_id INTEGER NOT NULL,
      weekday TEXT,
      start_time TEXT,
      end_time TEXT,
      timezone TEXT NOT NULL DEFAULT 'America/Sao_Paulo',
      is_primary INTEGER NOT NULL DEFAULT 0,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  await execSqlite(`
    CREATE TABLE IF NOT EXISTS teacher_profiles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      display_name TEXT NOT NULL,
      normalized_name TEXT NOT NULL UNIQUE,
      aliases_json TEXT,
      specialties_json TEXT,
      metadata_json TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  await execSqlite(`
    CREATE TABLE IF NOT EXISTS class_teachers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      class_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      role_in_class TEXT NOT NULL DEFAULT 'teacher',
      start_date TEXT,
      end_date TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(class_id, user_id, role_in_class, start_date)
    );
  `);

  await execSqlite(`
    CREATE TABLE IF NOT EXISTS enrollments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      student_id INTEGER NOT NULL,
      academic_program_id INTEGER,
      school_term_id INTEGER,
      class_id INTEGER,
      whatsapp_group_id INTEGER,
      enrollment_number TEXT UNIQUE,
      enrollment_date TEXT,
      start_date TEXT,
      end_date TEXT,
      enrollment_status TEXT NOT NULL DEFAULT 'aguardando turma',
      contract_status TEXT,
      payment_status TEXT,
      pedagogical_status TEXT,
      learning_book TEXT,
      grade_summary TEXT,
      grade_notes TEXT,
      source_channel TEXT,
      source_notes TEXT,
      notes TEXT,
      source_workbook TEXT,
      source_sheet TEXT,
      source_row_identifier TEXT,
      source_payload_json TEXT,
      metadata_json TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  await execSqlite(`
    CREATE TABLE IF NOT EXISTS class_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      class_id INTEGER NOT NULL,
      class_schedule_id INTEGER,
      class_date TEXT NOT NULL,
      start_time TEXT,
      end_time TEXT,
      session_status TEXT NOT NULL DEFAULT 'planejada',
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  await execSqlite(`
    CREATE TABLE IF NOT EXISTS attendance_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      enrollment_id INTEGER NOT NULL,
      class_id INTEGER NOT NULL,
      class_schedule_id INTEGER,
      class_date TEXT NOT NULL,
      attendance_status TEXT NOT NULL DEFAULT 'presente',
      notes TEXT,
      recorded_by_user_id INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(enrollment_id, class_id, class_schedule_id, class_date)
    );
  `);

  await execSqlite(`
    CREATE TABLE IF NOT EXISTS enrollment_class_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      enrollment_id INTEGER NOT NULL,
      old_class_id INTEGER,
      new_class_id INTEGER,
      reason TEXT,
      changed_by_user_id INTEGER,
      changed_at TEXT NOT NULL DEFAULT (datetime('now')),
      notes TEXT
    );
  `);

  await execSqlite(`
    CREATE TABLE IF NOT EXISTS enrollment_schedule_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      enrollment_id INTEGER NOT NULL,
      old_class_id INTEGER,
      new_class_id INTEGER,
      old_schedule_snapshot_json TEXT,
      new_schedule_snapshot_json TEXT,
      reason TEXT,
      changed_by_user_id INTEGER,
      changed_at TEXT NOT NULL DEFAULT (datetime('now')),
      notes TEXT
    );
  `);

  await execSqlite(`
    CREATE TABLE IF NOT EXISTS student_transfers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      enrollment_id INTEGER NOT NULL,
      transfer_type TEXT NOT NULL,
      old_value_json TEXT,
      new_value_json TEXT,
      reason TEXT,
      changed_by_user_id INTEGER,
      changed_at TEXT NOT NULL DEFAULT (datetime('now')),
      notes TEXT
    );
  `);

  await execSqlite(`
    CREATE TABLE IF NOT EXISTS academic_import_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_key TEXT NOT NULL DEFAULT 'academic-consolidated',
      status TEXT NOT NULL DEFAULT 'running',
      workbook_names_json TEXT,
      imported_sheets_json TEXT,
      ignored_sheets_json TEXT,
      summary_json TEXT,
      actor_user_id INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  await execSqlite(`
    CREATE TABLE IF NOT EXISTS academic_import_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id INTEGER NOT NULL,
      workbook_name TEXT,
      sheet_name TEXT,
      log_level TEXT NOT NULL DEFAULT 'info',
      stage TEXT,
      message TEXT NOT NULL,
      payload_json TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  await execSqlite(`
    CREATE TABLE IF NOT EXISTS financial_contracts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      student_id INTEGER NOT NULL,
      enrollment_id INTEGER,
      sales_record_id INTEGER,
      responsible_guardian_id INTEGER,
      contract_number TEXT,
      contract_type TEXT NOT NULL DEFAULT 'course_enrollment',
      contract_status TEXT NOT NULL DEFAULT 'draft',
      total_amount REAL,
      currency TEXT NOT NULL DEFAULT 'BRL',
      installments_count INTEGER NOT NULL DEFAULT 0,
      first_due_date TEXT,
      billing_cycle_day INTEGER,
      payment_method_preference TEXT,
      responsible_name TEXT,
      responsible_cpf TEXT,
      contract_pdf_file_name TEXT,
      contract_pdf_generated_at TEXT,
      notes TEXT,
      source_workbook TEXT,
      source_sheet TEXT,
      source_row_identifier TEXT,
      source_payload_json TEXT,
      metadata_json TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  await execSqlite(`
    CREATE TABLE IF NOT EXISTS financial_installments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      contract_id INTEGER NOT NULL,
      installment_number INTEGER NOT NULL,
      due_date TEXT,
      amount REAL,
      status TEXT NOT NULL DEFAULT 'pending',
      paid_at TEXT,
      payment_method TEXT,
      reference_label TEXT,
      notes TEXT,
      metadata_json TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  await execSqlite(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_financial_installments_contract_number
      ON financial_installments(contract_id, installment_number);
  `);

  await execSqlite(`
    CREATE TABLE IF NOT EXISTS student_timeline (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      student_id INTEGER NOT NULL,
      enrollment_id INTEGER,
      sales_record_id INTEGER,
      contract_id INTEGER,
      installment_id INTEGER,
      event_type TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      actor_user_id INTEGER,
      metadata_json TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  const studentColumns = await allSqlite("PRAGMA table_info(students)");
  if (!studentColumns.some((column) => column.name === "source_workbook")) {
    await execSqlite("ALTER TABLE students ADD COLUMN source_workbook TEXT;");
  }

  const classColumns = await allSqlite("PRAGMA table_info(classes)");
  if (!classColumns.some((column) => column.name === "class_kind")) {
    await execSqlite("ALTER TABLE classes ADD COLUMN class_kind TEXT NOT NULL DEFAULT 'regular';");
  }
  if (!classColumns.some((column) => column.name === "source_workbook")) {
    await execSqlite("ALTER TABLE classes ADD COLUMN source_workbook TEXT;");
  }
  if (!classColumns.some((column) => column.name === "metadata_json")) {
    await execSqlite("ALTER TABLE classes ADD COLUMN metadata_json TEXT;");
  }
  if (!classColumns.some((column) => column.name === "whatsapp_group_id")) {
    await execSqlite("ALTER TABLE classes ADD COLUMN whatsapp_group_id INTEGER;");
  }

  const enrollmentColumns = await allSqlite("PRAGMA table_info(enrollments)");
  if (!enrollmentColumns.some((column) => column.name === "source_workbook")) {
    await execSqlite("ALTER TABLE enrollments ADD COLUMN source_workbook TEXT;");
  }
  if (!enrollmentColumns.some((column) => column.name === "metadata_json")) {
    await execSqlite("ALTER TABLE enrollments ADD COLUMN metadata_json TEXT;");
  }
  if (!enrollmentColumns.some((column) => column.name === "learning_book")) {
    await execSqlite("ALTER TABLE enrollments ADD COLUMN learning_book TEXT;");
  }
  if (!enrollmentColumns.some((column) => column.name === "grade_summary")) {
    await execSqlite("ALTER TABLE enrollments ADD COLUMN grade_summary TEXT;");
  }
  if (!enrollmentColumns.some((column) => column.name === "grade_notes")) {
    await execSqlite("ALTER TABLE enrollments ADD COLUMN grade_notes TEXT;");
  }
  if (!enrollmentColumns.some((column) => column.name === "whatsapp_group_id")) {
    await execSqlite("ALTER TABLE enrollments ADD COLUMN whatsapp_group_id INTEGER;");
  }

  const contractColumns = await allSqlite("PRAGMA table_info(financial_contracts)");
  if (!contractColumns.some((column) => column.name === "payment_method_preference")) {
    await execSqlite("ALTER TABLE financial_contracts ADD COLUMN payment_method_preference TEXT;");
  }
  if (!contractColumns.some((column) => column.name === "contract_pdf_file_name")) {
    await execSqlite("ALTER TABLE financial_contracts ADD COLUMN contract_pdf_file_name TEXT;");
  }
  if (!contractColumns.some((column) => column.name === "contract_pdf_generated_at")) {
    await execSqlite("ALTER TABLE financial_contracts ADD COLUMN contract_pdf_generated_at TEXT;");
  }

  await execSqlite(`
    CREATE VIRTUAL TABLE IF NOT EXISTS documents_fts
    USING fts5(extracted_text, translated_text, rel_path, keywords, language, content='documents', content_rowid='id');
  `);

  await execSqlite(`
    CREATE VIRTUAL TABLE IF NOT EXISTS document_chunks_fts
    USING fts5(content_text, translated_text, rel_path, keywords, language, content='document_chunks', content_rowid='id');
  `);

  await execSqlite("CREATE INDEX IF NOT EXISTS idx_users_intranet_access ON users(can_access_intranet);");
  await execSqlite("CREATE INDEX IF NOT EXISTS idx_departments_sort ON departments(sort_order, name);");
  await execSqlite("CREATE INDEX IF NOT EXISTS idx_departments_active ON departments(is_active, sort_order, name);");
  await execSqlite("CREATE INDEX IF NOT EXISTS idx_user_departments_user ON user_departments(user_id);");
  await execSqlite("CREATE INDEX IF NOT EXISTS idx_user_departments_department ON user_departments(department_id);");
  await execSqlite("CREATE INDEX IF NOT EXISTS idx_department_submenus_department ON department_submenus(department_id, is_active, sort_order, title);");
  await execSqlite("CREATE INDEX IF NOT EXISTS idx_intranet_announcements_active ON intranet_announcements(is_active, is_pinned, created_at);");
  await execSqlite("CREATE INDEX IF NOT EXISTS idx_messages_conv_created ON messages(conversation_id, created_at);");
  await execSqlite("CREATE INDEX IF NOT EXISTS idx_conversations_user_updated ON conversations(user_id, updated_at);");
  await execSqlite("CREATE INDEX IF NOT EXISTS idx_documents_modified ON documents(modified_ms);");
  await execSqlite("CREATE INDEX IF NOT EXISTS idx_documents_language ON documents(language);");
  await execSqlite("CREATE INDEX IF NOT EXISTS idx_documents_hash ON documents(content_hash);");
  await execSqlite("CREATE INDEX IF NOT EXISTS idx_documents_department ON documents(department_name, updated_at);");
  await execSqlite("CREATE INDEX IF NOT EXISTS idx_document_chunks_document_idx ON document_chunks(document_id, chunk_index);");
  await execSqlite("CREATE INDEX IF NOT EXISTS idx_document_chunks_language ON document_chunks(language);");
  await execSqlite("CREATE INDEX IF NOT EXISTS idx_document_chunks_department ON document_chunks(department_name, updated_at);");
  await execSqlite("CREATE INDEX IF NOT EXISTS idx_knowledge_sources_created ON knowledge_sources(created_at);");
  await execSqlite("CREATE INDEX IF NOT EXISTS idx_knowledge_sources_department ON knowledge_sources(department_name, created_at);");
  await execSqlite("CREATE INDEX IF NOT EXISTS idx_knowledge_sources_updated ON knowledge_sources(updated_at);");
  await execSqlite("CREATE INDEX IF NOT EXISTS idx_knowledge_processing_logs_source ON knowledge_processing_logs(knowledge_source_id, created_at);");
  await execSqlite("CREATE INDEX IF NOT EXISTS idx_memory_entries_user_scope ON memory_entries(user_id, memory_scope, updated_at);");
  await execSqlite("CREATE INDEX IF NOT EXISTS idx_memory_entries_conversation ON memory_entries(conversation_id, updated_at);");
  await execSqlite("CREATE INDEX IF NOT EXISTS idx_memory_entries_knowledge_source ON memory_entries(knowledge_source_id, memory_scope, updated_at);");
  await execSqlite("CREATE INDEX IF NOT EXISTS idx_ai_training_events_user_created ON ai_training_events(user_id, created_at);");
  await execSqlite("CREATE INDEX IF NOT EXISTS idx_ai_training_events_source_created ON ai_training_events(knowledge_source_id, created_at);");
  await execSqlite("CREATE INDEX IF NOT EXISTS idx_semantic_cache_scope_updated ON semantic_cache(scope_key, updated_at);");
  await execSqlite("CREATE INDEX IF NOT EXISTS idx_closers_status ON closers(status, official_name);");
  await execSqlite("CREATE INDEX IF NOT EXISTS idx_closers_user ON closers(user_id);");
  await execSqlite("CREATE INDEX IF NOT EXISTS idx_closer_aliases_closer ON closer_aliases(closer_id);");
  await execSqlite("CREATE INDEX IF NOT EXISTS idx_sales_import_runs_created ON sales_import_runs(created_at);");
  await execSqlite("CREATE INDEX IF NOT EXISTS idx_sales_records_closer ON sales_records(closer_id, sale_date);");
  await execSqlite("CREATE INDEX IF NOT EXISTS idx_sales_records_user ON sales_records(user_id, updated_at);");
  await execSqlite("CREATE INDEX IF NOT EXISTS idx_sales_records_status ON sales_records(operational_status, updated_at);");
  await execSqlite("CREATE INDEX IF NOT EXISTS idx_sales_records_workbook ON sales_records(source_workbook, source_sheet);");
  await execSqlite("CREATE INDEX IF NOT EXISTS idx_sales_records_student ON sales_records(student_id, enrollment_id, financial_contract_id);");
  await execSqlite("CREATE INDEX IF NOT EXISTS idx_sales_records_lead_stage ON sales_records(lead_stage, converted_at);");
  await execSqlite("CREATE INDEX IF NOT EXISTS idx_sales_records_contact_email ON sales_records(contact_email);");
  await execSqlite("CREATE INDEX IF NOT EXISTS idx_entity_change_log_entity ON entity_change_log(entity_type, entity_id, created_at);");
  await execSqlite("CREATE INDEX IF NOT EXISTS idx_entity_change_log_actor ON entity_change_log(actor_user_id, created_at);");
  await execSqlite("CREATE INDEX IF NOT EXISTS idx_calendar_event_types_active ON calendar_event_types(is_active, sort_order, name);");
  await execSqlite("CREATE INDEX IF NOT EXISTS idx_calendar_events_start ON calendar_events(start_at, end_at);");
  await execSqlite("CREATE INDEX IF NOT EXISTS idx_calendar_events_status ON calendar_events(status, start_at);");
  await execSqlite("CREATE INDEX IF NOT EXISTS idx_calendar_events_creator ON calendar_events(created_by, updated_at);");
  await execSqlite("CREATE INDEX IF NOT EXISTS idx_calendar_event_participants_event ON calendar_event_participants(event_id, user_id);");
  await execSqlite("CREATE INDEX IF NOT EXISTS idx_calendar_event_participants_user ON calendar_event_participants(user_id, event_id);");
  await execSqlite("CREATE INDEX IF NOT EXISTS idx_calendar_event_logs_event ON calendar_event_logs(event_id, created_at);");
  await execSqlite("CREATE INDEX IF NOT EXISTS idx_calendar_event_logs_actor ON calendar_event_logs(actor_user_id, created_at);");
  await execSqlite("CREATE INDEX IF NOT EXISTS idx_marketing_influencers_department ON marketing_influencers(department_id, influencer_status, name);");
  await execSqlite("CREATE INDEX IF NOT EXISTS idx_marketing_influencers_status ON marketing_influencers(influencer_status, updated_at);");
  await execSqlite("CREATE INDEX IF NOT EXISTS idx_marketing_influencer_metrics_influencer ON marketing_influencer_metrics(influencer_id, period_start, period_end);");
  await execSqlite("CREATE INDEX IF NOT EXISTS idx_marketing_influencer_metrics_period ON marketing_influencer_metrics(period_type, period_start);");
  await execSqlite("CREATE INDEX IF NOT EXISTS idx_marketing_indicator_tabs_department ON marketing_indicator_tabs(department_id, sort_order, title);");
  await execSqlite("CREATE INDEX IF NOT EXISTS idx_marketing_indicator_tabs_kind ON marketing_indicator_tabs(indicator_kind, is_active, updated_at);");
  await execSqlite("CREATE INDEX IF NOT EXISTS idx_marketing_indicator_rows_tab ON marketing_indicator_rows(tab_id, row_order, updated_at);");
  await execSqlite("CREATE INDEX IF NOT EXISTS idx_marketing_indicator_rows_source ON marketing_indicator_rows(source_type, created_at);");
  await execSqlite("CREATE INDEX IF NOT EXISTS idx_pedagogical_whatsapp_groups_department ON pedagogical_whatsapp_groups(department_id, status, name);");
  await execSqlite("CREATE INDEX IF NOT EXISTS idx_pedagogical_whatsapp_groups_status ON pedagogical_whatsapp_groups(status, updated_at);");
  await execSqlite("CREATE INDEX IF NOT EXISTS idx_pedagogical_whatsapp_campaigns_department ON pedagogical_whatsapp_campaigns(department_id, status, created_at);");
  await execSqlite("CREATE INDEX IF NOT EXISTS idx_pedagogical_whatsapp_campaigns_execution ON pedagogical_whatsapp_campaigns(execution_mode, integration_status, updated_at);");
  await execSqlite("CREATE INDEX IF NOT EXISTS idx_pedagogical_whatsapp_items_campaign ON pedagogical_whatsapp_campaign_items(campaign_id, queue_order, send_status);");
  await execSqlite("CREATE INDEX IF NOT EXISTS idx_pedagogical_whatsapp_items_group ON pedagogical_whatsapp_campaign_items(group_id, send_status, updated_at);");
  await execSqlite("CREATE INDEX IF NOT EXISTS idx_pedagogical_whatsapp_logs_campaign ON pedagogical_whatsapp_campaign_logs(campaign_id, created_at);");
  await execSqlite("CREATE INDEX IF NOT EXISTS idx_students_name ON students(normalized_name, status, updated_at);");
  await execSqlite("CREATE INDEX IF NOT EXISTS idx_students_phone ON students(phone, whatsapp);");
  await execSqlite("CREATE INDEX IF NOT EXISTS idx_student_guardians_student ON student_guardians(student_id, financial_responsible, pedagogical_responsible);");
  await execSqlite("CREATE INDEX IF NOT EXISTS idx_student_guardians_search ON student_guardians(student_id, cpf, phone, email, name);");
  await execSqlite("CREATE INDEX IF NOT EXISTS idx_academic_programs_lookup ON academic_programs(language, modality, semester_label, level_name);");
  await execSqlite("CREATE INDEX IF NOT EXISTS idx_school_terms_code ON school_terms(code, status);");
  await execSqlite("CREATE INDEX IF NOT EXISTS idx_classes_term_program ON classes(school_term_id, academic_program_id, status);");
  await execSqlite("CREATE INDEX IF NOT EXISTS idx_classes_source ON classes(source_sheet, source_block_ref);");
  await execSqlite("CREATE INDEX IF NOT EXISTS idx_classes_kind ON classes(class_kind, modality, semester_label);");
  await execSqlite("CREATE INDEX IF NOT EXISTS idx_class_schedules_class ON class_schedules(class_id, weekday, start_time);");
  await execSqlite("CREATE INDEX IF NOT EXISTS idx_teacher_profiles_name ON teacher_profiles(normalized_name, active);");
  await execSqlite("CREATE INDEX IF NOT EXISTS idx_teacher_profiles_user ON teacher_profiles(user_id, active);");
  await execSqlite("CREATE INDEX IF NOT EXISTS idx_class_teachers_class ON class_teachers(class_id, is_active, role_in_class);");
  await execSqlite("CREATE INDEX IF NOT EXISTS idx_class_teachers_user ON class_teachers(user_id, is_active, class_id);");
  await execSqlite("CREATE INDEX IF NOT EXISTS idx_enrollments_student ON enrollments(student_id, enrollment_status, updated_at);");
  await execSqlite("CREATE INDEX IF NOT EXISTS idx_enrollments_class ON enrollments(class_id, enrollment_status, updated_at);");
  await execSqlite("CREATE INDEX IF NOT EXISTS idx_enrollments_term ON enrollments(school_term_id, academic_program_id, updated_at);");
  await execSqlite("CREATE INDEX IF NOT EXISTS idx_enrollments_source ON enrollments(source_sheet, source_row_identifier);");
  await execSqlite("CREATE INDEX IF NOT EXISTS idx_class_sessions_class_date ON class_sessions(class_id, class_date, session_status);");
  await execSqlite("CREATE INDEX IF NOT EXISTS idx_class_sessions_schedule ON class_sessions(class_schedule_id, class_date);");
  await execSqlite("CREATE INDEX IF NOT EXISTS idx_attendance_class_date ON attendance_records(class_id, class_date, attendance_status);");
  await execSqlite("CREATE INDEX IF NOT EXISTS idx_attendance_enrollment_date ON attendance_records(enrollment_id, class_date, attendance_status);");
  await execSqlite("CREATE INDEX IF NOT EXISTS idx_enrollment_class_history_enrollment ON enrollment_class_history(enrollment_id, changed_at);");
  await execSqlite("CREATE INDEX IF NOT EXISTS idx_enrollment_schedule_history_enrollment ON enrollment_schedule_history(enrollment_id, changed_at);");
  await execSqlite("CREATE INDEX IF NOT EXISTS idx_student_transfers_enrollment ON student_transfers(enrollment_id, changed_at);");
  await execSqlite("CREATE INDEX IF NOT EXISTS idx_academic_import_runs_created ON academic_import_runs(created_at, status);");
  await execSqlite("CREATE INDEX IF NOT EXISTS idx_academic_import_logs_run ON academic_import_logs(run_id, created_at);");
  await execSqlite("CREATE INDEX IF NOT EXISTS idx_financial_contracts_student ON financial_contracts(student_id, contract_status, updated_at);");
  await execSqlite("CREATE INDEX IF NOT EXISTS idx_financial_contracts_enrollment ON financial_contracts(enrollment_id, sales_record_id);");
  await execSqlite("CREATE INDEX IF NOT EXISTS idx_financial_installments_due ON financial_installments(contract_id, due_date, status);");
  await execSqlite("CREATE INDEX IF NOT EXISTS idx_financial_installments_status ON financial_installments(status, due_date);");
  await execSqlite("CREATE INDEX IF NOT EXISTS idx_student_timeline_student ON student_timeline(student_id, created_at);");
  await execSqlite("CREATE INDEX IF NOT EXISTS idx_student_timeline_enrollment ON student_timeline(enrollment_id, created_at);");

  await execSqlite(`
    CREATE TRIGGER IF NOT EXISTS documents_ai AFTER INSERT ON documents BEGIN
      INSERT INTO documents_fts(rowid, extracted_text, translated_text, rel_path, keywords, language)
      VALUES (new.id, new.extracted_text, new.translated_text, new.rel_path, new.keywords, new.language);
    END;
  `);
  await execSqlite(`
    CREATE TRIGGER IF NOT EXISTS documents_ad AFTER DELETE ON documents BEGIN
      INSERT INTO documents_fts(documents_fts, rowid, extracted_text, translated_text, rel_path, keywords, language)
      VALUES('delete', old.id, old.extracted_text, old.translated_text, old.rel_path, old.keywords, old.language);
    END;
  `);
  await execSqlite(`
    CREATE TRIGGER IF NOT EXISTS documents_au AFTER UPDATE ON documents BEGIN
      INSERT INTO documents_fts(documents_fts, rowid, extracted_text, translated_text, rel_path, keywords, language)
      VALUES('delete', old.id, old.extracted_text, old.translated_text, old.rel_path, old.keywords, old.language);
      INSERT INTO documents_fts(rowid, extracted_text, translated_text, rel_path, keywords, language)
      VALUES (new.id, new.extracted_text, new.translated_text, new.rel_path, new.keywords, new.language);
    END;
  `);
  await execSqlite(`
    CREATE TRIGGER IF NOT EXISTS document_chunks_ai AFTER INSERT ON document_chunks BEGIN
      INSERT INTO document_chunks_fts(rowid, content_text, translated_text, rel_path, keywords, language)
      VALUES (new.id, new.content_text, new.translated_text, new.rel_path, new.keywords, new.language);
    END;
  `);
  await execSqlite(`
    CREATE TRIGGER IF NOT EXISTS document_chunks_ad AFTER DELETE ON document_chunks BEGIN
      INSERT INTO document_chunks_fts(document_chunks_fts, rowid, content_text, translated_text, rel_path, keywords, language)
      VALUES('delete', old.id, old.content_text, old.translated_text, old.rel_path, old.keywords, old.language);
    END;
  `);
  await execSqlite(`
    CREATE TRIGGER IF NOT EXISTS document_chunks_au AFTER UPDATE ON document_chunks BEGIN
      INSERT INTO document_chunks_fts(document_chunks_fts, rowid, content_text, translated_text, rel_path, keywords, language)
      VALUES('delete', old.id, old.content_text, old.translated_text, old.rel_path, old.keywords, old.language);
      INSERT INTO document_chunks_fts(rowid, content_text, translated_text, rel_path, keywords, language)
      VALUES (new.id, new.content_text, new.translated_text, new.rel_path, new.keywords, new.language);
    END;
  `);
}
async function migratePostgres() {
  await pgPool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user',
      department TEXT,
      can_access_intranet BOOLEAN NOT NULL DEFAULT FALSE,
      preferred_locale TEXT NOT NULL DEFAULT 'pt-BR',
      job_title TEXT,
      unit_name TEXT,
      additional_permissions_json TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await pgPool.query(`
    CREATE TABLE IF NOT EXISTS departments (
      id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
      slug TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL UNIQUE,
      description TEXT,
      icon TEXT,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      sort_order INTEGER NOT NULL DEFAULT 0,
      metadata_json TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await pgPool.query(`
    CREATE TABLE IF NOT EXISTS user_departments (
      user_id INTEGER NOT NULL,
      department_id INTEGER NOT NULL,
      access_level TEXT NOT NULL DEFAULT 'colaborador',
      is_primary BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, department_id)
    );
  `);

  await pgPool.query(`
    CREATE TABLE IF NOT EXISTS department_submenus (
      id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
      department_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      slug TEXT NOT NULL,
      description TEXT,
      icon TEXT,
      view_key TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      metadata_json TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(department_id, slug)
    );
  `);

  await pgPool.query(`
    CREATE TABLE IF NOT EXISTS intranet_announcements (
      id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
      title TEXT NOT NULL,
      content_text TEXT NOT NULL,
      summary_text TEXT,
      audience_scope TEXT NOT NULL DEFAULT 'all',
      department_ids_json TEXT,
      announcement_type TEXT NOT NULL DEFAULT 'announcement',
      priority TEXT NOT NULL DEFAULT 'normal',
      is_pinned BOOLEAN NOT NULL DEFAULT FALSE,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      starts_at TIMESTAMPTZ,
      ends_at TIMESTAMPTZ,
      author_user_id INTEGER,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await pgPool.query(`
    CREATE TABLE IF NOT EXISTS conversations (
      id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
      user_id INTEGER NOT NULL,
      title TEXT NOT NULL DEFAULT 'Nova conversa',
      mode TEXT NOT NULL DEFAULT 'geral',
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await pgPool.query(`
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
      conversation_id INTEGER NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      meta_json TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await pgPool.query(`
    CREATE TABLE IF NOT EXISTS files (
      id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
      conversation_id INTEGER,
      uploaded_by INTEGER NOT NULL,
      original_name TEXT NOT NULL,
      stored_name TEXT NOT NULL,
      mime_type TEXT,
      size_bytes INTEGER,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await ensureArtifactSessionsSchemaPostgres();

  await pgPool.query(`
    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
      user_id INTEGER,
      action TEXT NOT NULL,
      meta_json TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await pgPool.query(`
    CREATE TABLE IF NOT EXISTS documents (
      id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
      source_path TEXT NOT NULL UNIQUE,
      rel_path TEXT NOT NULL,
      ext TEXT NOT NULL,
      size_bytes INTEGER,
      modified_ms BIGINT,
      extracted_text TEXT NOT NULL,
      mime_type TEXT,
      department_name TEXT,
      source_kind TEXT,
      language TEXT,
      translated_text TEXT,
      translated_language TEXT,
      content_hash TEXT,
      keywords TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await pgPool.query(`
    CREATE TABLE IF NOT EXISTS document_chunks (
      id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
      document_id INTEGER NOT NULL,
      rel_path TEXT NOT NULL,
      chunk_index INTEGER NOT NULL,
      content_text TEXT NOT NULL,
      department_name TEXT,
      language TEXT,
      translated_text TEXT,
      translated_language TEXT,
      content_hash TEXT,
      keywords TEXT,
      embedding_json TEXT,
      embedding_model TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(document_id, chunk_index)
    );
  `);

  await pgPool.query(`
    CREATE TABLE IF NOT EXISTS conversation_memories (
      conversation_id INTEGER PRIMARY KEY,
      summary_text TEXT NOT NULL DEFAULT '',
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await pgPool.query(`
    CREATE TABLE IF NOT EXISTS user_memories (
      user_id INTEGER PRIMARY KEY,
      summary_text TEXT NOT NULL DEFAULT '',
      topics_json TEXT,
      language TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await pgPool.query(`
    CREATE TABLE IF NOT EXISTS knowledge_sources (
      id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
      original_name TEXT NOT NULL,
      stored_name TEXT NOT NULL,
      mime_type TEXT,
      language TEXT,
      content_hash TEXT,
      department_name TEXT,
      source_kind TEXT NOT NULL DEFAULT 'manual_upload',
      sync_status TEXT NOT NULL DEFAULT 'local',
      openai_file_id TEXT,
      vector_store_file_id TEXT,
      uploaded_by INTEGER,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await pgPool.query(`
    CREATE TABLE IF NOT EXISTS semantic_cache (
      id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
      user_id INTEGER,
      scope_key TEXT,
      normalized_query TEXT NOT NULL,
      query_text TEXT NOT NULL,
      query_language TEXT,
      response_text TEXT NOT NULL,
      response_language TEXT,
      sources_json TEXT,
      embedding_json TEXT,
      knowledge_signature TEXT,
      hit_count INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await pgPool.query(`
    CREATE TABLE IF NOT EXISTS closers (
      id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
      official_name TEXT NOT NULL UNIQUE,
      display_name TEXT,
      user_id INTEGER,
      status TEXT NOT NULL DEFAULT 'active',
      notes TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await pgPool.query(`
    CREATE TABLE IF NOT EXISTS closer_aliases (
      id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
      closer_id INTEGER NOT NULL,
      alias_name TEXT NOT NULL UNIQUE,
      origin TEXT NOT NULL DEFAULT 'manual',
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await pgPool.query(`
    CREATE TABLE IF NOT EXISTS sales_import_sources (
      id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
      source_key TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      source_type TEXT NOT NULL DEFAULT 'manual_upload',
      sheet_name TEXT NOT NULL DEFAULT 'MATRICULAS NOVAS',
      post_sale_sheet_pattern TEXT,
      config_json TEXT,
      last_imported_at TIMESTAMPTZ,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await pgPool.query(`
    CREATE TABLE IF NOT EXISTS sales_import_runs (
      id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
      source_id INTEGER,
      origin_type TEXT NOT NULL DEFAULT 'manual_upload',
      source_workbook TEXT,
      post_sale_workbook TEXT,
      source_sheet TEXT NOT NULL DEFAULT 'MATRICULAS NOVAS',
      total_rows INTEGER NOT NULL DEFAULT 0,
      inserted_rows INTEGER NOT NULL DEFAULT 0,
      updated_rows INTEGER NOT NULL DEFAULT 0,
      duplicate_rows INTEGER NOT NULL DEFAULT 0,
      ignored_rows INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'completed',
      triggered_by INTEGER,
      summary_json TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await pgPool.query(`
    CREATE TABLE IF NOT EXISTS sales_records (
      id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
      source_id INTEGER,
      import_run_id INTEGER,
      origin_type TEXT NOT NULL DEFAULT 'spreadsheet_import',
      source_workbook TEXT,
      source_sheet TEXT,
      source_row_number INTEGER,
      source_row_identifier TEXT,
      dedupe_hash TEXT NOT NULL UNIQUE,
      row_hash TEXT,
      student_name TEXT NOT NULL,
      phone TEXT,
      course_name TEXT,
      level_name TEXT,
      teacher_name TEXT,
      attendant_name TEXT,
      sale_month TEXT,
      sale_date TEXT,
      semester_label TEXT,
      availability TEXT,
      modality TEXT,
      class_type TEXT,
      system_name TEXT,
      contract_status TEXT,
      language TEXT,
      closer_original TEXT,
      closer_normalized TEXT,
      closer_id INTEGER,
      user_id INTEGER,
      media_source TEXT,
      profession TEXT,
      indication TEXT,
      feedback TEXT,
      post_sale_rating TEXT,
      contact_email TEXT,
      lead_stage TEXT,
      interest_goal TEXT,
      negotiation_notes TEXT,
      first_contact_at TIMESTAMPTZ,
      closed_at TIMESTAMPTZ,
      lost_at TIMESTAMPTZ,
      lost_reason TEXT,
      student_id INTEGER,
      enrollment_id INTEGER,
      financial_contract_id INTEGER,
      converted_at TIMESTAMPTZ,
      source_payload_json TEXT,
      operational_status TEXT NOT NULL DEFAULT 'Novo',
      follow_up_notes TEXT,
      next_action TEXT,
      next_action_date TEXT,
      observations TEXT,
      custom_fields_json TEXT,
      last_synced_at TIMESTAMPTZ,
      last_modified_by INTEGER,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  await pgPool.query("ALTER TABLE sales_records ADD COLUMN IF NOT EXISTS phone TEXT;");
  await pgPool.query("ALTER TABLE sales_records ADD COLUMN IF NOT EXISTS level_name TEXT;");
  await pgPool.query("ALTER TABLE sales_records ADD COLUMN IF NOT EXISTS teacher_name TEXT;");
  await pgPool.query("ALTER TABLE sales_records ADD COLUMN IF NOT EXISTS attendant_name TEXT;");
  await pgPool.query("ALTER TABLE sales_records ADD COLUMN IF NOT EXISTS feedback TEXT;");
  await pgPool.query("ALTER TABLE sales_records ADD COLUMN IF NOT EXISTS post_sale_rating TEXT;");
  await pgPool.query("ALTER TABLE sales_records ADD COLUMN IF NOT EXISTS contact_email TEXT;");
  await pgPool.query("ALTER TABLE sales_records ADD COLUMN IF NOT EXISTS lead_stage TEXT;");
  await pgPool.query("ALTER TABLE sales_records ADD COLUMN IF NOT EXISTS interest_goal TEXT;");
  await pgPool.query("ALTER TABLE sales_records ADD COLUMN IF NOT EXISTS negotiation_notes TEXT;");
  await pgPool.query("ALTER TABLE sales_records ADD COLUMN IF NOT EXISTS first_contact_at TIMESTAMPTZ;");
  await pgPool.query("ALTER TABLE sales_records ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ;");
  await pgPool.query("ALTER TABLE sales_records ADD COLUMN IF NOT EXISTS lost_at TIMESTAMPTZ;");
  await pgPool.query("ALTER TABLE sales_records ADD COLUMN IF NOT EXISTS lost_reason TEXT;");
  await pgPool.query("ALTER TABLE sales_records ADD COLUMN IF NOT EXISTS student_id INTEGER;");
  await pgPool.query("ALTER TABLE sales_records ADD COLUMN IF NOT EXISTS enrollment_id INTEGER;");
  await pgPool.query("ALTER TABLE sales_records ADD COLUMN IF NOT EXISTS financial_contract_id INTEGER;");
  await pgPool.query("ALTER TABLE sales_records ADD COLUMN IF NOT EXISTS converted_at TIMESTAMPTZ;");

  await pgPool.query(`
    CREATE TABLE IF NOT EXISTS entity_change_log (
      id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
      entity_type TEXT NOT NULL,
      entity_id INTEGER NOT NULL,
      action TEXT NOT NULL,
      field_name TEXT,
      old_value TEXT,
      new_value TEXT,
      actor_user_id INTEGER,
      closer_id INTEGER,
      origin TEXT NOT NULL DEFAULT 'system',
      detail_json TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await pgPool.query(`
    CREATE TABLE IF NOT EXISTS calendar_event_types (
      id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
      event_key TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL UNIQUE,
      description TEXT,
      color TEXT,
      icon TEXT,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await pgPool.query(`
    CREATE TABLE IF NOT EXISTS calendar_events (
      id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT,
      event_type_id INTEGER,
      meeting_mode TEXT NOT NULL DEFAULT 'online',
      start_at TIMESTAMPTZ NOT NULL,
      end_at TIMESTAMPTZ NOT NULL,
      all_day BOOLEAN NOT NULL DEFAULT FALSE,
      location TEXT,
      meeting_link TEXT,
      notes TEXT,
      reminder_settings_json TEXT,
      status TEXT NOT NULL DEFAULT 'scheduled',
      created_by INTEGER NOT NULL,
      last_updated_by INTEGER,
      cancelled_at TIMESTAMPTZ,
      cancel_reason TEXT,
      metadata_json TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await pgPool.query(`
    CREATE TABLE IF NOT EXISTS calendar_event_participants (
      id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
      event_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      participant_role TEXT NOT NULL DEFAULT 'participant',
      response_status TEXT NOT NULL DEFAULT 'invited',
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(event_id, user_id)
    );
  `);

  await pgPool.query(`
    CREATE TABLE IF NOT EXISTS calendar_event_logs (
      id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
      event_id INTEGER NOT NULL,
      actor_user_id INTEGER,
      action TEXT NOT NULL,
      field_name TEXT,
      old_value TEXT,
      new_value TEXT,
      detail_json TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await pgPool.query(`
    CREATE TABLE IF NOT EXISTS marketing_influencers (
      id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
      department_id INTEGER,
      name TEXT NOT NULL,
      influence_types_json TEXT,
      contract_type TEXT,
      photo_url TEXT,
      instagram_url TEXT,
      followers_count INTEGER NOT NULL DEFAULT 0,
      partnership_start_date DATE,
      influencer_status TEXT NOT NULL DEFAULT 'ativo',
      notes TEXT,
      created_by INTEGER,
      updated_by INTEGER,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await pgPool.query(`
    CREATE TABLE IF NOT EXISTS marketing_influencer_metrics (
      id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
      influencer_id INTEGER NOT NULL,
      period_type TEXT NOT NULL DEFAULT 'month',
      period_start DATE NOT NULL,
      period_end DATE,
      posts_count INTEGER NOT NULL DEFAULT 0,
      reels_count INTEGER NOT NULL DEFAULT 0,
      stories_count INTEGER NOT NULL DEFAULT 0,
      views_count INTEGER NOT NULL DEFAULT 0,
      enrollments_count INTEGER NOT NULL DEFAULT 0,
      performance_score DOUBLE PRECISION,
      notes TEXT,
      source_type TEXT NOT NULL DEFAULT 'manual',
      created_by INTEGER,
      updated_by INTEGER,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await pgPool.query(`
    CREATE TABLE IF NOT EXISTS marketing_indicator_tabs (
      id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
      department_id INTEGER,
      sheet_key TEXT NOT NULL,
      title TEXT NOT NULL,
      slug TEXT NOT NULL,
      indicator_kind TEXT NOT NULL DEFAULT 'generic',
      owner_name TEXT,
      owner_photo_url TEXT,
      columns_json TEXT NOT NULL DEFAULT '[]',
      series_keys_json TEXT NOT NULL DEFAULT '[]',
      metadata_json TEXT NOT NULL DEFAULT '{}',
      chart_type TEXT NOT NULL DEFAULT 'line',
      sort_order INTEGER NOT NULL DEFAULT 0,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_by INTEGER,
      updated_by INTEGER,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(department_id, sheet_key)
    );
  `);

  await pgPool.query(`
    CREATE TABLE IF NOT EXISTS marketing_indicator_rows (
      id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
      tab_id INTEGER NOT NULL,
      row_order INTEGER NOT NULL DEFAULT 0,
      row_label TEXT,
      values_json TEXT NOT NULL DEFAULT '{}',
      source_type TEXT NOT NULL DEFAULT 'manual',
      created_by INTEGER,
      updated_by INTEGER,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await pgPool.query(`
    CREATE TABLE IF NOT EXISTS pedagogical_whatsapp_groups (
      id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
      department_id INTEGER,
      internal_code TEXT,
      name TEXT NOT NULL,
      group_link TEXT,
      category TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      notes TEXT,
      metadata_json TEXT,
      created_by INTEGER,
      updated_by INTEGER,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await pgPool.query(`
    CREATE TABLE IF NOT EXISTS pedagogical_whatsapp_campaigns (
      id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
      department_id INTEGER,
      name TEXT NOT NULL,
      image_url TEXT,
      message_text TEXT NOT NULL,
      campaign_link TEXT,
      interval_seconds INTEGER NOT NULL DEFAULT 30,
      status TEXT NOT NULL DEFAULT 'draft',
      execution_mode TEXT NOT NULL DEFAULT 'prepared',
      integration_status TEXT NOT NULL DEFAULT 'pending_provider',
      scheduled_at TIMESTAMPTZ,
      started_at TIMESTAMPTZ,
      finished_at TIMESTAMPTZ,
      total_groups INTEGER NOT NULL DEFAULT 0,
      total_sent INTEGER NOT NULL DEFAULT 0,
      total_pending INTEGER NOT NULL DEFAULT 0,
      total_error INTEGER NOT NULL DEFAULT 0,
      last_error TEXT,
      metadata_json TEXT,
      created_by INTEGER,
      updated_by INTEGER,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await pgPool.query(`
    CREATE TABLE IF NOT EXISTS pedagogical_whatsapp_campaign_items (
      id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
      campaign_id INTEGER NOT NULL,
      group_id INTEGER NOT NULL,
      queue_order INTEGER NOT NULL DEFAULT 0,
      send_status TEXT NOT NULL DEFAULT 'queued',
      provider_message_id TEXT,
      error_message TEXT,
      last_attempt_at TIMESTAMPTZ,
      sent_at TIMESTAMPTZ,
      attempt_count INTEGER NOT NULL DEFAULT 0,
      metadata_json TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(campaign_id, group_id)
    );
  `);

  await pgPool.query(`
    CREATE TABLE IF NOT EXISTS pedagogical_whatsapp_campaign_logs (
      id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
      campaign_id INTEGER,
      campaign_item_id INTEGER,
      group_id INTEGER,
      action TEXT NOT NULL,
      detail_json TEXT,
      actor_user_id INTEGER,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await pgPool.query(`
    CREATE TABLE IF NOT EXISTS pedagogical_whatsapp_settings (
      id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
      setting_key TEXT NOT NULL UNIQUE,
      setting_value TEXT,
      metadata_json TEXT,
      updated_by INTEGER,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await pgPool.query(`
    CREATE TABLE IF NOT EXISTS students (
      id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
      full_name TEXT NOT NULL,
      normalized_name TEXT,
      preferred_name TEXT,
      birth_date DATE,
      age INTEGER,
      gender TEXT,
      cpf TEXT,
      rg TEXT,
      email TEXT,
      phone TEXT,
      whatsapp TEXT,
      emergency_contact_name TEXT,
      emergency_contact_phone TEXT,
      address_zipcode TEXT,
      address_street TEXT,
      address_number TEXT,
      address_complement TEXT,
      address_neighborhood TEXT,
      address_city TEXT,
      address_state TEXT,
      notes TEXT,
      allergies TEXT,
      medical_notes TEXT,
      school_name TEXT,
      school_grade TEXT,
      status TEXT NOT NULL DEFAULT 'ativo',
      source_workbook TEXT,
      source_sheet TEXT,
      source_row_identifier TEXT,
      source_payload_json TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await pgPool.query(`
    CREATE TABLE IF NOT EXISTS student_guardians (
      id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
      student_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      relation_type TEXT,
      cpf TEXT,
      phone TEXT,
      whatsapp TEXT,
      email TEXT,
      financial_responsible BOOLEAN NOT NULL DEFAULT FALSE,
      pedagogical_responsible BOOLEAN NOT NULL DEFAULT FALSE,
      receives_notifications BOOLEAN NOT NULL DEFAULT TRUE,
      notes TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await pgPool.query(`
    CREATE TABLE IF NOT EXISTS academic_programs (
      id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
      language TEXT,
      program_name TEXT NOT NULL,
      level_name TEXT,
      stage_name TEXT,
      semester_label TEXT,
      modality TEXT,
      material_name TEXT,
      workload_hours DOUBLE PRECISION,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await pgPool.query(`
    CREATE TABLE IF NOT EXISTS school_terms (
      id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
      name TEXT NOT NULL,
      code TEXT NOT NULL UNIQUE,
      start_date DATE,
      end_date DATE,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await pgPool.query(`
    CREATE TABLE IF NOT EXISTS classes (
      id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
      code TEXT UNIQUE,
      name TEXT NOT NULL,
      school_term_id INTEGER,
      academic_program_id INTEGER,
      language TEXT,
      modality TEXT,
      level_name TEXT,
      semester_label TEXT,
      age_group TEXT,
      whatsapp_group_id INTEGER,
      capacity INTEGER,
      min_students INTEGER,
      status TEXT NOT NULL DEFAULT 'planejada',
      room_name TEXT,
      unit_name TEXT,
      notes TEXT,
      class_kind TEXT NOT NULL DEFAULT 'regular',
      source_workbook TEXT,
      source_sheet TEXT,
      source_block_ref TEXT,
      metadata_json TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await pgPool.query(`
    CREATE TABLE IF NOT EXISTS class_schedules (
      id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
      class_id INTEGER NOT NULL,
      weekday TEXT,
      start_time TEXT,
      end_time TEXT,
      timezone TEXT NOT NULL DEFAULT 'America/Sao_Paulo',
      is_primary BOOLEAN NOT NULL DEFAULT FALSE,
      notes TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await pgPool.query(`
    CREATE TABLE IF NOT EXISTS teacher_profiles (
      id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
      user_id INTEGER,
      display_name TEXT NOT NULL,
      normalized_name TEXT NOT NULL UNIQUE,
      aliases_json TEXT,
      specialties_json TEXT,
      metadata_json TEXT,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await pgPool.query(`
    CREATE TABLE IF NOT EXISTS class_teachers (
      id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
      class_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      role_in_class TEXT NOT NULL DEFAULT 'teacher',
      start_date DATE,
      end_date DATE,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(class_id, user_id, role_in_class, start_date)
    );
  `);

  await pgPool.query(`
    CREATE TABLE IF NOT EXISTS enrollments (
      id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
      student_id INTEGER NOT NULL,
      academic_program_id INTEGER,
      school_term_id INTEGER,
      class_id INTEGER,
      whatsapp_group_id INTEGER,
      enrollment_number TEXT UNIQUE,
      enrollment_date DATE,
      start_date DATE,
      end_date DATE,
      enrollment_status TEXT NOT NULL DEFAULT 'aguardando turma',
      contract_status TEXT,
      payment_status TEXT,
      pedagogical_status TEXT,
      learning_book TEXT,
      grade_summary TEXT,
      grade_notes TEXT,
      source_channel TEXT,
      source_notes TEXT,
      notes TEXT,
      source_workbook TEXT,
      source_sheet TEXT,
      source_row_identifier TEXT,
      source_payload_json TEXT,
      metadata_json TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await pgPool.query(`
    CREATE TABLE IF NOT EXISTS class_sessions (
      id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
      class_id INTEGER NOT NULL,
      class_schedule_id INTEGER,
      class_date DATE NOT NULL,
      start_time TEXT,
      end_time TEXT,
      session_status TEXT NOT NULL DEFAULT 'planejada',
      notes TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await pgPool.query(`
    CREATE TABLE IF NOT EXISTS attendance_records (
      id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
      enrollment_id INTEGER NOT NULL,
      class_id INTEGER NOT NULL,
      class_schedule_id INTEGER,
      class_date DATE NOT NULL,
      attendance_status TEXT NOT NULL DEFAULT 'presente',
      notes TEXT,
      recorded_by_user_id INTEGER,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(enrollment_id, class_id, class_schedule_id, class_date)
    );
  `);

  await pgPool.query(`
    CREATE TABLE IF NOT EXISTS enrollment_class_history (
      id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
      enrollment_id INTEGER NOT NULL,
      old_class_id INTEGER,
      new_class_id INTEGER,
      reason TEXT,
      changed_by_user_id INTEGER,
      changed_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      notes TEXT
    );
  `);

  await pgPool.query(`
    CREATE TABLE IF NOT EXISTS enrollment_schedule_history (
      id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
      enrollment_id INTEGER NOT NULL,
      old_class_id INTEGER,
      new_class_id INTEGER,
      old_schedule_snapshot_json TEXT,
      new_schedule_snapshot_json TEXT,
      reason TEXT,
      changed_by_user_id INTEGER,
      changed_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      notes TEXT
    );
  `);

  await pgPool.query(`
    CREATE TABLE IF NOT EXISTS student_transfers (
      id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
      enrollment_id INTEGER NOT NULL,
      transfer_type TEXT NOT NULL,
      old_value_json TEXT,
      new_value_json TEXT,
      reason TEXT,
      changed_by_user_id INTEGER,
      changed_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      notes TEXT
    );
  `);

  await pgPool.query(`
    CREATE TABLE IF NOT EXISTS academic_import_runs (
      id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
      source_key TEXT NOT NULL DEFAULT 'academic-consolidated',
      status TEXT NOT NULL DEFAULT 'running',
      workbook_names_json TEXT,
      imported_sheets_json TEXT,
      ignored_sheets_json TEXT,
      summary_json TEXT,
      actor_user_id INTEGER,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await pgPool.query(`
    CREATE TABLE IF NOT EXISTS academic_import_logs (
      id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
      run_id INTEGER NOT NULL,
      workbook_name TEXT,
      sheet_name TEXT,
      log_level TEXT NOT NULL DEFAULT 'info',
      stage TEXT,
      message TEXT NOT NULL,
      payload_json TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await pgPool.query(`
    CREATE TABLE IF NOT EXISTS financial_contracts (
      id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
      student_id INTEGER NOT NULL,
      enrollment_id INTEGER,
      sales_record_id INTEGER,
      responsible_guardian_id INTEGER,
      contract_number TEXT,
      contract_type TEXT NOT NULL DEFAULT 'course_enrollment',
      contract_status TEXT NOT NULL DEFAULT 'draft',
      total_amount DOUBLE PRECISION,
      currency TEXT NOT NULL DEFAULT 'BRL',
      installments_count INTEGER NOT NULL DEFAULT 0,
      first_due_date DATE,
      billing_cycle_day INTEGER,
      payment_method_preference TEXT,
      responsible_name TEXT,
      responsible_cpf TEXT,
      contract_pdf_file_name TEXT,
      contract_pdf_generated_at TIMESTAMPTZ,
      notes TEXT,
      source_workbook TEXT,
      source_sheet TEXT,
      source_row_identifier TEXT,
      source_payload_json TEXT,
      metadata_json TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await pgPool.query(`
    CREATE TABLE IF NOT EXISTS financial_installments (
      id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
      contract_id INTEGER NOT NULL,
      installment_number INTEGER NOT NULL,
      due_date DATE,
      amount DOUBLE PRECISION,
      status TEXT NOT NULL DEFAULT 'pending',
      paid_at TIMESTAMPTZ,
      payment_method TEXT,
      reference_label TEXT,
      notes TEXT,
      metadata_json TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(contract_id, installment_number)
    );
  `);

  await pgPool.query(`
    CREATE TABLE IF NOT EXISTS student_timeline (
      id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
      student_id INTEGER NOT NULL,
      enrollment_id INTEGER,
      sales_record_id INTEGER,
      contract_id INTEGER,
      installment_id INTEGER,
      event_type TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      actor_user_id INTEGER,
      metadata_json TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await pgPool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS department TEXT;");
  await pgPool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS can_access_intranet BOOLEAN NOT NULL DEFAULT FALSE;");
  await pgPool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS preferred_locale TEXT NOT NULL DEFAULT 'pt-BR';");
  await pgPool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS job_title TEXT;");
  await pgPool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS unit_name TEXT;");
  await pgPool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS additional_permissions_json TEXT;");
  await pgPool.query("ALTER TABLE departments ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;");
  await pgPool.query("ALTER TABLE documents ADD COLUMN IF NOT EXISTS mime_type TEXT;");
  await pgPool.query("ALTER TABLE documents ADD COLUMN IF NOT EXISTS department_name TEXT;");
  await pgPool.query("ALTER TABLE documents ADD COLUMN IF NOT EXISTS source_kind TEXT;");
  await pgPool.query("ALTER TABLE documents ADD COLUMN IF NOT EXISTS language TEXT;");
  await pgPool.query("ALTER TABLE documents ADD COLUMN IF NOT EXISTS translated_text TEXT;");
  await pgPool.query("ALTER TABLE documents ADD COLUMN IF NOT EXISTS translated_language TEXT;");
  await pgPool.query("ALTER TABLE documents ADD COLUMN IF NOT EXISTS content_hash TEXT;");
  await pgPool.query("ALTER TABLE documents ADD COLUMN IF NOT EXISTS keywords TEXT;");
  await pgPool.query("ALTER TABLE document_chunks ADD COLUMN IF NOT EXISTS department_name TEXT;");
  await pgPool.query("ALTER TABLE document_chunks ADD COLUMN IF NOT EXISTS language TEXT;");
  await pgPool.query("ALTER TABLE document_chunks ADD COLUMN IF NOT EXISTS translated_text TEXT;");
  await pgPool.query("ALTER TABLE document_chunks ADD COLUMN IF NOT EXISTS translated_language TEXT;");
  await pgPool.query("ALTER TABLE document_chunks ADD COLUMN IF NOT EXISTS content_hash TEXT;");
  await pgPool.query("ALTER TABLE document_chunks ADD COLUMN IF NOT EXISTS keywords TEXT;");
  await pgPool.query("ALTER TABLE document_chunks ADD COLUMN IF NOT EXISTS embedding_json TEXT;");
  await pgPool.query("ALTER TABLE document_chunks ADD COLUMN IF NOT EXISTS embedding_model TEXT;");
  await pgPool.query("ALTER TABLE user_memories ADD COLUMN IF NOT EXISTS topics_json TEXT;");
  await pgPool.query("ALTER TABLE user_memories ADD COLUMN IF NOT EXISTS language TEXT;");
  await pgPool.query("ALTER TABLE semantic_cache ADD COLUMN IF NOT EXISTS response_language TEXT;");
  await pgPool.query("ALTER TABLE semantic_cache ADD COLUMN IF NOT EXISTS sources_json TEXT;");
  await pgPool.query("ALTER TABLE semantic_cache ADD COLUMN IF NOT EXISTS embedding_json TEXT;");
  await pgPool.query("ALTER TABLE semantic_cache ADD COLUMN IF NOT EXISTS knowledge_signature TEXT;");
  await pgPool.query("ALTER TABLE knowledge_sources ADD COLUMN IF NOT EXISTS mime_type TEXT;");
  await pgPool.query("ALTER TABLE knowledge_sources ADD COLUMN IF NOT EXISTS language TEXT;");
  await pgPool.query("ALTER TABLE knowledge_sources ADD COLUMN IF NOT EXISTS content_hash TEXT;");
  await pgPool.query("ALTER TABLE knowledge_sources ADD COLUMN IF NOT EXISTS department_name TEXT;");
  await pgPool.query("ALTER TABLE knowledge_sources ADD COLUMN IF NOT EXISTS source_kind TEXT NOT NULL DEFAULT 'manual_upload';");
  await pgPool.query("ALTER TABLE knowledge_sources ADD COLUMN IF NOT EXISTS sync_status TEXT NOT NULL DEFAULT 'local';");
  await pgPool.query("ALTER TABLE knowledge_sources ADD COLUMN IF NOT EXISTS processing_state_json TEXT;");
  await pgPool.query("ALTER TABLE knowledge_sources ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP;");
  await pgPool.query("ALTER TABLE semantic_cache ADD COLUMN IF NOT EXISTS hit_count INTEGER NOT NULL DEFAULT 0;");
  const postgresAuditTimestampTables = [
    "students",
    "student_guardians",
    "academic_programs",
    "school_terms",
    "classes",
    "class_schedules",
    "teacher_profiles",
    "class_teachers",
    "enrollments",
    "sales_records",
    "financial_contracts",
    "financial_installments",
    "class_sessions",
    "attendance_records",
  ];
  for (const tableName of postgresAuditTimestampTables) {
    await pgPool.query(`ALTER TABLE ${quoteIdent(tableName)} ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ`);
    await pgPool.query(`ALTER TABLE ${quoteIdent(tableName)} ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ`);
    await pgPool.query(`UPDATE ${quoteIdent(tableName)} SET created_at = COALESCE(created_at, updated_at, CURRENT_TIMESTAMP) WHERE created_at IS NULL`);
    await pgPool.query(`UPDATE ${quoteIdent(tableName)} SET updated_at = COALESCE(updated_at, created_at, CURRENT_TIMESTAMP) WHERE updated_at IS NULL`);
    await pgPool.query(`ALTER TABLE ${quoteIdent(tableName)} ALTER COLUMN created_at SET DEFAULT CURRENT_TIMESTAMP`);
    await pgPool.query(`ALTER TABLE ${quoteIdent(tableName)} ALTER COLUMN updated_at SET DEFAULT CURRENT_TIMESTAMP`);
  }
  const postgresChangedAtTables = [
    "enrollment_class_history",
    "enrollment_schedule_history",
    "student_transfers",
  ];
  for (const tableName of postgresChangedAtTables) {
    await pgPool.query(`ALTER TABLE ${quoteIdent(tableName)} ADD COLUMN IF NOT EXISTS changed_at TIMESTAMPTZ`);
    await pgPool.query(`UPDATE ${quoteIdent(tableName)} SET changed_at = COALESCE(changed_at, CURRENT_TIMESTAMP) WHERE changed_at IS NULL`);
    await pgPool.query(`ALTER TABLE ${quoteIdent(tableName)} ALTER COLUMN changed_at SET DEFAULT CURRENT_TIMESTAMP`);
  }
  await pgPool.query("ALTER TABLE students ADD COLUMN IF NOT EXISTS source_workbook TEXT;");
  await pgPool.query("ALTER TABLE student_guardians ADD COLUMN IF NOT EXISTS cpf TEXT;");
  await pgPool.query("ALTER TABLE classes ADD COLUMN IF NOT EXISTS class_kind TEXT NOT NULL DEFAULT 'regular';");
  await pgPool.query("ALTER TABLE classes ADD COLUMN IF NOT EXISTS source_workbook TEXT;");
  await pgPool.query("ALTER TABLE classes ADD COLUMN IF NOT EXISTS metadata_json TEXT;");
  await pgPool.query("ALTER TABLE classes ADD COLUMN IF NOT EXISTS whatsapp_group_id INTEGER;");
  await pgPool.query("ALTER TABLE enrollments ADD COLUMN IF NOT EXISTS source_workbook TEXT;");
  await pgPool.query("ALTER TABLE enrollments ADD COLUMN IF NOT EXISTS metadata_json TEXT;");
  await pgPool.query("ALTER TABLE enrollments ADD COLUMN IF NOT EXISTS learning_book TEXT;");
  await pgPool.query("ALTER TABLE enrollments ADD COLUMN IF NOT EXISTS grade_summary TEXT;");
  await pgPool.query("ALTER TABLE enrollments ADD COLUMN IF NOT EXISTS grade_notes TEXT;");
  await pgPool.query("ALTER TABLE enrollments ADD COLUMN IF NOT EXISTS whatsapp_group_id INTEGER;");
  await pgPool.query("ALTER TABLE financial_contracts ADD COLUMN IF NOT EXISTS payment_method_preference TEXT;");
  await pgPool.query("ALTER TABLE financial_contracts ADD COLUMN IF NOT EXISTS contract_pdf_file_name TEXT;");
  await pgPool.query("ALTER TABLE financial_contracts ADD COLUMN IF NOT EXISTS contract_pdf_generated_at TIMESTAMPTZ;");

  await pgPool.query(`
    CREATE TABLE IF NOT EXISTS knowledge_processing_logs (
      id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
      knowledge_source_id INTEGER,
      stage_key TEXT NOT NULL,
      stage_status TEXT NOT NULL,
      message TEXT,
      detail_json TEXT,
      actor_user_id INTEGER,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await pgPool.query(`
    CREATE TABLE IF NOT EXISTS memory_entries (
      id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
      user_id INTEGER NOT NULL,
      conversation_id INTEGER,
      knowledge_source_id INTEGER,
      memory_scope TEXT NOT NULL,
      memory_kind TEXT NOT NULL DEFAULT 'context',
      title TEXT,
      content_text TEXT NOT NULL,
      normalized_text TEXT,
      topics_json TEXT,
      language TEXT,
      source_message_ids_json TEXT,
      embedding_json TEXT,
      embedding_model TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  await pgPool.query("ALTER TABLE memory_entries ADD COLUMN IF NOT EXISTS knowledge_source_id INTEGER;");

  await pgPool.query(`
    CREATE TABLE IF NOT EXISTS ai_training_events (
      id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
      user_id INTEGER,
      conversation_id INTEGER,
      knowledge_source_id INTEGER,
      event_type TEXT NOT NULL,
      event_status TEXT NOT NULL DEFAULT 'info',
      title TEXT,
      detail_text TEXT,
      meta_json TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await pgPool.query("ALTER TABLE documents ADD COLUMN IF NOT EXISTS search_vector tsvector GENERATED ALWAYS AS (to_tsvector('simple', coalesce(rel_path, '') || ' ' || coalesce(extracted_text, '') || ' ' || coalesce(translated_text, '') || ' ' || coalesce(keywords, '') || ' ' || coalesce(language, ''))) STORED;");
  await pgPool.query("ALTER TABLE document_chunks ADD COLUMN IF NOT EXISTS search_vector tsvector GENERATED ALWAYS AS (to_tsvector('simple', coalesce(rel_path, '') || ' ' || coalesce(content_text, '') || ' ' || coalesce(translated_text, '') || ' ' || coalesce(keywords, '') || ' ' || coalesce(language, ''))) STORED;");

  await pgPool.query("CREATE INDEX IF NOT EXISTS idx_users_intranet_access ON users(can_access_intranet);");
  await pgPool.query("CREATE INDEX IF NOT EXISTS idx_departments_sort ON departments(sort_order, name);");
  await pgPool.query("CREATE INDEX IF NOT EXISTS idx_departments_active ON departments(is_active, sort_order, name);");
  await pgPool.query("CREATE INDEX IF NOT EXISTS idx_user_departments_user ON user_departments(user_id);");
  await pgPool.query("CREATE INDEX IF NOT EXISTS idx_user_departments_department ON user_departments(department_id);");
  await pgPool.query("CREATE INDEX IF NOT EXISTS idx_department_submenus_department ON department_submenus(department_id, is_active, sort_order, title);");
  await pgPool.query("CREATE INDEX IF NOT EXISTS idx_intranet_announcements_active ON intranet_announcements(is_active, is_pinned, created_at);");
  await pgPool.query("CREATE INDEX IF NOT EXISTS idx_messages_conv_created ON messages(conversation_id, created_at);");
  await pgPool.query("CREATE INDEX IF NOT EXISTS idx_conversations_user_updated ON conversations(user_id, updated_at);");
  await pgPool.query("CREATE INDEX IF NOT EXISTS idx_documents_modified ON documents(modified_ms);");
  await pgPool.query("CREATE INDEX IF NOT EXISTS idx_documents_language ON documents(language);");
  await pgPool.query("CREATE INDEX IF NOT EXISTS idx_documents_hash ON documents(content_hash);");
  await pgPool.query("CREATE INDEX IF NOT EXISTS idx_documents_department ON documents(department_name, updated_at);");
  await pgPool.query("CREATE INDEX IF NOT EXISTS idx_documents_search_vector ON documents USING GIN(search_vector);");
  await pgPool.query("CREATE INDEX IF NOT EXISTS idx_document_chunks_document_idx ON document_chunks(document_id, chunk_index);");
  await pgPool.query("CREATE INDEX IF NOT EXISTS idx_document_chunks_language ON document_chunks(language);");
  await pgPool.query("CREATE INDEX IF NOT EXISTS idx_document_chunks_department ON document_chunks(department_name, updated_at);");
  await pgPool.query("CREATE INDEX IF NOT EXISTS idx_document_chunks_search_vector ON document_chunks USING GIN(search_vector);");
  await pgPool.query("CREATE INDEX IF NOT EXISTS idx_knowledge_sources_created ON knowledge_sources(created_at);");
  await pgPool.query("CREATE INDEX IF NOT EXISTS idx_knowledge_sources_department ON knowledge_sources(department_name, created_at);");
  await pgPool.query("CREATE INDEX IF NOT EXISTS idx_knowledge_sources_updated ON knowledge_sources(updated_at);");
  await pgPool.query("CREATE INDEX IF NOT EXISTS idx_knowledge_processing_logs_source ON knowledge_processing_logs(knowledge_source_id, created_at);");
  await pgPool.query("CREATE INDEX IF NOT EXISTS idx_memory_entries_user_scope ON memory_entries(user_id, memory_scope, updated_at);");
  await pgPool.query("CREATE INDEX IF NOT EXISTS idx_memory_entries_conversation ON memory_entries(conversation_id, updated_at);");
  await pgPool.query("CREATE INDEX IF NOT EXISTS idx_memory_entries_knowledge_source ON memory_entries(knowledge_source_id, memory_scope, updated_at);");
  await pgPool.query("CREATE INDEX IF NOT EXISTS idx_ai_training_events_user_created ON ai_training_events(user_id, created_at);");
  await pgPool.query("CREATE INDEX IF NOT EXISTS idx_ai_training_events_source_created ON ai_training_events(knowledge_source_id, created_at);");
  await pgPool.query("CREATE INDEX IF NOT EXISTS idx_semantic_cache_scope_updated ON semantic_cache(scope_key, updated_at);");
  await pgPool.query("CREATE INDEX IF NOT EXISTS idx_closers_status ON closers(status, official_name);");
  await pgPool.query("CREATE INDEX IF NOT EXISTS idx_closers_user ON closers(user_id);");
  await pgPool.query("CREATE INDEX IF NOT EXISTS idx_closer_aliases_closer ON closer_aliases(closer_id);");
  await pgPool.query("CREATE INDEX IF NOT EXISTS idx_sales_import_runs_created ON sales_import_runs(created_at);");
  await pgPool.query("CREATE INDEX IF NOT EXISTS idx_sales_records_closer ON sales_records(closer_id, sale_date);");
  await pgPool.query("CREATE INDEX IF NOT EXISTS idx_sales_records_user ON sales_records(user_id, updated_at);");
  await pgPool.query("CREATE INDEX IF NOT EXISTS idx_sales_records_status ON sales_records(operational_status, updated_at);");
  await pgPool.query("CREATE INDEX IF NOT EXISTS idx_sales_records_workbook ON sales_records(source_workbook, source_sheet);");
  await pgPool.query("CREATE INDEX IF NOT EXISTS idx_sales_records_student ON sales_records(student_id, enrollment_id, financial_contract_id);");
  await pgPool.query("CREATE INDEX IF NOT EXISTS idx_sales_records_lead_stage ON sales_records(lead_stage, converted_at);");
  await pgPool.query("CREATE INDEX IF NOT EXISTS idx_sales_records_contact_email ON sales_records(contact_email);");
  await pgPool.query("CREATE INDEX IF NOT EXISTS idx_entity_change_log_entity ON entity_change_log(entity_type, entity_id, created_at);");
  await pgPool.query("CREATE INDEX IF NOT EXISTS idx_entity_change_log_actor ON entity_change_log(actor_user_id, created_at);");
  await pgPool.query("CREATE INDEX IF NOT EXISTS idx_calendar_event_types_active ON calendar_event_types(is_active, sort_order, name);");
  await pgPool.query("CREATE INDEX IF NOT EXISTS idx_calendar_events_start ON calendar_events(start_at, end_at);");
  await pgPool.query("CREATE INDEX IF NOT EXISTS idx_calendar_events_status ON calendar_events(status, start_at);");
  await pgPool.query("CREATE INDEX IF NOT EXISTS idx_calendar_events_creator ON calendar_events(created_by, updated_at);");
  await pgPool.query("CREATE INDEX IF NOT EXISTS idx_calendar_event_participants_event ON calendar_event_participants(event_id, user_id);");
  await pgPool.query("CREATE INDEX IF NOT EXISTS idx_calendar_event_participants_user ON calendar_event_participants(user_id, event_id);");
  await pgPool.query("CREATE INDEX IF NOT EXISTS idx_calendar_event_logs_event ON calendar_event_logs(event_id, created_at);");
  await pgPool.query("CREATE INDEX IF NOT EXISTS idx_calendar_event_logs_actor ON calendar_event_logs(actor_user_id, created_at);");
  await pgPool.query("CREATE INDEX IF NOT EXISTS idx_marketing_influencers_department ON marketing_influencers(department_id, influencer_status, name);");
  await pgPool.query("CREATE INDEX IF NOT EXISTS idx_marketing_influencers_status ON marketing_influencers(influencer_status, updated_at);");
  await pgPool.query("CREATE INDEX IF NOT EXISTS idx_marketing_influencer_metrics_influencer ON marketing_influencer_metrics(influencer_id, period_start, period_end);");
  await pgPool.query("CREATE INDEX IF NOT EXISTS idx_marketing_influencer_metrics_period ON marketing_influencer_metrics(period_type, period_start);");
  await pgPool.query("CREATE INDEX IF NOT EXISTS idx_marketing_indicator_tabs_department ON marketing_indicator_tabs(department_id, sort_order, title);");
  await pgPool.query("CREATE INDEX IF NOT EXISTS idx_marketing_indicator_tabs_kind ON marketing_indicator_tabs(indicator_kind, is_active, updated_at);");
  await pgPool.query("CREATE INDEX IF NOT EXISTS idx_marketing_indicator_rows_tab ON marketing_indicator_rows(tab_id, row_order, updated_at);");
  await pgPool.query("CREATE INDEX IF NOT EXISTS idx_marketing_indicator_rows_source ON marketing_indicator_rows(source_type, created_at);");
  await pgPool.query("CREATE INDEX IF NOT EXISTS idx_pedagogical_whatsapp_groups_department ON pedagogical_whatsapp_groups(department_id, status, name);");
  await pgPool.query("CREATE INDEX IF NOT EXISTS idx_pedagogical_whatsapp_groups_status ON pedagogical_whatsapp_groups(status, updated_at);");
  await pgPool.query("CREATE INDEX IF NOT EXISTS idx_pedagogical_whatsapp_campaigns_department ON pedagogical_whatsapp_campaigns(department_id, status, created_at);");
  await pgPool.query("CREATE INDEX IF NOT EXISTS idx_pedagogical_whatsapp_campaigns_execution ON pedagogical_whatsapp_campaigns(execution_mode, integration_status, updated_at);");
  await pgPool.query("CREATE INDEX IF NOT EXISTS idx_pedagogical_whatsapp_items_campaign ON pedagogical_whatsapp_campaign_items(campaign_id, queue_order, send_status);");
  await pgPool.query("CREATE INDEX IF NOT EXISTS idx_pedagogical_whatsapp_items_group ON pedagogical_whatsapp_campaign_items(group_id, send_status, updated_at);");
  await pgPool.query("CREATE INDEX IF NOT EXISTS idx_pedagogical_whatsapp_logs_campaign ON pedagogical_whatsapp_campaign_logs(campaign_id, created_at);");
  await pgPool.query("CREATE INDEX IF NOT EXISTS idx_students_name ON students(normalized_name, status, updated_at);");
  await pgPool.query("CREATE INDEX IF NOT EXISTS idx_students_phone ON students(phone, whatsapp);");
  await pgPool.query("CREATE INDEX IF NOT EXISTS idx_student_guardians_student ON student_guardians(student_id, financial_responsible, pedagogical_responsible);");
  await pgPool.query("CREATE INDEX IF NOT EXISTS idx_student_guardians_search ON student_guardians(student_id, cpf, phone, email, name);");
  await pgPool.query("CREATE INDEX IF NOT EXISTS idx_academic_programs_lookup ON academic_programs(language, modality, semester_label, level_name);");
  await pgPool.query("CREATE INDEX IF NOT EXISTS idx_school_terms_code ON school_terms(code, status);");
  await pgPool.query("CREATE INDEX IF NOT EXISTS idx_classes_term_program ON classes(school_term_id, academic_program_id, status);");
  await pgPool.query("CREATE INDEX IF NOT EXISTS idx_classes_source ON classes(source_sheet, source_block_ref);");
  await pgPool.query("CREATE INDEX IF NOT EXISTS idx_classes_kind ON classes(class_kind, modality, semester_label);");
  await pgPool.query("CREATE INDEX IF NOT EXISTS idx_class_schedules_class ON class_schedules(class_id, weekday, start_time);");
  await pgPool.query("CREATE INDEX IF NOT EXISTS idx_teacher_profiles_name ON teacher_profiles(normalized_name, active);");
  await pgPool.query("CREATE INDEX IF NOT EXISTS idx_teacher_profiles_user ON teacher_profiles(user_id, active);");
  await pgPool.query("CREATE INDEX IF NOT EXISTS idx_class_teachers_class ON class_teachers(class_id, is_active, role_in_class);");
  await pgPool.query("CREATE INDEX IF NOT EXISTS idx_class_teachers_user ON class_teachers(user_id, is_active, class_id);");
  await pgPool.query("CREATE INDEX IF NOT EXISTS idx_enrollments_student ON enrollments(student_id, enrollment_status, updated_at);");
  await pgPool.query("CREATE INDEX IF NOT EXISTS idx_enrollments_class ON enrollments(class_id, enrollment_status, updated_at);");
  await pgPool.query("CREATE INDEX IF NOT EXISTS idx_enrollments_term ON enrollments(school_term_id, academic_program_id, updated_at);");
  await pgPool.query("CREATE INDEX IF NOT EXISTS idx_enrollments_source ON enrollments(source_sheet, source_row_identifier);");
  await pgPool.query("CREATE INDEX IF NOT EXISTS idx_class_sessions_class_date ON class_sessions(class_id, class_date, session_status);");
  await pgPool.query("CREATE INDEX IF NOT EXISTS idx_class_sessions_schedule ON class_sessions(class_schedule_id, class_date);");
  await pgPool.query("CREATE INDEX IF NOT EXISTS idx_attendance_class_date ON attendance_records(class_id, class_date, attendance_status);");
  await pgPool.query("CREATE INDEX IF NOT EXISTS idx_attendance_enrollment_date ON attendance_records(enrollment_id, class_date, attendance_status);");
  await pgPool.query("CREATE INDEX IF NOT EXISTS idx_enrollment_class_history_enrollment ON enrollment_class_history(enrollment_id, changed_at);");
  await pgPool.query("CREATE INDEX IF NOT EXISTS idx_enrollment_schedule_history_enrollment ON enrollment_schedule_history(enrollment_id, changed_at);");
  await pgPool.query("CREATE INDEX IF NOT EXISTS idx_student_transfers_enrollment ON student_transfers(enrollment_id, changed_at);");
  await pgPool.query("CREATE INDEX IF NOT EXISTS idx_academic_import_runs_created ON academic_import_runs(created_at, status);");
  await pgPool.query("CREATE INDEX IF NOT EXISTS idx_academic_import_logs_run ON academic_import_logs(run_id, created_at);");
  await pgPool.query("CREATE INDEX IF NOT EXISTS idx_financial_contracts_student ON financial_contracts(student_id, contract_status, updated_at);");
  await pgPool.query("CREATE INDEX IF NOT EXISTS idx_financial_contracts_enrollment ON financial_contracts(enrollment_id, sales_record_id);");
  await pgPool.query("CREATE INDEX IF NOT EXISTS idx_financial_installments_due ON financial_installments(contract_id, due_date, status);");
  await pgPool.query("CREATE INDEX IF NOT EXISTS idx_financial_installments_status ON financial_installments(status, due_date);");
  await pgPool.query("CREATE INDEX IF NOT EXISTS idx_student_timeline_student ON student_timeline(student_id, created_at);");
  await pgPool.query("CREATE INDEX IF NOT EXISTS idx_student_timeline_enrollment ON student_timeline(enrollment_id, created_at);");
}
async function postgresHasData() {
  const tables = [
    "users",
    "conversations",
    "messages",
    "files",
    "documents",
    "knowledge_sources",
    "knowledge_processing_logs",
    "memory_entries",
    "ai_training_events",
    "audit_log",
    "conversation_memories",
    "calendar_events",
    "marketing_influencers",
    "marketing_influencer_metrics",
    "pedagogical_whatsapp_groups",
    "pedagogical_whatsapp_campaigns",
    "students",
    "enrollments",
    "classes",
    "teacher_profiles",
  ];

  for (const table of tables) {
    const result = await pgPool.query(`SELECT EXISTS (SELECT 1 FROM ${quoteIdent(table)} LIMIT 1) AS has_rows`);
    if (result.rows[0]?.has_rows) return true;
  }

  return false;
}

async function setPostgresSequence(client, table, column) {
  const maxResult = await client.query(`SELECT COALESCE(MAX(${quoteIdent(column)}), 0) AS max_id FROM ${quoteIdent(table)}`);
  const maxId = Number(maxResult.rows[0]?.max_id || 0);
  if (maxId <= 0) return;
  await client.query(`SELECT setval(pg_get_serial_sequence('${table}', '${column}'), $1, true)`, [maxId]);
}

async function importLegacySqliteIntoPostgres(options = {}) {
  const sourcePath = options?.sourcePath
    ? path.resolve(String(options.sourcePath || "").trim())
    : sqlitePath;
  const skipIfTargetHasData = options?.skipIfTargetHasData !== false;
  const withSummary = options?.withSummary === true;
  const summary = {
    imported: false,
    source_path: sourcePath,
    inserted: 0,
    skipped_rows: 0,
    failed_rows: 0,
    reason: "",
  };

  if (DB_CLIENT !== "postgres" || !pgPool) {
    summary.reason = "postgres_inactive";
    return withSummary ? summary : false;
  }
  if (String(process.env.SKIP_SQLITE_IMPORT || "").trim() === "1") {
    summary.reason = "sqlite_import_disabled";
    return withSummary ? summary : false;
  }
  if (!fs.existsSync(sourcePath)) {
    summary.reason = "sqlite_source_missing";
    return withSummary ? summary : false;
  }
  if (skipIfTargetHasData && await postgresHasData()) {
    summary.reason = "target_has_data";
    return withSummary ? summary : false;
  }

  let legacyDb;
  try {
    legacyDb = await openLegacySqlite(sourcePath);
    const tableRows = await sqliteAllFrom(
      legacyDb,
"SELECT name FROM sqlite_master WHERE type='table' AND name IN ('users','departments','user_departments','department_submenus','intranet_announcements','conversations','messages','files','audit_log','documents','document_chunks','conversation_memories','user_memories','knowledge_sources','knowledge_processing_logs','memory_entries','ai_training_events','semantic_cache','closers','closer_aliases','sales_import_sources','sales_import_runs','sales_records','entity_change_log','calendar_event_types','calendar_events','calendar_event_participants','calendar_event_logs','marketing_influencers','marketing_influencer_metrics','marketing_indicator_tabs','marketing_indicator_rows','pedagogical_whatsapp_groups','pedagogical_whatsapp_campaigns','pedagogical_whatsapp_campaign_items','pedagogical_whatsapp_campaign_logs','pedagogical_whatsapp_settings','students','student_guardians','academic_programs','school_terms','classes','class_schedules','teacher_profiles','class_teachers','enrollments','class_sessions','attendance_records','enrollment_class_history','enrollment_schedule_history','student_transfers','academic_import_runs','academic_import_logs','financial_contracts','financial_installments','student_timeline')"
    );

    if (!Array.isArray(tableRows) || !tableRows.length) {
      await closeSqlite(legacyDb);
      summary.reason = "sqlite_tables_missing";
      return withSummary ? summary : false;
    }

    const client = await pgPool.connect();
    try {
      await client.query("BEGIN");
      const migrationSummary = {
        inserted: 0,
        skipped: 0,
        failed: 0,
      };

      const tableOrder = [
        { name: "users", pk: "id", orderBy: "id" },
        { name: "departments", pk: "id", orderBy: "id" },
        { name: "user_departments", pk: "department_id", conflictColumns: ["user_id", "department_id"], orderBy: "department_id, user_id" },
        { name: "department_submenus", pk: "id", orderBy: "id" },
        { name: "intranet_announcements", pk: "id", orderBy: "id" },
        { name: "conversations", pk: "id", orderBy: "id" },
        { name: "messages", pk: "id", orderBy: "id" },
        { name: "files", pk: "id", orderBy: "id" },
        { name: "artifact_sessions", targetName: "artifact_sessions", pk: "id", orderBy: "id", transformRow: normalizeLegacyArtifactSessionRow },
        { name: "artifactsessions", targetName: "artifact_sessions", pk: "id", orderBy: "id", transformRow: normalizeLegacyArtifactSessionRow },
        { name: "audit_log", pk: "id", orderBy: "id" },
        { name: "documents", pk: "id", orderBy: "id" },
        { name: "document_chunks", pk: "id", orderBy: "id" },
        { name: "conversation_memories", pk: "conversation_id", orderBy: "conversation_id" },
        { name: "user_memories", pk: "user_id", orderBy: "user_id" },
        { name: "knowledge_sources", pk: "id", orderBy: "id" },
        { name: "knowledge_processing_logs", pk: "id", orderBy: "id" },
        { name: "memory_entries", pk: "id", orderBy: "id" },
        { name: "ai_training_events", pk: "id", orderBy: "id" },
        { name: "semantic_cache", pk: "id", orderBy: "id" },
        { name: "closers", pk: "id", orderBy: "id" },
        { name: "closer_aliases", pk: "id", orderBy: "id" },
        { name: "sales_import_sources", pk: "id", orderBy: "id" },
        { name: "sales_import_runs", pk: "id", orderBy: "id" },
        { name: "sales_records", pk: "id", orderBy: "id" },
        { name: "entity_change_log", pk: "id", orderBy: "id" },
        { name: "calendar_event_types", pk: "id", orderBy: "id" },
        { name: "calendar_events", pk: "id", orderBy: "id" },
        { name: "calendar_event_participants", pk: "id", orderBy: "id" },
        { name: "calendar_event_logs", pk: "id", orderBy: "id" },
        { name: "marketing_influencers", pk: "id", orderBy: "id" },
        { name: "marketing_influencer_metrics", pk: "id", orderBy: "id" },
        { name: "marketing_indicator_tabs", pk: "id", orderBy: "id" },
        { name: "marketing_indicator_rows", pk: "id", orderBy: "id" },
        { name: "pedagogical_whatsapp_groups", pk: "id", orderBy: "id" },
        { name: "pedagogical_whatsapp_campaigns", pk: "id", orderBy: "id" },
        { name: "pedagogical_whatsapp_campaign_items", pk: "id", orderBy: "id" },
        { name: "pedagogical_whatsapp_campaign_logs", pk: "id", orderBy: "id" },
        { name: "pedagogical_whatsapp_settings", pk: "id", orderBy: "id" },
        { name: "students", pk: "id", orderBy: "id" },
        { name: "student_guardians", pk: "id", orderBy: "id" },
        { name: "academic_programs", pk: "id", orderBy: "id" },
        { name: "school_terms", pk: "id", orderBy: "id" },
        { name: "classes", pk: "id", orderBy: "id" },
        { name: "class_schedules", pk: "id", orderBy: "id" },
        { name: "teacher_profiles", pk: "id", orderBy: "id" },
        { name: "class_teachers", pk: "id", orderBy: "id" },
        { name: "enrollments", pk: "id", orderBy: "id" },
        { name: "class_sessions", pk: "id", orderBy: "id" },
        { name: "attendance_records", pk: "id", orderBy: "id" },
        { name: "enrollment_class_history", pk: "id", orderBy: "id" },
{ name: "enrollment_schedule_history", pk: "id", orderBy: "id" },
{ name: "student_transfers", pk: "id", orderBy: "id" },
{ name: "academic_import_runs", pk: "id", orderBy: "id" },
{ name: "academic_import_logs", pk: "id", orderBy: "id" },
{ name: "financial_contracts", pk: "id", orderBy: "id" },
{ name: "financial_installments", pk: "id", orderBy: "id" },
{ name: "student_timeline", pk: "id", orderBy: "id" },
      ];

      const availableTables = new Set(tableRows.map((row) => row.name));

      for (const table of tableOrder) {
        const sourceTableName = table.sourceName || table.name;
        const targetTableName = table.targetName || sourceTableName;
        if (!availableTables.has(sourceTableName)) continue;
        let rows = [];
        try {
          rows = await sqliteAllFrom(legacyDb, `SELECT * FROM ${sourceTableName} ORDER BY ${table.orderBy}`);
        } catch (err) {
          console.error(`Falha ao ler tabela legada ${sourceTableName}:`, err?.message || err);
          continue;
        }

        for (const row of rows) {
          const rowId = row?.id ?? row?.[table.pk] ?? row?.conversation_id ?? null;
          const normalizedRow = typeof table.transformRow === "function"
            ? table.transformRow(row)
            : Object.fromEntries(Object.entries(row).map(([key, value]) => [key, sanitizeLegacySqliteValue(value)]));
          const entries = Object.entries(normalizedRow);
          if (!entries.length) continue;
          const columns = entries.map(([key]) => quoteIdent(key)).join(", ");
          const placeholders = entries.map((_, index) => `$${index + 1}`).join(", ");
          const values = entries.map(([, value]) => value);
          const conflictTarget = Array.isArray(table.conflictColumns) && table.conflictColumns.length
            ? table.conflictColumns.map((column) => quoteIdent(column)).join(", ")
            : quoteIdent(table.pk);

          try {
            await client.query("SAVEPOINT legacy_row_import");
            const insertResult = await client.query(
              `INSERT INTO ${quoteIdent(targetTableName)} (${columns}) VALUES (${placeholders}) ON CONFLICT (${conflictTarget}) DO NOTHING`,
              values
            );
            await client.query("RELEASE SAVEPOINT legacy_row_import");
            if (Number(insertResult?.rowCount || 0) > 0) {
              migrationSummary.inserted += 1;
            } else {
              migrationSummary.skipped += 1;
            }
          } catch (err) {
            migrationSummary.failed += 1;
            try {
              await client.query("ROLLBACK TO SAVEPOINT legacy_row_import");
            } catch {}
            console.error("Failed to migrate row", {
              table: targetTableName,
              row_id: rowId,
              message: err?.message || String(err || "migration_row_failed"),
              code: err?.code || null,
            });
          }
        }
      }

      await setPostgresSequence(client, "users", "id");
      await setPostgresSequence(client, "departments", "id");
      await setPostgresSequence(client, "department_submenus", "id");
      await setPostgresSequence(client, "intranet_announcements", "id");
      await setPostgresSequence(client, "conversations", "id");
      await setPostgresSequence(client, "messages", "id");
      await setPostgresSequence(client, "files", "id");
      await setPostgresSequence(client, "artifact_sessions", "id");
      await setPostgresSequence(client, "audit_log", "id");
      await setPostgresSequence(client, "documents", "id");
      await setPostgresSequence(client, "document_chunks", "id");
      await setPostgresSequence(client, "knowledge_sources", "id");
      await setPostgresSequence(client, "knowledge_processing_logs", "id");
      await setPostgresSequence(client, "memory_entries", "id");
      await setPostgresSequence(client, "ai_training_events", "id");
      await setPostgresSequence(client, "semantic_cache", "id");
      await setPostgresSequence(client, "closers", "id");
      await setPostgresSequence(client, "closer_aliases", "id");
      await setPostgresSequence(client, "sales_import_sources", "id");
      await setPostgresSequence(client, "sales_import_runs", "id");
      await setPostgresSequence(client, "sales_records", "id");
  await setPostgresSequence(client, "entity_change_log", "id");
  await setPostgresSequence(client, "marketing_influencers", "id");
  await setPostgresSequence(client, "marketing_influencer_metrics", "id");
  await setPostgresSequence(client, "marketing_indicator_tabs", "id");
      await setPostgresSequence(client, "marketing_indicator_rows", "id");
      await setPostgresSequence(client, "pedagogical_whatsapp_groups", "id");
      await setPostgresSequence(client, "pedagogical_whatsapp_campaigns", "id");
      await setPostgresSequence(client, "pedagogical_whatsapp_campaign_items", "id");
      await setPostgresSequence(client, "pedagogical_whatsapp_campaign_logs", "id");
      await setPostgresSequence(client, "pedagogical_whatsapp_settings", "id");
      await setPostgresSequence(client, "students", "id");
      await setPostgresSequence(client, "student_guardians", "id");
      await setPostgresSequence(client, "academic_programs", "id");
      await setPostgresSequence(client, "school_terms", "id");
      await setPostgresSequence(client, "classes", "id");
      await setPostgresSequence(client, "class_schedules", "id");
      await setPostgresSequence(client, "teacher_profiles", "id");
      await setPostgresSequence(client, "class_teachers", "id");
      await setPostgresSequence(client, "enrollments", "id");
      await setPostgresSequence(client, "class_sessions", "id");
      await setPostgresSequence(client, "attendance_records", "id");
      await setPostgresSequence(client, "enrollment_class_history", "id");
      await setPostgresSequence(client, "enrollment_schedule_history", "id");
      await setPostgresSequence(client, "student_transfers", "id");
      await setPostgresSequence(client, "academic_import_runs", "id");
      await setPostgresSequence(client, "academic_import_logs", "id");
      await setPostgresSequence(client, "financial_contracts", "id");
      await setPostgresSequence(client, "financial_installments", "id");
      await setPostgresSequence(client, "student_timeline", "id");

      await client.query("COMMIT");
      summary.imported = true;
      summary.inserted = migrationSummary.inserted;
      summary.skipped_rows = migrationSummary.skipped;
      summary.failed_rows = migrationSummary.failed;
      summary.reason = "imported";
      console.log("Resumo da migracao SQLite -> Postgres:", migrationSummary);
      console.log(`Migracao automatica SQLite -> Postgres concluida a partir de ${sourcePath}.`);
      return withSummary ? summary : true;
    } catch (err) {
      try {
        await client.query("ROLLBACK");
      } catch {}
      throw err;
    } finally {
      client.release();
      await closeSqlite(legacyDb);
    }
  } catch (err) {
    if (legacyDb) {
      try {
        await closeSqlite(legacyDb);
      } catch {}
    }
    console.log("Falha ao importar SQLite legado:", err?.message || err);
    summary.reason = err?.code || err?.message || "legacy_import_failed";
    return withSummary ? summary : false;
  }
}

async function migrate() {
  if (!migratePromise) {
    migratePromise = (async () => {
      if (DB_CLIENT === "postgres") {
        await migratePostgres();
      } else {
        await migrateSqlite();
      }
    })();
  }

  return migratePromise;
}

function inferLastId(row) {
  if (!row || typeof row !== "object") return 0;
  if (row.id != null) return Number(row.id) || 0;
  if (row.conversation_id != null) return Number(row.conversation_id) || 0;

  for (const value of Object.values(row)) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }

  return 0;
}

async function logEvent(userId, action, meta = {}) {
  try {
    return await run(
      "INSERT INTO audit_log (user_id, action, meta_json) VALUES (?, ?, ?)",
      [userId ?? null, action, safeJsonStringifyForPostgres(meta ?? {}, "{}")]
    );
  } catch (err) {
    databaseLogger.warn("Erro ao registrar audit_log.", {
      message: err?.message || String(err || "audit_log_failed"),
      code: err?.code || "",
    });
    return null;
  }
}

async function get(sql, params = []) {
  await migrate();

  if (DB_CLIENT === "postgres") {
    const result = await queryPostgres(sql, params);
    return result.rows[0] || undefined;
  }

  return getSqlite(sql, params);
}

async function all(sql, params = []) {
  await migrate();

  if (DB_CLIENT === "postgres") {
    const result = await queryPostgres(sql, params);
    return result.rows || [];
  }

  return allSqlite(sql, params);
}

async function run(sql, params = []) {
  await migrate();

  if (DB_CLIENT === "postgres") {
    let translated = toPostgresSql(sql);
    const trimmed = translated.trim().toLowerCase();

    if (trimmed.startsWith("insert ") && !/\breturning\b/i.test(translated)) {
      translated = `${translated} RETURNING *`;
    }

    const result = await queryPostgres(translated, params, { skipTranslate: true });
    return {
      lastID: trimmed.startsWith("insert ") ? inferLastId(result.rows[0]) : 0,
      changes: result.rowCount || 0,
    };
  }

  return execSqlite(sql, params);
}

async function getArtifactSessionById(sessionId) {
  if (!Number(sessionId || 0)) return null;
  const row = await get(
    `SELECT id, conversation_id, artifact_type, intent_mode, prompt, resolved_prompt, source_message_id,
            input_files_json, image_refs_json, status, created_at, updated_at
       FROM artifact_sessions
      WHERE id=?
      LIMIT 1`,
    [Number(sessionId)]
  );
  return parseArtifactSessionRow(row);
}

async function getLatestArtifactSession(conversationId) {
  if (!Number(conversationId || 0)) return null;
  const row = await get(
    `SELECT id, conversation_id, artifact_type, intent_mode, prompt, resolved_prompt, source_message_id,
            input_files_json, image_refs_json, status, created_at, updated_at
       FROM artifact_sessions
      WHERE conversation_id=?
      ORDER BY id DESC
      LIMIT 1`,
    [Number(conversationId)]
  );
  return parseArtifactSessionRow(row);
}

async function saveArtifactSession(payload = {}) {
  const normalized = normalizeArtifactSessionPayload(payload);
  if (!normalized.conversation_id || !normalized.artifact_type || !normalized.prompt) {
    throw new Error("artifact_session_invalid_payload");
  }

  const created = await run(
    `INSERT INTO artifact_sessions (
       conversation_id,
       artifact_type,
       intent_mode,
       prompt,
       resolved_prompt,
       source_message_id,
       input_files_json,
       image_refs_json,
       status,
       updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
    [
      normalized.conversation_id,
      normalized.artifact_type,
      normalized.intent_mode,
      normalized.prompt,
      normalized.resolved_prompt,
      normalized.source_message_id,
      normalized.input_files_json,
      normalized.image_refs_json,
      normalized.status,
    ]
  );

  const byId = await getArtifactSessionById(created.lastID);
  if (byId) return byId;
  return getLatestArtifactSession(normalized.conversation_id);
}

async function updateArtifactSessionStatus(sessionId, updates = {}) {
  const safeSessionId = Number(sessionId || 0);
  if (!safeSessionId) return null;

  const sets = [];
  const params = [];
  const normalized = {};

  if (updates.artifactType !== undefined) normalized.artifact_type = sanitizeText(updates.artifactType);
  if (updates.intentMode !== undefined) normalized.intent_mode = sanitizeText(updates.intentMode);
  if (updates.prompt !== undefined || updates.promptText !== undefined) {
    normalized.prompt = sanitizeText(updates.prompt ?? updates.promptText);
  }
  if (updates.resolvedPrompt !== undefined) normalized.resolved_prompt = sanitizeText(updates.resolvedPrompt);
  if (updates.sourceMessageId !== undefined) normalized.source_message_id = Number(updates.sourceMessageId || 0) || null;
  if (updates.inputFiles !== undefined) normalized.input_files_json = safeJsonStringifyForPostgres(Array.isArray(updates.inputFiles) ? updates.inputFiles : [], "[]");
  if (updates.imageRefs !== undefined) normalized.image_refs_json = safeJsonStringifyForPostgres(Array.isArray(updates.imageRefs) ? updates.imageRefs : [], "[]");
  if (updates.status !== undefined) normalized.status = normalizeArtifactSessionStatus(updates.status);

  Object.entries(normalized).forEach(([column, value]) => {
    sets.push(`${column}=?`);
    params.push(value);
  });

  sets.push("updated_at=datetime('now')");
  params.push(safeSessionId);

  await run(`UPDATE artifact_sessions SET ${sets.join(", ")} WHERE id=?`, params);
  return getArtifactSessionById(safeSessionId);
}

function buildSqliteFtsQuery(query) {
  const tokens = String(query || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]+/g, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2)
    .slice(0, 8);

  if (!tokens.length) return null;
  return tokens.map((token) => `${token}*`).join(" ");
}

async function searchDocuments(query, limit = 4, options = {}) {
  await migrate();
  const safeLimit = Math.max(1, Number(limit) || 4);
  const candidateLimit = Math.max(safeLimit * 6, 12);
  const searchText = String(query || "").trim();
  const userLanguage = String(options?.userLanguage || "").trim();
  if (!searchText) return [];

  if (DB_CLIENT === "postgres") {
    try {
      const result = await pgPool.query(
        `SELECT id, document_id, rel_path, content_text AS extracted_text, translated_text, translated_language, language, department_name, keywords, embedding_json,
                ts_rank(search_vector, plainto_tsquery('simple', $1)) +
                CASE WHEN COALESCE(language, '') = $2 THEN 0.35 ELSE 0 END AS score
           FROM document_chunks
          WHERE search_vector @@ plainto_tsquery('simple', $1)
          ORDER BY score DESC, updated_at DESC
          LIMIT $3`,
        [searchText, userLanguage, candidateLimit]
      );
      return result.rows || [];
    } catch (err) {
      const like = `%${searchText}%`;
      const fallback = await pgPool.query(
        `SELECT id, document_id, rel_path, content_text AS extracted_text, translated_text, translated_language, language, department_name, keywords, embedding_json,
                CASE
                  WHEN COALESCE(language, '') = $2 THEN 0.35
                  WHEN rel_path ILIKE $1 OR keywords ILIKE $1 THEN 0.2
                  ELSE 0
                END AS score
           FROM document_chunks
          WHERE rel_path ILIKE $1 OR content_text ILIKE $1 OR translated_text ILIKE $1 OR keywords ILIKE $1
          ORDER BY score DESC, updated_at DESC
          LIMIT $3`,
        [like, userLanguage, candidateLimit]
      );
      return fallback.rows || [];
    }
  }

  const ftsQuery = buildSqliteFtsQuery(searchText);
  if (ftsQuery) {
    try {
      return await allSqlite(
        `SELECT c.id, c.document_id, c.rel_path, c.content_text AS extracted_text, c.translated_text, c.translated_language, c.language, c.keywords, c.embedding_json,
                ((-1 * bm25(document_chunks_fts)) + CASE WHEN COALESCE(c.language, '') = ? THEN 0.35 ELSE 0 END) AS score
           FROM document_chunks_fts
           JOIN document_chunks c ON c.id = document_chunks_fts.rowid
          WHERE document_chunks_fts MATCH ?
          ORDER BY score DESC
          LIMIT ?`,
        [userLanguage, ftsQuery, candidateLimit]
      );
    } catch (err) {
      // fallback LIKE below
    }
  }

  const like = `%${searchText}%`;
  return allSqlite(
    `SELECT id, document_id, rel_path, content_text AS extracted_text, translated_text, translated_language, language, department_name, keywords, embedding_json,
            CASE
              WHEN COALESCE(language, '') = ? THEN 0.35
              WHEN rel_path LIKE ? OR keywords LIKE ? THEN 0.2
              ELSE 0
            END AS score
       FROM document_chunks
      WHERE rel_path LIKE ? OR content_text LIKE ? OR translated_text LIKE ? OR keywords LIKE ?
      ORDER BY score DESC, updated_at DESC
      LIMIT ?`,
    [userLanguage, like, like, like, like, like, like, candidateLimit]
  );
}

module.exports = {
  DATA_DIR,
  DB_CLIENT,
  DB_RUNTIME_CONFIG,
  DATABASE_URL_PRESENT,
  POSTGRES_HOST,
  REQUESTED_DB_CLIENT,
  all,
  db,
  ensureArtifactSessionsSchema,
  get,
  getLatestArtifactSession,
  importLegacySqliteIntoPostgres,
  kbDir,
  logEvent,
  migrate,
  parseArtifactSessionRow,
  run,
  saveArtifactSession,
  searchDocuments,
  sqlitePath,
  updateArtifactSessionStatus,
  uploadsDir,
};















