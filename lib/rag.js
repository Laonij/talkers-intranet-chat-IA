const fs = require("fs");
const path = require("path");

const OPENAI_BASE_URL = "https://api.openai.com/v1";
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

  const resp = await fetch(`${OPENAI_BASE_URL}/files`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    body: form,
  });

  if (!resp.ok) {
    throw new Error(await resp.text());
  }

  return resp.json();
}

async function attachFileToVectorStore(fileId, vectorStoreId, apiKey) {
  const resp = await fetch(`${OPENAI_BASE_URL}/vector_stores/${vectorStoreId}/files`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ file_id: fileId }),
  });

  if (!resp.ok) {
    throw new Error(await resp.text());
  }

  return resp.json();
}

module.exports = {
  attachFileToVectorStore,
  buildOpenAIInputFilePart,
  fileToDataUri,
  getFileExtension,
  isSupportedOpenAIInputFile,
  uploadFileToOpenAI,
};
