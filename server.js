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
const { isAudioFile, isMediaFile, isVideoFile, transcribeAudio, transcribeMedia } = require("./lib/audio");
const {
  attachFileToVectorStore,
  buildOpenAIInputFilePart,
  getOpenAIFileStatus,
  getVectorStoreFileStatus,
  isSupportedOpenAIInputFile,
  uploadFileToOpenAI,
} = require("./lib/rag");
const { searchWeb } = require("./lib/webSearch");
const {
  analyzeBusinessIntent,
  buildBusinessContextBlock,
  buildBusinessInstructions,
  normalizeBusinessText,
} = require("./lib/business");
const {
  DEFAULT_CLOSER_ALIAS_SEEDS,
  SALES_PRIMARY_SHEET,
  extractCloserSheetNames,
  normalizeSalesText,
  parseMatriculasWorkbook,
  readWorkbookFromFile,
} = require("./lib/sales");

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
const SALES_VIEW_DEPARTMENTS = new Set(['comercial', 'gestao', 'administrativo', 'financeiro', 'atendimento']);
const SALES_EDITABLE_FIELDS = ['operational_status', 'follow_up_notes', 'next_action', 'next_action_date', 'observations'];
const SALES_SOURCE_KEY = 'matriculas-novas';

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
  ".mp3",
  ".wav",
  ".m4a",
  ".aac",
  ".ogg",
  ".webm",
  ".flac",
  ".wma",
  ".mp4",
  ".mov",
  ".avi",
  ".mkv",
  ".m4v",
  ".mpeg",
  ".mpg",
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
  ".mp3": 25 * 1024 * 1024,
  ".wav": 25 * 1024 * 1024,
  ".m4a": 25 * 1024 * 1024,
  ".aac": 25 * 1024 * 1024,
  ".ogg": 25 * 1024 * 1024,
  ".webm": 25 * 1024 * 1024,
  ".flac": 25 * 1024 * 1024,
  ".wma": 25 * 1024 * 1024,
  ".mp4": 25 * 1024 * 1024,
  ".mov": 25 * 1024 * 1024,
  ".avi": 25 * 1024 * 1024,
  ".mkv": 25 * 1024 * 1024,
  ".m4v": 25 * 1024 * 1024,
  ".mpeg": 25 * 1024 * 1024,
  ".mpg": 25 * 1024 * 1024,
};
const MEDIA_EXTS = new Set([".mp3", ".wav", ".m4a", ".aac", ".ogg", ".webm", ".flac", ".wma", ".mp4", ".mov", ".avi", ".mkv", ".m4v", ".mpeg", ".mpg"]);
const MEMORY_ENTRY_MIN_SIMILARITY = 0.43;
const MAX_MEMORY_CANDIDATES = 120;

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

function safeJsonStringify(value, fallback = "{}") {
  try {
    return JSON.stringify(value);
  } catch {
    return fallback;
  }
}

function createKnowledgeProcessingState(overrides = {}) {
  return {
    upload: { status: "pending" },
    parsing: { status: "pending" },
    chunking: { status: "pending" },
    embedding: { status: "pending" },
    vector_store: { status: OPENAI_VECTOR_STORE_ID ? "pending" : "skipped" },
    health: { status: "pending", issues: [] },
    transcript: { status: "skipped" },
    final: {
      status: "pending",
      available_to_ai: false,
      message: "Aguardando processamento.",
    },
    ...overrides,
  };
}

function getKnowledgeProcessingState(record) {
  const parsed = safeJsonParse(record?.processing_state_json || "{}");
  return parsed && typeof parsed === "object"
    ? parsed
    : createKnowledgeProcessingState();
}

function hasPersistedKnowledgeStages(record) {
  const raw = String(record?.processing_state_json || "").trim();
  if (!raw || raw === "{}") return false;
  const parsed = safeJsonParse(raw);
  if (!parsed || typeof parsed !== "object") return false;
  return ["parsing", "chunking", "embedding", "vector_store", "transcript"].some((key) => parsed[key] && typeof parsed[key] === "object");
}

function normalizeStageStatus(value, fallback = "pending") {
  const safe = String(value || "").trim().toLowerCase();
  return safe || fallback;
}

function withKnowledgeStage(state, stageKey, patch = {}) {
  const current = state && typeof state === "object" ? { ...state } : createKnowledgeProcessingState();
  const previous = current[stageKey] && typeof current[stageKey] === "object" ? current[stageKey] : {};
  current[stageKey] = {
    ...previous,
    ...patch,
    status: normalizeStageStatus(patch.status || previous.status || "pending"),
    updated_at: new Date().toISOString(),
  };
  return current;
}

function detectKnowledgeTextIssues(text = "") {
  const safe = String(text || "");
  const issues = [];

  if (!safe.trim()) {
    issues.push("sem_texto_extraido");
  }

  if (/[�]/.test(safe)) {
    issues.push("caractere_corrompido");
  }

  if (/(?:Ã.|Â.|ðŸ|�)/.test(safe)) {
    issues.push("encoding_suspeito");
  }

  if (safe.trim() && safe.replace(/\s+/g, "").length < 32) {
    issues.push("texto_muito_curto");
  }

  return [...new Set(issues)];
}

function finalizeKnowledgeProcessingState(state, extras = {}) {
  const safeState = state && typeof state === "object" ? { ...state } : createKnowledgeProcessingState();
  const parsingStatus = normalizeStageStatus(safeState.parsing?.status);
  const chunkStatus = normalizeStageStatus(safeState.chunking?.status);
  const embeddingStatus = normalizeStageStatus(safeState.embedding?.status);
  const vectorStatus = normalizeStageStatus(safeState.vector_store?.status, OPENAI_VECTOR_STORE_ID ? "pending" : "skipped");
  const transcriptStatus = normalizeStageStatus(safeState.transcript?.status, "skipped");
  const issues = Array.isArray(safeState.health?.issues) ? [...new Set(safeState.health.issues)] : [];

  const localReady = parsingStatus === "completed" && chunkStatus === "completed" && embeddingStatus === "completed";
  const vectorReady = !OPENAI_VECTOR_STORE_ID || vectorStatus === "completed" || vectorStatus === "skipped";
  const hasFailure = ["failed"].includes(parsingStatus)
    || ["failed"].includes(chunkStatus)
    || ["failed"].includes(embeddingStatus)
    || ["failed"].includes(vectorStatus)
    || ["failed"].includes(transcriptStatus);

  let finalStatus = "processing";
  let message = "Processando conhecimento.";
  if (hasFailure) {
    finalStatus = "failed";
    message = "Houve falha em uma ou mais etapas do processamento.";
  } else if (localReady && vectorReady) {
    finalStatus = "available";
    message = "Disponivel para uso da IA.";
  }

  safeState.health = {
    status: issues.length ? "warning" : (finalStatus === "failed" ? "failed" : "healthy"),
    issues,
    checked_at: new Date().toISOString(),
  };
  safeState.final = {
    status: finalStatus,
    available_to_ai: finalStatus === "available",
    message,
    ...extras,
  };
  return safeState;
}

function extractKnowledgeLastError(state) {
  const safeState = state && typeof state === "object" ? state : {};
  const stages = ["upload", "parsing", "transcript", "chunking", "embedding", "vector_store"];
  for (const stageKey of stages) {
    const stage = safeState[stageKey];
    if (stage?.status === "failed") {
      return stage.message || stage.error || `${stageKey}_failed`;
    }
  }
  return "";
}

async function appendKnowledgeProcessingLog(knowledgeSourceId, stageKey, stageStatus, message = "", detail = {}, actorUserId = null) {
  if (!knowledgeSourceId) return;
  await run(
    "INSERT INTO knowledge_processing_logs (knowledge_source_id, stage_key, stage_status, message, detail_json, actor_user_id) VALUES (?, ?, ?, ?, ?, ?)",
    [
      knowledgeSourceId,
      stageKey,
      stageStatus,
      message || null,
      detail && Object.keys(detail).length ? safeJsonStringify(detail, "{}") : null,
      actorUserId || null,
    ]
  );
}

async function updateKnowledgeSourceState(knowledgeSourceId, state, syncStatus = null) {
  if (!knowledgeSourceId) return;
  const finalized = finalizeKnowledgeProcessingState(state);
  const nextSyncStatus = syncStatus
    || (finalized.final?.available_to_ai
      ? "available"
      : finalized.final?.status === "failed"
        ? "failed"
        : "processing");

  await run(
    "UPDATE knowledge_sources SET processing_state_json=?, sync_status=?, updated_at=datetime('now') WHERE id=?",
    [safeJsonStringify(finalized, "{}"), nextSyncStatus, knowledgeSourceId]
  );
}

async function updateKnowledgeSourceFields(knowledgeSourceId, fields = {}) {
  const entries = Object.entries(fields).filter(([, value]) => value !== undefined);
  if (!knowledgeSourceId || !entries.length) return;

  const columns = entries.map(([key]) => `${key}=?`).join(", ");
  const values = entries.map(([, value]) => value);
  values.push(knowledgeSourceId);

  await run(
    `UPDATE knowledge_sources SET ${columns}, updated_at=datetime('now') WHERE id=?`,
    values
  );
}

async function getKnowledgeSourceById(knowledgeSourceId) {
  return await get(
    `SELECT id, original_name, stored_name, mime_type, language, content_hash, department_name, source_kind,
            sync_status, openai_file_id, vector_store_file_id, uploaded_by, processing_state_json, created_at, updated_at
       FROM knowledge_sources
      WHERE id=?`,
    [knowledgeSourceId]
  );
}

function getKnowledgeSourceFullPath(source) {
  if (!source?.stored_name) return "";
  return path.join(knowledgeDir, source.stored_name);
}

function getKnowledgeUploadExt(filePath, originalName = "", mimeType = "") {
  return detectExt(filePath, originalName, mimeType) || path.extname(String(filePath || "")).toLowerCase() || ".bin";
}

function isMediaKnowledgeFile(originalName = "", mimeType = "", filePath = "") {
  const ext = getKnowledgeUploadExt(filePath, originalName, mimeType);
  return MEDIA_EXTS.has(ext) || isMediaFile(originalName || filePath, mimeType);
}

function buildTranscriptStorageName(storedName = "") {
  const base = path.basename(storedName, path.extname(storedName));
  return `${base}.transcript.txt`;
}

function getTranscriptFilePathForKnowledge(storedName = "") {
  return path.join(knowledgeDir, buildTranscriptStorageName(storedName));
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

function parseAliasInput(value) {
  if (Array.isArray(value)) return value;
  const safe = String(value || '').trim();
  if (!safe) return [];
  return safe.split(/[\n,;]+/g).map((item) => item.trim()).filter(Boolean);
}

function formatDepartmentNames(departments = []) {
  const safe = sanitizeDepartmentList(departments);
  return safe.join(", ");
}

function normalizeDepartmentValue(value = "") {
  return normalizeBusinessText(sanitizeDepartment(value || "") || "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function slugifyDepartmentName(value = "") {
  return normalizeDepartmentValue(value).replace(/\s+/g, "-");
}

function coerceDbBoolean(value) {
  return value === true || value === 1 || value === "1" || value === "true";
}

function mapDepartmentRow(row) {
  if (!row) return null;
  return {
    ...row,
    is_active: row.is_active === undefined ? true : coerceDbBoolean(row.is_active),
    metadata: safeJsonParse(row.metadata_json || '{}') || {},
  };
}

async function listDepartmentCatalog(options = {}) {
  const includeInactive = Boolean(options.includeInactive);
  const rows = await all(
    `SELECT id, slug, name, description, icon, is_active, sort_order, metadata_json, created_at, updated_at
       FROM departments
      ${includeInactive ? '' : 'WHERE COALESCE(is_active, 1) = 1'}
      ORDER BY sort_order ASC, name ASC`
  );
  return rows.map(mapDepartmentRow).filter(Boolean);
}

async function getDepartmentCatalogLookup(options = {}) {
  const map = new Map();
  const rows = await listDepartmentCatalog({ includeInactive: options.includeInactive });
  for (const row of rows) {
    const keys = [row.name, row.slug].map((value) => normalizeDepartmentValue(value));
    for (const key of keys) {
      if (key) map.set(key, row);
    }
  }
  return map;
}

async function resolveDepartmentNames(departmentValues = [], options = {}) {
  const rawValues = Array.isArray(departmentValues)
    ? departmentValues
    : parseDepartmentInput(departmentValues);
  const requested = sanitizeDepartmentList(rawValues);
  const lookup = await getDepartmentCatalogLookup({ includeInactive: Boolean(options.includeInactive) });
  const resolved = [];
  const seen = new Set();

  for (const item of requested) {
    const key = normalizeDepartmentValue(item);
    if (!key || seen.has(key)) continue;
    const match = lookup.get(key);
    if (!match) continue;
    seen.add(key);
    resolved.push(match.name);
  }

  return resolved;
}

async function getDepartmentIdMap(options = {}) {
  const rows = await listDepartmentCatalog({ includeInactive: options.includeInactive });
  const map = new Map();
  for (const row of rows) {
    map.set(row.name, row);
    const normalizedName = normalizeDepartmentValue(row.name);
    const normalizedSlug = normalizeDepartmentValue(row.slug);
    if (normalizedName) map.set(normalizedName, row);
    if (normalizedSlug) map.set(normalizedSlug, row);
  }
  return map;
}

async function getUserDepartmentDetails(userId, options = {}) {
  const includeInactive = Boolean(options.includeInactive);
  const rows = await all(
    `SELECT d.id, d.slug, d.name, d.description, d.icon, d.is_active, d.sort_order, d.metadata_json,
            ud.access_level, ud.is_primary
       FROM user_departments ud
       JOIN departments d ON d.id = ud.department_id
      WHERE ud.user_id=?
        ${includeInactive ? '' : 'AND COALESCE(d.is_active, 1) = 1'}
      ORDER BY ud.is_primary DESC, d.sort_order ASC, d.name ASC`,
    [userId]
  );

  return rows.map((row) => ({
    ...mapDepartmentRow(row),
    is_primary: coerceDbBoolean(row.is_primary),
  }));
}

async function hydrateUserRecord(user) {
  if (!user) return null;
  const details = await getUserDepartmentDetails(user.id || user.sub, { includeInactive: true });
  const departments = details.filter((item) => item.is_active !== false).map((item) => item.name);
  const fallbackDepartments = details.map((item) => item.name);
  const primaryDepartment = user.department || getPrimaryDepartmentName(departments) || getPrimaryDepartmentName(fallbackDepartments);
  return {
    ...user,
    department: primaryDepartment,
    departments,
    department_details: details,
    can_access_intranet: coerceDbBoolean(user.can_access_intranet),
  };
}

async function syncUserDepartments(userId, departmentValues = []) {
  const safeDepartments = await resolveDepartmentNames(departmentValues, { includeInactive: false });
  const catalogMap = await getDepartmentIdMap({ includeInactive: false });
  const existing = await getUserDepartmentDetails(userId, { includeInactive: true });
  const existingByName = new Map(existing.map((item) => [item.name, item]));

  for (const row of existing) {
    if (!safeDepartments.includes(row.name)) {
      await run("DELETE FROM user_departments WHERE user_id=? AND department_id=?", [userId, row.id]);
    }
  }

  for (let index = 0; index < safeDepartments.length; index += 1) {
    const name = safeDepartments[index];
    const department = catalogMap.get(name) || catalogMap.get(normalizeDepartmentValue(name));
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
      `INSERT INTO departments (slug, name, description, icon, is_active, sort_order, metadata_json, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(slug) DO UPDATE SET
         name=excluded.name,
         description=excluded.description,
         icon=excluded.icon,
         is_active=excluded.is_active,
         sort_order=excluded.sort_order,
         metadata_json=excluded.metadata_json,
         updated_at=datetime('now')`,
      [row.slug, row.name, row.description, row.icon, row.isActive ? 1 : 0, row.sortOrder, row.metadataJson]
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

async function ensureSalesImportSource() {
  const existing = await get('SELECT id, source_key, name, source_type, sheet_name, status, config_json, last_imported_at FROM sales_import_sources WHERE source_key=? LIMIT 1', [SALES_SOURCE_KEY]);
  if (existing) return existing;

  const created = await run(
    "INSERT INTO sales_import_sources (source_key, name, source_type, sheet_name, status, config_json) VALUES (?, ?, 'manual_upload', ?, 'active', ?)",
    [SALES_SOURCE_KEY, 'Planilha de matriculas novas', SALES_PRIMARY_SHEET, JSON.stringify({ transition_mode: 'spreadsheet_to_intranet' })]
  );

  return get('SELECT id, source_key, name, source_type, sheet_name, status, config_json, last_imported_at FROM sales_import_sources WHERE id=?', [created.lastID]);
}

function normalizeCloserValue(value = '') {
  return normalizeSalesText(value || '').replace(/\s+/g, ' ').trim();
}

function normalizeSqlTextValue(value) {
  return value === null || value === undefined ? '' : String(value).trim();
}

function listSalesImportedFields() {
  return [
    'student_name',
    'course_name',
    'sale_month',
    'sale_date',
    'semester_label',
    'availability',
    'modality',
    'class_type',
    'system_name',
    'contract_status',
    'language',
    'closer_original',
    'closer_normalized',
    'closer_id',
    'user_id',
    'media_source',
    'profession',
    'indication',
    'source_payload_json',
    'row_hash',
    'source_workbook',
    'source_sheet',
    'source_row_number',
    'source_row_identifier',
  ];
}

async function logEntityChange({
  entityType,
  entityId,
  action,
  fieldName = null,
  oldValue = null,
  newValue = null,
  actorUserId = null,
  closerId = null,
  origin = 'system',
  detail = null,
}) {
  return run(
    'INSERT INTO entity_change_log (entity_type, entity_id, action, field_name, old_value, new_value, actor_user_id, closer_id, origin, detail_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [
      entityType,
      entityId,
      action,
      fieldName,
      oldValue === undefined ? null : oldValue,
      newValue === undefined ? null : newValue,
      actorUserId,
      closerId,
      origin,
      detail ? JSON.stringify(detail) : null,
    ]
  );
}

async function ensureCloserRecord(payload = {}, options = {}) {
  const officialName = String(payload.official_name || payload.name || '').trim();
  if (!officialName) return null;

  const displayName = String(payload.display_name || officialName).trim() || officialName;
  const status = String(payload.status || 'active').trim() || 'active';
  const notes = String(payload.notes || '').trim() || null;
  const userId = payload.user_id ? Number(payload.user_id) : null;
  const aliases = Array.isArray(payload.aliases) ? payload.aliases : [];

  let closer = await get('SELECT id, official_name, display_name, user_id, status, notes, created_at, updated_at FROM closers WHERE lower(official_name)=lower(?) LIMIT 1', [officialName]);
  if (!closer) {
    const created = await run(
      "INSERT INTO closers (official_name, display_name, user_id, status, notes, updated_at) VALUES (?, ?, ?, ?, ?, datetime('now'))",
      [officialName, displayName, userId, status, notes]
    );
    closer = await get('SELECT id, official_name, display_name, user_id, status, notes, created_at, updated_at FROM closers WHERE id=?', [created.lastID]);
    if (options.actorUserId) {
      await logEvent(options.actorUserId, 'admin_create_closer', { closer_id: closer.id, official_name: officialName });
    }
  } else {
    await run(
      "UPDATE closers SET display_name=?, user_id=?, status=?, notes=?, updated_at=datetime('now') WHERE id=?",
      [displayName, userId, status, notes, closer.id]
    );
    closer = await get('SELECT id, official_name, display_name, user_id, status, notes, created_at, updated_at FROM closers WHERE id=?', [closer.id]);
  }

  for (const alias of aliases) {
    const safeAlias = String(alias || '').trim();
    if (!safeAlias) continue;
    const existingAlias = await get('SELECT id, closer_id FROM closer_aliases WHERE lower(alias_name)=lower(?) LIMIT 1', [safeAlias]);
    if (existingAlias) {
      if (Number(existingAlias.closer_id) !== Number(closer.id)) continue;
    } else {
      await run(
        "INSERT INTO closer_aliases (closer_id, alias_name, origin, updated_at) VALUES (?, ?, ?, datetime('now'))",
        [closer.id, safeAlias, String(options.aliasOrigin || 'seed').trim() || 'seed']
      );
    }
  }

  return closer;
}

async function ensureDefaultCloserCatalog() {
  await ensureSalesImportSource();
  for (const seed of DEFAULT_CLOSER_ALIAS_SEEDS) {
    await ensureCloserRecord({
      official_name: seed.official_name,
      display_name: seed.official_name,
      aliases: [seed.alias_name],
      status: 'active',
    }, { aliasOrigin: seed.origin || 'bootstrap' });
  }
}

async function syncClosersFromWorkbook(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return [];
  const workbook = readWorkbookFromFile(filePath);
  const sheetNames = extractCloserSheetNames(workbook);
  const synced = [];
  for (const officialName of sheetNames) {
    const closer = await ensureCloserRecord({ official_name: officialName, display_name: officialName, status: 'active' }, { aliasOrigin: 'post_sale_workbook' });
    if (closer) synced.push(closer.official_name);
  }
  return synced;
}

async function listClosers(options = {}) {
  const includeInactive = Boolean(options.includeInactive);
  const rows = await all(
    `SELECT c.id, c.official_name, c.display_name, c.user_id, c.status, c.notes, c.created_at, c.updated_at,
            u.name AS user_name, u.email AS user_email
       FROM closers c
       LEFT JOIN users u ON u.id = c.user_id
      ${includeInactive ? '' : "WHERE c.status <> 'inactive'"}
      ORDER BY c.official_name ASC`
  );
  const aliases = await all('SELECT id, closer_id, alias_name, origin, created_at, updated_at FROM closer_aliases ORDER BY alias_name ASC');
  const aliasMap = new Map();
  for (const alias of aliases) {
    if (!aliasMap.has(Number(alias.closer_id))) aliasMap.set(Number(alias.closer_id), []);
    aliasMap.get(Number(alias.closer_id)).push(alias);
  }
  return rows.map((row) => ({
    ...row,
    aliases: aliasMap.get(Number(row.id)) || [],
  }));
}

async function getCloserCatalog() {
  const closers = await listClosers({ includeInactive: false });
  const byNormalized = new Map();
  for (const closer of closers) {
    const keys = [closer.official_name, closer.display_name, ...(closer.aliases || []).map((alias) => alias.alias_name)]
      .map((value) => normalizeCloserValue(value))
      .filter(Boolean);
    for (const key of keys) {
      if (!byNormalized.has(key)) byNormalized.set(key, closer);
    }
  }
  return { closers, byNormalized };
}

async function resolveCloserMatch(rawName = '', catalog = null) {
  const normalized = normalizeCloserValue(rawName);
  if (!normalized) return { normalizedName: '', closer: null };
  const safeCatalog = catalog || await getCloserCatalog();
  let closer = safeCatalog.byNormalized.get(normalized) || null;

  if (!closer) {
    const users = await all('SELECT id, name FROM users ORDER BY name ASC');
    const exactMatches = users.filter((item) => normalizeCloserValue(item.name) === normalized);
    const prefixMatches = users.filter((item) => normalizeCloserValue(item.name).startsWith(normalized));
    const userMatch = exactMatches[0] || (prefixMatches.length === 1 ? prefixMatches[0] : null);

    if (userMatch) {
      const aliasList = normalizeCloserValue(userMatch.name) === normalized ? [] : [String(rawName || '').trim()];
      closer = await ensureCloserRecord({
        official_name: userMatch.name,
        display_name: userMatch.name,
        user_id: userMatch.id,
        status: 'active',
        aliases: aliasList,
      }, { aliasOrigin: 'auto_user_match' });
    }
  }

  return {
    normalizedName: closer?.official_name || String(rawName || '').trim(),
    closer,
  };
}

async function replaceCloserAliases(closerId, aliasValues = [], origin = 'manual') {
  const safeCloserId = Number(closerId);
  if (!safeCloserId) return [];
  const aliases = Array.isArray(aliasValues) ? aliasValues : [];
  const normalized = [];
  const seen = new Set();
  for (const alias of aliases) {
    const safeAlias = String(alias || '').trim();
    const key = normalizeCloserValue(safeAlias);
    if (!safeAlias || !key || seen.has(key)) continue;
    seen.add(key);
    normalized.push(safeAlias);
  }

  const existing = await all('SELECT id, alias_name FROM closer_aliases WHERE closer_id=? ORDER BY id ASC', [safeCloserId]);
  const existingMap = new Map(existing.map((item) => [normalizeCloserValue(item.alias_name), item]));

  for (const item of existing) {
    if (!seen.has(normalizeCloserValue(item.alias_name))) {
      await run('DELETE FROM closer_aliases WHERE id=?', [item.id]);
    }
  }

  for (const alias of normalized) {
    const key = normalizeCloserValue(alias);
    if (existingMap.has(key)) {
      await run("UPDATE closer_aliases SET alias_name=?, origin=?, updated_at=datetime('now') WHERE id=?", [alias, origin, existingMap.get(key).id]);
      continue;
    }

    const conflict = await get('SELECT id, closer_id FROM closer_aliases WHERE lower(alias_name)=lower(?) LIMIT 1', [alias]);
    if (conflict && Number(conflict.closer_id) !== safeCloserId) continue;
    if (!conflict) {
      await run("INSERT INTO closer_aliases (closer_id, alias_name, origin, updated_at) VALUES (?, ?, ?, datetime('now'))", [safeCloserId, alias, origin]);
    }
  }

  return all('SELECT id, closer_id, alias_name, origin, created_at, updated_at FROM closer_aliases WHERE closer_id=? ORDER BY alias_name ASC', [safeCloserId]);
}

async function saveCloser(payload = {}, actorUserId = null) {
  const closerId = Number(payload.id || 0);
  const officialName = String(payload.official_name || '').trim();
  const displayName = String(payload.display_name || officialName).trim() || officialName;
  const status = String(payload.status || 'active').trim() || 'active';
  const userId = payload.user_id ? Number(payload.user_id) : null;
  const notes = String(payload.notes || '').trim() || null;
  const aliases = Array.isArray(payload.aliases) ? payload.aliases : [];

  if (!officialName) {
    throw new Error('missing_closer_name');
  }

  const conflict = await get('SELECT id FROM closers WHERE lower(official_name)=lower(?) AND id<>? LIMIT 1', [officialName, closerId || 0]);
  if (conflict) throw new Error('closer_name_conflict');

  let id = closerId;
  if (id) {
    await run(
      "UPDATE closers SET official_name=?, display_name=?, user_id=?, status=?, notes=?, updated_at=datetime('now') WHERE id=?",
      [officialName, displayName, userId, status, notes, id]
    );
    if (actorUserId) {
      await logEvent(actorUserId, 'admin_update_closer', { closer_id: id, official_name: officialName, user_id: userId, status });
    }
  } else {
    const created = await run(
      "INSERT INTO closers (official_name, display_name, user_id, status, notes, updated_at) VALUES (?, ?, ?, ?, ?, datetime('now'))",
      [officialName, displayName, userId, status, notes]
    );
    id = created.lastID;
    if (actorUserId) {
      await logEvent(actorUserId, 'admin_create_closer', { closer_id: id, official_name: officialName, user_id: userId, status });
    }
  }

  await replaceCloserAliases(id, aliases, 'admin');
  const closer = (await listClosers({ includeInactive: true })).find((item) => Number(item.id) === Number(id));
  return closer || null;
}

function getUserDepartmentKeySet(user = {}) {
  return new Set((user.departments || []).map((item) => normalizeDepartmentValue(item)).filter(Boolean));
}

async function getSalesAccessScope(user) {
  if (!user) {
    return { enabled: false, canViewAll: false, canEditAll: false, closer: null };
  }
  const departmentKeys = [...getUserDepartmentKeySet(user)];
  const canViewAll = user.role === 'admin' || departmentKeys.some((key) => SALES_VIEW_DEPARTMENTS.has(key));
  const closer = await get('SELECT id, official_name, display_name, user_id, status FROM closers WHERE user_id=? AND status<>? LIMIT 1', [user.id || user.sub, 'inactive']);
  return {
    enabled: canViewAll || Boolean(closer),
    canViewAll,
    canEditAll: user.role === 'admin',
    closer,
  };
}

function buildSalesWhereClause(scope, filters = {}) {
  const clauses = [];
  const params = [];

  if (!scope.canViewAll) {
    if (scope.closer?.id) {
      clauses.push('sr.closer_id=?');
      params.push(scope.closer.id);
    } else {
      clauses.push('1=0');
    }
  }

  if (filters.closerId) {
    clauses.push('sr.closer_id=?');
    params.push(Number(filters.closerId));
  }

  if (filters.status) {
    clauses.push('lower(sr.operational_status)=lower(?)');
    params.push(String(filters.status).trim());
  }

  if (filters.search) {
    const search = `%${String(filters.search).trim()}%`;
    clauses.push("(lower(coalesce(sr.student_name, '')) LIKE lower(?) OR lower(coalesce(sr.course_name, '')) LIKE lower(?) OR lower(coalesce(sr.closer_original, '')) LIKE lower(?) OR lower(coalesce(sr.media_source, '')) LIKE lower(?))");
    params.push(search, search, search, search);
  }

  return {
    sql: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '',
    params,
  };
}

async function getSalesSummaryForScope(scope, filters = {}) {
  const where = buildSalesWhereClause(scope, filters);
  const limit = Math.min(200, Math.max(1, Number(filters.limit || 80)));
  const [rows, totalRow, closerTotals, statusTotals] = await Promise.all([
    all(
      `SELECT sr.id, sr.student_name, sr.course_name, sr.sale_date, sr.modality, sr.language, sr.media_source, sr.operational_status,
              sr.closer_original, sr.closer_normalized, sr.closer_id, sr.user_id, sr.updated_at,
              COALESCE(c.display_name, c.official_name, sr.closer_normalized, sr.closer_original, 'Sem closer') AS closer_name
         FROM sales_records sr
         LEFT JOIN closers c ON c.id = sr.closer_id
         ${where.sql}
         ORDER BY COALESCE(sr.sale_date, sr.created_at) DESC, sr.id DESC
         LIMIT ?`,
      [...where.params, limit]
    ),
    get(
      `SELECT COUNT(*) AS total
         FROM sales_records sr
         LEFT JOIN closers c ON c.id = sr.closer_id
         ${where.sql}`,
      where.params
    ),
    all(
      `SELECT sr.closer_id,
              COALESCE(c.display_name, c.official_name, sr.closer_normalized, sr.closer_original, 'Sem closer') AS closer_name,
              COUNT(*) AS total
         FROM sales_records sr
         LEFT JOIN closers c ON c.id = sr.closer_id
         ${where.sql}
        GROUP BY sr.closer_id, COALESCE(c.display_name, c.official_name, sr.closer_normalized, sr.closer_original, 'Sem closer')
        ORDER BY COUNT(*) DESC, closer_name ASC`,
      where.params
    ),
    all(
      `SELECT COALESCE(sr.operational_status, 'Novo') AS status_name, COUNT(*) AS total
         FROM sales_records sr
         LEFT JOIN closers c ON c.id = sr.closer_id
         ${where.sql}
        GROUP BY COALESCE(sr.operational_status, 'Novo')
        ORDER BY COUNT(*) DESC, status_name ASC`,
      where.params
    ),
  ]);

  const groupedRecent = new Map();
  for (const row of rows) {
    const key = `${row.closer_id || 'none'}:${row.closer_name || 'Sem closer'}`;
    if (!groupedRecent.has(key)) groupedRecent.set(key, []);
    if (groupedRecent.get(key).length < 5) groupedRecent.get(key).push(row);
  }

  const totals = {
    total: Number(totalRow?.total || 0),
    by_closer: closerTotals.map((item) => {
      const key = `${item.closer_id || 'none'}:${item.closer_name || 'Sem closer'}`;
      return {
        closer_id: item.closer_id || null,
        closer_name: item.closer_name || 'Sem closer',
        total: Number(item.total || 0),
        recent_records: groupedRecent.get(key) || [],
      };
    }),
    statuses: statusTotals.reduce((acc, item) => {
      acc[String(item.status_name || 'Novo').trim() || 'Novo'] = Number(item.total || 0);
      return acc;
    }, {}),
  };

  return {
    totals,
    records: rows,
  };
}

async function getSalesRecordById(recordId) {
  return get(
    `SELECT sr.*, COALESCE(c.display_name, c.official_name) AS closer_name,
            u.name AS responsible_user_name,
            m.name AS last_modified_by_name
       FROM sales_records sr
       LEFT JOIN closers c ON c.id = sr.closer_id
       LEFT JOIN users u ON u.id = sr.user_id
       LEFT JOIN users m ON m.id = sr.last_modified_by
      WHERE sr.id=?`,
    [recordId]
  );
}

function serializeSalesRecord(record) {
  if (!record) return null;
  return {
    ...record,
    source_payload: safeJsonParse(record.source_payload_json || '{}') || null,
    custom_fields: safeJsonParse(record.custom_fields_json || '{}') || null,
  };
}

async function getSalesRecordHistory(recordId) {
  const rows = await all(
    `SELECT l.id, l.entity_type, l.entity_id, l.action, l.field_name, l.old_value, l.new_value, l.origin, l.detail_json, l.created_at,
            l.actor_user_id, u.name AS actor_name, c.official_name AS closer_name
       FROM entity_change_log l
       LEFT JOIN users u ON u.id = l.actor_user_id
       LEFT JOIN closers c ON c.id = l.closer_id
      WHERE l.entity_type='sales_record' AND l.entity_id=?
      ORDER BY datetime(l.created_at) DESC, l.id DESC`,
    [recordId]
  );
  return rows.map((row) => ({ ...row, detail: safeJsonParse(row.detail_json || '{}') || null }));
}

async function updateSalesRecord(recordId, payload = {}, actorUser) {
  const existing = await getSalesRecordById(recordId);
  if (!existing) throw new Error('not_found');

  const scope = await getSalesAccessScope(actorUser);
  const actorId = actorUser.id || actorUser.sub;
  const canEdit = scope.canEditAll || Number(existing.user_id || 0) === Number(actorId);
  if (!canEdit) throw new Error('forbidden');

  const updates = {};
  for (const field of SALES_EDITABLE_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(payload || {}, field)) {
      updates[field] = String(payload[field] ?? '').trim() || null;
    }
  }

  if (!Object.keys(updates).length) {
    return serializeSalesRecord(existing);
  }

  const merged = { ...existing, ...updates };
  await run(
    "UPDATE sales_records SET operational_status=?, follow_up_notes=?, next_action=?, next_action_date=?, observations=?, last_modified_by=?, updated_at=datetime('now') WHERE id=?",
    [
      merged.operational_status || 'Novo',
      merged.follow_up_notes,
      merged.next_action,
      merged.next_action_date,
      merged.observations,
      actorId,
      recordId,
    ]
  );

  for (const [field, nextValue] of Object.entries(updates)) {
    const previousValue = existing[field] ?? null;
    if (normalizeSqlTextValue(previousValue) === normalizeSqlTextValue(nextValue)) continue;
    await logEntityChange({
      entityType: 'sales_record',
      entityId: recordId,
      action: 'field_update',
      fieldName: field,
      oldValue: previousValue,
      newValue: nextValue,
      actorUserId: actorId,
      closerId: existing.closer_id || null,
      origin: 'manual_edit',
      detail: { source: 'intranet_sales_editor' },
    });
  }

  await logEvent(actorId, 'sales_record_update', { record_id: recordId, fields: Object.keys(updates) });
  return serializeSalesRecord(await getSalesRecordById(recordId));
}

async function recordSalesImportChange(existing, nextValues, actorUserId, origin) {
  for (const field of listSalesImportedFields()) {
    const previousValue = existing[field] ?? null;
    const nextValue = nextValues[field] ?? null;
    if (normalizeSqlTextValue(previousValue) === normalizeSqlTextValue(nextValue)) continue;
    await logEntityChange({
      entityType: 'sales_record',
      entityId: existing.id,
      action: 'import_sync',
      fieldName: field,
      oldValue: previousValue,
      newValue: nextValue,
      actorUserId,
      closerId: nextValues.closer_id || existing.closer_id || null,
      origin,
      detail: { source_workbook: nextValues.source_workbook, source_sheet: nextValues.source_sheet },
    });
  }
}

async function importSalesWorkbookBatch({ salesWorkbookPath, salesWorkbookName, postSaleWorkbookPath = '', postSaleWorkbookName = '', actorUserId = null }) {
  if (!salesWorkbookPath || !fs.existsSync(salesWorkbookPath)) {
    throw new Error('missing_sales_workbook');
  }

  const source = await ensureSalesImportSource();
  await ensureDefaultCloserCatalog();
  const syncedCloserNames = postSaleWorkbookPath ? await syncClosersFromWorkbook(postSaleWorkbookPath) : [];
  const closerCatalog = await getCloserCatalog();
  const parsed = parseMatriculasWorkbook(readWorkbookFromFile(salesWorkbookPath), {
    workbookName: salesWorkbookName || path.basename(salesWorkbookPath),
    sheetName: SALES_PRIMARY_SHEET,
  });

  const runResult = await run(
    "INSERT INTO sales_import_runs (source_id, origin_type, source_workbook, post_sale_workbook, source_sheet, total_rows, status, triggered_by, summary_json, updated_at) VALUES (?, 'manual_upload', ?, ?, ?, ?, 'running', ?, ?, datetime('now'))",
    [
      source?.id || null,
      parsed.workbook_name,
      postSaleWorkbookName ? path.basename(postSaleWorkbookName) : (postSaleWorkbookPath ? path.basename(postSaleWorkbookPath) : null),
      parsed.sheet_name,
      parsed.records.length,
      actorUserId,
      JSON.stringify({ synced_closers: syncedCloserNames }),
    ]
  );

  const importRunId = runResult.lastID;
  let insertedRows = 0;
  let updatedRows = 0;
  let duplicateRows = 0;
  let ignoredRows = 0;
  const importedRecordIds = [];

  for (const item of parsed.records) {
    const match = await resolveCloserMatch(item.closer_original, closerCatalog);
    const prepared = {
      ...item,
      source_id: source?.id || null,
      import_run_id: importRunId,
      closer_normalized: match.normalizedName || item.closer_original,
      closer_id: match.closer?.id || null,
      user_id: match.closer?.user_id || null,
      source_payload_json: JSON.stringify(item.source_payload || {}),
      last_synced_at: new Date().toISOString(),
    };

    const existing = await get('SELECT * FROM sales_records WHERE dedupe_hash=? LIMIT 1', [prepared.dedupe_hash]);
    if (!existing) {
      const created = await run(
        "INSERT INTO sales_records (source_id, import_run_id, origin_type, source_workbook, source_sheet, source_row_number, source_row_identifier, dedupe_hash, row_hash, student_name, course_name, sale_month, sale_date, semester_label, availability, modality, class_type, system_name, contract_status, language, closer_original, closer_normalized, closer_id, user_id, media_source, profession, indication, source_payload_json, last_synced_at, updated_at) VALUES (?, ?, 'spreadsheet_import', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))",
        [
          prepared.source_id,
          prepared.import_run_id,
          prepared.source_workbook,
          prepared.source_sheet,
          prepared.source_row_number,
          prepared.source_row_identifier,
          prepared.dedupe_hash,
          prepared.row_hash,
          prepared.student_name,
          prepared.course_name,
          prepared.sale_month,
          prepared.sale_date,
          prepared.semester_label,
          prepared.availability,
          prepared.modality,
          prepared.class_type,
          prepared.system_name,
          prepared.contract_status,
          prepared.language,
          prepared.closer_original,
          prepared.closer_normalized,
          prepared.closer_id,
          prepared.user_id,
          prepared.media_source,
          prepared.profession,
          prepared.indication,
          prepared.source_payload_json,
          prepared.last_synced_at,
        ]
      );
      insertedRows += 1;
      importedRecordIds.push(created.lastID);
      await logEntityChange({
        entityType: 'sales_record',
        entityId: created.lastID,
        action: 'created',
        actorUserId,
        closerId: prepared.closer_id,
        origin: 'spreadsheet_import',
        detail: {
          source_workbook: prepared.source_workbook,
          source_sheet: prepared.source_sheet,
          source_row_identifier: prepared.source_row_identifier,
        },
      });
      continue;
    }

    if (String(existing.row_hash || '') === String(prepared.row_hash || '')) {
      duplicateRows += 1;
      continue;
    }

    await recordSalesImportChange(existing, prepared, actorUserId, 'spreadsheet_sync');
    await run(
      "UPDATE sales_records SET source_id=?, import_run_id=?, source_workbook=?, source_sheet=?, source_row_number=?, source_row_identifier=?, row_hash=?, student_name=?, course_name=?, sale_month=?, sale_date=?, semester_label=?, availability=?, modality=?, class_type=?, system_name=?, contract_status=?, language=?, closer_original=?, closer_normalized=?, closer_id=?, user_id=?, media_source=?, profession=?, indication=?, source_payload_json=?, last_synced_at=?, updated_at=datetime('now') WHERE id=?",
      [
        prepared.source_id,
        prepared.import_run_id,
        prepared.source_workbook,
        prepared.source_sheet,
        prepared.source_row_number,
        prepared.source_row_identifier,
        prepared.row_hash,
        prepared.student_name,
        prepared.course_name,
        prepared.sale_month,
        prepared.sale_date,
        prepared.semester_label,
        prepared.availability,
        prepared.modality,
        prepared.class_type,
        prepared.system_name,
        prepared.contract_status,
        prepared.language,
        prepared.closer_original,
        prepared.closer_normalized,
        prepared.closer_id,
        prepared.user_id,
        prepared.media_source,
        prepared.profession,
        prepared.indication,
        prepared.source_payload_json,
        prepared.last_synced_at,
        existing.id,
      ]
    );
    updatedRows += 1;
    importedRecordIds.push(existing.id);
  }

  const summary = {
    synced_closers: syncedCloserNames,
    imported_record_ids: importedRecordIds.slice(0, 20),
  };

  await run(
    "UPDATE sales_import_runs SET inserted_rows=?, updated_rows=?, duplicate_rows=?, ignored_rows=?, status='completed', summary_json=?, updated_at=datetime('now') WHERE id=?",
    [insertedRows, updatedRows, duplicateRows, ignoredRows, JSON.stringify(summary), importRunId]
  );
  await run("UPDATE sales_import_sources SET last_imported_at=datetime('now'), updated_at=datetime('now') WHERE id=?", [source?.id || null]);
  if (actorUserId) {
    await logEvent(actorUserId, 'sales_import_completed', {
      import_run_id: importRunId,
      inserted_rows: insertedRows,
      updated_rows: updatedRows,
      duplicate_rows: duplicateRows,
      synced_closers: syncedCloserNames,
      workbook: parsed.workbook_name,
    });
  }

  return {
    import_run_id: importRunId,
    total_rows: parsed.records.length,
    inserted_rows: insertedRows,
    updated_rows: updatedRows,
    duplicate_rows: duplicateRows,
    ignored_rows: ignoredRows,
    synced_closers: syncedCloserNames,
    workbook: parsed.workbook_name,
    sheet_name: parsed.sheet_name,
  };
}

async function buildSalesIntranetPayload(user) {
  const scope = await getSalesAccessScope(user);
  if (!scope.enabled) {
    return {
      enabled: false,
      can_view_all: false,
      can_edit_all: false,
      summary: null,
      records: [],
      closers: [],
    };
  }

  const [salesSummary, closers] = await Promise.all([
    getSalesSummaryForScope(scope, { limit: 24 }),
    listClosers({ includeInactive: false }),
  ]);
  const visibleClosers = scope.canViewAll
    ? closers
    : closers.filter((closer) => Number(closer.id) === Number(scope.closer?.id || 0));

  return {
    enabled: true,
    can_view_all: scope.canViewAll,
    can_edit_all: scope.canEditAll,
    scope_closer_id: scope.closer?.id || null,
    summary: salesSummary.totals,
    records: salesSummary.records.map(serializeSalesRecord),
    closers: visibleClosers.map((closer) => ({
      id: closer.id,
      official_name: closer.official_name,
      display_name: closer.display_name || closer.official_name,
      user_id: closer.user_id || null,
      user_name: closer.user_name || null,
      aliases: (closer.aliases || []).map((alias) => alias.alias_name),
      status: closer.status,
    })),
  };
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

function analyzeConversationIntent(userText = "", userLanguage = "pt", options = {}) {
  const normalized = normalizeQuery(userText);
  const wantsStructured = STRUCTURED_REQUEST_RE.test(normalized) || /\n/.test(String(userText || ""));
  const wantsTranslation = /\b(traduza|translate|traduz|translation|traducao|traduccion|traduzione)\b/i.test(userText);
  const wantsSummary = /\b(resuma|resumo|summary|summarize|resumen|riassunto)\b/i.test(userText);
  const wantsRewrite = /\b(melhore|reescreva|rewrite|rephrase|ajuste|corrija|formate|organize)\b/i.test(userText);
  const wantsSteps = /\b(passo a passo|step by step|como fazer|how to|como faco|como faço)\b/i.test(userText);
  const wantsProfessional = /\b(profissional|formal|executivo|corporativo|business|profesional|professionnel)\b/i.test(userText);
  const wantsPersuasive = /\b(venda|comercial|persuasivo|convencer|sales|conversion)\b/i.test(userText);
  const businessIntent = analyzeBusinessIntent(userText, { departments: options.departments || [] });

  let tone = 'cordial';
  if (wantsProfessional) tone = 'profissional';
  else if (wantsPersuasive || businessIntent.businessAreaKey === 'commercial') tone = 'persuasivo';
  else if (wantsSteps || wantsSummary || businessIntent.responseDepth === 'deep') tone = 'objetivo';
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
    wantsStructured: wantsStructured || wantsTranslation || wantsSummary || wantsRewrite || wantsSteps || businessIntent.responseDepth !== 'compact',
    wantsTranslation,
    wantsSummary,
    wantsRewrite,
    wantsSteps,
    responseLabel,
    businessIntent,
    responseDepth: businessIntent.responseDepth,
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

function buildMemoryEntryTitle(userText = "", assistantText = "") {
  const base = String(userText || assistantText || "").trim();
  return base ? base.slice(0, 96) : "Memoria contextual";
}

function buildMemoryEntryContent(userText = "", assistantText = "") {
  const parts = [];
  if (String(userText || "").trim()) {
    parts.push(`Usuario mencionou: ${String(userText || "").trim()}`);
  }
  if (String(assistantText || "").trim()) {
    parts.push(`Contexto/acao da IA: ${String(assistantText || "").trim()}`);
  }
  return compactMemory(parts.join("\n"), 2200);
}

async function upsertMemoryEntry({
  userId,
  conversationId = null,
  memoryScope = "conversation",
  memoryKind = "context",
  title = "",
  contentText = "",
  topics = [],
  language = "pt",
  sourceMessageIds = [],
}) {
  const safeText = compactMemory(String(contentText || "").trim(), 2200);
  if (!userId || !safeText) return null;

  const normalizedText = normalizeSemanticText(safeText);
  if (!normalizedText) return null;

  const existing = await get(
    `SELECT id
       FROM memory_entries
      WHERE user_id=?
        AND COALESCE(conversation_id, 0)=?
        AND memory_scope=?
        AND normalized_text=?
      ORDER BY updated_at DESC
      LIMIT 1`,
    [userId, Number(conversationId || 0), memoryScope, normalizedText]
  );

  const embedding = await getEmbeddingForText(safeText);
  const payload = [
    title || buildMemoryEntryTitle(safeText),
    safeText,
    normalizedText,
    safeJsonStringify(topics || [], "[]"),
    language || "pt",
    safeJsonStringify(sourceMessageIds || [], "[]"),
    embedding ? JSON.stringify(embedding) : null,
    embedding ? OPENAI_EMBEDDING_MODEL : null,
  ];

  if (existing?.id) {
    await run(
      "UPDATE memory_entries SET title=?, content_text=?, normalized_text=?, topics_json=?, language=?, source_message_ids_json=?, embedding_json=?, embedding_model=?, updated_at=datetime('now') WHERE id=?",
      [...payload, existing.id]
    );
    return existing.id;
  }

  const created = await run(
    "INSERT INTO memory_entries (user_id, conversation_id, memory_scope, memory_kind, title, content_text, normalized_text, topics_json, language, source_message_ids_json, embedding_json, embedding_model) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    [userId, conversationId || null, memoryScope, memoryKind, ...payload]
  );
  return created.lastID;
}

async function persistConversationMemories({
  userId,
  conversationId,
  userText,
  assistantText,
  language = "pt",
}) {
  if (!userId || !conversationId) return [];

  const topics = extractTopicTerms(`${userText} ${assistantText}`).slice(0, 12);
  const memoryText = buildMemoryEntryContent(userText, assistantText);
  const createdIds = [];

  const conversationEntryId = await upsertMemoryEntry({
    userId,
    conversationId,
    memoryScope: "conversation",
    memoryKind: "thread_context",
    title: buildMemoryEntryTitle(userText),
    contentText: memoryText,
    topics,
    language,
  });
  if (conversationEntryId) createdIds.push(conversationEntryId);

  if (topics.length >= 2 || memoryText.length >= 160) {
    const globalEntryId = await upsertMemoryEntry({
      userId,
      conversationId: null,
      memoryScope: "user_global",
      memoryKind: "recurring_context",
      title: buildMemoryEntryTitle(userText),
      contentText: memoryText,
      topics,
      language,
    });
    if (globalEntryId) createdIds.push(globalEntryId);
  }

  return createdIds;
}

async function getRelevantMemoryEntries(userId, conversationId, queryText, limit = 4) {
  if (!userId || !String(queryText || "").trim()) return [];

  const queryEmbedding = await getEmbeddingForText(queryText);
  const topicTerms = new Set(extractTopicTerms(queryText));
  const rows = await all(
    `SELECT id, user_id, conversation_id, memory_scope, memory_kind, title, content_text, topics_json, language, embedding_json, updated_at
       FROM memory_entries
      WHERE user_id=?
        AND (conversation_id=? OR memory_scope='user_global')
      ORDER BY datetime(updated_at) DESC, id DESC
      LIMIT ?`,
    [userId, conversationId || 0, MAX_MEMORY_CANDIDATES]
  );

  return rows
    .map((row) => {
      const topics = safeJsonParse(row.topics_json || "[]") || [];
      const overlap = topics.filter((topic) => topicTerms.has(topic)).length;
      const similarity = queryEmbedding ? cosineSimilarity(queryEmbedding, row.embedding_json) : 0;
      const recencyBoost = row.conversation_id && Number(row.conversation_id) === Number(conversationId || 0) ? 0.18 : 0.06;
      const score = similarity + (overlap * 0.08) + recencyBoost;
      return {
        ...row,
        topics,
        memory_score: score,
      };
    })
    .filter((row) => row.memory_score >= MEMORY_ENTRY_MIN_SIMILARITY || row.topics.length >= 2)
    .sort((left, right) => Number(right.memory_score || 0) - Number(left.memory_score || 0))
    .slice(0, limit);
}

function buildMemoryContextBundle(entries = []) {
  const safeEntries = Array.isArray(entries) ? entries : [];
  return {
    text: safeEntries.map((entry) => {
      const scopeLabel = entry.memory_scope === "user_global" ? "Memoria global do usuario" : "Memoria da conversa";
      return `[${scopeLabel}: ${entry.title || "Contexto"}]\n${String(entry.content_text || "").slice(0, 1200)}`;
    }).join("\n\n"),
    entries: safeEntries,
  };
}

async function persistReplyMemories({
  conversationId,
  userId,
  userText,
  assistantText,
  language = "pt",
  resetMemory = false,
}) {
  await updateConversationMemory(conversationId, userText, assistantText, { resetMemory });
  await updateUserMemory(userId, userText, assistantText, language);
  await persistConversationMemories({
    userId,
    conversationId,
    userText,
    assistantText,
    language,
  });
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

function isSupportedKnowledgeUpload(originalName = "", mimeType = "", filePath = "") {
  const ext = getKnowledgeUploadExt(filePath, originalName, mimeType);
  return RAG_ALLOWED_EXTS.has(ext);
}

function shouldExtractKnowledgeLocally(ext, sizeBytes) {
  const limit = RAG_LOCAL_EXTRACTION_LIMITS[ext];
  if (!limit) return false;
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

async function upsertDocumentChunks(documentId, relPath, extractedText, language, documentKeywords = [], options = {}) {
  await run("DELETE FROM document_chunks WHERE document_id=?", [documentId]);

  const departmentName = String(options.departmentName || '').trim() || null;
  const chunks = chunkTextSemantically(extractedText || relPath, {
    maxChars: 1400,
    minChars: 420,
  });

  if (!chunks.length) {
    const contentText = String(extractedText || relPath || '').trim();
    const keywordText = extractKeywords(contentText, 12).join(', ');
    await run(
      "INSERT INTO document_chunks (document_id, rel_path, chunk_index, content_text, department_name, language, translated_text, translated_language, content_hash, keywords) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [documentId, relPath, 0, contentText, departmentName, language, '', null, hashText(contentText), keywordText]
    );
    return 1;
  }

  let created = 0;
  for (const chunk of chunks) {
    const keywords = [...new Set([...(chunk.keywords || []), ...documentKeywords])].slice(0, 16).join(', ');
    await run(
      "INSERT INTO document_chunks (document_id, rel_path, chunk_index, content_text, department_name, language, translated_text, translated_language, content_hash, keywords) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [documentId, relPath, chunk.index, chunk.text, departmentName, language, '', null, chunk.hash, keywords]
    );
    created += 1;
  }

  return created;
}

async function upsertIndexedDocument({
  sourcePath,
  relPath,
  originalName,
  mimeType,
  departmentName = '',
  sourceKind = 'manual_upload',
  extractedTextOverride = '',
  detectedLanguage = '',
}) {
  if (!fs.existsSync(sourcePath)) return null;

  const stat = fs.statSync(sourcePath);
  const ext = getKnowledgeUploadExt(sourcePath, originalName, mimeType);
  const shouldExtract = shouldExtractKnowledgeLocally(ext, stat.size);
  const extracted = normalizeKnowledgeText(
    extractedTextOverride
    || (shouldExtract ? await extractText(sourcePath, originalName, mimeType) : "")
  );
  const safeText = extracted || (shouldExtract
    ? `(sem texto extraido) ${relPath}`
    : `(arquivo grande para indexacao local, mantido para busca vetorial) ${relPath}`);
  const language = normalizeLanguageCode(detectedLanguage || detectConversationLanguage(safeText));
  const keywordText = extractKeywords(safeText, 14).join(', ');
  const contentHash = hashText(safeText);
  const normalizedDepartment = String(departmentName || '').trim() || null;
  const issues = detectKnowledgeTextIssues(extracted);
  const existing = await get("SELECT id FROM documents WHERE source_path=?", [sourcePath]);

  let documentId = existing?.id || 0;
  if (existing) {
    await run(
      "UPDATE documents SET rel_path=?, ext=?, size_bytes=?, modified_ms=?, extracted_text=?, mime_type=?, department_name=?, source_kind=?, language=?, translated_text=?, translated_language=?, content_hash=?, keywords=?, updated_at=datetime('now') WHERE id=?",
      [relPath, ext, stat.size, Math.round(stat.mtimeMs), safeText, mimeType || null, normalizedDepartment, sourceKind, language, '', null, contentHash, keywordText, existing.id]
    );
  } else {
    const created = await run(
      "INSERT INTO documents (source_path, rel_path, ext, size_bytes, modified_ms, extracted_text, mime_type, department_name, source_kind, language, translated_text, translated_language, content_hash, keywords) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [sourcePath, relPath, ext, stat.size, Math.round(stat.mtimeMs), safeText, mimeType || null, normalizedDepartment, sourceKind, language, '', null, contentHash, keywordText]
    );
    documentId = created.lastID;
  }

  if (!documentId) {
    const refreshed = await get("SELECT id FROM documents WHERE source_path=?", [sourcePath]);
    documentId = refreshed?.id || 0;
  }

  const chunkCount = documentId
    ? await upsertDocumentChunks(documentId, relPath, safeText, language, keywordText ? keywordText.split(', ').filter(Boolean) : [], { departmentName: normalizedDepartment })
    : 0;

  return {
    relPath,
    extractedText: safeText,
    language,
    contentHash,
    chunkCount,
    documentId,
    mimeType: mimeType || null,
    departmentName: normalizedDepartment,
    sourceKind,
    issues,
    isMedia: isMediaKnowledgeFile(originalName, mimeType, sourcePath),
  };
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

async function materializeDocumentEmbeddings(documentId) {
  if (!documentId) {
    return { total: 0, completed: 0, failed: 0 };
  }

  const chunks = await all(
    "SELECT id, content_text, translated_text, embedding_json FROM document_chunks WHERE document_id=? ORDER BY chunk_index ASC",
    [documentId]
  );

  let completed = 0;
  let failed = 0;

  for (const chunk of chunks) {
    const existing = parseEmbedding(chunk.embedding_json);
    if (existing) {
      completed += 1;
      continue;
    }

    const embedding = await getEmbeddingForText(chunk.translated_text || chunk.content_text || "");
    if (!embedding) {
      failed += 1;
      continue;
    }

    await run(
      "UPDATE document_chunks SET embedding_json=?, embedding_model=?, updated_at=datetime('now') WHERE id=?",
      [JSON.stringify(embedding), OPENAI_EMBEDDING_MODEL, chunk.id]
    );
    completed += 1;
  }

  return {
    total: chunks.length,
    completed,
    failed,
  };
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

async function hydrateKnowledgeRows(rows, userLanguage, queryEmbedding = null, options = {}) {
  const enriched = [];
  const departmentKeys = new Set((options.departments || []).map((item) => normalizeDepartmentValue(item)).filter(Boolean));

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
    const departmentBoost = departmentKeys.size && departmentKeys.has(normalizeDepartmentValue(item.department_name || '')) ? 0.22 : 0;
    item.score = (Number(item.score || 0) * 0.45) + (item.semantic_score * 0.55) + departmentBoost;
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
    const hydrated = await hydrateKnowledgeRows(rows, userLanguage, queryEmbedding, { departments: options.departments || [] });
    let uniqueRows = dedupeRows(hydrated);

    if (!uniqueRows.length && queryEmbedding) {
      const semanticCandidates = await all(
        "SELECT id, document_id, rel_path, content_text AS extracted_text, translated_text, translated_language, language, department_name, keywords, embedding_json, 0 AS score FROM document_chunks ORDER BY updated_at DESC LIMIT ?",
        [Math.max(safeLimit * 20, 80)]
      );
      const semanticHydrated = await hydrateKnowledgeRows(semanticCandidates, userLanguage, queryEmbedding, { departments: options.departments || [] });
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
    document_id: row?.document_id || null,
    stored_name: row?.rel_path ? path.basename(String(row.rel_path)) : '',
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
    rows: deduped,
  };
}

async function buildKnowledgeBundle(query, options = {}) {
  const userLanguage = normalizeLanguageCode(options.userLanguage || detectLanguage(query, 'pt'));
  const rows = await searchKnowledgeBase(query, { limit: options.limit || 4, userLanguage, departments: options.departments || [] });
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

async function refreshKnowledgeSourceVectorStatus(source, options = {}) {
  if (!source?.id) return source;
  const apiKey = String(process.env.OPENAI_API_KEY || "").trim();
  if (!apiKey || !OPENAI_VECTOR_STORE_ID || !source.vector_store_file_id) {
    return source;
  }

  const shouldRefresh = Boolean(options.force)
    || ["processing", "pending", "failed"].includes(String(source.sync_status || "").trim().toLowerCase());

  if (!shouldRefresh) return source;

  const state = getKnowledgeProcessingState(source);

  try {
    const vectorState = await getVectorStoreFileStatus(OPENAI_VECTOR_STORE_ID, source.vector_store_file_id, apiKey);
    const openaiState = source.openai_file_id
      ? await getOpenAIFileStatus(source.openai_file_id, apiKey).catch(() => null)
      : null;
    const vectorStatus = normalizeStageStatus(vectorState?.status, "processing");
    const lastError = vectorState?.last_error || openaiState?.last_error || null;
    const updatedState = withKnowledgeStage(state, "vector_store", {
      status: vectorStatus === "completed" ? "completed" : vectorStatus === "failed" ? "failed" : "processing",
      file_status: openaiState?.status || null,
      vector_status: vectorState?.status || null,
      last_error: lastError,
      file_id: source.openai_file_id || null,
      vector_store_file_id: source.vector_store_file_id || null,
      message: lastError?.message || lastError?.code || "",
    });
    const finalized = finalizeKnowledgeProcessingState(updatedState);
    const nextSyncStatus = finalized.final?.available_to_ai
      ? "available"
      : finalized.final?.status === "failed"
        ? "failed"
        : "processing";

    await updateKnowledgeSourceFields(source.id, {
      processing_state_json: safeJsonStringify(finalized, "{}"),
      sync_status: nextSyncStatus,
    });

    return {
      ...source,
      processing_state_json: safeJsonStringify(finalized, "{}"),
      sync_status: nextSyncStatus,
    };
  } catch (err) {
    const updatedState = withKnowledgeStage(state, "vector_store", {
      status: "failed",
      message: err?.message || "vector_store_status_failed",
      last_error: { message: err?.message || "vector_store_status_failed" },
    });
    const finalized = finalizeKnowledgeProcessingState(updatedState);
    await updateKnowledgeSourceFields(source.id, {
      processing_state_json: safeJsonStringify(finalized, "{}"),
      sync_status: "failed",
    });
    return {
      ...source,
      processing_state_json: safeJsonStringify(finalized, "{}"),
      sync_status: "failed",
    };
  }
}

function buildKnowledgeAdminRow(source) {
  const syncStatus = String(source?.sync_status || "").trim().toLowerCase();
  const hasState = hasPersistedKnowledgeStages(source);
  let state = getKnowledgeProcessingState(source);

  if (!hasState && ["available", "synced", "local"].includes(syncStatus)) {
    state = createKnowledgeProcessingState({
      parsing: { status: "completed", message: "Estado legado tratado como conteudo disponivel." },
      transcript: { status: isMediaKnowledgeFile(source?.original_name, source?.mime_type, source?.stored_name || "") ? "completed" : "skipped" },
      chunking: { status: "completed" },
      embedding: { status: "completed" },
      vector_store: {
        status: OPENAI_VECTOR_STORE_ID
          ? (syncStatus === "local" ? "skipped" : "completed")
          : "skipped",
      },
      health: { status: "healthy", issues: [] },
    });
  } else if (!hasState && syncStatus === "failed") {
    state = createKnowledgeProcessingState({
      parsing: { status: "failed", message: "Estado legado com falha." },
      health: { status: "failed", issues: ["falha_legada"] },
    });
  }

  state = finalizeKnowledgeProcessingState(state);
  const finalStatus = String(state.final?.status || source.sync_status || "pending");
  const lastError = extractKnowledgeLastError(state);
  const transcriptStatus = normalizeStageStatus(state.transcript?.status, "skipped");

  return {
    ...source,
    processing_state: state,
    parsing_status: normalizeStageStatus(state.parsing?.status),
    transcript_status: transcriptStatus,
    chunking_status: normalizeStageStatus(state.chunking?.status),
    embedding_status: normalizeStageStatus(state.embedding?.status),
    vector_store_status: normalizeStageStatus(state.vector_store?.status, OPENAI_VECTOR_STORE_ID ? "pending" : "skipped"),
    availability_status: finalStatus,
    available_to_ai: Boolean(state.final?.available_to_ai),
    last_error: lastError,
    issue_count: Array.isArray(state.health?.issues) ? state.health.issues.length : 0,
    health_issues: Array.isArray(state.health?.issues) ? state.health.issues : [],
  };
}

async function logAiTrainingEvent({
  userId = null,
  conversationId = null,
  knowledgeSourceId = null,
  eventType,
  eventStatus = "info",
  title = "",
  detailText = "",
  meta = null,
}) {
  if (!eventType) return null;
  const created = await run(
    "INSERT INTO ai_training_events (user_id, conversation_id, knowledge_source_id, event_type, event_status, title, detail_text, meta_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    [
      userId || null,
      conversationId || null,
      knowledgeSourceId || null,
      eventType,
      eventStatus,
      title || null,
      detailText || null,
      meta ? safeJsonStringify(meta, "{}") : null,
    ]
  );
  return created.lastID;
}

async function resolveKnowledgeSourceIdFromSource(source = {}) {
  const storedName = String(source.stored_name || "").trim()
    || (source.label ? path.basename(String(source.label || "")) : "");
  if (!storedName) return null;
  const row = await get("SELECT id FROM knowledge_sources WHERE stored_name=? LIMIT 1", [storedName]);
  return row?.id || null;
}

async function recordKnowledgeUsageEvents(userId, conversationId, sources = []) {
  const safeSources = Array.isArray(sources) ? sources : [];
  for (const source of safeSources) {
    if (source?.type !== "knowledge_base" && source?.type !== "file_search") continue;
    const knowledgeSourceId = await resolveKnowledgeSourceIdFromSource(source);
    await logAiTrainingEvent({
      userId,
      conversationId,
      knowledgeSourceId,
      eventType: "knowledge_used",
      eventStatus: "info",
      title: source.label || "Documento utilizado",
      detailText: source.excerpt || "",
      meta: {
        source_type: source.type,
        label: source.label || "",
      },
    });
  }
}

function responseLooksWeak(text = "") {
  const safe = String(text || "").trim().toLowerCase();
  if (!safe) return true;
  return /(nao encontrei|nao localizei|nao lembro|nao sei|sem contexto suficiente|preciso de mais contexto|nao tenho informacoes suficientes|i couldn't find|i don't know)/i.test(safe);
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

      if (isMediaFile(file.original_name, file.mime_type)) {
        try {
          const transcriptResult = await transcribeMedia(filePath, file.original_name, file.mime_type);
          const transcript = String(transcriptResult?.text || "").trim();
          const mediaLabel = isVideoFile(file.original_name, file.mime_type) ? "Video" : "Audio";
          if (transcript && transcript.trim()) {
            blocks.push(
              `[${mediaLabel} enviado: ${file.original_name} | ${file.mime_type || "media"}]\nTranscricao detectada:\n${transcript.slice(0, 9000)}`
            );
          } else {
            blocks.push(
              `[${mediaLabel} enviado: ${file.original_name} | ${file.mime_type || "media"}]\nO arquivo foi anexado a conversa, mas nao foi possivel gerar uma transcricao local.`
            );
          }
        } catch (err) {
          console.log("Erro ao transcrever midia:", err?.message || err);
          const mediaLabel = isVideoFile(file.original_name, file.mime_type) ? "Video" : "Audio";
          blocks.push(
            `[${mediaLabel} enviado: ${file.original_name} | ${file.mime_type || "media"}]\nO arquivo foi anexado a conversa, mas houve falha ao tentar transcreve-lo.`
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
      if (isMediaFile(row.original_name, row.mime_type)) continue;
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
  const currentUser = await getUserById(userId);
  const userLanguage = normalizeLanguageCode(responseProfile?.language || detectConversationLanguage(userText, history));
  const intent = responseProfile || analyzeConversationIntent(userText, userLanguage, {
    departments: currentUser?.departments || [],
  });
  const memory = await getConversationMemory(conversationId);
  const userMemory = await getRelevantUserMemory(userId, userText);
  const memoryEntries = topicShift.isShift
    ? []
    : await getRelevantMemoryEntries(userId, conversationId, userText, 4);
  const memoryBundle = buildMemoryContextBundle(memoryEntries);
  const visionInputs = await getRecentVisionInputs(conversationId, 3);
  const documentInputs = await getRecentDocumentInputs(conversationId, 2);
  const normalizedUserText = String(userText || '').trim();
  const businessContextText = buildBusinessContextBlock({
    user: currentUser || {},
    businessIntent: intent.businessIntent,
    userLanguageLabel: getLanguageLabel(userLanguage),
  });
  const businessInstructionText = buildBusinessInstructions(intent.businessIntent);

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
  const semanticMemoryText = topicShift.isShift
    ? 'Memorias semanticas ignoradas nesta resposta por mudanca de assunto.'
    : (memoryBundle.text || 'Sem memorias semanticas relevantes para esta pergunta.');

  const systemText = `
Voce e a TALKERS IA, assistente corporativa, educacional e operacional da empresa Talkers.
Idioma principal da resposta atual: ${getLanguageLabel(userLanguage)}.
Tom desejado para esta resposta: ${getToneInstruction(intent)}.

Comportamento:
- Detecte automaticamente o idioma do usuario e responda nesse idioma.
- Quando o usuario pedir traducao, traduza para o idioma solicitado mantendo contexto e intencao.
- Quando documentos estiverem em outro idioma, interprete o conteudo no idioma original, traduza silenciosamente quando necessario e responda no idioma do usuario.
- Para perguntas sobre processos, materiais, regras, vendas de cursos, atendimento, operacao pedagogica, marketing, financeiro e informacoes da Talkers, priorize sempre a base interna da empresa, a intranet e os arquivos da conversa.
- Use a web apenas como complemento ou quando o usuario pedir algo externo, atual, publico ou de mercado.
- Se houver conflito entre base interna e web em assuntos da empresa, avise e priorize a base interna.
- Analise a intencao antes de responder, identifique a area do negocio e adapte o tom naturalmente.
- Sempre que fizer sentido, entregue contexto, explicacao, passo a passo, exemplos, melhores praticas, alertas e proximo passo recomendado.
- Se o pedido envolver explicacao, orientacao, passo a passo, melhoria de texto, organizacao de informacao, sugestoes, traducao, resumo, reescrita, roteiro, mensagem comercial, comunicado ou texto pronto para uso, entregue em markdown bem estruturado, com hierarquia visual clara, blocos curtos e reutilizaveis.
- Se o usuario mudar de assunto, foque totalmente no tema atual sem arrastar contexto irrelevante.
- Se faltar informacao suficiente, deixe isso claro e peca complemento.
- Nunca responda de forma rasa quando a pergunta pedir profundidade ou aplicacao pratica.

Contexto do negocio:
${businessContextText}

Instrucoes especificas para esta resposta:
${businessInstructionText}

Contexto operacional atual:
- Data e hora atual no Brasil: ${nowBrazil()}
- Memoria da conversa atual: ${memoryText}
- Memoria util de outras conversas deste usuario: ${userMemoryText}
- Memorias semanticas relevantes por usuario/conversa: ${semanticMemoryText}
- Historico recente: ${historyText || 'Sem historico anterior.'}
- Contexto adicional: ${contextText || 'Sem contexto adicional.'}

Perfil desta resposta:
- Idioma da conversa: ${getLanguageLabel(userLanguage)}
- Tom: ${intent.tone}
- Estruturar resposta: ${intent.wantsStructured ? 'sim' : 'nao'}
- Profundidade sugerida: ${intent.responseDepth || 'balanced'}
- Area principal detectada: ${intent.businessIntent?.businessAreaLabel || 'Administrativo'}
- Tipo de intencao: ${intent.businessIntent?.intentTypeLabel || 'General Assistance'}
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

  const visibleDepartments = Array.isArray(user.departments) ? user.departments.filter(Boolean) : [];
  const documentWhere = [];
  const documentParams = [];
  if (visibleDepartments.length) {
    documentWhere.push(`(department_name IS NULL OR department_name='' OR department_name IN (${visibleDepartments.map(() => '?').join(', ')}))`);
    documentParams.push(...visibleDepartments);
  }

  const documentWhereSql = documentWhere.length ? `WHERE ${documentWhere.join(' AND ')}` : '';

  const [departmentCatalog, recentDocuments, totalDocumentsRow, salesPayload] = await Promise.all([
    listDepartmentCatalog(),
    all(
      `SELECT id, original_name, stored_name, mime_type, language, department_name, source_kind, vector_store_file_id, created_at
         FROM knowledge_sources
         ${documentWhereSql}
        ORDER BY datetime(created_at) DESC, id DESC
        LIMIT 12`,
      documentParams
    ),
    get(`SELECT COUNT(*) AS total FROM knowledge_sources ${documentWhereSql}`, documentParams),
    buildSalesIntranetPayload(user),
  ]);

  const workspace = buildIntranetWorkspace({
    user,
    departments: user.department_details || [],
    recentDocuments: recentDocuments.map((document) => {
      const adminRow = buildKnowledgeAdminRow(document);
      return {
        id: document.id,
        name: document.original_name,
        status: adminRow.available_to_ai ? 'Disponivel para IA' : (adminRow.availability_status || document.sync_status || 'Processando'),
        created_at: document.created_at,
        department_name: document.department_name || '',
        language: document.language || '',
        mime_type: document.mime_type || '',
        source_kind: document.source_kind || '',
        available_to_ai: adminRow.available_to_ai,
        last_error: adminRow.last_error,
      };
    }),
    totalDocuments: Number(totalDocumentsRow?.total || 0),
    salesWorkspace: salesPayload,
  });

  workspace.sales = salesPayload;

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
const salesImportUpload = upload.fields([
  { name: "sales_workbook", maxCount: 1 },
  { name: "post_sale_workbook", maxCount: 1 },
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

function salesImportUploadMiddleware(req, res, next) {
  salesImportUpload(req, res, (err) => {
    if (!err) return next();
    if (err?.code === "LIMIT_FILE_SIZE") {
      return res.status(413).json({ error: "sales_workbook_too_large" });
    }
    return res.status(400).json({ error: err?.message || "sales_import_upload_failed" });
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

  const currentUser = await getUserById(req.user.sub);
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
  const responseProfile = analyzeConversationIntent(text, userLanguage, {
    departments: currentUser?.departments || [],
  });
  const relevantMemoryEntries = topicSnapshot?.topicShift?.isShift
    ? []
    : await getRelevantMemoryEntries(req.user.sub, id, text, 4);
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
      await persistReplyMemories({
        conversationId: id,
        userId: req.user.sub,
        userText: text,
        assistantText: artifact.reply,
        language: userLanguage,
        resetMemory: Boolean(topicSnapshot?.topicShift?.isShift),
      });
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

    await persistReplyMemories({
      conversationId: id,
      userId: req.user.sub,
      userText: text,
      assistantText: artifact.reply,
      language: userLanguage,
      resetMemory: Boolean(topicSnapshot?.topicShift?.isShift),
    });
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
    await persistReplyMemories({
      conversationId: id,
      userId: req.user.sub,
      userText: text,
      assistantText: cachedReply.text,
      language: userLanguage,
      resetMemory: Boolean(topicSnapshot?.topicShift?.isShift),
    });
    if (relevantMemoryEntries.length) {
      await logAiTrainingEvent({
        userId: req.user.sub,
        conversationId: id,
        eventType: "memory_hit",
        eventStatus: "success",
        title: "Memoria reutilizada em resposta em cache",
        detailText: `A pergunta reutilizou ${relevantMemoryEntries.length} memoria(s) relevante(s).`,
      });
    }
    return res.json({ reply: cachedReply.text, meta: cachedMetaObject });
  }

  const fileContext = await getConversationFilesContext(id);
  const knowledgeBundle = await buildKnowledgeBundle(text, {
    limit: 4,
    userLanguage,
    departments: currentUser?.departments || [],
  });
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
  await persistReplyMemories({
    conversationId: id,
    userId: req.user.sub,
    userText: text,
    assistantText: assistant.text,
    language: userLanguage,
    resetMemory: Boolean(topicSnapshot?.topicShift?.isShift),
  });
  await saveSemanticCache(req.user.sub, text, userLanguage, assistant.text, userLanguage, assistant.sources || [], queryEmbedding, knowledgeSignature);
  await recordKnowledgeUsageEvents(req.user.sub, id, assistant.sources || []);

  if (relevantMemoryEntries.length) {
    await logAiTrainingEvent({
      userId: req.user.sub,
      conversationId: id,
      eventType: "memory_hit",
      eventStatus: "success",
      title: "Memoria contextual aplicada",
      detailText: `A resposta considerou ${relevantMemoryEntries.length} memoria(s) relacionada(s) ao usuario.`,
      meta: {
        memory_entry_ids: relevantMemoryEntries.map((entry) => entry.id),
      },
    });
  }

  if (responseLooksWeak(assistant.text)) {
    await logAiTrainingEvent({
      userId: req.user.sub,
      conversationId: id,
      eventType: "weak_response",
      eventStatus: "warning",
      title: text.slice(0, 120),
      detailText: assistant.text,
      meta: {
        knowledge_sources: (assistant.sources || []).length,
        memory_hits: relevantMemoryEntries.length,
      },
    });
  }

  res.json({ reply: assistant.text, meta: assistantMetaObject });
});

app.get("/api/admin/departments", requireAuth(JWT_SECRET), requireRole("admin"), async (req, res) => {
  const departments = await listDepartmentCatalog({ includeInactive: true });
  const usageRows = await all(`SELECT department_id, COUNT(*) AS total_users FROM user_departments GROUP BY department_id`);
  const usageMap = new Map((usageRows || []).map((row) => [Number(row.department_id), Number(row.total_users || 0)]));
  res.json({
    departments: departments.map((department) => ({
      ...department,
      total_users: usageMap.get(Number(department.id)) || 0,
    })),
  });
});

app.post("/api/admin/departments", requireAuth(JWT_SECRET), requireRole("admin"), async (req, res) => {
  const name = String(req.body?.name || '').trim();
  const description = String(req.body?.description || '').trim();
  const icon = String(req.body?.icon || 'layers').trim() || 'layers';
  const isActive = Object.prototype.hasOwnProperty.call(req.body || {}, 'is_active')
    ? parseBooleanInput(req.body?.is_active)
    : true;
  const slug = slugifyDepartmentName(req.body?.slug || name);

  if (!name || !slug) {
    return res.status(400).json({ error: 'missing_department_name' });
  }

  const existing = await get('SELECT id FROM departments WHERE slug=? OR lower(name)=lower(?) LIMIT 1', [slug, name]);
  if (existing) {
    return res.status(409).json({ error: 'department_already_exists' });
  }

  const metadataJson = JSON.stringify({
    access_levels: ['colaborador', 'gestor', 'administrador'],
    modules: [],
  });

  const created = await run(
    "INSERT INTO departments (slug, name, description, icon, is_active, sort_order, metadata_json, updated_at) VALUES (?, ?, ?, ?, ?, COALESCE((SELECT MAX(sort_order) + 10 FROM departments), 10), ?, datetime('now'))",
    [slug, name, description || null, icon, isActive, metadataJson]
  );

  await logEvent(req.user.sub, 'admin_create_department', { department_id: created.lastID, name, slug, is_active: isActive });
  const department = await get('SELECT id, slug, name, description, icon, is_active, sort_order, metadata_json, created_at, updated_at FROM departments WHERE id=?', [created.lastID]);
  res.json({ ok: true, department: mapDepartmentRow(department) });
});

app.patch("/api/admin/departments/:id", requireAuth(JWT_SECRET), requireRole("admin"), async (req, res) => {
  const departmentId = Number(req.params.id);
  const existing = await get('SELECT id, slug, name, description, icon, is_active, sort_order, metadata_json FROM departments WHERE id=?', [departmentId]);
  if (!existing) return res.status(404).json({ error: 'not_found' });

  const name = Object.prototype.hasOwnProperty.call(req.body || {}, 'name') ? String(req.body?.name || '').trim() : String(existing.name || '').trim();
  const description = Object.prototype.hasOwnProperty.call(req.body || {}, 'description') ? String(req.body?.description || '').trim() : String(existing.description || '').trim();
  const icon = Object.prototype.hasOwnProperty.call(req.body || {}, 'icon') ? String(req.body?.icon || '').trim() : String(existing.icon || 'layers').trim();
  const isActive = Object.prototype.hasOwnProperty.call(req.body || {}, 'is_active') ? parseBooleanInput(req.body?.is_active) : coerceDbBoolean(existing.is_active);
  const slug = slugifyDepartmentName(req.body?.slug || name || existing.slug);

  if (!name || !slug) {
    return res.status(400).json({ error: 'missing_department_name' });
  }

  const conflict = await get('SELECT id FROM departments WHERE (slug=? OR lower(name)=lower(?)) AND id<>? LIMIT 1', [slug, name, departmentId]);
  if (conflict) {
    return res.status(409).json({ error: 'department_already_exists' });
  }

  await run(
    "UPDATE departments SET slug=?, name=?, description=?, icon=?, is_active=?, updated_at=datetime('now') WHERE id=?",
    [slug, name, description || null, icon || 'layers', isActive, departmentId]
  );

  await logEvent(req.user.sub, 'admin_update_department', { department_id: departmentId, name, slug, is_active: isActive });
  const department = await get('SELECT id, slug, name, description, icon, is_active, sort_order, metadata_json, created_at, updated_at FROM departments WHERE id=?', [departmentId]);
  res.json({ ok: true, department: mapDepartmentRow(department) });
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
  const departments = await resolveDepartmentNames(parseDepartmentInput(req.body?.departments ?? req.body?.department), { includeInactive: false });
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
    ? await resolveDepartmentNames(parseDepartmentInput(req.body?.departments ?? req.body?.department), { includeInactive: false })
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

function getSalesImportFiles(req) {
  const files = [];
  if (req.files && typeof req.files === 'object') {
    for (const group of Object.values(req.files)) {
      if (Array.isArray(group)) files.push(...group);
    }
  }
  return files.filter(Boolean);
}

function cleanupUploadedFiles(files = []) {
  for (const file of files) {
    try {
      const tempPath = file?.path || (file?.filename ? path.join(uploadsDir, file.filename) : '');
      if (tempPath && fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
    } catch (err) {
      console.log('Falha ao limpar upload temporario:', err?.message || err);
    }
  }
}

app.get('/api/admin/closers', requireAuth(JWT_SECRET), requireRole('admin'), async (req, res) => {
  const closers = await listClosers({ includeInactive: true });
  res.json({ closers });
});

app.post('/api/admin/closers', requireAuth(JWT_SECRET), requireRole('admin'), async (req, res) => {
  try {
    const closer = await saveCloser({
      official_name: req.body?.official_name,
      display_name: req.body?.display_name,
      user_id: req.body?.user_id,
      status: req.body?.status,
      notes: req.body?.notes,
      aliases: parseAliasInput(req.body?.aliases),
    }, req.user.sub);
    res.json({ ok: true, closer });
  } catch (err) {
    res.status(err?.message === 'closer_name_conflict' ? 409 : 400).json({ error: err?.message || 'closer_save_failed' });
  }
});

app.patch('/api/admin/closers/:id', requireAuth(JWT_SECRET), requireRole('admin'), async (req, res) => {
  try {
    const closer = await saveCloser({
      id: Number(req.params.id),
      official_name: req.body?.official_name,
      display_name: req.body?.display_name,
      user_id: req.body?.user_id,
      status: req.body?.status,
      notes: req.body?.notes,
      aliases: parseAliasInput(req.body?.aliases),
    }, req.user.sub);
    res.json({ ok: true, closer });
  } catch (err) {
    if (err?.message === 'not_found') return res.status(404).json({ error: 'not_found' });
    res.status(err?.message === 'closer_name_conflict' ? 409 : 400).json({ error: err?.message || 'closer_save_failed' });
  }
});

app.get('/api/admin/sales/records', requireAuth(JWT_SECRET), requireRole('admin'), async (req, res) => {
  const scope = { enabled: true, canViewAll: true, canEditAll: true, closer: null };
  const payload = await getSalesSummaryForScope(scope, {
    closerId: req.query?.closer_id,
    status: req.query?.status,
    search: req.query?.search,
    limit: Math.min(200, Math.max(1, Number(req.query?.limit || 100))),
  });
  res.json({ summary: payload.totals, records: payload.records.map(serializeSalesRecord) });
});

app.get('/api/admin/sales/logs', requireAuth(JWT_SECRET), requireRole('admin'), async (req, res) => {
  const filters = [];
  const params = [];
  if (req.query?.user_id) {
    filters.push('l.actor_user_id=?');
    params.push(Number(req.query.user_id));
  }
  if (req.query?.closer_id) {
    filters.push('l.closer_id=?');
    params.push(Number(req.query.closer_id));
  }
  if (req.query?.record_id) {
    filters.push("l.entity_type='sales_record' AND l.entity_id=?");
    params.push(Number(req.query.record_id));
  }
  if (req.query?.action) {
    filters.push('lower(l.action)=lower(?)');
    params.push(String(req.query.action).trim());
  }
  if (req.query?.from) {
    filters.push('datetime(l.created_at) >= datetime(?)');
    params.push(String(req.query.from).trim());
  }
  if (req.query?.to) {
    filters.push('datetime(l.created_at) <= datetime(?)');
    params.push(String(req.query.to).trim());
  }
  const whereSql = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
  const rows = await all(
    `SELECT l.id, l.entity_type, l.entity_id, l.action, l.field_name, l.old_value, l.new_value, l.origin, l.detail_json, l.created_at,
            l.actor_user_id, u.name AS actor_name, c.official_name AS closer_name
       FROM entity_change_log l
       LEFT JOIN users u ON u.id = l.actor_user_id
       LEFT JOIN closers c ON c.id = l.closer_id
       ${whereSql}
      ORDER BY datetime(l.created_at) DESC, l.id DESC
      LIMIT 120`,
    params
  );
  res.json({
    logs: rows.map((row) => ({ ...row, detail: safeJsonParse(row.detail_json || '{}') || null })),
  });
});

app.post('/api/admin/sales/import', requireAuth(JWT_SECRET), requireRole('admin'), salesImportUploadMiddleware, async (req, res) => {
  const uploads = getSalesImportFiles(req);
  const salesWorkbook = (req.files?.sales_workbook || [])[0] || null;
  const postSaleWorkbook = (req.files?.post_sale_workbook || [])[0] || null;

  if (!salesWorkbook) {
    cleanupUploadedFiles(uploads);
    return res.status(400).json({ error: 'missing_sales_workbook' });
  }

  try {
    const summary = await importSalesWorkbookBatch({
      salesWorkbookPath: salesWorkbook.path,
      salesWorkbookName: salesWorkbook.originalname,
      postSaleWorkbookPath: postSaleWorkbook?.path || '',
      postSaleWorkbookName: postSaleWorkbook?.originalname || '',
      actorUserId: req.user.sub,
    });

    res.json({ ok: true, summary });
  } catch (err) {
    console.log('Erro ao importar planilha comercial:', err?.message || err);
    res.status(400).json({ error: err?.message || 'sales_import_failed' });
  } finally {
    cleanupUploadedFiles(uploads);
  }
});

app.get('/api/admin/sales/overview', requireAuth(JWT_SECRET), requireRole('admin'), async (req, res) => {
  const scope = { enabled: true, canViewAll: true, canEditAll: true, closer: null };
  const [summary, closers, recentRuns] = await Promise.all([
    getSalesSummaryForScope(scope, { limit: 40 }),
    listClosers({ includeInactive: true }),
    all('SELECT id, source_workbook, post_sale_workbook, total_rows, inserted_rows, updated_rows, duplicate_rows, status, created_at FROM sales_import_runs ORDER BY datetime(created_at) DESC, id DESC LIMIT 12'),
  ]);

  res.json({
    summary: summary.totals,
    closers,
    recent_runs: recentRuns,
  });
});
app.delete("/api/admin/users/:id", requireAuth(JWT_SECRET), requireRole("admin"), async (req, res) => {
  await logEvent(req.user.sub, "admin_delete_user_blocked", { target_user_id: Number(req.params.id) || null });
  res.status(403).json({ error: "user_deletion_disabled" });
});

app.get("/api/admin/rag/status", requireAuth(JWT_SECRET), requireRole("admin"), async (req, res) => {
  const [totalRow, availableRow, processingRow, failedRow] = await Promise.all([
    get("SELECT COUNT(*) AS total FROM knowledge_sources", []),
    get("SELECT COUNT(*) AS total FROM knowledge_sources WHERE sync_status IN ('available', 'synced', 'local')", []),
    get("SELECT COUNT(*) AS total FROM knowledge_sources WHERE sync_status IN ('processing', 'pending')", []),
    get("SELECT COUNT(*) AS total FROM knowledge_sources WHERE sync_status='failed'", []),
  ]);
  const counts = {
    total: Number(totalRow?.total || 0),
    available: Number(availableRow?.total || 0),
    processing: Number(processingRow?.total || 0),
    failed: Number(failedRow?.total || 0),
  };
  res.json({
    ok: true,
    vector_store_configured: Boolean(OPENAI_VECTOR_STORE_ID),
    openai_api_configured: Boolean(process.env.OPENAI_API_KEY),
    vector_store_id: OPENAI_VECTOR_STORE_ID || null,
    local_dir: knowledgeDir,
    counts,
    needs_reprocess: Math.max(counts.total - counts.available, 0),
    recent_failures: counts.failed,
    available_to_ai: counts.available,
    checked_at: new Date().toISOString(),
  });
});

app.get("/api/admin/rag/files", requireAuth(JWT_SECRET), requireRole("admin"), async (req, res) => {
  const [files, totalRow] = await Promise.all([
    all(
      `SELECT id, original_name, stored_name, mime_type, language, content_hash, department_name, source_kind, sync_status, openai_file_id, vector_store_file_id, uploaded_by, processing_state_json, created_at, updated_at
         FROM knowledge_sources
        ORDER BY datetime(updated_at) DESC, id DESC
        LIMIT 50`
    ),
    get("SELECT COUNT(*) AS total FROM knowledge_sources"),
  ]);

  const enriched = [];
  for (const file of files) {
    const refreshed = ["processing", "failed", "pending"].includes(String(file.sync_status || "").toLowerCase())
      ? await refreshKnowledgeSourceVectorStatus(file, { force: false })
      : file;
    enriched.push(buildKnowledgeAdminRow(refreshed || file));
  }

  res.json({ files: enriched, total: Number(totalRow?.total || 0) });
});

app.get("/api/admin/rag/files/:id/logs", requireAuth(JWT_SECRET), requireRole("admin"), async (req, res) => {
  const knowledgeSourceId = Number(req.params.id);
  const source = await getKnowledgeSourceById(knowledgeSourceId);
  if (!source) return res.status(404).json({ error: "not_found" });

  const [logs, history] = await Promise.all([
    all(
      `SELECT id, knowledge_source_id, stage_key, stage_status, message, detail_json, actor_user_id, created_at
         FROM knowledge_processing_logs
        WHERE knowledge_source_id=?
        ORDER BY datetime(created_at) DESC, id DESC
        LIMIT 120`,
      [knowledgeSourceId]
    ),
    all(
      `SELECT id, event_type, event_status, title, detail_text, meta_json, created_at
         FROM ai_training_events
        WHERE knowledge_source_id=?
        ORDER BY datetime(created_at) DESC, id DESC
        LIMIT 80`,
      [knowledgeSourceId]
    ),
  ]);

  res.json({
    source: buildKnowledgeAdminRow(source),
    logs,
    training_events: history,
  });
});

app.post("/api/admin/rag/files/:id/reprocess", requireAuth(JWT_SECRET), requireRole("admin"), async (req, res) => {
  try {
    const knowledgeSourceId = Number(req.params.id);
    const result = await reprocessKnowledgeSourceById(knowledgeSourceId, req.user.sub);
    res.json({ ok: true, file: result });
  } catch (err) {
    console.log("Erro ao reprocessar arquivo da base:", err?.message || err);
    res.status(err?.message === "knowledge_source_not_found" ? 404 : 400).json({
      error: err?.message || "knowledge_reprocess_failed",
    });
  }
});

app.get("/api/admin/ai-training/overview", requireAuth(JWT_SECRET), requireRole("admin"), async (req, res) => {
  const overview = await buildAiTrainingOverview();
  res.json(overview);
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

async function createKnowledgeSourceRecord({
  originalName,
  storedName,
  mimeType,
  language = null,
  contentHash = null,
  departmentName = null,
  sourceKind = "manual_upload",
  syncStatus = "processing",
  openaiFileId = null,
  vectorStoreFileId = null,
  uploadedBy = null,
  processingState = null,
}) {
  const created = await run(
    "INSERT INTO knowledge_sources (original_name, stored_name, mime_type, language, content_hash, department_name, source_kind, sync_status, openai_file_id, vector_store_file_id, uploaded_by, processing_state_json, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))",
    [
      originalName,
      storedName,
      mimeType || null,
      language || null,
      contentHash || null,
      departmentName || null,
      sourceKind,
      syncStatus,
      openaiFileId,
      vectorStoreFileId,
      uploadedBy,
      processingState ? safeJsonStringify(processingState, "{}") : null,
    ]
  );
  return created.lastID;
}

async function prepareKnowledgeVectorUploadFile(source, transcriptText = "") {
  const fullPath = getKnowledgeSourceFullPath(source);
  if (!fullPath || !fs.existsSync(fullPath)) {
    throw new Error("knowledge_source_file_missing");
  }

  if (isMediaKnowledgeFile(source.original_name, source.mime_type, fullPath)) {
    const transcriptPath = getTranscriptFilePathForKnowledge(source.stored_name);
    const normalizedTranscript = String(transcriptText || "").trim();
    if (!normalizedTranscript) {
      throw new Error("transcript_missing_for_vector_store");
    }
    fs.writeFileSync(transcriptPath, normalizedTranscript, "utf8");
    return {
      uploadPath: transcriptPath,
      uploadName: buildTranscriptStorageName(source.original_name || source.stored_name),
      uploadMimeType: "text/plain",
      transcriptPath,
    };
  }

  return {
    uploadPath: fullPath,
    uploadName: source.original_name,
    uploadMimeType: source.mime_type || "application/octet-stream",
    transcriptPath: null,
  };
}

async function ingestKnowledgeUpload(uploaded, userId, options = {}) {
  const tempPath = uploaded.path || path.join(uploadsDir, uploaded.filename);
  const safeOriginalName = sanitizeFilename(uploaded.originalname || `arquivo-${Date.now()}`);
  const sizeBytes = Number(uploaded.size || 0);
  const departmentName = String(options.departmentName || '').trim() || null;
  const sourceKind = String(options.sourceKind || 'manual_upload').trim() || 'manual_upload';

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
  const initialState = withKnowledgeStage(createKnowledgeProcessingState(), "upload", {
    status: "completed",
    size_bytes: sizeBytes,
    stored_name: storedName,
    original_name: safeOriginalName,
    mime_type: uploaded.mimetype || null,
    message: "Upload recebido e armazenado no disco persistente.",
  });
  const knowledgeSourceId = await createKnowledgeSourceRecord({
    originalName: safeOriginalName,
    storedName,
    mimeType: uploaded.mimetype || null,
    departmentName,
    sourceKind,
    syncStatus: "processing",
    uploadedBy: userId,
    processingState: initialState,
  });
  await appendKnowledgeProcessingLog(knowledgeSourceId, "upload", "completed", "Upload registrado com sucesso.", {
    size_bytes: sizeBytes,
    rel_path: relPath,
  }, userId);

  let state = initialState;
  let indexed = null;
  let openaiFile = null;
  let vectorStoreFile = null;
  let transcriptText = "";
  let transcriptLanguage = "";

  try {
    const isMedia = isMediaKnowledgeFile(safeOriginalName, uploaded.mimetype || "", finalPath);
    if (isMedia) {
      state = withKnowledgeStage(state, "transcript", {
        status: "processing",
        message: "Gerando transcricao da midia.",
      });
      await updateKnowledgeSourceState(knowledgeSourceId, state, "processing");
      await appendKnowledgeProcessingLog(knowledgeSourceId, "transcript", "processing", "Processamento de transcricao iniciado.", {}, userId);

      const transcriptResult = await transcribeMedia(finalPath, safeOriginalName, uploaded.mimetype || "");
      transcriptText = normalizeKnowledgeText(transcriptResult?.text || "");
      transcriptLanguage = normalizeLanguageCode(transcriptResult?.transcriptLanguage || detectConversationLanguage(transcriptText || safeOriginalName));

      state = withKnowledgeStage(state, "transcript", {
        status: transcriptText ? "completed" : "failed",
        source_kind: transcriptResult?.sourceKind || "media",
        used_audio_extraction: Boolean(transcriptResult?.usedAudioExtraction),
        language: transcriptLanguage || null,
        message: transcriptText
          ? "Transcricao concluida com sucesso."
          : "Nao foi possivel gerar texto a partir da midia.",
      });
      await appendKnowledgeProcessingLog(
        knowledgeSourceId,
        "transcript",
        transcriptText ? "completed" : "failed",
        transcriptText ? "Transcricao concluida." : "Transcricao vazia.",
        {
          transcript_language: transcriptLanguage || null,
          transcript_length: transcriptText.length,
        },
        userId
      );
    } else {
      state = withKnowledgeStage(state, "transcript", {
        status: "skipped",
        message: "Arquivo textual/documental nao exige transcricao.",
      });
    }

    state = withKnowledgeStage(state, "parsing", {
      status: "processing",
      message: "Extraindo e normalizando conteudo do arquivo.",
    });
    await updateKnowledgeSourceState(knowledgeSourceId, state, "processing");
    await appendKnowledgeProcessingLog(knowledgeSourceId, "parsing", "processing", "Parsing iniciado.", {}, userId);

    indexed = await upsertIndexedDocument({
      sourcePath: finalPath,
      relPath,
      originalName: safeOriginalName,
      mimeType: uploaded.mimetype || "",
      departmentName,
      sourceKind,
      extractedTextOverride: transcriptText,
      detectedLanguage: transcriptLanguage,
    });

    const parsingIssues = Array.isArray(indexed?.issues) ? indexed.issues : [];
    state = withKnowledgeStage(state, "parsing", {
      status: indexed?.extractedText ? "completed" : "failed",
      language: indexed?.language || null,
      content_hash: indexed?.contentHash || null,
      message: indexed?.extractedText
        ? "Conteudo extraido e normalizado com sucesso."
        : "Nao houve texto extraido do arquivo.",
      extracted_length: String(indexed?.extractedText || "").length,
    });
    state = withKnowledgeStage(state, "health", {
      status: parsingIssues.length ? "warning" : "healthy",
      issues: parsingIssues,
    });
    await updateKnowledgeSourceFields(knowledgeSourceId, {
      language: indexed?.language || null,
      content_hash: indexed?.contentHash || null,
      processing_state_json: safeJsonStringify(state, "{}"),
      sync_status: "processing",
    });
    await appendKnowledgeProcessingLog(
      knowledgeSourceId,
      "parsing",
      indexed?.extractedText ? "completed" : "failed",
      indexed?.extractedText ? "Parsing concluido." : "Parsing sem texto utilizavel.",
      {
        issues: parsingIssues,
        language: indexed?.language || null,
      },
      userId
    );

    state = withKnowledgeStage(state, "chunking", {
      status: indexed?.chunkCount ? "completed" : "failed",
      chunk_count: Number(indexed?.chunkCount || 0),
      message: indexed?.chunkCount
        ? `${indexed.chunkCount} chunk(s) semantico(s) gerado(s).`
        : "Nenhum chunk semantico foi gerado.",
    });
    await updateKnowledgeSourceState(knowledgeSourceId, state, "processing");
    await appendKnowledgeProcessingLog(
      knowledgeSourceId,
      "chunking",
      indexed?.chunkCount ? "completed" : "failed",
      indexed?.chunkCount ? "Chunking concluido." : "Chunking sem resultado.",
      { chunk_count: Number(indexed?.chunkCount || 0) },
      userId
    );

    const embeddingResult = await materializeDocumentEmbeddings(indexed?.documentId);
    state = withKnowledgeStage(state, "embedding", {
      status: embeddingResult.total > 0 && embeddingResult.failed === 0 ? "completed" : (embeddingResult.completed > 0 ? "processing" : "failed"),
      total: embeddingResult.total,
      completed: embeddingResult.completed,
      failed: embeddingResult.failed,
      message: embeddingResult.total
        ? `${embeddingResult.completed}/${embeddingResult.total} embedding(s) gerado(s).`
        : "Nenhum chunk disponivel para embedding.",
    });
    await updateKnowledgeSourceState(knowledgeSourceId, state, "processing");
    await appendKnowledgeProcessingLog(
      knowledgeSourceId,
      "embedding",
      state.embedding.status,
      state.embedding.message,
      embeddingResult,
      userId
    );

    if (process.env.OPENAI_API_KEY && OPENAI_VECTOR_STORE_ID) {
      state = withKnowledgeStage(state, "vector_store", {
        status: "processing",
        message: "Enviando conteudo para a Vector Store da OpenAI.",
      });
      await updateKnowledgeSourceState(knowledgeSourceId, state, "processing");
      await appendKnowledgeProcessingLog(knowledgeSourceId, "vector_store", "processing", "Upload para Vector Store iniciado.", {}, userId);

      const sourceRecord = await getKnowledgeSourceById(knowledgeSourceId);
      const uploadTarget = await prepareKnowledgeVectorUploadFile(sourceRecord, indexed?.extractedText || transcriptText);

      openaiFile = await uploadFileToOpenAI(
        uploadTarget.uploadPath,
        uploadTarget.uploadName,
        process.env.OPENAI_API_KEY,
        "user_data",
        uploadTarget.uploadMimeType
      );
      vectorStoreFile = await attachFileToVectorStore(
        openaiFile.id,
        OPENAI_VECTOR_STORE_ID,
        process.env.OPENAI_API_KEY
      );

      state = withKnowledgeStage(state, "vector_store", {
        status: normalizeStageStatus(vectorStoreFile?.status, "processing") === "completed" ? "completed" : "processing",
        file_id: openaiFile?.id || null,
        vector_store_file_id: vectorStoreFile?.id || null,
        file_status: openaiFile?.status || null,
        vector_status: vectorStoreFile?.status || null,
        message: "Arquivo enviado para a Vector Store. Validando disponibilidade.",
      });
      await updateKnowledgeSourceFields(knowledgeSourceId, {
        openai_file_id: openaiFile?.id || null,
        vector_store_file_id: vectorStoreFile?.id || null,
        processing_state_json: safeJsonStringify(state, "{}"),
        sync_status: "processing",
      });
      await appendKnowledgeProcessingLog(
        knowledgeSourceId,
        "vector_store",
        "processing",
        "Arquivo enviado para a OpenAI e anexado a Vector Store.",
        {
          openai_file_id: openaiFile?.id || null,
          vector_store_file_id: vectorStoreFile?.id || null,
        },
        userId
      );
    } else {
      state = withKnowledgeStage(state, "vector_store", {
        status: "skipped",
        message: "Vector Store nao configurada. O conhecimento fica disponivel via indice local.",
      });
    }

    const refreshed = await refreshKnowledgeSourceVectorStatus(await getKnowledgeSourceById(knowledgeSourceId), { force: true });
    const finalRow = buildKnowledgeAdminRow(refreshed || await getKnowledgeSourceById(knowledgeSourceId));
    await appendKnowledgeProcessingLog(
      knowledgeSourceId,
      "final",
      finalRow.available_to_ai ? "completed" : finalRow.availability_status,
      finalRow.processing_state?.final?.message || "Processamento concluido.",
      {
        available_to_ai: finalRow.available_to_ai,
        health_issues: finalRow.health_issues,
      },
      userId
    );
    await logAiTrainingEvent({
      userId,
      knowledgeSourceId,
      eventType: "knowledge_ingested",
      eventStatus: finalRow.available_to_ai ? "success" : "warning",
      title: safeOriginalName,
      detailText: finalRow.processing_state?.final?.message || "Conhecimento ingerido.",
      meta: {
        availability_status: finalRow.availability_status,
        chunking_status: finalRow.chunking_status,
        embedding_status: finalRow.embedding_status,
        vector_store_status: finalRow.vector_store_status,
      },
    });

    await logEvent(userId, "admin_rag_upload", {
      knowledge_source_id: knowledgeSourceId,
      filename: safeOriginalName,
      openai_file_id: openaiFile?.id || null,
      vector_store_file_id: vectorStoreFile?.id || null,
    });

    return {
      knowledge_source_id: knowledgeSourceId,
      original_name: safeOriginalName,
      stored_name: storedName,
      local_indexed: Boolean(indexed),
      language: indexed?.language || null,
      department_name: departmentName,
      source_kind: sourceKind,
      sync_status: finalRow.availability_status,
      openai_file_id: openaiFile?.id || null,
      vector_store_file_id: vectorStoreFile?.id || null,
      processing_state: finalRow.processing_state,
      parsing_status: finalRow.parsing_status,
      transcript_status: finalRow.transcript_status,
      chunking_status: finalRow.chunking_status,
      embedding_status: finalRow.embedding_status,
      vector_store_status: finalRow.vector_store_status,
      available_to_ai: finalRow.available_to_ai,
      last_error: finalRow.last_error,
    };
  } catch (err) {
    console.log("Erro no pipeline de conhecimento:", err?.message || err);
    state = withKnowledgeStage(state, "health", {
      status: "failed",
      issues: [...new Set([...(state.health?.issues || []), "falha_processamento"])],
    });
    const failedStage = state.vector_store?.status === "processing"
      ? "vector_store"
      : state.embedding?.status === "processing"
        ? "embedding"
        : state.chunking?.status === "processing"
          ? "chunking"
          : state.parsing?.status === "processing"
            ? "parsing"
            : "upload";
    state = withKnowledgeStage(state, failedStage, {
      status: "failed",
      message: err?.message || "knowledge_processing_failed",
      error: err?.message || "knowledge_processing_failed",
    });
    await updateKnowledgeSourceState(knowledgeSourceId, state, "failed");
    await appendKnowledgeProcessingLog(
      knowledgeSourceId,
      failedStage,
      "failed",
      err?.message || "knowledge_processing_failed",
      {},
      userId
    );
    await logAiTrainingEvent({
      userId,
      knowledgeSourceId,
      eventType: "knowledge_ingestion_failed",
      eventStatus: "error",
      title: safeOriginalName,
      detailText: err?.message || "knowledge_processing_failed",
      meta: {
        failed_stage: failedStage,
      },
    });
    throw err;
  }
}

async function reprocessKnowledgeSourceById(knowledgeSourceId, actorUserId) {
  const source = await getKnowledgeSourceById(knowledgeSourceId);
  if (!source) throw new Error("knowledge_source_not_found");

  const fullPath = getKnowledgeSourceFullPath(source);
  if (!fullPath || !fs.existsSync(fullPath)) {
    throw new Error("knowledge_source_file_missing");
  }

  let state = withKnowledgeStage(getKnowledgeProcessingState(source), "upload", {
    status: "completed",
    message: "Arquivo localizado para reprocessamento.",
  });
  await updateKnowledgeSourceState(knowledgeSourceId, state, "processing");
  await appendKnowledgeProcessingLog(knowledgeSourceId, "upload", "completed", "Reprocessamento iniciado.", {}, actorUserId);

  let transcriptText = "";
  let transcriptLanguage = "";

  try {
    if (isMediaKnowledgeFile(source.original_name, source.mime_type, fullPath)) {
      state = withKnowledgeStage(state, "transcript", {
        status: "processing",
        message: "Reprocessando transcricao da midia.",
      });
      await updateKnowledgeSourceState(knowledgeSourceId, state, "processing");

      const transcriptResult = await transcribeMedia(fullPath, source.original_name, source.mime_type || "");
      transcriptText = normalizeKnowledgeText(transcriptResult?.text || "");
      transcriptLanguage = normalizeLanguageCode(transcriptResult?.transcriptLanguage || detectConversationLanguage(transcriptText || source.original_name));

      state = withKnowledgeStage(state, "transcript", {
        status: transcriptText ? "completed" : "failed",
        language: transcriptLanguage || null,
        source_kind: transcriptResult?.sourceKind || "media",
        used_audio_extraction: Boolean(transcriptResult?.usedAudioExtraction),
        message: transcriptText ? "Transcricao reprocessada com sucesso." : "Transcricao vazia durante o reprocessamento.",
      });
      await appendKnowledgeProcessingLog(
        knowledgeSourceId,
        "transcript",
        transcriptText ? "completed" : "failed",
        transcriptText ? "Transcricao reprocessada." : "Transcricao vazia no reprocessamento.",
        {
          transcript_language: transcriptLanguage || null,
          transcript_length: transcriptText.length,
        },
        actorUserId
      );
    } else {
      state = withKnowledgeStage(state, "transcript", {
        status: "skipped",
        message: "Arquivo textual/documental nao exige transcricao.",
      });
    }

    state = withKnowledgeStage(state, "parsing", {
      status: "processing",
      message: "Reprocessando parsing e normalizacao do conteudo.",
    });
    await updateKnowledgeSourceState(knowledgeSourceId, state, "processing");

    const indexed = await upsertIndexedDocument({
      sourcePath: fullPath,
      relPath: path.relative(kbDir, fullPath).replace(/\\/g, "/"),
      originalName: source.original_name,
      mimeType: source.mime_type || "",
      departmentName: source.department_name || "",
      sourceKind: source.source_kind || "manual_upload",
      extractedTextOverride: transcriptText,
      detectedLanguage: transcriptLanguage,
    });

    const parsingIssues = Array.isArray(indexed?.issues) ? indexed.issues : [];
    state = withKnowledgeStage(state, "parsing", {
      status: indexed?.extractedText ? "completed" : "failed",
      language: indexed?.language || null,
      content_hash: indexed?.contentHash || null,
      extracted_length: String(indexed?.extractedText || "").length,
      message: indexed?.extractedText ? "Parsing reprocessado com sucesso." : "Reprocessamento sem texto utilizavel.",
    });
    state = withKnowledgeStage(state, "health", {
      status: parsingIssues.length ? "warning" : "healthy",
      issues: parsingIssues,
    });
    await updateKnowledgeSourceFields(knowledgeSourceId, {
      language: indexed?.language || null,
      content_hash: indexed?.contentHash || null,
      processing_state_json: safeJsonStringify(state, "{}"),
      sync_status: "processing",
    });
    await appendKnowledgeProcessingLog(knowledgeSourceId, "parsing", state.parsing.status, state.parsing.message, {
      issues: parsingIssues,
      language: indexed?.language || null,
    }, actorUserId);

    state = withKnowledgeStage(state, "chunking", {
      status: indexed?.chunkCount ? "completed" : "failed",
      chunk_count: Number(indexed?.chunkCount || 0),
      message: indexed?.chunkCount
        ? `${indexed.chunkCount} chunk(s) semantico(s) regenerado(s).`
        : "Nenhum chunk foi gerado no reprocessamento.",
    });
    await updateKnowledgeSourceState(knowledgeSourceId, state, "processing");

    const embeddingResult = await materializeDocumentEmbeddings(indexed?.documentId);
    state = withKnowledgeStage(state, "embedding", {
      status: embeddingResult.total > 0 && embeddingResult.failed === 0 ? "completed" : (embeddingResult.completed > 0 ? "processing" : "failed"),
      total: embeddingResult.total,
      completed: embeddingResult.completed,
      failed: embeddingResult.failed,
      message: embeddingResult.total
        ? `${embeddingResult.completed}/${embeddingResult.total} embedding(s) gerado(s) no reprocessamento.`
        : "Nenhum chunk disponivel para embedding.",
    });
    await updateKnowledgeSourceState(knowledgeSourceId, state, "processing");
    await appendKnowledgeProcessingLog(knowledgeSourceId, "embedding", state.embedding.status, state.embedding.message, embeddingResult, actorUserId);

    if (process.env.OPENAI_API_KEY && OPENAI_VECTOR_STORE_ID) {
      state = withKnowledgeStage(state, "vector_store", {
        status: "processing",
        message: "Reenviando conteudo para a Vector Store.",
      });
      await updateKnowledgeSourceState(knowledgeSourceId, state, "processing");

      const uploadTarget = await prepareKnowledgeVectorUploadFile(source, indexed?.extractedText || transcriptText);
      const openaiFile = await uploadFileToOpenAI(
        uploadTarget.uploadPath,
        uploadTarget.uploadName,
        process.env.OPENAI_API_KEY,
        "user_data",
        uploadTarget.uploadMimeType
      );
      const vectorStoreFile = await attachFileToVectorStore(
        openaiFile.id,
        OPENAI_VECTOR_STORE_ID,
        process.env.OPENAI_API_KEY
      );

      state = withKnowledgeStage(state, "vector_store", {
        status: normalizeStageStatus(vectorStoreFile?.status, "processing") === "completed" ? "completed" : "processing",
        file_id: openaiFile?.id || null,
        vector_store_file_id: vectorStoreFile?.id || null,
        file_status: openaiFile?.status || null,
        vector_status: vectorStoreFile?.status || null,
        message: "Arquivo reenviado para a Vector Store.",
      });
      await updateKnowledgeSourceFields(knowledgeSourceId, {
        openai_file_id: openaiFile?.id || null,
        vector_store_file_id: vectorStoreFile?.id || null,
        processing_state_json: safeJsonStringify(state, "{}"),
        sync_status: "processing",
      });
      await appendKnowledgeProcessingLog(
        knowledgeSourceId,
        "vector_store",
        "processing",
        "Reindexacao enviada para a OpenAI.",
        {
          openai_file_id: openaiFile?.id || null,
          vector_store_file_id: vectorStoreFile?.id || null,
        },
        actorUserId
      );
    } else {
      state = withKnowledgeStage(state, "vector_store", {
        status: "skipped",
        message: "Vector Store nao configurada. Reprocessamento local concluido.",
      });
    }

    const refreshed = await refreshKnowledgeSourceVectorStatus(await getKnowledgeSourceById(knowledgeSourceId), { force: true });
    const finalRow = buildKnowledgeAdminRow(refreshed || await getKnowledgeSourceById(knowledgeSourceId));
    await appendKnowledgeProcessingLog(
      knowledgeSourceId,
      "final",
      finalRow.available_to_ai ? "completed" : finalRow.availability_status,
      finalRow.processing_state?.final?.message || "Reprocessamento concluido.",
      {
        available_to_ai: finalRow.available_to_ai,
        health_issues: finalRow.health_issues,
      },
      actorUserId
    );
    await logAiTrainingEvent({
      userId: actorUserId,
      knowledgeSourceId,
      eventType: "knowledge_reprocessed",
      eventStatus: finalRow.available_to_ai ? "success" : "warning",
      title: source.original_name,
      detailText: finalRow.processing_state?.final?.message || "Reprocessamento concluido.",
    });
    return finalRow;
  } catch (err) {
    const failedStage = state.vector_store?.status === "processing"
      ? "vector_store"
      : state.embedding?.status === "processing"
        ? "embedding"
        : state.chunking?.status === "processing"
          ? "chunking"
          : state.parsing?.status === "processing"
            ? "parsing"
            : state.transcript?.status === "processing"
              ? "transcript"
              : "upload";
    state = withKnowledgeStage(state, failedStage, {
      status: "failed",
      message: err?.message || "knowledge_reprocess_failed",
      error: err?.message || "knowledge_reprocess_failed",
    });
    state = withKnowledgeStage(state, "health", {
      status: "failed",
      issues: [...new Set([...(state.health?.issues || []), "falha_reprocessamento"])],
    });
    await updateKnowledgeSourceState(knowledgeSourceId, state, "failed");
    await appendKnowledgeProcessingLog(knowledgeSourceId, failedStage, "failed", err?.message || "knowledge_reprocess_failed", {}, actorUserId);
    await logAiTrainingEvent({
      userId: actorUserId,
      knowledgeSourceId,
      eventType: "knowledge_reprocess_failed",
      eventStatus: "error",
      title: source.original_name,
      detailText: err?.message || "knowledge_reprocess_failed",
      meta: {
        failed_stage: failedStage,
      },
    });
    throw err;
  }
}

async function buildAiTrainingOverview() {
  const [sources, needsReprocessSources, failedSources, recentLogs, recentEvents, memoryRows, topUsedRows, totalKnowledgeRow, availableKnowledgeRow, failedKnowledgeRow, processingKnowledgeRow, totalMemoryRow] = await Promise.all([
    all(`SELECT id, original_name, stored_name, mime_type, language, department_name, source_kind, sync_status, openai_file_id, vector_store_file_id, uploaded_by, processing_state_json, created_at, updated_at
           FROM knowledge_sources
          ORDER BY datetime(updated_at) DESC, id DESC
          LIMIT 120`),
    all(`SELECT id, original_name, stored_name, mime_type, language, department_name, source_kind, sync_status, openai_file_id, vector_store_file_id, uploaded_by, processing_state_json, created_at, updated_at
           FROM knowledge_sources
          WHERE COALESCE(sync_status, 'pending') NOT IN ('available', 'synced', 'local')
          ORDER BY datetime(updated_at) DESC, id DESC
          LIMIT 20`),
    all(`SELECT id, original_name, stored_name, mime_type, language, department_name, source_kind, sync_status, openai_file_id, vector_store_file_id, uploaded_by, processing_state_json, created_at, updated_at
           FROM knowledge_sources
          WHERE sync_status='failed'
          ORDER BY datetime(updated_at) DESC, id DESC
          LIMIT 20`),
    all(`SELECT id, knowledge_source_id, stage_key, stage_status, message, detail_json, actor_user_id, created_at
           FROM knowledge_processing_logs
          ORDER BY datetime(created_at) DESC, id DESC
          LIMIT 80`),
    all(`SELECT id, user_id, conversation_id, knowledge_source_id, event_type, event_status, title, detail_text, meta_json, created_at
           FROM ai_training_events
          ORDER BY datetime(created_at) DESC, id DESC
          LIMIT 80`),
    all(`SELECT id, user_id, conversation_id, memory_scope, memory_kind, title, content_text, topics_json, language, created_at, updated_at
           FROM memory_entries
          ORDER BY datetime(updated_at) DESC, id DESC
          LIMIT 120`),
    all(`SELECT ai_training_events.knowledge_source_id, COUNT(*) AS total, MAX(knowledge_sources.original_name) AS name
           FROM ai_training_events
      LEFT JOIN knowledge_sources ON knowledge_sources.id = ai_training_events.knowledge_source_id
          WHERE event_type='knowledge_used' AND ai_training_events.knowledge_source_id IS NOT NULL
          GROUP BY ai_training_events.knowledge_source_id
          ORDER BY total DESC
          LIMIT 10`),
    get("SELECT COUNT(*) AS total FROM knowledge_sources", []),
    get("SELECT COUNT(*) AS total FROM knowledge_sources WHERE sync_status IN ('available', 'synced', 'local')", []),
    get("SELECT COUNT(*) AS total FROM knowledge_sources WHERE sync_status='failed'", []),
    get("SELECT COUNT(*) AS total FROM knowledge_sources WHERE sync_status IN ('processing', 'pending')", []),
    get("SELECT COUNT(*) AS total FROM memory_entries", []),
  ]);

  const knowledgeRows = [];
  for (const source of sources) {
    const maybeRefreshed = ["processing", "failed", "pending"].includes(String(source.sync_status || "").toLowerCase())
      ? await refreshKnowledgeSourceVectorStatus(source, { force: false })
      : source;
    knowledgeRows.push(buildKnowledgeAdminRow(maybeRefreshed || source));
  }

  const needsReprocessRows = [];
  for (const source of needsReprocessSources) {
    const maybeRefreshed = ["processing", "failed", "pending"].includes(String(source.sync_status || "").toLowerCase())
      ? await refreshKnowledgeSourceVectorStatus(source, { force: false })
      : source;
    needsReprocessRows.push(buildKnowledgeAdminRow(maybeRefreshed || source));
  }

  const failedRows = [];
  for (const source of failedSources) {
    const maybeRefreshed = ["processing", "failed", "pending"].includes(String(source.sync_status || "").toLowerCase())
      ? await refreshKnowledgeSourceVectorStatus(source, { force: false })
      : source;
    failedRows.push(buildKnowledgeAdminRow(maybeRefreshed || source));
  }

  const counts = {
    total: Number(totalKnowledgeRow?.total || 0),
    available: Number(availableKnowledgeRow?.total || 0),
    failed: Number(failedKnowledgeRow?.total || 0),
    processing: Number(processingKnowledgeRow?.total || 0),
  };

  const topicCounter = new Map();
  for (const row of memoryRows) {
    const topics = safeJsonParse(row.topics_json || "[]") || [];
    topics.forEach((topic) => {
      const safe = String(topic || "").trim();
      if (!safe) return;
      topicCounter.set(safe, (topicCounter.get(safe) || 0) + 1);
    });
  }

  const topTopics = [...topicCounter.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, 12)
    .map(([topic, total]) => ({ topic, total }));

  const sourceLookup = new Map(knowledgeRows.map((row) => [Number(row.id), row]));
  const topDocuments = topUsedRows.map((row) => ({
    knowledge_source_id: row.knowledge_source_id,
    total: Number(row.total || 0),
    name: row.name || sourceLookup.get(Number(row.knowledge_source_id))?.original_name || `Documento #${row.knowledge_source_id}`,
  }));

  return {
    openai: {
      api_configured: Boolean(process.env.OPENAI_API_KEY),
      vector_store_configured: Boolean(OPENAI_VECTOR_STORE_ID),
      vector_store_id: OPENAI_VECTOR_STORE_ID || null,
      checked_at: new Date().toISOString(),
    },
    knowledge: {
      counts,
      files: knowledgeRows.slice(0, 40),
      needs_reprocess: needsReprocessRows,
      recent_failures: failedRows,
      top_documents: topDocuments,
    },
    processing_logs: recentLogs,
    memories: {
      total: Number(totalMemoryRow?.total || 0),
      recent: memoryRows.slice(0, 20),
      top_topics: topTopics,
      by_scope: memoryRows.reduce((acc, row) => {
        const key = row.memory_scope || "unknown";
        acc[key] = (acc[key] || 0) + 1;
        return acc;
      }, {}),
    },
    training_events: {
      recent: recentEvents,
      weak_responses: recentEvents.filter((event) => event.event_type === "weak_response").slice(0, 20),
      memory_hits: recentEvents.filter((event) => event.event_type === "memory_hit").slice(0, 20),
      knowledge_hits: recentEvents.filter((event) => event.event_type === "knowledge_used").slice(0, 20),
    },
  };
}

app.post("/api/admin/rag/upload", requireAuth(JWT_SECRET), requireRole("admin"), ragUploadMiddleware, async (req, res) => {
  const uploads = getAdminRagUploads(req);
  if (!uploads.length) return res.status(400).json({ error: "missing_file" });

  const files = [];
  const duplicates = [];
  const errors = [];

  const departmentName = String(req.body?.department_name || req.body?.department || "").trim();
  for (const uploaded of uploads) {
    try {
      const result = await ingestKnowledgeUpload(uploaded, req.user.sub, { departmentName, sourceKind: "manual_upload" });
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

app.get('/api/intranet/sales/bootstrap', requireAuth(JWT_SECRET), requireIntranetAccess, async (req, res) => {
  const sales = await buildSalesIntranetPayload(req.currentUser || await getUserById(req.user.sub));
  if (!sales.enabled) return res.status(403).json({ error: 'sales_access_denied' });
  res.json({ sales });
});

app.get('/api/intranet/sales/records', requireAuth(JWT_SECRET), requireIntranetAccess, async (req, res) => {
  const user = req.currentUser || await getUserById(req.user.sub);
  const scope = await getSalesAccessScope(user);
  if (!scope.enabled) return res.status(403).json({ error: 'sales_access_denied' });
  const payload = await getSalesSummaryForScope(scope, {
    closerId: req.query?.closer_id,
    status: req.query?.status,
    search: req.query?.search,
    limit: Math.min(150, Math.max(1, Number(req.query?.limit || 80))),
  });
  res.json({ summary: payload.totals, records: payload.records.map(serializeSalesRecord) });
});

app.get('/api/intranet/sales/records/:id/history', requireAuth(JWT_SECRET), requireIntranetAccess, async (req, res) => {
  const user = req.currentUser || await getUserById(req.user.sub);
  const scope = await getSalesAccessScope(user);
  if (!scope.enabled) return res.status(403).json({ error: 'sales_access_denied' });
  const record = await getSalesRecordById(Number(req.params.id));
  if (!record) return res.status(404).json({ error: 'not_found' });
  if (!scope.canViewAll && Number(record.user_id || 0) !== Number(user.id || user.sub)) {
    return res.status(403).json({ error: 'forbidden' });
  }
  const history = await getSalesRecordHistory(Number(req.params.id));
  res.json({ record: serializeSalesRecord(record), history });
});

app.patch('/api/intranet/sales/records/:id', requireAuth(JWT_SECRET), requireIntranetAccess, async (req, res) => {
  try {
    const user = req.currentUser || await getUserById(req.user.sub);
    const updated = await updateSalesRecord(Number(req.params.id), req.body || {}, user);
    const history = await getSalesRecordHistory(Number(req.params.id));
    res.json({ ok: true, record: updated, history });
  } catch (err) {
    if (err?.message === 'not_found') return res.status(404).json({ error: 'not_found' });
    if (err?.message === 'forbidden') return res.status(403).json({ error: 'forbidden' });
    res.status(400).json({ error: err?.message || 'sales_record_update_failed' });
  }
});
app.get("/api/intranet/bootstrap", requireAuth(JWT_SECRET), requireIntranetAccess, async (req, res) => {
  const payload = await buildIntranetPayload(req.user.sub);
  res.json(payload || { user: null, intranet: null, department_catalog: [] });
});

app.get("/api/intranet/training/bootstrap", requireAuth(JWT_SECRET), requireIntranetAccess, async (req, res) => {
  const user = req.currentUser || await getUserById(req.user.sub);
  if (!user || user.role !== "admin") return res.status(403).json({ error: "forbidden" });
  const overview = await buildAiTrainingOverview();
  res.json({ training: overview });
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















































































































