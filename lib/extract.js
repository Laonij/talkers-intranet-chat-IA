const fs = require("fs");
const path = require("path");
const pdf = require("pdf-parse");
const mammoth = require("mammoth");
const XLSX = require("xlsx");
const JSZip = require("jszip");

function cleanText(s) {
  return String(s || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\r/g, "\n")
    .replace(/\t/g, " ")
    .replace(/[ ]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
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

async function extractPptxText(filePath) {
  try {
    const buf = fs.readFileSync(filePath);
    const zip = await JSZip.loadAsync(buf);

    const slideFiles = Object.keys(zip.files)
      .filter((name) => /^ppt\/slides\/slide\d+\.xml$/i.test(name))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

    let out = "";

    for (const slideName of slideFiles) {
      const xml = await zip.files[slideName].async("string");

      const texts = [];
      const regex = /<a:t[^>]*>([\s\S]*?)<\/a:t>/g;
      let match;

      while ((match = regex.exec(xml)) !== null) {
        texts.push(match[1]);
      }

      if (texts.length) {
        out += `Slide ${slideName.match(/slide(\d+)/i)?.[1] || ""}:\n`;
        out += texts.join(" ") + "\n\n";
      }
    }

    return cleanText(out);
  } catch (err) {
    console.error("Erro lendo PPTX:", err);
    return "";
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
    console.error("Erro lendo XLSX:", err);
    return "";
  }
}

async function extractPdfText(filePath) {
  try {
    const data = await pdf(fs.readFileSync(filePath));
    return cleanText(data.text || "");
  } catch (err) {
    console.error("Erro lendo PDF:", err);
    return "";
  }
}

async function extractDocxText(filePath) {
  try {
    const result = await mammoth.extractRawText({ path: filePath });
    return cleanText(result.value || "");
  } catch (err) {
    console.error("Erro lendo DOCX:", err);
    return "";
  }
}

function extractPlainText(filePath) {
  try {
    return cleanText(fs.readFileSync(filePath, "utf8"));
  } catch (err) {
    console.error("Erro lendo TXT/CSV:", err);
    return "";
  }
}

async function extractText(filePath, originalName = "", mimeType = "") {
  try {
    const ext = detectExt(filePath, originalName, mimeType);

    if (ext === ".pdf") {
      return await extractPdfText(filePath);
    }

    if (ext === ".docx") {
      return await extractDocxText(filePath);
    }

    if (ext === ".xlsx") {
      return extractWorkbookText(filePath);
    }

    if (ext === ".pptx") {
      return await extractPptxText(filePath);
    }

    if (ext === ".txt" || ext === ".csv") {
      return extractPlainText(filePath);
    }

    return "";
  } catch (err) {
    console.error("Erro lendo documento:", err);
    return "";
  }
}

module.exports = { extractText };
