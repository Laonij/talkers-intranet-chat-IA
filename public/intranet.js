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
  calendar: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="17" rx="2"/><path d="M8 2v4"/><path d="M16 2v4"/><path d="M3 10h18"/></svg>',
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
let calendarState = {
  enabled: false,
  view: 'month',
  baseDate: '',
  range: null,
  eventTypes: [],
  users: [],
  events: [],
  selectedEventId: null,
  history: [],
  summary: null,
};
const SIDEBAR_STORAGE_KEY = 'talkers_intranet_sidebar_state_v1';

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

function isDesktopSidebarViewport() {
  return window.innerWidth > 960;
}

function setSidebarOpen(isOpen) {
  document.body.classList.toggle('intranet-sidebar-open', Boolean(isOpen));
  syncSidebarButtons();
}

function readSidebarPreference() {
  try {
    const raw = localStorage.getItem(SIDEBAR_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return Boolean(parsed?.collapsed);
  } catch {
    return false;
  }
}

function writeSidebarPreference(isCollapsed) {
  try {
    localStorage.setItem(SIDEBAR_STORAGE_KEY, JSON.stringify({ collapsed: Boolean(isCollapsed) }));
  } catch {}
}

function setSidebarCollapsed(isCollapsed) {
  const shouldCollapse = Boolean(isCollapsed) && isDesktopSidebarViewport();
  document.body.classList.toggle('intranet-sidebar-collapsed', shouldCollapse);
  syncSidebarButtons();
}

function applySidebarPreference() {
  if (isDesktopSidebarViewport()) {
    setSidebarOpen(false);
    setSidebarCollapsed(readSidebarPreference());
  } else {
    document.body.classList.remove('intranet-sidebar-collapsed');
  }
  syncSidebarButtons();
}

function syncSidebarButtons() {
  const desktopExpanded = !document.body.classList.contains('intranet-sidebar-collapsed');
  const mobileOpen = document.body.classList.contains('intranet-sidebar-open');
  const isDesktop = isDesktopSidebarViewport();
  const expanded = isDesktop ? desktopExpanded : mobileOpen;
  const label = isDesktop
    ? (expanded ? 'Recolher menu lateral' : 'Expandir menu lateral')
    : (expanded ? 'Fechar menu lateral' : 'Abrir menu lateral');

  ['btnIntranetMenu', 'btnSidebarCollapse'].forEach((id) => {
    const button = el(id);
    if (!button) return;
    button.setAttribute('aria-expanded', expanded ? 'true' : 'false');
    button.setAttribute('aria-label', label);
    button.title = label;
  });
}

function toggleSidebar() {
  if (isDesktopSidebarViewport()) {
    const nextCollapsed = !document.body.classList.contains('intranet-sidebar-collapsed');
    setSidebarCollapsed(nextCollapsed);
    writeSidebarPreference(nextCollapsed);
    return;
  }

  setSidebarOpen(!document.body.classList.contains('intranet-sidebar-open'));
}

function closeSidebarOnMobile() {
  if (!isDesktopSidebarViewport()) setSidebarOpen(false);
}

function decorateSidebarNav() {
  Array.from(document.querySelectorAll('.intranet-nav-link')).forEach((link) => {
    const iconWrap = link.querySelector('.intranet-nav-link-icon');
    if (!iconWrap) return;
    const iconName = link.getAttribute('data-icon') || 'general';
    iconWrap.innerHTML = renderIcon(iconName);
  });
}

function renderSidebar(user, intranet) {
  el('intranetBrandSub').textContent = `${user.email || ''} - ${user.role || 'user'}`;

  const chips = el('sidebarDepartmentChips');
  chips.innerHTML = '';
  const visibleDepartments = Array.isArray(intranet.departments) ? intranet.departments : [];
  visibleDepartments.forEach((department) => {
    const item = document.createElement('span');
    item.className = 'intranet-chip';
    item.textContent = department.name || department;
    chips.appendChild(item);
  });
  if (!visibleDepartments.length) {
    chips.innerHTML = '<span class="small muted">Nenhuma area setorial liberada para este perfil.</span>';
  }

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
      item.target = link.href.startsWith('#') ? '' : '_self';
    } else if (link.anchor) {
      item.type = 'button';
      item.onclick = () => {
        document.querySelector(link.anchor)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        closeSidebarOnMobile();
      };
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

  if (!Array.isArray(intranet.departments) || !intranet.departments.length) {
    grid.innerHTML = '<div class="intranet-empty-card">Nenhum departamento especifico foi liberado para este perfil.</div>';
    return;
  }

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

function setDashboardSectionVisible(isVisible) {
  const section = el('dashboard');
  const navLink = el('dashboardNavLink');
  if (section) section.hidden = !isVisible;
  if (navLink) navLink.hidden = !isVisible;
}

function renderDashboard(intranet) {
  const dashboard = intranet.dashboard || { enabled: false };
  setDashboardSectionVisible(Boolean(dashboard.enabled));
  if (!dashboard.enabled) return;

  const summaryWrap = el('dashboardSummaryCards');
  const breakdownWrap = el('dashboardDepartmentBreakdown');
  const highlightsWrap = el('dashboardHighlightsList');
  const widgetsWrap = el('dashboardWidgetGrid');

  if (summaryWrap) {
    summaryWrap.innerHTML = '';
    (dashboard.cards || []).forEach((card) => {
      const item = document.createElement('article');
      item.className = 'intranet-stat-card';
      item.innerHTML = `
        <div class="intranet-stat-value">${escapeHtml(card.value || '0')}</div>
        <div class="intranet-stat-label">${escapeHtml(card.label || '')}</div>
        <div class="small muted">${escapeHtml(card.description || '')}</div>
      `;
      summaryWrap.appendChild(item);
    });
  }

  if (breakdownWrap) {
    breakdownWrap.innerHTML = '';
    const rows = dashboard.department_breakdown || [];
    if (!rows.length) {
      breakdownWrap.innerHTML = '<div class="intranet-empty-card">Nenhuma area disponivel para compor o dashboard deste perfil.</div>';
    } else {
      const maxDocuments = Math.max(...rows.map((item) => Number(item.documents_total || 0)), 1);
      rows.forEach((item) => {
        const row = document.createElement('div');
        row.className = 'intranet-dashboard-row';
        row.innerHTML = `
          <div class="intranet-dashboard-row-head">
            <div class="intranet-dashboard-row-title">
              <span class="intranet-dashboard-row-icon">${renderIcon(item.icon || 'layers')}</span>
              <div>
                <strong>${escapeHtml(item.name || 'Area')}</strong>
                <div class="small muted">${escapeHtml(item.access_level || 'colaborador')}</div>
              </div>
            </div>
            <div class="small muted">${escapeHtml(String(item.documents_total || 0))} doc(s) • ${escapeHtml(String(item.modules_total || 0))} modulo(s)</div>
          </div>
          <div class="intranet-dashboard-bar-track">
            <span class="intranet-dashboard-bar-fill" style="width:${Math.max(12, Math.round((Number(item.documents_total || 0) / maxDocuments) * 100))}%"></span>
          </div>
          <div class="small muted">${escapeHtml(item.description || '')}</div>
        `;
        breakdownWrap.appendChild(row);
      });
    }
  }

  if (highlightsWrap) {
    highlightsWrap.innerHTML = '';
    (dashboard.highlights || []).forEach((item) => {
      const row = document.createElement('div');
      row.className = 'intranet-dashboard-note';
      row.innerHTML = `<strong>${escapeHtml(item.title || '')}</strong><span>${escapeHtml(item.description || '')}</span>`;
      highlightsWrap.appendChild(row);
    });
  }

  if (widgetsWrap) {
    widgetsWrap.innerHTML = '';
    const docs = dashboard.recent_documents || [];
    if (!docs.length) {
      widgetsWrap.innerHTML = '<div class="intranet-empty-card">Nenhum documento recente para destacar no dashboard.</div>';
    } else {
      docs.forEach((document) => {
        const card = document.createElement('article');
        card.className = 'intranet-module-card';
        card.innerHTML = `
          <div class="intranet-module-top">
            <span class="intranet-module-icon">${renderIcon('document')}</span>
            <span class="intranet-chip">${escapeHtml(document.department_name || 'Geral')}</span>
          </div>
          <h4>${escapeHtml(document.name || 'Documento')}</h4>
          <p>${escapeHtml(document.status || 'Processando')}</p>
          <div class="intranet-module-type">${escapeHtml(formatDate(document.created_at || ''))}</div>
        `;
        widgetsWrap.appendChild(card);
      });
    }
  }
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

function getTodayDateKey() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function addDays(dateKey, amount) {
  const base = new Date(`${dateKey}T12:00:00-03:00`);
  base.setDate(base.getDate() + Number(amount || 0));
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(base);
}

function formatCalendarDateLabel(dateKey) {
  try {
    return new Date(`${dateKey}T12:00:00-03:00`).toLocaleDateString('pt-BR', {
      weekday: 'short',
      day: '2-digit',
      month: 'short',
    });
  } catch {
    return dateKey || '';
  }
}

function formatCalendarRangeLabel(range = {}) {
  const from = range.from ? formatCalendarDateLabel(range.from) : '';
  const to = range.to ? formatCalendarDateLabel(range.to) : '';
  if (!from && !to) return 'Agenda';
  if (from === to) return from;
  return `${from} - ${to}`;
}

function getCalendarModeLabel(mode = '') {
  if (mode === 'presencial') return 'Presencial';
  if (mode === 'hibrida') return 'Hibrida';
  return 'Online';
}

function getEventTypeMeta(eventTypeId) {
  return (calendarState.eventTypes || []).find((item) => Number(item.id) === Number(eventTypeId)) || null;
}

function renderCalendarSummary() {
  const wrap = el('calendarSummaryCards');
  if (!wrap) return;
  wrap.innerHTML = '';

  const currentUserId = Number(bootstrapData?.user?.id || 0);
  const today = getTodayDateKey();
  const nextWeek = addDays(today, 7);
  const events = Array.isArray(calendarState.events) ? calendarState.events : [];
  const cards = [
    { label: 'No periodo', value: events.length },
    { label: 'Hoje', value: events.filter((item) => item.start_date === today).length },
    { label: 'Esta semana', value: events.filter((item) => item.start_date >= today && item.start_date <= nextWeek).length },
    { label: 'Meus compromissos', value: events.filter((item) => (item.participants || []).some((participant) => Number(participant.user_id || 0) === currentUserId)).length },
  ];

  cards.forEach((card) => {
    const item = document.createElement('article');
    item.className = 'intranet-sales-card';
    item.innerHTML = `<strong>${escapeHtml(card.value)}</strong><span>${escapeHtml(card.label)}</span>`;
    wrap.appendChild(item);
  });
}

function renderCalendarTypeOptions() {
  const typeSelect = el('calendarTypeFilter');
  const eventTypeSelect = el('calendarEventType');
  const previousFilter = typeSelect?.value || '';
  const previousForm = eventTypeSelect?.value || '';

  if (typeSelect) {
    typeSelect.innerHTML = '<option value="">Todos</option>';
    (calendarState.eventTypes || []).forEach((item) => {
      const option = document.createElement('option');
      option.value = String(item.id);
      option.textContent = item.name;
      typeSelect.appendChild(option);
    });
    if (Array.from(typeSelect.options).some((option) => option.value === previousFilter)) {
      typeSelect.value = previousFilter;
    }
  }

  if (eventTypeSelect) {
    eventTypeSelect.innerHTML = '<option value="">Selecione</option>';
    (calendarState.eventTypes || []).forEach((item) => {
      const option = document.createElement('option');
      option.value = String(item.id);
      option.textContent = item.name;
      eventTypeSelect.appendChild(option);
    });
    if (Array.from(eventTypeSelect.options).some((option) => option.value === previousForm)) {
      eventTypeSelect.value = previousForm;
    }
  }
}

function renderCalendarUserOptions() {
  const userSelect = el('calendarUserFilter');
  if (!userSelect) return;
  const previous = userSelect.value;
  userSelect.innerHTML = '<option value="">Todos</option>';
  (calendarState.users || []).forEach((item) => {
    const option = document.createElement('option');
    option.value = String(item.id);
    option.textContent = `${item.name}${item.department ? ` - ${item.department}` : ''}`;
    userSelect.appendChild(option);
  });
  if (Array.from(userSelect.options).some((option) => option.value === previous)) {
    userSelect.value = previous;
  }
}

function renderCalendarParticipants() {
  const wrap = el('calendarParticipants');
  if (!wrap) return;
  wrap.innerHTML = '';

  (calendarState.users || []).forEach((user) => {
    const label = document.createElement('label');
    label.className = 'department-check';
    label.innerHTML = `
      <input type="checkbox" value="${escapeHtml(user.id)}" />
      <span>
        <strong>${escapeHtml(user.name)}</strong>
        <small>${escapeHtml([user.email, user.department].filter(Boolean).join(' - '))}</small>
      </span>
    `;
    wrap.appendChild(label);
  });
}

function setCalendarModeFields() {
  const mode = el('calendarMeetingMode')?.value || 'online';
  const linkWrap = el('calendarMeetingLinkWrap');
  if (linkWrap) {
    linkWrap.style.display = mode === 'presencial' ? 'none' : '';
  }
}

function setCalendarAllDayState() {
  const allDay = Boolean(el('calendarAllDay')?.checked);
  ['calendarStartTime', 'calendarEndTime'].forEach((id) => {
    const field = el(id);
    if (field) field.disabled = allDay;
  });
}

function renderCalendarHistory(history = []) {
  const wrap = el('calendarHistoryList');
  if (!wrap) return;
  if (!Array.isArray(history) || !history.length) {
    wrap.innerHTML = '<div class="intranet-empty-card">Nenhum historico registrado ainda para este compromisso.</div>';
    return;
  }
  wrap.innerHTML = history.map((item) => `
    <div class="intranet-sales-history-item">
      <strong>${escapeHtml(item.action || 'Atualizacao')}</strong>
      <div class="small muted">${escapeHtml(formatDate(item.created_at))} - ${escapeHtml(item.actor_name || 'Sistema')}</div>
      <div>${escapeHtml(item.field_name || '')}${item.old_value || item.new_value ? `: ${escapeHtml(item.old_value || '-')} -> ${escapeHtml(item.new_value || '-')}` : ''}</div>
    </div>
  `).join('');
}

function resetCalendarEditor(dateKey = '') {
  const form = el('calendarForm');
  if (!form) return;
  form.reset();
  el('calendarEventId').value = '';
  el('calendarEditorTitle').textContent = 'Novo compromisso';
  el('btnCalendarCancelEvent').style.display = 'none';
  const baseDate = dateKey || calendarState.baseDate || getTodayDateKey();
  el('calendarStartDate').value = baseDate;
  el('calendarEndDate').value = baseDate;
  el('calendarStartTime').value = '09:00';
  el('calendarEndTime').value = '10:00';
  Array.from(document.querySelectorAll('#calendarParticipants input[type="checkbox"]')).forEach((input) => {
    input.checked = false;
  });
  setCalendarAllDayState();
  setCalendarModeFields();
  renderCalendarHistory([]);
}

function fillCalendarEditor(event = null, history = []) {
  if (!event) {
    resetCalendarEditor();
    return;
  }
  el('calendarEventId').value = String(event.id || '');
  el('calendarEditorTitle').textContent = event.title || 'Compromisso';
  el('calendarTitle').value = event.title || '';
  el('calendarDescription').value = event.description || '';
  el('calendarEventType').value = event.event_type_id ? String(event.event_type_id) : '';
  el('calendarMeetingMode').value = event.meeting_mode || 'online';
  el('calendarAllDay').checked = Boolean(event.all_day);
  el('calendarStartDate').value = event.start_date || '';
  el('calendarStartTime').value = event.start_time || '09:00';
  el('calendarEndDate').value = event.end_date || event.start_date || '';
  el('calendarEndTime').value = event.end_time || '10:00';
  el('calendarLocation').value = event.location || '';
  el('calendarMeetingLink').value = event.meeting_link || '';
  el('calendarNotes').value = event.notes || '';
  const participants = new Set((event.participants || []).map((item) => String(item.user_id)));
  Array.from(document.querySelectorAll('#calendarParticipants input[type="checkbox"]')).forEach((input) => {
    input.checked = participants.has(String(input.value));
  });
  el('btnCalendarCancelEvent').style.display = event.status === 'cancelled' ? 'none' : '';
  setCalendarAllDayState();
  setCalendarModeFields();
  renderCalendarHistory(history || []);
}

function renderCalendarViewButtons() {
  Array.from(document.querySelectorAll('#calendarViewSwitch [data-view]')).forEach((button) => {
    const active = button.getAttribute('data-view') === calendarState.view;
    button.classList.toggle('primary', active);
  });
}

function buildCalendarMonthGrid(events = []) {
  const range = calendarState.range || {};
  const start = new Date(`${range.from}T12:00:00-03:00`);
  const end = new Date(`${range.to}T12:00:00-03:00`);
  const byDate = new Map();
  events.forEach((event) => {
    const key = event.start_date || '';
    if (!byDate.has(key)) byDate.set(key, []);
    byDate.get(key).push(event);
  });

  const days = [];
  const cursor = new Date(start);
  while (cursor.getTime() <= end.getTime()) {
    const dateKey = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Sao_Paulo',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(cursor);
    days.push(dateKey);
    cursor.setDate(cursor.getDate() + 1);
  }

  return `
    <div class="intranet-calendar-month">
      <div class="intranet-calendar-weekdays">
        ${['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sab'].map((label) => `<div>${label}</div>`).join('')}
      </div>
      <div class="intranet-calendar-grid">
        ${days.map((dateKey) => {
          const items = byDate.get(dateKey) || [];
          return `
            <div class="intranet-calendar-day">
              <button class="intranet-calendar-day-number" type="button" data-date="${escapeHtml(dateKey)}">${escapeHtml(dateKey.slice(-2))}</button>
              <div class="intranet-calendar-day-events">
                ${items.slice(0, 4).map((item) => `
                  <button class="intranet-calendar-event-chip" type="button" data-event-id="${escapeHtml(item.id)}">
                    <span>${escapeHtml(item.start_time || '')}</span>${escapeHtml(item.title || 'Compromisso')}
                  </button>
                `).join('')}
                ${items.length > 4 ? `<div class="small muted">+ ${items.length - 4} compromisso(s)</div>` : ''}
              </div>
            </div>
          `;
        }).join('')}
      </div>
    </div>
  `;
}

function buildCalendarListView(events = []) {
  if (!events.length) {
    return '<div class="intranet-empty-card">Nenhum compromisso encontrado para este periodo.</div>';
  }
  const grouped = new Map();
  events.forEach((event) => {
    const key = event.start_date || '';
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(event);
  });

  return `
    <div class="intranet-calendar-list">
      ${Array.from(grouped.entries()).map(([dateKey, items]) => `
        <div class="intranet-calendar-list-day">
          <div class="intranet-block-title">${escapeHtml(formatCalendarDateLabel(dateKey))}</div>
          ${items.map((item) => `
            <button class="intranet-calendar-list-item" type="button" data-event-id="${escapeHtml(item.id)}">
              <div>
                <strong>${escapeHtml(item.title || 'Compromisso')}</strong>
                <div class="small muted">${escapeHtml(item.event_type_name || 'Agenda')} - ${escapeHtml(getCalendarModeLabel(item.meeting_mode))}</div>
              </div>
              <span>${escapeHtml(item.all_day ? 'Dia inteiro' : `${item.start_time || ''} - ${item.end_time || ''}`)}</span>
            </button>
          `).join('')}
        </div>
      `).join('')}
    </div>
  `;
}

function renderCalendarView() {
  const wrap = el('calendarView');
  if (!wrap) return;
  wrap.innerHTML = calendarState.view === 'month'
    ? buildCalendarMonthGrid(calendarState.events || [])
    : buildCalendarListView(calendarState.events || []);

  Array.from(wrap.querySelectorAll('[data-event-id]')).forEach((button) => {
    button.addEventListener('click', () => selectCalendarEvent(Number(button.getAttribute('data-event-id'))));
  });
  Array.from(wrap.querySelectorAll('[data-date]')).forEach((button) => {
    button.addEventListener('click', () => {
      const dateKey = button.getAttribute('data-date');
      resetCalendarEditor(dateKey);
    });
  });
}

async function selectCalendarEvent(eventId) {
  calendarState.selectedEventId = Number(eventId || 0);
  try {
    const { event, history } = await api(`/api/intranet/calendar/events/${eventId}`);
    fillCalendarEditor(event, history || []);
  } catch (err) {
    alert('Nao foi possivel carregar o compromisso: ' + err.message);
  }
}

function collectCalendarPayload() {
  return {
    title: el('calendarTitle').value.trim(),
    description: el('calendarDescription').value.trim(),
    event_type_id: el('calendarEventType').value || null,
    meeting_mode: el('calendarMeetingMode').value,
    all_day: el('calendarAllDay').checked,
    start_date: el('calendarStartDate').value,
    start_time: el('calendarStartTime').value,
    end_date: el('calendarEndDate').value,
    end_time: el('calendarEndTime').value,
    location: el('calendarLocation').value.trim(),
    meeting_link: el('calendarMeetingLink').value.trim(),
    notes: el('calendarNotes').value.trim(),
    participant_ids: Array.from(document.querySelectorAll('#calendarParticipants input[type="checkbox"]:checked')).map((input) => Number(input.value)),
  };
}

async function fetchCalendarEvents() {
  const params = new URLSearchParams();
  if (calendarState.baseDate) params.set('base_date', calendarState.baseDate);
  params.set('view', calendarState.view);
  if (el('calendarUserFilter')?.value) params.set('user_id', el('calendarUserFilter').value);
  if (el('calendarTypeFilter')?.value) params.set('event_type_id', el('calendarTypeFilter').value);
  if (el('calendarModeFilter')?.value) params.set('meeting_mode', el('calendarModeFilter').value);
  if (el('calendarStatusFilter')?.value) params.set('status', el('calendarStatusFilter').value);
  if (el('calendarSearchInput')?.value.trim()) params.set('search', el('calendarSearchInput').value.trim());
  params.set('limit', '180');

  const { events, range: resolvedRange } = await api(`/api/intranet/calendar/events?${params.toString()}`);
  calendarState.events = Array.isArray(events) ? events : [];
  calendarState.range = resolvedRange || calendarState.range;
  el('calendarRangeLabel').textContent = formatCalendarRangeLabel(calendarState.range || {});
  renderCalendarSummary();
  renderCalendarViewButtons();
  renderCalendarView();

  if (calendarState.selectedEventId && calendarState.events.some((item) => Number(item.id) === Number(calendarState.selectedEventId))) {
    await selectCalendarEvent(calendarState.selectedEventId);
  } else {
    calendarState.selectedEventId = null;
    resetCalendarEditor(calendarState.baseDate || getTodayDateKey());
  }
}

async function fetchCalendarBootstrap() {
  const { calendar } = await api('/api/intranet/calendar/bootstrap');
  calendarState.enabled = Boolean(calendar?.enabled);
  calendarState.eventTypes = calendar?.event_types || [];
  calendarState.users = calendar?.users || [];
  calendarState.summary = calendar?.summary || null;
  calendarState.baseDate = getTodayDateKey();
  calendarState.range = null;

  renderCalendarTypeOptions();
  renderCalendarUserOptions();
  renderCalendarParticipants();

  const modeSelect = el('calendarModeFilter');
  if (modeSelect) {
    modeSelect.innerHTML = '<option value="">Todos</option>' + (calendar?.meeting_modes || []).map((item) => `<option value="${escapeHtml(item.key)}">${escapeHtml(item.label)}</option>`).join('');
  }

  resetCalendarEditor(calendarState.baseDate);
  await fetchCalendarEvents();
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
  await fetchCalendarBootstrap().catch(() => {});
  const { user, intranet } = bootstrapData;
  allModuleItems = intranet.modules || [];
  allDocumentItems = intranet.document_center?.recent_documents || [];

  decorateSidebarNav();
  applySidebarPreference();
  renderSidebar(user, intranet);
  renderHero(user, intranet);
  renderDashboard(intranet);
  renderModules(intranet);
  renderDepartments(intranet);
  renderDocuments(intranet);
  hydrateSalesWorkspace(intranet);
  renderCommunication(intranet);

  el('documentSearch').addEventListener('input', applyDocumentFilter);
  el('btnNewCalendarEvent')?.addEventListener('click', () => resetCalendarEditor(calendarState.baseDate || getTodayDateKey()));
  el('btnCalendarReset')?.addEventListener('click', () => resetCalendarEditor(calendarState.baseDate || getTodayDateKey()));
  el('btnCalendarPrev')?.addEventListener('click', async () => {
    const step = calendarState.view === 'month' ? -30 : calendarState.view === 'week' ? -7 : -1;
    calendarState.baseDate = addDays(calendarState.baseDate || getTodayDateKey(), step);
    await fetchCalendarEvents();
  });
  el('btnCalendarToday')?.addEventListener('click', async () => {
    calendarState.baseDate = getTodayDateKey();
    await fetchCalendarEvents();
  });
  el('btnCalendarNext')?.addEventListener('click', async () => {
    const step = calendarState.view === 'month' ? 30 : calendarState.view === 'week' ? 7 : 1;
    calendarState.baseDate = addDays(calendarState.baseDate || getTodayDateKey(), step);
    await fetchCalendarEvents();
  });
  Array.from(document.querySelectorAll('#calendarViewSwitch [data-view]')).forEach((button) => {
    button.addEventListener('click', async () => {
      calendarState.view = button.getAttribute('data-view') || 'month';
      await fetchCalendarEvents();
    });
  });
  el('calendarMeetingMode')?.addEventListener('change', setCalendarModeFields);
  el('calendarAllDay')?.addEventListener('change', setCalendarAllDayState);
  el('calendarUserFilter')?.addEventListener('change', fetchCalendarEvents);
  el('calendarTypeFilter')?.addEventListener('change', fetchCalendarEvents);
  el('calendarModeFilter')?.addEventListener('change', fetchCalendarEvents);
  el('calendarStatusFilter')?.addEventListener('change', fetchCalendarEvents);
  el('calendarSearchInput')?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      fetchCalendarEvents();
    }
  });
  el('calendarForm')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      const eventId = Number(el('calendarEventId').value || 0);
      const payload = collectCalendarPayload();
      const response = eventId
        ? await api(`/api/intranet/calendar/events/${eventId}`, {
            method: 'PATCH',
            body: JSON.stringify(payload),
          })
        : await api('/api/intranet/calendar/events', {
            method: 'POST',
            body: JSON.stringify(payload),
          });
      calendarState.selectedEventId = response?.event?.id || eventId || null;
      await fetchCalendarEvents();
      if (calendarState.selectedEventId) {
        await selectCalendarEvent(calendarState.selectedEventId);
      }
    } catch (err) {
      alert('Nao foi possivel salvar o compromisso: ' + err.message);
    }
  });
  el('btnCalendarCancelEvent')?.addEventListener('click', async () => {
    const eventId = Number(el('calendarEventId').value || 0);
    if (!eventId) return;
    const reason = window.prompt('Motivo do cancelamento (opcional):', '');
    try {
      await api(`/api/intranet/calendar/events/${eventId}/cancel`, {
        method: 'POST',
        body: JSON.stringify({ cancel_reason: reason || '' }),
      });
      await fetchCalendarEvents();
      await selectCalendarEvent(eventId);
    } catch (err) {
      alert('Nao foi possivel cancelar o compromisso: ' + err.message);
    }
  });
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
  el('btnIntranetMenu')?.addEventListener('click', toggleSidebar);
  el('btnSidebarCollapse')?.addEventListener('click', toggleSidebar);
  Array.from(document.querySelectorAll('.intranet-nav-link')).forEach((link) => {
    link.addEventListener('click', () => closeSidebarOnMobile());
  });
  document.addEventListener('click', (event) => {
    if (window.innerWidth > 960) return;
    const sidebar = el('intranetSidebar');
    if (!document.body.classList.contains('intranet-sidebar-open')) return;
    if (sidebar.contains(event.target) || event.target.closest('#btnIntranetMenu')) return;
    setSidebarOpen(false);
  });
  window.addEventListener('resize', () => {
    applySidebarPreference();
  });
  syncSidebarButtons();

  if (salesState.enabled && salesState.selectedRecordId) {
    selectSalesRecord(salesState.selectedRecordId);
  }
}

window.addEventListener('DOMContentLoaded', init);

