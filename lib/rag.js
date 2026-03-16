const fs = require("fs");
const path = require("path");

const OPENAI_BASE_URL = "https://api.openai.com/v1";
const OPENAI_RAG_TIMEOUT_MS = Math.max(5000, Number(process.env.OPENAI_RAG_TIMEOUT_MS || 30000));
const SUPPORTED_INPUT_EXTS = new Set([
  ".pdf",
  ".doc",
  ".docx",
  ".rtf",
  ".odt",
  ".ppt",
  ".pptx",
  ".xls",
  ".xlsx",
  ".csv",
  ".txt",
  ".md",
  ".json",
]);

function buildFetchErrorDetails(err, extra = {}) {
  return {
    message: err?.message || String(err || "unknown_error"),
    name: err?.name || "",
    code: err?.code || err?.cause?.code || "",
    url: extra.url || "",
    timeout_ms: OPENAI_RAG_TIMEOUT_MS,
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
        signal: options.signal || AbortSignal.timeout(OPENAI_RAG_TIMEOUT_MS),
      });
    } catch (err) {
      lastError = err;
      const details = buildFetchErrorDetails(err, {
        attempt: attempt + 1,
        ...diagnostics,
      });
      if (attempt < retryCount) {
        console.warn("Falha em operação de RAG externa; tentando novamente.", details);
        continue;
      }
      throw Object.assign(err instanceof Error ? err : new Error(String(err || "fetch_failed")), {
        diagnostics: details,
      });
    }
  }
  throw lastError || new Error("fetch_failed");
}

function getFileExtension(filename = "") {
  return path.extname(String(filename || "").toLowerCase());
}

function isSupportedOpenAIInputFile(filename = "", mimeType = "") {
  const ext = getFileExtension(filename);
  if (SUPPORTED_INPUT_EXTS.has(ext)) return true;

  const mime = String(mimeType || "").toLowerCase();
  return (
    mime.includes("pdf") ||
    mime.includes("word") ||
    mime.includes("officedocument.wordprocessingml") ||
    mime.includes("powerpoint") ||
    mime.includes("presentationml") ||
    mime.includes("excel") ||
    mime.includes("spreadsheetml") ||
    mime.startsWith("text/")
  );
}

function fileToDataUri(filePath, mimeType = "application/octet-stream") {
  const base64 = fs.readFileSync(filePath).toString("base64");
  return `data:${mimeType};base64,${base64}`;
}

function buildOpenAIInputFilePart(filePath, filename, mimeType = "application/octet-stream") {
  return {
    type: "input_file",
    filename,
    file_data: fileToDataUri(filePath, mimeType),
  };
}

async function fileToUploadBlob(localPath, mimeType = "application/octet-stream") {
  if (typeof fs.openAsBlob === "function") {
    return fs.openAsBlob(localPath, { type: mimeType });
  }

  return new Blob([fs.readFileSync(localPath)], { type: mimeType });
}

async function uploadFileToOpenAI(localPath, filename, apiKey, purpose = "user_data", mimeType = "application/octet-stream") {
  const form = new FormData();
  const blob = await fileToUploadBlob(localPath, mimeType);

  form.append("purpose", purpose);
  form.append("file", blob, filename);

  const resp = await fetchWithRetry(`${OPENAI_BASE_URL}/files`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    body: form,
  }, {
    url: `${OPENAI_BASE_URL}/files`,
    label: "rag_upload_file",
  });

  if (!resp.ok) {
    throw buildResponseError(resp, await resp.text(), `${OPENAI_BASE_URL}/files`);
  }

  return resp.json();
}

async function attachFileToVectorStore(fileId, vectorStoreId, apiKey) {
  const resp = await fetchWithRetry(`${OPENAI_BASE_URL}/vector_stores/${vectorStoreId}/files`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ file_id: fileId }),
  }, {
    url: `${OPENAI_BASE_URL}/vector_stores/${vectorStoreId}/files`,
    label: "rag_attach_file",
  });

  if (!resp.ok) {
    throw buildResponseError(resp, await resp.text(), `${OPENAI_BASE_URL}/vector_stores/${vectorStoreId}/files`);
  }

  return resp.json();
}

async function getOpenAIFileStatus(fileId, apiKey) {
  const resp = await fetchWithRetry(`${OPENAI_BASE_URL}/files/${fileId}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
  }, {
    url: `${OPENAI_BASE_URL}/files/${fileId}`,
    label: "rag_file_status",
  });

  if (!resp.ok) {
    throw buildResponseError(resp, await resp.text(), `${OPENAI_BASE_URL}/files/${fileId}`);
  }

  return resp.json();
}

async function getVectorStoreFileStatus(vectorStoreId, vectorStoreFileId, apiKey) {
  const resp = await fetchWithRetry(`${OPENAI_BASE_URL}/vector_stores/${vectorStoreId}/files/${vectorStoreFileId}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
  }, {
    url: `${OPENAI_BASE_URL}/vector_stores/${vectorStoreId}/files/${vectorStoreFileId}`,
    label: "rag_vector_file_status",
  });

  if (!resp.ok) {
    throw buildResponseError(resp, await resp.text(), `${OPENAI_BASE_URL}/vector_stores/${vectorStoreId}/files/${vectorStoreFileId}`);
  }

  return resp.json();
}

module.exports = {
  attachFileToVectorStore,
  buildOpenAIInputFilePart,
  fileToDataUri,
  getFileExtension,
  getOpenAIFileStatus,
  getVectorStoreFileStatus,
  isSupportedOpenAIInputFile,
  uploadFileToOpenAI,
};
