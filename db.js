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
      department TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  const userColumns = await allSqlite("PRAGMA table_info(users)");
  if (!userColumns.some((column) => column.name === "department")) {
    await execSqlite("ALTER TABLE users ADD COLUMN department TEXT;");
  }

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
  if (!chunkColumns.some((column) => column.name === "translated_language")) {
    await execSqlite("ALTER TABLE document_chunks ADD COLUMN translated_language TEXT;");
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
      openai_file_id TEXT,
      vector_store_file_id TEXT,
      uploaded_by INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
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
    CREATE VIRTUAL TABLE IF NOT EXISTS documents_fts
    USING fts5(extracted_text, translated_text, rel_path, keywords, language, content='documents', content_rowid='id');
  `);

  await execSqlite(`
    CREATE VIRTUAL TABLE IF NOT EXISTS document_chunks_fts
    USING fts5(content_text, translated_text, rel_path, keywords, language, content='document_chunks', content_rowid='id');
  `);

  await execSqlite("CREATE INDEX IF NOT EXISTS idx_messages_conv_created ON messages(conversation_id, created_at);");
  await execSqlite("CREATE INDEX IF NOT EXISTS idx_conversations_user_updated ON conversations(user_id, updated_at);");
  await execSqlite("CREATE INDEX IF NOT EXISTS idx_documents_modified ON documents(modified_ms);");
  await execSqlite("CREATE INDEX IF NOT EXISTS idx_documents_language ON documents(language);");
  await execSqlite("CREATE INDEX IF NOT EXISTS idx_documents_hash ON documents(content_hash);");
  await execSqlite("CREATE INDEX IF NOT EXISTS idx_document_chunks_document_idx ON document_chunks(document_id, chunk_index);");
  await execSqlite("CREATE INDEX IF NOT EXISTS idx_document_chunks_language ON document_chunks(language);");
  await execSqlite("CREATE INDEX IF NOT EXISTS idx_knowledge_sources_created ON knowledge_sources(created_at);");
  await execSqlite("CREATE INDEX IF NOT EXISTS idx_semantic_cache_scope_updated ON semantic_cache(scope_key, updated_at);");

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

  await pgPool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS department TEXT;");
  await pgPool.query("ALTER TABLE documents ADD COLUMN IF NOT EXISTS language TEXT;");
  await pgPool.query("ALTER TABLE documents ADD COLUMN IF NOT EXISTS translated_text TEXT;");
  await pgPool.query("ALTER TABLE documents ADD COLUMN IF NOT EXISTS translated_language TEXT;");
  await pgPool.query("ALTER TABLE documents ADD COLUMN IF NOT EXISTS content_hash TEXT;");
  await pgPool.query("ALTER TABLE documents ADD COLUMN IF NOT EXISTS keywords TEXT;");
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
  await pgPool.query("ALTER TABLE semantic_cache ADD COLUMN IF NOT EXISTS hit_count INTEGER NOT NULL DEFAULT 0;");

  await pgPool.query("ALTER TABLE documents ADD COLUMN IF NOT EXISTS search_vector tsvector GENERATED ALWAYS AS (to_tsvector('simple', coalesce(rel_path, '') || ' ' || coalesce(extracted_text, '') || ' ' || coalesce(translated_text, '') || ' ' || coalesce(keywords, '') || ' ' || coalesce(language, ''))) STORED;");
  await pgPool.query("ALTER TABLE document_chunks ADD COLUMN IF NOT EXISTS search_vector tsvector GENERATED ALWAYS AS (to_tsvector('simple', coalesce(rel_path, '') || ' ' || coalesce(content_text, '') || ' ' || coalesce(translated_text, '') || ' ' || coalesce(keywords, '') || ' ' || coalesce(language, ''))) STORED;");

  await pgPool.query("CREATE INDEX IF NOT EXISTS idx_messages_conv_created ON messages(conversation_id, created_at);");
  await pgPool.query("CREATE INDEX IF NOT EXISTS idx_conversations_user_updated ON conversations(user_id, updated_at);");
  await pgPool.query("CREATE INDEX IF NOT EXISTS idx_documents_modified ON documents(modified_ms);");
  await pgPool.query("CREATE INDEX IF NOT EXISTS idx_documents_language ON documents(language);");
  await pgPool.query("CREATE INDEX IF NOT EXISTS idx_documents_hash ON documents(content_hash);");
  await pgPool.query("CREATE INDEX IF NOT EXISTS idx_documents_search_vector ON documents USING GIN(search_vector);");
  await pgPool.query("CREATE INDEX IF NOT EXISTS idx_document_chunks_document_idx ON document_chunks(document_id, chunk_index);");
  await pgPool.query("CREATE INDEX IF NOT EXISTS idx_document_chunks_language ON document_chunks(language);");
  await pgPool.query("CREATE INDEX IF NOT EXISTS idx_document_chunks_search_vector ON document_chunks USING GIN(search_vector);");
  await pgPool.query("CREATE INDEX IF NOT EXISTS idx_knowledge_sources_created ON knowledge_sources(created_at);");
  await pgPool.query("CREATE INDEX IF NOT EXISTS idx_semantic_cache_scope_updated ON semantic_cache(scope_key, updated_at);");
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
      "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('users','conversations','messages','files','audit_log','documents','document_chunks','conversation_memories','user_memories','knowledge_sources','semantic_cache')"
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
        { name: "document_chunks", pk: "id", orderBy: "id" },
        { name: "conversation_memories", pk: "conversation_id", orderBy: "conversation_id" },
        { name: "user_memories", pk: "user_id", orderBy: "user_id" },
        { name: "knowledge_sources", pk: "id", orderBy: "id" },
        { name: "semantic_cache", pk: "id", orderBy: "id" },
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
      await setPostgresSequence(client, "document_chunks", "id");
      await setPostgresSequence(client, "knowledge_sources", "id");
      await setPostgresSequence(client, "semantic_cache", "id");

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
        `SELECT id, document_id, rel_path, content_text AS extracted_text, translated_text, translated_language, language, keywords, embedding_json,
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
        `SELECT id, document_id, rel_path, content_text AS extracted_text, translated_text, translated_language, language, keywords, embedding_json,
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
    `SELECT id, document_id, rel_path, content_text AS extracted_text, translated_text, translated_language, language, keywords, embedding_json,
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













