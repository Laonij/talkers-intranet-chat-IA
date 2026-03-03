const fs = require("fs");
const path = require("path");
const sqlite3 = require("sqlite3").verbose();

const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(__dirname, "data");

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const uploadsDir = path.join(DATA_DIR, "uploads");
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

const kbDir = path.join(DATA_DIR, "kb");
if (!fs.existsSync(kbDir)) fs.mkdirSync(kbDir, { recursive: true });

const dbPath = path.join(DATA_DIR, "app.db");
const db = new sqlite3.Database(dbPath);

function migrate() {
  db.serialize(() => {
    db.run("PRAGMA journal_mode = WAL;");

    db.run(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'user',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);

    db.run(`
      CREATE TABLE IF NOT EXISTS conversations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        title TEXT NOT NULL DEFAULT 'Nova conversa',
        mode TEXT NOT NULL DEFAULT 'geral',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);

    db.run(`
      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        conversation_id INTEGER NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        meta_json TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);

    db.run(`
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

    db.run(`
      CREATE TABLE IF NOT EXISTS audit_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        action TEXT NOT NULL,
        meta_json TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);

    db.run(`
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

    db.run(`
      CREATE VIRTUAL TABLE IF NOT EXISTS documents_fts
      USING fts5(extracted_text, rel_path, content='documents', content_rowid='id');
    `);

    db.run(`CREATE INDEX IF NOT EXISTS idx_messages_conv_created ON messages(conversation_id, created_at);`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_conversations_user_updated ON conversations(user_id, updated_at);`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_documents_modified ON documents(modified_ms);`);

    db.run(`
      CREATE TRIGGER IF NOT EXISTS documents_ai AFTER INSERT ON documents BEGIN
        INSERT INTO documents_fts(rowid, extracted_text, rel_path) VALUES (new.id, new.extracted_text, new.rel_path);
      END;
    `);
    db.run(`
      CREATE TRIGGER IF NOT EXISTS documents_ad AFTER DELETE ON documents BEGIN
        INSERT INTO documents_fts(documents_fts, rowid, extracted_text, rel_path) VALUES('delete', old.id, old.extracted_text, old.rel_path);
      END;
    `);
    db.run(`
      CREATE TRIGGER IF NOT EXISTS documents_au AFTER UPDATE ON documents BEGIN
        INSERT INTO documents_fts(documents_fts, rowid, extracted_text, rel_path) VALUES('delete', old.id, old.extracted_text, old.rel_path);
        INSERT INTO documents_fts(rowid, extracted_text, rel_path) VALUES (new.id, new.extracted_text, new.rel_path);
      END;
    `);
  });
}

function logEvent(userId, action, meta = {}) {
  db.run(
    "INSERT INTO audit_log (user_id, action, meta_json) VALUES (?, ?, ?)",
    [userId ?? null, action, JSON.stringify(meta ?? {})]
  );
}

function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row)));
  });
}

function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows)));
  });
}

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) return reject(err);
      resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

module.exports = { db, migrate, logEvent, get, all, run, uploadsDir, kbDir, DATA_DIR };
