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
  chevron: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg>',
  general: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16"/><path d="M4 12h16"/><path d="M4 18h10"/></svg>',
};

const i18n = () => window.TalkersI18n;
const t = (key, params = {}, fallback = '') => {
  const translated = i18n()?.t?.(key, params, fallback);
  return translated ?? fallback ?? key;
};
const currentLocale = () => i18n()?.getLocale?.() || 'pt-BR';
const localeDate = (value, options = {}) => {
  if (!value) return '';
  try {
    return new Intl.DateTimeFormat(currentLocale(), options).format(new Date(value));
  } catch {
    return String(value || '');
  }
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
let communicationState = {
  catalog: [],
  editingId: null,
};
let influencerState = {
  enabled: false,
  loading: false,
  loaded: false,
  error: '',
  bootstrap: null,
  editingId: null,
  formDraft: null,
  selectedInfluencerId: null,
  detail: null,
  detailLoading: false,
  detailError: '',
  formCollapsed: false,
  filters: {
    periodType: 'month',
    from: '',
    to: '',
  },
  analysis: {
    loading: false,
    periodType: 'month',
    result: '',
    generatedAt: '',
  },
};
const SIDEBAR_STORAGE_KEY = 'talkers_intranet_sidebar_state_v1';
const VIEW_STORAGE_KEY = 'talkers_intranet_view_state_v1';
const DEPARTMENT_TREE_STORAGE_KEY = 'talkers_intranet_department_tree_state_v1';
let currentViewState = { key: 'home', departmentSlug: '', submenuSlug: '' };
let expandedDepartmentSlugs = new Set();

function renderIcon(name) {
  return ICONS[name] || ICONS.general;
}

async function api(path, opts = {}) {
  const res = await fetch(path, {
    credentials: 'include',
    headers: opts.body instanceof FormData
      ? { ...(i18n()?.buildHeaders?.() || {}), ...(opts.headers || {}) }
      : { 'Content-Type': 'application/json', ...(i18n()?.buildHeaders?.() || {}), ...(opts.headers || {}) },
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

function compareAlpha(a, b) {
  return String(a || '').localeCompare(String(b || ''), currentLocale(), {
    sensitivity: 'base',
    numeric: true,
  });
}

function sortAlphabetically(items = [], resolver) {
  return [...(Array.isArray(items) ? items : [])].sort((left, right) => {
    const leftValue = resolver ? resolver(left) : left;
    const rightValue = resolver ? resolver(right) : right;
    return compareAlpha(leftValue, rightValue);
  });
}

function formatDate(value) {
  try {
    return new Date(value).toLocaleString(currentLocale());
  } catch {
    return '';
  }
}

function toDateTimeLocalValue(value) {
  if (!value) return '';
  try {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return `${year}-${month}-${day}T${hours}:${minutes}`;
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

  if (brazilHour < 12) return t('greetings.morning');
  if (brazilHour < 18) return t('greetings.afternoon');
  return t('greetings.evening');
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
    ? (expanded ? t('common.collapseMenu') : t('common.expandMenu'))
    : (expanded ? t('common.closeMenu') : t('common.openMenu'));

  ['btnIntranetMenu', 'btnSidebarCollapse'].forEach((id) => {
    const button = el(id);
    if (!button) return;
    button.setAttribute('aria-expanded', expanded ? 'true' : 'false');
    button.setAttribute('aria-label', label);
    button.title = label;
  });
}

function renderIntranetChrome() {
  document.title = t('intranet.title');
  const brandTitle = el('intranetBrandTitle');
  if (brandTitle) brandTitle.textContent = t('intranet.title');
  const brandSub = el('intranetBrandSub');
  if (brandSub) brandSub.textContent = t('intranet.brandSub');
  const topbarEyebrow = el('intranetTopbarEyebrow');
  if (topbarEyebrow) topbarEyebrow.textContent = t('intranet.eyebrow');
  const heroBadge = el('intranetHeroBadge');
  if (heroBadge) heroBadge.textContent = t('intranet.heroBadge');
  const overviewEyebrow = el('homeOverviewEyebrow');
  if (overviewEyebrow) overviewEyebrow.textContent = t('intranet.overviewEyebrow');
  const overviewTitle = el('homeOverviewTitle');
  if (overviewTitle) overviewTitle.textContent = t('intranet.overviewTitle');
  const communicationEyebrow = el('homeCommunicationEyebrow');
  if (communicationEyebrow) communicationEyebrow.textContent = t('intranet.communicationEyebrow');
  const communicationTitle = el('homeCommunicationTitle');
  if (communicationTitle) communicationTitle.textContent = t('intranet.communicationTitle');
  const quickEyebrow = el('homeQuickEyebrow');
  if (quickEyebrow) quickEyebrow.textContent = t('intranet.quickEyebrow');
  const quickTitle = el('homeQuickTitle');
  if (quickTitle) quickTitle.textContent = t('intranet.quickTitle');
  const sidebarDepartmentsTitle = el('intranetSidebarDepartmentsTitle');
  if (sidebarDepartmentsTitle) sidebarDepartmentsTitle.textContent = t('intranet.sidebarDepartments');
  const sidebarRemindersTitle = el('intranetSidebarRemindersTitle');
  if (sidebarRemindersTitle) sidebarRemindersTitle.textContent = t('intranet.sidebarReminders');
  document.querySelectorAll('.intranet-back-btn, .intranet-topbar-actions .btn[href="/index.html"]').forEach((node) => {
    node.textContent = t('common.backToChat');
  });
  const newEventBtn = el('btnNewCalendarEvent');
  if (newEventBtn) newEventBtn.textContent = t('calendar.newEvent');
  const prevBtn = el('btnCalendarPrev');
  if (prevBtn) prevBtn.textContent = t('calendar.previous');
  const todayBtn = el('btnCalendarToday');
  if (todayBtn) todayBtn.textContent = t('calendar.today');
  const nextBtn = el('btnCalendarNext');
  if (nextBtn) nextBtn.textContent = t('calendar.next');
  const rangeLabel = el('calendarRangeLabel');
  if (rangeLabel && !calendarState.range) rangeLabel.textContent = t('common.loading');
  document.querySelectorAll('#calendarViewSwitch [data-view]').forEach((button) => {
    const view = button.getAttribute('data-view');
    button.textContent = t(`calendar.${view}`, {}, button.textContent || view);
  });
  const statusFilter = el('calendarStatusFilter');
  if (statusFilter) {
    const allOption = statusFilter.querySelector('option[value=""]');
    const scheduled = statusFilter.querySelector('option[value="scheduled"]');
    const cancelled = statusFilter.querySelector('option[value="cancelled"]');
    if (allOption) allOption.textContent = t('common.all');
    if (scheduled) scheduled.textContent = t('calendar.statusLabel.scheduled');
    if (cancelled) cancelled.textContent = t('calendar.statusLabel.cancelled');
  }
  const meetingMode = el('calendarMeetingMode');
  if (meetingMode) {
    const online = meetingMode.querySelector('option[value="online"]');
    const presencial = meetingMode.querySelector('option[value="presencial"]');
    const hibrida = meetingMode.querySelector('option[value="hibrida"]');
    if (online) online.textContent = t('calendar.modeLabel.online');
    if (presencial) presencial.textContent = t('calendar.modeLabel.presencial');
    if (hibrida) hibrida.textContent = t('calendar.modeLabel.hibrida');
  }
  const fieldMap = [
    ['label[for="calendarUserFilter"]', t('calendar.user')],
    ['label[for="calendarTypeFilter"]', t('calendar.type')],
    ['label[for="calendarModeFilter"]', t('calendar.mode')],
    ['label[for="calendarStatusFilter"]', t('calendar.status')],
    ['label[for="calendarSearchInput"]', t('calendar.search')],
    ['label[for="calendarTitle"]', t('calendar.title')],
    ['label[for="calendarDescription"]', t('calendar.description')],
    ['label[for="calendarEventType"]', t('calendar.eventType')],
    ['label[for="calendarMeetingMode"]', t('calendar.meetingMode')],
    ['label[for="calendarStartDate"]', t('calendar.startDate')],
    ['label[for="calendarStartTime"]', t('calendar.startTime')],
    ['label[for="calendarEndDate"]', t('calendar.endDate')],
    ['label[for="calendarEndTime"]', t('calendar.endTime')],
    ['label[for="calendarLocation"]', t('calendar.location')],
    ['label[for="calendarMeetingLink"]', t('calendar.meetingLink')],
    ['label[for="calendarNotes"]', t('calendar.notes')],
  ];
  fieldMap.forEach(([selector, text]) => {
    const node = document.querySelector(selector);
    if (node) node.textContent = text;
  });
  const search = el('calendarSearchInput');
  if (search) search.placeholder = t('calendar.searchPlaceholder');
  const calendarTitle = el('calendarTitle');
  if (calendarTitle) calendarTitle.placeholder = t('calendar.defaultEventTitle');
  const calendarDescription = el('calendarDescription');
  if (calendarDescription) calendarDescription.placeholder = t('calendar.description');
  const calendarLocation = el('calendarLocation');
  if (calendarLocation) calendarLocation.placeholder = t('calendar.location');
  const calendarMeetingLink = el('calendarMeetingLink');
  if (calendarMeetingLink) calendarMeetingLink.placeholder = 'https://...';
  const calendarNotes = el('calendarNotes');
  if (calendarNotes) calendarNotes.placeholder = t('calendar.notes');
  const detailsEyebrow = document.querySelector('#calendar .intranet-sales-detail-head .intranet-section-eyebrow');
  if (detailsEyebrow) detailsEyebrow.textContent = t('calendar.detailsEyebrow', {}, 'Detalhes do compromisso');
  const allDayStrong = document.querySelector('#calendar .admin-check-row strong');
  const allDaySmall = document.querySelector('#calendar .admin-check-row small');
  if (allDayStrong) allDayStrong.textContent = t('calendar.allDay');
  if (allDaySmall) allDaySmall.textContent = t('calendar.allDayHint');
  const participantLabel = document.querySelector('#calendarParticipants')?.parentElement?.querySelector('label:not([for])');
  const participantHint = document.querySelector('#calendarParticipants')?.parentElement?.querySelector('.small.muted');
  if (participantLabel) participantLabel.textContent = t('calendar.participants');
  if (participantHint) participantHint.textContent = t('calendar.participantsHint', {}, 'Selecione uma ou mais pessoas. O compromisso aparecerá na agenda de todos os participantes.');
  const resetBtn = el('btnCalendarReset');
  if (resetBtn) resetBtn.textContent = t('calendar.reset');
  const cancelBtn = el('btnCalendarCancelEvent');
  if (cancelBtn) cancelBtn.textContent = t('calendar.cancelEvent');
  const saveBtn = el('btnCalendarSave');
  if (saveBtn) saveBtn.textContent = t('calendar.save');
  const communicationTitleLabel = document.querySelector('label[for="communicationTitle"]');
  const communicationSummaryLabel = document.querySelector('label[for="communicationSummary"]');
  const communicationContentLabel = document.querySelector('label[for="communicationContent"]');
  const communicationTypeLabel = document.querySelector('label[for="communicationType"]');
  const communicationPriorityLabel = document.querySelector('label[for="communicationPriority"]');
  const communicationAudienceLabel = document.querySelector('label[for="communicationAudienceScope"]');
  const communicationStartsAtLabel = document.querySelector('label[for="communicationStartsAt"]');
  const communicationEndsAtLabel = document.querySelector('label[for="communicationEndsAt"]');
  if (communicationTitleLabel) communicationTitleLabel.textContent = t('intranet.communication.fields.title', {}, 'Titulo');
  if (communicationSummaryLabel) communicationSummaryLabel.textContent = t('intranet.communication.fields.summary', {}, 'Resumo');
  if (communicationContentLabel) communicationContentLabel.textContent = t('intranet.communication.fields.content', {}, 'Conteudo completo');
  if (communicationTypeLabel) communicationTypeLabel.textContent = t('intranet.communication.fields.type', {}, 'Tipo');
  if (communicationPriorityLabel) communicationPriorityLabel.textContent = t('intranet.communication.fields.priority', {}, 'Prioridade');
  if (communicationAudienceLabel) communicationAudienceLabel.textContent = t('intranet.communication.fields.audience', {}, 'Publico');
  if (communicationStartsAtLabel) communicationStartsAtLabel.textContent = t('intranet.communication.fields.startsAt', {}, 'Inicio (opcional)');
  if (communicationEndsAtLabel) communicationEndsAtLabel.textContent = t('intranet.communication.fields.endsAt', {}, 'Fim (opcional)');
  const communicationTitleInput = el('communicationTitle');
  const communicationSummaryInput = el('communicationSummary');
  const communicationContentInput = el('communicationContent');
  if (communicationTitleInput) communicationTitleInput.placeholder = t('intranet.communication.placeholders.title', {}, 'Ex.: Treinamento interno desta semana');
  if (communicationSummaryInput) communicationSummaryInput.placeholder = t('intranet.communication.placeholders.summary', {}, 'Texto curto para a Home e notificacoes');
  if (communicationContentInput) communicationContentInput.placeholder = t('intranet.communication.placeholders.content', {}, 'Texto principal do comunicado');
  const communicationDepartmentsLabel = document.querySelector('#communicationDepartmentsWrap > label');
  const communicationDepartmentsHint = document.querySelector('#communicationDepartmentsWrap .small.muted');
  if (communicationDepartmentsLabel) communicationDepartmentsLabel.textContent = t('intranet.communication.fields.departments', {}, 'Departamentos do comunicado');
  if (communicationDepartmentsHint) communicationDepartmentsHint.textContent = t('intranet.communication.segmentedDepartmentsHint', {}, 'Use quando o publico for segmentado por departamento.');
  const communicationActiveStrong = document.querySelector('#communicationIsActive')?.closest('.admin-check-row')?.querySelector('strong');
  const communicationActiveSmall = document.querySelector('#communicationIsActive')?.closest('.admin-check-row')?.querySelector('small');
  if (communicationActiveStrong) communicationActiveStrong.textContent = t('intranet.communication.activeTitle', {}, 'Comunicado ativo');
  if (communicationActiveSmall) communicationActiveSmall.textContent = t('intranet.communication.activeHint', {}, 'Comunicados ativos aparecem na Home, na area de comunicacao e nas notificacoes internas.');
  const cancelCommunicationBtn = el('btnCancelCommunicationEdit');
  if (cancelCommunicationBtn) cancelCommunicationBtn.textContent = t('common.cancel');
  const publishedTitle = document.querySelector('#communicationManageList')?.previousElementSibling;
  if (publishedTitle && publishedTitle.classList.contains('intranet-block-title')) {
    publishedTitle.textContent = t('intranet.communication.publishedTitle', {}, 'Comunicados publicados');
  }
  const staticSectionMap = [
    ['#dashboard .intranet-section-eyebrow', t('intranet.routes.dashboardEyebrow', {}, 'BI')],
    ['#dashboard .intranet-section-title', t('intranet.routes.dashboardTitle', {}, 'Dashboard / BI')],
    ['#modules .intranet-section-eyebrow', t('intranet.routes.modulesEyebrow', {}, 'Workspace')],
    ['#modules .intranet-section-title', t('intranet.routes.modulesTitle', {}, 'Modulos')],
    ['#calendar .intranet-section-head .intranet-section-eyebrow', t('intranet.routes.calendarEyebrow', {}, 'Calendario corporativo')],
    ['#calendar .intranet-section-head .intranet-section-title', t('intranet.nav.calendar')],
    ['#departments .intranet-section-head .intranet-section-eyebrow', t('intranet.routes.departmentsEyebrow', {}, 'Areas de trabalho')],
    ['#departments .intranet-section-head .intranet-section-title', t('intranet.routes.departmentsTitle', {}, 'Departamentos')],
    ['#documents .intranet-section-eyebrow', t('intranet.routes.documentsEyebrow', {}, 'Base de conhecimento')],
    ['#documents .intranet-section-title', t('intranet.routes.documentsTitle', {}, 'Documentos')],
    ['#training .intranet-section-eyebrow', t('intranet.routes.trainingEyebrow', {}, 'Aprendizado e ingestao')],
    ['#training .intranet-section-title', t('intranet.routes.trainingTitle', {}, 'Treinamento IA')],
    ['#communication .intranet-section-eyebrow', t('intranet.routes.communicationEyebrow', {}, 'Avisos e comunicados')],
    ['#communication .intranet-section-title', t('intranet.routes.communicationTitle', {}, 'Comunicacao')],
  ];
  staticSectionMap.forEach(([selector, text]) => {
    const node = document.querySelector(selector);
    if (node) node.textContent = text;
  });
  syncSidebarButtons();
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

function readViewPreference() {
  try {
    const raw = localStorage.getItem(VIEW_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === 'object'
      ? {
          key: String(parsed.key || 'home'),
          departmentSlug: String(parsed.departmentSlug || ''),
          submenuSlug: String(parsed.submenuSlug || ''),
        }
      : { key: 'home', departmentSlug: '', submenuSlug: '' };
  } catch {
    return { key: 'home', departmentSlug: '', submenuSlug: '' };
  }
}

function writeViewPreference(route = {}) {
  try {
    localStorage.setItem(VIEW_STORAGE_KEY, JSON.stringify({
      key: String(route.key || 'home'),
      departmentSlug: String(route.departmentSlug || ''),
      submenuSlug: String(route.submenuSlug || ''),
    }));
  } catch {}
}

function readExpandedDepartmentPreference() {
  try {
    const raw = localStorage.getItem(DEPARTMENT_TREE_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(parsed) ? parsed.map((item) => String(item || '')) : []);
  } catch {
    return new Set();
  }
}

function writeExpandedDepartmentPreference() {
  try {
    localStorage.setItem(DEPARTMENT_TREE_STORAGE_KEY, JSON.stringify(Array.from(expandedDepartmentSlugs)));
  } catch {}
}

function getVisibleDepartments(intranet) {
  return sortAlphabetically(intranet?.departments || [], (item) => item?.name || item?.slug || '');
}

function getGlobalNavigationItems(intranet) {
  const items = [
    { key: 'home', label: t('intranet.nav.home'), icon: 'workspace' },
    { key: 'calendar', label: t('intranet.nav.calendar'), icon: 'calendar' },
    { key: 'sales', label: t('intranet.nav.sales'), icon: 'target', hidden: !Boolean(salesState?.enabled) },
  ];
  return items.filter((item) => !item.hidden);
}

function getDepartmentRouteMeta(intranet, departmentSlug = '', submenuSlug = '') {
  const department = getVisibleDepartments(intranet).find((item) => item.slug === departmentSlug) || null;
  const submenu = department?.submenus?.find((item) => item.slug === submenuSlug) || null;
  return { department, submenu };
}

function getRouteMeta(route = {}, intranet) {
  if (route.key === 'department') {
    const { department, submenu } = getDepartmentRouteMeta(intranet, route.departmentSlug, route.submenuSlug);
    return {
      title: submenu?.title || department?.name || 'Departamento',
      eyebrow: submenu ? (department?.name || 'Departamento') : 'Departamento',
    };
  }

  const map = {
    home: { title: t('intranet.nav.home'), eyebrow: t('intranet.eyebrow') },
    dashboard: { title: t('intranet.routes.dashboardTitle', {}, 'Dashboard / BI'), eyebrow: t('intranet.routes.dashboardEyebrow', {}, 'BI') },
    modules: { title: t('intranet.routes.modulesTitle', {}, 'Modulos'), eyebrow: t('intranet.routes.modulesEyebrow', {}, 'Workspace') },
    calendar: { title: t('intranet.nav.calendar'), eyebrow: t('intranet.routes.calendarEyebrow', {}, 'Calendario corporativo') },
    departments: { title: t('intranet.routes.departmentsTitle', {}, 'Departamentos'), eyebrow: t('intranet.routes.departmentsEyebrow', {}, 'Areas de trabalho') },
    documents: { title: t('intranet.routes.documentsTitle', {}, 'Documentos'), eyebrow: t('intranet.routes.documentsEyebrow', {}, 'Base de conhecimento') },
    training: { title: t('intranet.routes.trainingTitle', {}, 'Treinamento IA'), eyebrow: t('intranet.routes.trainingEyebrow', {}, 'Aprendizado e ingestao') },
    communication: { title: t('intranet.routes.communicationTitle', {}, 'Comunicacao'), eyebrow: t('intranet.routes.communicationEyebrow', {}, 'Avisos e comunicados') },
    sales: { title: t('intranet.nav.sales'), eyebrow: t('intranet.routes.salesEyebrow', {}, 'Operacao comercial') },
  };

  return map[route.key] || { title: t('intranet.title'), eyebrow: t('intranet.eyebrow') };
}

function normalizeViewState(route = {}, intranet) {
  const visibleDepartments = getVisibleDepartments(intranet);
  const normalized = {
    key: String(route.key || 'home'),
    departmentSlug: String(route.departmentSlug || ''),
    submenuSlug: String(route.submenuSlug || ''),
  };

  const globalKeys = new Set(getGlobalNavigationItems(intranet).map((item) => item.key));
  const internalKeys = new Set();
  if (normalized.key === 'department') {
    const department = visibleDepartments.find((item) => item.slug === normalized.departmentSlug);
    if (!department) return { key: 'home', departmentSlug: '', submenuSlug: '' };
    const submenu = normalized.submenuSlug
      ? (department.submenus || []).find((item) => item.slug === normalized.submenuSlug)
      : null;
    return {
      key: 'department',
      departmentSlug: department.slug,
      submenuSlug: submenu?.slug || '',
    };
  }

  if (normalized.key === 'sales' && !salesState.enabled) {
    return { key: 'home', departmentSlug: '', submenuSlug: '' };
  }

  if (!globalKeys.has(normalized.key) && !internalKeys.has(normalized.key)) {
    return { key: 'home', departmentSlug: '', submenuSlug: '' };
  }

  return normalized;
}

function applyIntranetSnapshot(snapshot, options = {}) {
  if (!snapshot?.intranet || !snapshot?.user) return;
  const preserveRoute = options.preserveRoute !== false;
  const nextRoute = preserveRoute
    ? normalizeViewState(options.route || currentViewState, snapshot.intranet)
    : normalizeViewState({ key: 'home', departmentSlug: '', submenuSlug: '' }, snapshot.intranet);

  bootstrapData = snapshot;
  allModuleItems = snapshot.intranet.modules || [];
  allDocumentItems = snapshot.intranet.document_center?.recent_documents || [];

  renderSidebar(snapshot.user, snapshot.intranet);
  renderHero(snapshot.user, snapshot.intranet);
  renderDashboard(snapshot.intranet);
  renderModules(snapshot.intranet);
  renderDepartments(snapshot.intranet);
  renderDocuments(snapshot.intranet);
  hydrateSalesWorkspace(snapshot.intranet);
  renderCommunication(snapshot.intranet);
  renderDepartmentWorkspace(snapshot.intranet);

  currentViewState = nextRoute;
  setActiveView(nextRoute.key, nextRoute);
}

async function refreshIntranetBootstrap(options = {}) {
  const snapshot = await api('/api/intranet/bootstrap');
  applyIntranetSnapshot(snapshot, {
    route: options.route || currentViewState,
    preserveRoute: options.preserveRoute !== false,
  });

  if (canManageCommunication()) {
    await fetchCommunicationCatalog();
  }
}

function syncTopbar(route, intranet) {
  const meta = getRouteMeta(route, intranet);
  const greeting = el('intranetGreeting');
  if (greeting) greeting.textContent = meta.title;
  const eyebrow = document.querySelector('.intranet-topbar .intranet-eyebrow');
  if (eyebrow) eyebrow.textContent = meta.eyebrow;
  document.title = `${meta.title} - Intranet Talkers`;
}

function syncVisibleViews(route) {
  Array.from(document.querySelectorAll('.intranet-view')).forEach((section) => {
    const sectionView = section.getAttribute('data-view');
    const shouldShow = route.key === 'department'
      ? sectionView === 'department'
      : sectionView === route.key;
    section.hidden = !shouldShow;
  });
}

function syncSidebarNavigation(intranet) {
  Array.from(document.querySelectorAll('[data-nav-key]')).forEach((item) => {
    const isActive = item.getAttribute('data-nav-key') === currentViewState.key;
    item.classList.toggle('is-active', isActive);
    item.setAttribute('aria-current', isActive ? 'page' : 'false');
  });

  Array.from(document.querySelectorAll('.intranet-department-group')).forEach((group) => {
    const slug = group.getAttribute('data-department-slug') || '';
    const isExpanded = expandedDepartmentSlugs.has(slug);
    const isDepartmentActive = currentViewState.key === 'department' && currentViewState.departmentSlug === slug;
    group.classList.toggle('is-open', isExpanded);
    group.classList.toggle('is-active', isDepartmentActive);

    const toggle = group.querySelector('.intranet-department-toggle');
    if (toggle) toggle.setAttribute('aria-expanded', isExpanded ? 'true' : 'false');

    const submenuList = group.querySelector('.intranet-department-submenu-list');
    if (submenuList) submenuList.hidden = !isExpanded;

    Array.from(group.querySelectorAll('.intranet-submenu-link')).forEach((button) => {
      const submenuSlug = button.getAttribute('data-submenu-slug') || '';
      const active = isDepartmentActive && currentViewState.submenuSlug === submenuSlug;
      button.classList.toggle('is-active', active);
    });
  });
}

function toggleDepartmentExpanded(slug, forceValue = null) {
  const safeSlug = String(slug || '').trim();
  if (!safeSlug) return;
  const shouldOpen = typeof forceValue === 'boolean' ? forceValue : !expandedDepartmentSlugs.has(safeSlug);
  if (shouldOpen) {
    expandedDepartmentSlugs.add(safeSlug);
  } else {
    expandedDepartmentSlugs.delete(safeSlug);
  }
  writeExpandedDepartmentPreference();
  syncSidebarNavigation(bootstrapData?.intranet || {});
}

function resolveQuickLinkRoute(link = {}) {
  if (link.routeKey) return { key: String(link.routeKey) };

  const anchor = String(link.anchor || '').trim().replace(/^#/, '');
  const anchorMap = {
    home: { key: 'home' },
    calendar: { key: 'calendar' },
    sales: { key: 'sales' },
  };
  if (anchor && anchorMap[anchor]) return anchorMap[anchor];
  return null;
}

function openHomeArea(targetId = 'home') {
  setActiveView('home');
  window.setTimeout(() => {
    const target = el(targetId);
    if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, 40);
}

function renderSidebarUtility(intranet) {
  const feed = el('sidebarUtilityFeed');
  if (!feed) return;
  feed.innerHTML = '';

  const notifications = Array.isArray(intranet?.notifications) ? intranet.notifications : [];
  const upcoming = Array.isArray(intranet?.home?.upcoming_events) ? intranet.home.upcoming_events : [];
  const items = [
    ...notifications.slice(0, 3).map((item) => ({
      type: item.type || 'notification',
      title: item.title || t('intranet.generic.update', {}, 'Atualizacao'),
      description: item.description || '',
    })),
    ...upcoming.slice(0, 3).map((item) => ({
      type: 'event',
      title: item.title || t('calendar.defaultEventTitle', {}, 'Compromisso'),
      description: `${formatDate(item.start_at || item.start_date || '')}${item.meeting_mode ? ` - ${getCalendarModeLabel(item.meeting_mode)}` : item.meeting_mode_label ? ` - ${item.meeting_mode_label}` : ''}`,
    })),
  ].slice(0, 5);

  if (!items.length) {
    feed.innerHTML = `<div class="small muted">${escapeHtml(t('intranet.sidebarUtilityEmpty', {}, 'Nenhum lembrete próximo no momento.'))}</div>`;
    return;
  }

  items.forEach((item) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'intranet-side-link intranet-utility-item';
    button.innerHTML = `
      <span class="intranet-nav-link-icon">${renderIcon(item.type === 'event' ? 'calendar' : item.type === 'announcement' ? 'megaphone' : 'general')}</span>
      <span class="intranet-side-link-copy">
        <strong>${escapeHtml(item.title || t('intranet.generic.update', {}, 'Atualizacao'))}</strong>
        <small>${escapeHtml(item.description || '')}</small>
      </span>
    `;
    button.onclick = () => {
      if (item.type === 'event') {
        setActiveView('calendar');
        return;
      }
      openHomeArea('homeCommunicationSection');
    };
    feed.appendChild(button);
  });
}

function renderSidebar(user, intranet) {
  const visibleDepartments = getVisibleDepartments(intranet);
  el('intranetBrandSub').textContent = user.role === 'admin'
    ? t('intranet.brandSubAdminAccess', {}, 'Acesso administrativo total')
    : t('intranet.brandSubUserAccess', { count: visibleDepartments.length, email: user.email || '' }, `${visibleDepartments.length} area(s) liberada(s) - ${user.email || ''}`);

  const primaryNav = el('intranetPrimaryNav');
  primaryNav.innerHTML = '';
  getGlobalNavigationItems(intranet).forEach((item) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'intranet-nav-link';
    button.setAttribute('data-nav-key', item.key);
    button.innerHTML = `
      <span class="intranet-nav-link-icon">${renderIcon(item.icon || 'general')}</span>
      <span class="intranet-nav-link-label">${escapeHtml(item.label)}</span>
    `;
    button.onclick = () => setActiveView(item.key);
    primaryNav.appendChild(button);
  });

  const departmentNav = el('intranetDepartmentNav');
  departmentNav.innerHTML = '';
  if (!visibleDepartments.length) {
    departmentNav.innerHTML = `<div class="small muted">${escapeHtml(t('intranet.sidebarNoDepartment', {}, 'Nenhum departamento setorial liberado para este usuario.'))}</div>`;
  } else {
    visibleDepartments.forEach((department) => {
      const group = document.createElement('div');
      group.className = 'intranet-department-group';
      group.setAttribute('data-department-slug', department.slug || '');
      const submenus = sortAlphabetically(department.submenus || [], (item) => item?.title || item?.slug || '');

      const toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.className = 'intranet-department-toggle';
      toggle.innerHTML = `
          <span class="intranet-nav-link-icon">${renderIcon(department.icon || 'layers')}</span>
          <span class="intranet-department-toggle-copy">
          <strong>${escapeHtml(department.name || t('intranet.departmentDefaultName', {}, 'Departamento'))}</strong>
          <small>${submenus.length ? t('intranet.departmentSubmenusCount', { count: submenus.length }, `${submenus.length} submenu(s)`) : t('intranet.departmentMainArea', {}, 'Area principal')}</small>
          </span>
          <span class="intranet-department-chevron">${renderIcon('chevron')}</span>
        `;
      toggle.onclick = () => {
        const slug = department.slug || '';
        const isExpanded = expandedDepartmentSlugs.has(slug);
        const isCurrentDepartment = currentViewState.key === 'department' && currentViewState.departmentSlug === slug && !currentViewState.submenuSlug;

        if (isExpanded && isCurrentDepartment) {
          toggleDepartmentExpanded(slug, false);
          setActiveView('home');
          return;
        }

        toggleDepartmentExpanded(slug, true);
        setActiveView('department', { departmentSlug: slug });
      };
      group.appendChild(toggle);

      const submenuList = document.createElement('div');
      submenuList.className = 'intranet-department-submenu-list';
      submenuList.hidden = !expandedDepartmentSlugs.has(department.slug || '');
      if (submenus.length) {
        submenus.forEach((submenu) => {
          const button = document.createElement('button');
          button.type = 'button';
          button.className = 'intranet-submenu-link';
          button.setAttribute('data-submenu-slug', submenu.slug || '');
          button.innerHTML = `
            <span class="intranet-nav-link-icon">${renderIcon(submenu.icon || department.icon || 'layers')}</span>
            <span class="intranet-side-link-copy">
              <strong>${escapeHtml(submenu.title || 'Submenu')}</strong>
              <small>${escapeHtml(submenu.description || t('intranet.departmentDefaultFlow', {}, 'Fluxo interno do departamento'))}</small>
            </span>
          `;
          button.onclick = () => {
            toggleDepartmentExpanded(department.slug || '', true);
            setActiveView('department', { departmentSlug: department.slug || '', submenuSlug: submenu.slug || '' });
          };
          submenuList.appendChild(button);
        });
      }
      group.appendChild(submenuList);
      departmentNav.appendChild(group);
    });
  }

  renderSidebarUtility(intranet);
  syncSidebarNavigation(intranet);
}

function renderHomeOverview(user, intranet) {
  const overviewGrid = el('homeOverviewGrid');
  const directionGrid = el('homeDirectionGrid');
  const communicationGrid = el('homeCommunicationGrid');
  if (overviewGrid) {
    const updates = Array.isArray(intranet.home?.updates) ? intranet.home.updates : [];
    const overviewCards = [
      {
        title: `${getPeriodGreeting()}, ${user.name}`,
        description: t('intranet.home.greetingCardDescription'),
        badge: user.role === 'admin' ? t('intranet.home.greetingBadgeAdmin') : t('intranet.home.greetingBadgeUser'),
      },
      ...(updates || []).slice(0, 4).map((item) => ({
        title: item.title || t('intranet.generic.update', {}, 'Atualizacao'),
        description: item.description || '',
        badge: item.label || t('intranet.generic.summary', {}, 'Resumo'),
      })),
      {
        title: t('intranet.home.nextMeetings'),
        description: intranet.home?.upcoming_events?.[0]
          ? `${intranet.home.upcoming_events[0].title} - ${formatDate(intranet.home.upcoming_events[0].start_at || intranet.home.upcoming_events[0].start_date)}`
          : t('intranet.home.noMeetings'),
        badge: t('intranet.home.meetingsBadge', { count: Number((intranet.home?.upcoming_events || []).length || 0) }),
      },
    ];

    overviewGrid.innerHTML = overviewCards.map((item) => `
      <article class="intranet-quick-card intranet-home-overview-card">
        <div class="intranet-quick-title">${escapeHtml(item.title)}</div>
        <div class="intranet-quick-text">${escapeHtml(item.description)}</div>
        <div class="intranet-home-overview-meta">${escapeHtml(item.badge || '')}</div>
      </article>
    `).join('');
  }

  if (directionGrid) {
    const directionItems = Array.isArray(intranet.home?.direction_board) ? intranet.home.direction_board : [];
    if (!directionItems.length) {
      directionGrid.innerHTML = `
        <article class="intranet-direction-card is-empty">
          <div class="intranet-card-meta">${escapeHtml(t('intranet.direction.origin'))}</div>
          <h4>${escapeHtml(t('intranet.direction.emptyTitle'))}</h4>
          <p>${escapeHtml(t('intranet.direction.emptyBody'))}</p>
        </article>
      `;
    } else {
      directionGrid.innerHTML = directionItems.map((item) => `
        <article class="intranet-direction-card${item.is_direction_highlight ? ' is-direction' : ''}">
          <div class="intranet-direction-pill">${escapeHtml(item.origin_label || t('intranet.direction.origin'))}</div>
          <div class="intranet-card-meta">${escapeHtml(item.type || t('intranet.generic.announcement', {}, 'Comunicado'))} - ${escapeHtml(item.priority || 'normal')}</div>
          <h4>${escapeHtml(item.title || t('intranet.direction.fallbackTitle', {}, 'Comunicado institucional'))}</h4>
          <p>${escapeHtml(item.summary || '')}</p>
          <div class="small muted">${escapeHtml(formatDate(item.created_at || ''))}</div>
        </article>
      `).join('');
    }
  }

  if (communicationGrid) {
    const announcements = Array.isArray(intranet.home?.communication_board) ? intranet.home.communication_board : [];
    const directionIds = new Set((Array.isArray(intranet.home?.direction_board) ? intranet.home.direction_board : []).map((item) => Number(item.id || 0)));
    const visibleAnnouncements = announcements.filter((item) => !directionIds.has(Number(item.id || 0)));
    if (!visibleAnnouncements.length) {
      communicationGrid.innerHTML = `<div class="intranet-empty-card">${escapeHtml(t('intranet.communication.emptyTitle'))}</div>`;
    } else {
      communicationGrid.innerHTML = visibleAnnouncements.map((item) => `
        <article class="intranet-communication-card">
          <div class="intranet-card-meta">${escapeHtml(item.origin_label || t('intranet.communication.defaultOrigin', {}, 'Comunicado interno'))} - ${escapeHtml(item.priority || 'normal')}</div>
          <h4>${escapeHtml(item.title || t('intranet.generic.announcement', {}, 'Comunicado'))}</h4>
          <p>${escapeHtml(item.summary || '')}</p>
          <div class="small muted">${escapeHtml(formatDate(item.created_at || ''))}</div>
        </article>
      `).join('');
    }
  }
}

function renderHero(user, intranet) {
  el('intranetGreeting').textContent = `${getPeriodGreeting()}, ${user.name}`;
  el('heroTitle').textContent = t('intranet.heroTitle', {}, intranet.home.heroTitle);
  el('heroDescription').textContent = t('intranet.heroDescription', {}, intranet.home.heroDescription);

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
  const hiddenRouteKeys = new Set(['dashboard', 'modules', 'departments', 'documents', 'training', 'communication']);
  const links = [...(intranet.home.quickLinks || [])].filter((link) => {
    const route = resolveQuickLinkRoute(link);
    return !route || !hiddenRouteKeys.has(route.key);
  });

  links.forEach((link) => {
    const route = resolveQuickLinkRoute(link);
    const card = document.createElement(route || !link.href ? 'button' : 'a');
    card.className = `intranet-quick-card${link.style === 'primary' ? ' is-primary' : ''}`;
    card.innerHTML = `
      <div class="intranet-quick-title">${escapeHtml(link.title)}</div>
      <div class="intranet-quick-text">${escapeHtml(link.description)}</div>
    `;
    if (route) {
      card.type = 'button';
      card.onclick = () => setActiveView(route.key, route);
    } else if (link.href) {
      card.href = link.href;
    } else {
      card.type = 'button';
    }
    quick.appendChild(card);
  });

  renderHomeOverview(user, intranet);
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
    grid.innerHTML = `<div class="intranet-empty-card">${escapeHtml(t('intranet.modules.empty', {}, 'Nenhum modulo encontrado para este filtro.'))}</div>`;
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
        <span class="intranet-chip">${escapeHtml(module.department || t('intranet.generic.general', {}, 'Geral'))}</span>
      </div>
      <h4>${escapeHtml(module.title)}</h4>
      <p>${escapeHtml(module.description || '')}</p>
      <div class="intranet-module-type">${escapeHtml(module.type || t('intranet.generic.workspace', {}, 'workspace'))}</div>
    `;
    grid.appendChild(card);
  });
}

function renderDepartments(intranet) {
  const grid = el('departmentGrid');
  const reminderGrid = el('departmentReminderGrid');
  grid.innerHTML = '';
  if (reminderGrid) reminderGrid.innerHTML = '';
  const visibleDepartments = getVisibleDepartments(intranet);

  if (!visibleDepartments.length) {
    grid.innerHTML = `<div class="intranet-empty-card">${escapeHtml(t('intranet.departments.empty', {}, 'Nenhum departamento especifico foi liberado para este perfil.'))}</div>`;
    if (reminderGrid) {
      reminderGrid.innerHTML = `<div class="intranet-empty-card">${escapeHtml(t('intranet.departments.reminderEmpty', {}, 'Sem lembretes operacionais para este perfil no momento.'))}</div>`;
    }
    return;
  }

  visibleDepartments.forEach((department) => {
    const card = document.createElement('article');
    card.className = 'intranet-department-card';
    const modules = (department.modules || []).map((module) => `<li>${escapeHtml(module.title)}<span>${escapeHtml(module.description || '')}</span></li>`).join('');
    card.innerHTML = `
      <div class="intranet-department-head">
        <div class="intranet-department-icon">${renderIcon(department.icon || 'layers')}</div>
        <div>
          <h4>${escapeHtml(department.name)}</h4>
          <div class="small muted">${escapeHtml(t('intranet.departments.currentLevel', { level: department.access_level || t('intranet.departments.collaborator', {}, 'colaborador') }, `Nivel atual: ${department.access_level || 'colaborador'}`))}</div>
        </div>
      </div>
      <p>${escapeHtml(department.description || '')}</p>
      <ul class="intranet-department-modules">${modules}</ul>
      <div class="intranet-card-actions">
        <button class="btn" type="button" data-open-department="${escapeHtml(department.slug || '')}">Abrir area</button>
      </div>
    `;
    grid.appendChild(card);
  });

  grid.querySelectorAll('[data-open-department]').forEach((button) => {
    button.addEventListener('click', () => {
      const departmentSlug = button.getAttribute('data-open-department') || '';
      toggleDepartmentExpanded(departmentSlug, true);
      setActiveView('department', { departmentSlug });
    });
  });

  if (reminderGrid) {
    const reminderItems = [
      ...(Array.isArray(intranet.home?.upcoming_events) ? intranet.home.upcoming_events.slice(0, 3).map((item) => ({
        badge: 'Reuniao',
        title: item.title || 'Compromisso',
        description: item.description || item.meeting_mode_label || 'Agenda corporativa',
        meta: formatDate(item.start_at || item.start_date || ''),
      })) : []),
      ...(Array.isArray(intranet.notifications) ? intranet.notifications.slice(0, 3).map((item) => ({
        badge: item.type === 'announcement' ? 'Aviso' : 'Lembrete',
        title: item.title || 'Atualizacao',
        description: item.description || '',
        meta: 'Fluxo interno',
      })) : []),
    ].slice(0, 6);

    if (!reminderItems.length) {
      reminderGrid.innerHTML = '<div class="intranet-empty-card">Nenhuma reuniao, aviso rapido ou lembrete imediato encontrado.</div>';
    } else {
      reminderGrid.innerHTML = reminderItems.map((item) => `
        <article class="intranet-quick-card intranet-home-overview-card intranet-reminder-card">
          <div class="intranet-card-meta">${escapeHtml(item.badge || 'Lembrete')}</div>
          <div class="intranet-quick-title">${escapeHtml(item.title || 'Atualizacao')}</div>
          <div class="intranet-quick-text">${escapeHtml(item.description || '')}</div>
          <div class="intranet-home-overview-meta">${escapeHtml(item.meta || '')}</div>
        </article>
      `).join('');
    }
  }
}

function formatDateOnly(value) {
  const safe = String(value || '').trim();
  if (!safe) return '-';
  try {
    return new Date(`${safe}T12:00:00-03:00`).toLocaleDateString(currentLocale(), {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      timeZone: 'America/Sao_Paulo',
    });
  } catch {
    return safe;
  }
}

function formatDateRangeLabel(from = '', to = '') {
  if (!from && !to) return t('intranet.generic.periodUndefined', {}, 'Periodo nao definido');
  if (from && to && from !== to) {
    return `${formatDateOnly(from)} - ${formatDateOnly(to)}`;
  }
  return formatDateOnly(from || to || '');
}

function formatInteger(value) {
  return new Intl.NumberFormat(currentLocale()).format(Number(value || 0));
}

function formatCompactInteger(value) {
  const safe = Number(value || 0);
  if (!safe) return '0';
  return new Intl.NumberFormat(currentLocale(), {
    notation: safe >= 1000 ? 'compact' : 'standard',
    maximumFractionDigits: safe >= 1000 ? 1 : 0,
  }).format(safe);
}

function formatInfluenceTypesList(items = []) {
  const safeItems = Array.isArray(items) ? items.filter(Boolean) : [];
  return safeItems.length ? safeItems.join(', ') : t('intranet.generic.notInformed', {}, 'Nao informado');
}

function getInfluencerInitials(name = '') {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return 'MK';
  return parts.slice(0, 2).map((item) => item.charAt(0).toUpperCase()).join('');
}

function getMarketingPeriodOptions() {
  return [
    { value: 'day', label: t('calendar.day') },
    { value: 'week', label: t('calendar.week') },
    { value: 'month', label: t('calendar.month') },
  ];
}

function getMarketingStatusLabel(status = '') {
  const safe = String(status || '').trim().toLowerCase();
  const map = {
    ativo: 'Ativo',
    em_teste: 'Em teste',
    'em teste': 'Em teste',
    pausado: 'Pausado',
    encerrado: 'Encerrado',
  };
  return map[safe] || (safe ? safe.charAt(0).toUpperCase() + safe.slice(1) : 'Ativo');
}

function getMarketingInfluencerPeriodFilters() {
  return {
    periodType: String(influencerState.filters?.periodType || 'month'),
    from: String(influencerState.filters?.from || ''),
    to: String(influencerState.filters?.to || ''),
  };
}

function setMarketingInfluencerFilters(filters = {}, options = {}) {
  influencerState.filters = {
    periodType: String(filters.periodType || filters.period_type || influencerState.filters?.periodType || 'month'),
    from: String(filters.from || ''),
    to: String(filters.to || ''),
  };

  if (options.syncAnalysis !== false) {
    influencerState.analysis.periodType = influencerState.filters.periodType;
  }
}

function applyMarketingInfluencerFilterValues(period = {}) {
  const periodType = String(period.period_type || influencerState.filters?.periodType || 'month');
  const from = String(period.from || influencerState.filters?.from || '');
  const to = String(period.to || influencerState.filters?.to || '');
  const filterType = el('influencerFilterPeriodType');
  const filterFrom = el('influencerFilterFrom');
  const filterTo = el('influencerFilterTo');
  const analysisType = el('influencerAnalysisPeriodType');
  const analysisFrom = el('influencerAnalysisFrom');
  const analysisTo = el('influencerAnalysisTo');

  if (filterType) filterType.value = periodType;
  if (filterFrom) filterFrom.value = from;
  if (filterTo) filterTo.value = to;
  if (analysisType) analysisType.value = influencerState.analysis.periodType || periodType;
  if (analysisFrom) analysisFrom.value = from;
  if (analysisTo) analysisTo.value = to;
}

function buildMarketingInfluencerQueryString(filters = influencerState.filters) {
  const params = new URLSearchParams();
  const periodType = String(filters?.periodType || filters?.period_type || 'month');
  params.set('period_type', periodType);
  if (filters?.from) params.set('from', String(filters.from));
  if (filters?.to) params.set('to', String(filters.to));
  return params.toString();
}

function getMarketingInfluencerCards() {
  return Array.isArray(influencerState.bootstrap?.influencers) ? influencerState.bootstrap.influencers : [];
}

function getSelectedMarketingInfluencerCard() {
  return getMarketingInfluencerCards().find((item) => Number(item.id) === Number(influencerState.selectedInfluencerId || 0)) || null;
}

function resetInfluencerForm() {
  influencerState.editingId = null;
  influencerState.formDraft = null;
  const form = el('influencerForm');
  if (!form) return;
  form.reset();
  const influencerId = el('influencerId');
  if (influencerId) influencerId.value = '';
  const formTitle = el('influencerFormTitle');
  if (formTitle) formTitle.textContent = 'Cadastrar influencer';
  const submitLabel = el('btnSaveInfluencerLabel');
  if (submitLabel) submitLabel.textContent = 'Cadastrar';
}

function populateInfluencerForm(influencer = null) {
  if (!influencer) {
    resetInfluencerForm();
    return;
  }

  influencerState.editingId = Number(influencer.id || 0) || null;
  influencerState.formDraft = {
    id: influencer.id || '',
    name: influencer.name || '',
    influence_types: formatInfluenceTypesList(influencer.influence_types || []),
    contract_type: influencer.contract_type || '',
    photo_url: influencer.photo_url || '',
    instagram_url: influencer.instagram_url || '',
    followers_count: influencer.followers_count || 0,
    partnership_start_date: influencer.partnership_start_date || '',
    influencer_status: influencer.influencer_status || 'ativo',
    notes: influencer.notes || '',
  };
  influencerState.formCollapsed = false;
  renderMarketingInfluencerWorkspace();
  window.setTimeout(() => {
    el('influencerName')?.focus();
  }, 30);
}

function renderInfluencerMetricBars(items = [], metricKey, label) {
  const safeItems = [...(Array.isArray(items) ? items : [])]
    .sort((left, right) => Number(right?.[metricKey] || 0) - Number(left?.[metricKey] || 0));
  const maxValue = Math.max(...safeItems.map((item) => Number(item?.[metricKey] || 0)), 1);

  return `
    <article class="influencer-chart-card">
      <div class="intranet-card-meta">Comparativo</div>
      <h4>${escapeHtml(label)}</h4>
      <div class="influencer-chart-list">
        ${safeItems.length ? safeItems.map((item) => {
          const value = Number(item?.[metricKey] || 0);
          const width = Math.max((value / maxValue) * 100, value > 0 ? 8 : 0);
          return `
            <div class="influencer-chart-row">
              <div class="influencer-chart-head">
                <strong>${escapeHtml(item?.name || 'Influencer')}</strong>
                <span>${escapeHtml(formatInteger(value))}</span>
              </div>
              <div class="influencer-chart-track">
                <span style="width:${width}%"></span>
              </div>
            </div>
          `;
        }).join('') : '<div class="intranet-empty-card">Sem dados suficientes para este comparativo.</div>'}
      </div>
    </article>
  `;
}

function renderInfluencerMonthlyComparison(monthly = []) {
  const rows = Array.isArray(monthly) ? monthly.slice(-6) : [];
  return `
    <article class="influencer-chart-card influencer-chart-card-wide">
      <div class="intranet-card-meta">Evolucao mensal</div>
      <h4>Comparativo entre influencers por periodo</h4>
      <div class="influencer-evolution-list">
        ${rows.length ? rows.map((entry) => `
          <div class="influencer-evolution-item">
            <div class="influencer-evolution-head">
              <strong>${escapeHtml(entry.label || entry.period_key || 'Periodo')}</strong>
              <span>${escapeHtml(String((entry.influencers || []).length || 0))} influencer(s)</span>
            </div>
            <div class="influencer-evolution-grid">
              ${(entry.influencers || []).sort((left, right) => Number(right?.enrollments_count || 0) - Number(left?.enrollments_count || 0)).map((item) => `
                <div class="influencer-evolution-chip">
                  <strong>${escapeHtml(item.name || 'Influencer')}</strong>
                  <span>${escapeHtml(formatInteger(item.enrollments_count || 0))} matriculas</span>
                  <small>${escapeHtml(formatInteger(item.performance_score || 0))} pts</small>
                </div>
              `).join('')}
            </div>
          </div>
        `).join('') : '<div class="intranet-empty-card">A evolucao mensal aparecera conforme os lancamentos forem sendo registrados.</div>'}
      </div>
    </article>
  `;
}

function isMarketingInfluencerWorkspace(department, submenu) {
  return String(department?.slug || '') === 'marketing' && String(submenu?.slug || '') === 'influencer';
}

function setDashboardSectionVisible(isVisible) {
  const section = el('dashboard');
  if (section) section.hidden = !isVisible;
}

function renderDepartmentWorkspace(intranet) {
  const section = el('departmentWorkspace');
  const customWrap = el('departmentWorkspaceCustom');
  const modulesHead = el('departmentWorkspaceModulesHead');
  if (!section) return;

  const { department, submenu } = getDepartmentRouteMeta(intranet, currentViewState.departmentSlug, currentViewState.submenuSlug);
  if (!department) {
    section.hidden = true;
    if (customWrap) customWrap.hidden = true;
    return;
  }

  section.hidden = false;
  el('departmentWorkspaceEyebrow').textContent = submenu ? department.name : t('intranet.departmentDefaultName', {}, 'Departamento');
  el('departmentWorkspaceTitle').textContent = submenu?.title || department.name || t('intranet.departmentWorkspaceTitle', {}, 'Area departamental');
  el('departmentWorkspaceDescription').textContent = submenu?.description || department.description || t('intranet.departmentWorkspaceDescription', {}, 'Area departamental da intranet.');

  const summary = el('departmentWorkspaceSummary');
  summary.innerHTML = '';
  const summaryCards = [
    { title: t('intranet.departmentSummary.currentLevel', {}, 'Nivel atual'), description: department.access_level || t('intranet.departments.collaborator', {}, 'colaborador'), badge: t('intranet.departmentSummary.permission', {}, 'Permissao') },
    { title: t('intranet.departmentSummary.activeSubmenus', {}, 'Submenus ativos'), description: String((department.submenus || []).length || 0), badge: t('intranet.departmentSummary.flows', {}, 'Fluxos') },
    { title: t('intranet.departmentSummary.availableModules', {}, 'Modulos liberados'), description: String((department.modules || []).length || 0), badge: t('intranet.departmentSummary.resources', {}, 'Recursos') },
    { title: submenu ? t('intranet.departmentSummary.activeSubmenu', {}, 'Submenu ativo') : t('intranet.departmentSummary.selectedArea', {}, 'Area selecionada'), description: submenu?.title || department.name, badge: submenu ? t('intranet.departmentSummary.detail', {}, 'Detalhe') : t('intranet.departmentSummary.main', {}, 'Principal') },
  ];
  summaryCards.forEach((item) => {
    const card = document.createElement('article');
    card.className = 'intranet-quick-card intranet-home-overview-card';
    card.innerHTML = `
      <div class="intranet-quick-title">${escapeHtml(item.title)}</div>
      <div class="intranet-quick-text">${escapeHtml(item.description)}</div>
      <div class="intranet-home-overview-meta">${escapeHtml(item.badge)}</div>
    `;
    summary.appendChild(card);
  });

  const submenusWrap = el('departmentWorkspaceSubmenus');
  submenusWrap.innerHTML = '';
  const submenus = sortAlphabetically(department.submenus || [], (item) => item?.title || item?.slug || '');
  if (!submenus.length) {
    submenusWrap.innerHTML = `<div class="intranet-empty-card">${escapeHtml(t('intranet.departments.noSubmenus', {}, 'Nenhum submenu configurado para este departamento ainda.'))}</div>`;
  } else {
    submenus.forEach((item) => {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = `intranet-quick-card intranet-submenu-card${currentViewState.submenuSlug === item.slug ? ' is-active' : ''}`;
      card.innerHTML = `
        <div class="intranet-quick-title">${escapeHtml(item.title)}</div>
        <div class="intranet-quick-text">${escapeHtml(item.description || t('intranet.departmentDefaultFlow', {}, 'Fluxo interno do departamento'))}</div>
      `;
      card.onclick = () => setActiveView('department', { departmentSlug: department.slug, submenuSlug: item.slug || '' });
      submenusWrap.appendChild(card);
    });
  }

  const modulesWrap = el('departmentWorkspaceModules');
  modulesWrap.innerHTML = '';
  const modules = sortAlphabetically(department.modules || [], (item) => item?.title || item?.key || '');
  const isCustomWorkspace = isMarketingInfluencerWorkspace(department, submenu);
  if (customWrap) customWrap.hidden = !isCustomWorkspace;
  if (modulesHead) modulesHead.hidden = isCustomWorkspace;
  modulesWrap.hidden = isCustomWorkspace;

  if (isCustomWorkspace) {
    renderMarketingInfluencerWorkspace();
    if (!influencerState.bootstrap && !influencerState.loading) {
      fetchMarketingInfluencerBootstrap({
        filters: getMarketingInfluencerPeriodFilters(),
        preserveSelection: true,
      });
    }
    return;
  }

  if (!modules.length) {
    modulesWrap.innerHTML = `<div class="intranet-empty-card">${escapeHtml(t('intranet.departments.noModules', {}, 'Nenhum modulo liberado para esta area no momento.'))}</div>`;
  } else {
    modules.forEach((module) => {
      const card = document.createElement('article');
      card.className = 'intranet-module-card';
      card.innerHTML = `
        <div class="intranet-module-top">
          <span class="intranet-module-icon">${renderIcon(module.icon || department.icon || 'workspace')}</span>
          <span class="intranet-chip">${escapeHtml(department.name || t('intranet.departmentDefaultName', {}, 'Departamento'))}</span>
        </div>
        <h4>${escapeHtml(module.title || t('intranet.generic.module', {}, 'Modulo'))}</h4>
        <p>${escapeHtml(module.description || '')}</p>
        <div class="intranet-module-type">${escapeHtml(module.type || t('intranet.generic.workspace', {}, 'workspace'))}</div>
      `;
      modulesWrap.appendChild(card);
    });
  }
}

function renderMarketingInfluencerWorkspace() {
  const customWrap = el('departmentWorkspaceCustom');
  if (!customWrap || customWrap.hidden) return;

  if (influencerState.loading && !influencerState.bootstrap) {
    customWrap.innerHTML = '<div class="intranet-empty-card">Carregando workspace de influencers...</div>';
    return;
  }

  if (influencerState.error && !influencerState.bootstrap) {
    customWrap.innerHTML = `<div class="intranet-empty-card">${escapeHtml(influencerState.error)}</div>`;
    return;
  }

  const bootstrap = influencerState.bootstrap || {};
  const cards = getMarketingInfluencerCards();
  const selectedCard = getSelectedMarketingInfluencerCard();
  const detail = influencerState.detail || {};
  const summary = bootstrap.summary || {};
  const comparison = bootstrap.comparison || {};
  const suggestions = bootstrap.suggestions || {};
  const detailSummary = detail.summary || selectedCard?.metrics_summary || {};
  const period = bootstrap.period || {
    period_type: influencerState.filters?.periodType || 'month',
    from: influencerState.filters?.from || '',
    to: influencerState.filters?.to || '',
    label: formatDateRangeLabel(influencerState.filters?.from, influencerState.filters?.to),
  };
  const comparisonItems = Array.isArray(comparison.items) ? comparison.items : [];
  const metricHistory = Array.isArray(detail.metric_history) ? detail.metric_history : [];
  const detailHistory = Array.isArray(detail.history) ? detail.history : [];
  const analysisText = influencerState.analysis.result || 'Selecione um periodo e clique em "Analisar" para receber uma leitura comparativa da IA sobre o desempenho das influencers.';
  const formDraft = influencerState.formDraft || {};

  customWrap.innerHTML = `
    <section class="influencer-workspace">
      <div class="influencer-toolbar">
        <div>
          <div class="intranet-section-eyebrow">Marketing</div>
          <h3 class="intranet-section-title">Gestao de influencers e leitura comparativa</h3>
          <p class="small muted">Cadastre as parceiras, lance a performance manualmente, compare indicadores e use a IA como apoio para decidir os proximos passos.</p>
        </div>
        <div class="influencer-toolbar-actions">
          <div>
            <label for="influencerFilterPeriodType">Periodo</label>
            <select id="influencerFilterPeriodType">
              ${getMarketingPeriodOptions().map((item) => `<option value="${escapeHtml(item.value)}"${item.value === (influencerState.filters?.periodType || 'month') ? ' selected' : ''}>${escapeHtml(item.label)}</option>`).join('')}
            </select>
          </div>
          <div>
            <label for="influencerFilterFrom">De</label>
            <input id="influencerFilterFrom" type="date" value="${escapeHtml(influencerState.filters?.from || period.from || '')}" />
          </div>
          <div>
            <label for="influencerFilterTo">Ate</label>
            <input id="influencerFilterTo" type="date" value="${escapeHtml(influencerState.filters?.to || period.to || '')}" />
          </div>
          <button class="btn" type="button" id="btnRefreshInfluencerWorkspace">${influencerState.loading ? 'Atualizando...' : 'Atualizar'}</button>
        </div>
      </div>

      <div class="intranet-home-grid influencer-summary-grid">
        <article class="intranet-quick-card intranet-home-overview-card">
          <div class="intranet-quick-title">${escapeHtml(formatInteger(summary.total_influencers || 0))}</div>
          <div class="intranet-quick-text">Influencers cadastradas</div>
          <div class="intranet-home-overview-meta">Base atual</div>
        </article>
        <article class="intranet-quick-card intranet-home-overview-card">
          <div class="intranet-quick-title">${escapeHtml(formatInteger(summary.followers_total || 0))}</div>
          <div class="intranet-quick-text">Seguidores monitorados</div>
          <div class="intranet-home-overview-meta">Total consolidado</div>
        </article>
        <article class="intranet-quick-card intranet-home-overview-card">
          <div class="intranet-quick-title">${escapeHtml(formatInteger(summary.enrollments_total || 0))}</div>
          <div class="intranet-quick-text">Matriculas atribuidas</div>
          <div class="intranet-home-overview-meta">${escapeHtml(period.label || 'Periodo atual')}</div>
        </article>
        <article class="intranet-quick-card intranet-home-overview-card">
          <div class="intranet-quick-title">${escapeHtml(formatInteger(summary.launches_total || 0))}</div>
          <div class="intranet-quick-text">Lancamentos de performance</div>
          <div class="intranet-home-overview-meta">Historico operacional</div>
        </article>
      </div>

      <article class="influencer-form-card">
        <button class="influencer-section-toggle" type="button" id="btnToggleInfluencerForm" aria-expanded="${influencerState.formCollapsed ? 'false' : 'true'}">
          <span>
            <strong id="influencerFormTitle">${escapeHtml(influencerState.editingId ? 'Editar influencer' : 'Cadastrar influencer')}</strong>
            <small>Bloco recolhivel para manter a tela organizada.</small>
          </span>
          <span class="influencer-section-toggle-icon">${renderIcon('chevron')}</span>
        </button>
        <div class="influencer-form-body${influencerState.formCollapsed ? ' is-collapsed' : ''}" id="influencerFormBody">
          <form id="influencerForm" class="influencer-form-grid">
            <input type="hidden" id="influencerId" value="${escapeHtml(formDraft.id || influencerState.editingId || '')}" />
            <div>
              <label for="influencerName">Nome do influencer</label>
              <input id="influencerName" placeholder="Ex.: Maria Andrade" value="${escapeHtml(formDraft.name || '')}" />
            </div>
            <div>
              <label for="influencerTypes">Tipos de influencia</label>
              <input id="influencerTypes" placeholder="Ex.: Reels, Stories, Conteudo educacional" list="influencerTypesSuggestions" value="${escapeHtml(formDraft.influence_types || '')}" />
              <datalist id="influencerTypesSuggestions">
                ${(suggestions.influence_types || []).map((item) => `<option value="${escapeHtml(item)}"></option>`).join('')}
              </datalist>
            </div>
            <div>
              <label for="influencerContractType">Tipo de contrato</label>
              <select id="influencerContractType">
                <option value="">Selecione</option>
                ${(suggestions.contract_types || []).map((item) => `<option value="${escapeHtml(item)}"${item === (formDraft.contract_type || '') ? ' selected' : ''}>${escapeHtml(item)}</option>`).join('')}
              </select>
            </div>
            <div>
              <label for="influencerPhotoUrl">Foto (URL)</label>
              <input id="influencerPhotoUrl" type="url" placeholder="https://..." value="${escapeHtml(formDraft.photo_url || '')}" />
            </div>
            <div>
              <label for="influencerInstagram">Link do Instagram</label>
              <input id="influencerInstagram" type="url" placeholder="https://instagram.com/..." value="${escapeHtml(formDraft.instagram_url || '')}" />
            </div>
            <div>
              <label for="influencerFollowers">Quantidade de seguidores</label>
              <input id="influencerFollowers" type="number" min="0" step="1" placeholder="0" value="${escapeHtml(formDraft.followers_count ?? '')}" />
            </div>
            <div>
              <label for="influencerStartDate">Data de inicio da parceria</label>
              <input id="influencerStartDate" type="date" value="${escapeHtml(formDraft.partnership_start_date || '')}" />
            </div>
            <div>
              <label for="influencerStatus">Status</label>
              <select id="influencerStatus">
                ${(suggestions.statuses || ['ativo', 'em_teste', 'pausado', 'encerrado']).map((item) => `<option value="${escapeHtml(item)}"${item === (formDraft.influencer_status || 'ativo') ? ' selected' : ''}>${escapeHtml(getMarketingStatusLabel(item))}</option>`).join('')}
              </select>
            </div>
            <div class="influencer-form-span">
              <label for="influencerNotes">Observacoes internas</label>
              <textarea id="influencerNotes" rows="3" placeholder="Anotacoes internas do Marketing sobre a parceria, posicionamento ou proximos passos">${escapeHtml(formDraft.notes || '')}</textarea>
            </div>
            <div class="influencer-form-actions influencer-form-span">
              <button class="btn" type="button" id="btnResetInfluencerForm">Limpar</button>
              <button class="btn primary" type="submit"><span id="btnSaveInfluencerLabel">${escapeHtml(influencerState.editingId ? 'Salvar' : 'Cadastrar')}</span></button>
            </div>
          </form>
        </div>
      </article>

      <section class="influencer-card-section">
        <div class="intranet-section-head">
          <div>
            <div class="intranet-section-eyebrow">Base cadastrada</div>
            <h4 class="intranet-section-title">Influencers cadastradas</h4>
          </div>
          <div class="small muted">${escapeHtml(period.label || 'Periodo atual')}</div>
        </div>
        <div class="influencer-list-grid">
          ${cards.length ? cards.map((item) => `
            <article class="influencer-card${Number(item.id) === Number(influencerState.selectedInfluencerId || 0) ? ' is-active' : ''}">
              <div class="influencer-card-head">
                ${item.photo_url ? `<img class="influencer-avatar" src="${escapeHtml(item.photo_url)}" alt="${escapeHtml(item.name || 'Influencer')}" />` : `<div class="influencer-avatar influencer-avatar-fallback">${escapeHtml(getInfluencerInitials(item.name || 'Influencer'))}</div>`}
                <div class="influencer-card-copy">
                  <h4>${escapeHtml(item.name || 'Influencer')}</h4>
                  <div class="small muted">${escapeHtml(formatInfluenceTypesList(item.influence_types || []))}</div>
                </div>
                <span class="intranet-chip">${escapeHtml(getMarketingStatusLabel(item.influencer_status))}</span>
              </div>
              <div class="influencer-card-metrics">
                <div><strong>${escapeHtml(item.contract_type || '-')}</strong><span>Contrato</span></div>
                <div><strong>${escapeHtml(formatCompactInteger(item.followers_count || 0))}</strong><span>Seguidores</span></div>
                <div><strong>${escapeHtml(formatInteger(item.metrics_summary?.enrollments_count || 0))}</strong><span>Matriculas</span></div>
                <div><strong>${escapeHtml(formatInteger(item.metrics_summary?.performance_score || 0))}</strong><span>Pontuacao</span></div>
              </div>
              <div class="small muted">${escapeHtml(item.instagram_url || 'Instagram nao informado')}</div>
              <div class="small muted">Parceria desde ${escapeHtml(formatDateOnly(item.partnership_start_date || ''))}</div>
              <div class="intranet-card-actions">
                <button class="btn" type="button" data-influencer-view="${escapeHtml(item.id)}">Ver mais</button>
                <button class="btn" type="button" data-influencer-edit="${escapeHtml(item.id)}">Editar cadastro</button>
              </div>
            </article>
          `).join('') : '<div class="intranet-empty-card">Nenhuma influencer cadastrada ainda. Use o bloco acima para iniciar a base de Marketing.</div>'}
        </div>
      </section>

      <div class="influencer-detail-layout">
        <section class="influencer-detail-panel">
          <div class="intranet-section-head">
            <div>
              <div class="intranet-section-eyebrow">Relatorio individual</div>
              <h4 class="intranet-section-title">${escapeHtml(selectedCard?.name || 'Selecione uma influencer')}</h4>
            </div>
            ${selectedCard ? `<button class="btn" type="button" data-influencer-edit="${escapeHtml(selectedCard.id)}">Editar cadastro</button>` : ''}
          </div>
          ${selectedCard && influencerState.detailLoading ? '<div class="small muted">Carregando relatorio detalhado...</div>' : ''}
          ${selectedCard && influencerState.detailError ? `<div class="small muted">${escapeHtml(influencerState.detailError)}</div>` : ''}
          ${selectedCard ? `
            <div class="influencer-detail-summary">
              <article class="intranet-sales-card"><strong>${escapeHtml(formatInteger(detailSummary.posts_count || 0))}</strong><span>Postagens</span></article>
              <article class="intranet-sales-card"><strong>${escapeHtml(formatInteger(detailSummary.reels_count || 0))}</strong><span>Reels</span></article>
              <article class="intranet-sales-card"><strong>${escapeHtml(formatInteger(detailSummary.stories_count || 0))}</strong><span>Stories</span></article>
              <article class="intranet-sales-card"><strong>${escapeHtml(formatInteger(detailSummary.views_count || 0))}</strong><span>Views</span></article>
              <article class="intranet-sales-card"><strong>${escapeHtml(formatInteger(detailSummary.enrollments_count || 0))}</strong><span>Matriculas</span></article>
              <article class="intranet-sales-card"><strong>${escapeHtml(detailSummary.performance_label || 'Acompanhar')}</strong><span>Desempenho geral</span></article>
            </div>
            <div class="influencer-detail-meta">
              <div><strong>Periodo consultado</strong><span>${escapeHtml(detail.period?.label || period.label || '-')}</span></div>
              <div><strong>Historico registrado</strong><span>${escapeHtml(formatInteger(detailSummary.launches_total || 0))} lancamento(s)</span></div>
              <div><strong>Dias com atividade</strong><span>${escapeHtml(formatInteger(detailSummary.reported_days_total || 0))}</span></div>
              <div><strong>Instagram</strong><span>${escapeHtml(selectedCard.instagram_url || '-')}</span></div>
            </div>
            <div class="influencer-detail-columns">
              <div>
                <div class="intranet-block-title">Historico de performance</div>
                <div class="influencer-history-list">
                  ${metricHistory.length ? metricHistory.map((item) => `
                    <article class="influencer-history-card">
                      <div class="influencer-history-head">
                        <strong>${escapeHtml(item.period_label || formatDateRangeLabel(item.period_start, item.period_end))}</strong>
                        <span>${escapeHtml(item.period_type || 'month')}</span>
                      </div>
                      <div class="influencer-history-stats">
                        <span>${escapeHtml(formatInteger(item.posts_count || 0))} posts</span>
                        <span>${escapeHtml(formatInteger(item.reels_count || 0))} reels</span>
                        <span>${escapeHtml(formatInteger(item.stories_count || 0))} stories</span>
                        <span>${escapeHtml(formatInteger(item.views_count || 0))} views</span>
                        <span>${escapeHtml(formatInteger(item.enrollments_count || 0))} matriculas</span>
                      </div>
                      ${item.notes ? `<p>${escapeHtml(item.notes)}</p>` : ''}
                    </article>
                  `).join('') : '<div class="intranet-empty-card">Ainda nao ha lancamentos de performance para esta influencer.</div>'}
                </div>
              </div>
              <div>
                <div class="intranet-block-title">Historico de atualizacoes</div>
                <div class="influencer-history-list">
                  ${detailHistory.length ? detailHistory.map((item) => `
                    <article class="influencer-history-card">
                      <div class="influencer-history-head">
                        <strong>${escapeHtml(item.action || 'Atualizacao')}</strong>
                        <span>${escapeHtml(formatDate(item.created_at || ''))}</span>
                      </div>
                      <div class="small muted">${escapeHtml(item.actor_name || 'Sistema')}</div>
                      <p>${escapeHtml(item.field_name ? `${item.field_name}: ${item.old_value || '-'} -> ${item.new_value || '-'}` : JSON.stringify(item.detail || {}))}</p>
                    </article>
                  `).join('') : '<div class="intranet-empty-card">Nenhum log administrativo registrado para esta influencer ainda.</div>'}
                </div>
              </div>
            </div>
          ` : '<div class="intranet-empty-card">Clique em "Ver mais" em uma influencer para abrir o relatorio detalhado, registrar performance e acompanhar o historico.</div>'}
        </section>

        <aside class="influencer-metric-panel">
          <div class="intranet-section-head">
            <div>
              <div class="intranet-section-eyebrow">Lancamento manual</div>
              <h4 class="intranet-section-title">Performance operacional</h4>
            </div>
          </div>
          ${selectedCard ? `
            <form id="influencerMetricForm" class="influencer-metric-form">
              <div class="small muted">Lancamento para <strong>${escapeHtml(selectedCard.name || 'Influencer')}</strong></div>
              <div class="influencer-form-grid influencer-metric-grid">
                <div>
                  <label for="metricPeriodType">Periodo</label>
                  <select id="metricPeriodType">
                    ${getMarketingPeriodOptions().map((item) => `<option value="${escapeHtml(item.value)}">${escapeHtml(item.label)}</option>`).join('')}
                  </select>
                </div>
                <div>
                  <label for="metricPeriodStart">Data inicial</label>
                  <input id="metricPeriodStart" type="date" value="${escapeHtml(influencerState.filters?.from || period.from || '')}" />
                </div>
                <div>
                  <label for="metricPeriodEnd">Data final</label>
                  <input id="metricPeriodEnd" type="date" value="${escapeHtml(influencerState.filters?.to || period.to || '')}" />
                </div>
                <div>
                  <label for="metricPosts">Postagens</label>
                  <input id="metricPosts" type="number" min="0" step="1" value="0" />
                </div>
                <div>
                  <label for="metricReels">Reels</label>
                  <input id="metricReels" type="number" min="0" step="1" value="0" />
                </div>
                <div>
                  <label for="metricStories">Stories</label>
                  <input id="metricStories" type="number" min="0" step="1" value="0" />
                </div>
                <div>
                  <label for="metricViews">Views</label>
                  <input id="metricViews" type="number" min="0" step="1" value="0" />
                </div>
                <div>
                  <label for="metricEnrollments">Matriculas atribuidas</label>
                  <input id="metricEnrollments" type="number" min="0" step="1" value="0" />
                </div>
                <div class="influencer-form-span">
                  <label for="metricNotes">Observacoes</label>
                  <textarea id="metricNotes" rows="3" placeholder="Anote contexto da campanha, particularidades do periodo ou observacoes operacionais"></textarea>
                </div>
              </div>
              <div class="influencer-form-actions">
                <button class="btn primary" type="submit">Salvar lancamento</button>
              </div>
            </form>
          ` : '<div class="intranet-empty-card">Selecione uma influencer para registrar postagens, reels, stories, views e matriculas do periodo.</div>'}
        </aside>
      </div>

      <section class="influencer-chart-section">
        <div class="intranet-section-head">
          <div>
            <div class="intranet-section-eyebrow">Comparativo</div>
            <h4 class="intranet-section-title">Graficos comparativos por influencer</h4>
          </div>
          <div class="small muted">${escapeHtml(period.label || 'Periodo atual')}</div>
        </div>
        <div class="influencer-chart-grid">
          ${renderInfluencerMetricBars(comparisonItems, 'enrollments_count', 'Matriculas por influencer')}
          ${renderInfluencerMetricBars(comparisonItems, 'posts_count', 'Postagens por influencer')}
          ${renderInfluencerMetricBars(comparisonItems, 'reels_count', 'Reels por influencer')}
          ${renderInfluencerMetricBars(comparisonItems, 'stories_count', 'Stories por influencer')}
          ${renderInfluencerMetricBars(comparisonItems, 'views_count', 'Views por influencer')}
          ${renderInfluencerMetricBars(comparisonItems, 'performance_score', 'Desempenho geral')}
          ${renderInfluencerMonthlyComparison(comparison.monthly_evolution || [])}
        </div>
      </section>

      <section class="influencer-analysis-box">
        <div class="intranet-section-head">
          <div>
            <div class="intranet-section-eyebrow">Analise com IA</div>
            <h4 class="intranet-section-title">Leitura comparativa e recomendacao operacional</h4>
          </div>
        </div>
        <div class="influencer-analysis-toolbar">
          <div>
            <label for="influencerAnalysisPeriodType">Periodo</label>
            <select id="influencerAnalysisPeriodType">
              ${getMarketingPeriodOptions().map((item) => `<option value="${escapeHtml(item.value)}"${item.value === (influencerState.analysis.periodType || influencerState.filters?.periodType || 'month') ? ' selected' : ''}>${escapeHtml(item.label)}</option>`).join('')}
            </select>
          </div>
          <div>
            <label for="influencerAnalysisFrom">De</label>
            <input id="influencerAnalysisFrom" type="date" value="${escapeHtml(influencerState.filters?.from || period.from || '')}" />
          </div>
          <div>
            <label for="influencerAnalysisTo">Ate</label>
            <input id="influencerAnalysisTo" type="date" value="${escapeHtml(influencerState.filters?.to || period.to || '')}" />
          </div>
          <div>
            <label for="influencerAnalysisFocus">Foco</label>
            <select id="influencerAnalysisFocus">
              <option value="">Comparativo geral</option>
              ${cards.map((item) => `<option value="${escapeHtml(item.id)}"${Number(item.id) === Number(influencerState.selectedInfluencerId || 0) ? ' selected' : ''}>${escapeHtml(item.name || 'Influencer')}</option>`).join('')}
            </select>
          </div>
          <button class="btn primary" type="button" id="btnRunInfluencerAnalysis" ${cards.length ? '' : 'disabled'}>${influencerState.analysis.loading ? 'Analisando...' : 'Analisar'}</button>
        </div>
        <div class="influencer-analysis-result" id="influencerAnalysisResult">${escapeHtml(analysisText)}</div>
        <div class="small muted">${influencerState.analysis.generatedAt ? `Ultima analise em ${escapeHtml(formatDate(influencerState.analysis.generatedAt))}` : 'A IA usa os dados registrados para sugerir proximos passos, reforco de parceria ou necessidade de revisao.'}</div>
      </section>
    </section>
  `;

  applyMarketingInfluencerFilterValues(period);
  if (selectedCard) {
    const metricPeriodType = el('metricPeriodType');
    if (metricPeriodType) metricPeriodType.value = influencerState.filters?.periodType || period.period_type || 'month';
  }

  el('btnToggleInfluencerForm')?.addEventListener('click', () => {
    influencerState.formCollapsed = !influencerState.formCollapsed;
    renderMarketingInfluencerWorkspace();
  });
  el('btnResetInfluencerForm')?.addEventListener('click', () => {
    resetInfluencerForm();
  });
  el('btnRefreshInfluencerWorkspace')?.addEventListener('click', async () => {
    const filters = {
      periodType: el('influencerFilterPeriodType')?.value || influencerState.filters?.periodType || 'month',
      from: el('influencerFilterFrom')?.value || '',
      to: el('influencerFilterTo')?.value || '',
    };
    await fetchMarketingInfluencerBootstrap({ filters, preserveSelection: true });
  });
  el('influencerForm')?.addEventListener('submit', handleInfluencerFormSubmit);
  el('influencerMetricForm')?.addEventListener('submit', handleInfluencerMetricSubmit);
  el('btnRunInfluencerAnalysis')?.addEventListener('click', handleInfluencerAnalysis);

  Array.from(customWrap.querySelectorAll('[data-influencer-view]')).forEach((button) => {
    button.addEventListener('click', async () => {
      const influencerId = Number(button.getAttribute('data-influencer-view') || 0);
      if (!influencerId) return;
      influencerState.selectedInfluencerId = influencerId;
      renderMarketingInfluencerWorkspace();
      await fetchMarketingInfluencerDetail(influencerId);
    });
  });

  Array.from(customWrap.querySelectorAll('[data-influencer-edit]')).forEach((button) => {
    button.addEventListener('click', () => {
      const influencerId = Number(button.getAttribute('data-influencer-edit') || 0);
      const influencer = getMarketingInfluencerCards().find((item) => Number(item.id) === influencerId) || null;
      if (!influencer) return;
      populateInfluencerForm(influencer);
    });
  });
}

async function fetchMarketingInfluencerBootstrap(options = {}) {
  influencerState.loading = true;
  influencerState.error = '';
  influencerState.detailError = '';
  renderMarketingInfluencerWorkspace();

  try {
    const nextFilters = options.filters || getMarketingInfluencerPeriodFilters();
    const queryString = buildMarketingInfluencerQueryString(nextFilters);
    const { marketing } = await api(`/api/intranet/marketing/influencers/bootstrap?${queryString}`);
    const payload = marketing || {};
    influencerState.enabled = Boolean(payload.enabled !== false);
    influencerState.loaded = true;
    influencerState.bootstrap = payload;
    influencerState.loading = false;
    setMarketingInfluencerFilters({
      periodType: payload.period?.period_type || nextFilters.periodType || 'month',
      from: payload.period?.from || nextFilters.from || '',
      to: payload.period?.to || nextFilters.to || '',
    });

    const cards = Array.isArray(payload.influencers) ? payload.influencers : [];
    const preserveSelection = options.preserveSelection !== false;
    const preferredId = Number(options.selectedInfluencerId || influencerState.selectedInfluencerId || 0);
    if (preserveSelection && preferredId && cards.some((item) => Number(item.id) === preferredId)) {
      influencerState.selectedInfluencerId = preferredId;
    } else {
      influencerState.selectedInfluencerId = cards[0]?.id || null;
    }

    renderMarketingInfluencerWorkspace();
    if (options.loadDetail === false || !influencerState.selectedInfluencerId) {
      influencerState.detail = null;
      return;
    }
    await fetchMarketingInfluencerDetail(influencerState.selectedInfluencerId, { quiet: true });
  } catch (err) {
    influencerState.loading = false;
    influencerState.loaded = true;
    influencerState.error = err.message || 'Erro ao carregar a area de influencers.';
    influencerState.bootstrap = null;
    influencerState.detail = null;
    influencerState.detailLoading = false;
    renderMarketingInfluencerWorkspace();
  }
}

async function fetchMarketingInfluencerDetail(influencerId, options = {}) {
  const safeId = Number(influencerId || 0);
  if (!safeId) {
    influencerState.detail = null;
    renderMarketingInfluencerWorkspace();
    return;
  }

  influencerState.detailLoading = true;
  influencerState.detailError = '';
  if (!options.quiet) renderMarketingInfluencerWorkspace();

  try {
    const queryString = buildMarketingInfluencerQueryString(getMarketingInfluencerPeriodFilters());
    const payload = await api(`/api/intranet/marketing/influencers/${safeId}?${queryString}`);
    influencerState.detail = payload;
    influencerState.selectedInfluencerId = safeId;
    influencerState.detailLoading = false;
    renderMarketingInfluencerWorkspace();
  } catch (err) {
    influencerState.detailLoading = false;
    influencerState.detailError = err.message || 'Nao foi possivel carregar o relatorio da influencer.';
    renderMarketingInfluencerWorkspace();
  }
}

async function handleInfluencerFormSubmit(event) {
  event.preventDefault();
  const payload = {
    id: Number(el('influencerId')?.value || 0) || null,
    name: el('influencerName')?.value.trim() || '',
    influence_types: el('influencerTypes')?.value || '',
    contract_type: el('influencerContractType')?.value || '',
    photo_url: el('influencerPhotoUrl')?.value.trim() || '',
    instagram_url: el('influencerInstagram')?.value.trim() || '',
    followers_count: Number(el('influencerFollowers')?.value || 0),
    partnership_start_date: el('influencerStartDate')?.value || '',
    influencer_status: el('influencerStatus')?.value || 'ativo',
    notes: el('influencerNotes')?.value.trim() || '',
  };

  if (!payload.name) {
    alert('Informe o nome da influencer.');
    return;
  }

  try {
    const { influencer } = await api('/api/intranet/marketing/influencers', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    resetInfluencerForm();
    influencerState.formCollapsed = true;
    influencerState.selectedInfluencerId = influencer?.id || influencerState.selectedInfluencerId;
    await fetchMarketingInfluencerBootstrap({
      filters: getMarketingInfluencerPeriodFilters(),
      preserveSelection: true,
      selectedInfluencerId: influencerState.selectedInfluencerId,
    });
  } catch (err) {
    alert('Nao foi possivel salvar a influencer: ' + err.message);
  }
}

async function handleInfluencerMetricSubmit(event) {
  event.preventDefault();
  const influencerId = Number(influencerState.selectedInfluencerId || 0);
  if (!influencerId) {
    alert('Selecione uma influencer para registrar a performance.');
    return;
  }

  const payload = {
    period_type: el('metricPeriodType')?.value || 'month',
    period_start: el('metricPeriodStart')?.value || '',
    period_end: el('metricPeriodEnd')?.value || '',
    posts_count: Number(el('metricPosts')?.value || 0),
    reels_count: Number(el('metricReels')?.value || 0),
    stories_count: Number(el('metricStories')?.value || 0),
    views_count: Number(el('metricViews')?.value || 0),
    enrollments_count: Number(el('metricEnrollments')?.value || 0),
    notes: el('metricNotes')?.value.trim() || '',
    source_type: 'manual',
  };

  if (!payload.period_start) {
    alert('Informe ao menos a data inicial do lancamento.');
    return;
  }

  try {
    await api(`/api/intranet/marketing/influencers/${influencerId}/metrics`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    await fetchMarketingInfluencerBootstrap({
      filters: getMarketingInfluencerPeriodFilters(),
      preserveSelection: true,
      selectedInfluencerId: influencerId,
    });
  } catch (err) {
    alert('Nao foi possivel registrar a performance: ' + err.message);
  }
}

async function handleInfluencerAnalysis() {
  influencerState.analysis.loading = true;
  renderMarketingInfluencerWorkspace();

  try {
    const payload = {
      period_type: el('influencerAnalysisPeriodType')?.value || influencerState.filters?.periodType || 'month',
      from: el('influencerAnalysisFrom')?.value || influencerState.filters?.from || '',
      to: el('influencerAnalysisTo')?.value || influencerState.filters?.to || '',
      influencer_id: Number(el('influencerAnalysisFocus')?.value || 0) || null,
    };
    const response = await api('/api/intranet/marketing/influencers/analyze', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    influencerState.analysis.loading = false;
    influencerState.analysis.periodType = payload.period_type;
    influencerState.analysis.result = response.analysis_text || 'Nao foi possivel gerar a analise.';
    influencerState.analysis.generatedAt = response.generated_at || new Date().toISOString();
    renderMarketingInfluencerWorkspace();
  } catch (err) {
    influencerState.analysis.loading = false;
    influencerState.analysis.result = `Nao foi possivel analisar este periodo: ${err.message}`;
    influencerState.analysis.generatedAt = new Date().toISOString();
    renderMarketingInfluencerWorkspace();
  }
}

function setActiveView(viewKey, options = {}) {
  if (!bootstrapData?.intranet) return;
  currentViewState = normalizeViewState({
    key: viewKey,
    departmentSlug: options.departmentSlug ?? currentViewState.departmentSlug,
    submenuSlug: options.submenuSlug ?? currentViewState.submenuSlug,
  }, bootstrapData.intranet);

  if (currentViewState.key === 'department' && currentViewState.departmentSlug) {
    toggleDepartmentExpanded(currentViewState.departmentSlug, true);
  }

  writeViewPreference(currentViewState);
  syncTopbar(currentViewState, bootstrapData.intranet);
  syncVisibleViews(currentViewState);
  syncSidebarNavigation(bootstrapData.intranet);
  renderDepartmentWorkspace(bootstrapData.intranet);
  closeSidebarOnMobile();
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
  if (section) section.hidden = !isVisible;
}

function renderTrainingCards(training = {}) {
  const wrap = el('trainingSummaryCards');
  if (!wrap) return;
  wrap.innerHTML = '';

  const knowledgeCounts = training.knowledge?.counts || {};
  const documentMemories = Number(training.memories?.document_total || 0);
  const cards = [
    { label: 'Arquivos', value: Number(knowledgeCounts.total || 0) },
    { label: 'Processados', value: Number(knowledgeCounts.processed || 0) },
    { label: 'Analisados', value: Number(knowledgeCounts.analyzed || 0) },
    { label: 'Disponiveis para IA', value: Number(knowledgeCounts.available || 0) },
    { label: 'Memorias documentais', value: documentMemories },
    { label: 'Usados em respostas', value: Number(knowledgeCounts.documents_used_in_responses || 0) },
    { label: 'Para reprocessar', value: Number(knowledgeCounts.needs_reprocess || 0) },
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

function addMonths(dateKey, amount) {
  const [year, month, day] = String(dateKey || getTodayDateKey()).split('-').map((item) => Number(item || 0));
  const safeYear = year || new Date().getFullYear();
  const safeMonth = month || 1;
  const safeDay = day || 1;
  const monthAnchor = new Date(`${String(safeYear).padStart(4, '0')}-${String(safeMonth).padStart(2, '0')}-01T12:00:00-03:00`);
  monthAnchor.setMonth(monthAnchor.getMonth() + Number(amount || 0));
  const lastDay = new Date(monthAnchor.getFullYear(), monthAnchor.getMonth() + 1, 0).getDate();
  monthAnchor.setDate(Math.min(safeDay, lastDay));
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(monthAnchor);
}

function formatCalendarDateLabel(dateKey) {
  try {
    return new Date(`${dateKey}T12:00:00-03:00`).toLocaleDateString(currentLocale(), {
      weekday: 'short',
      day: '2-digit',
      month: 'short',
      timeZone: 'America/Sao_Paulo',
    });
  } catch {
    return dateKey || '';
  }
}

function formatCalendarRangeLabel(range = {}) {
  if (calendarState.view === 'month' && range.from) {
    try {
      return new Date(`${range.from}T12:00:00-03:00`).toLocaleDateString(currentLocale(), {
        month: 'long',
        year: 'numeric',
        timeZone: 'America/Sao_Paulo',
      });
    } catch {}
  }

  const from = range.from ? formatCalendarDateLabel(range.from) : '';
  const to = range.to ? formatCalendarDateLabel(range.to) : '';
  if (!from && !to) return t('calendar.defaultAgenda');
  if (from === to) return from;
  return `${from} - ${to}`;
}

function getCalendarModeLabel(mode = '') {
  if (mode === 'presencial') return t('calendar.modeLabel.presencial');
  if (mode === 'hibrida') return t('calendar.modeLabel.hibrida');
  return t('calendar.modeLabel.online');
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
    { label: t('calendar.summary.inPeriod'), value: events.length },
    { label: t('calendar.summary.today'), value: events.filter((item) => item.start_date === today).length },
    { label: t('calendar.summary.thisWeek'), value: events.filter((item) => item.start_date >= today && item.start_date <= nextWeek).length },
    { label: t('calendar.summary.myEvents'), value: events.filter((item) => (item.participants || []).some((participant) => Number(participant.user_id || 0) === currentUserId)).length },
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
    typeSelect.innerHTML = `<option value="">${escapeHtml(t('common.all'))}</option>`;
    sortAlphabetically(calendarState.eventTypes || [], (item) => item?.name || '').forEach((item) => {
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
    eventTypeSelect.innerHTML = `<option value="">${escapeHtml(t('common.select'))}</option>`;
    sortAlphabetically(calendarState.eventTypes || [], (item) => item?.name || '').forEach((item) => {
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
  userSelect.innerHTML = `<option value="">${escapeHtml(t('common.all'))}</option>`;
  sortAlphabetically(calendarState.users || [], (item) => item?.name || item?.email || '').forEach((item) => {
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

  sortAlphabetically(calendarState.users || [], (item) => item?.name || item?.email || '').forEach((user) => {
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
    wrap.innerHTML = `<div class="intranet-empty-card">${escapeHtml(t('calendar.noHistory'))}</div>`;
    return;
  }
  wrap.innerHTML = history.map((item) => `
    <div class="intranet-sales-history-item">
      <strong>${escapeHtml(item.action || t('intranet.generic.update', {}, 'Atualizacao'))}</strong>
      <div class="small muted">${escapeHtml(formatDate(item.created_at))} - ${escapeHtml(item.actor_name || t('intranet.generic.system', {}, 'Sistema'))}</div>
      <div>${escapeHtml(item.field_name || '')}${item.old_value || item.new_value ? `: ${escapeHtml(item.old_value || '-')} -> ${escapeHtml(item.new_value || '-')}` : ''}</div>
    </div>
  `).join('');
}

function resetCalendarEditor(dateKey = '') {
  const form = el('calendarForm');
  if (!form) return;
  form.reset();
  el('calendarEventId').value = '';
  el('calendarEditorTitle').textContent = t('calendar.editorNew');
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
  el('calendarEditorTitle').textContent = event.title || t('calendar.defaultEventTitle');
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
  const today = getTodayDateKey();
  const activeMonth = String(calendarState.baseDate || range.from || today).slice(0, 7);
  const byDate = new Map();
  sortCalendarEvents(events).forEach((event) => {
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
        ${Array.from({ length: 7 }, (_, index) => {
          const base = new Date('2026-03-08T12:00:00-03:00');
          base.setDate(base.getDate() + index);
          return `<div>${escapeHtml(new Intl.DateTimeFormat(currentLocale(), { weekday: 'short', timeZone: 'America/Sao_Paulo' }).format(base))}</div>`;
        }).join('')}
      </div>
      <div class="intranet-calendar-grid">
        ${days.map((dateKey) => {
          const items = byDate.get(dateKey) || [];
          const stateClass = [
            'intranet-calendar-day',
            dateKey === today ? 'is-today' : '',
            dateKey === calendarState.baseDate ? 'is-selected' : '',
            dateKey.slice(0, 7) !== activeMonth ? 'is-outside-month' : '',
            items.length ? 'has-events' : '',
          ].filter(Boolean).join(' ');
          return `
            <div class="${stateClass}">
              <button class="intranet-calendar-day-number" type="button" data-date="${escapeHtml(dateKey)}">${escapeHtml(dateKey.slice(-2))}</button>
              <div class="intranet-calendar-day-events">
                ${items.slice(0, 4).map((item) => `
                  <button class="intranet-calendar-event-chip" type="button" data-event-id="${escapeHtml(item.id)}">
                    <span>${escapeHtml(item.start_time || '')}</span>${escapeHtml(item.title || t('calendar.defaultEventTitle'))}
                  </button>
                `).join('')}
                ${items.length > 4 ? `<div class="small muted">${escapeHtml(t('calendar.moreEvents', { count: items.length - 4 }))}</div>` : ''}
              </div>
            </div>
          `;
        }).join('')}
      </div>
    </div>
  `;
}

function sortCalendarEvents(events = []) {
  return [...events].sort((left, right) => {
    const leftKey = `${left.start_date || ''} ${left.all_day ? '00:00' : (left.start_time || '00:00')} ${left.title || ''}`;
    const rightKey = `${right.start_date || ''} ${right.all_day ? '00:00' : (right.start_time || '00:00')} ${right.title || ''}`;
    return leftKey.localeCompare(rightKey, currentLocale());
  });
}

function buildCalendarWeekGrid(events = []) {
  const range = calendarState.range || {};
  const start = new Date(`${range.from}T12:00:00-03:00`);
  const end = new Date(`${range.to}T12:00:00-03:00`);
  const today = getTodayDateKey();
  const byDate = new Map();
  sortCalendarEvents(events).forEach((event) => {
    const key = event.start_date || '';
    if (!byDate.has(key)) byDate.set(key, []);
    byDate.get(key).push(event);
  });

  const days = [];
  const cursor = new Date(start);
  while (cursor.getTime() <= end.getTime()) {
    days.push(new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Sao_Paulo',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }

  return `
    <div class="intranet-calendar-week">
      ${days.map((dateKey) => {
        const items = byDate.get(dateKey) || [];
        const isToday = dateKey === today;
        const isSelected = dateKey === calendarState.baseDate;
        return `
          <section class="intranet-calendar-week-column${isToday ? ' is-today' : ''}${isSelected ? ' is-selected' : ''}">
            <button class="intranet-calendar-week-head${isToday ? ' is-today' : ''}${isSelected ? ' is-selected' : ''}" type="button" data-date="${escapeHtml(dateKey)}">
              <strong>${escapeHtml(formatCalendarDateLabel(dateKey))}</strong>
              <span>${escapeHtml(t('calendar.moreEvents', { count: items.length }).replace(/^\+\s*/, ''))}</span>
            </button>
            <div class="intranet-calendar-week-events">
              ${items.length ? items.map((item) => `
                <button class="intranet-calendar-event-chip intranet-calendar-week-item" type="button" data-event-id="${escapeHtml(item.id)}">
                  <span>${escapeHtml(item.all_day ? t('calendar.fullDay') : (item.start_time || ''))}</span>${escapeHtml(item.title || t('calendar.defaultEventTitle'))}
                </button>
              `).join('') : `<div class="small muted intranet-calendar-week-empty">${escapeHtml(t('calendar.emptyWeek'))}</div>`}
            </div>
          </section>
        `;
      }).join('')}
    </div>
  `;
}

function buildCalendarDayView(events = []) {
  const title = calendarState.range?.from ? formatCalendarDateLabel(calendarState.range.from) : t('calendar.selectedDay', {}, 'Dia selecionado');
  const sortedEvents = sortCalendarEvents(events);

  if (!sortedEvents.length) {
    return `
      <div class="intranet-calendar-day-view">
        <div class="intranet-block-title">${escapeHtml(title)}</div>
        <div class="intranet-empty-card">${escapeHtml(t('calendar.noEventsDay'))}</div>
      </div>
    `;
  }

  return `
    <div class="intranet-calendar-day-view">
      <div class="intranet-block-title">${escapeHtml(title)}</div>
      <div class="intranet-calendar-day-list">
        ${sortedEvents.map((item) => `
          <button class="intranet-calendar-day-item" type="button" data-event-id="${escapeHtml(item.id)}">
            <div class="intranet-calendar-day-time">${escapeHtml(item.all_day ? t('calendar.fullDay') : `${item.start_time || ''} - ${item.end_time || ''}`)}</div>
            <div class="intranet-calendar-day-copy">
              <strong>${escapeHtml(item.title || t('calendar.defaultEventTitle'))}</strong>
              <span>${escapeHtml(item.event_type_name || t('calendar.defaultAgenda'))} - ${escapeHtml(getCalendarModeLabel(item.meeting_mode))}</span>
              <small>${escapeHtml(item.location || item.meeting_link || item.description || '')}</small>
            </div>
          </button>
        `).join('')}
      </div>
    </div>
  `;
}

function buildCalendarListView(events = []) {
  if (!events.length) {
    return `<div class="intranet-empty-card">${escapeHtml(t('calendar.noEventsPeriod'))}</div>`;
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
                <strong>${escapeHtml(item.title || t('calendar.defaultEventTitle'))}</strong>
                <div class="small muted">${escapeHtml(item.event_type_name || t('calendar.defaultAgenda'))} - ${escapeHtml(getCalendarModeLabel(item.meeting_mode))}</div>
              </div>
              <span>${escapeHtml(item.all_day ? t('calendar.fullDay') : `${item.start_time || ''} - ${item.end_time || ''}`)}</span>
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
  wrap.setAttribute('data-calendar-view', calendarState.view);
  if (calendarState.view === 'month') {
    wrap.innerHTML = buildCalendarMonthGrid(calendarState.events || []);
  } else if (calendarState.view === 'week') {
    wrap.innerHTML = buildCalendarWeekGrid(calendarState.events || []);
  } else if (calendarState.view === 'day') {
    wrap.innerHTML = buildCalendarDayView(calendarState.events || []);
  } else {
    wrap.innerHTML = buildCalendarListView(calendarState.events || []);
  }

  Array.from(wrap.querySelectorAll('[data-event-id]')).forEach((button) => {
    button.addEventListener('click', () => selectCalendarEvent(Number(button.getAttribute('data-event-id'))));
  });
  Array.from(wrap.querySelectorAll('[data-date]')).forEach((button) => {
    button.addEventListener('click', async () => {
      const dateKey = button.getAttribute('data-date');
      calendarState.baseDate = dateKey || calendarState.baseDate;
      if (calendarState.view !== 'day') {
        calendarState.view = 'day';
      }
      await fetchCalendarEvents();
      resetCalendarEditor(dateKey);
    });
  });
}

function shiftCalendarBaseDate(step = 1) {
  if (calendarState.view === 'month') {
    calendarState.baseDate = addMonths(calendarState.baseDate || getTodayDateKey(), step);
    return;
  }
  if (calendarState.view === 'week') {
    calendarState.baseDate = addDays(calendarState.baseDate || getTodayDateKey(), step * 7);
    return;
  }
  calendarState.baseDate = addDays(calendarState.baseDate || getTodayDateKey(), step);
}

async function selectCalendarEvent(eventId) {
  calendarState.selectedEventId = Number(eventId || 0);
  try {
    const { event, history } = await api(`/api/intranet/calendar/events/${eventId}`);
    fillCalendarEditor(event, history || []);
  } catch (err) {
    alert(t('calendar.loadError', { error: err.message }, `Nao foi possivel carregar o compromisso: ${err.message}`));
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
    modeSelect.innerHTML = `<option value="">${escapeHtml(t('common.all'))}</option>` + (calendar?.meeting_modes || []).map((item) => `<option value="${escapeHtml(item.key)}">${escapeHtml(getCalendarModeLabel(item.key) || item.label)}</option>`).join('');
  }

  resetCalendarEditor(calendarState.baseDate);
  await fetchCalendarEvents();
}

function setSalesSectionVisible(isVisible) {
  const section = el('sales');
  if (section) section.hidden = !isVisible;
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

function canManageCommunication() {
  return Boolean(bootstrapData?.intranet?.admin?.can_manage);
}

function getCommunicationDepartments() {
  const catalog = Array.isArray(bootstrapData?.department_catalog) ? bootstrapData.department_catalog : [];
  return [...catalog]
    .filter((department) => department?.is_active !== false)
    .sort((a, b) => {
      const left = Number(a?.sort_order || a?.sortOrder || 0);
      const right = Number(b?.sort_order || b?.sortOrder || 0);
      if (left !== right) return left - right;
      return String(a?.name || '').localeCompare(String(b?.name || ''), currentLocale());
    });
}

function getSelectedCommunicationDepartmentIds() {
  return Array.from(document.querySelectorAll('#communicationDepartments input:checked')).map((input) => Number(input.value));
}

function renderCommunicationDepartmentOptions(selectedIds = []) {
  const wrap = el('communicationDepartments');
  if (!wrap) return;
  const selected = new Set((selectedIds || []).map((item) => String(item)));
  wrap.innerHTML = '';

  getCommunicationDepartments().forEach((department) => {
    const label = document.createElement('label');
    label.className = 'department-check';
    label.innerHTML = `
      <input type="checkbox" value="${escapeHtml(department.id)}" ${selected.has(String(department.id)) ? 'checked' : ''} />
      <span>
        <strong>${escapeHtml(department.name || t('intranet.departmentDefaultName', {}, 'Departamento'))}</strong>
        <small>${escapeHtml(department.description || t('intranet.communication.segmentedDepartmentHint', {}, 'Comunicado segmentado para esta area.'))}</small>
      </span>
    `;
    wrap.appendChild(label);
  });
}

function syncCommunicationAudienceControls() {
  const scope = el('communicationAudienceScope')?.value || 'all';
  const departmentsWrap = el('communicationDepartmentsWrap');
  if (!departmentsWrap) return;
  const shouldShow = scope === 'departments';
  departmentsWrap.hidden = !shouldShow;
  departmentsWrap.querySelectorAll('input').forEach((input) => {
    input.disabled = !shouldShow;
  });
}

function resetCommunicationForm() {
  const form = el('communicationForm');
  if (!form) return;
  communicationState.editingId = null;
  el('communicationAnnouncementId').value = '';
  el('communicationFormTitle').textContent = t('intranet.communication.publishTitle', {}, 'Publicar comunicado');
  el('communicationTitle').value = '';
  el('communicationSummary').value = '';
  el('communicationContent').value = '';
  el('communicationType').value = 'announcement';
  el('communicationPriority').value = 'normal';
  el('communicationAudienceScope').value = 'all';
  el('communicationStartsAt').value = '';
  el('communicationEndsAt').value = '';
  el('communicationIsActive').checked = true;
  el('btnCancelCommunicationEdit').style.display = 'none';
  el('btnSaveCommunication').textContent = t('intranet.communication.save', {}, 'Salvar comunicado');
  renderCommunicationDepartmentOptions([]);
  syncCommunicationAudienceControls();
}

function populateCommunicationForm(announcement) {
  if (!announcement) return;
  communicationState.editingId = Number(announcement.id || 0) || null;
  el('communicationAnnouncementId').value = String(announcement.id || '');
  el('communicationFormTitle').textContent = t('intranet.communication.editTitle', { id: announcement.id }, `Editar comunicado #${announcement.id}`);
  el('communicationTitle').value = announcement.title || '';
  el('communicationSummary').value = announcement.summary_text || '';
  el('communicationContent').value = announcement.content_text || '';
  el('communicationType').value = announcement.announcement_type || 'announcement';
  el('communicationPriority').value = announcement.priority || 'normal';
  el('communicationAudienceScope').value = announcement.audience_scope || 'all';
  el('communicationStartsAt').value = toDateTimeLocalValue(announcement.starts_at);
  el('communicationEndsAt').value = toDateTimeLocalValue(announcement.ends_at);
  el('communicationIsActive').checked = announcement.is_active !== false;
  renderCommunicationDepartmentOptions(announcement.department_ids || []);
  syncCommunicationAudienceControls();
  el('btnCancelCommunicationEdit').style.display = '';
  el('btnSaveCommunication').textContent = t('intranet.communication.saveChanges', {}, 'Salvar alteracoes');
}

function renderCommunicationCatalogList() {
  const countLabel = el('communicationCountLabel');
  const list = el('communicationManageList');
  if (!countLabel || !list) return;

  const items = Array.isArray(communicationState.catalog) ? communicationState.catalog : [];
  countLabel.textContent = items.length === 1
    ? t('intranet.communication.onePublished', {}, '1 comunicado publicado')
    : t('intranet.communication.manyPublished', { count: items.length }, `${items.length} comunicados publicados`);

  if (!items.length) {
    list.innerHTML = `<div class="intranet-empty-card">${escapeHtml(t('intranet.communication.nonePublished', {}, 'Nenhum comunicado publicado ainda.'))}</div>`;
    return;
  }

  list.innerHTML = '';
  items.forEach((announcement) => {
    const audience = announcement.audience_scope === 'departments'
      ? t('intranet.communication.departmentsAudience', { departments: (announcement.department_names || []).join(', ') || '-' }, `Departamentos: ${(announcement.department_names || []).join(', ') || '-'}`)
      : t('intranet.communication.allUsers', {}, 'Todos os usuarios');
    const schedule = [
      announcement.starts_at ? formatDate(announcement.starts_at) : t('intranet.generic.now', {}, 'Agora'),
      announcement.ends_at ? formatDate(announcement.ends_at) : t('intranet.generic.noEnd', {}, 'Sem fim'),
    ].join(' - ');

    const card = document.createElement('article');
    card.className = 'intranet-communication-manage-card';
    card.innerHTML = `
      <div class="intranet-card-meta">${escapeHtml(announcement.priority || 'normal')} - ${escapeHtml(announcement.announcement_type || 'announcement')}</div>
      <h4>${escapeHtml(announcement.title || t('intranet.generic.announcement', {}, 'Comunicado'))}</h4>
      <p>${escapeHtml(announcement.summary_text || announcement.content_text || '')}</p>
      <div class="small muted">${escapeHtml(audience)}</div>
      <div class="small muted">${escapeHtml(schedule)}</div>
      <div class="intranet-card-actions"></div>
    `;

    const actions = card.querySelector('.intranet-card-actions');

    const editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.className = 'btn';
    editBtn.textContent = t('common.edit');
    editBtn.onclick = () => populateCommunicationForm(announcement);
    actions.appendChild(editBtn);

    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'btn danger';
    deleteBtn.textContent = t('common.delete');
    deleteBtn.onclick = async () => {
      if (!confirm(t('intranet.communication.deleteConfirm', { title: announcement.title }, `Deseja excluir o comunicado "${announcement.title}"?`))) return;
      try {
        await api(`/api/admin/intranet/announcements/${announcement.id}`, { method: 'DELETE' });
        resetCommunicationForm();
        await refreshIntranetBootstrap();
      } catch (err) {
        alert(t('intranet.communication.deleteError', { error: err.message }, `Nao foi possivel excluir o comunicado: ${err.message}`));
      }
    };
    actions.appendChild(deleteBtn);

    list.appendChild(card);
  });
}

async function fetchCommunicationCatalog() {
  if (!canManageCommunication()) {
    communicationState.catalog = [];
    renderCommunicationCatalogList();
    return;
  }
  const { announcements } = await api('/api/admin/intranet/announcements');
  communicationState.catalog = announcements || [];
  renderCommunicationCatalogList();
}

function renderCommunication(intranet) {
  const grid = el('communicationGrid');
  if (!grid) return;
  grid.innerHTML = '';

  const items = intranet.communication?.mural || [];
  if (!items.length) {
    grid.innerHTML = `<div class="intranet-empty-card">${escapeHtml(t('intranet.communication.emptyTitle'))}</div>`;
  } else {
    items.forEach((item) => {
      const card = document.createElement('article');
      card.className = 'intranet-communication-card';
      card.innerHTML = `
        <div class="intranet-card-meta">${escapeHtml(item.priority || 'normal')} - ${escapeHtml(item.type || 'announcement')}</div>
        <h4>${escapeHtml(item.title || t('intranet.generic.announcement', {}, 'Comunicado'))}</h4>
        <p>${escapeHtml(item.description || '')}</p>
        <div class="small muted">${escapeHtml(formatDate(item.created_at || ''))}</div>
      `;
      grid.appendChild(card);
    });
  }

  const managerPanel = el('communicationManagerPanel');
  if (managerPanel) {
    managerPanel.hidden = !canManageCommunication();
    if (canManageCommunication()) {
      renderCommunicationDepartmentOptions(getSelectedCommunicationDepartmentIds());
      syncCommunicationAudienceControls();
      renderCommunicationCatalogList();
    }
  }
}

function applyDocumentFilter() {
  const query = el('documentSearch').value || '';
  renderModules(bootstrapData.intranet, query);
  renderDocuments(bootstrapData.intranet, query);
}

async function init() {
  await i18n()?.ready?.();
  i18n()?.renderLanguageSwitcher?.('intranetLanguageSwitcher', { compact: true, showLabel: false });
  renderIntranetChrome();
  i18n()?.onChange?.((locale) => {
    renderIntranetChrome();
    if (bootstrapData) {
      applyIntranetSnapshot(bootstrapData, { preserveRoute: true, route: currentViewState });
      if (canManageCommunication()) {
        renderCommunicationCatalogList();
      }
      if (calendarState.enabled) {
        renderCalendarTypeOptions();
        renderCalendarUserOptions();
        renderCalendarViewButtons();
        if (calendarState.range) el('calendarRangeLabel').textContent = formatCalendarRangeLabel(calendarState.range || {});
        renderCalendarSummary();
        renderCalendarView();
      }
    }
    fetch('/api/me/preferences', {
      method: 'PATCH',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        ...(i18n()?.buildHeaders?.() || {}),
      },
      body: JSON.stringify({ preferred_locale: locale }),
    }).catch(() => {});
  });
  try {
    bootstrapData = await api('/api/intranet/bootstrap');
  } catch (err) {
    if (String(err.message || '').includes('intranet_access_denied')) {
      window.location.href = '/index.html';
      return;
    }
    alert(t('intranet.loadError', { error: err.message }, `Nao foi possivel carregar a intranet: ${err.message}`));
    return;
  }

  if (bootstrapData?.user?.preferred_locale && bootstrapData.user.preferred_locale !== currentLocale()) {
    await i18n()?.setLocale?.(bootstrapData.user.preferred_locale, { persist: false });
  }

  await fetchTrainingBootstrap();
  await fetchCalendarBootstrap().catch(() => {});
  expandedDepartmentSlugs = readExpandedDepartmentPreference();
  applySidebarPreference();
  applyIntranetSnapshot(bootstrapData, { preserveRoute: false });
  if (canManageCommunication()) {
    await fetchCommunicationCatalog().catch(() => {});
  } else {
    resetCommunicationForm();
  }

  el('documentSearch').addEventListener('input', applyDocumentFilter);
  el('communicationAudienceScope')?.addEventListener('change', syncCommunicationAudienceControls);
  el('btnCancelCommunicationEdit')?.addEventListener('click', () => {
    resetCommunicationForm();
  });
  el('communicationForm')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!canManageCommunication()) return;

    const announcementId = Number(el('communicationAnnouncementId').value || 0);
    const audienceScope = el('communicationAudienceScope').value;
    const payload = {
      title: el('communicationTitle').value.trim(),
      summary_text: el('communicationSummary').value.trim(),
      content_text: el('communicationContent').value.trim(),
      announcement_type: el('communicationType').value,
      priority: el('communicationPriority').value,
      audience_scope: audienceScope,
      department_ids: audienceScope === 'departments' ? getSelectedCommunicationDepartmentIds() : [],
      starts_at: el('communicationStartsAt').value || '',
      ends_at: el('communicationEndsAt').value || '',
      is_active: el('communicationIsActive').checked,
    };

    if (!payload.title) {
      alert(t('intranet.communication.titleRequired', {}, 'Informe o titulo do comunicado.'));
      return;
    }

    if (audienceScope === 'departments' && !payload.department_ids.length) {
      alert(t('intranet.communication.departmentsRequired', {}, 'Selecione ao menos um departamento para um comunicado segmentado.'));
      return;
    }

    try {
      if (announcementId) {
        await api(`/api/admin/intranet/announcements/${announcementId}`, {
          method: 'PATCH',
          body: JSON.stringify(payload),
        });
      } else {
        await api('/api/admin/intranet/announcements', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
      }
      resetCommunicationForm();
      await refreshIntranetBootstrap();
    } catch (err) {
      alert(t('intranet.communication.saveError', { error: err.message }, `Nao foi possivel salvar o comunicado: ${err.message}`));
    }
  });
  el('btnNewCalendarEvent')?.addEventListener('click', () => resetCalendarEditor(calendarState.baseDate || getTodayDateKey()));
  el('btnCalendarReset')?.addEventListener('click', () => resetCalendarEditor(calendarState.baseDate || getTodayDateKey()));
  el('btnCalendarPrev')?.addEventListener('click', async () => {
    shiftCalendarBaseDate(-1);
    await fetchCalendarEvents();
  });
  el('btnCalendarToday')?.addEventListener('click', async () => {
    calendarState.baseDate = getTodayDateKey();
    await fetchCalendarEvents();
  });
  el('btnCalendarNext')?.addEventListener('click', async () => {
    shiftCalendarBaseDate(1);
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
      await refreshIntranetBootstrap({ route: { key: 'calendar', departmentSlug: '', submenuSlug: '' } });
      await fetchCalendarEvents();
      if (calendarState.selectedEventId) {
        await selectCalendarEvent(calendarState.selectedEventId);
      }
    } catch (err) {
      alert(t('calendar.saveError', { error: err.message }, `Nao foi possivel salvar o compromisso: ${err.message}`));
    }
  });
  el('btnCalendarCancelEvent')?.addEventListener('click', async () => {
    const eventId = Number(el('calendarEventId').value || 0);
    if (!eventId) return;
    const reason = window.prompt(t('calendar.cancelReasonPrompt', {}, 'Motivo do cancelamento (opcional):'), '');
    try {
      await api(`/api/intranet/calendar/events/${eventId}/cancel`, {
        method: 'POST',
        body: JSON.stringify({ cancel_reason: reason || '' }),
      });
      await refreshIntranetBootstrap({ route: { key: 'calendar', departmentSlug: '', submenuSlug: '' } });
      await fetchCalendarEvents();
      await selectCalendarEvent(eventId);
    } catch (err) {
      alert(t('calendar.cancelError', { error: err.message }, `Nao foi possivel cancelar o compromisso: ${err.message}`));
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
      alert(t('intranet.generic.saveError', { error: err.message }, `Nao foi possivel salvar a atualizacao: ${err.message}`));
    }
  });
  el('btnIntranetMenu')?.addEventListener('click', toggleSidebar);
  el('btnSidebarCollapse')?.addEventListener('click', toggleSidebar);
  el('intranetSidebarBackdrop')?.addEventListener('click', () => setSidebarOpen(false));
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

