const el = (id) => document.getElementById(id);

const ICONS = {
  graduation: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m3 9 9-4 9 4-9 4-9-4Z"/><path d="M7 10.8v3.7c0 .7 2.2 2.5 5 2.5s5-1.8 5-2.5v-3.7"/><path d="M21 10v4"/></svg>',
  briefcase: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6V4h6v2"/><rect x="3" y="6" width="18" height="13" rx="2"/><path d="M3 12h18"/></svg>',
  'book-open': '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 19a2 2 0 0 1 2-2h14"/><path d="M6 3h14v18H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z"/><path d="M12 7h4"/></svg>',
  users: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2"/><circle cx="9.5" cy="7" r="3"/><path d="M20 21v-2a4 4 0 0 0-3-3.87"/><path d="M16.5 4.13a3 3 0 0 1 0 5.74"/></svg>',
  target: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4"/><path d="M12 2v3"/><path d="M22 12h-3"/><path d="M12 22v-3"/><path d="M2 12h3"/></svg>',
  chart: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 3v18h18"/><path d="m7 14 4-4 3 3 5-6"/></svg>',
  wallet: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 7H5a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2Z"/><path d="M16 12h.01"/><path d="M7 7V5a2 2 0 0 1 2-2h9"/></svg>',
  megaphone: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m3 11 14-7v16L3 13v-2Z"/><path d="M11 14v4a2 2 0 1 1-4 0v-2"/></svg>',
  shield: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 5 6v6c0 5 3.5 8 7 9 3.5-1 7-4 7-9V6l-7-3Z"/><path d="m9 12 2 2 4-4"/></svg>',
  scale: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v18"/><path d="M7 7h10"/><path d="m7 7-3 5a3 3 0 0 0 6 0L7 7Z"/><path d="m17 7-3 5a3 3 0 0 0 6 0l-3-5Z"/><path d="M8 21h8"/></svg>',
  layers: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 9 5-9 5-9-5 9-5Z"/><path d="m3 12 9 5 9-5"/><path d="m3 16 9 5 9-5"/></svg>',
  sparkles: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 1.8 4.2L18 9l-4.2 1.8L12 15l-1.8-4.2L6 9l4.2-1.8L12 3Z"/><path d="m19 14 .9 2.1L22 17l-2.1.9L19 20l-.9-2.1L16 17l2.1-.9L19 14Z"/><path d="m5 14 .9 2.1L8 17l-2.1.9L5 20l-.9-2.1L2 17l2.1-.9L5 14Z"/></svg>',
  message: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 17 3 21V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H7Z"/></svg>',
  document: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z"/><path d="M14 3v5h5"/><path d="M9 13h6"/><path d="M9 17h4"/></svg>',
  workspace: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="14" rx="2"/><path d="M8 20h8"/><path d="M12 18v2"/></svg>',
  assistant: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2v4"/><path d="m8 6 4 2 4-2"/><rect x="5" y="8" width="14" height="10" rx="4"/><path d="M9 13h.01"/><path d="M15 13h.01"/><path d="M9 17c1 .7 2 .9 3 .9s2-.2 3-.9"/></svg>',
  insight: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 18h6"/><path d="M10 22h4"/><path d="M12 2a7 7 0 0 0-4 12.7V18h8v-3.3A7 7 0 0 0 12 2Z"/></svg>',
  general: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16"/><path d="M4 12h16"/><path d="M4 18h10"/></svg>',
};

let bootstrapData = null;
let allDocumentItems = [];
let allModuleItems = [];
let salesState = {
  enabled: false,
  summary: null,
  records: [],
  closers: [],
  selectedRecordId: null,
  canEditAll: false,
};
let trainingState = null;

function renderIcon(name) {
  return ICONS[name] || ICONS.general;
}

async function api(path, opts = {}) {
  const res = await fetch(path, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
    ...opts,
  });

  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch {}
  if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
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

function formatDate(value) {
  try {
    return new Date(value).toLocaleString('pt-BR');
  } catch {
    return '';
  }
}

function getPeriodGreeting() {
  const now = new Date();
  const brazilHour = Number(new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Sao_Paulo',
    hour: '2-digit',
    hourCycle: 'h23',
  }).format(now));

  if (brazilHour < 12) return 'Bom dia';
  if (brazilHour < 18) return 'Boa tarde';
  return 'Boa noite';
}

function setSidebarOpen(isOpen) {
  document.body.classList.toggle('intranet-sidebar-open', Boolean(isOpen));
}

function renderSidebar(user, intranet) {
  el('intranetBrandSub').textContent = `${user.email || ''} - ${user.role || 'user'}`;

  const chips = el('sidebarDepartmentChips');
  chips.innerHTML = '';
  (user.departments || []).forEach((department) => {
    const item = document.createElement('span');
    item.className = 'intranet-chip';
    item.textContent = department;
    chips.appendChild(item);
  });

  const quickLinks = el('sidebarQuickLinks');
  quickLinks.innerHTML = '';
  const links = [...(intranet.home.quickLinks || [])];
  if (trainingState) {
    links.unshift({
      title: 'Treinamento da IA',
      description: 'Saude da base documental, memoria e reprocessamento.',
      anchor: '#training',
    });
  }
  links.forEach((link) => {
    const item = document.createElement(link.href ? 'a' : 'button');
    item.className = 'intranet-side-link';
    item.textContent = link.title;
    if (link.href) {
      item.href = link.href;
    } else if (link.anchor) {
      item.type = 'button';
      item.onclick = () => document.querySelector(link.anchor)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    quickLinks.appendChild(item);
  });
}

function renderHero(user, intranet) {
  el('intranetGreeting').textContent = `${getPeriodGreeting()}, ${user.name}`;
  el('heroTitle').textContent = intranet.home.heroTitle;
  el('heroDescription').textContent = intranet.home.heroDescription;

  const highlights = el('heroHighlights');
  highlights.innerHTML = '';
  (intranet.home.highlights || []).forEach((item) => {
    const block = document.createElement('div');
    block.className = 'intranet-highlight-card';
    block.textContent = item;
    highlights.appendChild(block);
  });

  const stats = el('homeStats');
  stats.innerHTML = '';
  (intranet.home.stats || []).forEach((stat) => {
    const card = document.createElement('article');
    card.className = 'intranet-stat-card';
    card.innerHTML = `
      <div class="intranet-stat-value">${escapeHtml(stat.value)}</div>
      <div class="intranet-stat-label">${escapeHtml(stat.label)}</div>
    `;
    stats.appendChild(card);
  });

  const quick = el('intranetQuickGrid');
  quick.innerHTML = '';
  const links = [...(intranet.home.quickLinks || [])];
  if (trainingState) {
    links.unshift({
      title: 'Treinamento da IA',
      description: 'Saude da base documental, memoria e reprocessamento.',
      anchor: '#training',
      style: 'primary',
    });
  }
  links.forEach((link) => {
    const card = document.createElement(link.href ? 'a' : 'button');
    card.className = `intranet-quick-card${link.style === 'primary' ? ' is-primary' : ''}`;
    card.innerHTML = `
      <div class="intranet-quick-title">${escapeHtml(link.title)}</div>
      <div class="intranet-quick-text">${escapeHtml(link.description)}</div>
    `;
    if (link.href) {
      card.href = link.href;
    } else if (link.anchor) {
      card.type = 'button';
      card.onclick = () => document.querySelector(link.anchor)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    quick.appendChild(card);
  });
}

function renderModules(intranet, query = '') {
  const normalizedQuery = String(query || '').trim().toLowerCase();
  const grid = el('moduleGrid');
  grid.innerHTML = '';

  const modules = (allModuleItems || []).filter((module) => {
    if (!normalizedQuery) return true;
    return [module.title, module.description, module.department]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()
      .includes(normalizedQuery);
  });

  if (!modules.length) {
    grid.innerHTML = '<div class="intranet-empty-card">Nenhum modulo encontrado para este filtro.</div>';
    return;
  }

  modules.forEach((module) => {
    const moduleIcon = module.icon || (module.type === 'assistant'
      ? 'assistant'
      : module.type === 'documents'
        ? 'document'
        : module.type === 'insight'
          ? 'insight'
          : 'workspace');
    const card = document.createElement('article');
    card.className = 'intranet-module-card';
    card.innerHTML = `
      <div class="intranet-module-top">
        <span class="intranet-module-icon">${renderIcon(moduleIcon)}</span>
        <span class="intranet-chip">${escapeHtml(module.department || 'Geral')}</span>
      </div>
      <h4>${escapeHtml(module.title)}</h4>
      <p>${escapeHtml(module.description || '')}</p>
      <div class="intranet-module-type">${escapeHtml(module.type || 'workspace')}</div>
    `;
    grid.appendChild(card);
  });
}

function renderDepartments(intranet) {
  const grid = el('departmentGrid');
  grid.innerHTML = '';

  (intranet.departments || []).forEach((department) => {
    const card = document.createElement('article');
    card.className = 'intranet-department-card';
    const modules = (department.modules || []).map((module) => `<li>${escapeHtml(module.title)}<span>${escapeHtml(module.description || '')}</span></li>`).join('');
    card.innerHTML = `
      <div class="intranet-department-head">
        <div class="intranet-department-icon">${renderIcon(department.icon || 'layers')}</div>
        <div>
          <h4>${escapeHtml(department.name)}</h4>
          <div class="small muted">Nivel atual: ${escapeHtml(department.access_level || 'colaborador')}</div>
        </div>
      </div>
      <p>${escapeHtml(department.description || '')}</p>
      <ul class="intranet-department-modules">${modules}</ul>
    `;
    grid.appendChild(card);
  });
}

function renderDocuments(intranet, query = '') {
  const normalizedQuery = String(query || '').trim().toLowerCase();
  const grid = el('documentGrid');
  grid.innerHTML = '';

  const documents = (allDocumentItems || []).filter((document) => {
    if (!normalizedQuery) return true;
    return [document.name, document.status]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()
      .includes(normalizedQuery);
  });

  if (!documents.length) {
    grid.innerHTML = `<div class="intranet-empty-card">${escapeHtml(intranet.document_center.empty_state || 'Nenhum documento encontrado.')}</div>`;
    return;
  }

  documents.forEach((document) => {
    const card = document.createElement('article');
    card.className = 'intranet-document-card';
    card.innerHTML = `
      <div class="intranet-document-head">
        <div class="intranet-document-icon">${renderIcon('document')}</div>
        <div>
          <h4>${escapeHtml(document.name)}</h4>
          <div class="small muted">${escapeHtml(document.status || 'Local')} - ${escapeHtml(formatDate(document.created_at))}</div>
        </div>
      </div>
    `;
    grid.appendChild(card);
  });
}

function setTrainingSectionVisible(isVisible) {
  const section = el('training');
  const navLink = el('trainingNavLink');
  if (section) section.hidden = !isVisible;
  if (navLink) navLink.hidden = !isVisible;
}

function renderTrainingCards(training = {}) {
  const wrap = el('trainingSummaryCards');
  if (!wrap) return;
  wrap.innerHTML = '';

  const knowledgeCounts = training.knowledge?.counts || {};
  const pendingReprocess = Math.max(Number(knowledgeCounts.total || 0) - Number(knowledgeCounts.available || 0), 0);
  const cards = [
    { label: 'Arquivos', value: Number(knowledgeCounts.total || 0) },
    { label: 'Disponiveis para IA', value: Number(knowledgeCounts.available || 0) },
    { label: 'Para reprocessar', value: pendingReprocess },
    { label: 'Memorias', value: Number(training.memories?.total || 0) },
  ];

  cards.forEach((card) => {
    const item = document.createElement('article');
    item.className = 'intranet-sales-card';
    item.innerHTML = `<strong>${escapeHtml(card.value)}</strong><span>${escapeHtml(card.label)}</span>`;
    wrap.appendChild(item);
  });
}

function renderTrainingList(containerId, items = [], formatter) {
  const wrap = el(containerId);
  if (!wrap) return;
  wrap.innerHTML = '';
  if (!Array.isArray(items) || !items.length) {
    wrap.innerHTML = '<div class="intranet-empty-card">Nenhum item recente nesta categoria.</div>';
    return;
  }
  items.slice(0, 16).forEach((item) => {
    const block = document.createElement('div');
    block.className = 'intranet-training-item';
    block.innerHTML = formatter(item);
    wrap.appendChild(block);
  });
}

function renderTrainingPanel(training = {}) {
  renderTrainingCards(training);
  const failureItems = Array.isArray(training.knowledge?.needs_reprocess) && training.knowledge.needs_reprocess.length
    ? training.knowledge.needs_reprocess
    : (training.knowledge?.recent_failures || []);

  const docsWrap = el('trainingTopDocuments');
  const topicsWrap = el('trainingTopTopics');
  if (docsWrap) {
    docsWrap.innerHTML = '';
    const topDocs = training.knowledge?.top_documents || [];
    if (!topDocs.length) {
      docsWrap.innerHTML = '<span class="small muted">Nenhum documento usado recentemente.</span>';
    } else {
      topDocs.slice(0, 10).forEach((item) => {
        const chip = document.createElement('span');
        chip.className = 'intranet-chip';
        chip.textContent = `${item.name || `Documento #${item.knowledge_source_id || '-'}`} (${Number(item.total || 0)})`;
        docsWrap.appendChild(chip);
      });
    }
  }

  if (topicsWrap) {
    topicsWrap.innerHTML = '';
    const topics = training.memories?.top_topics || [];
    if (!topics.length) {
      topicsWrap.innerHTML = '<span class="small muted">Nenhum tema recorrente ainda.</span>';
    } else {
      topics.slice(0, 12).forEach((item) => {
        const chip = document.createElement('span');
        chip.className = 'intranet-chip';
        chip.textContent = `${item.topic || '-'} (${Number(item.total || 0)})`;
        topicsWrap.appendChild(chip);
      });
    }
  }

  renderTrainingList('trainingFailuresList', failureItems, (item) => `
    <strong>${escapeHtml(item.original_name || '-')}</strong>
    <div class="small muted">${escapeHtml(item.availability_status || '-')}</div>
    <div>${escapeHtml(item.last_error || item.health_issues?.join(', ') || 'Sem detalhe adicional')}</div>
  `);

  renderTrainingList('trainingMemoriesList', training.memories?.recent || [], (item) => `
    <strong>${escapeHtml(item.title || '-')}</strong>
    <div class="small muted">${escapeHtml(item.memory_scope || '-')} - ${escapeHtml(item.language || '-')}</div>
    <div class="small muted">${escapeHtml(formatDate(item.updated_at || item.created_at))}</div>
  `);

  renderTrainingList('trainingEventsList', training.training_events?.recent || [], (item) => `
    <strong>${escapeHtml(item.title || item.event_type || '-')}</strong>
    <div class="small muted">${escapeHtml(item.event_status || '-')} - ${escapeHtml(formatDate(item.created_at))}</div>
    <div>${escapeHtml(item.detail_text || '-')}</div>
  `);
}

async function fetchTrainingBootstrap() {
  if (bootstrapData?.user?.role !== 'admin') {
    setTrainingSectionVisible(false);
    return;
  }
  try {
    const data = await api('/api/intranet/training/bootstrap');
    trainingState = data.training || null;
    setTrainingSectionVisible(Boolean(trainingState));
    if (trainingState) renderTrainingPanel(trainingState);
  } catch (err) {
    setTrainingSectionVisible(false);
  }
}

function setSalesSectionVisible(isVisible) {
  const section = el('sales');
  const navLink = el('salesNavLink');
  if (section) section.hidden = !isVisible;
  if (navLink) navLink.hidden = !isVisible;
}

function renderSalesSummary(sales) {
  const summaryWrap = el('salesSummaryCards');
  const closerWrap = el('salesCloserCards');
  summaryWrap.innerHTML = '';
  closerWrap.innerHTML = '';

  if (!sales?.enabled) {
    summaryWrap.innerHTML = '<div class="intranet-empty-card">Nenhuma operacao comercial liberada para este perfil.</div>';
    return;
  }

  const statusEntries = Object.entries(sales.summary?.statuses || {});
  const cards = [
    { label: 'Matriculas', value: Number(sales.summary?.total || 0) },
    { label: 'Closers ativas', value: Array.isArray(sales.closers) ? sales.closers.length : 0 },
    { label: 'Escopo atual', value: sales.can_view_all ? 'Geral' : 'Minha carteira' },
  ];
  statusEntries.slice(0, 3).forEach(([status, total]) => {
    cards.push({ label: status, value: Number(total || 0) });
  });

  cards.forEach((card) => {
    const item = document.createElement('article');
    item.className = 'intranet-sales-card';
    item.innerHTML = `<strong>${escapeHtml(card.value)}</strong><span>${escapeHtml(card.label)}</span>`;
    summaryWrap.appendChild(item);
  });

  (sales.summary?.by_closer || []).slice(0, 8).forEach((closer) => {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'intranet-sales-closer';
    card.innerHTML = `<strong>${escapeHtml(closer.closer_name || 'Sem closer')}</strong><span>${Number(closer.total || 0)} matricula(s)</span>`;
    card.onclick = () => {
      el('salesCloserFilter').value = closer.closer_id ? String(closer.closer_id) : '';
      fetchSalesRecords();
    };
    closerWrap.appendChild(card);
  });
}

function renderSalesFilterOptions(sales) {
  const closerSelect = el('salesCloserFilter');
  const statusSelect = el('salesStatusFilter');
  const previousCloser = closerSelect.value;
  const previousStatus = statusSelect.value;

  closerSelect.innerHTML = '<option value="">Todas</option>';
  (sales.closers || []).forEach((closer) => {
    const option = document.createElement('option');
    option.value = String(closer.id);
    option.textContent = closer.display_name || closer.official_name;
    closerSelect.appendChild(option);
  });
  if (Array.from(closerSelect.options).some((option) => option.value === previousCloser)) {
    closerSelect.value = previousCloser;
  }

  statusSelect.innerHTML = '<option value="">Todos</option>';
  Object.entries(sales.summary?.statuses || {}).forEach(([status, total]) => {
    const option = document.createElement('option');
    option.value = status;
    option.textContent = `${status} (${total})`;
    statusSelect.appendChild(option);
  });
  if (Array.from(statusSelect.options).some((option) => option.value === previousStatus)) {
    statusSelect.value = previousStatus;
  }
}

function getEditableSalesRecord(record) {
  const userId = Number(bootstrapData?.user?.id || 0);
  if (!record) return false;
  return Boolean(salesState.canEditAll || Number(record.user_id || 0) === userId);
}

function renderSalesDetail(record, history = []) {
  const title = el('salesDetailTitle');
  const meta = el('salesDetailMeta');
  const historyWrap = el('salesHistoryList');
  const form = el('salesDetailForm');

  if (!record) {
    title.textContent = 'Selecione uma matricula';
    meta.innerHTML = '<div class="intranet-empty-card">Clique em um registro para ver detalhes, historico e editar os campos permitidos.</div>';
    historyWrap.innerHTML = '';
    form.reset();
    Array.from(form.elements).forEach((field) => {
      if (field.tagName === 'BUTTON') return;
      field.disabled = true;
    });
    return;
  }

  title.textContent = record.student_name || 'Matricula';
  meta.innerHTML = [
    ['Curso', record.course_name || '-'],
    ['Closer', record.closer_name || record.closer_normalized || record.closer_original || 'Sem closer'],
    ['Data', record.sale_date || '-'],
    ['Status', record.operational_status || 'Novo'],
    ['Origem', record.media_source || record.source_workbook || '-'],
    ['Idioma', record.language || '-'],
  ].map(([label, value]) => `<div class="intranet-sales-meta-item"><strong>${escapeHtml(label)}</strong><span>${escapeHtml(value)}</span></div>`).join('');

  el('salesOperationalStatus').value = record.operational_status || '';
  el('salesNextAction').value = record.next_action || '';
  el('salesNextActionDate').value = record.next_action_date || '';
  el('salesFollowUpNotes').value = record.follow_up_notes || '';
  el('salesObservations').value = record.observations || '';

  const canEdit = getEditableSalesRecord(record);
  Array.from(form.elements).forEach((field) => {
    if (field.tagName === 'BUTTON') return;
    field.disabled = !canEdit;
  });
  el('btnSaveSalesRecord').disabled = !canEdit;

  if (!history.length) {
    historyWrap.innerHTML = '<div class="intranet-empty-card">Nenhum historico registrado ainda.</div>';
    return;
  }

  historyWrap.innerHTML = history.map((item) => `
    <div class="intranet-sales-history-item">
      <strong>${escapeHtml(item.action || 'Atualizacao')}</strong>
      <div class="small muted">${escapeHtml(formatDate(item.created_at))} - ${escapeHtml(item.actor_name || 'Sistema')}</div>
      <div>${escapeHtml(item.field_name || '')}${item.old_value || item.new_value ? `: ${escapeHtml(item.old_value || '-')} -> ${escapeHtml(item.new_value || '-')}` : ''}</div>
    </div>
  `).join('');
}

function renderSalesRecordsGrid() {
  const wrap = el('salesRecordGrid');
  wrap.innerHTML = '';

  if (!salesState.records.length) {
    wrap.innerHTML = '<div class="intranet-empty-card">Nenhuma matricula encontrada para os filtros atuais.</div>';
    renderSalesDetail(null, []);
    return;
  }

  salesState.records.forEach((record) => {
    const card = document.createElement('article');
    card.className = 'intranet-sales-record';
    if (Number(record.id) === Number(salesState.selectedRecordId || 0)) {
      card.style.borderColor = '#bbf7d0';
      card.style.boxShadow = '0 18px 32px rgba(15,23,42,.08)';
    }
    card.innerHTML = `
      <div class="intranet-sales-record-head">
        <div>
          <h4>${escapeHtml(record.student_name || 'Sem nome')}</h4>
          <div class="small muted">${escapeHtml(record.course_name || '-')}</div>
        </div>
        <span class="intranet-chip">${escapeHtml(record.operational_status || 'Novo')}</span>
      </div>
      <div class="small muted">${escapeHtml(record.closer_name || record.closer_normalized || record.closer_original || 'Sem closer')}</div>
      <div class="small muted">${escapeHtml(record.sale_date || '-')} - ${escapeHtml(record.media_source || record.source_workbook || '-')}</div>
    `;
    card.onclick = () => selectSalesRecord(record.id);
    wrap.appendChild(card);
  });
}

async function selectSalesRecord(recordId) {
  salesState.selectedRecordId = Number(recordId);
  renderSalesRecordsGrid();
  try {
    const { record, history } = await api(`/api/intranet/sales/records/${recordId}/history`);
    renderSalesDetail(record, history || []);
  } catch (err) {
    renderSalesDetail(salesState.records.find((item) => Number(item.id) === Number(recordId)), []);
  }
}

async function fetchSalesRecords() {
  const params = new URLSearchParams();
  const closerId = el('salesCloserFilter').value;
  const status = el('salesStatusFilter').value;
  const search = el('salesSearchInput').value.trim();
  if (closerId) params.set('closer_id', closerId);
  if (status) params.set('status', status);
  if (search) params.set('search', search);
  params.set('limit', '80');

  const { records } = await api(`/api/intranet/sales/records?${params.toString()}`);
  salesState.records = records || [];
  if (!salesState.records.some((item) => Number(item.id) === Number(salesState.selectedRecordId || 0))) {
    salesState.selectedRecordId = salesState.records[0]?.id || null;
  }
  renderSalesRecordsGrid();
  if (salesState.selectedRecordId) {
    await selectSalesRecord(salesState.selectedRecordId);
  }
}

function hydrateSalesWorkspace(intranet) {
  const sales = intranet.sales || { enabled: false };
  salesState = {
    enabled: Boolean(sales.enabled),
    summary: sales.summary || null,
    records: Array.isArray(sales.records) ? sales.records : [],
    closers: Array.isArray(sales.closers) ? sales.closers : [],
    selectedRecordId: sales.records?.[0]?.id || null,
    canEditAll: Boolean(sales.can_edit_all),
  };

  setSalesSectionVisible(salesState.enabled);
  if (!salesState.enabled) return;
  renderSalesSummary(sales);
  renderSalesFilterOptions(sales);
  renderSalesRecordsGrid();
}

function renderCommunication(intranet) {
  const grid = el('communicationGrid');
  grid.innerHTML = '';

  (intranet.communication.mural || []).forEach((item) => {
    const card = document.createElement('article');
    card.className = 'intranet-communication-card';
    card.innerHTML = `
      <h4>${escapeHtml(item.title)}</h4>
      <p>${escapeHtml(item.description)}</p>
    `;
    grid.appendChild(card);
  });

  const futureWrap = el('adminFuture');
  const futureList = el('futureList');
  if (intranet.admin?.can_manage) {
    futureWrap.style.display = '';
    futureList.innerHTML = '';
    (intranet.admin.next_steps || []).forEach((item) => {
      const block = document.createElement('div');
      block.className = 'intranet-future-item';
      block.textContent = item;
      futureList.appendChild(block);
    });
  }
}

function applyDocumentFilter() {
  const query = el('documentSearch').value || '';
  renderModules(bootstrapData.intranet, query);
  renderDocuments(bootstrapData.intranet, query);
}

async function init() {
  try {
    bootstrapData = await api('/api/intranet/bootstrap');
  } catch (err) {
    if (String(err.message || '').includes('intranet_access_denied')) {
      window.location.href = '/index.html';
      return;
    }
    alert('Nao foi possivel carregar a intranet: ' + err.message);
    return;
  }

  await fetchTrainingBootstrap();
  const { user, intranet } = bootstrapData;
  allModuleItems = intranet.modules || [];
  allDocumentItems = intranet.document_center?.recent_documents || [];

  renderSidebar(user, intranet);
  renderHero(user, intranet);
  renderModules(intranet);
  renderDepartments(intranet);
  renderDocuments(intranet);
  hydrateSalesWorkspace(intranet);
  renderCommunication(intranet);

  el('documentSearch').addEventListener('input', applyDocumentFilter);
  el('btnRefreshSales')?.addEventListener('click', fetchSalesRecords);
  el('salesCloserFilter')?.addEventListener('change', fetchSalesRecords);
  el('salesStatusFilter')?.addEventListener('change', fetchSalesRecords);
  el('salesSearchInput')?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      fetchSalesRecords();
    }
  });
  el('salesDetailForm')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!salesState.selectedRecordId) return;
    const payload = {
      operational_status: el('salesOperationalStatus').value.trim(),
      next_action: el('salesNextAction').value.trim(),
      next_action_date: el('salesNextActionDate').value,
      follow_up_notes: el('salesFollowUpNotes').value.trim(),
      observations: el('salesObservations').value.trim(),
    };

    try {
      const { record, history } = await api(`/api/intranet/sales/records/${salesState.selectedRecordId}`, {
        method: 'PATCH',
        body: JSON.stringify(payload),
      });
      const index = salesState.records.findIndex((item) => Number(item.id) === Number(record.id));
      if (index >= 0) salesState.records[index] = record;
      renderSalesRecordsGrid();
      renderSalesDetail(record, history || []);
    } catch (err) {
      alert('Nao foi possivel salvar a atualizacao: ' + err.message);
    }
  });
  el('btnIntranetMenu').addEventListener('click', () => setSidebarOpen(true));
  document.addEventListener('click', (event) => {
    if (window.innerWidth > 960) return;
    const sidebar = el('intranetSidebar');
    if (!document.body.classList.contains('intranet-sidebar-open')) return;
    if (sidebar.contains(event.target) || event.target.closest('#btnIntranetMenu')) return;
    setSidebarOpen(false);
  });
  window.addEventListener('resize', () => {
    if (window.innerWidth > 960) setSidebarOpen(false);
  });

  if (salesState.enabled && salesState.selectedRecordId) {
    selectSalesRecord(salesState.selectedRecordId);
  }
}

window.addEventListener('DOMContentLoaded', init);

