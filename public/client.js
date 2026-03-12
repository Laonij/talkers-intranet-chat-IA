const el = (id) => document.getElementById(id);

let me = null;
let conversations = [];
let currentConvId = null;

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
    const text = paragraph.join("\n").trim();
    if (text) {
      blocks.push(`<p>${renderInlineMarkdown(text).replace(/\n/g, "<br />")}</p>`);
    }
    paragraph = [];
  };

  const flushList = () => {
    if (!listItems.length || !listType) return;
    const tag = listType;
    const items = listItems.map((item) => `<li>${renderInlineMarkdown(item)}</li>`).join("");
    blocks.push(`<${tag}>${items}</${tag}>`);
    listType = null;
    listItems = [];
  };

  const flushQuote = () => {
    if (!quoteLines.length) return;
    const quoteHtml = quoteLines
      .map((line) => `<p>${renderInlineMarkdown(line).replace(/\n/g, "<br />")}</p>`)
      .join("");
    blocks.push(`<blockquote>${quoteHtml}</blockquote>`);
    quoteLines = [];
  };

  for (const rawLine of value.split("\n")) {
    const line = rawLine.replace(/\t/g, "    ");
    const trimmed = line.trim();

    if (/^%%TOKEN_\d+%%$/.test(trimmed)) {
      flushParagraph();
      flushList();
      flushQuote();
      blocks.push(trimmed);
      continue;
    }

    if (!trimmed) {
      flushParagraph();
      flushList();
      flushQuote();
      continue;
    }

    if (quoteLines.length && !/^>\s?/.test(trimmed)) {
      flushQuote();
    }

    const hrMatch = trimmed.match(/^(-{3,}|\*{3,}|_{3,})$/);
    if (hrMatch) {
      flushParagraph();
      flushList();
      flushQuote();
      blocks.push("<hr />");
      continue;
    }

    const headingMatch = trimmed.match(/^(#{1,6})\s+(.*)$/);
    if (headingMatch) {
      flushParagraph();
      flushList();
      flushQuote();
      const level = headingMatch[1].length;
      blocks.push(`<h${level}>${renderInlineMarkdown(headingMatch[2])}</h${level}>`);
      continue;
    }

    const quoteMatch = trimmed.match(/^>\s?(.*)$/);
    if (quoteMatch) {
      flushParagraph();
      flushList();
      quoteLines.push(quoteMatch[1]);
      continue;
    }

    const ulMatch = trimmed.match(/^[-*+]\s+(.*)$/);
    if (ulMatch) {
      flushParagraph();
      flushQuote();
      if (listType && listType !== "ul") flushList();
      listType = "ul";
      listItems.push(ulMatch[1]);
      continue;
    }

    const olMatch = trimmed.match(/^\d+\.\s+(.*)$/);
    if (olMatch) {
      flushParagraph();
      flushQuote();
      if (listType && listType !== "ol") flushList();
      listType = "ol";
      listItems.push(olMatch[1]);
      continue;
    }

    if (listItems.length) flushList();
    paragraph.push(line);
  }

  flushParagraph();
  flushList();
  flushQuote();

  return restoreTokens(blocks.join(""), tokens);
}

function describeSource(source) {
  switch (source?.type) {
    case "knowledge_base":
      return "Base interna";
    case "file_search":
      return "File Search";
    case "web":
      return "Web";
    default:
      return "Fonte";
  }
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

  const isImg = (meta.mimetype || "").startsWith("image/");
  const url = `/api/files/${meta.file_id}/download`;

  const card = document.createElement("div");
  card.className = "file-card";

  if (isImg) {
    const img = document.createElement("img");
    img.className = "file-thumb";
    img.src = url;
    img.alt = meta.filename || "imagem";
    card.appendChild(img);
  } else {
    const ic = document.createElement("div");
    ic.className = "file-ic";
    ic.textContent = "ARQ";
    card.appendChild(ic);
  }

  const textWrap = document.createElement("div");

  const link = document.createElement("a");
  link.href = url;
  link.target = "_blank";
  link.rel = "noopener";
  link.textContent = meta.filename || "arquivo";

  const mime = document.createElement("div");
  mime.style.fontSize = "11px";
  mime.style.opacity = ".68";
  mime.textContent = meta.mimetype || "";

  textWrap.appendChild(link);
  textWrap.appendChild(mime);
  card.appendChild(textWrap);
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
}

function renderConversations() {
  const list = el("convList");
  if (!list) return;

  list.innerHTML = "";

  for (const c of conversations) {
    const item = document.createElement("div");
    item.className = "conv" + (c.id === currentConvId ? " active" : "");

    const left = document.createElement("div");
    left.style.flex = "1";

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

  await loadConversations();

  if (conversations.length) {
    await openConversation(conversations[0].id);
  } else {
    const id = await ensureConversation();
    await openConversation(id);
  }
}

window.addEventListener("DOMContentLoaded", init);
