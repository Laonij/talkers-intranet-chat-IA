require("dotenv").config();

const express = require("express");
const path = require("path");
const fs = require("fs");
const cookieParser = require("cookie-parser");
const bcrypt = require("bcryptjs");
const multer = require("multer");
const jwt = require("jsonwebtoken");

const { DATA_DIR, DB_CLIENT, migrate, get, all, run, uploadsDir, kbDir, logEvent, searchDocuments } = require("./db");
const { signSession, requireAuth, requireRole } = require("./auth");
const { detectExt, extractText } = require("./lib/extract");
const { generateArtifact } = require("./lib/generate");
const { ocrImage } = require("./lib/ocr");
const { isAudioFile, transcribeAudio } = require("./lib/audio");
const {
  attachFileToVectorStore,
  buildOpenAIInputFilePart,
  isSupportedOpenAIInputFile,
  uploadFileToOpenAI,
} = require("./lib/rag");
const { searchWeb } = require("./lib/webSearch");

const PORT = Number(process.env.PORT || 10000);
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;
const NODE_ENV = String(process.env.NODE_ENV || "development").trim().toLowerCase();
const IS_PRODUCTION = NODE_ENV === "production";
const DEFAULT_JWT_SECRET = "troque-por-um-segredo-grande";
const DEFAULT_ADMIN_EMAIL = "admin@talkers.com";
const DEFAULT_ADMIN_NAME = "Admin";
const DEFAULT_ADMIN_PASSWORD = "Talkers#2026!";
const INLINE_OPENAI_FILE_LIMIT = 10 * 1024 * 1024;
const MAX_CONVERSATION_MEMORY = 6000;
const OPENAI_VECTOR_STORE_ID = String(process.env.OPENAI_VECTOR_STORE_ID || "").trim();

const JWT_SECRET =
  String(process.env.JWT_SECRET || "").trim() || (IS_PRODUCTION ? "" : DEFAULT_JWT_SECRET);
const ADMIN_EMAIL = String(process.env.ADMIN_EMAIL || DEFAULT_ADMIN_EMAIL).trim().toLowerCase();
const ADMIN_NAME = String(process.env.ADMIN_NAME || DEFAULT_ADMIN_NAME).trim() || DEFAULT_ADMIN_NAME;
const ADMIN_PASSWORD = String(process.env.ADMIN_PASSWORD || (IS_PRODUCTION ? "" : DEFAULT_ADMIN_PASSWORD));

const knowledgeDir = path.join(kbDir, "manual");

validateConfig();
fs.mkdirSync(uploadsDir, { recursive: true });
fs.mkdirSync(kbDir, { recursive: true });
fs.mkdirSync(knowledgeDir, { recursive: true });
logEnvironmentWarnings();

function logEnvironmentWarnings() {
  if (IS_PRODUCTION && DB_CLIENT === "sqlite" && process.env.DATABASE_URL) {
    console.log(`Aviso: DATABASE_URL esta configurado, mas DB_CLIENT esta em SQLite usando ${DATA_DIR}.`);
  }

  if (IS_PRODUCTION && DB_CLIENT === "postgres") {
    console.log("Banco configurado: Postgres.");
  }

  if (IS_PRODUCTION && !String(process.env.DATA_DIR || "").trim()) {
    console.log(`Aviso: DATA_DIR nao foi definido no ambiente. O servidor vai usar ${DATA_DIR}.`);
  }
}

function validateConfig() {
  if (!JWT_SECRET) {
    throw new Error("Configure JWT_SECRET antes de iniciar o servidor.");
  }

  if (IS_PRODUCTION && JWT_SECRET === DEFAULT_JWT_SECRET) {
    throw new Error("JWT_SECRET padrao nao pode ser usado em producao.");
  }
}

function getAdminBootstrapBlocker() {
  if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
    return "Credenciais do admin inicial nao foram configuradas.";
  }

  if (!IS_PRODUCTION) return null;

  const hasExplicitBootstrapConfig = Boolean(
    String(process.env.ADMIN_EMAIL || "").trim() ||
    String(process.env.ADMIN_NAME || "").trim() ||
    String(process.env.ADMIN_PASSWORD || "").trim()
  );

  if (!hasExplicitBootstrapConfig) {
    return "Bootstrap automatico de admin desativado em producao sem credenciais explicitas.";
  }

  if (ADMIN_PASSWORD === DEFAULT_ADMIN_PASSWORD) {
    return "Defina ADMIN_PASSWORD forte para criar o admin inicial em producao.";
  }

  return null;
}

async function ensureAdmin() {
  try {
    const blocker = getAdminBootstrapBlocker();
    if (blocker) {
      console.log(blocker);
      return;
    }

    const existing = await get("SELECT id FROM users WHERE email=?", [ADMIN_EMAIL]);
    if (existing) return;

    const hash = await bcrypt.hash(ADMIN_PASSWORD, 10);
    const created = await run(
      "INSERT INTO users (email, name, password_hash, role) VALUES (?, ?, ?, 'admin')",
      [ADMIN_EMAIL, ADMIN_NAME, hash]
    );

    await logEvent(created.lastID, "admin_bootstrap_created", { email: ADMIN_EMAIL });
  } catch (err) {
    console.log("Falha ao criar admin:", err?.message || err);
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

function clearSessionCookie(req, res) {
  res.clearCookie("session", {
    httpOnly: true,
    sameSite: "lax",
    secure: isHttps(req),
  });
}

function titleFromMessage(text) {
  const title = String(text || "").trim().split("\n")[0].slice(0, 60);
  return title || "Nova conversa";
}

function sanitizeFilename(filename = "arquivo") {
  return String(filename || "arquivo").replace(/[\\/:*?"<>|]+/g, "_");
}

function mimeLooksLikeImage(mime = "") {
  return String(mime || "").toLowerCase().startsWith("image/");
}

function safeJsonParse(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function compactMemory(text, maxChars = MAX_CONVERSATION_MEMORY) {
  const value = String(text || "").trim();
  if (value.length <= maxChars) return value;
  return value.slice(value.length - maxChars);
}

async function deleteStoredFiles(storedNames = [], baseDir = uploadsDir) {
  const uniqueNames = [...new Set((storedNames || []).filter(Boolean))];

  for (const storedName of uniqueNames) {
    try {
      const fullPath = path.join(baseDir, storedName);
      if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
    } catch (err) {
      console.log("Erro ao remover arquivo do disco:", storedName, err?.message || err);
    }
  }
}

async function createFileMessage({
  conversationId,
  uploadedBy,
  originalName,
  storedName,
  mimeType,
  sizeBytes,
  role,
  content,
}) {
  const fileResult = await run(
    "INSERT INTO files (conversation_id, uploaded_by, original_name, stored_name, mime_type, size_bytes) VALUES (?, ?, ?, ?, ?, ?)",
    [conversationId, uploadedBy, originalName, storedName, mimeType || null, sizeBytes || null]
  );

  const meta = {
    type: "file",
    file_id: fileResult.lastID,
    filename: originalName,
    mimetype: mimeType || "",
    size: sizeBytes || 0,
  };

  await run(
    "INSERT INTO messages (conversation_id, role, content, meta_json) VALUES (?, ?, ?, ?)",
    [conversationId, role, content || "", JSON.stringify(meta)]
  );

  await run("UPDATE conversations SET updated_at=datetime('now') WHERE id=?", [conversationId]);
  return { fileId: fileResult.lastID, meta };
}

async function handleConversationUpload(req, res) {
  const id = Number(req.params.id);
  const conv = await get("SELECT id FROM conversations WHERE id=? AND user_id=?", [id, req.user.sub]);
  if (!conv) return res.status(404).json({ error: "not_found" });

  const uploaded = req.file;
  if (!uploaded) return res.status(400).json({ error: "missing_file" });

  const saved = await createFileMessage({
    conversationId: id,
    uploadedBy: req.user.sub,
    originalName: uploaded.originalname,
    storedName: uploaded.filename,
    mimeType: uploaded.mimetype || "",
    sizeBytes: uploaded.size || 0,
    role: "user",
    content: "",
  });

  return res.json({ ok: true, file_id: saved.fileId });
}

async function getConversationHistory(conversationId, limit = 14) {
  const rows = await all(
    `SELECT role, content
       FROM messages
      WHERE conversation_id=?
      ORDER BY id DESC
      LIMIT ?`,
    [conversationId, limit]
  );

  return rows.reverse().map((row) => ({
    role: row.role === "assistant" ? "assistant" : "user",
    content: String(row.content || "").trim(),
  }));
}

async function getConversationMemory(conversationId) {
  const row = await get(
    "SELECT summary_text FROM conversation_memories WHERE conversation_id=?",
    [conversationId]
  );
  return String(row?.summary_text || "").trim();
}

async function updateConversationMemory(conversationId, userText, assistantText) {
  const previous = await getConversationMemory(conversationId);
  const entry = [
    `Usuario: ${String(userText || "").trim()}`,
    `IA: ${String(assistantText || "").trim()}`,
  ]
    .filter(Boolean)
    .join("\n");

  const summaryText = compactMemory([previous, entry].filter(Boolean).join("\n\n"));
  const existing = await get(
    "SELECT conversation_id FROM conversation_memories WHERE conversation_id=?",
    [conversationId]
  );

  if (existing) {
    await run(
      "UPDATE conversation_memories SET summary_text=?, updated_at=datetime('now') WHERE conversation_id=?",
      [summaryText, conversationId]
    );
  } else {
    await run(
      "INSERT INTO conversation_memories (conversation_id, summary_text) VALUES (?, ?)",
      [conversationId, summaryText]
    );
  }
}

async function upsertIndexedDocument({ sourcePath, relPath, originalName, mimeType }) {
  if (!fs.existsSync(sourcePath)) return null;

  const stat = fs.statSync(sourcePath);
  const ext = detectExt(sourcePath, originalName, mimeType) || path.extname(sourcePath).toLowerCase() || ".bin";
  const extracted = (await extractText(sourcePath, originalName, mimeType)).trim();
  const safeText = extracted || `(sem texto extraido) ${relPath}`;
  const existing = await get("SELECT id FROM documents WHERE source_path=?", [sourcePath]);

  if (existing) {
    await run(
      "UPDATE documents SET rel_path=?, ext=?, size_bytes=?, modified_ms=?, extracted_text=?, updated_at=datetime('now') WHERE id=?",
      [relPath, ext, stat.size, Math.round(stat.mtimeMs), safeText, existing.id]
    );
  } else {
    await run(
      "INSERT INTO documents (source_path, rel_path, ext, size_bytes, modified_ms, extracted_text) VALUES (?, ?, ?, ?, ?, ?)",
      [sourcePath, relPath, ext, stat.size, Math.round(stat.mtimeMs), safeText]
    );
  }

  return { relPath, extractedText: safeText };
}

async function searchKnowledgeBase(query, limit = 4) {
  try {
    return await searchDocuments(query, limit);
  } catch (err) {
    console.log("Erro na busca interna:", err?.message || err);
    return [];
  }
}

function makeSourceExcerpt(value, limit = 220) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, limit);
}

function pushUniqueSource(list, source) {
  if (!source || !Array.isArray(list)) return;

  const normalized = {
    type: String(source.type || "source").trim() || "source",
    label: String(source.label || source.url || "Fonte").trim() || "Fonte",
    excerpt: makeSourceExcerpt(source.excerpt || ""),
    url: String(source.url || "").trim(),
    file_id: String(source.file_id || "").trim(),
  };

  const key = [normalized.type, normalized.label, normalized.url, normalized.file_id].join("::");
  if (!key.replace(/[:]/g, "")) return;
  if (list.some((item) => [item.type, item.label, item.url || "", item.file_id || ""].join("::") === key)) {
    return;
  }

  list.push(normalized);
}

function mapKnowledgeSource(row) {
  return {
    type: "knowledge_base",
    label: String(row?.rel_path || "Documento interno").trim() || "Documento interno",
    excerpt: makeSourceExcerpt(row?.extracted_text || ""),
  };
}

function buildKnowledgeBundleFromRows(rows) {
  const safeRows = Array.isArray(rows) ? rows : [];
  return {
    text: safeRows.length
      ? safeRows
          .map((row) => `[Base interna: ${row.rel_path}]\n${String(row.extracted_text || "").slice(0, 1400)}`)
          .join("\n\n")
      : "",
    sources: safeRows.map(mapKnowledgeSource),
  };
}

async function buildKnowledgeBundle(query) {
  const rows = await searchKnowledgeBase(query, 4);
  return buildKnowledgeBundleFromRows(rows);
}
async function getConversationFilesContext(conversationId) {
  try {
    const files = await all(
      `SELECT original_name, stored_name, mime_type
         FROM files
        WHERE conversation_id=?
        ORDER BY id DESC
        LIMIT 4`,
      [conversationId]
    );

    const blocks = [];

    for (const file of files) {
      const filePath = path.join(uploadsDir, file.stored_name);
      if (!fs.existsSync(filePath)) continue;

      if (isAudioFile(file.original_name, file.mime_type)) {
        try {
          const transcript = await transcribeAudio(filePath, file.original_name, file.mime_type);
          if (transcript && transcript.trim()) {
            blocks.push(
              `[Audio enviado: ${file.original_name} | ${file.mime_type || "audio"}]\nTranscricao detectada:\n${transcript.slice(0, 9000)}`
            );
          } else {
            blocks.push(
              `[Audio enviado: ${file.original_name} | ${file.mime_type || "audio"}]\nO audio foi anexado a conversa, mas nao foi possivel transcreve-lo localmente.`
            );
          }
        } catch (err) {
          console.log("Erro ao transcrever audio:", err?.message || err);
          blocks.push(
            `[Audio enviado: ${file.original_name} | ${file.mime_type || "audio"}]\nO audio foi anexado a conversa, mas houve falha ao tentar transcreve-lo.`
          );
        }
        continue;
      }

      const extracted = await extractText(filePath, file.original_name, file.mime_type);
      if (extracted && extracted.trim()) {
        blocks.push(
          `[Documento enviado: ${file.original_name} | ${file.mime_type || "arquivo"}]\nTexto extraido:\n${extracted.slice(0, 9000)}`
        );
        continue;
      }

      if (mimeLooksLikeImage(file.mime_type)) {
        const ocr = await ocrImage(filePath);
        if (ocr && ocr.trim()) {
          blocks.push(
            `[Imagem enviada: ${file.original_name} | ${file.mime_type}]\nTexto OCR detectado:\n${ocr.slice(0, 6000)}`
          );
        } else {
          blocks.push(
            `[Imagem enviada: ${file.original_name} | ${file.mime_type}]\nA imagem foi anexada a conversa e pode ser analisada visualmente.`
          );
        }
        continue;
      }

      blocks.push(
        `[Documento enviado: ${file.original_name} | ${file.mime_type || "arquivo"}]\nO arquivo foi recebido, mas nao houve texto extraido localmente. Se o modelo suportar, ele tambem recebera o arquivo bruto para leitura.`
      );
    }

    return blocks.join("\n\n");
  } catch (err) {
    console.log("Erro lendo arquivos da conversa:", err?.message || err);
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
    for (const file of files) {
      if (!mimeLooksLikeImage(file.mime_type)) continue;

      const filePath = path.join(uploadsDir, file.stored_name);
      if (!fs.existsSync(filePath)) continue;

      out.push({
        type: "input_image",
        image_url: `data:${file.mime_type || "image/png"};base64,${fs.readFileSync(filePath).toString("base64")}`,
      });
    }

    return out;
  } catch (err) {
    console.log("Erro ao preparar imagens:", err?.message || err);
    return [];
  }
}

async function getRecentDocumentInputs(conversationId, limit = 2) {
  try {
    const rows = await all(
      `SELECT original_name, stored_name, mime_type, size_bytes
         FROM files
        WHERE conversation_id=?
        ORDER BY id DESC
        LIMIT ?`,
      [conversationId, limit * 4]
    );

    const out = [];
    for (const row of rows) {
      if (out.length >= limit) break;
      if (mimeLooksLikeImage(row.mime_type)) continue;
      if (!isSupportedOpenAIInputFile(row.original_name, row.mime_type)) continue;
      if (Number(row.size_bytes || 0) > INLINE_OPENAI_FILE_LIMIT) continue;

      const filePath = path.join(uploadsDir, row.stored_name);
      if (!fs.existsSync(filePath)) continue;

      out.push(
        buildOpenAIInputFilePart(
          filePath,
          row.original_name,
          row.mime_type || "application/octet-stream"
        )
      );
    }

    return out;
  } catch (err) {
    console.log("Erro ao preparar arquivos para a OpenAI:", err?.message || err);
    return [];
  }
}

function buildOpenAITools() {
  const tools = [{ type: "web_search_preview" }];

  if (OPENAI_VECTOR_STORE_ID) {
    tools.push({
      type: "file_search",
      vector_store_ids: [OPENAI_VECTOR_STORE_ID],
    });
  }

  return tools;
}

async function buildOpenAIInput({ conversationId, userText, contextText }) {
  const history = await getConversationHistory(conversationId, 12);
  const memory = await getConversationMemory(conversationId);
  const visionInputs = await getRecentVisionInputs(conversationId, 3);
  const documentInputs = await getRecentDocumentInputs(conversationId, 2);
  const normalizedUserText = String(userText || "").trim();
  const normalizedHistory = [...history];
  const lastHistoryItem = normalizedHistory[normalizedHistory.length - 1];

  if (
    lastHistoryItem?.role === "user" &&
    String(lastHistoryItem.content || "").trim() === normalizedUserText
  ) {
    normalizedHistory.pop();
  }

  const historyText = normalizedHistory
    .map((item) => `${item.role === "assistant" ? "IA" : "Usuario"}: ${item.content}`)
    .filter(Boolean)
    .join("\n");

  const systemText = `
Voce e a TALKERS IA, assistente corporativa da empresa Talkers.
Responda sempre em portugues do Brasil.
Seja objetiva, clara, educada e util.

Data e hora atual no Brasil:
${nowBrazil()}

Regras:
- Considere o historico recente da conversa antes de responder.
- Se houver memoria acumulada da conversa, use isso para manter continuidade.
- Se houver arquivos enviados, use o texto extraido e, quando disponivel, os arquivos brutos incluidos nesta chamada.
- Se o usuario pedir geracao de arquivo, entregue o arquivo e explique em uma frase o que foi gerado.
- Se nao houver base suficiente, diga isso claramente e peca complemento.

Memoria persistente da conversa:
${memory || "Sem memoria persistente ainda."}

Historico recente:
${historyText || "Sem historico anterior."}

Contexto adicional:
${contextText || "Sem contexto adicional."}
`.trim();

  return [
    {
      role: "system",
      content: [{ type: "input_text", text: systemText }],
    },
    {
      role: "user",
      content: [
        { type: "input_text", text: userText },
        ...visionInputs,
        ...documentInputs,
      ],
    },
  ];
}

function extractResponsePayload(data, baseSources = []) {
  const sources = [];
  for (const source of baseSources || []) {
    pushUniqueSource(sources, source);
  }

  let text = String(data?.output_text || "").trim();

  try {
    for (const item of data?.output || []) {
      if (item?.type === "message" && Array.isArray(item.content)) {
        for (const part of item.content) {
          if (!text && part?.type === "output_text" && part.text) {
            text = `${text ? `${text}\n` : ""}${part.text}`.trim();
          }

          for (const annotation of part?.annotations || []) {
            if (annotation?.type === "file_citation") {
              pushUniqueSource(sources, {
                type: "file_search",
                label: annotation.filename || annotation.file_id || "Arquivo da base",
                file_id: annotation.file_id || "",
              });
            }

            if (annotation?.type === "url_citation") {
              pushUniqueSource(sources, {
                type: "web",
                label: annotation.title || annotation.url || "Fonte externa",
                url: annotation.url || "",
              });
            }
          }
        }
      }

      if (item?.type === "file_search_call" && Array.isArray(item.results)) {
        for (const result of item.results.slice(0, 6)) {
          pushUniqueSource(sources, {
            type: "file_search",
            label: result?.filename || result?.file_id || "Arquivo da base",
            file_id: result?.file_id || "",
            excerpt: result?.text || result?.content || "",
          });
        }
      }

      if (item?.type === "web_search_call" && Array.isArray(item.action?.sources)) {
        for (const source of item.action.sources.slice(0, 6)) {
          pushUniqueSource(sources, {
            type: "web",
            label: source?.title || source?.url || "Fonte externa",
            url: source?.url || "",
          });
        }
      }
    }
  } catch (err) {
    console.log("Erro ao extrair fontes da OpenAI:", err?.message || err);
  }

  return {
    text: (text || "").trim() || "Sem resposta da OpenAI.",
    sources: sources.slice(0, 8),
  };
}

async function openaiReply({ conversationId, userText, contextText, baseSources = [] }) {
  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_MODEL || "gpt-4o-mini";
  if (!apiKey) {
    return {
      text: "Configure OPENAI_API_KEY no servidor para usar a OpenAI.",
      sources: [...(baseSources || [])],
    };
  }

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
      tools: buildOpenAITools(),
      include: ["file_search_call.results", "web_search_call.action.sources"],
    }),
  });

  if (!resp.ok) {
    const body = await resp.text();
    console.log("OpenAI error:", resp.status, body);
    return {
      text: "Erro ao consultar a OpenAI.",
      sources: [...(baseSources || [])],
    };
  }

  const data = await resp.json();
  return extractResponsePayload(data, baseSources);
}

const app = express();
app.set("trust proxy", 1);
app.use(express.json({ limit: "20mb" }));
app.use(cookieParser());

const upload = multer({
  dest: uploadsDir,
  limits: { fileSize: 25 * 1024 * 1024 },
});
const ragUpload = upload.fields([
  { name: "files", maxCount: 200 },
  { name: "file", maxCount: 1 },
]);

app.get("/api/health", (req, res) => {
  res.json({ ok: true, vector_store_configured: Boolean(OPENAI_VECTOR_STORE_ID), db_client: DB_CLIENT });
});

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
  clearSessionCookie(req, res);
  await logEvent(req.user.sub, "logout", {});
  res.json({ ok: true });
});

app.get("/logout", (req, res) => {
  clearSessionCookie(req, res);
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

  const created = await run(
    "INSERT INTO conversations (user_id, title, mode) VALUES (?, ?, ?)",
    [req.user.sub, title, mode]
  );

  res.json({ conversation_id: created.lastID });
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
  await deleteStoredFiles(files.map((file) => file.stored_name));

  await run("DELETE FROM messages WHERE conversation_id=?", [id]);
  await run("DELETE FROM files WHERE conversation_id=?", [id]);
  await run("DELETE FROM conversation_memories WHERE conversation_id=?", [id]);
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

  res.json({
    conversation: conv,
    messages: rows.map((row) => ({
      id: row.id,
      role: row.role,
      content: row.content,
      created_at: row.created_at,
      meta: row.meta_json ? safeJsonParse(row.meta_json) : null,
    })),
  });
});

app.post("/api/conversations/:id/files", requireAuth(JWT_SECRET), upload.single("file"), handleConversationUpload);
app.post("/api/conversations/:id/upload", requireAuth(JWT_SECRET), upload.single("file"), handleConversationUpload);

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

  const artifact = await generateArtifact({
    apiKey: process.env.OPENAI_API_KEY || "",
    prompt: text,
    outDir: uploadsDir,
  }).catch((err) => {
    console.log("Erro na geracao de artefato:", err?.message || err);
    return null;
  });

  if (artifact) {
    const stat = fs.statSync(artifact.fullPath);
    const saved = await createFileMessage({
      conversationId: id,
      uploadedBy: req.user.sub,
      originalName: artifact.filename,
      storedName: path.basename(artifact.fullPath),
      mimeType: artifact.mimeType,
      sizeBytes: stat.size,
      role: "assistant",
      content: artifact.reply,
    });

    await updateConversationMemory(id, text, artifact.reply);
    return res.json({ reply: artifact.reply, meta: saved.meta });
  }

  let webContext = "";
  try {
    webContext = await searchWeb(text);
  } catch (err) {
    console.log("Erro busca web:", err?.message || err);
  }

  const fileContext = await getConversationFilesContext(id);
  const knowledgeBundle = await buildKnowledgeBundle(text);
  const contextText = `
Data atual no Brasil:
${nowBrazil()}

Memoria interna da empresa:
${knowledgeBundle.text || "Sem resultados relevantes da base interna."}

Documentos e imagens da conversa:
${fileContext || "Nenhum anexo recente."}

Contexto da internet:
${webContext || "Sem resultados externos relevantes."}
`.trim();

  const assistant = await openaiReply({
    conversationId: id,
    userText: text,
    contextText,
    baseSources: knowledgeBundle.sources,
  });

  const assistantMeta = assistant.sources.length ? JSON.stringify({ sources: assistant.sources }) : null;

  await run(
    "INSERT INTO messages (conversation_id, role, content, meta_json) VALUES (?, 'assistant', ?, ?)",
    [id, assistant.text, assistantMeta]
  );
  await run("UPDATE conversations SET updated_at=datetime('now') WHERE id=?", [id]);
  await updateConversationMemory(id, text, assistant.text);

  res.json({ reply: assistant.text, meta: assistantMeta ? JSON.parse(assistantMeta) : null });
});

app.get("/api/admin/users", requireAuth(JWT_SECRET), requireRole("admin"), async (req, res) => {
  const users = await all(
    "SELECT id, name, email, role, created_at FROM users ORDER BY id DESC",
    []
  );
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
  const created = await run(
    "INSERT INTO users (email, name, password_hash, role) VALUES (?, ?, ?, ?)",
    [email, name, hash, role]
  );

  await logEvent(req.user.sub, "admin_create_user", { user_id: created.lastID, email, role });
  res.json({ ok: true, user_id: created.lastID });
});

app.delete("/api/admin/users/:id", requireAuth(JWT_SECRET), requireRole("admin"), async (req, res) => {
  await logEvent(req.user.sub, "admin_delete_user_blocked", { target_user_id: Number(req.params.id) || null });
  res.status(403).json({ error: "user_deletion_disabled" });
});

app.get("/api/admin/rag/status", requireAuth(JWT_SECRET), requireRole("admin"), async (req, res) => {
  res.json({
    ok: true,
    vector_store_configured: Boolean(OPENAI_VECTOR_STORE_ID),
    openai_api_configured: Boolean(process.env.OPENAI_API_KEY),
    vector_store_id: OPENAI_VECTOR_STORE_ID || null,
    local_dir: knowledgeDir,
  });
});

app.get("/api/admin/rag/files", requireAuth(JWT_SECRET), requireRole("admin"), async (req, res) => {
  const files = await all(
    `SELECT id, original_name, stored_name, openai_file_id, vector_store_file_id, uploaded_by, created_at
       FROM knowledge_sources
      ORDER BY datetime(created_at) DESC, id DESC
      LIMIT 50`
  );

  res.json({ files });
});

function getAdminRagUploads(req) {
  const uploads = [];

  if (req.file) uploads.push(req.file);

  if (req.files && typeof req.files === "object") {
    for (const group of Object.values(req.files)) {
      if (Array.isArray(group)) uploads.push(...group);
    }
  }

  return uploads.filter(Boolean);
}

async function ingestKnowledgeUpload(uploaded, userId) {
  const tempPath = uploaded.path || path.join(uploadsDir, uploaded.filename);
  const safeOriginalName = sanitizeFilename(uploaded.originalname || `arquivo-${Date.now()}`);
  const storedName = `${Date.now()}-${uploaded.filename}-${safeOriginalName}`;
  const finalPath = path.join(knowledgeDir, storedName);

  fs.renameSync(tempPath, finalPath);

  const relPath = path.relative(kbDir, finalPath).replace(/\\/g, "/");
  const indexed = await upsertIndexedDocument({
    sourcePath: finalPath,
    relPath,
    originalName: safeOriginalName,
    mimeType: uploaded.mimetype || "",
  });

  let openaiFile = null;
  let vectorStoreFile = null;

  if (process.env.OPENAI_API_KEY && OPENAI_VECTOR_STORE_ID) {
    openaiFile = await uploadFileToOpenAI(finalPath, safeOriginalName, process.env.OPENAI_API_KEY);
    vectorStoreFile = await attachFileToVectorStore(
      openaiFile.id,
      OPENAI_VECTOR_STORE_ID,
      process.env.OPENAI_API_KEY
    );
  }

  const record = await run(
    "INSERT INTO knowledge_sources (original_name, stored_name, openai_file_id, vector_store_file_id, uploaded_by) VALUES (?, ?, ?, ?, ?)",
    [
      safeOriginalName,
      storedName,
      openaiFile?.id || null,
      vectorStoreFile?.id || null,
      userId,
    ]
  );

  await logEvent(userId, "admin_rag_upload", {
    knowledge_source_id: record.lastID,
    filename: safeOriginalName,
    openai_file_id: openaiFile?.id || null,
    vector_store_file_id: vectorStoreFile?.id || null,
  });

  return {
    knowledge_source_id: record.lastID,
    original_name: safeOriginalName,
    stored_name: storedName,
    local_indexed: Boolean(indexed),
    openai_file_id: openaiFile?.id || null,
    vector_store_file_id: vectorStoreFile?.id || null,
  };
}

app.post("/api/admin/rag/upload", requireAuth(JWT_SECRET), requireRole("admin"), ragUpload, async (req, res) => {
  const uploads = getAdminRagUploads(req);
  if (!uploads.length) return res.status(400).json({ error: "missing_file" });

  const files = [];
  const errors = [];

  for (const uploaded of uploads) {
    try {
      const result = await ingestKnowledgeUpload(uploaded, req.user.sub);
      files.push(result);
    } catch (err) {
      console.log("Erro no upload RAG:", err?.message || err);
      errors.push({
        filename: sanitizeFilename(uploaded?.originalname || uploaded?.filename || "arquivo"),
        error: err?.message || "rag_upload_failed",
      });
    }
  }

  if (!files.length) {
    return res.status(500).json({
      error: errors[0]?.error || "rag_upload_failed",
      errors,
    });
  }

  const first = files[0];
  return res.status(errors.length ? 207 : 200).json({
    ok: errors.length === 0,
    uploaded_count: files.length,
    failed_count: errors.length,
    files,
    errors,
    knowledge_source_id: first.knowledge_source_id,
    local_indexed: first.local_indexed,
    openai_file_id: first.openai_file_id,
    vector_store_file_id: first.vector_store_file_id,
  });
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

async function startServer() {
  await migrate();
  await ensureAdmin();

  app.listen(PORT, () => {
    console.log(`Talkers IA rodando em ${BASE_URL}`);
    console.log(`Login: ${BASE_URL}/login.html`);
    console.log(`Banco ativo: ${DB_CLIENT}`);
  });
}

startServer().catch((err) => {
  console.error("Falha ao iniciar o servidor:", err);
  process.exit(1);
});










