const el = (id) => document.getElementById(id);

const QUICK_PROMPTS = [
  { emoji: "📄", label: "Gerar documento", prompt: "Gere um documento profissional sobre este tema:" },
  { emoji: "📊", label: "Criar planilha", prompt: "Crie uma planilha organizada com os principais campos para:" },
  { emoji: "🎧", label: "Transcrever audio", prompt: "Analise e transcreva o audio enviado, depois faca um resumo objetivo." },
  { emoji: "🖼️", label: "Gerar imagem", prompt: "Gere uma imagem realista e profissional de:" },
  { emoji: "🎓", label: "Comunicado escolar", prompt: "Crie um comunicado escolar claro e acolhedor sobre:" },
];

let me = null;
let conversations = [];
let currentConvId = null;
let mediaRecorder = null;
let recordingStream = null;
let recordingChunks = [];

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

function getConversationEmoji(title) {
  const text = normalizeText(title);
  if (!text) return "💬";
  if (/(planilha|tabela|excel|relatorio|relatorio|dados)/.test(text)) return "📊";
  if (/(pdf|doc|docx|documento|contrato|texto|comunicado)/.test(text)) return "📄";
  if (/(imagem|foto|banner|arte|logo)/.test(text)) return "🖼️";
  if (/(audio|voz|locucao|narracao|transcri|gravacao)/.test(text)) return "🎧";
  if (/(codigo|site|api|script|planilha automatica)/.test(text)) return "💻";
  if (/(aluno|escola|matricula|turma|pedagogico)/.test(text)) return "🎓";
  if (/(financeiro|orcamento|boleto|pagamento)/.test(text)) return "💰";
  return "💬";
}

function getFileEmoji(meta) {
  const mime = String(meta?.mimetype || "").toLowerCase();
  const name = normalizeText(meta?.filename || "");
  if (mime.startsWith("image/")) return "🖼️";
  if (mime.startsWith("audio/")) return "🎧";
  if (mime.includes("pdf") || name.endsWith(".pdf")) return "📕";
  if (mime.includes("spreadsheet") || /\.xlsx?$/.test(name)) return "📊";
  if (mime.includes("wordprocessing") || /\.docx?$/.test(name)) return "📄";
  if (mime.includes("presentation") || /\.pptx?$/.test(name)) return "📽️";
  if (mime.includes("json") || mime.includes("javascript") || /\.(js|ts|py|java|php|html|css)$/.test(name)) return "💻";
  return "📎";
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
  if (mime.includes("zip")) return "Compactado";
  return "Arquivo";
}

function formatBytes(value) {
  const size = Number(value || 0);
  if (!Number.isFinite(size) || size <= 0) return "";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1).replace('.', ',')} KB`;
  return `${(size / (1024 * 1024)).toFixed(1).replace('.', ',')} MB`;
}

function updateConversationTitle() {
  const titleBox = el("convTitle");
  if (!titleBox) return;

  const conv = conversations.find((item) => item.id === currentConvId);
  titleBox.textContent = conv?.title || "Nova conversa";
}

function renderUser() {
  const sub = el("userSub");
  if (!sub || !me) return;

  sub.textContent = `${me.name || "Usuario"} - ${me.email || ""} - ${me.role || ""}`;

  const adminBtn = el("adminBtn");
  if (adminBtn) {
    adminBtn.style.display = me.role === "admin" ? "" : "none";
  }
}

function clearChat() {
  const chat = el("chat");
  if (chat) chat.innerHTML = "";
  updateQuickPromptsVisibility();
}

function scrollChat() {
  const chat = el("chat");
  if (chat) chat.scrollTop = chat.scrollHeight;
}

async function copyText(text, button) {
  try {
    await navigator.clipboard.writeText(text || "");
    const old = button.textContent;
    button.textContent = "Copiado";
    setTimeout(() => {
      button.textContent = old;
    }, 1200);
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
  if (source?.type === "file_search") pieces.push("Base interna");
  if (source?.type === "web") pieces.push("Web");
  if (source?.url) pieces.push(source.url.replace(/^https?:\/\//, ""));
  if (source?.file_id) pieces.push(source.file_id);
  return pieces.join(" - ");
}

function appendTextContent(bubble, role, content) {
  const text = String(content || "");
  if (!text) return;

  const textNode = document.createElement("div");
  textNode.className = role === "assistant" ? "md-content" : "msg-text";

  if (role === "assistant") {
    textNode.innerHTML = renderMarkdown(text);
  } else {
    textNode.textContent = text;
  }

  bubble.appendChild(textNode);

  if (role === "assistant") {
    const actions = document.createElement("div");
    actions.className = "msg-actions";

    const copyBtn = document.createElement("button");
    copyBtn.className = "copy-btn";
    copyBtn.type = "button";
    copyBtn.textContent = "Copiar";
    copyBtn.onclick = () => copyText(text, copyBtn);

    actions.appendChild(copyBtn);
    bubble.appendChild(actions);
  }
}

function appendFileCard(bubble, meta) {
  if (!meta || meta.type !== "file" || !meta.file_id) return;

  const mime = String(meta.mimetype || "").toLowerCase();
  const isImg = mime.startsWith("image/");
  const isAudio = mime.startsWith("audio/");
  const url = `/api/files/${meta.file_id}/download`;

  const card = document.createElement("div");
  card.className = `file-card${isImg ? " is-image" : ""}${isAudio ? " is-audio" : ""}`;

  const preview = document.createElement("div");
  preview.className = "file-preview";

  if (isImg) {
    const img = document.createElement("img");
    img.className = "file-thumb";
    img.src = url;
    img.alt = meta.filename || "imagem";
    preview.appendChild(img);
  } else {
    const badge = document.createElement("div");
    badge.className = "file-ic";
    badge.textContent = getFileEmoji(meta);
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
  fileName.href = url;
  fileName.target = "_blank";
  fileName.rel = "noopener";
  fileName.textContent = meta.filename || "arquivo";

  const metaLine = document.createElement("div");
  metaLine.className = "file-meta";
  metaLine.textContent = [meta.mimetype || "", formatBytes(meta.size)].filter(Boolean).join(" - ");

  const actions = document.createElement("div");
  actions.className = "file-links";

  const openLink = document.createElement("a");
  openLink.href = url;
  openLink.target = "_blank";
  openLink.rel = "noopener";
  openLink.textContent = isAudio ? "Ouvir / baixar" : isImg ? "Abrir imagem" : "Abrir arquivo";

  actions.appendChild(openLink);

  top.appendChild(typePill);
  body.appendChild(top);
  body.appendChild(fileName);
  if (metaLine.textContent) body.appendChild(metaLine);

  if (isAudio) {
    const player = document.createElement("audio");
    player.className = "file-audio";
    player.controls = true;
    player.preload = "none";
    player.src = url;
    body.appendChild(player);
  }

  body.appendChild(actions);
  card.appendChild(preview);
  card.appendChild(body);
  bubble.appendChild(card);
}

function appendSources(bubble, meta) {
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

function updateQuickPromptsVisibility() {
  const wrap = el("quickPrompts");
  const chat = el("chat");
  if (!wrap || !chat) return;
  wrap.style.display = chat.children.length ? "none" : "flex";
}

function addMessage(role, content, meta = null) {
  const chat = el("chat");
  if (!chat) return;

  const wrap = document.createElement("div");
  wrap.className = "msg " + (role === "user" ? "user" : "assistant");

  const bubble = document.createElement("div");
  bubble.className = "bubble";

  appendTextContent(bubble, role, content);
  appendFileCard(bubble, meta);
  appendSources(bubble, meta);

  wrap.appendChild(bubble);
  chat.appendChild(wrap);
  updateQuickPromptsVisibility();
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
    emoji.textContent = getConversationEmoji(c.title);

    const left = document.createElement("div");
    left.className = "conv-body";

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
    del.textContent = "X";

    del.onclick = async (e) => {
      e.stopPropagation();

      if (!confirm("Apagar esta conversa? Isso nao pode ser desfeito.")) return;

      try {
        await api(`/api/conversations/${c.id}`, { method: "DELETE" });

        if (currentConvId === c.id) {
          currentConvId = null;
        }

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

    left.appendChild(title);
    left.appendChild(meta);

    item.appendChild(emoji);
    item.appendChild(left);
    item.appendChild(del);

    item.onclick = async () => {
      await openConversation(c.id);
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
  currentConvId = id;
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
  updateQuickPromptsVisibility();
}

async function sendMessage() {
  const msgEl = el("msg");
  const text = (msgEl?.value || "").trim();

  if (!text) return;

  const convId = await ensureConversation();

  msgEl.value = "";

  addMessage("user", text);
  scrollChat();

  const typing = document.createElement("div");
  typing.className = "msg assistant";
  typing.innerHTML = '<div class="bubble"><div class="msg-text">Pensando...</div></div>';
  el("chat").appendChild(typing);
  updateQuickPromptsVisibility();
  scrollChat();

  try {
    const data = await api(`/api/conversations/${convId}/send`, {
      method: "POST",
      body: JSON.stringify({ message: text }),
    });

    typing.remove();
    addMessage("assistant", data.reply || "OK", data.meta || null);
    await loadConversations();
    scrollChat();
  } catch (err) {
    typing.remove();
    addMessage("assistant", "Erro: " + err.message);
    scrollChat();
  }
}

async function uploadFiles(files) {
  const list = Array.from(files || []);
  if (!list.length) return;

  const convId = await ensureConversation();

  for (const file of list) {
    const fd = new FormData();
    fd.append("file", file);

    try {
      await api(`/api/conversations/${convId}/files`, {
        method: "POST",
        body: fd,
      });
    } catch (err) {
      alert(`Erro ao enviar arquivo "${file.name}": ${err.message}`);
    }
  }

  await openConversation(convId);
  await loadConversations();
}

function setupQuickPrompts() {
  const wrap = el("quickPrompts");
  const msgEl = el("msg");
  if (!wrap || !msgEl) return;

  wrap.innerHTML = "";
  for (const item of QUICK_PROMPTS) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "prompt-chip";
    button.innerHTML = `<span class="prompt-emoji">${item.emoji}</span><span>${item.label}</span>`;
    button.onclick = () => {
      msgEl.value = item.prompt;
      msgEl.focus();
      msgEl.setSelectionRange(msgEl.value.length, msgEl.value.length);
    };
    wrap.appendChild(button);
  }

  updateQuickPromptsVisibility();
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
        await uploadFiles([file]);
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

    input.onchange = async () => {
      await uploadFiles(input.files);
      input.value = "";
    };
  }

  const msgEl = el("msg");
  if (msgEl) {
    msgEl.addEventListener("paste", async (e) => {
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
      await uploadFiles(images);
    });
  }
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

  const btnSend = el("btnSend");
  if (btnSend) {
    btnSend.onclick = sendMessage;
  }

  const msgEl = el("msg");
  if (msgEl) {
    msgEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
    });
  }

  const btnNew = el("btnNewChat");
  if (btnNew) {
    btnNew.onclick = async () => {
      currentConvId = null;
      const id = await ensureConversation();
      await openConversation(id);
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


