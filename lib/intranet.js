const { normalizeText: normalizeLanguageText } = require('./language');

const DEPARTMENT_DEFINITIONS = [
  {
    slug: 'professor',
    name: 'Professor',
    icon: 'graduation',
    sortOrder: 10,
    description: 'Espaço para rotinas pedagógicas, materiais de aula e acompanhamento de turmas.',
    aliases: ['docente'],
    accessLevels: ['colaborador', 'coordenador', 'administrador'],
    modules: [
      { key: 'planejamentos', title: 'Planejamentos', description: 'Roteiros, sequências didáticas e guias de aula.', type: 'documents' },
      { key: 'turmas', title: 'Turmas e acompanhamento', description: 'Visão de turmas, devolutivas e pontos de atenção.', type: 'workspace' },
      { key: 'comunicados', title: 'Comunicados escolares', description: 'Modelos de mensagens para alunos e famílias.', type: 'assistant' },
    ],
  },
  {
    slug: 'administrativo',
    name: 'Administrativo',
    icon: 'briefcase',
    sortOrder: 20,
    description: 'Procedimentos operacionais, formulários internos e rotinas administrativas.',
    aliases: ['adm'],
    accessLevels: ['colaborador', 'gestor', 'administrador'],
    modules: [
      { key: 'procedimentos', title: 'Procedimentos', description: 'Passos, checklists e processos internos.', type: 'documents' },
      { key: 'formularios', title: 'Formulários', description: 'Solicitações recorrentes e modelos oficiais.', type: 'workspace' },
      { key: 'atendimento', title: 'Atendimento interno', description: 'Orientações para demandas de secretaria e suporte.', type: 'assistant' },
    ],
  },
  {
    slug: 'pedagogico',
    name: 'Pedagógico',
    icon: 'book-open',
    sortOrder: 30,
    description: 'Curadoria acadêmica, trilhas de aprendizagem e qualidade pedagógica.',
    aliases: ['pedagógico'],
    accessLevels: ['colaborador', 'coordenador', 'administrador'],
    modules: [
      { key: 'curriculo', title: 'Currículo e trilhas', description: 'Bases, planos, objetivos e referências.', type: 'documents' },
      { key: 'avaliacoes', title: 'Avaliações', description: 'Matrizes, rubricas e diretrizes pedagógicas.', type: 'workspace' },
      { key: 'qualidade', title: 'Qualidade acadêmica', description: 'Rotinas para melhoria contínua do ensino.', type: 'insight' },
    ],
  },
  {
    slug: 'rh',
    name: 'RH',
    icon: 'users',
    sortOrder: 40,
    description: 'Onboarding, benefícios, políticas internas e comunicação com colaboradores.',
    aliases: ['recursos humanos'],
    accessLevels: ['colaborador', 'gestor', 'administrador'],
    modules: [
      { key: 'beneficios', title: 'Benefícios', description: 'Guias, políticas e materiais para o colaborador.', type: 'documents' },
      { key: 'onboarding', title: 'Onboarding', description: 'Jornadas de entrada, trilhas e checklists.', type: 'workspace' },
      { key: 'pessoas', title: 'Comunicação com pessoas', description: 'Avisos internos e comunicados padronizados.', type: 'assistant' },
    ],
  },
  {
    slug: 'comercial',
    name: 'Comercial',
    icon: 'target',
    sortOrder: 50,
    description: 'Playbooks, discursos de venda, campanhas e acompanhamento comercial.',
    aliases: ['vendas'],
    accessLevels: ['colaborador', 'gestor', 'administrador'],
    modules: [
      { key: 'playbooks', title: 'Playbooks', description: 'Argumentos, objeções e roteiros comerciais.', type: 'documents' },
      { key: 'pipeline', title: 'Pipeline e operação', description: 'Fluxos, processos e combinados do time.', type: 'workspace' },
      { key: 'copys', title: 'Mensagens e copys', description: 'Textos prontos e materiais de apoio comercial.', type: 'assistant' },
    ],
  },
  {
    slug: 'gestao',
    name: 'Gestão',
    icon: 'chart',
    sortOrder: 60,
    description: 'Indicadores, priorização, comunicados de liderança e acompanhamento executivo.',
    aliases: ['gestão', 'lideranca', 'liderança'],
    accessLevels: ['gestor', 'diretoria', 'administrador'],
    modules: [
      { key: 'indicadores', title: 'Indicadores', description: 'Visão de metas, ritos e performance.', type: 'insight' },
      { key: 'planos', title: 'Planos de ação', description: 'Prioridades, metas e acompanhamentos.', type: 'workspace' },
      { key: 'comunicacao', title: 'Comunicação de liderança', description: 'Mensagens executivas e alinhamentos.', type: 'assistant' },
    ],
  },
  {
    slug: 'dashboard',
    name: 'Dashboard',
    icon: 'chart',
    sortOrder: 65,
    description: 'Indicadores, BI interno e visão consolidada da operação da escola.',
    aliases: ['bi', 'indicadores', 'power bi'],
    accessLevels: ['analista', 'gestor', 'administrador'],
    modules: [
      { key: 'painel-geral', title: 'Painel geral', description: 'KPIs, visões consolidadas e leitura executiva da escola.', type: 'insight' },
      { key: 'dashboards-setoriais', title: 'Dashboards por setor', description: 'Estrutura para expandir BI comercial, pedagógico, financeiro e operacional.', type: 'workspace' },
      { key: 'analises', title: 'Análises e leituras', description: 'Leituras de indicadores e oportunidades de melhoria.', type: 'assistant' },
    ],
  },
  {
    slug: 'financeiro',
    name: 'Financeiro',
    icon: 'wallet',
    sortOrder: 70,
    description: 'Relatórios, planilhas, procedimentos e materiais de controle financeiro.',
    aliases: ['financas', 'finanças'],
    accessLevels: ['analista', 'gestor', 'administrador'],
    modules: [
      { key: 'relatorios', title: 'Relatórios e planilhas', description: 'Arquivos-base, modelos e rotinas do setor.', type: 'documents' },
      { key: 'pagamentos', title: 'Pagamentos e aprovações', description: 'Fluxos e procedimentos internos.', type: 'workspace' },
      { key: 'analises', title: 'Análises estruturadas', description: 'Apoio para resumos e interpretação financeira.', type: 'assistant' },
    ],
  },
  {
    slug: 'marketing',
    name: 'Marketing',
    icon: 'megaphone',
    sortOrder: 80,
    description: 'Calendário de campanhas, brand book, assets e comunicação da marca.',
    aliases: [],
    accessLevels: ['colaborador', 'gestor', 'administrador'],
    modules: [
      { key: 'brandbook', title: 'Brand book', description: 'Tom de voz, identidade e diretrizes da marca.', type: 'documents' },
      { key: 'campanhas', title: 'Campanhas', description: 'Calendário, pautas e acompanhamento.', type: 'workspace' },
      { key: 'assets', title: 'Assets e criação', description: 'Peças, materiais e apoio criativo.', type: 'assistant' },
    ],
  },
  {
    slug: 'ti',
    name: 'TI',
    icon: 'shield',
    sortOrder: 90,
    description: 'Sistemas internos, acessos, documentação técnica e status operacional.',
    aliases: ['tecnologia'],
    accessLevels: ['colaborador', 'admin técnico'],
    modules: [
      { key: 'documentacao', title: 'Documentação técnica', description: 'Guias, acessos, infra e sistemas.', type: 'documents' },
      { key: 'suporte', title: 'Suporte e acessos', description: 'Procedimentos, checklists e orientações.', type: 'workspace' },
      { key: 'status', title: 'Status operacional', description: 'Visão de estabilidade e atualizações críticas.', type: 'insight' },
    ],
  },
  {
    slug: 'juridico',
    name: 'Jurídico',
    icon: 'scale',
    sortOrder: 100,
    description: 'Contratos, políticas, compliance e documentos legais da empresa.',
    aliases: ['jurídico', 'legal'],
    accessLevels: ['colaborador', 'gestor', 'administrador'],
    modules: [
      { key: 'contratos', title: 'Contratos e minutas', description: 'Bases legais e modelos oficiais.', type: 'documents' },
      { key: 'compliance', title: 'Compliance', description: 'Políticas, guias e orientações de conformidade.', type: 'workspace' },
      { key: 'pareceres', title: 'Pareceres e resumos', description: 'Apoio para localizar cláusulas e resumir materiais.', type: 'assistant' },
    ],
  },
  {
    slug: 'operacoes',
    name: 'Operações',
    icon: 'layers',
    sortOrder: 110,
    description: 'Fluxos operacionais, governança, SLAs e acompanhamento do dia a dia.',
    aliases: ['operações', 'operacao', 'operação'],
    accessLevels: ['colaborador', 'gestor', 'administrador'],
    modules: [
      { key: 'rotinas', title: 'Rotinas e SLAs', description: 'Acordos operacionais, ritos e checklists.', type: 'documents' },
      { key: 'execucao', title: 'Execução', description: 'Fluxos internos e alinhamentos do time.', type: 'workspace' },
      { key: 'gargalos', title: 'Gargalos e melhorias', description: 'Análise operacional com apoio operacional.', type: 'assistant' },
    ],
  },
  {
    slug: 'produto',
    name: 'Produto',
    icon: 'sparkles',
    sortOrder: 120,
    description: 'Roadmap, discovery, especificações e evolução dos produtos internos.',
    aliases: [],
    accessLevels: ['colaborador', 'gestor', 'administrador'],
    modules: [
      { key: 'roadmap', title: 'Roadmap', description: 'Priorização, backlog e objetivos.', type: 'workspace' },
      { key: 'descoberta', title: 'Discovery', description: 'Pesquisas, aprendizados e hipóteses.', type: 'documents' },
      { key: 'especificacoes', title: 'Especificações', description: 'Apoio para escrever requisitos e refinamentos.', type: 'assistant' },
    ],
  },
  {
    slug: 'atendimento',
    name: 'Atendimento',
    icon: 'message',
    sortOrder: 130,
    description: 'Scripts, políticas de atendimento, guias de resposta e escala de suporte.',
    aliases: ['suporte'],
    accessLevels: ['colaborador', 'gestor', 'administrador'],
    modules: [
      { key: 'scripts', title: 'Scripts e respostas', description: 'Mensagens padrão e orientações para contato.', type: 'documents' },
      { key: 'fila', title: 'Fila e operação', description: 'Fluxos de atendimento e combinados do time.', type: 'workspace' },
      { key: 'ajuda-ia', title: 'Apoio operacional', description: 'Resumos de contexto e padroniza??o de respostas.', type: 'assistant' },
    ],
  },
];

const DEPARTMENT_LOOKUP = new Map();
for (const definition of DEPARTMENT_DEFINITIONS) {
  const normalizedName = normalizeDepartmentKey(definition.name);
  const normalizedSlug = normalizeDepartmentKey(definition.slug);
  DEPARTMENT_LOOKUP.set(normalizedName, definition.name);
  DEPARTMENT_LOOKUP.set(normalizedSlug, definition.name);
  (definition.aliases || []).forEach((alias) => {
    DEPARTMENT_LOOKUP.set(normalizeDepartmentKey(alias), definition.name);
  });
}

const INTRANET_HOME_TEMPLATE = {
  heroTitle: 'Intranet Talkers',
  heroDescription: 'Um hub interno para documentos, comunicados e atalhos por departamento.',
  quickLinks: [
    { key: 'dashboard', title: 'Dashboard e indicadores', description: 'Acompanhar indicadores, alertas e prioridades da opera??o.', anchor: '#dashboard', style: 'primary' },
    { key: 'calendar', title: 'Agenda e calendário', description: 'Visualizar reuniões, compromissos e eventos internos.', anchor: '#calendar' },
    { key: 'docs', title: 'Central de documentos', description: 'Encontrar materiais internos e arquivos recentes.', anchor: '#documents' },
    { key: 'mural', title: 'Mural interno', description: 'Acompanhar comunicados e atualizações da empresa.', anchor: '#communication' },
  ],
  highlights: [
    'Base pronta para crescer com novos módulos.',
    'Permissões separadas por acesso e departamento.',
    'Conte?do interno centralizado para apoio operacional.',
  ],
};

const DEPARTMENT_SUBMENU_DEFINITIONS = [
  {
    departmentSlug: 'marketing',
    title: 'Influencer',
    slug: 'influencer',
    description: 'Cadastro, acompanhamento, performance e leitura comparativa das influencers parceiras.',
    icon: 'megaphone',
    viewKey: 'marketing-influencer',
    sortOrder: 10,
    isActive: true,
    metadata: {
      module: 'marketing_influencer',
      allow_manual_metrics: true,
      allow_ai_analysis: true,
    },
  },
  {
    departmentSlug: 'marketing',
    title: 'Indicador',
    slug: 'indicador',
    description: 'Entrada de dados em estilo planilha e acompanhamento dos indicadores que alimentam o dashboard do Marketing.',
    icon: 'chart',
    viewKey: 'marketing-indicator',
    sortOrder: 20,
    isActive: true,
    metadata: {
      module: 'marketing_indicator',
      allow_spreadsheet_entry: true,
      allow_dashboard_view: true,
      workbook_source: 'indicador geral.xlsx',
    },
  },
  {
    departmentSlug: 'pedagogico',
    title: 'WhatsApp',
    slug: 'whatsapp',
    description: 'Cadastro de grupos, campanhas pedagógicas, fila de envio e histórico operacional do WhatsApp.',
    icon: 'message',
    viewKey: 'pedagogico-whatsapp',
    sortOrder: 10,
    isActive: true,
    metadata: {
      module: 'pedagogical_whatsapp',
      allow_group_registry: true,
      allow_campaign_queue: true,
      requires_external_provider: true,
    },
  },
];

function normalizeIntranetText(value = '') {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function resolveAnnouncementDepartmentNames(announcement = {}, departmentAreas = []) {
  const ids = Array.isArray(announcement.department_ids) ? announcement.department_ids : [];
  if (!ids.length) return [];
  return departmentAreas
    .filter((department) => ids.includes(Number(department.id || 0)))
    .map((department) => department.name)
    .filter(Boolean);
}

function isDirectionAnnouncement(announcement = {}, departmentNames = []) {
  const normalizedDepartments = departmentNames.map((item) => normalizeIntranetText(item));
  const normalizedAuthor = normalizeIntranetText(announcement.author_name || '');
  const normalizedTitle = normalizeIntranetText(announcement.title || '');
  return announcement.announcement_type === 'institutional'
    || normalizedDepartments.some((item) => item.includes('gestao') || item.includes('direcao'))
    || normalizedAuthor.includes('direcao')
    || normalizedTitle.includes('direcao');
}

function mapAnnouncementForWorkspace(announcement = {}, departmentAreas = []) {
  const departmentNames = resolveAnnouncementDepartmentNames(announcement, departmentAreas);
  const isDirection = isDirectionAnnouncement(announcement, departmentNames);
  const originLabel = isDirection
    ? 'Direção'
    : (departmentNames[0] || announcement.author_name || 'Comunicado interno');

  return {
    id: announcement.id,
    title: announcement.title,
    summary: announcement.summary_text || announcement.content_text || '',
    description: announcement.summary_text || announcement.content_text || '',
    priority: announcement.priority || 'normal',
    type: announcement.announcement_type || 'announcement',
    created_at: announcement.created_at || '',
    is_pinned: Boolean(announcement.is_pinned),
    author_name: announcement.author_name || '',
    department_names: departmentNames,
    origin_label: originLabel,
    is_direction_highlight: isDirection,
  };
}

function normalizeDepartmentKey(value = '') {
  return String(normalizeLanguageText(value || '') || '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function sanitizeDepartment(value = '') {
  if (!value) return '';
  const original = String(value || '').trim();
  const normalized = normalizeDepartmentKey(original);
  return DEPARTMENT_LOOKUP.get(normalized) || original;
}

function sanitizeDepartmentList(values = []) {
  const source = Array.isArray(values)
    ? values
    : typeof values === 'string'
      ? values.split(',')
      : [];

  const seen = new Set();
  const out = [];

  for (const item of source) {
    const safe = sanitizeDepartment(item);
    if (!safe) continue;
    const key = normalizeDepartmentKey(safe);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(safe);
  }

  return out;
}

function buildDepartmentSeedRows() {
  return DEPARTMENT_DEFINITIONS.map((item) => ({
    slug: item.slug,
    name: item.name,
    description: item.description,
    icon: item.icon,
    sortOrder: item.sortOrder,
    isActive: true,
    metadataJson: JSON.stringify({
      access_levels: item.accessLevels,
      modules: item.modules,
    }),
  }));
}

function buildDepartmentSubmenuSeedRows() {
  return DEPARTMENT_SUBMENU_DEFINITIONS.map((item) => ({
    departmentSlug: item.departmentSlug,
    title: item.title,
    slug: item.slug,
    description: item.description,
    icon: item.icon,
    viewKey: item.viewKey,
    sortOrder: Number(item.sortOrder || 0),
    isActive: item.isActive !== false,
    metadataJson: JSON.stringify(item.metadata || {}),
  }));
}

function getDepartmentDefinitionByName(name = '') {
  const safeName = sanitizeDepartment(name);
  return DEPARTMENT_DEFINITIONS.find((item) => item.name === safeName) || null;
}

function parseDepartmentMetadata(value) {
  try {
    return value ? JSON.parse(value) : {};
  } catch {
    return {};
  }
}

function buildGenericDepartmentModules(departmentName = '') {
  const safeName = String(departmentName || 'Departamento').trim() || 'Departamento';
  return [
    { key: 'documentos', title: `Documentos de ${safeName}`, description: 'Materiais internos, políticas e documentos da área.', type: 'documents' },
    { key: 'rotinas', title: `Rotinas de ${safeName}`, description: 'Fluxos, processos e combinados operacionais do setor.', type: 'workspace' },
    { key: 'assistente', title: `Central de ${safeName}`, description: 'Apoio operacional para dúvidas, resumos e demandas do departamento.', type: 'assistant' },
  ];
}

function buildDepartmentWorkspace(department) {
  const definition = getDepartmentDefinitionByName(department?.name || department?.slug || '');
  const metadata = parseDepartmentMetadata(department?.metadata_json);
  const modules = Array.isArray(metadata.modules) && metadata.modules.length
    ? metadata.modules
    : (definition?.modules || buildGenericDepartmentModules(department?.name || department?.slug || 'Departamento'));
  const accessLevels = Array.isArray(metadata.access_levels) && metadata.access_levels.length
    ? metadata.access_levels
    : (definition?.accessLevels || ['colaborador']);

  return {
    id: department?.id || null,
    slug: department?.slug || definition?.slug || '',
    name: department?.name || definition?.name || '',
    description: department?.description || definition?.description || '',
    icon: department?.icon || definition?.icon || 'layers',
    access_level: department?.access_level || accessLevels[0] || 'colaborador',
    available_access_levels: accessLevels,
    is_active: department?.is_active !== false,
    modules,
    submenus: Array.isArray(department?.submenus)
      ? department.submenus.map((submenu) => ({
          id: submenu.id || null,
          title: submenu.title || '',
          slug: submenu.slug || '',
          description: submenu.description || '',
          icon: submenu.icon || department?.icon || definition?.icon || 'layers',
          view_key: submenu.view_key || submenu.slug || '',
          is_active: submenu.is_active !== false,
        }))
      : [],
  };
}

function buildDashboardWorkspace({
  user,
  departmentAreas = [],
  totalDocuments = 0,
  recentDocuments = [],
  salesWorkspace = null,
  departmentDocumentTotals = [],
  marketingIndicatorDashboard = null,
}) {
  const dashboardDepartment = departmentAreas.find((department) => department.slug === 'dashboard');
  const enabled = user?.role === 'admin' || Boolean(dashboardDepartment);
  const moduleTotal = departmentAreas.reduce((acc, department) => acc + Number((department.modules || []).length || 0), 0);
  const departmentCount = departmentAreas.length;
  const recentAvailable = (recentDocuments || []).filter((document) => document.available_to_ai).length;
  const breakdownLookup = new Map(
    (departmentDocumentTotals || []).map((item) => [String(item.name || ''), Number(item.total || 0)])
  );

  return {
    enabled,
    cards: [
      {
        label: 'Departamentos visíveis',
        value: String(departmentCount),
        description: user?.role === 'admin' ? 'Visão administrativa total da intranet.' : 'Áreas realmente liberadas para este perfil.',
      },
      {
        label: 'Módulos ativos',
        value: String(moduleTotal),
        description: 'Atalhos, workspaces e assistentes disponíveis agora.',
      },
      {
        label: 'Documentos acessíveis',
        value: String(totalDocuments),
        description: `${recentAvailable} arquivo(s) recentes já disponíveis para consulta.`,
      },
      {
        label: 'Operação comercial',
        value: String(Number(salesWorkspace?.summary?.total || 0)),
        description: salesWorkspace?.enabled
          ? 'Matrículas e operação comercial dentro do recorte permitido.'
          : 'Painel comercial não liberado para este perfil no momento.',
      },
    ],
    department_breakdown: departmentAreas.map((department) => ({
      slug: department.slug,
      name: department.name,
      icon: department.icon || 'layers',
      access_level: department.access_level || 'colaborador',
      modules_total: Array.isArray(department.modules) ? department.modules.length : 0,
      documents_total: breakdownLookup.get(department.name) || 0,
      description: department.description || '',
    })),
    highlights: [
      {
        title: 'Leitura executiva rápida',
        description: user?.role === 'admin'
          ? 'Como admin, você acompanha toda a intranet e pode navegar por qualquer área sem restrição.'
          : 'Este painel concentra os indicadores das áreas e módulos realmente liberados para o seu perfil.',
      },
      {
        title: 'Base documental viva',
        description: totalDocuments
          ? `A intranet ja expõe ${totalDocuments} documento(s) acessiveis para consulta, contexto e apoio operacional.`
          : 'A base documental ainda pode crescer com novos arquivos e departamentos.',
      },
      {
        title: 'Estrutura pronta para BI setorial',
        description: 'A área de Dashboard já fica preparada para evoluir para visões comercial, pedagógica, financeira e operacional.',
      },
    ],
    recent_documents: (recentDocuments || []).slice(0, 6).map((document) => ({
      id: document.id,
      name: document.name,
      department_name: document.department_name || 'Geral',
      status: document.status || 'Processando',
      created_at: document.created_at || '',
    })),
    marketing_indicator: marketingIndicatorDashboard || null,
  };
}

function buildIntranetWorkspace({
  user,
  departments = [],
  recentDocuments = [],
  totalDocuments = 0,
  salesWorkspace = null,
  departmentDocumentTotals = [],
  marketingIndicatorDashboard = null,
  announcements = [],
  upcomingEvents = [],
  notifications = [],
}) {
  const departmentAreas = departments
    .map((department) => buildDepartmentWorkspace(department))
    .filter((department) => department.is_active !== false);
  const uniqueModules = [];
  const seenModuleKeys = new Set();
  const salesEnabled = Boolean(salesWorkspace?.enabled);
  const dashboardWorkspace = buildDashboardWorkspace({
    user,
    departmentAreas,
    totalDocuments,
    recentDocuments,
    salesWorkspace,
    departmentDocumentTotals,
    marketingIndicatorDashboard,
  });

  uniqueModules.push({
    key: 'agenda',
    title: 'Agenda e reuniões',
    description: 'Calendário corporativo com compromissos, participantes e histórico de alterações.',
    type: 'workspace',
    icon: 'calendar',
    department: 'Geral',
    department_slug: 'geral',
  });
  seenModuleKeys.add('geral:agenda');

  if (dashboardWorkspace.enabled) {
    uniqueModules.unshift({
      key: 'dashboard-geral',
      title: 'Dashboard / BI',
      description: 'Leitura executiva da operação com visão consolidada das áreas liberadas.',
      type: 'insight',
      icon: 'chart',
      department: 'Dashboard',
      department_slug: 'dashboard',
    });
    seenModuleKeys.add('dashboard:dashboard-geral');
  }

  for (const department of departmentAreas) {
    for (const module of department.modules || []) {
      const moduleKey = `${department.slug}:${module.key}`;
      if (seenModuleKeys.has(moduleKey)) continue;
      seenModuleKeys.add(moduleKey);
      uniqueModules.push({ ...module, department: department.name, department_slug: department.slug });
    }
  }

  if (salesEnabled) {
    uniqueModules.unshift({
      key: 'pipeline-closers',
      title: 'Pipeline de closers',
      description: 'Matrículas novas, acompanhamento operacional e visão por closer dentro da intranet.',
      type: 'workspace',
      icon: 'target',
      department: 'Comercial',
      department_slug: 'comercial',
    });
  }

  const updates = departmentAreas.slice(0, 3).map((department) => ({
    title: `${department.name} ativo`,
    description: department.description,
    label: `${department.modules.length} modulo(s)`,
  }));

  if (salesEnabled) {
    updates.unshift({
      title: 'Operação comercial integrada',
      description: 'Planilhas de matrículas podem entrar na intranet e seguir o acompanhamento com histórico, status e responsável.',
      label: `${Number(salesWorkspace?.summary?.total || 0)} matrícula(s)`,
    });
  }

  const quickLinks = [...INTRANET_HOME_TEMPLATE.quickLinks];
  if (dashboardWorkspace.enabled) {
    quickLinks.unshift({
      title: 'Dashboard / BI',
      description: 'Acompanhar indicadores e visões consolidadas da intranet.',
      routeKey: 'dashboard',
      style: 'primary',
    });
  }
  if (salesEnabled) {
    quickLinks.unshift({
      title: 'Painel comercial',
      description: 'Closers, matrículas e histórico de acompanhamento.',
      routeKey: 'sales',
      style: 'primary',
    });
  }

  const stats = [
    { label: 'Departamentos liberados', value: String(departmentAreas.length || 0) },
    { label: 'Módulos ativos', value: String(uniqueModules.length || 0) },
    { label: 'Documentos recentes', value: String(totalDocuments || 0) },
    { label: 'Comunicados ativos', value: String((announcements || []).length || 0) },
    { label: 'Próximas reuniões', value: String((upcomingEvents || []).length || 0) },
  ];
  if (salesEnabled) {
    stats.push(
      { label: 'Matrículas na operação', value: String(Number(salesWorkspace?.summary?.total || 0)) },
      { label: 'Closers vinculadas', value: String((salesWorkspace?.closers || []).length) },
    );
  }

  const mappedAnnouncements = (announcements || []).map((item) => mapAnnouncementForWorkspace(item, departmentAreas));
  const directionBoard = mappedAnnouncements
    .filter((item) => item.is_direction_highlight || item.is_pinned)
    .slice(0, 3);

  return {
    home: {
      ...INTRANET_HOME_TEMPLATE,
      quickLinks,
      stats,
      updates,
      communication_board: mappedAnnouncements.slice(0, 6),
      direction_board: directionBoard,
      upcoming_events: (upcomingEvents || []).slice(0, 6).map((item) => ({
        id: item.id,
        title: item.title || 'Compromisso',
        description: item.description || item.location || item.meeting_mode_label || '',
        start_at: item.start_at || '',
        start_date: item.start_date || '',
        meeting_mode_label: item.meeting_mode_label || item.meeting_mode || '',
      })),
      notifications: notifications || [],
    },
    dashboard: dashboardWorkspace,
    departments: departmentAreas,
    modules: uniqueModules,
    document_center: {
      total_documents: totalDocuments,
      recent_documents: recentDocuments,
      empty_state: 'Nenhum documento recente disponível para a central corporativa.',
    },
    communication: {
      mural: mappedAnnouncements,
    },
    admin: {
      can_manage: user?.role === 'admin',
      next_steps: [
        'Adicionar novos departamentos sem retrabalho grande.',
        'Liberar novos módulos e widgets por perfil.',
        'Evoluir a central de documentos com tags, favoritos e versionamento.',
      ],
    },
    notifications: notifications || [],
  };
}

module.exports = {
  DEPARTMENT_DEFINITIONS,
  DEPARTMENT_SUBMENU_DEFINITIONS,
  INTRANET_HOME_TEMPLATE,
  buildDepartmentSeedRows,
  buildDepartmentSubmenuSeedRows,
  buildDepartmentWorkspace,
  buildIntranetWorkspace,
  getDepartmentDefinitionByName,
  normalizeDepartmentKey,
  parseDepartmentMetadata,
  sanitizeDepartment,
  sanitizeDepartmentList,
};

