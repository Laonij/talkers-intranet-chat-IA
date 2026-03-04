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

const el = (id) => document.getElementById(id);

let currentConvId = null;
let me = null;
let conversations = [];

function openSidebar(open){
  const sb = el('sidebar');
  if (!sb) return;
  sb.classList.toggle('open', !!open);
}

function escapeHtml(s){
  return String(s ?? '')
    .replaceAll('&','&amp;')
    .replaceAll('<','&lt;')
    .replaceAll('>','&gt;')
    .replaceAll('"','&quot;')
    .replaceAll("'",'&#39;');
}

function renderConversations(){
  const list = el('convList');
  if (!list) return;
  list.innerHTML = '';
  for (const c of conversations){
    const div = document.createElement('div');
    div.className = 'conv-item' + (String(c.id)===String(currentConvId) ? ' active' : '');
    div.innerHTML = `
      <div style="flex:1; min-width:0;">
        <div class="conv-title">${escapeHtml(c.title || 'Conversa')}</div>
        <div class="conv-meta">${new Date(c.updated_at || c.created_at).toLocaleString('pt-BR')}</div>
      </div>
    `;
    div.onclick = async ()=>{
      openSidebar(false);
      await openConversation(c.id);
    };
    list.appendChild(div);
  }
}

function renderMessages(messages){
  const chat = el('chat');
  chat.innerHTML = '';
  for (const m of messages){
    const row = document.createElement('div');
    row.className = 'msg-row ' + (m.role === 'user' ? 'user' : 'assistant');

    const bubble = document.createElement('div');
    bubble.className = 'bubble';
    bubble.textContent = m.content || '';
    row.appendChild(bubble);

    chat.appendChild(row);
  }
  chat.scrollTop = chat.scrollHeight;
}

function renderFiles(files){
  const list = el('filesList');
  list.innerHTML = '';
  for (const f of files){
    const div = document.createElement('div');
    div.className = 'file-item';
    div.innerHTML = `
      <div>
        <div class="file-name">${escapeHtml(f.original_name)}</div>
        <div class="file-meta">${Math.round((f.size_bytes||0)/1024)} KB • ${new Date(f.created_at).toLocaleString('pt-BR')}</div>
      </div>
      <a class="btn sm" href="/api/files/${f.id}/download">Baixar</a>
    `;
    list.appendChild(div);
  }
}

async function loadMe(){
  try{
    const data = await api('/api/me');
    me = data.user;
    el('userSub').textContent = `${me.name || 'Usuário'} • ${me.email || ''}`;
    if (me.role === 'admin') el('adminBtn').style.display = '';
  }catch{
    location.href = '/login.html';
  }
}

async function loadConversations(){
  const data = await api('/api/conversations');
  conversations = data.conversations || [];
  renderConversations();
  if (!currentConvId && conversations.length){
    await openConversation(conversations[0].id);
  }
}

async function openConversation(id){
  currentConvId = id;
  renderConversations();

  const data = await api(`/api/conversations/${id}/messages`);
  el('convTitle').textContent = data.conversation?.title || 'Conversa';
  renderMessages(data.messages || []);
  renderFiles(data.files || []);
}

async function newConversation(){
  const data = await api('/api/conversations', { method:'POST', body: JSON.stringify({ title: 'Nova conversa', mode: 'geral' }) });
  currentConvId = data.conversation_id;
  await loadConversations();
  await openConversation(currentConvId);
}

async function sendMessage(){
  const ta = el('msg');
  const text = (ta.value || '').trim();
  if (!text || !currentConvId) return;
  ta.value = '';
  ta.focus();

  // otimista: mostrar mensagem do usuário
  const chat = el('chat');
  const row = document.createElement('div');
  row.className = 'msg-row user';
  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  bubble.textContent = text;
  row.appendChild(bubble);
  chat.appendChild(row);
  chat.scrollTop = chat.scrollHeight;

  try{
    await api(`/api/conversations/${currentConvId}/send`, { method:'POST', body: JSON.stringify({ message: text }) });
    await openConversation(currentConvId);
  }catch(e){
    alert('Erro: ' + e.message);
    await openConversation(currentConvId);
  }
}

async function uploadFile(ev){
  ev.preventDefault();
  if (!currentConvId) return;
  const input = el('fileInput');
  const f = input.files && input.files[0];
  if (!f) return;

  const form = new FormData();
  form.append('file', f);

  const res = await fetch(`/api/conversations/${currentConvId}/upload`, {
    method:'POST',
    credentials:'include',
    body: form
  });
  if (!res.ok){
    const t = await res.text();
    alert('Erro: ' + t);
    return;
  }
  input.value = '';
  await openConversation(currentConvId);
}

function bindUI(){
  el('btnNewChat').onclick = newConversation;
  el('btnSend').onclick = sendMessage;

  el('msg').addEventListener('keydown', (e)=>{
    if (e.key === 'Enter' && !e.shiftKey){
      e.preventDefault();
      sendMessage();
    }
  });

  el('btnLogout').onclick = async ()=>{
    await api('/api/logout', { method:'POST' });
    location.href = '/login.html';
  };

  const menuBtn = el('btnMenu');
  if (menuBtn){
    menuBtn.onclick = ()=> openSidebar(true);
    document.addEventListener('click', (e)=>{
      const sb = el('sidebar');
      if (!sb) return;
      if (!sb.classList.contains('open')) return;
      const clickedInside = sb.contains(e.target) || menuBtn.contains(e.target);
      if (!clickedInside) openSidebar(false);
    });
  }

  el('uploadForm').addEventListener('submit', uploadFile);
}

(async ()=>{
  await loadMe();
  bindUI();
  await loadConversations();
})();
