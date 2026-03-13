const path = require('path');
const XLSX = require('xlsx');
const { hashText } = require('./semantic');
const { normalizeText: normalizeLanguageText, normalizeLanguageCode } = require('./language');

const SALES_PRIMARY_SHEET = 'MATRICULAS NOVAS';
const DEFAULT_CLOSER_ALIAS_SEEDS = [
  { official_name: 'Bruna Rafaela', alias_name: 'Bruna', origin: 'bootstrap' },
];

function normalizeSalesText(value = '') {
  return String(normalizeLanguageText(value || '') || '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function sanitizeWorkbookName(value = '') {
  return path.basename(String(value || '').trim() || 'planilha.xlsx');
}

function toVisibleString(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return String(value).trim();
}

function isExcelDateNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) && value > 30000 && value < 70000;
}

function excelSerialToIso(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  if (!isExcelDateNumber(value)) {
    const asText = String(value || '').trim();
    if (!asText) return '';
    const parsed = new Date(asText);
    return Number.isNaN(parsed.getTime()) ? asText : parsed.toISOString().slice(0, 10);
  }
  const utcDays = Math.floor(Number(value) - 25569);
  const utcValue = utcDays * 86400;
  const dateInfo = new Date(utcValue * 1000);
  if (Number.isNaN(dateInfo.getTime())) return '';
  return dateInfo.toISOString().slice(0, 10);
}

function readWorkbookFromFile(filePath) {
  return XLSX.readFile(filePath, { cellDates: true, raw: true, dense: false });
}

function readWorkbookFromBuffer(buffer, workbookName = 'planilha.xlsx') {
  return XLSX.read(buffer, { type: 'buffer', cellDates: true, raw: true, dense: false, WTF: false, bookVBA: false, bookFiles: false, bookDeps: false, bookSheets: false, sheets: undefined, filename: workbookName });
}

function listSheetNames(workbook) {
  return Array.isArray(workbook?.SheetNames) ? workbook.SheetNames.slice() : [];
}

function listVisibleSheetNames(workbook) {
  const states = Array.isArray(workbook?.Workbook?.Sheets) ? workbook.Workbook.Sheets : [];
  const hiddenByName = new Map(states.map((item) => [item?.name || item?.Name, Number(item?.Hidden || 0)]));
  return listSheetNames(workbook).filter((name) => Number(hiddenByName.get(name) || 0) === 0);
}

function normalizeSheetName(value = '') {
  return normalizeSalesText(value).replace(/\s+/g, ' ').trim();
}

function isIgnoredCloserSheet(name = '') {
  const safe = normalizeSheetName(name);
  if (!safe) return true;
  return /^pagina\d+$/.test(safe)
    || /^planilha\d+$/.test(safe)
    || safe.includes('intensivo inverno')
    || safe === normalizeSheetName(SALES_PRIMARY_SHEET)
    || safe === '$$$';
}

function extractCloserSheetNames(workbook) {
  return listVisibleSheetNames(workbook).filter((name) => !isIgnoredCloserSheet(name));
}

function getSheetRows(workbook, sheetName) {
  const sheet = workbook?.Sheets?.[sheetName];
  if (!sheet) return [];
  return XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    raw: true,
    defval: '',
    blankrows: false,
  });
}

function buildHeaderDescriptor(row = []) {
  return row.map((cell, index) => ({
    index,
    original: toVisibleString(cell),
    normalized: normalizeSalesText(cell),
  }));
}

function findHeaderRowIndex(rows = []) {
  for (let index = 0; index < Math.min(rows.length, 10); index += 1) {
    const header = buildHeaderDescriptor(rows[index]);
    const normalized = header.map((cell) => cell.normalized);
    const hasName = normalized.some((value) => value.includes('nome'));
    const hasCloser = normalized.some((value) => value.includes('atendente'));
    const hasDate = normalized.some((value) => value === 'data');
    if (hasName && (hasCloser || hasDate)) return index;
  }
  return 0;
}

function findColumnIndex(header = [], patterns = []) {
  for (const pattern of patterns) {
    const found = header.find((cell) => pattern.test(cell.normalized));
    if (found) return found.index;
  }
  return -1;
}

function inferSalesColumnMap(header = []) {
  const nameIndex = findColumnIndex(header, [/^nome completo$/, /^nome$/]);
  const semesterIndex = findColumnIndex(header, [/^semestre$/]);
  const availabilityIndex = findColumnIndex(header, [/^disponibilidade$/]);
  const modalityIndex = findColumnIndex(header, [/^modalidade$/]);
  const classTypeIndex = findColumnIndex(header, [/^tipo$/]);
  const systemIndex = findColumnIndex(header, [/^sistema$/]);
  const contractIndex = findColumnIndex(header, [/^contrato$/]);
  const languageIndex = findColumnIndex(header, [/^idioma$/]);
  const closerIndex = findColumnIndex(header, [/^atendente$/]);
  const professionIndex = findColumnIndex(header, [/^profissao$/, /^profissao atual$/]);
  const mediaIndex = findColumnIndex(header, [/^midia$/, /^origem$/, /^origem midia$/]);
  const indicationIndex = findColumnIndex(header, [/^indicacao$/, /^indicacao da closer$/]);
  const monthIndex = findColumnIndex(header, [/^mes$/]);
  const dateIndex = findColumnIndex(header, [/^data$/]);
  const courseIndex = findColumnIndex(header, [/^curso$/, /^nivel$/, /^nivel do curso$/]);

  let inferredCourseIndex = courseIndex;
  if (inferredCourseIndex < 0 && nameIndex >= 0 && semesterIndex > nameIndex + 1) {
    inferredCourseIndex = nameIndex + 1;
  }

  let inferredModalityIndex = modalityIndex;
  if (inferredModalityIndex < 0 && availabilityIndex >= 0) inferredModalityIndex = availabilityIndex + 1;

  let inferredTypeIndex = classTypeIndex;
  if (inferredTypeIndex < 0 && inferredModalityIndex >= 0) inferredTypeIndex = inferredModalityIndex + 1;

  let inferredSystemIndex = systemIndex;
  if (inferredSystemIndex < 0 && inferredTypeIndex >= 0) inferredSystemIndex = inferredTypeIndex + 1;

  let inferredIndicationIndex = indicationIndex;
  if (inferredIndicationIndex < 0 && mediaIndex >= 0) inferredIndicationIndex = mediaIndex + 1;

  return {
    monthIndex,
    dateIndex,
    nameIndex,
    courseIndex: inferredCourseIndex,
    semesterIndex,
    availabilityIndex,
    modalityIndex: inferredModalityIndex,
    classTypeIndex: inferredTypeIndex,
    systemIndex: inferredSystemIndex,
    contractIndex,
    languageIndex,
    closerIndex,
    professionIndex,
    mediaIndex,
    indicationIndex: inferredIndicationIndex,
  };
}

function pickCell(row = [], index) {
  if (index < 0 || index >= row.length) return '';
  return row[index];
}

function normalizeImportedLanguage(value = '') {
  return normalizeLanguageCode(value || detectSimpleLanguage(value));
}

function detectSimpleLanguage(value = '') {
  const safe = normalizeSalesText(value);
  if (safe.includes('english') || safe.includes('ingles')) return 'en';
  if (safe.includes('frances') || safe.includes('french')) return 'fr';
  if (safe.includes('italiano') || safe.includes('italian')) return 'it';
  if (safe.includes('espanhol') || safe.includes('spanish')) return 'es';
  return 'pt';
}

function buildImportHashes(item) {
  const dedupeBase = [
    normalizeSalesText(item.student_name),
    normalizeSalesText(item.course_name),
    item.sale_date,
    normalizeSalesText(item.language),
    normalizeSalesText(item.closer_normalized || item.closer_original),
    normalizeSalesText(item.modality),
    normalizeSalesText(item.class_type),
    normalizeSalesText(item.source_sheet),
  ].join('|');

  const rowHashBase = JSON.stringify({
    source_sheet: item.source_sheet,
    source_row_number: item.source_row_number,
    student_name: item.student_name,
    course_name: item.course_name,
    sale_month: item.sale_month,
    sale_date: item.sale_date,
    semester_label: item.semester_label,
    availability: item.availability,
    modality: item.modality,
    class_type: item.class_type,
    system_name: item.system_name,
    contract_status: item.contract_status,
    language: item.language,
    closer_original: item.closer_original,
    profession: item.profession,
    media_source: item.media_source,
    indication: item.indication,
    source_payload: item.source_payload,
  });

  return {
    dedupe_hash: hashText(dedupeBase),
    row_hash: hashText(rowHashBase),
  };
}

function parseMatriculasWorkbook(workbook, options = {}) {
  const workbookName = sanitizeWorkbookName(options.workbookName || 'vendas.xlsx');
  const sourceSheet = options.sheetName || SALES_PRIMARY_SHEET;
  const rows = getSheetRows(workbook, sourceSheet);
  if (!rows.length) {
    return { workbook_name: workbookName, sheet_name: sourceSheet, header: [], records: [] };
  }

  const headerRowIndex = findHeaderRowIndex(rows);
  const header = buildHeaderDescriptor(rows[headerRowIndex] || []);
  const map = inferSalesColumnMap(header);
  const records = [];

  for (let rowIndex = headerRowIndex + 1; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex] || [];
    const studentName = toVisibleString(pickCell(row, map.nameIndex));
    const closerOriginal = toVisibleString(pickCell(row, map.closerIndex));
    const courseName = toVisibleString(pickCell(row, map.courseIndex));
    if (!studentName && !closerOriginal && !courseName) continue;

    const record = {
      source_workbook: workbookName,
      source_sheet: sourceSheet,
      source_row_number: rowIndex + 1,
      source_row_identifier: `${sourceSheet}:${rowIndex + 1}`,
      sale_month: toVisibleString(pickCell(row, map.monthIndex)),
      sale_date: excelSerialToIso(pickCell(row, map.dateIndex)),
      student_name: studentName,
      course_name: courseName,
      semester_label: toVisibleString(pickCell(row, map.semesterIndex)),
      availability: toVisibleString(pickCell(row, map.availabilityIndex)),
      modality: toVisibleString(pickCell(row, map.modalityIndex)),
      class_type: toVisibleString(pickCell(row, map.classTypeIndex)),
      system_name: toVisibleString(pickCell(row, map.systemIndex)),
      contract_status: toVisibleString(pickCell(row, map.contractIndex)),
      language: normalizeImportedLanguage(toVisibleString(pickCell(row, map.languageIndex))),
      closer_original: closerOriginal,
      closer_normalized: normalizeSalesText(closerOriginal),
      profession: toVisibleString(pickCell(row, map.professionIndex)),
      media_source: toVisibleString(pickCell(row, map.mediaIndex)),
      indication: toVisibleString(pickCell(row, map.indicationIndex)),
      source_payload: {
        header: header.map((cell) => cell.original),
        row,
      },
    };

    Object.assign(record, buildImportHashes(record));
    records.push(record);
  }

  return {
    workbook_name: workbookName,
    sheet_name: sourceSheet,
    header: header.map((cell) => cell.original),
    records,
  };
}

module.exports = {
  DEFAULT_CLOSER_ALIAS_SEEDS,
  SALES_PRIMARY_SHEET,
  excelSerialToIso,
  extractCloserSheetNames,
  getSheetRows,
  listSheetNames,
  listVisibleSheetNames,
  normalizeSalesText,
  parseMatriculasWorkbook,
  readWorkbookFromBuffer,
  readWorkbookFromFile,
  sanitizeWorkbookName,
};
