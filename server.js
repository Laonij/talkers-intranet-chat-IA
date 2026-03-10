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
const ADMIN_NAME = String(process.env.ADMIN_NAME || "Admin").trim();
const ADMIN_PASSWORD = String(process.env.ADMIN_PASSWORD || "Talkers#2026!");

migrate();

fs.mkdirSync(uploadsDir, { recursive: true });
fs.mkdirSync(kbDir, { recursive: true });

async function ensureAdmin() {
  const existing = await get("SELECT id FROM users WHERE email=?", [ADMIN_EMAIL]);
  if (existing) return;

  const hash = await bcrypt.hash(ADMIN_PASSWORD, 10);

  const r = await run(
    "INSERT INTO users (email,name,password_hash,role) VALUES (?,?,?,'admin')",
    [ADMIN_EMAIL, ADMIN_NAME, hash]
  );

  console.log("Admin criado:", ADMIN_EMAIL);
  logEvent(r.lastID, "admin_bootstrap_created", { email: ADMIN_EMAIL });
}

const app = express();

app.use(express.json({ limit: "10mb" }));
app.use(cookieParser());

const upload = multer({
  dest: uploadsDir,
  limits: { fileSize: 25 * 1024 * 1024 },
});

function setSessionCookie(req, res, token) {
  res.cookie("session", token, {
    httpOnly: true,
    sameSite: "lax",
    secure: false,
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });
}

function titleFromMessage(text) {
  const t = (text || "").trim().split("\n")[0].slice(0, 60);
  return t || "Nova conversa";
}

app.get("/api/health", (req, res) => res.json({ ok: true }));

app.post("/api/login", async (req, res) => {
  const email = String(req.body?.email || "").trim().toLowerCase();
  const password = String(req.body?.password || "");

  const user = await get("SELECT * FROM users WHERE email=?", [email]);
  if (!user) return res.status(401).json({ error: "invalid_credentials" });

  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) return res.status(401).json({ error: "invalid_credentials" });

  const token = signSession(user, JWT_SECRET);
  setSessionCookie(req, res, token);

  logEvent(user.id, "login", { email });

  res.json({ ok: true });
});

app.post("/api/logout", requireAuth(JWT_SECRET), async (req, res) => {
  res.clearCookie("session");
  res.json({ ok: true });
});

app.get("/api/me", requireAuth(JWT_SECRET), async (req, res) => {
  res.json({ user: req.user });
});

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
        context += `\n\nDocumento: ${f.original_name}\n${text.slice(0, 5000)}`;
      }
    }

    return context;
  } catch (err) {
    console.log("Erro lendo arquivos", err);
    return "";
  }
}

async function openaiReply(userText, contextText) {
  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_MODEL || "gpt-4.1-mini";

  if (!apiKey) return "Configure OPENAI_API_KEY.";

  const prompt = `
Você é a TALKERS IA, assistente corporativa da empresa Talkers.

Responda sempre em português.

Use documentos internos e internet quando necessário.

CONTEXTO:
${contextText || "nenhum"}

PERGUNTA:
${userText}
`;

  const resp = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      input: prompt,
    }),
  });

  const data = await resp.json();

  if (data.output_text) return data.output_text;

  try {
    return data.output[0].content[0].text;
  } catch {
    return "Erro ao gerar resposta.";
  }
}

app.post("/api/conversations/:id/send", requireAuth(JWT_SECRET), async (req, res) => {
  const id = Number(req.params.id);
  const text = String(req.body?.message || "").trim();

  if (!text) return res.status(400).json({ error: "empty_message" });

  const conv = await get(
    "SELECT * FROM conversations WHERE id=? AND user_id=?",
    [id, req.user.sub]
  );

  if (!conv) return res.status(404).json({ error: "not_found" });

  if (conv.title === "Nova conversa") {
    await run(
      "UPDATE conversations SET title=? WHERE id=?",
      [titleFromMessage(text), id]
    );
  }

  await run(
    "INSERT INTO messages (conversation_id,role,content) VALUES (?, 'user', ?)",
    [id, text]
  );

  let webContext = "";
  try {
    webContext = await searchWeb(text);
  } catch {}

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
Analise os documentos enviados e responda a pergunta.

Pergunta do usuário:
${text}
`;
  }

  const reply = await openaiReply(finalQuestion, context);

  await run(
    "INSERT INTO messages (conversation_id,role,content) VALUES (?, 'assistant', ?)",
    [id, reply]
  );

  await run(
    "UPDATE conversations SET updated_at=datetime('now') WHERE id=?",
    [id]
  );

  res.json({ reply });
});

app.post(
  "/api/conversations/:id/files",
  requireAuth(JWT_SECRET),
  upload.single("file"),
  async (req, res) => {
    const id = Number(req.params.id);

    const f = req.file;
    if (!f) return res.status(400).json({ error: "missing_file" });

    const r = await run(
      "INSERT INTO files (conversation_id,uploaded_by,original_name,stored_name,mime_type,size_bytes) VALUES (?,?,?,?,?,?)",
      [
        id,
        req.user.sub,
        f.originalname,
        f.filename,
        f.mimetype || null,
        f.size || null,
      ]
    );

    res.json({ ok: true, file_id: r.lastID });
  }
);

const publicDir = path.join(__dirname, "public");

app.use(express.static(publicDir));

ensureAdmin().finally(() => {
  app.listen(PORT, () => {
    console.log(`Talkers IA rodando em ${BASE_URL}`);
  });
});
