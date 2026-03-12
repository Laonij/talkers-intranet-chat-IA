const fs = require("fs");
const path = require("path");
const JSZip = require("jszip");
const XLSX = require("xlsx");
const { PDFDocument, StandardFonts, rgb } = require("pdf-lib");
const { createSpeechArtifact } = require("./audio");

const RESPONSES_URL = "https://api.openai.com/v1/responses";
const IMAGES_URL = "https://api.openai.com/v1/images/generations";

function slugifyPrompt(prompt) {
  return String(prompt || "arquivo")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50) || "arquivo";
}

function makeArtifactFilename(prompt, ext) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `${slugifyPrompt(prompt)}-${stamp}${ext}`;
}

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function detectArtifactKind(prompt) {
  const text = normalizeText(prompt);

  if (/(imagem|foto|ilustracao|logo|banner|cartaz|poster|capa)/.test(text)) {
    return "image";
  }

  if (/(audio|audios|voz|locucao|narracao|narração|locução|mp3|podcast)/.test(text)) {
    return "audio";
  }

  if (/(planilha|excel|xlsx|tabela)/.test(text)) return "xlsx";
  if (/(pdf|relatorio em pdf)/.test(text)) return "pdf";
  if (/(docx|word|documento)/.test(text)) return "docx";
  if (/(codigo|script|javascript|node|html|css|sql|json|typescript|python)/.test(text)) {
    return "code";
  }

  return null;
}

function guessCodeExtension(prompt) {
  const text = normalizeText(prompt);
  if (text.includes("typescript")) return ".ts";
  if (text.includes("javascript") || text.includes("node")) return ".js";
  if (text.includes("html")) return ".html";
  if (text.includes("css")) return ".css";
  if (text.includes("sql")) return ".sql";
  if (text.includes("json")) return ".json";
  if (text.includes("python")) return ".py";
  return ".txt";
}

function stripCodeFences(value) {
  return String(value || "")
    .replace(/^```[a-z0-9]*\s*/i, "")
    .replace(/```$/i, "")
    .trim();
}

function xmlEscape(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function wrapText(text, maxChars = 88) {
  const words = String(text || "").split(/\s+/).filter(Boolean);
  const lines = [];
  let current = "";

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length > maxChars) {
      if (current) lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }

  if (current) lines.push(current);
  return lines;
}

async function callResponsesText(apiKey, prompt, targetKind) {
  if (!apiKey) return "";

  const model = process.env.OPENAI_ARTIFACT_MODEL || process.env.OPENAI_MODEL || "gpt-4.1-mini";
  const instructionsByKind = {
    pdf: "Escreva um texto objetivo em portugues do Brasil para ser colocado em um PDF. Nao use markdown.",
    docx: "Escreva um documento objetivo em portugues do Brasil. Nao use markdown.",
    code: "Responda apenas com o codigo solicitado, sem cercas markdown.",
    xlsx: "Resuma em texto simples quais colunas e dados principais a planilha precisa ter.",
    audio: "Escreva um roteiro curto em portugues do Brasil para ser narrado em audio. Nao use markdown.",
  };

  const resp = await fetch(RESPONSES_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      input: [
        {
          role: "system",
          content: [{ type: "input_text", text: instructionsByKind[targetKind] || instructionsByKind.docx }],
        },
        {
          role: "user",
          content: [{ type: "input_text", text: prompt }],
        },
      ],
    }),
  });

  if (!resp.ok) {
    throw new Error(await resp.text());
  }

  const data = await resp.json();
  return stripCodeFences(data.output_text || "");
}

function buildSpreadsheetRows(prompt, draftText) {
  const text = normalizeText(prompt);

  if (/(aluno|alunos|matricula|turma|cadastro)/.test(text)) {
    return [
      ["Nome do aluno", "Matricula", "Turma", "Responsavel", "Telefone", "Email", "Status", "Observacoes"],
      ["", "", "", "", "", "", "Ativo", ""],
    ];
  }

  if (/(financeiro|despesa|receita|pagamento|caixa)/.test(text)) {
    return [
      ["Data", "Descricao", "Categoria", "Valor", "Status", "Observacoes"],
      ["", "", "", "", "Pendente", ""],
    ];
  }

  const rows = [
    ["Campo", "Valor"],
    ["Solicitacao", String(prompt || "").trim() || "Planilha automatica"],
    ["Gerado em", new Date().toISOString()],
  ];

  const draftLines = String(draftText || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 12);

  for (const line of draftLines) {
    rows.push([line, ""]);
  }

  return rows;
}

async function createSpreadsheetArtifact(prompt, draftText, outDir) {
  const wb = XLSX.utils.book_new();
  const rows = buildSpreadsheetRows(prompt, draftText);
  const ws = XLSX.utils.aoa_to_sheet(rows);
  XLSX.utils.book_append_sheet(wb, ws, "Planilha");

  const filename = makeArtifactFilename(prompt, ".xlsx");
  const fullPath = path.join(outDir, filename);
  XLSX.writeFile(wb, fullPath);

  return {
    filename,
    fullPath,
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    reply: "Planilha gerada com sucesso.",
  };
}

async function createPdfArtifact(prompt, draftText, outDir) {
  const pdfDoc = await PDFDocument.create();
  let page = pdfDoc.addPage([595, 842]);
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const titleFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const fontSize = 12;
  const titleSize = 18;
  const margin = 48;
  let y = page.getHeight() - margin;

  page.drawText("Documento Gerado pela Talkers IA", {
    x: margin,
    y,
    size: titleSize,
    font: titleFont,
    color: rgb(0.06, 0.17, 0.32),
  });

  y -= 28;
  const body = draftText || String(prompt || "").trim() || "Documento gerado automaticamente.";
  const lines = wrapText(body, 88);

  for (const line of lines) {
    if (y < margin) {
      page = pdfDoc.addPage([595, 842]);
      y = page.getHeight() - margin;
    }

    page.drawText(line, {
      x: margin,
      y,
      size: fontSize,
      font,
      color: rgb(0.12, 0.16, 0.23),
    });

    y -= 18;
  }

  const filename = makeArtifactFilename(prompt, ".pdf");
  const fullPath = path.join(outDir, filename);
  fs.writeFileSync(fullPath, await pdfDoc.save());

  return {
    filename,
    fullPath,
    mimeType: "application/pdf",
    reply: "PDF gerado com sucesso.",
  };
}

async function createDocxArtifact(prompt, draftText, outDir) {
  const zip = new JSZip();
  const filename = makeArtifactFilename(prompt, ".docx");
  const fullPath = path.join(outDir, filename);
  const bodyText = draftText || String(prompt || "").trim() || "Documento gerado automaticamente.";

  const paragraphs = bodyText
    .split(/\r?\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => `<w:p><w:r><w:t xml:space="preserve">${xmlEscape(line)}</w:t></w:r></w:p>`)
    .join("");

  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`
  );

  zip.folder("_rels").file(
    ".rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`
  );

  zip.folder("word").file(
    "document.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p>
      <w:r>
        <w:rPr><w:b/></w:rPr>
        <w:t>Documento Gerado pela Talkers IA</w:t>
      </w:r>
    </w:p>
    ${paragraphs}
    <w:sectPr>
      <w:pgSz w:w="11906" w:h="16838"/>
      <w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/>
    </w:sectPr>
  </w:body>
</w:document>`
  );

  fs.writeFileSync(fullPath, await zip.generateAsync({ type: "nodebuffer" }));

  return {
    filename,
    fullPath,
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    reply: "Documento DOCX gerado com sucesso.",
  };
}

async function createCodeArtifact(prompt, draftText, outDir) {
  const ext = guessCodeExtension(prompt);
  const filename = makeArtifactFilename(prompt, ext);
  const fullPath = path.join(outDir, filename);
  const code = stripCodeFences(draftText) || String(prompt || "").trim() || "// Arquivo gerado automaticamente";

  fs.writeFileSync(fullPath, `${code}\n`, "utf8");

  const mimeByExt = {
    ".html": "text/html",
    ".css": "text/css",
    ".js": "text/javascript",
    ".ts": "text/plain",
    ".py": "text/x-python",
    ".sql": "application/sql",
    ".json": "application/json",
    ".txt": "text/plain",
  };

  return {
    filename,
    fullPath,
    mimeType: mimeByExt[ext] || "text/plain",
    reply: `Arquivo ${ext.replace(".", "").toUpperCase()} gerado com sucesso.`,
  };
}

async function createImageArtifact(apiKey, prompt, outDir) {
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY ausente para gerar imagem.");
  }

  const model = process.env.OPENAI_IMAGE_MODEL || "gpt-image-1";
  const resp = await fetch(IMAGES_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      prompt,
      size: "1024x1024",
    }),
  });

  if (!resp.ok) {
    throw new Error(await resp.text());
  }

  const data = await resp.json();
  const imageBase64 = data?.data?.[0]?.b64_json;
  if (!imageBase64) {
    throw new Error("A OpenAI nao retornou a imagem gerada.");
  }

  const filename = makeArtifactFilename(prompt, ".png");
  const fullPath = path.join(outDir, filename);
  fs.writeFileSync(fullPath, Buffer.from(imageBase64, "base64"));

  return {
    filename,
    fullPath,
    mimeType: "image/png",
    reply: "Imagem gerada com sucesso.",
  };
}

async function createAudioArtifact(apiKey, prompt, draftText, outDir) {
  const speechText = draftText || String(prompt || "").trim();
  return createSpeechArtifact({
    text: speechText,
    prompt,
    outDir,
    apiKey,
  });
}

async function generateArtifact({ prompt, outDir, apiKey = process.env.OPENAI_API_KEY || "" }) {
  const artifactKind = detectArtifactKind(prompt);
  if (!artifactKind) return null;

  fs.mkdirSync(outDir, { recursive: true });

  if (artifactKind === "image") {
    return createImageArtifact(apiKey, prompt, outDir);
  }

  let draftText = "";
  try {
    draftText = await callResponsesText(apiKey, prompt, artifactKind);
  } catch {
    draftText = "";
  }

  if (artifactKind === "xlsx") {
    return createSpreadsheetArtifact(prompt, draftText, outDir);
  }

  if (artifactKind === "pdf") {
    return createPdfArtifact(prompt, draftText, outDir);
  }

  if (artifactKind === "docx") {
    return createDocxArtifact(prompt, draftText, outDir);
  }

  if (artifactKind === "code") {
    return createCodeArtifact(prompt, draftText, outDir);
  }

  if (artifactKind === "audio") {
    return createAudioArtifact(apiKey, prompt, draftText, outDir);
  }

  return null;
}

module.exports = { generateArtifact };
