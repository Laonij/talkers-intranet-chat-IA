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
const OPENAI_GENERATE_TIMEOUT_MS = Math.max(5000, Number(process.env.OPENAI_GENERATE_TIMEOUT_MS || 30000));

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

async function fetchWithRetry(url, options = {}, diagnostics = {}, retryCount = 1) {
  let lastError = null;
  for (let attempt = 0; attempt <= retryCount; attempt += 1) {
    try {
      return await fetch(url, {
        ...options,
        signal: options.signal || AbortSignal.timeout(OPENAI_GENERATE_TIMEOUT_MS),
      });
    } catch (err) {
      lastError = err;
      const details = buildFetchErrorDetails(err, {
        attempt: attempt + 1,
        ...diagnostics,
      });
      if (attempt < retryCount) {
        console.warn("Falha em geração externa; tentando novamente.", details);
        continue;
      }
      throw Object.assign(err instanceof Error ? err : new Error(String(err || "fetch_failed")), {
        diagnostics: details,
      });
    }
  }
  throw lastError || new Error("fetch_failed");
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

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function isImageEditPrompt(text, hasReferenceImages = false) {
  const hasEditVerb = /(editar|edite|ajustar|ajuste|corrigir|corrija|melhorar|melhore|alinhar|alinhe|reposicionar|reposicione|mudar|mude|trocar|troque|alterar|altere|remover|remova|apagar|apague|recortar|recorte|redimensionar|clarear|escurecer|centralizar|desfocar|limpar|substituir|reescrever|retocar)/.test(text);
  if (!hasEditVerb) return false;

  const hasDocumentCue = /(pdf|docx|documento|word|planilha|xlsx|excel|contrato|comunicado|relatorio|relatorio|slide|ppt|powerpoint)/.test(text);
  if (hasDocumentCue) return false;

  const hasDirectImageCue = /(imagem|foto|arte|banner|cartaz|poster|capa|logo|print|layout|design|anexo|mockup)/.test(text);
  const hasVisualCue = /(texto|fonte|fundo|cor|alinhamento|alinhado|margem|borda|recorte|nitidez|brilho|contraste|resolucao|sombra|elemento|posicao|posição)/.test(text);

  return hasDirectImageCue || (hasReferenceImages && hasVisualCue);
}

function isMetaCapabilityQuestion(text = "") {
  return /(por que|porque|como|voce consegue|você consegue|voce pode|você pode|e possivel|é possível|tem como|da para|dá para|consegue)\s+.*(gerar|criar|fazer).*(imagem|pdf|documento|planilha|audio|áudio)/.test(text);
}

function detectArtifactKind(prompt, options = {}) {
  const text = normalizeText(prompt);
  const referenceImages = Array.isArray(options.referenceImages) ? options.referenceImages : [];
  const wantsImageEdit = isImageEditPrompt(text, referenceImages.length > 0);

  if (wantsImageEdit) {
    return "image_edit";
  }

  if (isMetaCapabilityQuestion(text)) return null;

  const imageVerb = /(gere|gera|gerar|crie|criar|fa[cz]a|fazer|produza|produzir|monte|montar|desenvolva|desenvolver|renderize|renderizar)/.test(text);
  const imageNoun = /(imagem|foto|ilustracao|logo|banner|cartaz|poster|capa|arte|mockup|criativo|thumb|thumbnail|anuncio|anúncio|campanha visual)/.test(text);
  if (imageNoun && (imageVerb || /(para baixar|pronta para baixar|social media|marketing|instagram|story|stories|post|feed)/.test(text))) {
    return "image";
  }

  if (/(audio|audios|voz|locucao|narracao|narração|locução|mp3|podcast)/.test(text) && imageVerb) {
    return "audio";
  }

  if (/(planilha|excel|xlsx|tabela)/.test(text) && imageVerb) return "xlsx";
  if (/(pdf|relatorio em pdf|comunicado em pdf)/.test(text) && imageVerb) return "pdf";
  if (/(docx|word|documento)/.test(text) && imageVerb) return "docx";
  if (/(codigo|script|javascript|node|html|css|sql|json|typescript|python)/.test(text) && imageVerb) {
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

function buildArtifactContentPrompt(prompt, targetKind) {
  const base = String(prompt || "").trim();
  if (!base) return "";

  if (targetKind === "pdf" || targetKind === "docx") {
    return [
      "Transforme o pedido do usuario em um documento final, pronto para uso, em portugues do Brasil.",
      "Nao descreva o que vai fazer. Nao explique. Entregue o conteudo final do documento.",
      "Se faltar algum dado objetivo, preencha com placeholders elegantes e claramente editaveis, sem repetir o pedido original.",
      "Use estrutura profissional com titulo, abertura, corpo e fechamento quando fizer sentido.",
      "Pedido do usuario:",
      base,
    ].join("\n");
  }

  if (targetKind === "xlsx") {
    return [
      "Identifique as colunas ideais e alguns exemplos de linhas para a planilha pedida.",
      "Responda em texto simples, objetivo e util.",
      "Pedido do usuario:",
      base,
    ].join("\n");
  }

  if (targetKind === "audio") {
    return [
      "Transforme o pedido em um roteiro final de locucao, curto e natural, em portugues do Brasil.",
      "Pedido do usuario:",
      base,
    ].join("\n");
  }

  return base;
}

function looksLikeEcho(prompt = "", draftText = "") {
  const p = normalizeText(prompt).replace(/\s+/g, " ").trim();
  const d = normalizeText(draftText).replace(/\s+/g, " ").trim();
  if (!d) return true;
  if (d === p) return true;
  if (p && d.includes(p) && d.length <= p.length + 40) return true;
  return d.length < Math.max(80, Math.min(140, p.length + 20));
}

function buildDocumentFallback(prompt = "", targetKind = "docx") {
  const text = String(prompt || "").trim();
  const normalized = normalizeText(text);
  const heading = targetKind === "pdf" ? "Comunicado" : "Documento";

  if (/(comunicado|aviso|informativo)/.test(normalized) && /(sorteio|pascoa|páscoa)/.test(normalized)) {
    return [
      `${heading}: Sorteio de Pascoa`,
      "",
      "Prezados alunos, responsaveis e equipe,",
      "",
      "Temos uma novidade especial para este fim de semana: realizaremos um Sorteio de Pascoa para celebrar este periodo com mais alegria e integracao.",
      "",
      "Detalhes do evento:",
      "- Data: [informar data]",
      "- Horario: [informar horario]",
      "- Local: [informar local]",
      "",
      "Participacao:",
      "- Todos os participantes devem seguir as orientacoes divulgadas pela escola.",
      "- Caso exista alguma dinamica especifica, ela pode ser informada aqui.",
      "",
      "Esperamos voce para participar conosco desse momento especial.",
      "",
      "Atenciosamente,",
      "Equipe Talkers",
    ].join("\n");
  }

  if (/(proposta comercial|proposta)/.test(normalized)) {
    return [
      "Proposta Comercial",
      "",
      "Prezado(a),",
      "",
      "Apresentamos a seguir nossa proposta comercial, elaborada de acordo com a sua necessidade.",
      "",
      "Objetivo:",
      "- [descrever objetivo]",
      "",
      "Escopo:",
      "- [descrever escopo]",
      "",
      "Investimento:",
      "- [informar valores]",
      "",
      "Prazo e condicoes:",
      "- [informar prazos e condicoes]",
      "",
      "Ficamos a disposicao para ajustes e esclarecimentos.",
    ].join("\n");
  }

  return [
    heading,
    "",
    "Conteudo gerado automaticamente a partir da solicitacao abaixo:",
    "",
    text || "Solicitacao sem descricao.",
    "",
    "Edite os campos conforme necessario antes do envio final.",
  ].join("\n");
}


async function callResponsesText(apiKey, prompt, targetKind) {
  if (!apiKey) return "";

  const model = process.env.OPENAI_ARTIFACT_MODEL || process.env.OPENAI_MODEL || "gpt-4.1-mini";
  const instructionsByKind = {
    pdf: "Escreva o conteudo FINAL de um PDF em portugues do Brasil. Nao use markdown. Nao descreva o processo. Nao repita literalmente o pedido do usuario.",
    docx: "Escreva o conteudo FINAL de um documento em portugues do Brasil. Nao use markdown. Nao descreva o processo. Nao repita literalmente o pedido do usuario.",
    code: "Responda apenas com o codigo solicitado, sem cercas markdown.",
    xlsx: "Resuma em texto simples quais colunas e exemplos principais a planilha precisa ter.",
    audio: "Escreva um roteiro curto em portugues do Brasil para ser narrado em audio. Nao use markdown.",
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
        {
          role: "system",
          content: [{ type: "input_text", text: instructionsByKind[targetKind] || instructionsByKind.docx }],
        },
        {
          role: "user",
          content: [{ type: "input_text", text: buildArtifactContentPrompt(prompt, targetKind) }],
        },
      ],
    }),
  }, {
    url: RESPONSES_URL,
    label: "generate_responses_text",
  });

  if (!resp.ok) {
    throw buildResponseError(resp, await resp.text(), RESPONSES_URL);
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
  const body = (!looksLikeEcho(prompt, draftText) ? draftText : buildDocumentFallback(prompt, "pdf")) || String(prompt || "").trim() || "Documento gerado automaticamente.";
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
  const bodyText = (!looksLikeEcho(prompt, draftText) ? draftText : buildDocumentFallback(prompt, "docx")) || String(prompt || "").trim() || "Documento gerado automaticamente.";

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

  return {
    kind: "file",
    filename,
    fullPath,
    mimeType: "image/png",
    reply,
  };
}

function detectImageLayout(prompt = "") {
  const text = normalizeText(prompt);
  if (/(story|stories|reels|status|vertical|9:16|1080x1920|flyer vertical|poster vertical)/.test(text)) {
    return { size: "1024x1536", label: "vertical", safeArea: "central 78% da composicao" };
  }
  if (/(banner|horizontal|header|hero|capa horizontal|landscape|16:9|linkedin cover|youtube)/.test(text)) {
    return { size: "1536x1024", label: "horizontal", safeArea: "central 80% da composicao" };
  }
  return { size: "1024x1024", label: "quadrado", safeArea: "central 82% da composicao" };
}

function buildSafeImagePrompt(prompt, mode = "generate") {
  const layout = detectImageLayout(prompt);
  const modeRule = mode === "edit"
    ? "Preserve integralmente todo o conteudo importante da imagem original e evite crop agressivo."
    : "Crie uma composicao equilibrada e pronta para uso real.";

  return [
    String(prompt || "").trim(),
    "",
    "Regras obrigatorias de composicao:",
    `- Formato solicitado: ${layout.label} (${layout.size}).`,
    `- Mantenha todos os elementos criticos dentro da ${layout.safeArea}.`,
    "- Nunca corte, trunque ou empurre titulos, subtitulos, CTA, logotipos ou textos para fora da area visivel.",
    "- Garanta margens de seguranca generosas nas quatro bordas.",
    "- Se houver rostos, pessoas, objetos principais ou produto, tudo deve ficar completamente visivel.",
    "- Priorize legibilidade, enquadramento seguro e composicao pronta para publicacao da escola.",
    modeRule,
  ].join("\n");
}

function extractJsonObject(text = "") {
  const safe = String(text || "").trim();
  if (!safe) return null;
  try {
    return JSON.parse(safe);
  } catch {}

  const match = safe.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]);
  } catch {
    return null;
  }
}

async function validateGeneratedImage(apiKey, prompt, imageBase64, mimeType = "image/png") {
  if (!apiKey || !imageBase64) {
    return { safe: true, issues: [] };
  }

  const resp = await fetchWithRetry(RESPONSES_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: IMAGE_VALIDATION_MODEL,
      input: [
        {
          role: "system",
          content: [
            {
              type: "input_text",
              text: [
                "Analise a composicao final da imagem e responda APENAS em JSON.",
                'Formato exato: {"safe":true|false,"issues":["..."],"retry_prompt_suffix":"..."}',
                "Marque safe=false se houver risco de texto cortado, CTA truncado, logo fora da area util, elemento principal perto demais da borda ou composicao desequilibrada.",
              ].join("\n"),
            },
          ],
        },
        {
          role: "user",
          content: [
            { type: "input_text", text: `Pedido original:\n${prompt}` },
            { type: "input_image", image_url: `data:${mimeType};base64,${imageBase64}` },
          ],
        },
      ],
    }),
  }, {
    url: RESPONSES_URL,
    label: "generate_validate_image",
  });

  if (!resp.ok) {
    throw buildResponseError(resp, await resp.text(), RESPONSES_URL);
  }

  const data = await resp.json();
  const parsed = extractJsonObject(data.output_text || "");
  return {
    safe: parsed?.safe !== false,
    issues: Array.isArray(parsed?.issues) ? parsed.issues : [],
    retryPromptSuffix: String(parsed?.retry_prompt_suffix || "").trim(),
  };
}

async function requestGeneratedImageBase64(apiKey, prompt, size) {
  const model = process.env.OPENAI_IMAGE_MODEL || "gpt-image-1";
  const resp = await fetchWithRetry(IMAGES_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      prompt,
      size,
    }),
  }, {
    url: IMAGES_URL,
    label: "generate_image",
  });

  if (!resp.ok) {
    throw buildResponseError(resp, await resp.text(), IMAGES_URL);
  }

  const data = await resp.json();
  const imageBase64 = data?.data?.[0]?.b64_json;
  if (!imageBase64) {
    throw new Error("A OpenAI nao retornou a imagem gerada.");
  }
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

  const resp = await fetchWithRetry(IMAGE_EDITS_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    body: form,
  }, {
    url: IMAGE_EDITS_URL,
    label: "generate_image_edit",
  });

  if (!resp.ok) {
    throw buildResponseError(resp, await resp.text(), IMAGE_EDITS_URL);
  }

  const data = await resp.json();
  const imageBase64 = data?.data?.[0]?.b64_json;
  if (!imageBase64) {
    throw new Error("A OpenAI nao retornou a imagem editada.");
  }
  return imageBase64;
}

async function generateSafeImageArtifact({ apiKey, prompt, outDir, referenceImages = [], mode = "generate" }) {
  const layout = detectImageLayout(prompt);
  const safePrompt = buildSafeImagePrompt(prompt, mode);
  const retrySuffix = "Refaca a composicao com margens ainda maiores, preservando totalmente titulo, subtitulo, CTA, logo, rostos, produto e elementos importantes dentro da area segura.";
  let lastImageBase64 = null;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const promptToUse = attempt === 0 ? safePrompt : `${safePrompt}\n\n${retrySuffix}`;
    lastImageBase64 = mode === "edit"
      ? await requestEditedImageBase64(apiKey, promptToUse, layout.size, referenceImages)
      : await requestGeneratedImageBase64(apiKey, promptToUse, layout.size);

    try {
      const validation = await validateGeneratedImage(apiKey, promptToUse, lastImageBase64);
      if (validation.safe) {
        return saveBase64ImageArtifact(prompt, outDir, lastImageBase64, mode === "edit" ? "Imagem editada com sucesso." : "Imagem gerada com sucesso.");
      }
      if (attempt === 0 && validation.retryPromptSuffix) {
        lastImageBase64 = mode === "edit"
          ? await requestEditedImageBase64(apiKey, `${safePrompt}\n\n${validation.retryPromptSuffix}`, layout.size, referenceImages)
          : await requestGeneratedImageBase64(apiKey, `${safePrompt}\n\n${validation.retryPromptSuffix}`, layout.size);
        return saveBase64ImageArtifact(prompt, outDir, lastImageBase64, mode === "edit" ? "Imagem editada com sucesso." : "Imagem gerada com sucesso.");
      }
    } catch {
      return saveBase64ImageArtifact(prompt, outDir, lastImageBase64, mode === "edit" ? "Imagem editada com sucesso." : "Imagem gerada com sucesso.");
    }
  }

  return saveBase64ImageArtifact(prompt, outDir, lastImageBase64, mode === "edit" ? "Imagem editada com sucesso." : "Imagem gerada com sucesso.");
}

async function createImageGenerationArtifact(apiKey, prompt, outDir) {
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY ausente para gerar imagem.");
  }
  return generateSafeImageArtifact({ apiKey, prompt, outDir, mode: "generate" });
}

async function createImageEditArtifact(apiKey, prompt, outDir, referenceImages = []) {
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY ausente para editar imagem.");
  }

  const eligibleImages = getEligibleReferenceImages(referenceImages);
  if (!eligibleImages.length) {
    return {
      kind: "message",
      reply: "Envie ou mantenha na conversa uma imagem PNG, JPG ou WEBP de ate 50 MB para que eu possa editar, ajustar ou corrigir para voce.",
    };
  }
  return generateSafeImageArtifact({ apiKey, prompt, outDir, referenceImages: eligibleImages, mode: "edit" });
}

async function createImageArtifact(apiKey, prompt, outDir, referenceImages = []) {
  const text = normalizeText(prompt);
  if (isImageEditPrompt(text, referenceImages.length > 0)) {
    return createImageEditArtifact(apiKey, prompt, outDir, referenceImages);
  }

  return createImageGenerationArtifact(apiKey, prompt, outDir);
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

async function generateArtifact({
  prompt,
  outDir,
  apiKey = process.env.OPENAI_API_KEY || "",
  referenceImages = [],
}) {
  const artifactKind = detectArtifactKind(prompt, { referenceImages });
  if (!artifactKind) return null;

  fs.mkdirSync(outDir, { recursive: true });

  if (artifactKind === "image" || artifactKind === "image_edit") {
    return createImageArtifact(apiKey, prompt, outDir, referenceImages);
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
module.exports = { generateArtifact, detectArtifactKind };




