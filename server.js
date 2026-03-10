require("dotenv").config();

const express = require("express");
const path = require("path");
const fs = require("fs");
const cookieParser = require("cookie-parser");
const bcrypt = require("bcryptjs");
const multer = require("multer");
const { spawn } = require("child_process");
const jwt = require("jsonwebtoken");

const { migrate, get, all, run, uploadsDir, kbDir, logEvent } = require("./db");
const { signSession, requireAuth, requireRole } = require("./auth");
const { extractText } = require("./lib/extract");
const { searchWeb } = require("./lib/webSearch");

const PORT = Number(process.env.PORT || 10000);
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;
const JWT_SECRET = process.env.JWT_SECRET || "troque-por-um-segredo-grande";

const ADMIN_EMAIL = String(process.env.ADMIN_EMAIL || "admin@talkers.com").trim().toLowerCase();
const ADMIN_NAME = String(process.env.ADMIN_NAME || "Admin").trim() || "Admin";
const ADMIN_PASSWORD = String(process.env.ADMIN_PASSWORD || "Talkers#2026!");

migrate();
fs.mkdirSync(uploadsDir, { recursive: true });
fs.mkdirSync(kbDir, { recursive: true });

async function ensureAdmin() {
  try {
    const existing = await get("SELECT id, email FROM users WHERE email=?", [ADMIN_EMAIL]);
    if (existing) return;

    const hash = await bcrypt.hash(ADMIN_PASSWORD, 10);
    const r = await run(
      "INSERT INTO users (email, name, password_hash, role) VALUES (?, ?, ?, 'admin')",
      [ADMIN_EMAIL, ADMIN_NAME, hash]
    );

    console.log("✅ Admin criado:", ADMIN_EMAIL);
    await logEvent(r.lastID, "admin_bootstrap_created", { email: ADMIN_EMAIL });
  } catch (e) {
    console.log("⚠️ Falha ao criar admin:", e?.message || e);
  }
}

const app = express();
app.set("trust proxy", 1);
app.use(express.json({ limit: "20mb" }));
app.use(cookieParser());

const upload = multer({
  dest: uploadsDir,
  limits: { fileSize: 25 * 1024 * 1024 },
});

function isHttps(req) {
  const xfProto = String(req.headers["x-forwarded-proto"] || "");
  return req.secure || xfProto.includes("https");
}

function setSessionCookie(req, res, token) {
  res.cookie("session", token, {
    httpOnly: true,
    sameSite: "lax",
    secure: isHttps(req),
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });
}

function titleFromMessage(text) {
  const t = (text || "").trim().split("\n")[0].slice(0, 60);
  return t || "Nova conversa";
}

// ---------- OPENAI ----------
async function openaiReply(userText, contextText) {
  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_MODEL || "gpt-4.1-mini";
  if (!apiKey) return "Configure OPENAI_API_KEY no Render.";

  const input = contextText
    ? `Você é a TALKERS IA, assistente corporativa da empresa Talkers.\nResponda sempre em português do Brasil.\nUse o contexto abaixo se ele for relevante.\n\n### CONTEXTO\n${contextText}\n\n### PERGUNTA\n${userText}`
    : `Você é a TALKERS IA, assistente corporativa da empresa Talkers.\nResponda sempre em português do Brasil.\n\nPergunta: ${userText}`;

  const resp = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      input,
    }),
  });

  if (!resp.ok) {
    const t = await resp.text();
    console.log("⚠️ OpenAI error:", resp.status, t);
    return "Erro ao consultar a OpenAI.";
  }

  const data = await resp.json();
  if (data.output_text) return data.output_text;

  try {
    const out = (data.output || [])
      .map((o) => (o.content || []).map((c) => c.text || "").join(""))
      .join("\n");
    return out || "Sem resposta da OpenAI.";
  } catch {
    return "Erro ao processar resposta da OpenAI.";
  }
}

// ---------- HELPERS ----------
async function getConversationFilesContext(conversationId) {
  try {
    const files = await all(
      `SELECT original_name, stored_name
       FROM files
       WHERE conversation_id=?
       ORDER BY id DESC
       LIMIT 3`,
      [conversationId]
    );

    let context = "";

    for (const f of files) {
      const filePath = path.join(uploadsDir, f.stored_name);
      if (!fs.existsSync(filePath)) continue;

      const text = await extractText(filePath);
      if (text && text.trim()) {
        context += `\n\n[Documento: ${f.original_name}]\n${text.slice(0, 5000)}`;
      }
    }

    return context;
  } catch (err) {
    console.log("Erro lendo anexos:", err);
    return "";
  }
}

async function searchInternal(query, limit = 8) {
  const q = String(query || "").trim();
  if (!q) return [];

  const terms = q
    .replace(/[^\p{L}\p{N}\s_-]+/gu, " ")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 10);

  if (!terms.length) return [];

  const ftsQuery = terms.map((t) => `"${t}"`).join(" AND ");

  try {
    const rows = await all(
      `SELECT d.id, d.rel_path, snippet(documents_fts, 0, '', '', ' … ', 12) AS snippet
       FROM documents_fts JOIN documents d ON d.id = documents_fts.rowid
       WHERE documents_fts MATCH ?
       ORDER BY bm25(documents_fts)
       LIMIT ?`,
      [ftsQuery, limit]
    );

    return rows.map((r) => ({
      ref: String(r.id),
      title: r.rel_path,
      snippet: r.snippet || "",
    }));
  } catch {
    return [];
  }
}

function tryDecodeSession(req) {
  const token = req.cookies?.session;
  if (!token) return null;
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch {
    return null;
  }
}

// ---------- HEALTH ----------
app.get("/api/health", (req, res) => res.json({ ok: true }));

// ---------- AUTH ----------
app.post("/api/login", async (req, res) => {
  const email = String(req.body?.email || "").trim().toLowerCase();
  const password = String(req.body?.password || "");

  if (!email || !password) {
    return res.status(400).json({ error: "missing_email_or_password" });
  }

  const user = await get("SELECT * FROM users WHERE email=?", [email]);
  if (!user) return res.status(401).json({ error: "invalid_credentials" });

  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) return res.status(401).json({ error: "invalid_credentials" });

  const token = signSession(user, JWT_SECRET);
  setSessionCookie(req, res, token);

  await logEvent(user.id, "login", { email });
  res.json({ ok: true });
});

app.post("/api/logout", requireAuth(JWT_SECRET), async (req, res) => {
  res.clearCookie("session");
  await logEvent(req.user.sub, "logout", {});
  res.json({ ok: true });
});

app.get("/logout", (req, res) => {
  res.clearCookie("session");
  res.redirect("/login.html");
});

app.get("/api/me", requireAuth(JWT_SECRET), async (req, res) => {
  res.json({ user: req.user });
});

// ---------- CONVERSATIONS ----------
app.get("/api/conversations", requireAuth(JWT_SECRET), async (req, res) => {
  const rows = await all(
    "SELECT id, title, mode, created_at, updated_at FROM conversations WHERE user_id=? ORDER BY datetime(updated_at) DESC",
    [req.user.sub]
  );
  res.json({ conversations: rows });
});

app.post("/api/conversations", requireAuth(JWT_SECRET), async (req, res) => {
  const title = String(req.body?.title || "Nova conversa").trim() || "Nova conversa";
  const requested = req.body?.mode === "empresa" ? "empresa" : "geral";
  const mode = req.user.role === "admin" ? requested : "geral";

  const r = await run(
    "INSERT INTO conversations (user_id, title, mode) VALUES (?, ?, ?)",
    [req.user.sub, title, mode]
  );

  res.json({ conversation_id: r.lastID });
});

app.patch("/api/conversations/:id", requireAuth(JWT_SECRET), async (req, res) => {
  const id = Number(req.params.id);
  const conv = await get("SELECT * FROM conversations WHERE id=? AND user_id=?", [id, req.user.sub]);
  if (!conv) return res.status(404).json({ error: "not_found" });

  const requested = req.body?.mode === "empresa" ? "empresa" : "geral";
  const mode = req.user.role === "admin" ? requested : "geral";
  const title = req.body?.title ? String(req.body.title).trim() : conv.title;

  await run(
    "UPDATE conversations SET title=?, mode=?, updated_at=datetime('now') WHERE id=?",
    [title || conv.title, mode, id]
  );

  res.json({ ok: true });
});

app.delete("/api/conversations/:id", requireAuth(JWT_SECRET), async (req, res) => {
  const id = Number(req.params.id);
  const conv = await get("SELECT * FROM conversations WHERE id=? AND user_id=?", [id, req.user.sub]);
  if (!conv) return res.status(404).json({ error: "not_found" });

  const files = await all("SELECT stored_name FROM files WHERE conversation_id=?", [id]);
  for (const f of files) {
    try {
      const full = path.join(uploadsDir, f.stored_name);
      if (fs.existsSync(full)) fs.unlinkSync(full);
    } catch {}
  }

  await run("DELETE FROM messages WHERE conversation_id=?", [id]);
  await run("DELETE FROM files WHERE conversation_id=?", [id]);
  await run("DELETE FROM conversations WHERE id=? AND user_id=?", [id, req.user.sub]);

  await logEvent(req.user.sub, "delete_conversation", { conversation_id: id });
  res.json({ ok: true });
});

app.get("/api/conversations/:id/messages", requireAuth(JWT_SECRET), async (req, res) => {
  const id = Number(req.params.id);
  const conv = await get("SELECT * FROM conversations WHERE id=? AND user_id=?", [id, req.user.sub]);
  if (!conv) return res.status(404).json({ error: "not_found" });

  const messagesRaw = await all(
    "SELECT id, role, content, meta_json, created_at FROM messages WHERE conversation_id=? ORDER BY datetime(created_at) ASC",
    [id]
  );

  const safeJson = (s) => {
    try {
      return JSON.parse(s);
    } catch {
      return null;
    }
  };

  const messages = messagesRaw.map((m) => ({
    id: m.id,
    role: m.role,
    content: m.content,
    created_at: m.created_at,
    meta: m.meta_json ? safeJson(m.meta_json) : null,
  }));

  res.json({ conversation: conv, messages });
});

// ---------- FILES ----------
app.post("/api/conversations/:id/files", requireAuth(JWT_SECRET), upload.single("file"), async (req, res) => {
  const id = Number(req.params.id);
  const conv = await get("SELECT id FROM conversations WHERE id=? AND user_id=?", [id, req.user.sub]);
  if (!conv) return res.status(404).json({ error: "not_found" });

  const f = req.file;
  if (!f) return res.status(400).json({ error: "missing_file" });

  const r = await run(
    "INSERT INTO files (conversation_id, uploaded_by, original_name, stored_name, mime_type, size_bytes) VALUES (?, ?, ?, ?, ?, ?)",
    [id, req.user.sub, f.originalname, f.filename, f.mimetype || null, f.size || null]
  );

  const meta = {
    type: "file",
    file_id: r.lastID,
    filename: f.originalname,
    mimetype: f.mimetype || null,
    size: f.size || null,
  };

  await run(
    "INSERT INTO messages (conversation_id, role, content, meta_json) VALUES (?, ?, ?, ?)",
    [id, "user", "", JSON.stringify(meta)]
  );

  await run(
    "UPDATE conversations SET updated_at=datetime('now') WHERE id=?",
    [id]
  );

  res.json({ ok: true, file_id: r.lastID });
});

app.post("/api/conversations/:id/upload", requireAuth(JWT_SECRET), upload.single("file"), async (req, res) => {
  req.url = `/api/conversations/${req.params.id}/files`;
  const id = Number(req.params.id);
  const conv = await get("SELECT id FROM conversations WHERE id=? AND user_id=?", [id, req.user.sub]);
  if (!conv) return res.status(404).json({ error: "not_found" });

  const f = req.file;
  if (!f) return res.status(400).json({ error: "missing_file" });

  const r = await run(
    "INSERT INTO files (conversation_id, uploaded_by, original_name, stored_name, mime_type, size_bytes) VALUES (?, ?, ?, ?, ?, ?)",
    [id, req.user.sub, f.originalname, f.filename, f.mimetype || null, f.size || null]
  );

  const meta = {
    type: "file",
    file_id: r.lastID,
    filename: f.originalname,
    mimetype: f.mimetype || null,
    size: f.size || null,
  };

  await run(
    "INSERT INTO messages (conversation_id, role, content, meta_json) VALUES (?, ?, ?, ?)",
    [id, "user", "", JSON.stringify(meta)]
  );

  await run(
    "UPDATE conversations SET updated_at=datetime('now') WHERE id=?",
    [id]
  );

  res.json({ ok: true, file_id: r.lastID });
});

app.get("/api/files/:id/download", requireAuth(JWT_SECRET), async (req, res) => {
  const id = Number(req.params.id);

  const file = await get(
    `SELECT f.*, c.user_id AS owner_user_id
     FROM files f
     LEFT JOIN conversations c ON c.id=f.conversation_id
     WHERE f.id=?`,
    [id]
  );

  if (!file) return res.status(404).send("not_found");
  if (file.owner_user_id && file.owner_user_id !== req.user.sub && req.user.role !== "admin") {
    return res.status(403).send("forbidden");
  }

  const full = path.join(uploadsDir, file.stored_name);
  if (!fs.existsSync(full)) return res.status(404).send("missing_on_disk");

  res.download(full, file.original_name);
});

// ---------- CHAT ----------
app.post("/api/conversations/:id/send", requireAuth(JWT_SECRET), async (req, res) => {
  const id = Number(req.params.id);
  const text = String(req.body?.message || "").trim();

  if (!text) return res.status(400).json({ error: "empty_message" });

  const conv = await get("SELECT * FROM conversations WHERE id=? AND user_id=?", [id, req.user.sub]);
  if (!conv) return res.status(404).json({ error: "not_found" });

  if (conv.title === "Nova conversa") {
    await run("UPDATE conversations SET title=? WHERE id=?", [titleFromMessage(text), id]);
  }

  await run(
    "INSERT INTO messages (conversation_id, role, content) VALUES (?, 'user', ?)",
    [id, text]
  );

  let webContext = "";
  try {
    webContext = await searchWeb(text);
  } catch (e) {
    console.log("⚠️ erro web search:", e?.message || e);
  }

  const fileContext = await getConversationFilesContext(id);

  const context = `
DOCUMENTOS ENVIADOS:
${fileContext || "nenhum"}

INTERNET:
${webContext || "nenhum"}
`;

  let finalQuestion = text;

  if (fileContext) {
    finalQuestion = `
Analise os documentos enviados e responda a pergunta do usuário.

Pergunta do usuário:
${text}
`;
  }

  const reply = await openaiReply(finalQuestion, context);

  await run(
    "INSERT INTO messages (conversation_id, role, content) VALUES (?, 'assistant', ?)",
    [id, reply]
  );

  await run(
    "UPDATE conversations SET updated_at=datetime('now') WHERE id=?",
    [id]
  );

  res.json({ reply });
});

// ---------- ADMIN ----------
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
  const r = await run(
    "INSERT INTO users (email, name, password_hash, role) VALUES (?, ?, ?, ?)",
    [email, name, hash, role]
  );

  await logEvent(req.user.sub, "admin_create_user", { user_id: r.lastID, email, role });
  res.json({ ok: true, user_id: r.lastID });
});

app.delete("/api/admin/users/:id", requireAuth(JWT_SECRET), requireRole("admin"), async (req, res) => {
  const id = Number(req.params.id);

  if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: "invalid_id" });
  if (id === req.user.sub) return res.status(400).json({ error: "cannot_delete_self" });

  const user = await get("SELECT id, email FROM users WHERE id=?", [id]);
  if (!user) return res.status(404).json({ error: "not_found" });
  if (String(user.email).toLowerCase() === ADMIN_EMAIL) {
    return res.status(400).json({ error: "cannot_delete_main_admin" });
  }

  await run("DELETE FROM messages WHERE conversation_id IN (SELECT id FROM conversations WHERE user_id=?)", [id]);
  await run("DELETE FROM files WHERE conversation_id IN (SELECT id FROM conversations WHERE user_id=?)", [id]);
  await run("DELETE FROM conversations WHERE user_id=?", [id]);
  await run("DELETE FROM users WHERE id=?", [id]);

  await logEvent(req.user.sub, "admin_delete_user", { user_id: id, email: user.email });
  res.json({ ok: true });
});

// ---------- KB / DRIVE ----------
app.post("/api/admin/kb/upload", requireAuth(JWT_SECRET), requireRole("admin"), upload.single("file"), async (req, res) => {
  const f = req.file;
  if (!f) return res.status(400).send("missing_file");

  const dest = path.join(kbDir, f.originalname);
  fs.renameSync(path.join(uploadsDir, f.filename), dest);

  await logEvent(req.user.sub, "admin_kb_upload", { name: f.originalname, size: f.size });
  res.json({ ok: true });
});

app.post("/api/admin/sync-drive", requireAuth(JWT_SECRET), requireRole("admin"), async (req, res) => {
  try {
    const p = spawn(process.execPath, ["scripts/sync_drive.js"], { stdio: "inherit" });
    p.on("close", () => {});
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: "failed_to_spawn_sync" });
  }
});

app.post("/api/admin/reindex", requireAuth(JWT_SECRET), requireRole("admin"), async (req, res) => {
  try {
    const p = spawn(process.execPath, ["scripts/index_drive.js"], { stdio: "inherit" });
    p.on("close", () => {});
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: "failed_to_spawn_indexer" });
  }
});

// ---------- PAGES ----------
const publicDir = path.join(__dirname, "public");

app.get("/", (req, res) => res.redirect("/index.html"));

app.get("/login.html", (req, res) => {
  res.sendFile(path.join(publicDir, "login.html"));
});

app.get("/index.html", (req, res) => {
  const user = tryDecodeSession(req);
  if (!user) return res.redirect("/login.html");
  return res.sendFile(path.join(publicDir, "index.html"));
});

app.get("/admin.html", (req, res) => {
  const user = tryDecodeSession(req);
  if (!user) return res.redirect("/login.html");
  if (user.role !== "admin") return res.redirect("/index.html");
  return res.sendFile(path.join(publicDir, "admin.html"));
});

app.use(express.static(publicDir));

// ---------- START ----------
ensureAdmin().finally(() => {
  app.listen(PORT, () => {
    console.log(`✅ Talkers IA rodando em ${BASE_URL}`);
    console.log(`➡️ Login: ${BASE_URL}/login.html`);
  });
});
