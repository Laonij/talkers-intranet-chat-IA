"use strict";

const path = require("path");
const XLSX = require("xlsx");
const { hashText } = require("./semantic");
const { normalizeLanguageCode, repairMojibakeText } = require("./language");

const ACADEMIC_PRIMARY_SHEET = "MATRICULAS NOVAS";
const ACADEMIC_TIMETABLE_SHEETS = new Set([
  "2 e 4 ONLINE",
  "3 e 5 ONLINE",
  "Sexta ONLINE",
  "Sáb ONLINE",
  "Sab ONLINE",
  "INTENSIVO INVERNO 2024.2",
]);
const ACADEMIC_STATUS_SHEETS = {
  desistentes: "Desistentes",
  trancados: "TRANCADOS",
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

const TEACHER_PREFIX_RE = /\b(?:teacher|professor|professora|maestro|maestra)\b/gi;
const TEACHER_ALIAS_MAP = new Map([
  ["natally", "nataly"],
  ["nataly", "nataly"],
  ["rodolpho", "rodolpho"],
  ["matheus susi", "matheus susi"],
  ["matheous susi", "matheus susi"],
  ["mateus pagnussat", "mateus pagnussat"],
  ["mateus pagnussat", "mateus pagnussat"],
  ["mateus pagnussatt", "mateus pagnussat"],
  ["thais castro", "thais castro"],
  ["thais lino", "thais lino"],
  ["thais corte batista", "thais corte batista"],
  ["virginia", "virginia"],
  ["angelo", "angelo"],
  ["ângelo", "angelo"],
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

function toTitleCase(value = "") {
  return normalizeWhitespace(value)
    .split(" ")
    .filter(Boolean)
    .map((token) => token.charAt(0).toUpperCase() + token.slice(1).toLowerCase())
    .join(" ");
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

function buildProgramName(language = "", levelName = "", modality = "") {
  const parts = [levelName, language, modality].filter(Boolean);
  return parts.join(" - ") || levelName || language || modality || "Programa acadêmico";
}

function parseTeacherHeader(rawValue = "") {
  const raw = normalizeWhitespace(repairMojibakeText(rawValue || ""));
  if (!raw) return null;
  const normalized = normalizeAcademicText(raw);
  if (!/(teacher|professor|professora|maestro|maestra)/.test(normalized)) return null;
  const specialties = [];
  const parentheticalMatches = [...raw.matchAll(/\(([^)]+)\)/g)];
  parentheticalMatches.forEach((match) => {
    const text = normalizeWhitespace(match[1] || "");
    if (text) specialties.push(text);
  });
  const displayBase = normalizeWhitespace(raw.replace(TEACHER_PREFIX_RE, " ").replace(/\([^)]*\)/g, " "));
  const displayName = toTitleCase(displayBase || raw);
  const normalizedName = TEACHER_ALIAS_MAP.get(normalizeAcademicText(displayName)) || normalizeAcademicText(displayName);
  return {
    raw_header: raw,
    display_name: displayName,
    normalized_name: normalizedName,
    aliases: Array.from(new Set([displayName, raw].filter(Boolean))),
    specialties,
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
  const modality = detectModalityFromText(descriptorBlob) || "online";
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

function parseAcademicWorkbook(workbook, options = {}) {
  const workbookName = sanitizeWorkbookName(options.workbookName || "academic-workbook.xlsx");
  const sheetNames = Array.isArray(workbook?.SheetNames) ? workbook.SheetNames.slice() : [];
  const relevantSheets = [];
  const ignoredSheets = [];
  sheetNames.forEach((name) => {
    const normalized = normalizeAcademicText(name);
    const trimmed = normalizeWhitespace(name);
    if (
      trimmed === ACADEMIC_PRIMARY_SHEET
      || ACADEMIC_TIMETABLE_SHEETS.has(trimmed)
      || normalized === normalizeAcademicText(ACADEMIC_STATUS_SHEETS.desistentes)
      || normalized === normalizeAcademicText(ACADEMIC_STATUS_SHEETS.trancados)
    ) {
      relevantSheets.push(name);
    } else if (ACADEMIC_IGNORED_SHEETS.has(trimmed) || /^planilha\d+$/.test(normalized)) {
      ignoredSheets.push(name);
    }
  });

  const matriculas = sheetNames.includes(ACADEMIC_PRIMARY_SHEET)
    ? parseMatriculasNovasSheet(workbook, ACADEMIC_PRIMARY_SHEET, workbookName)
    : [];
  const gridSheets = relevantSheets.filter((name) => ACADEMIC_TIMETABLE_SHEETS.has(normalizeWhitespace(name)));
  const classBlocks = gridSheets.flatMap((sheetName) => parseGridSheet(workbook, sheetName, workbookName));
  const trancadosSheet = sheetNames.find((name) => normalizeAcademicText(name) === normalizeAcademicText(ACADEMIC_STATUS_SHEETS.trancados));
  const desistentesSheet = sheetNames.find((name) => normalizeAcademicText(name) === normalizeAcademicText(ACADEMIC_STATUS_SHEETS.desistentes));
  const trancados = trancadosSheet ? parseStatusSheet(workbook, trancadosSheet, "trancado", workbookName) : [];
  const desistentes = desistentesSheet ? parseStatusSheet(workbook, desistentesSheet, "desistente", workbookName) : [];

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

  return {
    workbook_name: workbookName,
    relevant_sheets: relevantSheets,
    ignored_sheets: ignoredSheets,
    matriculas,
    class_blocks: classBlocks,
    trancados,
    desistentes,
    teachers: Array.from(teacherMap.values()),
  };
}

module.exports = {
  ACADEMIC_PRIMARY_SHEET,
  ACADEMIC_TIMETABLE_SHEETS,
  ACADEMIC_IGNORED_SHEETS,
  buildProgramName,
  deriveSchoolTermName,
  deriveSemesterCode,
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
