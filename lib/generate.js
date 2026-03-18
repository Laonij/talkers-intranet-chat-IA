const fs = require("fs");
const path = require("path");
const JSZip = require("jszip");
const XLSX = require("xlsx");
const { PDFDocument, StandardFonts, rgb } = require("pdf-lib");

const { createLogger } = require("./appLogger");
const { createSpeechArtifact } = require("./audio");
const { sanitizeTextForPostgres } = require("./postgresSanitizer");
const { normalizeSemanticText } = require("./semantic");

const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
const OPENAI_IMAGE_GENERATIONS_URL = "https://api.openai.com/v1/images/generations";
const OPENAI_IMAGE_EDITS_URL = "https://api.openai.com/v1/images/edits";
const ARTIFACT_TIMEOUT_MS = Math.max(15000, Number(process.env.OPENAI_ARTIFACT_TIMEOUT_MS || 45000));
const IMAGE_TIMEOUT_MS = Math.max(20000, Number(process.env.OPENAI_IMAGE_TIMEOUT_MS || 60000));
const TEXT_MODEL = String(process.env.OPENAI_ARTIFACT_MODEL || process.env.OPENAI_FALLBACK_MODEL || process.env.OPENAI_MODEL || "gpt-4.1-mini").trim();
const IMAGE_MODEL = String(process.env.OPENAI_IMAGE_MODEL || "gpt-image-1").trim();
const artifactLogger = createLogger("artifacts");

function normalizePrompt(prompt = "") {
  return sanitizeTextForPostgres(String(prompt || ""), {
    trim: true,
    normalizeWhitespace: false,
    maxLength: 24000,
  }) || "";
}

function slugifyFilename(value = "artifact") {
  return String(value || "artifact")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase()
    .slice(0, 50) || "artifact";
}

function makeArtifactFilename(prompt, ext) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `${slugifyFilename(prompt)}-${stamp}${ext}`;
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function buildFetchError(err, url, timeoutMs) {
  return {
    message: err?.message || String(err || "fetch_failed"),
    code: err?.code || err?.cause?.code || "",
    name: err?.name || "",
    url,
    timeout_ms: timeoutMs,
  };
}

async function fetchWithRetry(url, options = {}, diagnostics = {}, retryCount = 1, timeoutMs = ARTIFACT_TIMEOUT_MS) {
  let lastError = null;
  for (let attempt = 0; attempt <= retryCount; attempt += 1) {
    try {
      return await fetch(url, {
        ...options,
        signal: options.signal || AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      lastError = err;
      const details = { attempt: attempt + 1, ...diagnostics, ...buildFetchError(err, url, timeoutMs) };
      if (attempt < retryCount) {
        artifactLogger.warn("Falha em requisicao externa de artefato; tentando novamente.", details);
        continue;
      }
      throw Object.assign(err instanceof Error ? err : new Error(String(err || "fetch_failed")), { diagnostics: details });
    }
  }
  throw lastError || new Error("fetch_failed");
}

async function readResponseBodyText(resp) {
  try {
    return await resp.text();
  } catch {
    return "";
  }
}

function buildSourceContextBlock(sourceFileProfile = null, sourceContext = "") {
  const parts = [];
  const safeSourceContext = normalizePrompt(sourceContext);
  if (safeSourceContext) {
    parts.push("Contexto do arquivo-base:");
    parts.push(safeSourceContext);
  }
  if (sourceFileProfile?.summary_text && !safeSourceContext.includes(sourceFileProfile.summary_text.slice(0, 80))) {
    parts.push("Resumo local do arquivo:");
    parts.push(String(sourceFileProfile.summary_text || "").slice(0, 8000));
  }
  return parts.join("\n\n");
}

function buildArtifactInstruction(kind, prompt, sourceFileProfile = null, sourceContext = "") {
  const contextBlock = buildSourceContextBlock(sourceFileProfile, sourceContext);
  const introByKind = {
    docx: "Voce vai redigir um documento profissional pronto para virar DOCX.",
    pdf: "Voce vai redigir um documento estruturado pronto para virar PDF.",
    xlsx: "Voce vai planejar a estrutura de uma planilha profissional.",
    pptx: "Voce vai montar o conteudo de uma apresentacao profissional em slides.",
  };

  const outputGuideByKind = {
    docx: "Responda em JSON com { title, summary, sections:[{ heading, paragraphs:[], bullets:[], table:{ headers:[], rows:[[]] }? }] }.",
    pdf: "Responda em JSON com { title, summary, sections:[{ heading, paragraphs:[], bullets:[] }] }.",
    xlsx: "Responda em JSON com { title, workbook:{ sheets:[{ name, columns:[...], rows:[{...}], notes:[] }] }, summary }.",
    pptx: "Responda em JSON com { title, subtitle, slides:[{ title, bullets:[], speaker_notes:\"\", table:{ headers:[], rows:[[]] }? }] }.",
  };

  return [
    introByKind[kind] || "Voce vai produzir um artefato profissional.",
    contextBlock ? `${contextBlock}` : "",
    `Pedido do usuario: ${normalizePrompt(prompt)}`,
    "Priorize conteudo util, profissional, claro e pronto para uso. Nao escreva comentarios sobre limitacoes.",
    outputGuideByKind[kind] || "Responda em JSON estruturado.",
    "Nao use markdown fences. Retorne apenas JSON valido.",
  ].filter(Boolean).join("\n\n");
}

function parseJsonResponse(text, fallback = {}) {
  const raw = String(text || "").trim();
  if (!raw) return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    const match = raw.match(/\{[\s\S]*\}$/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch {
        return fallback;
      }
    }
    return fallback;
  }
}

async function callResponsesText(apiKey, prompt, options = {}) {
  if (!apiKey) throw new Error("openai_api_key_missing");
  const model = String(options.model || TEXT_MODEL).trim() || TEXT_MODEL;
  const temperature = Number.isFinite(Number(options.temperature)) ? Number(options.temperature) : 0.4;
  const response = await fetchWithRetry(
    OPENAI_RESPONSES_URL,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        input: prompt,
        temperature,
        max_output_tokens: Number(options.maxOutputTokens || 2400),
      }),
    },
    { label: "openai_responses_text", model },
    1,
    ARTIFACT_TIMEOUT_MS
  );

  if (!response.ok) {
    const body = await readResponseBodyText(response);
    throw Object.assign(new Error(body || `HTTP ${response.status}`), {
      response: { status: response.status },
      url: OPENAI_RESPONSES_URL,
    });
  }

  const data = await response.json();
  const outputText = Array.isArray(data?.output)
    ? data.output.flatMap((item) => Array.isArray(item?.content) ? item.content : [])
      .map((item) => item?.text || item?.output_text || "")
      .filter(Boolean)
      .join("\n")
    : String(data?.output_text || "");
  return sanitizeTextForPostgres(outputText, { trim: true, normalizeWhitespace: false, maxLength: 60000 }) || "";
}

function detectArtifactKind(prompt = "", options = {}) {
  const value = normalizeSemanticText(prompt);
  const hasReferenceImages = Array.isArray(options.referenceImages) && options.referenceImages.length > 0;
  if (!value) return null;

  if (/(audio|narre|narracao|voz|tts|locucao|locução)/.test(value)) return "audio";
  if (/(pptx|powerpoint|slides|slide|apresentacao|apresentação|deck)/.test(value)) return "pptx";
  if (/(planilha|xlsx|excel|csv|aba de resumo|kpi|kpis)/.test(value)) return "xlsx";
  if (/(pdf)/.test(value)) return "pdf";
  if (/(docx|word|documento|relatorio|relatório|proposta|contrato|comunicado|ata|manual|checklist|resumo executivo|carta)/.test(value)) return "docx";

  const imageEditCue = /(anime|viking|desenho|caricatura|cartoon|cyberpunk|troque a roupa|roupa formal|transforme|edite|minha foto|minha imagem|use a minha foto|use minha imagem|deixe em estilo|image to image)/.test(value);
  const imageGenCue = /(imagem|arte|banner|capa|ilustracao|ilustração|poster|criativo|mockup|thumbnail|logo)/.test(value) || imageEditCue;

  if (hasReferenceImages && imageEditCue) return "image_edit";
  if (imageGenCue) return hasReferenceImages && /(base|foto|imagem enviada|minha foto|minha imagem)/.test(value) ? "image_edit" : "image";
  return null;
}

function wrapText(text = "", width = 92) {
  const words = String(text || "").split(/\s+/).filter(Boolean);
  const lines = [];
  let current = "";
  for (const word of words) {
    if (!current.length || `${current} ${word}`.length <= width) {
      current = current ? `${current} ${word}` : word;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines;
}

function normalizeSection(section = {}, index = 0) {
  return {
    heading: sanitizeTextForPostgres(section.heading || `Secao ${index + 1}`, { trim: true }) || `Secao ${index + 1}`,
    paragraphs: Array.isArray(section.paragraphs) ? section.paragraphs.map((item) => sanitizeTextForPostgres(item, { trim: true, maxLength: 4000 }) || "").filter(Boolean) : [],
    bullets: Array.isArray(section.bullets) ? section.bullets.map((item) => sanitizeTextForPostgres(item, { trim: true, maxLength: 800 }) || "").filter(Boolean) : [],
    table: section.table && Array.isArray(section.table.headers) ? {
      headers: section.table.headers.map((item) => sanitizeTextForPostgres(item, { trim: true, maxLength: 120 }) || "").filter(Boolean),
      rows: Array.isArray(section.table.rows) ? section.table.rows.map((row) => Array.isArray(row) ? row.map((cell) => sanitizeTextForPostgres(cell, { trim: true, maxLength: 240 }) || "") : []) : [],
    } : null,
  };
}

async function buildDocumentContent(apiKey, kind, prompt, options = {}) {
  const instruction = buildArtifactInstruction(kind, prompt, options.sourceFileProfile, options.sourceContext);
  const responseText = await callResponsesText(apiKey, instruction, {
    model: options.model || TEXT_MODEL,
    maxOutputTokens: kind === "pptx" ? 3200 : 2800,
    temperature: 0.35,
  });
  const parsed = parseJsonResponse(responseText, {});
  const title = sanitizeTextForPostgres(parsed.title || prompt, { trim: true, maxLength: 180 }) || "Artefato";
  const summary = sanitizeTextForPostgres(parsed.summary || "", { trim: true, maxLength: 4000 }) || "";
  const sections = Array.isArray(parsed.sections) ? parsed.sections.map(normalizeSection).filter((section) => section.heading || section.paragraphs.length || section.bullets.length) : [];
  const slides = Array.isArray(parsed.slides)
    ? parsed.slides.map((slide, index) => ({
      title: sanitizeTextForPostgres(slide.title || `Slide ${index + 1}`, { trim: true, maxLength: 160 }) || `Slide ${index + 1}`,
      bullets: Array.isArray(slide.bullets) ? slide.bullets.map((item) => sanitizeTextForPostgres(item, { trim: true, maxLength: 400 }) || "").filter(Boolean) : [],
      speaker_notes: sanitizeTextForPostgres(slide.speaker_notes || "", { trim: true, maxLength: 2500 }) || "",
      table: slide.table && Array.isArray(slide.table.headers) ? {
        headers: slide.table.headers.map((item) => sanitizeTextForPostgres(item, { trim: true, maxLength: 120 }) || "").filter(Boolean),
        rows: Array.isArray(slide.table.rows) ? slide.table.rows.map((row) => Array.isArray(row) ? row.map((cell) => sanitizeTextForPostgres(cell, { trim: true, maxLength: 220 }) || "") : []) : [],
      } : null,
    }))
    : [];
  const workbook = parsed.workbook && typeof parsed.workbook === "object" ? parsed.workbook : null;
  const subtitle = sanitizeTextForPostgres(parsed.subtitle || "", { trim: true, maxLength: 240 }) || "";

  return {
    title,
    subtitle,
    summary,
    sections,
    slides,
    workbook,
    rawText: responseText,
  };
}

function drawMultilineText(page, text, x, y, options = {}) {
  const lines = wrapText(text, options.width || 92);
  let cursor = y;
  for (const line of lines) {
    page.drawText(line, {
      x,
      y: cursor,
      size: options.size || 11,
      font: options.font,
      color: options.color || rgb(0.12, 0.12, 0.12),
    });
    cursor -= (options.lineHeight || 14);
    if (cursor < 48) break;
  }
  return cursor;
}

async function createPdfArtifact(content, prompt, outDir) {
  ensureDir(outDir);
  const pdfDoc = await PDFDocument.create();
  let page = pdfDoc.addPage([595, 842]);
  const titleFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const bodyFont = await pdfDoc.embedFont(StandardFonts.Helvetica);
  let cursor = 780;

  page.drawText(content.title || "Documento", { x: 42, y: cursor, size: 22, font: titleFont, color: rgb(0.05, 0.13, 0.28) });
  cursor -= 28;
  if (content.summary) {
    cursor = drawMultilineText(page, content.summary, 42, cursor, { font: bodyFont, size: 11, width: 90, lineHeight: 14 });
    cursor -= 16;
  }

  const sections = Array.isArray(content.sections) && content.sections.length ? content.sections : [{ heading: "Conteudo", paragraphs: [content.rawText || content.summary || prompt], bullets: [] }];

  for (const section of sections) {
    if (cursor < 120) {
      page = pdfDoc.addPage([595, 842]);
      cursor = 790;
    }
    page.drawText(section.heading, { x: 42, y: cursor, size: 15, font: titleFont, color: rgb(0.08, 0.2, 0.42) });
    cursor -= 20;
    for (const paragraph of section.paragraphs || []) {
      cursor = drawMultilineText(page, paragraph, 42, cursor, { font: bodyFont, size: 11, width: 92, lineHeight: 14 });
      cursor -= 12;
      if (cursor < 90) {
        page = pdfDoc.addPage([595, 842]);
        cursor = 790;
      }
    }
    for (const bullet of section.bullets || []) {
      cursor = drawMultilineText(page, `• ${bullet}`, 54, cursor, { font: bodyFont, size: 11, width: 88, lineHeight: 14 });
      cursor -= 6;
      if (cursor < 90) {
        page = pdfDoc.addPage([595, 842]);
        cursor = 790;
      }
    }
    cursor -= 8;
  }

  const filename = makeArtifactFilename(prompt || content.title || "documento", ".pdf");
  const fullPath = path.join(outDir, filename);
  const pdfBytes = await pdfDoc.save();
  fs.writeFileSync(fullPath, pdfBytes);
  return { fullPath, filename, mimeType: "application/pdf" };
}

function xmlEscape(value = "") {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function buildWordParagraph(text = "", style = "") {
  return `<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ""}<w:r><w:t xml:space="preserve">${xmlEscape(text)}</w:t></w:r></w:p>`;
}

async function createDocxArtifact(content, prompt, outDir) {
  ensureDir(outDir);
  const zip = new JSZip();
  zip.file("[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
</Types>`);
  zip.folder("_rels").file(".rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>`);
  zip.folder("docProps").file("core.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <dc:title>${xmlEscape(content.title || prompt)}</dc:title>
  <dc:creator>Talkers IA</dc:creator>
  <cp:lastModifiedBy>Talkers IA</cp:lastModifiedBy>
</cp:coreProperties>`);
  zip.folder("docProps").file("app.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">
  <Application>Talkers IA</Application>
</Properties>`);
  zip.folder("word").folder("_rels").file("document.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>`);

  const parts = [];
  parts.push(buildWordParagraph(content.title || prompt, "Title"));
  if (content.summary) parts.push(buildWordParagraph(content.summary));
  const sections = Array.isArray(content.sections) && content.sections.length ? content.sections : [{ heading: "Conteudo", paragraphs: [content.rawText || content.summary || prompt], bullets: [] }];
  for (const section of sections) {
    parts.push(buildWordParagraph(section.heading, "Heading1"));
    for (const paragraph of section.paragraphs || []) parts.push(buildWordParagraph(paragraph));
    for (const bullet of section.bullets || []) parts.push(buildWordParagraph(`• ${bullet}`));
    if (section.table?.headers?.length) {
      parts.push(buildWordParagraph(section.table.headers.join(" | ")));
      for (const row of section.table.rows || []) parts.push(buildWordParagraph(row.join(" | ")));
    }
  }

  zip.folder("word").file("document.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:wpc="http://schemas.microsoft.com/office/word/2010/wordprocessingCanvas" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:wp14="http://schemas.microsoft.com/office/word/2010/wordprocessingDrawing" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:w10="urn:schemas-microsoft-com:office:word" xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" mc:Ignorable="w14 wp14">
  <w:body>
    ${parts.join("")}
    <w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr>
  </w:body>
</w:document>`);

  const filename = makeArtifactFilename(prompt || content.title || "documento", ".docx");
  const fullPath = path.join(outDir, filename);
  const buffer = await zip.generateAsync({ type: "nodebuffer" });
  fs.writeFileSync(fullPath, buffer);
  return { fullPath, filename, mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" };
}

function toSheetRowsFromObjects(rows = [], columns = []) {
  return rows.map((row) => columns.map((column) => row?.[column] ?? ""));
}

function buildTransformationWorkbook(sourceFileProfile, prompt) {
  const workbook = XLSX.utils.book_new();
  const sheets = Array.isArray(sourceFileProfile?.sheets) ? sourceFileProfile.sheets : [];

  for (const sheet of sheets) {
    const headers = Array.isArray(sheet.headers) && sheet.headers.length ? sheet.headers : ["Coluna 1"];
    const rows = Array.isArray(sheet.sample_rows) ? toSheetRowsFromObjects(sheet.sample_rows, headers) : [];
    const aoa = [headers, ...rows];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    XLSX.utils.book_append_sheet(workbook, ws, String(sheet.sheet_name || "Base").slice(0, 31));
  }

  const executiveRows = [
    ["Indicador", "Valor"],
    ["Arquivo-base", sourceFileProfile?.original_name || "Planilha enviada"],
    ["Abas detectadas", Number(sourceFileProfile?.sheet_count || sheets.length || 0)],
    ["Pedido", prompt],
    ["Data de geracao", new Date().toISOString()],
  ];
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(executiveRows), "Resumo_executivo");

  const suggestionRows = [["Ajuste sugerido", "Descricao"]];
  for (const sheet of sheets) {
    for (const hint of sheet.hints || []) suggestionRows.push([sheet.sheet_name, hint]);
    if (Array.isArray(sheet.columns)) {
      for (const column of sheet.columns.slice(0, 20)) {
        suggestionRows.push([
          `${sheet.sheet_name} / ${column.name}`,
          `Tipo detectado: ${column.detected_type}; preenchimento: ${column.fill_rate}`,
        ]);
      }
    }
  }
  if (suggestionRows.length === 1) suggestionRows.push(["Estrutura", "Revisar cabecalhos, validacoes e aba de indicadores."]);
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(suggestionRows), "Ajustes_sugeridos");
  return workbook;
}

function buildWorkbookFromContent(content, sourceFileProfile = null, prompt = "") {
  if (sourceFileProfile?.kind === "spreadsheet") {
    return buildTransformationWorkbook(sourceFileProfile, prompt);
  }

  const workbook = XLSX.utils.book_new();
  const sheets = Array.isArray(content?.workbook?.sheets) ? content.workbook.sheets : [];
  if (sheets.length) {
    for (const sheet of sheets) {
      const columns = Array.isArray(sheet.columns) && sheet.columns.length ? sheet.columns.map((item) => sanitizeTextForPostgres(item, { trim: true, maxLength: 80 }) || "") : [];
      const rows = Array.isArray(sheet.rows) ? sheet.rows : [];
      const normalizedRows = rows.map((row) => {
        if (Array.isArray(row)) {
          return row.map((cell) => sanitizeTextForPostgres(cell, { trim: true, maxLength: 500 }) || "");
        }
        if (row && typeof row === "object") {
          if (!columns.length) {
            return Object.keys(row);
          }
          return columns.map((column) => sanitizeTextForPostgres(row[column], { trim: true, maxLength: 500 }) || "");
        }
        return [sanitizeTextForPostgres(row, { trim: true, maxLength: 500 }) || ""];
      });
      const aoa = columns.length ? [columns, ...normalizedRows] : normalizedRows;
      const ws = XLSX.utils.aoa_to_sheet(aoa);
      XLSX.utils.book_append_sheet(workbook, ws, String(sheet.name || "Planilha").slice(0, 31));
      if (Array.isArray(sheet.notes) && sheet.notes.length) {
        const notesWs = XLSX.utils.aoa_to_sheet([["Observacoes"], ...sheet.notes.map((note) => [note])]);
        XLSX.utils.book_append_sheet(workbook, notesWs, `${String(sheet.name || "Planilha").slice(0, 24)}_Notas`.slice(0, 31));
      }
    }
  } else {
    const rows = [["Campo", "Valor"], ["Resumo", content.summary || prompt], ["Gerado em", new Date().toISOString()]];
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), "Conteudo");
  }
  return workbook;
}

async function createXlsxArtifact(content, prompt, outDir, sourceFileProfile = null) {
  ensureDir(outDir);
  const workbook = buildWorkbookFromContent(content, sourceFileProfile, prompt);
  const filename = makeArtifactFilename(prompt || content.title || "planilha", ".xlsx");
  const fullPath = path.join(outDir, filename);
  XLSX.writeFile(workbook, fullPath);
  return { fullPath, filename, mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" };
}

function pptxEscape(value = "") {
  return xmlEscape(String(value || "")).replace(/\n/g, "&#10;");
}

function buildPresentationSlides(content, prompt) {
  const slides = Array.isArray(content.slides) && content.slides.length ? content.slides : [];
  if (slides.length) return slides;
  return [
    {
      title: content.title || prompt || "Apresentacao",
      bullets: [content.summary || "Resumo executivo do tema solicitado."],
      speaker_notes: "",
      table: null,
    },
    ...((content.sections || []).slice(0, 5).map((section) => ({
      title: section.heading,
      bullets: [...(section.bullets || []), ...(section.paragraphs || []).slice(0, 3)],
      speaker_notes: "",
      table: section.table || null,
    }))),
  ];
}

function buildPptxSlideXml(slide) {
  const bullets = Array.isArray(slide.bullets) ? slide.bullets.slice(0, 6) : [];
  const bulletRuns = bullets.length
    ? bullets.map((bullet) => `<a:p><a:pPr lvl="0" marL="342900" indent="-285750"><a:buChar char="•"/></a:pPr><a:r><a:rPr lang="pt-BR" sz="2200"/><a:t>${pptxEscape(bullet)}</a:t></a:r></a:p>`).join("")
    : `<a:p><a:r><a:rPr lang="pt-BR" sz="2200"/><a:t>${pptxEscape(slide.speaker_notes || "Conteudo em desenvolvimento.")}</a:t></a:r></a:p>`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld>
    <p:spTree>
      <p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
      <p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>
      <p:sp>
        <p:nvSpPr><p:cNvPr id="2" name="Titulo"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
        <p:spPr/>
        <p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="pt-BR" sz="2800" b="1"/><a:t>${pptxEscape(slide.title || "Slide")}</a:t></a:r></a:p></p:txBody>
      </p:sp>
      <p:sp>
        <p:nvSpPr><p:cNvPr id="3" name="Conteudo"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
        <p:spPr/>
        <p:txBody><a:bodyPr/><a:lstStyle/>${bulletRuns}</p:txBody>
      </p:sp>
    </p:spTree>
  </p:cSld>
  <p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>
</p:sld>`;
}

async function createPptxArtifact(content, prompt, outDir) {
  ensureDir(outDir);
  const zip = new JSZip();
  const slides = buildPresentationSlides(content, prompt);
  zip.file("[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>
  <Override PartName="/ppt/presProps.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presProps+xml"/>
  <Override PartName="/ppt/viewProps.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.viewProps+xml"/>
  <Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>
  <Override PartName="/ppt/tableStyles.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.tableStyles+xml"/>
  ${slides.map((_, index) => `<Override PartName="/ppt/slides/slide${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`).join("\n  ")}
</Types>`);
  zip.folder("_rels").file(".rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>
</Relationships>`);

  const ppt = zip.folder("ppt");
  const slideRelEntries = slides.map((_, index) => `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${index + 1}.xml"/>`).join("");
  ppt.file("presentation.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:sldMasterIdLst/>
  <p:sldIdLst>${slides.map((_, index) => `<p:sldId id="${256 + index}" r:id="rId${index + 1}"/>`).join("")}</p:sldIdLst>
  <p:sldSz cx="9144000" cy="6858000"/>
  <p:notesSz cx="6858000" cy="9144000"/>
</p:presentation>`);
  ppt.folder("_rels").file("presentation.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${slideRelEntries}</Relationships>`);
  ppt.file("presProps.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:presentationPr xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"/>`);
  ppt.file("viewProps.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:viewPr xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"/>`);
  ppt.file("tableStyles.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><a:tblStyleLst xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" def="{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}"/>`);
  ppt.folder("theme").file("theme1.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="TalkersTheme"><a:themeElements/></a:theme>`);
  const slidesFolder = ppt.folder("slides");
  const slidesRels = slidesFolder.folder("_rels");
  slides.forEach((slide, index) => {
    slidesFolder.file(`slide${index + 1}.xml`, buildPptxSlideXml(slide));
    slidesRels.file(`slide${index + 1}.xml.rels`, `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>`);
  });

  const filename = makeArtifactFilename(prompt || content.title || "apresentacao", ".pptx");
  const fullPath = path.join(outDir, filename);
  const buffer = await zip.generateAsync({ type: "nodebuffer" });
  fs.writeFileSync(fullPath, buffer);
  return { fullPath, filename, mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation" };
}

async function createImageArtifact(apiKey, prompt, outDir, referenceImages = []) {
  ensureDir(outDir);
  if (!apiKey) throw new Error("openai_api_key_missing");
  const usingBaseImage = Array.isArray(referenceImages) && referenceImages.length > 0;
  const url = usingBaseImage ? OPENAI_IMAGE_EDITS_URL : OPENAI_IMAGE_GENERATIONS_URL;
  const form = new FormData();
  form.append("model", IMAGE_MODEL);
  form.append("prompt", normalizePrompt(prompt));
  form.append("size", process.env.OPENAI_IMAGE_SIZE || "1024x1024");

  if (usingBaseImage) {
    const base = referenceImages[0];
    const imageBuffer = fs.readFileSync(base.fullPath);
    form.append("image", new Blob([imageBuffer]), base.originalName || path.basename(base.fullPath));
  }

  const response = await fetchWithRetry(
    url,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
    },
    { label: usingBaseImage ? "openai_image_edit" : "openai_image_generation", using_base_image: usingBaseImage, model: IMAGE_MODEL },
    1,
    IMAGE_TIMEOUT_MS
  );

  if (!response.ok) {
    const body = await readResponseBodyText(response);
    throw Object.assign(new Error(body || `HTTP ${response.status}`), {
      response: { status: response.status },
      url,
    });
  }

  const data = await response.json();
  const imageBase64 = data?.data?.[0]?.b64_json || "";
  if (!imageBase64) {
    throw new Error("image_generation_empty_response");
  }

  const filename = makeArtifactFilename(prompt || "imagem", ".png");
  const fullPath = path.join(outDir, filename);
  fs.writeFileSync(fullPath, Buffer.from(imageBase64, "base64"));
  const reply = usingBaseImage
    ? "Usei a imagem enviada na conversa como base para a edicao e gerei uma nova versao com o estilo solicitado."
    : "Gerei a imagem solicitada a partir do pedido textual desta conversa.";
  return { fullPath, filename, mimeType: "image/png", reply, usedSourceImage: usingBaseImage };
}

function buildInlineArtifactReply(kind, prompt, sourceFileProfile = null, usedSourceImage = false) {
  if (kind === "image_edit" && usedSourceImage) {
    return "Usei a imagem enviada como base para a edicao solicitada.";
  }
  if (kind === "image") {
    return "Gerei a imagem solicitada com base no pedido textual.";
  }
  if (sourceFileProfile?.original_name) {
    return `Executei a tarefa usando o arquivo ${sourceFileProfile.original_name} como base.`;
  }
  return `Executei a solicitacao de ${kind || "artefato"}.`;
}

async function generateArtifact({ apiKey = "", prompt = "", outDir = "", referenceImages = [], sourceFileProfile = null, taskMode = "", sourceContext = "" } = {}) {
  const safePrompt = normalizePrompt(prompt);
  if (!safePrompt) {
    return { reply: "Nao encontrei um pedido valido para gerar o artefato.", fullPath: "", filename: "", mimeType: "text/plain" };
  }

  const kind = detectArtifactKind(safePrompt, { referenceImages })
    || (taskMode === "transform_attachment" && sourceFileProfile?.kind === "spreadsheet" ? "xlsx" : null)
    || (taskMode === "transform_attachment" && sourceFileProfile?.kind === "image" ? "image_edit" : null)
    || (taskMode === "transform_attachment" && sourceFileProfile?.kind === "presentation" ? "pptx" : null)
    || (taskMode === "transform_attachment" ? "docx" : null);

  if (!kind) {
    return {
      reply: "Entendi o pedido, mas ele nao correspondeu a um tipo de artefato geravel nesta etapa.",
      fullPath: "",
      filename: "",
      mimeType: "text/plain",
    };
  }

  if (kind === "audio") {
    const speech = await createSpeechArtifact({ apiKey, prompt: safePrompt, outDir }).catch((err) => {
      artifactLogger.error("Falha ao gerar audio.", { message: err?.message || String(err || "audio_generation_failed") });
      throw err;
    });
    return {
      ...speech,
      reply: "Gerei o audio solicitado.",
    };
  }

  if (kind === "image" || kind === "image_edit") {
    return createImageArtifact(apiKey, safePrompt, outDir, kind === "image_edit" ? referenceImages : []);
  }

  const content = await buildDocumentContent(apiKey, kind, safePrompt, { sourceFileProfile, sourceContext });

  if (kind === "pdf") {
    const file = await createPdfArtifact(content, safePrompt, outDir);
    return { ...file, reply: buildInlineArtifactReply(kind, safePrompt, sourceFileProfile) };
  }
  if (kind === "docx") {
    const file = await createDocxArtifact(content, safePrompt, outDir);
    return { ...file, reply: buildInlineArtifactReply(kind, safePrompt, sourceFileProfile) };
  }
  if (kind === "xlsx") {
    const file = await createXlsxArtifact(content, safePrompt, outDir, sourceFileProfile);
    return { ...file, reply: buildInlineArtifactReply(kind, safePrompt, sourceFileProfile) };
  }
  if (kind === "pptx") {
    const file = await createPptxArtifact(content, safePrompt, outDir);
    return { ...file, reply: buildInlineArtifactReply(kind, safePrompt, sourceFileProfile) };
  }

  return {
    reply: sanitizeTextForPostgres(content.rawText || content.summary || safePrompt, { trim: true, maxLength: 12000 }) || safePrompt,
    fullPath: "",
    filename: "",
    mimeType: "text/plain",
  };
}

module.exports = {
  detectArtifactKind,
  generateArtifact,
};
