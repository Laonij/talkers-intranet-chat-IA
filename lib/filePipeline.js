const fs = require("fs");
const path = require("path");
const XLSX = require("xlsx");

const { createLogger } = require("./appLogger");
const { transcribeMedia } = require("./audio");
const { detectExt, extractText } = require("./extract");
const { ocrImage } = require("./ocr");
const { sanitizeTextForPostgres } = require("./postgresSanitizer");
const { extractKeywords, normalizeSemanticText } = require("./semantic");

const pipelineLogger = createLogger("documents");

function normalizeCellValue(value) {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }
  return sanitizeTextForPostgres(String(value).replace(/\s+/g, " ").trim(), {
    trim: true,
    normalizeWhitespace: false,
  }) || "";
}

function detectFileKind(file = {}) {
  const ext = detectExt(file.fullPath || "", file.original_name || file.originalName || "", file.mime_type || file.mimeType || "");
  const mime = String(file.mime_type || file.mimeType || "").toLowerCase();

  if ([".xlsx", ".xls", ".csv"].includes(ext)) return "spreadsheet";
  if ([".pdf"].includes(ext)) return "pdf";
  if ([".docx", ".doc", ".txt", ".md"].includes(ext)) return "document";
  if ([".pptx", ".ppt"].includes(ext)) return "presentation";
  if (mime.startsWith("image/") || [".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp"].includes(ext)) return "image";
  if (mime.startsWith("audio/") || mime.startsWith("video/")) return "media";
  return "generic";
}

function buildConversationFilePath(uploadsDir, storedName = "") {
  if (!uploadsDir || !storedName) return "";
  return path.join(uploadsDir, storedName);
}

function scoreFileForQuery(file = {}, userText = "", index = 0) {
  const normalizedQuery = normalizeSemanticText(userText);
  const name = normalizeSemanticText(file.original_name || "");
  const mime = String(file.mime_type || "").toLowerCase();
  const kind = detectFileKind(file);
  let score = Math.max(0, 100 - index * 7);

  if (/planilha|xlsx|excel|csv|aba|coluna|linha|matricula|grade|horario|dados|kpi/.test(normalizedQuery) && kind === "spreadsheet") {
    score += 75;
  }
  if (/pdf|documento|docx|word|contrato|comunicado|relatorio|resumo executivo|manual|checklist/.test(normalizedQuery) && (kind === "pdf" || kind === "document")) {
    score += 65;
  }
  if (/ppt|pptx|slide|slides|apresentacao|deck|powerpoint/.test(normalizedQuery) && kind === "presentation") {
    score += 70;
  }
  if (/imagem|foto|anexo|banner|arte|transforme|anime|viking|desenho|estilo|minha foto|minha imagem/.test(normalizedQuery) && kind === "image") {
    score += 80;
  }
  if (/audio|video|voz|gravacao|transcricao|midia|reuniao/.test(normalizedQuery) && kind === "media") {
    score += 70;
  }
  if (/arquivo|anexo|documento|isso|esse|essa|esta|nesta|nesse/.test(normalizedQuery)) {
    score += 10;
  }
  if (name && normalizedQuery && normalizedQuery.includes(name)) {
    score += 40;
  }
  if (mime.includes("spreadsheetml") || mime.includes("excel")) score += 4;

  return score;
}

function selectRelevantConversationFile(files = [], userText = "") {
  if (!Array.isArray(files) || !files.length) return null;
  return files
    .map((file, index) => ({ ...file, __score: scoreFileForQuery(file, userText, index) }))
    .sort((left, right) => right.__score - left.__score || Number(right.id || 0) - Number(left.id || 0))[0] || null;
}

function inferColumnType(values = []) {
  const filtered = values.map(normalizeCellValue).filter(Boolean).slice(0, 20);
  if (!filtered.length) return "empty";

  const numericMatches = filtered.filter((value) => /^-?\d+(?:[.,]\d+)?$/.test(value)).length;
  const dateMatches = filtered.filter((value) => /^\d{1,2}[/-]\d{1,2}[/-]\d{2,4}$/.test(value) || /^\d{4}-\d{2}-\d{2}/.test(value)).length;
  const emailMatches = filtered.filter((value) => /@/.test(value)).length;
  const phoneMatches = filtered.filter((value) => /\d{8,}/.test(value)).length;

  if (numericMatches >= Math.max(2, Math.ceil(filtered.length * 0.7))) return "number";
  if (dateMatches >= Math.max(2, Math.ceil(filtered.length * 0.5))) return "date";
  if (emailMatches >= Math.max(1, Math.ceil(filtered.length * 0.4))) return "email";
  if (phoneMatches >= Math.max(1, Math.ceil(filtered.length * 0.4))) return "phone";
  return "text";
}

function inferHeaderRow(rows = []) {
  const searchRows = rows.slice(0, 8);
  let bestIndex = 0;
  let bestScore = -1;

  searchRows.forEach((row, rowIndex) => {
    const values = Array.isArray(row) ? row.map(normalizeCellValue) : [];
    const nonEmpty = values.filter(Boolean);
    if (!nonEmpty.length) return;
    const unique = new Set(nonEmpty.map((value) => value.toLowerCase())).size;
    const score = nonEmpty.length * 4 + unique * 2 - rowIndex;
    if (score > bestScore) {
      bestScore = score;
      bestIndex = rowIndex;
    }
  });

  return bestIndex;
}

function buildSheetProfile(sheetName, rows = []) {
  const normalizedRows = rows
    .map((row) => (Array.isArray(row) ? row.map(normalizeCellValue) : []))
    .filter((row) => row.some(Boolean));

  const totalRows = normalizedRows.length;
  if (!totalRows) {
    return {
      sheet_name: sheetName,
      headers: [],
      data_rows_total: 0,
      sample_rows: [],
      columns: [],
      hints: [],
    };
  }

  const headerRowIndex = inferHeaderRow(normalizedRows);
  const rawHeaders = normalizedRows[headerRowIndex] || [];
  const headers = rawHeaders.map((value, index) => value || `Coluna ${index + 1}`);
  const dataRows = normalizedRows.slice(headerRowIndex + 1).filter((row) => row.some(Boolean));
  const columnCount = headers.length;

  const sampleRows = dataRows.slice(0, 8).map((row) => {
    const out = {};
    headers.forEach((header, index) => {
      out[header] = normalizeCellValue(row[index]);
    });
    return out;
  });

  const columns = headers.map((header, index) => {
    const values = dataRows.map((row) => row[index]);
    const nonEmptyValues = values.map(normalizeCellValue).filter(Boolean);
    return {
      name: header,
      detected_type: inferColumnType(nonEmptyValues),
      fill_rate: values.length ? Number((nonEmptyValues.length / values.length).toFixed(2)) : 0,
      sample_values: nonEmptyValues.slice(0, 4),
    };
  });

  const lowerHeaders = headers.map((value) => normalizeSemanticText(value));
  const hints = [];
  if (lowerHeaders.some((value) => /status|situacao|estado/.test(value))) {
    const statusIndex = lowerHeaders.findIndex((value) => /status|situacao|estado/.test(value));
    const counts = new Map();
    dataRows.forEach((row) => {
      const key = normalizeCellValue(row[statusIndex]);
      if (!key) return;
      counts.set(key, (counts.get(key) || 0) + 1);
    });
    if (counts.size) {
      const topStatuses = [...counts.entries()]
        .sort((left, right) => right[1] - left[1])
        .slice(0, 4)
        .map(([label, total]) => `${label}: ${total}`);
      hints.push(`Distribuicao de status: ${topStatuses.join(", ")}`);
    }
  }
  if (lowerHeaders.some((value) => /data|dia|inicio|fim|vencimento/.test(value))) {
    hints.push("Ha colunas com indicios de datas ou cronograma.");
  }
  if (lowerHeaders.some((value) => /matricula|aluno|responsavel|turma/.test(value))) {
    hints.push("A estrutura parece relacionada a alunos, matriculas ou turmas.");
  }
  if (lowerHeaders.some((value) => /receita|valor|despesa|saldo|pagamento/.test(value))) {
    hints.push("A estrutura parece relacionada a controle financeiro.");
  }

  return {
    sheet_name: sheetName,
    headers,
    column_count: columnCount,
    data_rows_total: dataRows.length,
    sample_rows: sampleRows,
    columns,
    hints,
  };
}

function buildSpreadsheetAnalysisText(profile) {
  const lines = [];
  lines.push(`Arquivo analisado: ${profile.original_name}`);
  lines.push(`Tipo: planilha (${profile.extension || "xlsx/csv"})`);
  lines.push(`Abas detectadas: ${profile.sheets.length}`);
  lines.push("");

  profile.sheets.forEach((sheet) => {
    lines.push(`### Aba: ${sheet.sheet_name}`);
    lines.push(`- Linhas com dados: ${sheet.data_rows_total}`);
    lines.push(`- Colunas: ${sheet.column_count || sheet.headers.length}`);
    if (sheet.headers.length) {
      lines.push(`- Cabecalhos: ${sheet.headers.join(", ")}`);
    }
    if (sheet.hints.length) {
      sheet.hints.forEach((hint) => lines.push(`- ${hint}`));
    }
    if (sheet.sample_rows.length) {
      lines.push("- Amostra de linhas:");
      sheet.sample_rows.slice(0, 3).forEach((row) => {
        const rowPreview = Object.entries(row)
          .filter(([, value]) => String(value || "").trim())
          .slice(0, 6)
          .map(([key, value]) => `${key}: ${value}`)
          .join(" | ");
        if (rowPreview) lines.push(`  - ${rowPreview}`);
      });
    }
    lines.push("");
  });

  const globalHints = profile.sheets.flatMap((sheet) => sheet.hints || []).slice(0, 6);
  if (globalHints.length) {
    lines.push("### Leitura rapida");
    globalHints.forEach((hint) => lines.push(`- ${hint}`));
    lines.push("");
  }

  lines.push("Se quiser, posso tambem:");
  lines.push("- resumir a planilha por aba");
  lines.push("- apontar colunas criticas e padroes encontrados");
  lines.push("- sugerir indicadores, filtros ou um novo modelo de planilha");
  lines.push("- devolver uma planilha reorganizada com resumo executivo e abas auxiliares");

  return lines.join("\n");
}

function parseWorkbookStructure(filePath, originalName = "", mimeType = "") {
  const workbook = XLSX.readFile(filePath, {
    cellDates: true,
    raw: false,
    defval: "",
  });

  const sheets = workbook.SheetNames.map((sheetName) => {
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(sheet, {
      header: 1,
      defval: "",
      raw: false,
      blankrows: false,
    });
    return buildSheetProfile(sheetName, rows);
  });

  const summaryKeywords = extractKeywords(
    sheets
      .map((sheet) => [sheet.sheet_name, ...(sheet.headers || []), ...(sheet.hints || [])].join(" "))
      .join(" "),
    18
  );

  const profile = {
    parser: "xlsx-structured",
    kind: "spreadsheet",
    original_name: originalName || path.basename(filePath),
    mime_type: mimeType || "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    extension: path.extname(originalName || filePath).toLowerCase(),
    sheet_count: sheets.length,
    sheets,
    keywords: summaryKeywords,
    summary_text: buildSpreadsheetAnalysisText({
      original_name: originalName || path.basename(filePath),
      extension: path.extname(originalName || filePath).toLowerCase(),
      sheets,
    }),
  };

  return profile;
}

function summarizeDocumentText(originalName, ext, text) {
  const safeText = String(text || "").trim();
  const paragraphs = safeText.split(/\n{2,}/).map((block) => block.trim()).filter(Boolean);
  const headings = safeText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && line.length <= 80 && /^[A-Z0-9][^.!?]*$/.test(line))
    .slice(0, 8);
  const preview = paragraphs.slice(0, 4).join("\n\n").slice(0, 2200);

  return {
    parser: "text-structured",
    kind: ext === ".pdf" ? "pdf" : ext === ".pptx" ? "presentation" : "document",
    original_name: originalName,
    extension: ext,
    headings,
    paragraph_count: paragraphs.length,
    char_count: safeText.length,
    keywords: extractKeywords(safeText, 16),
    preview_text: preview,
    source_text_excerpt: safeText.slice(0, 12000),
    summary_text: [
      `Arquivo analisado: ${originalName}`,
      `Tipo: ${ext || "documento"}`,
      `Tamanho textual aproximado: ${safeText.length} caracteres`,
      headings.length ? `Secoes detectadas: ${headings.join(", ")}` : "",
      "",
      "### Trecho inicial",
      preview || "Nao houve texto suficiente para montar um resumo inicial.",
      "",
      "Se quiser, posso tambem:",
      "- resumir o documento em pontos-chave",
      "- identificar riscos, decisoes e proximos passos",
      "- transformar o conteudo em comunicado, proposta ou apresentacao",
    ].filter(Boolean).join("\n"),
  };
}

async function parseStructuredConversationFile(file = {}, options = {}) {
  const uploadsDir = options.uploadsDir || "";
  const fullPath = file.fullPath || buildConversationFilePath(uploadsDir, file.stored_name || file.storedName || "");
  if (!fullPath || !fs.existsSync(fullPath)) return null;

  const originalName = file.original_name || file.originalName || path.basename(fullPath);
  const mimeType = file.mime_type || file.mimeType || "";
  const extension = detectExt(fullPath, originalName, mimeType).toLowerCase();
  const kind = detectFileKind({ fullPath, original_name: originalName, mime_type: mimeType });

  if (kind === "spreadsheet") {
    const profile = parseWorkbookStructure(fullPath, originalName, mimeType);
    return {
      ...profile,
      file_id: Number(file.id || 0) || null,
      stored_name: file.stored_name || file.storedName || path.basename(fullPath),
      fullPath,
      size_bytes: Number(file.size_bytes || file.sizeBytes || 0),
    };
  }

  if (kind === "image") {
    let ocrText = "";
    try {
      ocrText = String(await ocrImage(fullPath) || "").trim();
    } catch {
      ocrText = "";
    }
    return {
      file_id: Number(file.id || 0) || null,
      stored_name: file.stored_name || file.storedName || path.basename(fullPath),
      fullPath,
      kind,
      parser: "image-metadata",
      original_name: originalName,
      mime_type: mimeType,
      extension,
      preview_text: ocrText.slice(0, 1800),
      source_text_excerpt: ocrText.slice(0, 12000),
      summary_text: [
        `Arquivo analisado: ${originalName}`,
        "Tipo: imagem",
        ocrText ? `Texto OCR detectado:\n${ocrText.slice(0, 1800)}` : "Nao houve texto OCR relevante. A imagem pode ser analisada visualmente pelo modelo.",
        "",
        "Se quiser, posso usar essa imagem como base para editar estilo, roupa, cenario ou acabamento.",
      ].join("\n\n"),
    };
  }

  if (kind === "media") {
    let transcriptResult = null;
    try {
      transcriptResult = await transcribeMedia(fullPath, originalName, mimeType, {
        apiKey: options.apiKey || process.env.OPENAI_API_KEY || "",
      });
    } catch (err) {
      pipelineLogger.warn("Falha ao transcrever midia selecionada.", {
        file: originalName,
        message: err?.message || String(err || "media_transcription_failed"),
      });
    }

    const transcriptText = String(transcriptResult?.text || "").trim();
    return {
      file_id: Number(file.id || 0) || null,
      stored_name: file.stored_name || file.storedName || path.basename(fullPath),
      fullPath,
      kind,
      parser: "media-reference",
      original_name: originalName,
      mime_type: mimeType,
      extension,
      preview_text: transcriptText.slice(0, 1800),
      source_text_excerpt: transcriptText.slice(0, 12000),
      summary_text: [
        `Arquivo analisado: ${originalName}`,
        "Tipo: audio ou video",
        transcriptText
          ? `Transcricao inicial:\n${transcriptText.slice(0, 1800)}`
          : "Esse arquivo precisa de transcricao ou processamento de midia para analise detalhada.",
      ].join("\n\n"),
    };
  }

  const extracted = await extractText(fullPath, originalName, mimeType);
  const profile = summarizeDocumentText(originalName, extension, extracted);
  return {
    ...profile,
    file_id: Number(file.id || 0) || null,
    stored_name: file.stored_name || file.storedName || path.basename(fullPath),
    fullPath,
    mime_type: mimeType,
    size_bytes: Number(file.size_bytes || file.sizeBytes || 0),
  };
}

function buildStructuredFileContext(fileProfile = null, userText = "", route = null) {
  if (!fileProfile) return "";
  const lines = [];
  lines.push(`Arquivo selecionado para este turno: ${fileProfile.original_name}`);
  lines.push(`Tipo detectado: ${fileProfile.kind}`);
  if (route?.reason) lines.push(`Modo inferido: ${route.reason}`);
  if (userText) lines.push(`Pedido atual do usuario: ${userText}`);
  lines.push("");
  lines.push(fileProfile.summary_text || "Sem resumo estruturado disponivel.");
  return lines.join("\n");
}

function buildArtifactSourceContext(fileProfile = null, userText = "", route = null) {
  if (!fileProfile) return "";
  const lines = [];
  lines.push(`Arquivo-base selecionado: ${fileProfile.original_name}`);
  lines.push(`Tipo do arquivo-base: ${fileProfile.kind}`);
  if (route?.artifact_kind) lines.push(`Artefato desejado: ${route.artifact_kind}`);
  if (userText) lines.push(`Pedido do usuario: ${String(userText || "").trim()}`);
  lines.push("");

  if (fileProfile.kind === "spreadsheet") {
    lines.push("Resumo estrutural da planilha:");
    for (const sheet of fileProfile.sheets || []) {
      lines.push(`- Aba ${sheet.sheet_name}: ${sheet.data_rows_total} linhas, ${sheet.column_count || sheet.headers.length} colunas`);
      if (Array.isArray(sheet.headers) && sheet.headers.length) {
        lines.push(`  Cabecalhos: ${sheet.headers.join(", ")}`);
      }
      if (Array.isArray(sheet.hints) && sheet.hints.length) {
        lines.push(`  Leitura: ${sheet.hints.join(" | ")}`);
      }
    }
  } else if (fileProfile.kind === "image") {
    lines.push("A imagem enviada deve ser usada como base se o pedido for de transformacao ou edicao.");
    if (fileProfile.preview_text) {
      lines.push(`OCR detectado: ${fileProfile.preview_text.slice(0, 1200)}`);
    }
  } else if (fileProfile.kind === "media") {
    lines.push("Resumo da midia selecionada:");
    lines.push(fileProfile.preview_text || "Sem transcricao disponivel.");
  } else {
    lines.push("Resumo do documento-base:");
    lines.push(fileProfile.source_text_excerpt || fileProfile.preview_text || fileProfile.summary_text || "");
  }

  return lines.join("\n");
}

function buildLocalFileAnalysisAnswer(fileProfile = null, route = null, userText = "") {
  if (!fileProfile) return "";
  if (fileProfile.kind === "image" && route?.source_file_mode === "image_analysis") {
    return "";
  }

  const base = String(fileProfile.summary_text || "").trim();
  if (!base) return "";

  const normalizedQuery = normalizeSemanticText(userText);
  const extra = [];

  if (fileProfile.kind === "spreadsheet" && /(melhoria|melhorar|organizar|limpar|padronizar|estrutura|kpi|kpis|corrigir)/.test(normalizedQuery)) {
    extra.push("");
    extra.push("Sugestoes iniciais de melhoria:");
    extra.push("- padronizar nomes de colunas e status");
    extra.push("- separar resumo executivo em aba propria");
    extra.push("- incluir indicadores e validacoes de dados");
    extra.push("- criar abas auxiliares para cadastros e apoio operacional");
  }

  if (["document", "pdf", "presentation"].includes(fileProfile.kind) && /(melhoria|melhorar|reescrever|formal|executivo|profissional)/.test(normalizedQuery)) {
    extra.push("");
    extra.push("Sugestoes iniciais de melhoria:");
    extra.push("- reforcar titulo, secoes e fechamento");
    extra.push("- transformar trechos longos em blocos mais executivos");
    extra.push("- destacar riscos, prazos, decisoes e proximos passos");
  }

  return [base, ...extra].join("\n");
}

module.exports = {
  buildArtifactSourceContext,
  buildConversationFilePath,
  buildLocalFileAnalysisAnswer,
  buildStructuredFileContext,
  detectFileKind,
  parseStructuredConversationFile,
  selectRelevantConversationFile,
};
