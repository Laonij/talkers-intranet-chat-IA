async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json", ...(opts.headers || {}) },
    credentials: "include",
    ...opts,
  });
  const txt = await res.text();
  let json = null;
  try {
    json = txt ? JSON.parse(txt) : null;
  } catch {}
  if (!res.ok) throw new Error(json?.error || txt || `HTTP ${res.status}`);
  return json;
}

const el = (id) => document.getElementById(id);

// Attach menu (ChatGPT-like) + toast
const btnAttach = el("btnAttach");
const attachMenu = el("attachMenu");
const menuAddFiles = el("menuAddFiles");
const menuKnowledge = el("menuKnowledge");
const menuCreateImage = el("menuCreateImage");
const menuDeep = el("menuDeep");
const menuWeb = el("menuWeb");
const toastEl = el("toast");

function toast(msg){
  if(!toastEl) return;
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  clearTimeout(toastEl._t);
  toastEl._t = setTimeout(()=>toastEl.classList.remove('show'), 2200);
}

let me = null;
let conversations = [];
let currentConvId = null;

function fmtDate(iso) {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString("pt-BR");
  } catch {
    return "";
  }
}

function renderConversations() {
  const list = el("convList");
  list.innerHTML = "";

  for (const c of conversations) {
    const item = document.createElement("div");
    item.className = "conv" + (c.id === currentConvId ? " active" : "");
    item.onclick = () => openConversation(c.id);

    const t = document.createElement("div");
    t.className = "conv-title";
    t.textContent = c.title || "Conversa";

    const s = document.createElement("div");
    s.className = "conv-sub";
    s.textContent = fmtDate(c.updated_at || c.created_at);

    item.appendChild(t);
    item.appendChild(s);

    const actions = document.createElement("div");
    actions.className = "conv-actions";

    const del = document.createElement("button");
    del.className = "icon-btn danger";
    del.title = "Apagar conversa";
    del.type = "button";
    del.textContent = "🗑";
    del.onclick = (e) => { e.stopPropagation(); deleteConversation(c.id); };

    actions.appendChild(del);
    item.appendChild(actions);

    list.appendChild(item);
  }
}

function addMessage(role, content) {
  const wrap = document.createElement("div");
  wrap.className = "msg " + (role === "user" ? "user" : "assistant");

  const bubble = document.createElement("div");
  bubble.className = "bubble";
  bubble.textContent = content || "";

  wrap.appendChild(bubble);
  el("chat").appendChild(wrap);
  el("chat").scrollTop = el("chat").scrollHeight;
}

function renderMessages(messages) {
  const chat = el("chat");
  chat.innerHTML = "";
  for (const m of messages) {
    addMessage(m.role, m.content);
  }
}

function renderFiles(files) {
  const list = el("filesList");
  list.innerHTML = "";
  for (const f of files) {
    const item = document.createElement("div");
    item.className = "file-item";

    const left = document.createElement("div");
    const a = document.createElement("a");
    a.href = `/api/files/${f.id}/download`;
    a.textContent = f.original_name;
    left.appendChild(a);

    const right = document.createElement("div");
    right.className = "meta";
    right.textContent = `${Math.round((f.size_bytes || 0) / 1024)} KB • ${fmtDate(f.created_at)}`;

    item.appendChild(left);
    item.appendChild(right);
    list.appendChild(item);
  }
}

async function refreshConversations() {
  const { conversations: rows } = await api("/api/conversations");
  conversations = rows || [];
  renderConversations();
}

async function openConversation(id) {
  currentConvId = id;
  // close sidebar on mobile after selecting a conversation
  document.body.classList.remove("sidebar-open");
  renderConversations();

  const { conversation, messages, files } = await api(`/api/conversations/${id}/messages`);
  el("convTitle").textContent = conversation?.title || "Conversa";

  // Mode is only visible/usable for admins
  if (me?.role === "admin") {
    el("modeWrap").style.display = "";
    el("modeSelect").value = conversation?.mode || "geral";
  } else {
    el("modeWrap").style.display = "none";
  }

  renderMessages(messages || []);
  renderFiles(files || []);
}

async function createConversation() {
  const payload = { title: "Nova conversa", mode: "geral" };
  const { conversation_id } = await api("/api/conversations", { method: "POST", body: JSON.stringify(payload) });
  await refreshConversations();
  await openConversation(conversation_id);
}

async function deleteConversation(id) {
  if (!confirm("Apagar esta conversa? Isso não pode ser desfeito.")) return;
  await api(`/api/conversations/${id}`, { method: "DELETE" });

  if (currentConvId === id) currentConvId = null;

  // Refresh list after deletion
  await refreshConversations();
  if (!currentConvId && conversations.length) {
    await openConversation(conversations[0].id);
  } else if (!conversations.length) {
    await createConversation();
  }
}




async function sendMessage() {
  const text = el("msg").value.trim();
  if (!text) return;

  el("msg").value = "";
  addMessage("user", text);

  const { reply } = await api(`/api/conversations/${currentConvId}/send`, {
    method: "POST",
    body: JSON.stringify({ message: text }),
  });

  addMessage("assistant", reply || "");
}

async function init() {
  try {
    const r = await api("/api/me");
    me = r.user;

    el("userSub").textContent = `${me.name || "Usuário"} • ${me.email || ""}${me.role ? " • " + me.role : ""}`;

    if (me.role === "admin") {
      el("adminBtn").style.display = "";
      el("modeWrap").style.display = "";
      el("modeSelect").onchange = async () => {
        if (!currentConvId) return;
        const mode = el("modeSelect").value;
        await api(`/api/conversations/${currentConvId}`, { method: "PATCH", body: JSON.stringify({ mode }) });
        await openConversation(currentConvId);
      };
    } else {
      el("adminBtn").style.display = "none";
      el("modeWrap").style.display = "none";
    }

    el("btnLogout").onclick = async () => {
      await api("/api/logout", { method: "POST" });
      location.href = "/login.html";
    };

    el("btnNewChat").onclick = createConversation;

    // Sidebar toggle (ChatGPT-like)
    const applySidebarState = () => {
      const mobile = window.matchMedia("(max-width: 900px)").matches;
      if (mobile) {
        // on mobile, keep collapsed flag but ignore it
        document.body.classList.remove("sidebar-collapsed");
      } else {
        const collapsed = localStorage.getItem("sidebarCollapsed") === "1";
        document.body.classList.toggle("sidebar-collapsed", collapsed);
        document.body.classList.remove("sidebar-open");
      }
    };

    applySidebarState();
    window.addEventListener("resize", applySidebarState);

    const toggleBtn = document.getElementById("btnToggleSidebar");
    const backdrop = document.getElementById("sidebarBackdrop");
    if (toggleBtn) {
      toggleBtn.onclick = () => {
        const mobile = window.matchMedia("(max-width: 900px)").matches;
        if (mobile) {
          document.body.classList.toggle("sidebar-open");
        } else {
          const next = !document.body.classList.contains("sidebar-collapsed");
          document.body.classList.toggle("sidebar-collapsed", next);
          localStorage.setItem("sidebarCollapsed", next ? "1" : "0");
        }
      };
    }
    if (backdrop) backdrop.onclick = () => document.body.classList.remove("sidebar-open");

    // -------- Attach menu + paste screenshot --------
    const closeAttachMenu = () => {
      if (!attachMenu || !btnAttach) return;
      attachMenu.hidden = true;
      btnAttach.setAttribute("aria-expanded", "false");
    };
    const openAttachMenu = () => {
      if (!attachMenu || !btnAttach) return;
      attachMenu.hidden = false;
      btnAttach.setAttribute("aria-expanded", "true");
    };
    if (btnAttach && attachMenu) {
      closeAttachMenu();
      btnAttach.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (attachMenu.hidden) openAttachMenu();
        else closeAttachMenu();
      };
      document.addEventListener("click", (e) => {
        if (attachMenu.hidden) return;
        const t = e.target;
        if (t && (attachMenu.contains(t) || btnAttach.contains(t))) return;
        closeAttachMenu();
      });
    }

    const uploadFile = async (file) => {
      if (!currentConvId) return;
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(`/api/conversations/${currentConvId}/upload`, {
        method: "POST",
        body: fd,
        credentials: "include",
      });
      if (!res.ok) {
        const t = await res.text();
        throw new Error(t || "upload_failed");
      }
      await openConversation(currentConvId);
    };

    if (menuAddFiles) {
      menuAddFiles.onclick = (e) => {
        e.preventDefault();
        closeAttachMenu();
        el("fileInput")?.click();
      };
    }
    if (menuKnowledge) {
      menuKnowledge.onclick = (e) => {
        e.preventDefault();
        closeAttachMenu();
        // Apenas um atalho: seleciona o modo Empresa (quando existir) e dá feedback.
        const sel = el("modeSelect");
        if (sel) {
          sel.value = "empresa";
          toast("Modo: Conhecimento da empresa");
        } else {
          toast("Conhecimento da empresa");
        }
      };
    }
    const soon = (label) => (e) => {
      e.preventDefault();
      closeAttachMenu();
      toast(label + " (em breve)");
    };
    if (menuCreateImage) menuCreateImage.onclick = soon("Criar imagem");
    if (menuDeep) menuDeep.onclick = soon("Pesquisa aprofundada");
    if (menuWeb) menuWeb.onclick = soon("Busca na web");

    // Auto-upload ao escolher arquivo
    el("fileInput").addEventListener("change", async () => {
      const f = el("fileInput").files?.[0];
      if (!f) return;
      try {
        toast("Enviando arquivo...");
        await uploadFile(f);
        toast("Arquivo enviado");
      } catch (err) {
        alert("Erro ao enviar arquivo: " + (err?.message || err));
      } finally {
        el("fileInput").value = "";
      }
    });

    // Colar print (Ctrl+V) direto no chat
    el("msg").addEventListener("paste", async (e) => {
      const items = e.clipboardData?.items;
      if (!items || !items.length) return;
      const images = [];
      for (const it of items) {
        if (it.kind === "file" && it.type && it.type.startsWith("image/")) {
          const blob = it.getAsFile();
          if (blob) images.push(blob);
        }
      }
      if (!images.length) return;
      e.preventDefault();
      try {
        toast(`Enviando ${images.length} imagem(ns)...`);
        for (const img of images) {
          const ts = new Date().toISOString().replace(/[:.]/g, "-");
          const file = new File([img], `print-${ts}.${(img.type.split("/")[1] || "png")}`, { type: img.type });
          await uploadFile(file);
        }
        toast("Print enviado");
      } catch (err) {
        alert("Erro ao enviar print: " + (err?.message || err));
      }
    });

    el("btnSend").onclick = sendMessage;

    el("msg").addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
    });

    // Mantém o form (fallback), mas o upload principal é pelo botão/cola.
    el("uploadForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const f = el("fileInput").files?.[0];
      if (!f) return;
      try {
        toast("Enviando arquivo...");
        await uploadFile(f);
        toast("Arquivo enviado");
      } catch (err) {
        alert("Erro ao enviar arquivo: " + (err?.message || err));
      } finally {
        el("fileInput").value = "";
      }
    });

    await refreshConversations();
    if (conversations.length) {
      await openConversation(conversations[0].id);
    } else {
      await createConversation();
    }
  } catch (e) {
    // Not logged in
    location.href = "/login.html";
  }
}

init();
