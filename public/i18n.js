(function () {
  const DEFAULT_LOCALE = 'pt-BR';
  const STORAGE_KEY = 'talkers_locale_v1';
  const COOKIE_KEY = 'talkers_locale';
  const SUPPORTED_LOCALES = ['pt-BR', 'en', 'es', 'it', 'fr'];
  const KNOWN_TEXT_REPAIRS = [
    ['ï¿½ltima', 'Última'],
    ['perï¿½odo', 'período'],
    ['Perï¿½odo', 'Período'],
    ['visï¿½o', 'visão'],
    ['Visï¿½o', 'Visão'],
    ['operaï¿½ï¿½o', 'operação'],
    ['Operaï¿½ï¿½o', 'Operação'],
    ['reuniï¿½es', 'reuniões'],
    ['Reuniï¿½es', 'Reuniões'],
    ['relatï¿½rios', 'relatórios'],
    ['Relatï¿½rios', 'Relatórios'],
    ['anï¿½lise', 'análise'],
    ['Anï¿½lise', 'Análise'],
    ['histï¿½rico', 'histórico'],
    ['Histï¿½rico', 'Histórico'],
    ['mï¿½dulo', 'módulo'],
    ['Mï¿½dulo', 'Módulo'],
    ['m�dulo', 'módulo'],
    ['M�dulo', 'Módulo'],
    ['ï¿½rea', 'Área'],
    ['ï¿½reas', 'Áreas'],
    ['�rea', 'Área'],
    ['�reas', 'Áreas'],
    ['regiï¿½o', 'região'],
    ['Regiï¿½o', 'Região'],
    ['Regi�o', 'Região'],
    ['calendï¿½rio', 'calendário'],
    ['conteï¿½do', 'conteúdo'],
    ['Conteï¿½do', 'Conteúdo'],
    ['matrï¿½culas', 'matrículas'],
    ['Matrï¿½culas', 'Matrículas'],
    ['lanï¿½amentos', 'lançamentos'],
    ['Lanï¿½amentos', 'Lançamentos'],
    ['automï¿½ticos', 'automáticos'],
    ['clusterizaï¿½ï¿½o', 'clusterização'],
    ['decisï¿½o', 'decisão'],
    ['revisï¿½o', 'revisão'],
    ['prï¿½ximos', 'próximos'],
    ['prï¿½ximo', 'próximo'],
    ['Prï¿½ximo', 'Próximo'],
    ['MÃªs', 'Mês'],
    ['mÃªs', 'mês'],
    ['Ã¡', 'á'],
    ['Ã©', 'é'],
    ['Ãª', 'ê'],
    ['Ã­', 'í'],
    ['Ã³', 'ó'],
    ['Ãº', 'ú'],
    ['Ã£', 'ã'],
    ['Ãµ', 'õ'],
    ['Ã§', 'ç'],
    ['Ã', 'Á'],
    ['Ã‰', 'É'],
    ['ÃŠ', 'Ê'],
    ['Ã', 'Í'],
    ['Ã“', 'Ó'],
    ['Ãš', 'Ú'],
    ['Ãƒ', 'Ã'],
    ['Ã‡', 'Ç'],
    ['TÃ­tulo', 'Título'],
    ['tÃ­tulo', 'título'],
    ['DescriÃ§Ã£o', 'Descrição'],
    ['descriÃ§Ã£o', 'descrição'],
    ['ObservaÃ§Ãµes', 'Observações'],
    ['observaÃ§Ãµes', 'observações'],
    ['UsuÃ¡rio', 'Usuário'],
    ['usuÃ¡rio', 'usuário'],
    ['DireÃ§Ã£o', 'Direção'],
    ['direÃ§Ã£o', 'direção'],
    ['LatÃªncia', 'Latência'],
    ['latÃªncia', 'latência'],
    ['MemÃ³ria', 'Memória'],
    ['memÃ³ria', 'memória'],
    ['AtenÃ§Ã£o', 'Atenção'],
    ['atenÃ§Ã£o', 'atenção'],
    ['opera��o', 'operação'],
    ['Opera��o', 'Operação'],
    ['vis�o', 'visão'],
    ['Vis�o', 'Visão'],
    ['�rea', 'Área'],
    ['�reas', 'Áreas'],
    ['m�dulo', 'módulo'],
    ['m�dulos', 'módulos'],
    ['M�dulo', 'Módulo'],
    ['M�dulos', 'Módulos'],
    ['dispon�vel', 'disponível'],
    ['dispon�veis', 'disponíveis'],
    ['per�odo', 'período'],
    ['Per�odo', 'Período'],
    ['reuni�es', 'reuniões'],
    ['Reuni�es', 'Reuniões'],
    ['cota��o', 'cotação'],
    ['Cota��o', 'Cotação'],
    ['rela��o', 'relação'],
    ['Rela��o', 'Relação'],
    ['econ�micos', 'econômicos'],
    ['Econ�micos', 'Econômicos'],
    ['pol�ticos', 'políticos'],
    ['Pol�ticos', 'Políticos'],
    ['c�mbio', 'câmbio'],
    ['C�mbio', 'Câmbio'],
    ['institui��es', 'instituições'],
    ['Institui��es', 'Instituições'],
    ['confi�veis', 'confiáveis'],
    ['Confi�veis', 'Confiáveis'],
    ['informa��es', 'informações'],
    ['Informa��es', 'Informações'],
    ['d�lar', 'dólar'],
    ['D�lar', 'Dólar'],
    ['est�', 'está'],
    ['Est�', 'Está'],
    ['convers�o', 'conversão'],
    ['Convers�o', 'Conversão'],
    ['cart�o', 'cartão'],
    ['Cart�o', 'Cartão'],
    ['at�', 'até'],
    ['At�', 'Até'],
    ['R$�', 'R$ '],
    ['compromissos e reuni�es', 'compromissos e reuniões'],
    ['calend�rio', 'calendário'],
    ['se��o', 'seção'],
    ['a��o', 'ação'],
    ['ações', 'ações'],
    ['hist�rico', 'histórico'],
    ['Hist�rico', 'Histórico'],
    ['M�s', 'Mês'],
    ['Descri��o', 'Descrição'],
    ['descri��o', 'descrição'],
    ['T�tulo', 'Título'],
    ['t�tulo', 'título'],
    ['serï¿½o', 'serão'],
    ['nï¿½o', 'não'],
    ['Nï¿½o', 'Não'],
    ['possï¿½vel', 'possível'],
    ['Aujourd�?Thui', 'Aujourd’hui'],
    ['�?couter', 'Écouter'],
    ['�? utiliser', 'À utiliser'],
    ['�ssalo', 'Úsalo'],
    ['l�?T', 'l’'],
    ['d�?T', 'd’'],
    ['t�?T', 't’'],
    ['qu�?T', 'qu’'],
    ['s�?T', 's’'],
    ['j�?T', 'j’'],
    ['n�?T', 'n’'],
    ['c�?T', 'c’'],
    ['all�?T', 'all’'],
    ['dell�?T', 'dell’'],
    ['nell�?T', 'nell’'],
    ['un�?T', 'un’'],
  ];
  function applyKnownTextRepairs(value = '') {
    let repaired = String(value ?? '');
    KNOWN_TEXT_REPAIRS.forEach(([pattern, replacement]) => {
      repaired = repaired.split(pattern).join(replacement);
    });
    return repaired
      .replace(/\u00a0/g, ' ')
      .replace(/\u202f/g, ' ');
  }
  function countCorruptionSignals(value = '') {
    const safe = String(value ?? '');
    if (!safe) return 0;
    const matches = safe.match(/[ÃÂâ€™â€œâ€â€“â€”ï¿½�]/g);
    const replacementCount = (safe.match(/�/g) || []).length;
    return Number(matches?.length || 0) + replacementCount;
  }
  function repairMojibakeText(value = '') {
    const safeValue = String(value ?? '');
    if (!safeValue) return '';
    let repaired = safeValue;
    if (/[ÃÂâ€™â€œâ€â€“â€”ï¿½�]/.test(safeValue)) {
      for (let index = 0; index < 2; index += 1) {
        try {
          const candidate = decodeURIComponent(escape(repaired));
          if (candidate && candidate !== repaired && countCorruptionSignals(candidate) <= countCorruptionSignals(repaired)) {
            repaired = candidate;
            continue;
          }
        } catch {}
        try {
          const candidate = new TextDecoder('utf-8').decode(Uint8Array.from(repaired, (char) => char.charCodeAt(0)));
          if (candidate && candidate !== repaired && countCorruptionSignals(candidate) <= countCorruptionSignals(repaired)) {
            repaired = candidate;
            continue;
          }
        } catch {}
        break;
      }
    }
    return applyKnownTextRepairs(repaired);
  }
  function repairBundle(value) {
    if (Array.isArray(value)) return value.map(repairBundle);
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, repairBundle(nested)]));
    }
    return typeof value === 'string' ? repairMojibakeText(value) : value;
  }
  function toFlagEmoji(countryCode) {
    const safeCode = String(countryCode || '').trim().toUpperCase();
    if (!/^[A-Z]{2}$/.test(safeCode)) return '';
    return Array.from(safeCode)
      .map((char) => String.fromCodePoint(127397 + char.charCodeAt(0)))
      .join('');
  }
  const LOCALE_OPTIONS = [
    { code: 'pt-BR', flag: toFlagEmoji('BR'), label: 'Português' },
    { code: 'en', flag: toFlagEmoji('US'), label: 'English' },
    { code: 'es', flag: toFlagEmoji('ES'), label: 'Español' },
    { code: 'it', flag: toFlagEmoji('IT'), label: 'Italiano' },
    { code: 'fr', flag: toFlagEmoji('FR'), label: 'Français' },
  ];
  const SELECTOR = '[data-i18n], [data-i18n-placeholder], [data-i18n-title], [data-i18n-aria-label]';

  let currentLocale = DEFAULT_LOCALE;
  const bundles = {};
  const listeners = new Set();

  function normalizeLocale(locale) {
    const raw = String(locale || '').trim();
    if (!raw) return DEFAULT_LOCALE;
    const normalized = raw.replace(/_/g, '-').toLowerCase();
    if (normalized === 'pt' || normalized === 'pt-br' || normalized === 'pt-pt') return 'pt-BR';
    if (normalized.startsWith('en')) return 'en';
    if (normalized.startsWith('es')) return 'es';
    if (normalized.startsWith('it')) return 'it';
    if (normalized.startsWith('fr')) return 'fr';
    return DEFAULT_LOCALE;
  }

  function localeToLanguage(locale) {
    return normalizeLocale(locale).split('-')[0];
  }

  function getCookie(name) {
    const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
    return match ? decodeURIComponent(match[1]) : '';
  }

  function setCookie(name, value) {
    document.cookie = `${name}=${encodeURIComponent(value)}; path=/; max-age=${60 * 60 * 24 * 365}; SameSite=Lax`;
  }

  function getValue(source, key) {
    return String(key || '')
      .split('.')
      .reduce((acc, part) => (acc && Object.prototype.hasOwnProperty.call(acc, part) ? acc[part] : undefined), source);
  }

  function interpolate(template, params) {
    return String(template || '').replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, key) => {
      const value = params?.[key];
      return value == null ? '' : String(value);
    });
  }

  async function loadLocale(locale) {
    const safeLocale = normalizeLocale(locale);
    if (bundles[safeLocale]) return bundles[safeLocale];

    try {
      const response = await fetch(`/locales/${safeLocale}.json`, { credentials: 'same-origin' });
      bundles[safeLocale] = response.ok ? repairBundle(await response.json()) : {};
    } catch {
      bundles[safeLocale] = {};
    }

    return bundles[safeLocale];
  }

  function t(key, params = {}, fallback = '') {
    const safeLocale = normalizeLocale(currentLocale);
    const localized = getValue(bundles[safeLocale], key);
    const base = getValue(bundles[DEFAULT_LOCALE], key);
    const resolved = localized ?? base ?? fallback ?? key;
    return typeof resolved === 'string' ? repairMojibakeText(interpolate(resolved, params)) : resolved;
  }

  function applyToElement(node) {
    if (!node || node.nodeType !== 1) return;

    const textKey = node.getAttribute('data-i18n');
    if (textKey) {
      node.textContent = t(textKey, {});
    }

    const placeholderKey = node.getAttribute('data-i18n-placeholder');
    if (placeholderKey) {
      node.setAttribute('placeholder', t(placeholderKey, {}));
    }

    const titleKey = node.getAttribute('data-i18n-title');
    if (titleKey) {
      node.setAttribute('title', t(titleKey, {}));
    }

    const ariaKey = node.getAttribute('data-i18n-aria-label');
    if (ariaKey) {
      node.setAttribute('aria-label', t(ariaKey, {}));
    }
  }

  function repairDomText(root = document) {
    if (!root || !root.ownerDocument && root !== document) return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const textNodes = [];
    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (!node?.nodeValue || !node.parentElement) continue;
      const tagName = node.parentElement.tagName;
      if (tagName === 'SCRIPT' || tagName === 'STYLE') continue;
      textNodes.push(node);
    }
    textNodes.forEach((node) => {
      const repaired = repairMojibakeText(node.nodeValue);
      if (repaired !== node.nodeValue) {
        node.nodeValue = repaired;
      }
    });

    root.querySelectorAll?.('*').forEach((node) => {
      ['placeholder', 'title', 'aria-label'].forEach((attribute) => {
        if (!node.hasAttribute?.(attribute)) return;
        const current = node.getAttribute(attribute);
        const repaired = repairMojibakeText(current);
        if (repaired !== current) node.setAttribute(attribute, repaired);
      });
    });
  }

  function applyTranslations(root = document) {
    if (!root) return;
    if (root.matches && root.matches(SELECTOR)) {
      applyToElement(root);
    }
    root.querySelectorAll?.(SELECTOR).forEach(applyToElement);
    repairDomText(root);
  }

  function getLocale() {
    return normalizeLocale(currentLocale);
  }

  function buildHeaders() {
    return { 'X-Talkers-Locale': getLocale() };
  }

  function notifyLocaleChange() {
    applyTranslations(document);
    listeners.forEach((listener) => {
      try {
        listener(getLocale());
      } catch {}
    });
  }

  async function setLocale(locale, options = {}) {
    const safeLocale = normalizeLocale(locale);
    currentLocale = safeLocale;
    await loadLocale(DEFAULT_LOCALE);
    await loadLocale(safeLocale);

    document.documentElement.lang = safeLocale;
    document.documentElement.setAttribute('data-locale', safeLocale);
    window.__talkersLocale = safeLocale;

    if (options.persist !== false) {
      try {
        localStorage.setItem(STORAGE_KEY, safeLocale);
      } catch {}
      setCookie(COOKIE_KEY, safeLocale);
    }

    if (options.notify !== false) {
      notifyLocaleChange();
    } else {
      applyTranslations(document);
    }

    return safeLocale;
  }

  function onChange(listener) {
    if (typeof listener === 'function') listeners.add(listener);
    return () => listeners.delete(listener);
  }

  function renderLanguageSwitcher(target, options = {}) {
    const container = typeof target === 'string' ? document.getElementById(target) : target;
    if (!container) return null;

    container.innerHTML = '';
    container.classList.add('language-switcher-host');

    const wrap = document.createElement('div');
    wrap.className = `language-switcher${options.compact ? ' is-compact' : ''}`;

    const label = document.createElement('label');
    label.className = 'language-switcher-label';
    label.textContent = options.showLabel === false ? '🌐' : t('language.label', {}, 'Idioma');

    const select = document.createElement('select');
    select.className = 'language-switcher-select';
    select.setAttribute('aria-label', t('language.label', {}, 'Idioma'));

    LOCALE_OPTIONS.forEach((item) => {
      const option = document.createElement('option');
      option.value = item.code;
      option.textContent = `${item.flag} ${item.label}`;
      select.appendChild(option);
    });
    select.value = getLocale();
    select.addEventListener('change', async () => {
      await setLocale(select.value);
    });

    wrap.appendChild(label);
    wrap.appendChild(select);
    container.appendChild(wrap);

    onChange((locale) => {
      label.textContent = options.showLabel === false ? '🌐' : t('language.label', {}, 'Idioma');
      select.setAttribute('aria-label', t('language.label', {}, 'Idioma'));
      select.value = locale;
    });

    return wrap;
  }

  function formatDate(value, intlOptions = {}) {
    if (!value) return '';
    try {
      return new Intl.DateTimeFormat(getLocale(), intlOptions).format(new Date(value));
    } catch {
      return String(value || '');
    }
  }

  function getPeriodGreeting(date = new Date()) {
    const hour = Number(new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Sao_Paulo',
      hour: '2-digit',
      hour12: false,
    }).format(date));

    if (hour < 12) return t('greetings.morning', {}, 'Bom dia');
    if (hour < 18) return t('greetings.afternoon', {}, 'Boa tarde');
    return t('greetings.evening', {}, 'Boa noite');
  }

  async function init() {
    await loadLocale(DEFAULT_LOCALE);
    let stored = DEFAULT_LOCALE;
    try {
      stored = localStorage.getItem(STORAGE_KEY) || getCookie(COOKIE_KEY) || document.documentElement.lang || DEFAULT_LOCALE;
    } catch {
      stored = getCookie(COOKIE_KEY) || document.documentElement.lang || DEFAULT_LOCALE;
    }
    await setLocale(stored, { persist: false, notify: false });
    notifyLocaleChange();
  }

  const readyPromise = init();

  window.TalkersI18n = {
    DEFAULT_LOCALE,
    SUPPORTED_LOCALES,
    LOCALE_OPTIONS,
    ready: () => readyPromise,
    t,
    getLocale,
    normalizeLocale,
    localeToLanguage,
    buildHeaders,
    applyTranslations,
    renderLanguageSwitcher,
    setLocale,
    onChange,
    formatDate,
    getPeriodGreeting,
    repairMojibakeText,
  };
})();

