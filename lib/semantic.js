const crypto = require('crypto');

const STOPWORDS = new Set([
  'a','o','os','as','de','da','do','das','dos','e','em','para','por','com','sem','que','um','uma','uns','umas','the','and','for','with','this','that','una','uno','con','per','pour','avec','les','des'
]);

function normalizeSemanticText(value = '') {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function hashText(value = '') {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

function extractKeywords(value = '', limit = 12) {
  const tokens = normalizeSemanticText(value)
    .split(' ')
    .map((token) => token.trim())
    .filter((token) => token.length >= 3 && !STOPWORDS.has(token));

  const counts = new Map();
  for (const token of tokens) {
    counts.set(token, (counts.get(token) || 0) + 1);
  }

  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, limit)
    .map(([token]) => token);
}

function chunkTextSemantically(text = '', options = {}) {
  const maxChars = Math.max(400, Number(options.maxChars || 1200));
  const minChars = Math.max(220, Number(options.minChars || 420));
  const paragraphs = String(text || '')
    .replace(/\r/g, '')
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);

  if (!paragraphs.length) return [];

  const chunks = [];
  let current = '';

  const flush = () => {
    const value = current.trim();
    if (!value) return;
    chunks.push(value);
    current = '';
  };

  for (const paragraph of paragraphs) {
    const next = current ? `${current}\n\n${paragraph}` : paragraph;
    const looksLikeHeading = /^#{1,3}\s|^[A-Z0-9][^\n:]{0,80}:$/.test(paragraph);

    if (looksLikeHeading && current.length >= minChars) {
      flush();
      current = paragraph;
      continue;
    }

    if (next.length > maxChars && current.length >= minChars) {
      flush();
      current = paragraph;
      continue;
    }

    current = next;
  }

  flush();

  return chunks.map((chunk, index) => ({
    index,
    text: chunk,
    hash: hashText(chunk),
    keywords: extractKeywords(chunk),
  }));
}

function parseEmbedding(value) {
  if (!value) return null;
  if (Array.isArray(value)) return value.map(Number).filter(Number.isFinite);

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.map(Number).filter(Number.isFinite)
      : null;
  } catch {
    return null;
  }
}

function cosineSimilarity(left, right) {
  const a = parseEmbedding(left);
  const b = parseEmbedding(right);
  if (!Array.isArray(a) || !Array.isArray(b) || !a.length || a.length !== b.length) return 0;

  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let index = 0; index < a.length; index += 1) {
    dot += a[index] * b[index];
    magA += a[index] * a[index];
    magB += b[index] * b[index];
  }

  if (!magA || !magB) return 0;
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

module.exports = {
  chunkTextSemantically,
  cosineSimilarity,
  extractKeywords,
  hashText,
  normalizeSemanticText,
  parseEmbedding,
};
