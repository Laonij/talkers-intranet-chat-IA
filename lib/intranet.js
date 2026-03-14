const { normalizeText: normalizeLanguageText } = require('./language');

const DEPARTMENT_DEFINITIONS = [
  {
    slug: 'professor',
    name: 'Professor',
    icon: 'graduation',
    sortOrder: 10,
    description: 'Espaco para rotinas pedagogicas, materiais de aula e acompanhamento de turmas.',
    aliases: ['docente'],
    accessLevels: ['colaborador', 'coordenador', 'administrador'],
    modules: [
      { key: 'planejamentos', title: 'Planejamentos', description: 'Roteiros, sequencias didaticas e guias de aula.', type: 'documents' },
      { key: 'turmas', title: 'Turmas e acompanhamento', description: 'Visao de turmas, devolutivas e pontos de atencao.', type: 'workspace' },
      { key: 'comunicados', title: 'Comunicados escolares', description: 'Modelos de mensagens para alunos e familias.', type: 'assistant' },
    ],
  },
  {
    slug: 'administrativo',
    name: 'Administrativo',
    icon: 'briefcase',
    sortOrder: 20,
    description: 'Procedimentos operacionais, formularios internos e rotinas administrativas.',
    aliases: ['adm'],
    accessLevels: ['colaborador', 'gestor', 'administrador'],
    modules: [
      { key: 'procedimentos', title: 'Procedimentos', description: 'Passos, checklists e processos internos.', type: 'documents' },
      { key: 'formularios', title: 'Formularios', description: 'Solicitacoes recorrentes e modelos oficiais.', type: 'workspace' },
      { key: 'atendimento', title: 'Atendimento interno', description: 'Orientacoes para demandas de secretaria e suporte.', type: 'assistant' },
    ],
  },
  {
    slug: 'pedagogico',
    name: 'Pedagogico',
    icon: 'book-open',
    sortOrder: 30,
    description: 'Curadoria academica, trilhas de aprendizagem e qualidade pedagogica.',
    aliases: ['pedagógico'],
    accessLevels: ['colaborador', 'coordenador', 'administrador'],
    modules: [
      { key: 'curriculo', title: 'Curriculo e trilhas', description: 'Bases, planos, objetivos e referencias.', type: 'documents' },
      { key: 'avaliacoes', title: 'Avaliacoes', description: 'Matrizes, rubricas e diretrizes pedagogicas.', type: 'workspace' },
      { key: 'qualidade', title: 'Qualidade academica', description: 'Rotinas para melhoria continua do ensino.', type: 'insight' },
    ],
  },
  {
    slug: 'rh',
    name: 'RH',
    icon: 'users',
    sortOrder: 40,
    description: 'Onboarding, beneficios, politicas internas e comunicacao com colaboradores.',
    aliases: ['recursos humanos'],
    accessLevels: ['colaborador', 'gestor', 'administrador'],
    modules: [
      { key: 'beneficios', title: 'Beneficios', description: 'Guias, politicas e materiais para o colaborador.', type: 'documents' },
      { key: 'onboarding', title: 'Onboarding', description: 'Jornadas de entrada, trilhas e checklists.', type: 'workspace' },
      { key: 'pessoas', title: 'Comunicacao com pessoas', description: 'Avisos internos, comunicados e apoio com IA.', type: 'assistant' },
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
      { key: 'pipeline', title: 'Pipeline e operacao', description: 'Fluxos, processos e combinados do time.', type: 'workspace' },
      { key: 'copys', title: 'Mensagens e copys', description: 'Textos prontos e apoio persuasivo com IA.', type: 'assistant' },
    ],
  },
  {
    slug: 'gestao',
    name: 'Gestao',
    icon: 'chart',
    sortOrder: 60,
    description: 'Indicadores, priorizacao, comunicados de lideranca e acompanhamento executivo.',
    aliases: ['gestão', 'lideranca', 'liderança'],
    accessLevels: ['gestor', 'diretoria', 'administrador'],
    modules: [
      { key: 'indicadores', title: 'Indicadores', description: 'Visao de metas, ritos e performance.', type: 'insight' },
      { key: 'planos', title: 'Planos de acao', description: 'Prioridades, metas e acompanhamentos.', type: 'workspace' },
      { key: 'comunicacao', title: 'Comunicacao de lideranca', description: 'Mensagens executivas e alinhamentos.', type: 'assistant' },
    ],
  },
  {
    slug: 'dashboard',
    name: 'Dashboard',
    icon: 'chart',
    sortOrder: 65,
    description: 'Indicadores, BI interno e visao consolidada da operacao da escola.',
    aliases: ['bi', 'indicadores', 'power bi'],
    accessLevels: ['analista', 'gestor', 'administrador'],
    modules: [
      { key: 'painel-geral', title: 'Painel geral', description: 'Kpis, visoes consolidadas e leitura executiva da escola.', type: 'insight' },
      { key: 'dashboards-setoriais', title: 'Dashboards por setor', description: 'Estrutura para expandir BI comercial, pedagogico, financeiro e operacional.', type: 'workspace' },
      { key: 'analises', title: 'Analises e leituras', description: 'Apoio da IA para interpretar indicadores e apontar oportunidades.', type: 'assistant' },
    ],
  },
  {
    slug: 'financeiro',
    name: 'Financeiro',
    icon: 'wallet',
    sortOrder: 70,
    description: 'Relatorios, planilhas, procedimentos e materiais de controle financeiro.',
    aliases: ['financas', 'finanças'],
    accessLevels: ['analista', 'gestor', 'administrador'],
    modules: [
      { key: 'relatorios', title: 'Relatorios e planilhas', description: 'Arquivos-base, modelos e rotinas do setor.', type: 'documents' },
      { key: 'pagamentos', title: 'Pagamentos e aprovacoes', description: 'Fluxos e procedimentos internos.', type: 'workspace' },
      { key: 'analises', title: 'Analises com IA', description: 'Apoio para resumos e interpretacao financeira.', type: 'assistant' },
    ],
  },
  {
    slug: 'marketing',
    name: 'Marketing',
    icon: 'megaphone',
    sortOrder: 80,
    description: 'Calendario de campanhas, brand book, assets e comunicacao da marca.',
    aliases: [],
    accessLevels: ['colaborador', 'gestor', 'administrador'],
    modules: [
      { key: 'brandbook', title: 'Brand book', description: 'Tom de voz, identidade e diretrizes da marca.', type: 'documents' },
      { key: 'campanhas', title: 'Campanhas', description: 'Calendario, pautas e acompanhamento.', type: 'workspace' },
      { key: 'assets', title: 'Assets e criacao', description: 'Pecas, materiais e apoio criativo com IA.', type: 'assistant' },
    ],
  },
  {
    slug: 'ti',
    name: 'TI',
    icon: 'shield',
    sortOrder: 90,
    description: 'Sistemas internos, acessos, documentacao tecnica e status operacional.',
    aliases: ['tecnologia'],
    accessLevels: ['colaborador', 'admin tecnico'],
    modules: [
      { key: 'documentacao', title: 'Documentacao tecnica', description: 'Guias, acessos, infra e sistemas.', type: 'documents' },
      { key: 'suporte', title: 'Suporte e acessos', description: 'Procedimentos, checklists e orientacoes.', type: 'workspace' },
      { key: 'status', title: 'Status operacional', description: 'Visao de estabilidade e atualizacoes criticas.', type: 'insight' },
    ],
  },
  {
    slug: 'juridico',
    name: 'Juridico',
    icon: 'scale',
    sortOrder: 100,
    description: 'Contratos, politicas, compliance e documentos legais da empresa.',
    aliases: ['jurídico', 'legal'],
    accessLevels: ['colaborador', 'gestor', 'administrador'],
    modules: [
      { key: 'contratos', title: 'Contratos e minutas', description: 'Bases legais e modelos oficiais.', type: 'documents' },
      { key: 'compliance', title: 'Compliance', description: 'Politicas, guias e orientacoes de conformidade.', type: 'workspace' },
      { key: 'pareceres', title: 'Pareceres com IA', description: 'Apoio para localizar clausulas e resumir materiais.', type: 'assistant' },
    ],
  },
  {
    slug: 'operacoes',
    name: 'Operacoes',
    icon: 'layers',
    sortOrder: 110,
    description: 'Fluxos operacionais, governanca, SLAs e acompanhamento do dia a dia.',
    aliases: ['operações', 'operacao', 'operação'],
    accessLevels: ['colaborador', 'gestor', 'administrador'],
    modules: [
      { key: 'rotinas', title: 'Rotinas e SLAs', description: 'Acordos operacionais, ritos e checklists.', type: 'documents' },
      { key: 'execucao', title: 'Execucao', description: 'Fluxos internos e alinhamentos do time.', type: 'workspace' },
      { key: 'gargalos', title: 'Gargalos e melhorias', description: 'Analise operacional com apoio da IA.', type: 'assistant' },
    ],
  },
  {
    slug: 'produto',
    name: 'Produto',
    icon: 'sparkles',
    sortOrder: 120,
    description: 'Roadmap, discovery, especificacoes e evolucao dos produtos internos.',
    aliases: [],
    accessLevels: ['colaborador', 'gestor', 'administrador'],
    modules: [
      { key: 'roadmap', title: 'Roadmap', description: 'Priorizacao, backlog e objetivos.', type: 'workspace' },
      { key: 'descoberta', title: 'Discovery', description: 'Pesquisas, aprendizados e hipoteses.', type: 'documents' },
      { key: 'especificacoes', title: 'Especificacoes', description: 'Apoio para escrever requisitos e refinamentos.', type: 'assistant' },
    ],
  },
  {
    slug: 'atendimento',
    name: 'Atendimento',
    icon: 'message',
    sortOrder: 130,
    description: 'Scripts, politicas de atendimento, guias de resposta e escala de suporte.',
    aliases: ['suporte'],
    accessLevels: ['colaborador', 'gestor', 'administrador'],
    modules: [
      { key: 'scripts', title: 'Scripts e respostas', description: 'Mensagens padrao e orientacoes para contato.', type: 'documents' },
      { key: 'fila', title: 'Fila e operacao', description: 'Fluxos de atendimento e combinados do time.', type: 'workspace' },
      { key: 'ajuda-ia', title: 'Apoio da IA', description: 'Resumos de contexto e reescrita de respostas.', type: 'assistant' },
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
  heroDescription: 'Um hub interno para documentos, comunicados, atalhos e apoio da IA por departamento.',
  quickLinks: [
    { key: 'chat', title: 'Abrir chat IA', description: 'Voltar para o assistente com contexto corporativo.', href: '/index.html', style: 'primary' },
    { key: 'calendar', title: 'Agenda e calendario', description: 'Visualizar reunioes, compromissos e eventos internos.', anchor: '#calendar' },
    { key: 'docs', title: 'Central de documentos', description: 'Encontrar materiais internos e arquivos recentes.', anchor: '#documents' },
    { key: 'mural', title: 'Mural interno', description: 'Acompanhar comunicados e atualizacoes da empresa.', anchor: '#communication' },
  ],
  highlights: [
    'Base pronta para crescer com novos modulos.',
    'Permissoes separadas por acesso e departamento.',
    'IA corporativa integrada para busca e apoio operacional.',
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
    ? 'Direcao'
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
    { key: 'documentos', title: `Documentos de ${safeName}`, description: 'Materiais internos, politicas e documentos da area.', type: 'documents' },
    { key: 'rotinas', title: `Rotinas de ${safeName}`, description: 'Fluxos, processos e combinados operacionais do setor.', type: 'workspace' },
    { key: 'assistente', title: `Assistente de ${safeName}`, description: 'Apoio da IA para duvidas, resumos e demandas do departamento.', type: 'assistant' },
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
        label: 'Departamentos visiveis',
        value: String(departmentCount),
        description: user?.role === 'admin' ? 'Visao administrativa total da intranet.' : 'Areas realmente liberadas para este perfil.',
      },
      {
        label: 'Modulos ativos',
        value: String(moduleTotal),
        description: 'Atalhos, workspaces e assistentes disponiveis agora.',
      },
      {
        label: 'Documentos acessiveis',
        value: String(totalDocuments),
        description: `${recentAvailable} arquivo(s) recentes ja disponiveis para IA.`,
      },
      {
        label: 'Operacao comercial',
        value: String(Number(salesWorkspace?.summary?.total || 0)),
        description: salesWorkspace?.enabled
          ? 'Matriculas e operacao comercial dentro do recorte permitido.'
          : 'Painel comercial nao liberado para este perfil no momento.',
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
        title: 'Leitura executiva rapida',
        description: user?.role === 'admin'
          ? 'Como admin, voce acompanha toda a intranet e pode navegar por qualquer area sem restricao.'
          : 'Este painel concentra os indicadores das areas e modulos realmente liberados para o seu perfil.',
      },
      {
        title: 'Base documental viva',
        description: totalDocuments
          ? `A intranet ja expõe ${totalDocuments} documento(s) acessiveis para consulta, contexto e apoio da IA.`
          : 'A base documental ainda pode crescer com novos arquivos e departamentos.',
      },
      {
        title: 'Estrutura pronta para BI setorial',
        description: 'A area de Dashboard ja fica preparada para evoluir para visoes comercial, pedagogica, financeira e operacional.',
      },
    ],
    recent_documents: (recentDocuments || []).slice(0, 6).map((document) => ({
      id: document.id,
      name: document.name,
      department_name: document.department_name || 'Geral',
      status: document.status || 'Processando',
      created_at: document.created_at || '',
    })),
  };
}

function buildIntranetWorkspace({
  user,
  departments = [],
  recentDocuments = [],
  totalDocuments = 0,
  salesWorkspace = null,
  departmentDocumentTotals = [],
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
  });

  uniqueModules.push({
    key: 'agenda',
    title: 'Agenda e reunioes',
    description: 'Calendario corporativo com compromissos, participantes e historico de alteracoes.',
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
      description: 'Leitura executiva da operacao com visao consolidada das areas liberadas.',
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
      description: 'Matriculas novas, acompanhamento operacional e visao por closer dentro da intranet.',
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
      title: 'Operacao comercial integrada',
      description: 'Planilhas de matriculas podem entrar na intranet e seguir o acompanhamento com historico, status e responsavel.',
      label: `${Number(salesWorkspace?.summary?.total || 0)} matricula(s)`,
    });
  }

  const quickLinks = [...INTRANET_HOME_TEMPLATE.quickLinks];
  if (dashboardWorkspace.enabled) {
    quickLinks.unshift({
      title: 'Dashboard / BI',
      description: 'Acompanhar indicadores e visoes consolidadas da intranet.',
      routeKey: 'dashboard',
      style: 'primary',
    });
  }
  if (salesEnabled) {
    quickLinks.unshift({
      title: 'Painel comercial',
      description: 'Closers, matriculas e historico de acompanhamento.',
      routeKey: 'sales',
      style: 'primary',
    });
  }

  const stats = [
    { label: 'Departamentos liberados', value: String(departmentAreas.length || 0) },
    { label: 'Modulos ativos', value: String(uniqueModules.length || 0) },
    { label: 'Documentos recentes', value: String(totalDocuments || 0) },
    { label: 'Comunicados ativos', value: String((announcements || []).length || 0) },
    { label: 'Proximas reunioes', value: String((upcomingEvents || []).length || 0) },
  ];
  if (salesEnabled) {
    stats.push(
      { label: 'Matriculas na operacao', value: String(Number(salesWorkspace?.summary?.total || 0)) },
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
      empty_state: 'Nenhum documento recente disponivel para a central corporativa.',
    },
    communication: {
      mural: mappedAnnouncements,
    },
    admin: {
      can_manage: user?.role === 'admin',
      next_steps: [
        'Adicionar novos departamentos sem retrabalho grande.',
        'Liberar novos modulos e widgets por perfil.',
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
