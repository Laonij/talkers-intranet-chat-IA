const { normalizeText, getModerationRefusal, normalizeLocaleCode } = require('./language');

const EDUCATIONAL_CONTEXT_RE = /\b(estudo|linguistic|linguistica|linguistico|academico|academica|historico|historica|traduz|translate|translation|traducao|traduccion|traduzione|meaning|significado|significa|etimologia|contexto|analise|analisar|debate|aula|professor|profesora|classroom|lesson|curso|explain|explique|explicar|resuma|resumen|riassunto)\b/i;
const HARMFUL_INSTRUCTION_RE = /\b(como fazer|how to|ensine|tutorial|instrucao|instruction|plan|planeje|roteiro|script|passo a passo|step by step|crie|gere|escreva|write|make|produza|melhore|improve|incentive|encourage|amea[cs]a|attack|kill|assassin|matar|bomb|arma|weapon|hack|porn|porno|sexual|erotic|violenc|racis|odio|hate|crime|fraud|golpe|coagir|extorquir)\b/i;

const CATEGORY_RULES = [
  {
    category: 'sexual_explicit',
    blockAlways: true,
    patterns: [
      /\b(pornografia|pornografico|pornographic|porno|porn)\b/i,
      /\b(conteudo sexual explicito|explicit sexual|erotic story|historia erotica|sexo explicito)\b/i,
      /\b(nudez explicita|explicit nudity|fetiche sexual|sexual fetish)\b/i,
      /\b(exploracao sexual|sexual exploitation|abuso sexual)\b/i,
    ],
  },
  {
    category: 'hate_or_racism',
    blockAlways: false,
    patterns: [
      /\b(racismo|racist|racista|hate speech|discurso de odio|odio racial)\b/i,
      /\b(supremacia branca|white supremacy|nazismo|nazista)\b/i,
      /\b(xingamento racista|racial slur|insulto racista)\b/i,
    ],
  },
  {
    category: 'extreme_violence',
    blockAlways: false,
    patterns: [
      /\b(assassinato|murder|kill someone|matar alguem|decapitar|desmembrar|torturar|torture)\b/i,
      /\b(violencia extrema|extreme violence|massacre|chacina|execucao)\b/i,
      /\b(ameaca de morte|death threat|ameacar matar)\b/i,
    ],
  },
  {
    category: 'crime_or_illegal',
    blockAlways: false,
    patterns: [
      /\b(cometer crime|commit a crime|fraude|golpe|extorsao|extortion|lavagem de dinheiro|money laundering)\b/i,
      /\b(fabricar bomba|build a bomb|fazer bomba|explosivo caseiro)\b/i,
      /\b(hackear|hack|invadir sistema|steal password|roubar senha)\b/i,
    ],
  },
  {
    category: 'harassment_or_threats',
    blockAlways: false,
    patterns: [
      /\b(ameacar|threaten|assediar|harass|chantagear|blackmail)\b/i,
      /\b(humilhar|humiliate|perseguir|stalk|stalking)\b/i,
    ],
  },
];

function evaluateEducationalModeration(text = '', options = {}) {
  const normalized = normalizeText(text);
  if (!normalized) {
    return { blocked: false, category: '', reason: '', message: '' };
  }

  const locale = normalizeLocaleCode(options.locale || 'pt-BR');
  const hasEducationalContext = EDUCATIONAL_CONTEXT_RE.test(text);
  const hasHarmfulInstruction = HARMFUL_INSTRUCTION_RE.test(text);

  for (const rule of CATEGORY_RULES) {
    const matched = rule.patterns.some((pattern) => pattern.test(text));
    if (!matched) continue;

    if (!rule.blockAlways && hasEducationalContext && !hasHarmfulInstruction) {
      return { blocked: false, category: '', reason: 'educational_exception', message: '' };
    }

    return {
      blocked: true,
      category: rule.category,
      reason: hasEducationalContext ? 'harmful_instruction' : 'unsafe_request',
      message: getModerationRefusal(locale),
    };
  }

  return { blocked: false, category: '', reason: '', message: '' };
}

module.exports = {
  evaluateEducationalModeration,
};
