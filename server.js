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

    await logEvent(r.lastID, "admin_bootstrap_created", { email: ADMIN_EMAIL });
  } catch (e) {
    console.log("Falha ao criar admin:", e?.message || e);
  }
}

function nowBrazil() {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    dateStyle: "full",
    timeStyle: "medium",
  }).format(new Date());
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

function extFromName(name = "") {
  return path.extname(String(name).toLowerCase());
}

function mimeLooksLikeImage(mime = "") {
  return String(mime || "").toLowerCase().startsWith("image/");
}

function fileToDataUrl(filePath, mimeType = "application/octet-stream") {
  const buf = fs.readFileSync(filePath);
  const b64 = buf.toString("base64");
  return `data:${mimeType};base64,${b64}`;
}

async function getConversationHistory(conversationId, limit = 10) {
  const rows = await all(
    `SELECT role, content
       FROM messages
      WHERE conversation_id=?
      ORDER BY id DESC
      LIMIT ?`,
    [conversationId, limit]
  );

  return rows.reverse().map((m) => ({
    role: m.role === "assistant" ? "assistant" : "user",
    content: String(m.content || "").trim(),
  }));
}

async function getConversationFilesContext(conversationId) {
  try {
    const files = await all(
      `SELECT id, original_name, stored_name, mime_type
         FROM files
        WHERE conversation_id=?
        ORDER BY id DESC
        LIMIT 4`,
      [conversationId]
    );

    let context = "";

    for (const f of files) {
      const filePath = path.join(uploadsDir, f.stored_name);
      let extracted = "";

      if (fs.existsSync(filePath)) {
        extracted = await extractText(filePath, f.original_name, f.mime_type);
      }

      if (extracted && extracted.trim()) {
        context += `\n\n[Documento enviado: ${f.original_name} | ${f.mime_type || "arquivo"}]\nTexto extraído:\n${extracted.slice(0, 9000)}\n`;
      } else if (mimeLooksLikeImage(f.mime_type)) {
        context += `\n\n[Imagem enviada: ${f.original_name} | ${f.mime_type}]\nA imagem foi anexada à conversa e pode ser analisada visualmente.\n`;
      } else {
        context += `\n\n[Documento enviado: ${f.original_name} | ${f.mime_type || "arquivo"}]\nO arquivo foi recebido e está anexado à conversa, mas não foi possível extrair texto automaticamente. Isso pode acontecer quando o PDF é imagem/escaneado ou quando o arquivo não contém texto legível por parser. Nesse caso, o próximo passo é adicionar OCR.\n`;
      }
    }

    return context;
  } catch (err) {
    console.log("Erro lendo arquivos da conversa:", err);
    return "";
  }
}

async function getRecentVisionInputs(conversationId, limit = 3) {
  try {
    const files = await all(
      `SELECT original_name, stored_name, mime_type
         FROM files
        WHERE conversation_id=?
        ORDER BY id DESC
        LIMIT ?`,
      [conversationId, limit]
    );

    const out = [];

    for (const f of files) {
      if (!mimeLooksLikeImage(f.mime_type)) continue;

      const filePath = path.join(uploadsDir, f.stored_name);
      if (!fs.existsSync(filePath)) continue;

      out.push({
        type: "input_image",
        image_url: fileToDataUrl(filePath, f.mime_type || "image/png"),
      });
    }

    return out;
  } catch (err) {
    console.log("Erro ao preparar imagens para visão:", err);
    return [];
  }
}

async function buildOpenAIInput({ conversationId, userText, contextText }) {
  const history = await getConversationHistory(conversationId, 10);
  const visionInputs = await getRecentVisionInputs(conversationId, 3);

  const historyText = history
    .map((m) => `${m.role === "assistant" ? "IA" : "Usuário"}: ${m.content}`)
    .filter(Boolean)
    .join("\n");

  const systemText = `
Você é a TALKERS IA, assistente corporativa da empresa Talkers.
Responda sempre em português do Brasil.
Seja educada, profissional, natural e objetiva.

Data e hora atual no Brasil:
${nowBrazil()}

Regras:
- Considere o histórico recente da conversa antes de responder.
- Entenda referências curtas como "seria isso", "esse", "aquele", "melhore", "resume", "faz daquele jeito".
- Se o usuário tiver enviado arquivo, nunca diga que ele não enviou.
- Se houver imagem enviada diretamente, analise visualmente a imagem.
- Se houver documento com texto extraído, use esse conteúdo para responder.
- Se o documento existir mas o texto não puder ser extraído, explique isso com clareza.
- Se o usuário perguntar a data de hoje, use a data atual acima.
- Se você não tiver base suficiente, peça complemento com educação, mas evite pedir de novo algo que já foi enviado.

Histórico recente:
${historyText || "Sem histórico anterior."}

Contexto adicional:
${contextText || "Sem contexto adicional."}
`.trim();

  const input = [
    {
      role: "system",
      content: [{ type: "input_text", text: systemText }],
    },
    {
      role: "user",
      content: [
        { type: "input_text", text: userText },
        ...visionInputs,
      ],
    },
  ];

  return input;
}

async function openaiReply({ conversationId, userText, contextText }) {
  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_MODEL || "gpt-4.1-mini";
  if (!apiKey) return "Configure OPENAI_API_KEY no Render.";

  const input = await buildOpenAIInput({ conversationId, userText, contextText });

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
    console.log("OpenAI error:", resp.status, t);
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

const app = express();
app.set("trust proxy", 1);
app.use(express.json({ limit: "20mb" }));
app.use(cookieParser());

const upload = multer({
  dest: uploadsDir,
  limits: { fileSize: 25 * 1024 * 1024 },
});

app.get("/api/health", (req, res) => res.json({ ok: true }));

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

  const rows = await all(
    "SELECT id, role, content, meta_json, created_at FROM messages WHERE conversation_id=? ORDER BY datetime(created_at) ASC, id ASC",
    [id]
  );

  const safeJson = (s) => {
    try { return JSON.parse(s); } catch { return null; }
  };

  res.json({
    conversation: conv,
    messages: rows.map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      created_at: m.created_at,
      meta: m.meta_json ? safeJson(m.meta_json) : null,
    })),
  });
});

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
    mimetype: f.mimetype || "",
    size: f.size || 0,
  };

  await run(
    "INSERT INTO messages (conversation_id, role, content, meta_json) VALUES (?, 'user', '', ?)",
    [id, JSON.stringify(meta)]
  );

  await run("UPDATE conversations SET updated_at=datetime('now') WHERE id=?", [id]);

  res.json({ ok: true, file_id: r.lastID });
});

app.post("/api/conversations/:id/upload", requireAuth(JWT_SECRET), upload.single("file"), async (req, res) => {
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
    mimetype: f.mimetype || "",
    size: f.size || 0,
  };

  await run(
    "INSERT INTO messages (conversation_id, role, content, meta_json) VALUES (?, 'user', '', ?)",
    [id, JSON.stringify(meta)]
  );

  await run("UPDATE conversations SET updated_at=datetime('now') WHERE id=?", [id]);

  res.json({ ok: true, file_id: r.lastID });
});

app.get("/api/files/:id/download", requireAuth(JWT_SECRET), async (req, res) => {
  const id = Number(req.params.id);

  const file = await get(
    `SELECT f.*, c.user_id AS owner_user_id
       FROM files f
       LEFT JOIN conversations c ON c.id = f.conversation_id
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
    console.log("Erro busca web:", e?.message || e);
  }

  const fileContext = await getConversationFilesContext(id);

  const context = `
Data atual no Brasil:
${nowBrazil()}

Documentos e imagens da conversa:
${fileContext || "Nenhum anexo recente."}

Contexto da internet:
${webContext || "Sem resultados externos relevantes."}
`;

  const reply = await openaiReply({
    conversationId: id,
    userText: text,
    contextText: context,
  });

  await run(
    "INSERT INTO messages (conversation_id, role, content) VALUES (?, 'assistant', ?)",
    [id, reply]
  );

  await run("UPDATE conversations SET updated_at=datetime('now') WHERE id=?", [id]);

  res.json({ reply });
});

app.get("/api/admin/users", requireAuth(JWT_SECRET), requireRole("admin"), async (req, res) => {
  const users = await all("SELECT id, name, email, role, created_at FROM users ORDER BY id DESC", []);
  res.json({ users });
});

app.post("/api/admin/users", requireAuth(JWT_SECRET), requireRole("admin"), async (req, res) => {
  const name = String(req.body?.name || "").trim();
  const email = String(req.body?.email || "").trim().toLowerCase();
  const password = String(req.body?.password || "");
  const role = req.body?.role === "admin" ? "admin" : "user";

  if (!name || !email || !password) {
    return res.status(400).json({ error: "missing_fields" });
  }

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

const publicDir = path.join(__dirname, "public");

app.get("/", (req, res) => res.redirect("/index.html"));

app.get("/login.html", (req, res) => res.sendFile(path.join(publicDir, "login.html")));

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

ensureAdmin().finally(() => {
  app.listen(PORT, () => {
    console.log(`Talkers IA rodando em ${BASE_URL}`);
    console.log(`Login: ${BASE_URL}/login.html`);
  });
});
