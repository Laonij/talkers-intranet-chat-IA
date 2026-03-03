require("dotenv").config();
const express = require("express");
const path = require("path");
const fs = require("fs");
const cookieParser = require("cookie-parser");
const bcrypt = require("bcryptjs");
const multer = require("multer");
const { spawn } = require("child_process");

const { migrate, get, all, run, uploadsDir, kbDir, logEvent } = require("./db");
const { signSession, requireAuth, requireRole } = require("./auth");

const PORT = Number(process.env.PORT || 8080);
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;
const JWT_SECRET = process.env.JWT_SECRET || "troque-por-um-segredo-grande";

migrate();

// AUTO SEED/INDEX (demo)
if (String(process.env.AUTO_SEED_ON_BOOT || "false").toLowerCase() === "true") {
  try {
    const p = spawn(process.execPath, ["scripts/seed.js"], { stdio: "inherit" });
    p.on("close", () => {});
  } catch {}
}
if (String(process.env.AUTO_INDEX_ON_BOOT || "false").toLowerCase() === "true") {
  try {
    const p = spawn(process.execPath, ["scripts/index_drive.js"], { stdio: "inherit" });
    p.on("close", () => {});
  } catch {}
}

async function openaiReply(userText, contextText) {
  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_MODEL || "gpt-4.1-mini";
  if (!apiKey) return null;

  const input = contextText
    ? `Responda em pt-BR usando SOMENTE o contexto. Se não der para responder, diga que não encontrou na base interna.\n\n## Contexto\n${contextText}\n\n## Pergunta\n${userText}`
    : userText;

  const resp = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model, input }),
  });

  if (!resp.ok) {
    const t = await resp.text();
    console.log("⚠️ OpenAI error:", resp.status, t);
    return null;
  }
  const data = await resp.json();
  if (data.output_text) return data.output_text;
  try {
    const out = (data.output || [])
      .map((o) => (o.content || []).map((c) => c.text || "").join(""))
      .join("\n");
    return out || null;
  } catch {
    return null;
  }
}

const app = express();
app.set("trust proxy", 1);
app.use(express.json({ limit: "10mb" }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, "public")));

// upload for conversation files and for KB (admin)
const upload = multer({ dest: uploadsDir, limits: { fileSize: 25 * 1024 * 1024 } });

function setSessionCookie(res, token) {
  res.cookie("session", token, { httpOnly: true, sameSite: "lax", secure: false, maxAge: 7 * 24 * 60 * 60 * 1000 });
}

function titleFromMessage(text) {
  const t = (text || "").trim().split("\n")[0].slice(0, 60);
  return t || "Nova conversa";
}

// AUTH
app.post("/api/login", async (req, res) => {
  const email = String(req.body?.email || "").trim().toLowerCase();
  const password = String(req.body?.password || "");
  if (!email || !password) return res.status(400).json({ error: "missing_email_or_password" });

  const user = await get("SELECT * FROM users WHERE email=?", [email]);
  if (!user) return res.status(401).json({ error: "invalid_credentials" });

  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) return res.status(401).json({ error: "invalid_credentials" });

  const token = signSession(user, JWT_SECRET);
  setSessionCookie(res, token);
  logEvent(user.id, "login", { email });
  res.json({ ok: true });
});

app.post("/api/logout", requireAuth(JWT_SECRET), async (req, res) => {
  res.clearCookie("session");
  logEvent(req.user.sub, "logout", {});
  res.json({ ok: true });
});

app.get("/api/me", requireAuth(JWT_SECRET), async (req, res) => res.json({ user: req.user }));

// CONVERSAS
app.get("/api/conversations", requireAuth(JWT_SECRET), async (req, res) => {
  const rows = await all(
    "SELECT id, title, mode, created_at, updated_at FROM conversations WHERE user_id=? ORDER BY datetime(updated_at) DESC",
    [req.user.sub]
  );
  res.json({ conversations: rows });
});

app.post("/api/conversations", requireAuth(JWT_SECRET), async (req, res) => {
  const title = String(req.body?.title || "Nova conversa").trim() || "Nova conversa";
  const mode = req.body?.mode === "empresa" ? "empresa" : "geral";
  const r = await run("INSERT INTO conversations (user_id, title, mode) VALUES (?, ?, ?)", [req.user.sub, title, mode]);
  res.json({ conversation_id: r.lastID });
});

app.patch("/api/conversations/:id", requireAuth(JWT_SECRET), async (req, res) => {
  const id = Number(req.params.id);
  const conv = await get("SELECT * FROM conversations WHERE id=? AND user_id=?", [id, req.user.sub]);
  if (!conv) return res.status(404).json({ error: "not_found" });

  const mode = req.body?.mode === "empresa" ? "empresa" : "geral";
  const title = req.body?.title ? String(req.body.title).trim() : conv.title;
  await run("UPDATE conversations SET title=?, mode=?, updated_at=datetime('now') WHERE id=?", [title || conv.title, mode, id]);
  res.json({ ok: true });
});

app.get("/api/conversations/:id/messages", requireAuth(JWT_SECRET), async (req, res) => {
  const id = Number(req.params.id);
  const conv = await get("SELECT * FROM conversations WHERE id=? AND user_id=?", [id, req.user.sub]);
  if (!conv) return res.status(404).json({ error: "not_found" });

  const messages = await all(
    "SELECT id, role, content, meta_json, created_at FROM messages WHERE conversation_id=? ORDER BY datetime(created_at) ASC",
    [id]
  );
  const files = await all(
    "SELECT id, original_name, size_bytes, created_at FROM files WHERE conversation_id=? ORDER BY datetime(created_at) DESC",
    [id]
  );

  res.json({ conversation: conv, messages, files });
});

// FILES (conversa)
app.post("/api/conversations/:id/upload", requireAuth(JWT_SECRET), upload.single("file"), async (req, res) => {
  const id = Number(req.params.id);
  const conv = await get("SELECT id FROM conversations WHERE id=? AND user_id=?", [id, req.user.sub]);
  if (!conv) return res.status(404).json({ error: "not_found" });

  const f = req.file;
  if (!f) return res.status(400).json({ error: "missing_file" });

  await run(
    "INSERT INTO files (conversation_id, uploaded_by, original_name, stored_name, mime_type, size_bytes) VALUES (?, ?, ?, ?, ?, ?)",
    [id, req.user.sub, f.originalname, f.filename, f.mimetype || null, f.size || null]
  );
  await run("UPDATE conversations SET updated_at=datetime('now') WHERE id=?", [id]);

  res.json({ ok: true });
});

app.get("/api/files/:id/download", requireAuth(JWT_SECRET), async (req, res) => {
  const id = Number(req.params.id);
  const file = await get(
    `SELECT f.*, c.user_id AS owner_user_id
     FROM files f LEFT JOIN conversations c ON c.id=f.conversation_id
     WHERE f.id=?`,
    [id]
  );
  if (!file) return res.status(404).send("not_found");
  if (file.owner_user_id && file.owner_user_id !== req.user.sub && req.user.role !== "admin") return res.status(403).send("forbidden");

  const full = path.join(uploadsDir, file.stored_name);
  if (!fs.existsSync(full)) return res.status(404).send("missing_on_disk");
  res.download(full, file.original_name);
});

// BUSCA INTERNA
async function searchInternal(query, limit = 8) {
  const q = String(query || "").trim();
  if (!q) return [];

  const terms = q.replace(/[^\p{L}\p{N}\s_-]+/gu, " ").split(/\s+/).filter(Boolean).slice(0, 10);
  if (!terms.length) return [];
  const ftsQuery = terms.map((t) => `"${t}"`).join(" AND ");

  const rows = await all(
    `SELECT d.id, d.rel_path, snippet(documents_fts, 0, '', '', ' … ', 12) AS snippet
     FROM documents_fts JOIN documents d ON d.id = documents_fts.rowid
     WHERE documents_fts MATCH ?
     ORDER BY bm25(documents_fts)
     LIMIT ?`,
    [ftsQuery, limit]
  );

  return rows.map((r) => ({ ref: String(r.id), title: r.rel_path, snippet: r.snippet || "" }));
}

app.get("/api/empresa/doc/:ref/download", requireAuth(JWT_SECRET), async (req, res) => {
  const ref = decodeURIComponent(req.params.ref || "");
  let doc = null;

  const asId = Number(ref);
  if (Number.isFinite(asId) && asId > 0) doc = await get("SELECT * FROM documents WHERE id=?", [asId]);
  if (!doc) doc = await get("SELECT * FROM documents WHERE rel_path=?", [ref]);
  if (!doc) return res.status(404).send("not_found");

  const full = doc.source_path;
  if (!fs.existsSync(full)) return res.status(404).send("missing_on_disk");
  res.download(full, path.basename(full));
});

// CHAT
app.post("/api/conversations/:id/send", requireAuth(JWT_SECRET), async (req, res) => {
  const id = Number(req.params.id);
  const text = String(req.body?.message || "").trim();
  if (!text) return res.status(400).json({ error: "empty_message" });

  const conv = await get("SELECT * FROM conversations WHERE id=? AND user_id=?", [id, req.user.sub]);
  if (!conv) return res.status(404).json({ error: "not_found" });

  if (conv.title === "Nova conversa") {
    await run("UPDATE conversations SET title=? WHERE id=?", [titleFromMessage(text), id]);
  }

  await run("INSERT INTO messages (conversation_id, role, content) VALUES (?, 'user', ?)", [id, text]);

  let reply = "";
  let meta = null;

  if (conv.mode === "empresa") {
    const sources = await searchInternal(text, 8);
    meta = { sources };

    if (!sources.length) {
      reply =
        "Não encontrei nada na base interna ainda.\n\n" +
        "• Confira INDEX_FOLDER\n" +
        "• Rode: npm run index\n" +
        "• (Opcional) Rode: npm run watch";
    } else {
      const context = sources.map((s, i) => `[#${i + 1}] ${s.title}\n${s.snippet}`).join("\n\n");
      const ai = await openaiReply(text, context);

      if (ai) {
        reply = ai + "\n\nFontes:\n" + sources.map((s, i) => `${i + 1}) ${s.title}`).join("\n");
      } else {
        reply =
          "Encontrei estes resultados na base interna:\n\n" +
          sources.map((s, i) => `${i + 1}) ${s.title}\n   ${s.snippet}`.trim()).join("\n\n") +
          "\n\n(Para responder com IA usando essas fontes, configure OPENAI_API_KEY no servidor.)";
      }
    }
  } else {
    const ai = await openaiReply(text, null);
    reply = ai ? ai : "[MODO GERAL - sem IA configurada]\n\nConfigure OPENAI_API_KEY para respostas com IA.";
  }

  await run(
    "INSERT INTO messages (conversation_id, role, content, meta_json) VALUES (?, 'assistant', ?, ?)",
    [id, reply, meta ? JSON.stringify(meta) : null]
  );
  await run("UPDATE conversations SET updated_at=datetime('now') WHERE id=?", [id]);

  res.json({ reply });
});

// ADMIN
app.get("/api/admin/users", requireAuth(JWT_SECRET), requireRole("admin"), async (req, res) => {
  const users = await all("SELECT id, name, email, role, created_at FROM users ORDER BY id DESC", []);
  res.json({ users });
});

app.post("/api/admin/users", requireAuth(JWT_SECRET), requireRole("admin"), async (req, res) => {
  const name = String(req.body?.name || "").trim();
  const email = String(req.body?.email || "").trim().toLowerCase();
  const password = String(req.body?.password || "");
  const role = req.body?.role === "admin" ? "admin" : "user";
  if (!name || !email || !password) return res.status(400).json({ error: "missing_fields" });

  const existing = await get("SELECT id FROM users WHERE email=?", [email]);
  if (existing) return res.status(409).json({ error: "email_already_exists" });

  const hash = await bcrypt.hash(password, 10);
  const r = await run("INSERT INTO users (email, name, password_hash, role) VALUES (?, ?, ?, ?)", [email, name, hash, role]);
  logEvent(req.user.sub, "admin_create_user", { user_id: r.lastID, email, role });
  res.json({ ok: true, user_id: r.lastID });
});

// Upload para KB (servidor)
app.post("/api/admin/kb/upload", requireAuth(JWT_SECRET), requireRole("admin"), upload.single("file"), async (req, res) => {
  const f = req.file;
  if (!f) return res.status(400).send("missing_file");
  const dest = path.join(kbDir, f.originalname);
  fs.renameSync(path.join(uploadsDir, f.filename), dest);
  logEvent(req.user.sub, "admin_kb_upload", { name: f.originalname, size: f.size });
  res.json({ ok: true });
});

// Sync Drive (service account)
app.post("/api/admin/sync-drive", requireAuth(JWT_SECRET), requireRole("admin"), async (req, res) => {
  try {
    const p = spawn(process.execPath, ["scripts/sync_drive.js"], { stdio: "inherit" });
    p.on("close", () => {});
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: "failed_to_spawn_sync" });
  }
});

// Reindex
app.post("/api/admin/reindex", requireAuth(JWT_SECRET), requireRole("admin"), async (req, res) => {
  try {
    const p = spawn(process.execPath, ["scripts/index_drive.js"], { stdio: "inherit" });
    p.on("close", () => {});
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: "failed_to_spawn_indexer" });
  }
});

app.listen(PORT, () => {
  console.log(`✅ Intranet Chat rodando em ${BASE_URL}`);
  console.log(`➡️ Login: ${BASE_URL}/login.html`);
});
