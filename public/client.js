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

let me = null;
let currentConvId = null;

function fmtDate(s){
  try { return new Date(s).toLocaleDateString('pt-BR'); } catch { return ''; }
}

function escapeHtml(str){
  return (str||'').replace(/[&<>"']/g, (m)=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m]));
}

function setSidebar(open){
  const sb = el('sidebar');
  if (!sb) return;
  sb.classList.toggle('open', !!open);
}

async function loadMe(){
  try {
    const r = await api('/api/me');
    me = r.user;
    el('userSub').textContent = `${me.name || '—'} • ${me.email || '—'} • ${me.role || 'user'}`;
    if (me.role === 'admin') el('adminBtn').style.display = 'inline-flex';

    // Modo Empresa só para admin (evita confusão)
    const modeWrap = el('modeWrap');
    const hint = el('empresaHint');
    if (me.role === 'admin') {
      modeWrap.style.display = 'flex';
    } else {
      modeWrap.style.display = 'none';
      hint.style.display = 'none';
    }
  } catch (e) {
    location.href = '/login.html';
  }
}

async function listConversations(){
  const r = await api('/api/conversations');
  const list = el('convList');
  list.innerHTML = '';
  (r.conversations || []).forEach((c)=>{
    const div = document.createElement('div');
    div.className = 'conv-item' + (String(c.id)===String(currentConvId) ? ' active' : '');
    div.innerHTML = `
      <div style="min-width:0">
        <div class="conv-title" title="${escapeHtml(c.title)}">${escapeHtml(c.title)}</div>
        <div class="conv-meta">${fmtDate(c.updated_at)}</div>
      </div>
      <div class="conv-meta">›</div>
    `;
    div.onclick = ()=> openConversation(c.id);
    list.appendChild(div);
  });
}

function renderMessages(messages){
  const chat = el('chat');
  chat.innerHTML = '';
  (messages||[]).forEach((m)=>{
    const row = document.createElement('div');
    row.className = 'msg ' + (m.role === 'user' ? 'user' : 'assistant');
    const avatar = document.createElement('div');
    avatar.className = 'avatar';
    avatar.textContent = m.role === 'user' ? 'U' : 'AI';
    const bubble = document.createElement('div');
    bubble.className = 'bubble';
    bubble.textContent = m.content || '';
    if (m.role === 'user') {
      row.appendChild(bubble);
    } else {
      row.appendChild(avatar);
      row.appendChild(bubble);
    }
    chat.appendChild(row);
  });
  chat.scrollTop = chat.scrollHeight;
}

function renderFiles(files){
  const list = el('filesList');
  list.innerHTML = '';
  (files||[]).forEach((f)=>{
    const row = document.createElement('div');
    row.className='file-row';
    row.innerHTML = `
      <div style="min-width:0">
        <div style="font-weight:700; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escapeHtml(f.original_name)}</div>
        <div class="conv-meta">${(f.size_bytes||0)} bytes</div>
      </div>
      <a class="btn" href="/api/files/${f.id}/download">Baixar</a>
    `;
    list.appendChild(row);
  });
}

async function openConversation(id){
  currentConvId = id;
  const r = await api(`/api/conversations/${id}/messages`);
  el('convTitle').textContent = r.conversation?.title || '—';
  renderMessages(r.messages);
  renderFiles(r.files);
  // atualizar select modo (admin only)
  const modeSelect = el('modeSelect');
  if (me?.role === 'admin' && modeSelect) {
    modeSelect.value = r.conversation?.mode === 'empresa' ? 'empresa' : 'geral';
    el('empresaHint').style.display = (modeSelect.value === 'empresa') ? 'block' : 'none';
  }
  await listConversations();
  setSidebar(false);
}

async function newConversation(){
  const mode = (me?.role === 'admin' && el('modeSelect')?.value === 'empresa') ? 'empresa' : 'geral';
  const r = await api('/api/conversations', { method:'POST', body: JSON.stringify({ title:'Nova conversa', mode }) });
  await listConversations();
  await openConversation(r.conversation_id);
}

async function sendMessage(){
  const ta = el('msg');
  const text = (ta.value || '').trim();
  if (!text || !currentConvId) return;

  ta.value='';
  // optimistic
  const chat = el('chat');
  const row = document.createElement('div');
  row.className='msg user';
  const bubble = document.createElement('div');
  bubble.className='bubble';
  bubble.textContent=text;
  row.appendChild(bubble);
  chat.appendChild(row);
  chat.scrollTop = chat.scrollHeight;

  try{
    const r = await api(`/api/conversations/${currentConvId}/send`, { method:'POST', body: JSON.stringify({ message:text }) });
    await openConversation(currentConvId);
  }catch(e){
    alert('Erro ao enviar: ' + (e.message||''));
  }
}

async function uploadFile(ev){
  ev.preventDefault();
  if (!currentConvId) return;
  const f = el('fileInput').files[0];
  if (!f) return;
  const fd = new FormData();
  fd.append('file', f);
  const res = await fetch(`/api/conversations/${currentConvId}/upload`, { method:'POST', body: fd, credentials:'include' });
  if(!res.ok){
    const t = await res.text();
    alert('Erro upload: ' + t);
    return;
  }
  el('fileInput').value = '';
  await openConversation(currentConvId);
}

async function logout(){
  try{ await api('/api/logout', { method:'POST' }); }catch{}
  location.href='/login.html';
}

window.addEventListener('DOMContentLoaded', async ()=>{
  await loadMe();
  await listConversations();

  el('btnNewChat').onclick = newConversation;
  el('btnSend').onclick = sendMessage;
  el('btnLogout').onclick = logout;
  el('uploadForm').addEventListener('submit', uploadFile);

  const toggle = el('btnToggleSidebar');
  if (toggle) toggle.onclick = ()=> setSidebar(true);

  const modeSelect = el('modeSelect');
  if (modeSelect) {
    modeSelect.addEventListener('change', async ()=>{
      if (me?.role !== 'admin' || !currentConvId) return;
      const mode = modeSelect.value === 'empresa' ? 'empresa' : 'geral';
      await api(`/api/conversations/${currentConvId}`, { method:'PATCH', body: JSON.stringify({ mode }) });
      el('empresaHint').style.display = (mode === 'empresa') ? 'block' : 'none';
    });
  }

  // open first conv if exists
  const r = await api('/api/conversations');
  if ((r.conversations||[]).length) {
    await openConversation(r.conversations[0].id);
  } else {
    await newConversation();
  }

  // keyboard send
  el('msg').addEventListener('keydown', (e)=>{
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });
});
