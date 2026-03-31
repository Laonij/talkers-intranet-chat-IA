"use strict";

const path = require("path");
const XLSX = require("xlsx");
const { hashText } = require("./semantic");
const { normalizeLanguageCode, repairMojibakeText } = require("./language");

const ACADEMIC_PRIMARY_SHEET = "MATRICULAS NOVAS";
const ACADEMIC_PRESENTIAL_PRIMARY_SHEET = "Matrículas";
const ACADEMIC_TIMETABLE_SHEETS = new Set([
  "2 e 4 ONLINE",
  "3 e 5 ONLINE",
  "Sexta ONLINE",
  "Sáb ONLINE",
  "Sab ONLINE",
  "2 e 4 PRESENCIAL",
  "3 e 5 PRESENCIAL",
  "Sexta PRESENCIAL",
  "SÃ¡b PRESENCIAL",
  "Sáb PRESENCIAL",
  "SÃ¡b PRESENCIAL",
  "Sab PRESENCIAL",
  "INTENSIVO INVERNO 2024.2",
  "TIME INTENSIVO",
]);
const ACADEMIC_STATUS_SHEETS = {
  desistentes: "Desistentes",
  trancados: "TRANCADOS",
};
const ACADEMIC_SHEET_ALIASES = {
  vip: new Set(["VIPS"]),
  intensivoVerao: new Set(["INTENSIVO VERÃO 2026", "INTENSIVO VERÃƒO 2026", "INTENSIVO VERAO 2026"]),
  remanejamento: new Set(["REMANEJAR 2026.1"]),
  reversao: new Set([" Reversão Pedagógico", "Reversão Pedagógico", " ReversÃ£o PedagÃ³gico", "ReversÃ£o PedagÃ³gico", "REVERSAO PEDAGOGICO"]),
  cancelamentos: new Set(["Cancelamentos Comerciais"]),
  agendamentos: new Set(["Agendamentos"]),
  summary: new Set(["2026.1 resumo"]),
  specialProject: new Set(["TARDES MÁGICAS", "TARDES MAGICAS", "TARDES MÃGICAS"]),
};
const ACADEMIC_IGNORED_SHEETS = new Set([
  "$$$",
  "Página13",
  "Pagina13",
  "Planilha7",
  "Planilha6",
  "Planilha5",
  "Planilha3",
  "Planilha2",
  "Planilha1",
]);
const ACADEMIC_AUXILIARY_SHEETS = new Set([
  "LIVROS",
  "LIVROS ",
  "Curso Online",
  "Escolas",
  "Biblioteca",
  "Empresas Parceiras",
]);

const TEACHER_PREFIX_RE = /\b(?:teacher|professor|professora|maestro|maestra)\b/gi;
const TEACHER_ALIAS_MAP = new Map([
  ["natally", "nataly"],
  ["nataly", "nataly"],
  ["ntathallia", "nathallia"],
  ["nathallia g", "nathallia"],
  ["rodolpho", "rodolpho"],
  ["matheus susi", "matheus susi"],
  ["matheus s", "matheus susi"],
  ["matheous susi", "matheus susi"],
  ["mateheus susi", "matheus susi"],
  ["mateus premium", "mateus"],
  ["techer juliana", "juliana"],
  ["mateus p", "mateus pagnussat"],
  ["mateus pagnussat", "mateus pagnussat"],
  ["mateus pagnussat", "mateus pagnussat"],
  ["mateus pagnussatt", "mateus pagnussat"],
  ["taina premium", "taina"],
  ["thais c", "thais castro"],
  ["thais castro", "thais castro"],
  ["thais corte", "thais corte batista"],
  ["thais lino", "thais lino"],
  ["thais corte batista", "thais corte batista"],
  ["virginia", "virginia"],
  ["angelo", "angelo"],
  ["ângelo", "angelo"],
]);

const TEACHER_INVALID_NORMALIZED_VALUES = new Set([
  "teacher",
  "modalidade",
  "premium",
  "hs",
  "sim",
  "datas diferentes",
]);

const CLASS_DESCRIPTOR_KEYWORDS = [
  "starter",
  "elementary",
  "pre intermediate",
  "pre-intermediate",
  "intermediate",
  "upper",
  "new i learn",
  "experiencias",
  "experiências",
  "defi",
  "défi",
  "italiano",
  "espanhol",
  "frances",
  "francês",
  "ingles",
  "inglês",
  "home school",
  "hs",
  "vip",
  "online",
  "segunda",
  "segundas",
  "terca",
  "terça",
  "terças",
  "quarta",
  "quintas",
  "sexta",
  "sáb",
  "sab",
  "intensivo",
  "semestre",
  "2026.1",
  "2026.2",
  "2025.1",
  "2025.2",
  "2024.2",
];
const OPERATIONAL_NOTE_KEYWORDS = [
  "wpp",
  "sponte",
  "início",
  "inicio",
  "pacote",
  "influencer",
  "entra em",
  "ouvinte",
  "grupo",
  "avisa",
  "avisar",
  "sem grupo",
  "vai para",
  "mais horários",
  "horário semanalmente",
  "horario semanalmente",
];

function sanitizeWorkbookName(value = "") {
  return path.basename(String(value || "").trim() || "academic-workbook.xlsx");
}

function normalizeAcademicText(value = "") {
  return String(repairMojibakeText(value || "") || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function toVisibleString(value) {
  if (value === null || value === undefined) return "";
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString();
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return Number.isInteger(value) ? String(value) : String(value).replace(/\.0+$/, "");
  }
  return String(repairMojibakeText(value) || "").replace(/\s+/g, " ").trim();
}

function isExcelDateNumber(value) {
  return typeof value === "number" && Number.isFinite(value) && value > 30000 && value < 70000;
}

function excelSerialToIso(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  if (!isExcelDateNumber(value)) {
    const asText = String(value || "").trim();
    if (!asText) return "";
    const parsed = new Date(asText);
    return Number.isNaN(parsed.getTime()) ? asText : parsed.toISOString().slice(0, 10);
  }
  const utcDays = Math.floor(Number(value) - 25569);
  const utcValue = utcDays * 86400;
  const dateInfo = new Date(utcValue * 1000);
  if (Number.isNaN(dateInfo.getTime())) return "";
  return dateInfo.toISOString().slice(0, 10);
}

function excelTimeToHHmm(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(11, 16);
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    const totalMinutes = Math.round((value % 1) * 24 * 60);
    if (!Number.isFinite(totalMinutes)) return "";
    const hours = Math.floor(totalMinutes / 60) % 24;
    const minutes = totalMinutes % 60;
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
  }
  const safe = String(value || "").trim();
  if (!safe) return "";
  if (/^\d{2}:\d{2}$/.test(safe)) return safe;
  const parsed = new Date(safe);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString().slice(11, 16);
}

function deriveSemesterCode(value = "") {
  const safe = String(value || "").trim();
  if (!safe) return "";
  const directMatch = safe.match(/\b(20\d{2}\.[12])\b/);
  if (directMatch) return directMatch[1];
  const iso = excelSerialToIso(value);
  const parsed = iso ? new Date(iso) : null;
  if (parsed && !Number.isNaN(parsed.getTime())) {
    const year = parsed.getUTCFullYear();
    const month = parsed.getUTCMonth() + 1;
    return `${year}.${month <= 6 ? 1 : 2}`;
  }
  return "";
}

function deriveSchoolTermName(code = "") {
  const safe = String(code || "").trim();
  if (!safe) return "";
  return `Semestre ${safe}`;
}

function normalizeWhitespace(value = "") {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function mergeUniqueStrings(...groups) {
  const out = [];
  const seen = new Set();
  for (const group of groups) {
    for (const item of Array.isArray(group) ? group : []) {
      const safe = normalizeWhitespace(item);
      if (!safe) continue;
      const key = normalizeAcademicText(safe);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(safe);
    }
  }
  return out;
}

function toTitleCase(value = "") {
  return normalizeWhitespace(value)
    .split(" ")
    .filter(Boolean)
    .map((token) => token.charAt(0).toUpperCase() + token.slice(1).toLowerCase())
    .join(" ");
}

function stripTeacherDescriptorText(value = "") {
  const safe = normalizeWhitespace(String(value || ""));
  if (!safe) return "";
  return normalizeWhitespace(
    safe
      .replace(/\([^)]*\)/g, " ")
      .replace(/\s+-\s*(?=(?:starter|elementary|pre[\s-]?inter|intermediate|upper|new i learn|experiencias|defi|italiano|espanhol|frances|ingles|vip|premium|intensivo|online|presencial|home school|hs)\b).*$/i, " ")
      .replace(/\b(?:premium|vip|semi vip|semi-vip|home school|hs)\b$/i, " ")
      .replace(TEACHER_PREFIX_RE, " ")
  );
}

function isPlausibleTeacherName(value = "") {
  const safe = normalizeWhitespace(String(value || ""));
  if (!safe) return false;
  if (safe.length > 80) return false;
  if (/\d/.test(safe)) return false;
  const normalized = normalizeAcademicText(safe);
  if (!normalized || TEACHER_INVALID_NORMALIZED_VALUES.has(normalized)) return false;
  if (OPERATIONAL_NOTE_KEYWORDS.some((keyword) => normalized.includes(normalizeAcademicText(keyword)))) return false;
  if (/(^| )(?:modalidade|premium|sim|nao|profe|avisei|bolsa|paga|pagar|grupo|horario|inicio|abril|frances|ingles|online|presencial|intensivo|starter|elementary|semestre)( |$)/.test(normalized)) {
    return false;
  }
  const tokens = normalized.split(" ").filter(Boolean);
  if (!tokens.length || tokens.length > 4) return false;
  return tokens.every((token, index) => {
    if (/^[a-z]{2,}$/.test(token)) return true;
    return index === tokens.length - 1 && /^[a-z]$/.test(token);
  });
}

function looksLikeTeacherAnchor(value = "") {
  const raw = normalizeWhitespace(String(value || ""));
  if (!raw) return false;
  if (/(teacher|professor|professora|maestro|maestra)/i.test(raw)) return true;
  const alphaOnly = normalizeWhitespace(raw.replace(/[^A-Za-zÀ-ÿ\s]/g, " "));
  if (!alphaOnly) return false;
  return alphaOnly === alphaOnly.toUpperCase() && isPlausibleTeacherName(alphaOnly);
}

function stripTrailingStudentAnnotations(value = "") {
  return normalizeWhitespace(String(value || "")
    .replace(/\([^)]*\)/g, " ")
    .replace(/\s+-\s*\d+\b.*$/g, " ")
    .replace(/\s+-\s*ok\b.*$/i, " ")
    .replace(/\s+\b(?:ok|inter|pre inter|pre-inter|ouvinte)\b.*$/i, " "));
}

function normalizePersonKey(value = "") {
  return normalizeAcademicText(stripTrailingStudentAnnotations(value));
}

function detectLanguageFromText(value = "") {
  const safe = normalizeAcademicText(value);
  if (!safe) return "";
  if (safe.includes("frances") || safe.includes("francais") || safe.includes("french")) return "Francês";
  if (safe.includes("italiano") || safe.includes("italian")) return "Italiano";
  if (safe.includes("espanhol") || safe.includes("spanish")) return "Espanhol";
  if (safe.includes("ingles") || safe.includes("english")) return "Inglês";
  return "";
}

function detectModalityFromText(value = "") {
  const safe = normalizeAcademicText(value);
  if (!safe) return "";
  if (safe.includes("home school") || safe.includes("hs")) return "home-school";
  if (safe.includes("online")) return "online";
  if (safe.includes("semi vip") || safe.includes("semi-vip")) return "semi-vip";
  if (safe.includes("vip")) return "vip";
  if (safe.includes("presencial")) return "presencial";
  return "";
}

function detectWeekdaysFromText(value = "") {
  const safe = normalizeAcademicText(value);
  const map = [
    ["segunda", "segunda"],
    ["segundas", "segunda"],
    ["terca", "terca"],
    ["tercas", "terca"],
    ["quarta", "quarta"],
    ["quartas", "quarta"],
    ["quinta", "quinta"],
    ["quintas", "quinta"],
    ["sexta", "sexta"],
    ["sextas", "sexta"],
    ["sab", "sabado"],
    ["sabado", "sabado"],
    ["sáb", "sabado"],
    ["sábado", "sabado"],
  ];
  const found = [];
  for (const [pattern, label] of map) {
    if (safe.includes(pattern) && !found.includes(label)) found.push(label);
  }
  return found;
}

function detectLevelNameFromText(value = "") {
  const safe = normalizeWhitespace(repairMojibakeText(value || ""));
  if (!safe) return "";
  const match = safe.match(/\b(?:STARTER|ELEMENTARY|PRE[\s-]?INTER(?:MEDIATE)?|INTERMEDIATE|UPPER|NEW I LEARN|EXPERIENCIAS|EXPERIÊNCIAS|D[ÉE]FI|ITALIANO)\b[^()\-]*/i);
  return normalizeWhitespace(match?.[0] || safe);
}

function detectAcademicClassKind(value = "", fallback = "regular") {
  const safe = normalizeAcademicText(value);
  if (!safe) return fallback;
  if (safe.includes("semi vip") || safe.includes("semi-vip")) return "semi_vip";
  if (safe.includes("vip")) return "vip";
  if (safe.includes("intensivo") || safe.includes("intensive")) return "intensive";
  if (safe.includes("tardes magicas") || safe.includes("projeto")) return "special_project";
  return fallback;
}

function buildProgramName(language = "", levelName = "", modality = "") {
  const parts = [levelName, language, modality].filter(Boolean);
  return parts.join(" - ") || levelName || language || modality || "Programa acadêmico";
}

function parseTeacherHeader(rawValue = "", options = {}) {
  const raw = normalizeWhitespace(String(rawValue || ""));
  if (!raw) return null;
  const normalized = normalizeAcademicText(raw);
  const requireHeaderSignal = options?.requireHeaderSignal !== false;
  const specialties = [];
  const parentheticalMatches = [...raw.matchAll(/\(([^)]+)\)/g)];
  parentheticalMatches.forEach((match) => {
    const text = normalizeWhitespace(match[1] || "");
    if (text) specialties.push(text);
  });
  const displayBase = stripTeacherDescriptorText(raw);
  const displayName = toTitleCase(displayBase || raw);
  if (!isPlausibleTeacherName(displayName)) return null;
  if (requireHeaderSignal && !looksLikeTeacherAnchor(raw)) return null;
  const normalizedName = TEACHER_ALIAS_MAP.get(normalizeAcademicText(displayName)) || normalizeAcademicText(displayName);
  return {
    raw_header: raw,
    display_name: displayName,
    normalized_name: normalizedName,
    aliases: Array.from(new Set([displayName, raw].filter(Boolean))),
    specialties,
  };
}

function buildTeacherIdentity(rawValue = "", extraSpecialties = []) {
  const parsed = parseTeacherHeader(rawValue, { requireHeaderSignal: false });
  if (parsed) {
    return {
      ...parsed,
      specialties: Array.from(new Set([...(parsed.specialties || []), ...(Array.isArray(extraSpecialties) ? extraSpecialties : [extraSpecialties]).filter(Boolean)])),
    };
  }
  const displayName = toTitleCase(stripTeacherDescriptorText(rawValue));
  if (!isPlausibleTeacherName(displayName)) return null;
  const normalizedName = TEACHER_ALIAS_MAP.get(normalizeAcademicText(displayName)) || normalizeAcademicText(displayName);
  return {
    raw_header: normalizeWhitespace(String(rawValue || "")),
    display_name: displayName,
    normalized_name: normalizedName,
    aliases: Array.from(new Set([displayName, normalizeWhitespace(String(rawValue || ""))].filter(Boolean))),
    specialties: Array.from(new Set((Array.isArray(extraSpecialties) ? extraSpecialties : [extraSpecialties]).filter(Boolean))),
  };
}

function getSheetRows(workbook, sheetName) {
  const sheet = workbook?.Sheets?.[sheetName];
  if (!sheet) return [];
  return XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    raw: true,
    defval: "",
    blankrows: false,
  });
}

function buildHeaderDescriptor(row = []) {
  return row.map((cell, index) => ({
    index,
    original: toVisibleString(cell),
    normalized: normalizeAcademicText(cell),
  }));
}

function findColumnIndex(header = [], patterns = []) {
  for (const pattern of patterns) {
    const found = header.find((cell) => pattern.test(cell.normalized));
    if (found) return found.index;
  }
  return -1;
}

function inferEnrollmentColumnMap(header = []) {
  return {
    countIndex: findColumnIndex(header, [/^contagem$/]),
    monthIndex: findColumnIndex(header, [/^mes$/]),
    dateIndex: findColumnIndex(header, [/^data$/]),
    fullNameIndex: findColumnIndex(header, [/^nome completo$/]),
    bookIndex: findColumnIndex(header, [/^livro$/]),
    semesterIndex: findColumnIndex(header, [/^semestre$/]),
    availabilityIndex: findColumnIndex(header, [/^disponibilidade$/]),
    classIndex: findColumnIndex(header, [/^turma$/]),
    typeIndex: findColumnIndex(header, [/^tipo$/]),
    sponteIndex: findColumnIndex(header, [/^sponte$/]),
    contractIndex: findColumnIndex(header, [/^contrato$/]),
    languageIndex: findColumnIndex(header, [/^idioma$/]),
    attendantIndex: findColumnIndex(header, [/^atendente$/]),
    professionIndex: findColumnIndex(header, [/^profissao$/]),
    mediaIndex: findColumnIndex(header, [/^midia$/]),
    obsIndex: findColumnIndex(header, [/^obs$/]),
    sourceIndex: findColumnIndex(header, [/^origem$/]),
    tagIndex: findColumnIndex(header, [/^tag$/]),
    firstContactIndex: findColumnIndex(header, [/^data primeiro contato$/]),
  };
}

function findHeaderRowIndex(rows = [], patterns = []) {
  const normalizedPatterns = (Array.isArray(patterns) ? patterns : [patterns]).filter(Boolean);
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    const header = buildHeaderDescriptor(rows[rowIndex] || []);
    const normalizedRow = header.map((cell) => cell.normalized).filter(Boolean);
    if (!normalizedRow.length) continue;
    if (normalizedPatterns.every((pattern) => normalizedRow.some((cell) => pattern.test(cell)))) {
      return rowIndex;
    }
  }
  return 0;
}

function inferPresentialEnrollmentColumnMap(header = []) {
  return {
    dateIndex: findColumnIndex(header, [/^data$/]),
    fullNameIndex: findColumnIndex(header, [/^nome$/, /^nome completo$/]),
    bookIndex: findColumnIndex(header, [/^livro$/]),
    semesterIndex: findColumnIndex(header, [/^semestre$/]),
    availabilityIndex: findColumnIndex(header, [/horario disponivel/, /^disponibilidade$/]),
    modalityIndex: findColumnIndex(header, [/^modalidade$/]),
    typeIndex: findColumnIndex(header, [/^tipo$/]),
    systemIndex: findColumnIndex(header, [/^sistema$/]),
    contractIndex: findColumnIndex(header, [/^contrato$/]),
    languageIndex: findColumnIndex(header, [/^idioma$/]),
    attendantIndex: findColumnIndex(header, [/^atendente$/]),
    schoolIndex: findColumnIndex(header, [/empresa escola/, /^empresa$/, /^escola$/]),
    mediaIndex: findColumnIndex(header, [/^midia$/]),
    obsIndex: findColumnIndex(header, [/observacao/, /^obs$/]),
    shipmentIndex: findColumnIndex(header, [/envio de livro/]),
  };
}

function inferVipColumnMap(header = []) {
  return {
    studentIndex: findColumnIndex(header, [/^aluno$/]),
    levelIndex: findColumnIndex(header, [/nivel/, /^n[íi]vel$/]),
    timeIndex: findColumnIndex(header, [/horario/, /^horÃ¡rio$/]),
    dayIndex: findColumnIndex(header, [/^dia$/]),
    teacherIndex: findColumnIndex(header, [/^teacher$/, /^professor$/]),
    hoursIndex: findColumnIndex(header, [/^horas$/]),
    modalityIndex: findColumnIndex(header, [/^modalidade$/]),
    forecastIndex: findColumnIndex(header, [/previsao de finalizar/, /^previsao$/]),
    cardIndex: findColumnIndex(header, [/^card$/]),
  };
}

function inferIntensiveEnrollmentColumnMap(header = []) {
  return {
    studentIndex: findColumnIndex(header, [/^aluno$/]),
    phoneIndex: findColumnIndex(header, [/^celular$/, /^telefone$/]),
    teacherIndex: findColumnIndex(header, [/^teacher$/, /^professor$/]),
    currentBookIndex: findColumnIndex(header, [/livro atual/]),
    intensiveBookIndex: findColumnIndex(header, [/livro intensivo/]),
    shiftIndex: findColumnIndex(header, [/^turno$/]),
    modalityIndex: findColumnIndex(header, [/^modalidade$/]),
    attendantIndex: findColumnIndex(header, [/quem anotou/, /^atendente$/]),
    teacherScheduleIndex: findColumnIndex(header, [/prof horario/, /^prof \+ horario$/]),
    billingIndex: findColumnIndex(header, [/boletos lancados/, /^boletos$/]),
  };
}

function pickCell(row = [], index) {
  if (index < 0 || index >= row.length) return "";
  return row[index];
}

function buildEnrollmentHashes(record) {
  const dedupeBase = [
    normalizePersonKey(record.full_name),
    normalizeAcademicText(record.language || ""),
    normalizeAcademicText(record.semester_label || ""),
    normalizeAcademicText(record.requested_class_label || ""),
    normalizeAcademicText(record.modality || ""),
  ].join("|");

  return {
    dedupe_hash: hashText(dedupeBase),
    row_hash: hashText(JSON.stringify(record.source_payload || {})),
  };
}

function parseMatriculasNovasSheet(workbook, sheetName = ACADEMIC_PRIMARY_SHEET, workbookName = "") {
  const rows = getSheetRows(workbook, sheetName);
  if (!rows.length) return [];
  const header = buildHeaderDescriptor(rows[0] || []);
  const map = inferEnrollmentColumnMap(header);
  const records = [];

  for (let rowIndex = 1; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex] || [];
    const fullName = normalizeWhitespace(pickCell(row, map.fullNameIndex));
    if (!fullName) continue;
    const languageLabel = normalizeWhitespace(pickCell(row, map.languageIndex));
    const language = detectLanguageFromText(languageLabel) || toTitleCase(languageLabel);
    const semesterCode = deriveSemesterCode(pickCell(row, map.semesterIndex));
    const bookName = normalizeWhitespace(pickCell(row, map.bookIndex));
    const availability = normalizeWhitespace(pickCell(row, map.availabilityIndex));
    const modality = detectModalityFromText(pickCell(row, map.classIndex) || pickCell(row, map.availabilityIndex) || pickCell(row, map.typeIndex) || "online") || "online";
    const levelName = detectLevelNameFromText(bookName || pickCell(row, map.classIndex) || "");
    const programName = buildProgramName(language, levelName || bookName, modality);

    const record = {
      source_workbook: sanitizeWorkbookName(workbookName),
      source_sheet: sheetName,
      source_row_number: rowIndex + 1,
      source_row_identifier: `${sheetName}:${rowIndex + 1}`,
      full_name: fullName,
      preferred_name: "",
      phone: "",
      whatsapp: "",
      notes: normalizeWhitespace(pickCell(row, map.obsIndex)),
      school_name: "",
      school_grade: "",
      status: "ativo",
      enrollment_date: excelSerialToIso(pickCell(row, map.dateIndex)),
      first_contact_date: excelSerialToIso(pickCell(row, map.firstContactIndex)),
      school_term_code: semesterCode,
      semester_label: semesterCode,
      language,
      program_name: programName,
      level_name: levelName || bookName,
      modality,
      requested_class_label: normalizeWhitespace(pickCell(row, map.classIndex) || availability),
      class_type: normalizeWhitespace(pickCell(row, map.typeIndex)),
      source_channel: normalizeWhitespace(pickCell(row, map.sourceIndex) || pickCell(row, map.mediaIndex)),
      source_notes: normalizeWhitespace(pickCell(row, map.tagIndex)),
      attendant_name: normalizeWhitespace(pickCell(row, map.attendantIndex)),
      contract_status: normalizeWhitespace(pickCell(row, map.contractIndex)),
      media_source: normalizeWhitespace(pickCell(row, map.mediaIndex)),
      profession: normalizeWhitespace(pickCell(row, map.professionIndex)),
      sponte_label: normalizeWhitespace(pickCell(row, map.sponteIndex)),
      source_payload: {
        header: header.map((cell) => cell.original),
        row,
      },
    };
    Object.assign(record, buildEnrollmentHashes(record));
    records.push(record);
  }

  return records;
}

function inferWorkbookSemester(workbookName = "", fallback = "") {
  return deriveSemesterCode(workbookName) || deriveSemesterCode(fallback) || "";
}

function inferDefaultModalityFromSheetName(sheetName = "", workbookName = "") {
  const combined = `${sheetName} ${workbookName}`;
  const detected = detectModalityFromText(combined);
  if (detected) return detected;
  if (normalizeAcademicText(combined).includes("presencial")) return "presencial";
  if (normalizeAcademicText(combined).includes("online")) return "online";
  return "";
}

function parsePresentialMatriculasSheet(workbook, sheetName = ACADEMIC_PRESENTIAL_PRIMARY_SHEET, workbookName = "") {
  const rows = getSheetRows(workbook, sheetName);
  if (!rows.length) return [];
  const headerRowIndex = findHeaderRowIndex(rows, [/^nome$/, /^idioma$/, /^atendente$/]);
  const header = buildHeaderDescriptor(rows[headerRowIndex] || []);
  const map = inferPresentialEnrollmentColumnMap(header);
  const records = [];

  for (let rowIndex = headerRowIndex + 1; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex] || [];
    const fullName = normalizeWhitespace(pickCell(row, map.fullNameIndex));
    if (!fullName) continue;
    const bookName = normalizeWhitespace(pickCell(row, map.bookIndex));
    const availability = normalizeWhitespace(pickCell(row, map.availabilityIndex));
    const explicitModality = normalizeWhitespace(pickCell(row, map.modalityIndex));
    const modality = detectModalityFromText(`${explicitModality} ${availability} ${pickCell(row, map.typeIndex)}`) || inferDefaultModalityFromSheetName(sheetName, workbookName) || "presencial";
    const semesterCode = deriveSemesterCode(pickCell(row, map.semesterIndex)) || inferWorkbookSemester(workbookName, sheetName);
    const languageLabel = normalizeWhitespace(pickCell(row, map.languageIndex));
    const language = detectLanguageFromText(languageLabel) || toTitleCase(languageLabel);
    const levelName = detectLevelNameFromText(bookName || availability);
    const classKind = detectAcademicClassKind(`${explicitModality} ${pickCell(row, map.typeIndex)} ${availability}`, "regular");
    const record = {
      source_workbook: sanitizeWorkbookName(workbookName),
      source_sheet: sheetName,
      source_row_number: rowIndex + 1,
      source_row_identifier: `${sheetName}:${rowIndex + 1}`,
      full_name: fullName,
      preferred_name: "",
      phone: "",
      whatsapp: "",
      notes: normalizeWhitespace(pickCell(row, map.obsIndex)),
      school_name: normalizeWhitespace(pickCell(row, map.schoolIndex)),
      school_grade: "",
      status: "ativo",
      enrollment_date: excelSerialToIso(pickCell(row, map.dateIndex)),
      school_term_code: semesterCode,
      semester_label: semesterCode,
      language,
      program_name: buildProgramName(language, levelName || bookName, modality),
      level_name: levelName || bookName,
      modality,
      class_kind: classKind,
      requested_class_label: availability,
      class_type: normalizeWhitespace(pickCell(row, map.typeIndex)),
      source_channel: normalizeWhitespace(pickCell(row, map.mediaIndex) || pickCell(row, map.schoolIndex)),
      source_notes: normalizeWhitespace(pickCell(row, map.shipmentIndex)),
      attendant_name: normalizeWhitespace(pickCell(row, map.attendantIndex)),
      contract_status: normalizeWhitespace(pickCell(row, map.contractIndex)),
      media_source: normalizeWhitespace(pickCell(row, map.mediaIndex)),
      system_name: normalizeWhitespace(pickCell(row, map.systemIndex)),
      source_payload: {
        header: header.map((cell) => cell.original),
        row,
      },
    };
    Object.assign(record, buildEnrollmentHashes(record));
    records.push(record);
  }

  return records;
}

function normalizeTeacherNameCell(value = "") {
  return buildTeacherIdentity(value);
}

function buildSyntheticVipClassName(record = {}) {
  const classKindLabel = record.class_kind === "semi_vip" ? "SEMI VIP" : (record.class_kind === "vip" ? "VIP" : "ATENDIMENTO");
  const base = normalizeWhitespace(record.card_label || record.level_name || record.requested_class_label || "");
  return base || `${classKindLabel} - ${record.full_name}`;
}

function buildSyntheticClassBlock(record = {}) {
  const teacher = normalizeTeacherNameCell(record.teacher_name || record.attendant_name || "");
  if (!teacher?.normalized_name) return null;
  const startTime = (() => {
    const match = String(record.schedule_label || record.requested_class_label || "").match(/(\d{1,2}:\d{2})\s*[_-]\s*(\d{1,2}:\d{2})/);
    return match?.[1] || "";
  })();
  const endTime = (() => {
    const match = String(record.schedule_label || record.requested_class_label || "").match(/(\d{1,2}:\d{2})\s*[_-]\s*(\d{1,2}:\d{2})/);
    return match?.[2] || "";
  })();
  const descriptor = buildSyntheticVipClassName(record);
  const descriptorBlob = [descriptor, record.requested_class_label, record.modality, record.level_name, record.semester_label, record.source_sheet].filter(Boolean).join(" ");
  const classKind = detectAcademicClassKind(`${record.class_kind || ""} ${descriptorBlob}`, record.class_kind || "regular");
  return {
    source_workbook: record.source_workbook,
    source_sheet: record.source_sheet,
    source_block_ref: `${record.source_sheet}:${normalizePersonKey(record.full_name)}:${teacher.normalized_name}:${normalizeAcademicText(record.schedule_label || descriptor)}`,
    teacher_display_name: teacher.display_name,
    teacher_normalized_name: teacher.normalized_name,
    teacher_aliases: teacher.aliases,
    teacher_specialties: teacher.specialties,
    class_name: descriptor,
    class_kind: classKind,
    descriptor_lines: [descriptor, record.level_name, record.card_label].filter(Boolean),
    notes_lines: [record.notes, record.source_notes].filter(Boolean),
    language: record.language || detectLanguageFromText(descriptorBlob),
    modality: record.modality || inferDefaultModalityFromSheetName(record.source_sheet, record.source_workbook),
    level_name: record.level_name || detectLevelNameFromText(descriptorBlob),
    semester_label: record.semester_label || inferWorkbookSemester(record.source_workbook, descriptorBlob),
    school_term_code: record.school_term_code || record.semester_label || inferWorkbookSemester(record.source_workbook, descriptorBlob),
    schedules: uniqueScheduleRows([{
      weekday: detectWeekdaysFromText(`${record.source_sheet} ${record.weekday_label || record.requested_class_label || ""}`)[0] || "",
      start_time: startTime,
      end_time: endTime,
      timezone: "America/Sao_Paulo",
      notes: normalizeWhitespace(record.schedule_label || record.requested_class_label || ""),
    }].filter((item) => item.weekday || item.start_time || item.end_time)),
    students: [{
      full_name: record.full_name,
      normalized_name: normalizePersonKey(record.full_name),
      source_sheet: record.source_sheet,
      source_row_number: record.source_row_number,
      source_row_identifier: record.source_row_identifier,
      raw_value: record.full_name,
    }],
  };
}

function parseVipSheet(workbook, sheetName = "VIPS", workbookName = "") {
  const rows = getSheetRows(workbook, sheetName);
  if (!rows.length) return { enrollments: [], classBlocks: [], teachers: [] };
  const header = buildHeaderDescriptor(rows[0] || []);
  const map = inferVipColumnMap(header);
  const enrollments = [];
  const classBlocks = [];
  const teachers = new Map();

  for (let rowIndex = 1; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex] || [];
    const fullName = stripTrailingStudentAnnotations(normalizeWhitespace(pickCell(row, map.studentIndex)));
    if (!fullName) continue;
    const teacher = normalizeTeacherNameCell(pickCell(row, map.teacherIndex));
    const levelName = normalizeWhitespace(pickCell(row, map.levelIndex));
    const modality = detectModalityFromText(`${pickCell(row, map.modalityIndex)} ${pickCell(row, map.cardIndex)}`) || inferDefaultModalityFromSheetName(sheetName, workbookName) || "home-school";
    const scheduleLabel = normalizeWhitespace(pickCell(row, map.timeIndex));
    const weekdayLabel = normalizeWhitespace(pickCell(row, map.dayIndex));
    const forecastRaw = normalizeWhitespace(pickCell(row, map.forecastIndex));
    const classKind = detectAcademicClassKind(`${pickCell(row, map.cardIndex)} ${pickCell(row, map.modalityIndex)}`, "vip");
    const semesterCode = inferWorkbookSemester(workbookName, `${sheetName} ${forecastRaw}`) || deriveSemesterCode(forecastRaw);
    const record = {
      source_workbook: sanitizeWorkbookName(workbookName),
      source_sheet: sheetName,
      source_row_number: rowIndex + 1,
      source_row_identifier: `${sheetName}:${rowIndex + 1}`,
      full_name: fullName,
      phone: "",
      whatsapp: "",
      notes: "",
      status: normalizeAcademicText(forecastRaw).includes("trancad") ? "trancado" : "ativo",
      enrollment_status: normalizeAcademicText(forecastRaw).includes("trancad") ? "trancado" : "matriculado",
      school_term_code: semesterCode,
      semester_label: semesterCode,
      language: detectLanguageFromText(`${levelName} ${pickCell(row, map.cardIndex)}`),
      program_name: buildProgramName(detectLanguageFromText(levelName), levelName, modality),
      level_name: levelName,
      modality,
      class_kind: classKind,
      requested_class_label: `${weekdayLabel} ${scheduleLabel}`.trim(),
      source_channel: "vip_sheet",
      source_notes: normalizeWhitespace(pickCell(row, map.hoursIndex)),
      teacher_name: teacher?.display_name || null,
      schedule_label: scheduleLabel,
      weekday_label: weekdayLabel,
      card_label: normalizeWhitespace(pickCell(row, map.cardIndex)),
      forecast_end: excelSerialToIso(pickCell(row, map.forecastIndex)) || forecastRaw,
      source_payload: {
        header: header.map((cell) => cell.original),
        row,
      },
    };
    Object.assign(record, buildEnrollmentHashes(record));
    enrollments.push(record);
    const block = teacher?.normalized_name ? buildSyntheticClassBlock(record) : null;
    if (block) classBlocks.push(block);
    if (teacher?.normalized_name) {
      teachers.set(teacher.normalized_name, teacher);
    }
  }

  return {
    enrollments,
    classBlocks,
    teachers: Array.from(teachers.values()),
  };
}

function parseIntensiveEnrollmentSheet(workbook, sheetName, workbookName = "") {
  const rows = getSheetRows(workbook, sheetName);
  if (!rows.length) return { enrollments: [], classBlocks: [], teachers: [] };
  const headerRowIndex = findHeaderRowIndex(rows, [/^aluno$/, /^teacher$/]);
  const header = buildHeaderDescriptor(rows[headerRowIndex] || []);
  const map = inferIntensiveEnrollmentColumnMap(header);
  const enrollments = [];
  const groupedBlocks = new Map();
  const teachers = new Map();

  for (let rowIndex = headerRowIndex + 1; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex] || [];
    const fullName = stripTrailingStudentAnnotations(normalizeWhitespace(pickCell(row, map.studentIndex)));
    if (!fullName) continue;
    const teacher = normalizeTeacherNameCell(pickCell(row, map.teacherIndex));
    const levelName = normalizeWhitespace(pickCell(row, map.intensiveBookIndex) || pickCell(row, map.currentBookIndex));
    const modality = detectModalityFromText(pickCell(row, map.modalityIndex)) || inferDefaultModalityFromSheetName(sheetName, workbookName) || "home-school";
    const semesterCode = inferWorkbookSemester(workbookName, sheetName);
    const shift = normalizeWhitespace(pickCell(row, map.shiftIndex));
    const classKind = "intensive";
    const className = normalizeWhitespace(`${sheetName} - ${levelName || "Intensivo"}${shift ? ` - ${shift}` : ""}`);
    const record = {
      source_workbook: sanitizeWorkbookName(workbookName),
      source_sheet: sheetName,
      source_row_number: rowIndex + 1,
      source_row_identifier: `${sheetName}:${rowIndex + 1}`,
      full_name: fullName,
      phone: normalizeWhitespace(pickCell(row, map.phoneIndex)),
      whatsapp: normalizeWhitespace(pickCell(row, map.phoneIndex)),
      notes: normalizeWhitespace(pickCell(row, map.billingIndex)),
      status: "ativo",
      enrollment_status: "matriculado",
      school_term_code: semesterCode,
      semester_label: semesterCode,
      language: detectLanguageFromText(levelName),
      program_name: buildProgramName(detectLanguageFromText(levelName), levelName, modality),
      level_name: levelName,
      modality,
      class_kind: classKind,
      requested_class_label: normalizeWhitespace(pickCell(row, map.teacherScheduleIndex) || className),
      source_channel: "intensive_sheet",
      source_notes: normalizeWhitespace(pickCell(row, map.attendantIndex)),
      teacher_name: teacher?.display_name || null,
      source_payload: {
        header: header.map((cell) => cell.original),
        row,
      },
    };
    Object.assign(record, buildEnrollmentHashes(record));
    enrollments.push(record);
    if (teacher?.normalized_name) teachers.set(teacher.normalized_name, teacher);
    if (!teacher?.normalized_name) continue;
    const groupKey = [teacher.normalized_name, normalizeAcademicText(className), modality, semesterCode].join("|");
    const currentGroup = groupedBlocks.get(groupKey) || {
      source_workbook: sanitizeWorkbookName(workbookName),
      source_sheet: sheetName,
      source_block_ref: `${sheetName}:${teacher.normalized_name}:${normalizeAcademicText(className)}`,
      teacher_display_name: teacher.display_name,
      teacher_normalized_name: teacher.normalized_name,
      teacher_aliases: teacher.aliases,
      teacher_specialties: teacher.specialties,
      class_name: className,
      class_kind: classKind,
      descriptor_lines: [className, shift].filter(Boolean),
      notes_lines: [],
      language: detectLanguageFromText(levelName),
      modality,
      level_name: levelName,
      semester_label: semesterCode,
      school_term_code: semesterCode,
      schedules: [],
      students: [],
    };
    currentGroup.students.push({
      full_name: record.full_name,
      normalized_name: normalizePersonKey(record.full_name),
      source_sheet: record.source_sheet,
      source_row_number: record.source_row_number,
      source_row_identifier: record.source_row_identifier,
      raw_value: record.full_name,
    });
    groupedBlocks.set(groupKey, currentGroup);
  }

  return {
    enrollments,
    classBlocks: Array.from(groupedBlocks.values()),
    teachers: Array.from(teachers.values()),
  };
}

function parsePremiumTeacherMatrixSheet(workbook, sheetName, workbookName = "") {
  const rows = getSheetRows(workbook, sheetName);
  if (!rows.length) return [];
  const teacherAnchors = [];
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex] || [];
    for (let columnIndex = 0; columnIndex < row.length; columnIndex += 1) {
      const teacher = parseTeacherHeader(row[columnIndex]);
      if (!teacher) continue;
      teacherAnchors.push({
        rowIndex,
        columnIndex,
        nameCol: columnIndex + 1,
        timeCol: columnIndex,
        teacher,
      });
    }
  }
  const classes = [];
  teacherAnchors.forEach((anchor, anchorIndex) => {
    const nextAnchorRow = teacherAnchors
      .filter((item, index) => index !== anchorIndex && item.columnIndex === anchor.columnIndex && item.rowIndex > anchor.rowIndex)
      .map((item) => item.rowIndex)
      .sort((left, right) => left - right)[0] || rows.length;
    let current = {
      source_block_ref: `${sheetName}:R${anchor.rowIndex + 1}:C${anchor.columnIndex + 1}`,
      teacher_display_name: anchor.teacher.display_name,
      teacher_normalized_name: anchor.teacher.normalized_name,
      teacher_aliases: anchor.teacher.aliases,
      teacher_specialties: anchor.teacher.specialties,
      descriptors: [],
      notes: [],
      students: [],
      schedules: [],
    };

    for (let rowIndex = anchor.rowIndex + 1; rowIndex < nextAnchorRow; rowIndex += 1) {
      const row = rows[rowIndex] || [];
      const cellText = normalizeWhitespace(pickCell(row, anchor.nameCol));
      const timeText = excelTimeToHHmm(pickCell(row, anchor.timeCol));
      if (!cellText && !timeText) continue;
      if (looksLikeClassDescriptor(cellText, sheetName)) {
        current.descriptors.push(cellText);
        if (timeText) {
          current.schedules.push({
            weekday: detectWeekdaysFromText(`${sheetName} ${current.descriptors.join(" ")}`)[0] || "",
            start_time: timeText,
            end_time: "",
            timezone: "America/Sao_Paulo",
            notes: null,
          });
        }
        continue;
      }
      const studentCandidate = extractStudentNameCandidate(cellText);
      if (studentCandidate) {
        current.students.push({
          full_name: studentCandidate,
          normalized_name: normalizePersonKey(studentCandidate),
          source_sheet: sheetName,
          source_row_number: rowIndex + 1,
          source_row_identifier: `${sheetName}:${rowIndex + 1}:${anchor.nameCol + 1}`,
          schedule_time: timeText || "",
          raw_value: cellText,
        });
        if (timeText) {
          current.schedules.push({
            weekday: detectWeekdaysFromText(`${sheetName} ${current.descriptors.join(" ")}`)[0] || "",
            start_time: timeText,
            end_time: "",
            timezone: "America/Sao_Paulo",
            notes: null,
          });
        }
        continue;
      }
      if (cellText) current.notes.push(cellText);
    }
    const finalized = finalizeTeacherClassSegment(current, sheetName);
    if (finalized) {
      classes.push({
        ...finalized,
        source_workbook: sanitizeWorkbookName(workbookName),
        class_kind: detectAcademicClassKind(`${sheetName} ${finalized.class_name}`, "intensive"),
      });
    }
  });
  return classes;
}

function parseRemanejamentoSheet(workbook, sheetName, workbookName = "") {
  const rows = getSheetRows(workbook, sheetName);
  if (!rows.length) return [];
  let currentDescriptors = [];
  let currentNotes = [];
  const movements = [];
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex] || [];
    const values = row.map((cell) => normalizeWhitespace(cell)).filter(Boolean);
    if (!values.length) continue;
    const studentCandidates = values.map((cell) => extractStudentNameCandidate(cell)).filter(Boolean);
    if (studentCandidates.length) {
      studentCandidates.forEach((fullName) => {
        const descriptor = choosePrimaryDescriptor(currentDescriptors, sheetName);
        movements.push({
          movement_type: "remanejamento",
          source_workbook: sanitizeWorkbookName(workbookName),
          source_sheet: sheetName,
          source_row_number: rowIndex + 1,
          source_row_identifier: `${sheetName}:${rowIndex + 1}`,
          full_name: fullName,
          normalized_name: normalizePersonKey(fullName),
          target_class_label: descriptor,
          semester_label: deriveSemesterCode([descriptor, ...currentNotes].join(" ")),
          notes: mergeUniqueStrings(currentNotes, values.filter((cell) => cell !== fullName)).join(" | "),
          source_payload: { row },
        });
      });
      continue;
    }
    values.forEach((value) => {
      if (looksLikeClassDescriptor(value, sheetName)) currentDescriptors.push(value);
      else currentNotes.push(value);
    });
    currentDescriptors = Array.from(new Set(currentDescriptors.filter(Boolean))).slice(-4);
    currentNotes = Array.from(new Set(currentNotes.filter(Boolean))).slice(-6);
  }
  return movements;
}

function parseReversaoSheet(workbook, sheetName, workbookName = "") {
  const rows = getSheetRows(workbook, sheetName);
  if (!rows.length) return [];
  const headerRowIndex = findHeaderRowIndex(rows, [/data/, /^nome aluno$/, /teacher/]);
  const header = buildHeaderDescriptor(rows[headerRowIndex] || []);
  const map = {
    dateIndex: findColumnIndex(header, [/data solicitacao/, /^data$/]),
    studentIndex: findColumnIndex(header, [/nome aluno/, /^nome$/]),
    attendantIndex: findColumnIndex(header, [/responsavel pelo atendimento/, /^responsavel$/]),
    levelIndex: findColumnIndex(header, [/nivel/, /^n[íi]vel$/]),
    teacherIndex: findColumnIndex(header, [/^teacher$/, /^professor$/]),
    reasonIndex: findColumnIndex(header, [/^motivo$/]),
    commissionIndex: findColumnIndex(header, [/^comissao$/]),
  };
  const items = [];
  for (let rowIndex = headerRowIndex + 1; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex] || [];
    const fullName = normalizeWhitespace(pickCell(row, map.studentIndex));
    if (!fullName) continue;
    items.push({
      movement_type: "reversao_pedagogica",
      source_workbook: sanitizeWorkbookName(workbookName),
      source_sheet: sheetName,
      source_row_number: rowIndex + 1,
      source_row_identifier: `${sheetName}:${rowIndex + 1}`,
      full_name: stripTrailingStudentAnnotations(fullName),
      normalized_name: normalizePersonKey(fullName),
      teacher_name: normalizeWhitespace(pickCell(row, map.teacherIndex)),
      level_name: normalizeWhitespace(pickCell(row, map.levelIndex)),
      status_date: excelSerialToIso(pickCell(row, map.dateIndex)),
      notes: mergeUniqueStrings([
        normalizeWhitespace(pickCell(row, map.reasonIndex)),
        normalizeWhitespace(pickCell(row, map.commissionIndex)),
        normalizeWhitespace(pickCell(row, map.attendantIndex)),
      ]).join(" | "),
      source_payload: {
        header: header.map((cell) => cell.original),
        row,
      },
    });
  }
  return items;
}

function parseCancellationSheet(workbook, sheetName, workbookName = "") {
  const rows = getSheetRows(workbook, sheetName);
  if (!rows.length) return [];
  const headerRowIndex = findHeaderRowIndex(rows, [/^nome$/, /^idioma$/, /^motivo$/]);
  const header = buildHeaderDescriptor(rows[headerRowIndex] || []);
  const map = {
    studentIndex: findColumnIndex(header, [/^nome$/, /^aluno$/]),
    languageIndex: findColumnIndex(header, [/^idioma$/]),
    paidIndex: findColumnIndex(header, [/^pagou$/]),
    materialIndex: findColumnIndex(header, [/recebeu material/]),
    responsibleIndex: findColumnIndex(header, [/responsavel da matricula/]),
    reasonIndex: findColumnIndex(header, [/^motivo$/]),
  };
  const items = [];
  for (let rowIndex = headerRowIndex + 1; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex] || [];
    const fullName = normalizeWhitespace(pickCell(row, map.studentIndex));
    if (!fullName) continue;
    items.push({
      source_workbook: sanitizeWorkbookName(workbookName),
      source_sheet: sheetName,
      source_row_number: rowIndex + 1,
      source_row_identifier: `${sheetName}:${rowIndex + 1}`,
      status_type: "cancelado",
      full_name: stripTrailingStudentAnnotations(fullName),
      normalized_name: normalizePersonKey(fullName),
      language: toTitleCase(normalizeWhitespace(pickCell(row, map.languageIndex))),
      notes: mergeUniqueStrings([
        normalizeWhitespace(pickCell(row, map.reasonIndex)),
        normalizeWhitespace(pickCell(row, map.responsibleIndex)),
        normalizeWhitespace(pickCell(row, map.paidIndex)),
        normalizeWhitespace(pickCell(row, map.materialIndex)),
      ]).join(" | "),
      source_payload: {
        header: header.map((cell) => cell.original),
        row,
      },
    });
  }
  return items;
}

function looksLikeClassDescriptor(value = "", sheetName = "") {
  const safe = normalizeAcademicText(value);
  if (!safe) return false;
  if (safe.length < 3) return false;
  if (CLASS_DESCRIPTOR_KEYWORDS.some((keyword) => safe.includes(normalizeAcademicText(keyword)))) return true;
  return detectWeekdaysFromText(`${sheetName} ${value}`).length > 0;
}

function isWeekdayOnlyDescriptor(value = "") {
  const safe = normalizeAcademicText(value);
  if (!safe) return false;
  const stripped = safe
    .replace(/\b(?:segunda|segundas|terca|tercas|quarta|quartas|quinta|quintas|sexta|sextas|sab|sabado)\b/g, " ")
    .replace(/\b(?:online|home school|hs)\b/g, " ")
    .replace(/[0-9()./-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return detectWeekdaysFromText(value).length > 0 && !stripped;
}

function isWeakClassDescriptor(value = "") {
  const safe = normalizeAcademicText(value);
  if (!safe) return true;
  if (isWeekdayOnlyDescriptor(value)) return true;
  if (/^(home school|online|inicio\s+\d{1,2}\/\d{1,2}|inicio)$/i.test(normalizeWhitespace(repairMojibakeText(value || "")))) {
    return true;
  }
  return false;
}

function choosePrimaryDescriptor(descriptors = [], fallback = "") {
  const safeDescriptors = Array.from(new Set((descriptors || []).map((item) => normalizeWhitespace(item)).filter(Boolean)));
  const strong = safeDescriptors.filter((item) => !isWeakClassDescriptor(item));
  const ranked = (strong.length ? strong : safeDescriptors).slice().sort((left, right) => {
    const leftScore = Number(Boolean(deriveSemesterCode(left))) * 4
      + Number(Boolean(detectLevelNameFromText(left))) * 3
      + Number(Boolean(detectLanguageFromText(left))) * 2
      + Math.min(1, Math.floor(String(left || "").length / 18));
    const rightScore = Number(Boolean(deriveSemesterCode(right))) * 4
      + Number(Boolean(detectLevelNameFromText(right))) * 3
      + Number(Boolean(detectLanguageFromText(right))) * 2
      + Math.min(1, Math.floor(String(right || "").length / 18));
    if (leftScore !== rightScore) return rightScore - leftScore;
    return String(right || "").length - String(left || "").length;
  });
  return ranked[0] || fallback;
}

function looksLikeOperationalNote(value = "") {
  const safe = normalizeAcademicText(value);
  if (!safe) return false;
  return OPERATIONAL_NOTE_KEYWORDS.some((keyword) => safe.includes(normalizeAcademicText(keyword)));
}

function extractStudentNameCandidate(value = "") {
  const cleaned = stripTrailingStudentAnnotations(value);
  const safe = normalizeWhitespace(cleaned);
  if (!safe) return "";
  if (looksLikeClassDescriptor(safe) || looksLikeOperationalNote(safe)) return "";
  if (safe.length < 4) return "";
  if (safe.split(" ").length < 2) return "";
  if (/^\d/.test(safe)) return "";
  return safe;
}

function uniqueScheduleRows(schedules = []) {
  const seen = new Set();
  const rows = [];
  for (const item of schedules) {
    const key = [item.weekday, item.start_time, item.end_time, item.notes].join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push(item);
  }
  return rows.map((item, index) => ({
    ...item,
    is_primary: index === 0,
  }));
}

function finalizeTeacherClassSegment(segment, sheetName) {
  if (!segment) return null;
  const descriptors = Array.from(new Set((segment.descriptors || []).map((item) => normalizeWhitespace(item)).filter(Boolean)));
  const students = Array.from(new Map((segment.students || []).map((item) => [item.normalized_name, item])).values());
  const primaryDescriptor = choosePrimaryDescriptor(descriptors, `${segment.teacher_display_name} - ${sheetName}`);
  const remainingDescriptors = descriptors.filter((item) => item !== primaryDescriptor);
  if (!primaryDescriptor && !students.length) return null;
  if (!students.length && !remainingDescriptors.length && isWeakClassDescriptor(primaryDescriptor)) return null;
  const descriptorBlob = [sheetName, primaryDescriptor, ...remainingDescriptors, ...(segment.notes || [])].join(" ");
  const semesterCode = deriveSemesterCode(descriptorBlob);
  const language = detectLanguageFromText(descriptorBlob) || detectLanguageFromText(segment.teacher_specialties.join(" "));
  const modality = detectModalityFromText(descriptorBlob) || inferDefaultModalityFromSheetName(sheetName) || "online";
  const levelName = detectLevelNameFromText(primaryDescriptor);
  const weekdays = detectWeekdaysFromText(descriptorBlob);
  const schedules = uniqueScheduleRows((segment.schedules || []).map((schedule) => ({
    weekday: schedule.weekday || weekdays[0] || "",
    start_time: schedule.start_time || "",
    end_time: schedule.end_time || "",
    timezone: "America/Sao_Paulo",
    notes: schedule.notes || null,
  })));
  return {
    source_sheet: sheetName,
    source_block_ref: segment.source_block_ref,
    teacher_display_name: segment.teacher_display_name,
    teacher_normalized_name: segment.teacher_normalized_name,
    teacher_aliases: segment.teacher_aliases || [],
    teacher_specialties: segment.teacher_specialties || [],
    class_name: primaryDescriptor,
    class_kind: detectAcademicClassKind(descriptorBlob, "regular"),
    descriptor_lines: [primaryDescriptor, ...remainingDescriptors].filter(Boolean),
    notes_lines: [...remainingDescriptors.filter((item) => isWeakClassDescriptor(item)), ...((segment.notes || []).filter(Boolean))],
    language: language || "",
    modality,
    level_name: levelName || "",
    semester_label: semesterCode,
    school_term_code: semesterCode,
    schedules,
    students,
  };
}

function parseGridSheet(workbook, sheetName, workbookName = "") {
  const rows = getSheetRows(workbook, sheetName);
  if (!rows.length) return [];
  const teacherColumns = [];
  const headerRow = rows[0] || [];
  for (let columnIndex = 0; columnIndex < headerRow.length; columnIndex += 1) {
    const teacher = parseTeacherHeader(headerRow[columnIndex]);
    if (!teacher) continue;
    teacherColumns.push({
      teacher,
      nameCol: columnIndex,
      timeCol: Math.max(0, columnIndex - 1),
    });
  }

  const classes = [];
  teacherColumns.forEach(({ teacher, nameCol, timeCol }) => {
    let current = null;
    const finalize = () => {
      const finalized = finalizeTeacherClassSegment(current, sheetName);
      if (finalized) classes.push(finalized);
      current = null;
    };

    for (let rowIndex = 1; rowIndex < rows.length; rowIndex += 1) {
      const row = rows[rowIndex] || [];
      const cellText = normalizeWhitespace(pickCell(row, nameCol));
      const timeText = excelTimeToHHmm(pickCell(row, timeCol));
      if (!cellText && !timeText) continue;

      if (looksLikeClassDescriptor(cellText, sheetName)) {
        if (!current) {
          current = {
            source_block_ref: `${sheetName}:C${nameCol + 1}`,
            teacher_display_name: teacher.display_name,
            teacher_normalized_name: teacher.normalized_name,
            teacher_aliases: teacher.aliases,
            teacher_specialties: teacher.specialties,
            descriptors: [cellText],
            notes: [],
            students: [],
            schedules: [],
          };
          continue;
        }
        if (!current.students.length) {
          current.descriptors.push(cellText);
          if (timeText) {
            current.schedules.push({
              weekday: detectWeekdaysFromText(`${sheetName} ${current.descriptors.join(" ")}`)[0] || "",
              start_time: timeText,
              end_time: "",
              timezone: "America/Sao_Paulo",
              notes: null,
            });
          }
          continue;
        }
        if (isWeakClassDescriptor(cellText)) {
          current.descriptors.push(cellText);
          if (timeText) {
            current.schedules.push({
              weekday: detectWeekdaysFromText(`${sheetName} ${current.descriptors.join(" ")}`)[0] || "",
              start_time: timeText,
              end_time: "",
              timezone: "America/Sao_Paulo",
              notes: null,
            });
          }
          continue;
        }
        finalize();
        current = {
          source_block_ref: `${sheetName}:C${nameCol + 1}`,
          teacher_display_name: teacher.display_name,
          teacher_normalized_name: teacher.normalized_name,
          teacher_aliases: teacher.aliases,
          teacher_specialties: teacher.specialties,
          descriptors: [cellText],
          notes: [],
          students: [],
          schedules: [],
        };
        continue;
      }

      if (!current) {
        current = {
          source_block_ref: `${sheetName}:C${nameCol + 1}`,
          teacher_display_name: teacher.display_name,
          teacher_normalized_name: teacher.normalized_name,
          teacher_aliases: teacher.aliases,
          teacher_specialties: teacher.specialties,
          descriptors: [],
          notes: [],
          students: [],
          schedules: [],
        };
      }

      const studentCandidate = extractStudentNameCandidate(cellText);
      if (studentCandidate) {
        current.students.push({
          full_name: studentCandidate,
          normalized_name: normalizePersonKey(studentCandidate),
          source_sheet: sheetName,
          source_row_number: rowIndex + 1,
          source_row_identifier: `${sheetName}:${rowIndex + 1}:${nameCol + 1}`,
          schedule_time: timeText || "",
          raw_value: cellText,
        });
        if (timeText) {
          current.schedules.push({
            weekday: detectWeekdaysFromText(`${sheetName} ${current.descriptors.join(" ")}`)[0] || "",
            start_time: timeText,
            end_time: "",
            timezone: "America/Sao_Paulo",
            notes: null,
          });
        }
        continue;
      }

      if (timeText && !cellText) {
        current.schedules.push({
          weekday: detectWeekdaysFromText(`${sheetName} ${current.descriptors.join(" ")}`)[0] || "",
          start_time: timeText,
          end_time: "",
          timezone: "America/Sao_Paulo",
          notes: null,
        });
        continue;
      }

      if (looksLikeOperationalNote(cellText)) {
        current.notes.push(cellText);
      } else if (cellText) {
        current.descriptors.push(cellText);
      }
    }

    finalize();
  });

  return classes.map((item, index) => ({
    ...item,
    source_workbook: sanitizeWorkbookName(workbookName),
    import_order: index + 1,
  }));
}

function parseStatusSheet(workbook, sheetName, statusType, workbookName = "") {
  const rows = getSheetRows(workbook, sheetName);
  if (!rows.length) return [];
  let headerRowIndex = 0;
  for (let index = 0; index < Math.min(rows.length, 6); index += 1) {
    const joined = normalizeAcademicText((rows[index] || []).join(" "));
    if (joined.includes("aluno") || joined.includes("teacher") || joined.includes("livro")) {
      headerRowIndex = index;
      break;
    }
  }
  const header = buildHeaderDescriptor(rows[headerRowIndex] || []);
  const map = {
    dateIndex: findColumnIndex(header, [/^data/, /^mes$/]),
    studentIndex: findColumnIndex(header, [/^aluno$/, /^nome$/, /^nome completo$/]),
    phoneIndex: findColumnIndex(header, [/^telefone$/, /^fone$/]),
    levelIndex: findColumnIndex(header, [/^livro$/, /^perfil$/, /^nivel/, /^n[íi]vel/]),
    languageIndex: findColumnIndex(header, [/^idioma$/]),
    modalityIndex: findColumnIndex(header, [/^modalidade$/]),
    teacherIndex: findColumnIndex(header, [/^teacher$/, /^professor$/]),
    feedbackIndex: findColumnIndex(header, [/^feedback$/, /^motivo/, /^atualiza/, /^situacao$/, /^situa[çc][ãa]o$/]),
  };

  const records = [];
  for (let rowIndex = headerRowIndex + 1; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex] || [];
    const fullName = normalizeWhitespace(pickCell(row, map.studentIndex));
    if (!fullName || normalizeAcademicText(fullName) === "aluno") continue;
    const levelName = normalizeWhitespace(pickCell(row, map.levelIndex));
    const language = detectLanguageFromText(pickCell(row, map.languageIndex) || levelName) || toTitleCase(normalizeWhitespace(pickCell(row, map.languageIndex)));
    records.push({
      source_workbook: sanitizeWorkbookName(workbookName),
      source_sheet: sheetName,
      source_row_number: rowIndex + 1,
      source_row_identifier: `${sheetName}:${rowIndex + 1}`,
      status_type: statusType,
      full_name: stripTrailingStudentAnnotations(fullName),
      normalized_name: normalizePersonKey(fullName),
      phone: normalizeWhitespace(pickCell(row, map.phoneIndex)),
      level_name: levelName,
      language,
      modality: detectModalityFromText(pickCell(row, map.modalityIndex)),
      teacher_name: normalizeWhitespace(pickCell(row, map.teacherIndex)),
      status_date: excelSerialToIso(pickCell(row, map.dateIndex)),
      notes: normalizeWhitespace(pickCell(row, map.feedbackIndex)),
      source_payload: {
        header: header.map((cell) => cell.original),
        row,
      },
    });
  }
  return records;
}

function readWorkbookFromFile(filePath) {
  return XLSX.readFile(filePath, { cellDates: true, raw: true, dense: false });
}

function classifyAcademicSheetName(sheetName = "") {
  const trimmed = normalizeWhitespace(sheetName);
  const normalized = normalizeAcademicText(sheetName);
  if (!trimmed) return "ignored";
  if (trimmed === ACADEMIC_PRIMARY_SHEET || normalized === normalizeAcademicText(ACADEMIC_PRIMARY_SHEET)) return "enrollment";
  if (trimmed === ACADEMIC_PRESENTIAL_PRIMARY_SHEET || normalized === normalizeAcademicText(ACADEMIC_PRESENTIAL_PRIMARY_SHEET)) return "enrollment";
  if (ACADEMIC_TIMETABLE_SHEETS.has(trimmed) || ACADEMIC_TIMETABLE_SHEETS.has(repairMojibakeText(trimmed || ""))) return "timetable";
  if (ACADEMIC_SHEET_ALIASES.vip.has(trimmed)) return "vip";
  if (ACADEMIC_SHEET_ALIASES.intensivoVerao.has(trimmed)) return "intensive_enrollment";
  if (ACADEMIC_SHEET_ALIASES.remanejamento.has(trimmed)) return "movement";
  if (ACADEMIC_SHEET_ALIASES.reversao.has(trimmed) || normalized.includes("reversao pedagogico")) return "reversal";
  if (ACADEMIC_SHEET_ALIASES.cancelamentos.has(trimmed)) return "cancellation";
  if (ACADEMIC_SHEET_ALIASES.agendamentos.has(trimmed)) return "appointments";
  if (ACADEMIC_SHEET_ALIASES.summary.has(trimmed)) return "summary";
  if (ACADEMIC_SHEET_ALIASES.specialProject.has(trimmed)) return "special_project";
  if (normalized === normalizeAcademicText(ACADEMIC_STATUS_SHEETS.trancados)) return "trancado";
  if (normalized === normalizeAcademicText(ACADEMIC_STATUS_SHEETS.desistentes)) return "desistente";
  if (ACADEMIC_AUXILIARY_SHEETS.has(trimmed)) return "auxiliary";
  if (ACADEMIC_IGNORED_SHEETS.has(trimmed) || /^planilha\d+$/.test(normalized)) return "ignored";
  return "unknown";
}

function parseAcademicWorkbook(workbook, options = {}) {
  const workbookName = sanitizeWorkbookName(options.workbookName || "academic-workbook.xlsx");
  const sheetNames = Array.isArray(workbook?.SheetNames) ? workbook.SheetNames.slice() : [];
  const relevantSheets = [];
  const ignoredSheets = [];
  const sheetKinds = [];
  sheetNames.forEach((name) => {
    const kind = classifyAcademicSheetName(name);
    sheetKinds.push({ sheet_name: name, kind });
    if (["ignored", "auxiliary", "summary", "appointments", "unknown"].includes(kind)) {
      if (kind === "ignored" || kind === "unknown") ignoredSheets.push(name);
      return;
    }
    relevantSheets.push(name);
  });

  const matriculas = [];
  const classBlocks = [];
  const trancados = [];
  const desistentes = [];
  const cancelamentos = [];
  const movements = [];
  const auxiliarySheets = [];

  for (const { sheet_name: sheetName, kind } of sheetKinds) {
    if (kind === "enrollment") {
      if (normalizeAcademicText(sheetName) === normalizeAcademicText(ACADEMIC_PRIMARY_SHEET)) {
        matriculas.push(...parseMatriculasNovasSheet(workbook, sheetName, workbookName));
      } else {
        matriculas.push(...parsePresentialMatriculasSheet(workbook, sheetName, workbookName));
      }
      continue;
    }
    if (kind === "timetable") {
      if (normalizeAcademicText(sheetName) === normalizeAcademicText("TIME INTENSIVO")) {
        classBlocks.push(...parsePremiumTeacherMatrixSheet(workbook, sheetName, workbookName));
      } else {
        classBlocks.push(...parseGridSheet(workbook, sheetName, workbookName));
      }
      continue;
    }
    if (kind === "vip") {
      const vipResult = parseVipSheet(workbook, sheetName, workbookName);
      matriculas.push(...vipResult.enrollments);
      classBlocks.push(...vipResult.classBlocks);
      continue;
    }
    if (kind === "intensive_enrollment") {
      const intensiveResult = parseIntensiveEnrollmentSheet(workbook, sheetName, workbookName);
      matriculas.push(...intensiveResult.enrollments);
      classBlocks.push(...intensiveResult.classBlocks);
      continue;
    }
    if (kind === "movement") {
      movements.push(...parseRemanejamentoSheet(workbook, sheetName, workbookName));
      continue;
    }
    if (kind === "reversal") {
      movements.push(...parseReversaoSheet(workbook, sheetName, workbookName));
      continue;
    }
    if (kind === "cancellation") {
      cancelamentos.push(...parseCancellationSheet(workbook, sheetName, workbookName));
      continue;
    }
    if (kind === "trancado") {
      trancados.push(...parseStatusSheet(workbook, sheetName, "trancado", workbookName));
      continue;
    }
    if (kind === "desistente") {
      desistentes.push(...parseStatusSheet(workbook, sheetName, "desistente", workbookName));
      continue;
    }
    if (kind === "auxiliary" || kind === "summary" || kind === "appointments" || kind === "special_project") {
      auxiliarySheets.push({ sheet_name: sheetName, kind });
    }
  }

  const teacherMap = new Map();
  classBlocks.forEach((item) => {
    const key = normalizeAcademicText(item.teacher_normalized_name || item.teacher_display_name);
    if (!key) return;
    if (!teacherMap.has(key)) {
      teacherMap.set(key, {
        display_name: item.teacher_display_name,
        normalized_name: item.teacher_normalized_name,
      aliases: item.teacher_aliases || [],
      specialties: item.teacher_specialties || [],
    });
      return;
    }
    const current = teacherMap.get(key);
    current.aliases = Array.from(new Set([...(current.aliases || []), ...(item.teacher_aliases || [])]));
    current.specialties = Array.from(new Set([...(current.specialties || []), ...(item.teacher_specialties || [])]));
  });

  const dedupeMap = (items = [], buildKey) => Array.from(new Map((items || []).map((item) => [buildKey(item), item])).values());

  return {
    workbook_name: workbookName,
    workbook_type: normalizeAcademicText(workbookName).includes("presencial") ? "presencial" : "home-school",
    relevant_sheets: relevantSheets,
    ignored_sheets: ignoredSheets,
    auxiliary_sheets: auxiliarySheets,
    sheet_kinds: sheetKinds,
    matriculas: dedupeMap(matriculas, (item) => item.dedupe_hash || item.source_row_identifier),
    class_blocks: dedupeMap(classBlocks, (item) => item.source_block_ref || hashText(JSON.stringify(item))),
    trancados: dedupeMap(trancados, (item) => [item.normalized_name, item.level_name, item.teacher_name, item.status_date, item.source_sheet].join("|")),
    desistentes: dedupeMap(desistentes, (item) => [item.normalized_name, item.level_name, item.teacher_name, item.status_date, item.source_sheet].join("|")),
    cancelamentos: dedupeMap(cancelamentos, (item) => [item.normalized_name, item.language, item.source_sheet, item.notes].join("|")),
    movements: dedupeMap(movements, (item) => [item.movement_type, item.normalized_name, item.target_class_label || item.level_name || "", item.status_date || "", item.source_sheet].join("|")),
    teachers: Array.from(teacherMap.values()),
  };
}

module.exports = {
  ACADEMIC_PRIMARY_SHEET,
  ACADEMIC_PRESENTIAL_PRIMARY_SHEET,
  ACADEMIC_TIMETABLE_SHEETS,
  ACADEMIC_IGNORED_SHEETS,
  ACADEMIC_SHEET_ALIASES,
  buildProgramName,
  classifyAcademicSheetName,
  deriveSchoolTermName,
  deriveSemesterCode,
  detectAcademicClassKind,
  detectLanguageFromText,
  detectModalityFromText,
  detectWeekdaysFromText,
  excelSerialToIso,
  excelTimeToHHmm,
  normalizeAcademicText,
  normalizePersonKey,
  parseAcademicWorkbook,
  parseTeacherHeader,
  readWorkbookFromFile,
  sanitizeWorkbookName,
  stripTrailingStudentAnnotations,
  toTitleCase,
};
