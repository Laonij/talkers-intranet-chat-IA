const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const pdf = require("pdf-parse");
const mammoth = require("mammoth");
const XLSX = require("xlsx");
const JSZip = require("jszip");
const { createLogger } = require("./appLogger");
const { ocrBuffer } = require("./ocr");
const { sanitizeTextForPostgres } = require("./postgresSanitizer");

const IMAGE_ENTRY_RE = /\.(png|jpe?g|webp|bmp|gif)$/i;
const extractLogger = createLogger("uploads");

function cleanText(value) {
  return sanitizeTextForPostgres(String(value || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\r/g, "\n")
    .replace(/\t/g, " ")
    .replace(/[ ]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim(), {
    trim: true,
    normalizeWhitespace: false,
  }) || "";
}

function hasMeaningfulText(value, minLength = 40) {
  return String(value || "").replace(/\s+/g, "").length >= minLength;
}

function detectExt(filePath, originalName = "", mimeType = "") {
  const originalExt = path.extname(String(originalName || "").toLowerCase());
  if (originalExt) return originalExt;

  const pathExt = path.extname(String(filePath || "").toLowerCase());
  if (pathExt) return pathExt;

  const mime = String(mimeType || "").toLowerCase();
  if (mime.includes("pdf")) return ".pdf";
  if (mime.includes("wordprocessingml") || mime.includes("officedocument.wordprocessingml")) return ".docx";
  if (mime.includes("spreadsheetml") || mime.includes("excel")) return ".xlsx";
  if (mime.includes("presentationml") || mime.includes("powerpoint")) return ".pptx";
  if (mime.includes("csv")) return ".csv";
  if (mime.startsWith("text/")) return ".txt";
  return "";
}

async function extractZipImageText(zip, folderPrefix) {
  const imageNames = Object.keys(zip.files)
    .filter((name) => name.startsWith(folderPrefix) && IMAGE_ENTRY_RE.test(name))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

  const chunks = [];
  for (const imageName of imageNames) {
    try {
      const buffer = await zip.files[imageName].async("nodebuffer");
      const text = cleanText(await ocrBuffer(buffer));
      if (!text) continue;
      chunks.push(`[OCR ${path.basename(imageName)}]\n${text}`);
    } catch (err) {
      extractLogger.warn("Erro lendo imagem interna.", {
        image: path.basename(imageName),
        message: err?.message || String(err || "zip_image_read_failed"),
      });
    }
  }

  return cleanText(chunks.join("\n\n"));
}

async function extractPptxText(filePath) {
  try {
    const zip = await JSZip.loadAsync(fs.readFileSync(filePath));
    const slideFiles = Object.keys(zip.files)
      .filter((name) => /^ppt\/slides\/slide\d+\.xml$/i.test(name))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

    const parts = [];
    for (const slideName of slideFiles) {
      const xml = await zip.files[slideName].async("string");
      const texts = [];
      const regex = /<a:t[^>]*>([\s\S]*?)<\/a:t>/g;
      let match;

      while ((match = regex.exec(xml)) !== null) {
        texts.push(match[1]);
      }

      if (texts.length) {
        const slideNumber = slideName.match(/slide(\d+)/i)?.[1] || "";
        parts.push(`Slide ${slideNumber}:\n${texts.join(" ")}`);
      }
    }

    const imageText = await extractZipImageText(zip, "ppt/media/");
    if (imageText) {
      parts.push(`Imagens do PowerPoint:\n${imageText}`);
    }

    return cleanText(parts.join("\n\n"));
  } catch (err) {
    extractLogger.warn("Erro lendo PPTX.", {
      message: err?.message || String(err || "pptx_extract_failed"),
      file: path.basename(filePath || ""),
    });
    return "";
  }
}

function listRasterizedPdfPages(tempDir) {
  return fs
    .readdirSync(tempDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && IMAGE_ENTRY_RE.test(entry.name))
    .map((entry) => path.join(tempDir, entry.name))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

function tryRasterizePdf(filePath, tempDir) {
  const attempts = [
    {
      command: "pdftoppm",
      args: ["-png", "-r", "180", filePath, path.join(tempDir, "page")],
    },
    {
      command: "mutool",
      args: ["draw", "-r", "180", "-o", path.join(tempDir, "page-%d.png"), filePath],
    },
    {
      command: "magick",
      args: ["-density", "180", filePath, path.join(tempDir, "page-%d.png")],
    },
  ];

  for (const attempt of attempts) {
    try {
      const result = spawnSync(attempt.command, attempt.args, {
        stdio: "ignore",
        windowsHide: true,
      });

      if (result.status !== 0) continue;
      if (listRasterizedPdfPages(tempDir).length) return true;
    } catch {
      // Segue para o proximo binario disponivel no host.
    }
  }

  return false;
}

async function extractPdfOcrText(filePath) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "talkers-pdf-"));

  try {
    if (!tryRasterizePdf(filePath, tempDir)) return "";

    const pageImages = listRasterizedPdfPages(tempDir);
    if (!pageImages.length) return "";

    const chunks = [];
    for (const pageImage of pageImages) {
      const text = cleanText(await ocrBuffer(fs.readFileSync(pageImage)));
      if (!text) continue;
      chunks.push(`[OCR ${path.basename(pageImage)}]\n${text}`);
    }

    return cleanText(chunks.join("\n\n"));
  } catch (err) {
    extractLogger.warn("Erro fazendo OCR do PDF.", {
      message: err?.message || String(err || "pdf_ocr_failed"),
      file: path.basename(filePath || ""),
    });
    return "";
  } finally {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  }
}

function extractWorkbookText(filePath) {
  try {
    const workbook = XLSX.readFile(filePath, { cellDates: true });
    const parts = [];

    for (const sheetName of workbook.SheetNames) {
      const sheet = workbook.Sheets[sheetName];
      if (!sheet) continue;

      const rows = XLSX.utils.sheet_to_json(sheet, {
        header: 1,
        defval: "",
        raw: false,
      });

      parts.push(`Planilha: ${sheetName}`);

      for (const row of rows) {
        const line = row
          .map((cell) => String(cell ?? "").trim())
          .filter(Boolean)
          .join(" | ");

        if (line) parts.push(line);
      }

      parts.push("");
    }

    return cleanText(parts.join("\n"));
  } catch (err) {
    extractLogger.warn("Erro lendo XLSX.", {
      message: err?.message || String(err || "xlsx_extract_failed"),
      file: path.basename(filePath || ""),
    });
    return "";
  }
}

async function extractPdfText(filePath) {
  try {
    const data = await pdf(fs.readFileSync(filePath));
    const directText = cleanText(data.text || "");
    if (hasMeaningfulText(directText)) return directText;

    const ocrText = await extractPdfOcrText(filePath);
    return cleanText([directText, ocrText].filter(Boolean).join("\n\n"));
  } catch (err) {
    extractLogger.warn("Erro lendo PDF.", {
      message: err?.message || String(err || "pdf_extract_failed"),
      file: path.basename(filePath || ""),
    });
    return await extractPdfOcrText(filePath);
  }
}

async function extractDocxText(filePath) {
  try {
    const result = await mammoth.extractRawText({ path: filePath });
    const zip = await JSZip.loadAsync(fs.readFileSync(filePath));
    const imageText = await extractZipImageText(zip, "word/media/");
    const parts = [cleanText(result.value || "")].filter(Boolean);

    if (imageText) {
      parts.push(`Imagens do DOCX:\n${imageText}`);
    }

    return cleanText(parts.join("\n\n"));
  } catch (err) {
    extractLogger.warn("Erro lendo DOCX.", {
      message: err?.message || String(err || "docx_extract_failed"),
      file: path.basename(filePath || ""),
    });
    return "";
  }
}

function extractPlainText(filePath) {
  try {
    const buffer = fs.readFileSync(filePath);
    return cleanText(buffer.toString("utf8"));
  } catch (err) {
    extractLogger.warn("Erro lendo TXT/CSV/MD.", {
      message: err?.message || String(err || "plain_text_extract_failed"),
      file: path.basename(filePath || ""),
    });
    return "";
  }
}

async function extractText(filePath, originalName = "", mimeType = "") {
  try {
    const ext = detectExt(filePath, originalName, mimeType);

    if (ext === ".pdf") return await extractPdfText(filePath);
    if (ext === ".docx") return await extractDocxText(filePath);
    if (ext === ".xlsx") return extractWorkbookText(filePath);
    if (ext === ".pptx") return await extractPptxText(filePath);
    if (ext === ".txt" || ext === ".csv" || ext === ".md") return extractPlainText(filePath);

    return "";
  } catch (err) {
    extractLogger.warn("Erro lendo documento.", {
      message: err?.message || String(err || "document_extract_failed"),
      file: path.basename(filePath || ""),
    });
    return "";
  }
}

module.exports = { detectExt, extractText };
