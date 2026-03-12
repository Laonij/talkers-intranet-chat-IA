const LANGUAGE_PROFILES = {
  pt: {
    label: 'Portugues',
    stopwords: ['de','da','do','que','para','com','uma','como','por','nao','mais','isso','essa','voce','voces','ajuda','arquivo','documento'],
  },
  en: {
    label: 'English',
    stopwords: ['the','and','for','with','that','this','you','your','please','about','file','document','help','what','how'],
  },
  es: {
    label: 'Espanol',
    stopwords: ['que','para','con','una','como','por','esto','esta','usted','ustedes','archivo','documento','ayuda','hola','gracias'],
  },
  it: {
    label: 'Italiano',
    stopwords: ['che','per','con','una','come','questo','questa','ciao','grazie','documento','file','aiuto','voglio'],
  },
  fr: {
    label: 'Francais',
    stopwords: ['que','pour','avec','une','comment','bonjour','merci','document','fichier','aide','voulez','votre'],
  },
};

const SUPPORTED_LANGUAGES = Object.keys(LANGUAGE_PROFILES);

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

function scoreLanguage(text = '') {
  const tokens = tokenize(text);
  const joined = ` ${tokens.join(' ')} `;
  const scores = {};

  for (const [language, profile] of Object.entries(LANGUAGE_PROFILES)) {
    let score = 0;
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
  if (!normalized) return fallback;

  const scores = scoreLanguage(normalized);
  let bestLanguage = fallback;
  let bestScore = -1;

  for (const [language, score] of Object.entries(scores)) {
    if (score > bestScore) {
      bestLanguage = language;
      bestScore = score;
    }
  }

  return bestScore > 0 ? bestLanguage : fallback;
}

function getLanguageLabel(language = 'pt') {
  return LANGUAGE_PROFILES[language]?.label || LANGUAGE_PROFILES.pt.label;
}

function normalizeLanguageCode(language = 'pt') {
  return SUPPORTED_LANGUAGES.includes(language) ? language : 'pt';
}

function getPeriodGreeting(date = new Date()) {
  const hour = Number(
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Sao_Paulo',
      hour: '2-digit',
      hour12: false,
    }).format(date)
  );

  if (hour < 12) return 'Bom dia';
  if (hour < 18) return 'Boa tarde';
  return 'Boa noite';
}

function formatDailyGreeting(name = 'Usuario', date = new Date()) {
  return `Oi ${String(name || 'Usuario').trim()}, como posso te ajudar? ${getPeriodGreeting(date)}.`;
}

module.exports = {
  SUPPORTED_LANGUAGES,
  detectLanguage,
  formatDailyGreeting,
  getLanguageLabel,
  getPeriodGreeting,
  normalizeLanguageCode,
  normalizeText,
  tokenize,
};