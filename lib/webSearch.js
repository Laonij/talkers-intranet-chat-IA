const axios = require("axios");
const cheerio = require("cheerio");

const REQUEST_HEADERS = {
  "User-Agent": "TalkersIA/1.0 (+https://talkersidiomas.com.br)",
  Accept: "application/json, text/html;q=0.9,*/*;q=0.8",
};

const TOOL_CACHE = new Map();
const WEB_CACHE_TTL_MS = 1000 * 60 * 5;
const FX_CACHE_TTL_MS = 1000 * 60 * 5;
const WEATHER_CACHE_TTL_MS = 1000 * 60 * 10;

const CURRENCY_ALIASES = new Map([
  ["usd", "USD"],
  ["dolar", "USD"],
  ["dolar americano", "USD"],
  ["dollar", "USD"],
  ["dólar", "USD"],
  ["dólar americano", "USD"],
  ["real", "BRL"],
  ["reais", "BRL"],
  ["brl", "BRL"],
  ["euro", "EUR"],
  ["eur", "EUR"],
  ["libra", "GBP"],
  ["libra esterlina", "GBP"],
  ["gbp", "GBP"],
  ["peso", "ARS"],
  ["ars", "ARS"],
]);

function stripDiacritics(value = "") {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function normalizeQuery(value = "") {
  return stripDiacritics(String(value || ""))
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function getCacheEntry(key) {
  const entry = TOOL_CACHE.get(key);
  if (!entry) return null;
  if (entry.expires_at <= Date.now()) {
    TOOL_CACHE.delete(key);
    return null;
  }
  return entry.value;
}

function setCacheEntry(key, value, ttlMs) {
  TOOL_CACHE.set(key, {
    value,
    expires_at: Date.now() + Math.max(1000, Number(ttlMs || 0)),
  });
  return value;
}

function compactText(value = "", limit = 1200) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .replace(/\u00a0/g, " ")
    .trim()
    .slice(0, limit);
}

function pushUniqueSource(list, source) {
  if (!Array.isArray(list) || !source) return;
  const normalized = {
    type: String(source.type || "web").trim() || "web",
    label: compactText(source.label || source.url || "Fonte externa", 140),
    url: String(source.url || "").trim(),
    excerpt: compactText(source.excerpt || "", 240),
  };
  const key = `${normalized.type}::${normalized.label}::${normalized.url}`;
  if (!normalized.label && !normalized.url) return;
  if (list.some((item) => `${item.type}::${item.label}::${item.url || ""}` === key)) return;
  list.push(normalized);
}

function queryLooksCurrent(value = "") {
  return /(hoje|agora|atual|atualizado|ultim|recente|cotacao|cota[cç][aã]o|preco|pre[cç]o|clima|tempo|resultado|placar|jogo|partida|ganhou|weather|today|current|latest|news|noticia|noticias|sports|score|match|won)/i.test(
    normalizeQuery(value)
  );
}

function extractCurrencyFromToken(token = "") {
  const normalized = normalizeQuery(token);
  if (!normalized) return "";
  if (CURRENCY_ALIASES.has(normalized)) return CURRENCY_ALIASES.get(normalized);
  if (/^[a-z]{3}$/i.test(normalized)) return normalized.toUpperCase();
  return "";
}

function detectCurrencyIntent(query = "") {
  const normalized = normalizeQuery(query);
  if (!normalized) return null;

  const pairMatch = normalized.match(/\b([a-z]{3})\s*(?:\/|-|para|to|em|versus)\s*([a-z]{3})\b/i);
  if (pairMatch) {
    const from = extractCurrencyFromToken(pairMatch[1]);
    const to = extractCurrencyFromToken(pairMatch[2]);
    if (from && to && from !== to) return { from, to };
  }

  const mentionsDollar = /\b(dolar|dólar|usd|dollar)\b/i.test(query);
  const mentionsReal = /\b(real|reais|brl)\b/i.test(query);
  const mentionsEuro = /\b(euro|eur)\b/i.test(query);
  const mentionsPound = /\b(libra|gbp)\b/i.test(query);
  const looksLikeFx = /(cotacao|cota[cç][aã]o|cambio|moeda|currency|vale|valor|quanto vale|exchange)/i.test(normalized);

  if (!looksLikeFx && !mentionsDollar && !mentionsReal && !mentionsEuro && !mentionsPound) return null;
  if (mentionsDollar) return { from: "USD", to: "BRL" };
  if (mentionsEuro) return { from: "EUR", to: "BRL" };
  if (mentionsPound) return { from: "GBP", to: "BRL" };
  return null;
}

function detectWeatherIntent(query = "") {
  const normalized = normalizeQuery(query);
  if (!/(clima|tempo|weather|temperatura|chuva|previsao|previsão)/i.test(normalized)) return null;

  const match = normalized.match(/\b(?:em|para|de|in)\s+([a-zà-ÿ\s-]{2,60})$/i) || normalized.match(/\b(?:em|para|de|in)\s+([a-zà-ÿ\s-]{2,60})\b/i);
  const location = compactText(match?.[1] || "", 80);
  if (!location) return null;
  return { location };
}

function formatCurrency(value, currency = "BRL") {
  const amount = Number(value || 0);
  if (!Number.isFinite(amount)) return "-";
  try {
    return new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 4,
    }).format(amount)
      .replace(/\u00a0/g, " ")
      .replace(/\u202f/g, " ");
  } catch {
    return amount.toFixed(4);
  }
}

function getCurrencyUnitLabel(code = "") {
  const safeCode = String(code || "").toUpperCase();
  if (safeCode === "USD") return "US$";
  if (safeCode === "BRL") return "R$";
  if (safeCode === "EUR") return "€";
  if (safeCode === "GBP") return "£";
  return safeCode || "Moeda";
}

function buildExchangeDirectAnswer(payload = {}, userLanguage = "pt") {
  const from = String(payload.from || "USD").toUpperCase();
  const to = String(payload.to || "BRL").toUpperCase();
  const bidLabel = from === "USD" && to === "BRL" ? "dólar americano" : `${from}/${to}`;
  const bidValue = formatCurrency(payload.bid, to);
  const askValue = formatCurrency(payload.ask, to);
  const highValue = formatCurrency(payload.high, to);
  const lowValue = formatCurrency(payload.low, to);
  const updatedAt = compactText(payload.updated_at || payload.create_date || "", 60);
  const baseRate = Number(payload.bid || payload.ask || 0);
  const askRate = Number(payload.ask || payload.bid || 0);
  const example100 = baseRate ? formatCurrency(baseRate * 100, to) : "-";
  const example10 = baseRate ? formatCurrency(baseRate * 10, to) : "-";
  const example1000 = baseRate ? formatCurrency(baseRate * 1000, to) : "-";
  const approximateRange = askValue && askValue !== bidValue ? `${bidValue} a ${askValue}` : bidValue;
  const fromLabel = getCurrencyUnitLabel(from);

  if (String(userLanguage || "pt").startsWith("en")) {
    return [
      `Today the **${bidLabel}** is around **${approximateRange}** per **1 ${from}** in the commercial market${updatedAt ? ` (updated ${updatedAt})` : ""}.`,
      "",
      "**Example conversions:**",
      `- ${fromLabel} 1 = approx. ${bidValue}`,
      `- ${fromLabel} 10 = approx. ${example10}`,
      `- ${fromLabel} 100 = approx. ${example100}`,
      `- ${fromLabel} 1,000 = approx. ${example1000}`,
      "",
      "**Notes:**",
      `- Today's range is ${lowValue} to ${highValue}.`,
      askRate && askRate !== baseRate ? `- Buy/sell spread is currently close to ${bidValue} / ${askValue}.` : null,
      "- The quote changes throughout the day with the market.",
    ].filter(Boolean).join("\n");
  }

  return [
    `Hoje o **${bidLabel}** está em torno de **${approximateRange}** por **1 ${from}** no câmbio comercial${updatedAt ? ` (atualizado em ${updatedAt})` : ""}.`,
    "",
    "**Exemplos de conversão:**",
    `- ${fromLabel} 1 = aprox. ${bidValue}`,
    `- ${fromLabel} 10 = aprox. ${example10}`,
    `- ${fromLabel} 100 = aprox. ${example100}`,
    `- ${fromLabel} 1.000 = aprox. ${example1000}`,
    "",
    "**Observações:**",
    `- A faixa do dia está entre ${lowValue} e ${highValue}.`,
    askRate && askRate !== baseRate ? `- Compra e venda estão próximas de ${bidValue} / ${askValue}.` : null,
    "- A cotação muda ao longo do dia conforme o mercado.",
    to === "BRL" ? "- Casas de câmbio, bancos e cartão internacional costumam operar com valores um pouco acima do mercado comercial." : null,
  ].filter(Boolean).join("\n");
}

async function fetchExchangeRateContext(query = "", { userLanguage = "pt" } = {}) {
  const intent = detectCurrencyIntent(query);
  if (!intent) return null;

  const cacheKey = `fx:${intent.from}:${intent.to}`;
  const cached = getCacheEntry(cacheKey);
  if (cached) return cached;

  const primaryUrl = `https://economia.awesomeapi.com.br/json/last/${intent.from}-${intent.to}`;
  const fallbackUrl = `https://api.frankfurter.app/latest?from=${intent.from}&to=${intent.to}`;

  try {
    const response = await axios.get(primaryUrl, {
      timeout: 5000,
      headers: REQUEST_HEADERS,
    });
    const data = response?.data || {};
    const key = `${intent.from}${intent.to}`;
    const row = data?.[key];
    if (!row) throw new Error("fx_row_missing");

    const payload = {
      from: intent.from,
      to: intent.to,
      bid: Number(row.bid || row.ask || row.high || 0),
      ask: Number(row.ask || row.bid || row.high || 0),
      high: Number(row.high || row.ask || row.bid || 0),
      low: Number(row.low || row.bid || row.ask || 0),
      updated_at: row.create_date || row.timestamp || "",
    };

    const result = {
      kind: "currency_api",
      text: [
        `[Cotação em tempo real aproximado: ${intent.from}/${intent.to}]`,
        `Compra: ${formatCurrency(payload.bid, intent.to)}`,
        `Venda: ${formatCurrency(payload.ask, intent.to)}`,
        `Faixa do dia: ${formatCurrency(payload.low, intent.to)} até ${formatCurrency(payload.high, intent.to)}`,
        payload.updated_at ? `Atualização: ${payload.updated_at}` : "",
        "Fonte primária: AwesomeAPI / mercado cambial.",
      ].filter(Boolean).join("\n"),
      sources: [{
        type: "data_api",
        label: `AwesomeAPI ${intent.from}/${intent.to}`,
        url: primaryUrl,
        excerpt: `${intent.from}/${intent.to} ${formatCurrency(payload.bid, intent.to)}${payload.updated_at ? ` • ${payload.updated_at}` : ""}`,
      }],
      metrics: {
        data_api_calls: 1,
        web_search_calls: 0,
        external_context_hits: 1,
        router: "currency_api",
      },
      direct_answer: buildExchangeDirectAnswer(payload, userLanguage),
    };

    return setCacheEntry(cacheKey, result, FX_CACHE_TTL_MS);
  } catch (primaryError) {
    try {
      const response = await axios.get(fallbackUrl, {
        timeout: 5000,
        headers: REQUEST_HEADERS,
      });
      const rate = Number(response?.data?.rates?.[intent.to] || 0);
      if (!rate) throw new Error("fx_rate_missing");
      const payload = {
        from: intent.from,
        to: intent.to,
        bid: rate,
        ask: rate,
        high: rate,
        low: rate,
        updated_at: response?.data?.date || "",
      };
      const result = {
        kind: "currency_api",
        text: [
          `[Cotação atual: ${intent.from}/${intent.to}]`,
          `Valor de referência: ${formatCurrency(rate, intent.to)}`,
          payload.updated_at ? `Data base: ${payload.updated_at}` : "",
          "Fonte de fallback: Frankfurter / ECB.",
        ].filter(Boolean).join("\n"),
        sources: [{
          type: "data_api",
          label: `Frankfurter ${intent.from}/${intent.to}`,
          url: fallbackUrl,
          excerpt: `${intent.from}/${intent.to} ${formatCurrency(rate, intent.to)}`,
        }],
        metrics: {
          data_api_calls: 1,
          web_search_calls: 0,
          external_context_hits: 1,
          router: "currency_api",
        },
        direct_answer: buildExchangeDirectAnswer(payload, userLanguage),
      };
      return setCacheEntry(cacheKey, result, FX_CACHE_TTL_MS);
    } catch (fallbackError) {
      console.log("Erro ao consultar cotacao:", primaryError?.message || primaryError, fallbackError?.message || fallbackError);
      return null;
    }
  }
}

async function fetchWeatherContext(query = "", { userLanguage = "pt" } = {}) {
  const intent = detectWeatherIntent(query);
  if (!intent?.location) return null;

  const cacheKey = `weather:${normalizeQuery(intent.location)}`;
  const cached = getCacheEntry(cacheKey);
  if (cached) return cached;

  try {
    const geoUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(intent.location)}&count=1&language=pt&format=json`;
    const geoResp = await axios.get(geoUrl, { timeout: 5000, headers: REQUEST_HEADERS });
    const place = Array.isArray(geoResp?.data?.results) ? geoResp.data.results[0] : null;
    if (!place) return null;

    const weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=${place.latitude}&longitude=${place.longitude}&current=temperature_2m,apparent_temperature,wind_speed_10m,relative_humidity_2m&timezone=America%2FSao_Paulo`;
    const weatherResp = await axios.get(weatherUrl, { timeout: 5000, headers: REQUEST_HEADERS });
    const current = weatherResp?.data?.current || {};
    if (!Object.keys(current).length) return null;

    const locationLabel = [place.name, place.admin1, place.country].filter(Boolean).join(", ");
    const temperature = Number(current.temperature_2m || 0);
    const feelsLike = Number(current.apparent_temperature || temperature);
    const humidity = Number(current.relative_humidity_2m || 0);
    const wind = Number(current.wind_speed_10m || 0);
    const updatedAt = compactText(current.time || "", 40);

    const result = {
      kind: "weather_api",
      text: [
        `[Clima atual: ${locationLabel}]`,
        `Temperatura: ${temperature.toFixed(1)}°C`,
        `Sensação térmica: ${feelsLike.toFixed(1)}°C`,
        humidity ? `Umidade: ${humidity.toFixed(0)}%` : "",
        wind ? `Vento: ${wind.toFixed(1)} km/h` : "",
        updatedAt ? `Atualização: ${updatedAt}` : "",
        "Fonte: Open-Meteo.",
      ].filter(Boolean).join("\n"),
      sources: [{
        type: "data_api",
        label: `Open-Meteo ${locationLabel}`,
        url: weatherUrl,
        excerpt: `${temperature.toFixed(1)}°C${humidity ? ` • ${humidity.toFixed(0)}% umidade` : ""}`,
      }],
      metrics: {
        data_api_calls: 1,
        web_search_calls: 0,
        external_context_hits: 1,
        router: "weather_api",
      },
      direct_answer: String(userLanguage || "pt").startsWith("en")
        ? `The current weather in ${locationLabel} is around ${temperature.toFixed(1)}°C, with feels-like temperature of ${feelsLike.toFixed(1)}°C.`
        : `O clima atual em ${locationLabel} está em torno de ${temperature.toFixed(1)}°C, com sensação térmica de ${feelsLike.toFixed(1)}°C.`,
    };

    return setCacheEntry(cacheKey, result, WEATHER_CACHE_TTL_MS);
  } catch (err) {
    console.log("Erro ao consultar clima:", err?.message || err);
    return null;
  }
}

function extractDuckDuckGoTopics(topics = [], out = []) {
  for (const item of Array.isArray(topics) ? topics : []) {
    if (item?.Text) out.push(item);
    if (Array.isArray(item?.Topics)) extractDuckDuckGoTopics(item.Topics, out);
  }
  return out;
}

async function searchWebDetailed(query = "") {
  const normalized = normalizeQuery(query);
  if (!normalized) {
    return {
      text: "",
      sources: [],
      metrics: {
        data_api_calls: 0,
        web_search_calls: 0,
        external_context_hits: 0,
        router: "none",
      },
    };
  }

  const cacheKey = `web:${normalized}`;
  const cached = getCacheEntry(cacheKey);
  if (cached) return cached;

  const sources = [];
  const lines = [];

  try {
    const ddgUrl = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_redirect=1&no_html=1&skip_disambig=1`;
    const response = await axios.get(ddgUrl, {
      timeout: 5000,
      headers: REQUEST_HEADERS,
    });
    const data = response?.data || {};
    if (data.Answer) lines.push(compactText(data.Answer, 220));
    if (data.AbstractText) lines.push(compactText(data.AbstractText, 320));
    if (data.Definition) lines.push(compactText(data.Definition, 220));
    pushUniqueSource(sources, {
      type: "web",
      label: data.Heading || "DuckDuckGo Instant Answer",
      url: data.AbstractURL || ddgUrl,
      excerpt: data.AbstractText || data.Answer || data.Definition || "",
    });

    const related = extractDuckDuckGoTopics(data.RelatedTopics || []).slice(0, 5);
    related.forEach((topic) => {
      if (topic?.Text) lines.push(`- ${compactText(topic.Text, 200)}`);
      pushUniqueSource(sources, {
        type: "web",
        label: topic?.FirstURL || "Resultado relacionado",
        url: topic?.FirstURL || "",
        excerpt: topic?.Text || "",
      });
    });
  } catch (err) {
    console.log("Erro no instant answer:", err?.message || err);
  }

  if (lines.length < 3) {
    try {
      const htmlUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
      const response = await axios.get(htmlUrl, {
        timeout: 6000,
        headers: {
          ...REQUEST_HEADERS,
          Accept: "text/html,application/xhtml+xml",
        },
      });
      const $ = cheerio.load(String(response?.data || ""));
      const results = [];

      $(".result").each((_, element) => {
        if (results.length >= 5) return false;
        const title = compactText($(element).find(".result__title a, .result__a").first().text(), 160);
        const url = $(element).find(".result__title a, .result__a").first().attr("href") || "";
        const snippet = compactText($(element).find(".result__snippet").first().text(), 220);
        if (!title && !snippet) return;
        results.push({ title, url, snippet });
        return undefined;
      });

      results.forEach((item) => {
        lines.push(`- ${item.title || "Resultado"}${item.snippet ? `: ${item.snippet}` : ""}`);
        pushUniqueSource(sources, {
          type: "web",
          label: item.title || item.url || "Resultado web",
          url: item.url || "",
          excerpt: item.snippet || "",
        });
      });
    } catch (err) {
      console.log("Erro no HTML search:", err?.message || err);
    }
  }

  const text = lines.filter(Boolean).slice(0, 8).join("\n");
  const result = {
    kind: "web_search",
    text,
    sources: sources.slice(0, 8),
    metrics: {
      data_api_calls: 0,
      web_search_calls: text ? 1 : 0,
      external_context_hits: text ? 1 : 0,
      router: text ? "web_search" : "none",
    },
  };
  return setCacheEntry(cacheKey, result, WEB_CACHE_TTL_MS);
}

async function resolveExternalToolContext(query = "", options = {}) {
  const userLanguage = options.userLanguage || "pt";

  const exchange = await fetchExchangeRateContext(query, { userLanguage });
  if (exchange?.text) return exchange;

  const weather = await fetchWeatherContext(query, { userLanguage });
  if (weather?.text) return weather;

  if (!queryLooksCurrent(query) && !options.forceWebSearch) {
    return {
      kind: "none",
      text: "",
      sources: [],
      metrics: {
        data_api_calls: 0,
        web_search_calls: 0,
        external_context_hits: 0,
        router: "none",
      },
    };
  }

  return searchWebDetailed(query);
}

async function searchWeb(query = "") {
  const result = await searchWebDetailed(query);
  return result.text || "";
}

module.exports = {
  searchWeb,
  resolveExternalToolContext,
  queryLooksCurrent,
};
