const fs = require("fs");
const path = require("path");
const JSZip = require("jszip");
const XLSX = require("xlsx");
const { PDFDocument, StandardFonts, rgb } = require("pdf-lib");
const { createSpeechArtifact } = require("./audio");

const RESPONSES_URL = "https://api.openai.com/v1/responses";
const IMAGES_URL = "https://api.openai.com/v1/images/generations";
const IMAGE_EDITS_URL = "https://api.openai.com/v1/images/edits";
const MAX_IMAGE_EDIT_BYTES = 50 * 1024 * 1024;
const IMAGE_VALIDATION_MODEL = process.env.OPENAI_IMAGE_VALIDATOR_MODEL || process.env.OPENAI_MODEL || "gpt-4.1-mini";
const OPENAI_GENERATE_TIMEOUT_MS = Math.max(8000, Number(process.env.OPENAI_GENERATE_TIMEOUT_MS || 60000));

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

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

function buildFetchErrorDetails(err, extra = {}) {
  return {
    message: err?.message || String(err || "unknown_error"),
    name: err?.name || "",
    code: err?.code || err?.cause?.code || "",
    url: extra.url || "",
    timeout_ms: OPENAI_GENERATE_TIMEOUT_MS,
    ...extra,
  };
}

function buildResponseError(resp, bodyText, url) {
  return Object.assign(new Error(String(bodyText || `HTTP ${resp?.status || 0}`)), {
    response: { status: resp?.status || 0 },
    url,
  });
}

async function fetchWithRetry(url, options = {}, diagnostics = {}, retryCount = 2) {
  let lastError = null;
  for (let attempt = 0; attempt <= retryCount; attempt += 1) {
    try {
      return await fetch(url, {
        ...options,
        signal: options.signal || AbortSignal.timeout(OPENAI_GENERATE_TIMEOUT_MS),
      });
    } catch (err) {
      lastError = err;
      const details = buildFetchErrorDetails(err, { attempt: attempt + 1, ...diagnostics });
      if (attempt < retryCount) {
        const waitMs = 800 * (attempt + 1);
        console.warn("Falha em geração externa; tentando novamente.", { ...details, retry_in_ms: waitMs });
        await new Promise((resolve) => setTimeout(resolve, waitMs));
        continue;
      }
      throw Object.assign(err instanceof Error ? err : new Error(String(err || "fetch_failed")), { diagnostics: details });
    }
  }
  throw lastError || new Error("fetch_failed");
}

function promptLooksMetaQuestion(text = "") {
  return /^(por que|porque|como|quais?|qual|voce consegue|você consegue|da para|dá para|tem como|e possivel|é possível)/.test(text)
    && /(gerar|criar|fazer|montar|produzir|imagem|pdf|docx|planilha|audio|áudio)/.test(text);
}

function isImageEditPrompt(text, hasReferenceImages = false) {
  const hasEditVerb = /(editar|edite|ajustar|ajuste|corrigir|corrija|melhorar|melhore|alinhar|alinhe|reposicionar|reposicione|mudar|mude|trocar|troque|alterar|altere|remover|remova|apagar|apague|recortar|recorte|redimensionar|clarear|escurecer|centralizar|desfocar|limpar|substituir|reescrever|retocar)/.test(text);
  if (!hasEditVerb) return false;
  if (/(pdf|docx|documento|word|planilha|xlsx|excel|contrato|comunicado|relatorio|relatório|slide|ppt|powerpoint)/.test(text)) return false;
  const hasDirectImageCue = /(imagem|foto|arte|banner|cartaz|poster|capa|logo|print|layout|design|anexo|mockup)/.test(text);
  const hasVisualCue = /(texto|fonte|fundo|cor|alinhamento|margem|borda|recorte|nitidez|brilho|contraste|resolucao|resolução|sombra|elemento|posicao|posição)/.test(text);
  return hasDirectImageCue || (hasReferenceImages && hasVisualCue);
}

function detectArtifactKind(prompt, options = {}) {
  const text = normalizeText(prompt);
  const referenceImages = Array.isArray(options.referenceImages) ? options.referenceImages : [];
  if (isImageEditPrompt(text, referenceImages.length > 0)) return "image_edit";

  const asksToCreate = /(gere|gera|crie|criar|monte|montar|faca|faça|produza|desenvolva|prepare|renderize)/.test(text);
  const imageCue = /(imagem|foto|ilustracao|ilustração|logo|banner|cartaz|poster|capa|arte|mockup|thumbnail|flyer|criativo)/.test(text);
  const documentCue = /(pdf|docx|word|documento|comunicado|relatorio|relatório|aviso|carta|oficio|ofício)/.test(text);
  const sheetCue = /(planilha|excel|xlsx|tabela)/.test(text);
  const audioCue = /(audio|áudio|voz|locucao|locução|narracao|narração|mp3|podcast)/.test(text);

  if ((imageCue || (asksToCreate && /(campanha|marketing|publicidade|anuncio|anúncio|social media|instagram|facebook|stories|reels)/.test(text))) && !promptLooksMetaQuestion(text)) {
    return "image";
  }
  if (audioCue && !promptLooksMetaQuestion(text)) return "audio";
  if (sheetCue && !promptLooksMetaQuestion(text)) return "xlsx";
  if (/(pdf|relatorio em pdf|relatório em pdf)/.test(text) && !promptLooksMetaQuestion(text)) return "pdf";
  if (/(docx|word)/.test(text) && !promptLooksMetaQuestion(text)) return "docx";
  if (documentCue && asksToCreate && !promptLooksMetaQuestion(text)) return "pdf";
  if (/(codigo|script|javascript|node|html|css|sql|json|typescript|python)/.test(text) && !promptLooksMetaQuestion(text)) return "code";
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
  return String(value || "").replace(/^```[a-z0-9]*\s*/i, "").replace(/```$/i, "").trim();
}

function xmlEscape(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function buildArtifactAuthoringPrompt(targetKind, prompt) {
  const safePrompt = String(prompt || "").trim();
  const shared = [
    "Transforme o pedido abaixo no artefato final pronto para uso.",
    "Nao repita literalmente a instrucao do usuario.",
    "Entregue conteudo util, completo, natural, profissional e apresentavel.",
    "Nao explique o que voce faria; entregue o material final.",
    "Se faltarem detalhes especificos, escreva de forma elegante sem placeholders como [inserir data] ou [informar local].",
  ].join(" ");

  const byKind = {
    pdf: [
      shared,
      "Crie um texto final em portugues do Brasil para um PDF institucional ou operacional.",
      "Use markdown simples apenas com # para titulo, ## para secoes e - para bullets.",
      "Entregue algo pronto para diagramacao profissional, sem cercas de codigo e sem frases meta.",
    ].join(" "),
    docx: [
      shared,
      "Crie um documento final em portugues do Brasil, organizado em secoes claras e linguagem profissional.",
      "Use markdown simples apenas com # para titulo, ## para secoes e - para bullets.",
      "Nao use cercas de codigo.",
    ].join(" "),
    xlsx: [shared, "Descreva em texto simples uma estrutura de planilha util, com colunas e algumas linhas de exemplo plausiveis."].join(" "),
    audio: [shared, "Escreva um roteiro curto em portugues do Brasil para ser narrado em audio."].join(" "),
    code: "Responda apenas com o codigo solicitado, sem markdown.",
  };

  return `${byKind[targetKind] || byKind.docx}\n\nPedido do usuario:\n${safePrompt}`;
}

function inferCampaignTopic(prompt = "") {
  const text = normalizeText(prompt);
  if (/(pascoa|páscoa)/.test(text)) return "Páscoa";
  if (/(matricula|matrícula|inscricao|inscrição)/.test(text)) return "Matrículas";
  if (/(black friday)/.test(text)) return "Black Friday";
  if (/(marketing|campanha|banner|arte)/.test(text)) return "Campanha";
  return "Comunicado";
}

function buildDocumentOutline(prompt = "", kind = "pdf") {
  const safePrompt = String(prompt || "").trim();
  const lowered = normalizeText(prompt);
  const today = new Date().toLocaleDateString("pt-BR");
  const topic = inferCampaignTopic(prompt);

  if (/(comunicado|aviso|informar|avisar|sorteio|pascoa|páscoa)/.test(lowered)) {
    return {
      title: `Comunicado Especial • ${topic}`,
      subtitle: `Mensagem oficial preparada em ${today}`,
      sections: [
        {
          heading: "Mensagem principal",
          paragraphs: [
            "Prezados alunos, responsáveis e equipe, temos uma novidade especial para este fim de semana.",
            `Vamos realizar um Sorteio de ${topic} para tornar este período ainda mais alegre, acolhedor e participativo para toda a comunidade Talkers.`,
          ],
        },
        {
          heading: "Como vai funcionar",
          bullets: [
            "A participação será comunicada com clareza pelos canais oficiais da escola.",
            "A programação detalhada será compartilhada pela equipe responsável com antecedência.",
            "Recomendamos acompanhar os comunicados internos para não perder nenhuma atualização importante.",
          ],
        },
        {
          heading: "Encerramento",
          paragraphs: [
            "Esperamos você para participar conosco desse momento especial.",
            "Contamos com a presença de todos e desejamos um excelente fim de semana.",
          ],
        },
      ],
      signature: "Atenciosamente,\nEquipe Talkers",
    };
  }

  if (/(proposta comercial|proposta|orcamento|orçamento)/.test(lowered)) {
    return {
      title: "Proposta Comercial",
      subtitle: safePrompt,
      sections: [
        { heading: "Objetivo", paragraphs: ["Apresentar uma proposta clara, profissional e alinhada com a necessidade do cliente."] },
        { heading: "Escopo", bullets: ["Solução personalizada", "Atendimento próximo", "Cronograma definido", "Próximos passos organizados"] },
      ],
      signature: "Equipe Talkers",
    };
  }

  return {
    title: kind === "pdf" ? "Documento Profissional" : "Documento",
    subtitle: safePrompt,
    sections: [
      { heading: "Conteúdo", paragraphs: [safePrompt, "Material estruturado automaticamente para uso imediato."] },
    ],
    signature: "Talkers IA",
  };
}

function textLooksTooSimilarToPrompt(prompt = "", draftText = "") {
  const safePrompt = normalizeText(prompt).replace(/\s+/g, " ").trim();
  const safeDraft = normalizeText(draftText).replace(/\s+/g, " ").trim();
  if (!safePrompt || !safeDraft) return false;
  if (safeDraft === safePrompt) return true;
  if (safeDraft.includes(safePrompt) || safePrompt.includes(safeDraft)) return true;
  const promptWords = new Set(safePrompt.split(" ").filter(Boolean));
  const draftWords = safeDraft.split(" ").filter(Boolean);
  const overlap = draftWords.filter((word) => promptWords.has(word)).length;
  return (overlap / Math.max(1, draftWords.length)) > 0.72;
}

function buildPromptBasedDocument(prompt = "", kind = "pdf") {
  const outline = buildDocumentOutline(prompt, kind);
  const parts = [`# ${outline.title}`];
  if (outline.subtitle) parts.push(outline.subtitle);
  for (const section of outline.sections) {
    if (section.heading) parts.push(`## ${section.heading}`);
    for (const paragraph of section.paragraphs || []) parts.push(paragraph);
    for (const bullet of section.bullets || []) parts.push(`- ${bullet}`);
  }
  if (outline.signature) parts.push(outline.signature);
  return parts.join("\n\n");
}

function parseStructuredDraft(prompt = "", draftText = "", kind = "pdf") {
  const safeDraft = String(draftText || "").trim();
  if (!safeDraft || textLooksTooSimilarToPrompt(prompt, safeDraft)) {
    return buildDocumentOutline(prompt, kind);
  }

  const lines = safeDraft.split(/\r?\n/).map((line) => line.trimRight());
  let title = "";
  let subtitle = "";
  const sections = [];
  let current = null;

  const pushSection = () => {
    if (current && (current.heading || current.paragraphs.length || current.bullets.length)) {
      sections.push(current);
    }
    current = null;
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    if (!title && /^#\s+/.test(line)) {
      title = line.replace(/^#\s+/, "").trim();
      continue;
    }
    if (!subtitle && /^##\s+/.test(line) && !current) {
      subtitle = line.replace(/^##\s+/, "").trim();
      continue;
    }
    if (/^##\s+/.test(line)) {
      pushSection();
      current = { heading: line.replace(/^##\s+/, "").trim(), paragraphs: [], bullets: [] };
      continue;
    }
    if (!current) current = { heading: "", paragraphs: [], bullets: [] };
    if (/^[-•]\s+/.test(line)) current.bullets.push(line.replace(/^[-•]\s+/, "").trim());
    else current.paragraphs.push(line);
  }
  pushSection();

  const fallback = buildDocumentOutline(prompt, kind);
  return {
    title: title || fallback.title,
    subtitle: subtitle || fallback.subtitle,
    sections: sections.length ? sections : fallback.sections,
    signature: fallback.signature,
  };
}

function splitParagraphsToLines(text, font, fontSize, maxWidth) {
  const words = String(text || "").split(/\s+/).filter(Boolean);
  const lines = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    const width = font.widthOfTextAtSize(candidate, fontSize);
    if (width > maxWidth && current) {
      lines.push(current);
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
    pdf: "Escreva um texto objetivo em portugues do Brasil para um PDF profissional. Use # e ## para organizar secoes e - para bullets.",
    docx: "Escreva um documento objetivo em portugues do Brasil. Use # e ## para organizar secoes e - para bullets.",
    code: "Responda apenas com o codigo solicitado, sem cercas markdown.",
    xlsx: "Resuma em texto simples quais colunas e dados principais a planilha precisa ter.",
    audio: "Escreva um roteiro curto em portugues do Brasil para ser narrado em audio.",
  };

  const resp = await fetchWithRetry(RESPONSES_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      input: [
        { role: "system", content: [{ type: "input_text", text: instructionsByKind[targetKind] || instructionsByKind.docx }] },
        { role: "user", content: [{ type: "input_text", text: buildArtifactAuthoringPrompt(targetKind, prompt) }] },
      ],
    }),
  }, { url: RESPONSES_URL, label: "generate_responses_text" }, 1);

  if (!resp.ok) throw buildResponseError(resp, await resp.text(), RESPONSES_URL);
  const data = await resp.json();
  return stripCodeFences(data.output_text || "");
}

function buildSpreadsheetRows(prompt, draftText) {
  const text = normalizeText(prompt);
  if (/(lead|leads)/.test(text)) {
    return [
      ["Nome", "Telefone", "Curso de interesse", "Origem", "Status", "Observações"],
      ["", "", "", "", "Novo", ""],
    ];
  }
  if (/(aluno|alunos|matricula|matrícula|turma|cadastro)/.test(text)) {
    return [
      ["Nome do aluno", "Matrícula", "Turma", "Responsável", "Telefone", "E-mail", "Status", "Observações"],
      ["", "", "", "", "", "", "Ativo", ""],
    ];
  }
  if (/(financeiro|despesa|receita|pagamento|caixa)/.test(text)) {
    return [
      ["Data", "Descrição", "Categoria", "Valor", "Status", "Observações"],
      ["", "", "", "", "Pendente", ""],
    ];
  }
  const rows = [["Campo", "Valor"], ["Solicitação", String(prompt || "").trim() || "Planilha automática"]];
  for (const line of String(draftText || "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean).slice(0, 12)) rows.push([line, ""]);
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
  return { filename, fullPath, mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", reply: "Planilha gerada com sucesso." };
}

async function createPdfArtifact(prompt, draftText, outDir) {
  const outline = parseStructuredDraft(prompt, draftText, "pdf");
  const pdfDoc = await PDFDocument.create();
  let page = pdfDoc.addPage([595, 842]);
  const regular = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const margin = 46;
  const contentWidth = page.getWidth() - margin * 2;
  const palette = {
    navy: rgb(0.08, 0.17, 0.33),
    text: rgb(0.14, 0.17, 0.22),
    muted: rgb(0.42, 0.48, 0.58),
    accent: rgb(0.11, 0.43, 0.74),
    soft: rgb(0.92, 0.95, 0.98),
  };

  const drawHeader = () => {
    page.drawRectangle({ x: 0, y: page.getHeight() - 112, width: page.getWidth(), height: 112, color: palette.navy });
    page.drawText("Talkers IA • Documento Profissional", { x: margin, y: page.getHeight() - 34, size: 11, font: bold, color: rgb(1, 1, 1) });
    let yTitle = page.getHeight() - 70;
    for (const line of splitParagraphsToLines(outline.title || "Documento", bold, 19, contentWidth - 12).slice(0, 3)) {
      page.drawText(line, { x: margin, y: yTitle, size: 19, font: bold, color: rgb(1, 1, 1) });
      yTitle -= 22;
    }
  };
  const drawFooter = () => {
    page.drawLine({ start: { x: margin, y: 38 }, end: { x: page.getWidth() - margin, y: 38 }, thickness: 1, color: palette.soft });
    page.drawText("Gerado automaticamente pela Talkers IA", { x: margin, y: 24, size: 9, font: regular, color: palette.muted });
  };
  const newPage = () => {
    drawFooter();
    page = pdfDoc.addPage([595, 842]);
    drawHeader();
    return page;
  };

  drawHeader();
  let y = page.getHeight() - 142;
  const ensureSpace = (needed = 40) => {
    if (y < 60 + needed) {
      newPage();
      y = page.getHeight() - 142;
    }
  };

  if (outline.subtitle) {
    for (const line of splitParagraphsToLines(outline.subtitle, regular, 11, contentWidth)) {
      page.drawText(line, { x: margin, y, size: 11, font: regular, color: palette.muted });
      y -= 15;
    }
    y -= 8;
  }

  for (const section of outline.sections || []) {
    ensureSpace(56);
    if (section.heading) {
      page.drawText(section.heading, { x: margin, y, size: 14, font: bold, color: palette.navy });
      y -= 20;
    }
    for (const paragraph of section.paragraphs || []) {
      for (const line of splitParagraphsToLines(paragraph, regular, 11.5, contentWidth)) {
        ensureSpace(18);
        page.drawText(line, { x: margin, y, size: 11.5, font: regular, color: palette.text });
        y -= 16;
      }
      y -= 6;
    }
    for (const bullet of section.bullets || []) {
      let first = true;
      for (const line of splitParagraphsToLines(bullet, regular, 11.5, contentWidth - 18)) {
        ensureSpace(18);
        if (first) {
          page.drawCircle({ x: margin + 4, y: y + 5, size: 2.2, color: palette.accent });
          first = false;
        }
        page.drawText(line, { x: margin + 14, y, size: 11.5, font: regular, color: palette.text });
        y -= 16;
      }
      y -= 4;
    }
    y -= 8;
  }

  if (outline.signature) {
    ensureSpace(42);
    page.drawLine({ start: { x: margin, y: y + 10 }, end: { x: margin + 150, y: y + 10 }, thickness: 1, color: palette.soft });
    y -= 8;
    for (const line of String(outline.signature).split(/\n/)) {
      page.drawText(line, { x: margin, y, size: 11, font: regular, color: palette.text });
      y -= 15;
    }
  }

  drawFooter();
  const filename = makeArtifactFilename(prompt, ".pdf");
  const fullPath = path.join(outDir, filename);
  fs.writeFileSync(fullPath, await pdfDoc.save());
  return { filename, fullPath, mimeType: "application/pdf", reply: "PDF gerado com sucesso." };
}

async function createDocxArtifact(prompt, draftText, outDir) {
  const zip = new JSZip();
  const filename = makeArtifactFilename(prompt, ".docx");
  const fullPath = path.join(outDir, filename);
  const outline = parseStructuredDraft(prompt, draftText, "docx");
  const xmlParagraphs = [];
  xmlParagraphs.push(`<w:p><w:r><w:rPr><w:b/><w:sz w:val="32"/></w:rPr><w:t>${xmlEscape(outline.title || "Documento")}</w:t></w:r></w:p>`);
  if (outline.subtitle) xmlParagraphs.push(`<w:p><w:r><w:rPr><w:color w:val="6B7280"/></w:rPr><w:t>${xmlEscape(outline.subtitle)}</w:t></w:r></w:p>`);
  for (const section of outline.sections || []) {
    if (section.heading) xmlParagraphs.push(`<w:p><w:r><w:rPr><w:b/><w:sz w:val="26"/></w:rPr><w:t>${xmlEscape(section.heading)}</w:t></w:r></w:p>`);
    for (const paragraph of section.paragraphs || []) xmlParagraphs.push(`<w:p><w:r><w:t xml:space="preserve">${xmlEscape(paragraph)}</w:t></w:r></w:p>`);
    for (const bullet of section.bullets || []) xmlParagraphs.push(`<w:p><w:r><w:t xml:space="preserve">• ${xmlEscape(bullet)}</w:t></w:r></w:p>`);
  }
  if (outline.signature) for (const line of String(outline.signature).split(/\n/)) xmlParagraphs.push(`<w:p><w:r><w:t>${xmlEscape(line)}</w:t></w:r></w:p>`);

  zip.file("[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`);
  zip.folder("_rels").file(".rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`);
  zip.folder("word").file("document.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    ${xmlParagraphs.join("\n    ")}
    <w:sectPr>
      <w:pgSz w:w="11906" w:h="16838"/>
      <w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/>
    </w:sectPr>
  </w:body>
</w:document>`);
  fs.writeFileSync(fullPath, await zip.generateAsync({ type: "nodebuffer" }));
  return { filename, fullPath, mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", reply: "Documento DOCX gerado com sucesso." };
}

async function createCodeArtifact(prompt, draftText, outDir) {
  const ext = guessCodeExtension(prompt);
  const filename = makeArtifactFilename(prompt, ext);
  const fullPath = path.join(outDir, filename);
  const code = stripCodeFences(draftText) || String(prompt || "").trim() || "// Arquivo gerado automaticamente";
  fs.writeFileSync(fullPath, `${code}\n`, "utf8");
  const mimeByExt = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".ts": "text/plain", ".py": "text/x-python", ".sql": "application/sql", ".json": "application/json", ".txt": "text/plain" };
  return { filename, fullPath, mimeType: mimeByExt[ext] || "text/plain", reply: `Arquivo ${ext.replace('.', '').toUpperCase()} gerado com sucesso.` };
}

function guessImageMimeType(filePath, mimeType = "") {
  const mime = String(mimeType || "").toLowerCase();
  if (mime.startsWith("image/")) return mime;
  const ext = path.extname(String(filePath || "")).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".webp") return "image/webp";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  return "application/octet-stream";
}

function getEligibleReferenceImages(referenceImages = []) {
  return (referenceImages || []).filter((item) => {
    if (!item?.fullPath || !fs.existsSync(item.fullPath)) return false;
    const ext = path.extname(String(item.originalName || item.fullPath || "")).toLowerCase();
    if (![".png", ".webp", ".jpg", ".jpeg"].includes(ext)) return false;
    const sizeBytes = Number(item.sizeBytes || fs.statSync(item.fullPath).size || 0);
    return sizeBytes > 0 && sizeBytes <= MAX_IMAGE_EDIT_BYTES;
  });
}

function saveBase64ImageArtifact(prompt, outDir, imageBase64, reply) {
  const filename = makeArtifactFilename(prompt, ".png");
  const fullPath = path.join(outDir, filename);
  fs.writeFileSync(fullPath, Buffer.from(imageBase64, "base64"));
  return { kind: "file", filename, fullPath, mimeType: "image/png", reply };
}

function detectImageLayout(prompt = "") {
  const text = normalizeText(prompt);
  if (/(story|stories|reels|status|vertical|9:16|1080x1920|poster vertical)/.test(text)) return { size: "1024x1536", label: "vertical", safeArea: "central 78% da composição" };
  if (/(banner|horizontal|header|hero|capa horizontal|landscape|16:9|linkedin cover|youtube)/.test(text)) return { size: "1536x1024", label: "horizontal", safeArea: "central 80% da composição" };
  return { size: "1024x1024", label: "quadrado", safeArea: "central 82% da composição" };
}

function buildSafeImagePrompt(prompt, mode = "generate") {
  const layout = detectImageLayout(prompt);
  const modeRule = mode === "edit" ? "Preserve integralmente o conteúdo importante da imagem original e evite crop agressivo." : "Crie uma composição equilibrada, limpa, profissional e pronta para uso real.";
  return [
    String(prompt || "").trim(),
    "",
    "Regras obrigatórias de composição:",
    `- Formato solicitado: ${layout.label} (${layout.size}).`,
    `- Mantenha todos os elementos críticos dentro da ${layout.safeArea}.`,
    "- Nunca corte, trunque ou empurre títulos, CTA, logotipos, rostos ou objetos principais para fora da área visível.",
    "- Garanta margens de segurança generosas nas quatro bordas.",
    "- Priorize legibilidade, enquadramento seguro e composição pronta para publicação.",
    "- Evite excesso de texto embutido na imagem; foque em impacto visual e clareza.",
    modeRule,
  ].join("\n");
}

function extractJsonObject(text = "") {
  const safe = String(text || "").trim();
  if (!safe) return null;
  try { return JSON.parse(safe); } catch {}
  const match = safe.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try { return JSON.parse(match[0]); } catch { return null; }
}

async function validateGeneratedImage(apiKey, prompt, imageBase64, mimeType = "image/png") {
  if (!apiKey || !imageBase64) return { safe: true, issues: [] };
  const resp = await fetchWithRetry(RESPONSES_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: IMAGE_VALIDATION_MODEL,
      input: [
        { role: "system", content: [{ type: "input_text", text: ["Analise a composição final da imagem e responda APENAS em JSON.", '{"safe":true|false,"issues":["..."],"retry_prompt_suffix":"..."}', "Marque safe=false se houver risco de texto cortado, logo fora da área útil, elemento principal perto demais da borda ou composição desequilibrada."].join("\n") }] },
        { role: "user", content: [{ type: "input_text", text: `Pedido original:\n${prompt}` }, { type: "input_image", image_url: `data:${mimeType};base64,${imageBase64}` }] },
      ],
    }),
  }, { url: RESPONSES_URL, label: "generate_validate_image" }, 1);
  if (!resp.ok) throw buildResponseError(resp, await resp.text(), RESPONSES_URL);
  const data = await resp.json();
  const parsed = extractJsonObject(data.output_text || "");
  return { safe: parsed?.safe !== false, issues: Array.isArray(parsed?.issues) ? parsed.issues : [], retryPromptSuffix: String(parsed?.retry_prompt_suffix || "").trim() };
}

async function requestGeneratedImageBase64(apiKey, prompt, size) {
  const model = process.env.OPENAI_IMAGE_MODEL || "gpt-image-1";
  const resp = await fetchWithRetry(IMAGES_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model, prompt, size, quality: "high", output_format: "png" }),
  }, { url: IMAGES_URL, label: "generate_image" }, 2);
  if (!resp.ok) throw buildResponseError(resp, await resp.text(), IMAGES_URL);
  const data = await resp.json();
  const imageBase64 = data?.data?.[0]?.b64_json;
  if (!imageBase64) throw new Error("A OpenAI não retornou a imagem gerada.");
  return imageBase64;
}

async function requestEditedImageBase64(apiKey, prompt, size, referenceImages = []) {
  const model = process.env.OPENAI_IMAGE_MODEL || "gpt-image-1";
  const form = new FormData();
  form.append("model", model);
  form.append("prompt", prompt);
  form.append("size", size);
  form.append("input_fidelity", "high");
  for (const reference of referenceImages.slice(0, 1)) {
    const imageBuffer = fs.readFileSync(reference.fullPath);
    const imageBlob = new Blob([imageBuffer], { type: guessImageMimeType(reference.fullPath, reference.mimeType) });
    form.append("image", imageBlob, path.basename(reference.originalName || reference.fullPath));
  }
  const resp = await fetchWithRetry(IMAGE_EDITS_URL, { method: "POST", headers: { Authorization: `Bearer ${apiKey}` }, body: form }, { url: IMAGE_EDITS_URL, label: "generate_image_edit" }, 2);
  if (!resp.ok) throw buildResponseError(resp, await resp.text(), IMAGE_EDITS_URL);
  const data = await resp.json();
  const imageBase64 = data?.data?.[0]?.b64_json;
  if (!imageBase64) throw new Error("A OpenAI não retornou a imagem editada.");
  return imageBase64;
}

async function generateSafeImageArtifact({ apiKey, prompt, outDir, referenceImages = [], mode = "generate" }) {
  const layout = detectImageLayout(prompt);
  const safePrompt = buildSafeImagePrompt(prompt, mode);
  const retrySuffix = "Refaça a composição com margens ainda maiores, preservando integralmente todos os elementos principais dentro da área segura.";
  let lastImageBase64 = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const promptToUse = attempt === 0 ? safePrompt : `${safePrompt}\n\n${retrySuffix}`;
    lastImageBase64 = mode === "edit"
      ? await requestEditedImageBase64(apiKey, promptToUse, layout.size, referenceImages)
      : await requestGeneratedImageBase64(apiKey, promptToUse, layout.size);
    try {
      const validation = await validateGeneratedImage(apiKey, promptToUse, lastImageBase64);
      if (validation.safe) return saveBase64ImageArtifact(prompt, outDir, lastImageBase64, mode === "edit" ? "Imagem editada com sucesso." : "Imagem gerada com sucesso.");
      if (validation.retryPromptSuffix) {
        lastImageBase64 = mode === "edit"
          ? await requestEditedImageBase64(apiKey, `${safePrompt}\n\n${validation.retryPromptSuffix}`, layout.size, referenceImages)
          : await requestGeneratedImageBase64(apiKey, `${safePrompt}\n\n${validation.retryPromptSuffix}`, layout.size);
        return saveBase64ImageArtifact(prompt, outDir, lastImageBase64, mode === "edit" ? "Imagem editada com sucesso." : "Imagem gerada com sucesso.");
      }
    } catch {
      return saveBase64ImageArtifact(prompt, outDir, lastImageBase64, mode === "edit" ? "Imagem editada com sucesso." : "Imagem gerada com sucesso.");
    }
  }
  if (!lastImageBase64) throw new Error("A geração de imagem não concluiu nesta tentativa.");
  return saveBase64ImageArtifact(prompt, outDir, lastImageBase64, mode === "edit" ? "Imagem editada com sucesso." : "Imagem gerada com sucesso.");
}

async function createImageArtifact(apiKey, prompt, outDir, referenceImages = []) {
  if (!apiKey) throw new Error("OPENAI_API_KEY ausente para gerar imagem.");
  if (isImageEditPrompt(normalizeText(prompt), referenceImages.length > 0)) {
    const eligibleImages = getEligibleReferenceImages(referenceImages);
    if (!eligibleImages.length) return { kind: "message", reply: "Envie ou mantenha na conversa uma imagem PNG, JPG ou WEBP de até 50 MB para que eu possa editar para você." };
    return generateSafeImageArtifact({ apiKey, prompt, outDir, referenceImages: eligibleImages, mode: "edit" });
  }
  return generateSafeImageArtifact({ apiKey, prompt, outDir, mode: "generate" });
}

async function createAudioArtifact(apiKey, prompt, draftText, outDir) {
  const speechText = draftText || String(prompt || "").trim();
  return createSpeechArtifact({ text: speechText, prompt, outDir, apiKey });
}

async function generateArtifact({ prompt, outDir, apiKey = process.env.OPENAI_API_KEY || "", referenceImages = [], preferredKind = null }) {
  const artifactKind = preferredKind || detectArtifactKind(prompt, { referenceImages });
  if (!artifactKind) return null;
  fs.mkdirSync(outDir, { recursive: true });
  if (artifactKind === "image" || artifactKind === "image_edit") return createImageArtifact(apiKey, prompt, outDir, referenceImages);

  let draftText = "";
  try { draftText = await callResponsesText(apiKey, prompt, artifactKind); } catch { draftText = ""; }
  if (artifactKind === "xlsx") return createSpreadsheetArtifact(prompt, draftText, outDir);
  if (artifactKind === "pdf") return createPdfArtifact(prompt, draftText, outDir);
  if (artifactKind === "docx") return createDocxArtifact(prompt, draftText, outDir);
  if (artifactKind === "code") return createCodeArtifact(prompt, draftText, outDir);
  if (artifactKind === "audio") return createAudioArtifact(apiKey, prompt, draftText, outDir);
  return null;
}

module.exports = { generateArtifact, detectArtifactKind };
