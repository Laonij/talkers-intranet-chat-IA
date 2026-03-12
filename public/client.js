const el = (id) => document.getElementById(id);

const QUICK_PROMPTS = [
  {
    icon: "document",
    label: "Gerar documento",
    hint: "Crie comunicados, contratos e textos organizados.",
    prompt: "Gere um documento profissional sobre este tema:",
  },
  {
    icon: "spreadsheet",
    label: "Criar planilha",
    hint: "Monte tabelas com colunas prontas para uso.",
    prompt: "Crie uma planilha organizada com os principais campos para:",
  },
  {
    icon: "audio",
    label: "Transcrever audio",
    hint: "Analise audio enviado ou gravado no navegador.",
    prompt: "Analise e transcreva o audio enviado, depois faca um resumo objetivo.",
  },
  {
    icon: "image",
    label: "Gerar imagem",
    hint: "Produza imagens para escola, marketing e materiais.",
    prompt: "Gere uma imagem realista e profissional de:",
  },
  {
    icon: "graduation",
    label: "Comunicado escolar",
    hint: "Crie avisos claros e acolhedores para alunos e familias.",
    prompt: "Crie um comunicado escolar claro e acolhedor sobre:",
  },
  {
    icon: "brain",
    label: "Consultar base interna",
    hint: "Pesquise documentos e conhecimento da empresa.",
    prompt: "Consulte a base interna e me responda sobre:",
  },
];

function renderIconSvg(iconName) {
  const icons = {
    document: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z"/><path d="M14 3v5h5"/><path d="M9 13h6"/><path d="M9 17h4"/></svg>',
    spreadsheet: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z"/><path d="M14 3v5h5"/><path d="M8 13h8"/><path d="M8 17h8"/><path d="M12 10v10"/></svg>',
    audio: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15a3 3 0 0 0 3-3V7a3 3 0 1 0-6 0v5a3 3 0 0 0 3 3Z"/><path d="M19 11a7 7 0 0 1-14 0"/><path d="M12 18v3"/></svg>',
    image: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m8 13 2.5-2.5a1 1 0 0 1 1.4 0L16 15"/><path d="m14 13 1.5-1.5a1 1 0 0 1 1.4 0L20 14.6"/><circle cx="8.5" cy="9" r="1.2"/></svg>',
    graduation: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m3 9 9-4 9 4-9 4-9-4Z"/><path d="M7 10.8v3.7c0 .7 2.2 2.5 5 2.5s5-1.8 5-2.5v-3.7"/><path d="M21 10v4"/></svg>',
    brain: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9.5 4a3.5 3.5 0 0 0-3.5 3.5V8a3 3 0 0 0-2 2.8A3 3 0 0 0 6 13.6V15a3 3 0 0 0 3 3h1"/><path d="M14.5 4A3.5 3.5 0 0 1 18 7.5V8a3 3 0 0 1 2 2.8 3 3 0 0 1-2 2.8V15a3 3 0 0 1-3 3h-1"/><path d="M12 4v16"/><path d="M9 10h3"/><path d="M12 14h3"/></svg>',
    chat: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 17 3 21V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H7Z"/></svg>',
    money: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="6" width="18" height="12" rx="2"/><path d="M7 12h.01"/><path d="M17 12h.01"/><path d="M12 9.5c-1.2 0-2 .7-2 1.5s.8 1.5 2 1.5 2 .7 2 1.5-.8 1.5-2 1.5"/><path d="M12 8v8"/></svg>',
    code: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 18-6-6 6-6"/><path d="m15 6 6 6-6 6"/></svg>',
    pdf: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z"/><path d="M14 3v5h5"/><path d="M8 15h8"/><path d="M8 11h5"/></svg>',
    presentation: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16v10H4z"/><path d="M12 15v4"/><path d="M9 19h6"/><path d="m8 11 2.5-3 2.2 2.5 1.8-1.7L17 11"/></svg>',
    attachment: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 12.5 14.3 6.2a3 3 0 1 1 4.2 4.2l-8.4 8.4a5 5 0 0 1-7.1-7.1l8.7-8.7"/></svg>',
    copy: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2"/><rect x="4" y="4" width="11" height="11" rx="2"/></svg>',
    check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 13 4 4L19 7"/></svg>',
  };

  return icons[iconName] || icons.chat;
}

let me = null;
let conversations = [];
let currentConvId = null;
let mediaRecorder = null;
let recordingStream = null;
let recordingChunks = [];
let pendingComposerFiles = [];
let isSendingMessage = false;

const MAX_COMPOSER_FILE_BYTES = 25 * 1024 * 1024;

async function api(path, opts = {}) {
  const res = await fetch(path, {
    credentials: "include",
    headers:
      opts.body instanceof FormData
        ? undefined
        : { "Content-Type": "application/json", ...(opts.headers || {}) },
    ...opts,
  });

  const txt = await res.text();
  let data = null;

  try {
    data = txt ? JSON.parse(txt) : null;
  } catch {
    data = txt;
  }

  if (!res.ok) {
    const msg = data?.error || `HTTP ${res.status}`;
    throw new Error(msg);
  }

  return data;
}

function formatDate(iso) {
  try {
    return new Date(iso).toLocaleDateString("pt-BR");
  } catch {
    return "";
  }
}

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function getUserInitial(name = "") {
  return String(name || "T").trim().charAt(0).toUpperCase() || "T";
}

function getConversationEmoji(title) {
  const text = normalizeText(title);
  if (!text) return "chat";
  if (/(planilha|tabela|excel|dados|cadastro)/.test(text)) return "spreadsheet";
  if (/(pdf|doc|docx|documento|contrato|comunicado|texto)/.test(text)) return "document";
  if (/(imagem|foto|banner|arte|logo)/.test(text)) return "image";
  if (/(audio|voz|locucao|narracao|transcri|gravacao)/.test(text)) return "audio";
  if (/(aluno|escola|turma|matricula|pedagogico)/.test(text)) return "graduation";
  if (/(financeiro|orcamento|boleto|pagamento)/.test(text)) return "money";
  if (/(site|codigo|api|script|sistema)/.test(text)) return "code";
  return "chat";
}

function getFileEmoji(meta) {
  const mime = String(meta?.mimetype || "").toLowerCase();
  const name = normalizeText(meta?.filename || "");
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("audio/")) return "audio";
  if (mime.includes("pdf") || name.endsWith(".pdf")) return "pdf";
  if (mime.includes("spreadsheet") || /\.xlsx?$/.test(name)) return "spreadsheet";
  if (mime.includes("wordprocessing") || /\.docx?$/.test(name)) return "document";
  if (mime.includes("presentation") || /\.pptx?$/.test(name)) return "presentation";
  if (mime.includes("json") || mime.includes("javascript") || /\.(js|ts|py|java|php|html|css)$/.test(name)) {
    return "code";
  }
  return "attachment";
}

function getFileKindLabel(meta) {
  const mime = String(meta?.mimetype || "").toLowerCase();
  const name = normalizeText(meta?.filename || "");
  if (mime.startsWith("image/")) return "Imagem";
  if (mime.startsWith("audio/")) return "Audio";
  if (mime.includes("pdf") || name.endsWith(".pdf")) return "PDF";
  if (mime.includes("spreadsheet") || /\.xlsx?$/.test(name)) return "Planilha";
  if (mime.includes("wordprocessing") || /\.docx?$/.test(name)) return "Documento";
  if (mime.includes("presentation") || /\.pptx?$/.test(name)) return "Apresentacao";
  return "Arquivo";
}

function formatBytes(value) {
  const size = Number(value || 0);
  if (!Number.isFinite(size) || size <= 0) return "";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1).replace('.', ',')} KB`;
  return `${(size / (1024 * 1024)).toFixed(1).replace('.', ',')} MB`;
}

function makePendingComposerId() {
  return `pending-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function getComposerFileKey(file) {
  return [
    String(file?.name || ""),
    Number(file?.size || 0),
    Number(file?.lastModified || 0),
    String(file?.type || ""),
  ].join("::");
}

function revokePendingComposerFile(item) {
  if (item?.objectUrl) {
    URL.revokeObjectURL(item.objectUrl);
  }
}

function buildPendingComposerFile(file) {
  const meta = {
    filename: file?.name || "arquivo",
    mimetype: file?.type || "",
    size: Number(file?.size || 0),
  };
  const mime = String(file?.type || "").toLowerCase();
  const isImage = mime.startsWith("image/");

  return {
    id: makePendingComposerId(),
    key: getComposerFileKey(file),
    file,
    isImage,
    objectUrl: isImage ? URL.createObjectURL(file) : "",
    emoji: getFileEmoji(meta),
    typeLabel: getFileKindLabel(meta),
    sizeLabel: formatBytes(file?.size || 0),
  };
}

function setComposerBusy(isBusy) {
  const disabled = Boolean(isBusy);
  const composer = document.querySelector(".composer");
  if (composer) composer.classList.toggle("is-busy", disabled);

  [el("btnAttach"), el("btnRecord"), el("btnSend"), el("msg")].forEach((node) => {
    if (!node) return;
    node.disabled = disabled;
  });
}

function removePendingComposerFile(id) {
  const index = pendingComposerFiles.findIndex((item) => item.id === id);
  if (index < 0) return;

  const [removed] = pendingComposerFiles.splice(index, 1);
  revokePendingComposerFile(removed);
  renderPendingComposerFiles();
  autoResizeTextarea();
}

function clearPendingComposerFiles() {
  pendingComposerFiles.forEach(revokePendingComposerFile);
  pendingComposerFiles = [];
  renderPendingComposerFiles();
}

function renderPendingComposerFiles() {
  const wrap = el("composerUploads");
  if (!wrap) return;

  wrap.innerHTML = "";
  if (!pendingComposerFiles.length) {
    wrap.hidden = true;
    return;
  }

  wrap.hidden = false;

  for (const item of pendingComposerFiles) {
    const chip = document.createElement("div");
    chip.className = "composer-upload";

    const preview = document.createElement(item.isImage ? "img" : "div");
    preview.className = item.isImage ? "composer-upload-thumb" : "composer-upload-icon";
    if (item.isImage) {
      preview.src = item.objectUrl;
      preview.alt = item.file?.name || "imagem";
    } else {
      preview.innerHTML = renderIconSvg(item.emoji);
    }

    const copy = document.createElement("div");
    copy.className = "composer-upload-copy";

    const name = document.createElement("div");
    name.className = "composer-upload-name";
    name.textContent = item.file?.name || "arquivo";

    const meta = document.createElement("div");
    meta.className = "composer-upload-meta";
    meta.textContent = [item.typeLabel, item.sizeLabel].filter(Boolean).join(" - ");

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "composer-upload-remove";
    remove.setAttribute("aria-label", `Remover ${item.file?.name || "arquivo"}`);
    remove.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12" /><path d="M18 6 6 18" /></svg>';
    remove.onclick = () => removePendingComposerFile(item.id);

    copy.appendChild(name);
    copy.appendChild(meta);
    chip.appendChild(preview);
    chip.appendChild(copy);
    chip.appendChild(remove);
    wrap.appendChild(chip);
  }
}

function queueComposerFiles(files) {
  const list = Array.from(files || []);
  if (!list.length) return;

  const oversized = [];
  const existingKeys = new Set(pendingComposerFiles.map((item) => item.key));

  for (const file of list) {
    if (!file) continue;

    if (Number(file.size || 0) > MAX_COMPOSER_FILE_BYTES) {
      oversized.push(file.name || "arquivo");
      continue;
    }

    const key = getComposerFileKey(file);
    if (existingKeys.has(key)) continue;

    pendingComposerFiles.push(buildPendingComposerFile(file));
    existingKeys.add(key);
  }

  renderPendingComposerFiles();
  autoResizeTextarea();

  if (oversized.length) {
    const previewNames = oversized.slice(0, 3).join(", ");
    alert(`${oversized.length} arquivo(s) acima de 25 MB foram ignorados${previewNames ? `: ${previewNames}` : ""}.`);
  }

  const msgEl = el("msg");
  if (msgEl) msgEl.focus();
}

function updateConversationTitle() {
  const titleBox = el("convTitle");
  if (!titleBox) return;

  const conv = conversations.find((item) => item.id === currentConvId);
  titleBox.textContent = conv?.title || "Nova conversa";
}

function renderUser() {
  if (!me) return;

  const sub = el("userSub");
  if (sub) {
    sub.textContent = me.role === "admin" ? "Painel administrativo" : "Assistente da escola";
  }

  const accountName = el("accountName");
  if (accountName) accountName.textContent = me.name || "Usuario";

  const accountMeta = el("accountMeta");
  if (accountMeta) {
    const parts = [me.email || "", me.department || "", me.role || "user"].filter(Boolean);
    accountMeta.textContent = parts.join(" - ");
  }

  const accountInitial = el("accountInitial");
  if (accountInitial) accountInitial.textContent = getUserInitial(me.name);

  const adminBtn = el("adminBtn");
  if (adminBtn) {
    adminBtn.style.display = me.role === "admin" ? "" : "none";
  }
}

function clearChat() {
  const chat = el("chat");
  if (chat) chat.innerHTML = "";
  updateEmptyState();
}

function scrollChat() {
  const chat = el("chat");
  if (chat) chat.scrollTop = chat.scrollHeight;
}

function autoResizeTextarea() {
  const msgEl = el("msg");
  if (!msgEl) return;
  msgEl.style.height = "0px";
  msgEl.style.height = `${Math.min(msgEl.scrollHeight, 220)}px`;
}

async function copyText(text, button) {
  try {
    await navigator.clipboard.writeText(text || "");
    if (button) {
      clearTimeout(button._copyTimer);
      button.classList.add("is-copied");
      button.innerHTML = renderIconSvg("check");
      button.setAttribute("aria-label", "Copiado");
      button.setAttribute("title", "Copiado");
      button._copyTimer = setTimeout(() => {
        button.classList.remove("is-copied");
        button.innerHTML = renderIconSvg("copy");
        button.setAttribute("aria-label", "Copiar");
        button.setAttribute("title", "Copiar");
      }, 1200);
    }
  } catch {
    alert("Nao foi possivel copiar o texto.");
  }
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function sanitizeUrl(value) {
  try {
    const parsed = new URL(String(value || ""));
    return /^https?:$/i.test(parsed.protocol) ? parsed.href : "";
  } catch {
    return "";
  }
}

function restoreTokens(text, tokens) {
  let output = text;
  tokens.forEach((token, index) => {
    output = output.replaceAll(`%%TOKEN_${index}%%`, token);
  });
  return output;
}

function renderInlineMarkdown(text) {
  const tokens = [];
  const storeToken = (value) => {
    const token = `%%TOKEN_${tokens.length}%%`;
    tokens.push(value);
    return token;
  };

  let value = String(text || "");

  value = value.replace(/`([^`\n]+)`/g, (_, code) => storeToken(`<code>${escapeHtml(code)}</code>`));
  value = value.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (_, label, url) => {
    const safeUrl = sanitizeUrl(url);
    if (!safeUrl) return escapeHtml(label);
    return storeToken(
      `<a href="${escapeHtml(safeUrl)}" target="_blank" rel="noopener">${escapeHtml(label)}</a>`
    );
  });

  value = escapeHtml(value);
  value = value.replace(/\*\*([\s\S]+?)\*\*/g, "<strong>$1</strong>");
  value = value.replace(/__([\s\S]+?)__/g, "<strong>$1</strong>");
  value = value.replace(/~~([\s\S]+?)~~/g, "<del>$1</del>");
  value = value.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, "$1<em>$2</em>");
  value = value.replace(/(^|[^_])_([^_\n]+)_(?!_)/g, "$1<em>$2</em>");

  return restoreTokens(value, tokens);
}

function renderMarkdown(markdown) {
  const tokens = [];
  const storeToken = (value) => {
    const token = `%%TOKEN_${tokens.length}%%`;
    tokens.push(value);
    return token;
  };

  const blocks = [];
  let paragraph = [];
  let listType = null;
  let listItems = [];
  let quoteLines = [];
  let value = String(markdown || "").replace(/\r\n/g, "\n");

  value = value.replace(/```([a-z0-9_-]+)?\n?([\s\S]*?)```/gi, (_, lang, code) => {
    const langAttr = lang ? ` class="language-${escapeHtml(lang)}"` : "";
    return storeToken(`<pre><code${langAttr}>${escapeHtml(code).replace(/\n$/, "")}</code></pre>`);
  });

  const flushParagraph = () => {
    if (!paragraph.length) return;
    blocks.push(`<p>${renderInlineMarkdown(paragraph.join(" "))}</p>`);
    paragraph = [];
  };

  const flushList = () => {
    if (!listItems.length || !listType) return;
    const tag = listType === "ol" ? "ol" : "ul";
    blocks.push(`<${tag}>${listItems.map((item) => `<li>${renderInlineMarkdown(item)}</li>`).join("")}</${tag}>`);
    listItems = [];
    listType = null;
  };

  const flushQuote = () => {
    if (!quoteLines.length) return;
    blocks.push(`<blockquote>${quoteLines.map((line) => `<p>${renderInlineMarkdown(line)}</p>`).join("")}</blockquote>`);
    quoteLines = [];
  };

  for (const rawLine of value.split("\n")) {
    const line = rawLine.trimEnd();
    const trimmed = line.trim();

    if (!trimmed) {
      flushParagraph();
      flushList();
      flushQuote();
      continue;
    }

    if (/^#{1,6}\s/.test(trimmed)) {
      flushParagraph();
      flushList();
      flushQuote();
      const level = trimmed.match(/^#+/)[0].length;
      blocks.push(`<h${level}>${renderInlineMarkdown(trimmed.slice(level).trim())}</h${level}>`);
      continue;
    }

    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      flushParagraph();
      flushList();
      flushQuote();
      blocks.push("<hr>");
      continue;
    }

    if (/^>\s?/.test(trimmed)) {
      flushParagraph();
      flushList();
      quoteLines.push(trimmed.replace(/^>\s?/, ""));
      continue;
    }

    const orderedMatch = trimmed.match(/^(\d+)\.\s+(.+)$/);
    if (orderedMatch) {
      flushParagraph();
      flushQuote();
      if (listType && listType !== "ol") flushList();
      listType = "ol";
      listItems.push(orderedMatch[2]);
      continue;
    }

    const unorderedMatch = trimmed.match(/^[-*]\s+(.+)$/);
    if (unorderedMatch) {
      flushParagraph();
      flushQuote();
      if (listType && listType !== "ul") flushList();
      listType = "ul";
      listItems.push(unorderedMatch[1]);
      continue;
    }

    flushList();
    flushQuote();
    paragraph.push(trimmed);
  }

  flushParagraph();
  flushList();
  flushQuote();

  return restoreTokens(blocks.join(""), tokens);
}

function describeSource(source) {
  const pieces = [];
  if (source?.type === "file_search" || source?.type === "knowledge_base") pieces.push("Base interna");
  if (source?.type === "web") pieces.push("Web");
  if (source?.url) pieces.push(source.url.replace(/^https?:\/\//, ""));
  if (source?.file_id) pieces.push(source.file_id);
  return pieces.join(" - ");
}

function createMessageAvatar(role) {
  const avatar = document.createElement("div");
  avatar.className = `message-avatar ${role}`;
  avatar.textContent = role === "assistant" ? "AI" : getUserInitial(me?.name);
  return avatar;
}

function createCopyButton(text, extraClass = "") {
  const copyBtn = document.createElement("button");
  copyBtn.className = `copy-btn icon-copy-btn${extraClass ? ` ${extraClass}` : ""}`;
  copyBtn.type = "button";
  copyBtn.innerHTML = renderIconSvg("copy");
  copyBtn.setAttribute("aria-label", "Copiar");
  copyBtn.setAttribute("title", "Copiar");
  copyBtn.onclick = () => copyText(text, copyBtn);
  return copyBtn;
}

function looksStructuredAssistantText(text = "") {
  const value = String(text || "").trim();
  if (!value) return false;
  if (/^#{1,6}\s/m.test(value)) return true;
  if (/^[-*]\s/m.test(value)) return true;
  if (/^\d+\.\s/m.test(value)) return true;
  if (/^>\s/m.test(value)) return true;
  if (/\n\n/.test(value)) return true;
  return value.length > 320 && /[:;]/.test(value);
}

function shouldRenderStructuredCard(meta, content) {
  if (meta?.structured === true) return true;
  return looksStructuredAssistantText(content);
}

function appendAssistantContent(bubble, text, meta = null) {
  const useStructuredCard = shouldRenderStructuredCard(meta, text);

  if (useStructuredCard) {
    const card = document.createElement("section");
    card.className = "structured-card";

    const head = document.createElement("div");
    head.className = "structured-card-head";

    const label = document.createElement("div");
    label.className = "structured-card-label";
    label.textContent = meta?.structured_label || "Resposta estruturada";

    head.appendChild(label);
    head.appendChild(createCopyButton(text, "structured-copy-btn"));
    card.appendChild(head);

    const body = document.createElement("div");
    body.className = "structured-card-body md-content";
    body.innerHTML = renderMarkdown(text);
    card.appendChild(body);

    bubble.appendChild(card);
    return;
  }

  const plain = document.createElement("div");
  plain.className = "assistant-plain";
  plain.appendChild(createCopyButton(text, "inline-copy-btn"));

  const textNode = document.createElement("div");
  textNode.className = "md-content";
  textNode.innerHTML = renderMarkdown(text);
  plain.appendChild(textNode);

  bubble.appendChild(plain);
}

function appendTextContent(bubble, role, content, meta = null) {
  const text = String(content || "");
  if (!text) return;

  if (role === "assistant") {
    appendAssistantContent(bubble, text, meta);
    return;
  }

  const textNode = document.createElement("div");
  textNode.className = "msg-text";
  textNode.textContent = text;
  bubble.appendChild(textNode);
}

function appendFileCard(bubble, meta) {
  if (!meta || meta.type !== "file" || !meta.file_id) return;

  const mime = String(meta.mimetype || "").toLowerCase();
  const isImg = mime.startsWith("image/");
  const isAudio = mime.startsWith("audio/");
  const downloadUrl = `/api/files/${meta.file_id}/download`;
  const previewUrl = (isImg || isAudio) ? `${downloadUrl}?inline=1` : downloadUrl;

  const card = document.createElement("div");
  card.className = `file-card${isImg ? " is-image" : ""}${isAudio ? " is-audio" : ""}`;

  const preview = document.createElement("div");
  preview.className = "file-preview";

  if (isImg) {
    const imageLink = document.createElement("a");
    imageLink.className = "file-preview-link";
    imageLink.href = previewUrl;
    imageLink.target = "_blank";
    imageLink.rel = "noopener";
    imageLink.setAttribute("aria-label", `Abrir ${meta.filename || "imagem"}`);

    const img = document.createElement("img");
    img.className = "file-thumb";
    img.src = previewUrl;
    img.alt = meta.filename || "imagem";
    imageLink.appendChild(img);
    preview.appendChild(imageLink);
  } else {
    const badge = document.createElement("div");
    badge.className = "file-ic";
    badge.innerHTML = renderIconSvg(getFileEmoji(meta));
    preview.appendChild(badge);
  }

  const body = document.createElement("div");
  body.className = "file-body";

  const top = document.createElement("div");
  top.className = "file-top";

  const typePill = document.createElement("div");
  typePill.className = "file-pill";
  typePill.textContent = getFileKindLabel(meta);

  const fileName = document.createElement("a");
  fileName.className = "file-name";
  fileName.href = previewUrl;
  fileName.target = "_blank";
  fileName.rel = "noopener";
  fileName.textContent = meta.filename || "arquivo";

  const metaLine = document.createElement("div");
  metaLine.className = "file-meta";
  metaLine.textContent = [meta.mimetype || "", formatBytes(meta.size)].filter(Boolean).join(" - ");

  const actions = document.createElement("div");
  actions.className = "file-links";

  const openLink = document.createElement("a");
  openLink.href = previewUrl;
  openLink.target = "_blank";
  openLink.rel = "noopener";
  openLink.textContent = isAudio ? "Ouvir" : isImg ? "Abrir imagem" : "Abrir arquivo";
  actions.appendChild(openLink);

  const downloadLink = document.createElement("a");
  downloadLink.href = downloadUrl;
  downloadLink.setAttribute("download", meta.filename || "arquivo");
  downloadLink.textContent = isAudio ? "Baixar audio" : isImg ? "Baixar imagem" : "Baixar arquivo";
  actions.appendChild(downloadLink);

  top.appendChild(typePill);
  body.appendChild(top);
  body.appendChild(fileName);
  if (metaLine.textContent) body.appendChild(metaLine);

  if (isAudio) {
    const player = document.createElement("audio");
    player.className = "file-audio";
    player.controls = true;
    player.preload = "none";
    player.src = previewUrl;
    body.appendChild(player);
  }

  body.appendChild(actions);
  card.appendChild(preview);
  card.appendChild(body);
  bubble.appendChild(card);
}

function appendSources(bubble, meta) {
  if (!meta?.show_sources) return;
  const sources = Array.isArray(meta?.sources) ? meta.sources.filter(Boolean) : [];
  if (!sources.length) return;

  const wrap = document.createElement("div");
  wrap.className = "sources-card";

  const title = document.createElement("div");
  title.className = "sources-title";
  title.textContent = "Fontes usadas";
  wrap.appendChild(title);

  const list = document.createElement("div");
  list.className = "sources-list";

  for (const source of sources) {
    const safeUrl = sanitizeUrl(source?.url || "");
    const item = document.createElement(safeUrl ? "a" : "div");
    item.className = "source-item";

    if (safeUrl) {
      item.href = safeUrl;
      item.target = "_blank";
      item.rel = "noopener";
    }

    const label = document.createElement("div");
    label.className = "source-label";
    label.textContent = source?.label || safeUrl || "Fonte";
    item.appendChild(label);

    if (source?.excerpt) {
      const excerpt = document.createElement("div");
      excerpt.className = "source-excerpt";
      excerpt.textContent = source.excerpt;
      item.appendChild(excerpt);
    }

    const metaLine = document.createElement("div");
    metaLine.className = "source-meta";
    metaLine.textContent = describeSource(source);
    item.appendChild(metaLine);

    list.appendChild(item);
  }

  wrap.appendChild(list);
  bubble.appendChild(wrap);
}

function updateEmptyState() {
  const emptyState = el("emptyState");
  const chat = el("chat");
  if (!emptyState || !chat) return;

  const hasMessages = chat.children.length > 0;
  emptyState.style.display = hasMessages ? "none" : "flex";
  chat.classList.toggle("has-messages", hasMessages);
}

function addMessage(role, content, meta = null) {
  const chat = el("chat");
  if (!chat) return;

  const wrap = document.createElement("div");
  wrap.className = `msg ${role === "user" ? "user" : "assistant"}`;

  const bubble = document.createElement("div");
  bubble.className = "bubble";

  appendTextContent(bubble, role, content, meta);
  appendFileCard(bubble, meta);
  appendSources(bubble, meta);

  const avatar = createMessageAvatar(role === "user" ? "user" : "assistant");

  if (role === "user") {
    wrap.appendChild(bubble);
    wrap.appendChild(avatar);
  } else {
    wrap.appendChild(avatar);
    wrap.appendChild(bubble);
  }

  chat.appendChild(wrap);
  updateEmptyState();
}

function renderConversations() {
  const list = el("convList");
  if (!list) return;

  list.innerHTML = "";

  for (const c of conversations) {
    const item = document.createElement("div");
    item.className = "conv" + (c.id === currentConvId ? " active" : "");

    const emoji = document.createElement("div");
    emoji.className = "conv-emoji";
    emoji.innerHTML = renderIconSvg(getConversationEmoji(c.title));

    const body = document.createElement("div");
    body.className = "conv-body";

    const title = document.createElement("div");
    title.className = "conv-title";
    title.textContent = c.title || "Nova conversa";

    const meta = document.createElement("div");
    meta.className = "conv-meta";
    meta.textContent = formatDate(c.updated_at || c.created_at);

    const del = document.createElement("button");
    del.className = "conv-del";
    del.type = "button";
    del.title = "Apagar conversa";
    del.setAttribute("aria-label", "Apagar conversa");
    del.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 9v8" /><path d="M15 9v8" /><path d="M4 7h16" /><path d="M10 4h4" /><path d="M6 7l1 12h10l1-12" /></svg>';

    del.onclick = async (e) => {
      e.stopPropagation();
      if (!confirm("Apagar esta conversa? Isso nao pode ser desfeito.")) return;

      try {
        await api(`/api/conversations/${c.id}`, { method: "DELETE" });
        if (currentConvId === c.id) currentConvId = null;
        await loadConversations();

        if (conversations.length) {
          await openConversation(conversations[0].id);
        } else {
          clearChat();
          updateConversationTitle();
        }
      } catch (err) {
        alert("Erro ao apagar conversa: " + err.message);
      }
    };

    body.appendChild(title);
    body.appendChild(meta);

    item.appendChild(emoji);
    item.appendChild(body);
    item.appendChild(del);

    item.onclick = async () => {
      await openConversation(c.id);
      closeSidebar();
    };

    list.appendChild(item);
  }
}

async function loadConversations() {
  const data = await api("/api/conversations");
  conversations = data.conversations || [];
  renderConversations();
  updateConversationTitle();
}

async function ensureConversation() {
  if (currentConvId) return currentConvId;

  const data = await api("/api/conversations", {
    method: "POST",
    body: JSON.stringify({ title: "Nova conversa" }),
  });

  currentConvId = data.conversation_id;
  await loadConversations();
  return currentConvId;
}

async function openConversation(id) {
  const shouldResetComposer = currentConvId !== null && currentConvId !== id;
  currentConvId = id;
  if (shouldResetComposer) {
    clearPendingComposerFiles();
  }
  renderConversations();
  updateConversationTitle();
  clearChat();

  const data = await api(`/api/conversations/${id}/messages`);
  const msgs = data.messages || [];

  if (data.conversation) {
    conversations = conversations.map((conversation) =>
      conversation.id === id ? { ...conversation, ...data.conversation } : conversation
    );
    renderConversations();
    updateConversationTitle();
  }

  for (const message of msgs) {
    addMessage(message.role, message.content, message.meta || null);
  }

  scrollChat();
  updateEmptyState();
}

function createTypingIndicator() {
  const chat = el("chat");
  if (!chat) return null;

  const typing = document.createElement("div");
  typing.className = "msg assistant";
  typing.innerHTML = `
    <div class="message-avatar assistant">AI</div>
    <div class="bubble typing-bubble"><div class="typing-dots"><span></span><span></span><span></span></div></div>
  `;

  chat.appendChild(typing);
  updateEmptyState();
  scrollChat();
  return typing;
}

async function sendTextOnlyMessage(text) {
  const msgEl = el("msg");
  const convId = await ensureConversation();

  isSendingMessage = true;
  setComposerBusy(true);
  msgEl.value = "";
  autoResizeTextarea();

  addMessage("user", text);
  scrollChat();

  const typing = createTypingIndicator();

  try {
    const data = await api(`/api/conversations/${convId}/send`, {
      method: "POST",
      body: JSON.stringify({ message: text }),
    });

    typing?.remove();
    addMessage("assistant", data.reply || "OK", data.meta || null);
    await loadConversations();
    scrollChat();
  } catch (err) {
    typing?.remove();
    addMessage("assistant", "Erro: " + err.message);
    scrollChat();
  } finally {
    isSendingMessage = false;
    setComposerBusy(false);
  }
}

async function uploadFiles(files, { convId: providedConvId = null, refresh = true } = {}) {
  const list = Array.from(files || []);
  if (!list.length) {
    return { conversationId: providedConvId, uploadedCount: 0, errors: [] };
  }

  const convId = providedConvId || await ensureConversation();
  const errors = [];
  let uploadedCount = 0;

  for (const file of list) {
    const fd = new FormData();
    fd.append("file", file);

    try {
      await api(`/api/conversations/${convId}/files`, {
        method: "POST",
        body: fd,
      });
      uploadedCount += 1;
    } catch (err) {
      errors.push({
        key: getComposerFileKey(file),
        name: file.name || "arquivo",
        message: err.message,
      });
    }
  }

  if (refresh) {
    await openConversation(convId);
    await loadConversations();
  }

  return { conversationId: convId, uploadedCount, errors };
}

async function sendMessageWithAttachments(text) {
  const msgEl = el("msg");
  const snapshot = [...pendingComposerFiles];
  if (!snapshot.length) return;

  const convId = await ensureConversation();
  isSendingMessage = true;
  setComposerBusy(true);

  try {
    const uploadResult = await uploadFiles(snapshot.map((item) => item.file), {
      convId,
      refresh: false,
    });

    const failedKeys = new Set(uploadResult.errors.map((item) => item.key));
    const uploadedItems = snapshot.filter((item) => !failedKeys.has(item.key));
    const failedItems = snapshot.filter((item) => failedKeys.has(item.key));

    uploadedItems.forEach(revokePendingComposerFile);
    pendingComposerFiles = failedItems;
    renderPendingComposerFiles();

    if (uploadResult.errors.length) {
      await openConversation(convId);
      await loadConversations();
      const firstError = uploadResult.errors[0];
      throw new Error(`Erro ao enviar "${firstError.name}": ${firstError.message}`);
    }

    if (text) {
      const typing = createTypingIndicator();
      try {
        await api(`/api/conversations/${convId}/send`, {
          method: "POST",
          body: JSON.stringify({ message: text }),
        });
      } finally {
        typing?.remove();
      }
    }

    msgEl.value = "";
    autoResizeTextarea();
    clearPendingComposerFiles();
    await openConversation(convId);
    await loadConversations();
    scrollChat();
  } catch (err) {
    if (currentConvId) {
      await openConversation(currentConvId);
      await loadConversations();
    }
    alert(err.message || "Nao foi possivel enviar a mensagem com anexos.");
  } finally {
    isSendingMessage = false;
    setComposerBusy(false);
  }
}

async function sendMessage() {
  const msgEl = el("msg");
  const text = (msgEl?.value || "").trim();
  const hasPendingFiles = pendingComposerFiles.length > 0;

  if (isSendingMessage) return;
  if (!text && !hasPendingFiles) return;

  if (hasPendingFiles) {
    await sendMessageWithAttachments(text);
    return;
  }

  await sendTextOnlyMessage(text);
}

function setupQuickPrompts() {
  const wrap = el("quickPrompts");
  const msgEl = el("msg");
  if (!wrap || !msgEl) return;

  wrap.innerHTML = "";

  for (const item of QUICK_PROMPTS) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "prompt-card";
    button.innerHTML = `
      <div class="prompt-icon">${renderIconSvg(item.icon)}</div>
      <div class="prompt-copy">
        <div class="prompt-title">${item.label}</div>
        <div class="prompt-hint">${item.hint}</div>
      </div>
    `;
    button.onclick = () => {
      msgEl.value = item.prompt;
      msgEl.focus();
      autoResizeTextarea();
      msgEl.setSelectionRange(msgEl.value.length, msgEl.value.length);
    };
    wrap.appendChild(button);
  }
}

function setRecordState(isRecording) {
  const btn = el("btnRecord");
  if (!btn) return;
  btn.classList.toggle("recording", Boolean(isRecording));
  btn.title = isRecording ? "Parar gravacao" : "Gravar audio";
  btn.setAttribute("aria-label", btn.title);
}

function stopRecordingStream() {
  if (!recordingStream) return;
  for (const track of recordingStream.getTracks()) {
    track.stop();
  }
  recordingStream = null;
}

async function setupRecorder() {
  const btn = el("btnRecord");
  if (!btn) return;

  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
    btn.style.display = "none";
    return;
  }

  btn.onclick = async () => {
    if (mediaRecorder && mediaRecorder.state === "recording") {
      mediaRecorder.stop();
      setRecordState(false);
      return;
    }

    try {
      recordingStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      recordingChunks = [];
      const recorderMime = typeof MediaRecorder.isTypeSupported === "function" && MediaRecorder.isTypeSupported("audio/webm")
        ? "audio/webm"
        : "";
      mediaRecorder = recorderMime
        ? new MediaRecorder(recordingStream, { mimeType: recorderMime })
        : new MediaRecorder(recordingStream);

      mediaRecorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          recordingChunks.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        setRecordState(false);
        const blob = new Blob(recordingChunks, { type: mediaRecorder.mimeType || "audio/webm" });
        stopRecordingStream();
        if (!blob.size) return;

        const ext = (blob.type || "").includes("ogg") ? ".ogg" : ".webm";
        const filename = `gravacao-${new Date().toISOString().replace(/[:.]/g, "-")}${ext}`;
        const file = new File([blob], filename, { type: blob.type || "audio/webm" });
        queueComposerFiles([file]);
      };

      mediaRecorder.start();
      setRecordState(true);
    } catch (err) {
      stopRecordingStream();
      setRecordState(false);
      alert("Nao foi possivel acessar o microfone: " + err.message);
    }
  };
}

function setupAttachments() {
  const btnAttach = el("btnAttach");
  const input = el("attachInput");

  if (btnAttach && input) {
    btnAttach.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      input.click();
    };

    input.onchange = () => {
      queueComposerFiles(input.files);
      input.value = "";
    };
  }

  const msgEl = el("msg");
  if (msgEl) {
    msgEl.addEventListener("paste", (e) => {
      const items = e.clipboardData?.items;
      if (!items) return;

      const images = [];
      for (const item of items) {
        if (item.kind !== "file") continue;
        const file = item.getAsFile();
        if (file && (file.type || "").startsWith("image/")) {
          images.push(file);
        }
      }

      if (!images.length) return;
      e.preventDefault();
      queueComposerFiles(images);
    });
  }
}

function openSidebar() {
  document.body.classList.add("sidebar-open");
}

function closeSidebar() {
  document.body.classList.remove("sidebar-open");
}

function setupSidebarToggle() {
  const btnSidebar = el("btnSidebar");
  const backdrop = el("backdrop");

  if (btnSidebar) {
    btnSidebar.onclick = () => openSidebar();
  }

  if (backdrop) {
    backdrop.onclick = () => closeSidebar();
  }

  window.addEventListener("resize", () => {
    if (window.innerWidth > 960) {
      closeSidebar();
    }
  });
}

async function init() {
  try {
    me = (await api("/api/me")).user;
  } catch {
    location.href = "/login.html";
    return;
  }

  renderUser();
  setupQuickPrompts();
  setupSidebarToggle();

  const btnSend = el("btnSend");
  if (btnSend) {
    btnSend.onclick = sendMessage;
  }

  const msgEl = el("msg");
  if (msgEl) {
    msgEl.addEventListener("input", autoResizeTextarea);
    msgEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
    });
    autoResizeTextarea();
  }

  const btnNew = el("btnNewChat");
  if (btnNew) {
    btnNew.onclick = async () => {
      clearPendingComposerFiles();
      const composerMsg = el("msg");
      if (composerMsg) {
        composerMsg.value = "";
        autoResizeTextarea();
      }
      currentConvId = null;
      const id = await ensureConversation();
      await openConversation(id);
      closeSidebar();
    };
  }

  const btnLogout = el("btnLogout");
  if (btnLogout) {
    btnLogout.onclick = async () => {
      await api("/api/logout", { method: "POST" });
      location.href = "/login.html";
    };
  }

  setupAttachments();
  renderPendingComposerFiles();
  await setupRecorder();

  await loadConversations();

  if (conversations.length) {
    await openConversation(conversations[0].id);
  } else {
    const id = await ensureConversation();
    await openConversation(id);
  }
}

window.addEventListener("DOMContentLoaded", init);
























