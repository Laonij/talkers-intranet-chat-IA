const fs = require("fs");
const path = require("path");

const TRANSCRIPTIONS_URL = "https://api.openai.com/v1/audio/transcriptions";
const SPEECH_URL = "https://api.openai.com/v1/audio/speech";
const AUDIO_EXTS = new Set([".mp3", ".mp4", ".mpeg", ".mpga", ".m4a", ".wav", ".webm", ".ogg", ".aac", ".flac"]);
const MIME_BY_FORMAT = {
  mp3: "audio/mpeg",
  opus: "audio/opus",
  aac: "audio/aac",
  flac: "audio/flac",
  wav: "audio/wav",
  pcm: "audio/wav",
};

function slugifyPrompt(prompt) {
  return String(prompt || "audio")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50) || "audio";
}

function makeArtifactFilename(prompt, ext) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `${slugifyPrompt(prompt)}-${stamp}${ext}`;
}

function getAudioExtension(filename = "", mimeType = "") {
  const ext = path.extname(String(filename || "").toLowerCase());
  if (AUDIO_EXTS.has(ext)) return ext;

  const mime = String(mimeType || "").toLowerCase();
  if (mime.includes("mpeg") || mime.includes("mp3")) return ".mp3";
  if (mime.includes("wav")) return ".wav";
  if (mime.includes("webm")) return ".webm";
  if (mime.includes("ogg")) return ".ogg";
  if (mime.includes("aac")) return ".aac";
  if (mime.includes("flac")) return ".flac";
  if (mime.includes("mp4") || mime.includes("m4a")) return ".m4a";
  return "";
}

function isAudioFile(filename = "", mimeType = "") {
  if (AUDIO_EXTS.has(path.extname(String(filename || "").toLowerCase()))) return true;
  return String(mimeType || "").toLowerCase().startsWith("audio/");
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function getTranscriptCachePath(filePath, cacheDir = "") {
  const baseDir = cacheDir || path.join(path.dirname(filePath), ".transcripts");
  ensureDir(baseDir);
  return path.join(baseDir, `${path.basename(filePath)}.txt`);
}

async function transcribeAudio(filePath, filename = "", mimeType = "", options = {}) {
  const apiKey = options.apiKey || process.env.OPENAI_API_KEY || "";
  if (!apiKey || !isAudioFile(filename || filePath, mimeType)) return "";

  const cachePath = getTranscriptCachePath(filePath, options.cacheDir || "");
  if (fs.existsSync(cachePath)) {
    const cached = String(fs.readFileSync(cachePath, "utf8") || "").trim();
    if (cached) return cached;
  }

  const form = new FormData();
  const inferredName = filename || `${path.basename(filePath, path.extname(filePath))}${getAudioExtension(filePath, mimeType) || ".mp3"}`;
  const blob = new Blob([fs.readFileSync(filePath)]);

  form.append("file", blob, inferredName);
  form.append("model", process.env.OPENAI_TRANSCRIBE_MODEL || "gpt-4o-mini-transcribe");
  form.append("response_format", "json");
  form.append("language", process.env.OPENAI_TRANSCRIBE_LANGUAGE || "pt");

  const prompt = String(options.prompt || process.env.OPENAI_TRANSCRIBE_PROMPT || "").trim();
  if (prompt) form.append("prompt", prompt);

  const resp = await fetch(TRANSCRIPTIONS_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    body: form,
  });

  if (!resp.ok) {
    throw new Error(await resp.text());
  }

  const data = await resp.json();
  const text = String(data?.text || "").trim();
  if (text) {
    fs.writeFileSync(cachePath, text, "utf8");
  }

  return text;
}

async function createSpeechArtifact({ text, prompt, outDir, apiKey = process.env.OPENAI_API_KEY || "" }) {
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY ausente para gerar audio.");
  }

  const input = String(text || "").trim();
  if (!input) {
    throw new Error("Texto vazio para gerar audio.");
  }

  ensureDir(outDir);

  const model = process.env.OPENAI_TTS_MODEL || "gpt-4o-mini-tts";
  const voice = process.env.OPENAI_TTS_VOICE || "alloy";
  const responseFormat = (process.env.OPENAI_TTS_FORMAT || "mp3").toLowerCase();
  const instructions = String(process.env.OPENAI_TTS_INSTRUCTIONS || "Fale em portugues do Brasil com tom claro e natural.").trim();
  const ext = responseFormat === "pcm" ? ".wav" : `.${responseFormat}`;

  const resp = await fetch(SPEECH_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      voice,
      input: input.slice(0, 4096),
      instructions,
      response_format: responseFormat,
    }),
  });

  if (!resp.ok) {
    throw new Error(await resp.text());
  }

  const filename = makeArtifactFilename(prompt || input.slice(0, 40), ext);
  const fullPath = path.join(outDir, filename);
  const buffer = Buffer.from(await resp.arrayBuffer());
  fs.writeFileSync(fullPath, buffer);

  return {
    filename,
    fullPath,
    mimeType: MIME_BY_FORMAT[responseFormat] || "audio/mpeg",
    reply: "Audio gerado com sucesso.",
  };
}

module.exports = {
  createSpeechArtifact,
  getAudioExtension,
  isAudioFile,
  transcribeAudio,
};
