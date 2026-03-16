const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const TRANSCRIPTIONS_URL = "https://api.openai.com/v1/audio/transcriptions";
const SPEECH_URL = "https://api.openai.com/v1/audio/speech";
const OPENAI_AUDIO_TIMEOUT_MS = Math.max(5000, Number(process.env.OPENAI_AUDIO_TIMEOUT_MS || 30000));
const AUDIO_EXTS = new Set([".mp3", ".mpeg", ".mpga", ".m4a", ".wav", ".webm", ".ogg", ".aac", ".flac", ".wma"]);
const VIDEO_EXTS = new Set([".mp4", ".mov", ".avi", ".mkv", ".webm", ".m4v", ".mpg", ".mpeg"]);
const MIME_BY_FORMAT = {
  mp3: "audio/mpeg",
  opus: "audio/opus",
  aac: "audio/aac",
  flac: "audio/flac",
  wav: "audio/wav",
  pcm: "audio/wav",
};

function buildFetchErrorDetails(err, extra = {}) {
  return {
    message: err?.message || String(err || "unknown_error"),
    name: err?.name || "",
    code: err?.code || err?.cause?.code || "",
    url: extra.url || "",
    timeout_ms: OPENAI_AUDIO_TIMEOUT_MS,
    ...extra,
  };
}

function buildResponseError(resp, bodyText, url) {
  return Object.assign(new Error(String(bodyText || `HTTP ${resp?.status || 0}`)), {
    response: { status: resp?.status || 0 },
    url,
  });
}

async function fetchWithRetry(url, options = {}, diagnostics = {}, retryCount = 1) {
  let lastError = null;
  for (let attempt = 0; attempt <= retryCount; attempt += 1) {
    try {
      return await fetch(url, {
        ...options,
        signal: options.signal || AbortSignal.timeout(OPENAI_AUDIO_TIMEOUT_MS),
      });
    } catch (err) {
      lastError = err;
      const details = buildFetchErrorDetails(err, {
        attempt: attempt + 1,
        ...diagnostics,
      });
      if (attempt < retryCount) {
        console.warn("Falha em requisicao externa de audio; tentando novamente.", details);
        continue;
      }
      throw Object.assign(err instanceof Error ? err : new Error(String(err || "fetch_failed")), {
        diagnostics: details,
      });
    }
  }
  throw lastError || new Error("fetch_failed");
}

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
  if (AUDIO_EXTS.has(ext) || VIDEO_EXTS.has(ext)) return ext;

  const mime = String(mimeType || "").toLowerCase();
  if (mime.includes("mpeg") || mime.includes("mp3")) return ".mp3";
  if (mime.includes("wav")) return ".wav";
  if (mime.includes("webm")) return ".webm";
  if (mime.includes("ogg")) return ".ogg";
  if (mime.includes("aac")) return ".aac";
  if (mime.includes("flac")) return ".flac";
  if (mime.includes("mp4") || mime.includes("m4a")) return ".m4a";
  if (mime.includes("quicktime")) return ".mov";
  if (mime.includes("avi")) return ".avi";
  if (mime.includes("matroska")) return ".mkv";
  return "";
}

function isAudioFile(filename = "", mimeType = "") {
  if (AUDIO_EXTS.has(path.extname(String(filename || "").toLowerCase()))) return true;
  return String(mimeType || "").toLowerCase().startsWith("audio/");
}

function isVideoFile(filename = "", mimeType = "") {
  if (VIDEO_EXTS.has(path.extname(String(filename || "").toLowerCase()))) return true;
  return String(mimeType || "").toLowerCase().startsWith("video/");
}

function isMediaFile(filename = "", mimeType = "") {
  return isAudioFile(filename, mimeType) || isVideoFile(filename, mimeType);
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function getTranscriptCachePath(filePath, cacheDir = "") {
  const baseDir = cacheDir || path.join(path.dirname(filePath), ".transcripts");
  ensureDir(baseDir);
  return path.join(baseDir, `${path.basename(filePath)}.txt`);
}

function extractAudioFromVideo(videoPath) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "talkers-media-"));
  const outputPath = path.join(tempDir, `${path.basename(videoPath, path.extname(videoPath))}.mp3`);

  const attempts = [
    {
      command: "ffmpeg",
      args: ["-y", "-i", videoPath, "-vn", "-acodec", "libmp3lame", "-ar", "44100", "-ac", "2", outputPath],
    },
    {
      command: "ffmpeg",
      args: ["-y", "-i", videoPath, "-vn", outputPath],
    },
  ];

  for (const attempt of attempts) {
    try {
      const result = spawnSync(attempt.command, attempt.args, {
        stdio: "ignore",
        windowsHide: true,
      });

      if (result.status === 0 && fs.existsSync(outputPath) && fs.statSync(outputPath).size > 0) {
        return { outputPath, tempDir };
      }
    } catch {
      // Continua tentando outros binarios/argumentos.
    }
  }

  try {
    fs.rmSync(tempDir, { recursive: true, force: true });
  } catch {}

  return null;
}

function cleanupExtractedAudio(result) {
  if (!result?.tempDir) return;
  try {
    fs.rmSync(result.tempDir, { recursive: true, force: true });
  } catch {}
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

  const forcedLanguage = String(options.language || process.env.OPENAI_TRANSCRIBE_LANGUAGE || "").trim();
  if (forcedLanguage) {
    form.append("language", forcedLanguage);
  }

  const prompt = String(options.prompt || process.env.OPENAI_TRANSCRIBE_PROMPT || "").trim();
  if (prompt) form.append("prompt", prompt);

  const resp = await fetchWithRetry(TRANSCRIPTIONS_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    body: form,
  }, {
    url: TRANSCRIPTIONS_URL,
    label: "openai_transcriptions",
  });

  if (!resp.ok) {
    throw buildResponseError(resp, await resp.text(), TRANSCRIPTIONS_URL);
  }

  const data = await resp.json();
  const text = String(data?.text || "").trim();
  if (text) {
    fs.writeFileSync(cachePath, text, "utf8");
  }

  return text;
}

async function transcribeMedia(filePath, filename = "", mimeType = "", options = {}) {
  const safeFilename = filename || path.basename(filePath);
  const safeMime = String(mimeType || "").trim();

  if (isAudioFile(safeFilename, safeMime)) {
    const text = await transcribeAudio(filePath, safeFilename, safeMime, options);
    return {
      text,
      transcriptLanguage: String(options.language || process.env.OPENAI_TRANSCRIBE_LANGUAGE || "").trim() || null,
      usedAudioExtraction: false,
      sourceKind: "audio",
    };
  }

  if (!isVideoFile(safeFilename, safeMime)) {
    return {
      text: "",
      transcriptLanguage: null,
      usedAudioExtraction: false,
      sourceKind: "unsupported",
    };
  }

  const extracted = extractAudioFromVideo(filePath);
  if (!extracted?.outputPath) {
    throw new Error("video_audio_extraction_unavailable");
  }

  try {
    const text = await transcribeAudio(extracted.outputPath, path.basename(extracted.outputPath), "audio/mpeg", options);
    return {
      text,
      transcriptLanguage: String(options.language || process.env.OPENAI_TRANSCRIBE_LANGUAGE || "").trim() || null,
      usedAudioExtraction: true,
      sourceKind: "video",
    };
  } finally {
    cleanupExtractedAudio(extracted);
  }
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

  const resp = await fetchWithRetry(SPEECH_URL, {
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
  }, {
    url: SPEECH_URL,
    label: "openai_speech",
  });

  if (!resp.ok) {
    throw buildResponseError(resp, await resp.text(), SPEECH_URL);
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
  isMediaFile,
  isVideoFile,
  transcribeAudio,
  transcribeMedia,
};
