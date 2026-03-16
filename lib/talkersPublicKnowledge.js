const axios = require("axios");
const cheerio = require("cheerio");

const TALKERS_ROOT_URL = "https://talkersidiomas.com.br/";
const TALKERS_CACHE_TTL_MS = 1000 * 60 * 60 * 6;
const REQUEST_HEADERS = {
  "User-Agent": "TalkersIA/1.0 (+https://talkersidiomas.com.br)",
  Accept: "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
};

const talkersKnowledgeState = {
  status: "seed",
  mode: "seed",
  last_synced_at: null,
  source_count: 0,
  sources: [],
  categories: [],
  origins: [TALKERS_ROOT_URL],
  alerts: [],
  technical_note: "Base pública ainda não sincronizada em tempo real.",
  social_profiles: [],
};
let talkersSyncPromise = null;

const FALLBACK_SOURCES = [
  {
    category: "institutional",
    title: "Talkers Idiomas - site oficial",
    url: TALKERS_ROOT_URL,
    summary: "Fonte pública oficial da Talkers Idiomas. Usar como ponto principal para apresentação institucional, páginas, cursos, contato e presença digital.",
  },
  {
    category: "contact",
    title: "Contato oficial Talkers",
    url: TALKERS_ROOT_URL,
    summary: "Contato público identificado no site oficial: WhatsApp +55 54 99603-3765.",
  },
  {
    category: "digital_presence",
    title: "Instagram oficial Talkers",
    url: "https://www.instagram.com/talkersidiomas/",
    summary: "Perfil público oficial identificado a partir do site: @talkersidiomas.",
  },
  {
    category: "digital_presence",
    title: "YouTube oficial Talkers",
    url: "https://www.youtube.com/@TalkersIdiomas",
    summary: "Canal público oficial identificado a partir do site: @TalkersIdiomas.",
  },
];

function stripDiacritics(value = "") {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function normalizeText(value = "") {
  return stripDiacritics(String(value || ""))
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function compactText(value = "", limit = 1400) {
  return String(value || "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, limit);
}

function dedupeStrings(values = []) {
  return Array.from(new Set((Array.isArray(values) ? values : []).map((value) => String(value || "").trim()).filter(Boolean)));
}

function classifyPage(url = "", text = "") {
  const normalized = normalizeText(`${url} ${text}`);
  if (/(contato|whatsapp|telefone|endereco|fale)/i.test(normalized)) return "contact";
  if (/(metodologia|metodo|abordagem|imersao|experiencia)/i.test(normalized)) return "methodology";
  if (/(curso|cursos|idioma|ingles|espanhol|italiano|frances|alemao|online)/i.test(normalized)) return "courses";
  if (/(instagram|youtube|facebook|social)/i.test(normalized)) return "digital_presence";
  return "institutional";
}

function scoreSourceForQuery(source, query = "") {
  const normalizedQuery = normalizeText(query);
  if (!normalizedQuery) return 0;
  const queryTokens = normalizedQuery.split(" ").filter((token) => token.length >= 3);
  const haystack = normalizeText([source.title, source.summary, source.category, source.url].filter(Boolean).join(" "));
  let score = 0;
  queryTokens.forEach((token) => {
    if (haystack.includes(token)) score += 1;
  });
  if (/\btalkers\b/.test(normalizedQuery)) score += 2;
  if (/(curso|cursos|idioma|metodologia|contato|instagram|site|unidade|online)/.test(normalizedQuery) && haystack) score += 1;
  return score;
}

function buildFallbackKnowledgeState(errorMessage = "") {
  return {
    status: errorMessage ? "fallback" : "seed",
    mode: "seed",
    last_synced_at: talkersKnowledgeState.last_synced_at || null,
    source_count: FALLBACK_SOURCES.length,
    sources: FALLBACK_SOURCES,
    categories: dedupeStrings(FALLBACK_SOURCES.map((source) => source.category)),
    origins: dedupeStrings(FALLBACK_SOURCES.map((source) => source.url)),
    alerts: errorMessage ? [errorMessage] : [],
    technical_note: errorMessage
      ? `Falha ao sincronizar automaticamente a base pública da Talkers. Foi mantido o seed oficial local.`
      : "Base pública oficial da Talkers em seed local.",
    social_profiles: FALLBACK_SOURCES.filter((source) => source.category === "digital_presence").map((source) => ({
      label: source.title,
      url: source.url,
    })),
  };
}

function extractInternalLinks($, baseUrl) {
  const base = new URL(baseUrl);
  const links = new Set([base.href]);
  $("a[href]").each((_, element) => {
    const href = $(element).attr("href");
    if (!href) return;
    try {
      const resolved = new URL(href, base.href);
      if (resolved.hostname !== base.hostname) return;
      const safe = resolved.href.split("#")[0];
      if (/\/wp-|\/cdn-cgi\//i.test(safe)) return;
      links.add(safe);
    } catch {}
  });
  return Array.from(links);
}

function prioritizeLinks(links = []) {
  const priorityTokens = [
    "sobre",
    "contato",
    "curso",
    "idioma",
    "ingles",
    "online",
    "metod",
    "fale",
    "escola",
  ];

  return dedupeStrings(links)
    .map((url) => ({
      url,
      score: priorityTokens.reduce((sum, token) => sum + (normalizeText(url).includes(token) ? 1 : 0), 0),
    }))
    .sort((left, right) => Number(right.score || 0) - Number(left.score || 0))
    .slice(0, 8)
    .map((item) => item.url);
}

function extractSocialProfiles($, baseUrl) {
  const profiles = [];
  $("a[href]").each((_, element) => {
    const href = $(element).attr("href");
    if (!href) return;
    let resolved = "";
    try {
      resolved = new URL(href, baseUrl).href;
    } catch {
      return;
    }
    if (!/(instagram\.com|youtube\.com|facebook\.com|wa\.me|api\.whatsapp\.com)/i.test(resolved)) return;
    const label = compactText($(element).text() || $(element).attr("aria-label") || resolved, 120);
    profiles.push({ label: label || resolved, url: resolved });
  });
  return profiles;
}

async function fetchTalkersPage(url) {
  const response = await axios.get(url, {
    timeout: 7000,
    headers: REQUEST_HEADERS,
  });
  const html = String(response?.data || "");
  const $ = cheerio.load(html);
  $("script, style, noscript").remove();

  const title = compactText($("title").first().text(), 180);
  const metaDescription = compactText($('meta[name="description"]').attr("content") || $('meta[property="og:description"]').attr("content") || "", 260);
  const headings = dedupeStrings(
    $("h1, h2")
      .slice(0, 12)
      .map((_, element) => compactText($(element).text(), 120))
      .get()
  );
  const bodyText = compactText($("body").text(), 2400);
  const socialProfiles = extractSocialProfiles($, url);

  return {
    url,
    title,
    metaDescription,
    headings,
    bodyText,
    socialProfiles,
    internalLinks: extractInternalLinks($, url),
  };
}

async function syncTalkersPublicKnowledge({ force = false } = {}) {
  const isFresh = talkersKnowledgeState.last_synced_at
    && (Date.now() - new Date(talkersKnowledgeState.last_synced_at).getTime()) < TALKERS_CACHE_TTL_MS
    && talkersKnowledgeState.sources.length;

  if (!force && isFresh) return talkersKnowledgeState;
  if (!force && talkersSyncPromise) return talkersSyncPromise;

  talkersSyncPromise = (async () => {
    try {
    const rootPage = await fetchTalkersPage(TALKERS_ROOT_URL);
    const links = prioritizeLinks(rootPage.internalLinks || []);
    const pages = [rootPage];

    for (const link of links) {
      if (pages.length >= 6) break;
      if (link === TALKERS_ROOT_URL) continue;
      try {
        pages.push(await fetchTalkersPage(link));
      } catch (err) {
        console.log("Falha ao sincronizar pagina publica Talkers:", link, err?.message || err);
      }
    }

    const sources = pages.map((page) => {
      const category = classifyPage(page.url, `${page.title} ${page.metaDescription} ${page.headings.join(" ")}`);
      const summary = compactText([
        page.metaDescription,
        page.headings.join(" • "),
        page.bodyText,
      ].filter(Boolean).join(" "), 1500);
      return {
        category,
        title: page.title || page.url,
        url: page.url,
        summary,
      };
    });

    const socialProfiles = dedupeStrings(
      pages.flatMap((page) => (page.socialProfiles || []).map((profile) => `${profile.label}|||${profile.url}`))
    ).map((entry) => {
      const [label, url] = entry.split("|||");
      return { label, url };
    });

    const nextState = {
      status: "active",
      mode: "live",
      last_synced_at: new Date().toISOString(),
      source_count: sources.length,
      sources,
      categories: dedupeStrings(sources.map((source) => source.category)),
      origins: dedupeStrings(sources.map((source) => source.url)),
      alerts: [],
      technical_note: "Base pública oficial sincronizada a partir do site institucional da Talkers.",
      social_profiles: socialProfiles,
    };

    Object.assign(talkersKnowledgeState, nextState);
    return talkersKnowledgeState;
    } catch (err) {
      console.log("Falha ao sincronizar base publica da Talkers:", err?.message || err);
      Object.assign(talkersKnowledgeState, buildFallbackKnowledgeState(err?.message || "sync_failed"));
      return talkersKnowledgeState;
    } finally {
      talkersSyncPromise = null;
    }
  })();

  return talkersSyncPromise;
}

function scheduleTalkersKnowledgeSync() {
  if (talkersSyncPromise) return talkersSyncPromise;
  talkersSyncPromise = syncTalkersPublicKnowledge({ force: true }).catch(() => null);
  return talkersSyncPromise;
}

function queryLooksAboutTalkers(query = "") {
  const normalized = normalizeText(query);
  if (!normalized) return false;
  return /(talkers|talkers idiomas|nossa escola|nossa empresa|nosso site|site da talkers|instagram da talkers|contato da talkers|metodologia da talkers|cursos da talkers|idiomas da talkers|unidades da talkers|a escola talkers|a empresa talkers|ensino online talkers)/i.test(normalized);
}

async function buildTalkersPublicKnowledgeBundle(query = "", { limit = 4 } = {}) {
  if (!queryLooksAboutTalkers(query)) {
    return {
      text: "",
      sources: [],
      diagnostics: {
        status: talkersKnowledgeState.status,
        source_count: talkersKnowledgeState.source_count,
        last_synced_at: talkersKnowledgeState.last_synced_at,
      },
      metrics: {
        talkers_public_hits: 0,
      },
    };
  }

  const hasWarmKnowledge = Array.isArray(talkersKnowledgeState.sources) && talkersKnowledgeState.sources.length > 0;
  const isFresh = talkersKnowledgeState.last_synced_at
    && (Date.now() - new Date(talkersKnowledgeState.last_synced_at).getTime()) < TALKERS_CACHE_TTL_MS;

  const knowledge = hasWarmKnowledge
    ? talkersKnowledgeState
    : buildFallbackKnowledgeState();

  if (!hasWarmKnowledge || !isFresh) {
    scheduleTalkersKnowledgeSync();
  }

  const ranked = (knowledge.sources || [])
    .map((source) => ({
      ...source,
      score: scoreSourceForQuery(source, query),
    }))
    .sort((left, right) => Number(right.score || 0) - Number(left.score || 0));

  const selected = ranked.slice(0, Math.max(1, Number(limit || 4)));
  return {
    text: selected
      .map((source) => `[Base pública oficial Talkers: ${source.title}]\n${source.summary}`)
      .join("\n\n"),
    sources: selected.map((source) => ({
      type: "talkers_public",
      label: source.title,
      url: source.url,
      excerpt: compactText(source.summary, 240),
    })),
    diagnostics: {
      status: knowledge.status,
      mode: knowledge.mode,
      source_count: Number(knowledge.source_count || 0),
      last_synced_at: knowledge.last_synced_at,
      categories: knowledge.categories || [],
      origins: knowledge.origins || [],
      social_profiles: knowledge.social_profiles || [],
      technical_note: knowledge.technical_note || "",
    },
    metrics: {
      talkers_public_hits: selected.length,
    },
  };
}

function getTalkersPublicKnowledgeDiagnostics() {
  if (!talkersKnowledgeState.sources.length) {
    return buildFallbackKnowledgeState();
  }
  return {
    status: talkersKnowledgeState.status,
    mode: talkersKnowledgeState.mode,
    last_synced_at: talkersKnowledgeState.last_synced_at,
    source_count: Number(talkersKnowledgeState.source_count || 0),
    categories: talkersKnowledgeState.categories || [],
    origins: talkersKnowledgeState.origins || [],
    alerts: talkersKnowledgeState.alerts || [],
    technical_note: talkersKnowledgeState.technical_note || "",
    social_profiles: talkersKnowledgeState.social_profiles || [],
  };
}

module.exports = {
  TALKERS_ROOT_URL,
  buildTalkersPublicKnowledgeBundle,
  getTalkersPublicKnowledgeDiagnostics,
  queryLooksAboutTalkers,
  syncTalkersPublicKnowledge,
};
