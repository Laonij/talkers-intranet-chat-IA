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
    .replace(/\s+/g, " ")
    .trim();
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

      if (texts.length) out += texts.join(" ") + "\n\n";
    }

    return cleanText(out);
  } catch (err) {
    console.error("Erro lendo PPTX:", err);
    return "";
  }
}

async function extractText(filePath) {
  try {
    const lower = String(filePath || "").toLowerCase();
    const ext = path.extname(lower);

    if (ext === ".pdf") {
      const data = await pdf(fs.readFileSync(filePath));
      return cleanText(data.text || "");
    }

    if (ext === ".docx") {
      const result = await mammoth.extractRawText({ path: filePath });
      return cleanText(result.value || "");
    }

    if (ext === ".xlsx") {
      const workbook = XLSX.readFile(filePath);
      const parts = [];

      for (const sheetName of workbook.SheetNames) {
        const sheet = workbook.Sheets[sheetName];
        parts.push(`Planilha: ${sheetName}`);
        parts.push(XLSX.utils.sheet_to_csv(sheet));
      }

      return cleanText(parts.join("\n\n"));
    }

    if (ext === ".pptx") {
      return await extractPptxText(filePath);
    }

    if (ext === ".txt" || ext === ".csv") {
      return cleanText(fs.readFileSync(filePath, "utf8"));
    }

    return "";
  } catch (err) {
    console.error("Erro lendo documento:", err);
    return "";
  }
}

module.exports = { extractText };
