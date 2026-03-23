const SCHOOL_CONTEXT = {
  companyName: "Talkers",
  sector: "escola de idiomas",
  channels: ["presencial", "online", "comercial", "pedagogico", "administrativo"],
};

const BUSINESS_AREAS = [
  {
    key: "general",
    label: "Geral",
    description: "Perguntas amplas, explicativas ou de uso geral sem contexto institucional claro.",
    terms: /\b(nadaespecifico)\b/i,
  },
  {
    key: "commercial",
    label: "Comercial",
    description: "Captacao, atendimento comercial, follow-up, negociacao, matricula e rematricula.",
    terms: /\b(lead|leads|follow-?up|matricul|rematricul|venda|vendas|curso|cursos|comercial|obje[cç][aã]o|convers[aã]o|negocia[cç][aã]o|whatsapp|script de venda|campanha comercial|capta[cç][aã]o)\b/i,
  },
  {
    key: "student_care",
    label: "Atendimento ao aluno",
    description: "Relacionamento com aluno e responsaveis, suporte e comunicacao operacional.",
    terms: /\b(aluno|alunos|respons[aá]vel|responsaveis|suporte|atendimento|secretaria|aviso|comunicado|fam[ií]lia|duvida do aluno|falta|reposi[cç][aã]o)\b/i,
  },
  {
    key: "pedagogical",
    label: "Pedagogico",
    description: "Turmas, professores, coordenacao, aulas e materiais didaticos.",
    terms: /\b(turma|turmas|professor|professora|professores|coordena[cç][aã]o|pedag[oó]gic|aula|aulas|material did[aá]tico|plano de aula|avalia[cç][aã]o|presencial|online)\b/i,
  },
  {
    key: "administrative",
    label: "Administrativo",
    description: "Processos internos, documentos administrativos, contratos e rotina operacional.",
    terms: /\b(administrativ|processo interno|procedimento|contrato|documento interno|rotina|formul[aá]rio|opera[cç][aã]o|intranet)\b/i,
  },
  {
    key: "financial",
    label: "Financeiro",
    description: "Cobranca, pagamentos, inadimplencia, relatorios e controle financeiro.",
    terms: /\b(cobran[cç]a|boleto|pagamento|inadimpl[eê]ncia|financeir|caixa|fluxo de caixa|parcelamento|relat[oó]rio financeiro)\b/i,
  },
  {
    key: "marketing",
    label: "Marketing",
    description: "Campanhas, posicionamento, marca e comunicacao institucional.",
    terms: /\b(marketing|campanha|campanhas|brand|posicionamento|conte[uú]do|an[uú]ncio|social media|trafego|copy|criativo)\b/i,
  },
  {
    key: "market_research",
    label: "Pesquisa de mercado",
    description: "Concorrentes, benchmarking, tendencias e expansao.",
    terms: /\b(mercado|benchmark|concorrent|tend[eê]ncia|tendencias|pesquisa de mercado|posicionamento|benchmarking|expans[aã]o|oportunidade|risco|estrat[eé]gic)\b/i,
  },
];

const INTENT_RULES = [
  { key: "translation", terms: /\b(traduz|tradu[zç][aã]o|translate|translation|traduc|traduzione)\b/i },
  { key: "summary", terms: /\b(resuma|resumo|summary|summarize|resumen|riassunto)\b/i },
  { key: "rewrite", terms: /\b(melhore|reescreva|rewrite|rephrase|ajuste|corrija|refa[cç]a|formate|organize)\b/i },
  { key: "step_by_step", terms: /\b(passo a passo|step by step|como fazer|how to|guia|tutorial|procedimento)\b/i },
  { key: "document_generation", terms: /\b(documento|comunicado|relat[oó]rio|ata|proposta|apresenta[cç][aã]o|planilha|arquivo|pdf|docx|xlsx|pptx)\b/i },
  { key: "image_edit", terms: /\b(imagem|foto|banner|arte|remova|remover fundo|alinhe|ajuste a imagem|edite a imagem)\b/i },
  { key: "market_research", terms: /\b(pesquisa de mercado|benchmark|concorrent|tend[eê]ncia|mercado educacional|mercado de idiomas)\b/i },
  { key: "operational_question", terms: /\b(como|qual|quais|quando|onde|processo|pol[ií]tica|procedimento|regra)\b/i },
];

const DEPARTMENT_LENSES = {
  comercial: "Priorize conversao, follow-up, clareza comercial, objecoes, urgencia saudavel e proximos passos.",
  atendimento: "Priorize acolhimento, clareza, resolucao e comunicacao simples para aluno e responsaveis.",
  pedagogico: "Priorize qualidade academica, experiencia de aprendizagem, rotina de turma e coerencia pedagogica.",
  administrativo: "Priorize processos internos, padronizacao, governanca e rastreabilidade.",
  financeiro: "Priorize impacto financeiro, compliance interno, prazos, cobranca e clareza operacional.",
  marketing: "Priorize posicionamento, clareza de mensagem, campanha e percepcao de valor.",
  rh: "Priorize politica interna, pessoas, onboarding, comunicacao clara e consistencia institucional.",
};

function normalizeBusinessText(value = "") {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function looksInstitutionalQuery(text = "") {
  const normalized = normalizeBusinessText(text);
  if (!normalized) return false;
  return /\b(talkers|intranet|departamento|departamentos|processo interno|procedimento interno|politica interna|unidade|unidades|matricula|rematricula|aluno|alunos|professor|professores|pedagogico|pedagogica|comercial da talkers|marketing da talkers|base interna|documento interno|whatsapp pedagogico|contato da talkers|curso da talkers|cursos da talkers|metodologia da talkers)\b/i.test(normalized);
}

function detectBusinessArea(text = "", departments = [], options = {}) {
  const normalized = normalizeBusinessText(text);
  const explicit = BUSINESS_AREAS.find((item) => item.terms.test(normalized) && item.key !== "general");
  if (explicit) return explicit;

  const safeOptions = options && typeof options === "object" ? options : {};
  const allowDepartmentFallback = Boolean(safeOptions.forceInstitutionalContext || looksInstitutionalQuery(normalized));
  if (!allowDepartmentFallback) {
    return BUSINESS_AREAS.find((item) => item.key === "general");
  }

  const departmentTerms = toArray(departments).map((item) => normalizeBusinessText(item));
  if (departmentTerms.some((item) => item.includes("comercial"))) return BUSINESS_AREAS.find((item) => item.key === "commercial");
  if (departmentTerms.some((item) => item.includes("pedagog"))) return BUSINESS_AREAS.find((item) => item.key === "pedagogical");
  if (departmentTerms.some((item) => item.includes("atendimento"))) return BUSINESS_AREAS.find((item) => item.key === "student_care");
  if (departmentTerms.some((item) => item.includes("financeir"))) return BUSINESS_AREAS.find((item) => item.key === "financial");
  if (departmentTerms.some((item) => item.includes("marketing"))) return BUSINESS_AREAS.find((item) => item.key === "marketing");
  return BUSINESS_AREAS.find((item) => item.key === "administrative") || BUSINESS_AREAS.find((item) => item.key === "general");
}

function detectIntentType(text = "") {
  const normalized = normalizeBusinessText(text);
  for (const rule of INTENT_RULES) {
    if (rule.terms.test(normalized)) return rule.key;
  }
  return "general_assistance";
}

function buildSectionsForIntent(intentType, areaKey) {
  const sections = [];
  if (intentType === "step_by_step" || intentType === "operational_question") {
    sections.push("contexto", "passo_a_passo", "boas_praticas", "alertas");
  }
  if (intentType === "rewrite") {
    sections.push("diagnostico", "versao_sugerida", "melhorias");
  }
  if (intentType === "translation") {
    sections.push("traducao");
  }
  if (intentType === "summary") {
    sections.push("resumo", "pontos_principais", "acoes_recomendadas");
  }
  if (intentType === "document_generation") {
    sections.push("objetivo", "versao_final", "observacoes");
  }
  if (intentType === "market_research") {
    sections.push("cenario", "achados", "riscos", "oportunidades", "recomendacoes");
  }
  if (areaKey === "commercial") {
    sections.push("abordagem", "texto_pronto", "proximo_passo");
  }
  return [...new Set(sections)];
}

function detectPreferredDepth(text = "", intentType = "general_assistance") {
  const normalized = normalizeBusinessText(text);
  if (/\b(resposta curta|bem curto|objetivo|resuma em 1 linha|one line|brief)\b/i.test(normalized)) return "compact";
  if (/\b(completo|completa|detalhado|detalhada|profundo|profunda|estrategico|estrategica|com exemplos)\b/i.test(normalized)) return "deep";
  if (["market_research", "step_by_step", "document_generation"].includes(intentType)) return "deep";
  return "balanced";
}

function buildDepartmentLens(departments = []) {
  const parts = [];
  for (const department of toArray(departments)) {
    const key = normalizeBusinessText(department);
    const lens = Object.entries(DEPARTMENT_LENSES).find(([candidate]) => key.includes(candidate));
    if (lens) parts.push(lens[1]);
  }
  return [...new Set(parts)];
}

function buildBusinessContextBlock({ user = {}, businessIntent, userLanguageLabel = "Portugues" }) {
  if (!businessIntent?.useInstitutionalContext) {
    return `
Contexto da resposta:
- Modo padrao: assistente generalista.
- Nunca presumir contexto institucional sem evidencia explicita no pedido, nos arquivos da conversa ou na base recuperada.
- So usar a base da Talkers quando a pergunta mencionar a empresa, envolver conteudo interno ou houver alta relevancia documental.

Perfil do usuario:
- Nome: ${user.name || "Usuario"}
- Idioma da conversa: ${userLanguageLabel}

Contexto operacional detectado:
- Area principal: ${businessIntent?.businessAreaLabel || "Geral"}
- Tipo de intencao: ${businessIntent?.intentTypeLabel || "General Assistance"}
- Profundidade sugerida: ${businessIntent?.responseDepth || "balanced"}
- Priorizar base institucional: nao
`.trim();
  }

  const departments = toArray(user.departments || []).join(", ") || "Sem departamento definido";
  const lens = buildDepartmentLens(user.departments || []);
  const lensText = lens.length ? `\nLentes do perfil do usuario:\n- ${lens.join("\n- ")}` : "";

  return `
Contexto do negocio:
- Empresa: ${SCHOOL_CONTEXT.companyName}
- Segmento: ${SCHOOL_CONTEXT.sector}
- Operacao principal: aulas presenciais, aulas online, atendimento ao aluno, comercial, marketing educacional e operacao administrativa.
- Resposta atual deve considerar esse contexto apenas porque a pergunta indicou relevancia institucional clara.

Perfil do usuario:
- Nome: ${user.name || "Usuario"}
- Cargo: ${user.job_title || "Nao informado"}
- Departamentos: ${departments}
- Idioma da conversa: ${userLanguageLabel}

Contexto operacional detectado:
- Area principal: ${businessIntent.businessAreaLabel}
- Tipo de intencao: ${businessIntent.intentTypeLabel}
- Profundidade sugerida: ${businessIntent.responseDepth}
- Priorizar base interna: ${businessIntent.preferInternalKnowledge ? "sim" : "nao"}
- Sugerir exemplos e texto pronto: ${businessIntent.includeReadyToUse ? "sim" : "nao"}
${lensText}
`.trim();
}

function buildBusinessInstructions(businessIntent) {
  const lines = businessIntent?.useInstitutionalContext
    ? [
        "- Interprete a pergunta como parte de uma operacao real da empresa somente porque houve evidencia institucional no pedido.",
        "- Entregue resposta aplicada ao contexto, com linguagem util para execucao no dia a dia.",
      ]
    : [
        "- Interprete a pergunta primeiro como uma solicitacao geral, sem presumir contexto institucional.",
        "- So traga contexto da empresa se o usuario mencionar a Talkers, usar material interno ou se a recuperacao documental indicar alta relevancia institucional.",
        "- Se houver anexo e uma acao executavel for possivel, priorize executar em vez de apenas orientar.",
      ];

  if (businessIntent?.preferInternalKnowledge) {
    lines.push("- Priorize documentos internos, procedimentos, intranet e materiais da empresa antes de responder com conhecimento generico.");
  }
  if (businessIntent?.needsMarketResearch) {
    lines.push("- Se usar contexto externo, organize a resposta como analise de mercado com achados, oportunidades, riscos e recomendacoes.");
  }
  if (businessIntent?.includeReadyToUse) {
    lines.push("- Sempre que fizer sentido, inclua texto pronto para copiar, exemplos reais de uso e proximo passo recomendado.");
  }
  if (businessIntent?.sections?.length) {
    lines.push(`- Estruture a resposta cobrindo, quando fizer sentido: ${businessIntent.sections.join(", ")}.`);
  }
  if (businessIntent?.businessAreaKey === "commercial") {
    lines.push("- Em temas comerciais, ajude com conversao, follow-up, objecoes, valor percebido e chamada para acao.");
  }
  if (businessIntent?.businessAreaKey === "pedagogical") {
    lines.push("- Em temas pedagogicos, preserve clareza academica, experiencia do aluno e coerencia de ensino.");
  }
  return lines.join("\n");
}

function analyzeBusinessIntent(text = "", options = {}) {
  const departments = toArray(options.departments || []);
  const useInstitutionalContext = looksInstitutionalQuery(text) || Boolean(options.forceInstitutionalContext);
  const area = detectBusinessArea(text, departments, { forceInstitutionalContext: useInstitutionalContext });
  const intentType = detectIntentType(text);
  const responseDepth = detectPreferredDepth(text, intentType);
  const businessAreaKey = area?.key || "general";

  return {
    intentType,
    intentTypeLabel: intentType.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase()),
    businessAreaKey,
    businessAreaLabel: area?.label || "Geral",
    responseDepth,
    useInstitutionalContext,
    preferInternalKnowledge: useInstitutionalContext && businessAreaKey !== "market_research",
    needsMarketResearch: intentType === "market_research" || businessAreaKey === "market_research",
    includeReadyToUse: ["commercial", "student_care", "marketing"].includes(businessAreaKey) || ["rewrite", "document_generation"].includes(intentType),
    sections: buildSectionsForIntent(intentType, businessAreaKey),
  };
}

module.exports = {
  BUSINESS_AREAS,
  SCHOOL_CONTEXT,
  analyzeBusinessIntent,
  buildBusinessContextBlock,
  buildBusinessInstructions,
  normalizeBusinessText,
};
