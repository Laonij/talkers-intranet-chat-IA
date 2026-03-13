const path = require("path");
const { extractKeywords, hashText, normalizeSemanticText } = require("./semantic");

function normalizeDisplayName(value = "") {
  return String(value || "")
    .replace(/\.[^.]+$/, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function splitSentences(text = "") {
  return String(text || "")
    .replace(/\r/g, " ")
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

function pickSummarySentences(text = "", options = {}) {
  const maxChars = Math.max(240, Number(options.maxChars || 520));
  const maxSentences = Math.max(2, Number(options.maxSentences || 4));
  const sentences = splitSentences(text);
  if (!sentences.length) return "";

  const selected = [];
  let totalChars = 0;
  for (const sentence of sentences) {
    if (!sentence) continue;
    if (selected.length >= maxSentences) break;
    if (totalChars >= maxChars) break;
    selected.push(sentence);
    totalChars += sentence.length + 1;
  }

  return selected.join(" ").slice(0, maxChars).trim();
}

function extractEntityCandidates(text = "", limit = 10) {
  const matches = String(text || "").match(/\b(?:[A-ZÀ-Ý][A-Za-zÀ-ÿ0-9&.-]{1,}(?:\s+[A-ZÀ-Ý0-9][A-Za-zÀ-ÿ0-9&.-]{1,}){0,3})\b/g) || [];
  const counts = new Map();

  for (const match of matches) {
    const normalized = match.replace(/\s+/g, " ").trim();
    if (!normalized || normalized.length < 4) continue;
    if (/^(Talkers IA|IA|PDF|DOCX|XLSX|PPTX)$/i.test(normalized)) continue;
    counts.set(normalized, (counts.get(normalized) || 0) + 1);
  }

  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, limit)
    .map(([entity]) => entity);
}

function buildThemeList({ title = "", summary = "", keywords = [], chunkKeywords = [] }) {
  const merged = [
    ...extractKeywords(title, 6),
    ...extractKeywords(summary, 8),
    ...(Array.isArray(keywords) ? keywords : []),
    ...(Array.isArray(chunkKeywords) ? chunkKeywords : []),
  ];

  const seen = new Set();
  const out = [];
  for (const item of merged) {
    const normalized = normalizeSemanticText(item);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(String(item || "").trim());
    if (out.length >= 10) break;
  }
  return out;
}

function buildRelatedLabel(item = {}) {
  return normalizeDisplayName(item.original_name || item.rel_path || item.name || "");
}

function buildKnowledgeSummaryText({
  title = "",
  summary = "",
  themes = [],
  entities = [],
  relationships = [],
  departmentName = "",
  sourceKind = "",
  language = "pt",
}) {
  const lines = [];
  const displayTitle = normalizeDisplayName(title);
  if (displayTitle) lines.push(`Documento: ${displayTitle}`);
  if (summary) lines.push(`Resumo semantico: ${summary}`);
  if (themes.length) lines.push(`Temas principais: ${themes.join(", ")}`);
  if (entities.length) lines.push(`Entidades relevantes: ${entities.join(", ")}`);
  if (relationships.length) lines.push(`Relacionamentos com outros documentos: ${relationships.join(", ")}`);
  if (departmentName) lines.push(`Departamento relacionado: ${departmentName}`);
  if (sourceKind) lines.push(`Origem: ${sourceKind}`);
  if (language) lines.push(`Idioma principal: ${language}`);
  return lines.join("\n");
}

function buildDocumentKnowledgeProfile({
  title = "",
  text = "",
  keywords = [],
  chunkTexts = [],
  relatedDocuments = [],
  departmentName = "",
  sourceKind = "",
  language = "pt",
}) {
  const safeTitle = normalizeDisplayName(title || path.basename(String(title || "")));
  const safeText = String(text || "").trim();
  const fallbackText = [safeTitle, ...chunkTexts].filter(Boolean).join(". ");
  const summary = pickSummarySentences(safeText || fallbackText);
  const chunkKeywords = (chunkTexts || []).flatMap((chunk) => extractKeywords(chunk, 6)).slice(0, 18);
  const themes = buildThemeList({
    title: safeTitle,
    summary,
    keywords,
    chunkKeywords,
  });
  const entities = extractEntityCandidates(safeText || fallbackText, 10);
  const relationships = (relatedDocuments || [])
    .map((item) => buildRelatedLabel(item))
    .filter(Boolean)
    .slice(0, 5);
  const memoryText = buildKnowledgeSummaryText({
    title: safeTitle,
    summary,
    themes,
    entities,
    relationships,
    departmentName,
    sourceKind,
    language,
  });

  return {
    title: safeTitle || "Documento da base interna",
    summary,
    themes,
    entities,
    relationships,
    memoryText,
    contentHash: hashText(memoryText),
  };
}

module.exports = {
  buildDocumentKnowledgeProfile,
  buildKnowledgeSummaryText,
  extractEntityCandidates,
  normalizeDisplayName,
  pickSummarySentences,
  splitSentences,
};
