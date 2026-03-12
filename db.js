const fs = require("fs");
const path = require("path");
const sqlite3 = require("sqlite3").verbose();
const { Pool } = require("pg");

const renderDiskCandidates = ["/var/data", "/data"];
const detectedRenderDiskDir = renderDiskCandidates.find((candidate) => fs.existsSync(candidate));
const defaultDataDir = detectedRenderDiskDir || path.join(__dirname, "data");

const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : defaultDataDir;

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const uploadsDir = path.join(DATA_DIR, "uploads");
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

const kbDir = path.join(DATA_DIR, "kb");
if (!fs.existsSync(kbDir)) fs.mkdirSync(kbDir, { recursive: true });

const DATABASE_URL = String(process.env.DATABASE_URL || "").trim();
const requestedDbClient = String(process.env.DB_CLIENT || "").trim().toLowerCase();
const DB_CLIENT = requestedDbClient === "sqlite"
  ? "sqlite"
  : requestedDbClient === "postgres"
    ? "postgres"
    : (DATABASE_URL ? "postgres" : "sqlite");

const sqlitePath = process.env.SQLITE_PATH
  ? path.resolve(process.env.SQLITE_PATH)
  : path.join(DATA_DIR, "app.db");

let sqliteDb = null;
let pgPool = null;
let migratePromise = null;

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
  });
}

const db = DB_CLIENT === "postgres" ? pgPool : sqliteDb;

function quoteIdent(value) {
  return `"${String(value || "").replace(/"/g, '""')}"`;
}

function normalizeSqlForPostgres(sql) {
  return String(sql || "")
    .replace(/datetime\('now'\)/gi, "CURRENT_TIMESTAMP")
    .replace(/datetime\(([^)]+)\)/gi, "$1");
}

function toPostgresSql(sql) {
  let index = 0;
  return normalizeSqlForPostgres(sql).replace(/\?/g, () => `$${++index}`);
}

function execSqlite(sql, params = []) {
  return new Promise((resolve, reject) => {
    sqliteDb.run(sql, params, function onRun(err) {
      if (err) return reject(err);
      resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

function getSqlite(sql, params = []) {
  return new Promise((resolve, reject) => {
    sqliteDb.get(sql, params, (err, row) => (err ? reject(err) : resolve(row)));
  });
}

function allSqlite(sql, params = []) {
  return new Promise((resolve, reject) => {
    sqliteDb.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows)));
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

async function migrateSqlite() {
  await execSqlite("PRAGMA journal_mode = WAL;");

  await execSqlite(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
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
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  await execSqlite(`
    CREATE TABLE IF NOT EXISTS conversation_memories (
      conversation_id INTEGER PRIMARY KEY,
      summary_text TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  await execSqlite(`
    CREATE TABLE IF NOT EXISTS knowledge_sources (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      original_name TEXT NOT NULL,
      stored_name TEXT NOT NULL,
      openai_file_id TEXT,
      vector_store_file_id TEXT,
      uploaded_by INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  await execSqlite(`
    CREATE VIRTUAL TABLE IF NOT EXISTS documents_fts
    USING fts5(extracted_text, rel_path, content='documents', content_rowid='id');
  `);

  await execSqlite("CREATE INDEX IF NOT EXISTS idx_messages_conv_created ON messages(conversation_id, created_at);");
  await execSqlite("CREATE INDEX IF NOT EXISTS idx_conversations_user_updated ON conversations(user_id, updated_at);");
  await execSqlite("CREATE INDEX IF NOT EXISTS idx_documents_modified ON documents(modified_ms);");
  await execSqlite("CREATE INDEX IF NOT EXISTS idx_knowledge_sources_created ON knowledge_sources(created_at);");

  await execSqlite(`
    CREATE TRIGGER IF NOT EXISTS documents_ai AFTER INSERT ON documents BEGIN
      INSERT INTO documents_fts(rowid, extracted_text, rel_path) VALUES (new.id, new.extracted_text, new.rel_path);
    END;
  `);
  await execSqlite(`
    CREATE TRIGGER IF NOT EXISTS documents_ad AFTER DELETE ON documents BEGIN
      INSERT INTO documents_fts(documents_fts, rowid, extracted_text, rel_path) VALUES('delete', old.id, old.extracted_text, old.rel_path);
    END;
  `);
  await execSqlite(`
    CREATE TRIGGER IF NOT EXISTS documents_au AFTER UPDATE ON documents BEGIN
      INSERT INTO documents_fts(documents_fts, rowid, extracted_text, rel_path) VALUES('delete', old.id, old.extracted_text, old.rel_path);
      INSERT INTO documents_fts(rowid, extracted_text, rel_path) VALUES (new.id, new.extracted_text, new.rel_path);
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
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
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
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
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
    CREATE TABLE IF NOT EXISTS knowledge_sources (
      id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
      original_name TEXT NOT NULL,
      stored_name TEXT NOT NULL,
      openai_file_id TEXT,
      vector_store_file_id TEXT,
      uploaded_by INTEGER,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await pgPool.query("ALTER TABLE documents ADD COLUMN IF NOT EXISTS search_vector tsvector GENERATED ALWAYS AS (to_tsvector('simple', coalesce(rel_path, '') || ' ' || coalesce(extracted_text, ''))) STORED;");
  await pgPool.query("CREATE INDEX IF NOT EXISTS idx_messages_conv_created ON messages(conversation_id, created_at);");
  await pgPool.query("CREATE INDEX IF NOT EXISTS idx_conversations_user_updated ON conversations(user_id, updated_at);");
  await pgPool.query("CREATE INDEX IF NOT EXISTS idx_documents_modified ON documents(modified_ms);");
  await pgPool.query("CREATE INDEX IF NOT EXISTS idx_knowledge_sources_created ON knowledge_sources(created_at);");
  await pgPool.query("CREATE INDEX IF NOT EXISTS idx_documents_search_vector ON documents USING GIN(search_vector);");
}

async function postgresHasData() {
  const tables = [
    "users",
    "conversations",
    "messages",
    "files",
    "documents",
    "knowledge_sources",
    "audit_log",
    "conversation_memories",
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

async function importLegacySqliteIntoPostgres() {
  if (String(process.env.SKIP_SQLITE_IMPORT || "").trim() === "1") return false;
  if (!fs.existsSync(sqlitePath)) return false;
  if (await postgresHasData()) return false;

  let legacyDb;
  try {
    legacyDb = await openLegacySqlite(sqlitePath);
    const tableRows = await sqliteAllFrom(
      legacyDb,
      "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('users','conversations','messages','files','audit_log','documents','conversation_memories','knowledge_sources')"
    );

    if (!Array.isArray(tableRows) || !tableRows.length) {
      await closeSqlite(legacyDb);
      return false;
    }

    const client = await pgPool.connect();
    try {
      await client.query("BEGIN");

      const tableOrder = [
        { name: "users", pk: "id", orderBy: "id" },
        { name: "conversations", pk: "id", orderBy: "id" },
        { name: "messages", pk: "id", orderBy: "id" },
        { name: "files", pk: "id", orderBy: "id" },
        { name: "audit_log", pk: "id", orderBy: "id" },
        { name: "documents", pk: "id", orderBy: "id" },
        { name: "conversation_memories", pk: "conversation_id", orderBy: "conversation_id" },
        { name: "knowledge_sources", pk: "id", orderBy: "id" },
      ];

      const availableTables = new Set(tableRows.map((row) => row.name));

      for (const table of tableOrder) {
        if (!availableTables.has(table.name)) continue;
        const rows = await sqliteAllFrom(legacyDb, `SELECT * FROM ${table.name} ORDER BY ${table.orderBy}`);
        for (const row of rows) {
          const entries = Object.entries(row);
          if (!entries.length) continue;
          const columns = entries.map(([key]) => quoteIdent(key)).join(", ");
          const placeholders = entries.map((_, index) => `$${index + 1}`).join(", ");
          const values = entries.map(([, value]) => value);
          await client.query(
            `INSERT INTO ${quoteIdent(table.name)} (${columns}) VALUES (${placeholders}) ON CONFLICT (${quoteIdent(table.pk)}) DO NOTHING`,
            values
          );
        }
      }

      await setPostgresSequence(client, "users", "id");
      await setPostgresSequence(client, "conversations", "id");
      await setPostgresSequence(client, "messages", "id");
      await setPostgresSequence(client, "files", "id");
      await setPostgresSequence(client, "audit_log", "id");
      await setPostgresSequence(client, "documents", "id");
      await setPostgresSequence(client, "knowledge_sources", "id");

      await client.query("COMMIT");
      console.log(`Migracao automatica SQLite -> Postgres concluida a partir de ${sqlitePath}.`);
      return true;
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
    throw err;
  }
}

async function migrate() {
  if (!migratePromise) {
    migratePromise = (async () => {
      if (DB_CLIENT === "postgres") {
        await migratePostgres();
        await importLegacySqliteIntoPostgres();
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
      [userId ?? null, action, JSON.stringify(meta ?? {})]
    );
  } catch (err) {
    console.log("Erro ao registrar audit_log:", err?.message || err);
    return null;
  }
}

async function get(sql, params = []) {
  await migrate();

  if (DB_CLIENT === "postgres") {
    const result = await pgPool.query(toPostgresSql(sql), params);
    return result.rows[0] || undefined;
  }

  return getSqlite(sql, params);
}

async function all(sql, params = []) {
  await migrate();

  if (DB_CLIENT === "postgres") {
    const result = await pgPool.query(toPostgresSql(sql), params);
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

    const result = await pgPool.query(translated, params);
    return {
      lastID: trimmed.startsWith("insert ") ? inferLastId(result.rows[0]) : 0,
      changes: result.rowCount || 0,
    };
  }

  return execSqlite(sql, params);
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

async function searchDocuments(query, limit = 4) {
  await migrate();
  const safeLimit = Math.max(1, Number(limit) || 4);
  const searchText = String(query || "").trim();
  if (!searchText) return [];

  if (DB_CLIENT === "postgres") {
    try {
      const result = await pgPool.query(
        `SELECT rel_path, extracted_text,
                ts_rank(search_vector, plainto_tsquery('simple', $1)) AS score
           FROM documents
          WHERE search_vector @@ plainto_tsquery('simple', $1)
          ORDER BY score DESC, updated_at DESC
          LIMIT $2`,
        [searchText, safeLimit]
      );
      return result.rows || [];
    } catch (err) {
      const like = `%${searchText}%`;
      const fallback = await pgPool.query(
        `SELECT rel_path, extracted_text
           FROM documents
          WHERE rel_path ILIKE $1 OR extracted_text ILIKE $1
          ORDER BY updated_at DESC
          LIMIT $2`,
        [like, safeLimit]
      );
      return fallback.rows || [];
    }
  }

  const ftsQuery = buildSqliteFtsQuery(searchText);
  if (!ftsQuery) return [];

  try {
    return await allSqlite(
      `SELECT d.rel_path, d.extracted_text, bm25(documents_fts) AS score
         FROM documents_fts
         JOIN documents d ON d.id = documents_fts.rowid
        WHERE documents_fts MATCH ?
        ORDER BY score
        LIMIT ?`,
      [ftsQuery, safeLimit]
    );
  } catch (err) {
    const like = `%${searchText}%`;
    return allSqlite(
      `SELECT rel_path, extracted_text
         FROM documents
        WHERE rel_path LIKE ? OR extracted_text LIKE ?
        ORDER BY updated_at DESC
        LIMIT ?`,
      [like, like, safeLimit]
    );
  }
}

module.exports = {
  DATA_DIR,
  DB_CLIENT,
  all,
  db,
  get,
  kbDir,
  logEvent,
  migrate,
  run,
  searchDocuments,
  sqlitePath,
  uploadsDir,
};
