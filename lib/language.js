const KNOWN_TEXT_REPAIRS = [
  ["operaÃ¯Â¿Â½Ã¯Â¿Â½o", "operação"],
  ["OperaÃ¯Â¿Â½Ã¯Â¿Â½o", "Operação"],
  ["operaï¿½ï¿½o", "operação"],
  ["Operaï¿½ï¿½o", "Operação"],
  ["opera��o", "operação"],
  ["Opera��o", "Operação"],
  ["visÃ¯Â¿Â½o", "visão"],
  ["VisÃ¯Â¿Â½o", "Visão"],
  ["visï¿½o", "visão"],
  ["Visï¿½o", "Visão"],
  ["vis�o", "visão"],
  ["Vis�o", "Visão"],
  ["Ã¯Â¿Â½rea", "Área"],
  ["Ã¯Â¿Â½reas", "Áreas"],
  ["ï¿½rea", "Área"],
  ["ï¿½reas", "Áreas"],
  ["�rea", "Área"],
  ["�reas", "Áreas"],
  ["mÃ¯Â¿Â½dulo", "módulo"],
  ["mÃ¯Â¿Â½dulos", "módulos"],
  ["MÃ¯Â¿Â½dulo", "Módulo"],
  ["MÃ¯Â¿Â½dulos", "Módulos"],
  ["mï¿½dulo", "módulo"],
  ["mï¿½dulos", "módulos"],
  ["Mï¿½dulo", "Módulo"],
  ["Mï¿½dulos", "Módulos"],
  ["m�dulo", "módulo"],
  ["m�dulos", "módulos"],
  ["M�dulo", "Módulo"],
  ["M�dulos", "Módulos"],
  ["MÃƒÆ’Ã‚Âªs", "Mês"],
  ["mÃƒÆ’Ã‚Âªs", "mês"],
  ["MÃƒÂªs", "Mês"],
  ["mÃƒÂªs", "mês"],
  ["MÃªs", "Mês"],
  ["mÃªs", "mês"],
  ["TÃƒÆ’Ã‚Â­tulo", "Título"],
  ["tÃƒÆ’Ã‚Â­tulo", "título"],
  ["TÃƒÂ­tulo", "Título"],
  ["tÃƒÂ­tulo", "título"],
  ["TÃ­tulo", "Título"],
  ["tÃ­tulo", "título"],
  ["DescriÃƒÆ’Ã‚Â§ÃƒÆ’Ã‚Â£o", "Descrição"],
  ["descriÃƒÆ’Ã‚Â§ÃƒÆ’Ã‚Â£o", "descrição"],
  ["DescriÃƒÂ§ÃƒÂ£o", "Descrição"],
  ["descriÃƒÂ§ÃƒÂ£o", "descrição"],
  ["DescriÃ§Ã£o", "Descrição"],
  ["descriÃ§Ã£o", "descrição"],
  ["Descri��o", "Descrição"],
  ["descri��o", "descrição"],
  ["T�tulo", "Título"],
  ["t�tulo", "título"],
  ["DireÃƒÆ’Ã‚Â§ÃƒÆ’Ã‚Â£o", "Direção"],
  ["direÃƒÆ’Ã‚Â§ÃƒÆ’Ã‚Â£o", "direção"],
  ["DireÃƒÂ§ÃƒÂ£o", "Direção"],
  ["direÃƒÂ§ÃƒÂ£o", "direção"],
  ["DireÃ§Ã£o", "Direção"],
  ["direÃ§Ã£o", "direção"],
  ["UsuÃƒÂ¡rio", "Usuário"],
  ["usuÃƒÂ¡rio", "usuário"],
  ["UsuÃ¡rio", "Usuário"],
  ["usuÃ¡rio", "usuário"],
  ["LatÃƒÂªncia", "Latência"],
  ["latÃƒÂªncia", "latência"],
  ["LatÃªncia", "Latência"],
  ["latÃªncia", "latência"],
  ["MemÃƒÂ³ria", "Memória"],
  ["memÃƒÂ³ria", "memória"],
  ["MemÃ³ria", "Memória"],
  ["memÃ³ria", "memória"],
  ["AtenÃƒÂ§ÃƒÂ£o", "Atenção"],
  ["atenÃƒÂ§ÃƒÂ£o", "atenção"],
  ["AtenÃ§Ã£o", "Atenção"],
  ["atenÃ§Ã£o", "atenção"],
  ["cotaï¿½ï¿½o", "cotação"],
  ["Cotaï¿½ï¿½o", "Cotação"],
  ["cota��o", "cotação"],
  ["Cota��o", "Cotação"],
  ["relaï¿½ï¿½o", "relação"],
  ["Relaï¿½ï¿½o", "Relação"],
  ["rela��o", "relação"],
  ["Rela��o", "Relação"],
  ["econï¿½micos", "econômicos"],
  ["Econï¿½micos", "Econômicos"],
  ["econ�micos", "econômicos"],
  ["Econ�micos", "Econômicos"],
  ["polï¿½ticos", "políticos"],
  ["Polï¿½ticos", "Políticos"],
  ["pol�ticos", "políticos"],
  ["Pol�ticos", "Políticos"],
  ["cï¿½mbio", "câmbio"],
  ["Cï¿½mbio", "Câmbio"],
  ["c�mbio", "câmbio"],
  ["C�mbio", "Câmbio"],
  ["instituiï¿½ï¿½es", "instituições"],
  ["Instituiï¿½ï¿½es", "Instituições"],
  ["institui��es", "instituições"],
  ["Institui��es", "Instituições"],
  ["confiï¿½veis", "confiáveis"],
  ["Confiï¿½veis", "Confiáveis"],
  ["confi�veis", "confiáveis"],
  ["Confi�veis", "Confiáveis"],
  ["informaï¿½ï¿½es", "informações"],
  ["Informaï¿½ï¿½es", "Informações"],
  ["informa��es", "informações"],
  ["Informa��es", "Informações"],
  ["dï¿½lar", "dólar"],
  ["Dï¿½lar", "Dólar"],
  ["d�lar", "dólar"],
  ["D�lar", "Dólar"],
  ["est�", "está"],
  ["Est�", "Está"],
  ["convers�o", "conversão"],
  ["Convers�o", "Conversão"],
  ["Observa��es", "Observações"],
  ["observa��es", "observações"],
  ["cart�o", "cartão"],
  ["Cart�o", "Cartão"],
  ["at�", "até"],
  ["At�", "Até"],
  ["n�o", "não"],
  ["N�o", "Não"],
  ["tamb�m", "também"],
  ["Tamb�m", "Também"],
  ["R$�", "R$ "],
];

function applyKnownTextRepairs(value = "") {
  let repaired = String(value ?? "");
  KNOWN_TEXT_REPAIRS.forEach(([pattern, replacement]) => {
    repaired = repaired.split(pattern).join(replacement);
  });
  return repaired
    .replace(/\u00a0/g, " ")
    .replace(/\u202f/g, " ");
}

function countCorruptionSignals(value = "") {
  const safe = String(value ?? "");
  if (!safe) return 0;
  const matches = safe.match(/[ÃÂâ€™â€œâ€â€“â€”ï¿½�]/g);
  const replacementCount = (safe.match(/�/g) || []).length;
  return Number(matches?.length || 0) + replacementCount;
}

function repairMojibakeText(value = "") {
  const safeValue = String(value ?? "");
  if (!safeValue) return "";

  let repaired = safeValue;
  if (/[ÃÂâ€™â€œâ€â€“â€”ï¿½�]/.test(safeValue)) {
    for (let index = 0; index < 2; index += 1) {
      try {
        const candidate = decodeURIComponent(escape(repaired));
        if (
          candidate
          && candidate !== repaired
          && countCorruptionSignals(candidate) <= countCorruptionSignals(repaired)
        ) {
          repaired = candidate;
          continue;
        }
      } catch {}

      try {
        const candidate = Buffer.from(repaired, "latin1").toString("utf8");
        if (
          candidate
          && candidate !== repaired
          && countCorruptionSignals(candidate) <= countCorruptionSignals(repaired)
        ) {
          repaired = candidate;
          continue;
        }
      } catch {}

      break;
    }
  }

  return applyKnownTextRepairs(repaired);
}

function repairDeepStrings(value) {
  if (Array.isArray(value)) return value.map(repairDeepStrings);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, nested]) => [key, repairDeepStrings(nested)])
    );
  }
  return typeof value === "string" ? repairMojibakeText(value) : value;
}

const DEFAULT_LOCALE = "pt-BR";

const LOCALE_PROFILES = repairDeepStrings({
  "pt-BR": {
    language: "pt",
    label: "Português (Brasil)",
    shortLabel: "Português",
    stopwords: ["de", "da", "do", "que", "para", "com", "uma", "como", "por", "nao", "mais", "isso", "essa", "voce", "voces", "ajuda", "arquivo", "documento"],
    greetings: {
      morning: "Bom dia",
      afternoon: "Boa tarde",
      evening: "Boa noite",
      daily: "Oi {{name}}, como posso te ajudar? {{greeting}}.",
    },
    moderationRefusal: "Não posso ajudar com esse tipo de solicitação. Esta plataforma é voltada para educação e aprendizado de idiomas.",
  },
  en: {
    language: "en",
    label: "English",
    shortLabel: "English",
    stopwords: ["the", "and", "for", "with", "that", "this", "you", "your", "please", "about", "file", "document", "help", "what", "how"],
    greetings: {
      morning: "Good morning",
      afternoon: "Good afternoon",
      evening: "Good evening",
      daily: "Hi {{name}}, how can I help you? {{greeting}}.",
    },
    moderationRefusal: "I cannot help with that type of request. This platform is intended for education and language learning.",
  },
  es: {
    language: "es",
    label: "Español",
    shortLabel: "Español",
    stopwords: ["que", "para", "con", "una", "como", "por", "esto", "esta", "usted", "ustedes", "archivo", "documento", "ayuda", "hola", "gracias"],
    greetings: {
      morning: "Buenos días",
      afternoon: "Buenas tardes",
      evening: "Buenas noches",
      daily: "Hola {{name}}, ¿cómo puedo ayudarte? {{greeting}}.",
    },
    moderationRefusal: "No puedo ayudar con ese tipo de solicitud. Esta plataforma está orientada a la educación y al aprendizaje de idiomas.",
  },
  it: {
    language: "it",
    label: "Italiano",
    shortLabel: "Italiano",
    stopwords: ["che", "per", "con", "una", "come", "questo", "questa", "ciao", "grazie", "documento", "file", "aiuto", "voglio"],
    greetings: {
      morning: "Buongiorno",
      afternoon: "Buon pomeriggio",
      evening: "Buonasera",
      daily: "Ciao {{name}}, come posso aiutarti? {{greeting}}.",
    },
    moderationRefusal: "Non posso aiutarti con questo tipo di richiesta. Questa piattaforma è pensata per l'educazione e l'apprendimento delle lingue.",
  },
  fr: {
    language: "fr",
    label: "Français",
    shortLabel: "Français",
    stopwords: ["que", "pour", "avec", "une", "comment", "bonjour", "merci", "document", "fichier", "aide", "voulez", "votre"],
    greetings: {
      morning: "Bonjour",
      afternoon: "Bon après-midi",
      evening: "Bonsoir",
      daily: "Bonjour {{name}}, comment puis-je vous aider ? {{greeting}}.",
    },
    moderationRefusal: "Je ne peux pas aider avec ce type de demande. Cette plateforme est destinée à l'éducation et à l'apprentissage des langues.",
  },
});

const LOCALE_ALIASES = {
  pt: "pt-BR",
  "pt-br": "pt-BR",
  "pt_br": "pt-BR",
  "pt-pt": "pt-BR",
  en: "en",
  "en-us": "en",
  "en-gb": "en",
  es: "es",
  "es-es": "es",
  "es-mx": "es",
  it: "it",
  "it-it": "it",
  fr: "fr",
  "fr-fr": "fr",
  "fr-ca": "fr",
};

const SUPPORTED_LOCALES = Object.keys(LOCALE_PROFILES);
const SUPPORTED_LANGUAGES = [...new Set(SUPPORTED_LOCALES.map((locale) => LOCALE_PROFILES[locale].language))];

function normalizeText(value = "") {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(value = "") {
  return normalizeText(value)
    .split(" ")
    .map((token) => token.trim())
    .filter(Boolean);
}

function interpolate(template = "", params = {}) {
  return String(template || "").replace(/\{\{\s*([a-z0-9_]+)\s*\}\}/gi, (_, key) => {
    const value = params?.[key];
    return value == null ? "" : String(value);
  });
}

function normalizeLocaleCode(locale = DEFAULT_LOCALE) {
  const normalized = String(locale || DEFAULT_LOCALE).trim();
  if (!normalized) return DEFAULT_LOCALE;
  if (LOCALE_PROFILES[normalized]) return normalized;

  const aliasKey = normalized.toLowerCase().replace(/_/g, "-");
  if (LOCALE_ALIASES[aliasKey]) return LOCALE_ALIASES[aliasKey];

  return DEFAULT_LOCALE;
}

function localeToLanguage(locale = DEFAULT_LOCALE) {
  const safeLocale = normalizeLocaleCode(locale);
  return LOCALE_PROFILES[safeLocale]?.language || LOCALE_PROFILES[DEFAULT_LOCALE].language;
}

function normalizeLanguageCode(language = "pt") {
  const raw = String(language || "pt").trim();
  if (!raw) return "pt";

  const locale = normalizeLocaleCode(raw);
  if (LOCALE_PROFILES[locale]) {
    return localeToLanguage(locale);
  }

  const normalized = raw.toLowerCase();
  return SUPPORTED_LANGUAGES.includes(normalized) ? normalized : "pt";
}

function getLocaleProfile(locale = DEFAULT_LOCALE) {
  return LOCALE_PROFILES[normalizeLocaleCode(locale)] || LOCALE_PROFILES[DEFAULT_LOCALE];
}

function getLanguageProfile(language = "pt") {
  const normalizedLanguage = normalizeLanguageCode(language);
  const locale = SUPPORTED_LOCALES.find((item) => LOCALE_PROFILES[item].language === normalizedLanguage) || DEFAULT_LOCALE;
  return getLocaleProfile(locale);
}

function scoreLanguage(text = "") {
  const tokens = tokenize(text);
  const joined = ` ${tokens.join(" ")} `;
  const scores = {};

  for (const [, profile] of Object.entries(LOCALE_PROFILES)) {
    const language = profile.language;
    let score = scores[language] || 0;

    for (const word of profile.stopwords) {
      if (joined.includes(` ${word} `)) score += 1;
    }

    if (language === "pt" && /\b(voce|nao|tambem|conversa|arquivo|documento)\b/.test(joined)) score += 2;
    if (language === "en" && /\b(the|please|could|would|document|file)\b/.test(joined)) score += 2;
    if (language === "es" && /\b(usted|ustedes|archivo|documento|hola|necesito)\b/.test(joined)) score += 2;
    if (language === "it" && /\b(questo|questa|voglio|grazie|documento)\b/.test(joined)) score += 2;
    if (language === "fr" && /\b(bonjour|merci|fichier|document|besoin)\b/.test(joined)) score += 2;

    scores[language] = score;
  }

  return scores;
}

function detectLanguage(text = "", fallback = "pt") {
  const normalized = normalizeText(text);
  const safeFallback = normalizeLanguageCode(fallback);
  if (!normalized) return safeFallback;

  const scores = scoreLanguage(normalized);
  let bestLanguage = safeFallback;
  let bestScore = -1;

  for (const [language, score] of Object.entries(scores)) {
    if (score > bestScore) {
      bestLanguage = language;
      bestScore = score;
    }
  }

  return bestScore > 0 ? bestLanguage : safeFallback;
}

function getLanguageLabel(language = "pt") {
  return getLanguageProfile(language).label || getLanguageProfile("pt").label;
}

function getLocaleLabel(locale = DEFAULT_LOCALE) {
  return getLocaleProfile(locale).label || getLocaleProfile(DEFAULT_LOCALE).label;
}

function getPeriodGreeting(date = new Date(), locale = DEFAULT_LOCALE) {
  const hour = Number(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Sao_Paulo",
      hour: "2-digit",
      hour12: false,
    }).format(date)
  );

  const profile = getLocaleProfile(locale);
  if (hour < 12) return profile.greetings.morning;
  if (hour < 18) return profile.greetings.afternoon;
  return profile.greetings.evening;
}

function formatDailyGreeting(name = "Usuário", locale = DEFAULT_LOCALE, date = new Date()) {
  const safeName = String(name || "Usuário").trim() || "Usuário";
  const profile = getLocaleProfile(locale);
  return interpolate(profile.greetings.daily, {
    name: safeName,
    greeting: getPeriodGreeting(date, locale),
  });
}

function getModerationRefusal(locale = DEFAULT_LOCALE) {
  return getLocaleProfile(locale).moderationRefusal || getLocaleProfile(DEFAULT_LOCALE).moderationRefusal;
}

module.exports = {
  DEFAULT_LOCALE,
  SUPPORTED_LANGUAGES,
  SUPPORTED_LOCALES,
  detectLanguage,
  formatDailyGreeting,
  getLanguageLabel,
  getLocaleLabel,
  getLocaleProfile,
  getModerationRefusal,
  getPeriodGreeting,
  localeToLanguage,
  normalizeLanguageCode,
  normalizeLocaleCode,
  normalizeText,
  repairMojibakeText,
  tokenize,
};
