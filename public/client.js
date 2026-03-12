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

function appendTextContent(bubble, role, content) {
  const text = String(content || "");
  if (!text) return;

  const textNode = document.createElement("div");
  textNode.textContent = text;
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

function addMessage(role, content, meta = null) {
  const chat = el("chat");
  if (!chat) return;

  const wrap = document.createElement("div");
  wrap.className = "msg " + (role === "user" ? "user" : "assistant");

  const bubble = document.createElement("div");
  bubble.className = "bubble";

  appendTextContent(bubble, role, content);
  appendFileCard(bubble, meta);

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
  typing.innerHTML = '<div class="bubble">Pensando...</div>';
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