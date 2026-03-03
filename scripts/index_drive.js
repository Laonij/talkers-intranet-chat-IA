require('dotenv').config();
const fs = require('fs');
const path = require('path');
const pdfParse = require('pdf-parse');
const mammoth = require('mammoth');
const XLSX = require('xlsx');
const { migrate, get, all, run } = require('../db');

const INDEX_FOLDER = process.env.INDEX_FOLDER || 'kb';
const SUPPORTED = new Set(['.txt', '.md', '.pdf', '.docx', '.xlsx', '.csv']);

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

function toRel(full, absIndex) {
  const rel = path.relative(absIndex, full);
  return rel.replace(/\\/g, '/');
}

async function extractText(fullPath, ext) {
  if (ext === '.txt' || ext === '.md' || ext === '.csv') {
    return fs.readFileSync(fullPath, 'utf-8');
  }
  if (ext === '.pdf') {
    const buf = fs.readFileSync(fullPath);
    const data = await pdfParse(buf);
    return data.text || '';
  }
  if (ext === '.docx') {
    const result = await mammoth.extractRawText({ path: fullPath });
    return result.value || '';
  }
  if (ext === '.xlsx') {
    const wb = XLSX.readFile(fullPath, { cellDates: true });
    let text = '';
    for (const sheetName of wb.SheetNames) {
      const sheet = wb.Sheets[sheetName];
      const csv = XLSX.utils.sheet_to_csv(sheet, { FS: '\t' });
      text += `\n\n# Planilha: ${sheetName}\n` + csv;
    }
    return text;
  }
  return '';
}

async function main() {
  migrate();

  const absIndex = path.isAbsolute(INDEX_FOLDER) ? INDEX_FOLDER : path.join(process.cwd(), INDEX_FOLDER);
  if (!fs.existsSync(absIndex)) {
    console.error("❌ INDEX_FOLDER não encontrado:", absIndex);
    console.error("Dica: instale Google Drive for Desktop e aponte INDEX_FOLDER para a pasta sincronizada (Mirror).");
    process.exit(1);
  }

  console.log("📂 Indexando pasta:", absIndex);

  const files = walk(absIndex)
    .filter(p => SUPPORTED.has(path.extname(p).toLowerCase()));

  console.log("🔎 Arquivos suportados encontrados:", files.length);

  const seen = new Set();
  let indexed = 0, skipped = 0, failed = 0;

  for (const full of files) {
    const stat = fs.statSync(full);
    const ext = path.extname(full).toLowerCase();

    if (stat.size > 25 * 1024 * 1024) { skipped++; continue; }

    const source_path = full;
    const rel_path = toRel(full, absIndex);
    seen.add(source_path);

    const existing = await get("SELECT id, modified_ms FROM documents WHERE source_path=?", [source_path]);
    if (existing && Number(existing.modified_ms) === Number(stat.mtimeMs)) {
      skipped++;
      continue;
    }

    try {
      const extracted = (await extractText(full, ext)).trim();
      const safeText = extracted.length ? extracted : `(sem texto extraído) ${rel_path}`;

      if (!existing) {
        await run(
          "INSERT INTO documents (source_path, rel_path, ext, size_bytes, modified_ms, extracted_text) VALUES (?, ?, ?, ?, ?, ?)",
          [source_path, rel_path, ext, stat.size, round(stat.mtimeMs), safeText]
        );
      } else {
        await run(
          "UPDATE documents SET rel_path=?, ext=?, size_bytes=?, modified_ms=?, extracted_text=?, updated_at=datetime('now') WHERE id=?",
          [rel_path, ext, stat.size, round(stat.mtimeMs), safeText, existing.id]
        );
      }

      indexed++;
      if (indexed % 25 === 0) console.log(`✅ Indexados: ${indexed} | Pulados: ${skipped} | Falhas: ${failed}`);
    } catch (e) {
      failed++;
      console.log("⚠️ Falha ao indexar:", rel_path, String(e?.message || e));
    }
  }

  const rows = await all("SELECT id, source_path FROM documents");
  let removed = 0;
  for (const r of rows) {
    if (!seen.has(r.source_path)) {
      await run("DELETE FROM documents WHERE id=?", [r.id]);
      removed++;
    }
  }

  console.log("✅ Indexação finalizada.");
  console.log("Indexados:", indexed, "Pulados:", skipped, "Falhas:", failed, "Removidos:", removed);
  console.log("Dica: use `npm run watch` para reindexar automaticamente quando mudar algo.");
}

function round(x){ return Math.round(Number(x)); }

main().catch(err => { console.error(err); process.exit(1); });
