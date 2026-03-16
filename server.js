require("dotenv").config();

const express = require("express");
const path = require("path");
const fs = require("fs");
const os = require("os");
const crypto = require("crypto");
const { URLSearchParams } = require("url");
const cookieParser = require("cookie-parser");
const bcrypt = require("bcryptjs");
const multer = require("multer");
const jwt = require("jsonwebtoken");

const { DATA_DIR, DB_CLIENT, migrate, get, all, run, uploadsDir, kbDir, logEvent, searchDocuments } = require("./db");
const {
  DEFAULT_LOCALE,
  detectLanguage,
  formatDailyGreeting,
  getLanguageLabel,
  localeToLanguage,
  normalizeLanguageCode,
  normalizeLocaleCode,
  normalizeText: normalizeLanguageText,
  repairMojibakeText,
} = require("./lib/language");
const { evaluateEducationalModeration } = require("./lib/moderation");
const { chunkTextSemantically, cosineSimilarity, extractKeywords, hashText, normalizeSemanticText, parseEmbedding } = require("./lib/semantic");
const {
  DEPARTMENT_DEFINITIONS,
  buildDepartmentSeedRows,
  buildDepartmentSubmenuSeedRows,
  buildIntranetWorkspace,
  sanitizeDepartment,
  sanitizeDepartmentList,
} = require("./lib/intranet");
const {
  CALENDAR_MEETING_MODES,
  buildCalendarEventTypeSeedRows,
  sanitizeMeetingMode,
} = require("./lib/calendar");
const { signSession, requireAuth, requireRole } = require("./auth");
const { detectExt, extractText } = require("./lib/extract");
const { generateArtifact } = require("./lib/generate");
const { buildDocumentKnowledgeProfile, normalizeDisplayName } = require("./lib/knowledge");
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
const { queryLooksCurrent, resolveExternalToolContext } = require("./lib/webSearch");
const {
  buildTalkersPublicKnowledgeBundle,
  getTalkersPublicKnowledgeDiagnostics,
  queryLooksAboutTalkers,
  scheduleTalkersKnowledgeSync,
  syncTalkersPublicKnowledge,
} = require("./lib/talkersPublicKnowledge");
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
const {
  WORKBOOK_SOURCE: MARKETING_INDICATOR_WORKBOOK_SOURCE,
  MARKETING_INDICATOR_SEEDS,
} = require("./lib/marketingIndicatorSeed");

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
const OPENAI_REQUEST_TIMEOUT_MS = Math.max(5000, Number(process.env.OPENAI_REQUEST_TIMEOUT_MS || 30000));
const OPENAI_EMBEDDING_TIMEOUT_MS = Math.max(5000, Number(process.env.OPENAI_EMBEDDING_TIMEOUT_MS || OPENAI_REQUEST_TIMEOUT_MS));
const OPENAI_PROMPT_ID = String(process.env.OPENAI_PROMPT_ID || "").trim();
const OPENAI_PROMPT_VERSION = String(process.env.OPENAI_PROMPT_VERSION || "").trim();
const OPENAI_PROMPT_VARIABLES_JSON = String(process.env.OPENAI_PROMPT_VARIABLES_JSON || "").trim();
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
const DEFAULT_CONVERSATION_TITLES = new Set([
  'nova conversa',
  'new conversation',
  'nueva conversacion',
  'nuova conversazione',
  'nouvelle conversation',
]);
const FIXED_DEPARTMENT_BY_EMAIL = {
  'julia@talkers.com': ['RH'],
  'laura@talkers.com': ['Administrativo'],
};
const SALES_VIEW_DEPARTMENTS = new Set(['comercial', 'gestao', 'administrativo', 'financeiro', 'atendimento']);
const SALES_EDITABLE_FIELDS = ['operational_status', 'follow_up_notes', 'next_action', 'next_action_date', 'observations'];
const SALES_SOURCE_KEY = 'matriculas-novas';
const MARKETING_INFLUENCER_STATUSES = new Set(['ativo', 'em teste', 'pausado', 'encerrado']);
const MARKETING_INFLUENCE_TYPE_SUGGESTIONS = ['Stories', 'Reels', 'Postagens', 'UGC', 'Presenca em evento', 'Campanha local'];
const MARKETING_CONTRACT_TYPE_SUGGESTIONS = ['Permuta', 'Contrato mensal', 'Campanha pontual', 'Comissao', 'Teste'];
const MARKETING_INDICATOR_ALLOWED_PERSON_NAMES = new Set(['bruna rafaela', 'bruna goncalves', 'viviane siepeman', 'cristiana freitas']);
const PEDAGOGICAL_WHATSAPP_GROUP_STATUSES = new Set(["active", "inactive"]);
const PEDAGOGICAL_WHATSAPP_CAMPAIGN_STATUSES = new Set(["draft", "prepared", "running", "completed", "error", "cancelled"]);
const PEDAGOGICAL_WHATSAPP_ITEM_STATUSES = new Set(["queued", "sending", "sent", "error", "pending_provider", "cancelled"]);
const PEDAGOGICAL_WHATSAPP_DEFAULT_INTERVAL_SECONDS = 30;
const CHAT_PERFORMANCE_SAMPLE_LIMIT = 60;
const CHAT_HISTORY_CONTEXT_LIMIT = 8;
const CHAT_HISTORY_CONTEXT_MAX_CHARS = 2200;
const CHAT_CONTEXT_BLOCK_MAX_CHARS = 3200;
const CHAT_MEMORY_BLOCK_MAX_CHARS = 900;
const CHAT_SUPPORT_CACHE_TTL_MS = 60 * 1000;
const CHAT_SUPPORT_CACHE_MAX = 160;
const WHATSAPP_PROVIDER_ENABLED = String(process.env.WHATSAPP_PROVIDER_ENABLED || "").trim() === "1";
const WHATSAPP_PROVIDER_NAME = String(process.env.WHATSAPP_PROVIDER_NAME || "").trim();
const WHATSAPP_PROVIDER_API_URL = String(process.env.WHATSAPP_PROVIDER_API_URL || "").trim();
const WHATSAPP_PROVIDER_TOKEN = String(process.env.WHATSAPP_PROVIDER_TOKEN || "").trim();

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
const RAG_BLOCKED_EXTS = new Set([
  ".exe",
  ".msi",
  ".bat",
  ".cmd",
  ".com",
  ".scr",
  ".ps1",
  ".dll",
  ".jar",
  ".apk",
  ".app",
  ".dmg",
  ".pkg",
  ".sh",
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
const CALENDAR_EVENT_STATUSES = new Set(["scheduled", "cancelled"]);
const DOCUMENT_MEMORY_USER_ID = 0;
const KNOWLEDGE_MEMORY_SCOPE = "knowledge_document";
const KNOWLEDGE_MEMORY_KIND = "document_semantic";
const BACKGROUND_KNOWLEDGE_SWEEP_BATCH = 50;
const BACKGROUND_KNOWLEDGE_SWEEP_INTERVAL_MS = 12 * 1000;
const BACKGROUND_KNOWLEDGE_IDLE_INTERVAL_MS = 2 * 60 * 1000;

const knowledgeBackgroundState = {
  queue: [],
  queuedIds: new Set(),
  running: false,
  sweepScheduled: false,
  queue_processed: 0,
  queue_failed: 0,
  queue_enqueued: 0,
  current_source_id: null,
  last_started_at: null,
  last_finished_at: null,
  last_error: "",
  last_sweep_at: null,
};

const chatPerformanceState = {
  samples: [],
  concurrent_requests: 0,
  peak_concurrent: 0,
  last_response_ms: 0,
  last_api_latency_ms: 0,
  last_internal_ms: 0,
   last_context_ms: 0,
   last_persistence_ms: 0,
  last_prompt_chars: 0,
  last_response_chars: 0,
   last_payload_bytes: 0,
   last_response_bytes: 0,
  last_web_search_calls: 0,
  last_data_api_calls: 0,
  last_file_search_calls: 0,
  last_talkers_public_hits: 0,
  last_external_context_hits: 0,
  last_status: "idle",
  last_updated_at: null,
};
const chatSupportContextCache = new Map();

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

function getRequestLocale(req, fallback = DEFAULT_LOCALE) {
  const headerLocale = String(req.headers["x-talkers-locale"] || "").trim();
  const cookieLocale = String(req.cookies?.talkers_locale || "").trim();
  const queryLocale = String(req.query?.locale || "").trim();
  const userLocale = String(req.currentUser?.preferred_locale || req.user?.preferred_locale || "").trim();
  return normalizeLocaleCode(headerLocale || cookieLocale || queryLocale || userLocale || fallback);
}

async function maybeInsertDailyGreeting(conversationId, user, locale = DEFAULT_LOCALE) {
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

  const safeLocale = normalizeLocaleCode(locale || user?.preferred_locale || DEFAULT_LOCALE);
  const greeting = formatDailyGreeting(user.name || 'Usuario', safeLocale);
  const meta = JSON.stringify({
    daily_greeting: true,
    greeting_date: todayKey,
    structured: false,
    response_language: localeToLanguage(safeLocale),
    response_locale: safeLocale,
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

function formatDateTimeBrazil(value) {
  if (!value) return "";
  try {
    return new Intl.DateTimeFormat("pt-BR", {
      timeZone: "America/Sao_Paulo",
      dateStyle: "short",
      timeStyle: "short",
    }).format(new Date(value));
  } catch {
    return String(value || "");
  }
}

function formatDateBrazil(value) {
  if (!value) return "";
  try {
    return new Intl.DateTimeFormat("pt-BR", {
      timeZone: "America/Sao_Paulo",
      dateStyle: "short",
    }).format(new Date(value));
  } catch {
    return String(value || "");
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

function isDefaultConversationTitle(value = "") {
  return DEFAULT_CONVERSATION_TITLES.has(String(value || "").trim().toLowerCase());
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

function trimContextText(value = "", maxChars = CHAT_CONTEXT_BLOCK_MAX_CHARS) {
  const safeValue = String(value || "").trim();
  if (!safeValue || safeValue.length <= maxChars) return safeValue;
  return `${safeValue.slice(0, Math.max(0, maxChars - 3)).trim()}...`;
}

function buildCompactHistoryText(history = [], {
  maxItems = CHAT_HISTORY_CONTEXT_LIMIT,
  maxChars = CHAT_HISTORY_CONTEXT_MAX_CHARS,
} = {}) {
  const safeHistory = Array.isArray(history)
    ? history.filter((item) => {
        const content = String(item?.content || "").trim();
        if (!content) return false;
        if (item?.role === "assistant" && (responseLooksSelfLimiting(content) || responseLooksWeak(content))) {
          return false;
        }
        return true;
      })
    : [];
  if (!safeHistory.length) return "";
  const recent = safeHistory.slice(-Math.max(1, maxItems));
  const lines = [];
  let totalChars = 0;

  for (let index = recent.length - 1; index >= 0; index -= 1) {
    const item = recent[index];
    const roleLabel = item.role === "assistant" ? "IA" : "Usuario";
    const safeLine = `${roleLabel}: ${trimContextText(item.content || "", 420)}`;
    if (totalChars + safeLine.length > maxChars && lines.length) break;
    lines.unshift(safeLine);
    totalChars += safeLine.length;
  }

  const omitted = Math.max(0, safeHistory.length - lines.length);
  if (omitted > 0) {
    lines.unshift(`Historico anterior resumido: ${omitted} mensagem(ns) mais antiga(s) foram ocultadas para reduzir latencia.`);
  }
  return lines.join("\n");
}

function getChatSupportCacheEntry(cacheKey = "") {
  const cached = chatSupportContextCache.get(cacheKey);
  if (!cached) return null;
  if ((Date.now() - Number(cached.cachedAt || 0)) > CHAT_SUPPORT_CACHE_TTL_MS) {
    chatSupportContextCache.delete(cacheKey);
    return null;
  }
  return cached.value || null;
}

function setChatSupportCacheEntry(cacheKey = "", value = null) {
  if (!cacheKey || !value) return;
  if (chatSupportContextCache.size >= CHAT_SUPPORT_CACHE_MAX) {
    const firstKey = chatSupportContextCache.keys().next().value;
    if (firstKey) chatSupportContextCache.delete(firstKey);
  }
  chatSupportContextCache.set(cacheKey, {
    cachedAt: Date.now(),
    value,
  });
}

function repairDeepText(value) {
  if (Array.isArray(value)) return value.map(repairDeepText);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, nested]) => [key, repairDeepText(nested)])
    );
  }
  return typeof value === "string" ? repairMojibakeText(value) : value;
}

function normalizeIndicatorHeaderValue(value = "") {
  const repaired = repairMojibakeText(String(value || "").trim());
  if (!repaired) return "";
  if (repaired === "System.Xml.XmlElement") return "Nome do aluno";
  return repaired;
}

function beginChatPerformanceSample(promptChars = 0) {
  chatPerformanceState.concurrent_requests += 1;
  chatPerformanceState.peak_concurrent = Math.max(
    Number(chatPerformanceState.peak_concurrent || 0),
    Number(chatPerformanceState.concurrent_requests || 0)
  );
  return {
    started_at: Date.now(),
    prompt_chars: Number(promptChars || 0),
  };
}

function finalizeChatPerformanceSample(sample = {}, metrics = {}) {
  const finishedAt = Date.now();
  const totalResponseMs = Math.max(0, Number(metrics.total_response_ms || (finishedAt - Number(sample.started_at || finishedAt))));
  const apiLatencyMs = Math.max(0, Number(metrics.api_latency_ms || 0));
  const internalMs = Math.max(0, Number(metrics.internal_processing_ms || (totalResponseMs - apiLatencyMs)));
  const contextMs = Math.max(0, Number(metrics.context_assembly_ms || 0));
  const persistenceMs = Math.max(0, Number(metrics.persistence_ms || 0));
  const promptChars = Math.max(0, Number(metrics.prompt_chars || sample.prompt_chars || 0));
  const responseChars = Math.max(0, Number(metrics.response_chars || 0));
  const payloadBytes = Math.max(0, Number(metrics.payload_bytes || 0));
  const responseBytes = Math.max(0, Number(metrics.response_bytes || 0));
  const webSearchCalls = Math.max(0, Number(metrics.web_search_calls || 0));
  const dataApiCalls = Math.max(0, Number(metrics.data_api_calls || 0));
  const fileSearchCalls = Math.max(0, Number(metrics.file_search_calls || 0));
  const talkersPublicHits = Math.max(0, Number(metrics.talkers_public_hits || 0));
  const externalContextHits = Math.max(0, Number(metrics.external_context_hits || 0));

  chatPerformanceState.concurrent_requests = Math.max(0, Number(chatPerformanceState.concurrent_requests || 0) - 1);
  chatPerformanceState.last_response_ms = totalResponseMs;
  chatPerformanceState.last_api_latency_ms = apiLatencyMs;
  chatPerformanceState.last_internal_ms = internalMs;
  chatPerformanceState.last_context_ms = contextMs;
  chatPerformanceState.last_persistence_ms = persistenceMs;
  chatPerformanceState.last_prompt_chars = promptChars;
  chatPerformanceState.last_response_chars = responseChars;
  chatPerformanceState.last_payload_bytes = payloadBytes;
  chatPerformanceState.last_response_bytes = responseBytes;
  chatPerformanceState.last_web_search_calls = webSearchCalls;
  chatPerformanceState.last_data_api_calls = dataApiCalls;
  chatPerformanceState.last_file_search_calls = fileSearchCalls;
  chatPerformanceState.last_talkers_public_hits = talkersPublicHits;
  chatPerformanceState.last_external_context_hits = externalContextHits;
  chatPerformanceState.last_status = String(metrics.status || "success");
  chatPerformanceState.last_updated_at = new Date().toISOString();

  chatPerformanceState.samples.push({
    finished_at: finishedAt,
    total_response_ms: totalResponseMs,
    api_latency_ms: apiLatencyMs,
    internal_processing_ms: internalMs,
    context_assembly_ms: contextMs,
    persistence_ms: persistenceMs,
    prompt_chars: promptChars,
    response_chars: responseChars,
    payload_bytes: payloadBytes,
    response_bytes: responseBytes,
    web_search_calls: webSearchCalls,
    data_api_calls: dataApiCalls,
    file_search_calls: fileSearchCalls,
    talkers_public_hits: talkersPublicHits,
    external_context_hits: externalContextHits,
    status: chatPerformanceState.last_status,
  });
  if (chatPerformanceState.samples.length > CHAT_PERFORMANCE_SAMPLE_LIMIT) {
    chatPerformanceState.samples = chatPerformanceState.samples.slice(-CHAT_PERFORMANCE_SAMPLE_LIMIT);
  }
}

function getAverageFromSamples(field) {
  const samples = Array.isArray(chatPerformanceState.samples) ? chatPerformanceState.samples : [];
  if (!samples.length) return 0;
  const total = samples.reduce((sum, item) => sum + Number(item?.[field] || 0), 0);
  return total / samples.length;
}

function getTotalFromSamples(field) {
  const samples = Array.isArray(chatPerformanceState.samples) ? chatPerformanceState.samples : [];
  if (!samples.length) return 0;
  return samples.reduce((sum, item) => sum + Number(item?.[field] || 0), 0);
}

function getChatPerformanceSnapshot() {
  const averageResponseMs = getAverageFromSamples("total_response_ms");
  const averageApiLatencyMs = getAverageFromSamples("api_latency_ms");
  const averageInternalMs = getAverageFromSamples("internal_processing_ms");
  const averageContextMs = getAverageFromSamples("context_assembly_ms");
  const averagePersistenceMs = getAverageFromSamples("persistence_ms");
  const averagePromptChars = getAverageFromSamples("prompt_chars");
  const averageResponseChars = getAverageFromSamples("response_chars");
  const averagePayloadBytes = getAverageFromSamples("payload_bytes");
  const averageResponseBytes = getAverageFromSamples("response_bytes");
  const averageWebSearchCalls = getAverageFromSamples("web_search_calls");
  const averageDataApiCalls = getAverageFromSamples("data_api_calls");
  const averageFileSearchCalls = getAverageFromSamples("file_search_calls");
  const averageTalkersPublicHits = getAverageFromSamples("talkers_public_hits");
  const averageExternalContextHits = getAverageFromSamples("external_context_hits");
  const rssBytes = Number(process.memoryUsage?.().rss || 0);
  const heapUsedBytes = Number(process.memoryUsage?.().heapUsed || 0);
  const totalMemoryBytes = Number(os.totalmem?.() || 0);
  const memoryPercent = totalMemoryBytes ? (rssBytes / totalMemoryBytes) * 100 : 0;
  const loadAverage = Array.isArray(os.loadavg?.()) ? os.loadavg() : [0, 0, 0];
  const averageResponseSeconds = averageResponseMs / 1000;
  let severity = "fast";
  if (averageResponseSeconds > 6) severity = "critical";
  else if (averageResponseSeconds > 3) severity = "slow";
  else if (averageResponseSeconds > 1) severity = "normal";

  return {
    severity,
    status: chatPerformanceState.last_status || "idle",
    average_response_ms: Math.round(averageResponseMs),
    last_response_ms: Math.round(Number(chatPerformanceState.last_response_ms || 0)),
    average_api_latency_ms: Math.round(averageApiLatencyMs),
    last_api_latency_ms: Math.round(Number(chatPerformanceState.last_api_latency_ms || 0)),
    average_internal_ms: Math.round(averageInternalMs),
    last_internal_ms: Math.round(Number(chatPerformanceState.last_internal_ms || 0)),
    average_context_ms: Math.round(averageContextMs),
    last_context_ms: Math.round(Number(chatPerformanceState.last_context_ms || 0)),
    average_persistence_ms: Math.round(averagePersistenceMs),
    last_persistence_ms: Math.round(Number(chatPerformanceState.last_persistence_ms || 0)),
    average_prompt_chars: Math.round(averagePromptChars),
    average_response_chars: Math.round(averageResponseChars),
    last_prompt_chars: Math.round(Number(chatPerformanceState.last_prompt_chars || 0)),
    last_response_chars: Math.round(Number(chatPerformanceState.last_response_chars || 0)),
    average_payload_bytes: Math.round(averagePayloadBytes),
    last_payload_bytes: Math.round(Number(chatPerformanceState.last_payload_bytes || 0)),
    average_response_bytes: Math.round(averageResponseBytes),
    last_response_bytes: Math.round(Number(chatPerformanceState.last_response_bytes || 0)),
    average_web_search_calls: Number(averageWebSearchCalls.toFixed(2)),
    average_data_api_calls: Number(averageDataApiCalls.toFixed(2)),
    average_file_search_calls: Number(averageFileSearchCalls.toFixed(2)),
    average_talkers_public_hits: Number(averageTalkersPublicHits.toFixed(2)),
    average_external_context_hits: Number(averageExternalContextHits.toFixed(2)),
    total_web_search_calls: getTotalFromSamples("web_search_calls"),
    total_data_api_calls: getTotalFromSamples("data_api_calls"),
    total_file_search_calls: getTotalFromSamples("file_search_calls"),
    total_talkers_public_hits: getTotalFromSamples("talkers_public_hits"),
    total_external_context_hits: getTotalFromSamples("external_context_hits"),
    last_web_search_calls: Number(chatPerformanceState.last_web_search_calls || 0),
    last_data_api_calls: Number(chatPerformanceState.last_data_api_calls || 0),
    last_file_search_calls: Number(chatPerformanceState.last_file_search_calls || 0),
    last_talkers_public_hits: Number(chatPerformanceState.last_talkers_public_hits || 0),
    last_external_context_hits: Number(chatPerformanceState.last_external_context_hits || 0),
    concurrent_requests: Number(chatPerformanceState.concurrent_requests || 0),
    peak_concurrent: Number(chatPerformanceState.peak_concurrent || 0),
    sample_size: Array.isArray(chatPerformanceState.samples) ? chatPerformanceState.samples.length : 0,
    memory_rss_bytes: rssBytes,
    memory_heap_used_bytes: heapUsedBytes,
    memory_percent: Number(memoryPercent.toFixed(1)),
    cpu_load_1m: Number((loadAverage[0] || 0).toFixed(2)),
    cpu_load_5m: Number((loadAverage[1] || 0).toFixed(2)),
    last_updated_at: chatPerformanceState.last_updated_at,
  };
}

function buildChatPerformanceAlerts(snapshot = {}) {
  const alerts = [];
  if (Number(snapshot.average_api_latency_ms || 0) > 1800) alerts.push("Latência elevada da API");
  if (Number(snapshot.average_internal_ms || 0) > 2000) alerts.push("Processamento interno lento");
  if (Number(snapshot.average_context_ms || 0) > 900) alerts.push("Montagem de contexto acima do ideal");
  if (Number(snapshot.average_persistence_ms || 0) > 600) alerts.push("Persistência do chat mais lenta que o esperado");
  if (Number(snapshot.memory_percent || 0) > 75) alerts.push("Possível gargalo de memória");
  if (Number(snapshot.concurrent_requests || 0) >= 4) alerts.push("Volume alto de requisições");
  if (Number(snapshot.average_prompt_chars || 0) > 8000) alerts.push("Mensagens enviadas para a IA estão grandes");
  if (Number(snapshot.average_payload_bytes || 0) > 24000) alerts.push("Payload da IA está acima do ideal");
  return alerts;
}

function createKnowledgeProcessingState(overrides = {}) {
  return {
    upload: { status: "pending" },
    parsing: { status: "pending" },
    chunking: { status: "pending" },
    embedding: { status: "pending" },
    analysis: { status: "pending" },
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
  return ["parsing", "chunking", "embedding", "analysis", "vector_store", "transcript"].some((key) => parsed[key] && typeof parsed[key] === "object");
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
  const analysisStatus = normalizeStageStatus(safeState.analysis?.status);
  const vectorStatus = normalizeStageStatus(safeState.vector_store?.status, OPENAI_VECTOR_STORE_ID ? "pending" : "skipped");
  const transcriptStatus = normalizeStageStatus(safeState.transcript?.status, "skipped");
  const issues = Array.isArray(safeState.health?.issues) ? [...new Set(safeState.health.issues)] : [];

  const localReady = parsingStatus === "completed"
    && chunkStatus === "completed"
    && embeddingStatus === "completed"
    && analysisStatus === "completed";
  const vectorReady = !OPENAI_VECTOR_STORE_ID || vectorStatus === "completed" || vectorStatus === "skipped";
  const hasFailure = ["failed"].includes(parsingStatus)
    || ["failed"].includes(chunkStatus)
    || ["failed"].includes(embeddingStatus)
    || ["failed"].includes(analysisStatus)
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
  const stages = ["upload", "parsing", "transcript", "chunking", "embedding", "analysis", "vector_store"];
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

function normalizeKnowledgeExt(value = "") {
  const safeValue = String(value || "").trim().toLowerCase();
  if (!safeValue) return "";
  return safeValue.startsWith(".") ? safeValue : `.${safeValue}`;
}

function classifyKnowledgeCompatibility({ originalName = "", mimeType = "", filePath = "", ext = "" } = {}) {
  const resolvedExt = normalizeKnowledgeExt(ext || getKnowledgeUploadExt(filePath, originalName, mimeType));
  if (RAG_BLOCKED_EXTS.has(resolvedExt)) {
    return {
      allowed: false,
      ext: resolvedExt,
      reason: "blocked_knowledge_file",
    };
  }

  if (!RAG_ALLOWED_EXTS.has(resolvedExt)) {
    return {
      allowed: false,
      ext: resolvedExt,
      reason: "unsupported_knowledge_file",
    };
  }

  return {
    allowed: true,
    ext: resolvedExt,
    reason: "supported",
  };
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

function mapDepartmentSubmenuRow(row) {
  if (!row) return null;
  return {
    ...row,
    is_active: row.is_active === undefined ? true : coerceDbBoolean(row.is_active),
    metadata: safeJsonParse(row.metadata_json || '{}') || {},
  };
}

function mapAnnouncementRow(row) {
  if (!row) return null;
  return {
    ...row,
    is_active: row.is_active === undefined ? true : coerceDbBoolean(row.is_active),
    is_pinned: coerceDbBoolean(row.is_pinned),
    department_ids: Array.isArray(safeJsonParse(row.department_ids_json || '[]'))
      ? safeJsonParse(row.department_ids_json || '[]')
      : [],
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

async function listDepartmentSubmenus(options = {}) {
  const includeInactive = Boolean(options.includeInactive);
  const safeDepartmentIds = Array.isArray(options.departmentIds)
    ? options.departmentIds.map((value) => Number(value || 0)).filter(Boolean)
    : [];
  const where = [];
  const params = [];
  if (!includeInactive) {
    where.push("COALESCE(ds.is_active, 1) = 1");
  }
  if (safeDepartmentIds.length) {
    where.push(`ds.department_id IN (${safeDepartmentIds.map(() => '?').join(', ')})`);
    params.push(...safeDepartmentIds);
  }

  const rows = await all(
    `SELECT ds.id, ds.department_id, ds.title, ds.slug, ds.description, ds.icon, ds.view_key, ds.sort_order, ds.is_active, ds.metadata_json, ds.created_at, ds.updated_at,
            d.name AS department_name, d.slug AS department_slug
       FROM department_submenus ds
       JOIN departments d ON d.id = ds.department_id
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY d.sort_order ASC, d.name ASC, ds.sort_order ASC, ds.title ASC`,
    params
  );

  return rows.map(mapDepartmentSubmenuRow).filter(Boolean);
}

async function listIntranetAnnouncements(options = {}) {
  const includeInactive = Boolean(options.includeInactive);
  const limit = Math.max(1, Math.min(200, Number(options.limit || 40)));
  const rows = await all(
    `SELECT intranet_announcements.id,
            intranet_announcements.title,
            intranet_announcements.content_text,
            intranet_announcements.summary_text,
            intranet_announcements.audience_scope,
            intranet_announcements.department_ids_json,
            intranet_announcements.announcement_type,
            intranet_announcements.priority,
            intranet_announcements.is_pinned,
            intranet_announcements.is_active,
            intranet_announcements.starts_at,
            intranet_announcements.ends_at,
            intranet_announcements.author_user_id,
            intranet_announcements.created_at,
            intranet_announcements.updated_at,
            users.name AS author_name
       FROM intranet_announcements
  LEFT JOIN users ON users.id = intranet_announcements.author_user_id
      ${includeInactive ? '' : 'WHERE COALESCE(intranet_announcements.is_active, 1) = 1'}
      ORDER BY COALESCE(intranet_announcements.is_pinned, 0) DESC, datetime(intranet_announcements.created_at) DESC, intranet_announcements.id DESC
      LIMIT ?`,
    [limit]
  );
  return rows.map(mapAnnouncementRow).filter(Boolean);
}

function isAnnouncementActiveNow(announcement, referenceDate = new Date()) {
  const now = new Date(referenceDate);
  if (!announcement || announcement.is_active === false) return false;

  if (announcement.starts_at) {
    const start = new Date(announcement.starts_at);
    if (!Number.isNaN(start.getTime()) && start > now) return false;
  }
  if (announcement.ends_at) {
    const end = new Date(announcement.ends_at);
    if (!Number.isNaN(end.getTime()) && end < now) return false;
  }
  return true;
}

function filterAnnouncementsForUser(announcements = [], user = null, departmentDetails = []) {
  if (!Array.isArray(announcements) || !announcements.length) return [];
  const isAdmin = user?.role === 'admin';
  const visibleDepartmentIds = new Set((departmentDetails || []).map((item) => Number(item.id || 0)).filter(Boolean));

  return announcements.filter((announcement) => {
    if (!isAnnouncementActiveNow(announcement)) return false;
    if (isAdmin) return true;
    if (announcement.audience_scope === 'all') return true;
    const departmentIds = Array.isArray(announcement.department_ids) ? announcement.department_ids : [];
    return departmentIds.some((departmentId) => visibleDepartmentIds.has(Number(departmentId || 0)));
  });
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
    preferred_locale: normalizeLocaleCode(user.preferred_locale || DEFAULT_LOCALE),
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

async function ensureDepartmentSubmenus() {
  const seeds = buildDepartmentSubmenuSeedRows();
  if (!seeds.length) return;

  const departments = await listDepartmentCatalog({ includeInactive: true });
  const departmentBySlug = new Map(
    departments.map((department) => [String(department.slug || '').trim(), department]).filter((entry) => entry[0])
  );

  for (const seed of seeds) {
    const department = departmentBySlug.get(String(seed.departmentSlug || '').trim());
    if (!department?.id) continue;

    await run(
      `INSERT INTO department_submenus (department_id, title, slug, description, icon, view_key, sort_order, is_active, metadata_json, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(department_id, slug) DO UPDATE SET
         title=excluded.title,
         description=excluded.description,
         icon=excluded.icon,
         view_key=excluded.view_key,
         sort_order=excluded.sort_order,
         is_active=excluded.is_active,
         metadata_json=excluded.metadata_json,
         updated_at=datetime('now')`,
      [
        department.id,
        seed.title,
        seed.slug,
        seed.description || null,
        seed.icon || 'layers',
        seed.viewKey || seed.slug,
        Number(seed.sortOrder || 0),
        seed.isActive ? 1 : 0,
        seed.metadataJson || '{}',
      ]
    );
  }
}

async function ensureCalendarEventTypes() {
  const rows = buildCalendarEventTypeSeedRows();
  for (const row of rows) {
    await run(
      `INSERT INTO calendar_event_types (event_key, name, description, color, icon, is_active, sort_order, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(event_key) DO UPDATE SET
         name=excluded.name,
         description=excluded.description,
         color=excluded.color,
         icon=excluded.icon,
         is_active=excluded.is_active,
         sort_order=excluded.sort_order,
         updated_at=datetime('now')`,
      [
        row.key,
        row.name,
        row.description || null,
        row.color || null,
        row.icon || "calendar",
        row.isActive ? 1 : 0,
        Number(row.sortOrder || 0),
      ]
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

function userHasDepartmentAccess(user = {}, departmentValue = "") {
  if (!user) return false;
  if (user.role === "admin") return true;
  const departmentKey = normalizeDepartmentValue(departmentValue);
  if (!departmentKey) return false;
  return getUserDepartmentKeySet(user).has(departmentKey);
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

function normalizeCalendarUrl(value = "") {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    const parsed = new URL(raw);
    return /^https?:$/i.test(parsed.protocol) ? parsed.href : "";
  } catch {
    return "";
  }
}

function mapCalendarEventTypeRow(row) {
  if (!row) return null;
  return {
    id: Number(row.id || 0),
    key: row.event_key,
    name: row.name,
    description: row.description || "",
    color: row.color || "#2563eb",
    icon: row.icon || "calendar",
    is_active: coerceDbBoolean(row.is_active),
    sort_order: Number(row.sort_order || 0),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

async function listCalendarEventTypes({ includeInactive = false } = {}) {
  const rows = await all(
    `SELECT id, event_key, name, description, color, icon, is_active, sort_order, created_at, updated_at
       FROM calendar_event_types
       ${includeInactive ? "" : "WHERE is_active=?"}
      ORDER BY sort_order ASC, name ASC`,
    includeInactive ? [] : [true]
  );
  return rows.map(mapCalendarEventTypeRow).filter(Boolean);
}

function normalizeCalendarParticipantIds(value) {
  const source = Array.isArray(value)
    ? value
    : value == null
      ? []
      : [value];
  const out = [];
  const seen = new Set();
  for (const item of source) {
    const id = Number(item);
    if (!Number.isInteger(id) || id <= 0 || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

function buildCalendarTimestamp(dateValue = "", timeValue = "", fallbackTime = "09:00") {
  const safeDate = String(dateValue || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(safeDate)) return "";
  const safeTime = /^\d{2}:\d{2}$/.test(String(timeValue || "").trim())
    ? String(timeValue || "").trim()
    : fallbackTime;
  return `${safeDate}T${safeTime}:00-03:00`;
}

function splitCalendarDateTime(value = "") {
  if (!value) return { date: "", time: "" };
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return { date: "", time: "" };
  const formatterDate = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const formatterTime = new Intl.DateTimeFormat("en-GB", {
    timeZone: "America/Sao_Paulo",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  return {
    date: formatterDate.format(date),
    time: formatterTime.format(date),
  };
}

function getCalendarRangeFromQuery(query = {}) {
  const today = brazilDateKey();
  const baseDate = String(query.base_date || today).trim();
  const view = ["month", "week", "day", "list"].includes(String(query.view || "").trim())
    ? String(query.view || "").trim()
    : "month";

  let from = String(query.from || "").trim();
  let to = String(query.to || "").trim();

  const base = /^\d{4}-\d{2}-\d{2}$/.test(baseDate) ? new Date(`${baseDate}T12:00:00-03:00`) : new Date(`${today}T12:00:00-03:00`);
  if (!from || !to) {
    const start = new Date(base);
    const end = new Date(base);
    if (view === "month") {
      start.setDate(1);
      start.setDate(start.getDate() - start.getDay());
      end.setMonth(end.getMonth() + 1, 0);
      end.setDate(end.getDate() + (6 - end.getDay()));
    } else if (view === "week") {
      start.setDate(start.getDate() - start.getDay());
      end.setDate(start.getDate() + 6);
    } else if (view === "day") {
      end.setDate(end.getDate());
    } else {
      end.setDate(end.getDate() + 14);
    }
    from = brazilDateKey(start);
    to = brazilDateKey(end);
  }

  return { view, from, to, base_date: baseDate };
}

async function listCalendarUsersForPicker() {
  const rows = await all(
    `SELECT id, name, email, role, department, can_access_intranet
       FROM users
      WHERE can_access_intranet=?
      ORDER BY lower(name) ASC, id ASC`,
    [true]
  );
  return rows.map((row) => ({
    id: Number(row.id || 0),
    name: row.name || "",
    email: row.email || "",
    role: row.role || "user",
    department: row.department || "",
    can_access_intranet: coerceDbBoolean(row.can_access_intranet),
  }));
}

function buildCalendarAccessWhere(user, filters = {}) {
  const actorId = Number(user?.id || user?.sub || 0);
  const clauses = [];
  const params = [];

  if (user?.role !== "admin") {
    clauses.push("(ce.created_by=? OR EXISTS (SELECT 1 FROM calendar_event_participants cep_scope WHERE cep_scope.event_id=ce.id AND cep_scope.user_id=?))");
    params.push(actorId, actorId);
  }

  if (filters.participantId) {
    clauses.push("EXISTS (SELECT 1 FROM calendar_event_participants cep_filter WHERE cep_filter.event_id=ce.id AND cep_filter.user_id=?)");
    params.push(Number(filters.participantId));
  }

  if (filters.typeId) {
    clauses.push("ce.event_type_id=?");
    params.push(Number(filters.typeId));
  }

  if (filters.mode) {
    clauses.push("ce.meeting_mode=?");
    params.push(sanitizeMeetingMode(filters.mode));
  }

  if (filters.status) {
    clauses.push("lower(coalesce(ce.status, 'scheduled'))=lower(?)");
    params.push(String(filters.status).trim());
  }

  if (filters.from) {
    clauses.push("date(ce.end_at) >= date(?)");
    params.push(String(filters.from).trim());
  }

  if (filters.to) {
    clauses.push("date(ce.start_at) <= date(?)");
    params.push(String(filters.to).trim());
  }

  if (filters.search) {
    const search = `%${String(filters.search).trim()}%`;
    clauses.push("(lower(coalesce(ce.title, '')) LIKE lower(?) OR lower(coalesce(ce.description, '')) LIKE lower(?) OR lower(coalesce(ce.location, '')) LIKE lower(?) OR lower(coalesce(cet.name, '')) LIKE lower(?))");
    params.push(search, search, search, search);
  }

  return {
    sql: clauses.length ? `WHERE ${clauses.join(" AND ")}` : "",
    params,
  };
}

async function getCalendarParticipantsByEventIds(eventIds = []) {
  const ids = [...new Set((eventIds || []).map((item) => Number(item)).filter((item) => item > 0))];
  if (!ids.length) return new Map();

  const rows = await all(
    `SELECT cep.event_id, cep.user_id, cep.participant_role, cep.response_status, cep.created_at, cep.updated_at,
            u.name AS user_name, u.email AS user_email, u.role AS user_role
       FROM calendar_event_participants cep
       JOIN users u ON u.id = cep.user_id
      WHERE cep.event_id IN (${ids.map(() => "?").join(", ")})
      ORDER BY lower(u.name) ASC, cep.id ASC`,
    ids
  );

  const out = new Map();
  for (const row of rows) {
    const key = Number(row.event_id || 0);
    if (!out.has(key)) out.set(key, []);
    out.get(key).push({
      user_id: Number(row.user_id || 0),
      name: row.user_name || "",
      email: row.user_email || "",
      role: row.user_role || "user",
      participant_role: row.participant_role || "participant",
      response_status: row.response_status || "invited",
      created_at: row.created_at,
      updated_at: row.updated_at,
    });
  }

  return out;
}

function serializeCalendarEvent(row, participants = []) {
  if (!row) return null;
  const startParts = splitCalendarDateTime(row.start_at);
  const endParts = splitCalendarDateTime(row.end_at);
  return {
    id: Number(row.id || 0),
    title: row.title || "",
    description: row.description || "",
    event_type_id: row.event_type_id ? Number(row.event_type_id) : null,
    event_type_name: row.event_type_name || "",
    event_type_color: row.event_type_color || "#2563eb",
    event_type_icon: row.event_type_icon || "calendar",
    meeting_mode: sanitizeMeetingMode(row.meeting_mode || "online"),
    start_at: row.start_at,
    end_at: row.end_at,
    start_date: startParts.date,
    start_time: startParts.time,
    end_date: endParts.date,
    end_time: endParts.time,
    all_day: coerceDbBoolean(row.all_day),
    location: row.location || "",
    meeting_link: row.meeting_link || "",
    notes: row.notes || "",
    reminder_settings: safeJsonParse(row.reminder_settings_json || "[]") || [],
    status: row.status || "scheduled",
    created_by: Number(row.created_by || 0),
    created_by_name: row.created_by_name || "",
    last_updated_by: row.last_updated_by ? Number(row.last_updated_by) : null,
    last_updated_by_name: row.last_updated_by_name || "",
    cancelled_at: row.cancelled_at || null,
    cancel_reason: row.cancel_reason || "",
    metadata: safeJsonParse(row.metadata_json || "{}") || {},
    participants,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

async function listCalendarEventsForUser(user, filters = {}) {
  const where = buildCalendarAccessWhere(user, filters);
  const limit = Math.min(250, Math.max(1, Number(filters.limit || 120)));
  const rows = await all(
    `SELECT ce.*, cet.name AS event_type_name, cet.color AS event_type_color, cet.icon AS event_type_icon,
            creator.name AS created_by_name, updater.name AS last_updated_by_name
       FROM calendar_events ce
       LEFT JOIN calendar_event_types cet ON cet.id = ce.event_type_id
       LEFT JOIN users creator ON creator.id = ce.created_by
       LEFT JOIN users updater ON updater.id = ce.last_updated_by
       ${where.sql}
      ORDER BY ce.start_at ASC, ce.id ASC
      LIMIT ?`,
    [...where.params, limit]
  );

  const participantsByEvent = await getCalendarParticipantsByEventIds(rows.map((row) => row.id));
  return rows.map((row) => serializeCalendarEvent(row, participantsByEvent.get(Number(row.id || 0)) || []));
}

async function getCalendarEventById(eventId) {
  return get(
    `SELECT ce.*, cet.name AS event_type_name, cet.color AS event_type_color, cet.icon AS event_type_icon,
            creator.name AS created_by_name, updater.name AS last_updated_by_name
       FROM calendar_events ce
       LEFT JOIN calendar_event_types cet ON cet.id = ce.event_type_id
       LEFT JOIN users creator ON creator.id = ce.created_by
       LEFT JOIN users updater ON updater.id = ce.last_updated_by
      WHERE ce.id=?`,
    [eventId]
  );
}

function canAccessCalendarEvent(user, event, participants = []) {
  if (!user || !event) return false;
  const actorId = Number(user.id || user.sub || 0);
  if (user.role === "admin") return true;
  if (Number(event.created_by || 0) === actorId) return true;
  return (participants || []).some((item) => Number(item.user_id || 0) === actorId);
}

async function getCalendarEventParticipants(eventId) {
  const map = await getCalendarParticipantsByEventIds([eventId]);
  return map.get(Number(eventId || 0)) || [];
}

async function getCalendarEventHistory(eventId) {
  const rows = await all(
    `SELECT cel.id, cel.event_id, cel.action, cel.field_name, cel.old_value, cel.new_value, cel.detail_json, cel.created_at,
            cel.actor_user_id, u.name AS actor_name
       FROM calendar_event_logs cel
       LEFT JOIN users u ON u.id = cel.actor_user_id
      WHERE cel.event_id=?
      ORDER BY datetime(cel.created_at) DESC, cel.id DESC`,
    [eventId]
  );
  return rows.map((row) => ({
    ...row,
    detail: safeJsonParse(row.detail_json || "{}") || {},
  }));
}

async function logCalendarEventChange({
  eventId,
  actorUserId = null,
  action,
  fieldName = null,
  oldValue = null,
  newValue = null,
  detail = null,
}) {
  if (!eventId || !action) return null;
  const created = await run(
    "INSERT INTO calendar_event_logs (event_id, actor_user_id, action, field_name, old_value, new_value, detail_json) VALUES (?, ?, ?, ?, ?, ?, ?)",
    [
      eventId,
      actorUserId || null,
      action,
      fieldName || null,
      oldValue == null ? null : String(oldValue),
      newValue == null ? null : String(newValue),
      detail ? safeJsonStringify(detail) : null,
    ]
  );
  if (actorUserId) {
    await logEvent(actorUserId, `calendar_${action}`, {
      event_id: eventId,
      field_name: fieldName || null,
      detail: detail || null,
    });
  }
  return created?.lastID || null;
}

async function syncCalendarParticipants(eventId, participantIds = [], actorUserId = null) {
  const desired = [...new Set((participantIds || []).map((item) => Number(item)).filter((item) => item > 0))];
  const existing = await all(
    "SELECT id, user_id, participant_role, response_status FROM calendar_event_participants WHERE event_id=?",
    [eventId]
  );
  const existingIds = new Set(existing.map((row) => Number(row.user_id || 0)));

  for (const row of existing) {
    const userId = Number(row.user_id || 0);
    if (!desired.includes(userId)) {
      await run("DELETE FROM calendar_event_participants WHERE id=?", [row.id]);
      await logCalendarEventChange({
        eventId,
        actorUserId,
        action: "participant_removed",
        fieldName: "participants",
        oldValue: userId,
        newValue: null,
        detail: { user_id: userId },
      });
    }
  }

  for (const userId of desired) {
    if (existingIds.has(userId)) continue;
    await run(
      "INSERT INTO calendar_event_participants (event_id, user_id, participant_role, response_status) VALUES (?, ?, 'participant', 'invited')",
      [eventId, userId]
    );
    await logCalendarEventChange({
      eventId,
      actorUserId,
      action: "participant_added",
      fieldName: "participants",
      oldValue: null,
      newValue: userId,
      detail: { user_id: userId },
    });
  }
}

function normalizeCalendarPayload(payload = {}, existing = null) {
  const merged = { ...(existing || {}), ...(payload || {}) };
  const allDay = Object.prototype.hasOwnProperty.call(payload || {}, "all_day")
    ? parseBooleanInput(payload?.all_day)
    : coerceDbBoolean(existing?.all_day);
  const startDate = String(payload?.start_date || payload?.date || splitCalendarDateTime(existing?.start_at).date || "").trim();
  const endDate = String(payload?.end_date || startDate || splitCalendarDateTime(existing?.end_at).date || "").trim();
  const startTime = allDay ? "00:00" : String(payload?.start_time || splitCalendarDateTime(existing?.start_at).time || "09:00").trim();
  const endTime = allDay ? "23:59" : String(payload?.end_time || splitCalendarDateTime(existing?.end_at).time || "10:00").trim();

  const participantIds = normalizeCalendarParticipantIds(
    payload?.participant_ids ??
    payload?.participants ??
    payload?.participantIds ??
    []
  );

  return {
    title: String(merged.title || "").trim(),
    description: String(merged.description || "").trim(),
    event_type_id: merged.event_type_id ? Number(merged.event_type_id) : null,
    meeting_mode: sanitizeMeetingMode(merged.meeting_mode || "online"),
    start_at: buildCalendarTimestamp(startDate, startTime, "09:00"),
    end_at: buildCalendarTimestamp(endDate || startDate, endTime, "10:00"),
    all_day: Boolean(allDay),
    location: String(merged.location || "").trim(),
    meeting_link: normalizeCalendarUrl(merged.meeting_link || ""),
    notes: String(merged.notes || merged.observations || "").trim(),
    reminder_settings_json: safeJsonStringify(Array.isArray(merged.reminder_settings) ? merged.reminder_settings : []),
    status: CALENDAR_EVENT_STATUSES.has(String(merged.status || "").trim().toLowerCase())
      ? String(merged.status || "").trim().toLowerCase()
      : (existing?.status || "scheduled"),
    cancel_reason: String(merged.cancel_reason || "").trim(),
    participant_ids: participantIds,
  };
}

async function createCalendarEvent(payload = {}, actorUser) {
  const actorId = Number(actorUser?.id || actorUser?.sub || 0);
  const normalized = normalizeCalendarPayload(payload);

  if (!normalized.title || !normalized.start_at || !normalized.end_at) {
    throw new Error("missing_calendar_fields");
  }
  if (new Date(normalized.end_at).getTime() < new Date(normalized.start_at).getTime()) {
    throw new Error("calendar_end_before_start");
  }

  const participantIds = [...new Set([actorId, ...normalized.participant_ids])];
  const created = await run(
    "INSERT INTO calendar_events (title, description, event_type_id, meeting_mode, start_at, end_at, all_day, location, meeting_link, notes, reminder_settings_json, status, created_by, last_updated_by, metadata_json, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))",
    [
      normalized.title,
      normalized.description || null,
      normalized.event_type_id || null,
      normalized.meeting_mode,
      normalized.start_at,
      normalized.end_at,
      normalized.all_day,
      normalized.location || null,
      normalized.meeting_link || null,
      normalized.notes || null,
      normalized.reminder_settings_json,
      normalized.status,
      actorId,
      actorId,
      safeJsonStringify({ origin: "intranet_calendar" }),
    ]
  );

  await syncCalendarParticipants(created.lastID, participantIds, actorId);
  await logCalendarEventChange({
    eventId: created.lastID,
    actorUserId: actorId,
    action: "created",
    detail: {
      title: normalized.title,
      participant_ids: participantIds,
      meeting_mode: normalized.meeting_mode,
    },
  });

  const event = await getCalendarEventById(created.lastID);
  const participants = await getCalendarEventParticipants(created.lastID);
  return serializeCalendarEvent(event, participants);
}

async function updateCalendarEvent(eventId, payload = {}, actorUser) {
  const actorId = Number(actorUser?.id || actorUser?.sub || 0);
  const existing = await getCalendarEventById(eventId);
  if (!existing) throw new Error("not_found");

  const existingParticipants = await getCalendarEventParticipants(eventId);
  if (!(actorUser?.role === "admin" || Number(existing.created_by || 0) === actorId)) {
    throw new Error("forbidden");
  }

  const normalized = normalizeCalendarPayload(payload, existing);
  if (!normalized.title || !normalized.start_at || !normalized.end_at) {
    throw new Error("missing_calendar_fields");
  }
  if (new Date(normalized.end_at).getTime() < new Date(normalized.start_at).getTime()) {
    throw new Error("calendar_end_before_start");
  }

  await run(
    "UPDATE calendar_events SET title=?, description=?, event_type_id=?, meeting_mode=?, start_at=?, end_at=?, all_day=?, location=?, meeting_link=?, notes=?, reminder_settings_json=?, status=?, last_updated_by=?, cancel_reason=?, updated_at=datetime('now') WHERE id=?",
    [
      normalized.title,
      normalized.description || null,
      normalized.event_type_id || null,
      normalized.meeting_mode,
      normalized.start_at,
      normalized.end_at,
      normalized.all_day,
      normalized.location || null,
      normalized.meeting_link || null,
      normalized.notes || null,
      normalized.reminder_settings_json,
      normalized.status,
      actorId,
      normalized.cancel_reason || null,
      eventId,
    ]
  );

  const fieldsToTrack = [
    ["title", existing.title, normalized.title],
    ["description", existing.description, normalized.description],
    ["event_type_id", existing.event_type_id, normalized.event_type_id],
    ["meeting_mode", existing.meeting_mode, normalized.meeting_mode],
    ["start_at", existing.start_at, normalized.start_at],
    ["end_at", existing.end_at, normalized.end_at],
    ["all_day", coerceDbBoolean(existing.all_day), normalized.all_day],
    ["location", existing.location, normalized.location],
    ["meeting_link", existing.meeting_link, normalized.meeting_link],
    ["notes", existing.notes, normalized.notes],
    ["status", existing.status, normalized.status],
  ];

  for (const [fieldName, previousValue, nextValue] of fieldsToTrack) {
    if (normalizeSqlTextValue(previousValue) === normalizeSqlTextValue(nextValue)) continue;
    await logCalendarEventChange({
      eventId,
      actorUserId: actorId,
      action: "updated",
      fieldName,
      oldValue: previousValue,
      newValue: nextValue,
    });
  }

  const participantIds = [...new Set([Number(existing.created_by || 0), ...normalized.participant_ids])].filter(Boolean);
  await syncCalendarParticipants(eventId, participantIds, actorId);

  const event = await getCalendarEventById(eventId);
  const participants = await getCalendarEventParticipants(eventId);
  const history = await getCalendarEventHistory(eventId);

  return {
    event: serializeCalendarEvent(event, participants),
    history,
    previous_participants: existingParticipants,
  };
}

async function cancelCalendarEvent(eventId, payload = {}, actorUser) {
  const actorId = Number(actorUser?.id || actorUser?.sub || 0);
  const existing = await getCalendarEventById(eventId);
  if (!existing) throw new Error("not_found");
  if (!(actorUser?.role === "admin" || Number(existing.created_by || 0) === actorId)) {
    throw new Error("forbidden");
  }

  const reason = String(payload?.cancel_reason || payload?.reason || "").trim();
  await run(
    "UPDATE calendar_events SET status='cancelled', cancel_reason=?, cancelled_at=datetime('now'), last_updated_by=?, updated_at=datetime('now') WHERE id=?",
    [reason || null, actorId, eventId]
  );
  await logCalendarEventChange({
    eventId,
    actorUserId: actorId,
    action: "cancelled",
    fieldName: "status",
    oldValue: existing.status || "scheduled",
    newValue: "cancelled",
    detail: { cancel_reason: reason || null },
  });

  const event = await getCalendarEventById(eventId);
  const participants = await getCalendarEventParticipants(eventId);
  const history = await getCalendarEventHistory(eventId);
  return {
    event: serializeCalendarEvent(event, participants),
    history,
  };
}

async function buildCalendarBootstrap(user) {
  const [eventTypes, users, upcomingEvents] = await Promise.all([
    listCalendarEventTypes(),
    listCalendarUsersForPicker(),
    listCalendarEventsForUser(user, {
      from: brazilDateKey(),
      to: brazilDateKey(new Date(Date.now() + 1000 * 60 * 60 * 24 * 30)),
      status: "scheduled",
      limit: 12,
    }),
  ]);

  const actorId = Number(user?.id || user?.sub || 0);
  const today = brazilDateKey();
  const weekLimit = brazilDateKey(new Date(Date.now() + 1000 * 60 * 60 * 24 * 7));
  const summary = {
    total_upcoming: upcomingEvents.length,
    today: upcomingEvents.filter((item) => item.start_date === today).length,
    this_week: upcomingEvents.filter((item) => item.start_date >= today && item.start_date <= weekLimit).length,
    mine: upcomingEvents.filter((item) => (item.participants || []).some((participant) => Number(participant.user_id || 0) === actorId)).length,
  };

  return {
    enabled: true,
    views: ["month", "week", "day", "list"],
    meeting_modes: CALENDAR_MEETING_MODES,
    event_types: eventTypes,
    users,
    summary,
    upcoming_events: upcomingEvents,
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

function buildExternalErrorDetails(err, extra = {}) {
  const safeError = err || {};
  return {
    message: safeError?.message || String(safeError || "unknown_error"),
    name: safeError?.name || "",
    code: safeError?.code || safeError?.cause?.code || "",
    status: safeError?.response?.status || safeError?.status || null,
    url: safeError?.config?.url || safeError?.url || extra.url || "",
    ...extra,
  };
}

async function fetchWithRetry(url, options = {}, diagnostics = {}, retryCount = 1) {
  let lastError = null;
  for (let attempt = 0; attempt <= retryCount; attempt += 1) {
    try {
      const requestOptions = { ...options };
      if (!requestOptions.signal) {
        requestOptions.signal = AbortSignal.timeout(OPENAI_REQUEST_TIMEOUT_MS);
      }
      return await fetch(url, requestOptions);
    } catch (err) {
      lastError = err;
      const details = buildExternalErrorDetails(err, {
        attempt: attempt + 1,
        timeout_ms: OPENAI_REQUEST_TIMEOUT_MS,
        ...diagnostics,
      });
      if (attempt < retryCount) {
        console.warn("Falha em chamada externa; tentando novamente.", details);
        continue;
      }
      throw Object.assign(err instanceof Error ? err : new Error(String(err || "external_request_failed")), {
        diagnostics: details,
      });
    }
  }
  throw lastError || new Error("external_request_failed");
}

function detectConversationLanguage(userText = "", history = [], fallbackLanguage = "pt") {
  const joined = [
    String(userText || "").trim(),
    ...(history || []).slice(-4).map((item) => String(item?.content || "").trim()),
  ].filter(Boolean).join("\n");
  return normalizeLanguageCode(detectLanguage(joined || userText || "", fallbackLanguage));
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

function isPathInside(baseDir, candidatePath) {
  const safeBase = path.resolve(String(baseDir || ""));
  const safeCandidate = path.resolve(String(candidatePath || ""));
  return safeCandidate === safeBase || safeCandidate.startsWith(`${safeBase}${path.sep}`);
}

function deleteFileIfExists(filePath, allowedRoots = [DATA_DIR, kbDir, knowledgeDir, uploadsDir]) {
  const safePath = String(filePath || "").trim();
  if (!safePath || !fs.existsSync(safePath)) return false;

  const canDelete = (allowedRoots || []).some((root) => root && isPathInside(root, safePath));
  if (!canDelete) return false;

  try {
    fs.unlinkSync(safePath);
    return true;
  } catch (err) {
    console.log("Erro ao remover arquivo incompatível do disco:", safePath, err?.message || err);
    return false;
  }
}

async function deleteRowsByIds(tableName, columnName, ids = []) {
  const safeIds = [...new Set((ids || []).map((item) => Number(item || 0)).filter(Boolean))];
  if (!safeIds.length) return 0;

  const placeholders = safeIds.map(() => "?").join(", ");
  const result = await run(`DELETE FROM ${tableName} WHERE ${columnName} IN (${placeholders})`, safeIds);
  return Number(result?.changes || 0);
}

function removeKnowledgeSourceFromBackgroundQueue(knowledgeSourceId) {
  const safeId = Number(knowledgeSourceId || 0);
  if (!safeId) return;

  knowledgeBackgroundState.queue = knowledgeBackgroundState.queue.filter((item) => Number(item?.id || 0) !== safeId);
  knowledgeBackgroundState.queuedIds.delete(safeId);
  if (Number(knowledgeBackgroundState.current_source_id || 0) === safeId) {
    knowledgeBackgroundState.current_source_id = null;
  }
}

function createKnowledgeCleanupSummary() {
  return {
    scanned_sources: 0,
    scanned_documents: 0,
    removed_sources: 0,
    removed_documents: 0,
    removed_document_chunks: 0,
    removed_memories: 0,
    removed_processing_logs: 0,
    removed_training_events: 0,
    removed_local_files: 0,
    removed_transcripts: 0,
    removed_orphan_documents: 0,
    reasons: {},
    extensions: {},
  };
}

function bumpKnowledgeCleanupCounter(map, key) {
  const safeKey = String(key || "unknown").trim() || "unknown";
  map[safeKey] = Number(map[safeKey] || 0) + 1;
}

async function deleteKnowledgeSourceCascade(source, summary, reason = "unsupported_knowledge_file") {
  if (!source?.id) return;

  const fullPath = getKnowledgeSourceFullPath(source);
  const relPath = fullPath ? path.relative(kbDir, fullPath).replace(/\\/g, "/") : "";
  const conditions = [];
  const params = [];

  if (fullPath) {
    conditions.push("source_path=?");
    params.push(fullPath);
  }
  if (relPath) {
    conditions.push("rel_path=?");
    params.push(relPath);
  }

  const documentRows = conditions.length
    ? await all(
        `SELECT id, source_path
           FROM documents
          WHERE ${conditions.join(" OR ")}`,
        params
      )
    : [];

  const documentIds = documentRows.map((row) => Number(row.id || 0)).filter(Boolean);
  summary.removed_document_chunks += await deleteRowsByIds("document_chunks", "document_id", documentIds);
  summary.removed_documents += await deleteRowsByIds("documents", "id", documentIds);

  const memoryDelete = await run("DELETE FROM memory_entries WHERE knowledge_source_id=?", [source.id]);
  summary.removed_memories += Number(memoryDelete?.changes || 0);

  const logDelete = await run("DELETE FROM knowledge_processing_logs WHERE knowledge_source_id=?", [source.id]);
  summary.removed_processing_logs += Number(logDelete?.changes || 0);

  const trainingDelete = await run("DELETE FROM ai_training_events WHERE knowledge_source_id=?", [source.id]);
  summary.removed_training_events += Number(trainingDelete?.changes || 0);

  const sourceDelete = await run("DELETE FROM knowledge_sources WHERE id=?", [source.id]);
  summary.removed_sources += Number(sourceDelete?.changes || 0);

  if (deleteFileIfExists(fullPath)) summary.removed_local_files += 1;
  const transcriptPath = getTranscriptFilePathForKnowledge(source.stored_name || "");
  if (deleteFileIfExists(transcriptPath)) summary.removed_transcripts += 1;

  removeKnowledgeSourceFromBackgroundQueue(source.id);

  const ext = normalizeKnowledgeExt(path.extname(String(source.original_name || source.stored_name || "")).toLowerCase());
  bumpKnowledgeCleanupCounter(summary.reasons, reason);
  if (ext) bumpKnowledgeCleanupCounter(summary.extensions, ext);
}

async function purgeIncompatibleKnowledgeAssets(actorUserId = null) {
  const summary = createKnowledgeCleanupSummary();

  const sources = await all(
    `SELECT id, original_name, stored_name, mime_type
       FROM knowledge_sources
      ORDER BY id ASC`
  );

  for (const source of sources) {
    summary.scanned_sources += 1;
    const fullPath = getKnowledgeSourceFullPath(source);
    const compatibility = classifyKnowledgeCompatibility({
      originalName: source.original_name || source.stored_name || "",
      mimeType: source.mime_type || "",
      filePath: fullPath,
    });

    if (!compatibility.allowed) {
      await deleteKnowledgeSourceCascade(source, summary, compatibility.reason);
    }
  }

  const documents = await all(
    `SELECT id, source_path, rel_path, ext, mime_type
       FROM documents
      ORDER BY id ASC`
  );

  const documentIdsToDelete = [];
  for (const row of documents) {
    summary.scanned_documents += 1;
    const compatibility = classifyKnowledgeCompatibility({
      originalName: row.rel_path || path.basename(String(row.source_path || "")),
      mimeType: row.mime_type || "",
      filePath: row.source_path || "",
      ext: row.ext || "",
    });

    if (compatibility.allowed) continue;

    documentIdsToDelete.push(Number(row.id || 0));
    if (deleteFileIfExists(row.source_path || "")) summary.removed_local_files += 1;
    bumpKnowledgeCleanupCounter(summary.reasons, compatibility.reason);
    if (compatibility.ext) bumpKnowledgeCleanupCounter(summary.extensions, compatibility.ext);
  }

  if (documentIdsToDelete.length) {
    summary.removed_document_chunks += await deleteRowsByIds("document_chunks", "document_id", documentIdsToDelete);
    const deletedDocs = await deleteRowsByIds("documents", "id", documentIdsToDelete);
    summary.removed_documents += deletedDocs;
    summary.removed_orphan_documents += deletedDocs;
  }

  if (summary.removed_sources || summary.removed_documents || summary.removed_local_files || summary.removed_transcripts) {
    await logEvent(actorUserId, "knowledge_cleanup_incompatible_files", summary);
  }

  return summary;
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
  knowledgeSourceId = null,
  memoryScope = "conversation",
  memoryKind = "context",
  title = "",
  contentText = "",
  topics = [],
  language = "pt",
  sourceMessageIds = [],
}) {
  const safeText = compactMemory(String(contentText || "").trim(), 2200);
  if (!safeText) return null;

  const hasUserId = ![undefined, null, ""].includes(userId);
  const safeUserId = hasUserId ? Number(userId) : null;
  if (!knowledgeSourceId && (!hasUserId || !Number.isFinite(safeUserId) || safeUserId <= 0)) {
    return null;
  }

  const persistedUserId = Number.isFinite(safeUserId) ? safeUserId : DOCUMENT_MEMORY_USER_ID;

  const normalizedText = normalizeSemanticText(safeText);
  if (!normalizedText) return null;

  const existing = await get(
    `SELECT id
      FROM memory_entries
      WHERE user_id=?
        AND COALESCE(conversation_id, 0)=?
        AND COALESCE(knowledge_source_id, 0)=?
        AND memory_scope=?
        AND normalized_text=?
      ORDER BY updated_at DESC
      LIMIT 1`,
    [persistedUserId, Number(conversationId || 0), Number(knowledgeSourceId || 0), memoryScope, normalizedText]
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
      "UPDATE memory_entries SET knowledge_source_id=?, title=?, content_text=?, normalized_text=?, topics_json=?, language=?, source_message_ids_json=?, embedding_json=?, embedding_model=?, updated_at=datetime('now') WHERE id=?",
      [knowledgeSourceId || null, ...payload, existing.id]
    );
    return existing.id;
  }

  const existingBySource = knowledgeSourceId
    ? await get(
      `SELECT id
         FROM memory_entries
        WHERE knowledge_source_id=?
          AND memory_scope=?
          AND memory_kind=?
        ORDER BY updated_at DESC
        LIMIT 1`,
      [knowledgeSourceId, memoryScope, memoryKind]
    )
    : null;

  if (existingBySource?.id) {
    await run(
      "UPDATE memory_entries SET user_id=?, conversation_id=?, knowledge_source_id=?, title=?, content_text=?, normalized_text=?, topics_json=?, language=?, source_message_ids_json=?, embedding_json=?, embedding_model=?, updated_at=datetime('now') WHERE id=?",
      [persistedUserId, conversationId || null, knowledgeSourceId || null, ...payload, existingBySource.id]
    );
    return existingBySource.id;
  }

  const created = await run(
    "INSERT INTO memory_entries (user_id, conversation_id, knowledge_source_id, memory_scope, memory_kind, title, content_text, normalized_text, topics_json, language, source_message_ids_json, embedding_json, embedding_model) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    [persistedUserId, conversationId || null, knowledgeSourceId || null, memoryScope, memoryKind, ...payload]
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

async function getRelevantMemoryEntries(userId, conversationId, queryText, limit = 4, options = {}) {
  if (!userId || !String(queryText || "").trim()) return [];

  const queryEmbedding = Object.prototype.hasOwnProperty.call(options, "queryEmbedding")
    ? options.queryEmbedding
    : await getEmbeddingForText(queryText);
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
      const safeContent = String(row.content_text || "").trim();
      if (!safeContent || responseLooksSelfLimiting(safeContent) || responseLooksWeak(safeContent)) {
        return null;
      }
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
    .filter(Boolean)
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
  const safeAssistantText = String(assistantText || "").trim();
  if (!safeAssistantText || responseLooksSelfLimiting(safeAssistantText) || responseLooksWeak(safeAssistantText)) {
    return;
  }

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
  return classifyKnowledgeCompatibility({ originalName, mimeType, filePath }).allowed;
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

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), OPENAI_EMBEDDING_TIMEOUT_MS);
    try {
      const resp = await fetch('https://api.openai.com/v1/embeddings', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        signal: controller.signal,
        body: JSON.stringify({
          model: OPENAI_EMBEDDING_MODEL,
          input: String(text).slice(0, 6000),
        }),
      });

      if (!resp.ok) {
        console.error('Erro embeddings OpenAI:', {
          status: resp.status,
          url: 'https://api.openai.com/v1/embeddings',
          attempt: attempt + 1,
          timeout_ms: OPENAI_EMBEDDING_TIMEOUT_MS,
          body: String(await resp.text()).slice(0, 600),
        });
        return null;
      }

      const data = await resp.json();
      return Array.isArray(data?.data?.[0]?.embedding) ? data.data[0].embedding : null;
    } catch (err) {
      const details = buildExternalErrorDetails(err, {
        attempt: attempt + 1,
        timeout_ms: OPENAI_EMBEDDING_TIMEOUT_MS,
        url: 'https://api.openai.com/v1/embeddings',
      });
      if (err?.name === "AbortError") {
        console.error("Embedding cancelado por timeout.", details);
      } else {
        console.error('Falha ao gerar embedding:', details);
      }
      if (attempt === 0) {
        console.warn("Repetindo geração de embedding após falha temporária.");
        continue;
      }
      return null;
    } finally {
      clearTimeout(timeout);
    }
  }
  return null;
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

async function getDocumentRowByKnowledgeSource(source = {}) {
  const fullPath = getKnowledgeSourceFullPath(source);
  if (!fullPath) return null;
  return await get(
    `SELECT id, source_path, rel_path, extracted_text, mime_type, department_name, source_kind, language, content_hash, keywords, updated_at
       FROM documents
      WHERE source_path=?
      LIMIT 1`,
    [fullPath]
  );
}

async function getTopDocumentChunks(documentId, limit = 4) {
  if (!documentId) return [];
  return await all(
    `SELECT id, chunk_index, content_text, keywords, translated_text, translated_language
       FROM document_chunks
      WHERE document_id=?
      ORDER BY chunk_index ASC
      LIMIT ?`,
    [documentId, Math.max(1, Number(limit || 4))]
  );
}

async function getRelatedDocumentCandidates(documentRow, limit = 5) {
  if (!documentRow?.id) return [];
  const currentKeywords = String(documentRow.keywords || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 8);
  if (!currentKeywords.length) return [];

  const params = [documentRow.id];
  let sql = `
    SELECT id, rel_path, source_path, department_name, keywords, updated_at
      FROM documents
     WHERE id<>?
  `;

  if (String(documentRow.department_name || "").trim()) {
    sql += " AND department_name=?";
    params.push(String(documentRow.department_name || "").trim());
  }

  sql += " ORDER BY datetime(updated_at) DESC, id DESC LIMIT 32";
  const candidates = await all(sql, params);

  return candidates
    .map((candidate) => {
      const candidateKeywords = new Set(
        String(candidate.keywords || "")
          .split(",")
          .map((item) => normalizeSemanticText(item))
          .filter(Boolean)
      );
      const overlap = currentKeywords.filter((keyword) => candidateKeywords.has(normalizeSemanticText(keyword))).length;
      return {
        ...candidate,
        overlap,
      };
    })
    .filter((candidate) => candidate.overlap > 0)
    .sort((left, right) => Number(right.overlap || 0) - Number(left.overlap || 0))
    .slice(0, Math.max(1, Number(limit || 5)));
}

async function ensureKnowledgeDocumentMemory(knowledgeSourceId, source = null, options = {}) {
  const safeKnowledgeSourceId = Number(knowledgeSourceId || 0);
  if (!safeKnowledgeSourceId) return null;

  const knowledgeSource = source || await getKnowledgeSourceById(safeKnowledgeSourceId);
  if (!knowledgeSource) throw new Error("knowledge_source_not_found");

  const documentRow = await getDocumentRowByKnowledgeSource(knowledgeSource);
  if (!documentRow) throw new Error("knowledge_document_not_found");

  const chunkRows = await getTopDocumentChunks(documentRow.id, 5);
  const chunkTexts = chunkRows.map((row) => String(row.content_text || "").trim()).filter(Boolean);
  const relatedDocuments = await getRelatedDocumentCandidates(documentRow, 5);
  const keywords = String(documentRow.keywords || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  const profile = buildDocumentKnowledgeProfile({
    title: knowledgeSource.original_name || documentRow.rel_path,
    text: documentRow.extracted_text || "",
    keywords,
    chunkTexts,
    relatedDocuments,
    departmentName: knowledgeSource.department_name || documentRow.department_name || "",
    sourceKind: knowledgeSource.source_kind || documentRow.source_kind || "manual_upload",
    language: knowledgeSource.language || documentRow.language || "pt",
  });

  if (!String(profile.memoryText || "").trim()) {
    throw new Error("knowledge_analysis_empty");
  }

  const memoryId = await upsertMemoryEntry({
    userId: DOCUMENT_MEMORY_USER_ID,
    conversationId: null,
    knowledgeSourceId: safeKnowledgeSourceId,
    memoryScope: KNOWLEDGE_MEMORY_SCOPE,
    memoryKind: KNOWLEDGE_MEMORY_KIND,
    title: profile.title,
    contentText: profile.memoryText,
    topics: profile.themes,
    language: knowledgeSource.language || documentRow.language || "pt",
    sourceMessageIds: [],
  });

  const analysisDetail = {
    summary: profile.summary,
    entities: profile.entities,
    themes: profile.themes,
    relationships: profile.relationships,
    memory_id: memoryId,
  };

  return {
    memoryId,
    profile,
    analysisDetail,
  };
}

async function getRelevantKnowledgeDocumentMemories(queryText, options = {}) {
  const safeQuery = String(queryText || "").trim();
  if (!safeQuery) return [];

  const queryEmbedding = options.queryEmbedding || await getEmbeddingForText(safeQuery);
  const topicTerms = new Set(extractTopicTerms(safeQuery));
  const departmentKeys = new Set((options.departments || []).map((item) => normalizeDepartmentValue(item)).filter(Boolean));
  const rows = await all(
    `SELECT me.id, me.knowledge_source_id, me.title, me.content_text, me.topics_json, me.language, me.embedding_json, me.updated_at,
            ks.original_name, ks.stored_name, ks.department_name, ks.source_kind
       FROM memory_entries me
       LEFT JOIN knowledge_sources ks ON ks.id = me.knowledge_source_id
      WHERE me.memory_scope=?
      ORDER BY datetime(me.updated_at) DESC, me.id DESC
      LIMIT 160`,
    [KNOWLEDGE_MEMORY_SCOPE]
  );

  return rows
    .map((row) => {
      const topics = safeJsonParse(row.topics_json || "[]") || [];
      const overlap = topics.filter((topic) => topicTerms.has(normalizeTopicText(topic))).length;
      const similarity = queryEmbedding ? cosineSimilarity(queryEmbedding, row.embedding_json) : 0;
      const departmentBoost = departmentKeys.size && departmentKeys.has(normalizeDepartmentValue(row.department_name || "")) ? 0.16 : 0;
      return {
        ...row,
        topics,
        memory_score: similarity + (overlap * 0.08) + departmentBoost,
      };
    })
    .filter((row) => row.memory_score >= 0.36 || row.topics.length >= 2)
    .sort((left, right) => Number(right.memory_score || 0) - Number(left.memory_score || 0))
    .slice(0, Math.max(1, Number(options.limit || 4)));
}

function buildKnowledgeMemoryBundle(entries = [], userLanguage = "pt") {
  const safeEntries = Array.isArray(entries) ? entries : [];
  const sources = [];
  const textBlocks = [];

  for (const entry of safeEntries) {
    const label = normalizeDisplayName(entry.original_name || entry.title || `Documento #${entry.knowledge_source_id || ""}`);
    textBlocks.push(`[Memoria documental: ${label}]\n${String(entry.content_text || "").slice(0, 1600)}`);
    pushUniqueSource(sources, {
      type: "knowledge_memory",
      label,
      excerpt: entry.content_text || "",
      stored_name: entry.stored_name || "",
      knowledge_source_id: entry.knowledge_source_id || null,
      language: entry.language || userLanguage,
    });
  }

  return {
    text: textBlocks.join("\n\n"),
    sources,
    entries: safeEntries,
  };
}

async function runKnowledgeSemanticAnalysisStage({
  knowledgeSourceId,
  source = null,
  state,
  actorUserId = null,
}) {
  let nextState = withKnowledgeStage(state, "analysis", {
    status: "processing",
    message: "Gerando memoria semantica documental.",
  });
  await updateKnowledgeSourceState(knowledgeSourceId, nextState, "processing");
  await appendKnowledgeProcessingLog(
    knowledgeSourceId,
    "analysis",
    "processing",
    "Analise semantica documental iniciada.",
    {},
    actorUserId
  );

  try {
    const analysis = await ensureKnowledgeDocumentMemory(knowledgeSourceId, source);
    nextState = withKnowledgeStage(nextState, "analysis", {
      status: "completed",
      memory_id: analysis?.memoryId || null,
      themes: analysis?.profile?.themes || [],
      entities: analysis?.profile?.entities || [],
      relationships: analysis?.profile?.relationships || [],
      message: "Memoria documental gerada com sucesso.",
    });
    await updateKnowledgeSourceState(knowledgeSourceId, nextState, "processing");
    await appendKnowledgeProcessingLog(
      knowledgeSourceId,
      "analysis",
      "completed",
      "Analise semantica concluida.",
      analysis?.analysisDetail || {},
      actorUserId
    );
    await logAiTrainingEvent({
      userId: actorUserId,
      knowledgeSourceId,
      eventType: "knowledge_memory_generated",
      eventStatus: "success",
      title: source?.original_name || `Documento #${knowledgeSourceId}`,
      detailText: analysis?.profile?.summary || "Memoria documental gerada.",
      meta: analysis?.analysisDetail || null,
    });
    return {
      state: nextState,
      analysis,
    };
  } catch (err) {
    nextState = withKnowledgeStage(nextState, "analysis", {
      status: "failed",
      message: err?.message || "knowledge_analysis_failed",
      error: err?.message || "knowledge_analysis_failed",
    });
    nextState = withKnowledgeStage(nextState, "health", {
      status: "failed",
      issues: [...new Set([...(nextState.health?.issues || []), "falha_analise_semantica"])],
    });
    await updateKnowledgeSourceState(knowledgeSourceId, nextState, "failed");
    await appendKnowledgeProcessingLog(
      knowledgeSourceId,
      "analysis",
      "failed",
      err?.message || "knowledge_analysis_failed",
      {},
      actorUserId
    );
    await logAiTrainingEvent({
      userId: actorUserId,
      knowledgeSourceId,
      eventType: "knowledge_memory_failed",
      eventStatus: "error",
      title: source?.original_name || `Documento #${knowledgeSourceId}`,
      detailText: err?.message || "knowledge_analysis_failed",
    });
    throw err;
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
    const resp = await fetchWithRetry('https://api.openai.com/v1/responses', {
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
    }, {
      label: "openai_translation",
      url: "https://api.openai.com/v1/responses",
    });

    if (!resp.ok) return cleanText;
    const data = await resp.json();
    return String(data?.output_text || cleanText).trim() || cleanText;
  } catch (err) {
    console.error('Falha ao traduzir texto:', buildExternalErrorDetails(err, {
      label: "openai_translation",
      url: "https://api.openai.com/v1/responses",
    }));
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
    stored_name: String(source.stored_name || "").trim(),
    knowledge_source_id: Number(source.knowledge_source_id || 0) || null,
  };

  const key = [normalized.type, normalized.label, normalized.url, normalized.file_id, normalized.stored_name, normalized.knowledge_source_id || ""].join("::");
  if (!key.replace(/[:]/g, "")) return;
  if (list.some((item) => [item.type, item.label, item.url || "", item.file_id || "", item.stored_name || "", item.knowledge_source_id || ""].join("::") === key)) {
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
  const legacyHasMemory = Number(source?.knowledge_memory_total || 0) > 0;
  let state = getKnowledgeProcessingState(source);

  if (!hasState && ["available", "synced", "local"].includes(syncStatus)) {
    state = createKnowledgeProcessingState({
      parsing: { status: "completed", message: "Estado legado tratado como conteudo disponivel." },
      transcript: { status: isMediaKnowledgeFile(source?.original_name, source?.mime_type, source?.stored_name || "") ? "completed" : "skipped" },
      chunking: { status: "completed" },
      embedding: { status: "completed" },
      analysis: legacyHasMemory
        ? { status: "completed", message: "Memoria documental legada encontrada." }
        : { status: "pending", message: "Memoria documental ainda nao foi gerada para este arquivo legado." },
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
    analysis_status: normalizeStageStatus(state.analysis?.status),
    vector_store_status: normalizeStageStatus(state.vector_store?.status, OPENAI_VECTOR_STORE_ID ? "pending" : "skipped"),
    availability_status: finalStatus,
    available_to_ai: Boolean(state.final?.available_to_ai),
    last_error: lastError,
    issue_count: Array.isArray(state.health?.issues) ? state.health.issues.length : 0,
    health_issues: Array.isArray(state.health?.issues) ? state.health.issues : [],
  };
}

function needsKnowledgeReprocess(row = {}) {
  return row.analysis_status !== "completed"
    || !row.available_to_ai
    || row.availability_status === "failed";
}

function summarizeKnowledgeAdminRows(rows = []) {
  const safeRows = Array.isArray(rows) ? rows : [];
  const counts = {
    total: safeRows.length,
    processed: 0,
    analyzed: 0,
    available: 0,
    failed: 0,
    processing: 0,
    needs_reprocess: 0,
  };

  for (const row of safeRows) {
    if (row.parsing_status === "completed") counts.processed += 1;
    if (row.analysis_status === "completed") counts.analyzed += 1;
    if (row.available_to_ai) counts.available += 1;
    if (row.availability_status === "failed") counts.failed += 1;
    if (["processing", "pending"].includes(String(row.availability_status || "").trim().toLowerCase())) {
      counts.processing += 1;
    }
    if (needsKnowledgeReprocess(row)) counts.needs_reprocess += 1;
  }

  return counts;
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
  if (Number(source.knowledge_source_id || 0)) {
    return Number(source.knowledge_source_id);
  }

  const explicitStoredName = String(source.stored_name || "").trim();
  if (explicitStoredName) {
    const storedRow = await get("SELECT id FROM knowledge_sources WHERE stored_name=? LIMIT 1", [explicitStoredName]);
    if (storedRow?.id) return storedRow.id;
  }

  const storedName = String(source.stored_name || "").trim()
    || (source.label ? path.basename(String(source.label || "")) : "");
  if (!storedName) return null;
  const row = await get("SELECT id FROM knowledge_sources WHERE stored_name=? LIMIT 1", [storedName]);
  return row?.id || null;
}

async function recordKnowledgeUsageEvents(userId, conversationId, sources = []) {
  const safeSources = Array.isArray(sources) ? sources : [];
  for (const source of safeSources) {
    if (!["knowledge_base", "file_search", "knowledge_memory"].includes(source?.type)) continue;
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
    if (responseLooksSelfLimiting(exact.response_text) || responseLooksWeak(exact.response_text)) {
      return null;
    }
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
    if (responseLooksSelfLimiting(best.response_text) || responseLooksWeak(best.response_text)) {
      return null;
    }
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
  const value = normalizeQuery(query);
  if (!value) return false;

  return queryLooksCurrent(value)
    || /(governo|lei|extern|internet|pesquise|pesquisar|web|site|sites|tendencia|publicado|gobierno|actualidad|oggi|actuel|nouvelles)/i.test(value);
}

function queryLooksInternalWorkspace(query = "") {
  const value = normalizeQuery(query);
  if (!value) return false;

  return /(intranet|departamento|departamentos|documento|documentos|arquivo|arquivos|processo|processos|agenda|dashboard|marketing|pedagog|pedag[oó]gic|financeir|comercial|matricula|matr[ií]cula|aluno|alunos|campanha|campanhas|whatsapp|usuario|usu[aá]rio|colaborador|time|crm|closer|rh|jur[ií]dic|professor|professores)/i.test(value);
}

function buildChatContextStrategy(query = "", responseProfile = null) {
  const looksTalkers = queryLooksAboutTalkers(query);
  const looksExternal = queryLooksExternalOrCurrent(query);
  const looksInternal = queryLooksInternalWorkspace(query);
  const fastGeneralOnly = !looksExternal && !looksTalkers && !looksInternal;
  const fastExternalOnly = looksExternal
    && !looksTalkers
    && !looksInternal;
  const fastTalkersOnly = looksTalkers && !looksInternal;
  const fastPath = fastExternalOnly || fastTalkersOnly || fastGeneralOnly;

  return {
    fastExternalOnly,
    fastTalkersOnly,
    fastGeneralOnly,
    skipEmbeddings: fastPath,
    skipInternalKnowledge: fastPath,
    skipKnowledgeMemories: fastPath,
    skipConversationMemories: fastPath,
    skipSemanticCache: fastPath,
    skipSupportAssets: fastPath,
    looksTalkers,
    looksExternal,
    looksInternal,
  };
}

function shouldFetchWebContext(query, knowledgeBundle) {
  const hasInternalContext = Boolean(String(knowledgeBundle?.text || "").trim());
  return !hasInternalContext || queryLooksExternalOrCurrent(query);
}

function talkersQueryNeedsFreshWebContext(query = "") {
  const normalized = normalizeQuery(query);
  if (!queryLooksAboutTalkers(normalized)) return false;
  return /(instagram|facebook|youtube|rede social|redes sociais|post|posts|publicacao|publicação|publicou|publica|blog|site|novidade|novidades|recente|ultim|últim|evento|campanha)/i.test(normalized);
}

function responseLooksSelfLimiting(text = "") {
  const safe = String(text || "").trim().toLowerCase();
  if (!safe) return true;
  return /(minhas limita[cç][oõ]es|nao tenho acesso|não tenho acesso|nao consigo verificar|não consigo verificar|consulte outro site|consultar outro site|sou focad[oa] apenas|nao mantenho um historico|não mantenho um histórico|nao tenho informac|não tenho informac|nao consigo acessar|não consigo acessar)/i.test(safe);
}

function mergeToolUsageMetrics(...metricsList) {
  const merged = {
    web_search_calls: 0,
    data_api_calls: 0,
    file_search_calls: 0,
    talkers_public_hits: 0,
    external_context_hits: 0,
  };

  for (const metrics of metricsList) {
    if (!metrics || typeof metrics !== "object") continue;
    merged.web_search_calls += Number(metrics.web_search_calls || 0);
    merged.data_api_calls += Number(metrics.data_api_calls || 0);
    merged.file_search_calls += Number(metrics.file_search_calls || 0);
    merged.talkers_public_hits += Number(metrics.talkers_public_hits || 0);
    merged.external_context_hits += Number(metrics.external_context_hits || 0);
  }

  return merged;
}

function buildExternalContextFallbackAnswer(externalToolContext = null, userLanguage = "pt") {
  const direct = String(externalToolContext?.direct_answer || "").trim();
  if (direct) return direct;

  const lines = String(externalToolContext?.text || "")
    .split("\n")
    .map((line) => String(line || "").trim())
    .filter(Boolean)
    .slice(0, 4);

  if (!lines.length) return "";
  if (String(userLanguage || "pt").startsWith("en")) {
    return [
      "Here is the most relevant public context I found for your question:",
      "",
      ...lines.map((line) => `- ${line}`),
      "",
      "✅ If you want, I can also refine this answer, summarize the key points, or organize it into a clearer comparison.",
    ].join("\n");
  }
  return [
    "Aqui está o contexto público mais relevante que encontrei para a sua pergunta:",
    "",
    ...lines.map((line) => `- ${line}`),
    "",
    "✅ Se quiser, eu também posso refinar essa resposta, resumir os pontos principais ou organizar tudo em uma comparação mais clara.",
  ].join("\n");
}

function buildTalkersContextFallbackAnswer(talkersPublicBundle = null) {
  return repairMojibakeText(String(talkersPublicBundle?.direct_answer || "").trim());
}

async function buildConversationKnowledgeContext({
  text,
  userLanguage,
  currentUser,
  queryEmbedding,
  supportAssets,
  strategy = null,
  preloadedExternalToolContext = null,
}) {
  const contextStrategy = strategy || buildChatContextStrategy(text);
  const emptyKnowledgeBundle = { text: "", sources: [], rows: [] };
  const emptyPublicBundle = {
    text: "",
    sources: [],
    categories: [],
    last_updated_at: null,
    metrics: { talkers_public_hits: 0 },
  };

  const knowledgeBundlePromise = contextStrategy.skipInternalKnowledge
    ? Promise.resolve(emptyKnowledgeBundle)
    : buildKnowledgeBundle(text, {
        limit: 4,
        userLanguage,
        departments: currentUser?.departments || [],
      }).catch((err) => {
        console.log("Erro ao montar base interna da conversa:", err?.message || err);
        return emptyKnowledgeBundle;
      });

  const knowledgeMemoryEntriesPromise = contextStrategy.skipKnowledgeMemories
    ? Promise.resolve([])
    : getRelevantKnowledgeDocumentMemories(text, {
        limit: 4,
        queryEmbedding,
        departments: currentUser?.departments || [],
      }).catch((err) => {
        console.log("Erro ao montar memoria documental da conversa:", err?.message || err);
        return [];
      });

  const talkersPublicBundlePromise = contextStrategy.looksTalkers
    ? buildTalkersPublicKnowledgeBundle(text, {
        limit: 5,
        userLanguage,
      }).catch((err) => {
        console.log("Erro ao montar base publica da Talkers:", err?.message || err);
        return emptyPublicBundle;
      })
    : Promise.resolve(emptyPublicBundle);

  const [knowledgeBundle, knowledgeMemoryEntries, talkersPublicBundle] = await Promise.all([
    knowledgeBundlePromise,
    knowledgeMemoryEntriesPromise,
    talkersPublicBundlePromise,
  ]);
  const knowledgeMemoryBundle = buildKnowledgeMemoryBundle(knowledgeMemoryEntries, userLanguage);

  const mergedKnowledgeSources = [];
  (talkersPublicBundle.sources || []).forEach((source) => pushUniqueSource(mergedKnowledgeSources, source));
  (knowledgeBundle.sources || []).forEach((source) => pushUniqueSource(mergedKnowledgeSources, source));
  (knowledgeMemoryBundle.sources || []).forEach((source) => pushUniqueSource(mergedKnowledgeSources, source));

  const layeredKnowledgeText = [
    talkersPublicBundle.text || "",
    knowledgeBundle.text || "",
    knowledgeMemoryBundle.text || "",
  ].filter(Boolean).join("\n\n");

  const shouldUseTalkersWebRefresh = contextStrategy.looksTalkers && talkersQueryNeedsFreshWebContext(text);
  const shouldUseExternalTools = contextStrategy.fastExternalOnly
    || shouldFetchWebContext(text, { text: layeredKnowledgeText })
    || shouldUseTalkersWebRefresh
    || contextStrategy.looksExternal;

  const externalToolContext = preloadedExternalToolContext
    ? preloadedExternalToolContext
    : shouldUseExternalTools
      ? await resolveExternalToolContext(text, {
          userLanguage,
          forceWebSearch: contextStrategy.looksExternal || shouldUseTalkersWebRefresh,
        }).catch((err) => {
          console.log("Erro ao montar contexto externo:", err?.message || err);
          return null;
        })
      : null;

  (externalToolContext?.sources || []).forEach((source) => pushUniqueSource(mergedKnowledgeSources, source));

  const contextText = `
Data atual no Brasil:
${nowBrazil()}

Roteamento desta pergunta:
- Perguntas sobre a Talkers devem priorizar a base pública oficial da Talkers e a base interna da empresa.
- Perguntas gerais, atuais, públicas ou de mercado devem usar os dados externos atualizados e a busca web quando houver contexto disponível.
- Nunca diga que voce nao consegue acessar dados atuais se ja houver contexto externo, API ou resultado de busca no contexto.

Idioma detectado do usuário:
${getLanguageLabel(userLanguage)}

Base pública oficial da Talkers:
${trimContextText(talkersPublicBundle.text || "Sem bloco público específico da Talkers para esta pergunta.")}

Memória interna da empresa:
${trimContextText(knowledgeBundle.text || "Sem resultados relevantes da base interna.")}

Memória semântica derivada dos documentos:
${trimContextText(knowledgeMemoryBundle.text || "Sem memória documental relevante para esta pergunta.")}

Documentos e imagens da conversa:
${trimContextText(supportAssets.fileContext || "Nenhum anexo recente.")}

Dados externos atualizados e busca web:
${trimContextText(externalToolContext?.text || (shouldUseExternalTools ? "Nenhum resultado externo adicional foi encontrado nesta tentativa." : "Nao foi necessario consultar fonte externa nesta pergunta."))}
`.trim();

  return {
    contextText,
    knowledgeBundle,
    knowledgeMemoryEntries,
    knowledgeMemoryBundle,
    talkersPublicBundle,
    externalToolContext: externalToolContext || {
      text: "",
      sources: [],
      metrics: {
        web_search_calls: 0,
        data_api_calls: 0,
        external_context_hits: 0,
      },
    },
    mergedKnowledgeSources,
    toolMetrics: mergeToolUsageMetrics(
      talkersPublicBundle.metrics || null,
      externalToolContext?.metrics || null
    ),
  };
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
        `[${mediaLabel} enviado: ${file.original_name} | ${file.mime_type || "media"}]\nO arquivo foi anexado à conversa, mas não foi possível gerar uma transcrição local.`
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

function buildOpenAIWebSearchTool(legacyWebSearch = false) {
  if (legacyWebSearch) {
    return { type: "web_search_preview" };
  }

  return {
    type: "web_search",
    search_context_size: "medium",
    external_web_access: true,
    user_location: {
      type: "approximate",
      country: "BR",
      timezone: "America/Sao_Paulo",
    },
  };
}

function buildOpenAITools({ legacyWebSearch = false } = {}) {
  const tools = [];

  if (OPENAI_VECTOR_STORE_ID) {
    tools.push({
      type: "file_search",
      vector_store_ids: [OPENAI_VECTOR_STORE_ID],
    });
  }

  tools.push(buildOpenAIWebSearchTool(Boolean(legacyWebSearch)));
  return tools;
}

function buildOpenAIResponsesRequestBody({
  model,
  input,
  prompt = null,
  stream = false,
  legacyWebSearch = false,
}) {
  const requestBody = {
    model,
    input,
    tools: buildOpenAITools({ legacyWebSearch }),
    include: ["file_search_call.results", "web_search_call.action.sources"],
    tool_choice: "auto",
  };
  if (stream) {
    requestBody.stream = true;
    requestBody.stream_options = {
      include_obfuscation: false,
    };
  }
  if (prompt) requestBody.prompt = prompt;
  return requestBody;
}

async function postOpenAIResponses(apiKey, requestBody) {
  try {
    return await fetchWithRetry("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
    }, {
      label: "openai_responses",
      url: "https://api.openai.com/v1/responses",
      payload_bytes: Buffer.byteLength(JSON.stringify(requestBody), "utf8"),
    });
  } catch (err) {
    console.error("Falha de rede ao chamar OpenAI Responses:", buildExternalErrorDetails(err, {
      label: "openai_responses",
      url: "https://api.openai.com/v1/responses",
    }));
    return {
      ok: false,
      status: 0,
      body: null,
      text: async () => String(err?.message || err || "network_error"),
    };
  }
}

function shouldRetryWithLegacyWebSearch(status, bodyText = "") {
  const safeBody = String(bodyText || "").toLowerCase();
  if (!status || status < 400) return false;
  return /web_search|web search|unknown tool|invalid tool|unsupported tool|tool_choice|tool type/.test(safeBody);
}

function parsePromptVariablesConfig() {
  if (!OPENAI_PROMPT_VARIABLES_JSON) return {};
  try {
    const parsed = JSON.parse(OPENAI_PROMPT_VARIABLES_JSON);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch (err) {
    console.log("OPENAI_PROMPT_VARIABLES_JSON invalido:", err?.message || err);
    return {};
  }
}

async function getConversationSupportCacheKey(conversationId) {
  const row = await get(
    `SELECT COUNT(*) AS total_files, COALESCE(MAX(id), 0) AS last_file_id
       FROM files
      WHERE conversation_id=?`,
    [conversationId]
  );
  return `${Number(conversationId || 0)}:${Number(row?.total_files || 0)}:${Number(row?.last_file_id || 0)}`;
}

async function getConversationSupportAssets(conversationId) {
  const cacheKey = await getConversationSupportCacheKey(conversationId);
  const cached = getChatSupportCacheEntry(cacheKey);
  if (cached) return cached;

  const [fileContext, visionInputs, documentInputs, imageReferences] = await Promise.all([
    getConversationFilesContext(conversationId),
    getRecentVisionInputs(conversationId, 3),
    getRecentDocumentInputs(conversationId, 2),
    getRecentImageReferences(conversationId, 4),
  ]);

  const payload = {
    cache_key: cacheKey,
    fileContext,
    visionInputs,
    documentInputs,
    imageReferences,
  };
  setChatSupportCacheEntry(cacheKey, payload);
  return payload;
}

function buildOpenAIPromptConfig(user = null, intent = null, language = "pt") {
  const allowReusablePrompt = /^(1|true|yes|on)$/i.test(String(process.env.OPENAI_PROMPT_USE_IN_CHAT || "").trim());
  if (!OPENAI_PROMPT_ID || !allowReusablePrompt) return null;

  const variables = {
    company_name: "Talkers",
    user_name: user?.name || "",
    user_role: user?.role || "user",
    user_departments: Array.isArray(user?.departments) ? user.departments.join(", ") : "",
    conversation_language: getLanguageLabel(language || "pt"),
    business_area: intent?.businessIntent?.businessAreaLabel || "",
    intent_type: intent?.businessIntent?.intentTypeLabel || "",
    current_datetime_br: nowBrazil(),
    ...parsePromptVariablesConfig(),
  };

  const prompt = {
    id: OPENAI_PROMPT_ID,
    variables,
  };

  if (OPENAI_PROMPT_VERSION) {
    prompt.version = OPENAI_PROMPT_VERSION;
  }

  return prompt;
}

async function buildOpenAIInput({
  conversationId,
  userId,
  userText,
  contextText,
  topicSnapshot = null,
  responseProfile = null,
  contextStrategy = null,
  currentUser = null,
  relevantMemoryEntries = null,
  visionInputs = null,
  documentInputs = null,
}) {
  const snapshot = topicSnapshot || await getConversationTopicSnapshot(conversationId, userText, CHAT_HISTORY_CONTEXT_LIMIT);
  const history = Array.isArray(snapshot?.history) ? snapshot.history : [];
  const topicShift = snapshot?.topicShift || { isShift: false, reason: 'unknown' };
  const resolvedUser = currentUser || await getUserById(userId);
  const userLanguage = normalizeLanguageCode(responseProfile?.language || detectConversationLanguage(userText, history));
  const intent = responseProfile || analyzeConversationIntent(userText, userLanguage, {
    departments: resolvedUser?.departments || [],
  });
  const skipPersistentMemory = Boolean(contextStrategy?.fastExternalOnly || contextStrategy?.fastTalkersOnly || contextStrategy?.fastGeneralOnly);
  const memory = skipPersistentMemory ? "" : await getConversationMemory(conversationId);
  const userMemory = skipPersistentMemory ? "" : await getRelevantUserMemory(userId, userText);
  const memoryEntries = Array.isArray(relevantMemoryEntries)
    ? relevantMemoryEntries
    : topicShift.isShift
      ? []
      : await getRelevantMemoryEntries(userId, conversationId, userText, 4);
  const memoryBundle = buildMemoryContextBundle(memoryEntries);
  const supportVisionInputs = Array.isArray(visionInputs) ? visionInputs : await getRecentVisionInputs(conversationId, 3);
  const supportDocumentInputs = Array.isArray(documentInputs) ? documentInputs : await getRecentDocumentInputs(conversationId, 2);
  const normalizedUserText = String(userText || '').trim();
  const businessContextText = buildBusinessContextBlock({
    user: resolvedUser || {},
    businessIntent: intent.businessIntent,
    userLanguageLabel: getLanguageLabel(userLanguage),
  });
  const businessInstructionText = buildBusinessInstructions(intent.businessIntent);

  const historyText = topicShift.isShift
    ? 'Historico recente ocultado nesta resposta porque o usuario mudou claramente de assunto.'
    : buildCompactHistoryText(history, {
        maxItems: CHAT_HISTORY_CONTEXT_LIMIT,
        maxChars: CHAT_HISTORY_CONTEXT_MAX_CHARS,
      });

  const memoryText = topicShift.isShift
    ? 'Memoria de conversa anterior ignorada nesta resposta por mudanca de assunto.'
    : trimContextText(memory || 'Sem memoria persistente desta conversa ainda.', CHAT_MEMORY_BLOCK_MAX_CHARS);

  const userMemoryText = topicShift.isShift
    ? 'Memoria entre conversas nao usada nesta resposta por mudanca de assunto.'
    : trimContextText(userMemory || 'Sem memoria relevante de outras conversas.', CHAT_MEMORY_BLOCK_MAX_CHARS);
  const semanticMemoryText = topicShift.isShift
    ? 'Memorias semanticas ignoradas nesta resposta por mudanca de assunto.'
    : trimContextText(memoryBundle.text || 'Sem memorias semanticas relevantes para esta pergunta.', CHAT_MEMORY_BLOCK_MAX_CHARS);

  const systemText = `
Voce e a TALKERS IA, assistente moderna, natural, util e confiavel da empresa Talkers.
Idioma principal da resposta atual: ${getLanguageLabel(userLanguage)}.
Tom desejado para esta resposta: ${getToneInstruction(intent)}.

Comportamento:
- Detecte automaticamente o idioma do usuario e responda nesse idioma.
- Quando o usuario pedir traducao, traduza para o idioma solicitado mantendo contexto e intencao.
- Quando documentos estiverem em outro idioma, interprete o conteudo no idioma original, traduza silenciosamente quando necessario e responda no idioma do usuario.
- Voce e um assistente amplo e inteligente, capaz de responder sobre assuntos gerais, tecnicos, atuais, institucionais e informativos, nao ficando restrito apenas ao contexto da escola.
- Para perguntas sobre a Talkers, seus cursos, metodologia, contatos, site, presenca publica e comunicacao institucional, priorize a base oficial da Talkers e a base interna quando estiverem disponiveis.
- Para perguntas sobre processos, materiais, regras, vendas de cursos, atendimento, operacao pedagogica, marketing, financeiro e informacoes da Talkers, priorize sempre a base interna da empresa, a intranet e os arquivos da conversa.
- Para perguntas gerais, atuais, publicas, de mercado, cotacoes, clima, noticias ou dados recentes, use naturalmente o contexto externo, a busca web e os dados atualizados quando eles aparecerem no contexto.
- Se houver conflito entre base interna e web em assuntos da empresa, avise e priorize a base interna. Para temas gerais e atuais, priorize os dados externos atualizados.
- Analise a intencao antes de responder, identifique a area do negocio e adapte o tom naturalmente.
- Sempre que fizer sentido, entregue contexto, explicacao, passo a passo, exemplos, melhores praticas, alertas e proximo passo recomendado.
- Se o pedido envolver explicacao, orientacao, passo a passo, melhoria de texto, organizacao de informacao, sugestoes, traducao, resumo, reescrita, roteiro, mensagem comercial, comunicado ou texto pronto para uso, entregue em markdown bem estruturado, com hierarquia visual clara, blocos curtos e reutilizaveis.
- Para respostas institucionais, comerciais, explicativas ou comparativas, prefira uma abertura curta, 2 a 5 blocos claros com titulos e bullets objetivos, em vez de um texto corrido confuso.
- Se a pergunta for sobre uma empresa, marca, curso, produto, servico ou tema publico relevante, responda de forma apresentavel, persuasiva e facil de escanear, como se o usuario pudesse reutilizar a resposta em uma apresentacao ou conversa executiva.
- Se o usuario mudar de assunto, foque totalmente no tema atual sem arrastar contexto irrelevante.
- Se faltar informacao suficiente, deixe isso claro e peca complemento.
- Nunca responda de forma rasa quando a pergunta pedir profundidade ou aplicacao pratica.
- Nunca se compare negativamente com outros assistentes, nunca diga que tem menos capacidade, e nunca responda com frases como "nao tenho acesso" se houver contexto atual disponivel.
- Quando houver valor atual, faixa de cotacao, dado publico ou resultado de busca no contexto, responda de forma direta e util, citando a natureza aproximada do dado quando cabivel.
- Quando fizer sentido, encerre a resposta com um bloco curto no estilo "✅ Se quiser, posso tambem..." e ofereca de 2 a 4 proximos passos uteis, sem exagerar.

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
 - Contexto adicional: ${trimContextText(contextText || 'Sem contexto adicional.', CHAT_CONTEXT_BLOCK_MAX_CHARS)}

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
        ...supportVisionInputs,
        ...supportDocumentInputs,
      ],
    },
  ];
}

function extractResponsePayload(data, baseSources = []) {
  const sources = [];
  const toolUsage = {
    web_search_calls: 0,
    file_search_calls: 0,
    data_api_calls: 0,
    talkers_public_hits: 0,
    external_context_hits: 0,
  };
  for (const source of baseSources || []) {
    pushUniqueSource(sources, source);
  }

  let text = repairMojibakeText(String(data?.output_text || "").trim());

  try {
    for (const item of data?.output || []) {
      if (item?.type === "message" && Array.isArray(item.content)) {
        for (const part of item.content) {
          if (!text && part?.type === "output_text" && part.text) {
            text = repairMojibakeText(`${text ? `${text}\n` : ""}${part.text}`.trim());
          }

          for (const annotation of part?.annotations || []) {
            if (annotation?.type === "file_citation") {
              pushUniqueSource(sources, {
                type: "file_search",
                label: repairMojibakeText(annotation.filename || annotation.file_id || "Arquivo da base"),
                file_id: annotation.file_id || "",
              });
            }

            if (annotation?.type === "url_citation") {
              pushUniqueSource(sources, {
                type: "web",
                label: repairMojibakeText(annotation.title || annotation.url || "Fonte externa"),
                url: annotation.url || "",
              });
            }
          }
        }
      }

      if (item?.type === "file_search_call" && Array.isArray(item.results)) {
        toolUsage.file_search_calls += 1;
        for (const result of item.results.slice(0, 6)) {
          pushUniqueSource(sources, {
            type: "file_search",
            label: repairMojibakeText(result?.filename || result?.file_id || "Arquivo da base"),
            file_id: result?.file_id || "",
            excerpt: repairMojibakeText(result?.text || result?.content || ""),
          });
        }
      }

      if (item?.type === "web_search_call" && Array.isArray(item.action?.sources)) {
        toolUsage.web_search_calls += 1;
        toolUsage.external_context_hits += 1;
        for (const source of item.action.sources.slice(0, 6)) {
          pushUniqueSource(sources, {
            type: "web",
            label: repairMojibakeText(source?.title || source?.url || "Fonte externa"),
            url: source?.url || "",
          });
        }
      }
    }
  } catch (err) {
    console.log("Erro ao extrair fontes da OpenAI:", err?.message || err);
  }

  return {
    text: repairMojibakeText((text || "").trim()) || "Sem resposta da OpenAI.",
    sources: sources.slice(0, 8),
    tool_usage: toolUsage,
  };
}

async function openaiReply({
  conversationId,
  userId,
  userText,
  contextText,
  baseSources = [],
  topicSnapshot = null,
  responseProfile = null,
  contextStrategy = null,
  currentUser = null,
  relevantMemoryEntries = null,
  visionInputs = null,
  documentInputs = null,
}) {
  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_MODEL || "gpt-4o-mini";
  const apiStartedAt = Date.now();
  if (!apiKey) {
    return {
      text: "Não foi possível concluir a resposta agora por indisponibilidade temporária da IA.",
      sources: [...(baseSources || [])],
      metrics: {
        api_latency_ms: 0,
        status: "missing_api_key",
        model,
      },
    };
  }

  const input = await buildOpenAIInput({
    conversationId,
    userId,
    userText,
    contextText,
    topicSnapshot,
    responseProfile,
    contextStrategy,
    currentUser,
    relevantMemoryEntries,
    visionInputs,
    documentInputs,
  });
  const resolvedUser = currentUser || await getUserById(userId).catch(() => null);
  const prompt = buildOpenAIPromptConfig(resolvedUser, responseProfile || analyzeConversationIntent(userText, detectConversationLanguage(userText)), responseProfile?.language);

  let legacyWebSearch = false;
  let requestBody = buildOpenAIResponsesRequestBody({
    model,
    input,
    prompt,
    legacyWebSearch,
  });
  let payloadBytes = Buffer.byteLength(JSON.stringify(requestBody), "utf8");

  let resp = await postOpenAIResponses(apiKey, requestBody);

  if (!resp.ok && prompt) {
    const body = await resp.text();
    console.log("OpenAI prompt fallback:", resp.status, body);
    const fallbackBody = { ...requestBody };
    delete fallbackBody.prompt;
    resp = await postOpenAIResponses(apiKey, fallbackBody);
  }

  if (!resp.ok) {
    const body = await resp.text();
    if (shouldRetryWithLegacyWebSearch(resp.status, body)) {
      console.log("OpenAI web_search fallback:", resp.status, body);
      legacyWebSearch = true;
      requestBody = buildOpenAIResponsesRequestBody({
        model,
        input,
        prompt,
        legacyWebSearch,
      });
      payloadBytes = Buffer.byteLength(JSON.stringify(requestBody), "utf8");
      resp = await postOpenAIResponses(apiKey, requestBody);
    } else {
      resp = {
        ok: false,
        status: resp.status,
        text: async () => body,
      };
    }
  }

  if (!resp.ok) {
    const body = await resp.text();
    console.log("OpenAI error:", resp.status, body);
    return {
      text: "Não foi possível concluir a resposta agora por indisponibilidade temporária da IA.",
      sources: [...(baseSources || [])],
      metrics: {
        api_latency_ms: Date.now() - apiStartedAt,
        status: `http_${resp.status}`,
        model,
        payload_bytes: payloadBytes,
        response_bytes: Buffer.byteLength(String(body || ""), "utf8"),
      },
    };
  }

  const rawBody = await resp.text();
  const data = rawBody ? JSON.parse(rawBody) : {};
  const payload = extractResponsePayload(data, baseSources);
  payload.metrics = {
    api_latency_ms: Date.now() - apiStartedAt,
    status: "success",
    model,
    payload_bytes: payloadBytes,
    response_bytes: Buffer.byteLength(String(rawBody || ""), "utf8"),
    ...(payload.tool_usage || {}),
  };
  return payload;
}

async function openaiReplyStream({
  conversationId,
  userId,
  userText,
  contextText,
  baseSources = [],
  topicSnapshot = null,
  responseProfile = null,
  contextStrategy = null,
  currentUser = null,
  relevantMemoryEntries = null,
  visionInputs = null,
  documentInputs = null,
  onDelta = null,
}) {
  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_MODEL || "gpt-4o-mini";
  const apiStartedAt = Date.now();
  if (!apiKey) {
    return {
      text: "Não foi possível concluir a resposta agora por indisponibilidade temporária da IA.",
      sources: [...(baseSources || [])],
      metrics: {
        api_latency_ms: 0,
        status: "missing_api_key",
        model,
      },
    };
  }

  const input = await buildOpenAIInput({
    conversationId,
    userId,
    userText,
    contextText,
    topicSnapshot,
    responseProfile,
    contextStrategy,
    currentUser,
    relevantMemoryEntries,
    visionInputs,
    documentInputs,
  });
  const resolvedUser = currentUser || await getUserById(userId).catch(() => null);
  const prompt = buildOpenAIPromptConfig(
    resolvedUser,
    responseProfile || analyzeConversationIntent(userText, detectConversationLanguage(userText)),
    responseProfile?.language
  );
  let legacyWebSearch = false;
  let requestBody = buildOpenAIResponsesRequestBody({
    model,
    input,
    prompt,
    stream: true,
    legacyWebSearch,
  });
  let payloadBytes = Buffer.byteLength(JSON.stringify(requestBody), "utf8");

  let resp = await postOpenAIResponses(apiKey, requestBody);

  if (!resp.ok && prompt) {
    const body = await resp.text();
    console.log("OpenAI prompt fallback (stream):", resp.status, body);
    const fallbackBody = { ...requestBody };
    delete fallbackBody.prompt;
    resp = await postOpenAIResponses(apiKey, fallbackBody);
  }

  if (!resp.ok) {
    const body = await resp.text();
    if (shouldRetryWithLegacyWebSearch(resp.status, body)) {
      console.log("OpenAI web_search fallback (stream):", resp.status, body);
      legacyWebSearch = true;
      requestBody = buildOpenAIResponsesRequestBody({
        model,
        input,
        prompt,
        stream: true,
        legacyWebSearch,
      });
      payloadBytes = Buffer.byteLength(JSON.stringify(requestBody), "utf8");
      resp = await postOpenAIResponses(apiKey, requestBody);
    } else {
      resp = {
        ok: false,
        status: resp.status,
        body: null,
        text: async () => body,
      };
    }
  }

  if (!resp.ok || !resp.body) {
    const body = await resp.text();
    console.log("OpenAI stream error:", resp.status, body);
    return {
      text: "Não foi possível concluir a resposta agora por indisponibilidade temporária da IA.",
      sources: [...(baseSources || [])],
      metrics: {
        api_latency_ms: Date.now() - apiStartedAt,
        status: `http_${resp.status}`,
        model,
        payload_bytes: payloadBytes,
        response_bytes: Buffer.byteLength(String(body || ""), "utf8"),
      },
    };
  }

  const decoder = new TextDecoder();
  let buffer = "";
  let responseBytes = 0;
  let fullText = "";
  let finalPayload = null;

  const flushBlock = async (blockText = "") => {
    const lines = String(blockText || "").split("\n").map((line) => line.trim()).filter(Boolean);
    if (!lines.length) return;
    const dataLines = lines.filter((line) => line.startsWith("data:")).map((line) => line.replace(/^data:\s?/, ""));
    if (!dataLines.length) return;
    const dataText = dataLines.join("\n");
    if (dataText === "[DONE]") return;
    let event = null;
    try {
      event = JSON.parse(dataText);
    } catch {
      return;
    }
    if (!event || typeof event !== "object") return;
    if (event.type === "response.output_text.delta" && event.delta) {
      fullText += event.delta;
      if (typeof onDelta === "function") await onDelta(String(event.delta || ""), { fullText });
    }
    if (event.type === "response.output_text.done" && event.text && !fullText) {
      fullText = String(event.text || "");
      if (typeof onDelta === "function") await onDelta(fullText, { fullText, replace: true });
    }
    if (event.type === "response.completed") {
      finalPayload = extractResponsePayload(event.response || {}, baseSources);
    }
  };

  for await (const chunk of resp.body) {
    const chunkBuffer = Buffer.from(chunk);
    responseBytes += chunkBuffer.length;
    buffer += decoder.decode(chunkBuffer, { stream: true });
    while (buffer.includes("\n\n")) {
      const boundaryIndex = buffer.indexOf("\n\n");
      const block = buffer.slice(0, boundaryIndex);
      buffer = buffer.slice(boundaryIndex + 2);
      await flushBlock(block);
    }
  }
  if (buffer.trim()) {
    await flushBlock(buffer);
  }

  const payload = finalPayload || {
    text: (fullText || "").trim() || "Sem resposta da OpenAI.",
    sources: [...(baseSources || [])].slice(0, 8),
  };
  payload.text = String(payload.text || fullText || "").trim() || "Sem resposta da OpenAI.";
  payload.metrics = {
    api_latency_ms: Date.now() - apiStartedAt,
    status: "success",
    model,
    payload_bytes: payloadBytes,
    response_bytes: responseBytes,
    ...(payload.tool_usage || {}),
  };
  return payload;
}

async function getUserById(userId) {
  const user = await get(
    "SELECT id, name, email, role, department, can_access_intranet, preferred_locale, job_title, unit_name, created_at FROM users WHERE id=?",
    [userId]
  );
  return hydrateUserRecord(user);
}

async function getUserByEmail(email) {
  const user = await get(
    "SELECT id, name, email, role, department, can_access_intranet, preferred_locale, job_title, unit_name, created_at FROM users WHERE email=?",
    [email]
  );
  return hydrateUserRecord(user);
}

function hasIntranetAccess(user) {
  return Boolean(user);
}

function buildIntranetNotifications(announcements = [], upcomingEvents = []) {
  const items = [];

  announcements
    .filter((item) => item.is_pinned)
    .slice(0, 3)
    .forEach((item) => {
      items.push({
        kind: 'announcement',
        title: item.title,
        description: item.summary_text || item.content_text || '',
        date_label: item.created_at ? formatDateBrazil(item.created_at) : '',
      });
    });

  upcomingEvents
    .slice(0, 3)
    .forEach((item) => {
      items.push({
        kind: 'meeting',
        title: item.title || 'Compromisso',
        description: item.description || item.location || item.meeting_mode_label || '',
        date_label: item.start_at ? formatDateTimeBrazil(item.start_at) : (item.start_date || ''),
      });
    });

  return items.slice(0, 6);
}

async function buildIntranetPayload(userId) {
  const user = await getUserById(userId);
  if (!user) return null;

  const isAdmin = user.role === 'admin';
  const departmentCatalog = await listDepartmentCatalog();
  const visibleDepartmentDetails = isAdmin
    ? departmentCatalog.map((department) => ({
        ...department,
        access_level: 'administrador',
      }))
    : (user.department_details || []).filter((department) => department.is_active !== false);
  const visibleDepartments = visibleDepartmentDetails.map((item) => item.name).filter(Boolean);
  const visibleDepartmentIds = visibleDepartmentDetails.map((item) => Number(item.id || 0)).filter(Boolean);
  const documentWhere = [];
  const documentParams = [];
  if (!isAdmin && visibleDepartments.length) {
    documentWhere.push(`(department_name IS NULL OR department_name='' OR department_name IN (${visibleDepartments.map(() => '?').join(', ')}))`);
    documentParams.push(...visibleDepartments);
  } else if (!isAdmin) {
    documentWhere.push("(department_name IS NULL OR department_name='')");
  }

  const documentWhereSql = documentWhere.length ? `WHERE ${documentWhere.join(' AND ')}` : '';

  const [departmentSubmenus, recentDocuments, totalDocumentsRow, salesPayload, documentCountRows, announcementsRaw, upcomingEvents, marketingIndicatorDashboard] = await Promise.all([
    (!isAdmin && !visibleDepartmentIds.length)
      ? Promise.resolve([])
      : listDepartmentSubmenus({ includeInactive: isAdmin, departmentIds: visibleDepartmentIds }),
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
      all(
        `SELECT COALESCE(NULLIF(department_name, ''), 'Geral') AS department_name, COUNT(*) AS total
           FROM knowledge_sources
           ${documentWhereSql}
          GROUP BY COALESCE(NULLIF(department_name, ''), 'Geral')
          ORDER BY COUNT(*) DESC, department_name ASC
          LIMIT 16`,
        documentParams
      ),
      listIntranetAnnouncements({ includeInactive: isAdmin, limit: 24 }),
      listCalendarEventsForUser(user, {
        from: brazilDateKey(),
        to: brazilDateKey(new Date(Date.now() + 1000 * 60 * 60 * 24 * 21)),
        status: 'scheduled',
        limit: 8,
      }),
      (isAdmin || userHasDepartmentAccess(user, "marketing"))
        ? buildMarketingIndicatorDashboardSnapshot(user).catch(() => null)
        : Promise.resolve(null),
  ]);

  const submenusByDepartmentId = new Map();
  for (const submenu of departmentSubmenus || []) {
    const key = Number(submenu.department_id || 0);
    if (!submenusByDepartmentId.has(key)) submenusByDepartmentId.set(key, []);
    submenusByDepartmentId.get(key).push(submenu);
  }

  const visibleAnnouncements = filterAnnouncementsForUser(announcementsRaw, user, visibleDepartmentDetails);
  const departmentDetailsWithSubmenus = visibleDepartmentDetails.map((department) => ({
    ...department,
    submenus: submenusByDepartmentId.get(Number(department.id || 0)) || [],
  }));

  const workspace = buildIntranetWorkspace({
    user,
    departments: departmentDetailsWithSubmenus,
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
    departmentDocumentTotals: (documentCountRows || []).map((row) => ({
      name: row.department_name || 'Geral',
      total: Number(row.total || 0),
    })),
    marketingIndicatorDashboard: marketingIndicatorDashboard || null,
    announcements: visibleAnnouncements,
    upcomingEvents,
    notifications: buildIntranetNotifications(visibleAnnouncements, upcomingEvents),
  });

  workspace.sales = salesPayload;
  workspace.dashboard.marketing_indicator = marketingIndicatorDashboard || null;
  workspace.calendar_preview = {
    total_upcoming: upcomingEvents.length,
    upcoming_events: upcomingEvents,
  };

  return repairDeepText({
    user,
    department_catalog: departmentCatalog,
    intranet: workspace,
  });
}

const MARKETING_PERIOD_TYPES = new Set(["day", "week", "month"]);

function parseDelimitedValues(value) {
  if (Array.isArray(value)) return value;
  const safe = String(value || "").trim();
  if (!safe) return [];
  return safe.split(/[\n,;]+/g).map((item) => item.trim()).filter(Boolean);
}

function normalizeMarketingInfluencerStatus(value = "") {
  const normalized = normalizeBusinessText(String(value || "").trim()).replace(/\s+/g, " ").trim();
  if (!normalized) return "ativo";

  const lookup = new Map([
    ["ativo", "ativo"],
    ["ativa", "ativo"],
    ["em teste", "em teste"],
    ["teste", "em teste"],
    ["pausado", "pausado"],
    ["pausada", "pausado"],
    ["encerrado", "encerrado"],
    ["encerrada", "encerrado"],
  ]);

  return lookup.get(normalized) || (MARKETING_INFLUENCER_STATUSES.has(normalized) ? normalized : "ativo");
}

function normalizeMarketingPeriodType(value = "") {
  const normalized = normalizeBusinessText(String(value || "").trim()).replace(/\s+/g, " ").trim();
  if (!normalized) return "month";

  const lookup = new Map([
    ["dia", "day"],
    ["diario", "day"],
    ["daily", "day"],
    ["day", "day"],
    ["semana", "week"],
    ["semanal", "week"],
    ["weekly", "week"],
    ["week", "week"],
    ["mes", "month"],
    ["mensal", "month"],
    ["monthly", "month"],
    ["month", "month"],
  ]);

  return lookup.get(normalized) || "month";
}

function normalizeDateKeyInput(value = "") {
  const safe = String(value || "").trim();
  if (!safe) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(safe)) return safe;
  const parsed = new Date(safe);
  if (Number.isNaN(parsed.getTime())) return "";
  return brazilDateKey(parsed);
}

function buildMarketingPeriodRange(query = {}) {
  const periodType = normalizeMarketingPeriodType(query.period_type || query.periodType || "month");
  let from = normalizeDateKeyInput(query.from || query.start_date || "");
  let to = normalizeDateKeyInput(query.to || query.end_date || "");

  const anchor = normalizeDateKeyInput(query.base_date || from || to || brazilDateKey());
  const base = new Date(`${anchor}T12:00:00-03:00`);

  if (!from || !to) {
    const start = new Date(base);
    const end = new Date(base);

    if (periodType === "month") {
      start.setDate(1);
      end.setMonth(end.getMonth() + 1, 0);
    } else if (periodType === "week") {
      start.setDate(start.getDate() - start.getDay());
      end.setDate(start.getDate() + 6);
    }

    from = brazilDateKey(start);
    to = brazilDateKey(end);
  }

  if (to < from) {
    const swap = from;
    from = to;
    to = swap;
  }

  const label = `${formatDateBrazil(`${from}T12:00:00-03:00`)} - ${formatDateBrazil(`${to}T12:00:00-03:00`)}`;
  return { period_type: periodType, from, to, label };
}

function normalizeMarketingInfluenceTypes(value) {
  const seen = new Set();
  const out = [];

  for (const item of parseDelimitedValues(value)) {
    const normalized = String(item || "").trim();
    const key = normalizeBusinessText(normalized);
    if (!normalized || !key || seen.has(key)) continue;
    seen.add(key);
    out.push(normalized);
  }

  return out;
}

function normalizeInstagramUrl(value = "") {
  const safe = String(value || "").trim();
  if (!safe) return null;

  let normalized = safe;
  if (normalized.startsWith("@")) {
    normalized = `https://instagram.com/${normalized.slice(1)}`;
  } else if (!/^https?:\/\//i.test(normalized)) {
    normalized = `https://${normalized}`;
  }

  try {
    const parsed = new URL(normalized);
    if (!/instagram\.com$/i.test(parsed.hostname) && !/www\.instagram\.com$/i.test(parsed.hostname)) {
      throw new Error("instagram_invalid_host");
    }
    return parsed.toString();
  } catch {
    throw new Error("invalid_instagram_url");
  }
}

function normalizeMarketingFollowersCount(value) {
  const numeric = Number(value || 0);
  if (!Number.isFinite(numeric) || numeric < 0) return 0;
  return Math.round(numeric);
}

function normalizeMarketingMetricCount(value) {
  const numeric = Number(value || 0);
  if (!Number.isFinite(numeric) || numeric < 0) return 0;
  return Math.round(numeric);
}

function calculateMarketingPerformanceScore(metric = {}) {
  const posts = normalizeMarketingMetricCount(metric.posts_count);
  const reels = normalizeMarketingMetricCount(metric.reels_count);
  const stories = normalizeMarketingMetricCount(metric.stories_count);
  const views = normalizeMarketingMetricCount(metric.views_count);
  const enrollments = normalizeMarketingMetricCount(metric.enrollments_count);
  return Math.round((posts * 3) + (reels * 5) + (stories * 2) + (views / 400) + (enrollments * 40));
}

function mapMarketingInfluencerRow(row) {
  if (!row) return null;
  return {
    ...row,
    influence_types: Array.isArray(safeJsonParse(row.influence_types_json || "[]"))
      ? safeJsonParse(row.influence_types_json || "[]")
      : [],
    followers_count: Number(row.followers_count || 0),
    influencer_status: normalizeMarketingInfluencerStatus(row.influencer_status || "ativo"),
  };
}

function mapMarketingInfluencerMetricRow(row) {
  if (!row) return null;
  return {
    ...row,
    posts_count: normalizeMarketingMetricCount(row.posts_count),
    reels_count: normalizeMarketingMetricCount(row.reels_count),
    stories_count: normalizeMarketingMetricCount(row.stories_count),
    views_count: normalizeMarketingMetricCount(row.views_count),
    enrollments_count: normalizeMarketingMetricCount(row.enrollments_count),
    performance_score: normalizeMarketingMetricCount(row.performance_score),
    period_type: normalizeMarketingPeriodType(row.period_type || "month"),
    source_type: String(row.source_type || "manual").trim() || "manual",
  };
}

function getMarketingPerformanceLabel(score = 0) {
  const safeScore = Number(score || 0);
  if (safeScore >= 120) return "Excelente";
  if (safeScore >= 80) return "Bom potencial";
  if (safeScore >= 45) return "Acompanhar";
  return "Baixo retorno";
}

async function getDepartmentBySlug(slug = "") {
  const safeSlug = String(slug || "").trim();
  if (!safeSlug) return null;
  const row = await get(
    `SELECT id, slug, name, description, icon, is_active, sort_order, metadata_json, created_at, updated_at
       FROM departments
      WHERE lower(slug)=lower(?)
      LIMIT 1`,
    [safeSlug]
  );
  return mapDepartmentRow(row);
}

async function resolveMarketingScope(user) {
  const department = await getDepartmentBySlug("marketing");
  if (!department?.id) {
    throw new Error("marketing_department_not_found");
  }

  const allowed = userHasDepartmentAccess(user, "marketing");
  if (!allowed) {
    throw new Error("marketing_access_denied");
  }

  return { department, canManage: true };
}

async function resolvePedagogicalScope(user) {
  const department = await getDepartmentBySlug("pedagogico");
  if (!department?.id) {
    throw new Error("pedagogical_department_not_found");
  }

  const allowed = userHasDepartmentAccess(user, "pedagogico");
  if (!allowed) {
    throw new Error("pedagogical_access_denied");
  }

  return { department, canManage: true };
}

function normalizeOperationalUrl(value = "") {
  const safe = String(value || "").trim();
  if (!safe) return null;
  if (/^https?:\/\//i.test(safe)) return safe;
  return `https://${safe}`;
}

function normalizePedagogicalWhatsAppGroupStatus(value = "active") {
  const safe = String(value || "active").trim().toLowerCase();
  return PEDAGOGICAL_WHATSAPP_GROUP_STATUSES.has(safe) ? safe : "active";
}

function normalizePedagogicalWhatsAppCampaignStatus(value = "draft") {
  const safe = String(value || "draft").trim().toLowerCase();
  return PEDAGOGICAL_WHATSAPP_CAMPAIGN_STATUSES.has(safe) ? safe : "draft";
}

function normalizePedagogicalWhatsAppItemStatus(value = "queued") {
  const safe = String(value || "queued").trim().toLowerCase();
  return PEDAGOGICAL_WHATSAPP_ITEM_STATUSES.has(safe) ? safe : "queued";
}

function normalizePedagogicalWhatsAppInterval(value) {
  const safe = Number(value || PEDAGOGICAL_WHATSAPP_DEFAULT_INTERVAL_SECONDS);
  return Math.max(5, Math.min(600, Number.isFinite(safe) ? safe : PEDAGOGICAL_WHATSAPP_DEFAULT_INTERVAL_SECONDS));
}

function getWhatsAppIntegrationStatus() {
  const hasAnyConfig = Boolean(WHATSAPP_PROVIDER_ENABLED || WHATSAPP_PROVIDER_NAME || WHATSAPP_PROVIDER_API_URL || WHATSAPP_PROVIDER_TOKEN);
  const hasCredentials = Boolean(WHATSAPP_PROVIDER_NAME && WHATSAPP_PROVIDER_API_URL && WHATSAPP_PROVIDER_TOKEN);
  const adapterImplemented = false;
  return {
    configured: hasAnyConfig,
    credentials_ready: hasCredentials,
    execution_enabled: false,
    provider_name: WHATSAPP_PROVIDER_NAME || "Não configurado",
    api_url: WHATSAPP_PROVIDER_API_URL || "",
    token_configured: Boolean(WHATSAPP_PROVIDER_TOKEN),
    mode: hasCredentials ? "prepared_only" : "pending_provider",
    status_label: hasCredentials
      ? "Configuração parcial detectada"
      : "Integração final pendente",
    technical_note: hasCredentials
      ? "Existe configuração parcial de provider, mas o projeto ainda não possui adapter implementado para disparo real em grupos."
      : "O módulo opera internamente com grupos, campanhas, fila e histórico. O envio real depende da integração final com o provider de WhatsApp.",
    next_step: adapterImplemented
      ? "Execução real liberada."
      : "Conectar um provider compatível e implementar o adapter de envio por grupo antes de ativar o disparo real.",
  };
}

function mapPedagogicalWhatsAppGroupRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    department_id: row.department_id,
    internal_code: row.internal_code || `GRP-${String(row.id || "").padStart(4, "0")}`,
    name: repairMojibakeText(row.name || ""),
    group_link: row.group_link || "",
    category: repairMojibakeText(row.category || ""),
    status: normalizePedagogicalWhatsAppGroupStatus(row.status || "active"),
    notes: repairMojibakeText(row.notes || ""),
    metadata: repairDeepText(safeJsonParse(row.metadata_json || "{}") || {}),
    created_by: row.created_by || null,
    updated_by: row.updated_by || null,
    created_at: row.created_at || "",
    updated_at: row.updated_at || "",
  };
}

function mapPedagogicalWhatsAppCampaignRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    department_id: row.department_id,
    name: repairMojibakeText(row.name || ""),
    image_url: row.image_url || "",
    message_text: repairMojibakeText(row.message_text || ""),
    campaign_link: row.campaign_link || "",
    interval_seconds: Number(row.interval_seconds || PEDAGOGICAL_WHATSAPP_DEFAULT_INTERVAL_SECONDS),
    status: normalizePedagogicalWhatsAppCampaignStatus(row.status || "draft"),
    execution_mode: row.execution_mode || "prepared",
    integration_status: row.integration_status || "pending_provider",
    scheduled_at: row.scheduled_at || "",
    started_at: row.started_at || "",
    finished_at: row.finished_at || "",
    total_groups: Number(row.total_groups || 0),
    total_sent: Number(row.total_sent || 0),
    total_pending: Number(row.total_pending || 0),
    total_error: Number(row.total_error || 0),
    last_error: repairMojibakeText(row.last_error || ""),
    metadata: repairDeepText(safeJsonParse(row.metadata_json || "{}") || {}),
    created_by: row.created_by || null,
    updated_by: row.updated_by || null,
    created_at: row.created_at || "",
    updated_at: row.updated_at || "",
  };
}

function mapPedagogicalWhatsAppCampaignItemRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    campaign_id: row.campaign_id,
    group_id: row.group_id,
    queue_order: Number(row.queue_order || 0),
    send_status: normalizePedagogicalWhatsAppItemStatus(row.send_status || "queued"),
    provider_message_id: row.provider_message_id || "",
    error_message: repairMojibakeText(row.error_message || ""),
    last_attempt_at: row.last_attempt_at || "",
    sent_at: row.sent_at || "",
    attempt_count: Number(row.attempt_count || 0),
    metadata: repairDeepText(safeJsonParse(row.metadata_json || "{}") || {}),
    group_name: repairMojibakeText(row.group_name || ""),
    group_status: normalizePedagogicalWhatsAppGroupStatus(row.group_status || "active"),
    created_at: row.created_at || "",
    updated_at: row.updated_at || "",
  };
}

function mapPedagogicalWhatsAppCampaignLogRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    campaign_id: row.campaign_id || null,
    campaign_item_id: row.campaign_item_id || null,
    group_id: row.group_id || null,
    action: row.action || "",
    detail: repairDeepText(safeJsonParse(row.detail_json || "{}") || {}),
    actor_user_id: row.actor_user_id || null,
    actor_name: repairMojibakeText(row.actor_name || ""),
    created_at: row.created_at || "",
  };
}

async function ensurePedagogicalWhatsAppSettings(actorUserId = null) {
  const defaults = [
    { key: "default_interval_seconds", value: String(PEDAGOGICAL_WHATSAPP_DEFAULT_INTERVAL_SECONDS) },
    { key: "execution_mode", value: "prepared_only" },
  ];
  for (const item of defaults) {
    const existing = await get(
      "SELECT id FROM pedagogical_whatsapp_settings WHERE setting_key=? LIMIT 1",
      [item.key]
    );
    if (existing?.id) continue;
    await run(
      "INSERT INTO pedagogical_whatsapp_settings (setting_key, setting_value, metadata_json, updated_by, updated_at) VALUES (?, ?, ?, ?, datetime('now'))",
      [item.key, item.value, safeJsonStringify({ seeded: true }, "{}"), actorUserId || null]
    );
  }
}

async function listPedagogicalWhatsAppGroupsRows(departmentId, options = {}) {
  const params = [departmentId];
  const where = ["department_id=?"];
  const search = String(options.search || "").trim();
  const status = String(options.status || "").trim();
  const limit = Math.min(600, Math.max(1, Number(options.limit || 400)));
  if (search) {
    where.push("(lower(name) LIKE lower(?) OR lower(category) LIKE lower(?) OR lower(group_link) LIKE lower(?))");
    params.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }
  if (status) {
    where.push("lower(status)=lower(?)");
    params.push(normalizePedagogicalWhatsAppGroupStatus(status));
  }
  params.push(limit);
  const rows = await all(
    `SELECT id, department_id, internal_code, name, group_link, category, status, notes, metadata_json,
            created_by, updated_by, created_at, updated_at
       FROM pedagogical_whatsapp_groups
      WHERE ${where.join(" AND ")}
      ORDER BY lower(name) ASC, id DESC
      LIMIT ?`,
    params
  );
  return rows.map(mapPedagogicalWhatsAppGroupRow).filter(Boolean);
}

async function listPedagogicalWhatsAppCampaignRows(departmentId, options = {}) {
  const limit = Math.min(120, Math.max(1, Number(options.limit || 40)));
  const rows = await all(
    `SELECT id, department_id, name, image_url, message_text, campaign_link, interval_seconds, status, execution_mode,
            integration_status, scheduled_at, started_at, finished_at, total_groups, total_sent, total_pending,
            total_error, last_error, metadata_json, created_by, updated_by, created_at, updated_at
       FROM pedagogical_whatsapp_campaigns
      WHERE department_id=?
      ORDER BY datetime(created_at) DESC, id DESC
      LIMIT ?`,
    [departmentId, limit]
  );
  return rows.map(mapPedagogicalWhatsAppCampaignRow).filter(Boolean);
}

async function listPedagogicalWhatsAppCampaignItems(campaignIds = [], options = {}) {
  const ids = (campaignIds || []).map((item) => Number(item || 0)).filter(Boolean);
  if (!ids.length) return [];
  const limit = Math.min(800, Math.max(1, Number(options.limit || 400)));
  const rows = await all(
    `SELECT pci.id, pci.campaign_id, pci.group_id, pci.queue_order, pci.send_status, pci.provider_message_id,
            pci.error_message, pci.last_attempt_at, pci.sent_at, pci.attempt_count, pci.metadata_json,
            pci.created_at, pci.updated_at, pg.name AS group_name, pg.status AS group_status
       FROM pedagogical_whatsapp_campaign_items pci
  LEFT JOIN pedagogical_whatsapp_groups pg ON pg.id = pci.group_id
      WHERE pci.campaign_id IN (${ids.map(() => "?").join(", ")})
      ORDER BY pci.campaign_id DESC, pci.queue_order ASC, pci.id ASC
      LIMIT ?`,
    [...ids, limit]
  );
  return rows.map(mapPedagogicalWhatsAppCampaignItemRow).filter(Boolean);
}

async function listPedagogicalWhatsAppCampaignLogs(campaignIds = [], options = {}) {
  const ids = (campaignIds || []).map((item) => Number(item || 0)).filter(Boolean);
  if (!ids.length) return [];
  const limit = Math.min(240, Math.max(1, Number(options.limit || 80)));
  const rows = await all(
    `SELECT pcl.id, pcl.campaign_id, pcl.campaign_item_id, pcl.group_id, pcl.action, pcl.detail_json,
            pcl.actor_user_id, pcl.created_at, u.name AS actor_name
       FROM pedagogical_whatsapp_campaign_logs pcl
  LEFT JOIN users u ON u.id = pcl.actor_user_id
      WHERE pcl.campaign_id IN (${ids.map(() => "?").join(", ")})
      ORDER BY datetime(pcl.created_at) DESC, pcl.id DESC
      LIMIT ?`,
    [...ids, limit]
  );
  return rows.map(mapPedagogicalWhatsAppCampaignLogRow).filter(Boolean);
}

async function logPedagogicalWhatsAppCampaignAction({
  campaignId = null,
  campaignItemId = null,
  groupId = null,
  action = "",
  actorUserId = null,
  detail = {},
}) {
  await run(
    `INSERT INTO pedagogical_whatsapp_campaign_logs
       (campaign_id, campaign_item_id, group_id, action, detail_json, actor_user_id)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      campaignId || null,
      campaignItemId || null,
      groupId || null,
      String(action || "").trim() || "updated",
      detail && Object.keys(detail).length ? safeJsonStringify(detail, "{}") : null,
      actorUserId || null,
    ]
  );
}

async function savePedagogicalWhatsAppGroup(payload = {}, actorUser) {
  const scope = await resolvePedagogicalScope(actorUser);
  const actorId = Number(actorUser?.id || actorUser?.sub || 0) || null;
  const groupId = Number(payload.id || 0) || null;
  const name = String(payload.name || "").trim();
  const groupLink = normalizeOperationalUrl(payload.group_link || "");
  const category = String(payload.category || "").trim() || null;
  const status = normalizePedagogicalWhatsAppGroupStatus(payload.status || "active");
  const notes = String(payload.notes || "").trim() || null;
  const internalCode = String(payload.internal_code || "").trim() || null;

  if (!name) throw new Error("missing_whatsapp_group_name");

  if (groupId) {
    await run(
      `UPDATE pedagogical_whatsapp_groups
          SET internal_code=?, name=?, group_link=?, category=?, status=?, notes=?, updated_by=?, updated_at=datetime('now')
        WHERE id=? AND department_id=?`,
      [internalCode, name, groupLink, category, status, notes, actorId, groupId, scope.department.id]
    );
    await logPedagogicalWhatsAppCampaignAction({
      groupId,
      action: "group_updated",
      actorUserId: actorId,
      detail: { name, status },
    });
  } else {
    const created = await run(
      `INSERT INTO pedagogical_whatsapp_groups
         (department_id, internal_code, name, group_link, category, status, notes, created_by, updated_by, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
      [scope.department.id, internalCode, name, groupLink, category, status, notes, actorId, actorId]
    );
    await logPedagogicalWhatsAppCampaignAction({
      groupId: created.lastID,
      action: "group_created",
      actorUserId: actorId,
      detail: { name, status },
    });
    return get(
      `SELECT id, department_id, internal_code, name, group_link, category, status, notes, metadata_json,
              created_by, updated_by, created_at, updated_at
         FROM pedagogical_whatsapp_groups
        WHERE id=?`,
      [created.lastID]
    ).then(mapPedagogicalWhatsAppGroupRow);
  }

  return get(
    `SELECT id, department_id, internal_code, name, group_link, category, status, notes, metadata_json,
            created_by, updated_by, created_at, updated_at
       FROM pedagogical_whatsapp_groups
      WHERE id=?`,
    [groupId]
  ).then(mapPedagogicalWhatsAppGroupRow);
}

async function savePedagogicalWhatsAppCampaign(payload = {}, actorUser) {
  const scope = await resolvePedagogicalScope(actorUser);
  const actorId = Number(actorUser?.id || actorUser?.sub || 0) || null;
  const campaignId = Number(payload.id || 0) || null;
  const name = String(payload.name || "").trim();
  const imageUrl = normalizeOperationalUrl(payload.image_url || "");
  const messageText = String(payload.message_text || payload.text || "").trim();
  const campaignLink = normalizeOperationalUrl(payload.campaign_link || payload.link || "");
  const intervalSeconds = normalizePedagogicalWhatsAppInterval(payload.interval_seconds || PEDAGOGICAL_WHATSAPP_DEFAULT_INTERVAL_SECONDS);
  const selectedGroupIds = [...new Set((Array.isArray(payload.group_ids) ? payload.group_ids : [])
    .map((item) => Number(item || 0))
    .filter(Boolean))];
  const metadata = {
    selected_group_ids: selectedGroupIds,
    image_mode: imageUrl ? "url" : "none",
    notes: String(payload.notes || "").trim() || "",
  };

  if (!name) throw new Error("missing_whatsapp_campaign_name");
  if (!messageText) throw new Error("missing_whatsapp_campaign_text");

  if (campaignId) {
    await run(
      `UPDATE pedagogical_whatsapp_campaigns
          SET name=?, image_url=?, message_text=?, campaign_link=?, interval_seconds=?, metadata_json=?,
              updated_by=?, updated_at=datetime('now')
        WHERE id=? AND department_id=?`,
      [
        name,
        imageUrl,
        messageText,
        campaignLink,
        intervalSeconds,
        safeJsonStringify(metadata, "{}"),
        actorId,
        campaignId,
        scope.department.id,
      ]
    );
    await logPedagogicalWhatsAppCampaignAction({
      campaignId,
      action: "campaign_updated",
      actorUserId: actorId,
      detail: { groups_total: selectedGroupIds.length },
    });
  } else {
    const created = await run(
      `INSERT INTO pedagogical_whatsapp_campaigns
         (department_id, name, image_url, message_text, campaign_link, interval_seconds, status, execution_mode,
          integration_status, total_groups, total_pending, metadata_json, created_by, updated_by, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'draft', 'prepared', 'pending_provider', ?, ?, ?, ?, ?, datetime('now'))`,
      [
        scope.department.id,
        name,
        imageUrl,
        messageText,
        campaignLink,
        intervalSeconds,
        selectedGroupIds.length,
        selectedGroupIds.length,
        safeJsonStringify(metadata, "{}"),
        actorId,
        actorId,
      ]
    );
    await logPedagogicalWhatsAppCampaignAction({
      campaignId: created.lastID,
      action: "campaign_created",
      actorUserId: actorId,
      detail: { groups_total: selectedGroupIds.length },
    });
    return get(
      `SELECT id, department_id, name, image_url, message_text, campaign_link, interval_seconds, status, execution_mode,
              integration_status, scheduled_at, started_at, finished_at, total_groups, total_sent, total_pending,
              total_error, last_error, metadata_json, created_by, updated_by, created_at, updated_at
         FROM pedagogical_whatsapp_campaigns
        WHERE id=?`,
      [created.lastID]
    ).then(mapPedagogicalWhatsAppCampaignRow);
  }

  return get(
    `SELECT id, department_id, name, image_url, message_text, campaign_link, interval_seconds, status, execution_mode,
            integration_status, scheduled_at, started_at, finished_at, total_groups, total_sent, total_pending,
            total_error, last_error, metadata_json, created_by, updated_by, created_at, updated_at
       FROM pedagogical_whatsapp_campaigns
      WHERE id=?`,
    [campaignId]
  ).then(mapPedagogicalWhatsAppCampaignRow);
}

async function startPedagogicalWhatsAppCampaign(campaignId, actorUser) {
  const scope = await resolvePedagogicalScope(actorUser);
  const actorId = Number(actorUser?.id || actorUser?.sub || 0) || null;
  const campaign = await get(
    `SELECT id, department_id, name, image_url, message_text, campaign_link, interval_seconds, status, execution_mode,
            integration_status, scheduled_at, started_at, finished_at, total_groups, total_sent, total_pending,
            total_error, last_error, metadata_json, created_by, updated_by, created_at, updated_at
       FROM pedagogical_whatsapp_campaigns
      WHERE id=? AND department_id=?`,
    [Number(campaignId || 0), scope.department.id]
  ).then(mapPedagogicalWhatsAppCampaignRow);
  if (!campaign) throw new Error("whatsapp_campaign_not_found");

  const selectedGroupIds = [...new Set((campaign.metadata?.selected_group_ids || [])
    .map((item) => Number(item || 0))
    .filter(Boolean))];
  if (!selectedGroupIds.length) throw new Error("whatsapp_campaign_without_groups");

  const groups = await listPedagogicalWhatsAppGroupsRows(scope.department.id, { limit: 600 });
  const validGroups = groups.filter((group) => selectedGroupIds.includes(Number(group.id || 0)));
  if (!validGroups.length) throw new Error("whatsapp_campaign_without_valid_groups");

  await run("DELETE FROM pedagogical_whatsapp_campaign_items WHERE campaign_id=?", [campaign.id]);
  const integration = getWhatsAppIntegrationStatus();
  const itemStatus = integration.execution_enabled ? "queued" : "pending_provider";

  for (let index = 0; index < validGroups.length; index += 1) {
    const group = validGroups[index];
    const created = await run(
      `INSERT INTO pedagogical_whatsapp_campaign_items
         (campaign_id, group_id, queue_order, send_status, metadata_json, updated_at)
       VALUES (?, ?, ?, ?, ?, datetime('now'))`,
      [
        campaign.id,
        group.id,
        index + 1,
        itemStatus,
        safeJsonStringify({
          group_name: group.name,
          interval_seconds: campaign.interval_seconds || PEDAGOGICAL_WHATSAPP_DEFAULT_INTERVAL_SECONDS,
          provider_mode: integration.mode,
        }, "{}"),
      ]
    );
    await logPedagogicalWhatsAppCampaignAction({
      campaignId: campaign.id,
      campaignItemId: created.lastID,
      groupId: group.id,
      action: integration.execution_enabled ? "queue_item_created" : "queue_item_pending_provider",
      actorUserId: actorId,
      detail: {
        group_name: group.name,
        send_status: itemStatus,
      },
    });
  }

  const totalGroups = validGroups.length;
  const totalPending = itemStatus === "queued" || itemStatus === "pending_provider" ? totalGroups : 0;
  await run(
    `UPDATE pedagogical_whatsapp_campaigns
        SET status=?, execution_mode=?, integration_status=?, total_groups=?, total_sent=0, total_pending=?,
            total_error=0, last_error=?, started_at=datetime('now'), updated_by=?, updated_at=datetime('now')
      WHERE id=?`,
    [
      integration.execution_enabled ? "running" : "prepared",
      integration.execution_enabled ? "provider" : "prepared",
      integration.mode,
      totalGroups,
      totalPending,
      integration.execution_enabled ? null : integration.technical_note,
      actorId,
      campaign.id,
    ]
  );
  await logPedagogicalWhatsAppCampaignAction({
    campaignId: campaign.id,
    action: integration.execution_enabled ? "campaign_started" : "campaign_prepared",
    actorUserId: actorId,
    detail: {
      groups_total: totalGroups,
      integration_mode: integration.mode,
      execution_enabled: integration.execution_enabled,
    },
  });

  return get(
    `SELECT id, department_id, name, image_url, message_text, campaign_link, interval_seconds, status, execution_mode,
            integration_status, scheduled_at, started_at, finished_at, total_groups, total_sent, total_pending,
            total_error, last_error, metadata_json, created_by, updated_by, created_at, updated_at
       FROM pedagogical_whatsapp_campaigns
      WHERE id=?`,
    [campaign.id]
  ).then(mapPedagogicalWhatsAppCampaignRow);
}

async function buildPedagogicalWhatsAppBootstrap(user) {
  const scope = await resolvePedagogicalScope(user);
  await ensurePedagogicalWhatsAppSettings(user?.id || user?.sub || null);
  const integration = getWhatsAppIntegrationStatus();
  const [groups, campaigns, settingsRows] = await Promise.all([
    listPedagogicalWhatsAppGroupsRows(scope.department.id, { limit: 500 }),
    listPedagogicalWhatsAppCampaignRows(scope.department.id, { limit: 36 }),
    all(
      `SELECT id, setting_key, setting_value, metadata_json, updated_by, created_at, updated_at
         FROM pedagogical_whatsapp_settings
        ORDER BY setting_key ASC`
    ),
  ]);

  const campaignItems = await listPedagogicalWhatsAppCampaignItems(campaigns.map((item) => item.id), { limit: 600 });
  const campaignLogs = await listPedagogicalWhatsAppCampaignLogs(campaigns.map((item) => item.id), { limit: 120 });
  const itemsByCampaignId = new Map();
  campaignItems.forEach((item) => {
    const key = Number(item.campaign_id || 0);
    if (!itemsByCampaignId.has(key)) itemsByCampaignId.set(key, []);
    itemsByCampaignId.get(key).push(item);
  });

  const campaignsWithItems = campaigns.map((campaign) => ({
    ...campaign,
    items: itemsByCampaignId.get(Number(campaign.id || 0)) || [],
    selected_group_ids: campaign.metadata?.selected_group_ids || [],
  }));
  const queueItems = campaignItems.filter((item) => ["queued", "sending", "pending_provider", "error"].includes(item.send_status));
  const sentTotal = campaignItems.filter((item) => item.send_status === "sent").length;
  const successRate = campaignItems.length ? Number(((sentTotal / campaignItems.length) * 100).toFixed(1)) : 0;
  const lastCampaign = campaignsWithItems[0] || null;

  return {
    enabled: true,
    department: {
      id: scope.department.id,
      slug: scope.department.slug,
      name: scope.department.name,
    },
    integration,
    settings: (settingsRows || []).map((row) => ({
      id: row.id,
      key: row.setting_key,
      value: row.setting_value,
      metadata: repairDeepText(safeJsonParse(row.metadata_json || "{}") || {}),
      updated_by: row.updated_by || null,
      created_at: row.created_at || "",
      updated_at: row.updated_at || "",
    })),
    summary: {
      groups_total: groups.length,
      groups_active: groups.filter((group) => group.status === "active").length,
      campaigns_total: campaignsWithItems.length,
      campaigns_completed: campaignsWithItems.filter((campaign) => campaign.status === "completed").length,
      campaigns_error: campaignsWithItems.filter((campaign) => campaign.status === "error").length,
      queue_total: queueItems.length,
      success_rate: successRate,
      last_campaign_name: lastCampaign?.name || "",
      last_campaign_at: lastCampaign?.started_at || lastCampaign?.created_at || "",
    },
    dashboard: {
      cards: [
        { label: "Grupos cadastrados", value: String(groups.length) },
        { label: "Grupos ativos", value: String(groups.filter((group) => group.status === "active").length) },
        { label: "Campanhas criadas", value: String(campaignsWithItems.length) },
        { label: "Fila atual", value: String(queueItems.length) },
      ],
    },
    groups,
    campaigns: campaignsWithItems,
    queue: {
      items: queueItems.slice(0, 120),
      pending_total: queueItems.filter((item) => ["queued", "pending_provider"].includes(item.send_status)).length,
      sending_total: queueItems.filter((item) => item.send_status === "sending").length,
      sent_total: sentTotal,
      error_total: campaignItems.filter((item) => item.send_status === "error").length,
    },
    history: campaignLogs,
  };
}

async function getPedagogicalWhatsAppCampaignRowById(campaignId, departmentId) {
  return get(
    `SELECT id, department_id, name, image_url, message_text, campaign_link, interval_seconds, status, execution_mode,
            integration_status, scheduled_at, started_at, finished_at, total_groups, total_sent, total_pending,
            total_error, last_error, metadata_json, created_by, updated_by, created_at, updated_at
       FROM pedagogical_whatsapp_campaigns
      WHERE id=? AND department_id=?`,
    [Number(campaignId || 0), Number(departmentId || 0)]
  ).then(mapPedagogicalWhatsAppCampaignRow);
}

async function listMarketingInfluencersRows(departmentId, options = {}) {
  const params = [departmentId];
  const where = ["department_id=?"];
  const search = String(options.search || "").trim();
  const status = String(options.status || "").trim();
  const limit = Math.min(400, Math.max(1, Number(options.limit || 200)));

  if (search) {
    where.push("(lower(name) LIKE lower(?) OR lower(contract_type) LIKE lower(?) OR lower(instagram_url) LIKE lower(?))");
    params.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }
  if (status) {
    where.push("lower(influencer_status)=lower(?)");
    params.push(normalizeMarketingInfluencerStatus(status));
  }

  params.push(limit);
  const rows = await all(
    `SELECT mi.id, mi.department_id, mi.name, mi.influence_types_json, mi.contract_type, mi.photo_url, mi.instagram_url,
            mi.followers_count, mi.partnership_start_date, mi.influencer_status, mi.notes, mi.created_by, mi.updated_by,
            mi.created_at, mi.updated_at,
            uc.name AS created_by_name, uu.name AS updated_by_name
       FROM marketing_influencers mi
  LEFT JOIN users uc ON uc.id = mi.created_by
  LEFT JOIN users uu ON uu.id = mi.updated_by
      WHERE ${where.join(" AND ")}
      ORDER BY lower(mi.name) ASC, mi.id DESC
      LIMIT ?`,
    params
  );
  return rows.map(mapMarketingInfluencerRow).filter(Boolean);
}

async function getMarketingInfluencerRow(influencerId) {
  const row = await get(
    `SELECT mi.id, mi.department_id, mi.name, mi.influence_types_json, mi.contract_type, mi.photo_url, mi.instagram_url,
            mi.followers_count, mi.partnership_start_date, mi.influencer_status, mi.notes, mi.created_by, mi.updated_by,
            mi.created_at, mi.updated_at,
            uc.name AS created_by_name, uu.name AS updated_by_name
       FROM marketing_influencers mi
  LEFT JOIN users uc ON uc.id = mi.created_by
  LEFT JOIN users uu ON uu.id = mi.updated_by
      WHERE mi.id=?
      LIMIT 1`,
    [influencerId]
  );
  return mapMarketingInfluencerRow(row);
}

async function listMarketingMetricsForInfluencers(influencerIds = [], range = {}) {
  const safeIds = Array.isArray(influencerIds)
    ? influencerIds.map((value) => Number(value || 0)).filter(Boolean)
    : [];
  if (!safeIds.length) return [];

  const from = normalizeDateKeyInput(range.from || "");
  const to = normalizeDateKeyInput(range.to || "");
  const params = [...safeIds];
  const where = [`mim.influencer_id IN (${safeIds.map(() => "?").join(", ")})`];

  if (from) {
    where.push("COALESCE(mim.period_end, mim.period_start) >= ?");
    params.push(from);
  }
  if (to) {
    where.push("mim.period_start <= ?");
    params.push(to);
  }

  const rows = await all(
    `SELECT mim.id, mim.influencer_id, mim.period_type, mim.period_start, mim.period_end, mim.posts_count, mim.reels_count,
            mim.stories_count, mim.views_count, mim.enrollments_count, mim.performance_score, mim.notes, mim.source_type,
            mim.created_by, mim.updated_by, mim.created_at, mim.updated_at,
            uc.name AS created_by_name, uu.name AS updated_by_name
       FROM marketing_influencer_metrics mim
  LEFT JOIN users uc ON uc.id = mim.created_by
  LEFT JOIN users uu ON uu.id = mim.updated_by
      WHERE ${where.join(" AND ")}
      ORDER BY mim.period_start DESC, mim.id DESC`,
    params
  );
  return rows.map(mapMarketingInfluencerMetricRow).filter(Boolean);
}

async function getMarketingEntityHistory(entityType, entityId) {
  const rows = await all(
    `SELECT l.id, l.entity_type, l.entity_id, l.action, l.field_name, l.old_value, l.new_value, l.origin, l.detail_json, l.created_at,
            l.actor_user_id, u.name AS actor_name
       FROM entity_change_log l
  LEFT JOIN users u ON u.id = l.actor_user_id
      WHERE l.entity_type=? AND l.entity_id=?
      ORDER BY datetime(l.created_at) DESC, l.id DESC`,
    [entityType, entityId]
  );
  return rows.map((row) => ({ ...row, detail: safeJsonParse(row.detail_json || "{}") || null }));
}

function summarizeMarketingMetrics(metrics = []) {
  const safeMetrics = Array.isArray(metrics) ? metrics : [];
  const dayLabels = new Set();
  const monthlyTotals = new Map();
  let posts = 0;
  let reels = 0;
  let stories = 0;
  let views = 0;
  let enrollments = 0;
  let performanceTotal = 0;

  safeMetrics.forEach((metric) => {
    posts += normalizeMarketingMetricCount(metric.posts_count);
    reels += normalizeMarketingMetricCount(metric.reels_count);
    stories += normalizeMarketingMetricCount(metric.stories_count);
    views += normalizeMarketingMetricCount(metric.views_count);
    enrollments += normalizeMarketingMetricCount(metric.enrollments_count);
    performanceTotal += normalizeMarketingMetricCount(metric.performance_score);

    const start = normalizeDateKeyInput(metric.period_start || "");
    const end = normalizeDateKeyInput(metric.period_end || metric.period_start || "");
    if (start) dayLabels.add(start);
    if (end && end !== start) dayLabels.add(end);

    const monthKey = String(start || end || "").slice(0, 7);
    if (monthKey) {
      if (!monthlyTotals.has(monthKey)) {
        monthlyTotals.set(monthKey, {
          period_key: monthKey,
          label: formatDateBrazil(`${monthKey}-01T12:00:00-03:00`),
          posts_count: 0,
          reels_count: 0,
          stories_count: 0,
          views_count: 0,
          enrollments_count: 0,
          performance_score: 0,
        });
      }
      const bucket = monthlyTotals.get(monthKey);
      bucket.posts_count += normalizeMarketingMetricCount(metric.posts_count);
      bucket.reels_count += normalizeMarketingMetricCount(metric.reels_count);
      bucket.stories_count += normalizeMarketingMetricCount(metric.stories_count);
      bucket.views_count += normalizeMarketingMetricCount(metric.views_count);
      bucket.enrollments_count += normalizeMarketingMetricCount(metric.enrollments_count);
      bucket.performance_score += normalizeMarketingMetricCount(metric.performance_score);
    }
  });

  const launchesTotal = safeMetrics.length;
  const averageScore = launchesTotal ? Math.round(performanceTotal / launchesTotal) : 0;

  return {
    launches_total: launchesTotal,
    posts_count: posts,
    reels_count: reels,
    stories_count: stories,
    views_count: views,
    enrollments_count: enrollments,
    performance_score_total: performanceTotal,
    performance_score: averageScore,
    performance_label: getMarketingPerformanceLabel(averageScore),
    reported_days_total: dayLabels.size,
    reported_days: Array.from(dayLabels).sort((left, right) => left.localeCompare(right, "pt-BR")),
    monthly_evolution: Array.from(monthlyTotals.values()).sort((left, right) => left.period_key.localeCompare(right.period_key, "pt-BR")),
  };
}

function buildMarketingInfluencerCards(influencers = [], metrics = []) {
  const metricsByInfluencer = new Map();
  for (const metric of metrics) {
    const key = Number(metric.influencer_id || 0);
    if (!metricsByInfluencer.has(key)) metricsByInfluencer.set(key, []);
    metricsByInfluencer.get(key).push(metric);
  }

  return influencers.map((influencer) => {
    const summary = summarizeMarketingMetrics(metricsByInfluencer.get(Number(influencer.id || 0)) || []);
    return {
      ...influencer,
      metrics_summary: summary,
      last_period_label: summary.monthly_evolution.at(-1)?.label || "",
    };
  });
}

function buildMarketingComparisonPayload(influencerCards = []) {
  const items = (Array.isArray(influencerCards) ? influencerCards : []).map((item) => ({
    id: item.id,
    name: item.name,
    influencer_status: item.influencer_status || "ativo",
    followers_count: Number(item.followers_count || 0),
    posts_count: Number(item.metrics_summary?.posts_count || 0),
    reels_count: Number(item.metrics_summary?.reels_count || 0),
    stories_count: Number(item.metrics_summary?.stories_count || 0),
    views_count: Number(item.metrics_summary?.views_count || 0),
    enrollments_count: Number(item.metrics_summary?.enrollments_count || 0),
    performance_score: Number(item.metrics_summary?.performance_score || 0),
  }));

  const maxima = {
    followers_count: Math.max(...items.map((item) => item.followers_count), 1),
    posts_count: Math.max(...items.map((item) => item.posts_count), 1),
    reels_count: Math.max(...items.map((item) => item.reels_count), 1),
    stories_count: Math.max(...items.map((item) => item.stories_count), 1),
    views_count: Math.max(...items.map((item) => item.views_count), 1),
    enrollments_count: Math.max(...items.map((item) => item.enrollments_count), 1),
    performance_score: Math.max(...items.map((item) => item.performance_score), 1),
  };

  const monthlyBuckets = new Map();
  influencerCards.forEach((influencer) => {
    const series = influencer.metrics_summary?.monthly_evolution || [];
    series.forEach((entry) => {
      if (!monthlyBuckets.has(entry.period_key)) {
        monthlyBuckets.set(entry.period_key, {
          period_key: entry.period_key,
          label: entry.label,
          influencers: [],
        });
      }
      monthlyBuckets.get(entry.period_key).influencers.push({
        influencer_id: influencer.id,
        name: influencer.name,
        enrollments_count: Number(entry.enrollments_count || 0),
        posts_count: Number(entry.posts_count || 0),
        reels_count: Number(entry.reels_count || 0),
        stories_count: Number(entry.stories_count || 0),
        views_count: Number(entry.views_count || 0),
        performance_score: Number(entry.performance_score || 0),
      });
    });
  });

  return {
    items,
    maxima,
    monthly_evolution: Array.from(monthlyBuckets.values())
      .sort((left, right) => left.period_key.localeCompare(right.period_key, "pt-BR"))
      .slice(-6),
  };
}

async function buildMarketingInfluencerBootstrap(user, query = {}) {
  const scope = await resolveMarketingScope(user);
  const period = buildMarketingPeriodRange(query);
  const influencers = await listMarketingInfluencersRows(scope.department.id, {
    search: query.search,
    status: query.status,
    limit: query.limit,
  });
  const metrics = await listMarketingMetricsForInfluencers(influencers.map((item) => item.id), period);
  const cards = buildMarketingInfluencerCards(influencers, metrics);
  const comparison = buildMarketingComparisonPayload(cards);
  const totalFollowers = cards.reduce((acc, item) => acc + Number(item.followers_count || 0), 0);
  const totalEnrollments = cards.reduce((acc, item) => acc + Number(item.metrics_summary?.enrollments_count || 0), 0);
  const totalViews = cards.reduce((acc, item) => acc + Number(item.metrics_summary?.views_count || 0), 0);
  const totalLaunches = cards.reduce((acc, item) => acc + Number(item.metrics_summary?.launches_total || 0), 0);

  return {
    enabled: true,
    department: {
      id: scope.department.id,
      name: scope.department.name,
      slug: scope.department.slug,
    },
    period,
    suggestions: {
      influence_types: MARKETING_INFLUENCE_TYPE_SUGGESTIONS,
      contract_types: MARKETING_CONTRACT_TYPE_SUGGESTIONS,
      statuses: Array.from(MARKETING_INFLUENCER_STATUSES),
    },
    summary: {
      total_influencers: cards.length,
      active_influencers: cards.filter((item) => item.influencer_status === "ativo").length,
      followers_total: totalFollowers,
      launches_total: totalLaunches,
      views_total: totalViews,
      enrollments_total: totalEnrollments,
    },
    influencers: cards,
    comparison,
  };
}

async function buildMarketingInfluencerDetail(user, influencerId, query = {}) {
  await resolveMarketingScope(user);
  const influencer = await getMarketingInfluencerRow(influencerId);
  if (!influencer) throw new Error("not_found");
  if (!userHasDepartmentAccess(user, "marketing")) throw new Error("marketing_access_denied");

  const period = buildMarketingPeriodRange(query);
  const metrics = await listMarketingMetricsForInfluencers([influencer.id], period);
  const summary = summarizeMarketingMetrics(metrics);
  const history = await getMarketingEntityHistory("marketing_influencer", influencer.id);

  return {
    influencer,
    period,
    summary,
    metric_history: metrics.map((metric) => ({
      ...metric,
      period_label: metric.period_start === metric.period_end
        ? formatDateBrazil(`${metric.period_start}T12:00:00-03:00`)
        : `${formatDateBrazil(`${metric.period_start}T12:00:00-03:00`)} - ${formatDateBrazil(`${metric.period_end}T12:00:00-03:00`)}`,
    })),
    history,
  };
}

async function saveMarketingInfluencer(payload = {}, actorUser) {
  const scope = await resolveMarketingScope(actorUser);
  const influencerId = Number(payload.id || 0);
  const actorId = Number(actorUser?.id || actorUser?.sub || 0);
  const name = String(payload.name || "").trim();
  const influenceTypes = normalizeMarketingInfluenceTypes(payload.influence_types || payload.influence_types_json || []);
  const contractType = String(payload.contract_type || "").trim();
  const photoUrl = String(payload.photo_url || "").trim() || null;
  const instagramUrl = normalizeInstagramUrl(payload.instagram_url || "");
  const followersCount = normalizeMarketingFollowersCount(payload.followers_count);
  const partnershipStartDate = normalizeDateKeyInput(payload.partnership_start_date || "");
  const influencerStatus = normalizeMarketingInfluencerStatus(payload.influencer_status || "ativo");
  const notes = String(payload.notes || "").trim() || null;

  if (!name) throw new Error("missing_influencer_name");

  const conflict = await get(
    `SELECT id
       FROM marketing_influencers
      WHERE department_id=?
        AND lower(name)=lower(?)
        AND id<>?
      LIMIT 1`,
    [scope.department.id, name, influencerId || 0]
  );
  if (conflict) throw new Error("marketing_influencer_name_conflict");

  if (influencerId) {
    await run(
      `UPDATE marketing_influencers
          SET name=?, influence_types_json=?, contract_type=?, photo_url=?, instagram_url=?, followers_count=?,
              partnership_start_date=?, influencer_status=?, notes=?, updated_by=?, updated_at=datetime('now')
        WHERE id=?`,
      [
        name,
        safeJsonStringify(influenceTypes, "[]"),
        contractType || null,
        photoUrl,
        instagramUrl,
        followersCount,
        partnershipStartDate || null,
        influencerStatus,
        notes,
        actorId || null,
        influencerId,
      ]
    );

    await logEntityChange({
      entityType: "marketing_influencer",
      entityId: influencerId,
      action: "updated",
      actorUserId: actorId || null,
      origin: "manual_edit",
      detail: { source: "marketing_workspace", name, influencer_status: influencerStatus },
    });
  } else {
    const created = await run(
      `INSERT INTO marketing_influencers
         (department_id, name, influence_types_json, contract_type, photo_url, instagram_url, followers_count,
          partnership_start_date, influencer_status, notes, created_by, updated_by, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
      [
        scope.department.id,
        name,
        safeJsonStringify(influenceTypes, "[]"),
        contractType || null,
        photoUrl,
        instagramUrl,
        followersCount,
        partnershipStartDate || null,
        influencerStatus,
        notes,
        actorId || null,
        actorId || null,
      ]
    );

    await logEntityChange({
      entityType: "marketing_influencer",
      entityId: created.lastID,
      action: "created",
      actorUserId: actorId || null,
      origin: "manual_create",
      detail: { source: "marketing_workspace", name, influencer_status: influencerStatus },
    });

    return getMarketingInfluencerRow(created.lastID);
  }

  return getMarketingInfluencerRow(influencerId);
}

async function createMarketingInfluencerMetric(influencerId, payload = {}, actorUser) {
  await resolveMarketingScope(actorUser);
  const actorId = Number(actorUser?.id || actorUser?.sub || 0);
  const influencer = await getMarketingInfluencerRow(influencerId);
  if (!influencer) throw new Error("not_found");

  const periodType = normalizeMarketingPeriodType(payload.period_type || "month");
  const periodStart = normalizeDateKeyInput(payload.period_start || payload.date || "");
  const periodEnd = normalizeDateKeyInput(payload.period_end || payload.period_start || payload.date || "");
  const postsCount = normalizeMarketingMetricCount(payload.posts_count);
  const reelsCount = normalizeMarketingMetricCount(payload.reels_count);
  const storiesCount = normalizeMarketingMetricCount(payload.stories_count);
  const viewsCount = normalizeMarketingMetricCount(payload.views_count);
  const enrollmentsCount = normalizeMarketingMetricCount(payload.enrollments_count);
  const notes = String(payload.notes || "").trim() || null;
  const sourceType = String(payload.source_type || "manual").trim() || "manual";

  if (!periodStart) throw new Error("missing_metric_period_start");
  const safePeriodEnd = periodEnd || periodStart;
  if (safePeriodEnd < periodStart) throw new Error("metric_period_invalid");

  const performanceScore = calculateMarketingPerformanceScore({
    posts_count: postsCount,
    reels_count: reelsCount,
    stories_count: storiesCount,
    views_count: viewsCount,
    enrollments_count: enrollmentsCount,
  });

  const created = await run(
    `INSERT INTO marketing_influencer_metrics
       (influencer_id, period_type, period_start, period_end, posts_count, reels_count, stories_count, views_count,
        enrollments_count, performance_score, notes, source_type, created_by, updated_by, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
    [
      influencer.id,
      periodType,
      periodStart,
      safePeriodEnd,
      postsCount,
      reelsCount,
      storiesCount,
      viewsCount,
      enrollmentsCount,
      performanceScore,
      notes,
      sourceType,
      actorId || null,
      actorId || null,
    ]
  );

  await logEntityChange({
    entityType: "marketing_influencer_metric",
    entityId: created.lastID,
    action: "created",
    actorUserId: actorId || null,
    origin: sourceType === "manual" ? "manual_entry" : sourceType,
    detail: {
      influencer_id: influencer.id,
      influencer_name: influencer.name,
      period_type: periodType,
      period_start: periodStart,
      period_end: safePeriodEnd,
      performance_score: performanceScore,
    },
  });

  return get(
    `SELECT mim.id, mim.influencer_id, mim.period_type, mim.period_start, mim.period_end, mim.posts_count, mim.reels_count,
            mim.stories_count, mim.views_count, mim.enrollments_count, mim.performance_score, mim.notes, mim.source_type,
            mim.created_by, mim.updated_by, mim.created_at, mim.updated_at,
            uc.name AS created_by_name, uu.name AS updated_by_name
       FROM marketing_influencer_metrics mim
  LEFT JOIN users uc ON uc.id = mim.created_by
  LEFT JOIN users uu ON uu.id = mim.updated_by
      WHERE mim.id=?`,
    [created.lastID]
  ).then(mapMarketingInfluencerMetricRow);
}

function buildMarketingAnalysisFallback(summary = {}, comparison = {}, period = {}, influencer = null) {
  const items = Array.isArray(comparison.items) ? [...comparison.items] : [];
  items.sort((left, right) => Number(right.enrollments_count || 0) - Number(left.enrollments_count || 0));
  const leader = items[0] || null;
  const weakest = items.at(-1) || null;
  const rangeLabel = period.label || "periodo selecionado";
  const paragraphs = [];

  if (influencer) {
    const performance = Number(influencer.performance_score || 0);
    const enrollments = Number(influencer.enrollments_count || 0);
    const views = Number(influencer.views_count || 0);
    let recommendation = "acompanhar mais de perto";
    if (enrollments >= 8 || performance >= 100) recommendation = "continuar investimento";
    else if (enrollments >= 4 || performance >= 60) recommendation = "segurar mais um mes";
    else if (views >= 4000) recommendation = "ajustar tipo de campanha";
    else recommendation = "rever estrategia";

    paragraphs.push(`Analise de ${influencer.name} em ${rangeLabel}: ${influencer.name} registrou ${enrollments} matricula(s), ${views} views e score medio ${performance}. A recomendacao operacional agora e ${recommendation}.`);
    if (performance < 45) {
      paragraphs.push("O retorno ainda esta abaixo do desejado. Vale revisar formato de conteudo, briefing e aderencia da campanha antes de renovar no mesmo modelo.");
    } else if (performance >= 80) {
      paragraphs.push("O desempenho indica boa tracao. Vale reforcar a parceria, manter frequencia e testar campanhas com CTA mais direto para conversao.");
    }
    return paragraphs.join("\n\n");
  }

  paragraphs.push(`Leitura geral do periodo ${rangeLabel}: ${summary.total_influencers || 0} influencer(s) acompanhadas, ${summary.enrollments_total || 0} matricula(s) atribuidas e ${summary.views_total || 0} views registradas.`);
  if (leader) {
    paragraphs.push(`${leader.name} lidera o recorte com ${leader.enrollments_count} matricula(s), ${leader.reels_count} reels e score ${leader.performance_score}. Vale manter a parceria ativa e observar o formato que mais converte.`);
  }
  if (weakest && weakest.id !== leader?.id) {
    paragraphs.push(`${weakest.name} aparece com menor retorno relativo neste recorte. Recomendo rever estrategia, acompanhar mais de perto e decidir se faz sentido insistir, pausar ou testar outra campanha.`);
  }
  return paragraphs.join("\n\n");
}

async function requestOpenAIPlainText(systemText, userText) {
  const apiKey = String(process.env.OPENAI_API_KEY || "").trim();
  if (!apiKey) return "";

  try {
    const resp = await fetchWithRetry("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || "gpt-4o-mini",
        input: [
          { role: "system", content: [{ type: "input_text", text: String(systemText || "").trim() }] },
          { role: "user", content: [{ type: "input_text", text: String(userText || "").trim() }] },
        ],
      }),
    }, {
      label: "openai_marketing_analysis",
      url: "https://api.openai.com/v1/responses",
    });

    if (!resp.ok) {
      console.error("Falha analise OpenAI marketing:", {
        status: resp.status,
        url: "https://api.openai.com/v1/responses",
        body: String(await resp.text()).slice(0, 600),
      });
      return "";
    }

    const data = await resp.json();
    return String(data?.output_text || "").trim();
  } catch (err) {
    console.error("Erro analise OpenAI marketing:", buildExternalErrorDetails(err, {
      label: "openai_marketing_analysis",
      url: "https://api.openai.com/v1/responses",
    }));
    return "";
  }
}

async function buildMarketingInfluencerAnalysis(user, payload = {}) {
  await resolveMarketingScope(user);
  const period = buildMarketingPeriodRange(payload);
  const bootstrap = await buildMarketingInfluencerBootstrap(user, period);
  const influencerId = Number(payload.influencer_id || 0);
  const selected = influencerId
    ? bootstrap.influencers.find((item) => Number(item.id) === influencerId) || null
    : null;

  const fallback = buildMarketingAnalysisFallback(bootstrap.summary, bootstrap.comparison, bootstrap.period, selected ? {
    name: selected.name,
    performance_score: selected.metrics_summary?.performance_score || 0,
    enrollments_count: selected.metrics_summary?.enrollments_count || 0,
    views_count: selected.metrics_summary?.views_count || 0,
  } : null);

  const systemText = [
    "Voce e uma analista de marketing da escola Talkers.",
    "Responda em portugues do Brasil.",
    "Analise o desempenho de influencers de forma objetiva, comparativa e operacional.",
    "Traga diagnostico, pontos fortes, pontos fracos, recomendacao pratica e proximo passo.",
    "Nao invente dados fora do resumo enviado.",
  ].join(" ");

  const userText = [
    `Periodo: ${bootstrap.period.label}.`,
    selected ? `Influencer foco: ${selected.name}.` : "Analise comparativa geral entre as influencers.",
    `Resumo geral: ${safeJsonStringify(bootstrap.summary, "{}")}.`,
    `Comparativo: ${safeJsonStringify(bootstrap.comparison.items, "[]")}.`,
  ].join("\n");

  const aiText = await requestOpenAIPlainText(systemText, userText);
  return {
    period: bootstrap.period,
    analysis_text: aiText || fallback,
    generated_at: new Date().toISOString(),
    influencer_id: selected?.id || null,
  };
}

function parseIndicatorNumericValue(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return 0;
  const normalized = raw.replace(/\./g, "").replace(",", ".");
  const numeric = Number.parseFloat(/^-?\d+(\.\d+)?$/.test(normalized) ? normalized : raw.replace(",", "."));
  return Number.isFinite(numeric) ? numeric : 0;
}

function readIndicatorNumericValue(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return { isNumeric: false, value: 0 };

  const compact = raw.replace(/\s+/g, "");
  const normalized = compact.replace(/\.(?=\d{3}(?:\D|$))/g, "").replace(",", ".");
  const candidate = Number(normalized);
  if (Number.isFinite(candidate)) {
    return { isNumeric: true, value: candidate };
  }

  const scientific = Number(compact.replace(",", "."));
  if (Number.isFinite(scientific)) {
    return { isNumeric: true, value: scientific };
  }

  return { isNumeric: false, value: 0 };
}

function normalizeMarketingIndicatorSeed(seed = {}) {
  const repairedSeed = repairDeepText(seed);
  const title = repairMojibakeText(String(repairedSeed.title || repairedSeed.key || "").trim());
  const ownerName = repairMojibakeText(String(repairedSeed.owner_name || "").trim());
  const columns = (Array.isArray(repairedSeed.columns) ? repairedSeed.columns : [])
    .map((item) => normalizeIndicatorHeaderValue(item))
    .filter(Boolean);
  const seriesKeys = (Array.isArray(repairedSeed.series_keys) ? repairedSeed.series_keys : [])
    .map((item) => normalizeIndicatorHeaderValue(item))
    .filter(Boolean);

  return {
    ...repairedSeed,
    key: slugifyDepartmentName(repairedSeed.key || title || ownerName),
    title,
    owner_name: ownerName,
    columns,
    series_keys: seriesKeys.length ? seriesKeys : columns.slice(1),
    rows: Array.isArray(repairedSeed.rows) ? repairedSeed.rows : [],
  };
}

function buildMarketingIndicatorRowValues(columns = [], values = {}) {
  const out = {};
  (columns || []).forEach((column) => {
    out[column] = repairMojibakeText(String(values?.[column] ?? "").trim());
  });
  return out;
}

function buildMarketingIndicatorRowLabel(columns = [], values = {}) {
  const year = String(values?.Ano || values?.ano || "").trim();
  const month = String(values?.Mês || values?.Mes || values?.mês || values?.mes || "").trim();
  if (year && month) return `${month}/${year}`;
  const first = (columns || []).map((column) => String(values?.[column] ?? "").trim()).find(Boolean);
  return first || "Linha";
}

function mapMarketingIndicatorTabRow(row) {
  if (!row) return null;
  return {
    ...row,
    title: repairMojibakeText(row.title || ""),
    slug: row.slug || slugifyDepartmentName(row.title || row.sheet_key || "indicador"),
    indicator_kind: row.indicator_kind || "generic",
    owner_name: repairMojibakeText(row.owner_name || ""),
    owner_photo_url: row.owner_photo_url || "",
    columns: (safeJsonParse(row.columns_json || "[]") || []).map(normalizeIndicatorHeaderValue).filter(Boolean),
    series_keys: (safeJsonParse(row.series_keys_json || "[]") || []).map(normalizeIndicatorHeaderValue).filter(Boolean),
    metadata: repairDeepText(safeJsonParse(row.metadata_json || "{}") || {}),
    is_active: row.is_active === undefined ? true : coerceDbBoolean(row.is_active),
  };
}

function mapMarketingIndicatorRowRow(row) {
  if (!row) return null;
  return {
    ...row,
    row_label: repairMojibakeText(row.row_label || ""),
    values: repairDeepText(safeJsonParse(row.values_json || "{}") || {}),
  };
}

async function listMarketingIndicatorTabsRows(departmentId) {
  const rows = await all(
    `SELECT id, department_id, sheet_key, title, slug, indicator_kind, owner_name, owner_photo_url,
            columns_json, series_keys_json, metadata_json, chart_type, sort_order, is_active,
            created_by, updated_by, created_at, updated_at
       FROM marketing_indicator_tabs
      WHERE department_id=? AND is_active<>0
      ORDER BY sort_order ASC, title ASC, id ASC`,
    [departmentId]
  );
  return rows.map(mapMarketingIndicatorTabRow).filter(Boolean);
}

async function listMarketingIndicatorRowsByTabIds(tabIds = []) {
  const ids = (tabIds || []).map((item) => Number(item || 0)).filter(Boolean);
  if (!ids.length) return [];
  return all(
    `SELECT id, tab_id, row_order, row_label, values_json, source_type, created_by, updated_by, created_at, updated_at
       FROM marketing_indicator_rows
      WHERE tab_id IN (${ids.map(() => "?").join(", ")})
      ORDER BY tab_id ASC, row_order ASC, id ASC`,
    ids
  ).then((rows) => rows.map(mapMarketingIndicatorRowRow).filter(Boolean));
}

function buildMarketingIndicatorChart(tab = {}, rows = []) {
  const columns = Array.isArray(tab.columns) ? tab.columns : [];
  const seriesKeys = Array.isArray(tab.series_keys) && tab.series_keys.length ? tab.series_keys : columns.slice(1);
  const labels = rows.map((row) => row.row_label || buildMarketingIndicatorRowLabel(columns, row.values || {}));
  const series = seriesKeys
    .map((key) => {
      const points = rows.map((row) => readIndicatorNumericValue(row.values?.[key]));
      const hasNumericValue = points.some((item) => item.isNumeric);
      return {
        key,
        label: key,
        points: points.map((item) => item.value),
        total: Number(points.reduce((sum, item) => sum + Number(item.value || 0), 0).toFixed(2)),
        last_value: Number(points.length ? points[points.length - 1].value : 0),
        has_numeric_value: hasNumericValue,
      };
    })
    .filter((item) => item.has_numeric_value);

  if (!series.length) {
    const preferredCategoryKey = columns.find((column) => /closer/i.test(String(column || "")))
      || columns.find((column) => /origem|origin/i.test(String(column || "")))
      || columns.find((column) => /modalidade|mode/i.test(String(column || "")))
      || columns.find((column) => !/ano|m[eê]s|mes/i.test(String(column || "")))
      || columns[0]
      || "Categoria";
    const grouped = new Map();

    rows.forEach((row) => {
      const label = repairMojibakeText(String(row.values?.[preferredCategoryKey] || "").trim()) || "Sem categoria";
      grouped.set(label, Number(grouped.get(label) || 0) + 1);
    });

    const groupedLabels = Array.from(grouped.keys());
    const groupedPoints = groupedLabels.map((label) => Number(grouped.get(label) || 0));
    return {
      type: tab.chart_type || "line",
      labels: groupedLabels,
      series: groupedLabels.length
        ? [{
            key: "registros",
            label: preferredCategoryKey,
            points: groupedPoints,
            total: Number(groupedPoints.reduce((sum, value) => sum + Number(value || 0), 0).toFixed(2)),
            last_value: Number(groupedPoints.length ? groupedPoints[groupedPoints.length - 1] : 0),
          }]
        : [],
    };
  }

  return {
    type: tab.chart_type || "line",
    labels,
    series,
  };
}

function buildMarketingIndicatorTabModel(tab = {}, rows = []) {
  const safeRows = (rows || []).map((row, index) => {
    const values = buildMarketingIndicatorRowValues(tab.columns || [], row.values || {});
    return {
      id: row.id,
      row_order: Number(row.row_order || index + 1),
      row_label: row.row_label || buildMarketingIndicatorRowLabel(tab.columns || [], values),
      values,
      source_type: row.source_type || "manual",
      created_at: row.created_at || "",
      updated_at: row.updated_at || "",
    };
  });
  const normalizedOwner = normalizeBusinessText(tab.owner_name || tab.title || "");
  const isPersonPanel = Boolean(tab.owner_name) || MARKETING_INDICATOR_ALLOWED_PERSON_NAMES.has(normalizedOwner);
  return {
    ...tab,
    rows: safeRows,
    row_count: safeRows.length,
    chart: buildMarketingIndicatorChart(tab, safeRows),
    is_person_panel: isPersonPanel,
    person: isPersonPanel
      ? {
          name: tab.owner_name || tab.title,
          photo_url: tab.owner_photo_url || "",
          initials: String(tab.owner_name || tab.title || "MK")
            .split(/\s+/g)
            .filter(Boolean)
            .slice(0, 2)
            .map((item) => item.charAt(0).toUpperCase())
            .join(""),
        }
      : null,
  };
}

function buildMarketingIndicatorSummary(tabModels = []) {
  const totalRows = tabModels.reduce((sum, tab) => sum + Number(tab.row_count || 0), 0);
  const totalSeries = tabModels.reduce((sum, tab) => sum + Number(tab.chart?.series?.length || 0), 0);
  const personPanels = tabModels.filter((tab) => tab.is_person_panel).length;
  return {
    tabs_total: tabModels.length,
    rows_total: totalRows,
    series_total: totalSeries,
    person_panels_total: personPanels,
  };
}

function buildMarketingIndicatorDashboardModel(tabModels = []) {
  const summary = buildMarketingIndicatorSummary(tabModels);
  const compactTabs = tabModels.map((tab) => ({
    id: tab.id,
    title: tab.title,
    slug: tab.slug,
    indicator_kind: tab.indicator_kind,
    row_count: tab.row_count,
    is_person_panel: tab.is_person_panel,
    person: tab.person,
    chart: tab.chart,
    latest_label: tab.chart?.labels?.length ? tab.chart.labels[tab.chart.labels.length - 1] : "",
  }));
  return {
    enabled: compactTabs.length > 0,
    workbook_source: MARKETING_INDICATOR_WORKBOOK_SOURCE,
    summary,
    tabs: compactTabs,
    people: compactTabs.filter((tab) => tab.is_person_panel),
  };
}

async function buildMarketingIndicatorBootstrap(user, query = {}) {
  const scope = await resolveMarketingScope(user);
  const tabs = await listMarketingIndicatorTabsRows(scope.department.id);
  const rows = await listMarketingIndicatorRowsByTabIds(tabs.map((tab) => tab.id));
  const rowsByTabId = new Map();
  for (const row of rows) {
    const tabId = Number(row.tab_id || 0);
    if (!rowsByTabId.has(tabId)) rowsByTabId.set(tabId, []);
    rowsByTabId.get(tabId).push(row);
  }

  const tabModels = tabs.map((tab) => buildMarketingIndicatorTabModel(tab, rowsByTabId.get(Number(tab.id || 0)) || []));
  const selectedTabId = Number(query.tab_id || query.tabId || 0);
  const selectedTabSlug = String(query.tab_slug || query.tabSlug || "").trim();
  const selectedTab = tabModels.find((tab) => Number(tab.id) === selectedTabId)
    || tabModels.find((tab) => tab.slug === selectedTabSlug)
    || tabModels[0]
    || null;

  return {
    enabled: true,
    department: scope.department,
    workbook_source: MARKETING_INDICATOR_WORKBOOK_SOURCE,
    summary: buildMarketingIndicatorSummary(tabModels),
    tabs: tabModels,
    selected_tab_id: selectedTab?.id || null,
    selected_tab_slug: selectedTab?.slug || "",
    dashboard: buildMarketingIndicatorDashboardModel(tabModels),
  };
}

async function buildMarketingIndicatorDashboardSnapshot(user) {
  try {
    const bootstrap = await buildMarketingIndicatorBootstrap(user, {});
    return bootstrap.dashboard || buildMarketingIndicatorDashboardModel([]);
  } catch (err) {
    if (err?.message === "marketing_access_denied" || err?.message === "marketing_department_not_found") {
      return null;
    }
    throw err;
  }
}

async function saveMarketingIndicatorRow(tabId, payload = {}, actorUser) {
  const scope = await resolveMarketingScope(actorUser);
  const actorId = Number(actorUser?.id || actorUser?.sub || 0) || null;
  const tab = await get(
    `SELECT id, department_id, sheet_key, title, slug, indicator_kind, owner_name, owner_photo_url,
            columns_json, series_keys_json, metadata_json, chart_type, sort_order, is_active,
            created_by, updated_by, created_at, updated_at
       FROM marketing_indicator_tabs
      WHERE id=? AND department_id=?`,
    [Number(tabId || 0), Number(scope.department.id || 0)]
  ).then(mapMarketingIndicatorTabRow);

  if (!tab || tab.is_active === false) throw new Error("marketing_indicator_tab_not_found");

  const values = buildMarketingIndicatorRowValues(tab.columns || [], payload.values || {});
  if (!(tab.columns || []).some((column) => String(values?.[column] || "").trim())) {
    throw new Error("marketing_indicator_row_empty");
  }

  const rowLabel = repairMojibakeText(String(payload.row_label || buildMarketingIndicatorRowLabel(tab.columns || [], values)).trim()) || "Linha";
  const currentMax = await get(`SELECT COALESCE(MAX(row_order), 0) AS total FROM marketing_indicator_rows WHERE tab_id=?`, [tab.id]);
  const created = await run(
    `INSERT INTO marketing_indicator_rows
       (tab_id, row_order, row_label, values_json, source_type, created_by, updated_by, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
    [
      tab.id,
      Number(currentMax?.total || 0) + 1,
      rowLabel,
      safeJsonStringify(values, "{}"),
      String(payload.source_type || "manual").trim() || "manual",
      actorId,
      actorId,
    ]
  );

  await logEntityChange({
    entityType: "marketing_indicator_row",
    entityId: created.lastID,
    action: "created",
    actorUserId: actorId,
    origin: "manual_entry",
    detail: {
      tab_id: tab.id,
      tab_title: tab.title,
      row_label: rowLabel,
    },
  });

  const row = await get(
    `SELECT id, tab_id, row_order, row_label, values_json, source_type, created_by, updated_by, created_at, updated_at
       FROM marketing_indicator_rows
      WHERE id=?`,
    [created.lastID]
  ).then(mapMarketingIndicatorRowRow);

  return buildMarketingIndicatorTabModel(tab, [row]).rows[0] || row;
}

async function ensureMarketingIndicatorSeeds() {
  const marketingDepartment = await getDepartmentBySlug("marketing");
  if (!marketingDepartment) return;

  for (const seedEntry of MARKETING_INDICATOR_SEEDS || []) {
    const seed = normalizeMarketingIndicatorSeed(seedEntry);
    if (!seed.title) continue;

    let tab = await get(
      `SELECT id, department_id, sheet_key, title, slug, indicator_kind, owner_name, owner_photo_url,
              columns_json, series_keys_json, metadata_json, chart_type, sort_order, is_active,
              created_by, updated_by, created_at, updated_at
         FROM marketing_indicator_tabs
        WHERE department_id=? AND sheet_key=?`,
      [marketingDepartment.id, seed.key]
    ).then(mapMarketingIndicatorTabRow);

    if (!tab) {
      const created = await run(
        `INSERT INTO marketing_indicator_tabs
           (department_id, sheet_key, title, slug, indicator_kind, owner_name, owner_photo_url,
            columns_json, series_keys_json, metadata_json, chart_type, sort_order, is_active, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'line', ?, 1, datetime('now'))`,
        [
          marketingDepartment.id,
          seed.key,
          seed.title,
          slugifyDepartmentName(seed.title || seed.key),
          seed.kind || "generic",
          seed.owner_name || null,
          null,
          safeJsonStringify(seed.columns || [], "[]"),
          safeJsonStringify(seed.series_keys || [], "[]"),
          safeJsonStringify({
            workbook_source: MARKETING_INDICATOR_WORKBOOK_SOURCE?.source_file || "indicador geral.xlsx",
            generated_at: MARKETING_INDICATOR_WORKBOOK_SOURCE?.generated_at || "",
            source_summary: MARKETING_INDICATOR_WORKBOOK_SOURCE?.source_summary || "",
            seed_kind: seed.kind || "generic",
          }, "{}"),
          Number(seed.sort_order || 0),
        ]
      );
      tab = await get(
        `SELECT id, department_id, sheet_key, title, slug, indicator_kind, owner_name, owner_photo_url,
                columns_json, series_keys_json, metadata_json, chart_type, sort_order, is_active,
                created_by, updated_by, created_at, updated_at
           FROM marketing_indicator_tabs
          WHERE id=?`,
        [created.lastID]
      ).then(mapMarketingIndicatorTabRow);
    }

    const rowCount = await get(`SELECT COUNT(*) AS total FROM marketing_indicator_rows WHERE tab_id=?`, [tab.id]);
    if (Number(rowCount?.total || 0) > 0) continue;

    for (let index = 0; index < seed.rows.length; index += 1) {
      const rawRow = Array.isArray(seed.rows[index]) ? seed.rows[index] : [];
      const values = {};
      (seed.columns || []).forEach((column, columnIndex) => {
        values[column] = repairMojibakeText(String(rawRow[columnIndex] ?? "").trim());
      });
      await run(
        `INSERT INTO marketing_indicator_rows
           (tab_id, row_order, row_label, values_json, source_type, updated_at)
         VALUES (?, ?, ?, ?, 'seed', datetime('now'))`,
        [
          tab.id,
          index + 1,
          buildMarketingIndicatorRowLabel(seed.columns || [], values),
          safeJsonStringify(values, "{}"),
        ]
      );
    }
  }
}

async function requireIntranetAccess(req, res, next) {
  const user = await getUserById(req.user.sub);
  if (!user) return res.status(401).json({ error: 'not_authenticated' });
  if (!hasIntranetAccess(user)) return res.status(403).json({ error: 'intranet_access_denied' });
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

function maskConnectionTarget(value = "") {
  const safe = String(value || "").trim();
  if (!safe) return "";
  try {
    const parsed = new URL(safe);
    return `${parsed.protocol}//${parsed.hostname}${parsed.port ? `:${parsed.port}` : ""}${parsed.pathname || ""}`;
  } catch {
    return safe;
  }
}

async function buildAdminCockpitPayload() {
  scheduleTalkersKnowledgeSync().catch((err) => {
    console.error("Erro na sincronização em background da base pública da Talkers:", buildExternalErrorDetails(err, {
      label: "talkers_public_sync_background",
    }));
  });
  const [knowledgeSourceRows, recentProcessingFailureRow, recentTrainingFailureRow, whatsappGroupsRow, whatsappCampaignsRow, whatsappQueueRow, talkersPublicDiagnostics] = await Promise.all([
    all(`SELECT id, original_name, stored_name, mime_type, language, department_name, source_kind, sync_status, processing_state_json
           FROM knowledge_sources
          ORDER BY id DESC`),
    get(`SELECT COUNT(*) AS total FROM knowledge_processing_logs WHERE stage_status IN ('failed', 'error') AND datetime(created_at) >= datetime('now', '-7 day')`),
    get(`SELECT COUNT(*) AS total FROM ai_training_events WHERE event_status IN ('failed', 'error', 'warning') AND datetime(created_at) >= datetime('now', '-7 day')`),
    get(`SELECT COUNT(*) AS total,
                SUM(CASE WHEN status='active' THEN 1 ELSE 0 END) AS active_total
           FROM pedagogical_whatsapp_groups`),
    get(`SELECT COUNT(*) AS total,
                SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END) AS completed_total,
                SUM(CASE WHEN status='error' THEN 1 ELSE 0 END) AS error_total
           FROM pedagogical_whatsapp_campaigns`),
    get(`SELECT COUNT(*) AS total,
                SUM(CASE WHEN send_status IN ('queued', 'pending_provider') THEN 1 ELSE 0 END) AS pending_total,
                SUM(CASE WHEN send_status='sending' THEN 1 ELSE 0 END) AS sending_total,
                SUM(CASE WHEN send_status='sent' THEN 1 ELSE 0 END) AS sent_total,
                SUM(CASE WHEN send_status='error' THEN 1 ELSE 0 END) AS error_total
           FROM pedagogical_whatsapp_campaign_items`),
    Promise.resolve(getTalkersPublicKnowledgeDiagnostics()),
  ]);

  const knowledgeCounts = summarizeKnowledgeAdminRows(
    (knowledgeSourceRows || []).map((row) => buildKnowledgeAdminRow(row))
  );

  const localStorageActive = Boolean(uploadsDir || kbDir);
  const openAiConfigured = Boolean(String(process.env.OPENAI_API_KEY || "").trim());
  const vectorConfigured = Boolean(OPENAI_VECTOR_STORE_ID);
  const promptConfigured = Boolean(OPENAI_PROMPT_ID);
  const whatsappIntegration = getWhatsAppIntegrationStatus();
  const chatPerformance = getChatPerformanceSnapshot();
  const chatAlerts = buildChatPerformanceAlerts(chatPerformance);
  const recentErrorTotal = Number(recentProcessingFailureRow?.total || 0) + Number(recentTrainingFailureRow?.total || 0);

  return {
    generated_at: new Date().toISOString(),
    storage: {
      current: vectorConfigured ? (IS_PRODUCTION ? "Render + OpenAI" : "Servidor local + OpenAI") : (IS_PRODUCTION ? "Render" : "Servidor local"),
      upload_path: uploadsDir,
      knowledge_path: kbDir,
      type: vectorConfigured ? "Híbrido" : "Local",
      status: localStorageActive ? "Ativo" : "Inativo",
      technical_note: vectorConfigured
        ? "Os arquivos entram no filesystem do servidor e podem ser espelhados para OpenAI Files / Vector Store."
        : "Os arquivos estão sendo mantidos no filesystem local do servidor.",
      alert: localStorageActive
        ? "Os uploads usam armazenamento do servidor. Isso merece revisão futura para escalabilidade, persistência e custo operacional."
        : "",
    },
    database: {
      client: DB_CLIENT,
      status: "Ativo",
      environment: NODE_ENV,
      target: DB_CLIENT === "sqlite" ? DATA_DIR : maskConnectionTarget(process.env.DATABASE_URL || ""),
      availability_note: DB_CLIENT === "sqlite"
        ? "Banco local em arquivo."
        : "Banco relacional externo configurado por DATABASE_URL.",
    },
    openai: {
      status: openAiConfigured ? "Ativo" : "Inativo",
      api_configured: openAiConfigured,
      api_key_status: openAiConfigured ? "Configurada" : "Ausente",
      responses_api_active: true,
      streaming_active: true,
      model: String(process.env.OPENAI_MODEL || "gpt-4o-mini").trim(),
      vector_store_configured: vectorConfigured,
      vector_store_id: OPENAI_VECTOR_STORE_ID || "",
      prompt_configured: promptConfigured,
      prompt_id: OPENAI_PROMPT_ID || "",
      external_search_enabled: true,
      current_data_tools_enabled: true,
      knowledge_files_total: Number(knowledgeCounts?.total || 0),
      knowledge_available_total: Number(knowledgeCounts?.available || 0),
      knowledge_failed_total: Number(knowledgeCounts?.failed || 0),
      talkers_public_base: {
        status: talkersPublicDiagnostics?.status || "seed",
        mode: talkersPublicDiagnostics?.mode || "seed",
        source_count: Number(talkersPublicDiagnostics?.source_count || 0),
        last_synced_at: talkersPublicDiagnostics?.last_synced_at || null,
        categories: talkersPublicDiagnostics?.categories || [],
        origins: talkersPublicDiagnostics?.origins || [],
        technical_note: talkersPublicDiagnostics?.technical_note || "",
      },
    },
    services: {
      integrations: [
        { name: "OpenAI API", status: openAiConfigured ? "Ativo" : "Inativo" },
        { name: "Vector Store", status: vectorConfigured ? "Ativo" : "Inativo" },
        { name: "Prompt reutilizável", status: promptConfigured ? "Ativo" : "Inativo" },
        { name: "Busca web externa", status: "Ativo" },
        { name: "APIs de dados atuais", status: "Ativo" },
        {
          name: "Base pública da Talkers",
          status: talkersPublicDiagnostics?.status === "active" ? "Ativo" : "Preparado",
        },
        {
          name: "WhatsApp provider",
          status: whatsappIntegration.execution_enabled
            ? "Ativo"
            : (whatsappIntegration.credentials_ready ? "Preparado" : "Pendente"),
        },
      ],
    },
    application: {
      status: "Ativo",
      environment: NODE_ENV,
      base_url: BASE_URL,
      uptime_seconds: Math.round(process.uptime()),
      healthcheck: {
        ok: true,
        db_client: DB_CLIENT,
        vector_store_configured: vectorConfigured,
        openai_prompt_configured: promptConfigured,
      },
    },
    queues: {
      knowledge_background: {
        running: Boolean(knowledgeBackgroundState.running),
        queued: Number(knowledgeBackgroundState.queue.length || 0),
        processed: Number(knowledgeBackgroundState.queue_processed || 0),
        failed: Number(knowledgeBackgroundState.queue_failed || 0),
        current_source_id: knowledgeBackgroundState.current_source_id || null,
        last_error: knowledgeBackgroundState.last_error || "",
      },
      whatsapp_campaigns: {
        running: Boolean(whatsappIntegration.execution_enabled),
        pending: Number(whatsappQueueRow?.pending_total || 0),
        sending: Number(whatsappQueueRow?.sending_total || 0),
        sent: Number(whatsappQueueRow?.sent_total || 0),
        failed: Number(whatsappQueueRow?.error_total || 0),
        mode: whatsappIntegration.mode,
      },
    },
    alerts: {
      recent_errors_total: recentErrorTotal,
      processing_failures_7d: Number(recentProcessingFailureRow?.total || 0),
      training_failures_7d: Number(recentTrainingFailureRow?.total || 0),
      chat: chatAlerts,
    },
    operational_summary: {
      files_total: Number(knowledgeCounts?.total || 0),
      files_available: Number(knowledgeCounts?.available || 0),
      files_failed: Number(knowledgeCounts?.failed || 0),
      chat_status: chatPerformance.severity,
    },
    whatsapp: {
      integration: whatsappIntegration,
      summary: {
        groups_total: Number(whatsappGroupsRow?.total || 0),
        groups_active: Number(whatsappGroupsRow?.active_total || 0),
        campaigns_total: Number(whatsappCampaignsRow?.total || 0),
        campaigns_completed: Number(whatsappCampaignsRow?.completed_total || 0),
        campaigns_error: Number(whatsappCampaignsRow?.error_total || 0),
        queue_total: Number(whatsappQueueRow?.total || 0),
      },
    },
    chat_performance: chatPerformance,
    talkers_public_base: talkersPublicDiagnostics,
  };
}

function writeEventStreamPacket(res, eventName, payload = {}) {
  if (!res || res.writableEnded) return;
  const safeEvent = String(eventName || "message").trim() || "message";
  const safePayload = repairDeepText(payload || {});
  res.write(`event: ${safeEvent}\n`);
  res.write(`data: ${safeJsonStringify(safePayload, "{}")}\n\n`);
}

function makeHttpError(message, statusCode = 400) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}

async function prepareConversationMessageState({ conversationId, userId, text, requestLocale = DEFAULT_LOCALE }) {
  const conv = await get("SELECT * FROM conversations WHERE id=? AND user_id=?", [conversationId, userId]);
  if (!conv) throw makeHttpError("not_found", 404);

  const currentUser = await getUserById(userId);
  if (!currentUser) throw makeHttpError("not_authenticated", 401);

  const safeLocale = normalizeLocaleCode(requestLocale || currentUser?.preferred_locale || DEFAULT_LOCALE);
  const requestLanguage = normalizeLanguageCode(localeToLanguage(safeLocale));
  await maybeInsertDailyGreeting(conversationId, currentUser, safeLocale);

  if (isDefaultConversationTitle(conv.title)) {
    await run("UPDATE conversations SET title=? WHERE id=?", [titleFromMessage(text), conversationId]);
  }

  await run(
    "INSERT INTO messages (conversation_id, role, content) VALUES (?, 'user', ?)",
    [conversationId, text]
  );

  const topicSnapshot = await getConversationTopicSnapshot(conversationId, text, CHAT_HISTORY_CONTEXT_LIMIT);
  const userLanguage = detectConversationLanguage(text, topicSnapshot.history, requestLanguage);
  const responseProfile = analyzeConversationIntent(text, userLanguage, {
    departments: currentUser?.departments || [],
  });
  const moderation = evaluateEducationalModeration(text, {
    locale: safeLocale,
    userLanguage,
  });

  return {
    conversationId,
    conv,
    currentUser,
    requestLocale: safeLocale,
    requestLanguage,
    topicSnapshot,
    userLanguage,
    responseProfile,
    moderation,
  };
}

async function persistAssistantTextReply({
  conversationId,
  userId,
  userText,
  assistantText,
  responseProfile,
  responseLanguage,
  metaObject,
  sources = [],
  queryEmbedding = null,
  knowledgeSignature = "",
  relevantMemoryEntries = [],
  knowledgeMemoryEntries = [],
  resetMemory = false,
  cacheSemantic = false,
  recordUsage = false,
  allowWeakResponseLog = true,
}) {
  const persistStartedAt = Date.now();
  const safeAssistantText = String(assistantText || "").trim();
  const shouldPersistDerivedMemory = Boolean(
    safeAssistantText
      && !responseLooksSelfLimiting(safeAssistantText)
      && !responseLooksWeak(safeAssistantText)
  );
  await run(
    "INSERT INTO messages (conversation_id, role, content, meta_json) VALUES (?, 'assistant', ?, ?)",
    [conversationId, assistantText, safeJsonStringify(metaObject, "{}")]
  );
  await run("UPDATE conversations SET updated_at=datetime('now') WHERE id=?", [conversationId]);
  if (shouldPersistDerivedMemory) {
    await persistReplyMemories({
      conversationId,
      userId,
      userText,
      assistantText,
      language: responseLanguage,
      resetMemory: Boolean(resetMemory),
    });
  }

  if (shouldPersistDerivedMemory && cacheSemantic && queryEmbedding && knowledgeSignature) {
    await saveSemanticCache(
      userId,
      userText,
      responseLanguage,
      assistantText,
      responseLanguage,
      sources || [],
      queryEmbedding,
      knowledgeSignature
    );
  }
  if (recordUsage && Array.isArray(sources) && sources.length) {
    await recordKnowledgeUsageEvents(userId, conversationId, sources);
  }
  if (Array.isArray(relevantMemoryEntries) && relevantMemoryEntries.length) {
    await logAiTrainingEvent({
      userId,
      conversationId,
      eventType: "memory_hit",
      eventStatus: "success",
      title: "Memória contextual aplicada",
      detailText: `A resposta considerou ${relevantMemoryEntries.length} memória(s) relacionada(s) ao usuário.`,
      meta: {
        memory_entry_ids: relevantMemoryEntries.map((entry) => entry.id),
      },
    });
  }
  if (allowWeakResponseLog && (responseLooksWeak(assistantText) || responseLooksSelfLimiting(assistantText))) {
    await logAiTrainingEvent({
      userId,
      conversationId,
      eventType: "weak_response",
      eventStatus: "warning",
      title: String(userText || "").slice(0, 120),
      detailText: assistantText,
      meta: {
        knowledge_sources: Array.isArray(sources) ? sources.length : 0,
        memory_hits: Array.isArray(relevantMemoryEntries) ? relevantMemoryEntries.length : 0,
        document_memory_hits: Array.isArray(knowledgeMemoryEntries) ? knowledgeMemoryEntries.length : 0,
      },
    });
  }

  return {
    persistence_ms: Date.now() - persistStartedAt,
  };
}

app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    vector_store_configured: Boolean(OPENAI_VECTOR_STORE_ID),
    openai_prompt_configured: Boolean(OPENAI_PROMPT_ID),
    db_client: DB_CLIENT,
    uptime_seconds: Math.round(process.uptime()),
  });
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
  res.cookie("talkers_locale", normalizeLocaleCode(sessionUser?.preferred_locale || DEFAULT_LOCALE), {
    httpOnly: false,
    sameSite: "lax",
    secure: isHttps(req),
    maxAge: 365 * 24 * 60 * 60 * 1000,
  });

  await logEvent(user.id, "login", { email });
  res.json({ ok: true });
});

app.post("/api/logout", requireAuth(JWT_SECRET), async (req, res) => {
  clearSessionCookie(req, res);
  res.clearCookie("talkers_locale", {
    httpOnly: false,
    sameSite: "lax",
    secure: isHttps(req),
  });
  await logEvent(req.user.sub, "logout", {});
  res.json({ ok: true });
});

app.get("/logout", (req, res) => {
  clearSessionCookie(req, res);
  res.redirect("/login.html");
});

app.get("/api/me", requireAuth(JWT_SECRET), async (req, res) => {
  const user = await getUserById(req.user.sub);
  const requestLocale = getRequestLocale(req, user?.preferred_locale || DEFAULT_LOCALE);

  res.json({
    user: user
      ? {
          ...user,
          preferred_locale: requestLocale || user.preferred_locale || DEFAULT_LOCALE,
        }
      : {
          id: req.user.sub,
          name: req.user.name,
          email: req.user.email,
          role: req.user.role,
          department: req.user.department || '',
          departments: Array.isArray(req.user.departments) ? req.user.departments : [],
          department_details: [],
          can_access_intranet: parseBooleanInput(req.user.can_access_intranet),
          preferred_locale: requestLocale,
        },
  });
});

app.patch("/api/me/preferences", requireAuth(JWT_SECRET), async (req, res) => {
  const preferredLocale = normalizeLocaleCode(req.body?.preferred_locale || DEFAULT_LOCALE);
  await run("UPDATE users SET preferred_locale=? WHERE id=?", [preferredLocale, req.user.sub]);
  res.cookie("talkers_locale", preferredLocale, {
    httpOnly: false,
    sameSite: "lax",
    secure: isHttps(req),
    maxAge: 365 * 24 * 60 * 60 * 1000,
  });
  const user = await getUserById(req.user.sub);
  res.json({ ok: true, user });
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
  const requestLocale = getRequestLocale(req);

  const created = await run(
    "INSERT INTO conversations (user_id, title, mode) VALUES (?, ?, ?)",
    [req.user.sub, title, mode]
  );

  const freshUser = await get(
    "SELECT id, name, email, role, department, preferred_locale FROM users WHERE id=?",
    [req.user.sub]
  );
  await maybeInsertDailyGreeting(created.lastID, freshUser || req.user, requestLocale);

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
  const perfSample = beginChatPerformanceSample(text.length);
  try {
    const prepared = await prepareConversationMessageState({
      conversationId: id,
      userId: req.user.sub,
      text,
      requestLocale: getRequestLocale(req, req.user?.preferred_locale || DEFAULT_LOCALE),
    });
    const { currentUser, requestLocale, topicSnapshot, userLanguage, responseProfile, moderation } = prepared;

    if (moderation.blocked) {
      const moderationMetaObject = makeStructuredResponseMeta(responseProfile, {
        response_language: userLanguage,
        response_locale: requestLocale,
        moderated: true,
        moderation_category: moderation.category,
      });
      const persistMetrics = await persistAssistantTextReply({
        conversationId: id,
        userId: req.user.sub,
        userText: text,
        assistantText: moderation.message,
        responseProfile,
        responseLanguage: userLanguage,
        metaObject: moderationMetaObject,
        resetMemory: Boolean(topicSnapshot?.topicShift?.isShift),
        allowWeakResponseLog: false,
      });
      finalizeChatPerformanceSample(perfSample, {
        total_response_ms: Date.now() - perfSample.started_at,
        api_latency_ms: 0,
        internal_processing_ms: Date.now() - perfSample.started_at,
        context_assembly_ms: 0,
        persistence_ms: persistMetrics.persistence_ms,
        prompt_chars: text.length,
        response_chars: moderation.message.length,
        response_bytes: Buffer.byteLength(String(moderation.message || ""), "utf8"),
        status: "moderated",
      });
      return res.json({ reply: moderation.message, meta: moderationMetaObject });
    }

    const contextStartedAt = Date.now();
    const contextStrategy = buildChatContextStrategy(text, responseProfile);
    const [knowledgeSignature, supportAssets, queryEmbedding] = await Promise.all([
      contextStrategy.skipSemanticCache ? Promise.resolve("external_live") : getKnowledgeSignatureValue(),
      contextStrategy.skipSupportAssets
        ? Promise.resolve({
            cache_key: "fast_external",
            fileContext: "",
            visionInputs: [],
            documentInputs: [],
            imageReferences: [],
          })
        : getConversationSupportAssets(id),
      contextStrategy.skipEmbeddings ? Promise.resolve(null) : getEmbeddingForText(text),
    ]);
    const relevantMemoryEntries = topicSnapshot?.topicShift?.isShift || contextStrategy.skipConversationMemories
      ? []
      : await getRelevantMemoryEntries(req.user.sub, id, text, 4, { queryEmbedding });

    const artifact = await generateArtifact({
      apiKey: process.env.OPENAI_API_KEY || "",
      prompt: text,
      outDir: uploadsDir,
      referenceImages: supportAssets.imageReferences || [],
    }).catch((err) => {
      console.log("Erro na geracao de artefato:", err?.message || err);
      return null;
    });

    const quickExternalContext = contextStrategy.fastExternalOnly
      ? await resolveExternalToolContext(text, {
          userLanguage,
          forceWebSearch: true,
        }).catch((err) => {
          console.log("Erro no contexto externo rapido:", err?.message || err);
          return null;
        })
      : null;

    if (artifact) {
      if (!artifact.fullPath) {
        const artifactMetaObject = makeStructuredResponseMeta(responseProfile, {
          response_language: userLanguage,
        });
        const persistMetrics = await persistAssistantTextReply({
          conversationId: id,
          userId: req.user.sub,
          userText: text,
          assistantText: artifact.reply,
          responseProfile,
          responseLanguage: userLanguage,
          metaObject: artifactMetaObject,
          resetMemory: Boolean(topicSnapshot?.topicShift?.isShift),
          allowWeakResponseLog: false,
        });
        const contextAssemblyMs = Date.now() - contextStartedAt;
        finalizeChatPerformanceSample(perfSample, {
          total_response_ms: Date.now() - perfSample.started_at,
          api_latency_ms: 0,
          internal_processing_ms: Date.now() - perfSample.started_at,
          context_assembly_ms: contextAssemblyMs,
          persistence_ms: persistMetrics.persistence_ms,
          prompt_chars: text.length,
          response_chars: artifact.reply.length,
          response_bytes: Buffer.byteLength(String(artifact.reply || ""), "utf8"),
          status: "artifact_inline",
        });
        return res.json({ reply: artifact.reply, meta: artifactMetaObject });
      }

      const persistStartedAt = Date.now();
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
      const contextAssemblyMs = Date.now() - contextStartedAt;
      finalizeChatPerformanceSample(perfSample, {
        total_response_ms: Date.now() - perfSample.started_at,
        api_latency_ms: 0,
        internal_processing_ms: Date.now() - perfSample.started_at,
        context_assembly_ms: contextAssemblyMs,
        persistence_ms: Date.now() - persistStartedAt,
        prompt_chars: text.length,
        response_chars: artifact.reply.length,
        response_bytes: Buffer.byteLength(String(artifact.reply || ""), "utf8"),
        status: "artifact_file",
      });
      return res.json({ reply: artifact.reply, meta: { ...saved.meta, response_language: userLanguage } });
    }

    if (contextStrategy.fastExternalOnly && String(quickExternalContext?.direct_answer || "").trim()) {
      const directReply = repairMojibakeText(String(quickExternalContext.direct_answer || "").trim());
      const directSources = Array.isArray(quickExternalContext?.sources) ? quickExternalContext.sources.slice(0, 8) : [];
      const directMetaObject = makeStructuredResponseMeta(responseProfile, {
        response_language: userLanguage,
        sources: directSources,
        show_sources: shouldShowSourcesForReply(text),
      });
      const persistMetrics = await persistAssistantTextReply({
        conversationId: id,
        userId: req.user.sub,
        userText: text,
        assistantText: directReply,
        responseProfile,
        responseLanguage: userLanguage,
        metaObject: directMetaObject,
        sources: directSources,
        relevantMemoryEntries,
        resetMemory: Boolean(topicSnapshot?.topicShift?.isShift),
        recordUsage: true,
        allowWeakResponseLog: false,
      });
      finalizeChatPerformanceSample(perfSample, {
        total_response_ms: Date.now() - perfSample.started_at,
        api_latency_ms: 0,
        internal_processing_ms: Date.now() - perfSample.started_at,
        context_assembly_ms: Date.now() - contextStartedAt,
        persistence_ms: persistMetrics.persistence_ms,
        prompt_chars: text.length,
        response_chars: directReply.length,
        response_bytes: Buffer.byteLength(String(directReply || ""), "utf8"),
        ...mergeToolUsageMetrics(quickExternalContext?.metrics || null),
        status: "tool_direct_answer",
      });
      return res.json({ reply: directReply, meta: directMetaObject });
    }

    const cachedReply = !queryLooksExternalOrCurrent(text)
      ? await findSemanticCache(req.user.sub, text, userLanguage, queryEmbedding, knowledgeSignature)
      : null;

    if (cachedReply?.text) {
      const safeCachedText = repairMojibakeText(String(cachedReply.text || ""));
      if (responseLooksSelfLimiting(safeCachedText) || responseLooksWeak(safeCachedText)) {
        // Ignore low-quality cache hits so they do not contaminate future responses.
      } else {
      const cachedMetaObject = makeStructuredResponseMeta(responseProfile, {
        response_language: cachedReply.responseLanguage || userLanguage,
        sources: cachedReply.sources || [],
        show_sources: shouldShowSourcesForReply(text),
      });
      const persistMetrics = await persistAssistantTextReply({
        conversationId: id,
        userId: req.user.sub,
        userText: text,
        assistantText: safeCachedText,
        responseProfile,
        responseLanguage: cachedReply.responseLanguage || userLanguage,
        metaObject: cachedMetaObject,
        sources: cachedReply.sources || [],
        relevantMemoryEntries,
        resetMemory: Boolean(topicSnapshot?.topicShift?.isShift),
        recordUsage: Boolean((cachedReply.sources || []).length),
        allowWeakResponseLog: false,
      });
      const contextAssemblyMs = Date.now() - contextStartedAt;
      finalizeChatPerformanceSample(perfSample, {
        total_response_ms: Date.now() - perfSample.started_at,
        api_latency_ms: 0,
        internal_processing_ms: Date.now() - perfSample.started_at,
        context_assembly_ms: contextAssemblyMs,
        persistence_ms: persistMetrics.persistence_ms,
        prompt_chars: text.length,
        response_chars: safeCachedText.length,
        response_bytes: Buffer.byteLength(String(safeCachedText || ""), "utf8"),
        status: "cache_hit",
      });
      return res.json({ reply: safeCachedText, meta: cachedMetaObject });
      }
    }

    const contextLayers = await buildConversationKnowledgeContext({
      text,
      userLanguage,
      currentUser,
      queryEmbedding,
      supportAssets,
      strategy: contextStrategy,
      preloadedExternalToolContext: quickExternalContext,
    });
    if (contextStrategy.fastTalkersOnly) {
      const talkersDirectReply = buildTalkersContextFallbackAnswer(contextLayers.talkersPublicBundle);
      if (talkersDirectReply) {
        const talkersSources = Array.isArray(contextLayers.talkersPublicBundle?.sources)
          ? contextLayers.talkersPublicBundle.sources.slice(0, 8)
          : [];
        const talkersMetaObject = makeStructuredResponseMeta(responseProfile, {
          response_language: userLanguage,
          sources: talkersSources,
          show_sources: shouldShowSourcesForReply(text),
        });
        const persistMetrics = await persistAssistantTextReply({
          conversationId: id,
          userId: req.user.sub,
          userText: text,
          assistantText: talkersDirectReply,
          responseProfile,
          responseLanguage: userLanguage,
          metaObject: talkersMetaObject,
          sources: talkersSources,
          relevantMemoryEntries,
          resetMemory: Boolean(topicSnapshot?.topicShift?.isShift),
          recordUsage: true,
          allowWeakResponseLog: false,
        });
        finalizeChatPerformanceSample(perfSample, {
          total_response_ms: Date.now() - perfSample.started_at,
          api_latency_ms: 0,
          internal_processing_ms: Date.now() - perfSample.started_at,
          context_assembly_ms: Date.now() - contextStartedAt,
          persistence_ms: persistMetrics.persistence_ms,
          prompt_chars: text.length,
          response_chars: talkersDirectReply.length,
          response_bytes: Buffer.byteLength(String(talkersDirectReply || ""), "utf8"),
          ...mergeToolUsageMetrics(contextLayers.toolMetrics || null),
          status: "talkers_direct_answer",
        });
        return res.json({ reply: talkersDirectReply, meta: talkersMetaObject });
      }
    }
    const contextText = contextLayers.contextText;
    const contextAssemblyMs = Date.now() - contextStartedAt;

    const assistant = await openaiReply({
      conversationId: id,
      userId: req.user.sub,
      userText: text,
      contextText,
      baseSources: contextLayers.mergedKnowledgeSources,
      topicSnapshot,
      responseProfile,
      contextStrategy,
      currentUser,
      relevantMemoryEntries,
      visionInputs: supportAssets.visionInputs || [],
      documentInputs: supportAssets.documentInputs || [],
    });

    let finalAssistantText = repairMojibakeText(String(assistant.text || "").trim());
    let finalAssistantSources = Array.isArray(assistant.sources) ? assistant.sources : [];
    const combinedToolMetrics = mergeToolUsageMetrics(
      contextLayers.toolMetrics || null,
      assistant.metrics || null
    );

    if (responseLooksSelfLimiting(finalAssistantText) || responseLooksWeak(finalAssistantText)) {
      const directFallback = buildExternalContextFallbackAnswer(contextLayers.externalToolContext, userLanguage);
      if (directFallback) {
        finalAssistantText = directFallback;
        finalAssistantSources = (contextLayers.externalToolContext?.sources || []).slice(0, 8);
      }
    }

    const assistantMetaObject = makeStructuredResponseMeta(responseProfile, {
      response_language: userLanguage,
      sources: finalAssistantSources || [],
      show_sources: shouldShowSourcesForReply(text),
    });
    const persistMetrics = await persistAssistantTextReply({
      conversationId: id,
      userId: req.user.sub,
      userText: text,
      assistantText: finalAssistantText,
      responseProfile,
      responseLanguage: userLanguage,
      metaObject: assistantMetaObject,
      sources: finalAssistantSources || [],
      queryEmbedding,
      knowledgeSignature,
      relevantMemoryEntries,
      knowledgeMemoryEntries: contextLayers.knowledgeMemoryEntries,
      resetMemory: Boolean(topicSnapshot?.topicShift?.isShift),
      cacheSemantic: true,
      recordUsage: true,
      allowWeakResponseLog: true,
    });

    finalizeChatPerformanceSample(perfSample, {
      total_response_ms: Date.now() - perfSample.started_at,
      api_latency_ms: Number(assistant?.metrics?.api_latency_ms || 0),
      internal_processing_ms: Math.max(0, (Date.now() - perfSample.started_at) - Number(assistant?.metrics?.api_latency_ms || 0)),
      context_assembly_ms: contextAssemblyMs,
      persistence_ms: persistMetrics.persistence_ms,
      prompt_chars: text.length,
      response_chars: String(finalAssistantText || "").length,
      payload_bytes: Number(assistant?.metrics?.payload_bytes || 0),
      response_bytes: Number(assistant?.metrics?.response_bytes || Buffer.byteLength(String(finalAssistantText || ""), "utf8")),
      ...combinedToolMetrics,
      status: assistant?.metrics?.status || "success",
    });

    res.json({ reply: finalAssistantText, meta: assistantMetaObject });
  } catch (err) {
    finalizeChatPerformanceSample(perfSample, {
      total_response_ms: Date.now() - perfSample.started_at,
      api_latency_ms: 0,
      internal_processing_ms: Date.now() - perfSample.started_at,
      prompt_chars: text.length,
      response_chars: 0,
      status: err?.message || "send_failed",
    });
    res.status(err?.statusCode || 500).json({ error: err?.message || "conversation_send_failed" });
  }
});

app.post("/api/conversations/:id/send-stream", requireAuth(JWT_SECRET), async (req, res) => {
  const id = Number(req.params.id);
  const text = String(req.body?.message || "").trim();
  if (!text) return res.status(400).json({ error: "empty_message" });
  const perfSample = beginChatPerformanceSample(text.length);

  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();

  try {
    const prepared = await prepareConversationMessageState({
      conversationId: id,
      userId: req.user.sub,
      text,
      requestLocale: getRequestLocale(req, req.user?.preferred_locale || DEFAULT_LOCALE),
    });
    const { currentUser, requestLocale, topicSnapshot, userLanguage, responseProfile, moderation } = prepared;

    if (moderation.blocked) {
      const moderationMetaObject = makeStructuredResponseMeta(responseProfile, {
        response_language: userLanguage,
        response_locale: requestLocale,
        moderated: true,
        moderation_category: moderation.category,
      });
      const persistMetrics = await persistAssistantTextReply({
        conversationId: id,
        userId: req.user.sub,
        userText: text,
        assistantText: moderation.message,
        responseProfile,
        responseLanguage: userLanguage,
        metaObject: moderationMetaObject,
        resetMemory: Boolean(topicSnapshot?.topicShift?.isShift),
        allowWeakResponseLog: false,
      });
      finalizeChatPerformanceSample(perfSample, {
        total_response_ms: Date.now() - perfSample.started_at,
        api_latency_ms: 0,
        internal_processing_ms: Date.now() - perfSample.started_at,
        context_assembly_ms: 0,
        persistence_ms: persistMetrics.persistence_ms,
        prompt_chars: text.length,
        response_chars: moderation.message.length,
        response_bytes: Buffer.byteLength(String(moderation.message || ""), "utf8"),
        status: "moderated",
      });
      writeEventStreamPacket(res, "done", { reply: moderation.message, meta: moderationMetaObject });
      return res.end();
    }

    writeEventStreamPacket(res, "stage", {
      stage: "context",
      label: "Montando contexto inteligente",
    });

    const contextStartedAt = Date.now();
    const contextStrategy = buildChatContextStrategy(text, responseProfile);
    const [knowledgeSignature, supportAssets, queryEmbedding] = await Promise.all([
      contextStrategy.skipSemanticCache ? Promise.resolve("external_live") : getKnowledgeSignatureValue(),
      contextStrategy.skipSupportAssets
        ? Promise.resolve({
            cache_key: "fast_external",
            fileContext: "",
            visionInputs: [],
            documentInputs: [],
            imageReferences: [],
          })
        : getConversationSupportAssets(id),
      contextStrategy.skipEmbeddings ? Promise.resolve(null) : getEmbeddingForText(text),
    ]);
    const relevantMemoryEntries = topicSnapshot?.topicShift?.isShift || contextStrategy.skipConversationMemories
      ? []
      : await getRelevantMemoryEntries(req.user.sub, id, text, 4, { queryEmbedding });

    const artifact = await generateArtifact({
      apiKey: process.env.OPENAI_API_KEY || "",
      prompt: text,
      outDir: uploadsDir,
      referenceImages: supportAssets.imageReferences || [],
    }).catch((err) => {
      console.log("Erro na geracao de artefato:", err?.message || err);
      return null;
    });

    const quickExternalContext = contextStrategy.fastExternalOnly
      ? await resolveExternalToolContext(text, {
          userLanguage,
          forceWebSearch: true,
        }).catch((err) => {
          console.log("Erro no contexto externo rapido:", err?.message || err);
          return null;
        })
      : null;

    if (artifact) {
      if (!artifact.fullPath) {
        const artifactMetaObject = makeStructuredResponseMeta(responseProfile, {
          response_language: userLanguage,
        });
        const persistMetrics = await persistAssistantTextReply({
          conversationId: id,
          userId: req.user.sub,
          userText: text,
          assistantText: artifact.reply,
          responseProfile,
          responseLanguage: userLanguage,
          metaObject: artifactMetaObject,
          resetMemory: Boolean(topicSnapshot?.topicShift?.isShift),
          allowWeakResponseLog: false,
        });
        finalizeChatPerformanceSample(perfSample, {
          total_response_ms: Date.now() - perfSample.started_at,
          api_latency_ms: 0,
          internal_processing_ms: Date.now() - perfSample.started_at,
          context_assembly_ms: Date.now() - contextStartedAt,
          persistence_ms: persistMetrics.persistence_ms,
          prompt_chars: text.length,
          response_chars: artifact.reply.length,
          response_bytes: Buffer.byteLength(String(artifact.reply || ""), "utf8"),
          status: "artifact_inline",
        });
        writeEventStreamPacket(res, "done", { reply: artifact.reply, meta: artifactMetaObject });
        return res.end();
      }

      const persistStartedAt = Date.now();
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
      finalizeChatPerformanceSample(perfSample, {
        total_response_ms: Date.now() - perfSample.started_at,
        api_latency_ms: 0,
        internal_processing_ms: Date.now() - perfSample.started_at,
        context_assembly_ms: Date.now() - contextStartedAt,
        persistence_ms: Date.now() - persistStartedAt,
        prompt_chars: text.length,
        response_chars: artifact.reply.length,
        response_bytes: Buffer.byteLength(String(artifact.reply || ""), "utf8"),
        status: "artifact_file",
      });
      writeEventStreamPacket(res, "done", {
        reply: artifact.reply,
        meta: { ...saved.meta, response_language: userLanguage },
      });
      return res.end();
    }

    if (contextStrategy.fastExternalOnly && String(quickExternalContext?.direct_answer || "").trim()) {
      const directReply = repairMojibakeText(String(quickExternalContext.direct_answer || "").trim());
      const directSources = Array.isArray(quickExternalContext?.sources) ? quickExternalContext.sources.slice(0, 8) : [];
      const directMetaObject = makeStructuredResponseMeta(responseProfile, {
        response_language: userLanguage,
        sources: directSources,
        show_sources: shouldShowSourcesForReply(text),
      });
      const persistMetrics = await persistAssistantTextReply({
        conversationId: id,
        userId: req.user.sub,
        userText: text,
        assistantText: directReply,
        responseProfile,
        responseLanguage: userLanguage,
        metaObject: directMetaObject,
        sources: directSources,
        relevantMemoryEntries,
        resetMemory: Boolean(topicSnapshot?.topicShift?.isShift),
        recordUsage: true,
        allowWeakResponseLog: false,
      });
      finalizeChatPerformanceSample(perfSample, {
        total_response_ms: Date.now() - perfSample.started_at,
        api_latency_ms: 0,
        internal_processing_ms: Date.now() - perfSample.started_at,
        context_assembly_ms: Date.now() - contextStartedAt,
        persistence_ms: persistMetrics.persistence_ms,
        prompt_chars: text.length,
        response_chars: directReply.length,
        response_bytes: Buffer.byteLength(String(directReply || ""), "utf8"),
        ...mergeToolUsageMetrics(quickExternalContext?.metrics || null),
        status: "tool_direct_answer",
      });
      writeEventStreamPacket(res, "done", { reply: directReply, meta: directMetaObject });
      return res.end();
    }

    const cachedReply = !queryLooksExternalOrCurrent(text)
      ? await findSemanticCache(req.user.sub, text, userLanguage, queryEmbedding, knowledgeSignature)
      : null;

    if (cachedReply?.text) {
      const safeCachedText = repairMojibakeText(String(cachedReply.text || ""));
      if (responseLooksSelfLimiting(safeCachedText) || responseLooksWeak(safeCachedText)) {
        // Ignore low-quality cache hits so they do not contaminate future streaming responses.
      } else {
      const cachedMetaObject = makeStructuredResponseMeta(responseProfile, {
        response_language: cachedReply.responseLanguage || userLanguage,
        sources: cachedReply.sources || [],
        show_sources: shouldShowSourcesForReply(text),
      });
      const persistMetrics = await persistAssistantTextReply({
        conversationId: id,
        userId: req.user.sub,
        userText: text,
        assistantText: safeCachedText,
        responseProfile,
        responseLanguage: cachedReply.responseLanguage || userLanguage,
        metaObject: cachedMetaObject,
        sources: cachedReply.sources || [],
        relevantMemoryEntries,
        resetMemory: Boolean(topicSnapshot?.topicShift?.isShift),
        recordUsage: Boolean((cachedReply.sources || []).length),
        allowWeakResponseLog: false,
      });
      finalizeChatPerformanceSample(perfSample, {
        total_response_ms: Date.now() - perfSample.started_at,
        api_latency_ms: 0,
        internal_processing_ms: Date.now() - perfSample.started_at,
        context_assembly_ms: Date.now() - contextStartedAt,
        persistence_ms: persistMetrics.persistence_ms,
        prompt_chars: text.length,
        response_chars: safeCachedText.length,
        response_bytes: Buffer.byteLength(String(safeCachedText || ""), "utf8"),
        status: "cache_hit",
      });
      writeEventStreamPacket(res, "done", { reply: safeCachedText, meta: cachedMetaObject });
      return res.end();
      }
    }

    const contextLayers = await buildConversationKnowledgeContext({
      text,
      userLanguage,
      currentUser,
      queryEmbedding,
      supportAssets,
      strategy: contextStrategy,
      preloadedExternalToolContext: quickExternalContext,
    });
    if (contextStrategy.fastTalkersOnly) {
      const talkersDirectReply = buildTalkersContextFallbackAnswer(contextLayers.talkersPublicBundle);
      if (talkersDirectReply) {
        const talkersSources = Array.isArray(contextLayers.talkersPublicBundle?.sources)
          ? contextLayers.talkersPublicBundle.sources.slice(0, 8)
          : [];
        const talkersMetaObject = makeStructuredResponseMeta(responseProfile, {
          response_language: userLanguage,
          sources: talkersSources,
          show_sources: shouldShowSourcesForReply(text),
        });
        const persistMetrics = await persistAssistantTextReply({
          conversationId: id,
          userId: req.user.sub,
          userText: text,
          assistantText: talkersDirectReply,
          responseProfile,
          responseLanguage: userLanguage,
          metaObject: talkersMetaObject,
          sources: talkersSources,
          relevantMemoryEntries,
          resetMemory: Boolean(topicSnapshot?.topicShift?.isShift),
          recordUsage: true,
          allowWeakResponseLog: false,
        });
        finalizeChatPerformanceSample(perfSample, {
          total_response_ms: Date.now() - perfSample.started_at,
          api_latency_ms: 0,
          internal_processing_ms: Date.now() - perfSample.started_at,
          context_assembly_ms: Date.now() - contextStartedAt,
          persistence_ms: persistMetrics.persistence_ms,
          prompt_chars: text.length,
          response_chars: talkersDirectReply.length,
          response_bytes: Buffer.byteLength(String(talkersDirectReply || ""), "utf8"),
          ...mergeToolUsageMetrics(contextLayers.toolMetrics || null),
          status: "talkers_direct_answer",
        });
        writeEventStreamPacket(res, "done", { reply: talkersDirectReply, meta: talkersMetaObject });
        return res.end();
      }
    }
    const contextText = contextLayers.contextText;
    const contextAssemblyMs = Date.now() - contextStartedAt;

    writeEventStreamPacket(res, "stage", {
      stage: "ai",
      label: "Recebendo resposta da IA",
    });

    const assistant = await openaiReplyStream({
      conversationId: id,
      userId: req.user.sub,
      userText: text,
      contextText,
      baseSources: contextLayers.mergedKnowledgeSources,
      topicSnapshot,
      responseProfile,
      contextStrategy,
      currentUser,
      relevantMemoryEntries,
      visionInputs: supportAssets.visionInputs || [],
      documentInputs: supportAssets.documentInputs || [],
      onDelta: async (delta) => {
        writeEventStreamPacket(res, "delta", { delta, text: delta });
      },
    });

    let finalAssistantText = repairMojibakeText(String(assistant.text || "").trim());
    let finalAssistantSources = Array.isArray(assistant.sources) ? assistant.sources : [];
    const combinedToolMetrics = mergeToolUsageMetrics(
      contextLayers.toolMetrics || null,
      assistant.metrics || null
    );

    if (responseLooksSelfLimiting(finalAssistantText) || responseLooksWeak(finalAssistantText)) {
      const directFallback = buildExternalContextFallbackAnswer(contextLayers.externalToolContext, userLanguage);
      if (directFallback) {
        finalAssistantText = directFallback;
        finalAssistantSources = (contextLayers.externalToolContext?.sources || []).slice(0, 8);
      }
    }

    const assistantMetaObject = makeStructuredResponseMeta(responseProfile, {
      response_language: userLanguage,
      sources: finalAssistantSources || [],
      show_sources: shouldShowSourcesForReply(text),
    });
    writeEventStreamPacket(res, "stage", {
      stage: "persist",
      label: "Salvando conversa e telemetria",
    });
    const persistMetrics = await persistAssistantTextReply({
      conversationId: id,
      userId: req.user.sub,
      userText: text,
      assistantText: finalAssistantText,
      responseProfile,
      responseLanguage: userLanguage,
      metaObject: assistantMetaObject,
      sources: finalAssistantSources || [],
      queryEmbedding,
      knowledgeSignature,
      relevantMemoryEntries,
      knowledgeMemoryEntries: contextLayers.knowledgeMemoryEntries,
      resetMemory: Boolean(topicSnapshot?.topicShift?.isShift),
      cacheSemantic: true,
      recordUsage: true,
      allowWeakResponseLog: true,
    });

    finalizeChatPerformanceSample(perfSample, {
      total_response_ms: Date.now() - perfSample.started_at,
      api_latency_ms: Number(assistant?.metrics?.api_latency_ms || 0),
      internal_processing_ms: Math.max(0, (Date.now() - perfSample.started_at) - Number(assistant?.metrics?.api_latency_ms || 0)),
      context_assembly_ms: contextAssemblyMs,
      persistence_ms: persistMetrics.persistence_ms,
      prompt_chars: text.length,
      response_chars: String(finalAssistantText || "").length,
      payload_bytes: Number(assistant?.metrics?.payload_bytes || 0),
      response_bytes: Number(assistant?.metrics?.response_bytes || Buffer.byteLength(String(finalAssistantText || ""), "utf8")),
      ...combinedToolMetrics,
      status: assistant?.metrics?.status || "success",
    });

    writeEventStreamPacket(res, "done", {
      reply: finalAssistantText,
      meta: assistantMetaObject,
      metrics: {
        ...(assistant.metrics || {}),
        ...combinedToolMetrics,
      },
    });
    res.end();
  } catch (err) {
    finalizeChatPerformanceSample(perfSample, {
      total_response_ms: Date.now() - perfSample.started_at,
      api_latency_ms: 0,
      internal_processing_ms: Date.now() - perfSample.started_at,
      prompt_chars: text.length,
      response_chars: 0,
      status: err?.message || "send_stream_failed",
    });
    writeEventStreamPacket(res, "error", {
      error: err?.message || "conversation_send_stream_failed",
    });
    res.end();
  }
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

app.delete("/api/admin/departments/:id", requireAuth(JWT_SECRET), requireRole("admin"), async (req, res) => {
  const departmentId = Number(req.params.id);
  const existing = await get('SELECT id, slug, name FROM departments WHERE id=?', [departmentId]);
  if (!existing) return res.status(404).json({ error: 'not_found' });

  const announcements = await all('SELECT id, department_ids_json FROM intranet_announcements WHERE audience_scope=?', ['departments']);
  for (const announcement of announcements) {
    const currentIds = safeJsonParse(announcement.department_ids_json, []);
    const nextIds = currentIds.map((value) => Number(value || 0)).filter((value) => value && value !== departmentId);
    if (nextIds.length !== currentIds.length) {
      await run(
        "UPDATE intranet_announcements SET department_ids_json=?, updated_at=datetime('now') WHERE id=?",
        [safeJsonStringify(nextIds, '[]'), announcement.id]
      );
    }
  }

  await run("DELETE FROM user_departments WHERE department_id=?", [departmentId]);
  await run("DELETE FROM department_submenus WHERE department_id=?", [departmentId]);
  await run("UPDATE users SET department=NULL WHERE department=?", [existing.name]);
  await run("UPDATE knowledge_sources SET department_name=NULL, updated_at=datetime('now') WHERE department_name=?", [existing.name]);
  await run("UPDATE documents SET department_name=NULL, updated_at=datetime('now') WHERE department_name=?", [existing.name]);
  await run("UPDATE document_chunks SET department_name=NULL, updated_at=datetime('now') WHERE department_name=?", [existing.name]);
  await run("DELETE FROM departments WHERE id=?", [departmentId]);

  await logEvent(req.user.sub, 'admin_delete_department', { department_id: departmentId, name: existing.name, slug: existing.slug });
  res.json({ ok: true });
});

app.get("/api/admin/department-submenus", requireAuth(JWT_SECRET), requireRole("admin"), async (req, res) => {
  const submenus = await listDepartmentSubmenus({ includeInactive: true });
  res.json({ submenus });
});

app.post("/api/admin/department-submenus", requireAuth(JWT_SECRET), requireRole("admin"), async (req, res) => {
  const departmentId = Number(req.body?.department_id || 0);
  const title = String(req.body?.title || '').trim();
  const description = String(req.body?.description || '').trim();
  const icon = String(req.body?.icon || 'layers').trim() || 'layers';
  const isActive = Object.prototype.hasOwnProperty.call(req.body || {}, 'is_active')
    ? parseBooleanInput(req.body?.is_active)
    : true;
  const slug = slugifyDepartmentName(req.body?.slug || title);
  const viewKey = String(req.body?.view_key || slug || '').trim() || slug;

  if (!departmentId || !title || !slug) {
    return res.status(400).json({ error: 'missing_department_submenu_fields' });
  }

  const department = await get('SELECT id, name FROM departments WHERE id=?', [departmentId]);
  if (!department) return res.status(404).json({ error: 'department_not_found' });

  const conflict = await get('SELECT id FROM department_submenus WHERE department_id=? AND slug=? LIMIT 1', [departmentId, slug]);
  if (conflict) return res.status(409).json({ error: 'department_submenu_already_exists' });

  const created = await run(
    "INSERT INTO department_submenus (department_id, title, slug, description, icon, view_key, sort_order, is_active, metadata_json, updated_at) VALUES (?, ?, ?, ?, ?, ?, COALESCE((SELECT MAX(sort_order) + 10 FROM department_submenus WHERE department_id=?), 10), ?, ?, datetime('now'))",
    [departmentId, title, slug, description || null, icon, viewKey, departmentId, isActive, safeJsonStringify({}, '{}')]
  );

  await logEvent(req.user.sub, 'admin_create_department_submenu', { submenu_id: created.lastID, department_id: departmentId, title, slug });
  const submenu = await get(
    `SELECT ds.id, ds.department_id, ds.title, ds.slug, ds.description, ds.icon, ds.view_key, ds.sort_order, ds.is_active, ds.metadata_json, ds.created_at, ds.updated_at,
            d.name AS department_name, d.slug AS department_slug
       FROM department_submenus ds
       JOIN departments d ON d.id = ds.department_id
      WHERE ds.id=?`,
    [created.lastID]
  );
  res.json({ ok: true, submenu: mapDepartmentSubmenuRow(submenu) });
});

app.patch("/api/admin/department-submenus/:id", requireAuth(JWT_SECRET), requireRole("admin"), async (req, res) => {
  const submenuId = Number(req.params.id);
  const existing = await get('SELECT id, department_id, title, slug, description, icon, view_key, is_active FROM department_submenus WHERE id=?', [submenuId]);
  if (!existing) return res.status(404).json({ error: 'not_found' });

  const departmentId = Object.prototype.hasOwnProperty.call(req.body || {}, 'department_id')
    ? Number(req.body?.department_id || 0)
    : Number(existing.department_id || 0);
  const title = Object.prototype.hasOwnProperty.call(req.body || {}, 'title') ? String(req.body?.title || '').trim() : String(existing.title || '').trim();
  const description = Object.prototype.hasOwnProperty.call(req.body || {}, 'description') ? String(req.body?.description || '').trim() : String(existing.description || '').trim();
  const icon = Object.prototype.hasOwnProperty.call(req.body || {}, 'icon') ? String(req.body?.icon || '').trim() : String(existing.icon || 'layers').trim();
  const isActive = Object.prototype.hasOwnProperty.call(req.body || {}, 'is_active') ? parseBooleanInput(req.body?.is_active) : coerceDbBoolean(existing.is_active);
  const slug = slugifyDepartmentName(req.body?.slug || title || existing.slug);
  const viewKey = Object.prototype.hasOwnProperty.call(req.body || {}, 'view_key')
    ? String(req.body?.view_key || '').trim()
    : String(existing.view_key || existing.slug || '').trim();

  if (!departmentId || !title || !slug) {
    return res.status(400).json({ error: 'missing_department_submenu_fields' });
  }

  const department = await get('SELECT id FROM departments WHERE id=?', [departmentId]);
  if (!department) return res.status(404).json({ error: 'department_not_found' });

  const conflict = await get('SELECT id FROM department_submenus WHERE department_id=? AND slug=? AND id<>? LIMIT 1', [departmentId, slug, submenuId]);
  if (conflict) return res.status(409).json({ error: 'department_submenu_already_exists' });

  await run(
    "UPDATE department_submenus SET department_id=?, title=?, slug=?, description=?, icon=?, view_key=?, is_active=?, updated_at=datetime('now') WHERE id=?",
    [departmentId, title, slug, description || null, icon || 'layers', viewKey || slug, isActive, submenuId]
  );

  await logEvent(req.user.sub, 'admin_update_department_submenu', { submenu_id: submenuId, department_id: departmentId, title, slug });
  const submenu = await get(
    `SELECT ds.id, ds.department_id, ds.title, ds.slug, ds.description, ds.icon, ds.view_key, ds.sort_order, ds.is_active, ds.metadata_json, ds.created_at, ds.updated_at,
            d.name AS department_name, d.slug AS department_slug
       FROM department_submenus ds
       JOIN departments d ON d.id = ds.department_id
      WHERE ds.id=?`,
    [submenuId]
  );
  res.json({ ok: true, submenu: mapDepartmentSubmenuRow(submenu) });
});

app.delete("/api/admin/department-submenus/:id", requireAuth(JWT_SECRET), requireRole("admin"), async (req, res) => {
  const submenuId = Number(req.params.id);
  const existing = await get('SELECT id, department_id, title, slug FROM department_submenus WHERE id=?', [submenuId]);
  if (!existing) return res.status(404).json({ error: 'not_found' });

  await run("DELETE FROM department_submenus WHERE id=?", [submenuId]);
  await logEvent(req.user.sub, 'admin_delete_department_submenu', { submenu_id: submenuId, department_id: existing.department_id, title: existing.title, slug: existing.slug });
  res.json({ ok: true });
});

app.get("/api/admin/intranet/announcements", requireAuth(JWT_SECRET), requireRole("admin"), async (req, res) => {
  const announcements = await listIntranetAnnouncements({ includeInactive: true, limit: 200 });
  res.json({ announcements });
});

app.post("/api/admin/intranet/announcements", requireAuth(JWT_SECRET), requireRole("admin"), async (req, res) => {
  const title = String(req.body?.title || '').trim();
  const contentText = String(req.body?.content_text || '').trim();
  const summaryText = String(req.body?.summary_text || '').trim();
  const audienceScope = String(req.body?.audience_scope || 'all').trim() === 'departments' ? 'departments' : 'all';
  const departmentIds = audienceScope === 'departments'
    ? parseDepartmentInput(req.body?.department_ids).map((value) => Number(value || 0)).filter(Boolean)
    : [];
  const announcementType = String(req.body?.announcement_type || 'announcement').trim() || 'announcement';
  const priority = String(req.body?.priority || 'normal').trim() || 'normal';
  const isPinned = parseBooleanInput(req.body?.is_pinned);
  const isActive = Object.prototype.hasOwnProperty.call(req.body || {}, 'is_active') ? parseBooleanInput(req.body?.is_active) : true;
  const startsAt = String(req.body?.starts_at || '').trim() || null;
  const endsAt = String(req.body?.ends_at || '').trim() || null;

  if (!title || !contentText) {
    return res.status(400).json({ error: 'missing_announcement_fields' });
  }

  const created = await run(
    "INSERT INTO intranet_announcements (title, content_text, summary_text, audience_scope, department_ids_json, announcement_type, priority, is_pinned, is_active, starts_at, ends_at, author_user_id, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))",
    [title, contentText, summaryText || null, audienceScope, safeJsonStringify(departmentIds, '[]'), announcementType, priority, isPinned, isActive, startsAt, endsAt, req.user.sub]
  );
  await logEvent(req.user.sub, 'admin_create_intranet_announcement', { announcement_id: created.lastID, title, audience_scope: audienceScope });
  const announcement = await all(
    `SELECT intranet_announcements.id,
            intranet_announcements.title,
            intranet_announcements.content_text,
            intranet_announcements.summary_text,
            intranet_announcements.audience_scope,
            intranet_announcements.department_ids_json,
            intranet_announcements.announcement_type,
            intranet_announcements.priority,
            intranet_announcements.is_pinned,
            intranet_announcements.is_active,
            intranet_announcements.starts_at,
            intranet_announcements.ends_at,
            intranet_announcements.author_user_id,
            intranet_announcements.created_at,
            intranet_announcements.updated_at,
            users.name AS author_name
       FROM intranet_announcements
  LEFT JOIN users ON users.id = intranet_announcements.author_user_id
      WHERE intranet_announcements.id=?`,
    [created.lastID]
  );
  res.json({ ok: true, announcement: mapAnnouncementRow(announcement[0]) });
});

app.patch("/api/admin/intranet/announcements/:id", requireAuth(JWT_SECRET), requireRole("admin"), async (req, res) => {
  const announcementId = Number(req.params.id);
  const existing = await get('SELECT * FROM intranet_announcements WHERE id=?', [announcementId]);
  if (!existing) return res.status(404).json({ error: 'not_found' });

  const audienceScope = Object.prototype.hasOwnProperty.call(req.body || {}, 'audience_scope')
    ? (String(req.body?.audience_scope || 'all').trim() === 'departments' ? 'departments' : 'all')
    : String(existing.audience_scope || 'all');
  const departmentIds = Object.prototype.hasOwnProperty.call(req.body || {}, 'department_ids')
    ? (audienceScope === 'departments'
      ? parseDepartmentInput(req.body?.department_ids).map((value) => Number(value || 0)).filter(Boolean)
      : [])
    : (safeJsonParse(existing.department_ids_json || '[]') || []);

  const title = Object.prototype.hasOwnProperty.call(req.body || {}, 'title') ? String(req.body?.title || '').trim() : String(existing.title || '').trim();
  const contentText = Object.prototype.hasOwnProperty.call(req.body || {}, 'content_text') ? String(req.body?.content_text || '').trim() : String(existing.content_text || '').trim();
  const summaryText = Object.prototype.hasOwnProperty.call(req.body || {}, 'summary_text') ? String(req.body?.summary_text || '').trim() : String(existing.summary_text || '').trim();
  const announcementType = Object.prototype.hasOwnProperty.call(req.body || {}, 'announcement_type') ? String(req.body?.announcement_type || '').trim() : String(existing.announcement_type || 'announcement').trim();
  const priority = Object.prototype.hasOwnProperty.call(req.body || {}, 'priority') ? String(req.body?.priority || '').trim() : String(existing.priority || 'normal').trim();
  const isPinned = Object.prototype.hasOwnProperty.call(req.body || {}, 'is_pinned') ? parseBooleanInput(req.body?.is_pinned) : coerceDbBoolean(existing.is_pinned);
  const isActive = Object.prototype.hasOwnProperty.call(req.body || {}, 'is_active') ? parseBooleanInput(req.body?.is_active) : coerceDbBoolean(existing.is_active);
  const startsAt = Object.prototype.hasOwnProperty.call(req.body || {}, 'starts_at') ? (String(req.body?.starts_at || '').trim() || null) : existing.starts_at;
  const endsAt = Object.prototype.hasOwnProperty.call(req.body || {}, 'ends_at') ? (String(req.body?.ends_at || '').trim() || null) : existing.ends_at;

  if (!title || !contentText) {
    return res.status(400).json({ error: 'missing_announcement_fields' });
  }

  await run(
    "UPDATE intranet_announcements SET title=?, content_text=?, summary_text=?, audience_scope=?, department_ids_json=?, announcement_type=?, priority=?, is_pinned=?, is_active=?, starts_at=?, ends_at=?, updated_at=datetime('now') WHERE id=?",
    [title, contentText, summaryText || null, audienceScope, safeJsonStringify(departmentIds, '[]'), announcementType || 'announcement', priority || 'normal', isPinned, isActive, startsAt, endsAt, announcementId]
  );
  await logEvent(req.user.sub, 'admin_update_intranet_announcement', { announcement_id: announcementId, title, audience_scope: audienceScope });
  const announcement = await all(
    `SELECT intranet_announcements.id,
            intranet_announcements.title,
            intranet_announcements.content_text,
            intranet_announcements.summary_text,
            intranet_announcements.audience_scope,
            intranet_announcements.department_ids_json,
            intranet_announcements.announcement_type,
            intranet_announcements.priority,
            intranet_announcements.is_pinned,
            intranet_announcements.is_active,
            intranet_announcements.starts_at,
            intranet_announcements.ends_at,
            intranet_announcements.author_user_id,
            intranet_announcements.created_at,
            intranet_announcements.updated_at,
            users.name AS author_name
       FROM intranet_announcements
  LEFT JOIN users ON users.id = intranet_announcements.author_user_id
      WHERE intranet_announcements.id=?`,
    [announcementId]
  );
  res.json({ ok: true, announcement: mapAnnouncementRow(announcement[0]) });
});

app.delete("/api/admin/intranet/announcements/:id", requireAuth(JWT_SECRET), requireRole("admin"), async (req, res) => {
  const announcementId = Number(req.params.id);
  const existing = await get('SELECT id, title FROM intranet_announcements WHERE id=?', [announcementId]);
  if (!existing) return res.status(404).json({ error: 'not_found' });
  await run("DELETE FROM intranet_announcements WHERE id=?", [announcementId]);
  await logEvent(req.user.sub, 'admin_delete_intranet_announcement', { announcement_id: announcementId, title: existing.title });
  res.json({ ok: true });
});

app.get("/api/admin/system-logs", requireAuth(JWT_SECRET), requireRole("admin"), async (req, res) => {
  const [auditRows, processingRows, trainingRows, calendarRows] = await Promise.all([
    all(`SELECT audit_log.id, audit_log.user_id, audit_log.action, audit_log.meta_json, audit_log.created_at, users.name AS actor_name
           FROM audit_log
      LEFT JOIN users ON users.id = audit_log.user_id
          ORDER BY datetime(audit_log.created_at) DESC, audit_log.id DESC
          LIMIT 120`),
    all(`SELECT knowledge_processing_logs.id, knowledge_processing_logs.knowledge_source_id, knowledge_processing_logs.stage_key, knowledge_processing_logs.stage_status,
                knowledge_processing_logs.message, knowledge_processing_logs.detail_json, knowledge_processing_logs.actor_user_id, knowledge_processing_logs.created_at,
                users.name AS actor_name, knowledge_sources.original_name AS file_name
           FROM knowledge_processing_logs
      LEFT JOIN users ON users.id = knowledge_processing_logs.actor_user_id
      LEFT JOIN knowledge_sources ON knowledge_sources.id = knowledge_processing_logs.knowledge_source_id
          ORDER BY datetime(knowledge_processing_logs.created_at) DESC, knowledge_processing_logs.id DESC
          LIMIT 120`),
    all(`SELECT ai_training_events.id, ai_training_events.user_id, ai_training_events.conversation_id, ai_training_events.knowledge_source_id, ai_training_events.event_type,
                ai_training_events.event_status, ai_training_events.title, ai_training_events.detail_text, ai_training_events.meta_json, ai_training_events.created_at,
                users.name AS actor_name
           FROM ai_training_events
      LEFT JOIN users ON users.id = ai_training_events.user_id
          ORDER BY datetime(ai_training_events.created_at) DESC, ai_training_events.id DESC
          LIMIT 120`),
    all(`SELECT calendar_event_logs.id, calendar_event_logs.event_id, calendar_event_logs.action, calendar_event_logs.field_name, calendar_event_logs.old_value,
                calendar_event_logs.new_value, calendar_event_logs.detail_json, calendar_event_logs.created_at, users.name AS actor_name,
                calendar_events.title AS event_title
           FROM calendar_event_logs
      LEFT JOIN users ON users.id = calendar_event_logs.actor_user_id
      LEFT JOIN calendar_events ON calendar_events.id = calendar_event_logs.event_id
          ORDER BY datetime(calendar_event_logs.created_at) DESC, calendar_event_logs.id DESC
          LIMIT 120`),
  ]);

  res.json({
    audit_logs: auditRows || [],
    processing_logs: processingRows || [],
    training_logs: trainingRows || [],
    calendar_logs: calendarRows || [],
  });
});

app.get("/api/admin/cockpit", requireAuth(JWT_SECRET), requireRole("admin"), async (req, res) => {
  try {
    const cockpit = await buildAdminCockpitPayload();
    res.json({ cockpit });
  } catch (err) {
    res.status(500).json({ error: err?.message || "admin_cockpit_failed" });
  }
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
  const rows = await all(
    `SELECT ks.id, ks.original_name, ks.stored_name, ks.mime_type, ks.language, ks.department_name, ks.source_kind, ks.sync_status,
            ks.openai_file_id, ks.vector_store_file_id, ks.uploaded_by, ks.processing_state_json, ks.created_at, ks.updated_at,
            COUNT(me.id) AS knowledge_memory_total
       FROM knowledge_sources ks
  LEFT JOIN memory_entries me
         ON me.knowledge_source_id = ks.id
        AND me.memory_scope = ?
      GROUP BY ks.id, ks.original_name, ks.stored_name, ks.mime_type, ks.language, ks.department_name, ks.source_kind,
               ks.sync_status, ks.openai_file_id, ks.vector_store_file_id, ks.uploaded_by, ks.processing_state_json, ks.created_at, ks.updated_at`,
    [KNOWLEDGE_MEMORY_SCOPE]
  );
  const counts = summarizeKnowledgeAdminRows(rows.map((row) => buildKnowledgeAdminRow(row)));
  res.json({
    ok: true,
    vector_store_configured: Boolean(OPENAI_VECTOR_STORE_ID),
    openai_api_configured: Boolean(process.env.OPENAI_API_KEY),
    vector_store_id: OPENAI_VECTOR_STORE_ID || null,
    local_dir: knowledgeDir,
    counts,
    needs_reprocess: counts.needs_reprocess,
    recent_failures: counts.failed,
    available_to_ai: counts.available,
    background: {
      running: knowledgeBackgroundState.running,
      queued: knowledgeBackgroundState.queue.length,
      processed: Number(knowledgeBackgroundState.queue_processed || 0),
      failed: Number(knowledgeBackgroundState.queue_failed || 0),
      current_source_id: knowledgeBackgroundState.current_source_id || null,
      last_error: knowledgeBackgroundState.last_error || "",
    },
    checked_at: new Date().toISOString(),
  });
});

app.post("/api/admin/rag/cleanup-incompatible", requireAuth(JWT_SECRET), requireRole("admin"), async (req, res) => {
  try {
    const summary = await purgeIncompatibleKnowledgeAssets(req.user.sub);
    res.json({ ok: true, summary });
  } catch (err) {
    console.log("Erro ao limpar arquivos incompatíveis da base:", err?.message || err);
    res.status(500).json({ error: err?.message || "knowledge_cleanup_failed" });
  }
});

app.get("/api/admin/rag/files", requireAuth(JWT_SECRET), requireRole("admin"), async (req, res) => {
  const [files, totalRow] = await Promise.all([
    all(
      `SELECT ks.id, ks.original_name, ks.stored_name, ks.mime_type, ks.language, ks.content_hash, ks.department_name, ks.source_kind, ks.sync_status,
              ks.openai_file_id, ks.vector_store_file_id, ks.uploaded_by, ks.processing_state_json, ks.created_at, ks.updated_at,
              COUNT(me.id) AS knowledge_memory_total
         FROM knowledge_sources ks
    LEFT JOIN memory_entries me
           ON me.knowledge_source_id = ks.id
          AND me.memory_scope = ?
        GROUP BY ks.id, ks.original_name, ks.stored_name, ks.mime_type, ks.language, ks.content_hash, ks.department_name, ks.source_kind,
                 ks.sync_status, ks.openai_file_id, ks.vector_store_file_id, ks.uploaded_by, ks.processing_state_json, ks.created_at, ks.updated_at
        ORDER BY datetime(ks.updated_at) DESC, ks.id DESC
        LIMIT 50`,
      [KNOWLEDGE_MEMORY_SCOPE]
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

app.post("/api/admin/rag/reprocess-pending", requireAuth(JWT_SECRET), requireRole("admin"), async (req, res) => {
  try {
    const added = await enqueuePendingKnowledgeSourcesBatch(Number(req.body?.limit || BACKGROUND_KNOWLEDGE_SWEEP_BATCH));
    res.json({
      ok: true,
      queued: added,
      background: {
        running: knowledgeBackgroundState.running,
        queued: knowledgeBackgroundState.queue.length,
        processed: Number(knowledgeBackgroundState.queue_processed || 0),
        failed: Number(knowledgeBackgroundState.queue_failed || 0),
        current_source_id: knowledgeBackgroundState.current_source_id || null,
      },
    });
  } catch (err) {
    res.status(400).json({ error: err?.message || "knowledge_bulk_reprocess_failed" });
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
  if (codes.every((code) => code === 'unsupported_knowledge_file' || code === 'blocked_knowledge_file')) return 400;
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
    deleteFileIfExists(tempPath);
    throw new Error("knowledge_file_too_large");
  }

  const compatibility = classifyKnowledgeCompatibility({
    originalName: safeOriginalName,
    mimeType: uploaded.mimetype || "",
    filePath: tempPath,
  });
  if (!compatibility.allowed) {
    deleteFileIfExists(tempPath);
    throw new Error(compatibility.reason);
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
          : "Não foi possível gerar texto a partir da mídia.",
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

    const analysisResult = await runKnowledgeSemanticAnalysisStage({
      knowledgeSourceId,
      source: await getKnowledgeSourceById(knowledgeSourceId),
      state,
      actorUserId: userId,
    });
    state = analysisResult.state;

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
      analysis_status: finalRow.analysis_status,
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
        : state.analysis?.status === "processing"
          ? "analysis"
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

async function reprocessKnowledgeSourceById(knowledgeSourceId, actorUserId, options = {}) {
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

    const analysisResult = await runKnowledgeSemanticAnalysisStage({
      knowledgeSourceId,
      source: await getKnowledgeSourceById(knowledgeSourceId),
      state,
      actorUserId,
    });
    state = analysisResult.state;

    const canReuseVectorStore = Boolean(options.skipVectorStoreUpload) && Boolean(source.vector_store_file_id);
    if (process.env.OPENAI_API_KEY && OPENAI_VECTOR_STORE_ID && !canReuseVectorStore) {
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
    } else if (canReuseVectorStore) {
      const refreshedSource = await refreshKnowledgeSourceVectorStatus(source, { force: false });
      const refreshedState = getKnowledgeProcessingState(refreshedSource || source);
      state = withKnowledgeStage(state, "vector_store", {
        status: normalizeStageStatus(refreshedState.vector_store?.status, "completed"),
        file_id: refreshedState.vector_store?.file_id || source.openai_file_id || null,
        vector_store_file_id: refreshedState.vector_store?.vector_store_file_id || source.vector_store_file_id || null,
        file_status: refreshedState.vector_store?.file_status || null,
        vector_status: refreshedState.vector_store?.vector_status || null,
        message: "Vector Store reaproveitada sem reenviar o arquivo.",
      });
      await updateKnowledgeSourceFields(knowledgeSourceId, {
        openai_file_id: source.openai_file_id || null,
        vector_store_file_id: source.vector_store_file_id || null,
        processing_state_json: safeJsonStringify(state, "{}"),
        sync_status: "processing",
      });
      await appendKnowledgeProcessingLog(
        knowledgeSourceId,
        "vector_store",
        state.vector_store.status,
        "Vector Store reaproveitada durante o reprocessamento.",
        {
          openai_file_id: source.openai_file_id || null,
          vector_store_file_id: source.vector_store_file_id || null,
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
        : state.analysis?.status === "processing"
          ? "analysis"
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
  const [
    allSourceRows,
    recentLogs,
    recentEvents,
    recentMemoryRows,
    memoryTopicRows,
    topUsedRows,
    totalMemoryRow,
    documentMemoryRow,
    conversationalMemoryRow,
    usedKnowledgeRow,
  ] = await Promise.all([
    all(`SELECT ks.id, ks.original_name, ks.stored_name, ks.mime_type, ks.language, ks.department_name, ks.source_kind, ks.sync_status,
                ks.openai_file_id, ks.vector_store_file_id, ks.uploaded_by, ks.processing_state_json, ks.created_at, ks.updated_at,
                COUNT(me.id) AS knowledge_memory_total
           FROM knowledge_sources ks
      LEFT JOIN memory_entries me
             ON me.knowledge_source_id = ks.id
            AND me.memory_scope = ?
          GROUP BY ks.id, ks.original_name, ks.stored_name, ks.mime_type, ks.language, ks.department_name, ks.source_kind,
                   ks.sync_status, ks.openai_file_id, ks.vector_store_file_id, ks.uploaded_by, ks.processing_state_json, ks.created_at, ks.updated_at
          ORDER BY datetime(ks.updated_at) DESC, ks.id DESC`, [KNOWLEDGE_MEMORY_SCOPE]),
    all(`SELECT id, knowledge_source_id, stage_key, stage_status, message, detail_json, actor_user_id, created_at
           FROM knowledge_processing_logs
          ORDER BY datetime(created_at) DESC, id DESC
          LIMIT 80`),
    all(`SELECT id, user_id, conversation_id, knowledge_source_id, event_type, event_status, title, detail_text, meta_json, created_at
           FROM ai_training_events
          ORDER BY datetime(created_at) DESC, id DESC
          LIMIT 80`),
    all(`SELECT id, user_id, conversation_id, knowledge_source_id, memory_scope, memory_kind, title, content_text, topics_json, language, created_at, updated_at
           FROM memory_entries
          ORDER BY datetime(updated_at) DESC, id DESC
          LIMIT 120`),
    all(`SELECT topics_json, memory_scope, memory_kind FROM memory_entries`),
    all(`SELECT ai_training_events.knowledge_source_id, COUNT(*) AS total, MAX(knowledge_sources.original_name) AS name
           FROM ai_training_events
      LEFT JOIN knowledge_sources ON knowledge_sources.id = ai_training_events.knowledge_source_id
          WHERE event_type='knowledge_used' AND ai_training_events.knowledge_source_id IS NOT NULL
          GROUP BY ai_training_events.knowledge_source_id
          ORDER BY total DESC
          LIMIT 10`),
    get("SELECT COUNT(*) AS total FROM memory_entries", []),
    get("SELECT COUNT(*) AS total FROM memory_entries WHERE memory_scope=?", [KNOWLEDGE_MEMORY_SCOPE]),
    get("SELECT COUNT(*) AS total FROM memory_entries WHERE memory_scope<>?", [KNOWLEDGE_MEMORY_SCOPE]),
    get("SELECT COUNT(DISTINCT knowledge_source_id) AS total FROM ai_training_events WHERE event_type='knowledge_used' AND knowledge_source_id IS NOT NULL", []),
  ]);

  const knowledgeRows = allSourceRows.map((source) => buildKnowledgeAdminRow(source));
  const counts = summarizeKnowledgeAdminRows(knowledgeRows);
  const needsReprocessRows = knowledgeRows.filter((row) => needsKnowledgeReprocess(row)).slice(0, 24);
  const failedRows = knowledgeRows
    .filter((row) => row.availability_status === "failed" || row.issue_count > 0)
    .slice(0, 24);

  const topicCounter = new Map();
  for (const row of memoryTopicRows) {
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
      counts: {
        ...counts,
        documents_with_memory: Number(documentMemoryRow?.total || 0),
        documents_used_in_responses: Number(usedKnowledgeRow?.total || 0),
      },
      files: knowledgeRows.slice(0, 40),
      needs_reprocess: needsReprocessRows,
      recent_failures: failedRows,
      top_documents: topDocuments,
    },
    processing_logs: recentLogs,
    memories: {
      total: Number(totalMemoryRow?.total || 0),
      document_total: Number(documentMemoryRow?.total || 0),
      conversational_total: Number(conversationalMemoryRow?.total || 0),
      recent: recentMemoryRows.slice(0, 20),
      top_topics: topTopics,
      by_scope: recentMemoryRows.reduce((acc, row) => {
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
    background: {
      running: knowledgeBackgroundState.running,
      queued: knowledgeBackgroundState.queue.length,
      processed: Number(knowledgeBackgroundState.queue_processed || 0),
      failed: Number(knowledgeBackgroundState.queue_failed || 0),
      enqueued: Number(knowledgeBackgroundState.queue_enqueued || 0),
      current_source_id: knowledgeBackgroundState.current_source_id || null,
      last_started_at: knowledgeBackgroundState.last_started_at || null,
      last_finished_at: knowledgeBackgroundState.last_finished_at || null,
      last_error: knowledgeBackgroundState.last_error || "",
      last_sweep_at: knowledgeBackgroundState.last_sweep_at || null,
    },
  };
}

function enqueueKnowledgeSourceForBackgroundReprocess(knowledgeSourceId, options = {}) {
  const safeId = Number(knowledgeSourceId || 0);
  if (!safeId || knowledgeBackgroundState.queuedIds.has(safeId)) return false;
  knowledgeBackgroundState.queue.push({
    id: safeId,
    actorUserId: options.actorUserId || null,
    reason: options.reason || "background_backfill",
  });
  knowledgeBackgroundState.queuedIds.add(safeId);
  knowledgeBackgroundState.queue_enqueued += 1;
  setTimeout(() => {
    runKnowledgeBackgroundWorker().catch((err) => {
      console.log("Erro no worker de reprocessamento em background:", err?.message || err);
    });
  }, 0);
  return true;
}

async function enqueuePendingKnowledgeSourcesBatch(limit = BACKGROUND_KNOWLEDGE_SWEEP_BATCH) {
  const rows = await all(
    `SELECT ks.id, ks.sync_status, ks.vector_store_file_id, ks.processing_state_json, ks.updated_at,
            COUNT(me.id) AS knowledge_memory_total
       FROM knowledge_sources ks
  LEFT JOIN memory_entries me
         ON me.knowledge_source_id = ks.id
        AND me.memory_scope = ?
      GROUP BY ks.id, ks.sync_status, ks.vector_store_file_id, ks.processing_state_json, ks.updated_at
      ORDER BY datetime(ks.updated_at) DESC, ks.id DESC`,
    [KNOWLEDGE_MEMORY_SCOPE]
  );

  let added = 0;
  for (const row of rows) {
    if (added >= limit) break;
    const adminRow = buildKnowledgeAdminRow(row);
    if (!needsKnowledgeReprocess(adminRow)) continue;
    if (enqueueKnowledgeSourceForBackgroundReprocess(row.id, { reason: "auto_backfill" })) {
      added += 1;
    }
  }

  knowledgeBackgroundState.last_sweep_at = new Date().toISOString();
  return added;
}

async function runKnowledgeBackgroundWorker() {
  if (knowledgeBackgroundState.running) return;
  knowledgeBackgroundState.running = true;
  knowledgeBackgroundState.last_started_at = new Date().toISOString();

  try {
    while (knowledgeBackgroundState.queue.length) {
      const nextItem = knowledgeBackgroundState.queue.shift();
      if (!nextItem) continue;
      knowledgeBackgroundState.queuedIds.delete(Number(nextItem.id));
      knowledgeBackgroundState.current_source_id = Number(nextItem.id);

      try {
        const source = await getKnowledgeSourceById(nextItem.id);
        const shouldReuseVector = Boolean(source?.vector_store_file_id);
        await reprocessKnowledgeSourceById(nextItem.id, nextItem.actorUserId, {
          skipVectorStoreUpload: shouldReuseVector,
          reason: nextItem.reason || "background_backfill",
        });
        knowledgeBackgroundState.queue_processed += 1;
        knowledgeBackgroundState.last_error = "";
      } catch (err) {
        knowledgeBackgroundState.queue_failed += 1;
        knowledgeBackgroundState.last_error = err?.message || "knowledge_background_reprocess_failed";
        console.log("Falha no reprocessamento em background:", err?.message || err);
      } finally {
        knowledgeBackgroundState.current_source_id = null;
      }
    }
  } finally {
    knowledgeBackgroundState.running = false;
    knowledgeBackgroundState.last_finished_at = new Date().toISOString();
  }
}

function scheduleKnowledgeBackfillSweep(delayMs = BACKGROUND_KNOWLEDGE_SWEEP_INTERVAL_MS) {
  if (knowledgeBackgroundState.sweepScheduled) return;
  knowledgeBackgroundState.sweepScheduled = true;
  setTimeout(async () => {
    knowledgeBackgroundState.sweepScheduled = false;
    try {
      const added = await enqueuePendingKnowledgeSourcesBatch(BACKGROUND_KNOWLEDGE_SWEEP_BATCH);
      if (knowledgeBackgroundState.queue.length && !knowledgeBackgroundState.running) {
        runKnowledgeBackgroundWorker().catch((err) => {
          knowledgeBackgroundState.last_error = err?.message || "knowledge_background_worker_failed";
          console.log("Erro ao reiniciar worker de conhecimento:", err?.message || err);
        });
      }
      if (added > 0 || knowledgeBackgroundState.queue.length) {
        scheduleKnowledgeBackfillSweep(BACKGROUND_KNOWLEDGE_SWEEP_INTERVAL_MS);
      } else {
        scheduleKnowledgeBackfillSweep(BACKGROUND_KNOWLEDGE_IDLE_INTERVAL_MS);
      }
    } catch (err) {
      knowledgeBackgroundState.last_error = err?.message || "knowledge_backfill_sweep_failed";
      console.log("Erro ao varrer base para backfill documental:", err?.message || err);
      scheduleKnowledgeBackfillSweep(BACKGROUND_KNOWLEDGE_IDLE_INTERVAL_MS);
    }
  }, Math.max(1000, Number(delayMs || BACKGROUND_KNOWLEDGE_SWEEP_INTERVAL_MS)));
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
      deleteFileIfExists(uploaded?.path || (uploaded?.filename ? path.join(uploadsDir, uploaded.filename) : ""));
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

app.get("/api/intranet/calendar/bootstrap", requireAuth(JWT_SECRET), requireIntranetAccess, async (req, res) => {
  const user = req.currentUser || await getUserById(req.user.sub);
  const calendar = await buildCalendarBootstrap(user);
  res.json({ calendar });
});

app.get("/api/intranet/calendar/events", requireAuth(JWT_SECRET), requireIntranetAccess, async (req, res) => {
  const user = req.currentUser || await getUserById(req.user.sub);
  const range = getCalendarRangeFromQuery(req.query || {});
  const events = await listCalendarEventsForUser(user, {
    from: range.from,
    to: range.to,
    participantId: req.query?.user_id,
    typeId: req.query?.event_type_id,
    mode: req.query?.meeting_mode,
    status: req.query?.status,
    search: req.query?.search,
    limit: Math.min(250, Math.max(1, Number(req.query?.limit || 180))),
  });
  res.json({ events, range });
});

app.get("/api/intranet/calendar/events/:id", requireAuth(JWT_SECRET), requireIntranetAccess, async (req, res) => {
  const user = req.currentUser || await getUserById(req.user.sub);
  const eventId = Number(req.params.id);
  const eventRow = await getCalendarEventById(eventId);
  if (!eventRow) return res.status(404).json({ error: "not_found" });
  const participants = await getCalendarEventParticipants(eventId);
  if (!canAccessCalendarEvent(user, eventRow, participants)) {
    return res.status(403).json({ error: "forbidden" });
  }
  const history = await getCalendarEventHistory(eventId);
  res.json({ event: serializeCalendarEvent(eventRow, participants), history });
});

app.post("/api/intranet/calendar/events", requireAuth(JWT_SECRET), requireIntranetAccess, async (req, res) => {
  try {
    const user = req.currentUser || await getUserById(req.user.sub);
    const event = await createCalendarEvent(req.body || {}, user);
    const history = await getCalendarEventHistory(event.id);
    res.json({ ok: true, event, history });
  } catch (err) {
    res.status(400).json({ error: err?.message || "calendar_event_create_failed" });
  }
});

app.patch("/api/intranet/calendar/events/:id", requireAuth(JWT_SECRET), requireIntranetAccess, async (req, res) => {
  try {
    const user = req.currentUser || await getUserById(req.user.sub);
    const eventId = Number(req.params.id);
    const updated = await updateCalendarEvent(eventId, req.body || {}, user);
    res.json({ ok: true, event: updated.event, history: updated.history });
  } catch (err) {
    if (err?.message === "not_found") return res.status(404).json({ error: "not_found" });
    if (err?.message === "forbidden") return res.status(403).json({ error: "forbidden" });
    res.status(400).json({ error: err?.message || "calendar_event_update_failed" });
  }
});

app.post("/api/intranet/calendar/events/:id/cancel", requireAuth(JWT_SECRET), requireIntranetAccess, async (req, res) => {
  try {
    const user = req.currentUser || await getUserById(req.user.sub);
    const eventId = Number(req.params.id);
    const cancelled = await cancelCalendarEvent(eventId, req.body || {}, user);
    res.json({ ok: true, event: cancelled.event, history: cancelled.history });
  } catch (err) {
    if (err?.message === "not_found") return res.status(404).json({ error: "not_found" });
    if (err?.message === "forbidden") return res.status(403).json({ error: "forbidden" });
    res.status(400).json({ error: err?.message || "calendar_event_cancel_failed" });
  }
});

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

app.get("/api/intranet/marketing/influencers/bootstrap", requireAuth(JWT_SECRET), requireIntranetAccess, async (req, res) => {
  try {
    const user = req.currentUser || await getUserById(req.user.sub);
    const marketing = await buildMarketingInfluencerBootstrap(user, req.query || {});
    res.json({ marketing });
  } catch (err) {
    if (err?.message === "marketing_access_denied") {
      return res.status(403).json({ error: "marketing_access_denied" });
    }
    if (err?.message === "marketing_department_not_found") {
      return res.status(404).json({ error: "marketing_department_not_found" });
    }
    res.status(400).json({ error: err?.message || "marketing_bootstrap_failed" });
  }
});

app.post("/api/intranet/marketing/influencers", requireAuth(JWT_SECRET), requireIntranetAccess, async (req, res) => {
  try {
    const user = req.currentUser || await getUserById(req.user.sub);
    const influencer = await saveMarketingInfluencer(req.body || {}, user);
    res.json({ ok: true, influencer });
  } catch (err) {
    if (err?.message === "marketing_access_denied") {
      return res.status(403).json({ error: "marketing_access_denied" });
    }
    res.status(400).json({ error: err?.message || "marketing_influencer_create_failed" });
  }
});

app.get("/api/intranet/marketing/influencers/:id", requireAuth(JWT_SECRET), requireIntranetAccess, async (req, res) => {
  try {
    const user = req.currentUser || await getUserById(req.user.sub);
    const detail = await buildMarketingInfluencerDetail(user, Number(req.params.id), req.query || {});
    res.json(detail);
  } catch (err) {
    if (err?.message === "not_found") {
      return res.status(404).json({ error: "not_found" });
    }
    if (err?.message === "marketing_access_denied") {
      return res.status(403).json({ error: "marketing_access_denied" });
    }
    res.status(400).json({ error: err?.message || "marketing_influencer_detail_failed" });
  }
});

app.post("/api/intranet/marketing/influencers/:id/metrics", requireAuth(JWT_SECRET), requireIntranetAccess, async (req, res) => {
  try {
    const user = req.currentUser || await getUserById(req.user.sub);
    const metric = await createMarketingInfluencerMetric(Number(req.params.id), req.body || {}, user);
    res.json({ ok: true, metric });
  } catch (err) {
    if (err?.message === "not_found") {
      return res.status(404).json({ error: "not_found" });
    }
    if (err?.message === "marketing_access_denied") {
      return res.status(403).json({ error: "marketing_access_denied" });
    }
    res.status(400).json({ error: err?.message || "marketing_metric_create_failed" });
  }
});

app.post("/api/intranet/marketing/influencers/analyze", requireAuth(JWT_SECRET), requireIntranetAccess, async (req, res) => {
  try {
    const user = req.currentUser || await getUserById(req.user.sub);
    const analysis = await buildMarketingInfluencerAnalysis(user, req.body || {});
    res.json({ ok: true, ...analysis });
  } catch (err) {
    if (err?.message === "marketing_access_denied") {
      return res.status(403).json({ error: "marketing_access_denied" });
    }
    res.status(400).json({ error: err?.message || "marketing_analysis_failed" });
  }
});

app.get("/api/intranet/marketing/indicators/bootstrap", requireAuth(JWT_SECRET), requireIntranetAccess, async (req, res) => {
  try {
    const user = req.currentUser || await getUserById(req.user.sub);
    const indicators = await buildMarketingIndicatorBootstrap(user, req.query || {});
    res.json({ indicators });
  } catch (err) {
    if (err?.message === "marketing_access_denied") {
      return res.status(403).json({ error: "marketing_access_denied" });
    }
    if (err?.message === "marketing_department_not_found") {
      return res.status(404).json({ error: "marketing_department_not_found" });
    }
    res.status(400).json({ error: err?.message || "marketing_indicator_bootstrap_failed" });
  }
});

app.post("/api/intranet/marketing/indicators/tabs/:id/rows", requireAuth(JWT_SECRET), requireIntranetAccess, async (req, res) => {
  try {
    const user = req.currentUser || await getUserById(req.user.sub);
    const row = await saveMarketingIndicatorRow(Number(req.params.id), req.body || {}, user);
    res.json({ ok: true, row });
  } catch (err) {
    if (err?.message === "marketing_access_denied") {
      return res.status(403).json({ error: "marketing_access_denied" });
    }
    if (err?.message === "marketing_indicator_tab_not_found") {
      return res.status(404).json({ error: "marketing_indicator_tab_not_found" });
    }
    res.status(400).json({ error: err?.message || "marketing_indicator_row_create_failed" });
  }
});

app.get("/api/intranet/pedagogico/whatsapp/bootstrap", requireAuth(JWT_SECRET), requireIntranetAccess, async (req, res) => {
  try {
    const user = req.currentUser || await getUserById(req.user.sub);
    const whatsapp = await buildPedagogicalWhatsAppBootstrap(user);
    res.json({ whatsapp });
  } catch (err) {
    if (err?.message === "pedagogical_access_denied") {
      return res.status(403).json({ error: "pedagogical_access_denied" });
    }
    if (err?.message === "pedagogical_department_not_found") {
      return res.status(404).json({ error: "pedagogical_department_not_found" });
    }
    res.status(400).json({ error: err?.message || "pedagogical_whatsapp_bootstrap_failed" });
  }
});

app.post("/api/intranet/pedagogico/whatsapp/groups", requireAuth(JWT_SECRET), requireIntranetAccess, async (req, res) => {
  try {
    const user = req.currentUser || await getUserById(req.user.sub);
    const group = await savePedagogicalWhatsAppGroup(req.body || {}, user);
    res.json({ ok: true, group });
  } catch (err) {
    if (err?.message === "pedagogical_access_denied") {
      return res.status(403).json({ error: "pedagogical_access_denied" });
    }
    res.status(400).json({ error: err?.message || "pedagogical_whatsapp_group_save_failed" });
  }
});

app.post("/api/intranet/pedagogico/whatsapp/campaigns", requireAuth(JWT_SECRET), requireIntranetAccess, async (req, res) => {
  try {
    const user = req.currentUser || await getUserById(req.user.sub);
    const campaign = await savePedagogicalWhatsAppCampaign(req.body || {}, user);
    res.json({ ok: true, campaign });
  } catch (err) {
    if (err?.message === "pedagogical_access_denied") {
      return res.status(403).json({ error: "pedagogical_access_denied" });
    }
    res.status(400).json({ error: err?.message || "pedagogical_whatsapp_campaign_save_failed" });
  }
});

app.post("/api/intranet/pedagogico/whatsapp/campaigns/:id/start", requireAuth(JWT_SECRET), requireIntranetAccess, async (req, res) => {
  try {
    const user = req.currentUser || await getUserById(req.user.sub);
    const campaign = await startPedagogicalWhatsAppCampaign(Number(req.params.id), user);
    const scope = await resolvePedagogicalScope(user);
    const refreshed = await getPedagogicalWhatsAppCampaignRowById(campaign.id, scope.department.id);
    const items = await listPedagogicalWhatsAppCampaignItems([campaign.id], { limit: 600 });
    const history = await listPedagogicalWhatsAppCampaignLogs([campaign.id], { limit: 80 });
    res.json({
      ok: true,
      campaign: {
        ...(refreshed || campaign),
        items,
        selected_group_ids: refreshed?.metadata?.selected_group_ids || campaign?.metadata?.selected_group_ids || [],
      },
      history,
      integration: getWhatsAppIntegrationStatus(),
    });
  } catch (err) {
    if (err?.message === "pedagogical_access_denied") {
      return res.status(403).json({ error: "pedagogical_access_denied" });
    }
    if (err?.message === "whatsapp_campaign_not_found") {
      return res.status(404).json({ error: "whatsapp_campaign_not_found" });
    }
    res.status(400).json({ error: err?.message || "pedagogical_whatsapp_campaign_start_failed" });
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
  if (!user || !hasIntranetAccess(user)) return res.redirect("/index.html");
  return res.sendFile(path.join(publicDir, "intranet.html"));
});

app.use(express.static(publicDir));

async function startServer() {
  await migrate();
  await ensureAdmin();
  await ensureDepartmentCatalog();
  await ensureDepartmentSubmenus();
  await ensureMarketingIndicatorSeeds();
  await ensureCalendarEventTypes();
  await syncLegacyUserDepartmentData();
  await ensureFixedDepartments();
  const incompatibleCleanup = await purgeIncompatibleKnowledgeAssets(null);
  if (
    incompatibleCleanup.removed_sources
    || incompatibleCleanup.removed_documents
    || incompatibleCleanup.removed_local_files
    || incompatibleCleanup.removed_transcripts
  ) {
    console.log("Limpeza de arquivos incompatíveis concluída:", incompatibleCleanup);
  }

  app.listen(PORT, () => {
    console.log(`Talkers IA rodando em ${BASE_URL}`);
    console.log(`Login: ${BASE_URL}/login.html`);
    console.log(`Banco ativo: ${DB_CLIENT}`);
    scheduleKnowledgeBackfillSweep(3 * 1000);
  });
}

startServer().catch((err) => {
  console.error("Falha ao iniciar o servidor:", err);
  process.exit(1);
});















































































































