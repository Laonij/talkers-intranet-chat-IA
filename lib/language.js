const LOCALE_PROFILES = {
  'pt-BR': {
    language: 'pt',
    label: 'Português (Brasil)',
    shortLabel: 'Português',
    stopwords: ['de', 'da', 'do', 'que', 'para', 'com', 'uma', 'como', 'por', 'nao', 'mais', 'isso', 'essa', 'voce', 'voces', 'ajuda', 'arquivo', 'documento'],
    greetings: {
      morning: 'Bom dia',
      afternoon: 'Boa tarde',
      evening: 'Boa noite',
      daily: 'Oi {{name}}, como posso te ajudar? {{greeting}}.',
    },
    moderationRefusal: 'Nao posso ajudar com esse tipo de solicitacao. Esta plataforma e voltada para educacao e aprendizado de idiomas.',
  },
  en: {
    language: 'en',
    label: 'English',
    shortLabel: 'English',
    stopwords: ['the', 'and', 'for', 'with', 'that', 'this', 'you', 'your', 'please', 'about', 'file', 'document', 'help', 'what', 'how'],
    greetings: {
      morning: 'Good morning',
      afternoon: 'Good afternoon',
      evening: 'Good evening',
      daily: 'Hi {{name}}, how can I help you? {{greeting}}.',
    },
    moderationRefusal: 'I cannot help with that type of request. This platform is intended for education and language learning.',
  },
  es: {
    language: 'es',
    label: 'Espanol',
    shortLabel: 'Espanol',
    stopwords: ['que', 'para', 'con', 'una', 'como', 'por', 'esto', 'esta', 'usted', 'ustedes', 'archivo', 'documento', 'ayuda', 'hola', 'gracias'],
    greetings: {
      morning: 'Buenos dias',
      afternoon: 'Buenas tardes',
      evening: 'Buenas noches',
      daily: 'Hola {{name}}, como puedo ayudarte? {{greeting}}.',
    },
    moderationRefusal: 'No puedo ayudar con ese tipo de solicitud. Esta plataforma esta orientada a la educacion y al aprendizaje de idiomas.',
  },
  it: {
    language: 'it',
    label: 'Italiano',
    shortLabel: 'Italiano',
    stopwords: ['che', 'per', 'con', 'una', 'come', 'questo', 'questa', 'ciao', 'grazie', 'documento', 'file', 'aiuto', 'voglio'],
    greetings: {
      morning: 'Buongiorno',
      afternoon: 'Buon pomeriggio',
      evening: 'Buonasera',
      daily: 'Ciao {{name}}, come posso aiutarti? {{greeting}}.',
    },
    moderationRefusal: 'Non posso aiutarti con questo tipo di richiesta. Questa piattaforma e pensata per l educazione e l apprendimento delle lingue.',
  },
  fr: {
    language: 'fr',
    label: 'Francais',
    shortLabel: 'Francais',
    stopwords: ['que', 'pour', 'avec', 'une', 'comment', 'bonjour', 'merci', 'document', 'fichier', 'aide', 'voulez', 'votre'],
    greetings: {
      morning: 'Bonjour',
      afternoon: 'Bon apres-midi',
      evening: 'Bonsoir',
      daily: 'Bonjour {{name}}, comment puis-je vous aider? {{greeting}}.',
    },
    moderationRefusal: 'Je ne peux pas aider avec ce type de demande. Cette plateforme est destinee a l education et a l apprentissage des langues.',
  },
};

const DEFAULT_LOCALE = 'pt-BR';
const LOCALE_ALIASES = {
  pt: 'pt-BR',
  'pt-br': 'pt-BR',
  'pt_br': 'pt-BR',
  'pt-pt': 'pt-BR',
  en: 'en',
  'en-us': 'en',
  'en-gb': 'en',
  es: 'es',
  'es-es': 'es',
  'es-mx': 'es',
  it: 'it',
  'it-it': 'it',
  fr: 'fr',
  'fr-fr': 'fr',
  'fr-ca': 'fr',
};

const SUPPORTED_LOCALES = Object.keys(LOCALE_PROFILES);
const SUPPORTED_LANGUAGES = [...new Set(SUPPORTED_LOCALES.map((locale) => LOCALE_PROFILES[locale].language))];

function normalizeText(value = '') {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenize(value = '') {
  return normalizeText(value)
    .split(' ')
    .map((token) => token.trim())
    .filter(Boolean);
}

function interpolate(template = '', params = {}) {
  return String(template || '').replace(/\{\{\s*([a-z0-9_]+)\s*\}\}/gi, (_, key) => {
    const value = params?.[key];
    return value == null ? '' : String(value);
  });
}

function normalizeLocaleCode(locale = DEFAULT_LOCALE) {
  const normalized = String(locale || DEFAULT_LOCALE).trim();
  if (!normalized) return DEFAULT_LOCALE;
  if (LOCALE_PROFILES[normalized]) return normalized;

  const aliasKey = normalized.toLowerCase().replace(/_/g, '-');
  if (LOCALE_ALIASES[aliasKey]) return LOCALE_ALIASES[aliasKey];

  return DEFAULT_LOCALE;
}

function localeToLanguage(locale = DEFAULT_LOCALE) {
  const safeLocale = normalizeLocaleCode(locale);
  return LOCALE_PROFILES[safeLocale]?.language || LOCALE_PROFILES[DEFAULT_LOCALE].language;
}

function normalizeLanguageCode(language = 'pt') {
  const raw = String(language || 'pt').trim();
  if (!raw) return 'pt';

  const locale = normalizeLocaleCode(raw);
  if (LOCALE_PROFILES[locale]) {
    return localeToLanguage(locale);
  }

  const normalized = raw.toLowerCase();
  return SUPPORTED_LANGUAGES.includes(normalized) ? normalized : 'pt';
}

function getLocaleProfile(locale = DEFAULT_LOCALE) {
  return LOCALE_PROFILES[normalizeLocaleCode(locale)] || LOCALE_PROFILES[DEFAULT_LOCALE];
}

function getLanguageProfile(language = 'pt') {
  const normalizedLanguage = normalizeLanguageCode(language);
  const locale = SUPPORTED_LOCALES.find((item) => LOCALE_PROFILES[item].language === normalizedLanguage) || DEFAULT_LOCALE;
  return getLocaleProfile(locale);
}

function scoreLanguage(text = '') {
  const tokens = tokenize(text);
  const joined = ` ${tokens.join(' ')} `;
  const scores = {};

  for (const [locale, profile] of Object.entries(LOCALE_PROFILES)) {
    const language = profile.language;
    let score = scores[language] || 0;

    for (const word of profile.stopwords) {
      if (joined.includes(` ${word} `)) score += 1;
    }

    if (language === 'pt' && /\b(voce|nao|tambem|conversa|arquivo|documento)\b/.test(joined)) score += 2;
    if (language === 'en' && /\b(the|please|could|would|document|file)\b/.test(joined)) score += 2;
    if (language === 'es' && /\b(usted|ustedes|archivo|documento|hola|necesito)\b/.test(joined)) score += 2;
    if (language === 'it' && /\b(questo|questa|voglio|grazie|documento)\b/.test(joined)) score += 2;
    if (language === 'fr' && /\b(bonjour|merci|fichier|document|besoin)\b/.test(joined)) score += 2;

    scores[language] = score;
  }

  return scores;
}

function detectLanguage(text = '', fallback = 'pt') {
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

function getLanguageLabel(language = 'pt') {
  return getLanguageProfile(language).label || getLanguageProfile('pt').label;
}

function getLocaleLabel(locale = DEFAULT_LOCALE) {
  return getLocaleProfile(locale).label || getLocaleProfile(DEFAULT_LOCALE).label;
}

function getPeriodGreeting(date = new Date(), locale = DEFAULT_LOCALE) {
  const hour = Number(
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Sao_Paulo',
      hour: '2-digit',
      hour12: false,
    }).format(date)
  );

  const profile = getLocaleProfile(locale);
  if (hour < 12) return profile.greetings.morning;
  if (hour < 18) return profile.greetings.afternoon;
  return profile.greetings.evening;
}

function formatDailyGreeting(name = 'Usuario', locale = DEFAULT_LOCALE, date = new Date()) {
  const safeName = String(name || 'Usuario').trim() || 'Usuario';
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
  tokenize,
};
