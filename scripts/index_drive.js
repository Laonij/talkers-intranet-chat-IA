require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { migrate, get, all, run } = require("../db");
const { createLogger } = require("../lib/appLogger");
const { extractText } = require("../lib/extract");
const { detectLanguage } = require("../lib/language");
const { sanitizeTextForPostgres } = require("../lib/postgresSanitizer");
const { chunkTextSemantically, extractKeywords, hashText } = require("../lib/semantic");

const INDEX_FOLDER = process.env.INDEX_FOLDER || "kb";
const SUPPORTED = new Set([".txt", ".md", ".pdf", ".docx", ".xlsx", ".csv", ".pptx"]);
const MAX_FILE_SIZE_BYTES = Math.max(1, Number(process.env.MAX_UPLOAD_SIZE_MB || 25)) * 1024 * 1024;
const indexLogger = createLogger("indexing");

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

async function upsertDocumentChunks(documentId, relPath, safeText, language, keywordText) {
  await run("DELETE FROM document_chunks WHERE document_id=?", [documentId]);

  const documentKeywords = keywordText ? keywordText.split(", ").filter(Boolean) : [];
  const normalizedText = sanitizeTextForPostgres(safeText || relPath, {
    trim: true,
    normalizeWhitespace: true,
    maxLength: 250000,
  }) || relPath;
  const chunks = chunkTextSemantically(normalizedText, {
    maxChars: 1400,
    minChars: 420,
  });

  if (!chunks.length) {
    await run(
      "INSERT INTO document_chunks (document_id, rel_path, chunk_index, content_text, language, translated_text, translated_language, content_hash, keywords) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [documentId, relPath, 0, normalizedText, language, "", null, hashText(normalizedText), keywordText]
    );
    return 1;
  }

  let created = 0;
  for (const chunk of chunks) {
    const keywords = [...new Set([...(chunk.keywords || []), ...documentKeywords])].slice(0, 16).join(", ");
    try {
      await run(
        "INSERT INTO document_chunks (document_id, rel_path, chunk_index, content_text, language, translated_text, translated_language, content_hash, keywords) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [documentId, relPath, chunk.index, sanitizeTextForPostgres(chunk.text, { trim: true, normalizeWhitespace: true }) || normalizedText, language, "", null, chunk.hash, keywords]
      );
      created += 1;
    } catch (err) {
      indexLogger.warn("Falha ao persistir chunk no indexador.", {
        document_id: documentId,
        chunk_index: chunk.index,
        message: err?.message || String(err || "document_chunk_insert_failed"),
      });
    }
  }

  return created;
}

async function main() {
  await migrate();

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
      const extracted = sanitizeTextForPostgres(await extractText(full, path.basename(full), ""), {
        trim: true,
        normalizeWhitespace: true,
        maxLength: 250000,
      }) || "";
      const safeText = extracted.length ? extracted : `(sem texto extraido) ${relPath}`;
      const language = detectLanguage(safeText, "pt");
      const keywordText = extractKeywords(safeText, 14).join(", ");
      const contentHash = hashText(safeText);

      let documentId = existing?.id || 0;
      if (!existing) {
        const created = await run(
          "INSERT INTO documents (source_path, rel_path, ext, size_bytes, modified_ms, extracted_text, language, translated_text, translated_language, content_hash, keywords) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
          [sourcePath, relPath, ext, stat.size, round(stat.mtimeMs), safeText, language, "", null, contentHash, keywordText]
        );
        documentId = created.lastID;
      } else {
        await run(
          "UPDATE documents SET rel_path=?, ext=?, size_bytes=?, modified_ms=?, extracted_text=?, language=?, translated_text=?, translated_language=?, content_hash=?, keywords=?, updated_at=datetime('now') WHERE id=?",
          [relPath, ext, stat.size, round(stat.mtimeMs), safeText, language, "", null, contentHash, keywordText, existing.id]
        );
        documentId = existing.id;
      }

      if (documentId) {
        await upsertDocumentChunks(documentId, relPath, safeText, language, keywordText);
      }

      indexed++;
      if (indexed % 25 === 0) {
        console.log(`Indexados: ${indexed} | Pulados: ${skipped} | Falhas: ${failed}`);
      }
    } catch (err) {
      failed++;
      indexLogger.warn("Falha ao indexar arquivo.", {
        rel_path: relPath,
        message: err?.message || String(err || "drive_index_failed"),
      });
    }
  }

  const rows = await all("SELECT id, source_path FROM documents");
  let removed = 0;
  for (const row of rows) {
    if (!seen.has(row.source_path)) {
      await run("DELETE FROM document_chunks WHERE document_id=?", [row.id]);
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

