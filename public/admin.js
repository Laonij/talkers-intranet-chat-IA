const i18n = () => window.TalkersI18n;
const state = {
  activeTab: 'users',
  users: [],
  departments: [],
  submenus: [],
  announcements: [],
  logs: null,
};

function el(id) {
  return document.getElementById(id);
}

async function api(path, opts = {}) {
  const isFormData = opts.body instanceof FormData;
  const res = await fetch(path, {
    credentials: 'include',
    headers: isFormData
      ? { ...(i18n()?.buildHeaders?.() || {}), ...(opts.headers || {}) }
      : {
          'Content-Type': 'application/json',
          ...(i18n()?.buildHeaders?.() || {}),
          ...(opts.headers || {}),
        },
    ...opts,
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch {}
  if (!res.ok) throw new Error(data?.error || text || `HTTP ${res.status}`);
  return data;
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function slugify(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function setStatus(message, type = 'muted') {
  const node = el('adminStatus');
  if (!node) return;
  node.className = type === 'error' ? 'small error' : 'small muted';
  node.textContent = message || '';
}

function setActiveTab(tab) {
  state.activeTab = tab;
  document.querySelectorAll('[data-admin-tab]').forEach((button) => {
    button.classList.toggle('is-active', button.dataset.adminTab === tab);
  });
  document.querySelectorAll('[data-admin-chunk]').forEach((chunk) => {
    chunk.hidden = chunk.dataset.adminChunk !== tab;
  });

  const titles = {
    users: ['Usuários cadastrados', 'Gerencie acessos, departamentos e perfis.'],
    departments: ['Departamentos e submenus', 'Organize as áreas e a navegação da intranet.'],
    announcements: ['Comunicados da intranet', 'Publique, edite e acompanhe avisos internos.'],
    logs: ['Logs do sistema', 'Acompanhe auditoria, processamento e histórico administrativo.'],
  };
  const [title, subtitle] = titles[tab] || titles.users;
  el('adminListTitle').textContent = title;
  el('adminListSubtitle').textContent = subtitle;
  renderListPane();
}

function renderDepartmentOptions() {
  const departmentSelect = el('submenuDepartmentId');
  const announcementSelect = el('announcementDepartmentIds');
  const grid = el('departmentsGrid');
  if (departmentSelect) {
    departmentSelect.innerHTML = '<option value="">Selecione</option>' + state.departments
      .map((department) => `<option value="${department.id}">${escapeHtml(department.name)}</option>`)
      .join('');
  }
  if (announcementSelect) {
    announcementSelect.innerHTML = state.departments
      .map((department) => `<option value="${department.id}">${escapeHtml(department.name)}</option>`)
      .join('');
  }
  if (grid) {
    grid.innerHTML = state.departments.map((department) => `
      <label class="admin-check-row">
        <input type="checkbox" name="userDepartments" value="${department.name}" />
        <span>
          <strong>${escapeHtml(department.name)}</strong>
          <small>${escapeHtml(department.description || department.slug || 'Departamento')}</small>
        </span>
      </label>
    `).join('');
  }
}

function selectedUserDepartments() {
  return Array.from(document.querySelectorAll('input[name="userDepartments"]:checked')).map((input) => input.value);
}

function selectedAnnouncementDepartments() {
  return Array.from(el('announcementDepartmentIds')?.selectedOptions || [])
    .map((option) => Number(option.value))
    .filter(Boolean);
}

function resetUserForm() {
  el('editingUserId').value = '';
  el('userFormTitle').textContent = 'Criar usuário';
  el('btnSaveUser').textContent = 'Salvar usuário';
  el('btnCancelUserEdit').style.display = 'none';
  ['name', 'email', 'password', 'jobTitle', 'unitName'].forEach((id) => { el(id).value = ''; });
  el('role').value = 'user';
  el('canAccessIntranet').checked = false;
  document.querySelectorAll('input[name="userDepartments"]').forEach((input) => { input.checked = false; });
}

function resetDepartmentForm() {
  el('editingDepartmentId').value = '';
  el('departmentFormTitle').textContent = 'Criar departamento';
  el('btnSaveDepartment').textContent = 'Salvar departamento';
  el('btnCancelDepartmentEdit').style.display = 'none';
  ['departmentName', 'departmentSlug', 'departmentDescription', 'departmentIcon'].forEach((id) => { el(id).value = ''; });
  el('departmentActive').checked = true;
}

function resetSubmenuForm() {
  el('editingSubmenuId').value = '';
  el('submenuFormTitle').textContent = 'Criar submenu de departamento';
  el('btnSaveSubmenu').textContent = 'Salvar submenu';
  el('btnCancelSubmenuEdit').style.display = 'none';
  ['submenuTitle', 'submenuSlug', 'submenuViewKey', 'submenuDescription', 'submenuIcon'].forEach((id) => { el(id).value = ''; });
  el('submenuDepartmentId').value = '';
  el('submenuActive').checked = true;
}

function resetAnnouncementForm() {
  el('announcementId').value = '';
  el('announcementFormTitle').textContent = 'Publicar comunicado';
  el('btnSaveAnnouncement').textContent = 'Salvar comunicado';
  el('btnCancelAnnouncementEdit').style.display = 'none';
  ['announcementTitle', 'announcementSummary', 'announcementContent', 'announcementStartsAt', 'announcementEndsAt'].forEach((id) => { el(id).value = ''; });
  el('announcementType').value = 'announcement';
  el('announcementPriority').value = 'normal';
  el('announcementAudienceScope').value = 'all';
  el('announcementPinned').checked = false;
  el('announcementActive').checked = true;
  Array.from(el('announcementDepartmentIds')?.options || []).forEach((option) => { option.selected = false; });
  syncAnnouncementDepartmentVisibility();
}

function syncAnnouncementDepartmentVisibility() {
  const select = el('announcementDepartmentIds');
  if (!select) return;
  select.disabled = el('announcementAudienceScope').value !== 'departments';
}

function renderUserList() {
  const content = el('adminListContent');
  if (!content) return;
  if (!state.users.length) {
    content.innerHTML = '<div class="intranet-empty-card">Nenhum usuário cadastrado.</div>';
    return;
  }
  content.innerHTML = state.users.map((user) => `
    <article class="admin-list-item">
      <div>
        <strong>${escapeHtml(user.name)}</strong>
        <div class="small muted">${escapeHtml(user.email)} · ${escapeHtml(user.role)}</div>
        <div class="small muted">${escapeHtml((user.departments || []).join(', ') || user.department || 'Sem departamentos')}</div>
      </div>
      <div class="admin-inline-actions">
        <button class="btn" type="button" data-user-edit="${user.id}">Editar</button>
      </div>
    </article>
  `).join('');
}

function renderDepartmentList() {
  const content = el('adminListContent');
  if (!content) return;
  const cards = [];
  state.departments.forEach((department) => {
    const related = state.submenus.filter((submenu) => Number(submenu.department_id) === Number(department.id));
    cards.push(`
      <article class="admin-list-item">
        <div>
          <strong>${escapeHtml(department.name)}</strong>
          <div class="small muted">${escapeHtml(department.slug)} · ${department.is_active ? 'Ativo' : 'Inativo'} · ${Number(department.total_users || 0)} usuário(s)</div>
          <div class="small muted">${escapeHtml(department.description || 'Sem descrição')}</div>
          ${related.length ? `<div class="small muted">Submenus: ${escapeHtml(related.map((item) => item.title).join(', '))}</div>` : ''}
        </div>
        <div class="admin-inline-actions">
          <button class="btn" type="button" data-department-edit="${department.id}">Editar</button>
          <button class="btn" type="button" data-department-delete="${department.id}">Excluir</button>
        </div>
      </article>
    `);
  });
  cards.push(...state.submenus.map((submenu) => `
    <article class="admin-list-item">
      <div>
        <strong>${escapeHtml(submenu.title)}</strong>
        <div class="small muted">${escapeHtml(submenu.department_name || 'Departamento')} · ${escapeHtml(submenu.slug)} · ${submenu.is_active ? 'Ativo' : 'Inativo'}</div>
        <div class="small muted">${escapeHtml(submenu.description || 'Sem descrição')}</div>
      </div>
      <div class="admin-inline-actions">
        <button class="btn" type="button" data-submenu-edit="${submenu.id}">Editar</button>
        <button class="btn" type="button" data-submenu-delete="${submenu.id}">Excluir</button>
      </div>
    </article>
  `));
  content.innerHTML = cards.join('') || '<div class="intranet-empty-card">Nenhum departamento cadastrado.</div>';
}

function renderAnnouncementList() {
  const content = el('adminListContent');
  if (!content) return;
  if (!state.announcements.length) {
    content.innerHTML = '<div class="intranet-empty-card">Nenhum comunicado cadastrado.</div>';
    return;
  }
  content.innerHTML = state.announcements.map((item) => `
    <article class="admin-list-item">
      <div>
        <strong>${escapeHtml(item.title)}</strong>
        <div class="small muted">${escapeHtml(item.announcement_type || 'announcement')} · ${escapeHtml(item.priority || 'normal')} · ${item.is_active ? 'Ativo' : 'Inativo'}</div>
        <div class="small muted">${escapeHtml(item.summary_text || item.content_text || '')}</div>
      </div>
      <div class="admin-inline-actions">
        <button class="btn" type="button" data-announcement-edit="${item.id}">Editar</button>
        <button class="btn" type="button" data-announcement-delete="${item.id}">Excluir</button>
      </div>
    </article>
  `).join('');
}

function renderLogList(containerId, items, formatter) {
  const container = el(containerId);
  if (!container) return;
  if (!Array.isArray(items) || !items.length) {
    container.innerHTML = '<div class="intranet-empty-card">Nenhum evento recente.</div>';
    return;
  }
  container.innerHTML = items.map(formatter).join('');
}

function renderLogs() {
  const content = el('adminListContent');
  if (content) {
    content.innerHTML = '<div class="intranet-empty-card">Os detalhes dos logs aparecem no painel ao lado.</div>';
  }
  const logs = state.logs || {};
  renderLogList('auditLogsList', logs.audit_logs || [], (item) => `
    <article class="system-log-item">
      <strong>${escapeHtml(item.action || '-')}</strong>
      <div class="small muted">${escapeHtml(item.actor_name || 'Sistema')} · ${escapeHtml(item.created_at || '')}</div>
      <div class="small muted">${escapeHtml(item.meta_json || '')}</div>
    </article>
  `);
  renderLogList('processingLogsList', logs.processing_logs || [], (item) => `
    <article class="system-log-item">
      <strong>${escapeHtml(item.stage_key || '-')} · ${escapeHtml(item.stage_status || '-')}</strong>
      <div class="small muted">${escapeHtml(item.file_name || 'Arquivo interno')} · ${escapeHtml(item.created_at || '')}</div>
      <div class="small muted">${escapeHtml(item.message || '')}</div>
    </article>
  `);
  renderLogList('calendarLogsList', logs.calendar_logs || [], (item) => `
    <article class="system-log-item">
      <strong>${escapeHtml(item.event_type || '-')}</strong>
      <div class="small muted">${escapeHtml(item.actor_name || 'Sistema')} · ${escapeHtml(item.created_at || '')}</div>
      <div class="small muted">${escapeHtml(item.detail_text || '')}</div>
    </article>
  `);
  renderLogList('trainingLogsList', logs.training_logs || [], (item) => `
    <article class="system-log-item">
      <strong>${escapeHtml(item.training_title || item.event_type || '-')}</strong>
      <div class="small muted">${escapeHtml(item.actor_name || 'Sistema')} · ${escapeHtml(item.created_at || '')}</div>
      <div class="small muted">${escapeHtml(item.event_notes || item.detail_text || '')}</div>
    </article>
  `);
}

function renderListPane() {
  if (state.activeTab === 'users') return renderUserList();
  if (state.activeTab === 'departments') return renderDepartmentList();
  if (state.activeTab === 'announcements') return renderAnnouncementList();
  return renderLogs();
}

async function loadAdminData() {
  setStatus('Atualizando dados do admin...');
  const [usersData, departmentsData, submenusData, announcementsData, logsData] = await Promise.all([
    api('/api/admin/users'),
    api('/api/admin/departments'),
    api('/api/admin/department-submenus'),
    api('/api/admin/intranet/announcements'),
    api('/api/admin/system-logs'),
  ]);
  state.users = usersData.users || [];
  state.departments = departmentsData.departments || [];
  state.submenus = submenusData.submenus || [];
  state.announcements = announcementsData.announcements || [];
  state.logs = logsData || null;
  renderDepartmentOptions();
  renderListPane();
  setStatus('Dados carregados com sucesso.');
}

function fillUserForm(userId) {
  const user = state.users.find((item) => Number(item.id) === Number(userId));
  if (!user) return;
  el('editingUserId').value = user.id;
  el('userFormTitle').textContent = `Editar usuário #${user.id}`;
  el('btnSaveUser').textContent = 'Salvar alterações';
  el('btnCancelUserEdit').style.display = '';
  el('name').value = user.name || '';
  el('email').value = user.email || '';
  el('password').value = '';
  el('role').value = user.role === 'admin' ? 'admin' : 'user';
  el('jobTitle').value = user.job_title || '';
  el('unitName').value = user.unit_name || '';
  el('canAccessIntranet').checked = Boolean(user.can_access_intranet);
  const departmentNames = new Set(Array.isArray(user.departments) ? user.departments : []);
  document.querySelectorAll('input[name="userDepartments"]').forEach((input) => {
    input.checked = departmentNames.has(input.value);
  });
  setActiveTab('users');
}

function fillDepartmentForm(departmentId) {
  const department = state.departments.find((item) => Number(item.id) === Number(departmentId));
  if (!department) return;
  el('editingDepartmentId').value = department.id;
  el('departmentFormTitle').textContent = `Editar departamento #${department.id}`;
  el('btnSaveDepartment').textContent = 'Salvar alterações';
  el('btnCancelDepartmentEdit').style.display = '';
  el('departmentName').value = department.name || '';
  el('departmentSlug').value = department.slug || '';
  el('departmentDescription').value = department.description || '';
  el('departmentIcon').value = department.icon || '';
  el('departmentActive').checked = Boolean(department.is_active);
  setActiveTab('departments');
}

function fillSubmenuForm(submenuId) {
  const submenu = state.submenus.find((item) => Number(item.id) === Number(submenuId));
  if (!submenu) return;
  el('editingSubmenuId').value = submenu.id;
  el('submenuFormTitle').textContent = `Editar submenu #${submenu.id}`;
  el('btnSaveSubmenu').textContent = 'Salvar alterações';
  el('btnCancelSubmenuEdit').style.display = '';
  el('submenuDepartmentId').value = submenu.department_id || '';
  el('submenuTitle').value = submenu.title || '';
  el('submenuSlug').value = submenu.slug || '';
  el('submenuViewKey').value = submenu.view_key || '';
  el('submenuDescription').value = submenu.description || '';
  el('submenuIcon').value = submenu.icon || '';
  el('submenuActive').checked = Boolean(submenu.is_active);
  setActiveTab('departments');
}

function fillAnnouncementForm(announcementId) {
  const item = state.announcements.find((entry) => Number(entry.id) === Number(announcementId));
  if (!item) return;
  el('announcementId').value = item.id;
  el('announcementFormTitle').textContent = `Editar comunicado #${item.id}`;
  el('btnSaveAnnouncement').textContent = 'Salvar alterações';
  el('btnCancelAnnouncementEdit').style.display = '';
  el('announcementTitle').value = item.title || '';
  el('announcementSummary').value = item.summary_text || '';
  el('announcementContent').value = item.content_text || '';
  el('announcementType').value = item.announcement_type || 'announcement';
  el('announcementPriority').value = item.priority || 'normal';
  el('announcementAudienceScope').value = item.audience_scope || 'all';
  el('announcementStartsAt').value = item.starts_at ? String(item.starts_at).slice(0, 16) : '';
  el('announcementEndsAt').value = item.ends_at ? String(item.ends_at).slice(0, 16) : '';
  el('announcementPinned').checked = Boolean(item.is_pinned);
  el('announcementActive').checked = Boolean(item.is_active);
  const selected = new Set(Array.isArray(item.department_ids) ? item.department_ids.map((id) => Number(id)) : []);
  Array.from(el('announcementDepartmentIds').options).forEach((option) => {
    option.selected = selected.has(Number(option.value));
  });
  syncAnnouncementDepartmentVisibility();
  setActiveTab('announcements');
}

async function saveUser() {
  const id = Number(el('editingUserId').value || 0);
  const payload = {
    name: el('name').value.trim(),
    email: el('email').value.trim(),
    password: el('password').value,
    role: el('role').value,
    departments: selectedUserDepartments(),
    can_access_intranet: el('canAccessIntranet').checked,
    job_title: el('jobTitle').value.trim(),
    unit_name: el('unitName').value.trim(),
  };
  if (!payload.name || !payload.email || (!id && !payload.password)) {
    setStatus('Preencha nome, email e senha para criar um novo usuário.', 'error');
    return;
  }
  const endpoint = id ? `/api/admin/users/${id}` : '/api/admin/users';
  const method = id ? 'PATCH' : 'POST';
  await api(endpoint, { method, body: JSON.stringify(payload) });
  resetUserForm();
  await loadAdminData();
}

async function saveDepartment() {
  const id = Number(el('editingDepartmentId').value || 0);
  const payload = {
    name: el('departmentName').value.trim(),
    slug: el('departmentSlug').value.trim() || slugify(el('departmentName').value),
    description: el('departmentDescription').value.trim(),
    icon: el('departmentIcon').value.trim() || 'layers',
    is_active: el('departmentActive').checked,
  };
  if (!payload.name) {
    setStatus('Informe o nome do departamento.', 'error');
    return;
  }
  const endpoint = id ? `/api/admin/departments/${id}` : '/api/admin/departments';
  const method = id ? 'PATCH' : 'POST';
  await api(endpoint, { method, body: JSON.stringify(payload) });
  resetDepartmentForm();
  await loadAdminData();
}

async function saveSubmenu() {
  const id = Number(el('editingSubmenuId').value || 0);
  const payload = {
    department_id: Number(el('submenuDepartmentId').value || 0),
    title: el('submenuTitle').value.trim(),
    slug: el('submenuSlug').value.trim() || slugify(el('submenuTitle').value),
    view_key: el('submenuViewKey').value.trim() || slugify(el('submenuTitle').value),
    description: el('submenuDescription').value.trim(),
    icon: el('submenuIcon').value.trim() || 'layers',
    is_active: el('submenuActive').checked,
  };
  if (!payload.department_id || !payload.title) {
    setStatus('Informe departamento e título do submenu.', 'error');
    return;
  }
  const endpoint = id ? `/api/admin/department-submenus/${id}` : '/api/admin/department-submenus';
  const method = id ? 'PATCH' : 'POST';
  await api(endpoint, { method, body: JSON.stringify(payload) });
  resetSubmenuForm();
  await loadAdminData();
}

async function saveAnnouncement() {
  const id = Number(el('announcementId').value || 0);
  const audienceScope = el('announcementAudienceScope').value;
  const payload = {
    title: el('announcementTitle').value.trim(),
    summary_text: el('announcementSummary').value.trim(),
    content_text: el('announcementContent').value.trim(),
    announcement_type: el('announcementType').value,
    priority: el('announcementPriority').value,
    audience_scope: audienceScope,
    department_ids: audienceScope === 'departments' ? selectedAnnouncementDepartments() : [],
    starts_at: el('announcementStartsAt').value || '',
    ends_at: el('announcementEndsAt').value || '',
    is_pinned: el('announcementPinned').checked,
    is_active: el('announcementActive').checked,
  };
  if (!payload.title || !payload.content_text) {
    setStatus('Informe título e conteúdo do comunicado.', 'error');
    return;
  }
  if (payload.audience_scope === 'departments' && !payload.department_ids.length) {
    setStatus('Selecione ao menos um departamento para um comunicado segmentado.', 'error');
    return;
  }
  const endpoint = id ? `/api/admin/intranet/announcements/${id}` : '/api/admin/intranet/announcements';
  const method = id ? 'PATCH' : 'POST';
  await api(endpoint, { method, body: JSON.stringify(payload) });
  resetAnnouncementForm();
  await loadAdminData();
}

async function handleListActions(event) {
  const editUserId = event.target.closest('[data-user-edit]')?.dataset.userEdit;
  if (editUserId) return fillUserForm(editUserId);
  const editDepartmentId = event.target.closest('[data-department-edit]')?.dataset.departmentEdit;
  if (editDepartmentId) return fillDepartmentForm(editDepartmentId);
  const deleteDepartmentId = event.target.closest('[data-department-delete]')?.dataset.departmentDelete;
  if (deleteDepartmentId && confirm('Deseja remover este departamento?')) {
    await api(`/api/admin/departments/${deleteDepartmentId}`, { method: 'DELETE' });
    return loadAdminData();
  }
  const editSubmenuId = event.target.closest('[data-submenu-edit]')?.dataset.submenuEdit;
  if (editSubmenuId) return fillSubmenuForm(editSubmenuId);
  const deleteSubmenuId = event.target.closest('[data-submenu-delete]')?.dataset.submenuDelete;
  if (deleteSubmenuId && confirm('Deseja remover este submenu?')) {
    await api(`/api/admin/department-submenus/${deleteSubmenuId}`, { method: 'DELETE' });
    return loadAdminData();
  }
  const editAnnouncementId = event.target.closest('[data-announcement-edit]')?.dataset.announcementEdit;
  if (editAnnouncementId) return fillAnnouncementForm(editAnnouncementId);
  const deleteAnnouncementId = event.target.closest('[data-announcement-delete]')?.dataset.announcementDelete;
  if (deleteAnnouncementId && confirm('Deseja remover este comunicado?')) {
    await api(`/api/admin/intranet/announcements/${deleteAnnouncementId}`, { method: 'DELETE' });
    return loadAdminData();
  }
}

window.addEventListener('DOMContentLoaded', async () => {
  await i18n()?.ready?.();
  i18n()?.renderLanguageSwitcher?.('adminLanguageSwitcher', { showLabel: false });
  document.querySelectorAll('[data-admin-tab]').forEach((button) => {
    button.addEventListener('click', () => setActiveTab(button.dataset.adminTab));
  });
  el('btnReloadAdminData').addEventListener('click', loadAdminData);
  el('btnSaveUser').addEventListener('click', saveUser);
  el('btnSaveDepartment').addEventListener('click', saveDepartment);
  el('btnSaveSubmenu').addEventListener('click', saveSubmenu);
  el('btnSaveAnnouncement').addEventListener('click', saveAnnouncement);
  el('btnCancelUserEdit').addEventListener('click', resetUserForm);
  el('btnCancelDepartmentEdit').addEventListener('click', resetDepartmentForm);
  el('btnCancelSubmenuEdit').addEventListener('click', resetSubmenuForm);
  el('btnCancelAnnouncementEdit').addEventListener('click', resetAnnouncementForm);
  el('announcementAudienceScope').addEventListener('change', syncAnnouncementDepartmentVisibility);
  el('adminListContent').addEventListener('click', (event) => {
    handleListActions(event).catch((err) => setStatus(`Erro ao executar ação: ${err.message}`, 'error'));
  });
  setActiveTab('users');
  try {
    await loadAdminData();
  } catch (err) {
    setStatus(`Erro ao carregar admin: ${err.message}`, 'error');
  }
});
