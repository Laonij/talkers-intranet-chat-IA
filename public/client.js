/* The Boss IA - client */

const el = (id) => document.getElementById(id);

const state = {
  me: null,
  conversations: [],
  currentConvId: null,
  sidebarOpenMobile: false,
};

function escapeHtml(s) {
  return (s ?? '').replace(/[&<>"']/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}

async function api(path, opts = {}) {
  const res = await fetch(path, {
    credentials: 'include',
    headers: opts.body instanceof FormData ? undefined : { 'Content-Type': 'application/json', ...(opts.headers || {}) },
    ...opts,
  });

  const txt = await res.text();
  let data = null;
  try { data = txt ? JSON.parse(txt) : null; } catch { data = txt; }

  if (!res.ok) {
    const msg = (data && data.error) ? data.error : `HTTP ${res.status}`;
    const err = new Error(msg);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

function openSidebarMobile(v) {
  state.sidebarOpenMobile = v;
  document.body.classList.toggle('sidebar-open', v);
  const bd = el('sidebarBackdrop');
  if (bd) bd.style.display = v ? 'block' : 'none';
}

function renderUser() {
  const sub = el('userSub');
  if (sub && state.me) {
    sub.textContent = `${state.me?.name || 'Admin'} • ${state.me?.email || ''} • ${state.me?.role || ''}`;
  }
  const adminBtn = el('adminBtn');
  if (adminBtn) {
    adminBtn.style.display = state.me?.role === 'admin' ? 'inline-flex' : 'none';
  }
}

function formatDate(d) {
  if (!d) return '';
  const s = String(d).slice(0, 10);
  const [y,m,dd] = s.split('-');
  if (!y || !m || !dd) return s;
  return `${dd}/${m}/${y}`;
}

async function refreshConversations() {
  state.conversations = (await api('/api/conversations')).conversations || [];
  renderConversations();
}

function renderConversations() {
  const list = el('convList');
  if (!list) return;
  list.innerHTML = '';

  for (const c of state.conversations) {
    const item = document.createElement('div');
    item.className = 'conv' + (c.id === state.currentConvId ? ' active' : '');

    const left = document.createElement('div');
    left.style.flex = '1';

    const title = document.createElement('div');
    title.className = 'conv-title';
    title.textContent = c.title || 'Nova conversa';

    const meta = document.createElement('div');
    meta.className = 'conv-meta';
    meta.textContent = formatDate(c.updated_at || c.created_at);

    left.appendChild(title);
    left.appendChild(meta);

    const del = document.createElement('button');
    del.className = 'conv-del';
    del.title = 'Apagar conversa';
    del.innerHTML = '🗑️';
    del.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!confirm('Apagar esta conversa? Isso não pode ser desfeito.')) return;
      try {
        await api(`/api/conversations/${c.id}`, { method: 'DELETE' });
        if (state.currentConvId === c.id) state.currentConvId = null;
        await refreshConversations();
        if (state.conversations.length) {
          await openConversation(state.conversations[0].id);
        } else {
          clearChat();
        }
      } catch (err) {
        alert('Não foi possível apagar a conversa. ' + err.message);
      }
    });

    item.appendChild(left);
    item.appendChild(del);

    item.addEventListener('click', async () => {
      await openConversation(c.id);
      openSidebarMobile(false);
    });

    list.appendChild(item);
  }
}

function clearChat() {
  const chat = el('chat');
  if (chat) chat.innerHTML = '';
}

function scrollChatToBottom() {
  const chat = el('chat');
  if (!chat) return;
  chat.scrollTop = chat.scrollHeight;
}

function addBubble({ role, content, created_at, meta }) {
  const chat = el('chat');
  if (!chat) return;

  const wrap = document.createElement('div');
  wrap.className = 'msg ' + (role === 'user' ? 'user' : 'assistant');

  const bubble = document.createElement('div');
  bubble.className = 'bubble';

  if (meta && meta.type === 'file' && meta.file_id) {
    const isImg = (meta.mimetype || '').startsWith('image/');
    const dlUrl = `/api/files/${meta.file_id}/download`;

    const card = document.createElement('div');
    card.className = 'file-card';

    if (isImg) {
      const img = document.createElement('img');
      img.className = 'file-thumb';
      img.src = dlUrl;
      img.alt = meta.filename || 'imagem';
      card.appendChild(img);
    } else {
      const ic = document.createElement('div');
      ic.className = 'file-ic';
      ic.textContent = '📎';
      card.appendChild(ic);
    }

    const txt = document.createElement('div');
    txt.innerHTML = `
      <div><a href="${dlUrl}" target="_blank" rel="noopener">${escapeHtml(meta.filename || 'arquivo')}</a></div>
      <div style="font-size:12px;opacity:.7;">${escapeHtml(meta.mimetype || '')}</div>
    `;
    card.appendChild(txt);
    bubble.appendChild(card);
  } else {
    bubble.innerHTML = escapeHtml(content || '').replace(/\n/g, '<br/>');
  }

  const time = document.createElement('div');
  time.className = 'time';
  time.textContent = created_at ? new Date(created_at).toLocaleString() : '';

  wrap.appendChild(bubble);
  wrap.appendChild(time);
  chat.appendChild(wrap);
}

async function openConversation(id) {
  state.currentConvId = id;
  renderConversations();
  clearChat();

  const title = el('convTitle');
  const c = state.conversations.find((x) => x.id === id);
  if (title) title.textContent = c?.title || 'Conversa';

  const data = await api(`/api/conversations/${id}/messages`);
  const msgs = data?.messages || [];
  for (const m of msgs) {
    addBubble({ role: m.role, content: m.content, created_at: m.created_at, meta: m.meta || null });
  }
  scrollChatToBottom();
}

async function ensureConversation() {
  if (state.currentConvId) return state.currentConvId;
  const created = await api('/api/conversations', { method: 'POST', body: JSON.stringify({ title: 'Nova conversa' }) });
  await refreshConversations();
  await openConversation(created.conversation_id);
  return created.id;
}

async function sendMessage() {
  const textarea = el('msg');
  const mode = el('modeSelect')?.value || 'geral';
  const content = (textarea?.value || '').trim();
  if (!content) return;

  const convId = await ensureConversation();

  textarea.value = '';
  autoResizeComposer();
  addBubble({ role: 'user', content, created_at: new Date().toISOString() });
  scrollChatToBottom();

  const chat = el('chat');
  const typing = document.createElement('div');
  typing.className = 'msg assistant';
  typing.innerHTML = `<div class="bubble">...</div><div class="time"></div>`;
  chat.appendChild(typing);
  scrollChatToBottom();

  try {
    const resp = await api(`/api/conversations/${convId}/send`, {
      method: 'POST',
      body: JSON.stringify({ message: content, mode }),
    });
    typing.remove();
    addBubble({ role: 'assistant', content: resp.reply || 'OK', created_at: new Date().toISOString() });
    await refreshConversations();
    scrollChatToBottom();
  } catch (err) {
    typing.remove();
    addBubble({ role: 'assistant', content: 'Erro: ' + err.message, created_at: new Date().toISOString() });
    scrollChatToBottom();
  }
}


function autoResizeComposer() {
  const textarea = el('msg');
  if (!textarea) return;
  textarea.style.height = 'auto';
  textarea.style.height = Math.min(textarea.scrollHeight, 160) + 'px';
}

function closeAttachMenu() {

  const menu = el('attachMenu');
  if (menu) menu.style.display = 'none';
}

async function uploadFiles(fileList) {
  const files = Array.from(fileList || []);
  if (!files.length) return;

  const convId = await ensureConversation();

  for (const file of files) {
    const fd = new FormData();
    fd.append('file', file);
    try {
      await api(`/api/conversations/${convId}/files`, { method: 'POST', body: fd });
    } catch (err) {
      addBubble({ role: 'assistant', content: `Erro ao enviar arquivo "${file.name}": ${err.message}`, created_at: new Date().toISOString() });
    }
  }

  await openConversation(convId);
  await refreshConversations();
  closeAttachMenu();
}

function setupAttachments() {
  const btnAttach = el('btnAttach');
  const menu = el('attachMenu');
  const menuUpload = el('menuUpload');
  const input = el('attachInput');

  btnAttach?.addEventListener('click', () => {
    if (!menu) return;
    menu.style.display = (menu.style.display === 'none' || !menu.style.display) ? 'block' : 'none';
  });

  menuUpload?.addEventListener('click', () => input?.click());

  input?.addEventListener('change', async () => {
    await uploadFiles(input.files);
    input.value = '';
  });

  document.addEventListener('click', (e) => {
    if (!menu || menu.style.display === 'none') return;
    const inside = menu.contains(e.target) || btnAttach?.contains(e.target);
    if (!inside) closeAttachMenu();
  });

  const textarea = el('msg');
  textarea?.addEventListener('paste', async (e) => {
    const items = e.clipboardData?.items;
    if (!items) return;

    const imgs = [];
    for (const it of items) {
      if (it.kind === 'file') {
        const f = it.getAsFile();
        if (f && (f.type || '').startsWith('image/')) imgs.push(f);
      }
    }
    if (!imgs.length) return;

    e.preventDefault();

    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const renamed = imgs.map((f, i) => new File([f], `print-${stamp}${i ? '-' + i : ''}.png`, { type: f.type || 'image/png' }));
    await uploadFiles(renamed);
  });
}

async function init() {
  try {
    state.me = (await api('/api/me')).user;
  } catch {
    location.href = '/login.html';
    return;
  }

  renderUser();

  el('btnToggleSidebar')?.addEventListener('click', () => openSidebarMobile(!state.sidebarOpenMobile));
  el('sidebarBackdrop')?.addEventListener('click', () => openSidebarMobile(false));

  el('btnNewChat')?.addEventListener('click', async () => {
    state.currentConvId = null;
    await ensureConversation();
    openSidebarMobile(false);
  });

  el('btnLogout')?.addEventListener('click', async () => {
    await api('/api/logout', { method: 'POST' });
      location.href = '/login.html';
  });

  el('btnSend')?.addEventListener('click', sendMessage);
  el('msg')?.addEventListener('input', autoResizeComposer);
  el('msg')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });
  autoResizeComposer();

  await refreshConversations();
  if (state.conversations.length) {
    await openConversation(state.conversations[0].id);
  } else {
    await ensureConversation();
  }

  setupAttachments();
}

window.addEventListener('DOMContentLoaded', init);
