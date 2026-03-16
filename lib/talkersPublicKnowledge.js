const axios = require("axios");
const cheerio = require("cheerio");

const { repairMojibakeText } = require("./language");

const TALKERS_ROOT_URL = "https://talkersidiomas.com.br/";
const TALKERS_CACHE_TTL_MS = 1000 * 60 * 60 * 6;
const TALKERS_HTTP_TIMEOUT_MS = Math.max(5000, Number(process.env.TALKERS_PUBLIC_TIMEOUT_MS || 30000));

const REQUEST_HEADERS = {
  "User-Agent": "TalkersIA/1.0 (+https://talkersidiomas.com.br)",
  Accept: "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
};

const TALKERS_PUBLIC_FACTS = {
  school:
    "A Talkers Idiomas é uma escola brasileira de idiomas fundada em 2005, com unidades em Farroupilha e Taquara e operação também em cursos online.",
  purpose:
    "A marca comunica como propósito transformar vidas por meio do ensino de idiomas.",
  methodology:
    "A metodologia pública da Talkers é apresentada como prática, interativa e focada em destravar a comunicação real do aluno, com aplicação do idioma no dia a dia.",
  differentiators: [
    "aulas dinâmicas com foco em comunicação real",
    "aplicação prática do idioma no cotidiano",
    "materiais internacionais e ambiente acolhedor",
  ],
  languages: [
    "Inglês",
    "Espanhol",
    "Francês",
    "Italiano",
    "Alemão",
    "Chinês",
    "Japonês",
    "Português para estrangeiros",
  ],
  formats: [
    "aulas VIP",
    "cursos online",
    "preparação para viagens",
    "preparação para testes de proficiência",
  ],
  phone: "(54) 3268-3377",
  whatsapp: "(54) 9 9156-8495",
  emails: [
    "contato@talkersidiomas.com.br",
    "adm@talkersidiomas.com.br",
    "pedagogico@talkersidiomas.com.br",
    "matriculas@talkersidiomas.com.br",
  ],
  units: [
    "Farroupilha: Rua Carlos Dreher Neto, 305, sala 801, Bairro do Parque.",
    "Taquara: Avenida Julio de Castilhos, 2903, sala 2, Centro.",
  ],
  socialProfiles: [
    { label: "Instagram", handle: "@talkersidiomas", url: "https://www.instagram.com/talkersidiomas/" },
    { label: "Facebook", handle: "Talkers Idiomas", url: "https://www.facebook.com/Talkersidiomas/" },
    { label: "YouTube", handle: "@TalkersIdiomas", url: "https://www.youtube.com/@TalkersIdiomas" },
  ],
};

const TALKERS_FALLBACK_SOURCES = [
  {
    curated: true,
    category: "institutional",
    title: "Talkers Idiomas - site oficial",
    url: "https://talkersidiomas.com.br/",
    summary:
      "A Talkers Idiomas é uma escola brasileira de idiomas fundada em 2005, com unidades em Farroupilha e Taquara, além de cursos online.",
  },
  {
    curated: true,
    category: "institutional",
    title: "Propósito da marca - Talkers Idiomas",
    url: "https://talkersidiomas.com.br/",
    summary:
      "A marca comunica como propósito transformar vidas por meio do ensino de idiomas e conectar alunos a experiências reais de comunicação.",
  },
  {
    curated: true,
    category: "methodology",
    title: "Sobre nós - Talkers Idiomas",
    url: "https://talkersidiomas.com.br/sobre-nos/",
    summary:
      "A metodologia pública da Talkers é apresentada como prática, interativa e focada em destravar a comunicação real do aluno, com aulas dinâmicas e aplicação do idioma no dia a dia.",
  },
  {
    curated: true,
    category: "courses",
    title: "Idiomas e formatos - Talkers Idiomas",
    url: "https://talkersidiomas.com.br/idiomas/",
    summary:
      "Nas páginas públicas, a Talkers apresenta cursos de inglês, espanhol, francês, italiano, alemão, chinês, japonês e português para estrangeiros, além de aulas VIP, cursos online, preparação para viagens e preparação para testes de proficiência.",
  },
  {
    curated: true,
    category: "contact",
    title: "Contato oficial Talkers",
    url: "https://talkersidiomas.com.br/contato/",
    summary:
      "Contato público oficial: telefone (54) 3268-3377, WhatsApp (54) 9 9156-8495, e-mails contato@talkersidiomas.com.br, adm@talkersidiomas.com.br, pedagogico@talkersidiomas.com.br e matriculas@talkersidiomas.com.br.",
  },
  {
    curated: true,
    category: "units",
    title: "Unidades da Talkers",
    url: "https://talkersidiomas.com.br/contato/",
    summary:
      "A unidade de Farroupilha fica na Rua Carlos Dreher Neto, 305, sala 801, Bairro do Parque. A unidade de Taquara fica na Avenida Julio de Castilhos, 2903, sala 2, Centro.",
  },
  {
    curated: true,
    category: "digital_presence",
    title: "Instagram oficial Talkers",
    url: "https://www.instagram.com/talkersidiomas/",
    summary: "Perfil oficial público da marca no Instagram: @talkersidiomas.",
  },
  {
    curated: true,
    category: "digital_presence",
    title: "Facebook oficial Talkers",
    url: "https://www.facebook.com/Talkersidiomas/",
    summary: "Página oficial pública da marca no Facebook: Talkers Idiomas.",
  },
  {
    curated: true,
    category: "digital_presence",
    title: "YouTube oficial Talkers",
    url: "https://www.youtube.com/@TalkersIdiomas",
    summary: "Canal oficial público da marca no YouTube: @TalkersIdiomas.",
  },
];

const talkersKnowledgeState = {
  status: "seed",
  mode: "seed",
  last_synced_at: null,
  source_count: TALKERS_FALLBACK_SOURCES.length,
  sources: TALKERS_FALLBACK_SOURCES,
  categories: Array.from(new Set(TALKERS_FALLBACK_SOURCES.map((source) => source.category))),
  origins: Array.from(new Set(TALKERS_FALLBACK_SOURCES.map((source) => source.url))),
  alerts: [],
  technical_note: "Base pública oficial em seed local, pronta para sincronização em segundo plano.",
  social_profiles: TALKERS_PUBLIC_FACTS.socialProfiles.map((profile) => ({
    label: profile.label,
    url: profile.url,
  })),
};

let talkersSyncPromise = null;

function buildAxiosErrorDetails(err, extra = {}) {
  return {
    message: err?.message || String(err || "unknown_error"),
    code: err?.code || err?.cause?.code || "",
    status: err?.response?.status || null,
    url: err?.config?.url || extra.url || "",
    ...extra,
  };
}

async function axiosGetWithRetry(url, config = {}, diagnostics = {}, retryCount = 1) {
  let lastError = null;
  for (let attempt = 0; attempt <= retryCount; attempt += 1) {
    try {
      return await axios.get(url, {
        timeout: TALKERS_HTTP_TIMEOUT_MS,
        ...config,
      });
    } catch (err) {
      lastError = err;
      const details = buildAxiosErrorDetails(err, {
        attempt: attempt + 1,
        timeout_ms: TALKERS_HTTP_TIMEOUT_MS,
        url,
        ...diagnostics,
      });
      if (attempt < retryCount) {
        console.warn("Falha na busca pública da Talkers; tentando novamente.", details);
        continue;
      }
      throw Object.assign(err instanceof Error ? err : new Error(String(err || "axios_request_failed")), {
        diagnostics: details,
      });
    }
  }
  throw lastError || new Error("axios_request_failed");
}

function stripDiacritics(value = "") {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function normalizeText(value = "") {
  return stripDiacritics(repairMojibakeText(String(value || "")))
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function compactText(value = "", limit = 560) {
  return repairMojibakeText(String(value || ""))
    .replace(/\u00a0/g, " ")
    .replace(/\u202f/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, limit);
}

function dedupeStrings(values = []) {
  return Array.from(
    new Set(
      (Array.isArray(values) ? values : [])
        .map((value) => String(value || "").trim())
        .filter(Boolean)
    )
  );
}

function classifyPage(url = "", text = "") {
  const normalized = normalizeText(`${url} ${text}`);
  if (/(contato|whatsapp|telefone|endereco|fale)/i.test(normalized)) return "contact";
  if (/(metodologia|metodo|abordagem|imersao|experiencia)/i.test(normalized)) return "methodology";
  if (/(curso|cursos|idioma|ingles|espanhol|italiano|frances|alemao|online|vip|proficiencia)/i.test(normalized)) return "courses";
  if (/(unidade|unidades|farroupilha|taquara|endereco)/i.test(normalized)) return "units";
  if (/(instagram|youtube|facebook|social|rede social)/i.test(normalized)) return "digital_presence";
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
  if (source?.curated) score += 2;
  if (/(curso|cursos|idioma|metodologia|contato|instagram|facebook|youtube|site|unidade|online|telefone|whatsapp)/.test(normalizedQuery)) {
    score += 1;
  }

  return score;
}

function buildFallbackKnowledgeState(errorMessage = "") {
  return {
    status: errorMessage ? "fallback" : "seed",
    mode: "seed",
    last_synced_at: talkersKnowledgeState.last_synced_at || null,
    source_count: TALKERS_FALLBACK_SOURCES.length,
    sources: TALKERS_FALLBACK_SOURCES,
    categories: dedupeStrings(TALKERS_FALLBACK_SOURCES.map((source) => source.category)),
    origins: dedupeStrings(TALKERS_FALLBACK_SOURCES.map((source) => source.url)),
    alerts: errorMessage ? [errorMessage] : [],
    technical_note: errorMessage
      ? "Falha ao sincronizar automaticamente a base pública da Talkers. O seed oficial local foi mantido."
      : "Base pública oficial da Talkers em seed local.",
    social_profiles: talkersKnowledgeState.social_profiles,
  };
}

function detectTalkersQuestionIntent(query = "") {
  const normalized = normalizeText(query);
  if (!normalized) return "overview";
  if (/(me fale|fala|fale|sobre a talkers|sobre talkers|o que e|o que é|quem e|quem é|apresente|resuma a talkers|explique a talkers)/i.test(normalized)) return "overview";
  if (/(metodologia|metodo|m[eé]todo|como ensina|como funciona|diferencial|diferenciais|abordagem)/i.test(normalized)) {
    return "methodology";
  }
  if (/(telefone|whatsapp|contato|email|e-mail|endereco|endereço|unidade|unidades|onde fica|localizacao|localização)/i.test(normalized)) {
    return "contact";
  }
  if (/(instagram|facebook|youtube|rede social|redes sociais|site|blog|post|posts|conteudo|conteúdo)/i.test(normalized)) {
    return "digital";
  }
  if (/(quais.*idiom|idiomas?.*(ensina|oferece|trabalha|tem)|tipos? de idiomas?|curso|cursos|modalidade|modalidades|formato|formatos)/i.test(normalized)) {
    return "courses";
  }
  return "overview";
}

function selectTalkersSourcesForQuery(sources = [], query = "", limit = 5) {
  const ranked = (Array.isArray(sources) ? sources : [])
    .map((source) => ({
      ...source,
      score: scoreSourceForQuery(source, query),
    }))
    .sort((left, right) => {
      const scoreDiff = Number(right.score || 0) - Number(left.score || 0);
      if (scoreDiff !== 0) return scoreDiff;
      return Number(Boolean(right.curated)) - Number(Boolean(left.curated));
    });

  const normalizedQuery = normalizeText(query);
  const genericTalkersQuery = !/(metodologia|curso|cursos|contato|telefone|whatsapp|instagram|facebook|youtube|endereco|unidade|unidades|online|vip|proficiencia)/.test(normalizedQuery);
  if (!genericTalkersQuery) {
    return ranked.slice(0, Math.max(1, Number(limit || 5)));
  }

  const desiredCategories = ["institutional", "methodology", "courses", "contact", "digital_presence"];
  const selected = [];
  desiredCategories.forEach((category) => {
    const match = ranked.find((source) => source.category === category && !selected.some((item) => item.url === source.url && item.title === source.title));
    if (match) selected.push(match);
  });

  for (const source of ranked) {
    if (selected.length >= Math.max(1, Number(limit || 5))) break;
    if (selected.some((item) => item.url === source.url && item.title === source.title)) continue;
    selected.push(source);
  }

  return selected;
}

function mergeTalkersSources(primarySources = [], secondarySources = []) {
  const merged = [];
  const push = (source) => {
    if (!source?.url && !source?.title) return;
    const key = `${String(source.url || "").trim()}::${String(source.title || "").trim()}`;
    if (merged.some((item) => `${String(item.url || "").trim()}::${String(item.title || "").trim()}` === key)) return;
    merged.push({
      ...source,
      title: repairMojibakeText(String(source.title || "")),
      summary: repairMojibakeText(String(source.summary || "")),
    });
  };

  (Array.isArray(primarySources) ? primarySources : []).forEach(push);
  (Array.isArray(secondarySources) ? secondarySources : []).forEach(push);
  return merged;
}

function buildTalkersDirectAnswer(selectedSources = [], userLanguage = "pt", query = "") {
  const byCategory = new Map();
  (Array.isArray(selectedSources) ? selectedSources : []).forEach((source) => {
    if (!source?.category || byCategory.has(source.category)) return;
    byCategory.set(source.category, source);
  });

  const institutional = byCategory.get("institutional");
  const methodology = byCategory.get("methodology");
  const courses = byCategory.get("courses");
  const contact = byCategory.get("contact");
  const units = byCategory.get("units");
  const digital = byCategory.get("digital_presence");
  const intent = detectTalkersQuestionIntent(query);

  if (String(userLanguage || "pt").startsWith("en")) {
    return [
      "Here is a structured summary about **Talkers Idiomas** based on its official public sources:",
      "",
      "## What Talkers is",
      institutional?.summary || TALKERS_PUBLIC_FACTS.school,
      TALKERS_PUBLIC_FACTS.purpose,
      "",
      "## Methodology",
      methodology?.summary || TALKERS_PUBLIC_FACTS.methodology,
      "",
      "## Languages and formats",
      courses?.summary || `Public pages mention ${TALKERS_PUBLIC_FACTS.languages.join(", ")} and formats such as ${TALKERS_PUBLIC_FACTS.formats.join(", ")}.`,
      "",
      "## Contact and units",
      contact?.summary || `Phone ${TALKERS_PUBLIC_FACTS.phone} and WhatsApp ${TALKERS_PUBLIC_FACTS.whatsapp}.`,
      units?.summary || TALKERS_PUBLIC_FACTS.units.join(" "),
      "",
      "✅ If you want, I can also organize this by student profile, contact channel, or course format.",
    ].filter(Boolean).join("\n");
  }

  if (intent === "courses") {
    return [
      "Aqui vai a resposta mais direta sobre os idiomas da **Talkers Idiomas**:",
      "",
      `Hoje, nas fontes públicas da marca, aparecem estes idiomas: ${TALKERS_PUBLIC_FACTS.languages.join(", ")}.`,
      "",
      "## Formatos que também aparecem publicamente",
      ...TALKERS_PUBLIC_FACTS.formats.map((item) => `- ${item}`),
      "",
      "## Leitura rápida",
      courses?.summary || "A marca apresenta uma grade variada de idiomas e formatos flexíveis para diferentes perfis de aluno.",
      "",
      "✅ Se quiser, eu também posso:",
      "- separar os idiomas por perfil de aluno ou objetivo",
      "- montar uma resposta comercial mais persuasiva sobre os cursos",
      "- organizar isso em formato de texto para site, apresentação ou redes sociais",
    ].join("\n");
  }

  if (intent === "methodology") {
    return [
      "Aqui vai um resumo focado na **metodologia da Talkers Idiomas**:",
      "",
      methodology?.summary || TALKERS_PUBLIC_FACTS.methodology,
      "",
      "## O que a proposta da escola enfatiza",
      ...TALKERS_PUBLIC_FACTS.differentiators.map((item) => `- ${item}`),
      "",
      "✅ Se quiser, eu também posso:",
      "- transformar isso em um texto institucional mais forte",
      "- comparar a metodologia da Talkers com escolas mais tradicionais",
      "- resumir a proposta em linguagem comercial ou pedagógica",
    ].join("\n");
  }

  if (intent === "contact") {
    return [
      "Aqui estão os principais **contatos e pontos de atendimento da Talkers Idiomas**:",
      "",
      `- Telefone: ${TALKERS_PUBLIC_FACTS.phone}`,
      `- WhatsApp: ${TALKERS_PUBLIC_FACTS.whatsapp}`,
      `- E-mails: ${TALKERS_PUBLIC_FACTS.emails.join(", ")}`,
      "",
      "## Unidades",
      ...TALKERS_PUBLIC_FACTS.units.map((item) => `- ${item}`),
      "",
      "✅ Se quiser, eu também posso:",
      "- montar um bloco pronto com site, telefone, WhatsApp e redes sociais",
      "- organizar os canais por tipo de atendimento",
      "- criar uma versão curta para bio, card ou apresentação",
    ].join("\n");
  }

  if (intent === "digital") {
    return [
      "Aqui vai um panorama rápido da **presença digital da Talkers Idiomas**:",
      "",
      ...TALKERS_PUBLIC_FACTS.socialProfiles.map((item) => `- ${item.label}: ${item.handle} - ${item.url}`),
      "",
      digital?.summary || "A marca mantém presença pública identificável nos principais canais institucionais e sociais.",
      "",
      "✅ Se quiser, eu também posso:",
      "- organizar os links oficiais em um bloco pronto para divulgação",
      "- sugerir melhorias de apresentação digital da marca",
      "- montar um resumo com Instagram, Facebook, YouTube, site e contatos",
    ].join("\n");
  }

  return [
    "Aqui vai uma visão mais clara e completa da **Talkers Idiomas**, com base nas fontes públicas oficiais:",
    "",
    "## O que é a Talkers",
    institutional?.summary || TALKERS_PUBLIC_FACTS.school,
    TALKERS_PUBLIC_FACTS.purpose,
    "",
    "## Metodologia",
    methodology?.summary || TALKERS_PUBLIC_FACTS.methodology,
    "",
    "## Idiomas e formatos",
    courses?.summary || `A escola apresenta publicamente estes idiomas: ${TALKERS_PUBLIC_FACTS.languages.join(", ")}.`,
    "",
    "## Contato e unidades",
    contact?.summary || `Telefone ${TALKERS_PUBLIC_FACTS.phone} e WhatsApp ${TALKERS_PUBLIC_FACTS.whatsapp}.`,
    units?.summary || TALKERS_PUBLIC_FACTS.units.join(" "),
    "",
    "## Presença digital",
    digital?.summary || "Perfis públicos oficiais identificados em Instagram, Facebook e YouTube.",
    "",
    "## O que chama atenção",
    "- proposta de ensino prática e aplicável no dia a dia",
    "- variedade de idiomas e formatos",
    "- presença digital oficial e canais claros de contato",
    "",
    "✅ Se quiser, eu também posso:",
    "- detalhar a metodologia da Talkers",
    "- listar apenas os idiomas e modalidades",
    "- montar um resumo com telefone, WhatsApp, e-mails e redes sociais",
    "- sugerir melhorias de apresentação institucional ou comercial",
  ].join("\n");
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
    "idioma",
    "ingles",
    "online",
    "metod",
    "fale",
    "escola",
    "taquara",
    "farroupilha",
  ];

  return dedupeStrings(links)
    .map((url) => ({
      url,
      score: priorityTokens.reduce((total, token) => (url.includes(token) ? total + 1 : total), 0),
    }))
    .sort((left, right) => Number(right.score || 0) - Number(left.score || 0))
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
    if (!/(instagram\.com|youtube\.com|facebook\.com|wa\.me|api\.whatsapp\.com|whatsapp\.com)/i.test(resolved)) return;
    const label = compactText($(element).text() || $(element).attr("aria-label") || resolved, 120);
    profiles.push({ label: label || resolved, url: resolved });
  });
  return profiles;
}

async function fetchTalkersPage(url) {
  const response = await axiosGetWithRetry(url, {
    headers: REQUEST_HEADERS,
  }, {
    label: "talkers_public_page",
  });
  const html = String(response?.data || "");
  const $ = cheerio.load(html);
  $("script, style, noscript").remove();

  const title = compactText($("title").first().text(), 180);
  const metaDescription = compactText(
    $('meta[name="description"]').attr("content")
      || $('meta[property="og:description"]').attr("content")
      || "",
    260
  );
  const headings = dedupeStrings(
    $("h1, h2")
      .slice(0, 12)
      .map((_, element) => compactText($(element).text(), 120))
      .get()
  );
  const bodyText = compactText($("body").text(), 720);
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
          console.error("Falha ao sincronizar página pública da Talkers:", buildAxiosErrorDetails(err, {
            label: "talkers_public_page",
            url: link,
          }));
        }
      }

      const sources = pages.map((page) => {
        const category = classifyPage(page.url, `${page.title} ${page.metaDescription} ${page.headings.join(" ")}`);
        const summary = compactText(
          [page.metaDescription, page.headings.join(" • "), page.bodyText.slice(0, 320)].filter(Boolean).join(" "),
          520
        );
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
      console.error("Falha ao sincronizar base pública da Talkers:", buildAxiosErrorDetails(err, {
        label: "talkers_public_sync",
        url: TALKERS_ROOT_URL,
      }));
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
  talkersSyncPromise = syncTalkersPublicKnowledge({ force: false }).catch(() => null);
  return talkersSyncPromise;
}

function queryLooksAboutTalkers(query = "") {
  const normalized = normalizeText(query);
  if (!normalized) return false;
  return /(talkers|talkers idiomas|escola talkers|site da talkers|instagram da talkers|facebook da talkers|youtube da talkers|contato da talkers|metodologia da talkers|cursos da talkers|idiomas da talkers|unidades da talkers|telefone da talkers|whatsapp da talkers|onde fica a talkers|a talkers oferece)/i.test(normalized);
}

async function buildTalkersPublicKnowledgeBundle(query = "", { limit = 5, userLanguage = "pt" } = {}) {
  if (!queryLooksAboutTalkers(query)) {
    return {
      text: "",
      direct_answer: "",
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

  const knowledge = hasWarmKnowledge ? talkersKnowledgeState : buildFallbackKnowledgeState();
  if (!hasWarmKnowledge || !isFresh) {
    scheduleTalkersKnowledgeSync();
  }

  const mergedSources = mergeTalkersSources(TALKERS_FALLBACK_SOURCES, knowledge.sources || []);
  const selected = selectTalkersSourcesForQuery(mergedSources, query, limit);

  return {
    text: selected
      .map((source) => `[Base pública oficial Talkers: ${repairMojibakeText(source.title)}]\n${repairMojibakeText(compactText(source.summary, 380))}`)
      .join("\n\n"),
    direct_answer: repairMojibakeText(buildTalkersDirectAnswer(selected, userLanguage, query)),
    sources: selected.map((source) => ({
      type: "talkers_public",
      label: repairMojibakeText(source.title),
      url: source.url,
      excerpt: repairMojibakeText(compactText(source.summary, 220)),
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
  scheduleTalkersKnowledgeSync,
  syncTalkersPublicKnowledge,
};
