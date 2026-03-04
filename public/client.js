async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
    credentials: 'include',
    ...opts
  });
  const txt = await res.text();
  let json = null;
  try { json = txt ? JSON.parse(txt) : null; } catch {}
  if (!res.ok) throw new Error(json?.error || txt || `HTTP ${res.status}`);
  return json;
}

function el(id){ return document.getElementById(id); }

let me = null;
let activeConvId = null;

function formatDate(s){
  try { return new Date(s).toLocaleString(); } catch { return s; }
}

document.addEventListener("click", async (e) => {
  const btn = e.target.closest("[data-del-user]");
  if (!btn) return;

  const id = Number(btn.getAttribute("data-del-user"));
  if (!id) return;

  if (!confirm("Tem certeza que deseja excluir este usuário? Isso apagará conversas e arquivos dele.")) return;

  try {
    await api(`/api/admin/users/${id}`, { method: "DELETE" });
    alert("Usuário excluído.");
    location.reload();
  } catch (err) {
    alert("Erro: " + (err?.message || err));
  }
});

function renderMessages(messages){
  const chat = el('chat');
  chat.innerHTML = '';
  for (const m of messages) {
    const div = document.createElement('div');
    div.className = `msg ${m.role === 'user' ? 'user' : 'assistant'}`;
    div.textContent = m.content;

    if (m.meta_json) {
      try {
        const meta = JSON.parse(m.meta_json);
        if (meta?.sources?.length) {
          const metaDiv = document.createElement('div');
          metaDiv.className = 'muted small';
          metaDiv.style.marginTop = '6px';
          metaDiv.innerHTML = 'Fontes: ' + meta.sources.map(s => {
            const id = encodeURIComponent(s.ref || '');
            const title = (s.title || s.ref || '').replace(/[<>]/g,'');
            return `<a href="/api/empresa/doc/${id}/download" target="_blank">${title}</a>`;
          }).join(', ');
          div.appendChild(metaDiv);
        }
      } catch {}
    }

    chat.appendChild(div);
  }
  chat.scrollTop = chat.scrollHeight;
}

function renderFiles(files){
  const list = el('filesList');
  list.innerHTML = '';
  for (const f of files) {
    const chip = document.createElement('div');
    chip.className = 'file-chip';

    const a = document.createElement('a');
    a.href = `/api/files/${f.id}/download`;
    a.textContent = f.original_name;
    a.target = '_blank';
    chip.appendChild(a);

    const small = document.createElement('span');
    small.style.opacity = '0.7';
    small.style.fontSize = '12px';
    small.textContent = `(${Math.round((f.size_bytes||0)/1024)} KB)`;
    chip.appendChild(small);

    list.appendChild(chip);
  }
}

async function loadMe(){
  const data = await api('/api/me');
  me = data.user;
  el('userSub').textContent = `${me.name} • ${me.email} • ${me.role}`;
  if (me.role === 'admin') el('adminBtn').style.display = 'inline-flex';
}

async function loadConversations(){
  const data = await api('/api/conversations');
  const list = el('convList');
  list.innerHTML = '';

  for (const c of data.conversations) {
    const item = document.createElement('div');
    item.className = 'conv-item' + (c.id === activeConvId ? ' active' : '');
    item.onclick = () => openConversation(c.id);

    const t = document.createElement('div');
    t.className = 'conv-title';
    t.textContent = c.title;

    const meta = document.createElement('div');
    meta.className = 'conv-meta';
    meta.innerHTML = `<span>${c.mode}</span><span>${formatDate(c.updated_at)}</span>`;

    item.appendChild(t);
    item.appendChild(meta);
    list.appendChild(item);
  }
  return data.conversations;
}

async function openConversation(id){
  activeConvId = id;
  await loadConversations();

  const data = await api(`/api/conversations/${id}/messages`);
  el('convTitle').textContent = data.conversation.title;
  el('modeSelect').value = data.conversation.mode;

  renderMessages(data.messages);
  renderFiles(data.files);
}

async function createConversation(){
  const title = prompt("Título da conversa:", "Nova conversa");
  const mode = el('modeSelect').value || 'geral';
  const data = await api('/api/conversations', { method:'POST', body: JSON.stringify({ title, mode }) });
  await openConversation(data.conversation_id);
}

async function sendMessage(){
  const msgEl = el('msg');
  const text = msgEl.value.trim();
  if (!text) return;

  if (!activeConvId) {
    const data = await api('/api/conversations', { method:'POST', body: JSON.stringify({ title: 'Nova conversa', mode: el('modeSelect').value }) });
    activeConvId = data.conversation_id;
  }

  msgEl.value = '';

  const chat = el('chat');
  const div = document.createElement('div');
  div.className = 'msg user';
  div.textContent = text;
  chat.appendChild(div);
  chat.scrollTop = chat.scrollHeight;

  const res = await api(`/api/conversations/${activeConvId}/send`, { method:'POST', body: JSON.stringify({ message: text }) });

  const a = document.createElement('div');
  a.className = 'msg assistant';
  a.textContent = res.reply;
  chat.appendChild(a);
  chat.scrollTop = chat.scrollHeight;

  await loadConversations();
}

async function setMode(){
  if (!activeConvId) return;
  const mode = el('modeSelect').value;
  await api(`/api/conversations/${activeConvId}`, { method:'PATCH', body: JSON.stringify({ mode }) });
  await openConversation(activeConvId);
}

async function logout(){
  await api('/api/logout', { method:'POST' });
  location.href = '/login.html';
}

async function uploadFile(e){
  e.preventDefault();
  if (!activeConvId) {
    alert("Crie/abra uma conversa antes de enviar arquivo.");
    return;
  }
  const input = el('fileInput');
  if (!input.files || !input.files[0]) return;

  const fd = new FormData();
  fd.append('file', input.files[0]);

  const res = await fetch(`/api/conversations/${activeConvId}/upload`, { method:'POST', body: fd, credentials: 'include' });
  if (!res.ok) {
    const t = await res.text();
    alert("Erro ao enviar arquivo: " + t);
    return;
  }
  input.value = '';
  await openConversation(activeConvId);
}

async function init(){
  try {
    await loadMe();
    const convs = await loadConversations();
    if (convs.length) await openConversation(convs[0].id);
  } catch (e) {
    location.href = '/login.html';
    return;
  }

  el('btnNewChat').onclick = createConversation;
  el('btnSend').onclick = sendMessage;
  el('btnLogout').onclick = logout;
  el('modeSelect').onchange = setMode;
  el('uploadForm').addEventListener('submit', uploadFile);

  el('msg').addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter' && !ev.shiftKey) {
      ev.preventDefault();
      sendMessage();
    }
  });
}

init();
