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
      course_name TEXT,
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
      course_name TEXT,
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
      "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('users','departments','user_departments','department_submenus','intranet_announcements','conversations','messages','files','audit_log','documents','document_chunks','conversation_memories','user_memories','knowledge_sources','knowledge_processing_logs','memory_entries','ai_training_events','semantic_cache','closers','closer_aliases','sales_import_sources','sales_import_runs','sales_records','entity_change_log','calendar_event_types','calendar_events','calendar_event_participants','calendar_event_logs','marketing_influencers','marketing_influencer_metrics')"
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
        { name: "departments", pk: "id", orderBy: "id" },
        { name: "user_departments", pk: "department_id", conflictColumns: ["user_id", "department_id"], orderBy: "department_id, user_id" },
        { name: "department_submenus", pk: "id", orderBy: "id" },
        { name: "intranet_announcements", pk: "id", orderBy: "id" },
        { name: "conversations", pk: "id", orderBy: "id" },
        { name: "messages", pk: "id", orderBy: "id" },
        { name: "files", pk: "id", orderBy: "id" },
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
          const conflictTarget = Array.isArray(table.conflictColumns) && table.conflictColumns.length
            ? table.conflictColumns.map((column) => quoteIdent(column)).join(", ")
            : quoteIdent(table.pk);
          await client.query(
            `INSERT INTO ${quoteIdent(table.name)} (${columns}) VALUES (${placeholders}) ON CONFLICT (${conflictTarget}) DO NOTHING`,
            values
          );
        }
      }

      await setPostgresSequence(client, "users", "id");
      await setPostgresSequence(client, "departments", "id");
      await setPostgresSequence(client, "department_submenus", "id");
      await setPostgresSequence(client, "intranet_announcements", "id");
      await setPostgresSequence(client, "conversations", "id");
      await setPostgresSequence(client, "messages", "id");
      await setPostgresSequence(client, "files", "id");
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






























