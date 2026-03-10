const fs = require("fs");
const pdf = require("pdf-parse");
const mammoth = require("mammoth");
const XLSX = require("xlsx");

async function extractText(filePath) {
  try {
    const lower = String(filePath || "").toLowerCase();

    if (lower.endsWith(".pdf")) {
      const data = await pdf(fs.readFileSync(filePath));
      return data.text || "";
    }

    if (lower.endsWith(".docx")) {
      const result = await mammoth.extractRawText({ path: filePath });
      return result.value || "";
    }

    if (lower.endsWith(".xlsx")) {
      const workbook = XLSX.readFile(filePath);
      const firstSheet = workbook.SheetNames[0];
      if (!firstSheet) return "";
      const sheet = workbook.Sheets[firstSheet];
      return XLSX.utils.sheet_to_csv(sheet);
    }

    if (lower.endsWith(".txt") || lower.endsWith(".csv")) {
      return fs.readFileSync(filePath, "utf8");
    }

    return "";
  } catch (err) {
    console.error("Erro lendo documento:", err);
    return "";
  }
}

module.exports = { extractText };
