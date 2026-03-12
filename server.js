require("dotenv").config();

const express = require("express");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const cookieParser = require("cookie-parser");
const bcrypt = require("bcryptjs");
const multer = require("multer");
const jwt = require("jsonwebtoken");

const { DATA_DIR, DB_CLIENT, migrate, get, all, run, uploadsDir, kbDir, logEvent, searchDocuments } = require("./db");
const { detectLanguage, formatDailyGreeting, getLanguageLabel, normalizeLanguageCode, normalizeText: normalizeLanguageText } = require("./lib/language");
const { chunkTextSemantically, cosineSimilarity, extractKeywords, hashText, normalizeSemanticText, parseEmbedding } = require("./lib/semantic");
const {
  DEPARTMENT_DEFINITIONS,
  buildDepartmentSeedRows,
  buildIntranetWorkspace,
  sanitizeDepartment,
  sanitizeDepartmentList,
} = require("./lib/intranet");
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
const OPENAI_EMBEDDING_MODEL = String(process.env.OPENAI_EMBEDDING_MODEL || "text-embedding-3-small").trim();
const SEMANTIC_CACHE_MIN_SIMILARITY = 0.93;
const SEARCH_CANDIDATE_LIMIT = 16;
const STRUCTURED_REQUEST_RE = /\b(como|explique|instru|passo a passo|melhore|reescreva|reorganize|organize|estrutura|estruture|resuma|traduza|sugest|modelo|mensagem|texto pronto|texto profissional|formate|formatar|resposta|compare|analise|analisar)\b/i;
const TONE_PROFILE_MAP = {
  profissional: 'profissional, elegante e confiavel',
  direto: 'direto, claro e sem rodeios',
  objetivo: 'objetivo, pratico e focado no que importa',
  cordial: 'cordial, acolhedor e respeitoso',
  leve: 'leve, humano e acessivel',
  despojado: 'despojado, natural e fluido',
  persuasivo: 'persuasivo, comercial e orientado a conversao',
};
const FIXED_DEPARTMENT_BY_EMAIL = {
  'julia@talkers.com': ['RH'],
  'laura@talkers.com': ['Administrativo'],
};
const DEPARTMENT_NAMES = DEPARTMENT_DEFINITIONS.map((item) => item.name);

const JWT_SECRET =
  String(process.env.JWT_SECRET || "").trim() || (IS_PRODUCTION ? "" : DEFAULT_JWT_SECRET);
const ADMIN_EMAIL = String(process.env.ADMIN_EMAIL || DEFAULT_ADMIN_EMAIL).trim().toLowerCase();
const ADMIN_NAME = String(process.env.ADMIN_NAME || DEFAULT_ADMIN_NAME).trim() || DEFAULT_ADMIN_NAME;
const ADMIN_PASSWORD = String(process.env.ADMIN_PASSWORD || (IS_PRODUCTION ? "" : DEFAULT_ADMIN_PASSWORD));

const knowledgeDir = path.join(kbDir, "manual");
const RAG_ALLOWED_EXTS = new Set([
  ".pdf",
  ".doc",
  ".docx",
  ".rtf",
  ".odt",
  ".ppt",
  ".pptx",
  ".xls",
  ".xlsx",
  ".csv",
  ".txt",
  ".md",
  ".json",
]);
const RAG_TEXT_COMPARE_EXTS = new Set([".txt", ".md", ".csv", ".json"]);
const RAG_LOCAL_EXTRACTION_LIMITS = {
  ".pdf": 8 * 1024 * 1024,
  ".doc": 6 * 1024 * 1024,
  ".docx": 12 * 1024 * 1024,
  ".ppt": 8 * 1024 * 1024,
  ".pptx": 12 * 1024 * 1024,
  ".xls": 8 * 1024 * 1024,
  ".xlsx": 12 * 1024 * 1024,
  ".csv": 5 * 1024 * 1024,
  ".txt": 5 * 1024 * 1024,
  ".md": 5 * 1024 * 1024,
  ".json": 5 * 1024 * 1024,
};

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
      "INSERT INTO users (email, name, password_hash, role, can_access_intranet) VALUES (?, ?, ?, 'admin', ?)",
      [ADMIN_EMAIL, ADMIN_NAME, hash, true]
    );

    await logEvent(created.lastID, "admin_bootstrap_created", { email: ADMIN_EMAIL });
  } catch (err) {
    console.log("Falha ao criar admin:", err?.message || err);
  }
}

async function ensureFixedDepartments() {
  for (const [email, departments] of Object.entries(FIXED_DEPARTMENT_BY_EMAIL)) {
    const user = await get("SELECT id FROM users WHERE email=?", [email]);
    if (!user) continue;
    await syncUserDepartments(user.id, departments);
  }
}

async function maybeInsertDailyGreeting(conversationId, user) {
  const todayKey = brazilDateKey();
  const priorGreetings = await all(
    `SELECT m.meta_json
       FROM messages m
       JOIN conversations c ON c.id = m.conversation_id
      WHERE c.user_id=?
        AND m.role='assistant'
        AND m.meta_json IS NOT NULL
      ORDER BY m.id DESC
      LIMIT 40`,
    [user.id || user.sub]
  );

  const hasGreetingToday = priorGreetings.some((row) => {
    const meta = safeJsonParse(row?.meta_json || '');
    return meta?.daily_greeting === true && meta?.greeting_date === todayKey;
  });

  if (hasGreetingToday) return null;

  const greeting = formatDailyGreeting(user.name || 'Usuario');
  const meta = JSON.stringify({
    daily_greeting: true,
    greeting_date: todayKey,
    structured: false,
    response_language: 'pt',
  });

  await run(
    "INSERT INTO messages (conversation_id, role, content, meta_json) VALUES (?, 'assistant', ?, ?)",
    [conversationId, greeting, meta]
  );
  await run("UPDATE conversations SET updated_at=datetime('now') WHERE id=?", [conversationId]);
  return greeting;
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

function parseBooleanInput(value) {
  if (typeof value === "boolean") return value;
  const normalized = String(value ?? "").trim().toLowerCase();
  return ["1", "true", "yes", "sim", "on"].includes(normalized);
}

function parseDepartmentInput(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return [];
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) return parsed;
    } catch {}
    return trimmed.split(",");
  }
  return [];
}

function getPrimaryDepartmentName(departments = []) {
  return departments.find(Boolean) || "";
}

function formatDepartmentNames(departments = []) {
  const safe = sanitizeDepartmentList(departments);
  return safe.join(", ");
}

function coerceDbBoolean(value) {
  return value === true || value === 1 || value === "1" || value === "true";
}

async function listDepartmentCatalog() {
  return all(
    "SELECT id, slug, name, description, icon, sort_order, metadata_json FROM departments ORDER BY sort_order ASC, name ASC"
  );
}

async function getDepartmentIdMap() {
  const rows = await listDepartmentCatalog();
  return new Map(rows.map((row) => [row.name, row]));
}

async function getUserDepartmentDetails(userId) {
  const rows = await all(
    `SELECT d.id, d.slug, d.name, d.description, d.icon, d.sort_order, d.metadata_json,
            ud.access_level, ud.is_primary
       FROM user_departments ud
       JOIN departments d ON d.id = ud.department_id
      WHERE ud.user_id=?
      ORDER BY ud.is_primary DESC, d.sort_order ASC, d.name ASC`,
    [userId]
  );

  return rows.map((row) => ({
    ...row,
    is_primary: coerceDbBoolean(row.is_primary),
  }));
}

async function hydrateUserRecord(user) {
  if (!user) return null;
  const details = await getUserDepartmentDetails(user.id || user.sub);
  const departments = details.map((item) => item.name);
  const primaryDepartment = user.department || getPrimaryDepartmentName(departments);
  return {
    ...user,
    department: primaryDepartment,
    departments,
    department_details: details,
    can_access_intranet: coerceDbBoolean(user.can_access_intranet),
  };
}

async function syncUserDepartments(userId, departmentValues = []) {
  const safeDepartments = sanitizeDepartmentList(departmentValues);
  const catalogMap = await getDepartmentIdMap();
  const existing = await getUserDepartmentDetails(userId);
  const existingByName = new Map(existing.map((item) => [item.name, item]));

  for (const row of existing) {
    if (!safeDepartments.includes(row.name)) {
      await run("DELETE FROM user_departments WHERE user_id=? AND department_id=?", [userId, row.id]);
    }
  }

  for (let index = 0; index < safeDepartments.length; index += 1) {
    const name = safeDepartments[index];
    const department = catalogMap.get(name);
    if (!department) continue;
    const isPrimary = index === 0;

    if (existingByName.has(name)) {
      await run(
        "UPDATE user_departments SET access_level=?, is_primary=?, updated_at=datetime('now') WHERE user_id=? AND department_id=?",
        [existingByName.get(name).access_level || 'colaborador', isPrimary, userId, department.id]
      );
    } else {
      await run(
        "INSERT INTO user_departments (user_id, department_id, access_level, is_primary) VALUES (?, ?, ?, ?)",
        [userId, department.id, 'colaborador', isPrimary]
      );
    }
  }

  await run("UPDATE users SET department=? WHERE id=?", [getPrimaryDepartmentName(safeDepartments) || null, userId]);
  return safeDepartments;
}

async function ensureDepartmentCatalog() {
  const rows = buildDepartmentSeedRows();
  for (const row of rows) {
    await run(
      `INSERT INTO departments (slug, name, description, icon, sort_order, metadata_json, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(slug) DO UPDATE SET
         name=excluded.name,
         description=excluded.description,
         icon=excluded.icon,
         sort_order=excluded.sort_order,
         metadata_json=excluded.metadata_json,
         updated_at=datetime('now')`,
      [row.slug, row.name, row.description, row.icon, row.sortOrder, row.metadataJson]
    );
  }
}

async function syncLegacyUserDepartmentData() {
  const users = await all("SELECT id, role, department, can_access_intranet FROM users ORDER BY id ASC");
  for (const user of users) {
    if (user.role === 'admin' && !coerceDbBoolean(user.can_access_intranet)) {
      await run("UPDATE users SET can_access_intranet=? WHERE id=?", [true, user.id]);
    }

    const existingDepartments = await getUserDepartmentDetails(user.id);
    if (!existingDepartments.length && user.department) {
      await syncUserDepartments(user.id, [user.department]);
    }
  }
}

function brazilDateKey(value = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(value));
}

function normalizeQuery(value = "") {
  return normalizeSemanticText(String(value || "")).slice(0, 500);
}

function detectConversationLanguage(userText = "", history = []) {
  const joined = [
    String(userText || "").trim(),
    ...(history || []).slice(-4).map((item) => String(item?.content || "").trim()),
  ].filter(Boolean).join("\n");
  return normalizeLanguageCode(detectLanguage(joined || userText || "", "pt"));
}

function analyzeConversationIntent(userText = "", userLanguage = "pt") {
  const normalized = normalizeQuery(userText);
  const wantsStructured = STRUCTURED_REQUEST_RE.test(normalized) || /\n/.test(String(userText || ""));
  const wantsTranslation = /\b(traduza|translate|traduz|translation|traducao|traduccion|traduzione)\b/i.test(userText);
  const wantsSummary = /\b(resuma|resumo|summary|summarize|resumen|riassunto)\b/i.test(userText);
  const wantsRewrite = /\b(melhore|reescreva|rewrite|rephrase|ajuste|corrija|formate|organize)\b/i.test(userText);
  const wantsSteps = /\b(passo a passo|step by step|como fazer|how to|como faco|como faço)\b/i.test(userText);
  const wantsProfessional = /\b(profissional|formal|executivo|corporativo|business|profesional|professionnel)\b/i.test(userText);
  const wantsPersuasive = /\b(venda|comercial|persuasivo|convencer|sales|conversion)\b/i.test(userText);

  let tone = 'cordial';
  if (wantsProfessional) tone = 'profissional';
  else if (wantsPersuasive) tone = 'persuasivo';
  else if (wantsSteps || wantsSummary) tone = 'objetivo';
  else if (/\b(rapido|rápido|direto|curto|short|brief)\b/i.test(userText)) tone = 'direto';
  else if (/\b(leve|humano|friendly|casual|despojado)\b/i.test(userText)) tone = 'leve';

  const responseLabel = userLanguage === 'en'
    ? 'Structured answer'
    : userLanguage === 'es'
      ? 'Respuesta estructurada'
      : userLanguage === 'it'
        ? 'Risposta strutturata'
        : userLanguage === 'fr'
          ? 'Reponse structuree'
          : 'Resposta estruturada';

  return {
    language: userLanguage,
    tone,
    wantsStructured: wantsStructured || wantsTranslation || wantsSummary || wantsRewrite || wantsSteps,
    wantsTranslation,
    wantsSummary,
    wantsRewrite,
    wantsSteps,
    responseLabel,
  };
}

function getToneInstruction(intent) {
  return TONE_PROFILE_MAP[intent?.tone] || TONE_PROFILE_MAP.cordial;
}

function makeStructuredResponseMeta(intent, extra = {}) {
  return {
    structured: Boolean(intent?.wantsStructured),
    structured_label: intent?.responseLabel || 'Resposta estruturada',
    response_language: intent?.language || 'pt',
    tone: intent?.tone || 'cordial',
    ...extra,
  };
}
const TOPIC_SHIFT_EXPLICIT_RE = /\b(mudando de assunto|mudando totalmente de assunto|outro assunto|agora outra coisa|agora outro assunto|falando de outra coisa|novo assunto|vamos falar de outra coisa|esquece isso|esquece aquilo|deixa isso pra la|sem relacao com isso)\b/i;
const TOPIC_CONTINUITY_HINT_RE = /\b(isso|isto|esse|essa|esses|essas|anterior|mesmo|mesma|continuar|continua|continuando|agora em|com base nisso|nesse texto|nesta imagem|nessa imagem|nesse arquivo|nessa planilha|adicione|remova|ajuste|edite|corrija|melhore|reescreva|resuma|traduza)\b/i;
const TOPIC_STOPWORDS = new Set([
  "a", "o", "os", "as", "um", "uma", "uns", "umas", "de", "da", "do", "das", "dos", "e", "ou", "em", "no", "na", "nos", "nas", "para", "por", "com", "sem", "sobre", "entre", "ate", "apos", "que", "se", "como", "mais", "menos", "muito", "muita", "muitos", "muitas", "ja", "agora", "depois", "antes", "aqui", "ali", "isso", "isto", "esse", "essa", "esses", "essas", "dele", "dela", "deles", "delas", "me", "te", "lhe", "nos", "vos", "eu", "voce", "voces", "ela", "ele", "eles", "elas", "ser", "estar", "ficar", "ter", "tem", "quero", "preciso", "pode", "poder", "fazer", "gera", "gerar", "criar", "montar", "mostrar", "explicar", "ajudar"
]);

function normalizeTopicText(value = "") {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractTopicTerms(value = "") {
  return [...new Set(
    normalizeTopicText(value)
      .split(" ")
      .map((term) => term.trim())
      .filter((term) => term.length >= 3 && !TOPIC_STOPWORDS.has(term))
  )];
}

function detectTopicShift(userText, history = []) {
  const normalizedUserText = normalizeTopicText(userText);
  if (!normalizedUserText) return { isShift: false, reason: "empty" };

  if (TOPIC_SHIFT_EXPLICIT_RE.test(normalizedUserText)) {
    return { isShift: true, reason: "explicit" };
  }

  if (TOPIC_CONTINUITY_HINT_RE.test(normalizedUserText)) {
    return { isShift: false, reason: "continuity_hint" };
  }

  if (normalizedUserText.length < 32) {
    return { isShift: false, reason: "short" };
  }

  const recentUserTexts = (history || [])
    .filter((item) => item?.role === "user")
    .map((item) => String(item.content || "").trim())
    .filter(Boolean)
    .slice(-4);

  if (!recentUserTexts.length) {
    return { isShift: false, reason: "no_history" };
  }

  const currentTerms = extractTopicTerms(normalizedUserText);
  const recentTerms = new Set(recentUserTexts.flatMap((item) => extractTopicTerms(item)));

  if (currentTerms.length < 4 || recentTerms.size < 5) {
    return { isShift: false, reason: "low_signal" };
  }

  let overlapCount = 0;
  for (const term of currentTerms) {
    if (recentTerms.has(term)) overlapCount += 1;
  }

  const overlapRatio = overlapCount / currentTerms.length;
  if (overlapCount <= 1 && overlapRatio < 0.2) {
    return { isShift: true, reason: "low_overlap" };
  }

  return { isShift: false, reason: "related" };
}

async function getConversationTopicSnapshot(conversationId, userText, limit = 12) {
  const history = await getConversationHistory(conversationId, limit);
  const normalizedHistory = [...history];
  const normalizedUserText = String(userText || "").trim();
  const lastHistoryItem = normalizedHistory[normalizedHistory.length - 1];

  if (
    lastHistoryItem?.role === "user" &&
    String(lastHistoryItem.content || "").trim() === normalizedUserText
  ) {
    normalizedHistory.pop();
  }

  return {
    history: normalizedHistory,
    topicShift: detectTopicShift(normalizedUserText, normalizedHistory),
  };
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

async function updateConversationMemory(conversationId, userText, assistantText, options = {}) {
  const previous = await getConversationMemory(conversationId);
  const entry = [
    `Usuario: ${String(userText || "").trim()}`,
    `IA: ${String(assistantText || "").trim()}`,
  ]
    .filter(Boolean)
    .join("\n");

  const resetMemory = Boolean(options?.resetMemory);
  const summaryBase = resetMemory
    ? `[Novo assunto]\n${entry}`
    : [previous, entry].filter(Boolean).join("\n\n");
  const summaryText = compactMemory(summaryBase);
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

async function getUserMemory(userId) {
  const row = await get(
    "SELECT summary_text, topics_json, language FROM user_memories WHERE user_id=?",
    [userId]
  );

  return {
    summaryText: String(row?.summary_text || '').trim(),
    topics: safeJsonParse(row?.topics_json || '[]') || [],
    language: String(row?.language || '').trim(),
  };
}

async function updateUserMemory(userId, userText, assistantText, language = 'pt') {
  if (!userId) return;

  const previous = await getUserMemory(userId);
  const mergedTopics = [...new Set([
    ...(Array.isArray(previous.topics) ? previous.topics : []),
    ...extractTopicTerms(userText).slice(0, 6),
  ])].slice(-16);

  const entry = [
    `Usuario: ${String(userText || '').trim()}`,
    `IA: ${String(assistantText || '').trim()}`,
  ].filter(Boolean).join('\n');

  const summaryText = compactMemory([previous.summaryText, entry].filter(Boolean).join('\n\n'));
  const existing = await get("SELECT user_id FROM user_memories WHERE user_id=?", [userId]);

  if (existing) {
    await run(
      "UPDATE user_memories SET summary_text=?, topics_json=?, language=?, updated_at=datetime('now') WHERE user_id=?",
      [summaryText, JSON.stringify(mergedTopics), language, userId]
    );
  } else {
    await run(
      "INSERT INTO user_memories (user_id, summary_text, topics_json, language) VALUES (?, ?, ?, ?)",
      [userId, summaryText, JSON.stringify(mergedTopics), language]
    );
  }
}

async function getRelevantUserMemory(userId, userText) {
  const memory = await getUserMemory(userId);
  if (!memory.summaryText) return '';

  const currentTerms = extractTopicTerms(userText);
  const storedTerms = Array.isArray(memory.topics) ? memory.topics : [];
  const overlap = currentTerms.filter((term) => storedTerms.includes(term));

  if (overlap.length >= 2 || currentTerms.length <= 3) {
    return memory.summaryText;
  }

  return '';
}

function getKnowledgeUploadExt(filePath, originalName = "", mimeType = "") {
  return detectExt(filePath, originalName, mimeType) || path.extname(String(filePath || "")).toLowerCase() || ".bin";
}

function isSupportedKnowledgeUpload(originalName = "", mimeType = "", filePath = "") {
  const ext = getKnowledgeUploadExt(filePath, originalName, mimeType);
  return RAG_ALLOWED_EXTS.has(ext);
}

function shouldExtractKnowledgeLocally(ext, sizeBytes) {
  const limit = RAG_LOCAL_EXTRACTION_LIMITS[ext];
  if (!limit) return false;

  if (OPENAI_VECTOR_STORE_ID && !RAG_TEXT_COMPARE_EXTS.has(ext)) {
    return false;
  }

  return Number(sizeBytes || 0) <= limit;
}

function normalizeKnowledgeText(value = "") {
  return String(value || "").replace(/\s+/g, " ").trim();
}

async function hashFileSha256(filePath) {
  return await new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = fs.createReadStream(filePath);

    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

async function findDuplicateKnowledgeUpload({ sourcePath, originalName, mimeType, sizeBytes }) {
  if (!fs.existsSync(sourcePath)) return null;

  const ext = getKnowledgeUploadExt(sourcePath, originalName, mimeType);
  const candidates = await all(
    "SELECT source_path, rel_path FROM documents WHERE size_bytes=? AND ext=? LIMIT 25",
    [Number(sizeBytes || 0), ext]
  );

  if (candidates.length) {
    const incomingHash = await hashFileSha256(sourcePath);

    for (const candidate of candidates) {
      if (!candidate?.source_path || !fs.existsSync(candidate.source_path)) continue;
      try {
        const candidateHash = await hashFileSha256(candidate.source_path);
        if (candidateHash === incomingHash) {
          return { relPath: candidate.rel_path, reason: "hash" };
        }
      } catch (err) {
        console.log("Erro ao comparar duplicidade por hash:", err?.message || err);
      }
    }
  }

  const extracted = normalizeKnowledgeText(await extractText(sourcePath, originalName, mimeType));
  if (extracted) {
    const contentHash = hashText(extracted);
    const duplicateHash = await get(
      "SELECT rel_path FROM documents WHERE content_hash=? LIMIT 1",
      [contentHash]
    );

    if (duplicateHash?.rel_path) {
      return { relPath: duplicateHash.rel_path, reason: "content_hash" };
    }

    if (RAG_TEXT_COMPARE_EXTS.has(ext)) {
      const duplicateText = await get(
        "SELECT rel_path FROM documents WHERE extracted_text=? LIMIT 1",
        [extracted]
      );

      if (duplicateText?.rel_path) {
        return { relPath: duplicateText.rel_path, reason: "text" };
      }
    }
  }

  return null;
}

async function upsertDocumentChunks(documentId, relPath, extractedText, language, documentKeywords = []) {
  await run("DELETE FROM document_chunks WHERE document_id=?", [documentId]);

  const chunks = chunkTextSemantically(extractedText || relPath, {
    maxChars: 1400,
    minChars: 420,
  });

  if (!chunks.length) {
    const contentText = String(extractedText || relPath || '').trim();
    const keywordText = extractKeywords(contentText, 12).join(', ');
    await run(
      "INSERT INTO document_chunks (document_id, rel_path, chunk_index, content_text, language, translated_text, translated_language, content_hash, keywords) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [documentId, relPath, 0, contentText, language, '', null, hashText(contentText), keywordText]
    );
    return 1;
  }

  let created = 0;
  for (const chunk of chunks) {
    const keywords = [...new Set([...(chunk.keywords || []), ...documentKeywords])].slice(0, 16).join(', ');
    await run(
      "INSERT INTO document_chunks (document_id, rel_path, chunk_index, content_text, language, translated_text, translated_language, content_hash, keywords) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [documentId, relPath, chunk.index, chunk.text, language, '', null, chunk.hash, keywords]
    );
    created += 1;
  }

  return created;
}

async function upsertIndexedDocument({ sourcePath, relPath, originalName, mimeType }) {
  if (!fs.existsSync(sourcePath)) return null;

  const stat = fs.statSync(sourcePath);
  const ext = getKnowledgeUploadExt(sourcePath, originalName, mimeType);
  const shouldExtract = shouldExtractKnowledgeLocally(ext, stat.size);
  const extracted = shouldExtract ? (await extractText(sourcePath, originalName, mimeType)).trim() : "";
  const safeText = extracted || (shouldExtract
    ? `(sem texto extraido) ${relPath}`
    : `(arquivo grande para indexacao local, mantido para busca vetorial) ${relPath}`);
  const language = detectConversationLanguage(safeText);
  const keywordText = extractKeywords(safeText, 14).join(', ');
  const contentHash = hashText(safeText);
  const existing = await get("SELECT id FROM documents WHERE source_path=?", [sourcePath]);

  let documentId = existing?.id || 0;
  if (existing) {
    await run(
      "UPDATE documents SET rel_path=?, ext=?, size_bytes=?, modified_ms=?, extracted_text=?, language=?, translated_text=?, translated_language=?, content_hash=?, keywords=?, updated_at=datetime('now') WHERE id=?",
      [relPath, ext, stat.size, Math.round(stat.mtimeMs), safeText, language, '', null, contentHash, keywordText, existing.id]
    );
  } else {
    const created = await run(
      "INSERT INTO documents (source_path, rel_path, ext, size_bytes, modified_ms, extracted_text, language, translated_text, translated_language, content_hash, keywords) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [sourcePath, relPath, ext, stat.size, Math.round(stat.mtimeMs), safeText, language, '', null, contentHash, keywordText]
    );
    documentId = created.lastID;
  }

  if (!documentId) {
    const refreshed = await get("SELECT id FROM documents WHERE source_path=?", [sourcePath]);
    documentId = refreshed?.id || 0;
  }

  const chunkCount = documentId
    ? await upsertDocumentChunks(documentId, relPath, safeText, language, keywordText ? keywordText.split(', ').filter(Boolean) : [])
    : 0;

  return { relPath, extractedText: safeText, language, chunkCount, documentId };
}

async function getEmbeddingForText(text) {
  const apiKey = String(process.env.OPENAI_API_KEY || '').trim();
  if (!apiKey || !text) return null;

  try {
    const resp = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: OPENAI_EMBEDDING_MODEL,
        input: String(text).slice(0, 6000),
      }),
    });

    if (!resp.ok) {
      console.log('Erro embeddings OpenAI:', resp.status, await resp.text());
      return null;
    }

    const data = await resp.json();
    return Array.isArray(data?.data?.[0]?.embedding) ? data.data[0].embedding : null;
  } catch (err) {
    console.log('Falha ao gerar embedding:', err?.message || err);
    return null;
  }
}

async function ensureChunkEmbedding(row) {
  if (!row?.id) return null;
  const existing = parseEmbedding(row.embedding_json);
  if (existing) return existing;

  const generated = await getEmbeddingForText(row.extracted_text || row.translated_text || '');
  if (!generated) return null;

  await run(
    "UPDATE document_chunks SET embedding_json=?, embedding_model=?, updated_at=datetime('now') WHERE id=?",
    [JSON.stringify(generated), OPENAI_EMBEDDING_MODEL, row.id]
  );
  row.embedding_json = JSON.stringify(generated);
  return generated;
}

async function translateTextSilently(text, sourceLanguage, targetLanguage) {
  const cleanText = String(text || '').trim();
  if (!cleanText) return '';
  if (normalizeLanguageCode(sourceLanguage) === normalizeLanguageCode(targetLanguage)) return cleanText;

  const apiKey = String(process.env.OPENAI_API_KEY || '').trim();
  if (!apiKey) return cleanText;

  try {
    const resp = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
        input: [
          {
            role: 'system',
            content: [{ type: 'input_text', text: `Traduza internamente o texto para ${getLanguageLabel(targetLanguage)} preservando contexto, tom e terminologia. Responda somente com a traducao.` }],
          },
          {
            role: 'user',
            content: [{ type: 'input_text', text: cleanText.slice(0, 5000) }],
          },
        ],
      }),
    });

    if (!resp.ok) return cleanText;
    const data = await resp.json();
    return String(data?.output_text || cleanText).trim() || cleanText;
  } catch (err) {
    console.log('Falha ao traduzir texto:', err?.message || err);
    return cleanText;
  }
}

async function hydrateKnowledgeRows(rows, userLanguage, queryEmbedding = null) {
  const enriched = [];

  for (const row of rows || []) {
    const item = { ...row };
    const embedding = queryEmbedding ? (await ensureChunkEmbedding(item)) : parseEmbedding(item.embedding_json);
    const currentTranslationLanguage = normalizeLanguageCode(item.translated_language || '');
    const hasMatchingTranslation = Boolean(item.translated_text) && currentTranslationLanguage === userLanguage;
    let translated = hasMatchingTranslation ? String(item.translated_text || '') : '';

    if (!hasMatchingTranslation) {
      translated = await translateTextSilently(
        item.extracted_text || item.translated_text || '',
        item.language || 'pt',
        userLanguage
      );

      if (translated && translated !== item.extracted_text) {
        await run(
          "UPDATE document_chunks SET translated_text=?, translated_language=?, updated_at=datetime('now') WHERE id=?",
          [translated, userLanguage, item.id]
        );
        item.translated_text = translated;
        item.translated_language = userLanguage;
      }
    }

    item.semantic_score = queryEmbedding && embedding ? cosineSimilarity(queryEmbedding, embedding) : 0;
    item.score = (Number(item.score || 0) * 0.45) + (item.semantic_score * 0.55);
    item.analysis_text = translated || item.extracted_text;
    enriched.push(item);
  }

  enriched.sort((left, right) => (Number(right.score || 0) - Number(left.score || 0)) || String(left.rel_path || '').localeCompare(String(right.rel_path || '')));
  return enriched;
}

async function searchKnowledgeBase(query, options = {}) {
  const safeLimit = Math.max(1, Number(options.limit || 4));
  const userLanguage = normalizeLanguageCode(options.userLanguage || detectLanguage(query, 'pt'));

  const dedupeRows = (rows = []) => {
    const uniqueRows = [];
    const seenDocuments = new Set();

    for (const row of rows) {
      const key = String(row.document_id || row.rel_path || row.id || '');
      if (!key || seenDocuments.has(key)) continue;
      seenDocuments.add(key);
      uniqueRows.push(row);
      if (uniqueRows.length >= safeLimit) break;
    }

    return uniqueRows;
  };

  try {
    const queryEmbedding = await getEmbeddingForText(query);
    const rows = await searchDocuments(query, SEARCH_CANDIDATE_LIMIT, {
      userLanguage,
      queryEmbedding: queryEmbedding ? JSON.stringify(queryEmbedding) : null,
    });
    const hydrated = await hydrateKnowledgeRows(rows, userLanguage, queryEmbedding);
    let uniqueRows = dedupeRows(hydrated);

    if (!uniqueRows.length && queryEmbedding) {
      const semanticCandidates = await all(
        "SELECT id, document_id, rel_path, content_text AS extracted_text, translated_text, translated_language, language, keywords, embedding_json, 0 AS score FROM document_chunks ORDER BY updated_at DESC LIMIT ?",
        [Math.max(safeLimit * 20, 80)]
      );
      const semanticHydrated = await hydrateKnowledgeRows(semanticCandidates, userLanguage, queryEmbedding);
      uniqueRows = dedupeRows(
        semanticHydrated.filter((row) => Number(row.semantic_score || 0) >= 0.42)
      );
    }

    return uniqueRows;
  } catch (err) {
    console.log('Erro na busca interna:', err?.message || err);
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
    excerpt: makeSourceExcerpt(row?.analysis_text || row?.translated_text || row?.extracted_text || ""),
    language: row?.language || '',
  };
}

function buildKnowledgeBundleFromRows(rows, userLanguage = 'pt') {
  const safeRows = Array.isArray(rows) ? rows : [];
  const deduped = [];
  const seen = new Set();

  for (const row of safeRows) {
    const key = String(row?.document_id || row?.rel_path || row?.id || '');
    if (!key || seen.has(key)) continue;
    seen.add(key);
    deduped.push(row);
  }

  return {
    text: deduped.length
      ? deduped
          .map((row) => {
            const baseText = String(row.analysis_text || row.translated_text || row.extracted_text || '').slice(0, 1400);
            const languageLabel = row?.language && row.language !== userLanguage
              ? ` | idioma original: ${getLanguageLabel(row.language)}`
              : '';
            return `[Base interna: ${row.rel_path}${languageLabel}]\n${baseText}`;
          })
          .join("\n\n")
      : "",
    sources: deduped.map(mapKnowledgeSource),
  };
}

async function buildKnowledgeBundle(query, options = {}) {
  const userLanguage = normalizeLanguageCode(options.userLanguage || detectLanguage(query, 'pt'));
  const rows = await searchKnowledgeBase(query, { limit: options.limit || 4, userLanguage });
  return buildKnowledgeBundleFromRows(rows, userLanguage);
}

async function getKnowledgeSignatureValue() {
  const row = await get(
    "SELECT COUNT(*) AS total, MAX(updated_at) AS updated_at FROM documents",
    []
  );
  const chunkRow = await get(
    "SELECT COUNT(*) AS total, MAX(updated_at) AS updated_at FROM document_chunks",
    []
  );
  return `${Number(row?.total || 0)}:${row?.updated_at || '0'}:${Number(chunkRow?.total || 0)}:${chunkRow?.updated_at || '0'}`;
}

async function findSemanticCache(userId, queryText, queryLanguage, queryEmbedding, knowledgeSignature) {
  const normalizedQuery = normalizeQuery(queryText);
  if (!normalizedQuery) return null;

  const exact = await get(
    "SELECT id, response_text, response_language, sources_json, embedding_json FROM semantic_cache WHERE user_id=? AND normalized_query=? AND knowledge_signature=? ORDER BY updated_at DESC LIMIT 1",
    [userId, normalizedQuery, knowledgeSignature]
  );

  if (exact) {
    await run("UPDATE semantic_cache SET hit_count=COALESCE(hit_count, 0)+1, updated_at=datetime('now') WHERE id=?", [exact.id]);
    return {
      text: exact.response_text,
      responseLanguage: exact.response_language,
      sources: safeJsonParse(exact.sources_json || '[]') || [],
    };
  }

  if (!queryEmbedding) return null;

  const recent = await all(
    "SELECT id, response_text, response_language, sources_json, embedding_json FROM semantic_cache WHERE user_id=? AND knowledge_signature=? ORDER BY updated_at DESC LIMIT 24",
    [userId, knowledgeSignature]
  );

  let best = null;
  let bestScore = 0;
  for (const row of recent) {
    const score = cosineSimilarity(queryEmbedding, row.embedding_json);
    if (score > bestScore) {
      bestScore = score;
      best = row;
    }
  }

  if (best && bestScore >= SEMANTIC_CACHE_MIN_SIMILARITY) {
    await run("UPDATE semantic_cache SET hit_count=COALESCE(hit_count, 0)+1, updated_at=datetime('now') WHERE id=?", [best.id]);
    return {
      text: best.response_text,
      responseLanguage: best.response_language,
      sources: safeJsonParse(best.sources_json || '[]') || [],
      semanticSimilarity: bestScore,
    };
  }

  return null;
}

async function saveSemanticCache(userId, queryText, queryLanguage, responseText, responseLanguage, sources, queryEmbedding, knowledgeSignature) {
  const normalizedQuery = normalizeQuery(queryText);
  if (!normalizedQuery || !responseText) return;

  await run(
    "INSERT INTO semantic_cache (user_id, scope_key, normalized_query, query_text, query_language, response_text, response_language, sources_json, embedding_json, knowledge_signature) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    [userId, `${userId}:${queryLanguage}`, normalizedQuery, queryText, queryLanguage, responseText, responseLanguage, JSON.stringify(sources || []), queryEmbedding ? JSON.stringify(queryEmbedding) : null, knowledgeSignature]
  );
}

function queryLooksExternalOrCurrent(query = "") {
  const value = String(query || "").trim().toLowerCase();
  if (!value) return false;

  return /(hoje|agora|atual|atualizado|ultim|recente|noticia|noticias|mercado|cotacao|preco|precos|clima|governo|lei|extern|internet|pesquise|pesquisar|web|site|sites|tendencia|publicado|today|latest|current|news|market|weather|gobierno|actualidad|noticias|oggi|actuel|nouvelles)/i.test(value);
}

function shouldFetchWebContext(query, knowledgeBundle) {
  const hasInternalContext = Boolean(String(knowledgeBundle?.text || "").trim());
  return !hasInternalContext || queryLooksExternalOrCurrent(query);
}

function shouldShowSourcesForReply(query) {
  const normalized = String(query || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();

  if (!normalized) return false;

  return /(fonte|fontes|referencia|referencias|origem|origens|cite|citar|citacao|citacoes|source|sources|link|links|de onde|baseou|baseada|baseado|fuente|fuentes|referencia|references|sorgente|origine|origen)/.test(normalized);
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

async function getRecentImageReferences(conversationId, limit = 4) {
  try {
    const files = await all(
      `SELECT original_name, stored_name, mime_type, size_bytes
         FROM files
        WHERE conversation_id=?
        ORDER BY id DESC
        LIMIT ?`,
      [conversationId, limit * 3]
    );

    const out = [];
    for (const file of files) {
      if (out.length >= limit) break;
      if (!mimeLooksLikeImage(file.mime_type)) continue;

      const fullPath = path.join(uploadsDir, file.stored_name);
      if (!fs.existsSync(fullPath)) continue;

      out.push({
        fullPath,
        originalName: file.original_name,
        mimeType: file.mime_type || "image/png",
        sizeBytes: Number(file.size_bytes || 0),
      });
    }

    return out;
  } catch (err) {
    console.log("Erro ao preparar referencias de imagem:", err?.message || err);
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
  const tools = [];

  if (OPENAI_VECTOR_STORE_ID) {
    tools.push({
      type: "file_search",
      vector_store_ids: [OPENAI_VECTOR_STORE_ID],
    });
  }

  tools.push({ type: "web_search_preview" });
  return tools;
}
async function buildOpenAIInput({
  conversationId,
  userId,
  userText,
  contextText,
  topicSnapshot = null,
  responseProfile = null,
}) {
  const snapshot = topicSnapshot || await getConversationTopicSnapshot(conversationId, userText, 12);
  const history = Array.isArray(snapshot?.history) ? snapshot.history : [];
  const topicShift = snapshot?.topicShift || { isShift: false, reason: 'unknown' };
  const userLanguage = normalizeLanguageCode(responseProfile?.language || detectConversationLanguage(userText, history));
  const intent = responseProfile || analyzeConversationIntent(userText, userLanguage);
  const memory = await getConversationMemory(conversationId);
  const userMemory = await getRelevantUserMemory(userId, userText);
  const visionInputs = await getRecentVisionInputs(conversationId, 3);
  const documentInputs = await getRecentDocumentInputs(conversationId, 2);
  const normalizedUserText = String(userText || '').trim();

  const historyText = topicShift.isShift
    ? 'Historico recente ocultado nesta resposta porque o usuario mudou claramente de assunto.'
    : history
        .map((item) => `${item.role === 'assistant' ? 'IA' : 'Usuario'}: ${item.content}`)
        .filter(Boolean)
        .join('\n');

  const memoryText = topicShift.isShift
    ? 'Memoria de conversa anterior ignorada nesta resposta por mudanca de assunto.'
    : (memory || 'Sem memoria persistente desta conversa ainda.');

  const userMemoryText = topicShift.isShift
    ? 'Memoria entre conversas nao usada nesta resposta por mudanca de assunto.'
    : (userMemory || 'Sem memoria relevante de outras conversas.');

  const systemText = `
Voce e a TALKERS IA, assistente corporativa e educacional da empresa Talkers.
Idioma principal da resposta atual: ${getLanguageLabel(userLanguage)}.
Tom desejado para esta resposta: ${getToneInstruction(intent)}.

Comportamento:
- Detecte automaticamente o idioma do usuario e responda nesse idioma.
- Quando o usuario pedir traducao, traduza para o idioma solicitado mantendo contexto e intencao.
- Quando documentos estiverem em outro idioma, interprete o conteudo no idioma original, traduza silenciosamente quando necessario e responda no idioma do usuario.
- Para perguntas sobre processos, materiais, regras e informacoes da Talkers, priorize sempre a base interna da empresa e os arquivos da conversa.
- Use a web apenas como complemento ou quando o usuario pedir algo externo, atual ou publico.
- Se houver conflito entre base interna e web em assuntos da empresa, avise e priorize a base interna.
- Analise a intencao antes de responder e adapte o tom naturalmente.
- Se o pedido envolver explicacao, orientacao, passo a passo, melhoria de texto, organizacao de informacao, sugestoes, traducao, resumo, reescrita ou texto pronto para uso, entregue em markdown bem estruturado, com hierarquia visual clara, blocos curtos e reutilizaveis.
- Se o usuario mudar de assunto, foque totalmente no tema atual sem arrastar contexto irrelevante.
- Se faltar informacao suficiente, deixe isso claro e peca complemento.

Contexto:
- Data e hora atual no Brasil: ${nowBrazil()}
- Memoria da conversa atual: ${memoryText}
- Memoria util de outras conversas deste usuario: ${userMemoryText}
- Historico recente: ${historyText || 'Sem historico anterior.'}
- Contexto adicional: ${contextText || 'Sem contexto adicional.'}

Perfil desta resposta:
- Idioma da conversa: ${getLanguageLabel(userLanguage)}
- Tom: ${intent.tone}
- Estruturar resposta: ${intent.wantsStructured ? 'sim' : 'nao'}
- Responder com referencias so se o usuario pedir explicitamente.
`.trim();

  return [
    {
      role: 'system',
      content: [{ type: 'input_text', text: systemText }],
    },
    {
      role: 'user',
      content: [
        { type: 'input_text', text: normalizedUserText },
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

async function openaiReply({ conversationId, userId, userText, contextText, baseSources = [], topicSnapshot = null, responseProfile = null }) {
  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_MODEL || "gpt-4o-mini";
  if (!apiKey) {
    return {
      text: "Configure OPENAI_API_KEY no servidor para usar a OpenAI.",
      sources: [...(baseSources || [])],
    };
  }

  const input = await buildOpenAIInput({ conversationId, userId, userText, contextText, topicSnapshot, responseProfile });
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

async function getUserById(userId) {
  const user = await get(
    "SELECT id, name, email, role, department, can_access_intranet, job_title, unit_name, created_at FROM users WHERE id=?",
    [userId]
  );
  return hydrateUserRecord(user);
}

async function getUserByEmail(email) {
  const user = await get(
    "SELECT id, name, email, role, department, can_access_intranet, job_title, unit_name, created_at FROM users WHERE email=?",
    [email]
  );
  return hydrateUserRecord(user);
}

async function buildIntranetPayload(userId) {
  const user = await getUserById(userId);
  if (!user) return null;

  const [departmentCatalog, recentDocuments, totalDocumentsRow] = await Promise.all([
    listDepartmentCatalog(),
    all(
      `SELECT id, original_name, stored_name, vector_store_file_id, created_at
         FROM knowledge_sources
        ORDER BY datetime(created_at) DESC, id DESC
        LIMIT 12`
    ),
    get("SELECT COUNT(*) AS total FROM knowledge_sources"),
  ]);

  const workspace = buildIntranetWorkspace({
    user,
    departments: user.department_details || [],
    recentDocuments: recentDocuments.map((document) => ({
      id: document.id,
      name: document.original_name,
      status: document.vector_store_file_id ? 'Sincronizado' : 'Local',
      created_at: document.created_at,
    })),
    totalDocuments: Number(totalDocumentsRow?.total || 0),
  });

  return {
    user,
    department_catalog: departmentCatalog,
    intranet: workspace,
  };
}

async function requireIntranetAccess(req, res, next) {
  const user = await getUserById(req.user.sub);
  if (!user) return res.status(401).json({ error: 'not_authenticated' });
  if (!user.can_access_intranet) return res.status(403).json({ error: 'intranet_access_denied' });
  req.currentUser = user;
  next();
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
  { name: "files", maxCount: 1 },
  { name: "file", maxCount: 1 },
]);

function ragUploadMiddleware(req, res, next) {
  ragUpload(req, res, (err) => {
    if (!err) return next();
    if (err?.code === "LIMIT_FILE_SIZE") {
      return res.status(413).json({ error: "knowledge_file_too_large" });
    }
    if (err?.code === "LIMIT_FILE_COUNT" || err?.code === "LIMIT_PART_COUNT" || err?.code === "LIMIT_UNEXPECTED_FILE") {
      return res.status(400).json({ error: "rag_batch_too_large" });
    }
    return res.status(400).json({ error: err?.message || "rag_upload_failed" });
  });
}

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

  const sessionUser = await getUserById(user.id) || user;
  const token = signSession(sessionUser, JWT_SECRET);
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
  const user = await getUserById(req.user.sub);

  res.json({
    user: user || {
      id: req.user.sub,
      name: req.user.name,
      email: req.user.email,
      role: req.user.role,
      department: req.user.department || '',
      departments: Array.isArray(req.user.departments) ? req.user.departments : [],
      department_details: [],
      can_access_intranet: parseBooleanInput(req.user.can_access_intranet),
    },
  });
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

  const freshUser = await get(
    "SELECT id, name, email, role, department FROM users WHERE id=?",
    [req.user.sub]
  );
  await maybeInsertDailyGreeting(created.lastID, freshUser || req.user);

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

  const inline = String(req.query.inline || "").trim() === "1";
  if (inline) {
    if (file.mime_type) res.type(file.mime_type);
    return res.sendFile(full);
  }

  return res.download(full, file.original_name);
});

app.post("/api/conversations/:id/send", requireAuth(JWT_SECRET), async (req, res) => {
  const id = Number(req.params.id);
  const text = String(req.body?.message || "").trim();
  if (!text) return res.status(400).json({ error: "empty_message" });

  const conv = await get("SELECT * FROM conversations WHERE id=? AND user_id=?", [id, req.user.sub]);
  if (!conv) return res.status(404).json({ error: "not_found" });

  const currentUser = await get(
    "SELECT id, name, email, role, department FROM users WHERE id=?",
    [req.user.sub]
  );
  await maybeInsertDailyGreeting(id, currentUser || req.user);
  if (conv.title === "Nova conversa") {
    await run("UPDATE conversations SET title=? WHERE id=?", [titleFromMessage(text), id]);
  }

  await run(
    "INSERT INTO messages (conversation_id, role, content) VALUES (?, 'user', ?)",
    [id, text]
  );

  const topicSnapshot = await getConversationTopicSnapshot(id, text, 12);
  const userLanguage = detectConversationLanguage(text, topicSnapshot.history);
  const responseProfile = analyzeConversationIntent(text, userLanguage);
  const knowledgeSignature = await getKnowledgeSignatureValue();
  const queryEmbedding = await getEmbeddingForText(text);
  const recentImageReferences = await getRecentImageReferences(id, 4);
  const artifact = await generateArtifact({
    apiKey: process.env.OPENAI_API_KEY || "",
    prompt: text,
    outDir: uploadsDir,
    referenceImages: recentImageReferences,
  }).catch((err) => {
    console.log("Erro na geracao de artefato:", err?.message || err);
    return null;
  });

  if (artifact) {
    if (!artifact.fullPath) {
      const artifactMetaObject = makeStructuredResponseMeta(responseProfile, {
        response_language: userLanguage,
      });
      await run(
        "INSERT INTO messages (conversation_id, role, content, meta_json) VALUES (?, 'assistant', ?, ?)",
        [id, artifact.reply, JSON.stringify(artifactMetaObject)]
      );
      await run("UPDATE conversations SET updated_at=datetime('now') WHERE id=?", [id]);
      await updateConversationMemory(id, text, artifact.reply, { resetMemory: Boolean(topicSnapshot?.topicShift?.isShift) });
      await updateUserMemory(req.user.sub, text, artifact.reply, userLanguage);
      return res.json({ reply: artifact.reply, meta: artifactMetaObject });
    }

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

    await updateConversationMemory(id, text, artifact.reply, { resetMemory: Boolean(topicSnapshot?.topicShift?.isShift) });
    await updateUserMemory(req.user.sub, text, artifact.reply, userLanguage);
    return res.json({ reply: artifact.reply, meta: { ...saved.meta, response_language: userLanguage } });
  }

  const cachedReply = !queryLooksExternalOrCurrent(text)
    ? await findSemanticCache(req.user.sub, text, userLanguage, queryEmbedding, knowledgeSignature)
    : null;

  if (cachedReply?.text) {
    const cachedMetaObject = makeStructuredResponseMeta(responseProfile, {
      response_language: cachedReply.responseLanguage || userLanguage,
      sources: cachedReply.sources || [],
      show_sources: shouldShowSourcesForReply(text),
    });
    await run(
      "INSERT INTO messages (conversation_id, role, content, meta_json) VALUES (?, 'assistant', ?, ?)",
      [id, cachedReply.text, JSON.stringify(cachedMetaObject)]
    );
    await run("UPDATE conversations SET updated_at=datetime('now') WHERE id=?", [id]);
    await updateConversationMemory(id, text, cachedReply.text, { resetMemory: Boolean(topicSnapshot?.topicShift?.isShift) });
    await updateUserMemory(req.user.sub, text, cachedReply.text, userLanguage);
    return res.json({ reply: cachedReply.text, meta: cachedMetaObject });
  }

  const fileContext = await getConversationFilesContext(id);
  const knowledgeBundle = await buildKnowledgeBundle(text, { limit: 4, userLanguage });
  const shouldUseWebComplement = shouldFetchWebContext(text, knowledgeBundle);

  let webContext = "";
  if (shouldUseWebComplement) {
    try {
      webContext = await searchWeb(text);
    } catch (err) {
      console.log("Erro busca web:", err?.message || err);
    }
  }

  const contextText = `
Data atual no Brasil:
${nowBrazil()}

Prioridade de fontes:
1. Base interna da empresa.
2. Arquivos e anexos da conversa.
3. Internet apenas como complemento quando necessario.

Idioma detectado do usuario:
${getLanguageLabel(userLanguage)}

Memoria interna da empresa:
${knowledgeBundle.text || "Sem resultados relevantes da base interna."}

Documentos e imagens da conversa:
${fileContext || "Nenhum anexo recente."}

Contexto externo complementar:
${shouldUseWebComplement
  ? (webContext || "Nenhum resultado externo complementar encontrado.")
  : "Nao foi necessario incluir contexto externo fixo nesta pergunta. Use busca web apenas se faltar contexto interno ou se o usuario pedir atualizacao externa."}
`.trim();
  const assistant = await openaiReply({
    conversationId: id,
    userId: req.user.sub,
    userText: text,
    contextText,
    baseSources: knowledgeBundle.sources,
    topicSnapshot,
    responseProfile,
  });

  const assistantMetaObject = makeStructuredResponseMeta(responseProfile, {
    response_language: userLanguage,
    sources: assistant.sources || [],
    show_sources: shouldShowSourcesForReply(text),
  });

  await run(
    "INSERT INTO messages (conversation_id, role, content, meta_json) VALUES (?, 'assistant', ?, ?)",
    [id, assistant.text, JSON.stringify(assistantMetaObject)]
  );
  await run("UPDATE conversations SET updated_at=datetime('now') WHERE id=?", [id]);
  await updateConversationMemory(id, text, assistant.text, { resetMemory: Boolean(topicSnapshot?.topicShift?.isShift) });
  await updateUserMemory(req.user.sub, text, assistant.text, userLanguage);
  await saveSemanticCache(req.user.sub, text, userLanguage, assistant.text, userLanguage, assistant.sources || [], queryEmbedding, knowledgeSignature);

  res.json({ reply: assistant.text, meta: assistantMetaObject });
});

app.get("/api/admin/departments", requireAuth(JWT_SECRET), requireRole("admin"), async (req, res) => {
  const departments = await listDepartmentCatalog();
  res.json({ departments });
});

app.get("/api/admin/users", requireAuth(JWT_SECRET), requireRole("admin"), async (req, res) => {
  const users = await all(
    "SELECT id, name, email, role, department, can_access_intranet, job_title, unit_name, created_at FROM users ORDER BY id DESC",
    []
  );

  const hydratedUsers = [];
  for (const user of users) {
    hydratedUsers.push(await hydrateUserRecord(user));
  }

  res.json({ users: hydratedUsers });
});

app.post("/api/admin/users", requireAuth(JWT_SECRET), requireRole("admin"), async (req, res) => {
  const name = String(req.body?.name || "").trim();
  const email = String(req.body?.email || "").trim().toLowerCase();
  const password = String(req.body?.password || "");
  const role = req.body?.role === "admin" ? "admin" : "user";
  const departments = sanitizeDepartmentList(parseDepartmentInput(req.body?.departments ?? req.body?.department));
  const canAccessIntranet = parseBooleanInput(req.body?.can_access_intranet);
  const jobTitle = String(req.body?.job_title || "").trim();
  const unitName = String(req.body?.unit_name || "").trim();

  if (!name || !email || !password) {
    return res.status(400).json({ error: "missing_fields" });
  }

  const existing = await get("SELECT id FROM users WHERE email=?", [email]);
  if (existing) return res.status(409).json({ error: "email_already_exists" });

  const hash = await bcrypt.hash(password, 10);
  const primaryDepartment = getPrimaryDepartmentName(departments);
  const created = await run(
    "INSERT INTO users (email, name, password_hash, role, department, can_access_intranet, job_title, unit_name) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    [email, name, hash, role, primaryDepartment || null, canAccessIntranet, jobTitle || null, unitName || null]
  );

  await syncUserDepartments(created.lastID, departments);
  await logEvent(req.user.sub, "admin_create_user", {
    user_id: created.lastID,
    email,
    role,
    departments,
    can_access_intranet: canAccessIntranet,
  });
  res.json({ ok: true, user_id: created.lastID });
});

app.patch("/api/admin/users/:id", requireAuth(JWT_SECRET), requireRole("admin"), async (req, res) => {
  const userId = Number(req.params.id);
  const existingUser = await get(
    "SELECT id, name, email, password_hash, role, department, can_access_intranet, job_title, unit_name FROM users WHERE id=?",
    [userId]
  );
  if (!existingUser) return res.status(404).json({ error: "not_found" });

  const name = String(req.body?.name || existingUser.name || "").trim();
  const email = String(req.body?.email || existingUser.email || "").trim().toLowerCase();
  const password = String(req.body?.password || "");
  const role = req.body?.role === "admin" ? "admin" : (req.body?.role === "user" ? "user" : existingUser.role);
  const hasDepartmentsPayload = Object.prototype.hasOwnProperty.call(req.body || {}, "departments") || Object.prototype.hasOwnProperty.call(req.body || {}, "department");
  const currentDepartments = (await getUserDepartmentDetails(userId)).map((item) => item.name);
  const departments = hasDepartmentsPayload
    ? sanitizeDepartmentList(parseDepartmentInput(req.body?.departments ?? req.body?.department))
    : currentDepartments;
  const canAccessIntranet = Object.prototype.hasOwnProperty.call(req.body || {}, "can_access_intranet")
    ? parseBooleanInput(req.body?.can_access_intranet)
    : coerceDbBoolean(existingUser.can_access_intranet);
  const jobTitle = Object.prototype.hasOwnProperty.call(req.body || {}, "job_title")
    ? String(req.body?.job_title || "").trim()
    : String(existingUser.job_title || "").trim();
  const unitName = Object.prototype.hasOwnProperty.call(req.body || {}, "unit_name")
    ? String(req.body?.unit_name || "").trim()
    : String(existingUser.unit_name || "").trim();

  if (!name || !email) {
    return res.status(400).json({ error: "missing_fields" });
  }

  const emailOwner = await get("SELECT id FROM users WHERE email=?", [email]);
  if (emailOwner && Number(emailOwner.id) !== userId) {
    return res.status(409).json({ error: "email_already_exists" });
  }

  const passwordHash = password ? await bcrypt.hash(password, 10) : existingUser.password_hash;
  const primaryDepartment = getPrimaryDepartmentName(departments);

  await run(
    "UPDATE users SET name=?, email=?, password_hash=?, role=?, department=?, can_access_intranet=?, job_title=?, unit_name=? WHERE id=?",
    [name, email, passwordHash, role, primaryDepartment || null, canAccessIntranet, jobTitle || null, unitName || null, userId]
  );
  await syncUserDepartments(userId, departments);

  const updatedUser = await getUserById(userId);
  if (req.user.sub === userId && updatedUser) {
    setSessionCookie(req, res, signSession(updatedUser, JWT_SECRET));
  }

  await logEvent(req.user.sub, "admin_update_user", {
    user_id: userId,
    email,
    role,
    departments,
    can_access_intranet: canAccessIntranet,
  });

  res.json({ ok: true, user: updatedUser });
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
  const [files, totalRow] = await Promise.all([
    all(
      `SELECT id, original_name, stored_name, openai_file_id, vector_store_file_id, uploaded_by, created_at
         FROM knowledge_sources
        ORDER BY datetime(created_at) DESC, id DESC
        LIMIT 50`
    ),
    get("SELECT COUNT(*) AS total FROM knowledge_sources"),
  ]);

  res.json({ files, total: Number(totalRow?.total || 0) });
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

function getRagUploadFailureStatus(errors = []) {
  const codes = [...new Set((errors || []).map((item) => String(item?.error || '').trim()).filter(Boolean))];
  if (!codes.length) return 500;
  if (codes.every((code) => code === 'knowledge_file_too_large')) return 413;
  if (codes.every((code) => code === 'unsupported_knowledge_file')) return 400;
  return 500;
}

async function ingestKnowledgeUpload(uploaded, userId) {
  const tempPath = uploaded.path || path.join(uploadsDir, uploaded.filename);
  const safeOriginalName = sanitizeFilename(uploaded.originalname || `arquivo-${Date.now()}`);
  const sizeBytes = Number(uploaded.size || 0);

  if (sizeBytes > 25 * 1024 * 1024) {
    throw new Error("knowledge_file_too_large");
  }

  if (!isSupportedKnowledgeUpload(safeOriginalName, uploaded.mimetype || "", tempPath)) {
    throw new Error("unsupported_knowledge_file");
  }

  const duplicate = await findDuplicateKnowledgeUpload({
    sourcePath: tempPath,
    originalName: safeOriginalName,
    mimeType: uploaded.mimetype || "",
    sizeBytes,
  });

  if (duplicate) {
    try {
      if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
    } catch (err) {
      console.log("Erro ao descartar duplicado temporario:", err?.message || err);
    }

    await logEvent(userId, "admin_rag_upload_duplicate", {
      filename: safeOriginalName,
      duplicate_of: duplicate.relPath,
      reason: duplicate.reason,
    });

    return {
      duplicate: true,
      original_name: safeOriginalName,
      duplicate_of: duplicate.relPath,
      duplicate_reason: duplicate.reason,
    };
  }

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
    openaiFile = await uploadFileToOpenAI(
      finalPath,
      safeOriginalName,
      process.env.OPENAI_API_KEY,
      "user_data",
      uploaded.mimetype || "application/octet-stream"
    );
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

app.post("/api/admin/rag/upload", requireAuth(JWT_SECRET), requireRole("admin"), ragUploadMiddleware, async (req, res) => {
  const uploads = getAdminRagUploads(req);
  if (!uploads.length) return res.status(400).json({ error: "missing_file" });

  const files = [];
  const duplicates = [];
  const errors = [];

  for (const uploaded of uploads) {
    try {
      const result = await ingestKnowledgeUpload(uploaded, req.user.sub);
      if (result?.duplicate) {
        duplicates.push(result);
      } else {
        files.push(result);
      }
    } catch (err) {
      console.log("Erro no upload RAG:", err?.message || err);
      errors.push({
        filename: sanitizeFilename(uploaded?.originalname || uploaded?.filename || "arquivo"),
        error: err?.message || "rag_upload_failed",
      });
    }
  }

  if (!files.length && !duplicates.length) {
    return res.status(getRagUploadFailureStatus(errors)).json({
      error: errors[0]?.error || "rag_upload_failed",
      errors,
    });
  }

  const first = files[0] || null;
  return res.status(errors.length ? 207 : 200).json({
    ok: errors.length === 0,
    uploaded_count: files.length,
    duplicate_count: duplicates.length,
    failed_count: errors.length,
    files,
    duplicates,
    errors,
    knowledge_source_id: first?.knowledge_source_id || null,
    local_indexed: first?.local_indexed || false,
    openai_file_id: first?.openai_file_id || null,
    vector_store_file_id: first?.vector_store_file_id || null,
  });
});
const publicDir = path.join(__dirname, "public");

app.get("/api/intranet/bootstrap", requireAuth(JWT_SECRET), requireIntranetAccess, async (req, res) => {
  const payload = await buildIntranetPayload(req.user.sub);
  res.json(payload || { user: null, intranet: null, department_catalog: [] });
});

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

app.get("/intranet.html", async (req, res) => {
  const session = tryDecodeSession(req);
  if (!session) return res.redirect("/login.html");
  const user = await getUserById(session.sub);
  if (!user || !user.can_access_intranet) return res.redirect("/index.html");
  return res.sendFile(path.join(publicDir, "intranet.html"));
});

app.use(express.static(publicDir));

async function startServer() {
  await migrate();
  await ensureAdmin();
  await ensureDepartmentCatalog();
  await syncLegacyUserDepartmentData();
  await ensureFixedDepartments();

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






















































































