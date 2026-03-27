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
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Number.isInteger(value) ? String(value) : String(value).replace(/\.0+$/, '');
  }
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

function inferPostSaleColumnMap(header = []) {
  return {
    dateIndex: findColumnIndex(header, [/^data$/]),
    nameIndex: findColumnIndex(header, [/^nome$/, /^nome completo$/]),
    phoneIndex: findColumnIndex(header, [/^telefone$/, /^fone$/, /^whatsapp$/]),
    levelIndex: findColumnIndex(header, [/^nivel$/, /^nível$/, /^curso$/]),
    teacherIndex: findColumnIndex(header, [/^professor$/, /^teacher$/]),
    semesterIndex: findColumnIndex(header, [/^semestre$/]),
    modalityIndex: findColumnIndex(header, [/^modalidade$/]),
    classTypeIndex: findColumnIndex(header, [/^tipo$/]),
    systemIndex: findColumnIndex(header, [/^sistema$/]),
    languageIndex: findColumnIndex(header, [/^idioma$/]),
    attendantIndex: findColumnIndex(header, [/^atendente$/]),
    mediaIndex: findColumnIndex(header, [/^midia$/, /^mídia$/, /^origem$/]),
    indicationIndex: findColumnIndex(header, [/^indicacao$/, /^indicação$/]),
    feedbackIndex: findColumnIndex(header, [/^feedback$/, /^retorno$/]),
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
    normalizeSalesText(item.course_name || item.level_name),
    item.sale_date,
    normalizeSalesText(item.semester_label),
    normalizeSalesText(item.language),
    normalizeSalesText(item.closer_normalized || item.closer_original),
    normalizeSalesText(item.source_sheet),
  ].join('|');

  const rowHashBase = JSON.stringify({
    source_sheet: item.source_sheet,
    source_row_number: item.source_row_number,
    student_name: item.student_name,
    course_name: item.course_name,
    level_name: item.level_name,
    phone: item.phone,
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
    teacher_name: item.teacher_name,
    attendant_name: item.attendant_name,
    feedback: item.feedback,
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

function isMeaningfulPostSaleRow(record = {}) {
  return Boolean(
    String(record.student_name || '').trim()
    || String(record.phone || '').trim()
    || String(record.level_name || '').trim()
    || String(record.language || '').trim()
    || String(record.feedback || '').trim()
  );
}

function normalizeSemesterValue(value) {
  if (value === null || value === undefined || value === '') return '';
  if (value instanceof Date || isExcelDateNumber(value)) {
    return excelSerialToIso(value);
  }
  return toVisibleString(value);
}

function parsePostSaleWorkbook(workbook, options = {}) {
  const workbookName = sanitizeWorkbookName(options.workbookName || 'pos-venda.xlsx');
  const sheetNames = extractCloserSheetNames(workbook);
  const sheets = [];
  const records = [];

  for (const sheetName of sheetNames) {
    const rows = getSheetRows(workbook, sheetName);
    if (!rows.length) continue;
    const headerRowIndex = findHeaderRowIndex(rows);
    const header = buildHeaderDescriptor(rows[headerRowIndex] || []);
    const map = inferPostSaleColumnMap(header);
    const sheetRecords = [];

    for (let rowIndex = headerRowIndex + 1; rowIndex < rows.length; rowIndex += 1) {
      const row = rows[rowIndex] || [];
      const studentName = toVisibleString(pickCell(row, map.nameIndex));
      const phone = toVisibleString(pickCell(row, map.phoneIndex));
      const levelName = toVisibleString(pickCell(row, map.levelIndex));
      const teacherName = toVisibleString(pickCell(row, map.teacherIndex));
      const semesterLabel = normalizeSemesterValue(pickCell(row, map.semesterIndex));
      const modality = toVisibleString(pickCell(row, map.modalityIndex));
      const classType = toVisibleString(pickCell(row, map.classTypeIndex));
      const systemName = toVisibleString(pickCell(row, map.systemIndex));
      const language = normalizeImportedLanguage(toVisibleString(pickCell(row, map.languageIndex)));
      const attendantName = toVisibleString(pickCell(row, map.attendantIndex));
      const mediaSource = toVisibleString(pickCell(row, map.mediaIndex));
      const indication = toVisibleString(pickCell(row, map.indicationIndex));
      const feedback = toVisibleString(pickCell(row, map.feedbackIndex));

      const record = {
        source_workbook: workbookName,
        source_sheet: sheetName,
        source_row_number: rowIndex + 1,
        source_row_identifier: `${sheetName}:${rowIndex + 1}`,
        sale_date: excelSerialToIso(pickCell(row, map.dateIndex)),
        student_name: studentName,
        phone,
        course_name: levelName,
        level_name: levelName,
        teacher_name: teacherName,
        attendant_name: attendantName,
        semester_label: semesterLabel,
        availability: '',
        modality,
        class_type: classType,
        system_name: systemName,
        contract_status: '',
        language,
        closer_original: sheetName,
        closer_normalized: normalizeSalesText(sheetName),
        profession: '',
        media_source: mediaSource,
        indication,
        feedback,
        source_payload: {
          header: header.map((cell) => cell.original),
          row,
          sheet_closer: sheetName,
          attendant_name: attendantName,
        },
      };

      if (!isMeaningfulPostSaleRow(record)) continue;
      Object.assign(record, buildImportHashes(record));
      sheetRecords.push(record);
      records.push(record);
    }

    if (sheetRecords.length) {
      sheets.push({
        sheet_name: sheetName,
        records: sheetRecords,
        total_rows: sheetRecords.length,
        header: header.map((cell) => cell.original),
      });
    }
  }

  return {
    workbook_name: workbookName,
    sheet_names: sheets.map((sheet) => sheet.sheet_name),
    sheets,
    records,
  };
}

module.exports = {
  DEFAULT_CLOSER_ALIAS_SEEDS,
  SALES_PRIMARY_SHEET,
  excelSerialToIso,
  extractCloserSheetNames,
  getSheetRows,
  inferPostSaleColumnMap,
  listSheetNames,
  listVisibleSheetNames,
  normalizeSalesText,
  parseMatriculasWorkbook,
  parsePostSaleWorkbook,
  readWorkbookFromBuffer,
  readWorkbookFromFile,
  sanitizeWorkbookName,
};
