require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { migrate, get, all, run } = require("../db");
const { extractText } = require("../lib/extract");

const INDEX_FOLDER = process.env.INDEX_FOLDER || "kb";
const SUPPORTED = new Set([".txt", ".md", ".pdf", ".docx", ".xlsx", ".csv", ".pptx"]);
const MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024;

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(fullPath));
    else out.push(fullPath);
  }
  return out;
}

function toRel(full, absIndex) {
  const rel = path.relative(absIndex, full);
  return rel.replace(/\\/g, "/");
}

function round(x) {
  return Math.round(Number(x));
}

async function main() {
  migrate();

  const absIndex = path.isAbsolute(INDEX_FOLDER)
    ? INDEX_FOLDER
    : path.join(process.cwd(), INDEX_FOLDER);

  if (!fs.existsSync(absIndex)) {
    console.error("INDEX_FOLDER nao encontrado:", absIndex);
    console.error(
      "Dica: instale o Google Drive for Desktop e aponte INDEX_FOLDER para a pasta sincronizada."
    );
    process.exit(1);
  }

  console.log("Indexando pasta:", absIndex);

  const files = walk(absIndex).filter((fullPath) =>
    SUPPORTED.has(path.extname(fullPath).toLowerCase())
  );

  console.log("Arquivos suportados encontrados:", files.length);

  const seen = new Set();
  let indexed = 0;
  let skipped = 0;
  let failed = 0;

  for (const full of files) {
    const stat = fs.statSync(full);
    const ext = path.extname(full).toLowerCase();

    if (stat.size > MAX_FILE_SIZE_BYTES) {
      skipped++;
      continue;
    }

    const sourcePath = full;
    const relPath = toRel(full, absIndex);
    seen.add(sourcePath);

    const existing = await get("SELECT id, modified_ms FROM documents WHERE source_path=?", [sourcePath]);
    if (existing && Number(existing.modified_ms) === Number(round(stat.mtimeMs))) {
      skipped++;
      continue;
    }

    try {
      const extracted = (await extractText(full, path.basename(full), "")).trim();
      const safeText = extracted.length ? extracted : `(sem texto extraido) ${relPath}`;

      if (!existing) {
        await run(
          "INSERT INTO documents (source_path, rel_path, ext, size_bytes, modified_ms, extracted_text) VALUES (?, ?, ?, ?, ?, ?)",
          [sourcePath, relPath, ext, stat.size, round(stat.mtimeMs), safeText]
        );
      } else {
        await run(
          "UPDATE documents SET rel_path=?, ext=?, size_bytes=?, modified_ms=?, extracted_text=?, updated_at=datetime('now') WHERE id=?",
          [relPath, ext, stat.size, round(stat.mtimeMs), safeText, existing.id]
        );
      }

      indexed++;
      if (indexed % 25 === 0) {
        console.log(`Indexados: ${indexed} | Pulados: ${skipped} | Falhas: ${failed}`);
      }
    } catch (err) {
      failed++;
      console.log("Falha ao indexar:", relPath, String(err?.message || err));
    }
  }

  const rows = await all("SELECT id, source_path FROM documents");
  let removed = 0;
  for (const row of rows) {
    if (!seen.has(row.source_path)) {
      await run("DELETE FROM documents WHERE id=?", [row.id]);
      removed++;
    }
  }

  console.log("Indexacao finalizada.");
  console.log("Indexados:", indexed, "Pulados:", skipped, "Falhas:", failed, "Removidos:", removed);
  console.log("Dica: use `npm run watch` para reindexar automaticamente quando mudar algo.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});