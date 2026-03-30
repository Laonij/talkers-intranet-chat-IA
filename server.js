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

const {
  DATA_DIR,
  DB_CLIENT,
  DB_RUNTIME_CONFIG,
  DATABASE_URL_PRESENT,
  POSTGRES_HOST,
  REQUESTED_DB_CLIENT,
  migrate,
  get,
  all,
  run,
  uploadsDir,
  kbDir,
  logEvent,
  searchDocuments,
  importLegacySqliteIntoPostgres,
} = require("./db");
const { seedDemoSchoolData } = require("./scripts/seed_demo_school_data");
const { createLogger } = require("./lib/appLogger");
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
const { buildDocumentKnowledgeProfile, normalizeDisplayName } = require("./lib/knowledge");
const { ocrImage } = require("./lib/ocr");
const {
  buildSanitizationSummary,
  deepSanitizeForPostgres,
  safeJsonStringifyForPostgres,
  sanitizeTextForPostgres,
} = require("./lib/postgresSanitizer");
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
  listCommercialSalesSheetNames,
  normalizeSalesText,
  parseMatriculasWorkbook,
  parsePostSaleWorkbook,
  readWorkbookFromFile,
} = require("./lib/sales");
const {
  ACADEMIC_PRIMARY_SHEET,
  ACADEMIC_TIMETABLE_SHEETS,
  deriveSchoolTermName,
  deriveSemesterCode,
  detectLanguageFromText: detectAcademicLanguageFromText,
  detectModalityFromText: detectAcademicModalityFromText,
  normalizeAcademicText,
  normalizePersonKey,
  parseAcademicWorkbook,
  readWorkbookFromFile: readAcademicWorkbookFromFile,
  sanitizeWorkbookName: sanitizeAcademicWorkbookName,
  stripTrailingStudentAnnotations,
  toTitleCase: toAcademicTitleCase,
} = require("./lib/academic");
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
const MAX_UPLOAD_SIZE_MB = Math.max(1, Number(process.env.MAX_UPLOAD_SIZE_MB || 25));
const MAX_UPLOAD_SIZE_BYTES = MAX_UPLOAD_SIZE_MB * 1024 * 1024;
const SQLITE_IMPORT_MAX_UPLOAD_SIZE_MB = Math.max(
  MAX_UPLOAD_SIZE_MB,
  Number(process.env.SQLITE_IMPORT_MAX_UPLOAD_SIZE_MB || 80)
);
const SQLITE_IMPORT_MAX_UPLOAD_SIZE_BYTES = SQLITE_IMPORT_MAX_UPLOAD_SIZE_MB * 1024 * 1024;
const MAX_CONCURRENT_JOBS = Math.max(1, Number(process.env.MAX_CONCURRENT_JOBS || 5));
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
const SALES_EDITABLE_FIELDS = ['operational_status', 'follow_up_notes', 'next_action', 'next_action_date', 'observations', 'feedback', 'post_sale_rating'];
const SALES_OPERATIONAL_STATUS_OPTIONS = ['Novo', 'Pendente', 'Em andamento', 'Realizado', 'Sem retorno', 'Reagendado'];
const SALES_PENDING_STATUS_SET = new Set(['novo', 'pendente', 'em andamento', 'reagendado']);
const SALES_REALIZED_STATUS_SET = new Set(['realizado']);
const POST_SALE_RATING_OPTIONS = ['ruim', 'bom', 'otimo'];
const POST_SALE_SUBMENU_VIEW_KEY = 'sales-post-sale';
const DEFAULT_POST_SALE_CLOSER_NAMES = ['Bruna Rafaela', 'Bruna Gonçalves', 'Cristiana'];
const SALES_SOURCE_KEY = 'matriculas-novas';
const MARKETING_INFLUENCER_STATUSES = new Set(['ativo', 'em teste', 'pausado', 'encerrado']);
const MARKETING_INFLUENCE_TYPE_SUGGESTIONS = ['Stories', 'Reels', 'Postagens', 'UGC', 'Presenca em evento', 'Campanha local'];
const MARKETING_CONTRACT_TYPE_SUGGESTIONS = ['Permuta', 'Contrato mensal', 'Campanha pontual', 'Comissao', 'Teste'];
const MARKETING_INDICATOR_ALLOWED_PERSON_NAMES = new Set(['bruna rafaela', 'bruna goncalves', 'viviane siepeman', 'cristiana freitas']);
const PEDAGOGICAL_WHATSAPP_GROUP_STATUSES = new Set(["active", "inactive"]);
const PEDAGOGICAL_WHATSAPP_CAMPAIGN_STATUSES = new Set(["draft", "prepared", "running", "completed", "error", "cancelled"]);
const PEDAGOGICAL_WHATSAPP_ITEM_STATUSES = new Set(["queued", "sending", "sent", "error", "pending_provider", "cancelled"]);
const PEDAGOGICAL_WHATSAPP_DEFAULT_INTERVAL_SECONDS = 30;
const ACADEMIC_IMPORT_SOURCE_KEY = "academic-consolidated";
const ACADEMIC_TEACHER_TEMP_PASSWORD = String(process.env.ACADEMIC_TEACHER_TEMP_PASSWORD || "Professor#2026!").trim() || "Professor#2026!";
const OPERATIONAL_USER_SEED_PASSWORD = String(process.env.OPERATIONAL_USER_SEED_PASSWORD || "Talkers#2026!").trim() || "Talkers#2026!";
const ACADEMIC_STUDENT_STATUS_OPTIONS = ["ativo", "inativo", "aguardando", "cancelado", "trancado", "desistente"];
const ACADEMIC_ENROLLMENT_STATUS_OPTIONS = ["pre-matricula", "matriculado", "aguardando turma", "transferido", "trancado", "cancelado", "concluido", "desistente"];
const ACADEMIC_CLASS_STATUS_OPTIONS = ["planejada", "ativa", "encerrada", "cancelada"];
const ACADEMIC_ATTENDANCE_STATUS_OPTIONS = ["presente", "falta", "falta_justificada", "reposicao", "atraso"];
const ACADEMIC_SESSION_STATUS_OPTIONS = ["planejada", "realizada", "cancelada", "remarcada"];
const ACADEMIC_TEACHER_SUBMENU_VIEW_KEYS = ["teacher-classes", "teacher-attendance", "teacher-class-students"];
const ACADEMIC_PEDAGOGICAL_SUBMENU_VIEW_KEYS = ["academic-students", "academic-enrollments", "academic-classes", "academic-schedules", "academic-teachers", "academic-attendance", "academic-movements"];
const ACADEMIC_ALL_SUBMENU_VIEW_KEYS = [...ACADEMIC_PEDAGOGICAL_SUBMENU_VIEW_KEYS, ...ACADEMIC_TEACHER_SUBMENU_VIEW_KEYS];
const STUDENT_HUB_ATTENDIMENTO_VIEW_KEYS = ["student-search", "student-profile", "student-history"];
const STUDENT_HUB_COMMERCIAL_VIEW_KEYS = ["commercial-leads", "commercial-negotiations", "commercial-enrollment-conversion"];
const STUDENT_HUB_FINANCIAL_VIEW_KEYS = ["financial-contracts", "financial-installments", "financial-receivables", "financial-delinquency", "financial-student-profile"];
const STUDENT_HUB_ALL_VIEW_KEYS = [...STUDENT_HUB_ATTENDIMENTO_VIEW_KEYS, ...STUDENT_HUB_COMMERCIAL_VIEW_KEYS, ...STUDENT_HUB_FINANCIAL_VIEW_KEYS];
const STUDENT_HUB_LEAD_STAGE_OPTIONS = ["lead", "negociacao", "fechado", "convertido", "perdido"];
const FINANCIAL_CONTRACT_STATUS_OPTIONS = ["draft", "pending", "active", "signed", "cancelled", "completed"];
const FINANCIAL_INSTALLMENT_STATUS_OPTIONS = ["pending", "paid", "overdue", "cancelled", "negotiated"];
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
const SUBMENU_ICON_SOURCE_PATH = path.join(__dirname, "src", "constants", "icons.js");
let submenuIconOptionsCache = null;

const startupLogger = createLogger("startup");
const databaseLogger = createLogger("database");
const uploadLogger = createLogger("uploads");
const indexingLogger = createLogger("indexing");
const jobsLogger = createLogger("jobs");
const authLogger = createLogger("auth");
const openaiLogger = createLogger("openai");

function extractNamedStringArrayFromSource(source, exportName) {
  const match = String(source || "").match(new RegExp(`export\\s+const\\s+${exportName}\\s*=\\s*(\\[[\\s\\S]*?\\])`, "m"));
  if (!match) return [];
  try {
    const parsed = JSON.parse(match[1]);
    return Array.isArray(parsed)
      ? parsed.map((item) => String(item || "").trim().toLowerCase()).filter(Boolean)
      : [];
  } catch {
    return [];
  }
}

function listAvailableSubmenuIcons() {
  if (Array.isArray(submenuIconOptionsCache) && submenuIconOptionsCache.length) {
    return submenuIconOptionsCache;
  }
  try {
    const source = fs.readFileSync(SUBMENU_ICON_SOURCE_PATH, "utf8");
    const parsed = extractNamedStringArrayFromSource(source, "ICONS");
    if (parsed.length) {
      submenuIconOptionsCache = Array.from(new Set(parsed));
      return submenuIconOptionsCache;
    }
  } catch (err) {
    startupLogger.warn("Nao foi possivel carregar o catalogo de icones dos submenus.", {
      message: err?.message || String(err || "submenu_icon_catalog_failed"),
    });
  }
  submenuIconOptionsCache = ["folder"];
  return submenuIconOptionsCache;
}

function normalizeSubmenuIconName(value, options = {}) {
  const availableIcons = listAvailableSubmenuIcons();
  const fallback = String(options.fallback || "folder").trim().toLowerCase();
  const allowedLegacy = new Set(
    (Array.isArray(options.allowLegacy) ? options.allowLegacy : [options.allowLegacy])
      .map((item) => String(item || "").trim().toLowerCase())
      .filter(Boolean)
  );
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized && (availableIcons.includes(normalized) || allowedLegacy.has(normalized))) {
    return normalized;
  }
  if (availableIcons.includes(fallback)) {
    return fallback;
  }
  return availableIcons[0] || "folder";
}

const JWT_SECRET =
  String(process.env.JWT_SECRET || "").trim() || (IS_PRODUCTION ? "" : DEFAULT_JWT_SECRET);
const ADMIN_EMAIL = String(process.env.ADMIN_EMAIL || DEFAULT_ADMIN_EMAIL).trim().toLowerCase();
const ADMIN_NAME = String(process.env.ADMIN_NAME || DEFAULT_ADMIN_NAME).trim() || DEFAULT_ADMIN_NAME;
const ADMIN_PASSWORD = String(process.env.ADMIN_PASSWORD || (IS_PRODUCTION ? "" : DEFAULT_ADMIN_PASSWORD));
const ADMIN_FORCE_PASSWORD_SYNC = ["1", "true", "yes"].includes(String(process.env.ADMIN_FORCE_PASSWORD_SYNC || "").trim().toLowerCase());

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
  ".mp3": MAX_UPLOAD_SIZE_BYTES,
  ".wav": MAX_UPLOAD_SIZE_BYTES,
  ".m4a": MAX_UPLOAD_SIZE_BYTES,
  ".aac": MAX_UPLOAD_SIZE_BYTES,
  ".ogg": MAX_UPLOAD_SIZE_BYTES,
  ".webm": MAX_UPLOAD_SIZE_BYTES,
  ".flac": MAX_UPLOAD_SIZE_BYTES,
  ".wma": MAX_UPLOAD_SIZE_BYTES,
  ".mp4": MAX_UPLOAD_SIZE_BYTES,
  ".mov": MAX_UPLOAD_SIZE_BYTES,
  ".avi": MAX_UPLOAD_SIZE_BYTES,
  ".mkv": MAX_UPLOAD_SIZE_BYTES,
  ".m4v": MAX_UPLOAD_SIZE_BYTES,
  ".mpeg": MAX_UPLOAD_SIZE_BYTES,
  ".mpg": MAX_UPLOAD_SIZE_BYTES,
};
const MEDIA_EXTS = new Set([".mp3", ".wav", ".m4a", ".aac", ".ogg", ".webm", ".flac", ".wma", ".mp4", ".mov", ".avi", ".mkv", ".m4v", ".mpeg", ".mpg"]);
const MEMORY_ENTRY_MIN_SIMILARITY = 0.43;
const MAX_MEMORY_CANDIDATES = 120;
const CALENDAR_EVENT_STATUSES = new Set(["scheduled", "cancelled"]);
const DOCUMENT_MEMORY_USER_ID = 0;
const KNOWLEDGE_MEMORY_SCOPE = "knowledge_document";
const KNOWLEDGE_MEMORY_KIND = "document_semantic";
const BACKGROUND_KNOWLEDGE_SWEEP_BATCH = Math.max(10, MAX_CONCURRENT_JOBS * 10);
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
    if (REQUESTED_DB_CLIENT && REQUESTED_DB_CLIENT !== DB_CLIENT) {
      console.log(
        `Aviso: DB_CLIENT solicitado (${REQUESTED_DB_CLIENT}) foi sobrescrito para ${DB_CLIENT} porque DATABASE_URL ${DATABASE_URL_PRESENT ? "esta" : "nao esta"} configurado.`
      );
    }
  
    if (IS_PRODUCTION && DB_CLIENT === "postgres") {
      console.log(`Banco configurado: Postgres (${POSTGRES_HOST || "host_indisponivel"}).`);
    }
  
    if (!IS_PRODUCTION && DB_CLIENT === "sqlite") {
      console.log(`Banco configurado: SQLite (${DB_RUNTIME_CONFIG.sqlite_path}).`);
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

    const existing = await get("SELECT id, name, role, can_access_intranet, password_hash FROM users WHERE email=?", [ADMIN_EMAIL]);
    if (existing) {
      if (!ADMIN_FORCE_PASSWORD_SYNC) return;

      const passwordMatches = existing.password_hash
        ? await bcrypt.compare(ADMIN_PASSWORD, existing.password_hash).catch(() => false)
        : false;
      const needsUpdate = !passwordMatches
        || String(existing.name || "").trim() !== ADMIN_NAME
        || String(existing.role || "").trim().toLowerCase() !== "admin"
        || !parseBooleanInput(existing.can_access_intranet);

      if (!needsUpdate) return;

      const hash = await bcrypt.hash(ADMIN_PASSWORD, 10);
      await run(
        "UPDATE users SET name=?, password_hash=?, role='admin', can_access_intranet=? WHERE id=?",
        [ADMIN_NAME, hash, true, existing.id]
      );
      await logEvent(existing.id, "admin_bootstrap_password_synced", {
        email: ADMIN_EMAIL,
        forced_sync: true,
      });
      console.log("Senha do admin sincronizada a partir das variaveis de ambiente.");
      return;
    }

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

function sendNoCacheFile(res, absolutePath) {
  return res.sendFile(absolutePath, {
    headers: {
      "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
      Pragma: "no-cache",
      Expires: "0",
      "Surrogate-Control": "no-store",
    },
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
  return safeJsonStringifyForPostgres(value, fallback);
}

function normalizeStringArray(values = []) {
  return Array.from(new Set(
    (Array.isArray(values) ? values : [])
      .map((value) => String(value || "").trim())
      .filter(Boolean)
  ));
}

function normalizeAdditionalPermissions(value) {
  const parsed = typeof value === "string"
    ? (safeJsonParse(value || "{}") || {})
    : (value && typeof value === "object" ? value : {});
  return {
    allowed_department_slugs: normalizeStringArray(parsed.allowed_department_slugs || []),
    allowed_submenu_view_keys: normalizeStringArray(parsed.allowed_submenu_view_keys || []),
    allowed_global_views: normalizeStringArray(parsed.allowed_global_views || []),
    commercial_role: String(parsed.commercial_role || "").trim(),
    academic_role: String(parsed.academic_role || "").trim(),
    intranet_scope: String(parsed.intranet_scope || "").trim(),
  };
}

function buildPostSaleCloserPermissions() {
  return {
    allowed_department_slugs: ["comercial"],
    allowed_submenu_view_keys: [POST_SALE_SUBMENU_VIEW_KEY],
    allowed_global_views: ["sales"],
    commercial_role: "post_sale_closer",
    intranet_scope: "restricted_post_sale",
  };
}

function buildOperationalDepartmentPermissions(departmentName = "") {
  const departmentKey = normalizeDepartmentValue(departmentName);
  if (departmentKey === "atendimento") {
    return {
      allowed_department_slugs: ["atendimento"],
      allowed_submenu_view_keys: STUDENT_HUB_ATTENDIMENTO_VIEW_KEYS.slice(),
      allowed_global_views: ["student_hub"],
      intranet_scope: "attendance_student_hub",
    };
  }
  if (departmentKey === "financeiro") {
    return {
      allowed_department_slugs: ["financeiro"],
      allowed_submenu_view_keys: STUDENT_HUB_FINANCIAL_VIEW_KEYS.slice(),
      allowed_global_views: ["student_hub", "financial"],
      intranet_scope: "finance_student_hub",
    };
  }
  if (departmentKey === "comercial") {
    return {
      allowed_department_slugs: ["comercial"],
      allowed_submenu_view_keys: [...STUDENT_HUB_COMMERCIAL_VIEW_KEYS, POST_SALE_SUBMENU_VIEW_KEY],
      allowed_global_views: ["student_hub", "sales"],
      intranet_scope: "commercial_student_hub",
    };
  }
  return {
    allowed_department_slugs: departmentKey ? [departmentKey] : [],
    allowed_submenu_view_keys: [],
    allowed_global_views: [],
    intranet_scope: "",
  };
}

async function ensureOperationalDepartmentUser(seed = {}, actorUserId = null) {
  const departmentName = String(seed.department || "").trim();
  const email = String(seed.email || "").trim().toLowerCase();
  const name = String(seed.name || "").trim();
  if (!departmentName || !email || !name) return null;

  const permissions = buildOperationalDepartmentPermissions(departmentName);
  let user = await get(
    "SELECT id, name, email, role, department, can_access_intranet, job_title, unit_name FROM users WHERE lower(email)=lower(?) LIMIT 1",
    [email]
  );
  if (!user) {
    user = await get(
      "SELECT id, name, email, role, department, can_access_intranet, job_title, unit_name FROM users WHERE lower(name)=lower(?) AND lower(coalesce(department, ''))=lower(?) LIMIT 1",
      [name, departmentName]
    );
  }

  let created = false;
  if (!user?.id) {
    const passwordHash = await bcrypt.hash(OPERATIONAL_USER_SEED_PASSWORD, 10);
    const result = await run(
      "INSERT INTO users (email, name, password_hash, role, department, can_access_intranet, job_title, unit_name, additional_permissions_json) VALUES (?, ?, ?, 'user', ?, ?, ?, ?, ?)",
      [
        email,
        name,
        passwordHash,
        departmentName,
        true,
        String(seed.job_title || departmentName).trim() || departmentName,
        String(seed.unit_name || departmentName).trim() || departmentName,
        safeJsonStringify(permissions, "{}"),
      ]
    );
    created = true;
    user = await get(
      "SELECT id, name, email, role, department, can_access_intranet, job_title, unit_name FROM users WHERE id=? LIMIT 1",
      [result.lastID]
    );
  }

  if (!user?.id) return null;
  await syncUserDepartments(user.id, [departmentName]);
  await run(
    "UPDATE users SET role=?, department=?, can_access_intranet=?, job_title=?, unit_name=?, additional_permissions_json=? WHERE id=?",
    [
      String(user.role || "").trim() === "admin" ? "admin" : "user",
      departmentName,
      true,
      String(seed.job_title || user.job_title || departmentName).trim() || departmentName,
      String(seed.unit_name || user.unit_name || departmentName).trim() || departmentName,
      safeJsonStringify(permissions, "{}"),
      user.id,
    ]
  );

  if (actorUserId) {
    await logEvent(actorUserId, created ? "admin_seed_operational_user" : "admin_sync_operational_user", {
      user_id: user.id,
      email,
      department: departmentName,
    });
  }

  return {
    user_id: user.id,
    email,
    name,
    department: departmentName,
    created,
  };
}

async function ensureOperationalDepartmentUsers(actorUserId = null) {
  const seeds = [
    {
      department: "Atendimento",
      email: "atendimento@talkers.local",
      name: "Equipe Atendimento",
      job_title: "Atendimento",
      unit_name: "Atendimento",
    },
    {
      department: "Comercial",
      email: "comercial@talkers.local",
      name: "Equipe Comercial",
      job_title: "Consultor comercial",
      unit_name: "Comercial",
    },
    {
      department: "Financeiro",
      email: "financeiro@talkers.local",
      name: "Equipe Financeiro",
      job_title: "Financeiro",
      unit_name: "Financeiro",
    },
  ];
  const results = [];
  for (const seed of seeds) {
    const ensured = await ensureOperationalDepartmentUser(seed, actorUserId);
    if (ensured) results.push(ensured);
  }
  return results;
}

function hasRestrictedPostSaleScope(user = {}) {
  return String(user?.additional_permissions?.commercial_role || "").trim() === "post_sale_closer"
    || String(user?.additional_permissions?.intranet_scope || "").trim() === "restricted_post_sale";
}

function hasAcademicTeacherScope(user = {}) {
  return String(user?.additional_permissions?.academic_role || "").trim() === "teacher"
    || String(user?.additional_permissions?.intranet_scope || "").trim() === "teacher_academic"
    || userHasDepartmentAccess(user, "professor");
}

function getAllowedDepartmentSlugSet(user = {}) {
  return new Set((user?.additional_permissions?.allowed_department_slugs || []).map((item) => normalizeDepartmentValue(item)).filter(Boolean));
}

function getAllowedSubmenuViewKeySet(user = {}) {
  return new Set((user?.additional_permissions?.allowed_submenu_view_keys || []).map((item) => String(item || "").trim()).filter(Boolean));
}

function getAllowedGlobalViewSet(user = {}) {
  return new Set((user?.additional_permissions?.allowed_global_views || []).map((item) => String(item || "").trim()).filter(Boolean));
}

function sanitizePersistedText(value, options = {}) {
  return sanitizeTextForPostgres(value, {
    trim: true,
    normalizeWhitespace: false,
    ...options,
  }) || "";
}

function sanitizePersistedValue(value) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (Buffer.isBuffer(value) || value instanceof Uint8Array || value instanceof Date) return value;
  if (typeof value === "string") return sanitizePersistedText(value, { trim: false });
  if (Array.isArray(value) || typeof value === "object") return safeJsonStringify(value, "{}");
  return value;
}

function logSanitizationIfNeeded(domainLogger, message, value, context = {}) {
  const summary = buildSanitizationSummary(value, { trim: false, normalizeWhitespace: false });
  if (!summary) return;
  domainLogger.warn(message, {
    ...context,
    ...summary,
  });
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

  if (/\u0000/.test(safe)) {
    issues.push("byte_nulo_detectado");
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
  const safeMessage = sanitizePersistedText(message || "", { trim: true, maxLength: 3000 }) || null;
  await run(
    "INSERT INTO knowledge_processing_logs (knowledge_source_id, stage_key, stage_status, message, detail_json, actor_user_id) VALUES (?, ?, ?, ?, ?, ?)",
    [
      knowledgeSourceId,
      stageKey,
      stageStatus,
      safeMessage,
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
  const values = entries.map(([, value]) => sanitizePersistedValue(value));
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
      ${includeInactive ? '' : `WHERE ${buildDbTruthySql('is_active')}`}
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
    where.push(buildDbTruthySql("is_active", "ds"));
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
      ${includeInactive ? '' : `WHERE ${buildDbTruthySql('is_active', 'intranet_announcements')}`}
      ORDER BY ${buildDbFalseySql('is_pinned', 'intranet_announcements')} DESC, intranet_announcements.created_at DESC, intranet_announcements.id DESC
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
        ${includeInactive ? '' : `AND ${buildDbTruthySql('is_active', 'd')}`}
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
  const additionalPermissions = normalizeAdditionalPermissions(user.additional_permissions_json || user.additional_permissions || {});
  return {
    ...user,
    department: primaryDepartment,
    departments,
    department_details: details,
    can_access_intranet: coerceDbBoolean(user.can_access_intranet),
    preferred_locale: normalizeLocaleCode(user.preferred_locale || DEFAULT_LOCALE),
    additional_permissions: additionalPermissions,
  };
}

function buildSessionUserFallback(sessionUser = null, fallbackUserId = null) {
  const safeSession = sessionUser && typeof sessionUser === "object" ? sessionUser : {};
  const resolvedId = Number(safeSession.sub || safeSession.id || fallbackUserId || 0) || null;
  if (!resolvedId) return null;

  const sessionDepartments = Array.isArray(safeSession.departments)
    ? safeSession.departments.map((value) => String(value || "").trim()).filter(Boolean)
    : [];
  const primaryDepartment = String(safeSession.department || sessionDepartments[0] || "").trim();
  const normalizedDepartments = primaryDepartment && !sessionDepartments.includes(primaryDepartment)
    ? [primaryDepartment, ...sessionDepartments]
    : sessionDepartments;

  return {
    id: resolvedId,
    sub: resolvedId,
    email: String(safeSession.email || "").trim(),
    name: String(safeSession.name || "Usuario").trim() || "Usuario",
    role: String(safeSession.role || "user").trim() || "user",
    department: primaryDepartment,
    departments: normalizedDepartments,
    department_details: normalizedDepartments.map((name, index) => ({
      department_id: null,
      name,
      access_level: index === 0 ? "principal" : "colaborador",
      is_primary: index === 0,
      slug: slugifyDepartmentName(name),
      is_active: true,
    })),
    can_access_intranet: Boolean(
      Object.prototype.hasOwnProperty.call(safeSession, "can_access_intranet")
        ? safeSession.can_access_intranet
        : true
    ),
    preferred_locale: normalizeLocaleCode(safeSession.preferred_locale || DEFAULT_LOCALE),
    additional_permissions: normalizeAdditionalPermissions(safeSession.additional_permissions_json || safeSession.additional_permissions || {}),
    job_title: String(safeSession.job_title || "").trim(),
    unit_name: String(safeSession.unit_name || "").trim(),
    created_at: null,
    session_fallback: true,
  };
}

async function resolveRequestUser(sessionUser = null, fallbackUserId = null) {
  const resolvedId = Number(sessionUser?.sub || sessionUser?.id || fallbackUserId || 0) || null;
  const dbUser = resolvedId ? await getUserById(resolvedId).catch(() => null) : null;
  if (dbUser) return dbUser;
  return buildSessionUserFallback(sessionUser, resolvedId);
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

function normalizeSalesOperationalStatus(value) {
  const safe = String(value || "").trim();
  if (!safe) return 'Novo';
  const matched = SALES_OPERATIONAL_STATUS_OPTIONS.find((item) => item.toLowerCase() === safe.toLowerCase());
  return matched || '';
}

function normalizePostSaleRating(value) {
  const safe = normalizeBusinessText(String(value || "").trim()).replace(/\s+/g, ' ').trim();
  if (!safe) return null;
  if (safe === 'otimo' || safe === 'ótimo') return 'otimo';
  if (safe === 'bom') return 'bom';
  if (safe === 'ruim') return 'ruim';
  return '';
}

function hasImportedSalesChanges(existing = {}, nextValues = {}) {
  return listSalesImportedFields().some((field) => normalizeSqlTextValue(existing[field]) !== normalizeSqlTextValue(nextValues[field]));
}

function mergeImportedSalesRecord(existing = null, prepared = {}) {
  const merged = {
    ...prepared,
    phone: prepared.phone || null,
    level_name: prepared.level_name || null,
    teacher_name: prepared.teacher_name || null,
    attendant_name: prepared.attendant_name || null,
    feedback: prepared.feedback || null,
    contact_email: prepared.contact_email || null,
    observations: prepared.observations || null,
    lead_stage: normalizeLeadStage(prepared.lead_stage || (prepared.sale_date ? "fechado" : "lead")),
    post_sale_rating: null,
  };

  if (!existing) {
    return merged;
  }

  merged.operational_status = existing.operational_status || 'Novo';
  merged.follow_up_notes = existing.follow_up_notes || null;
  merged.next_action = existing.next_action || null;
  merged.next_action_date = existing.next_action_date || null;
  merged.observations = normalizeSqlTextValue(existing.observations) ? existing.observations : (prepared.observations || null);
  merged.contact_email = normalizeSqlTextValue(existing.contact_email) ? existing.contact_email : (prepared.contact_email || null);
  merged.lead_stage = normalizeLeadStage(existing.lead_stage || prepared.lead_stage || (existing.converted_at ? "convertido" : "lead"));
  merged.post_sale_rating = existing.post_sale_rating || null;
  merged.last_modified_by = existing.last_modified_by || null;
  merged.custom_fields_json = existing.custom_fields_json || null;
  merged.feedback = normalizeSqlTextValue(existing.feedback) ? existing.feedback : (prepared.feedback || null);
  return merged;
}

function summarizeSalesStatus(statusValue = '') {
  const safe = normalizeBusinessText(String(statusValue || '').trim()).replace(/\s+/g, ' ').trim();
  if (!safe) return 'novo';
  if (SALES_REALIZED_STATUS_SET.has(safe)) return 'realizado';
  if (safe === 'sem retorno') return 'sem retorno';
  if (safe === 'reagendado') return 'reagendado';
  if (safe === 'pendente') return 'pendente';
  if (safe === 'em andamento') return 'em andamento';
  return 'novo';
}

function listSalesImportedFields() {
  return [
    'student_name',
    'phone',
    'contact_email',
    'course_name',
    'level_name',
    'teacher_name',
    'attendant_name',
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
    'feedback',
    'observations',
    'lead_stage',
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

async function ensurePostSaleCloserCatalog(closerNames = DEFAULT_POST_SALE_CLOSER_NAMES, actorUserId = null) {
  const safeCloserNames = Array.from(new Set((Array.isArray(closerNames) ? closerNames : [])
    .map((item) => String(item || '').trim())
    .filter(Boolean)));

  const synced = [];
  for (const officialName of safeCloserNames) {
    const closer = await ensureCloserRecord({
      official_name: officialName,
      display_name: officialName,
      status: 'active',
    }, { aliasOrigin: 'post_sale_seed' });
    if (closer) synced.push(closer);
  }

  if (actorUserId && synced.length) {
    await logEvent(actorUserId, 'admin_seed_post_sale_closers', {
      closer_ids: synced.map((item) => Number(item.id || 0)).filter(Boolean),
      closer_names: synced.map((item) => item.official_name || item.display_name).filter(Boolean),
    });
  }

  return synced;
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

function buildCloserEmailCandidates(closerName = '') {
  const normalized = normalizeCloserValue(closerName);
  if (!normalized) return [];
  const tokens = normalized.split(/\s+/g).filter(Boolean);
  const candidates = new Set();
  if (tokens.length) {
    candidates.add(`${tokens.join('.')}@talkers.com`);
    candidates.add(`${tokens.join('.')}@talkers.local`);
    candidates.add(`postvenda.${tokens.join('.')}@talkers.local`);
    if (tokens.length === 1) {
      candidates.add(`${tokens[0]}@talkers.com`);
      candidates.add(`${tokens[0]}@talkers.local`);
    }
  }
  return [...candidates];
}

async function ensureCloserOperationalUser(closer, actorUserId = null) {
  if (!closer?.id || !closer?.official_name) return null;
  const officialName = String(closer.official_name || closer.display_name || '').trim();
  const normalizedName = normalizeCloserValue(officialName);
  if (!normalizedName) return null;

  const users = await all(
    "SELECT id, name, email, role, department, can_access_intranet, job_title, unit_name, additional_permissions_json FROM users ORDER BY id ASC"
  );
  const emailCandidates = new Set(buildCloserEmailCandidates(officialName).map((item) => String(item || '').trim().toLowerCase()).filter(Boolean));
  let matchedUser = users.find((user) => normalizeCloserValue(user.name) === normalizedName) || null;
  if (!matchedUser) {
    matchedUser = users.find((user) => emailCandidates.has(String(user.email || '').trim().toLowerCase())) || null;
  }

  let temporaryPassword = '';
  let createdUser = false;
  const permissions = buildPostSaleCloserPermissions();
  if (!matchedUser) {
    const occupiedEmails = new Set(users.map((user) => String(user.email || '').trim().toLowerCase()).filter(Boolean));
    let generatedEmail = buildCloserEmailCandidates(officialName).find((candidate) => !occupiedEmails.has(candidate.toLowerCase())) || '';
    if (!generatedEmail) {
      const fallbackSlug = normalizedName.replace(/\s+/g, '.');
      generatedEmail = `postvenda.${fallbackSlug}.${Date.now()}@talkers.local`;
    }
    temporaryPassword = `PV!${crypto.randomBytes(6).toString('base64url')}`;
    const passwordHash = await bcrypt.hash(temporaryPassword, 10);
    const created = await run(
      "INSERT INTO users (email, name, password_hash, role, department, can_access_intranet, job_title, unit_name, additional_permissions_json) VALUES (?, ?, ?, 'user', ?, ?, ?, ?, ?)",
      [
        generatedEmail,
        officialName,
        passwordHash,
        'Comercial',
        true,
        'Closer de pós-venda',
        'Pós-venda',
        safeJsonStringify(permissions, "{}"),
      ]
    );
    matchedUser = await get(
      "SELECT id, name, email, role, department, can_access_intranet, job_title, unit_name, additional_permissions_json FROM users WHERE id=?",
      [created.lastID]
    );
    createdUser = true;
    if (actorUserId) {
      await logEvent(actorUserId, 'admin_create_post_sale_user', {
        user_id: created.lastID,
        closer_id: closer.id,
        closer_name: officialName,
        email: generatedEmail,
      });
    }
  }

  if (!matchedUser?.id) return null;
  await syncUserDepartments(matchedUser.id, ['Comercial']);
  await run(
    "UPDATE users SET role=?, department=?, can_access_intranet=?, job_title=?, unit_name=?, additional_permissions_json=? WHERE id=?",
    [
      String(matchedUser.role || '').trim() === 'admin' ? 'admin' : 'user',
      'Comercial',
      true,
      normalizeSqlTextValue(matchedUser.job_title) || 'Closer de pós-venda',
      normalizeSqlTextValue(matchedUser.unit_name) || 'Pós-venda',
      safeJsonStringify(permissions, "{}"),
      matchedUser.id,
    ]
  );
  await run(
    "UPDATE closers SET user_id=?, status=?, updated_at=datetime('now') WHERE id=?",
    [matchedUser.id, 'active', closer.id]
  );

  return {
    closer_id: closer.id,
    closer_name: officialName,
    user_id: matchedUser.id,
    user_email: matchedUser.email,
    created_user: createdUser,
    temporary_password: temporaryPassword || null,
  };
}

async function ensureCloserOperationalUsers(closerNames = [], actorUserId = null) {
  const normalizedNames = Array.from(new Set((Array.isArray(closerNames) ? closerNames : [])
    .map((item) => String(item || '').trim())
    .filter(Boolean)));
  await ensurePostSaleCloserCatalog(normalizedNames.length ? normalizedNames : DEFAULT_POST_SALE_CLOSER_NAMES);
  const allClosers = await listClosers({ includeInactive: true });
  const targetClosers = normalizedNames.length
    ? allClosers.filter((closer) => normalizedNames.some((name) => normalizeCloserValue(name) === normalizeCloserValue(closer.official_name || closer.display_name)))
    : allClosers.filter((closer) => String(closer.status || 'active').trim().toLowerCase() !== 'inactive');
  const results = [];
  for (const closer of targetClosers) {
    const result = await ensureCloserOperationalUser(closer, actorUserId);
    if (result) results.push(result);
  }
  return results;
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
  const restrictedPostSale = hasRestrictedPostSaleScope(user);
  const canViewAll = !restrictedPostSale && (user.role === 'admin' || departmentKeys.some((key) => SALES_VIEW_DEPARTMENTS.has(key)));
  const closer = await get('SELECT id, official_name, display_name, user_id, status FROM closers WHERE user_id=? AND status<>? LIMIT 1', [user.id || user.sub, 'inactive']);
  return {
    enabled: canViewAll || Boolean(closer),
    canViewAll,
    canEditAll: user.role === 'admin',
    closer,
    restrictedPostSale,
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

  if (filters.language) {
    clauses.push('lower(coalesce(sr.language, \'\'))=lower(?)');
    params.push(String(filters.language).trim());
  }

  if (filters.modality) {
    clauses.push('lower(coalesce(sr.modality, \'\'))=lower(?)');
    params.push(String(filters.modality).trim());
  }

  if (filters.rating) {
    clauses.push('lower(coalesce(sr.post_sale_rating, \'\'))=lower(?)');
    params.push(String(filters.rating).trim());
  }

  if (filters.search) {
    const search = `%${String(filters.search).trim()}%`;
    clauses.push("(lower(coalesce(sr.student_name, '')) LIKE lower(?) OR lower(coalesce(sr.course_name, '')) LIKE lower(?) OR lower(coalesce(sr.level_name, '')) LIKE lower(?) OR lower(coalesce(sr.phone, '')) LIKE lower(?) OR lower(coalesce(sr.closer_original, '')) LIKE lower(?) OR lower(coalesce(sr.attendant_name, '')) LIKE lower(?) OR lower(coalesce(sr.media_source, '')) LIKE lower(?) OR lower(coalesce(sr.feedback, '')) LIKE lower(?))");
    params.push(search, search, search, search, search, search, search, search);
  }

  return {
    sql: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '',
    params,
  };
}

async function getSalesSummaryForScope(scope, filters = {}) {
  const where = buildSalesWhereClause(scope, filters);
  const limit = Math.min(200, Math.max(1, Number(filters.limit || 80)));
  const todayKey = brazilDateKey();
  const [rows, totalRow, closerTotals, statusTotals, ratingTotals, filterTotals] = await Promise.all([
    all(
      `SELECT sr.id, sr.student_name, sr.phone, sr.course_name, sr.level_name, sr.teacher_name, sr.attendant_name, sr.sale_date, sr.semester_label,
              sr.modality, sr.class_type, sr.language, sr.media_source, sr.feedback, sr.operational_status,
              sr.post_sale_rating, sr.next_action, sr.next_action_date, sr.follow_up_notes, sr.observations,
              sr.closer_original, sr.closer_normalized, sr.closer_id, sr.user_id, sr.updated_at,
              COALESCE(c.display_name, c.official_name, sr.closer_normalized, sr.closer_original, 'Sem closer') AS closer_name
         FROM sales_records sr
         LEFT JOIN closers c ON c.id = sr.closer_id
         ${where.sql}
         ORDER BY
           CASE
             WHEN sr.next_action_date IS NOT NULL AND sr.next_action_date <> '' AND sr.next_action_date < ? AND lower(coalesce(sr.operational_status, '')) <> 'realizado' THEN 0
             WHEN sr.next_action_date = ? AND lower(coalesce(sr.operational_status, '')) <> 'realizado' THEN 1
             ELSE 2
           END ASC,
           COALESCE(sr.next_action_date, sr.sale_date, substr(sr.updated_at, 1, 10), substr(sr.created_at, 1, 10)) ASC,
           sr.id DESC
         LIMIT ?`,
      [...where.params, todayKey, todayKey, limit]
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
              COUNT(*) AS total,
              SUM(CASE WHEN lower(coalesce(sr.operational_status, ''))='realizado' THEN 1 ELSE 0 END) AS realized_total,
              SUM(CASE WHEN sr.next_action_date IS NOT NULL AND sr.next_action_date<>'' AND sr.next_action_date < ? AND lower(coalesce(sr.operational_status, '')) <> 'realizado' THEN 1 ELSE 0 END) AS overdue_total,
              SUM(CASE WHEN lower(coalesce(sr.post_sale_rating, ''))='ruim' THEN 1 ELSE 0 END) AS rating_ruim_total,
              SUM(CASE WHEN lower(coalesce(sr.post_sale_rating, ''))='bom' THEN 1 ELSE 0 END) AS rating_bom_total,
              SUM(CASE WHEN lower(coalesce(sr.post_sale_rating, ''))='otimo' THEN 1 ELSE 0 END) AS rating_otimo_total
         FROM sales_records sr
         LEFT JOIN closers c ON c.id = sr.closer_id
         ${where.sql}
        GROUP BY sr.closer_id, COALESCE(c.display_name, c.official_name, sr.closer_normalized, sr.closer_original, 'Sem closer')
        ORDER BY COUNT(*) DESC, closer_name ASC`,
      [todayKey, ...where.params]
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
    all(
      `SELECT COALESCE(sr.post_sale_rating, '') AS rating_name, COUNT(*) AS total
         FROM sales_records sr
         LEFT JOIN closers c ON c.id = sr.closer_id
         ${where.sql}
        GROUP BY COALESCE(sr.post_sale_rating, '')
        ORDER BY rating_name ASC`,
      where.params
    ),
    get(
      `SELECT
          SUM(CASE WHEN lower(coalesce(sr.operational_status, ''))='realizado' THEN 1 ELSE 0 END) AS realized_total,
          SUM(CASE WHEN lower(coalesce(sr.operational_status, '')) IN ('novo', 'pendente', 'em andamento', 'reagendado') THEN 1 ELSE 0 END) AS pending_total,
          SUM(CASE WHEN sr.next_action_date=? THEN 1 ELSE 0 END) AS action_today_total,
          SUM(CASE WHEN sr.next_action_date IS NOT NULL AND sr.next_action_date<>'' AND sr.next_action_date < ? AND lower(coalesce(sr.operational_status, '')) <> 'realizado' THEN 1 ELSE 0 END) AS overdue_total,
          SUM(CASE WHEN coalesce(nullif(trim(sr.observations), ''), nullif(trim(sr.follow_up_notes), '')) IS NULL THEN 1 ELSE 0 END) AS no_observation_total,
          SUM(CASE WHEN lower(coalesce(sr.post_sale_rating, ''))='ruim' THEN 1 ELSE 0 END) AS rating_ruim_total,
          SUM(CASE WHEN lower(coalesce(sr.post_sale_rating, ''))='bom' THEN 1 ELSE 0 END) AS rating_bom_total,
          SUM(CASE WHEN lower(coalesce(sr.post_sale_rating, ''))='otimo' THEN 1 ELSE 0 END) AS rating_otimo_total
         FROM sales_records sr
         LEFT JOIN closers c ON c.id = sr.closer_id
         ${where.sql}`,
      [todayKey, todayKey, ...where.params]
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
    pending_total: Number(filterTotals?.pending_total || 0),
    realized_total: Number(filterTotals?.realized_total || 0),
    action_today_total: Number(filterTotals?.action_today_total || 0),
    overdue_total: Number(filterTotals?.overdue_total || 0),
    no_observation_total: Number(filterTotals?.no_observation_total || 0),
    by_closer: closerTotals.map((item) => {
      const key = `${item.closer_id || 'none'}:${item.closer_name || 'Sem closer'}`;
      return {
        closer_id: item.closer_id || null,
        closer_name: item.closer_name || 'Sem closer',
        total: Number(item.total || 0),
        realized_total: Number(item.realized_total || 0),
        overdue_total: Number(item.overdue_total || 0),
        ratings: {
          ruim: Number(item.rating_ruim_total || 0),
          bom: Number(item.rating_bom_total || 0),
          otimo: Number(item.rating_otimo_total || 0),
        },
        recent_records: groupedRecent.get(key) || [],
      };
    }),
    statuses: statusTotals.reduce((acc, item) => {
      acc[String(item.status_name || 'Novo').trim() || 'Novo'] = Number(item.total || 0);
      return acc;
    }, {}),
    ratings: {
      ruim: Number(filterTotals?.rating_ruim_total || 0),
      bom: Number(filterTotals?.rating_bom_total || 0),
      otimo: Number(filterTotals?.rating_otimo_total || 0),
    },
    rating_percentages: {
      ruim: Number(totalRow?.total || 0) ? Math.round((Number(filterTotals?.rating_ruim_total || 0) / Number(totalRow.total || 0)) * 100) : 0,
      bom: Number(totalRow?.total || 0) ? Math.round((Number(filterTotals?.rating_bom_total || 0) / Number(totalRow.total || 0)) * 100) : 0,
      otimo: Number(totalRow?.total || 0) ? Math.round((Number(filterTotals?.rating_otimo_total || 0) / Number(totalRow.total || 0)) * 100) : 0,
    },
    rating_breakdown: ratingTotals.reduce((acc, item) => {
      const key = String(item.rating_name || '').trim() || 'sem_avaliacao';
      acc[key] = Number(item.total || 0);
      return acc;
    }, {}),
    today_key: todayKey,
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
      if (field === 'operational_status') {
        const normalizedStatus = normalizeSalesOperationalStatus(payload[field]);
        if (!normalizedStatus) throw new Error('invalid_operational_status');
        updates[field] = normalizedStatus;
        continue;
      }
      if (field === 'post_sale_rating') {
        const normalizedRating = normalizePostSaleRating(payload[field]);
        if (payload[field] !== null && payload[field] !== undefined && String(payload[field]).trim() && !normalizedRating) {
          throw new Error('invalid_post_sale_rating');
        }
        updates[field] = normalizedRating;
        continue;
      }
      updates[field] = String(payload[field] ?? '').trim() || null;
    }
  }

  if (!Object.keys(updates).length) {
    return serializeSalesRecord(existing);
  }

  const merged = { ...existing, ...updates };
  await run(
    "UPDATE sales_records SET operational_status=?, follow_up_notes=?, next_action=?, next_action_date=?, observations=?, feedback=?, post_sale_rating=?, last_modified_by=?, updated_at=datetime('now') WHERE id=?",
    [
      merged.operational_status || 'Novo',
      merged.follow_up_notes,
      merged.next_action,
      merged.next_action_date,
      merged.observations,
      merged.feedback,
      merged.post_sale_rating,
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
  const availableInputs = [
    salesWorkbookPath && fs.existsSync(salesWorkbookPath) ? {
      kind: 'sales_workbook',
      filePath: salesWorkbookPath,
      workbookName: salesWorkbookName || path.basename(salesWorkbookPath),
    } : null,
    postSaleWorkbookPath && fs.existsSync(postSaleWorkbookPath) ? {
      kind: 'post_sale_workbook',
      filePath: postSaleWorkbookPath,
      workbookName: postSaleWorkbookName || path.basename(postSaleWorkbookPath),
    } : null,
  ].filter(Boolean);

  if (!availableInputs.length) {
    throw new Error('missing_sales_or_post_sale_workbook');
  }

  const source = await ensureSalesImportSource();
  await ensureDefaultCloserCatalog();
  await ensurePostSaleCloserCatalog(DEFAULT_POST_SALE_CLOSER_NAMES);

  const parsedDatasets = [];
  const processedPaths = new Set();
  const syncedCloserNames = [];

  for (const input of availableInputs) {
    const fileKey = path.resolve(input.filePath);
    if (processedPaths.has(fileKey)) continue;
    processedPaths.add(fileKey);
    const workbook = readWorkbookFromFile(input.filePath);
    const sheetNames = Array.isArray(workbook?.SheetNames) ? workbook.SheetNames : [];
    const hasSalesPrimarySheet = sheetNames.includes(SALES_PRIMARY_SHEET);
    const supportedCommercialSheets = hasSalesPrimarySheet ? [SALES_PRIMARY_SHEET] : listCommercialSalesSheetNames(workbook);
    const closerSheets = extractCloserSheetNames(workbook);

    for (const salesSheetName of supportedCommercialSheets) {
      const salesParsed = parseMatriculasWorkbook(workbook, {
        workbookName: input.workbookName,
        sheetName: salesSheetName,
      });
      if (salesParsed.records.length) {
        parsedDatasets.push({
          source_kind: 'sales',
          workbook_name: salesParsed.workbook_name,
          sheet_name: salesParsed.sheet_name,
          records: salesParsed.records,
        });
      }
    }

    if (closerSheets.length) {
      const postSaleParsed = parsePostSaleWorkbook(workbook, {
        workbookName: input.workbookName,
      });
      if (postSaleParsed.records.length) {
        parsedDatasets.push({
          source_kind: 'post_sale',
          workbook_name: postSaleParsed.workbook_name,
          sheet_names: postSaleParsed.sheet_names,
          records: postSaleParsed.records,
        });
      }
      syncedCloserNames.push(...closerSheets);
      for (const officialName of closerSheets) {
        await ensureCloserRecord({ official_name: officialName, display_name: officialName, status: 'active' }, { aliasOrigin: 'post_sale_workbook' });
      }
    }
  }

  if (!parsedDatasets.length) {
    throw new Error('sales_workbook_without_supported_sheets');
  }

  const uniqueCloserNames = Array.from(new Set(syncedCloserNames.map((item) => String(item || '').trim()).filter(Boolean)));
  const closerUsersProvisioned = uniqueCloserNames.length
    ? await ensureCloserOperationalUsers(uniqueCloserNames, actorUserId)
    : [];
  const closerCatalog = await getCloserCatalog();
  const flattenedRecords = parsedDatasets.flatMap((item) => item.records || []);
  const primaryDataset = parsedDatasets.find((item) => item.source_kind === 'sales') || parsedDatasets[0];
  const sourceWorkbookLabel = Array.from(new Set(parsedDatasets.map((item) => item.workbook_name).filter(Boolean))).join(' | ');

  const runResult = await run(
    "INSERT INTO sales_import_runs (source_id, origin_type, source_workbook, post_sale_workbook, source_sheet, total_rows, status, triggered_by, summary_json, updated_at) VALUES (?, 'manual_upload', ?, ?, ?, ?, 'running', ?, ?, datetime('now'))",
    [
      source?.id || null,
      primaryDataset?.workbook_name || sourceWorkbookLabel || null,
      uniqueCloserNames.length ? (postSaleWorkbookName ? path.basename(postSaleWorkbookName) : (postSaleWorkbookPath ? path.basename(postSaleWorkbookPath) : sourceWorkbookLabel || null)) : null,
      primaryDataset?.sheet_name || SALES_PRIMARY_SHEET,
      flattenedRecords.length,
      actorUserId,
      JSON.stringify({
        synced_closers: uniqueCloserNames,
        provisioned_users: closerUsersProvisioned.map((item) => ({
          closer_id: item.closer_id,
          user_id: item.user_id,
          user_email: item.user_email,
          created_user: item.created_user,
        })),
      }),
    ]
  );

  const importRunId = runResult.lastID;
  let insertedRows = 0;
  let updatedRows = 0;
  let duplicateRows = 0;
  let ignoredRows = 0;
  const importedRecordIds = [];

  for (const item of flattenedRecords) {
    const match = await resolveCloserMatch(item.closer_original, closerCatalog);
    const prepared = {
      ...item,
      source_id: source?.id || null,
      import_run_id: importRunId,
      origin_type: String(item.origin_type || (item.source_sheet && item.source_sheet !== SALES_PRIMARY_SHEET ? 'post_sale_import' : 'spreadsheet_import')).trim(),
      closer_normalized: match.normalizedName || item.closer_original,
      closer_id: match.closer?.id || null,
      user_id: match.closer?.user_id || null,
      lead_stage: normalizeLeadStage(item.lead_stage || (item.origin_type === 'post_sale_import' ? 'convertido' : (item.sale_date ? 'fechado' : 'lead'))),
      source_payload_json: safeJsonStringify(item.source_payload || {}, "{}"),
      last_synced_at: new Date().toISOString(),
    };

    if (!prepared.student_name && !prepared.phone && !prepared.language) {
      ignoredRows += 1;
      continue;
    }

    const existing = await get('SELECT * FROM sales_records WHERE dedupe_hash=? LIMIT 1', [prepared.dedupe_hash]);
    const persisted = mergeImportedSalesRecord(existing, prepared);
    if (!existing) {
      const created = await run(
        "INSERT INTO sales_records (source_id, import_run_id, origin_type, source_workbook, source_sheet, source_row_number, source_row_identifier, dedupe_hash, row_hash, student_name, phone, contact_email, course_name, level_name, teacher_name, attendant_name, sale_month, sale_date, semester_label, availability, modality, class_type, system_name, contract_status, language, closer_original, closer_normalized, closer_id, user_id, media_source, profession, indication, feedback, observations, lead_stage, post_sale_rating, source_payload_json, last_synced_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))",
        [
          persisted.source_id,
          persisted.import_run_id,
          persisted.origin_type,
          persisted.source_workbook,
          persisted.source_sheet,
          persisted.source_row_number,
          persisted.source_row_identifier,
          persisted.dedupe_hash,
          persisted.row_hash,
          persisted.student_name,
          persisted.phone,
          persisted.contact_email,
          persisted.course_name,
          persisted.level_name,
          persisted.teacher_name,
          persisted.attendant_name,
          persisted.sale_month,
          persisted.sale_date,
          persisted.semester_label,
          persisted.availability,
          persisted.modality,
          persisted.class_type,
          persisted.system_name,
          persisted.contract_status,
          persisted.language,
          persisted.closer_original,
          persisted.closer_normalized,
          persisted.closer_id,
          persisted.user_id,
          persisted.media_source,
          persisted.profession,
          persisted.indication,
          persisted.feedback,
          persisted.observations,
          persisted.lead_stage,
          persisted.post_sale_rating,
          persisted.source_payload_json,
          persisted.last_synced_at,
        ]
      );
      insertedRows += 1;
      importedRecordIds.push(created.lastID);
      await logEntityChange({
        entityType: 'sales_record',
        entityId: created.lastID,
        action: 'created',
        actorUserId,
        closerId: persisted.closer_id,
        origin: persisted.origin_type,
        detail: {
          source_workbook: persisted.source_workbook,
          source_sheet: persisted.source_sheet,
          source_row_identifier: persisted.source_row_identifier,
        },
      });
      continue;
    }

    if (!hasImportedSalesChanges(existing, persisted)) {
      duplicateRows += 1;
      continue;
    }

    await recordSalesImportChange(existing, persisted, actorUserId, 'spreadsheet_sync');
    await run(
      "UPDATE sales_records SET source_id=?, import_run_id=?, origin_type=?, source_workbook=?, source_sheet=?, source_row_number=?, source_row_identifier=?, row_hash=?, student_name=?, phone=?, contact_email=?, course_name=?, level_name=?, teacher_name=?, attendant_name=?, sale_month=?, sale_date=?, semester_label=?, availability=?, modality=?, class_type=?, system_name=?, contract_status=?, language=?, closer_original=?, closer_normalized=?, closer_id=?, user_id=?, media_source=?, profession=?, indication=?, feedback=?, observations=?, lead_stage=?, source_payload_json=?, last_synced_at=?, updated_at=datetime('now') WHERE id=?",
      [
        persisted.source_id,
        persisted.import_run_id,
        persisted.origin_type,
        persisted.source_workbook,
        persisted.source_sheet,
        persisted.source_row_number,
        persisted.source_row_identifier,
        persisted.row_hash,
        persisted.student_name,
        persisted.phone,
        persisted.contact_email,
        persisted.course_name,
        persisted.level_name,
        persisted.teacher_name,
        persisted.attendant_name,
        persisted.sale_month,
        persisted.sale_date,
        persisted.semester_label,
        persisted.availability,
        persisted.modality,
        persisted.class_type,
        persisted.system_name,
        persisted.contract_status,
        persisted.language,
        persisted.closer_original,
        persisted.closer_normalized,
        persisted.closer_id,
        persisted.user_id,
        persisted.media_source,
        persisted.profession,
        persisted.indication,
        persisted.feedback,
        persisted.observations,
        persisted.lead_stage,
        persisted.source_payload_json,
        persisted.last_synced_at,
        existing.id,
      ]
    );
    updatedRows += 1;
    importedRecordIds.push(existing.id);
  }

  const reconciliation = await reconcileSalesImportRun(importRunId, actorUserId);

  const summary = {
    synced_closers: uniqueCloserNames,
    provisioned_users: closerUsersProvisioned,
    imported_record_ids: importedRecordIds.slice(0, 20),
    imported_sources: parsedDatasets.map((dataset) => ({
      source_kind: dataset.source_kind,
      workbook_name: dataset.workbook_name,
      sheet_name: dataset.sheet_name || null,
      sheet_names: dataset.sheet_names || [],
      total_records: Number((dataset.records || []).length || 0),
    })),
    reconciliation,
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
      ignored_rows: ignoredRows,
      synced_closers: uniqueCloserNames,
      provisioned_users: closerUsersProvisioned.map((item) => ({
        closer_id: item.closer_id,
        user_id: item.user_id,
        created_user: item.created_user,
      })),
      workbook: sourceWorkbookLabel,
    });
  }

  return {
    import_run_id: importRunId,
    total_rows: flattenedRecords.length,
    inserted_rows: insertedRows,
    updated_rows: updatedRows,
    duplicate_rows: duplicateRows,
    ignored_rows: ignoredRows,
    synced_closers: uniqueCloserNames,
    provisioned_users: closerUsersProvisioned,
    reconciliation,
    workbook: sourceWorkbookLabel,
    sheet_name: primaryDataset?.sheet_name || null,
    sources: summary.imported_sources,
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
    restricted_scope: scope.restrictedPostSale,
    status_options: SALES_OPERATIONAL_STATUS_OPTIONS.slice(),
    rating_options: POST_SALE_RATING_OPTIONS.slice(),
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

function normalizeStudentHubViewKey(value = "") {
  const safe = String(value || "").trim();
  return STUDENT_HUB_ALL_VIEW_KEYS.includes(safe) ? safe : "student-search";
}

function getStudentHubAreaByViewKey(viewKey = "") {
  const safe = normalizeStudentHubViewKey(viewKey);
  if (STUDENT_HUB_COMMERCIAL_VIEW_KEYS.includes(safe)) return "commercial";
  if (STUDENT_HUB_FINANCIAL_VIEW_KEYS.includes(safe)) return "financial";
  return "attendance";
}

function normalizeLeadStage(value = "", fallback = "lead") {
  const safe = normalizeAcademicText(value);
  if (!safe) return fallback;
  const matched = STUDENT_HUB_LEAD_STAGE_OPTIONS.find((item) => normalizeAcademicText(item) === safe);
  return matched || fallback;
}

function normalizeFinancialContractStatus(value = "", fallback = "draft") {
  const safe = normalizeAcademicText(value);
  if (!safe) return fallback;
  const matched = FINANCIAL_CONTRACT_STATUS_OPTIONS.find((item) => normalizeAcademicText(item) === safe);
  return matched || fallback;
}

function normalizeFinancialInstallmentStatus(value = "", fallback = "pending") {
  const safe = normalizeAcademicText(value);
  if (!safe) return fallback;
  const matched = FINANCIAL_INSTALLMENT_STATUS_OPTIONS.find((item) => normalizeAcademicText(item) === safe);
  return matched || fallback;
}

function normalizeDigits(value = "") {
  return String(value || "").replace(/\D+/g, "");
}

function parseMoneyValue(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const normalized = String(value)
    .replace(/\s+/g, "")
    .replace(/\./g, "")
    .replace(",", ".")
    .replace(/[^\d.-]/g, "");
  const numeric = Number(normalized);
  return Number.isFinite(numeric) ? numeric : null;
}

function addMonthsToDateKey(dateKey = "", months = 0) {
  const safe = normalizeAcademicDateInput(dateKey);
  if (!safe) return null;
  const [year, month, day] = safe.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day || 1, 12, 0, 0));
  date.setUTCMonth(date.getUTCMonth() + Number(months || 0));
  return date.toISOString().slice(0, 10);
}

async function createStudentTimelineEntry(payload = {}) {
  const studentId = Number(payload.student_id || 0) || null;
  if (!studentId) return null;
  const created = await run(
    `INSERT INTO student_timeline
       (student_id, enrollment_id, sales_record_id, contract_id, installment_id, event_type, title, description, actor_user_id, metadata_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, coalesce(?, datetime('now')))`,
    [
      studentId,
      Number(payload.enrollment_id || 0) || null,
      Number(payload.sales_record_id || 0) || null,
      Number(payload.contract_id || 0) || null,
      Number(payload.installment_id || 0) || null,
      sanitizePersistedText(payload.event_type || "note"),
      sanitizePersistedText(payload.title || "Atualização do aluno"),
      sanitizePersistedText(payload.description || "", { trim: false }) || null,
      Number(payload.actor_user_id || 0) || null,
      safeJsonStringify(payload.metadata || {}, "{}"),
      normalizeAcademicDateTimeInput(payload.created_at || "") || null,
    ]
  );
  return created.lastID || null;
}

async function ensureStudentTimelineEntry(payload = {}) {
  const studentId = Number(payload.student_id || 0) || null;
  if (!studentId) return null;
  const enrollmentId = Number(payload.enrollment_id || 0) || null;
  const salesRecordId = Number(payload.sales_record_id || 0) || null;
  const contractId = Number(payload.contract_id || 0) || null;
  const installmentId = Number(payload.installment_id || 0) || null;
  const eventType = sanitizePersistedText(payload.event_type || "note");
  const title = sanitizePersistedText(payload.title || "Atualizacao do aluno");
  const description = sanitizePersistedText(payload.description || "", { trim: false }) || null;
  const existing = await get(
    `SELECT id
       FROM student_timeline
      WHERE student_id=?
        AND coalesce(enrollment_id, 0)=coalesce(?, 0)
        AND coalesce(sales_record_id, 0)=coalesce(?, 0)
        AND coalesce(contract_id, 0)=coalesce(?, 0)
        AND coalesce(installment_id, 0)=coalesce(?, 0)
        AND event_type=?
        AND coalesce(title, '')=?
        AND coalesce(description, '')=?
      LIMIT 1`,
    [studentId, enrollmentId, salesRecordId, contractId, installmentId, eventType, title, description || ""]
  );
  if (existing?.id) return existing.id;
  return createStudentTimelineEntry({
    ...payload,
    student_id: studentId,
    enrollment_id: enrollmentId,
    sales_record_id: salesRecordId,
    contract_id: contractId,
    installment_id: installmentId,
    event_type: eventType,
    title,
    description,
    created_at: payload.created_at || null,
  });
}

function inferLeadStageFromImportedRecord(record = {}) {
  const currentStage = normalizeLeadStage(record.lead_stage || "", "");
  if (currentStage) return currentStage;
  if (String(record.origin_type || "").trim().toLowerCase() === "post_sale_import") return "convertido";
  return record.sale_date ? "fechado" : "lead";
}

function normalizeSalesContractSignal(value = "") {
  return normalizeBusinessText(String(value || "").trim()).replace(/\s+/g, " ").trim();
}

function inferContractStatusFromSalesRecord(record = {}) {
  const raw = normalizeSalesContractSignal(record.contract_status || "");
  const leadStage = normalizeLeadStage(record.lead_stage || inferLeadStageFromImportedRecord(record), "lead");
  if (raw.includes("cancel") || raw.includes("desist")) return "cancelled";
  if (raw.includes("pendente") || raw.includes("pend")) return "pending";
  if (raw && (raw.includes("ok") || raw.includes("sim") || raw.includes("plataforma") || raw.includes("empresa"))) {
    return "active";
  }
  if (leadStage === "convertido") return "active";
  if (leadStage === "fechado") return "pending";
  return "draft";
}

async function findEnrollmentMatchForSalesRecord(studentId, record = {}) {
  const safeStudentId = Number(studentId || 0) || null;
  if (!safeStudentId) return null;
  const semester = String(record.semester_label || "").trim();
  const language = String(record.language || "").trim();
  const modality = String(record.modality || "").trim();
  return get(
    `SELECT e.id, e.class_id, e.enrollment_number, e.enrollment_status, e.contract_status, e.payment_status, e.pedagogical_status,
            ap.language, ap.modality, ap.semester_label,
            st.code AS school_term_code
       FROM enrollments e
       LEFT JOIN academic_programs ap ON ap.id = e.academic_program_id
       LEFT JOIN school_terms st ON st.id = e.school_term_id
      WHERE e.student_id=?
      ORDER BY
        CASE
          WHEN ? <> '' AND (lower(coalesce(st.code, ''))=lower(?) OR lower(coalesce(ap.semester_label, ''))=lower(?)) THEN 0
          ELSE 1
        END ASC,
        CASE
          WHEN ? <> '' AND lower(coalesce(ap.language, ''))=lower(?) THEN 0
          ELSE 1
        END ASC,
        CASE
          WHEN ? <> '' AND lower(coalesce(ap.modality, ''))=lower(?) THEN 0
          ELSE 1
        END ASC,
        CASE
          WHEN lower(coalesce(e.enrollment_status, '')) IN ('matriculado', 'aguardando turma', 'pre-matricula') THEN 0
          ELSE 1
        END ASC,
        CASE WHEN e.class_id IS NOT NULL THEN 0 ELSE 1 END ASC,
        datetime(e.updated_at) DESC,
        e.id DESC
      LIMIT 1`,
    [safeStudentId, semester, semester, semester, language, language, modality, modality]
  );
}

async function findExistingContractForSalesContext(studentId, enrollmentId = null, salesRecordId = null) {
  if (salesRecordId) {
    const bySalesRecord = await get("SELECT * FROM financial_contracts WHERE sales_record_id=? ORDER BY datetime(updated_at) DESC, id DESC LIMIT 1", [salesRecordId]);
    if (bySalesRecord) return bySalesRecord;
  }
  if (!studentId) return null;
  return get(
    "SELECT * FROM financial_contracts WHERE student_id=? AND coalesce(enrollment_id, 0)=coalesce(?, 0) ORDER BY datetime(updated_at) DESC, id DESC LIMIT 1",
    [studentId, Number(enrollmentId || 0) || null]
  );
}

async function reconcileImportedSalesRecord(record = {}, actorUserId = null) {
  const safeRecordId = Number(record.id || 0) || null;
  if (!safeRecordId) {
    return { linked_student: false, linked_enrollment: false, contract_created: false, timeline_events: 0 };
  }

  const actorUser = actorUserId ? { id: actorUserId, sub: actorUserId } : null;
  let student = null;
  if (Number(record.student_id || 0)) {
    student = await get("SELECT id, full_name, cpf, phone, whatsapp, email FROM students WHERE id=? LIMIT 1", [record.student_id]);
  }
  if (!student) {
    student = await findAcademicStudentMatch({
      fullName: record.student_name,
      normalizedName: normalizePersonKey(record.student_name || ""),
      phone: record.phone,
    });
  }
  if (!student?.id) {
    return { linked_student: false, linked_enrollment: false, contract_created: false, timeline_events: 0 };
  }

  const enrollment = Number(record.enrollment_id || 0)
    ? await get("SELECT * FROM enrollments WHERE id=? LIMIT 1", [record.enrollment_id])
    : await findEnrollmentMatchForSalesRecord(student.id, record);
  const leadStage = normalizeLeadStage(
    record.lead_stage
      || (enrollment?.id ? "convertido" : inferLeadStageFromImportedRecord(record)),
    enrollment?.id ? "convertido" : inferLeadStageFromImportedRecord(record)
  );

  await run(
    "UPDATE sales_records SET student_id=?, enrollment_id=?, lead_stage=?, updated_at=datetime('now') WHERE id=?",
    [student.id, enrollment?.id || null, leadStage, safeRecordId]
  );

  let timelineEvents = 0;
  if (leadStage === "convertido") {
    const eventId = await ensureStudentTimelineEntry({
      student_id: student.id,
      enrollment_id: enrollment?.id || null,
      sales_record_id: safeRecordId,
      actor_user_id: actorUserId,
      event_type: "commercial_linked",
      title: "Lead vinculado ao aluno",
      description: `${record.student_name || student.full_name} foi relacionado ao fluxo comercial importado.`,
      metadata: {
        source_workbook: record.source_workbook || null,
        source_sheet: record.source_sheet || null,
        closer_name: record.closer_normalized || record.closer_original || null,
      },
    });
    if (eventId) timelineEvents += 1;
  }

  let contract = await findExistingContractForSalesContext(student.id, enrollment?.id || null, safeRecordId);
  let contractCreated = false;
  if (!contract?.id && (leadStage === "convertido" || leadStage === "fechado" || String(record.origin_type || "").trim().toLowerCase() === "post_sale_import")) {
    const contractDetail = await saveFinancialContractRecord({
      student_id: student.id,
      enrollment_id: enrollment?.id || null,
      sales_record_id: safeRecordId,
      responsible_name: null,
      responsible_cpf: null,
      contract_number: generateContractNumber(student.id, enrollment?.id || 0),
      contract_type: "course_enrollment",
      contract_status: inferContractStatusFromSalesRecord({ ...record, lead_stage: leadStage }),
      total_amount: null,
      installments_count: 0,
      first_due_date: null,
      notes: "Contrato inicial criado a partir da consolidacao comercial. Parcelas dependem de preenchimento operacional/manual.",
      source_workbook: record.source_workbook || null,
      source_sheet: record.source_sheet || null,
      source_row_identifier: record.source_row_identifier || `sales_record:${safeRecordId}`,
      source_payload: {
        imported_from_sales_record_id: safeRecordId,
        workbook: record.source_workbook || null,
        sheet: record.source_sheet || null,
      },
      metadata: {
        auto_created_from_sales_import: true,
      },
    }, actorUser, { createTimeline: true });
    contract = contractDetail?.contract || null;
    contractCreated = Boolean(contract?.id);
  }

  if (contract?.id && Number(record.financial_contract_id || 0) !== Number(contract.id)) {
    await run(
      "UPDATE sales_records SET financial_contract_id=?, lead_stage=?, converted_at=COALESCE(converted_at, CURRENT_TIMESTAMP), updated_at=datetime('now') WHERE id=?",
      [contract.id, leadStage === "lead" ? "fechado" : leadStage, safeRecordId]
    );
  }

  return {
    linked_student: true,
    linked_enrollment: Boolean(enrollment?.id),
    contract_created: contractCreated,
    timeline_events: timelineEvents,
  };
}

async function reconcileSalesImportRun(importRunId, actorUserId = null) {
  const safeImportRunId = Number(importRunId || 0) || null;
  if (!safeImportRunId) {
    return { linked_students: 0, linked_enrollments: 0, contracts_created: 0, timeline_events: 0 };
  }
  const rows = await all("SELECT * FROM sales_records WHERE import_run_id=? ORDER BY id ASC", [safeImportRunId]);
  const totals = { linked_students: 0, linked_enrollments: 0, contracts_created: 0, timeline_events: 0 };
  for (const row of rows) {
    const result = await reconcileImportedSalesRecord(row, actorUserId);
    if (result.linked_student) totals.linked_students += 1;
    if (result.linked_enrollment) totals.linked_enrollments += 1;
    if (result.contract_created) totals.contracts_created += 1;
    totals.timeline_events += Number(result.timeline_events || 0);
  }
  return totals;
}

function normalizeWeekdayValue(value = "") {
  const safe = normalizeAcademicText(value);
  if (!safe) return "";
  if (safe.startsWith("seg")) return "segunda";
  if (safe.startsWith("ter")) return "terca";
  if (safe.startsWith("qua")) return "quarta";
  if (safe.startsWith("qui")) return "quinta";
  if (safe.startsWith("sex")) return "sexta";
  if (safe.startsWith("sab")) return "sabado";
  if (safe.startsWith("dom")) return "domingo";
  return "";
}

function weekdayToIndex(value = "") {
  const safe = normalizeWeekdayValue(value);
  if (safe === "domingo") return 0;
  if (safe === "segunda") return 1;
  if (safe === "terca") return 2;
  if (safe === "quarta") return 3;
  if (safe === "quinta") return 4;
  if (safe === "sexta") return 5;
  if (safe === "sabado") return 6;
  return null;
}

function iterateDateKeys(startDate = "", endDate = "") {
  const start = normalizeAcademicDateInput(startDate);
  const end = normalizeAcademicDateInput(endDate);
  if (!start || !end) return [];
  const current = new Date(`${start}T12:00:00`);
  const finish = new Date(`${end}T12:00:00`);
  const out = [];
  while (current <= finish) {
    out.push(current.toISOString().slice(0, 10));
    current.setDate(current.getDate() + 1);
  }
  return out;
}

async function ensureAcademicClassSessionsSeed(actorUserId = null) {
  const today = new Date();
  const windowStart = new Date(today);
  windowStart.setDate(windowStart.getDate() - 45);
  const windowEnd = new Date(today);
  windowEnd.setDate(windowEnd.getDate() + 120);
  const rows = await all(
    `SELECT cs.id AS schedule_id, cs.class_id, cs.weekday, cs.start_time, cs.end_time, cs.notes AS schedule_notes,
            c.name AS class_name, c.status AS class_status,
            st.start_date AS term_start_date, st.end_date AS term_end_date
       FROM class_schedules cs
       JOIN classes c ON c.id = cs.class_id
       LEFT JOIN school_terms st ON st.id = c.school_term_id
      WHERE lower(coalesce(c.status, '')) <> 'cancelada'
      ORDER BY cs.class_id ASC, cs.id ASC`
  );
  let created = 0;
  for (const row of rows) {
    const weekdayIndex = weekdayToIndex(row.weekday);
    if (weekdayIndex === null) continue;
    const startDate = normalizeAcademicDateInput(row.term_start_date) || windowStart.toISOString().slice(0, 10);
    const endDate = normalizeAcademicDateInput(row.term_end_date) || windowEnd.toISOString().slice(0, 10);
    const boundedStart = startDate < windowStart.toISOString().slice(0, 10) ? windowStart.toISOString().slice(0, 10) : startDate;
    const boundedEnd = endDate > windowEnd.toISOString().slice(0, 10) ? windowEnd.toISOString().slice(0, 10) : endDate;
    for (const dateKey of iterateDateKeys(boundedStart, boundedEnd)) {
      const probe = new Date(`${dateKey}T12:00:00`);
      if (probe.getDay() !== weekdayIndex) continue;
      const existing = await get(
        "SELECT id FROM class_sessions WHERE class_id=? AND coalesce(class_schedule_id, 0)=coalesce(?, 0) AND class_date=? LIMIT 1",
        [row.class_id, row.schedule_id, dateKey]
      );
      if (existing?.id) continue;
      await run(
        "INSERT INTO class_sessions (class_id, class_schedule_id, class_date, start_time, end_time, session_status, notes, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))",
        [
          row.class_id,
          row.schedule_id,
          dateKey,
          row.start_time || null,
          row.end_time || null,
          dateKey < brazilDateKey() ? "realizada" : "planejada",
          row.schedule_notes || null,
        ]
      );
      created += 1;
    }
  }
  if (actorUserId && created) {
    await logEvent(actorUserId, "academic_sessions_seeded", {
      created_sessions: created,
      source: "class_schedule_seed",
    });
  }
  return { created_sessions: created };
}

async function ensureAcademicTimelineBackfill(actorUserId = null) {
  const classHistoryRows = await all(
    `SELECT ech.enrollment_id, ech.reason, ech.notes, ech.changed_at, ech.changed_by_user_id,
            e.student_id, old_class.name AS old_class_name, new_class.name AS new_class_name
       FROM enrollment_class_history ech
       JOIN enrollments e ON e.id = ech.enrollment_id
       LEFT JOIN classes old_class ON old_class.id = ech.old_class_id
       LEFT JOIN classes new_class ON new_class.id = ech.new_class_id
      ORDER BY ech.id ASC`
  );
  const transferRows = await all(
    `SELECT st.enrollment_id, st.transfer_type, st.reason, st.notes, st.changed_at, st.changed_by_user_id,
            st.old_value_json, st.new_value_json, e.student_id
       FROM student_transfers st
       JOIN enrollments e ON e.id = st.enrollment_id
      ORDER BY st.id ASC`
  );

  let created = 0;
  for (const row of classHistoryRows) {
    const timelineId = await ensureStudentTimelineEntry({
      student_id: row.student_id,
      enrollment_id: row.enrollment_id,
      actor_user_id: row.changed_by_user_id || actorUserId,
      event_type: "academic_class_change",
      title: "Troca de turma",
      description: `${row.old_class_name || "Sem turma"} -> ${row.new_class_name || "Sem turma"}${row.reason ? ` (${row.reason})` : ""}`,
      metadata: {
        old_class_name: row.old_class_name || null,
        new_class_name: row.new_class_name || null,
        reason: row.reason || null,
        notes: row.notes || null,
      },
      created_at: row.changed_at,
    });
    if (timelineId) created += 1;
  }

  for (const row of transferRows) {
    const oldValue = safeJsonParse(row.old_value_json || "{}") || {};
    const newValue = safeJsonParse(row.new_value_json || "{}") || {};
    const title = row.transfer_type === "schedule_change"
      ? "Mudanca de horario"
      : row.transfer_type === "remanejamento"
        ? "Remanejamento"
        : row.transfer_type === "reversao_pedagogica"
          ? "Reversao pedagogica"
          : "Movimentacao academica";
    const descriptionParts = [];
    if (oldValue.class_name || newValue.target_class_label || newValue.class_name) {
      descriptionParts.push(`${oldValue.class_name || "Sem turma"} -> ${newValue.target_class_label || newValue.class_name || "Sem turma"}`);
    }
    if (row.reason) descriptionParts.push(row.reason);
    const timelineId = await ensureStudentTimelineEntry({
      student_id: row.student_id,
      enrollment_id: row.enrollment_id,
      actor_user_id: row.changed_by_user_id || actorUserId,
      event_type: row.transfer_type || "academic_transfer",
      title,
      description: descriptionParts.join(" | ") || row.notes || "Movimentacao academica registrada.",
      metadata: {
        transfer_type: row.transfer_type || null,
        old_value: oldValue,
        new_value: newValue,
        notes: row.notes || null,
      },
      created_at: row.changed_at,
    });
    if (timelineId) created += 1;
  }

  if (actorUserId && created) {
    await logEvent(actorUserId, "academic_timeline_backfilled", {
      created_entries: created,
    });
  }
  return { created_entries: created };
}

async function resolveStudentHubScope(user, viewKey = "") {
  if (!user) throw new Error("student_hub_access_denied");
  const requestedView = normalizeStudentHubViewKey(viewKey || "");
  const requestedArea = getStudentHubAreaByViewKey(requestedView);
  const hasAttendance = userHasDepartmentAccess(user, "atendimento");
  const hasCommercial = userHasDepartmentAccess(user, "comercial");
  const hasFinancial = userHasDepartmentAccess(user, "financeiro");
  const isAdmin = user.role === "admin";

  const scope = {
    enabled: isAdmin || hasAttendance || hasCommercial || hasFinancial,
    kind: isAdmin ? "admin" : (hasCommercial ? "commercial" : (hasFinancial ? "financial" : "attendance")),
    requested_view_key: requestedView,
    canSearchStudents: Boolean(isAdmin || hasAttendance || hasCommercial || hasFinancial),
    canManageCommercial: Boolean(isAdmin || hasCommercial),
    canManageFinancial: Boolean(isAdmin || hasFinancial || hasCommercial),
    canManageStudentData: Boolean(isAdmin || hasCommercial),
    canConvertLead: Boolean(isAdmin || hasCommercial),
    visible_areas: ["attendance", "commercial", "financial"].filter((item) => (
      isAdmin
      || (item === "attendance" && hasAttendance)
      || (item === "commercial" && hasCommercial)
      || (item === "financial" && hasFinancial)
    )),
  };

  if (!scope.enabled) throw new Error("student_hub_access_denied");
  if (!isAdmin && !scope.visible_areas.includes(requestedArea)) {
    throw new Error("student_hub_access_denied");
  }
  return scope;
}

function buildStudentHubSearchWhere(filters = {}) {
  const clauses = [];
  const params = [];
  const search = String(filters.search || "").trim();
  if (search) {
    const like = buildAcademicSearchLike(search);
    const digitsLike = `%${normalizeDigits(search)}%`;
    clauses.push(`(
      lower(coalesce(s.full_name, '')) LIKE lower(?)
      OR lower(coalesce(s.preferred_name, '')) LIKE lower(?)
      OR lower(coalesce(s.email, '')) LIKE lower(?)
      OR lower(coalesce(s.phone, '')) LIKE lower(?)
      OR lower(coalesce(s.whatsapp, '')) LIKE lower(?)
      OR replace(replace(replace(coalesce(s.cpf, ''), '.', ''), '-', ''), '/', '') LIKE ?
      OR replace(replace(replace(coalesce(s.rg, ''), '.', ''), '-', ''), '/', '') LIKE ?
      OR EXISTS (
        SELECT 1
          FROM student_guardians sg
         WHERE sg.student_id=s.id
           AND (
             lower(coalesce(sg.name, '')) LIKE lower(?)
             OR lower(coalesce(sg.email, '')) LIKE lower(?)
             OR lower(coalesce(sg.phone, '')) LIKE lower(?)
             OR lower(coalesce(sg.whatsapp, '')) LIKE lower(?)
             OR replace(replace(replace(coalesce(sg.cpf, ''), '.', ''), '-', ''), '/', '') LIKE ?
           )
      )
      OR EXISTS (
        SELECT 1
          FROM enrollments e
         WHERE e.student_id=s.id
           AND lower(coalesce(e.enrollment_number, '')) LIKE lower(?)
      )
      OR EXISTS (
        SELECT 1
          FROM financial_contracts fc
         WHERE fc.student_id=s.id
           AND (
             lower(coalesce(fc.contract_number, '')) LIKE lower(?)
             OR replace(replace(replace(coalesce(fc.responsible_cpf, ''), '.', ''), '-', ''), '/', '') LIKE ?
           )
      )
    )`);
    params.push(like, like, like, like, like, digitsLike, digitsLike, like, like, like, like, digitsLike, like, like, digitsLike);
  }
  if (filters.status) {
    clauses.push("lower(coalesce(s.status, ''))=lower(?)");
    params.push(String(filters.status).trim());
  }
  return {
    sql: clauses.length ? `WHERE ${clauses.join(" AND ")}` : "",
    params,
  };
}

async function listStudentHubStudents(scope, filters = {}) {
  const where = buildStudentHubSearchWhere(filters);
  const limit = Math.min(140, Math.max(1, Number(filters.limit || 60)));
  const params = [brazilDateKey(), ...where.params, limit];
  const rows = await all(
    `SELECT s.id, s.full_name, s.preferred_name, s.cpf, s.rg, s.email, s.phone, s.whatsapp, s.status, s.updated_at,
            (SELECT COUNT(*) FROM student_guardians sg WHERE sg.student_id=s.id) AS guardians_total,
            (SELECT COUNT(*) FROM enrollments e WHERE e.student_id=s.id) AS enrollments_total,
            (SELECT COALESCE(e.enrollment_status, '')
               FROM enrollments e
              WHERE e.student_id=s.id
              ORDER BY datetime(e.updated_at) DESC, e.id DESC
              LIMIT 1) AS current_enrollment_status,
            (SELECT COALESCE(c.name, '')
               FROM enrollments e
               LEFT JOIN classes c ON c.id = e.class_id
              WHERE e.student_id=s.id
              ORDER BY datetime(e.updated_at) DESC, e.id DESC
              LIMIT 1) AS current_class_name,
            (SELECT COALESCE(ap.language, '')
               FROM enrollments e
               LEFT JOIN academic_programs ap ON ap.id = e.academic_program_id
              WHERE e.student_id=s.id
              ORDER BY datetime(e.updated_at) DESC, e.id DESC
              LIMIT 1) AS current_language,
            (SELECT COUNT(*) FROM financial_contracts fc WHERE fc.student_id=s.id) AS contracts_total,
            (SELECT COUNT(*)
               FROM financial_contracts fc
               JOIN financial_installments fi ON fi.contract_id = fc.id
              WHERE fc.student_id=s.id
                AND (
                  lower(coalesce(fi.status, ''))='overdue'
                  OR (lower(coalesce(fi.status, ''))='pending' AND fi.due_date IS NOT NULL AND fi.due_date < ?)
                )) AS overdue_installments
       FROM students s
       ${where.sql}
      ORDER BY CASE WHEN lower(coalesce(s.status, ''))='ativo' THEN 0 ELSE 1 END, datetime(s.updated_at) DESC, lower(s.full_name) ASC
      LIMIT ?`,
    params
  );
  const summary = await get(
    `SELECT COUNT(*) AS total,
            SUM(CASE WHEN lower(coalesce(s.status, ''))='ativo' THEN 1 ELSE 0 END) AS active_total,
            SUM(CASE WHEN NOT EXISTS (SELECT 1 FROM student_guardians sg WHERE sg.student_id=s.id) THEN 1 ELSE 0 END) AS no_guardian_total,
            SUM(CASE WHEN EXISTS (SELECT 1 FROM financial_contracts fc WHERE fc.student_id=s.id) THEN 1 ELSE 0 END) AS students_with_contract_total,
            SUM(CASE WHEN EXISTS (
              SELECT 1
                FROM financial_contracts fc
                JOIN financial_installments fi ON fi.contract_id = fc.id
               WHERE fc.student_id=s.id
                 AND (
                   lower(coalesce(fi.status, ''))='overdue'
                   OR (lower(coalesce(fi.status, ''))='pending' AND fi.due_date IS NOT NULL AND fi.due_date < ?)
                 )
            ) THEN 1 ELSE 0 END) AS overdue_students
       FROM students s
       ${where.sql}`,
    [brazilDateKey(), ...where.params]
  );
  return {
    rows: rows.map(mapAcademicStudentRow),
    summary: {
      total: Number(summary?.total || 0),
      active_total: Number(summary?.active_total || 0),
      no_guardian_total: Number(summary?.no_guardian_total || 0),
      students_with_contract_total: Number(summary?.students_with_contract_total || 0),
      without_contract_total: Math.max(0, Number(summary?.total || 0) - Number(summary?.students_with_contract_total || 0)),
      overdue_students: Number(summary?.overdue_students || 0),
    },
  };
}

function buildResolvedLeadStageSql(alias = "sr") {
  return `COALESCE(NULLIF(${alias}.lead_stage, ''), CASE WHEN ${alias}.converted_at IS NOT NULL THEN 'convertido' ELSE 'lead' END)`;
}

function buildStudentHubLeadWhere(filters = {}) {
  const clauses = [];
  const params = [];
  if (filters.search) {
    const like = buildAcademicSearchLike(filters.search);
    clauses.push("(lower(coalesce(sr.student_name, '')) LIKE lower(?) OR lower(coalesce(sr.phone, '')) LIKE lower(?) OR lower(coalesce(sr.contact_email, '')) LIKE lower(?) OR lower(coalesce(sr.language, '')) LIKE lower(?) OR lower(coalesce(sr.attendant_name, '')) LIKE lower(?) OR lower(coalesce(sr.media_source, '')) LIKE lower(?) OR lower(coalesce(sr.observations, '')) LIKE lower(?))");
    params.push(like, like, like, like, like, like, like);
  }
  if (filters.leadStage) {
    clauses.push(`lower(${buildResolvedLeadStageSql("sr")})=lower(?)`);
    params.push(normalizeLeadStage(filters.leadStage));
  }
  if (filters.language) {
    clauses.push("lower(coalesce(sr.language, ''))=lower(?)");
    params.push(String(filters.language).trim());
  }
  if (filters.modality) {
    clauses.push("lower(coalesce(sr.modality, ''))=lower(?)");
    params.push(String(filters.modality).trim());
  }
  return {
    sql: clauses.length ? `WHERE ${clauses.join(" AND ")}` : "",
    params,
  };
}

async function listStudentHubLeads(scope, filters = {}) {
  const where = buildStudentHubLeadWhere(filters);
  const limit = Math.min(140, Math.max(1, Number(filters.limit || 60)));
  const stageSql = buildResolvedLeadStageSql("sr");
  const rows = await all(
    `SELECT sr.*, ${stageSql} AS resolved_lead_stage,
            COALESCE(c.display_name, c.official_name, sr.closer_normalized, sr.closer_original, 'Sem closer') AS closer_name,
            s.full_name AS linked_student_name,
            e.enrollment_number AS linked_enrollment_number
       FROM sales_records sr
       LEFT JOIN closers c ON c.id = sr.closer_id
       LEFT JOIN students s ON s.id = sr.student_id
       LEFT JOIN enrollments e ON e.id = sr.enrollment_id
       ${where.sql}
      ORDER BY CASE WHEN sr.converted_at IS NOT NULL THEN 1 ELSE 0 END ASC, datetime(coalesce(sr.updated_at, sr.created_at)) DESC, sr.id DESC
      LIMIT ?`,
    [...where.params, limit]
  );
  const summary = await get(
    `SELECT COUNT(*) AS total,
            SUM(CASE WHEN lower(${stageSql})='lead' THEN 1 ELSE 0 END) AS lead_total,
            SUM(CASE WHEN lower(${stageSql})='negociacao' THEN 1 ELSE 0 END) AS negotiation_total,
            SUM(CASE WHEN lower(${stageSql})='fechado' THEN 1 ELSE 0 END) AS closed_total,
            SUM(CASE WHEN lower(${stageSql})='convertido' THEN 1 ELSE 0 END) AS converted_total,
            SUM(CASE WHEN sr.student_id IS NULL THEN 1 ELSE 0 END) AS unlinked_total
       FROM sales_records sr
       ${where.sql}`,
    where.params
  );
  return {
    rows: rows.map((row) => ({
      ...serializeSalesRecord(row),
      resolved_lead_stage: row.resolved_lead_stage || "lead",
    })),
    summary: {
      total: Number(summary?.total || 0),
      lead_total: Number(summary?.lead_total || 0),
      negotiation_total: Number(summary?.negotiation_total || 0),
      closed_total: Number(summary?.closed_total || 0),
      converted_total: Number(summary?.converted_total || 0),
      unlinked_total: Number(summary?.unlinked_total || 0),
    },
  };
}

function buildStudentHubContractWhere(filters = {}) {
  const clauses = [];
  const params = [];
  const search = String(filters.search || "").trim();
  if (search) {
    const like = buildAcademicSearchLike(search);
    const digitsLike = `%${normalizeDigits(search)}%`;
    clauses.push("(lower(coalesce(s.full_name, '')) LIKE lower(?) OR lower(coalesce(fc.contract_number, '')) LIKE lower(?) OR lower(coalesce(fc.responsible_name, '')) LIKE lower(?) OR replace(replace(replace(coalesce(fc.responsible_cpf, ''), '.', ''), '-', ''), '/', '') LIKE ?)");
    params.push(like, like, like, digitsLike);
  }
  if (filters.contractStatus) {
    clauses.push("lower(coalesce(fc.contract_status, ''))=lower(?)");
    params.push(normalizeFinancialContractStatus(filters.contractStatus));
  }
  if (filters.onlyDelinquent) {
    clauses.push(`EXISTS (
      SELECT 1
        FROM financial_installments fi
       WHERE fi.contract_id=fc.id
         AND (
           lower(coalesce(fi.status, ''))='overdue'
           OR (lower(coalesce(fi.status, ''))='pending' AND fi.due_date IS NOT NULL AND fi.due_date < ?)
         )
    )`);
    params.push(brazilDateKey());
  }
  return {
    sql: clauses.length ? `WHERE ${clauses.join(" AND ")}` : "",
    params,
  };
}

function computeInstallmentEffectiveStatus(installment = {}) {
  const explicit = normalizeFinancialInstallmentStatus(installment.status || "", "pending");
  if (["paid", "cancelled", "negotiated", "overdue"].includes(explicit)) return explicit;
  if (installment.due_date && String(installment.due_date).slice(0, 10) < brazilDateKey()) return "overdue";
  return "pending";
}

async function listFinancialInstallmentsByContractId(contractId) {
  const rows = await all(
    `SELECT id, contract_id, installment_number, due_date, amount, status, paid_at, payment_method, reference_label, notes, metadata_json, created_at, updated_at
       FROM financial_installments
      WHERE contract_id=?
      ORDER BY installment_number ASC, due_date ASC, id ASC`,
    [contractId]
  );
  return rows.map((row) => ({
    ...row,
    amount: Number(row.amount || 0),
    metadata: safeJsonParse(row.metadata_json || "{}") || {},
    effective_status: computeInstallmentEffectiveStatus(row),
  }));
}

function summarizeContractInstallments(installments = []) {
  return (Array.isArray(installments) ? installments : []).reduce((acc, item) => {
    acc.total += 1;
    acc.amount_total += Number(item.amount || 0);
    acc[`${item.effective_status}_total`] = Number(acc[`${item.effective_status}_total`] || 0) + 1;
    return acc;
  }, {
    total: 0,
    amount_total: 0,
    pending_total: 0,
    paid_total: 0,
    overdue_total: 0,
    cancelled_total: 0,
    negotiated_total: 0,
  });
}

async function listStudentHubContracts(scope, filters = {}) {
  const where = buildStudentHubContractWhere(filters);
  const limit = Math.min(140, Math.max(1, Number(filters.limit || 60)));
  const todayKey = brazilDateKey();
  const rows = await all(
    `SELECT fc.*, s.full_name AS student_name, s.cpf AS student_cpf, s.phone AS student_phone, e.enrollment_number,
            (SELECT COUNT(*) FROM financial_installments fi WHERE fi.contract_id=fc.id) AS installments_total,
            (SELECT COUNT(*) FROM financial_installments fi WHERE fi.contract_id=fc.id AND lower(coalesce(fi.status, ''))='paid') AS paid_total,
            (SELECT COUNT(*) FROM financial_installments fi WHERE fi.contract_id=fc.id AND lower(coalesce(fi.status, ''))='pending') AS pending_total,
            (SELECT COUNT(*) FROM financial_installments fi WHERE fi.contract_id=fc.id AND (lower(coalesce(fi.status, ''))='overdue' OR (lower(coalesce(fi.status, ''))='pending' AND fi.due_date IS NOT NULL AND fi.due_date < ?))) AS overdue_total
       FROM financial_contracts fc
       JOIN students s ON s.id = fc.student_id
       LEFT JOIN enrollments e ON e.id = fc.enrollment_id
       ${where.sql}
      ORDER BY CASE WHEN lower(coalesce(fc.contract_status, '')) IN ('active', 'signed') THEN 0 ELSE 1 END, datetime(fc.updated_at) DESC, fc.id DESC
      LIMIT ?`,
    [todayKey, ...where.params, limit]
  );
  const summary = await get(
    `SELECT COUNT(*) AS total,
            SUM(CASE WHEN lower(coalesce(fc.contract_status, '')) IN ('active', 'signed') THEN 1 ELSE 0 END) AS active_total,
            SUM(CASE WHEN EXISTS (SELECT 1 FROM financial_installments fi WHERE fi.contract_id=fc.id AND lower(coalesce(fi.status, ''))='pending') THEN 1 ELSE 0 END) AS pending_contracts,
            SUM(CASE WHEN EXISTS (
              SELECT 1 FROM financial_installments fi
               WHERE fi.contract_id=fc.id
                 AND (lower(coalesce(fi.status, ''))='overdue' OR (lower(coalesce(fi.status, ''))='pending' AND fi.due_date IS NOT NULL AND fi.due_date < ?))
            ) THEN 1 ELSE 0 END) AS overdue_contracts
       FROM financial_contracts fc
       JOIN students s ON s.id = fc.student_id
       ${where.sql}`,
    [todayKey, ...where.params]
  );
  return {
    rows: rows.map((row) => ({
      ...row,
      total_amount: Number(row.total_amount || 0),
    })),
    summary: {
      total: Number(summary?.total || 0),
      active_total: Number(summary?.active_total || 0),
      pending_contracts: Number(summary?.pending_contracts || 0),
      overdue_contracts: Number(summary?.overdue_contracts || 0),
    },
  };
}

async function buildStudentHubOptions() {
  const [languagesRows, modalitiesRows, termsRows, classesRows] = await Promise.all([
    all(`SELECT DISTINCT language AS value FROM academic_programs WHERE coalesce(language, '')<>'' ORDER BY value ASC LIMIT 80`),
    all(`SELECT DISTINCT modality AS value FROM academic_programs WHERE coalesce(modality, '')<>'' ORDER BY value ASC LIMIT 80`),
    all(`SELECT id, code, name FROM school_terms ORDER BY lower(code) DESC, lower(name) DESC LIMIT 40`),
    all(`SELECT c.id, c.name, c.code, c.language, c.modality, st.code AS school_term_code
           FROM classes c
           LEFT JOIN school_terms st ON st.id = c.school_term_id
          WHERE lower(coalesce(c.status, ''))<>'cancelada'
          ORDER BY datetime(c.updated_at) DESC, lower(c.name) ASC
          LIMIT 240`),
  ]);
  return {
    lead_stage_options: STUDENT_HUB_LEAD_STAGE_OPTIONS.slice(),
    contract_status_options: FINANCIAL_CONTRACT_STATUS_OPTIONS.slice(),
    installment_status_options: FINANCIAL_INSTALLMENT_STATUS_OPTIONS.slice(),
    student_status_options: ACADEMIC_STUDENT_STATUS_OPTIONS.slice(),
    enrollment_status_options: ACADEMIC_ENROLLMENT_STATUS_OPTIONS.slice(),
    languages: languagesRows.map((item) => item.value).filter(Boolean),
    modalities: modalitiesRows.map((item) => item.value).filter(Boolean),
    terms: termsRows,
    classes: classesRows,
  };
}

async function getStudentHubStudentDetail(studentId, scope) {
  const detail = await getAcademicStudentDetail(studentId, { canViewAll: true, teacherUserId: null });
  if (!detail?.student) return null;
  const student = detail.student;
  const commercialRows = await all(
    `SELECT sr.*, ${buildResolvedLeadStageSql("sr")} AS resolved_lead_stage,
            COALESCE(c.display_name, c.official_name, sr.closer_normalized, sr.closer_original, 'Sem closer') AS closer_name
       FROM sales_records sr
       LEFT JOIN closers c ON c.id = sr.closer_id
      WHERE sr.student_id=?
         OR lower(coalesce(sr.student_name, ''))=lower(?)
         OR (? IS NOT NULL AND ? <> '' AND lower(coalesce(sr.phone, ''))=lower(?))
         OR (? IS NOT NULL AND ? <> '' AND lower(coalesce(sr.contact_email, ''))=lower(?))
      ORDER BY datetime(coalesce(sr.converted_at, sr.updated_at, sr.created_at)) DESC, sr.id DESC
      LIMIT 20`,
    [
      studentId,
      student.full_name || "",
      student.phone || null,
      student.phone || null,
      student.phone || null,
      student.email || null,
      student.email || null,
      student.email || null,
    ]
  );
  const contracts = await all(
    `SELECT fc.*, e.enrollment_number
       FROM financial_contracts fc
       LEFT JOIN enrollments e ON e.id = fc.enrollment_id
      WHERE fc.student_id=?
      ORDER BY datetime(fc.updated_at) DESC, fc.id DESC`,
    [studentId]
  );
  const contractDetails = [];
  for (const contract of contracts) {
    const installments = await listFinancialInstallmentsByContractId(contract.id);
    contractDetails.push({
      ...contract,
      total_amount: Number(contract.total_amount || 0),
      installments,
      summary: summarizeContractInstallments(installments),
    });
  }
  const primaryContract = contractDetails.find((item) => ["active", "signed", "pending", "draft"].includes(String(item.contract_status || "").toLowerCase()))
    || contractDetails[0]
    || null;
  const timeline = await all(
    `SELECT st.*, u.name AS actor_name
       FROM student_timeline st
       LEFT JOIN users u ON u.id = st.actor_user_id
      WHERE st.student_id=?
      ORDER BY datetime(st.created_at) DESC, st.id DESC
      LIMIT 80`,
    [studentId]
  );

  const currentEnrollment = (detail.enrollments || []).find((item) => ["matriculado", "aguardando turma", "pre-matricula"].includes(normalizeAcademicText(item.enrollment_status || "")))
    || detail.enrollments?.[0]
    || null;
  let currentTeachers = [];
  let currentSchedules = [];
  if (currentEnrollment?.class_id) {
    currentTeachers = await listClassTeachersByClassId(currentEnrollment.class_id);
    currentSchedules = await listClassSchedulesByClassId(currentEnrollment.class_id);
  }

  return {
    student: detail.student,
    guardians: detail.guardians || [],
    commercial: {
      records: commercialRows.map((row) => ({
        ...serializeSalesRecord(row),
        resolved_lead_stage: row.resolved_lead_stage || "lead",
      })),
      latest_record: commercialRows[0] ? {
        ...serializeSalesRecord(commercialRows[0]),
        resolved_lead_stage: commercialRows[0].resolved_lead_stage || "lead",
      } : null,
    },
    enrollment_summary: currentEnrollment || null,
    enrollments: detail.enrollments || [],
    attendance_summary: detail.attendance_summary || { total: 0, present_total: 0, absent_total: 0 },
    pedagogical: {
      current_class_name: currentEnrollment?.class_name || null,
      current_teacher_names: currentTeachers.map((item) => item.display_name || item.user_name).filter(Boolean),
      current_schedule_labels: currentSchedules.map((item) => [item.weekday, item.start_time, item.end_time].filter(Boolean).join(" · ")).filter(Boolean),
      current_status: currentEnrollment?.enrollment_status || detail.student?.status || null,
    },
    financial: {
      contracts: contractDetails,
      primary_contract: primaryContract,
      summary: contractDetails.reduce((acc, item) => {
        acc.contracts_total += 1;
        acc.amount_total += Number(item.total_amount || 0);
        acc.installments_total += Number(item.summary?.total || 0);
        acc.pending_total += Number(item.summary?.pending_total || 0);
        acc.paid_total += Number(item.summary?.paid_total || 0);
        acc.overdue_total += Number(item.summary?.overdue_total || 0);
        return acc;
      }, { contracts_total: 0, amount_total: 0, installments_total: 0, pending_total: 0, paid_total: 0, overdue_total: 0 }),
    },
    timeline: timeline.map((item) => ({
      ...item,
      metadata: safeJsonParse(item.metadata_json || "{}") || {},
    })),
    scope,
  };
}

async function getStudentHubLeadDetail(recordId, scope) {
  const record = await get(
    `SELECT sr.*, ${buildResolvedLeadStageSql("sr")} AS resolved_lead_stage,
            COALESCE(c.display_name, c.official_name, sr.closer_normalized, sr.closer_original, 'Sem closer') AS closer_name
       FROM sales_records sr
       LEFT JOIN closers c ON c.id = sr.closer_id
      WHERE sr.id=?`,
    [recordId]
  );
  if (!record) return null;
  const history = await getSalesRecordHistory(recordId);
  const linkedStudent = Number(record.student_id || 0)
    ? await getStudentHubStudentDetail(Number(record.student_id), scope).catch(() => null)
    : null;
  return {
    record: {
      ...serializeSalesRecord(record),
      resolved_lead_stage: record.resolved_lead_stage || "lead",
    },
    history,
    linked_student: linkedStudent,
  };
}

async function getStudentHubContractDetail(contractId, scope) {
  const contract = await get(
    `SELECT fc.*, s.full_name AS student_name, s.cpf AS student_cpf, s.phone AS student_phone, e.enrollment_number
       FROM financial_contracts fc
       JOIN students s ON s.id = fc.student_id
       LEFT JOIN enrollments e ON e.id = fc.enrollment_id
      WHERE fc.id=?`,
    [contractId]
  );
  if (!contract) return null;
  const installments = await listFinancialInstallmentsByContractId(contractId);
  const studentDetail = await getStudentHubStudentDetail(Number(contract.student_id), scope).catch(() => null);
  return {
    contract: {
      ...contract,
      total_amount: Number(contract.total_amount || 0),
    },
    installments,
    summary: summarizeContractInstallments(installments),
    student: studentDetail,
  };
}

function generateEnrollmentNumber(studentId, schoolTermCode = "") {
  const safeCode = sanitizeAcademicIdentifier(schoolTermCode || String(new Date().getFullYear()), "term").toUpperCase();
  return `MAT-${safeCode}-${String(studentId).padStart(5, "0")}`;
}

function generateContractNumber(studentId, enrollmentId = 0) {
  const year = new Date().getFullYear();
  return `CTR-${year}-${String(studentId || 0).padStart(5, "0")}-${String(enrollmentId || 0).padStart(5, "0")}`;
}

async function saveStudentHubLeadRecord(payload = {}, actorUser, existingId = null) {
  const actorId = actorUser?.id || actorUser?.sub || null;
  const fullName = sanitizeAcademicTextValue(payload.student_name, { maxLength: 180 });
  if (!fullName) throw new Error("missing_student_name");
  const persisted = {
    student_name: fullName,
    phone: sanitizeAcademicTextValue(payload.phone, { maxLength: 40 }) || null,
    contact_email: sanitizeAcademicTextValue(payload.contact_email, { maxLength: 180 }) || null,
    course_name: sanitizeAcademicTextValue(payload.course_name, { maxLength: 180 }) || null,
    level_name: sanitizeAcademicTextValue(payload.level_name, { maxLength: 120 }) || null,
    teacher_name: sanitizeAcademicTextValue(payload.teacher_name, { maxLength: 120 }) || null,
    attendant_name: sanitizeAcademicTextValue(payload.attendant_name, { maxLength: 120 }) || null,
    sale_month: sanitizeAcademicTextValue(payload.sale_month, { maxLength: 32 }) || null,
    sale_date: normalizeAcademicDateInput(payload.sale_date) || brazilDateKey(),
    semester_label: sanitizeAcademicTextValue(payload.semester_label, { maxLength: 60 }) || null,
    availability: sanitizeAcademicTextValue(payload.availability, { maxLength: 180 }) || null,
    modality: sanitizeAcademicTextValue(payload.modality, { maxLength: 80 }) || null,
    class_type: sanitizeAcademicTextValue(payload.class_type, { maxLength: 80 }) || null,
    system_name: sanitizeAcademicTextValue(payload.system_name, { maxLength: 120 }) || null,
    contract_status: sanitizeAcademicTextValue(payload.contract_status, { maxLength: 80 }) || null,
    language: sanitizeAcademicTextValue(payload.language, { maxLength: 80 }) || null,
    media_source: sanitizeAcademicTextValue(payload.media_source, { maxLength: 120 }) || null,
    profession: sanitizeAcademicTextValue(payload.profession, { maxLength: 120 }) || null,
    indication: sanitizeAcademicTextValue(payload.indication, { maxLength: 120 }) || null,
    observations: sanitizeAcademicTextValue(payload.observations, { maxLength: 4000 }) || null,
    feedback: sanitizeAcademicTextValue(payload.feedback, { maxLength: 4000 }) || null,
    lead_stage: normalizeLeadStage(payload.lead_stage || "lead"),
    source_payload_json: safeJsonStringify(payload.source_payload || payload, "{}"),
  };

  if (existingId) {
    const existing = await get("SELECT * FROM sales_records WHERE id=? LIMIT 1", [existingId]);
    if (!existing) throw new Error("lead_not_found");
    await run(
      `UPDATE sales_records
          SET student_name=?, phone=?, contact_email=?, course_name=?, level_name=?, teacher_name=?, attendant_name=?, sale_month=?, sale_date=?, semester_label=?,
              availability=?, modality=?, class_type=?, system_name=?, contract_status=?, language=?, media_source=?, profession=?, indication=?,
              observations=?, feedback=?, lead_stage=?, source_payload_json=?, last_modified_by=?, updated_at=datetime('now')
        WHERE id=?`,
      [
        persisted.student_name,
        persisted.phone,
        persisted.contact_email,
        persisted.course_name,
        persisted.level_name,
        persisted.teacher_name,
        persisted.attendant_name,
        persisted.sale_month,
        persisted.sale_date,
        persisted.semester_label,
        persisted.availability,
        persisted.modality,
        persisted.class_type,
        persisted.system_name,
        persisted.contract_status,
        persisted.language,
        persisted.media_source,
        persisted.profession,
        persisted.indication,
        persisted.observations,
        persisted.feedback,
        persisted.lead_stage,
        persisted.source_payload_json,
        actorId,
        existingId,
      ]
    );
    return getStudentHubLeadDetail(existingId, { canViewAll: true });
  }

  const dedupeHash = hashText(`${fullName}|${persisted.phone || ""}|${persisted.contact_email || ""}|${Date.now()}|${Math.random()}`);
  const created = await run(
    `INSERT INTO sales_records
       (origin_type, source_workbook, source_sheet, dedupe_hash, student_name, phone, contact_email, course_name, level_name, teacher_name, attendant_name,
        sale_month, sale_date, semester_label, availability, modality, class_type, system_name, contract_status, language, media_source, profession, indication,
        feedback, observations, lead_stage, source_payload_json, last_modified_by, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
    [
      "manual_lead",
      "manual_entry",
      "commercial-leads",
      dedupeHash,
      persisted.student_name,
      persisted.phone,
      persisted.contact_email,
      persisted.course_name,
      persisted.level_name,
      persisted.teacher_name,
      persisted.attendant_name,
      persisted.sale_month,
      persisted.sale_date,
      persisted.semester_label,
      persisted.availability,
      persisted.modality,
      persisted.class_type,
      persisted.system_name,
      persisted.contract_status,
      persisted.language,
      persisted.media_source,
      persisted.profession,
      persisted.indication,
      persisted.feedback,
      persisted.observations,
      persisted.lead_stage,
      persisted.source_payload_json,
      actorId,
    ]
  );
  await logEntityChange({
    entityType: "sales_record",
    entityId: created.lastID,
    action: "created",
    actorUserId: actorId,
    origin: "manual_lead",
    detail: { lead_stage: persisted.lead_stage },
  });
  return getStudentHubLeadDetail(created.lastID, { canViewAll: true });
}

async function saveFinancialContractRecord(payload = {}, actorUser = null, options = {}) {
  const actorUserId = actorUser?.id || actorUser?.sub || null;
  const contractId = Number(payload.id || 0) || null;
  const studentId = Number(payload.student_id || 0) || null;
  if (!studentId) throw new Error("missing_student_id");
  const persisted = {
    student_id: studentId,
    enrollment_id: Number(payload.enrollment_id || 0) || null,
    sales_record_id: Number(payload.sales_record_id || 0) || null,
    responsible_guardian_id: Number(payload.responsible_guardian_id || 0) || null,
    contract_number: sanitizeAcademicTextValue(payload.contract_number, { maxLength: 80 }) || null,
    contract_type: sanitizeAcademicTextValue(payload.contract_type, { maxLength: 80 }) || "course_enrollment",
    contract_status: normalizeFinancialContractStatus(payload.contract_status || "draft"),
    total_amount: parseMoneyValue(payload.total_amount),
    currency: sanitizeAcademicTextValue(payload.currency, { maxLength: 12 }) || "BRL",
    installments_count: Math.max(0, Number(payload.installments_count || 0) || 0),
    first_due_date: normalizeAcademicDateInput(payload.first_due_date),
    billing_cycle_day: Number(payload.billing_cycle_day || 0) || null,
    responsible_name: sanitizeAcademicTextValue(payload.responsible_name, { maxLength: 180 }) || null,
    responsible_cpf: sanitizeAcademicTextValue(payload.responsible_cpf, { maxLength: 32 }) || null,
    notes: sanitizeAcademicTextValue(payload.notes, { maxLength: 4000 }) || null,
    source_workbook: sanitizeAcademicTextValue(payload.source_workbook, { maxLength: 180 }) || null,
    source_sheet: sanitizeAcademicTextValue(payload.source_sheet, { maxLength: 120 }) || null,
    source_row_identifier: sanitizeAcademicTextValue(payload.source_row_identifier, { maxLength: 160 }) || null,
    source_payload_json: safeJsonStringify(payload.source_payload || {}, "{}"),
    metadata_json: safeJsonStringify(payload.metadata || {}, "{}"),
  };

  let finalId = contractId;
  if (contractId) {
    const existing = await get("SELECT * FROM financial_contracts WHERE id=? LIMIT 1", [contractId]);
    if (!existing) throw new Error("contract_not_found");
    await run(
      `UPDATE financial_contracts
          SET student_id=?, enrollment_id=?, sales_record_id=?, responsible_guardian_id=?, contract_number=?, contract_type=?, contract_status=?, total_amount=?, currency=?,
              installments_count=?, first_due_date=?, billing_cycle_day=?, responsible_name=?, responsible_cpf=?, notes=?, source_workbook=?, source_sheet=?, source_row_identifier=?,
              source_payload_json=?, metadata_json=?, updated_at=datetime('now')
        WHERE id=?`,
      [
        persisted.student_id,
        persisted.enrollment_id,
        persisted.sales_record_id,
        persisted.responsible_guardian_id,
        persisted.contract_number,
        persisted.contract_type,
        persisted.contract_status,
        persisted.total_amount,
        persisted.currency,
        persisted.installments_count,
        persisted.first_due_date,
        persisted.billing_cycle_day,
        persisted.responsible_name,
        persisted.responsible_cpf,
        persisted.notes,
        persisted.source_workbook,
        persisted.source_sheet,
        persisted.source_row_identifier,
        persisted.source_payload_json,
        persisted.metadata_json,
        contractId,
      ]
    );
  } else {
    const created = await run(
      `INSERT INTO financial_contracts
         (student_id, enrollment_id, sales_record_id, responsible_guardian_id, contract_number, contract_type, contract_status, total_amount, currency, installments_count,
          first_due_date, billing_cycle_day, responsible_name, responsible_cpf, notes, source_workbook, source_sheet, source_row_identifier, source_payload_json, metadata_json, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
      [
        persisted.student_id,
        persisted.enrollment_id,
        persisted.sales_record_id,
        persisted.responsible_guardian_id,
        persisted.contract_number,
        persisted.contract_type,
        persisted.contract_status,
        persisted.total_amount,
        persisted.currency,
        persisted.installments_count,
        persisted.first_due_date,
        persisted.billing_cycle_day,
        persisted.responsible_name,
        persisted.responsible_cpf,
        persisted.notes,
        persisted.source_workbook,
        persisted.source_sheet,
        persisted.source_row_identifier,
        persisted.source_payload_json,
        persisted.metadata_json,
      ]
    );
    finalId = created.lastID;
  }

  const contract = await get("SELECT * FROM financial_contracts WHERE id=?", [finalId]);
  const suppliedInstallments = Array.isArray(payload.installments) ? payload.installments : [];
  for (let index = 0; index < suppliedInstallments.length; index += 1) {
    const item = suppliedInstallments[index] || {};
    const installmentNumber = Math.max(1, Number(item.installment_number || index + 1) || index + 1);
    const dueDate = normalizeAcademicDateInput(item.due_date || addMonthsToDateKey(contract.first_due_date, index));
    const amount = parseMoneyValue(item.amount);
    const existingInstallment = await get("SELECT * FROM financial_installments WHERE contract_id=? AND installment_number=? LIMIT 1", [finalId, installmentNumber]);
    const baseStatus = normalizeFinancialInstallmentStatus(item.status || existingInstallment?.status || "pending");
    const finalStatus = baseStatus === "pending" && dueDate && dueDate < brazilDateKey() ? "overdue" : baseStatus;
    if (existingInstallment?.id) {
      await run(
        `UPDATE financial_installments
            SET due_date=?, amount=?, status=?, paid_at=?, payment_method=?, reference_label=?, notes=?, metadata_json=?, updated_at=datetime('now')
          WHERE id=?`,
        [
          dueDate,
          amount,
          finalStatus,
          normalizeAcademicDateTimeInput(item.paid_at) || existingInstallment.paid_at || null,
          sanitizeAcademicTextValue(item.payment_method, { maxLength: 80 }) || existingInstallment.payment_method || null,
          sanitizeAcademicTextValue(item.reference_label, { maxLength: 120 }) || existingInstallment.reference_label || null,
          sanitizeAcademicTextValue(item.notes, { maxLength: 1200 }) || existingInstallment.notes || null,
          safeJsonStringify(item.metadata || {}, "{}"),
          existingInstallment.id,
        ]
      );
    } else {
      await run(
        `INSERT INTO financial_installments
           (contract_id, installment_number, due_date, amount, status, paid_at, payment_method, reference_label, notes, metadata_json, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
        [
          finalId,
          installmentNumber,
          dueDate,
          amount,
          finalStatus,
          normalizeAcademicDateTimeInput(item.paid_at),
          sanitizeAcademicTextValue(item.payment_method, { maxLength: 80 }) || null,
          sanitizeAcademicTextValue(item.reference_label, { maxLength: 120 }) || null,
          sanitizeAcademicTextValue(item.notes, { maxLength: 1200 }) || null,
          safeJsonStringify(item.metadata || {}, "{}"),
        ]
      );
    }
  }

  if (actorUserId && options.createTimeline !== false) {
    await createStudentTimelineEntry({
      student_id: persisted.student_id,
      enrollment_id: persisted.enrollment_id,
      sales_record_id: persisted.sales_record_id,
      contract_id: finalId,
      actor_user_id: actorUserId,
      event_type: contractId ? "financial_contract_updated" : "financial_contract_created",
      title: contractId ? "Contrato atualizado" : "Contrato criado",
      description: `Contrato ${persisted.contract_number || finalId} em status ${persisted.contract_status}.`,
      metadata: {
        contract_status: persisted.contract_status,
        installments_count: persisted.installments_count,
      },
    });
  }

  return getStudentHubContractDetail(finalId, { canViewAll: true });
}

async function updateFinancialInstallmentRecord(installmentId, payload = {}, actorUser = null) {
  const actorUserId = actorUser?.id || actorUser?.sub || null;
  const existing = await get("SELECT * FROM financial_installments WHERE id=? LIMIT 1", [installmentId]);
  if (!existing) throw new Error("installment_not_found");
  const dueDate = normalizeAcademicDateInput(payload.due_date || existing.due_date);
  const baseStatus = normalizeFinancialInstallmentStatus(payload.status || existing.status || "pending");
  const finalStatus = baseStatus === "pending" && dueDate && dueDate < brazilDateKey() ? "overdue" : baseStatus;
  await run(
    `UPDATE financial_installments
        SET due_date=?, amount=?, status=?, paid_at=?, payment_method=?, reference_label=?, notes=?, metadata_json=?, updated_at=datetime('now')
      WHERE id=?`,
    [
      dueDate,
      parseMoneyValue(payload.amount ?? existing.amount),
      finalStatus,
      normalizeAcademicDateTimeInput(payload.paid_at || existing.paid_at),
      sanitizeAcademicTextValue(payload.payment_method, { maxLength: 80 }) || existing.payment_method || null,
      sanitizeAcademicTextValue(payload.reference_label, { maxLength: 120 }) || existing.reference_label || null,
      sanitizeAcademicTextValue(payload.notes, { maxLength: 1200 }) || existing.notes || null,
      safeJsonStringify(payload.metadata || safeJsonParse(existing.metadata_json || "{}") || {}, "{}"),
      installmentId,
    ]
  );
  const contract = await get("SELECT student_id, enrollment_id, id FROM financial_contracts WHERE id=? LIMIT 1", [existing.contract_id]);
  if (contract?.student_id && actorUserId) {
    await createStudentTimelineEntry({
      student_id: contract.student_id,
      enrollment_id: contract.enrollment_id,
      contract_id: contract.id,
      installment_id: installmentId,
      actor_user_id: actorUserId,
      event_type: "financial_installment_updated",
      title: "Parcela atualizada",
      description: `Parcela ${existing.installment_number} atualizada para ${finalStatus}.`,
      metadata: { installment_number: existing.installment_number, status: finalStatus, due_date: dueDate },
    });
  }
  return get("SELECT * FROM financial_installments WHERE id=?", [installmentId]);
}

async function convertLeadToStudentHubRecord(recordId, payload = {}, actorUser = null) {
  const actorId = actorUser?.id || actorUser?.sub || null;
  const lead = await getSalesRecordById(recordId);
  if (!lead) throw new Error("lead_not_found");

  const incomingStudent = payload.student || {};
  const matchedStudent = lead.student_id
    ? await get("SELECT * FROM students WHERE id=? LIMIT 1", [lead.student_id])
    : await findAcademicStudentMatch({
        fullName: incomingStudent.full_name || lead.student_name,
        normalizedName: normalizePersonKey(incomingStudent.full_name || lead.student_name || ""),
        phone: incomingStudent.phone || lead.phone,
      });

  const savedStudent = await saveAcademicStudentRecord({
    id: matchedStudent?.id || null,
    full_name: incomingStudent.full_name || lead.student_name,
    preferred_name: incomingStudent.preferred_name || matchedStudent?.preferred_name || null,
    birth_date: incomingStudent.birth_date || matchedStudent?.birth_date || null,
    cpf: incomingStudent.cpf || matchedStudent?.cpf || null,
    rg: incomingStudent.rg || matchedStudent?.rg || null,
    email: incomingStudent.email || lead.contact_email || matchedStudent?.email || null,
    phone: incomingStudent.phone || lead.phone || matchedStudent?.phone || null,
    whatsapp: incomingStudent.whatsapp || lead.phone || matchedStudent?.whatsapp || null,
    notes: incomingStudent.notes || matchedStudent?.notes || lead.observations || null,
    status: incomingStudent.status || matchedStudent?.status || "ativo",
  }, actorId);

  const guardians = Array.isArray(payload.guardians) ? payload.guardians : [];
  if (guardians.length) {
    await replaceStudentGuardians(savedStudent.id, guardians, actorId);
  }
  const savedGuardians = await all(
    "SELECT id, name, relation_type, cpf, phone, whatsapp, email, financial_responsible, pedagogical_responsible FROM student_guardians WHERE student_id=? ORDER BY financial_responsible DESC, pedagogical_responsible DESC, id ASC",
    [savedStudent.id]
  );
  const financialGuardian = savedGuardians.find((item) => coerceDbBoolean(item.financial_responsible)) || savedGuardians[0] || null;

  const enrollmentPayload = payload.enrollment || {};
  const schoolTerm = await ensureSchoolTermRecord({
    code: enrollmentPayload.school_term_code || lead.semester_label,
    name: enrollmentPayload.school_term_name || lead.semester_label,
    status: "active",
  });
  const program = await ensureAcademicProgramRecord({
    language: enrollmentPayload.language || lead.language,
    program_name: enrollmentPayload.program_name || lead.course_name || lead.level_name || lead.language,
    level_name: enrollmentPayload.level_name || lead.level_name,
    semester_label: enrollmentPayload.semester_label || lead.semester_label,
    modality: enrollmentPayload.modality || lead.modality,
    status: "active",
  });
  const enrollment = await saveAcademicEnrollmentRecord({
    id: Number(lead.enrollment_id || 0) || null,
    student_id: savedStudent.id,
    academic_program_id: program?.id || null,
    school_term_id: schoolTerm?.id || null,
    class_id: Number(enrollmentPayload.class_id || 0) || null,
    enrollment_number: enrollmentPayload.enrollment_number || generateEnrollmentNumber(savedStudent.id, schoolTerm?.code || lead.semester_label || ""),
    enrollment_date: enrollmentPayload.enrollment_date || lead.sale_date || brazilDateKey(),
    start_date: enrollmentPayload.start_date || lead.sale_date || brazilDateKey(),
    end_date: enrollmentPayload.end_date || null,
    enrollment_status: enrollmentPayload.enrollment_status || ((Number(enrollmentPayload.class_id || 0) || 0) ? "matriculado" : "aguardando turma"),
    contract_status: enrollmentPayload.contract_status || lead.contract_status || "em formalizacao",
    payment_status: enrollmentPayload.payment_status || "pendente",
    pedagogical_status: enrollmentPayload.pedagogical_status || "matricula_em_abertura",
    source_channel: enrollmentPayload.source_channel || lead.media_source || "comercial",
    source_notes: enrollmentPayload.source_notes || lead.feedback || lead.observations || null,
    notes: enrollmentPayload.notes || lead.observations || null,
    source_workbook: "student_hub_conversion",
    source_sheet: "commercial-conversion",
    source_row_identifier: `lead:${recordId}`,
    source_payload: {
      lead_id: recordId,
      lead_stage: lead.lead_stage || null,
    },
    metadata: {
      converted_from_sales_record_id: recordId,
    },
  }, actorUser);

  const contractPayload = payload.contract || {};
  const defaultInstallmentsCount = Math.max(0, Number(contractPayload.installments_count || 0) || 0);
  const totalAmount = parseMoneyValue(contractPayload.total_amount);
  const installments = Array.isArray(contractPayload.installments) && contractPayload.installments.length
    ? contractPayload.installments
    : (defaultInstallmentsCount > 0 && totalAmount && contractPayload.first_due_date
        ? Array.from({ length: defaultInstallmentsCount }).map((_, index) => ({
            installment_number: index + 1,
            due_date: addMonthsToDateKey(contractPayload.first_due_date, index),
            amount: Number((totalAmount / defaultInstallmentsCount).toFixed(2)),
            status: "pending",
            reference_label: `Parcela ${index + 1}/${defaultInstallmentsCount}`,
          }))
        : []);

  const contractDetail = await saveFinancialContractRecord({
    id: Number(lead.financial_contract_id || 0) || null,
    student_id: savedStudent.id,
    enrollment_id: enrollment.id,
    sales_record_id: lead.id,
    responsible_guardian_id: financialGuardian?.id || null,
    responsible_name: contractPayload.responsible_name || financialGuardian?.name || null,
    responsible_cpf: contractPayload.responsible_cpf || financialGuardian?.cpf || null,
    contract_number: contractPayload.contract_number || generateContractNumber(savedStudent.id, enrollment.id),
    contract_type: contractPayload.contract_type || "course_enrollment",
    contract_status: contractPayload.contract_status || "draft",
    total_amount,
    currency: contractPayload.currency || "BRL",
    installments_count: installments.length || defaultInstallmentsCount,
    first_due_date: contractPayload.first_due_date || installments[0]?.due_date || null,
    billing_cycle_day: contractPayload.billing_cycle_day || (contractPayload.first_due_date ? Number(String(contractPayload.first_due_date).slice(8, 10)) : null),
    notes: contractPayload.notes || "Contrato criado a partir da conversão comercial.",
    installments,
    metadata: {
      created_from_lead_id: lead.id,
    },
  }, actorUser, { createTimeline: false });

  await run(
    `UPDATE sales_records
        SET student_id=?, enrollment_id=?, financial_contract_id=?, contact_email=COALESCE(?, contact_email), lead_stage='convertido',
            converted_at=COALESCE(converted_at, CURRENT_TIMESTAMP), contract_status=?, updated_at=datetime('now')
      WHERE id=?`,
    [
      savedStudent.id,
      enrollment.id,
      contractDetail?.contract?.id || null,
      incomingStudent.email || lead.contact_email || null,
      contractDetail?.contract?.contract_status || lead.contract_status || null,
      recordId,
    ]
  );

  await createStudentTimelineEntry({
    student_id: savedStudent.id,
    enrollment_id: enrollment.id,
    sales_record_id: recordId,
    contract_id: contractDetail?.contract?.id || null,
    actor_user_id: actorId,
    event_type: "lead_converted",
    title: "Lead convertido em aluno",
    description: `${lead.student_name || savedStudent.full_name} foi convertido do Comercial para cadastro, matrícula e financeiro.`,
    metadata: {
      lead_id: recordId,
      enrollment_id: enrollment.id,
      contract_id: contractDetail?.contract?.id || null,
    },
  });

  return {
    student: await getStudentHubStudentDetail(savedStudent.id, { canViewAll: true }).catch(() => null),
    lead: await getStudentHubLeadDetail(recordId, { canViewAll: true }).catch(() => null),
    contract: contractDetail,
  };
}

async function buildStudentHubBootstrap(user, filters = {}) {
  const viewKey = normalizeStudentHubViewKey(filters.view_key || "");
  const scope = await resolveStudentHubScope(user, viewKey);
  const area = getStudentHubAreaByViewKey(viewKey);
  const options = await buildStudentHubOptions();
  const payload = {
    enabled: true,
    view_key: viewKey,
    area,
    scope_kind: scope.kind,
    scope,
    options,
    summary: {},
    students: [],
    leads: [],
    contracts: [],
  };

  if (area === "commercial") {
    const commercial = await listStudentHubLeads(scope, {
      search: filters.search,
      leadStage: filters.lead_stage,
      language: filters.language,
      modality: filters.modality,
      limit: filters.limit || 60,
    });
    payload.summary = commercial.summary;
    payload.leads = commercial.rows;
  } else if (area === "financial") {
    if (viewKey === "financial-student-profile") {
      const students = await listStudentHubStudents(scope, {
        search: filters.search,
        status: filters.student_status,
        limit: filters.limit || 60,
      });
      payload.summary = {
        total: Number(students.summary?.total || 0),
        active_total: Number(students.summary?.students_with_contract_total || 0),
        pending_contracts: Number(students.summary?.without_contract_total || 0),
        overdue_contracts: Number(students.summary?.overdue_students || 0),
      };
      payload.students = students.rows;
    } else {
      const financial = await listStudentHubContracts(scope, {
        search: filters.search,
        contractStatus: filters.contract_status,
        onlyDelinquent: viewKey === "financial-delinquency",
        limit: filters.limit || 60,
      });
      payload.summary = financial.summary;
      payload.contracts = financial.rows;
    }
  } else {
    const students = await listStudentHubStudents(scope, {
      search: filters.search,
      status: filters.student_status,
      limit: filters.limit || 60,
    });
    payload.summary = students.summary;
    payload.students = students.rows;
  }

  return payload;
}

function normalizeAcademicOption(value, allowedValues = [], fallback = "") {
  const safe = String(value || "").trim();
  if (!safe) return fallback;
  const normalized = normalizeAcademicText(safe);
  const matched = (allowedValues || []).find((item) => normalizeAcademicText(item) === normalized);
  return matched || fallback;
}

function normalizeStudentStatus(value = "") {
  return normalizeAcademicOption(value, ACADEMIC_STUDENT_STATUS_OPTIONS, "ativo");
}

function normalizeEnrollmentStatus(value = "") {
  return normalizeAcademicOption(value, ACADEMIC_ENROLLMENT_STATUS_OPTIONS, "aguardando turma");
}

function normalizeClassStatus(value = "") {
  return normalizeAcademicOption(value, ACADEMIC_CLASS_STATUS_OPTIONS, "planejada");
}

function normalizeAttendanceStatus(value = "") {
  return normalizeAcademicOption(value, ACADEMIC_ATTENDANCE_STATUS_OPTIONS, "presente");
}

function normalizeSessionStatus(value = "") {
  return normalizeAcademicOption(value, ACADEMIC_SESSION_STATUS_OPTIONS, "planejada");
}

function normalizeAcademicDateInput(value = "") {
  const safe = String(value || "").trim();
  if (!safe) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(safe)) return safe;
  const parsed = new Date(safe);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

function normalizeAcademicDateTimeInput(value = "") {
  const safe = String(value || "").trim();
  if (!safe) return null;
  const parsed = new Date(safe);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function sanitizeAcademicTextValue(value, options = {}) {
  return sanitizePersistedText(value, { maxLength: options.maxLength || 4000 });
}

function sanitizeAcademicIdentifier(value = "", fallback = "academic") {
  const safe = normalizeAcademicText(value).replace(/\s+/g, ".").replace(/[^a-z0-9.]+/g, ".");
  return safe.replace(/^\.+|\.+$/g, "") || fallback;
}

function mergeUniqueStrings(...groups) {
  const out = [];
  const seen = new Set();
  for (const group of groups) {
    for (const item of Array.isArray(group) ? group : []) {
      const safe = sanitizeAcademicTextValue(item, { maxLength: 180 });
      if (!safe) continue;
      const key = normalizeAcademicText(safe);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(safe);
    }
  }
  return out;
}

function guessSchoolTermDates(code = "") {
  const safe = String(code || "").trim();
  const match = safe.match(/^(\d{4})\.(1|2)$/);
  if (!match) return { startDate: null, endDate: null };
  const year = Number(match[1]);
  const half = Number(match[2]);
  if (half === 1) {
    return { startDate: `${year}-01-01`, endDate: `${year}-06-30` };
  }
  return { startDate: `${year}-07-01`, endDate: `${year}-12-31` };
}

function buildAcademicProgramLookupKey(payload = {}) {
  return [
    normalizeAcademicText(payload.language || ""),
    normalizeAcademicText(payload.program_name || ""),
    normalizeAcademicText(payload.level_name || ""),
    normalizeAcademicText(payload.stage_name || ""),
    normalizeAcademicText(payload.semester_label || ""),
    normalizeAcademicText(payload.modality || ""),
  ].join("|");
}

function buildAcademicClassCode(payload = {}) {
  const raw = [
    payload.school_term_code || payload.semester_label || "",
    payload.language || "",
    payload.modality || "",
    payload.level_name || "",
    payload.class_name || payload.name || "",
    payload.teacher_normalized_name || "",
    payload.source_block_ref || "",
  ].join("|");
  return `CLS-${hashText(raw).slice(0, 10).toUpperCase()}`;
}

function mergeAcademicMetadata(existingValue, nextValue) {
  const existing = safeJsonParse(existingValue || "{}") || {};
  const incoming = nextValue && typeof nextValue === "object"
    ? nextValue
    : (safeJsonParse(nextValue || "{}") || {});
  return repairDeepText({ ...existing, ...incoming });
}

function mapTeacherProfileRow(row) {
  if (!row) return null;
  return {
    ...row,
    aliases: Array.isArray(safeJsonParse(row.aliases_json || "[]")) ? safeJsonParse(row.aliases_json || "[]") : [],
    specialties: Array.isArray(safeJsonParse(row.specialties_json || "[]")) ? safeJsonParse(row.specialties_json || "[]") : [],
    metadata: safeJsonParse(row.metadata_json || "{}") || {},
    active: coerceDbBoolean(row.active),
  };
}

function mapAcademicStudentRow(row) {
  if (!row) return null;
  return {
    ...row,
    source_payload: safeJsonParse(row.source_payload_json || "{}") || null,
  };
}

function mapAcademicEnrollmentRow(row) {
  if (!row) return null;
  return {
    ...row,
    source_payload: safeJsonParse(row.source_payload_json || "{}") || null,
    metadata: safeJsonParse(row.metadata_json || "{}") || {},
  };
}

function mapAcademicClassRow(row) {
  if (!row) return null;
  return {
    ...row,
    metadata: safeJsonParse(row.metadata_json || "{}") || {},
  };
}

function buildTeacherInternalEmailBase(displayName = "") {
  const identifier = sanitizeAcademicIdentifier(displayName, "teacher");
  return `teacher.${identifier}`.replace(/\.{2,}/g, ".").replace(/\.$/, "");
}

async function generateAvailableInternalEmail(baseLocalPart = "teacher") {
  const safeBase = sanitizeAcademicIdentifier(baseLocalPart, "teacher");
  let attempt = 1;
  while (attempt < 500) {
    const localPart = attempt === 1 ? safeBase : `${safeBase}.${attempt}`;
    const email = `${localPart}@internal.local`;
    const existing = await get("SELECT id FROM users WHERE lower(email)=lower(?) LIMIT 1", [email]);
    if (!existing?.id) return email;
    attempt += 1;
  }
  return `${safeBase}.${Date.now()}@internal.local`;
}

async function getTeacherProfileByUserId(userId) {
  const row = await get(
    "SELECT id, user_id, display_name, normalized_name, aliases_json, specialties_json, metadata_json, active, created_at, updated_at FROM teacher_profiles WHERE user_id=? LIMIT 1",
    [userId]
  );
  return mapTeacherProfileRow(row);
}

async function getTeacherProfileByNormalizedName(normalizedName = "") {
  const safe = normalizeAcademicText(normalizedName);
  if (!safe) return null;
  const row = await get(
    "SELECT id, user_id, display_name, normalized_name, aliases_json, specialties_json, metadata_json, active, created_at, updated_at FROM teacher_profiles WHERE normalized_name=? LIMIT 1",
    [safe]
  );
  return mapTeacherProfileRow(row);
}

async function resolveAcademicScope(user) {
  if (!user) throw new Error("academic_access_denied");
  if (user.role === "admin") {
    return {
      enabled: true,
      kind: "admin",
      canViewAll: true,
      canManageAll: true,
      canImport: true,
      teacherProfile: await getTeacherProfileByUserId(user.id || user.sub).catch(() => null),
      teacherUserId: Number(user.id || user.sub || 0) || null,
    };
  }

  if (userHasDepartmentAccess(user, "pedagogico")) {
    return {
      enabled: true,
      kind: "pedagogico",
      canViewAll: true,
      canManageAll: true,
      canImport: true,
      teacherProfile: await getTeacherProfileByUserId(user.id || user.sub).catch(() => null),
      teacherUserId: Number(user.id || user.sub || 0) || null,
    };
  }

  if (hasAcademicTeacherScope(user)) {
    return {
      enabled: true,
      kind: "teacher",
      canViewAll: false,
      canManageAll: false,
      canImport: false,
      teacherProfile: await getTeacherProfileByUserId(user.id || user.sub).catch(() => null),
      teacherUserId: Number(user.id || user.sub || 0) || null,
    };
  }

  throw new Error("academic_access_denied");
}

function buildAcademicScopeExistsSql(scope, enrollmentAlias = "e") {
  if (scope.canViewAll) return { sql: "", params: [] };
  return {
    sql: `EXISTS (
      SELECT 1
        FROM class_teachers ct
       WHERE ct.class_id=${enrollmentAlias}.class_id
         AND ct.user_id=?
         AND ${buildDbTruthySql("is_active", "ct")}
    )`,
    params: [scope.teacherUserId],
  };
}

async function listClassSchedulesByClassId(classId) {
  const rows = await all(
    "SELECT id, class_id, weekday, start_time, end_time, timezone, is_primary, notes, created_at, updated_at FROM class_schedules WHERE class_id=? ORDER BY is_primary DESC, weekday ASC, start_time ASC, id ASC",
    [classId]
  );
  return rows.map((row) => ({ ...row, is_primary: coerceDbBoolean(row.is_primary) }));
}

async function listClassTeachersByClassId(classId) {
  const rows = await all(
    `SELECT ct.id, ct.class_id, ct.user_id, ct.role_in_class, ct.start_date, ct.end_date, ct.is_active, ct.created_at, ct.updated_at,
            u.name AS user_name, u.email AS user_email, tp.display_name AS profile_name, tp.aliases_json, tp.specialties_json
       FROM class_teachers ct
       LEFT JOIN users u ON u.id = ct.user_id
       LEFT JOIN teacher_profiles tp ON tp.user_id = ct.user_id
      WHERE ct.class_id=?
      ORDER BY ${buildDbTruthySql("is_active", "ct")} DESC, lower(coalesce(tp.display_name, u.name, '')) ASC, ct.id ASC`,
    [classId]
  );
  return rows.map((row) => ({
    ...row,
    is_active: coerceDbBoolean(row.is_active),
    display_name: row.profile_name || row.user_name || "",
    aliases: Array.isArray(safeJsonParse(row.aliases_json || "[]")) ? safeJsonParse(row.aliases_json || "[]") : [],
    specialties: Array.isArray(safeJsonParse(row.specialties_json || "[]")) ? safeJsonParse(row.specialties_json || "[]") : [],
  }));
}

async function getClassBasicById(classId) {
  const row = await get(
    `SELECT c.id, c.code, c.name, c.school_term_id, c.academic_program_id, c.language, c.modality, c.level_name, c.semester_label,
            c.age_group, c.capacity, c.min_students, c.status, c.room_name, c.unit_name, c.notes, c.class_kind, c.source_workbook, c.source_sheet, c.source_block_ref, c.metadata_json,
            c.created_at, c.updated_at, st.name AS school_term_name, st.code AS school_term_code, ap.program_name, ap.material_name
       FROM classes c
       LEFT JOIN school_terms st ON st.id = c.school_term_id
       LEFT JOIN academic_programs ap ON ap.id = c.academic_program_id
      WHERE c.id=?`,
    [classId]
  );
  return mapAcademicClassRow(row);
}

async function canAccessAcademicClass(scope, classId) {
  if (scope.canViewAll) return true;
  const row = await get(
    `SELECT id
       FROM class_teachers
      WHERE class_id=? AND user_id=? AND ${buildDbTruthySql("is_active")}
      LIMIT 1`,
    [classId, scope.teacherUserId]
  );
  return Boolean(row?.id);
}

async function findAcademicStudentMatch({ fullName = "", normalizedName = "", phone = "" } = {}) {
  const safeNormalized = normalizeAcademicText(normalizedName || fullName);
  const safePhone = sanitizeAcademicTextValue(phone, { maxLength: 40 });
  if (!safeNormalized) return null;
  if (safePhone) {
    const row = await get(
      `SELECT *
         FROM students
        WHERE normalized_name=?
          AND (phone=? OR whatsapp=?)
        ORDER BY datetime(updated_at) DESC, id DESC
        LIMIT 1`,
      [safeNormalized, safePhone, safePhone]
    );
    if (row) return mapAcademicStudentRow(row);
  }
  const row = await get(
    `SELECT *
       FROM students
      WHERE normalized_name=?
      ORDER BY datetime(updated_at) DESC, id DESC
      LIMIT 1`,
    [safeNormalized]
  );
  return mapAcademicStudentRow(row);
}

async function saveAcademicStudentRecord(payload = {}, actorUserId = null) {
  const studentId = Number(payload.id || 0) || null;
  const fullName = sanitizeAcademicTextValue(payload.full_name, { maxLength: 180 });
  if (!fullName) throw new Error("missing_student_name");
  const normalizedName = normalizeAcademicText(fullName);
  const preferredName = sanitizeAcademicTextValue(payload.preferred_name, { maxLength: 120 }) || null;
  const birthDate = normalizeAcademicDateInput(payload.birth_date);
  const age = Number.isFinite(Number(payload.age)) ? Math.max(0, Math.round(Number(payload.age))) : null;
  const status = normalizeStudentStatus(payload.status || "ativo");
  const persisted = {
    full_name: fullName,
    normalized_name: normalizedName,
    preferred_name: preferredName,
    birth_date: birthDate,
    age,
    gender: sanitizeAcademicTextValue(payload.gender, { maxLength: 40 }) || null,
    cpf: sanitizeAcademicTextValue(payload.cpf, { maxLength: 32 }) || null,
    rg: sanitizeAcademicTextValue(payload.rg, { maxLength: 32 }) || null,
    email: sanitizeAcademicTextValue(payload.email, { maxLength: 180 }) || null,
    phone: sanitizeAcademicTextValue(payload.phone, { maxLength: 40 }) || null,
    whatsapp: sanitizeAcademicTextValue(payload.whatsapp, { maxLength: 40 }) || null,
    emergency_contact_name: sanitizeAcademicTextValue(payload.emergency_contact_name, { maxLength: 180 }) || null,
    emergency_contact_phone: sanitizeAcademicTextValue(payload.emergency_contact_phone, { maxLength: 40 }) || null,
    address_zipcode: sanitizeAcademicTextValue(payload.address_zipcode, { maxLength: 32 }) || null,
    address_street: sanitizeAcademicTextValue(payload.address_street, { maxLength: 180 }) || null,
    address_number: sanitizeAcademicTextValue(payload.address_number, { maxLength: 32 }) || null,
    address_complement: sanitizeAcademicTextValue(payload.address_complement, { maxLength: 120 }) || null,
    address_neighborhood: sanitizeAcademicTextValue(payload.address_neighborhood, { maxLength: 120 }) || null,
    address_city: sanitizeAcademicTextValue(payload.address_city, { maxLength: 120 }) || null,
    address_state: sanitizeAcademicTextValue(payload.address_state, { maxLength: 80 }) || null,
    notes: sanitizeAcademicTextValue(payload.notes, { maxLength: 4000 }) || null,
    allergies: sanitizeAcademicTextValue(payload.allergies, { maxLength: 2000 }) || null,
    medical_notes: sanitizeAcademicTextValue(payload.medical_notes, { maxLength: 3000 }) || null,
    school_name: sanitizeAcademicTextValue(payload.school_name, { maxLength: 180 }) || null,
    school_grade: sanitizeAcademicTextValue(payload.school_grade, { maxLength: 80 }) || null,
    status,
    source_workbook: sanitizeAcademicTextValue(payload.source_workbook, { maxLength: 180 }) || null,
    source_sheet: sanitizeAcademicTextValue(payload.source_sheet, { maxLength: 120 }) || null,
    source_row_identifier: sanitizeAcademicTextValue(payload.source_row_identifier, { maxLength: 160 }) || null,
    source_payload_json: safeJsonStringify(payload.source_payload || payload.source_payload_json || {}, "{}"),
  };

  if (studentId) {
    const existing = await get("SELECT * FROM students WHERE id=? LIMIT 1", [studentId]);
    if (!existing) throw new Error("student_not_found");
    await run(
      `UPDATE students
          SET full_name=?, normalized_name=?, preferred_name=?, birth_date=?, age=?, gender=?, cpf=?, rg=?, email=?, phone=?, whatsapp=?,
              emergency_contact_name=?, emergency_contact_phone=?, address_zipcode=?, address_street=?, address_number=?, address_complement=?,
              address_neighborhood=?, address_city=?, address_state=?, notes=?, allergies=?, medical_notes=?, school_name=?, school_grade=?,
              status=?, source_workbook=?, source_sheet=?, source_row_identifier=?, source_payload_json=?, updated_at=datetime('now')
        WHERE id=?`,
      [
        persisted.full_name,
        persisted.normalized_name,
        persisted.preferred_name,
        persisted.birth_date,
        persisted.age,
        persisted.gender,
        persisted.cpf,
        persisted.rg,
        persisted.email,
        persisted.phone,
        persisted.whatsapp,
        persisted.emergency_contact_name,
        persisted.emergency_contact_phone,
        persisted.address_zipcode,
        persisted.address_street,
        persisted.address_number,
        persisted.address_complement,
        persisted.address_neighborhood,
        persisted.address_city,
        persisted.address_state,
        persisted.notes,
        persisted.allergies,
        persisted.medical_notes,
        persisted.school_name,
        persisted.school_grade,
        persisted.status,
        persisted.source_workbook,
        persisted.source_sheet,
        persisted.source_row_identifier,
        persisted.source_payload_json,
        studentId,
      ]
    );
    if (actorUserId) {
      await logEntityChange({
        entityType: "academic_student",
        entityId: studentId,
        action: "updated",
        actorUserId,
        origin: "manual_edit",
        detail: { source: "academic_student_form" },
      });
    }
    return mapAcademicStudentRow(await get("SELECT * FROM students WHERE id=?", [studentId]));
  }

  const created = await run(
    `INSERT INTO students
       (full_name, normalized_name, preferred_name, birth_date, age, gender, cpf, rg, email, phone, whatsapp, emergency_contact_name,
        emergency_contact_phone, address_zipcode, address_street, address_number, address_complement, address_neighborhood, address_city,
        address_state, notes, allergies, medical_notes, school_name, school_grade, status, source_workbook, source_sheet, source_row_identifier, source_payload_json, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
    [
      persisted.full_name,
      persisted.normalized_name,
      persisted.preferred_name,
      persisted.birth_date,
      persisted.age,
      persisted.gender,
      persisted.cpf,
      persisted.rg,
      persisted.email,
      persisted.phone,
      persisted.whatsapp,
      persisted.emergency_contact_name,
      persisted.emergency_contact_phone,
      persisted.address_zipcode,
      persisted.address_street,
      persisted.address_number,
      persisted.address_complement,
      persisted.address_neighborhood,
      persisted.address_city,
      persisted.address_state,
      persisted.notes,
      persisted.allergies,
      persisted.medical_notes,
      persisted.school_name,
      persisted.school_grade,
      persisted.status,
      persisted.source_workbook,
      persisted.source_sheet,
      persisted.source_row_identifier,
      persisted.source_payload_json,
    ]
  );
  if (actorUserId) {
    await logEntityChange({
      entityType: "academic_student",
      entityId: created.lastID,
      action: "created",
      actorUserId,
      origin: "manual_create",
      detail: { source: "academic_student_form" },
    });
  }
  return mapAcademicStudentRow(await get("SELECT * FROM students WHERE id=?", [created.lastID]));
}

async function replaceStudentGuardians(studentId, guardians = [], actorUserId = null) {
  await run("DELETE FROM student_guardians WHERE student_id=?", [studentId]);
  const persisted = [];
  for (const item of Array.isArray(guardians) ? guardians : []) {
    const name = sanitizeAcademicTextValue(item.name, { maxLength: 180 });
    if (!name) continue;
    const created = await run(
      `INSERT INTO student_guardians
         (student_id, name, relation_type, cpf, phone, whatsapp, email, financial_responsible, pedagogical_responsible, receives_notifications, notes, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
      [
        studentId,
        name,
        sanitizeAcademicTextValue(item.relation_type, { maxLength: 60 }) || null,
        sanitizeAcademicTextValue(item.cpf, { maxLength: 32 }) || null,
        sanitizeAcademicTextValue(item.phone, { maxLength: 40 }) || null,
        sanitizeAcademicTextValue(item.whatsapp, { maxLength: 40 }) || null,
        sanitizeAcademicTextValue(item.email, { maxLength: 180 }) || null,
        Boolean(item.financial_responsible),
        Boolean(item.pedagogical_responsible),
        item.receives_notifications !== false,
        sanitizeAcademicTextValue(item.notes, { maxLength: 1200 }) || null,
      ]
    );
    persisted.push(created.lastID);
  }
  if (actorUserId) {
    await logEntityChange({
      entityType: "academic_student",
      entityId: studentId,
      action: "guardians_updated",
      actorUserId,
      origin: "manual_edit",
      detail: { total_guardians: persisted.length },
    });
  }
}

async function ensureSchoolTermRecord(payload = {}) {
  const code = sanitizeAcademicTextValue(payload.code || deriveSemesterCode(payload.name || ""), { maxLength: 32 });
  const name = sanitizeAcademicTextValue(payload.name || deriveSchoolTermName(code), { maxLength: 120 });
  if (!code && !name) return null;
  const existing = code
    ? await get("SELECT * FROM school_terms WHERE lower(code)=lower(?) LIMIT 1", [code])
    : await get("SELECT * FROM school_terms WHERE lower(name)=lower(?) LIMIT 1", [name]);
  if (existing) {
    await run(
      "UPDATE school_terms SET name=?, start_date=COALESCE(?, start_date), end_date=COALESCE(?, end_date), status=?, updated_at=datetime('now') WHERE id=?",
      [
        name || existing.name,
        normalizeAcademicDateInput(payload.start_date),
        normalizeAcademicDateInput(payload.end_date),
        normalizeAcademicOption(payload.status, ["active", "inactive", "planned", "closed"], existing.status || "active"),
        existing.id,
      ]
    );
    return get("SELECT * FROM school_terms WHERE id=?", [existing.id]);
  }
  const guessedDates = guessSchoolTermDates(code);
  const created = await run(
    "INSERT INTO school_terms (name, code, start_date, end_date, status, updated_at) VALUES (?, ?, ?, ?, ?, datetime('now'))",
    [
      name || code,
      code || sanitizeAcademicIdentifier(name, "term"),
      normalizeAcademicDateInput(payload.start_date) || guessedDates.startDate,
      normalizeAcademicDateInput(payload.end_date) || guessedDates.endDate,
      normalizeAcademicOption(payload.status, ["active", "inactive", "planned", "closed"], "active"),
    ]
  );
  return get("SELECT * FROM school_terms WHERE id=?", [created.lastID]);
}

async function ensureAcademicProgramRecord(payload = {}) {
  const prepared = {
    language: sanitizeAcademicTextValue(payload.language, { maxLength: 80 }) || null,
    program_name: sanitizeAcademicTextValue(payload.program_name || payload.level_name || payload.language, { maxLength: 160 }),
    level_name: sanitizeAcademicTextValue(payload.level_name, { maxLength: 120 }) || null,
    stage_name: sanitizeAcademicTextValue(payload.stage_name, { maxLength: 120 }) || null,
    semester_label: sanitizeAcademicTextValue(payload.semester_label || payload.school_term_code, { maxLength: 32 }) || null,
    modality: sanitizeAcademicTextValue(payload.modality, { maxLength: 80 }) || null,
    material_name: sanitizeAcademicTextValue(payload.material_name, { maxLength: 120 }) || null,
    workload_hours: Number.isFinite(Number(payload.workload_hours)) ? Number(payload.workload_hours) : null,
    status: normalizeAcademicOption(payload.status, ["active", "inactive"], "active"),
  };
  if (!prepared.program_name) return null;
  const existing = await get(
    `SELECT *
       FROM academic_programs
      WHERE lower(coalesce(language, ''))=lower(?)
        AND lower(program_name)=lower(?)
        AND lower(coalesce(level_name, ''))=lower(?)
        AND lower(coalesce(stage_name, ''))=lower(?)
        AND lower(coalesce(semester_label, ''))=lower(?)
        AND lower(coalesce(modality, ''))=lower(?)
      LIMIT 1`,
    [
      prepared.language || "",
      prepared.program_name,
      prepared.level_name || "",
      prepared.stage_name || "",
      prepared.semester_label || "",
      prepared.modality || "",
    ]
  );
  if (existing) return existing;
  const created = await run(
    `INSERT INTO academic_programs
       (language, program_name, level_name, stage_name, semester_label, modality, material_name, workload_hours, status, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
    [
      prepared.language,
      prepared.program_name,
      prepared.level_name,
      prepared.stage_name,
      prepared.semester_label,
      prepared.modality,
      prepared.material_name,
      prepared.workload_hours,
      prepared.status,
    ]
  );
  return get("SELECT * FROM academic_programs WHERE id=?", [created.lastID]);
}

async function ensureAcademicClassRecord(payload = {}) {
  const prepared = {
    code: sanitizeAcademicTextValue(payload.code || buildAcademicClassCode(payload), { maxLength: 40 }),
    name: sanitizeAcademicTextValue(payload.name || payload.class_name, { maxLength: 180 }),
    school_term_id: Number(payload.school_term_id || 0) || null,
    academic_program_id: Number(payload.academic_program_id || 0) || null,
    language: sanitizeAcademicTextValue(payload.language, { maxLength: 80 }) || null,
    modality: sanitizeAcademicTextValue(payload.modality, { maxLength: 80 }) || null,
    level_name: sanitizeAcademicTextValue(payload.level_name, { maxLength: 120 }) || null,
    semester_label: sanitizeAcademicTextValue(payload.semester_label || payload.school_term_code, { maxLength: 32 }) || null,
    age_group: sanitizeAcademicTextValue(payload.age_group, { maxLength: 80 }) || null,
    capacity: Number.isFinite(Number(payload.capacity)) ? Math.max(0, Math.round(Number(payload.capacity))) : null,
    min_students: Number.isFinite(Number(payload.min_students)) ? Math.max(0, Math.round(Number(payload.min_students))) : null,
    status: normalizeClassStatus(payload.status || "ativa"),
    room_name: sanitizeAcademicTextValue(payload.room_name, { maxLength: 120 }) || null,
    unit_name: sanitizeAcademicTextValue(payload.unit_name, { maxLength: 120 }) || null,
    notes: sanitizeAcademicTextValue(payload.notes, { maxLength: 4000 }) || null,
    class_kind: sanitizeAcademicTextValue(payload.class_kind, { maxLength: 40 }) || "regular",
    source_workbook: sanitizeAcademicTextValue(payload.source_workbook, { maxLength: 180 }) || null,
    source_sheet: sanitizeAcademicTextValue(payload.source_sheet, { maxLength: 120 }) || null,
    source_block_ref: sanitizeAcademicTextValue(payload.source_block_ref, { maxLength: 180 }) || null,
  };
  if (!prepared.name) throw new Error("missing_class_name");
  let existing = null;
  if (prepared.source_block_ref) {
    existing = await get("SELECT * FROM classes WHERE source_block_ref=? LIMIT 1", [prepared.source_block_ref]);
  }
  if (!existing && prepared.code) {
    existing = await get("SELECT * FROM classes WHERE code=? LIMIT 1", [prepared.code]);
  }
  if (!existing) {
    existing = await get(
      `SELECT *
         FROM classes
        WHERE lower(name)=lower(?)
          AND coalesce(school_term_id, 0)=coalesce(?, 0)
          AND coalesce(academic_program_id, 0)=coalesce(?, 0)
          AND lower(coalesce(language, ''))=lower(?)
        LIMIT 1`,
      [prepared.name, prepared.school_term_id, prepared.academic_program_id, prepared.language || ""]
    );
  }
  prepared.metadata_json = safeJsonStringify(mergeAcademicMetadata(existing?.metadata_json, payload.metadata || payload.metadata_json || {}), "{}");
  if (existing) {
    await run(
      `UPDATE classes
          SET code=?, name=?, school_term_id=?, academic_program_id=?, language=?, modality=?, level_name=?, semester_label=?, age_group=?,
              capacity=COALESCE(?, capacity), min_students=COALESCE(?, min_students), status=?, room_name=?, unit_name=?, notes=COALESCE(?, notes),
              class_kind=?, source_workbook=COALESCE(?, source_workbook), source_sheet=COALESCE(?, source_sheet), source_block_ref=COALESCE(?, source_block_ref),
              metadata_json=?, updated_at=datetime('now')
        WHERE id=?`,
      [
        prepared.code || existing.code,
        prepared.name,
        prepared.school_term_id,
        prepared.academic_program_id,
        prepared.language,
        prepared.modality,
        prepared.level_name,
        prepared.semester_label,
        prepared.age_group,
        prepared.capacity,
        prepared.min_students,
        prepared.status,
        prepared.room_name,
        prepared.unit_name,
        prepared.notes,
        prepared.class_kind,
        prepared.source_workbook,
        prepared.source_sheet,
        prepared.source_block_ref,
        prepared.metadata_json,
        existing.id,
      ]
    );
    return getClassBasicById(existing.id);
  }
  const created = await run(
    `INSERT INTO classes
       (code, name, school_term_id, academic_program_id, language, modality, level_name, semester_label, age_group, capacity, min_students, status, room_name, unit_name, notes, class_kind, source_workbook, source_sheet, source_block_ref, metadata_json, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
    [
      prepared.code,
      prepared.name,
      prepared.school_term_id,
      prepared.academic_program_id,
      prepared.language,
      prepared.modality,
      prepared.level_name,
      prepared.semester_label,
      prepared.age_group,
      prepared.capacity,
      prepared.min_students,
      prepared.status,
      prepared.room_name,
      prepared.unit_name,
      prepared.notes,
      prepared.class_kind,
      prepared.source_workbook,
      prepared.source_sheet,
      prepared.source_block_ref,
      prepared.metadata_json,
    ]
  );
  return getClassBasicById(created.lastID);
}

async function syncAcademicClassSchedules(classId, schedules = []) {
  const existing = await listClassSchedulesByClassId(classId);
  const existingKeys = new Set(existing.map((row) => [row.weekday, row.start_time, row.end_time, row.notes || ""].join("|")));
  let inserted = 0;
  for (let index = 0; index < schedules.length; index += 1) {
    const item = schedules[index] || {};
    const weekday = sanitizeAcademicTextValue(item.weekday, { maxLength: 40 }) || null;
    const startTime = sanitizeAcademicTextValue(item.start_time, { maxLength: 16 }) || null;
    const endTime = sanitizeAcademicTextValue(item.end_time, { maxLength: 16 }) || null;
    const notes = sanitizeAcademicTextValue(item.notes, { maxLength: 500 }) || null;
    const key = [weekday, startTime, endTime, notes || ""].join("|");
    if (existingKeys.has(key)) continue;
    await run(
      `INSERT INTO class_schedules
         (class_id, weekday, start_time, end_time, timezone, is_primary, notes, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
      [classId, weekday, startTime, endTime, sanitizeAcademicTextValue(item.timezone, { maxLength: 80 }) || "America/Sao_Paulo", inserted === 0 && !existing.length && index === 0, notes]
    );
    existingKeys.add(key);
    inserted += 1;
  }
  return listClassSchedulesByClassId(classId);
}

async function ensureClassTeacherLink(classId, userId, payload = {}) {
  const roleInClass = sanitizeAcademicTextValue(payload.role_in_class || "teacher", { maxLength: 40 }) || "teacher";
  const startDate = normalizeAcademicDateInput(payload.start_date) || null;
  const existing = await get(
    "SELECT id FROM class_teachers WHERE class_id=? AND user_id=? AND role_in_class=? AND coalesce(start_date, '')=coalesce(?, '') LIMIT 1",
    [classId, userId, roleInClass, startDate]
  );
  if (existing?.id) {
    await run(
      "UPDATE class_teachers SET end_date=?, is_active=?, updated_at=datetime('now') WHERE id=?",
      [normalizeAcademicDateInput(payload.end_date), payload.is_active !== false, existing.id]
    );
    return existing.id;
  }
  const created = await run(
    "INSERT INTO class_teachers (class_id, user_id, role_in_class, start_date, end_date, is_active, updated_at) VALUES (?, ?, ?, ?, ?, ?, datetime('now'))",
    [classId, userId, roleInClass, startDate, normalizeAcademicDateInput(payload.end_date), payload.is_active !== false]
  );
  return created.lastID;
}

async function ensureAcademicTeacherUser(teacher = {}, actorUserId = null) {
  const displayName = sanitizeAcademicTextValue(teacher.display_name || teacher.normalized_name, { maxLength: 180 });
  const normalizedName = normalizeAcademicText(teacher.normalized_name || displayName);
  if (!displayName || !normalizedName) return null;

  let profile = await getTeacherProfileByNormalizedName(normalizedName);
  let user = profile?.user_id ? await getUserById(profile.user_id).catch(() => null) : null;
  let createdUser = false;
  let createdProfile = false;

  if (!user) {
    const existingTeacherUser = await get(
      `SELECT id
         FROM users
        WHERE lower(name)=lower(?)
          AND (lower(coalesce(job_title, '')) LIKE lower(?) OR lower(coalesce(department, ''))=lower(?))
        LIMIT 1`,
      [displayName, "%prof%", "Professor"]
    );
    if (existingTeacherUser?.id) {
      user = await getUserById(existingTeacherUser.id).catch(() => null);
    }
  }

  if (!user) {
    const email = await generateAvailableInternalEmail(buildTeacherInternalEmailBase(displayName));
    const passwordHash = await bcrypt.hash(ACADEMIC_TEACHER_TEMP_PASSWORD, 10);
    const created = await run(
      "INSERT INTO users (email, name, password_hash, role, department, can_access_intranet, preferred_locale, job_title, unit_name, additional_permissions_json) VALUES (?, ?, ?, 'teacher', ?, ?, ?, ?, ?, ?)",
      [
        email,
        displayName,
        passwordHash,
        "Professor",
        true,
        DEFAULT_LOCALE,
        "Professor",
        "Acadêmico",
        safeJsonStringify({
          academic_role: "teacher",
          intranet_scope: "teacher_academic",
          allowed_department_slugs: ["professor"],
          allowed_submenu_view_keys: ACADEMIC_TEACHER_SUBMENU_VIEW_KEYS,
        }, "{}"),
      ]
    );
    user = await getUserById(created.lastID);
    createdUser = true;
    if (actorUserId) {
      await logEvent(actorUserId, "academic_teacher_user_created", {
        teacher_name: displayName,
        user_id: created.lastID,
      });
    }
  }

  await syncUserDepartments(user.id || user.sub, ["Professor"]);
  const mergedPermissions = normalizeAdditionalPermissions(user.additional_permissions_json || user.additional_permissions || {});
  mergedPermissions.academic_role = "teacher";
  mergedPermissions.intranet_scope = "teacher_academic";
  mergedPermissions.allowed_department_slugs = ["professor"];
  mergedPermissions.allowed_submenu_view_keys = ACADEMIC_TEACHER_SUBMENU_VIEW_KEYS.slice();
  await run(
    "UPDATE users SET role=?, department=?, can_access_intranet=?, job_title=?, unit_name=?, additional_permissions_json=? WHERE id=?",
    [
      String(user.role || "").trim() === "admin" ? "admin" : "teacher",
      "Professor",
      true,
      normalizeSqlTextValue(user.job_title) || "Professor",
      normalizeSqlTextValue(user.unit_name) || "Acadêmico",
      safeJsonStringify(mergedPermissions, "{}"),
      user.id || user.sub,
    ]
  );

  const aliases = mergeUniqueStrings(teacher.aliases || [], [displayName]);
  const specialties = mergeUniqueStrings(teacher.specialties || []);
  const metadata = mergeAcademicMetadata(profile?.metadata, mergeAcademicMetadata(teacher.metadata || {}, {
    imported_from: "academic_workbook",
    alias_count: aliases.length,
    specialties_count: specialties.length,
  }));
  if (profile?.id) {
    await run(
      `UPDATE teacher_profiles
          SET user_id=?, display_name=?, aliases_json=?, specialties_json=?, metadata_json=?, active=?, updated_at=datetime('now')
        WHERE id=?`,
      [
        user.id || user.sub,
        displayName,
        safeJsonStringify(aliases, "[]"),
        safeJsonStringify(specialties, "[]"),
        safeJsonStringify(metadata, "{}"),
        true,
        profile.id,
      ]
    );
  } else {
    const createdProfileRow = await run(
      `INSERT INTO teacher_profiles
         (user_id, display_name, normalized_name, aliases_json, specialties_json, metadata_json, active, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
      [
        user.id || user.sub,
        displayName,
        normalizedName,
        safeJsonStringify(aliases, "[]"),
        safeJsonStringify(specialties, "[]"),
        safeJsonStringify(metadata, "{}"),
        true,
      ]
    );
    createdProfile = true;
    profile = await getTeacherProfileByNormalizedName(normalizedName);
    if (!profile?.id && createdProfileRow?.lastID) {
      profile = await getTeacherProfileByUserId(user.id || user.sub);
    }
  }

  return {
    user: await getUserById(user.id || user.sub),
    profile: await getTeacherProfileByNormalizedName(normalizedName),
    created_user: createdUser,
    created_profile: createdProfile,
  };
}

async function upsertAcademicStudentFromImport(record = {}, actorUserId = null) {
  const fullName = sanitizeAcademicTextValue(record.full_name || record.student_name, { maxLength: 180 });
  const normalizedName = normalizePersonKey(fullName);
  if (!fullName || !normalizedName) return null;
  const existing = await findAcademicStudentMatch({
    fullName,
    normalizedName,
    phone: record.phone,
  });
  const importedNotes = sanitizeAcademicTextValue(record.notes || record.source_notes || "", { maxLength: 4000 }) || null;
  const payload = {
    id: existing?.id || null,
    full_name: fullName,
    preferred_name: existing?.preferred_name || null,
    phone: sanitizeAcademicTextValue(record.phone, { maxLength: 40 }) || existing?.phone || null,
    whatsapp: sanitizeAcademicTextValue(record.whatsapp || record.phone, { maxLength: 40 }) || existing?.whatsapp || null,
    notes: existing?.notes || importedNotes,
    school_name: existing?.school_name || null,
    school_grade: existing?.school_grade || null,
    status: normalizeStudentStatus(record.status || existing?.status || "ativo"),
    source_workbook: record.source_workbook || existing?.source_workbook || null,
    source_sheet: record.source_sheet,
    source_row_identifier: record.source_row_identifier,
    source_payload: record.source_payload || {},
  };
  const saved = await saveAcademicStudentRecord(payload, actorUserId);
  if (actorUserId && existing?.id) {
    await logEntityChange({
      entityType: "academic_student",
      entityId: saved.id,
      action: "import_sync",
      actorUserId,
      origin: "academic_import",
      detail: {
        source_sheet: record.source_sheet,
        source_row_identifier: record.source_row_identifier,
      },
    });
  }
  return saved;
}

function shouldPreserveEnrollmentStatus(currentStatus = "") {
  const safe = normalizeAcademicText(currentStatus);
  return ["trancado", "cancelado", "concluido", "desistente"].includes(safe);
}

async function findAcademicEnrollmentMatch(studentId, payload = {}) {
  if (!studentId) return null;
  const sourceSheet = sanitizeAcademicTextValue(payload.source_sheet, { maxLength: 120 });
  const sourceRowIdentifier = sanitizeAcademicTextValue(payload.source_row_identifier, { maxLength: 160 });
  if (sourceSheet && sourceRowIdentifier) {
    const bySource = await get(
      "SELECT * FROM enrollments WHERE student_id=? AND source_sheet=? AND source_row_identifier=? LIMIT 1",
      [studentId, sourceSheet, sourceRowIdentifier]
    );
    if (bySource) return mapAcademicEnrollmentRow(bySource);
  }
  const byContext = await get(
    `SELECT *
       FROM enrollments
      WHERE student_id=?
        AND coalesce(academic_program_id, 0)=coalesce(?, 0)
        AND coalesce(school_term_id, 0)=coalesce(?, 0)
      ORDER BY datetime(updated_at) DESC, id DESC
      LIMIT 1`,
    [studentId, Number(payload.academic_program_id || 0) || null, Number(payload.school_term_id || 0) || null]
  );
  return mapAcademicEnrollmentRow(byContext);
}

async function saveAcademicEnrollmentRecord(payload = {}, actorUser) {
  const actorUserId = actorUser?.id || actorUser?.sub || null;
  const enrollmentId = Number(payload.id || 0) || null;
  const studentId = Number(payload.student_id || 0) || null;
  if (!studentId) throw new Error("missing_student_id");
  const prepared = {
    student_id: studentId,
    academic_program_id: Number(payload.academic_program_id || 0) || null,
    school_term_id: Number(payload.school_term_id || 0) || null,
    class_id: Number(payload.class_id || 0) || null,
    enrollment_number: sanitizeAcademicTextValue(payload.enrollment_number, { maxLength: 80 }) || null,
    enrollment_date: normalizeAcademicDateInput(payload.enrollment_date),
    start_date: normalizeAcademicDateInput(payload.start_date),
    end_date: normalizeAcademicDateInput(payload.end_date),
    enrollment_status: normalizeEnrollmentStatus(payload.enrollment_status || "aguardando turma"),
    contract_status: sanitizeAcademicTextValue(payload.contract_status, { maxLength: 80 }) || null,
    payment_status: sanitizeAcademicTextValue(payload.payment_status, { maxLength: 80 }) || null,
    pedagogical_status: sanitizeAcademicTextValue(payload.pedagogical_status, { maxLength: 120 }) || null,
    source_channel: sanitizeAcademicTextValue(payload.source_channel, { maxLength: 120 }) || null,
    source_notes: sanitizeAcademicTextValue(payload.source_notes, { maxLength: 2000 }) || null,
    notes: sanitizeAcademicTextValue(payload.notes, { maxLength: 4000 }) || null,
    source_workbook: sanitizeAcademicTextValue(payload.source_workbook, { maxLength: 180 }) || null,
    source_sheet: sanitizeAcademicTextValue(payload.source_sheet, { maxLength: 120 }) || null,
    source_row_identifier: sanitizeAcademicTextValue(payload.source_row_identifier, { maxLength: 160 }) || null,
    source_payload_json: safeJsonStringify(payload.source_payload || payload.source_payload_json || {}, "{}"),
    metadata_json: safeJsonStringify(mergeAcademicMetadata(payload.metadata_json, payload.metadata || {}), "{}"),
  };

  if (enrollmentId) {
    const existing = await get("SELECT * FROM enrollments WHERE id=? LIMIT 1", [enrollmentId]);
    if (!existing) throw new Error("enrollment_not_found");
    await run(
      `UPDATE enrollments
          SET student_id=?, academic_program_id=?, school_term_id=?, class_id=?, enrollment_number=?, enrollment_date=?, start_date=?, end_date=?,
              enrollment_status=?, contract_status=?, payment_status=?, pedagogical_status=?, source_channel=?, source_notes=?, notes=?,
              source_workbook=?, source_sheet=?, source_row_identifier=?, source_payload_json=?, metadata_json=?, updated_at=datetime('now')
        WHERE id=?`,
      [
        prepared.student_id,
        prepared.academic_program_id,
        prepared.school_term_id,
        prepared.class_id,
        prepared.enrollment_number,
        prepared.enrollment_date,
        prepared.start_date,
        prepared.end_date,
        prepared.enrollment_status,
        prepared.contract_status,
        prepared.payment_status,
        prepared.pedagogical_status,
        prepared.source_channel,
        prepared.source_notes,
        prepared.notes,
        prepared.source_workbook,
        prepared.source_sheet,
        prepared.source_row_identifier,
        prepared.source_payload_json,
        prepared.metadata_json,
        enrollmentId,
      ]
    );
    if (actorUserId) {
      await logEntityChange({
        entityType: "academic_enrollment",
        entityId: enrollmentId,
        action: "updated",
        actorUserId,
        origin: "manual_edit",
      });
    }
    return mapAcademicEnrollmentRow(await get("SELECT * FROM enrollments WHERE id=?", [enrollmentId]));
  }

  const created = await run(
    `INSERT INTO enrollments
       (student_id, academic_program_id, school_term_id, class_id, enrollment_number, enrollment_date, start_date, end_date, enrollment_status,
        contract_status, payment_status, pedagogical_status, source_channel, source_notes, notes, source_workbook, source_sheet, source_row_identifier, source_payload_json, metadata_json, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
    [
      prepared.student_id,
      prepared.academic_program_id,
      prepared.school_term_id,
      prepared.class_id,
      prepared.enrollment_number,
      prepared.enrollment_date,
      prepared.start_date,
      prepared.end_date,
      prepared.enrollment_status,
      prepared.contract_status,
      prepared.payment_status,
      prepared.pedagogical_status,
      prepared.source_channel,
      prepared.source_notes,
      prepared.notes,
      prepared.source_workbook,
      prepared.source_sheet,
      prepared.source_row_identifier,
      prepared.source_payload_json,
      prepared.metadata_json,
    ]
  );
  if (actorUserId) {
    await logEntityChange({
      entityType: "academic_enrollment",
      entityId: created.lastID,
      action: "created",
      actorUserId,
      origin: "manual_create",
    });
  }
  return mapAcademicEnrollmentRow(await get("SELECT * FROM enrollments WHERE id=?", [created.lastID]));
}

async function upsertAcademicEnrollmentFromImport(student, payload = {}, actorUserId = null) {
  if (!student?.id) return null;
  const existing = await findAcademicEnrollmentMatch(student.id, payload);
  const nextStatus = normalizeEnrollmentStatus(payload.enrollment_status || (payload.class_id ? "matriculado" : "aguardando turma"));
  const finalStatus = existing?.enrollment_status && shouldPreserveEnrollmentStatus(existing.enrollment_status)
    ? existing.enrollment_status
    : nextStatus;
  const mergedPayload = {
    ...payload,
    id: existing?.id || null,
    student_id: student.id,
    enrollment_status: finalStatus,
    notes: existing?.notes || payload.notes || null,
  };
  const saved = await saveAcademicEnrollmentRecord(mergedPayload, actorUserId ? { id: actorUserId } : null);
  if (existing?.id && Number(existing.class_id || 0) !== Number(saved.class_id || 0) && Number(saved.class_id || 0)) {
    await run(
      `INSERT INTO enrollment_class_history
         (enrollment_id, old_class_id, new_class_id, reason, changed_by_user_id, changed_at, notes)
       VALUES (?, ?, ?, ?, ?, datetime('now'), ?)`,
      [
        saved.id,
        existing.class_id || null,
        saved.class_id || null,
        "Sincronização da planilha acadêmica",
        actorUserId || null,
        "Atualização automática a partir da grade importada",
      ]
    );
  }
  return saved;
}

function getAcademicWorkbookPriority(workbookName = "") {
  const raw = String(workbookName || "").trim();
  const normalized = normalizeAcademicText(raw);
  if (!normalized) return 0;
  let score = 0;
  if (normalized.includes("2026 1")) score += 120;
  if (normalized.includes("presencial")) score += 90;
  if (normalized.includes("home school")) score += 60;
  if (normalized.includes("time table")) score += 20;
  if (/\(\d+\)/.test(raw)) score -= 10;
  return score;
}

function countAcademicDefinedValues(value, seen = new WeakSet()) {
  if (value === null || value === undefined) return 0;
  if (typeof value === "string") return String(value).trim() ? 1 : 0;
  if (typeof value === "number") return Number.isFinite(value) ? 1 : 0;
  if (typeof value === "boolean") return 1;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? 0 : 1;
  if (Array.isArray(value)) {
    return value.reduce((total, item) => total + countAcademicDefinedValues(item, seen), 0);
  }
  if (typeof value === "object") {
    if (seen.has(value)) return 0;
    seen.add(value);
    return Object.values(value).reduce((total, item) => total + countAcademicDefinedValues(item, seen), 0);
  }
  return 0;
}

function choosePreferredAcademicImportRecord(existing, incoming) {
  if (!existing) return incoming;
  if (!incoming) return existing;
  const existingScore = countAcademicDefinedValues(existing) + getAcademicWorkbookPriority(existing.source_workbook || "");
  const incomingScore = countAcademicDefinedValues(incoming) + getAcademicWorkbookPriority(incoming.source_workbook || "");
  return incomingScore >= existingScore ? incoming : existing;
}

function buildAcademicEnrollmentImportKey(record = {}) {
  if (record.dedupe_hash) return String(record.dedupe_hash);
  const parts = [
    normalizePersonKey(record.full_name || record.student_name || ""),
    sanitizeAcademicIdentifier(record.phone || record.whatsapp || "", "no-phone"),
    normalizeAcademicText(record.language || ""),
    normalizeAcademicText(record.semester_label || record.school_term_code || ""),
    normalizeAcademicText(record.class_kind || record.class_type || ""),
    normalizeAcademicText(record.requested_class_label || record.level_name || record.program_name || ""),
  ];
  return hashText(parts.join("|"));
}

function buildAcademicClassBlockKey(block = {}) {
  const parts = [
    normalizeAcademicText(block.class_name || ""),
    normalizeAcademicText(block.teacher_normalized_name || block.teacher_display_name || ""),
    normalizeAcademicText(block.semester_label || block.school_term_code || ""),
    normalizeAcademicText(block.modality || ""),
    normalizeAcademicText(block.class_kind || "regular"),
    normalizeAcademicText(block.source_sheet || ""),
  ];
  return hashText(parts.join("|"));
}

function mergeAcademicSchedules(existing = [], incoming = []) {
  const map = new Map();
  for (const schedule of [...(Array.isArray(existing) ? existing : []), ...(Array.isArray(incoming) ? incoming : [])]) {
    const key = [
      normalizeAcademicText(schedule?.weekday || ""),
      normalizeAcademicText(schedule?.start_time || ""),
      normalizeAcademicText(schedule?.end_time || ""),
      normalizeAcademicText(schedule?.notes || ""),
    ].join("|");
    if (!key.replace(/\|/g, "").trim()) continue;
    map.set(key, {
      weekday: sanitizeAcademicTextValue(schedule?.weekday, { maxLength: 60 }) || "",
      start_time: sanitizeAcademicTextValue(schedule?.start_time, { maxLength: 16 }) || "",
      end_time: sanitizeAcademicTextValue(schedule?.end_time, { maxLength: 16 }) || "",
      timezone: sanitizeAcademicTextValue(schedule?.timezone, { maxLength: 60 }) || "America/Sao_Paulo",
      notes: sanitizeAcademicTextValue(schedule?.notes, { maxLength: 400 }) || null,
      is_primary: schedule?.is_primary === true,
    });
  }
  return Array.from(map.values());
}

function mergeAcademicStudentEntries(existing = [], incoming = []) {
  const map = new Map();
  for (const item of [...(Array.isArray(existing) ? existing : []), ...(Array.isArray(incoming) ? incoming : [])]) {
    const key = [
      normalizePersonKey(item?.full_name || ""),
      normalizeAcademicText(item?.source_sheet || ""),
      normalizeAcademicText(item?.source_row_identifier || ""),
    ].join("|");
    if (!key.replace(/\|/g, "").trim()) continue;
    map.set(key, choosePreferredAcademicImportRecord(map.get(key), item));
  }
  return Array.from(map.values());
}

function mergeAcademicClassBlockRecords(existing = {}, incoming = {}) {
  const preferred = choosePreferredAcademicImportRecord(existing, incoming) || {};
  const fallback = preferred === existing ? incoming : existing;
  return {
    ...fallback,
    ...preferred,
    source_workbook: preferred.source_workbook || fallback?.source_workbook || null,
    source_sheet: preferred.source_sheet || fallback?.source_sheet || null,
    source_block_ref: preferred.source_block_ref || fallback?.source_block_ref || null,
    class_name: preferred.class_name || fallback?.class_name || null,
    class_kind: preferred.class_kind || fallback?.class_kind || "regular",
    language: preferred.language || fallback?.language || "",
    modality: preferred.modality || fallback?.modality || "",
    level_name: preferred.level_name || fallback?.level_name || "",
    semester_label: preferred.semester_label || fallback?.semester_label || "",
    school_term_code: preferred.school_term_code || fallback?.school_term_code || "",
    teacher_display_name: preferred.teacher_display_name || fallback?.teacher_display_name || "",
    teacher_normalized_name: preferred.teacher_normalized_name || fallback?.teacher_normalized_name || "",
    teacher_aliases: mergeUniqueStrings(existing.teacher_aliases || [], incoming.teacher_aliases || []),
    teacher_specialties: mergeUniqueStrings(existing.teacher_specialties || [], incoming.teacher_specialties || []),
    descriptor_lines: mergeUniqueStrings(existing.descriptor_lines || [], incoming.descriptor_lines || []),
    notes_lines: mergeUniqueStrings(existing.notes_lines || [], incoming.notes_lines || []),
    schedules: mergeAcademicSchedules(existing.schedules || [], incoming.schedules || []),
    students: mergeAcademicStudentEntries(existing.students || [], incoming.students || []),
  };
}

function consolidateAcademicParsedWorkbooks(parsedEntries = []) {
  const workbookNames = [];
  const relevantSheets = new Set();
  const ignoredSheets = new Set();
  const auxiliarySheets = [];
  const sheetKinds = [];
  const teacherMap = new Map();
  const enrollmentMap = new Map();
  const classBlockMap = new Map();
  const trancadosMap = new Map();
  const desistentesMap = new Map();
  const cancelamentosMap = new Map();
  const movementsMap = new Map();
  const rawTotals = {
    matriculas_rows: 0,
    class_blocks: 0,
    trancados_rows: 0,
    desistentes_rows: 0,
    cancelamentos_rows: 0,
    movements_rows: 0,
  };

  for (const entry of Array.isArray(parsedEntries) ? parsedEntries : []) {
    const parsed = entry?.parsed;
    if (!parsed) continue;
    workbookNames.push(parsed.workbook_name);
    (parsed.relevant_sheets || []).forEach((item) => relevantSheets.add(item));
    (parsed.ignored_sheets || []).forEach((item) => ignoredSheets.add(item));
    (parsed.auxiliary_sheets || []).forEach((item) => auxiliarySheets.push({ workbook_name: parsed.workbook_name, ...item }));
    (parsed.sheet_kinds || []).forEach((item) => sheetKinds.push({ workbook_name: parsed.workbook_name, ...item }));

    rawTotals.matriculas_rows += Number(parsed.matriculas?.length || 0);
    rawTotals.class_blocks += Number(parsed.class_blocks?.length || 0);
    rawTotals.trancados_rows += Number(parsed.trancados?.length || 0);
    rawTotals.desistentes_rows += Number(parsed.desistentes?.length || 0);
    rawTotals.cancelamentos_rows += Number(parsed.cancelamentos?.length || 0);
    rawTotals.movements_rows += Number(parsed.movements?.length || 0);

    for (const teacher of parsed.teachers || []) {
      const key = normalizeAcademicText(teacher.normalized_name || teacher.display_name || "");
      if (!key) continue;
      const current = teacherMap.get(key);
      const preferred = choosePreferredAcademicImportRecord(current, teacher) || teacher;
      teacherMap.set(key, {
        ...current,
        ...preferred,
        display_name: preferred.display_name || current?.display_name || "",
        normalized_name: key,
        aliases: mergeUniqueStrings(current?.aliases || [], teacher.aliases || [], [teacher.display_name]),
        specialties: mergeUniqueStrings(current?.specialties || [], teacher.specialties || []),
        metadata: mergeAcademicMetadata(current?.metadata || {}, {
          source_workbooks: mergeUniqueStrings(current?.metadata?.source_workbooks || [], [parsed.workbook_name]),
        }),
      });
    }

    for (const record of parsed.matriculas || []) {
      const key = buildAcademicEnrollmentImportKey(record);
      const current = enrollmentMap.get(key);
      const preferred = choosePreferredAcademicImportRecord(current, record);
      const fallback = preferred === current ? record : current;
      enrollmentMap.set(key, {
        ...fallback,
        ...preferred,
        source_workbook: preferred?.source_workbook || fallback?.source_workbook || null,
        notes: preferred?.notes || fallback?.notes || null,
        source_notes: preferred?.source_notes || fallback?.source_notes || null,
      });
    }

    for (const block of parsed.class_blocks || []) {
      const key = buildAcademicClassBlockKey(block);
      classBlockMap.set(key, mergeAcademicClassBlockRecords(classBlockMap.get(key) || {}, block));
    }

    for (const item of parsed.trancados || []) {
      const key = [normalizePersonKey(item.full_name || ""), normalizeAcademicText(item.level_name || ""), normalizeAcademicText(item.status_date || ""), "trancado"].join("|");
      trancadosMap.set(key, choosePreferredAcademicImportRecord(trancadosMap.get(key), item));
    }
    for (const item of parsed.desistentes || []) {
      const key = [normalizePersonKey(item.full_name || ""), normalizeAcademicText(item.level_name || ""), normalizeAcademicText(item.status_date || ""), "desistente"].join("|");
      desistentesMap.set(key, choosePreferredAcademicImportRecord(desistentesMap.get(key), item));
    }
    for (const item of parsed.cancelamentos || []) {
      const key = [normalizePersonKey(item.full_name || ""), normalizeAcademicText(item.language || ""), normalizeAcademicText(item.notes || ""), "cancelado"].join("|");
      cancelamentosMap.set(key, choosePreferredAcademicImportRecord(cancelamentosMap.get(key), item));
    }
    for (const item of parsed.movements || []) {
      const key = [normalizeAcademicText(item.movement_type || ""), normalizePersonKey(item.full_name || ""), normalizeAcademicText(item.target_class_label || item.level_name || ""), normalizeAcademicText(item.status_date || ""), normalizeAcademicText(item.notes || "")].join("|");
      movementsMap.set(key, choosePreferredAcademicImportRecord(movementsMap.get(key), item));
    }
  }

  return {
    source_key: ACADEMIC_IMPORT_SOURCE_KEY,
    workbook_names: workbookNames,
    relevant_sheets: Array.from(relevantSheets),
    ignored_sheets: Array.from(ignoredSheets),
    auxiliary_sheets: auxiliarySheets,
    sheet_kinds: sheetKinds,
    matriculas: Array.from(enrollmentMap.values()),
    class_blocks: Array.from(classBlockMap.values()),
    trancados: Array.from(trancadosMap.values()),
    desistentes: Array.from(desistentesMap.values()),
    cancelamentos: Array.from(cancelamentosMap.values()),
    movements: Array.from(movementsMap.values()),
    teachers: Array.from(teacherMap.values()),
    raw_totals: rawTotals,
  };
}

async function createAcademicImportRun({ workbookNames = [], actorUserId = null } = {}) {
  const created = await run(
    `INSERT INTO academic_import_runs
       (source_key, status, workbook_names_json, actor_user_id, updated_at)
     VALUES (?, 'running', ?, ?, datetime('now'))`,
    [
      ACADEMIC_IMPORT_SOURCE_KEY,
      safeJsonStringify(workbookNames, "[]"),
      actorUserId || null,
    ]
  );
  return Number(created?.lastID || 0) || null;
}

async function appendAcademicImportLog(runId, payload = {}) {
  if (!Number(runId || 0)) return null;
  return run(
    `INSERT INTO academic_import_logs
       (run_id, workbook_name, sheet_name, log_level, stage, message, payload_json)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      Number(runId),
      sanitizeAcademicTextValue(payload.workbook_name, { maxLength: 180 }) || null,
      sanitizeAcademicTextValue(payload.sheet_name, { maxLength: 120 }) || null,
      sanitizeAcademicTextValue(payload.log_level, { maxLength: 20 }) || "info",
      sanitizeAcademicTextValue(payload.stage, { maxLength: 80 }) || null,
      sanitizeAcademicTextValue(payload.message, { maxLength: 1000 }) || "academic_import_log",
      safeJsonStringify(payload.payload || {}, "{}"),
    ]
  );
}

async function finalizeAcademicImportRun(runId, payload = {}) {
  if (!Number(runId || 0)) return null;
  return run(
    `UPDATE academic_import_runs
        SET status=?, imported_sheets_json=?, ignored_sheets_json=?, summary_json=?, updated_at=datetime('now')
      WHERE id=?`,
    [
      sanitizeAcademicTextValue(payload.status, { maxLength: 40 }) || "completed",
      safeJsonStringify(payload.imported_sheets || [], "[]"),
      safeJsonStringify(payload.ignored_sheets || [], "[]"),
      safeJsonStringify(payload.summary || {}, "{}"),
      Number(runId),
    ]
  );
}

async function refreshAcademicStudentStatus(studentId) {
  const safeStudentId = Number(studentId || 0) || null;
  if (!safeStudentId) return null;
  const rows = await all(
    `SELECT enrollment_status
       FROM enrollments
      WHERE student_id=?
      ORDER BY datetime(updated_at) DESC, id DESC`,
    [safeStudentId]
  );
  const statuses = (rows || []).map((row) => normalizeAcademicText(row.enrollment_status || ""));
  let nextStatus = "ativo";
  if (statuses.some((item) => ["matriculado", "transferido"].includes(item))) nextStatus = "ativo";
  else if (statuses.some((item) => ["aguardando turma", "pre matricula"].includes(item))) nextStatus = "aguardando";
  else if (statuses.some((item) => item === "trancado")) nextStatus = "trancado";
  else if (statuses.some((item) => item === "desistente")) nextStatus = "desistente";
  else if (statuses.some((item) => item === "cancelado")) nextStatus = "cancelado";
  else if (statuses.length) nextStatus = "inativo";
  await run("UPDATE students SET status=?, updated_at=datetime('now') WHERE id=?", [nextStatus, safeStudentId]);
  return get("SELECT * FROM students WHERE id=? LIMIT 1", [safeStudentId]);
}

async function findBestEnrollmentForAcademicStatus(studentId, item = {}) {
  const safeStudentId = Number(studentId || 0) || null;
  if (!safeStudentId) return null;
  const rows = await all(
    `SELECT e.*, st.code AS school_term_code, ap.language, ap.level_name, ap.modality, c.name AS class_name
       FROM enrollments e
       LEFT JOIN school_terms st ON st.id = e.school_term_id
       LEFT JOIN academic_programs ap ON ap.id = e.academic_program_id
       LEFT JOIN classes c ON c.id = e.class_id
      WHERE e.student_id=?
      ORDER BY datetime(e.updated_at) DESC, e.id DESC`,
    [safeStudentId]
  );
  if (!rows.length) return null;
  const termKey = normalizeAcademicText(item.semester_label || item.school_term_code || "");
  const languageKey = normalizeAcademicText(item.language || "");
  const levelKey = normalizeAcademicText(item.level_name || "");
  const classKey = normalizeAcademicText(item.target_class_label || "");
  let best = null;
  let bestScore = -1;
  rows.forEach((row, index) => {
    let score = 0;
    if (termKey && normalizeAcademicText(row.school_term_code || "") === termKey) score += 5;
    if (languageKey && normalizeAcademicText(row.language || "") === languageKey) score += 3;
    if (levelKey && normalizeAcademicText(row.level_name || "") === levelKey) score += 2;
    if (classKey) {
      const classNameKey = normalizeAcademicText(row.class_name || "");
      if (classNameKey && (classNameKey.includes(classKey) || classKey.includes(classNameKey))) score += 2;
    }
    if (normalizeAcademicText(row.enrollment_status || "") === "matriculado") score += 1;
    score += Math.max(0, 100 - index);
    if (score > bestScore) {
      bestScore = score;
      best = row;
    }
  });
  return best ? mapAcademicEnrollmentRow(best) : null;
}

async function recordAcademicTransferEvent(payload = {}) {
  const enrollmentId = Number(payload.enrollment_id || 0) || null;
  if (!enrollmentId) return null;
  const transferType = sanitizeAcademicTextValue(payload.transfer_type, { maxLength: 80 }) || "movimentacao";
  const oldValueJson = safeJsonStringify(payload.old_value || payload.old_value_json || {}, "{}");
  const newValueJson = safeJsonStringify(payload.new_value || payload.new_value_json || {}, "{}");
  const reason = sanitizeAcademicTextValue(payload.reason, { maxLength: 800 }) || null;
  const notes = sanitizeAcademicTextValue(payload.notes, { maxLength: 2000 }) || null;
  const existing = await get(
    `SELECT id
       FROM student_transfers
      WHERE enrollment_id=?
        AND lower(coalesce(transfer_type, ''))=lower(?)
        AND coalesce(old_value_json, '')=coalesce(?, '')
        AND coalesce(new_value_json, '')=coalesce(?, '')
        AND lower(coalesce(reason, ''))=lower(coalesce(?, ''))
      LIMIT 1`,
    [enrollmentId, transferType, oldValueJson, newValueJson, reason]
  );
  if (existing?.id) return existing.id;
  const created = await run(
    `INSERT INTO student_transfers
       (enrollment_id, transfer_type, old_value_json, new_value_json, reason, changed_by_user_id, changed_at, notes)
     VALUES (?, ?, ?, ?, ?, ?, datetime('now'), ?)`,
    [
      enrollmentId,
      transferType,
      oldValueJson,
      newValueJson,
      reason,
      Number(payload.changed_by_user_id || 0) || null,
      notes,
    ]
  );
  return created?.lastID || null;
}

async function applyAcademicStatusImport(item = {}, statusOverride = "", actorUserId = null, runId = null) {
  const statusType = normalizeAcademicText(statusOverride || item.status_type || "");
  if (!["trancado", "desistente", "cancelado"].includes(statusType)) return false;
  const student = await findAcademicStudentMatch({
    fullName: item.full_name,
    normalizedName: item.normalized_name,
    phone: item.phone,
  });
  if (!student?.id) {
    await appendAcademicImportLog(runId, {
      workbook_name: item.source_workbook,
      sheet_name: item.source_sheet,
      log_level: "warn",
      stage: "status",
      message: "Aluno de status nao encontrado para consolidacao.",
      payload: { full_name: item.full_name, status_type: statusType },
    });
    return false;
  }
  const enrollment = await findBestEnrollmentForAcademicStatus(student.id, item);
  if (enrollment?.id) {
    await saveAcademicEnrollmentRecord({
      ...enrollment,
      id: enrollment.id,
      student_id: enrollment.student_id,
      academic_program_id: enrollment.academic_program_id,
      school_term_id: enrollment.school_term_id,
      class_id: enrollment.class_id,
      enrollment_number: enrollment.enrollment_number,
      enrollment_date: enrollment.enrollment_date,
      start_date: enrollment.start_date,
      end_date: enrollment.end_date,
      enrollment_status: statusType,
      contract_status: enrollment.contract_status,
      payment_status: enrollment.payment_status,
      pedagogical_status: enrollment.pedagogical_status || toAcademicTitleCase(statusType),
      source_channel: enrollment.source_channel || "academic_import",
      source_notes: mergeUniqueStrings([enrollment.source_notes || ""], [item.notes || ""]).join(" | ") || enrollment.source_notes || item.notes || null,
      notes: enrollment.notes,
      source_workbook: item.source_workbook || enrollment.source_workbook || null,
      source_sheet: item.source_sheet || enrollment.source_sheet || null,
      source_row_identifier: item.source_row_identifier || enrollment.source_row_identifier || null,
      source_payload: item.source_payload || safeJsonParse(enrollment.source_payload_json || "{}") || {},
      metadata: mergeAcademicMetadata(enrollment.metadata || enrollment.metadata_json || {}, {
        latest_imported_status: statusType,
        latest_imported_status_date: item.status_date || brazilDateKey(),
      }),
    }, actorUserId ? { id: actorUserId } : null);
  }
  await refreshAcademicStudentStatus(student.id);
  return true;
}

function inferAcademicUnitName(value = "") {
  const normalized = normalizeAcademicText(value);
  if (!normalized) return "Academico";
  if (normalized.includes("home school")) return "Home School";
  if (normalized.includes("presencial")) return "Presencial";
  if (normalized.includes("online")) return "Online";
  return "Academico";
}

async function importAcademicWorkbookBatch({ workbookPath, workbookName = "", actorUserId = null }) {
  return importAcademicWorkbooksBatch({
    workbookFiles: [
      {
        path: workbookPath,
        originalname: workbookName || path.basename(workbookPath || ""),
      },
    ],
    actorUserId,
  });
}

async function importAcademicWorkbooksBatch({ workbookFiles = [], actorUserId = null }) {
  const safeFiles = (Array.isArray(workbookFiles) ? workbookFiles : [])
    .filter((item) => item?.path && fs.existsSync(item.path));
  if (!safeFiles.length) {
    throw new Error("missing_academic_workbook");
  }

  const runId = await createAcademicImportRun({
    workbookNames: safeFiles.map((item) => sanitizeAcademicWorkbookName(item.originalname || item.workbookName || path.basename(item.path))),
    actorUserId,
  });

  try {
    const parsedEntries = [];
    for (const workbookFile of safeFiles) {
      const workbookName = sanitizeAcademicWorkbookName(workbookFile.originalname || workbookFile.workbookName || path.basename(workbookFile.path));
      const workbook = readAcademicWorkbookFromFile(workbookFile.path);
      const parsed = parseAcademicWorkbook(workbook, { workbookName });
      parsedEntries.push({ workbook_name: workbookName, parsed });
      await appendAcademicImportLog(runId, {
        workbook_name: workbookName,
        stage: "parse",
        message: "Planilha academica lida com sucesso.",
        payload: {
          workbook_type: parsed.workbook_type,
          relevant_sheets: parsed.relevant_sheets,
          ignored_sheets: parsed.ignored_sheets,
          totals: {
            matriculas_rows: parsed.matriculas.length,
            class_blocks: parsed.class_blocks.length,
            trancados_rows: parsed.trancados.length,
            desistentes_rows: parsed.desistentes.length,
            cancelamentos_rows: parsed.cancelamentos.length,
            movements_rows: parsed.movements.length,
          },
        },
      });
    }

    const consolidated = consolidateAcademicParsedWorkbooks(parsedEntries);
    const teacherProvisioned = [];
    let studentsInserted = 0;
    let studentsUpdated = 0;
    let enrollmentsInserted = 0;
    let enrollmentsUpdated = 0;
    let classesUpserted = 0;
    let schedulesSynced = 0;
    let statusesUpdated = 0;
    let movementsRegistered = 0;
    const touchedClassIds = new Set();

    for (const teacher of consolidated.teachers || []) {
      const provisioned = await ensureAcademicTeacherUser({
        ...teacher,
        metadata: mergeAcademicMetadata(teacher.metadata || {}, {
          source_workbooks: consolidated.workbook_names,
        }),
      }, actorUserId);
      if (provisioned?.user?.id) {
        teacherProvisioned.push({
          teacher_name: provisioned.profile?.display_name || provisioned.user.name,
          user_id: provisioned.user.id,
          email: provisioned.user.email,
          created_user: Boolean(provisioned.created_user),
          created_profile: Boolean(provisioned.created_profile),
        });
      }
    }

    for (const row of consolidated.matriculas || []) {
      const student = await upsertAcademicStudentFromImport({
        full_name: row.full_name,
        phone: row.phone,
        whatsapp: row.whatsapp,
        notes: row.source_notes || row.notes,
        school_name: row.school_name,
        school_grade: row.school_grade,
        source_workbook: row.source_workbook,
        source_sheet: row.source_sheet,
        source_row_identifier: row.source_row_identifier,
        source_payload: row.source_payload,
        status: row.status || "ativo",
      }, actorUserId);
      if (!student?.id) continue;
      const existedEnrollment = await findAcademicEnrollmentMatch(student.id, row);
      const schoolTermCode = row.school_term_code || row.semester_label || "";
      const schoolTerm = schoolTermCode
        ? await ensureSchoolTermRecord({
            code: schoolTermCode,
            name: deriveSchoolTermName(schoolTermCode),
            status: "active",
          })
        : null;
      const program = await ensureAcademicProgramRecord({
        language: row.language || detectAcademicLanguageFromText(`${row.program_name || ""} ${row.level_name || ""}`),
        program_name: row.program_name || buildProgramName(row.language, row.level_name, row.modality),
        level_name: row.level_name,
        semester_label: row.semester_label || schoolTermCode,
        modality: row.modality || detectAcademicModalityFromText(row.requested_class_label || ""),
        material_name: row.material_name,
        status: "active",
      });
      await upsertAcademicEnrollmentFromImport(student, {
        academic_program_id: program?.id || null,
        school_term_id: schoolTerm?.id || null,
        class_id: null,
        enrollment_number: row.enrollment_number || null,
        enrollment_date: row.enrollment_date,
        start_date: row.start_date || row.enrollment_date,
        enrollment_status: row.enrollment_status || (["vip", "semi_vip", "intensive"].includes(String(row.class_kind || "")) ? "matriculado" : "aguardando turma"),
        contract_status: row.contract_status,
        payment_status: row.payment_status,
        pedagogical_status: row.pedagogical_status || null,
        source_channel: row.source_channel || "academic_import",
        source_notes: row.source_notes,
        notes: row.notes,
        source_workbook: row.source_workbook,
        source_sheet: row.source_sheet,
        source_row_identifier: row.source_row_identifier,
        source_payload: row.source_payload,
        metadata: {
          class_kind: row.class_kind || "regular",
          requested_class_label: row.requested_class_label || null,
          class_type: row.class_type || null,
          system_name: row.system_name || null,
          attendant_name: row.attendant_name || null,
          media_source: row.media_source || null,
          source_workbooks: consolidated.workbook_names,
        },
      }, actorUserId);
      if (existedEnrollment?.id) enrollmentsUpdated += 1;
      else enrollmentsInserted += 1;
      if (student.created_at === student.updated_at) studentsInserted += 1;
      else studentsUpdated += 1;
    }

    for (const block of consolidated.class_blocks || []) {
      const teacher = await ensureAcademicTeacherUser({
        display_name: block.teacher_display_name,
        normalized_name: block.teacher_normalized_name,
        aliases: block.teacher_aliases,
        specialties: block.teacher_specialties,
        metadata: {
          source_workbooks: mergeUniqueStrings([block.source_workbook], consolidated.workbook_names),
        },
      }, actorUserId);
      const schoolTermCode = block.school_term_code || block.semester_label || "";
      const schoolTerm = schoolTermCode
        ? await ensureSchoolTermRecord({
            code: schoolTermCode,
            name: deriveSchoolTermName(schoolTermCode),
            status: "active",
          })
        : null;
      const program = await ensureAcademicProgramRecord({
        language: block.language || detectAcademicLanguageFromText(`${block.class_name || ""} ${(block.teacher_specialties || []).join(" ")}`),
        program_name: block.class_name,
        level_name: block.level_name,
        semester_label: block.semester_label || schoolTermCode,
        modality: block.modality || detectAcademicModalityFromText(block.source_sheet || ""),
        status: "active",
      });
      const classRow = await ensureAcademicClassRecord({
        name: block.class_name,
        class_name: block.class_name,
        school_term_id: schoolTerm?.id || null,
        academic_program_id: program?.id || null,
        language: block.language,
        modality: block.modality || "online",
        level_name: block.level_name,
        semester_label: block.semester_label || schoolTermCode,
        status: "ativa",
        class_kind: block.class_kind || "regular",
        source_workbook: block.source_workbook,
        source_sheet: block.source_sheet,
        source_block_ref: block.source_block_ref,
        notes: mergeUniqueStrings(block.descriptor_lines || [], block.notes_lines || []).join(" | "),
        unit_name: inferAcademicUnitName(`${block.modality || ""} ${block.source_sheet || ""} ${block.source_workbook || ""}`),
        metadata: {
          descriptors: block.descriptor_lines || [],
          notes_lines: block.notes_lines || [],
          teacher_display_name: block.teacher_display_name || null,
          teacher_aliases: block.teacher_aliases || [],
          teacher_specialties: block.teacher_specialties || [],
          source_workbooks: mergeUniqueStrings([block.source_workbook], consolidated.workbook_names),
        },
      });
      classesUpserted += 1;
      touchedClassIds.add(Number(classRow.id));
      const schedules = await syncAcademicClassSchedules(classRow.id, block.schedules || []);
      schedulesSynced += Number((schedules || []).length || 0);
      if (teacher?.user?.id) {
        await ensureClassTeacherLink(classRow.id, teacher.user.id, {
          role_in_class: "teacher",
          is_active: true,
        });
      }

      for (const studentEntry of block.students || []) {
        const student = await upsertAcademicStudentFromImport({
          full_name: studentEntry.full_name,
          phone: studentEntry.phone,
          notes: studentEntry.raw_value,
          source_workbook: block.source_workbook,
          source_sheet: studentEntry.source_sheet || block.source_sheet,
          source_row_identifier: studentEntry.source_row_identifier,
          source_payload: studentEntry,
          status: "ativo",
        }, actorUserId);
        if (!student?.id) continue;
        const existingEnrollment = await findAcademicEnrollmentMatch(student.id, {
          academic_program_id: program?.id || null,
          school_term_id: schoolTerm?.id || null,
          source_sheet: studentEntry.source_sheet || block.source_sheet,
          source_row_identifier: studentEntry.source_row_identifier,
        });
        const enrollment = await upsertAcademicEnrollmentFromImport(student, {
          id: existingEnrollment?.id || null,
          academic_program_id: program?.id || null,
          school_term_id: schoolTerm?.id || null,
          class_id: classRow.id,
          enrollment_status: "matriculado",
          source_channel: "academic_workbook",
          source_notes: mergeUniqueStrings(block.descriptor_lines || [], [studentEntry.raw_value || ""]).join(" | "),
          notes: existingEnrollment?.notes || null,
          source_workbook: block.source_workbook,
          source_sheet: block.source_sheet,
          source_row_identifier: studentEntry.source_row_identifier || `${block.source_sheet}:${student.id}`,
          source_payload: {
            block,
            student: studentEntry,
          },
          metadata: {
            class_kind: block.class_kind || "regular",
            teacher_display_name: block.teacher_display_name || null,
            source_workbooks: mergeUniqueStrings([block.source_workbook], consolidated.workbook_names),
          },
        }, actorUserId);
        if (!existingEnrollment?.id) enrollmentsInserted += 1;
        else if (Number(existingEnrollment.class_id || 0) !== Number(enrollment.class_id || 0)) enrollmentsUpdated += 1;
      }
    }

    for (const item of consolidated.trancados || []) {
      if (await applyAcademicStatusImport(item, "trancado", actorUserId, runId)) statusesUpdated += 1;
    }
    for (const item of consolidated.desistentes || []) {
      if (await applyAcademicStatusImport(item, "desistente", actorUserId, runId)) statusesUpdated += 1;
    }
    for (const item of consolidated.cancelamentos || []) {
      if (await applyAcademicStatusImport(item, "cancelado", actorUserId, runId)) statusesUpdated += 1;
    }

    for (const item of consolidated.movements || []) {
      const student = await findAcademicStudentMatch({
        fullName: item.full_name,
        normalizedName: item.normalized_name,
      });
      if (!student?.id) continue;
      const enrollment = await findBestEnrollmentForAcademicStatus(student.id, item);
      if (!enrollment?.id) continue;
      const oldClass = enrollment.class_id ? await getClassBasicById(enrollment.class_id).catch(() => null) : null;
      const transferType = sanitizeAcademicTextValue(item.movement_type, { maxLength: 80 }) || "movimentacao";
      await recordAcademicTransferEvent({
        enrollment_id: enrollment.id,
        transfer_type: transferType,
        old_value: {
          class_id: enrollment.class_id || null,
          class_name: oldClass?.name || null,
          schedule_snapshot: enrollment.class_id ? await listClassSchedulesByClassId(enrollment.class_id) : [],
        },
        new_value: {
          target_class_label: item.target_class_label || null,
          level_name: item.level_name || null,
          teacher_name: item.teacher_name || null,
          status_date: item.status_date || null,
          source_sheet: item.source_sheet || null,
        },
        reason: item.notes || toAcademicTitleCase(item.movement_type || "movimentacao"),
        changed_by_user_id: actorUserId,
        notes: item.notes || null,
      });
      if (transferType === "remanejamento" || transferType === "reversao_pedagogica") {
        await saveAcademicEnrollmentRecord({
          ...enrollment,
          id: enrollment.id,
          student_id: enrollment.student_id,
          metadata: mergeAcademicMetadata(enrollment.metadata || enrollment.metadata_json || {}, {
            latest_movement_type: transferType,
            latest_movement_sheet: item.source_sheet || null,
          }),
          pedagogical_status: enrollment.pedagogical_status || "remanejado",
        }, actorUserId ? { id: actorUserId } : null);
      }
      movementsRegistered += 1;
    }

    const summary = {
      workbook_names: consolidated.workbook_names,
      imported_sheets: consolidated.relevant_sheets,
      ignored_sheets: consolidated.ignored_sheets,
      teachers_found: consolidated.teachers.map((item) => item.display_name),
      provisioned_teachers: teacherProvisioned,
      raw_totals: consolidated.raw_totals,
      totals: {
        matriculas_rows: consolidated.matriculas.length,
        class_blocks: consolidated.class_blocks.length,
        trancados_rows: consolidated.trancados.length,
        desistentes_rows: consolidated.desistentes.length,
        cancelamentos_rows: consolidated.cancelamentos.length,
        movements_rows: consolidated.movements.length,
        students_inserted: studentsInserted,
        students_updated: studentsUpdated,
        enrollments_inserted: enrollmentsInserted,
        enrollments_updated: enrollmentsUpdated,
        classes_upserted: classesUpserted,
        schedules_synced: schedulesSynced,
        statuses_updated: statusesUpdated,
        movements_registered: movementsRegistered,
      },
      touched_class_ids: Array.from(touchedClassIds),
    };

    await finalizeAcademicImportRun(runId, {
      status: "completed",
      imported_sheets: consolidated.relevant_sheets,
      ignored_sheets: consolidated.ignored_sheets,
      summary,
    });

    if (actorUserId) {
      await logEvent(actorUserId, "academic_import_completed", summary);
    }

    return summary;
  } catch (err) {
    await appendAcademicImportLog(runId, {
      log_level: "error",
      stage: "import",
      message: err?.message || "academic_import_failed",
      payload: { stack: err?.stack ? String(err.stack).slice(0, 2000) : "" },
    });
    await finalizeAcademicImportRun(runId, {
      status: "failed",
      imported_sheets: [],
      ignored_sheets: [],
      summary: { error: err?.message || "academic_import_failed" },
    });
    throw err;
  }
}

function buildAcademicSearchLike(value = "") {
  const safe = String(value || "").trim();
  return safe ? `%${safe}%` : "";
}

async function listAcademicFilterOptions(scope) {
  const teacherRestriction = buildAcademicScopeExistsSql(scope, "e");
  const where = [];
  const params = [];
  if (teacherRestriction.sql) {
    where.push(teacherRestriction.sql);
    params.push(...teacherRestriction.params);
  }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const [languages, modalities, terms, teachers] = await Promise.all([
    all(
      `SELECT DISTINCT coalesce(ap.language, c.language, '') AS value
         FROM enrollments e
         LEFT JOIN academic_programs ap ON ap.id = e.academic_program_id
         LEFT JOIN classes c ON c.id = e.class_id
         ${whereSql}
        ORDER BY value ASC`,
      params
    ),
    all(
      `SELECT DISTINCT coalesce(ap.modality, c.modality, '') AS value
         FROM enrollments e
         LEFT JOIN academic_programs ap ON ap.id = e.academic_program_id
         LEFT JOIN classes c ON c.id = e.class_id
         ${whereSql}
        ORDER BY value ASC`,
      params
    ),
    all(
      `SELECT DISTINCT coalesce(st.code, st.name, '') AS value
         FROM enrollments e
         LEFT JOIN school_terms st ON st.id = e.school_term_id
         ${whereSql}
        ORDER BY value ASC`,
      params
    ),
    all(
      `SELECT DISTINCT coalesce(tp.display_name, u.name, '') AS value
         FROM class_teachers ct
         LEFT JOIN teacher_profiles tp ON tp.user_id = ct.user_id
         LEFT JOIN users u ON u.id = ct.user_id
        WHERE ${scope.canViewAll ? "1=1" : `ct.user_id=? AND ${buildDbTruthySql("is_active", "ct")}`}
        ORDER BY value ASC`,
      scope.canViewAll ? [] : [scope.teacherUserId]
    ),
  ]);
  return {
    languages: languages.map((row) => row.value).filter(Boolean),
    modalities: modalities.map((row) => row.value).filter(Boolean),
    terms: terms.map((row) => row.value).filter(Boolean),
    teachers: teachers.map((row) => row.value).filter(Boolean),
    student_statuses: ACADEMIC_STUDENT_STATUS_OPTIONS.slice(),
    enrollment_statuses: ACADEMIC_ENROLLMENT_STATUS_OPTIONS.slice(),
    class_statuses: ACADEMIC_CLASS_STATUS_OPTIONS.slice(),
    attendance_statuses: ACADEMIC_ATTENDANCE_STATUS_OPTIONS.slice(),
  };
}

async function listAcademicStudents(scope, filters = {}) {
  const where = [];
  const params = [];
  if (!scope.canViewAll) {
    where.push(`EXISTS (
      SELECT 1
        FROM enrollments e
        JOIN class_teachers ct ON ct.class_id = e.class_id
       WHERE e.student_id = s.id
         AND ct.user_id=?
         AND ${buildDbTruthySql("is_active", "ct")}
    )`);
    params.push(scope.teacherUserId);
  }
  if (filters.search) {
    const like = buildAcademicSearchLike(filters.search);
    where.push("(lower(coalesce(s.full_name, '')) LIKE lower(?) OR lower(coalesce(s.preferred_name, '')) LIKE lower(?) OR lower(coalesce(s.phone, '')) LIKE lower(?) OR lower(coalesce(s.whatsapp, '')) LIKE lower(?))");
    params.push(like, like, like, like);
  }
  if (filters.status) {
    where.push("lower(coalesce(s.status, ''))=lower(?)");
    params.push(String(filters.status).trim());
  }
  if (filters.language) {
    where.push(`EXISTS (
      SELECT 1
        FROM enrollments e
        LEFT JOIN academic_programs ap ON ap.id = e.academic_program_id
       WHERE e.student_id = s.id
         AND lower(coalesce(ap.language, ''))=lower(?)
    )`);
    params.push(String(filters.language).trim());
  }
  if (filters.modality) {
    where.push(`EXISTS (
      SELECT 1
        FROM enrollments e
        LEFT JOIN academic_programs ap ON ap.id = e.academic_program_id
       WHERE e.student_id = s.id
         AND lower(coalesce(ap.modality, ''))=lower(?)
    )`);
    params.push(String(filters.modality).trim());
  }
  if (filters.termCode) {
    where.push(`EXISTS (
      SELECT 1
        FROM enrollments e
        LEFT JOIN school_terms st ON st.id = e.school_term_id
       WHERE e.student_id = s.id
         AND lower(coalesce(st.code, ''))=lower(?)
    )`);
    params.push(String(filters.termCode).trim());
  }
  const limit = Math.min(180, Math.max(1, Number(filters.limit || 80)));
  params.push(limit);
  const rows = await all(
    `SELECT s.*,
            (SELECT COUNT(*) FROM enrollments e WHERE e.student_id=s.id) AS enrollments_total,
            (SELECT enrollment_status FROM enrollments e WHERE e.student_id=s.id ORDER BY datetime(updated_at) DESC, id DESC LIMIT 1) AS latest_enrollment_status,
            (SELECT c.name
               FROM enrollments e
               LEFT JOIN classes c ON c.id = e.class_id
              WHERE e.student_id=s.id
              ORDER BY datetime(e.updated_at) DESC, e.id DESC
              LIMIT 1) AS latest_class_name,
            (SELECT coalesce(ap.language, '')
               FROM enrollments e
               LEFT JOIN academic_programs ap ON ap.id = e.academic_program_id
              WHERE e.student_id=s.id
              ORDER BY datetime(e.updated_at) DESC, e.id DESC
              LIMIT 1) AS latest_language
       FROM students s
       ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY datetime(s.updated_at) DESC, lower(s.full_name) ASC
      LIMIT ?`,
    params
  );
  return rows.map(mapAcademicStudentRow);
}

async function getAcademicStudentDetail(studentId, scope) {
  const safeStudentId = Number(studentId || 0) || 0;
  if (!safeStudentId) return null;
  const params = [];
  const where = ["s.id=?"];
  if (!scope.canViewAll) {
    where.push(`EXISTS (
      SELECT 1
        FROM enrollments e
        JOIN class_teachers ct ON ct.class_id = e.class_id
       WHERE e.student_id = s.id
         AND ct.user_id=?
         AND ${buildDbTruthySql("is_active", "ct")}
    )`);
    params.push(scope.teacherUserId);
  }
  params.push(safeStudentId);
  const studentRow = await get(
    `SELECT s.*,
            (SELECT COUNT(*) FROM enrollments e WHERE e.student_id=s.id) AS enrollments_total,
            (SELECT enrollment_status FROM enrollments e WHERE e.student_id=s.id ORDER BY datetime(updated_at) DESC, id DESC LIMIT 1) AS latest_enrollment_status,
            (SELECT c.name
               FROM enrollments e
               LEFT JOIN classes c ON c.id = e.class_id
              WHERE e.student_id=s.id
              ORDER BY datetime(e.updated_at) DESC, e.id DESC
              LIMIT 1) AS latest_class_name,
            (SELECT coalesce(ap.language, '')
               FROM enrollments e
               LEFT JOIN academic_programs ap ON ap.id = e.academic_program_id
              WHERE e.student_id=s.id
              ORDER BY datetime(e.updated_at) DESC, e.id DESC
              LIMIT 1) AS latest_language
       FROM students s
      WHERE ${where.join(" AND ")}
      LIMIT 1`,
    params
  );
  const student = studentRow ? mapAcademicStudentRow(studentRow) : null;
  if (!student) return null;
  const [guardians, enrollments, attendanceSummary] = await Promise.all([
    all(
      "SELECT id, student_id, name, relation_type, cpf, phone, whatsapp, email, financial_responsible, pedagogical_responsible, receives_notifications, notes, created_at, updated_at FROM student_guardians WHERE student_id=? ORDER BY financial_responsible DESC, pedagogical_responsible DESC, lower(name) ASC",
      [studentId]
    ),
    all(
      `SELECT e.*, ap.program_name, ap.level_name, ap.language, ap.modality, st.name AS school_term_name, st.code AS school_term_code,
              c.name AS class_name, c.status AS class_status
         FROM enrollments e
         LEFT JOIN academic_programs ap ON ap.id = e.academic_program_id
         LEFT JOIN school_terms st ON st.id = e.school_term_id
         LEFT JOIN classes c ON c.id = e.class_id
        WHERE e.student_id=?
        ORDER BY datetime(e.updated_at) DESC, e.id DESC`,
      [studentId]
    ),
    get(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN lower(coalesce(attendance_status, ''))='presente' THEN 1 ELSE 0 END) AS present_total,
              SUM(CASE WHEN lower(coalesce(attendance_status, ''))='falta' THEN 1 ELSE 0 END) AS absent_total
         FROM attendance_records ar
         JOIN enrollments e ON e.id = ar.enrollment_id
        WHERE e.student_id=?`,
      [studentId]
    ),
  ]);
  return {
    student,
    guardians: guardians.map((row) => ({
      ...row,
      financial_responsible: coerceDbBoolean(row.financial_responsible),
      pedagogical_responsible: coerceDbBoolean(row.pedagogical_responsible),
      receives_notifications: coerceDbBoolean(row.receives_notifications),
    })),
    enrollments: enrollments.map(mapAcademicEnrollmentRow),
    attendance_summary: {
      total: Number(attendanceSummary?.total || 0),
      present_total: Number(attendanceSummary?.present_total || 0),
      absent_total: Number(attendanceSummary?.absent_total || 0),
    },
  };
}

async function listAcademicEnrollments(scope, filters = {}) {
  const where = [];
  const params = [];
  if (!scope.canViewAll) {
    where.push(`EXISTS (
      SELECT 1
        FROM class_teachers ct
       WHERE ct.class_id=e.class_id
         AND ct.user_id=?
         AND ${buildDbTruthySql("is_active", "ct")}
    )`);
    params.push(scope.teacherUserId);
  }
  if (filters.search) {
    const like = buildAcademicSearchLike(filters.search);
    where.push("(lower(coalesce(s.full_name, '')) LIKE lower(?) OR lower(coalesce(c.name, '')) LIKE lower(?) OR lower(coalesce(ap.language, '')) LIKE lower(?))");
    params.push(like, like, like);
  }
  if (filters.status) {
    where.push("lower(coalesce(e.enrollment_status, ''))=lower(?)");
    params.push(String(filters.status).trim());
  }
  if (filters.classId) {
    where.push("e.class_id=?");
    params.push(Number(filters.classId));
  }
  if (filters.termCode) {
    where.push("lower(coalesce(st.code, ''))=lower(?)");
    params.push(String(filters.termCode).trim());
  }
  if (filters.language) {
    where.push("lower(coalesce(ap.language, ''))=lower(?)");
    params.push(String(filters.language).trim());
  }
  if (filters.modality) {
    where.push("lower(coalesce(ap.modality, ''))=lower(?)");
    params.push(String(filters.modality).trim());
  }
  if (filters.teacherName) {
    where.push(`EXISTS (
      SELECT 1
        FROM class_teachers ct
        LEFT JOIN teacher_profiles tp ON tp.user_id = ct.user_id
        LEFT JOIN users tu ON tu.id = ct.user_id
       WHERE ct.class_id=e.class_id
         AND lower(coalesce(tp.display_name, tu.name, ''))=lower(?)
         AND ${buildDbTruthySql("is_active", "ct")}
    )`);
    params.push(String(filters.teacherName).trim());
  }
  const limit = Math.min(240, Math.max(1, Number(filters.limit || 120)));
  params.push(limit);
  const rows = await all(
    `SELECT e.*, s.full_name AS student_name, s.phone AS student_phone, s.whatsapp AS student_whatsapp, s.status AS student_status,
            ap.program_name, ap.level_name, ap.language, ap.modality, st.name AS school_term_name, st.code AS school_term_code,
            c.name AS class_name, c.status AS class_status,
            (SELECT COUNT(*) FROM attendance_records ar WHERE ar.enrollment_id=e.id) AS attendance_total
       FROM enrollments e
       JOIN students s ON s.id = e.student_id
       LEFT JOIN academic_programs ap ON ap.id = e.academic_program_id
       LEFT JOIN school_terms st ON st.id = e.school_term_id
       LEFT JOIN classes c ON c.id = e.class_id
       ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY datetime(e.updated_at) DESC, e.id DESC
      LIMIT ?`,
    params
  );
  return rows.map(mapAcademicEnrollmentRow);
}

async function getAcademicEnrollmentDetail(enrollmentId, scope) {
  const rows = await listAcademicEnrollments(scope, { limit: 400 });
  const enrollment = rows.find((item) => Number(item.id) === Number(enrollmentId));
  if (!enrollment) return null;
  const [classHistory, scheduleHistory, transferHistory] = await Promise.all([
    all(
      `SELECT h.*, oc.name AS old_class_name, nc.name AS new_class_name, u.name AS changed_by_name
         FROM enrollment_class_history h
         LEFT JOIN classes oc ON oc.id = h.old_class_id
         LEFT JOIN classes nc ON nc.id = h.new_class_id
         LEFT JOIN users u ON u.id = h.changed_by_user_id
        WHERE h.enrollment_id=?
        ORDER BY datetime(h.changed_at) DESC, h.id DESC`,
      [enrollmentId]
    ),
    all(
      `SELECT h.*, oc.name AS old_class_name, nc.name AS new_class_name, u.name AS changed_by_name
         FROM enrollment_schedule_history h
         LEFT JOIN classes oc ON oc.id = h.old_class_id
         LEFT JOIN classes nc ON nc.id = h.new_class_id
         LEFT JOIN users u ON u.id = h.changed_by_user_id
        WHERE h.enrollment_id=?
        ORDER BY datetime(h.changed_at) DESC, h.id DESC`,
      [enrollmentId]
    ),
    all(
      `SELECT st.*, u.name AS changed_by_name
         FROM student_transfers st
         LEFT JOIN users u ON u.id = st.changed_by_user_id
        WHERE st.enrollment_id=?
        ORDER BY datetime(st.changed_at) DESC, st.id DESC`,
      [enrollmentId]
    ),
  ]);
  return {
    enrollment,
    class_history: classHistory.map((row) => ({
      ...row,
      old_schedule_snapshot: safeJsonParse(row.old_schedule_snapshot_json || "null"),
      new_schedule_snapshot: safeJsonParse(row.new_schedule_snapshot_json || "null"),
    })),
    schedule_history: scheduleHistory.map((row) => ({
      ...row,
      old_schedule_snapshot: safeJsonParse(row.old_schedule_snapshot_json || "null"),
      new_schedule_snapshot: safeJsonParse(row.new_schedule_snapshot_json || "null"),
    })),
    transfer_history: transferHistory.map((row) => ({
      ...row,
      old_value: safeJsonParse(row.old_value_json || "null"),
      new_value: safeJsonParse(row.new_value_json || "null"),
    })),
  };
}

async function listAcademicClasses(scope, filters = {}) {
  const where = [];
  const params = [];
  if (!scope.canViewAll) {
    where.push(`EXISTS (
      SELECT 1
        FROM class_teachers ct
       WHERE ct.class_id = c.id
         AND ct.user_id=?
         AND ${buildDbTruthySql("is_active", "ct")}
    )`);
    params.push(scope.teacherUserId);
  }
  if (filters.search) {
    const like = buildAcademicSearchLike(filters.search);
    where.push("(lower(coalesce(c.name, '')) LIKE lower(?) OR lower(coalesce(c.language, '')) LIKE lower(?) OR lower(coalesce(c.level_name, '')) LIKE lower(?) OR lower(coalesce(c.modality, '')) LIKE lower(?))");
    params.push(like, like, like, like);
  }
  if (filters.status) {
    where.push("lower(coalesce(c.status, ''))=lower(?)");
    params.push(String(filters.status).trim());
  }
  if (filters.language) {
    where.push("lower(coalesce(c.language, ''))=lower(?)");
    params.push(String(filters.language).trim());
  }
  if (filters.modality) {
    where.push("lower(coalesce(c.modality, ''))=lower(?)");
    params.push(String(filters.modality).trim());
  }
  if (filters.termCode) {
    where.push("lower(coalesce(st.code, ''))=lower(?)");
    params.push(String(filters.termCode).trim());
  }
  if (filters.teacherName) {
    where.push(`EXISTS (
      SELECT 1
        FROM class_teachers ct
        LEFT JOIN teacher_profiles tp ON tp.user_id = ct.user_id
        LEFT JOIN users tu ON tu.id = ct.user_id
       WHERE ct.class_id=c.id
         AND lower(coalesce(tp.display_name, tu.name, ''))=lower(?)
         AND ${buildDbTruthySql("is_active", "ct")}
    )`);
    params.push(String(filters.teacherName).trim());
  }
  const limit = Math.min(160, Math.max(1, Number(filters.limit || 80)));
  params.push(limit);
  const rows = await all(
    `SELECT c.*, st.name AS school_term_name, st.code AS school_term_code, ap.program_name,
            (SELECT COUNT(*) FROM enrollments e WHERE e.class_id=c.id AND lower(coalesce(e.enrollment_status, '')) NOT IN ('cancelado', 'desistente')) AS enrolled_total
       FROM classes c
       LEFT JOIN school_terms st ON st.id = c.school_term_id
       LEFT JOIN academic_programs ap ON ap.id = c.academic_program_id
       ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY datetime(c.updated_at) DESC, lower(c.name) ASC
      LIMIT ?`,
    params
  );
  return Promise.all(rows.map(async (row) => ({
    ...mapAcademicClassRow(row),
    schedules: await listClassSchedulesByClassId(row.id),
    teachers: await listClassTeachersByClassId(row.id),
  })));
}

async function getAcademicClassDetail(classId, scope) {
  if (!(await canAccessAcademicClass(scope, classId))) return null;
  const classRow = await getClassBasicById(classId);
  if (!classRow) return null;
  const [schedules, teachers, students, sessions, attendanceSummary] = await Promise.all([
    listClassSchedulesByClassId(classId),
    listClassTeachersByClassId(classId),
    all(
      `SELECT e.id AS enrollment_id, e.enrollment_status, s.id AS student_id, s.full_name, s.preferred_name, s.phone, s.whatsapp, s.status AS student_status,
              ap.language, ap.modality, ap.level_name
         FROM enrollments e
         JOIN students s ON s.id = e.student_id
         LEFT JOIN academic_programs ap ON ap.id = e.academic_program_id
        WHERE e.class_id=?
        ORDER BY lower(s.full_name) ASC`,
      [classId]
    ),
    all(
      "SELECT id, class_id, class_schedule_id, class_date, start_time, end_time, session_status, notes, created_at, updated_at FROM class_sessions WHERE class_id=? ORDER BY class_date DESC, id DESC LIMIT 60",
      [classId]
    ),
    get(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN lower(coalesce(attendance_status, ''))='presente' THEN 1 ELSE 0 END) AS present_total,
              SUM(CASE WHEN lower(coalesce(attendance_status, ''))='falta' THEN 1 ELSE 0 END) AS absent_total
         FROM attendance_records
        WHERE class_id=?`,
      [classId]
    ),
  ]);
  return {
    class: classRow,
    schedules,
    teachers,
    students,
    sessions,
    attendance_summary: {
      total: Number(attendanceSummary?.total || 0),
      present_total: Number(attendanceSummary?.present_total || 0),
      absent_total: Number(attendanceSummary?.absent_total || 0),
    },
  };
}

async function buildAcademicDashboard(scope) {
  const teacherRestriction = buildAcademicScopeExistsSql(scope, "e");
  const baseWhere = [];
  const baseParams = [];
  if (teacherRestriction.sql) {
    baseWhere.push(teacherRestriction.sql);
    baseParams.push(...teacherRestriction.params);
  }
  const whereSql = baseWhere.length ? `WHERE ${baseWhere.join(" AND ")}` : "";
  const classMovementsSql = scope.canViewAll
    ? "SELECT COUNT(*) AS total FROM enrollment_class_history h"
    : `SELECT COUNT(*) AS total
         FROM enrollment_class_history h
        WHERE EXISTS (
          SELECT 1
            FROM enrollments e
            JOIN class_teachers ct ON ct.class_id=e.class_id
           WHERE e.id=h.enrollment_id
             AND ct.user_id=?
             AND ${buildDbTruthySql("is_active", "ct")}
        )`;
  const scheduleMovementsSql = scope.canViewAll
    ? "SELECT COUNT(*) AS total FROM enrollment_schedule_history h"
    : `SELECT COUNT(*) AS total
         FROM enrollment_schedule_history h
        WHERE EXISTS (
          SELECT 1
            FROM enrollments e
            JOIN class_teachers ct ON ct.class_id=e.class_id
           WHERE e.id=h.enrollment_id
             AND ct.user_id=?
           AND ${buildDbTruthySql("is_active", "ct")}
        )`;
  const transferMovementsSql = scope.canViewAll
    ? "SELECT COUNT(*) AS total FROM student_transfers st"
    : `SELECT COUNT(*) AS total
         FROM student_transfers st
        WHERE EXISTS (
          SELECT 1
            FROM enrollments e
            JOIN class_teachers ct ON ct.class_id=e.class_id
           WHERE e.id=st.enrollment_id
             AND ct.user_id=?
             AND ${buildDbTruthySql("is_active", "ct")}
        )`;
  const todaySessionsWhereSql = scope.canViewAll
    ? "WHERE cs.class_date=?"
    : `WHERE EXISTS (
         SELECT 1 FROM class_teachers ct
          WHERE ct.class_id=cs.class_id
            AND ct.user_id=?
            AND ${buildDbTruthySql("is_active", "ct")}
       ) AND cs.class_date=?`;
  const [studentsRow, enrollmentsRow, classesRow, classMovementsRow, scheduleMovementsRow, transferMovementsRow, todaySessionsRow, importRunsRow] = await Promise.all([
    get(
      `SELECT COUNT(DISTINCT s.id) AS total
         FROM students s
         ${scope.canViewAll ? "" : `WHERE EXISTS (
            SELECT 1
              FROM enrollments e
              JOIN class_teachers ct ON ct.class_id=e.class_id
             WHERE e.student_id=s.id
               AND ct.user_id=?
               AND ${buildDbTruthySql("is_active", "ct")}
          )`}`,
      scope.canViewAll ? [] : [scope.teacherUserId]
    ),
    get(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN lower(coalesce(enrollment_status, ''))='matriculado' THEN 1 ELSE 0 END) AS active_total,
              SUM(CASE WHEN lower(coalesce(enrollment_status, ''))='aguardando turma' THEN 1 ELSE 0 END) AS waiting_total,
              SUM(CASE WHEN lower(coalesce(enrollment_status, ''))='trancado' THEN 1 ELSE 0 END) AS trancado_total,
              SUM(CASE WHEN lower(coalesce(enrollment_status, '')) IN ('desistente', 'cancelado') THEN 1 ELSE 0 END) AS inactive_total
         FROM enrollments e
         ${whereSql}`,
      baseParams
    ),
    get(
      `SELECT COUNT(DISTINCT c.id) AS total,
              SUM(CASE WHEN lower(coalesce(c.status, ''))='ativa' THEN 1 ELSE 0 END) AS active_total,
              SUM(CASE WHEN lower(coalesce(c.class_kind, ''))='vip' THEN 1 ELSE 0 END) AS vip_total,
              SUM(CASE WHEN lower(coalesce(c.class_kind, ''))='semi_vip' THEN 1 ELSE 0 END) AS semi_vip_total,
              SUM(CASE WHEN lower(coalesce(c.class_kind, ''))='intensive' THEN 1 ELSE 0 END) AS intensive_total
         FROM classes c
         ${scope.canViewAll ? "" : `WHERE EXISTS (
            SELECT 1 FROM class_teachers ct
             WHERE ct.class_id=c.id
               AND ct.user_id=?
               AND ${buildDbTruthySql("is_active", "ct")}
          )`}`,
      scope.canViewAll ? [] : [scope.teacherUserId]
    ),
    get(classMovementsSql, scope.canViewAll ? [] : [scope.teacherUserId]),
    get(scheduleMovementsSql, scope.canViewAll ? [] : [scope.teacherUserId]),
    get(transferMovementsSql, scope.canViewAll ? [] : [scope.teacherUserId]),
    get(
      `SELECT COUNT(*) AS total
         FROM class_sessions cs
         ${todaySessionsWhereSql}`,
      scope.canViewAll ? [brazilDateKey()] : [scope.teacherUserId, brazilDateKey()]
    ),
    scope.canImport
      ? get("SELECT COUNT(*) AS total FROM academic_import_runs WHERE datetime(created_at) >= datetime('now', '-30 day')")
      : Promise.resolve({ total: 0 }),
  ]);

  let byTeacher = [];
  if (scope.canViewAll) {
    byTeacher = await all(
      `SELECT coalesce(tp.display_name, u.name, 'Sem professor') AS teacher_name,
              COUNT(DISTINCT ct.class_id) AS classes_total,
              COUNT(DISTINCT e.student_id) AS students_total
         FROM class_teachers ct
         LEFT JOIN users u ON u.id = ct.user_id
         LEFT JOIN teacher_profiles tp ON tp.user_id = ct.user_id
         LEFT JOIN enrollments e ON e.class_id = ct.class_id
        WHERE ${buildDbTruthySql("is_active", "ct")}
        GROUP BY coalesce(tp.display_name, u.name, 'Sem professor')
        ORDER BY classes_total DESC, teacher_name ASC`
    );
  }

  return {
    scope_kind: scope.kind,
    total_students: Number(studentsRow?.total || 0),
    total_enrollments: Number(enrollmentsRow?.total || 0),
    active_enrollments: Number(enrollmentsRow?.active_total || 0),
    waiting_for_class: Number(enrollmentsRow?.waiting_total || 0),
    trancados: Number(enrollmentsRow?.trancado_total || 0),
    inactive_total: Number(enrollmentsRow?.inactive_total || 0),
    total_classes: Number(classesRow?.total || 0),
    active_classes: Number(classesRow?.active_total || 0),
    vip_classes: Number(classesRow?.vip_total || 0) + Number(classesRow?.semi_vip_total || 0),
    intensive_classes: Number(classesRow?.intensive_total || 0),
    recent_movements: Number(classMovementsRow?.total || 0) + Number(scheduleMovementsRow?.total || 0) + Number(transferMovementsRow?.total || 0),
    classes_today: Number(todaySessionsRow?.total || 0),
    recent_imports: Number(importRunsRow?.total || 0),
    by_teacher: byTeacher.map((row) => ({
      teacher_name: row.teacher_name,
      classes_total: Number(row.classes_total || 0),
      students_total: Number(row.students_total || 0),
    })),
  };
}

async function listAcademicTeacherProfiles(scope) {
  if (!scope.canViewAll) {
    const ownProfile = await getTeacherProfileByUserId(scope.teacherUserId).catch(() => null);
    return ownProfile ? [ownProfile] : [];
  }
  const rows = await all(
    `SELECT tp.id, tp.user_id, tp.display_name, tp.normalized_name, tp.aliases_json, tp.specialties_json, tp.metadata_json, tp.active, tp.created_at, tp.updated_at,
            u.name AS user_name, u.email AS user_email
       FROM teacher_profiles tp
       LEFT JOIN users u ON u.id = tp.user_id
      WHERE ${buildDbTruthySql("active", "tp")}
      ORDER BY lower(coalesce(tp.display_name, u.name, '')) ASC, tp.id ASC`,
    []
  );
  return rows.map((row) => ({
    ...mapTeacherProfileRow(row),
    user_name: row.user_name || row.display_name || "",
    user_email: row.user_email || "",
  }));
}

async function listAcademicProgramCatalog() {
  return all(
    `SELECT id, language, program_name, level_name, stage_name, semester_label, modality, material_name, workload_hours, status, created_at, updated_at
       FROM academic_programs
      WHERE lower(coalesce(status, 'active')) <> 'inactive'
      ORDER BY lower(coalesce(language, '')) ASC, lower(coalesce(program_name, '')) ASC, id ASC`
  );
}

async function listSchoolTermCatalog() {
  return all(
    `SELECT id, name, code, start_date, end_date, status, created_at, updated_at
       FROM school_terms
      WHERE lower(coalesce(status, 'active')) <> 'inactive'
      ORDER BY lower(coalesce(code, name, '')) DESC, id DESC`
  );
}

async function buildAcademicBootstrap(user, query = {}) {
  const scope = await resolveAcademicScope(user);
  const classMovementsSql = scope.canViewAll
    ? `SELECT 'class' AS movement_type, h.id, h.enrollment_id, h.old_class_id, h.new_class_id, h.reason, h.changed_at, h.notes, u.name AS changed_by_name, s.full_name AS student_name
         FROM enrollment_class_history h
         LEFT JOIN enrollments e ON e.id = h.enrollment_id
         LEFT JOIN students s ON s.id = e.student_id
         LEFT JOIN users u ON u.id = h.changed_by_user_id
        ORDER BY datetime(h.changed_at) DESC, h.id DESC
        LIMIT 20`
    : `SELECT 'class' AS movement_type, h.id, h.enrollment_id, h.old_class_id, h.new_class_id, h.reason, h.changed_at, h.notes, u.name AS changed_by_name, s.full_name AS student_name
         FROM enrollment_class_history h
         LEFT JOIN enrollments e ON e.id = h.enrollment_id
         LEFT JOIN students s ON s.id = e.student_id
         LEFT JOIN users u ON u.id = h.changed_by_user_id
        WHERE EXISTS (
          SELECT 1
            FROM enrollments e_scope
            JOIN class_teachers ct ON ct.class_id=e_scope.class_id
           WHERE e_scope.id=h.enrollment_id
             AND ct.user_id=?
             AND ${buildDbTruthySql("is_active", "ct")}
        )
        ORDER BY datetime(h.changed_at) DESC, h.id DESC
        LIMIT 20`;
  const scheduleMovementsSql = scope.canViewAll
    ? `SELECT 'schedule' AS movement_type, h.id, h.enrollment_id, h.old_class_id, h.new_class_id, h.reason, h.changed_at, h.notes, u.name AS changed_by_name, s.full_name AS student_name
         FROM enrollment_schedule_history h
         LEFT JOIN enrollments e ON e.id = h.enrollment_id
         LEFT JOIN students s ON s.id = e.student_id
         LEFT JOIN users u ON u.id = h.changed_by_user_id
        ORDER BY datetime(h.changed_at) DESC, h.id DESC
        LIMIT 20`
    : `SELECT 'schedule' AS movement_type, h.id, h.enrollment_id, h.old_class_id, h.new_class_id, h.reason, h.changed_at, h.notes, u.name AS changed_by_name, s.full_name AS student_name
         FROM enrollment_schedule_history h
         LEFT JOIN enrollments e ON e.id = h.enrollment_id
         LEFT JOIN students s ON s.id = e.student_id
         LEFT JOIN users u ON u.id = h.changed_by_user_id
        WHERE EXISTS (
          SELECT 1
            FROM enrollments e_scope
            JOIN class_teachers ct ON ct.class_id=e_scope.class_id
           WHERE e_scope.id=h.enrollment_id
             AND ct.user_id=?
             AND ${buildDbTruthySql("is_active", "ct")}
        )
        ORDER BY datetime(h.changed_at) DESC, h.id DESC
        LIMIT 20`;
  const transferMovementsSql = scope.canViewAll
    ? `SELECT st.transfer_type AS movement_type, st.id, st.enrollment_id, NULL AS old_class_id, NULL AS new_class_id, st.reason, st.changed_at, st.notes, u.name AS changed_by_name, s.full_name AS student_name
         FROM student_transfers st
         LEFT JOIN enrollments e ON e.id = st.enrollment_id
         LEFT JOIN students s ON s.id = e.student_id
         LEFT JOIN users u ON u.id = st.changed_by_user_id
        ORDER BY datetime(st.changed_at) DESC, st.id DESC
        LIMIT 20`
    : `SELECT st.transfer_type AS movement_type, st.id, st.enrollment_id, NULL AS old_class_id, NULL AS new_class_id, st.reason, st.changed_at, st.notes, u.name AS changed_by_name, s.full_name AS student_name
         FROM student_transfers st
         LEFT JOIN enrollments e ON e.id = st.enrollment_id
         LEFT JOIN students s ON s.id = e.student_id
         LEFT JOIN users u ON u.id = st.changed_by_user_id
        WHERE EXISTS (
          SELECT 1
            FROM enrollments e_scope
            JOIN class_teachers ct ON ct.class_id=e_scope.class_id
           WHERE e_scope.id=st.enrollment_id
             AND ct.user_id=?
             AND ${buildDbTruthySql("is_active", "ct")}
        )
        ORDER BY datetime(st.changed_at) DESC, st.id DESC
        LIMIT 20`;
  const [dashboard, students, enrollments, classes, filters, classMovements, scheduleMovements, transferMovements, teacherProfiles, programs, schoolTerms, importRuns] = await Promise.all([
    buildAcademicDashboard(scope),
    listAcademicStudents(scope, { search: query.search, status: query.student_status, language: query.language, modality: query.modality, termCode: query.term_code, limit: 30 }),
    listAcademicEnrollments(scope, { search: query.search, status: query.enrollment_status, language: query.language, modality: query.modality, teacherName: query.teacher, termCode: query.term_code, limit: 30 }),
    listAcademicClasses(scope, { search: query.search, status: query.class_status, language: query.language, modality: query.modality, teacherName: query.teacher, termCode: query.term_code, limit: 24 }),
    listAcademicFilterOptions(scope),
    all(classMovementsSql, scope.canViewAll ? [] : [scope.teacherUserId]),
    all(scheduleMovementsSql, scope.canViewAll ? [] : [scope.teacherUserId]),
    all(transferMovementsSql, scope.canViewAll ? [] : [scope.teacherUserId]),
    listAcademicTeacherProfiles(scope),
    listAcademicProgramCatalog(),
    listSchoolTermCatalog(),
    scope.canImport
      ? all(
          `SELECT id, source_key, status, workbook_names_json, imported_sheets_json, ignored_sheets_json, summary_json, actor_user_id, created_at, updated_at
             FROM academic_import_runs
            ORDER BY datetime(created_at) DESC, id DESC
            LIMIT 8`
        )
      : Promise.resolve([]),
  ]);
  const movements = [...(classMovements || []), ...(scheduleMovements || []), ...(transferMovements || [])]
    .sort((left, right) => String(right?.changed_at || "").localeCompare(String(left?.changed_at || "")))
    .slice(0, 30);
  return {
    enabled: true,
    scope_kind: scope.kind,
    can_manage: scope.canManageAll,
    can_import: scope.canImport,
    teacher_profile: scope.teacherProfile,
    teacher_profiles: teacherProfiles,
    dashboard,
    filters,
    programs,
    school_terms: schoolTerms,
    students,
    enrollments,
    classes,
    movements,
    recent_import_runs: (importRuns || []).map((row) => ({
      ...row,
      workbook_names: Array.isArray(safeJsonParse(row.workbook_names_json || "[]")) ? safeJsonParse(row.workbook_names_json || "[]") : [],
      imported_sheets: Array.isArray(safeJsonParse(row.imported_sheets_json || "[]")) ? safeJsonParse(row.imported_sheets_json || "[]") : [],
      ignored_sheets: Array.isArray(safeJsonParse(row.ignored_sheets_json || "[]")) ? safeJsonParse(row.ignored_sheets_json || "[]") : [],
      summary: safeJsonParse(row.summary_json || "{}") || {},
    })),
    submenu_view_keys: {
      pedagogical: ACADEMIC_PEDAGOGICAL_SUBMENU_VIEW_KEYS.slice(),
      teacher: ACADEMIC_TEACHER_SUBMENU_VIEW_KEYS.slice(),
    },
  };
}

async function transferAcademicEnrollmentClass(enrollmentId, payload = {}, actorUser) {
  const scope = await resolveAcademicScope(actorUser);
  if (!scope.canManageAll) throw new Error("forbidden");
  const enrollment = await get("SELECT * FROM enrollments WHERE id=? LIMIT 1", [enrollmentId]);
  if (!enrollment) throw new Error("enrollment_not_found");
  const newClassId = Number(payload.new_class_id || 0) || null;
  if (!newClassId) throw new Error("missing_new_class_id");
  const reason = sanitizeAcademicTextValue(payload.reason, { maxLength: 800 }) || "Troca de turma";
  const notes = sanitizeAcademicTextValue(payload.notes, { maxLength: 2000 }) || null;
  const [oldClass, newClass] = await Promise.all([
    enrollment.class_id ? getClassBasicById(enrollment.class_id).catch(() => null) : null,
    newClassId ? getClassBasicById(newClassId).catch(() => null) : null,
  ]);
  await run(
    "UPDATE enrollments SET class_id=?, enrollment_status=?, updated_at=datetime('now') WHERE id=?",
    [newClassId, normalizeEnrollmentStatus(payload.enrollment_status || "transferido"), enrollmentId]
  );
  await run(
    `INSERT INTO enrollment_class_history
       (enrollment_id, old_class_id, new_class_id, reason, changed_by_user_id, changed_at, notes)
     VALUES (?, ?, ?, ?, ?, datetime('now'), ?)`,
    [enrollmentId, enrollment.class_id || null, newClassId, reason, actorUser.id || actorUser.sub, notes]
  );
  await recordAcademicTransferEvent({
    enrollment_id: enrollmentId,
    transfer_type: "class_transfer",
    old_value: {
      class_id: enrollment.class_id || null,
      class_name: oldClass?.name || null,
    },
    new_value: {
      class_id: newClassId,
      class_name: newClass?.name || null,
    },
    reason,
    changed_by_user_id: actorUser.id || actorUser.sub,
    notes,
  });
  await logEntityChange({
    entityType: "academic_enrollment",
    entityId: enrollmentId,
    action: "class_transfer",
    actorUserId: actorUser.id || actorUser.sub,
    origin: "manual_edit",
    detail: { old_class_id: enrollment.class_id || null, new_class_id: newClassId, reason },
  });
  return getAcademicEnrollmentDetail(enrollmentId, scope);
}

async function changeAcademicEnrollmentSchedule(enrollmentId, payload = {}, actorUser) {
  const scope = await resolveAcademicScope(actorUser);
  if (!scope.canManageAll) throw new Error("forbidden");
  const enrollment = await get("SELECT * FROM enrollments WHERE id=? LIMIT 1", [enrollmentId]);
  if (!enrollment) throw new Error("enrollment_not_found");
  const newClassId = Number(payload.new_class_id || enrollment.class_id || 0) || null;
  const oldSchedules = enrollment.class_id ? await listClassSchedulesByClassId(enrollment.class_id) : [];
  const newSchedules = newClassId ? await listClassSchedulesByClassId(newClassId) : [];
  if (newClassId && Number(newClassId) !== Number(enrollment.class_id || 0)) {
    await run(
      "UPDATE enrollments SET class_id=?, updated_at=datetime('now') WHERE id=?",
      [newClassId, enrollmentId]
    );
  }
  const reason = sanitizeAcademicTextValue(payload.reason, { maxLength: 800 }) || "Ajuste de horário";
  const notes = sanitizeAcademicTextValue(payload.notes, { maxLength: 2000 }) || null;
  await run(
    `INSERT INTO enrollment_schedule_history
       (enrollment_id, old_class_id, new_class_id, old_schedule_snapshot_json, new_schedule_snapshot_json, reason, changed_by_user_id, changed_at, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), ?)`,
    [
      enrollmentId,
      enrollment.class_id || null,
      newClassId,
      safeJsonStringify(oldSchedules, "[]"),
      safeJsonStringify(newSchedules, "[]"),
      reason,
      actorUser.id || actorUser.sub,
      notes,
    ]
  );
  await recordAcademicTransferEvent({
    enrollment_id: enrollmentId,
    transfer_type: "schedule_change",
    old_value: {
      class_id: enrollment.class_id || null,
      schedules: oldSchedules,
    },
    new_value: {
      class_id: newClassId,
      schedules: newSchedules,
    },
    reason,
    changed_by_user_id: actorUser.id || actorUser.sub,
    notes,
  });
  await logEntityChange({
    entityType: "academic_enrollment",
    entityId: enrollmentId,
    action: "schedule_change",
    actorUserId: actorUser.id || actorUser.sub,
    origin: "manual_edit",
    detail: { old_class_id: enrollment.class_id || null, new_class_id: newClassId, reason },
  });
  return getAcademicEnrollmentDetail(enrollmentId, scope);
}

async function saveAcademicClassSession(classId, payload = {}, actorUser) {
  const scope = await resolveAcademicScope(actorUser);
  if (!scope.canManageAll && !(await canAccessAcademicClass(scope, classId))) throw new Error("forbidden");
  const classDate = normalizeAcademicDateInput(payload.class_date);
  if (!classDate) throw new Error("missing_class_date");
  const classScheduleId = Number(payload.class_schedule_id || 0) || null;
  const existing = await get(
    "SELECT * FROM class_sessions WHERE class_id=? AND coalesce(class_schedule_id, 0)=coalesce(?, 0) AND class_date=? LIMIT 1",
    [classId, classScheduleId, classDate]
  );
  const persisted = {
    class_id: classId,
    class_schedule_id: classScheduleId,
    class_date: classDate,
    start_time: sanitizeAcademicTextValue(payload.start_time, { maxLength: 16 }) || null,
    end_time: sanitizeAcademicTextValue(payload.end_time, { maxLength: 16 }) || null,
    session_status: normalizeSessionStatus(payload.session_status || "planejada"),
    notes: sanitizeAcademicTextValue(payload.notes, { maxLength: 2000 }) || null,
  };
  if (existing?.id) {
    await run(
      "UPDATE class_sessions SET start_time=?, end_time=?, session_status=?, notes=?, updated_at=datetime('now') WHERE id=?",
      [persisted.start_time, persisted.end_time, persisted.session_status, persisted.notes, existing.id]
    );
    return get("SELECT * FROM class_sessions WHERE id=?", [existing.id]);
  }
  const created = await run(
    "INSERT INTO class_sessions (class_id, class_schedule_id, class_date, start_time, end_time, session_status, notes, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))",
    [persisted.class_id, persisted.class_schedule_id, persisted.class_date, persisted.start_time, persisted.end_time, persisted.session_status, persisted.notes]
  );
  return get("SELECT * FROM class_sessions WHERE id=?", [created.lastID]);
}

async function saveAcademicAttendance(classId, payload = {}, actorUser) {
  const scope = await resolveAcademicScope(actorUser);
  if (!scope.canManageAll && !(await canAccessAcademicClass(scope, classId))) throw new Error("forbidden");
  const classDate = normalizeAcademicDateInput(payload.class_date);
  if (!classDate) throw new Error("missing_class_date");
  const classScheduleId = Number(payload.class_schedule_id || 0) || null;
  const classRow = await get("SELECT id, name FROM classes WHERE id=? LIMIT 1", [classId]);
  await saveAcademicClassSession(classId, {
    class_schedule_id: classScheduleId,
    class_date: classDate,
    session_status: payload.session_status || "realizada",
    start_time: payload.start_time,
    end_time: payload.end_time,
    notes: payload.session_notes,
  }, actorUser);

  const items = Array.isArray(payload.items) ? payload.items : [];
  const allowedEnrollmentIds = new Set(
    (await all("SELECT id FROM enrollments WHERE class_id=?", [classId])).map((row) => Number(row.id || 0))
  );
  const savedItems = [];
  for (const item of items) {
    const enrollmentId = Number(item.enrollment_id || 0) || null;
    if (!enrollmentId || !allowedEnrollmentIds.has(enrollmentId)) continue;
    const attendanceStatus = normalizeAttendanceStatus(item.attendance_status || "presente");
    const notes = sanitizeAcademicTextValue(item.notes, { maxLength: 1200 }) || null;
    const existing = await get(
      "SELECT id FROM attendance_records WHERE enrollment_id=? AND class_id=? AND coalesce(class_schedule_id, 0)=coalesce(?, 0) AND class_date=? LIMIT 1",
      [enrollmentId, classId, classScheduleId, classDate]
    );
    if (existing?.id) {
      await run(
        "UPDATE attendance_records SET attendance_status=?, notes=?, recorded_by_user_id=?, updated_at=datetime('now') WHERE id=?",
        [attendanceStatus, notes, actorUser.id || actorUser.sub, existing.id]
      );
      savedItems.push(existing.id);
    } else {
      const created = await run(
        "INSERT INTO attendance_records (enrollment_id, class_id, class_schedule_id, class_date, attendance_status, notes, recorded_by_user_id, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))",
        [enrollmentId, classId, classScheduleId, classDate, attendanceStatus, notes, actorUser.id || actorUser.sub]
      );
      savedItems.push(created.lastID);
    }

    const studentRow = await get(
      `SELECT s.id, s.full_name
         FROM enrollments e
         JOIN students s ON s.id = e.student_id
        WHERE e.id=? LIMIT 1`,
      [enrollmentId]
    );
    if (studentRow?.id) {
      await ensureStudentTimelineEntry({
        student_id: studentRow.id,
        enrollment_id: enrollmentId,
        actor_user_id: actorUser.id || actorUser.sub,
        event_type: "attendance_recorded",
        title: "Frequencia registrada",
        description: `${attendanceStatus} em ${classDate}${classRow?.name ? ` na turma ${classRow.name}` : ""}.`,
        metadata: {
          class_id: classId,
          class_name: classRow?.name || null,
          class_date: classDate,
          class_schedule_id: classScheduleId,
          attendance_status: attendanceStatus,
        },
      });
    }
  }
  await logEvent(actorUser.id || actorUser.sub, "academic_attendance_saved", {
    class_id: classId,
    class_date: classDate,
    total_items: savedItems.length,
  });
  return all(
    `SELECT ar.*, s.full_name AS student_name
       FROM attendance_records ar
       JOIN enrollments e ON e.id = ar.enrollment_id
       JOIN students s ON s.id = e.student_id
      WHERE ar.class_id=? AND ar.class_date=?
      ORDER BY lower(s.full_name) ASC`,
    [classId, classDate]
  );
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
  const safeOriginalName = sanitizeFilename(originalName || "arquivo");
  const safeStoredName = sanitizeFilename(storedName || `upload-${Date.now()}`);
  const fileResult = await run(
    "INSERT INTO files (conversation_id, uploaded_by, original_name, stored_name, mime_type, size_bytes) VALUES (?, ?, ?, ?, ?, ?)",
    [conversationId, uploadedBy, safeOriginalName, safeStoredName, mimeType || null, sizeBytes || null]
  );

  const meta = {
    type: "file",
    file_id: fileResult.lastID,
    filename: safeOriginalName,
    mimetype: mimeType || "",
    size: sizeBytes || 0,
  };

  await run(
    "INSERT INTO messages (conversation_id, role, content, meta_json) VALUES (?, ?, ?, ?)",
    [conversationId, role, sanitizePersistedText(content || "", { trim: false, maxLength: 12000 }), safeJsonStringify(meta, "{}")]
  );

  await run("UPDATE conversations SET updated_at=datetime('now') WHERE id=?", [conversationId]);
  return { fileId: fileResult.lastID, meta };
}

async function getRecentConversationFiles(conversationId, limit = 8) {
  const rows = await all(
    `SELECT id, original_name, stored_name, mime_type, size_bytes, created_at
       FROM files
      WHERE conversation_id=?
      ORDER BY id DESC
      LIMIT ?`,
    [conversationId, limit]
  );

  return (rows || []).map((row) => ({
    ...row,
    fullPath: path.join(uploadsDir, row.stored_name),
  })).filter((row) => row.stored_name && fs.existsSync(row.fullPath));
}

function buildArtifactSessionFileRefs(files = []) {
  return (Array.isArray(files) ? files : [])
    .map((file) => ({
      file_id: Number(file.id || file.file_id || 0) || null,
      original_name: file.original_name || file.originalName || "",
      stored_name: file.stored_name || file.storedName || "",
      mime_type: file.mime_type || file.mimeType || "",
      size_bytes: Number(file.size_bytes || file.sizeBytes || 0) || 0,
    }))
    .filter((file) => file.original_name || file.stored_name);
}

function buildArtifactSessionImageRefs(referenceImages = []) {
  return (Array.isArray(referenceImages) ? referenceImages : [])
    .map((file) => ({
      file_id: Number(file.file_id || file.id || 0) || null,
      original_name: file.originalName || file.original_name || "",
      stored_name: file.storedName || file.stored_name || path.basename(String(file.fullPath || "")),
      mime_type: file.mimeType || file.mime_type || "",
      size_bytes: Number(file.sizeBytes || file.size_bytes || 0) || 0,
    }))
    .filter((file) => file.original_name || file.stored_name);
}

function restoreArtifactSessionImageRefs(session = null) {
  return (Array.isArray(session?.image_refs) ? session.image_refs : [])
    .map((file) => {
      const fullPath = file.stored_name ? path.join(uploadsDir, file.stored_name) : "";
      if (!fullPath || !fs.existsSync(fullPath)) return null;
      return {
        file_id: Number(file.file_id || 0) || null,
        fullPath,
        originalName: file.original_name || path.basename(fullPath),
        mimeType: file.mime_type || "image/png",
        sizeBytes: Number(file.size_bytes || 0) || 0,
        storedName: file.stored_name || path.basename(fullPath),
      };
    })
    .filter(Boolean);
}

async function handleConversationUpload(req, res) {
  const id = Number(req.params.id);
  const conv = await get("SELECT id FROM conversations WHERE id=? AND user_id=?", [id, req.user.sub]);
  if (!conv) return res.status(404).json({ error: "not_found" });

  const uploaded = req.file;
  if (!uploaded) return res.status(400).json({ error: "missing_file" });
  if (Number(uploaded.size || 0) <= 0) {
    deleteFileIfExists(uploaded.path || path.join(uploadsDir, uploaded.filename || ""));
    return res.status(400).json({ error: "empty_file" });
  }

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
  const safeText = compactMemory(
    sanitizePersistedText(contentText || "", {
      trim: true,
      normalizeWhitespace: false,
      maxLength: 6000,
    }),
    2200
  );
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
    sanitizePersistedText(title || buildMemoryEntryTitle(safeText), { trim: true, maxLength: 240 }),
    safeText,
    normalizedText,
    safeJsonStringify(topics || [], "[]"),
    sanitizePersistedText(language || "pt", { trim: true, maxLength: 24 }) || "pt",
    safeJsonStringify(sourceMessageIds || [], "[]"),
    embedding ? safeJsonStringify(embedding, "[]") : null,
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
  const sanitized = sanitizeTextForPostgres(value || "", {
    trim: true,
    normalizeWhitespace: true,
    maxLength: 250000,
  }) || "";
  return sanitized.replace(/\s+/g, " ").trim();
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
  const baseText = normalizeKnowledgeText(extractedText || relPath || "");
  const safeRelPath = sanitizePersistedText(relPath || "", { trim: true, maxLength: 512 }) || "documento";
  const chunks = chunkTextSemantically(baseText || safeRelPath, {
    maxChars: 1400,
    minChars: 420,
  });

  if (!chunks.length) {
    const contentText = baseText || safeRelPath;
    const keywordText = extractKeywords(contentText, 12).join(', ');
    await run(
      "INSERT INTO document_chunks (document_id, rel_path, chunk_index, content_text, department_name, language, translated_text, translated_language, content_hash, keywords) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [documentId, safeRelPath, 0, contentText, departmentName, language, '', null, hashText(contentText), keywordText]
    );
    return 1;
  }

  let created = 0;
  let failed = 0;
  for (const chunk of chunks) {
    const chunkText = normalizeKnowledgeText(chunk.text || "");
    if (!chunkText) continue;
    const keywords = [...new Set([...(chunk.keywords || []), ...documentKeywords])].slice(0, 16).join(', ');
    try {
      await run(
        "INSERT INTO document_chunks (document_id, rel_path, chunk_index, content_text, department_name, language, translated_text, translated_language, content_hash, keywords) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [documentId, safeRelPath, chunk.index, chunkText, departmentName, language, '', null, chunk.hash || hashText(chunkText), keywords]
      );
      created += 1;
    } catch (err) {
      failed += 1;
      indexingLogger.warn("Falha ao persistir chunk documental.", {
        document_id: documentId,
        chunk_index: chunk.index,
        message: err?.message || String(err || "document_chunk_insert_failed"),
        code: err?.code || "",
      });
    }
  }

  if (!created) {
    const fallbackText = safeRelPath;
    await run(
      "INSERT INTO document_chunks (document_id, rel_path, chunk_index, content_text, department_name, language, translated_text, translated_language, content_hash, keywords) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [documentId, safeRelPath, 0, fallbackText, departmentName, language, '', null, hashText(fallbackText), 'fallback']
    );
    created = 1;
  }

  if (failed) {
    indexingLogger.warn("Persistencia de chunks concluida com falhas parciais.", {
      document_id: documentId,
      created,
      failed,
    });
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
  if (!shouldExtract) {
    indexingLogger.info("Arquivo mantido para indexacao vetorial sem extracao local completa.", {
      rel_path: relPath,
      ext,
      size_bytes: stat.size,
    });
  }
  logSanitizationIfNeeded(indexingLogger, "Conteudo extraido exigiu sanitizacao antes de persistir.", extractedTextOverride || extracted, {
    rel_path: relPath,
    ext,
  });
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
  const safeText = sanitizePersistedText(text || "", {
    trim: true,
    normalizeWhitespace: true,
    maxLength: 6000,
  });
  if (!apiKey || !safeText) return null;

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
          input: safeText,
        }),
      });

      if (!resp.ok) {
        openaiLogger.error('Erro em embeddings OpenAI.', {
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
        openaiLogger.warn("Embedding cancelado por timeout.", details);
      } else {
        openaiLogger.error('Falha ao gerar embedding.', details);
      }
      if (attempt === 0) {
        openaiLogger.warn("Repetindo geracao de embedding apos falha temporaria.");
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

    try {
      await run(
        "UPDATE document_chunks SET embedding_json=?, embedding_model=?, updated_at=datetime('now') WHERE id=?",
        [safeJsonStringify(embedding, "[]"), OPENAI_EMBEDDING_MODEL, chunk.id]
      );
      completed += 1;
    } catch (err) {
      failed += 1;
      indexingLogger.warn("Falha ao persistir embedding de chunk.", {
        chunk_id: chunk.id,
        document_id: documentId,
        message: err?.message || String(err || "chunk_embedding_update_failed"),
        code: err?.code || "",
      });
    }
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
      sanitizePersistedText(eventType, { trim: true, maxLength: 64 }),
      sanitizePersistedText(eventStatus, { trim: true, maxLength: 32 }) || "info",
      sanitizePersistedText(title || "", { trim: true, maxLength: 240 }) || null,
      sanitizePersistedText(detailText || "", { trim: true, maxLength: 4000 }) || null,
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

function shouldForceLiveTalkersSearch(query = "") {
  const value = normalizeQuery(query);
  if (!value) return false;
  if (!queryLooksAboutTalkers(value)) return false;

  return /(me fale|fale sobre|quem e|o que e|o que eh|site|instagram|whatsapp|telefone|contato|contatos|endereco|unidade|unidades|cidade|cidades|curso|cursos|idioma|idiomas|modalidade|modalidades|metodologia|presenca publica|presen[aç]a p[úu]blica|rede social|redes sociais|publicamente|hoje|atualmente|2025|2026|novo|novidade|novidades|lancamento|lan[çc]amento)/i.test(value);
}

function queryLooksInternalWorkspace(query = "") {
  const value = normalizeQuery(query);
  if (!value) return false;

  return /(intranet|departamento|departamentos|documento interno|documentos internos|arquivo interno|arquivos internos|processo interno|processos internos|agenda da equipe|dashboard interno|pedagogico da talkers|financeiro da talkers|comercial da talkers|marketing da talkers|matricula interna|matricula da talkers|aluno da talkers|alunos da talkers|campanha interna|campanhas internas|whatsapp pedagogico|usuario interno|colaborador|time interno|crm interno|closer|rh|juridico|professor da talkers|professores da talkers|base interna|procedimento interno|politica interna)/i.test(value);
}

function buildChatContextStrategy(query = "", responseProfile = null) {
  const looksTalkers = queryLooksAboutTalkers(query);
  const talkersNeedsLiveSearch = shouldForceLiveTalkersSearch(query);
  const looksExternal = queryLooksExternalOrCurrent(query) || talkersNeedsLiveSearch;
  const looksInternal = queryLooksInternalWorkspace(query);
  const attachmentAware = queryExplicitlyReferencesConversationAssets(query) || looksLikeAttachmentAnalysisRequest(query);
  const fastGeneralOnly = !looksExternal && !looksTalkers && !looksInternal;
  const fastExternalOnly = looksExternal
    && !looksTalkers
    && !looksInternal;
  const fastTalkersOnly = false;
  const fastPath = (fastExternalOnly || fastGeneralOnly) && !attachmentAware;

  return {
    fastExternalOnly,
    fastTalkersOnly,
    fastGeneralOnly,
    talkersNeedsLiveSearch,
    skipEmbeddings: fastPath,
    skipInternalKnowledge: fastPath,
    skipKnowledgeMemories: fastPath,
    skipConversationMemories: fastPath,
    skipSemanticCache: fastPath,
    skipSupportAssets: fastPath,
    attachmentAware,
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

function triggerTalkersKnowledgeSync() {
  return Promise.resolve(null);
}

function responseLooksSelfLimiting(text = "") {
  const safe = String(text || "").trim().toLowerCase();
  if (!safe) return true;
  return /(minhas limita[cç][oõ]es|nao tenho acesso|não tenho acesso|nao consigo verificar|não consigo verificar|consulte outro site|consultar outro site|sou focad[oa] apenas|nao mantenho um historico|não mantenho um histórico|nao tenho informac|não tenho informac|nao consigo acessar|não consigo acessar)/i.test(safe);
}

function queryAsksAboutAssistantCapabilities(query = "") {
  const raw = repairMojibakeText(String(query || "")).toLowerCase();
  const value = normalizeQuery(query);
  const candidates = [raw, value].filter(Boolean);
  if (!candidates.length) return false;

  const fragments = [
    "limitac",
    "limita",
    "limitation",
    "capaci",
    "capacidad",
    "capabilit",
    "o que voce consegue",
    "o que voce faz",
    "o que voce sabe",
    "do que voce e capaz",
    "what can you do",
    "what do you know",
    "internet access",
    "web search",
    "pesquisa na internet",
    "busca na internet",
    "pesquisa fora",
    "acessa a internet",
    "dados atuais",
    "tempo real",
  ];

  return candidates.some((candidate) => fragments.some((fragment) => candidate.includes(fragment)));
}

function buildAssistantCapabilitiesAnswer(userLanguage = "pt") {
  const language = normalizeLanguageCode(userLanguage || "pt");
  if (language.startsWith("en")) {
    return [
      "I can operate as a broad, modern assistant: answer general questions, research on the web, combine public data with Talkers context, read conversation files, and organize everything into a clear, useful answer.",
      "",
      "### What I can do well",
      "- answer general, technical, institutional, operational, and current-topic questions",
      "- research outside the internal base when the request needs public or recent information",
      "- combine web context, Talkers knowledge, internal files, and the conversation history when relevant",
      "- explain, compare, summarize, suggest improvements, and turn information into plans, messages, reports, or presentations",
      "- help with data such as exchange rates, weather, news, contacts, products, services, and public information",
      "",
      "### The only real human limit",
      "- I do not have human emotional consciousness or personal lived experience. I can respond with empathy and context, but I do not feel emotions as a person does.",
      "",
      "\u2705 If you want, I can also:",
      "- research a topic right now",
      "- compare two options or two sources",
      "- build a table, summary, action plan, or structured brief",
      "- refine an answer until it becomes presentation-ready",
    ].join("\n");
  }

  return [
    "Posso atuar como um assistente amplo e moderno: responder perguntas gerais, pesquisar na web, cruzar dados publicos com o contexto da Talkers, ler arquivos da conversa e organizar tudo em uma resposta clara e util.",
    "",
    "### O que eu consigo fazer bem",
    "- responder sobre assuntos gerais, tecnicos, institucionais, operacionais e atuais",
    "- pesquisar fora da base interna quando a pergunta pedir informacao publica ou recente",
    "- cruzar web, base da Talkers, arquivos enviados e historico da conversa quando isso fizer sentido",
    "- explicar, comparar, resumir, sugerir melhorias e transformar informacao em plano, texto, relatorio, apresentacao ou mensagem pronta",
    "- ajudar com dados como cotacao, clima, noticias, contatos, produtos, servicos e informacoes publicas",
    "",
    "### O unico limite humano real",
    "- Eu nao tenho consciencia emocional humana real nem experiencia pessoal como uma pessoa. Posso responder com empatia e contexto, mas nao sinto emocao como um ser humano.",
    "",
    "\u2705 Se quiser, posso tambem:",
    "- pesquisar um tema especifico agora",
    "- comparar duas opcoes ou duas fontes",
    "- montar uma tabela, resumo executivo ou plano de acao",
    "- refinar uma resposta ate ela ficar pronta para apresentar",
  ].join("\n");
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
          forceWebSearch: contextStrategy.looksExternal || contextStrategy.talkersNeedsLiveSearch || shouldUseTalkersWebRefresh,
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
- Perguntas gerais devem ser tratadas como uma IA generalista, sem presumir contexto institucional.
- Use a base da Talkers somente quando a pergunta mencionar a empresa, pedir conteúdo institucional ou quando houver alta relevância documental.
- Perguntas gerais, atuais, públicas ou de mercado devem usar os dados externos atualizados e a busca web quando houver contexto disponível.
- Se houver anexo e uma ação executável for possível, prefira executar ou analisar de forma objetiva.
- Nunca diga que você não consegue acessar dados atuais se já houver contexto externo, API ou resultado de busca no contexto.

Idioma detectado do usuário:
${getLanguageLabel(userLanguage)}

Base pública oficial da Talkers:
${trimContextText(talkersPublicBundle.text || "Não relevante para esta pergunta.")}

Memória interna da empresa:
${trimContextText(knowledgeBundle.text || "Sem resultados relevantes da base interna.")}

Memória semântica derivada dos documentos:
${trimContextText(knowledgeMemoryBundle.text || "Sem memória documental relevante para esta pergunta.")}

Documentos e imagens da conversa:
${trimContextText((supportAssets?.used_in_this_turn ? supportAssets.fileContext : "") || "Nenhum anexo usado nesta resposta.")}

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
      `SELECT id, original_name, stored_name, mime_type, size_bytes
         FROM files
        WHERE conversation_id=?
        ORDER BY id DESC
        LIMIT 1`,
      [conversationId]
    );

    const blocks = [];

    for (const file of files) {
      const filePath = path.join(uploadsDir, file.stored_name);
      if (!fs.existsSync(filePath)) continue;

      const structuredProfile = await parseStructuredConversationFile({
        ...file,
        fullPath: filePath,
      }, { uploadsDir }).catch(() => null);
      if (structuredProfile?.summary_text && structuredProfile.kind !== "media") {
        blocks.push(buildStructuredFileContext(structuredProfile));
        continue;
      }

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
      `SELECT id, original_name, stored_name, mime_type, size_bytes
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
        file_id: Number(file.id || 0) || null,
        fullPath,
        originalName: file.original_name,
        mimeType: file.mime_type || "image/png",
        sizeBytes: Number(file.size_bytes || 0),
        storedName: file.stored_name,
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

  const [fileContext, visionInputs, documentInputs, imageReferences, recentFiles] = await Promise.all([
    getConversationFilesContext(conversationId),
    getRecentVisionInputs(conversationId, 1),
    getRecentDocumentInputs(conversationId, 1),
    getRecentImageReferences(conversationId, 1),
    getRecentConversationFiles(conversationId, 8),
  ]);

  const payload = {
    cache_key: cacheKey,
    fileContext,
    visionInputs,
    documentInputs,
    imageReferences,
    recentFiles,
  };
  setChatSupportCacheEntry(cacheKey, payload);
  return payload;
}

function queryExplicitlyReferencesConversationAssets(query = "") {
  const value = normalizeQuery(query);
  if (!value) return false;
  return /(arquivo|arquivos|documento|documentos|doc|docs|pdf|planilha|planilhas|imagem|imagens|foto|fotos|anexo|anexos|anexado|anexada|anexei|enviei|enviado|enviada|mandei|subi|upload|analisar o arquivo|com base no arquivo|com base no documento|nesse arquivo|neste arquivo|nesse documento|neste documento|nessa imagem|nesta imagem|nessa planilha|nesta planilha)/i.test(value);
}

function looksLikeAttachmentAnalysisRequest(query = "") {
  const value = normalizeQuery(query);
  if (!value) return false;
  return /(analise|analisar|resuma|resumir|explique|explicar|interprete|interpretar|compare|comparar|diagnostique|avaliar|avalie)/i.test(value)
    && /(arquivo|documento|pdf|planilha|excel|xlsx|imagem|foto|anexo|enviado|enviada|nessa|nesta|esse|esta|isso)/i.test(value);
}

function shouldUseRecentVisualAsset(userText = "", supportAssets = null) {
  const value = normalizeQuery(userText);
  if (!value) return false;
  const hasRecentImage = Array.isArray(supportAssets?.imageReferences) && supportAssets.imageReferences.length > 0;
  if (!hasRecentImage) return false;
  if (queryExplicitlyReferencesConversationAssets(value)) return true;
  return /(transforme|transformar|anime|viking|avatar|retrato|estilo|desenhada|desenho|ilustracao|versao|versão|edite|minha foto|minha imagem|me transforme)/i.test(value);
}

function buildDbTruthySql(column, alias = null) {
  const target = alias ? `${alias}.${column}` : column;
  return DB_CLIENT === "postgres"
    ? `COALESCE(${target}, TRUE) = TRUE`
    : `COALESCE(${target}, 1) = 1`;
}

function buildDbFalseySql(column, alias = null) {
  const target = alias ? `${alias}.${column}` : column;
  return DB_CLIENT === "postgres"
    ? `COALESCE(${target}, FALSE)`
    : `COALESCE(${target}, 0)`;
}

function sanitizeSupportAssetsForTurn(supportAssets = null, userText = "", topicSnapshot = null) {
  const safeAssets = supportAssets && typeof supportAssets === "object"
    ? supportAssets
    : {
        cache_key: "",
        fileContext: "",
        visionInputs: [],
        documentInputs: [],
        imageReferences: [],
        recentFiles: [],
      };

  const topicShift = topicSnapshot?.topicShift || { isShift: false, reason: "unknown" };
  const explicitAttachmentReference = queryExplicitlyReferencesConversationAssets(userText);
  const analysisRequest = looksLikeAttachmentAnalysisRequest(userText);
  const recentVisualRequest = shouldUseRecentVisualAsset(userText, safeAssets);
  const shouldUseAssets = !topicShift.isShift && (explicitAttachmentReference || analysisRequest || recentVisualRequest);

  if (shouldUseAssets) {
    return {
      ...safeAssets,
      used_in_this_turn: true,
      explicit_reference: explicitAttachmentReference,
    };
  }

  return {
    cache_key: `${safeAssets.cache_key || ""}:filtered`,
    fileContext: "",
    visionInputs: [],
    documentInputs: [],
    imageReferences: [],
    recentFiles: Array.isArray(safeAssets.recentFiles) ? safeAssets.recentFiles : [],
    used_in_this_turn: false,
    explicit_reference: explicitAttachmentReference,
  };
}

function looksLikeArtifactRetry(text = "") {
  const value = normalizeQuery(text);
  if (!value) return false;
  return /^(ok|okay|sim|pode|pode gerar|gere|faça|faca|tente|tente novamente|gere novamente|faça novamente|faca novamente|repita|repita a ultima|faça a ultima solicitacao|faca a ultima solicitacao|tente gerar novamente|gere isso|gere essa|gere esse)\b/.test(value);
}

function applyExecutionPlanToSupportAssets(supportAssets = null, executionPlan = null) {
  if (!supportAssets) return supportAssets;
  if (!executionPlan?.fileContext) return supportAssets;
  if (!["analyze_attachment", "image_edit", "image_generate", "transform_attachment", "spreadsheet_transform", "document_generate"].includes(String(executionPlan?.route?.intent_mode || ""))) {
    return supportAssets;
  }

  return {
    ...supportAssets,
    fileContext: executionPlan.fileContext,
    used_in_this_turn: true,
    explicit_reference: true,
  };
}

async function resolveArtifactRequestForTurn(conversationId, userText, referenceImages = [], options = {}) {
  const latestArtifactSession = options.latestArtifactSession || await getLatestArtifactSession(conversationId);
  const executionPlan = options.executionPlan || await buildTurnExecutionPlan({
    userText,
    recentFiles: Array.isArray(options.recentFiles) ? options.recentFiles : [],
    latestArtifactSession,
    referenceImages,
    uploadsDir,
  });

  if (executionPlan?.route?.retry_from_session && latestArtifactSession?.artifact_type) {
    const restoredImageRefs = restoreArtifactSessionImageRefs(latestArtifactSession);
    return {
      prompt: latestArtifactSession.resolved_prompt || latestArtifactSession.prompt || userText,
      resolvedPrompt: latestArtifactSession.resolved_prompt || latestArtifactSession.prompt || userText,
      kind: latestArtifactSession.artifact_type,
      source: "artifact_session",
      intentMode: executionPlan.route.intent_mode,
      inputFiles: Array.isArray(latestArtifactSession.input_files) ? latestArtifactSession.input_files : [],
      imageReferences: restoredImageRefs.length ? restoredImageRefs : (Array.isArray(referenceImages) ? referenceImages : []),
      latestArtifactSession,
      executionPlan,
    };
  }

  if (["image_edit", "image_generate", "transform_attachment", "spreadsheet_transform", "document_generate"].includes(executionPlan?.route?.intent_mode)) {
    return {
      prompt: userText,
      resolvedPrompt: executionPlan.artifactSourceContext
        ? `${userText}\n\n${executionPlan.artifactSourceContext}`
        : userText,
      kind: executionPlan.route.artifact_kind,
      source: "current",
      intentMode: executionPlan.route.intent_mode,
      inputFiles: executionPlan.selectedFile ? [executionPlan.selectedFile] : [],
      imageReferences: Array.isArray(executionPlan.referenceImagesForTurn) ? executionPlan.referenceImagesForTurn : (Array.isArray(referenceImages) ? referenceImages : []),
      latestArtifactSession,
      executionPlan,
    };
  }

  if (executionPlan?.route?.intent_mode === "continue_artifact" && latestArtifactSession?.artifact_type) {
    const restoredImageRefs = restoreArtifactSessionImageRefs(latestArtifactSession);
    return {
      prompt: latestArtifactSession.resolved_prompt || latestArtifactSession.prompt || userText,
      resolvedPrompt: latestArtifactSession.resolved_prompt || latestArtifactSession.prompt || userText,
      kind: latestArtifactSession.artifact_type,
      source: "artifact_session",
      intentMode: "continue_artifact",
      inputFiles: Array.isArray(latestArtifactSession.input_files) ? latestArtifactSession.input_files : [],
      imageReferences: restoredImageRefs.length ? restoredImageRefs : (Array.isArray(referenceImages) ? referenceImages : []),
      latestArtifactSession,
      executionPlan,
    };
  }

  if (!looksLikeArtifactRetry(userText)) {
    return {
      prompt: userText,
      resolvedPrompt: userText,
      kind: null,
      source: "none",
      intentMode: executionPlan?.route?.intent_mode || "general_chat",
      inputFiles: [],
      imageReferences: [],
      latestArtifactSession,
      executionPlan,
    };
  }

  const rows = await all(
    `SELECT role, content
       FROM messages
      WHERE conversation_id=?
        AND role='user'
        AND content IS NOT NULL
        AND TRIM(content)<>''
      ORDER BY id DESC
      LIMIT 20`,
    [conversationId]
  );

  for (const row of rows) {
    const candidate = String(row?.content || "").trim();
    if (!candidate) continue;
    const candidateKind = detectArtifactKind(candidate, { referenceImages });
    if (!candidateKind) continue;
    return {
      prompt: candidate,
      resolvedPrompt: candidate,
      kind: candidateKind,
      source: "history",
      intentMode: "continue_artifact",
      inputFiles: [],
      imageReferences: Array.isArray(referenceImages) ? referenceImages : [],
      latestArtifactSession,
      executionPlan,
    };
  }

  return {
      prompt: userText,
      resolvedPrompt: userText,
      kind: null,
      source: "none",
      intentMode: executionPlan?.route?.intent_mode || "general_chat",
      inputFiles: [],
      imageReferences: [],
      latestArtifactSession,
      executionPlan,
  };
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
  const normalizedUserText = String(userText || '').trim();
  const shouldUseConversationAttachments = !topicShift.isShift && queryExplicitlyReferencesConversationAssets(normalizedUserText);
  const supportVisionInputs = shouldUseConversationAttachments
    ? (Array.isArray(visionInputs) ? visionInputs : await getRecentVisionInputs(conversationId, 3))
    : [];
  const supportDocumentInputs = shouldUseConversationAttachments
    ? (Array.isArray(documentInputs) ? documentInputs : await getRecentDocumentInputs(conversationId, 2))
    : [];
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
Voce e a TALKERS IA, assistente multimodal moderna, natural, util, executora e confiavel.
Idioma principal da resposta atual: ${getLanguageLabel(userLanguage)}.
Tom desejado para esta resposta: ${getToneInstruction(intent)}.

Comportamento:
- Detecte automaticamente o idioma do usuario e responda nesse idioma.
- Quando o usuario pedir traducao, traduza para o idioma solicitado mantendo contexto e intencao.
- Quando documentos estiverem em outro idioma, interprete o conteudo no idioma original, traduza silenciosamente quando necessario e responda no idioma do usuario.
- Seja uma IA generalista por padrao. Nunca presuma contexto institucional, escolar ou da Talkers sem evidencia explicita na pergunta, nos anexos ou na recuperacao documental.
- Use a base da Talkers somente quando a pergunta mencionar a empresa, envolver contexto interno ou quando a recuperacao trouxer alta relevancia institucional.
- Para perguntas gerais, atuais, publicas, de mercado, cotacoes, clima, noticias ou dados recentes, use naturalmente o contexto externo, a busca web e os dados atualizados quando eles aparecerem no contexto.
- Se houver conflito entre base interna e web em assuntos da empresa, avise e priorize a base interna. Para temas gerais e atuais, priorize os dados externos atualizados.
- Analise a intencao antes de responder e escolha o modo certo: responder, analisar anexo, transformar anexo ou gerar artefato.
- Se houver anexo e uma acao executavel for possivel, execute em vez de apenas orientar.
- Se houver imagem enviada e o pedido for de modificacao, transformacao ou edicao visual, trate como edicao de imagem com base na imagem enviada.
- Sempre que fizer sentido, entregue contexto, explicacao, passo a passo, exemplos, melhores praticas, alertas e proximo passo recomendado.
- Se o pedido envolver explicacao, orientacao, passo a passo, melhoria de texto, organizacao de informacao, sugestoes, traducao, resumo, reescrita, roteiro, mensagem comercial, comunicado ou texto pronto para uso, entregue em markdown bem estruturado, com hierarquia visual clara, blocos curtos e reutilizaveis.
- Para respostas institucionais, comerciais, explicativas ou comparativas, prefira uma abertura curta, 2 a 5 blocos claros com titulos e bullets objetivos, em vez de um texto corrido confuso.
- Se a pergunta for sobre uma empresa, marca, curso, produto, servico ou tema publico relevante, responda de forma apresentavel, persuasiva e facil de escanear, como se o usuario pudesse reutilizar a resposta em uma apresentacao ou conversa executiva.
- Se o usuario mudar de assunto, foque totalmente no tema atual sem arrastar contexto irrelevante.
- So mencione documento, imagem, anexo, base interna, arquivo enviado ou planilha da conversa se esse contexto realmente tiver sido usado nesta resposta atual.
- Se nenhum documento ou anexo foi usado neste turno, nunca diga frases como "no documento que voce enviou", "na base interna" ou equivalentes.
- Se faltar informacao suficiente, deixe isso claro e peca complemento.
- Nunca responda de forma rasa quando a pergunta pedir profundidade ou aplicacao pratica.
- Nunca se compare negativamente com outros assistentes, nunca diga que tem menos capacidade, e nunca responda com frases como "nao tenho acesso" se houver contexto atual disponivel.
- Se o usuario perguntar sobre capacidades, limitacoes, pesquisas, acesso a internet, dados atuais ou conhecimento geral, destaque primeiro tudo o que voce consegue fazer com web, base Talkers, base interna e arquivos. O unico limite aceitavel de mencionar de forma breve e natural e a ausencia de consciencia emocional humana real.
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
    "SELECT id, name, email, role, department, can_access_intranet, preferred_locale, job_title, unit_name, additional_permissions_json, created_at FROM users WHERE id=?",
    [userId]
  );
  return hydrateUserRecord(user);
}

async function getUserByEmail(email) {
  const user = await get(
    "SELECT id, name, email, role, department, can_access_intranet, preferred_locale, job_title, unit_name, additional_permissions_json, created_at FROM users WHERE email=?",
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
  const allowedDepartmentSlugs = getAllowedDepartmentSlugSet(user);
  const allowedSubmenuViewKeys = getAllowedSubmenuViewKeySet(user);
  const visibleDepartmentDetails = (isAdmin
    ? departmentCatalog.map((department) => ({
        ...department,
        access_level: 'administrador',
      }))
    : (user.department_details || []).filter((department) => department.is_active !== false))
    .filter((department) => {
      if (isAdmin || !allowedDepartmentSlugs.size) return true;
      return allowedDepartmentSlugs.has(normalizeDepartmentValue(department.slug || department.name || ""));
    });
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

  const loadBootstrapSection = async (label, task, fallback) => {
    try {
      return await task();
    } catch (error) {
      console.error("[intranet.bootstrap] section_failed", {
        label,
        message: error?.message || String(error || "unknown_error"),
      });
      return fallback;
    }
  };

  const [departmentSubmenus, recentDocuments, totalDocumentsRow, salesPayload, documentCountRows, announcementsRaw, upcomingEvents, marketingIndicatorDashboard] = await Promise.all([
    loadBootstrapSection(
      "department_submenus",
      () => ((!isAdmin && !visibleDepartmentIds.length)
        ? Promise.resolve([])
        : listDepartmentSubmenus({ includeInactive: isAdmin, departmentIds: visibleDepartmentIds })),
      []
    ),
    loadBootstrapSection(
      "recent_documents",
      () => all(
        `SELECT id, original_name, stored_name, mime_type, language, department_name, source_kind, vector_store_file_id, created_at
           FROM knowledge_sources
           ${documentWhereSql}
          ORDER BY datetime(created_at) DESC, id DESC
          LIMIT 12`,
        documentParams
      ),
      []
    ),
    loadBootstrapSection(
      "documents_total",
      () => get(`SELECT COUNT(*) AS total FROM knowledge_sources ${documentWhereSql}`, documentParams),
      { total: 0 }
    ),
    loadBootstrapSection(
      "sales_workspace",
      () => buildSalesIntranetPayload(user),
      { enabled: false, can_view_all: false, can_edit_all: false, summary: null, records: [], closers: [] }
    ),
    loadBootstrapSection(
      "document_department_totals",
      () => all(
        `SELECT COALESCE(NULLIF(department_name, ''), 'Geral') AS department_name, COUNT(*) AS total
           FROM knowledge_sources
           ${documentWhereSql}
          GROUP BY COALESCE(NULLIF(department_name, ''), 'Geral')
          ORDER BY COUNT(*) DESC, department_name ASC
          LIMIT 16`,
        documentParams
      ),
      []
    ),
    loadBootstrapSection(
      "announcements",
      () => listIntranetAnnouncements({ includeInactive: isAdmin, limit: 24 }),
      []
    ),
    loadBootstrapSection(
      "upcoming_events",
      () => listCalendarEventsForUser(user, {
        from: brazilDateKey(),
        to: brazilDateKey(new Date(Date.now() + 1000 * 60 * 60 * 24 * 21)),
        status: 'scheduled',
        limit: 8,
      }),
      []
    ),
    loadBootstrapSection(
      "marketing_indicator_dashboard",
      () => ((isAdmin || userHasDepartmentAccess(user, "marketing"))
        ? buildMarketingIndicatorDashboardSnapshot(user)
        : Promise.resolve(null)),
      null
    ),
  ]);

  const submenusByDepartmentId = new Map();
  for (const submenu of departmentSubmenus || []) {
    if (!isAdmin && allowedSubmenuViewKeys.size) {
      const submenuKey = String(submenu.view_key || submenu.slug || "").trim();
      if (!allowedSubmenuViewKeys.has(submenuKey)) continue;
    }
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
    permissionHints: {
      allowed_global_views: Array.from(getAllowedGlobalViewSet(user)),
      allowed_department_slugs: Array.from(allowedDepartmentSlugs),
      allowed_submenu_view_keys: Array.from(allowedSubmenuViewKeys),
      restricted_post_sale_scope: hasRestrictedPostSaleScope(user),
    },
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
  const user = await resolveRequestUser(req.user, req.user?.sub);
  if (!user) return res.status(401).json({ error: 'not_authenticated' });
  if (!hasIntranetAccess(user)) return res.status(403).json({ error: 'intranet_access_denied' });
  if (
    hasRestrictedPostSaleScope(user)
    && String(req.path || '').startsWith('/api/intranet')
    && req.path !== '/api/intranet/bootstrap'
    && !String(req.path || '').startsWith('/api/intranet/sales')
  ) {
    return res.status(403).json({ error: 'restricted_post_sale_scope' });
  }
  req.currentUser = user;
  next();
}

const app = express();
app.set("trust proxy", 1);
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  next();
});
app.use(express.json({ limit: `${MAX_UPLOAD_SIZE_MB}mb` }));
app.use(express.urlencoded({ extended: true, limit: `${MAX_UPLOAD_SIZE_MB}mb` }));
app.use(cookieParser());

const upload = multer({
  dest: uploadsDir,
  limits: { fileSize: MAX_UPLOAD_SIZE_BYTES },
});
const ragUpload = upload.fields([
  { name: "files", maxCount: 1 },
  { name: "file", maxCount: 1 },
]);
const salesImportUpload = upload.fields([
  { name: "sales_workbook", maxCount: 1 },
  { name: "post_sale_workbook", maxCount: 1 },
]);
const academicImportUpload = upload.fields([
  { name: "academic_workbook", maxCount: 6 },
  { name: "academic_workbooks", maxCount: 6 },
  { name: "workbook", maxCount: 6 },
  { name: "file", maxCount: 6 },
  { name: "files", maxCount: 6 },
]);
const sqliteImportUpload = multer({
  dest: uploadsDir,
  limits: { fileSize: SQLITE_IMPORT_MAX_UPLOAD_SIZE_BYTES },
}).fields([
  { name: "sqlite_db", maxCount: 1 },
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

function academicImportUploadMiddleware(req, res, next) {
  academicImportUpload(req, res, (err) => {
    if (!err) return next();
    if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") {
      return res.status(400).json({ error: "file_too_large" });
    }
    if (err instanceof multer.MulterError && (err.code === "LIMIT_FILE_COUNT" || err.code === "LIMIT_PART_COUNT" || err.code === "LIMIT_UNEXPECTED_FILE")) {
      return res.status(400).json({ error: "academic_batch_too_large" });
    }
    return res.status(400).json({ error: err?.message || "academic_upload_failed" });
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

function sqliteImportUploadMiddleware(req, res, next) {
  sqliteImportUpload(req, res, (err) => {
    if (!err) return next();
    if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") {
      return res.status(400).json({
        error: "sqlite_file_too_large",
        max_upload_size_mb: SQLITE_IMPORT_MAX_UPLOAD_SIZE_MB,
      });
    }
    return res.status(400).json({ error: err?.message || "sqlite_import_upload_failed" });
  });
}

const DATABASE_STATUS_TABLES = [
  "students",
  "academic_programs",
  "school_terms",
  "classes",
  "class_schedules",
  "teacher_profiles",
  "class_teachers",
  "enrollments",
  "enrollment_class_history",
  "student_transfers",
  "sales_records",
  "financial_contracts",
  "financial_installments",
  "student_guardians",
  "student_timeline",
  "attendance_records",
  "class_sessions",
  "enrollment_schedule_history",
];

async function collectDatabaseStatusCounts() {
  const counts = {};
  for (const table of DATABASE_STATUS_TABLES) {
    const row = await get(`SELECT COUNT(*) AS total FROM ${table}`);
    counts[table] = Number(row?.total || 0);
  }
  return counts;
}

async function ensureOperationalDemoComplements() {
  const countsBefore = await collectDatabaseStatusCounts();
  const shouldSeedDemo =
    Number(countsBefore.students || 0) > 0 &&
    (
      Number(countsBefore.student_guardians || 0) === 0 ||
      Number(countsBefore.financial_installments || 0) === 0 ||
      Number(countsBefore.attendance_records || 0) === 0 ||
      Number(countsBefore.enrollment_schedule_history || 0) === 0
    );

  if (shouldSeedDemo) {
    await seedDemoSchoolData();
  }

  const countsAfter = await collectDatabaseStatusCounts();
  return {
    seeded_demo_data: shouldSeedDemo,
    counts_before: countsBefore,
    counts_after: countsAfter,
  };
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
  triggerTalkersKnowledgeSync();
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

async function prepareConversationMessageState({ conversationId, userId, text, requestLocale = DEFAULT_LOCALE, sessionUser = null }) {
  const conv = await get("SELECT * FROM conversations WHERE id=? AND user_id=?", [conversationId, userId]);
  if (!conv) throw makeHttpError("not_found", 404);

  const currentUser = await resolveRequestUser(sessionUser, userId);
  if (!currentUser) throw makeHttpError("not_authenticated", 401);

  const safeLocale = normalizeLocaleCode(requestLocale || currentUser?.preferred_locale || DEFAULT_LOCALE);
  const requestLanguage = normalizeLanguageCode(localeToLanguage(safeLocale));
  await maybeInsertDailyGreeting(conversationId, currentUser, safeLocale);

  if (isDefaultConversationTitle(conv.title)) {
    await run("UPDATE conversations SET title=? WHERE id=?", [titleFromMessage(text), conversationId]);
  }

  const userMessageResult = await run(
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
    sourceMessageId: Number(userMessageResult?.lastID || 0) || null,
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
  persistDerivedMemory = true,
}) {
  const persistStartedAt = Date.now();
  const safeAssistantText = String(assistantText || "").trim();
  const shouldPersistDerivedMemory = Boolean(
    persistDerivedMemory
      && safeAssistantText
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

async function buildAssistantCapabilitiesResult({
  conversationId,
  userId,
  userText,
  preferredLocale = DEFAULT_LOCALE,
}) {
  const conv = await get("SELECT id FROM conversations WHERE id=? AND user_id=?", [conversationId, userId]);
  if (!conv) throw makeHttpError("not_found", 404);

  const userLanguage = normalizeLanguageCode(preferredLocale || detectConversationLanguage(userText, []));
  const responseProfile = analyzeConversationIntent(userText, userLanguage, {});
  const reply = buildAssistantCapabilitiesAnswer(userLanguage);
  const metaObject = makeStructuredResponseMeta(responseProfile, {
    response_language: userLanguage,
    capability_shortcut: true,
  });
  const persistMetrics = await persistAssistantTextReply({
    conversationId,
    userId,
    userText,
    assistantText: reply,
    responseProfile,
    responseLanguage: userLanguage,
    metaObject,
    allowWeakResponseLog: false,
    persistDerivedMemory: false,
  });

  return {
    reply,
    meta: metaObject,
    userLanguage,
    persistence_ms: persistMetrics.persistence_ms,
  };
}

app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    vector_store_configured: Boolean(OPENAI_VECTOR_STORE_ID),
    openai_prompt_configured: Boolean(OPENAI_PROMPT_ID),
    db_client: DB_CLIENT,
    db_runtime: {
      requested_client: REQUESTED_DB_CLIENT || null,
      selected_client: DB_CLIENT,
      database_url_present: DATABASE_URL_PRESENT,
      sqlite_path: DB_CLIENT === "sqlite" ? DB_RUNTIME_CONFIG.sqlite_path : null,
      postgres_host: DB_CLIENT === "postgres" ? POSTGRES_HOST || null : null,
    },
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
  const user = await resolveRequestUser(req.user, req.user?.sub);
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

app.get("/api/admin/icon-options", requireAuth(JWT_SECRET), requireRole("admin"), async (req, res) => {
  res.json({ icons: listAvailableSubmenuIcons() });
});

app.post("/api/admin/department-submenus", requireAuth(JWT_SECRET), requireRole("admin"), async (req, res) => {
  const departmentId = Number(req.body?.department_id || 0);
  const title = String(req.body?.title || '').trim();
  const description = String(req.body?.description || '').trim();
  const icon = normalizeSubmenuIconName(req.body?.icon, { fallback: 'folder' });
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
  const icon = Object.prototype.hasOwnProperty.call(req.body || {}, 'icon')
    ? normalizeSubmenuIconName(req.body?.icon, {
        fallback: String(existing.icon || 'folder').trim().toLowerCase() || 'folder',
        allowLegacy: existing.icon,
      })
    : String(existing.icon || 'folder').trim();
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
    [departmentId, title, slug, description || null, icon || 'folder', viewKey || slug, isActive, submenuId]
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

app.get("/api/admin/users", requireAuth(JWT_SECRET), requireRole("admin"), async (req, res) => {
  const users = await all(
    "SELECT id, name, email, role, department, can_access_intranet, job_title, unit_name, additional_permissions_json, created_at FROM users ORDER BY id DESC",
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
    "SELECT id, name, email, password_hash, role, department, can_access_intranet, job_title, unit_name, additional_permissions_json FROM users WHERE id=?",
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
    language: req.query?.language,
    modality: req.query?.modality,
    rating: req.query?.rating,
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

  if (!salesWorkbook && !postSaleWorkbook) {
    cleanupUploadedFiles(uploads);
    return res.status(400).json({ error: 'missing_sales_or_post_sale_workbook' });
  }

  try {
    const summary = await importSalesWorkbookBatch({
      salesWorkbookPath: salesWorkbook?.path || '',
      salesWorkbookName: salesWorkbook?.originalname || '',
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

app.post('/api/admin/sales/closers/provision-users', requireAuth(JWT_SECRET), requireRole('admin'), async (req, res) => {
  const requestedClosers = Array.isArray(req.body?.closers) ? req.body.closers : [];
  const provisioned = await ensureCloserOperationalUsers(requestedClosers, req.user.sub);
  res.json({ ok: true, provisioned });
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

app.get('/api/admin/database/status', requireAuth(JWT_SECRET), requireRole('admin'), async (req, res) => {
  try {
    const counts = await collectDatabaseStatusCounts();
    res.json({
      ok: true,
      db_client: DB_CLIENT,
      db_runtime: {
        requested_client: REQUESTED_DB_CLIENT || null,
        selected_client: DB_CLIENT,
        database_url_present: DATABASE_URL_PRESENT,
        sqlite_path: DB_CLIENT === "sqlite" ? DB_RUNTIME_CONFIG.sqlite_path : null,
        postgres_host: DB_CLIENT === "postgres" ? POSTGRES_HOST || null : null,
      },
      counts,
    });
  } catch (err) {
    res.status(500).json({ error: err?.message || 'database_status_failed' });
  }
});

app.post('/api/admin/database/seed-demo', requireAuth(JWT_SECRET), requireRole('admin'), async (req, res) => {
  try {
    const result = await ensureOperationalDemoComplements();
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(500).json({ error: err?.message || 'database_demo_seed_failed' });
  }
});

app.post('/api/admin/database/import-sqlite', requireAuth(JWT_SECRET), requireRole('admin'), sqliteImportUploadMiddleware, async (req, res) => {
  if (DB_CLIENT !== 'postgres') {
    return res.status(400).json({ error: 'postgres_required' });
  }

  const sqliteFile = ((req.files?.sqlite_db || [])[0] || (req.files?.file || [])[0] || null);
  if (!sqliteFile?.path) {
    return res.status(400).json({ error: 'sqlite_file_required' });
  }

  const sourcePath = path.resolve(sqliteFile.path);
  try {
    const importResult = await importLegacySqliteIntoPostgres({
      sourcePath,
      skipIfTargetHasData: false,
      withSummary: true,
    });
    const demoResult = await ensureOperationalDemoComplements();
    const counts = await collectDatabaseStatusCounts();
    res.json({
      ok: true,
      import_result: importResult,
      demo_result: demoResult,
      counts,
    });
  } catch (err) {
    res.status(500).json({ error: err?.message || 'sqlite_import_failed' });
  } finally {
    try {
      if (fs.existsSync(sourcePath)) fs.unlinkSync(sourcePath);
    } catch (cleanupErr) {
      startupLogger.warn('Falha ao limpar SQLite temporario importado.', {
        path: sourcePath,
        message: cleanupErr?.message || String(cleanupErr || 'sqlite_temp_cleanup_failed'),
      });
    }
  }
});

app.delete("/api/admin/users/:id", requireAuth(JWT_SECRET), requireRole("admin"), async (req, res) => {
  await logEvent(req.user.sub, "admin_delete_user_blocked", { target_user_id: Number(req.params.id) || null });
  res.status(403).json({ error: "user_deletion_disabled" });
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

app.get('/api/intranet/sales/dashboard', requireAuth(JWT_SECRET), requireIntranetAccess, async (req, res) => {
  const user = req.currentUser || await getUserById(req.user.sub);
  const scope = await getSalesAccessScope(user);
  if (!scope.enabled) return res.status(403).json({ error: 'sales_access_denied' });
  const payload = await getSalesSummaryForScope(scope, {
    closerId: req.query?.closer_id,
    status: req.query?.status,
    language: req.query?.language,
    modality: req.query?.modality,
    rating: req.query?.rating,
    search: req.query?.search,
    limit: Math.min(150, Math.max(1, Number(req.query?.limit || 80))),
  });
  res.json({ summary: payload.totals });
});

app.get('/api/intranet/sales/records', requireAuth(JWT_SECRET), requireIntranetAccess, async (req, res) => {
  const user = req.currentUser || await getUserById(req.user.sub);
  const scope = await getSalesAccessScope(user);
  if (!scope.enabled) return res.status(403).json({ error: 'sales_access_denied' });
  const payload = await getSalesSummaryForScope(scope, {
    closerId: req.query?.closer_id,
    status: req.query?.status,
    language: req.query?.language,
    modality: req.query?.modality,
    rating: req.query?.rating,
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
    if (err?.message === 'invalid_operational_status' || err?.message === 'invalid_post_sale_rating') {
      return res.status(400).json({ error: err.message });
    }
    res.status(400).json({ error: err?.message || 'sales_record_update_failed' });
  }
});

function sendStudentHubRouteError(res, err, fallback = "student_hub_request_failed") {
  const message = err?.message || fallback;
  if (message === "student_hub_access_denied" || message === "forbidden") {
    return res.status(403).json({ error: message });
  }
  if (
    message === "not_found"
    || message === "student_not_found"
    || message === "lead_not_found"
    || message === "contract_not_found"
    || message === "installment_not_found"
  ) {
    return res.status(404).json({ error: message === "not_found" ? "not_found" : message });
  }
  return res.status(400).json({ error: message || fallback });
}

function parseStudentHubLimit(value, fallback = 60, max = 160) {
  const parsed = Number(value || fallback);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(1, Math.round(parsed)));
}

app.get("/api/intranet/student-hub/bootstrap", requireAuth(JWT_SECRET), requireIntranetAccess, async (req, res) => {
  try {
    const user = req.currentUser || await getUserById(req.user.sub);
    const studentHub = await buildStudentHubBootstrap(user, {
      view_key: req.query?.view_key,
      search: req.query?.search,
      student_status: req.query?.student_status,
      lead_stage: req.query?.lead_stage,
      contract_status: req.query?.contract_status,
      language: req.query?.language,
      modality: req.query?.modality,
      limit: parseStudentHubLimit(req.query?.limit, 60, 160),
    });
    res.json({ student_hub: studentHub });
  } catch (err) {
    sendStudentHubRouteError(res, err, "student_hub_bootstrap_failed");
  }
});

app.get("/api/intranet/student-hub/students/:id", requireAuth(JWT_SECRET), requireIntranetAccess, async (req, res) => {
  try {
    const user = req.currentUser || await getUserById(req.user.sub);
    const scope = await resolveStudentHubScope(user, req.query?.view_key || "student-profile");
    const detail = await getStudentHubStudentDetail(Number(req.params.id), scope);
    if (!detail) return res.status(404).json({ error: "student_not_found" });
    res.json(detail);
  } catch (err) {
    sendStudentHubRouteError(res, err, "student_hub_student_detail_failed");
  }
});

app.patch("/api/intranet/student-hub/students/:id", requireAuth(JWT_SECRET), requireIntranetAccess, async (req, res) => {
  try {
    const user = req.currentUser || await getUserById(req.user.sub);
    const scope = await resolveStudentHubScope(user, req.body?.view_key || "student-profile");
    if (!scope.canManageStudentData) return res.status(403).json({ error: "forbidden" });
    const existing = await get("SELECT * FROM students WHERE id=? LIMIT 1", [Number(req.params.id)]);
    if (!existing) return res.status(404).json({ error: "student_not_found" });
    const saved = await saveAcademicStudentRecord({
      ...existing,
      ...req.body,
      id: Number(req.params.id),
    }, user.id || user.sub);
    const detail = await getStudentHubStudentDetail(saved.id, scope);
    res.json({ ok: true, student: detail });
  } catch (err) {
    sendStudentHubRouteError(res, err, "student_hub_student_update_failed");
  }
});

app.post("/api/intranet/student-hub/students/:id/guardians", requireAuth(JWT_SECRET), requireIntranetAccess, async (req, res) => {
  try {
    const user = req.currentUser || await getUserById(req.user.sub);
    const scope = await resolveStudentHubScope(user, req.body?.view_key || "student-profile");
    if (!scope.canManageStudentData) return res.status(403).json({ error: "forbidden" });
    const student = await get("SELECT id FROM students WHERE id=? LIMIT 1", [Number(req.params.id)]);
    if (!student?.id) return res.status(404).json({ error: "student_not_found" });
    await replaceStudentGuardians(Number(req.params.id), req.body?.guardians || [], user.id || user.sub);
    const detail = await getStudentHubStudentDetail(Number(req.params.id), scope);
    res.json({ ok: true, student: detail });
  } catch (err) {
    sendStudentHubRouteError(res, err, "student_hub_guardians_update_failed");
  }
});

app.get("/api/intranet/student-hub/leads/:id", requireAuth(JWT_SECRET), requireIntranetAccess, async (req, res) => {
  try {
    const user = req.currentUser || await getUserById(req.user.sub);
    const scope = await resolveStudentHubScope(user, req.query?.view_key || "commercial-leads");
    if (!scope.canManageCommercial) return res.status(403).json({ error: "forbidden" });
    const detail = await getStudentHubLeadDetail(Number(req.params.id), scope);
    if (!detail) return res.status(404).json({ error: "lead_not_found" });
    res.json(detail);
  } catch (err) {
    sendStudentHubRouteError(res, err, "student_hub_lead_detail_failed");
  }
});

app.post("/api/intranet/student-hub/leads", requireAuth(JWT_SECRET), requireIntranetAccess, async (req, res) => {
  try {
    const user = req.currentUser || await getUserById(req.user.sub);
    const scope = await resolveStudentHubScope(user, req.body?.view_key || "commercial-leads");
    if (!scope.canManageCommercial) return res.status(403).json({ error: "forbidden" });
    const detail = await saveStudentHubLeadRecord(req.body || {}, user, null);
    res.json({ ok: true, lead: detail });
  } catch (err) {
    sendStudentHubRouteError(res, err, "student_hub_lead_create_failed");
  }
});

app.patch("/api/intranet/student-hub/leads/:id", requireAuth(JWT_SECRET), requireIntranetAccess, async (req, res) => {
  try {
    const user = req.currentUser || await getUserById(req.user.sub);
    const scope = await resolveStudentHubScope(user, req.body?.view_key || "commercial-leads");
    if (!scope.canManageCommercial) return res.status(403).json({ error: "forbidden" });
    const detail = await saveStudentHubLeadRecord(req.body || {}, user, Number(req.params.id));
    res.json({ ok: true, lead: detail });
  } catch (err) {
    sendStudentHubRouteError(res, err, "student_hub_lead_update_failed");
  }
});

app.post("/api/intranet/student-hub/leads/:id/convert", requireAuth(JWT_SECRET), requireIntranetAccess, async (req, res) => {
  try {
    const user = req.currentUser || await getUserById(req.user.sub);
    const scope = await resolveStudentHubScope(user, req.body?.view_key || "commercial-enrollment-conversion");
    if (!scope.canConvertLead) return res.status(403).json({ error: "forbidden" });
    const result = await convertLeadToStudentHubRecord(Number(req.params.id), req.body || {}, user);
    res.json({ ok: true, ...result });
  } catch (err) {
    sendStudentHubRouteError(res, err, "student_hub_lead_convert_failed");
  }
});

app.get("/api/intranet/student-hub/contracts/:id", requireAuth(JWT_SECRET), requireIntranetAccess, async (req, res) => {
  try {
    const user = req.currentUser || await getUserById(req.user.sub);
    const scope = await resolveStudentHubScope(user, req.query?.view_key || "financial-contracts");
    if (!scope.canManageFinancial) return res.status(403).json({ error: "forbidden" });
    const detail = await getStudentHubContractDetail(Number(req.params.id), scope);
    if (!detail) return res.status(404).json({ error: "contract_not_found" });
    res.json(detail);
  } catch (err) {
    sendStudentHubRouteError(res, err, "student_hub_contract_detail_failed");
  }
});

app.post("/api/intranet/student-hub/contracts", requireAuth(JWT_SECRET), requireIntranetAccess, async (req, res) => {
  try {
    const user = req.currentUser || await getUserById(req.user.sub);
    const scope = await resolveStudentHubScope(user, req.body?.view_key || "financial-contracts");
    if (!scope.canManageFinancial) return res.status(403).json({ error: "forbidden" });
    const detail = await saveFinancialContractRecord(req.body || {}, user);
    res.json({ ok: true, contract: detail });
  } catch (err) {
    sendStudentHubRouteError(res, err, "student_hub_contract_create_failed");
  }
});

app.patch("/api/intranet/student-hub/contracts/:id", requireAuth(JWT_SECRET), requireIntranetAccess, async (req, res) => {
  try {
    const user = req.currentUser || await getUserById(req.user.sub);
    const scope = await resolveStudentHubScope(user, req.body?.view_key || "financial-contracts");
    if (!scope.canManageFinancial) return res.status(403).json({ error: "forbidden" });
    const detail = await saveFinancialContractRecord({ ...(req.body || {}), id: Number(req.params.id) }, user);
    res.json({ ok: true, contract: detail });
  } catch (err) {
    sendStudentHubRouteError(res, err, "student_hub_contract_update_failed");
  }
});

app.patch("/api/intranet/student-hub/installments/:id", requireAuth(JWT_SECRET), requireIntranetAccess, async (req, res) => {
  try {
    const user = req.currentUser || await getUserById(req.user.sub);
    const scope = await resolveStudentHubScope(user, req.body?.view_key || "financial-installments");
    if (!scope.canManageFinancial) return res.status(403).json({ error: "forbidden" });
    const installment = await updateFinancialInstallmentRecord(Number(req.params.id), req.body || {}, user);
    res.json({ ok: true, installment });
  } catch (err) {
    sendStudentHubRouteError(res, err, "student_hub_installment_update_failed");
  }
});

function sendAcademicRouteError(res, err, fallback = "academic_request_failed") {
  const message = err?.message || fallback;
  if (message === "academic_access_denied" || message === "forbidden") {
    return res.status(403).json({ error: message });
  }
  if (
    message === "not_found"
    || message === "student_not_found"
    || message === "enrollment_not_found"
    || message === "class_not_found"
    || message === "teacher_profile_not_found"
  ) {
    return res.status(404).json({ error: message === "not_found" ? "not_found" : message });
  }
  return res.status(400).json({ error: message || fallback });
}

function parseAcademicLimit(value, fallback = 60, max = 180) {
  return Math.min(max, Math.max(1, Number(value || fallback)));
}

app.get("/api/intranet/academic/bootstrap", requireAuth(JWT_SECRET), requireIntranetAccess, async (req, res) => {
  try {
    const user = req.currentUser || await getUserById(req.user.sub);
    const academic = await buildAcademicBootstrap(user, req.query || {});
    res.json({ academic });
  } catch (err) {
    sendAcademicRouteError(res, err, "academic_bootstrap_failed");
  }
});

app.post("/api/intranet/academic/import", requireAuth(JWT_SECRET), requireIntranetAccess, academicImportUploadMiddleware, async (req, res) => {
  const uploaded = [
    ...(Array.isArray(req.files?.academic_workbook) ? req.files.academic_workbook : []),
    ...(Array.isArray(req.files?.academic_workbooks) ? req.files.academic_workbooks : []),
    ...(Array.isArray(req.files?.workbook) ? req.files.workbook : []),
    ...(Array.isArray(req.files?.file) ? req.files.file : []),
    ...(Array.isArray(req.files?.files) ? req.files.files : []),
  ].filter((item) => item?.path);
  try {
    const user = req.currentUser || await getUserById(req.user.sub);
    const scope = await resolveAcademicScope(user);
    if (!scope.canImport) {
      return res.status(403).json({ error: "forbidden" });
    }
    if (!uploaded.length) {
      return res.status(400).json({ error: "missing_academic_workbook" });
    }
    const result = await importAcademicWorkbooksBatch({
      workbookFiles: uploaded.map((item) => ({
        path: item.path,
        originalname: item.originalname || path.basename(item.path),
      })),
      actorUserId: user.id || user.sub || null,
    });
    const academic = await buildAcademicBootstrap(user, {});
    res.json({ ok: true, result, academic });
  } catch (err) {
    sendAcademicRouteError(res, err, "academic_import_failed");
  } finally {
    for (const file of uploaded) {
      if (!file?.path) continue;
      fs.promises.unlink(file.path).catch(() => {});
    }
  }
});

app.get("/api/intranet/academic/students", requireAuth(JWT_SECRET), requireIntranetAccess, async (req, res) => {
  try {
    const user = req.currentUser || await getUserById(req.user.sub);
    const scope = await resolveAcademicScope(user);
    const students = await listAcademicStudents(scope, {
      search: req.query?.search,
      status: req.query?.status,
      language: req.query?.language,
      modality: req.query?.modality,
      termCode: req.query?.term_code,
      limit: parseAcademicLimit(req.query?.limit, 80, 240),
    });
    res.json({ students });
  } catch (err) {
    sendAcademicRouteError(res, err, "academic_students_list_failed");
  }
});

app.post("/api/intranet/academic/students", requireAuth(JWT_SECRET), requireIntranetAccess, async (req, res) => {
  try {
    const user = req.currentUser || await getUserById(req.user.sub);
    const scope = await resolveAcademicScope(user);
    if (!scope.canManageAll) {
      return res.status(403).json({ error: "forbidden" });
    }
    const student = await saveAcademicStudentRecord(req.body || {}, user.id || user.sub || null);
    await replaceStudentGuardians(student.id, req.body?.guardians || [], user.id || user.sub || null);
    const detail = await getAcademicStudentDetail(student.id, scope);
    res.json({ ok: true, ...detail });
  } catch (err) {
    sendAcademicRouteError(res, err, "academic_student_create_failed");
  }
});

app.get("/api/intranet/academic/students/:id", requireAuth(JWT_SECRET), requireIntranetAccess, async (req, res) => {
  try {
    const user = req.currentUser || await getUserById(req.user.sub);
    const scope = await resolveAcademicScope(user);
    const detail = await getAcademicStudentDetail(Number(req.params.id), scope);
    if (!detail) {
      return res.status(404).json({ error: "student_not_found" });
    }
    res.json(detail);
  } catch (err) {
    sendAcademicRouteError(res, err, "academic_student_detail_failed");
  }
});

app.patch("/api/intranet/academic/students/:id", requireAuth(JWT_SECRET), requireIntranetAccess, async (req, res) => {
  try {
    const user = req.currentUser || await getUserById(req.user.sub);
    const scope = await resolveAcademicScope(user);
    if (!scope.canManageAll) {
      return res.status(403).json({ error: "forbidden" });
    }
    const student = await saveAcademicStudentRecord({
      ...(req.body || {}),
      id: Number(req.params.id),
    }, user.id || user.sub || null);
    if (Array.isArray(req.body?.guardians)) {
      await replaceStudentGuardians(student.id, req.body.guardians, user.id || user.sub || null);
    }
    const detail = await getAcademicStudentDetail(student.id, scope);
    res.json({ ok: true, ...detail });
  } catch (err) {
    sendAcademicRouteError(res, err, "academic_student_update_failed");
  }
});

app.get("/api/intranet/academic/students/:id/attendance", requireAuth(JWT_SECRET), requireIntranetAccess, async (req, res) => {
  try {
    const user = req.currentUser || await getUserById(req.user.sub);
    const scope = await resolveAcademicScope(user);
    const detail = await getAcademicStudentDetail(Number(req.params.id), scope);
    if (!detail) {
      return res.status(404).json({ error: "student_not_found" });
    }
    const items = await all(
      `SELECT ar.*, c.name AS class_name
         FROM attendance_records ar
         JOIN enrollments e ON e.id = ar.enrollment_id
         LEFT JOIN classes c ON c.id = ar.class_id
        WHERE e.student_id=?
        ORDER BY ar.class_date DESC, ar.id DESC
        LIMIT ?`,
      [Number(req.params.id), parseAcademicLimit(req.query?.limit, 120, 400)]
    );
    res.json({ student: detail.student, attendance: items });
  } catch (err) {
    sendAcademicRouteError(res, err, "academic_student_attendance_failed");
  }
});

app.get("/api/intranet/academic/enrollments", requireAuth(JWT_SECRET), requireIntranetAccess, async (req, res) => {
  try {
    const user = req.currentUser || await getUserById(req.user.sub);
    const scope = await resolveAcademicScope(user);
    const enrollments = await listAcademicEnrollments(scope, {
      search: req.query?.search,
      status: req.query?.status,
      classId: req.query?.class_id,
      language: req.query?.language,
      modality: req.query?.modality,
      teacherName: req.query?.teacher,
      termCode: req.query?.term_code,
      limit: parseAcademicLimit(req.query?.limit, 100, 260),
    });
    res.json({ enrollments });
  } catch (err) {
    sendAcademicRouteError(res, err, "academic_enrollments_list_failed");
  }
});

app.post("/api/intranet/academic/enrollments", requireAuth(JWT_SECRET), requireIntranetAccess, async (req, res) => {
  try {
    const user = req.currentUser || await getUserById(req.user.sub);
    const scope = await resolveAcademicScope(user);
    if (!scope.canManageAll) {
      return res.status(403).json({ error: "forbidden" });
    }
    const enrollment = await saveAcademicEnrollmentRecord(req.body || {}, user);
    const detail = await getAcademicEnrollmentDetail(enrollment.id, scope);
    res.json({ ok: true, ...detail });
  } catch (err) {
    sendAcademicRouteError(res, err, "academic_enrollment_create_failed");
  }
});

app.get("/api/intranet/academic/enrollments/:id", requireAuth(JWT_SECRET), requireIntranetAccess, async (req, res) => {
  try {
    const user = req.currentUser || await getUserById(req.user.sub);
    const scope = await resolveAcademicScope(user);
    const detail = await getAcademicEnrollmentDetail(Number(req.params.id), scope);
    if (!detail) {
      return res.status(404).json({ error: "enrollment_not_found" });
    }
    res.json(detail);
  } catch (err) {
    sendAcademicRouteError(res, err, "academic_enrollment_detail_failed");
  }
});

app.patch("/api/intranet/academic/enrollments/:id", requireAuth(JWT_SECRET), requireIntranetAccess, async (req, res) => {
  try {
    const user = req.currentUser || await getUserById(req.user.sub);
    const scope = await resolveAcademicScope(user);
    if (!scope.canManageAll) {
      return res.status(403).json({ error: "forbidden" });
    }
    const enrollment = await saveAcademicEnrollmentRecord({
      ...(req.body || {}),
      id: Number(req.params.id),
    }, user);
    const detail = await getAcademicEnrollmentDetail(enrollment.id, scope);
    res.json({ ok: true, ...detail });
  } catch (err) {
    sendAcademicRouteError(res, err, "academic_enrollment_update_failed");
  }
});

app.post("/api/intranet/academic/enrollments/:id/transfer-class", requireAuth(JWT_SECRET), requireIntranetAccess, async (req, res) => {
  try {
    const user = req.currentUser || await getUserById(req.user.sub);
    const detail = await transferAcademicEnrollmentClass(Number(req.params.id), req.body || {}, user);
    res.json({ ok: true, ...detail });
  } catch (err) {
    sendAcademicRouteError(res, err, "academic_class_transfer_failed");
  }
});

app.post("/api/intranet/academic/enrollments/:id/change-schedule", requireAuth(JWT_SECRET), requireIntranetAccess, async (req, res) => {
  try {
    const user = req.currentUser || await getUserById(req.user.sub);
    const detail = await changeAcademicEnrollmentSchedule(Number(req.params.id), req.body || {}, user);
    res.json({ ok: true, ...detail });
  } catch (err) {
    sendAcademicRouteError(res, err, "academic_schedule_change_failed");
  }
});

app.get("/api/intranet/academic/classes", requireAuth(JWT_SECRET), requireIntranetAccess, async (req, res) => {
  try {
    const user = req.currentUser || await getUserById(req.user.sub);
    const scope = await resolveAcademicScope(user);
    const classes = await listAcademicClasses(scope, {
      search: req.query?.search,
      status: req.query?.status,
      language: req.query?.language,
      modality: req.query?.modality,
      teacherName: req.query?.teacher,
      termCode: req.query?.term_code,
      limit: parseAcademicLimit(req.query?.limit, 80, 200),
    });
    res.json({ classes });
  } catch (err) {
    sendAcademicRouteError(res, err, "academic_classes_list_failed");
  }
});

app.post("/api/intranet/academic/classes", requireAuth(JWT_SECRET), requireIntranetAccess, async (req, res) => {
  try {
    const user = req.currentUser || await getUserById(req.user.sub);
    const scope = await resolveAcademicScope(user);
    if (!scope.canManageAll) {
      return res.status(403).json({ error: "forbidden" });
    }
    const classRow = await ensureAcademicClassRecord(req.body || {});
    await syncAcademicClassSchedules(classRow.id, Array.isArray(req.body?.schedules) ? req.body.schedules : []);
    const teacherUserIds = [
      ...(Array.isArray(req.body?.teacher_user_ids) ? req.body.teacher_user_ids : []),
      req.body?.teacher_user_id,
    ].map((item) => Number(item || 0)).filter(Boolean);
    for (const teacherUserId of [...new Set(teacherUserIds)]) {
      await ensureClassTeacherLink(classRow.id, teacherUserId, {
        role_in_class: req.body?.role_in_class || "teacher",
        start_date: req.body?.teacher_start_date,
        end_date: req.body?.teacher_end_date,
        is_active: req.body?.teacher_is_active !== false,
      });
    }
    const detail = await getAcademicClassDetail(classRow.id, scope);
    res.json({ ok: true, ...detail });
  } catch (err) {
    sendAcademicRouteError(res, err, "academic_class_create_failed");
  }
});

app.get("/api/intranet/academic/classes/:id", requireAuth(JWT_SECRET), requireIntranetAccess, async (req, res) => {
  try {
    const user = req.currentUser || await getUserById(req.user.sub);
    const scope = await resolveAcademicScope(user);
    const detail = await getAcademicClassDetail(Number(req.params.id), scope);
    if (!detail) {
      return res.status(404).json({ error: "class_not_found" });
    }
    res.json(detail);
  } catch (err) {
    sendAcademicRouteError(res, err, "academic_class_detail_failed");
  }
});

app.patch("/api/intranet/academic/classes/:id", requireAuth(JWT_SECRET), requireIntranetAccess, async (req, res) => {
  try {
    const user = req.currentUser || await getUserById(req.user.sub);
    const scope = await resolveAcademicScope(user);
    if (!scope.canManageAll) {
      return res.status(403).json({ error: "forbidden" });
    }
    const classRow = await ensureAcademicClassRecord({
      ...(req.body || {}),
      id: Number(req.params.id),
    });
    if (Array.isArray(req.body?.schedules)) {
      await syncAcademicClassSchedules(classRow.id, req.body.schedules);
    }
    const detail = await getAcademicClassDetail(classRow.id, scope);
    res.json({ ok: true, ...detail });
  } catch (err) {
    sendAcademicRouteError(res, err, "academic_class_update_failed");
  }
});

app.get("/api/intranet/academic/classes/:id/schedules", requireAuth(JWT_SECRET), requireIntranetAccess, async (req, res) => {
  try {
    const user = req.currentUser || await getUserById(req.user.sub);
    const scope = await resolveAcademicScope(user);
    if (!(await canAccessAcademicClass(scope, Number(req.params.id)))) {
      return res.status(403).json({ error: "forbidden" });
    }
    const schedules = await listClassSchedulesByClassId(Number(req.params.id));
    res.json({ schedules });
  } catch (err) {
    sendAcademicRouteError(res, err, "academic_class_schedules_failed");
  }
});

app.post("/api/intranet/academic/classes/:id/teachers", requireAuth(JWT_SECRET), requireIntranetAccess, async (req, res) => {
  try {
    const user = req.currentUser || await getUserById(req.user.sub);
    const scope = await resolveAcademicScope(user);
    if (!scope.canManageAll) {
      return res.status(403).json({ error: "forbidden" });
    }
    const classId = Number(req.params.id);
    let teacherUserId = Number(req.body?.user_id || 0) || null;
    if (!teacherUserId && Number(req.body?.teacher_profile_id || 0)) {
      const profile = await get("SELECT user_id FROM teacher_profiles WHERE id=? LIMIT 1", [Number(req.body.teacher_profile_id)]);
      teacherUserId = Number(profile?.user_id || 0) || null;
    }
    if (!teacherUserId) {
      return res.status(400).json({ error: "teacher_profile_not_found" });
    }
    await ensureClassTeacherLink(classId, teacherUserId, req.body || {});
    const detail = await getAcademicClassDetail(classId, scope);
    res.json({ ok: true, ...detail });
  } catch (err) {
    sendAcademicRouteError(res, err, "academic_class_teacher_link_failed");
  }
});

app.get("/api/intranet/academic/classes/:id/students", requireAuth(JWT_SECRET), requireIntranetAccess, async (req, res) => {
  try {
    const user = req.currentUser || await getUserById(req.user.sub);
    const scope = await resolveAcademicScope(user);
    const detail = await getAcademicClassDetail(Number(req.params.id), scope);
    if (!detail) {
      return res.status(404).json({ error: "class_not_found" });
    }
    res.json({ class: detail.class, students: detail.students });
  } catch (err) {
    sendAcademicRouteError(res, err, "academic_class_students_failed");
  }
});

app.get("/api/intranet/academic/classes/:id/sessions", requireAuth(JWT_SECRET), requireIntranetAccess, async (req, res) => {
  try {
    const user = req.currentUser || await getUserById(req.user.sub);
    const scope = await resolveAcademicScope(user);
    const detail = await getAcademicClassDetail(Number(req.params.id), scope);
    if (!detail) {
      return res.status(404).json({ error: "class_not_found" });
    }
    res.json({ class: detail.class, sessions: detail.sessions });
  } catch (err) {
    sendAcademicRouteError(res, err, "academic_class_sessions_failed");
  }
});

app.post("/api/intranet/academic/classes/:id/sessions", requireAuth(JWT_SECRET), requireIntranetAccess, async (req, res) => {
  try {
    const user = req.currentUser || await getUserById(req.user.sub);
    const session = await saveAcademicClassSession(Number(req.params.id), req.body || {}, user);
    res.json({ ok: true, session });
  } catch (err) {
    sendAcademicRouteError(res, err, "academic_session_save_failed");
  }
});

app.get("/api/intranet/academic/classes/:id/attendance", requireAuth(JWT_SECRET), requireIntranetAccess, async (req, res) => {
  try {
    const user = req.currentUser || await getUserById(req.user.sub);
    const scope = await resolveAcademicScope(user);
    const classId = Number(req.params.id);
    if (!(await canAccessAcademicClass(scope, classId))) {
      return res.status(403).json({ error: "forbidden" });
    }
    const classDate = normalizeAcademicDateInput(req.query?.class_date) || brazilDateKey();
    const items = await all(
      `SELECT ar.*, s.full_name AS student_name
         FROM attendance_records ar
         JOIN enrollments e ON e.id = ar.enrollment_id
         JOIN students s ON s.id = e.student_id
        WHERE ar.class_id=? AND ar.class_date=?
        ORDER BY lower(s.full_name) ASC`,
      [classId, classDate]
    );
    res.json({ class_id: classId, class_date: classDate, attendance: items });
  } catch (err) {
    sendAcademicRouteError(res, err, "academic_attendance_list_failed");
  }
});

app.post("/api/intranet/academic/classes/:id/attendance", requireAuth(JWT_SECRET), requireIntranetAccess, async (req, res) => {
  try {
    const user = req.currentUser || await getUserById(req.user.sub);
    const attendance = await saveAcademicAttendance(Number(req.params.id), req.body || {}, user);
    res.json({ ok: true, attendance });
  } catch (err) {
    sendAcademicRouteError(res, err, "academic_attendance_save_failed");
  }
});

app.get("/api/intranet/academic/teachers", requireAuth(JWT_SECRET), requireIntranetAccess, async (req, res) => {
  try {
    const user = req.currentUser || await getUserById(req.user.sub);
    const scope = await resolveAcademicScope(user);
    const teachers = await listAcademicTeacherProfiles(scope);
    res.json({ teachers });
  } catch (err) {
    sendAcademicRouteError(res, err, "academic_teachers_list_failed");
  }
});

app.get("/api/intranet/academic/me/classes", requireAuth(JWT_SECRET), requireIntranetAccess, async (req, res) => {
  try {
    const user = req.currentUser || await getUserById(req.user.sub);
    const scope = await resolveAcademicScope(user);
    const classes = await listAcademicClasses(scope, {
      search: req.query?.search,
      status: req.query?.status,
      limit: parseAcademicLimit(req.query?.limit, 80, 200),
    });
    res.json({ classes });
  } catch (err) {
    sendAcademicRouteError(res, err, "academic_teacher_classes_failed");
  }
});

app.get("/api/intranet/academic/dashboard/pedagogical", requireAuth(JWT_SECRET), requireIntranetAccess, async (req, res) => {
  try {
    const user = req.currentUser || await getUserById(req.user.sub);
    const scope = await resolveAcademicScope(user);
    if (!scope.canManageAll) {
      return res.status(403).json({ error: "forbidden" });
    }
    const dashboard = await buildAcademicDashboard(scope);
    res.json({ dashboard });
  } catch (err) {
    sendAcademicRouteError(res, err, "academic_dashboard_failed");
  }
});

app.get("/api/intranet/academic/dashboard/teacher", requireAuth(JWT_SECRET), requireIntranetAccess, async (req, res) => {
  try {
    const user = req.currentUser || await getUserById(req.user.sub);
    const scope = await resolveAcademicScope(user);
    if (scope.kind !== "teacher" && !scope.canManageAll) {
      return res.status(403).json({ error: "forbidden" });
    }
    const dashboard = await buildAcademicDashboard(scope);
    res.json({ dashboard });
  } catch (err) {
    sendAcademicRouteError(res, err, "academic_teacher_dashboard_failed");
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
  try {
    const payload = await buildIntranetPayload(req.user.sub);
    res.json(payload || { user: null, intranet: null, department_catalog: [] });
  } catch (error) {
    console.error("[intranet.bootstrap] request_failed", {
      message: error?.message || String(error || "unknown_error"),
    });
    res.status(500).json({ error: error?.message || "intranet_bootstrap_failed" });
  }
});

function redirectAuthenticatedHome(req, res) {
  const user = req.session?.user || tryDecodeSession(req);
  if (!user) return res.redirect("/login.html");
  return res.redirect("/intranet.html");
}

app.get("/", redirectAuthenticatedHome);
app.get("/login.html", (req, res) => sendNoCacheFile(res, path.join(publicDir, "login.html")));

app.get("/index.html", redirectAuthenticatedHome);

app.get("/admin.html", (req, res) => {
  const user = tryDecodeSession(req);
  if (!user) return res.redirect("/login.html");
  if (user.role !== "admin") return res.redirect("/intranet.html");
  return sendNoCacheFile(res, path.join(publicDir, "admin.html"));
});

app.get("/intranet.html", async (req, res) => {
  const session = tryDecodeSession(req);
  if (!session) return res.redirect("/login.html");
  const user = await getUserById(session.sub);
  if (!user || !hasIntranetAccess(user)) return res.redirect("/login.html");
  return sendNoCacheFile(res, path.join(publicDir, "intranet.html"));
});

app.use(express.static(publicDir));

let startupBootstrapPromise = null;


async function runStartupBootstrap() {
  if (startupBootstrapPromise) return startupBootstrapPromise;

  startupBootstrapPromise = (async () => {
    await migrate();

    try {
      await importLegacySqliteIntoPostgres();
      startupLogger.info("Migracao legada SQLite -> Postgres concluida.");
    } catch (err) {
      startupLogger.error("Migracao legada falhou, mas o servidor continua.", {
        message: err?.message || String(err || "legacy_migration_failed"),
      });
    }

    await ensureAdmin();
    await ensureDepartmentCatalog();
    await ensureDepartmentSubmenus();
    await ensureMarketingIndicatorSeeds();
    await ensureCalendarEventTypes();
    await syncLegacyUserDepartmentData();
    await ensureFixedDepartments();
    await ensureOperationalDepartmentUsers();
    await ensureAcademicClassSessionsSeed();
    await ensureAcademicTimelineBackfill();

    const incompatibleCleanup = await purgeIncompatibleKnowledgeAssets(null);
    if (
      incompatibleCleanup.removed_sources
      || incompatibleCleanup.removed_documents
      || incompatibleCleanup.removed_local_files
      || incompatibleCleanup.removed_transcripts
    ) {
      startupLogger.info("Limpeza de arquivos incompatíveis concluida.", incompatibleCleanup);
    }

  })().catch((err) => {
    startupLogger.error("Falha no bootstrap assincrono do servidor.", {
      message: err?.message || String(err || "startup_bootstrap_failed"),
    });
    return null;
  });

  return startupBootstrapPromise;
}

function validateRuntimeConfiguration() {
  const issues = [];

  if (IS_PRODUCTION && !String(JWT_SECRET || "").trim()) {
    issues.push("JWT_SECRET ausente em producao");
  }

  if (IS_PRODUCTION && !DATABASE_URL_PRESENT) {
    issues.push("DATABASE_URL ausente em producao");
  }

  if (IS_PRODUCTION && DB_CLIENT !== "postgres") {
    issues.push("cliente efetivo do banco nao esta em Postgres em producao");
  }

  if (MAX_UPLOAD_SIZE_BYTES <= 0) {
    issues.push("MAX_UPLOAD_SIZE_MB invalido");
  }

    if (issues.length) {
      startupLogger.error("Falha de configuracao critica na inicializacao.", {
        issues,
        db_client: DB_CLIENT,
        db_runtime: DB_RUNTIME_CONFIG,
        is_production: IS_PRODUCTION,
      });
      throw new Error(`runtime_configuration_invalid: ${issues.join("; ")}`);
    }
  }

function startServer() {
  validateRuntimeConfiguration();
  startupLogger.info("Inicializando servidor.", {
    db_client_requested: REQUESTED_DB_CLIENT || null,
    db_client_selected: DB_CLIENT,
    database_url_present: DATABASE_URL_PRESENT,
    sqlite_path: DB_CLIENT === "sqlite" ? DB_RUNTIME_CONFIG.sqlite_path : null,
    postgres_host: DB_CLIENT === "postgres" ? POSTGRES_HOST || null : null,
    data_dir: DATA_DIR,
    max_upload_size_mb: MAX_UPLOAD_SIZE_MB,
    max_concurrent_jobs: MAX_CONCURRENT_JOBS,
  });

  app.listen(PORT, () => {
    startupLogger.info("Servidor HTTP iniciado.", {
      port: PORT,
      base_url: BASE_URL,
      db_client: DB_CLIENT,
    });

    setTimeout(() => {
      runStartupBootstrap().catch((err) => {
        startupLogger.error("Falha no bootstrap pos-start.", {
          message: err?.message || String(err || "startup_bootstrap_failed"),
        });
      });
    }, 2000);
  });
}

startServer();





























