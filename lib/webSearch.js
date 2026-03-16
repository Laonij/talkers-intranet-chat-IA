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
const EXTERNAL_HTTP_TIMEOUT_MS = Math.max(5000, Number(process.env.EXTERNAL_HTTP_TIMEOUT_MS || 30000));

const CURRENCY_ALIASES = new Map([
  ["usd", "USD"],
  ["dolar", "USD"],
  ["dólar", "USD"],
  ["dolar americano", "USD"],
  ["dólar americano", "USD"],
  ["dollar", "USD"],
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

function compactText(value = "", limit = 1200) {
  return String(value || "")
    .replace(/\u00a0/g, " ")
    .replace(/\u202f/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, limit);
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
        timeout: EXTERNAL_HTTP_TIMEOUT_MS,
        ...config,
      });
    } catch (err) {
      lastError = err;
      const details = buildAxiosErrorDetails(err, {
        attempt: attempt + 1,
        timeout_ms: EXTERNAL_HTTP_TIMEOUT_MS,
        url,
        ...diagnostics,
      });
      if (attempt < retryCount) {
        console.warn("Falha em API externa; tentando novamente.", details);
        continue;
      }
      throw Object.assign(err instanceof Error ? err : new Error(String(err || "axios_request_failed")), {
        diagnostics: details,
      });
    }
  }
  throw lastError || new Error("axios_request_failed");
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
  return /(hoje|agora|atual|atualizado|ultimo|último|ultimos|últimos|recente|cotacao|cotação|preco|preço|clima|tempo|resultado|placar|jogo|partida|ganhou|weather|today|current|latest|news|noticia|notícia|noticias|notícias|sports|score|match|won)/i.test(
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
  const looksLikeFx = /(cotacao|cotação|cambio|câmbio|moeda|currency|vale|valor|quanto vale|exchange)/i.test(normalized);

  if (!looksLikeFx && !mentionsDollar && !mentionsReal && !mentionsEuro && !mentionsPound) return null;
  if (mentionsDollar) return { from: "USD", to: mentionsReal ? "BRL" : "BRL" };
  if (mentionsEuro) return { from: "EUR", to: "BRL" };
  if (mentionsPound) return { from: "GBP", to: "BRL" };
  return null;
}

function detectWeatherIntent(query = "") {
  const normalized = normalizeQuery(query);
  if (!/(clima|tempo|weather|temperatura|chuva|previsao|previsão)/i.test(normalized)) return null;

  const match = normalized.match(/\b(?:em|para|de|in)\s+([a-zà-ÿ\s-]{2,60})$/i)
    || normalized.match(/\b(?:em|para|de|in)\s+([a-zà-ÿ\s-]{2,60})\b/i);
  const location = compactText(match?.[1] || "", 80);
  if (!location) return null;
  return { location };
}

function formatCurrency(value, currency = "BRL", maxFractionDigits = 4) {
  const amount = Number(value || 0);
  if (!Number.isFinite(amount)) return "-";
  try {
    return new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: maxFractionDigits,
    }).format(amount)
      .replace(/\u00a0/g, " ")
      .replace(/\u202f/g, " ");
  } catch {
    return amount.toFixed(Math.min(4, maxFractionDigits));
  }
}

function formatCurrencyAmount(value, currency = "BRL") {
  return formatCurrency(value, currency, 2);
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
  const bidLabel = from === "USD" && to === "BRL" ? "dólar americano (USD)" : `${from}/${to}`;
  const bidValue = formatCurrency(payload.bid, to, 4);
  const askValue = formatCurrency(payload.ask, to, 4);
  const highValue = formatCurrency(payload.high, to, 4);
  const lowValue = formatCurrency(payload.low, to, 4);
  const updatedAt = compactText(payload.updated_at || payload.create_date || "", 60);
  const baseRate = Number(payload.bid || payload.ask || 0);
  const askRate = Number(payload.ask || payload.bid || 0);
  const example10 = baseRate ? formatCurrencyAmount(baseRate * 10, to) : "-";
  const example100 = baseRate ? formatCurrencyAmount(baseRate * 100, to) : "-";
  const example1000 = baseRate ? formatCurrencyAmount(baseRate * 1000, to) : "-";
  const approximateRange = askRate && askRate !== baseRate ? `${bidValue} a ${askValue}` : bidValue;
  const fromLabel = getCurrencyUnitLabel(from);
  const hasVisibleRange = lowValue && highValue && lowValue !== highValue;

  if (String(userLanguage || "pt").startsWith("en")) {
    return [
      `Today the **${bidLabel}** is around **${approximateRange}** for **1 ${from}** in the commercial exchange market${updatedAt ? ` (updated ${updatedAt})` : ""}.`,
      "",
      "## Example conversions",
      `- ${fromLabel} 1 = approx. ${bidValue}`,
      `- ${fromLabel} 10 = approx. ${example10}`,
      `- ${fromLabel} 100 = approx. ${example100}`,
      `- ${fromLabel} 1,000 = approx. ${example1000}`,
      "",
      "## Notes",
      hasVisibleRange ? `- Today's range is ${lowValue} to ${highValue}.` : `- The reference quote is close to ${bidValue}.`,
      askRate && askRate !== baseRate ? `- Buy and sell levels are close to ${bidValue} / ${askValue}.` : null,
      "- Exchange values move throughout the day with the market.",
      to === "BRL" ? "- Banks, exchange offices and international cards usually operate a bit above the commercial market." : null,
      "",
      "✅ If you want, I can also show:",
      "- how much BRL 1,000 or BRL 10,000 is worth in dollars",
      "- a quick recent USD/BRL trend summary",
      "- the difference between commercial and tourism rates",
    ].filter(Boolean).join("\n");
  }

  return [
    `Hoje o **${bidLabel}** está em torno de **${approximateRange}** por **1 ${from}** no câmbio comercial${updatedAt ? ` (atualizado em ${updatedAt})` : ""}.`,
    "",
    "## 💱 Exemplos de conversão",
    `- ${fromLabel} 1 = aprox. ${bidValue}`,
    `- ${fromLabel} 10 = aprox. ${example10}`,
    `- ${fromLabel} 100 = aprox. ${example100}`,
    `- ${fromLabel} 1.000 = aprox. ${example1000}`,
    "",
    "## 📌 Observações",
    hasVisibleRange ? `- A faixa do dia está entre ${lowValue} e ${highValue}.` : `- A cotação de referência está perto de ${bidValue}.`,
    askRate && askRate !== baseRate ? `- Compra e venda estão próximas de ${bidValue} / ${askValue}.` : null,
    "- A cotação muda ao longo do dia conforme o mercado.",
    to === "BRL" ? "- Casas de câmbio, bancos e cartão internacional costumam operar com valores um pouco acima do mercado comercial." : null,
    "",
    "✅ Se quiser, posso também te mostrar:",
    "- quanto R$ 1.000 ou R$ 10.000 valem em dólar",
    "- uma leitura rápida da tendência recente do USD/BRL",
    "- a comparação entre dólar comercial e turismo",
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
      const response = await axiosGetWithRetry(primaryUrl, {
        headers: REQUEST_HEADERS,
      }, {
        label: "fx_primary",
      });
    const row = response?.data?.[`${intent.from}${intent.to}`];
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

    return setCacheEntry(cacheKey, {
      kind: "currency_api",
      text: [
        `[Cotação em tempo real aproximada: ${intent.from}/${intent.to}]`,
        `Compra: ${formatCurrency(payload.bid, intent.to, 4)}`,
        `Venda: ${formatCurrency(payload.ask, intent.to, 4)}`,
        `Faixa do dia: ${formatCurrency(payload.low, intent.to, 4)} até ${formatCurrency(payload.high, intent.to, 4)}`,
        payload.updated_at ? `Atualização: ${payload.updated_at}` : "",
        "Fonte primária: AwesomeAPI / mercado cambial.",
      ].filter(Boolean).join("\n"),
      sources: [{
        type: "data_api",
        label: `AwesomeAPI ${intent.from}/${intent.to}`,
        url: primaryUrl,
        excerpt: `${intent.from}/${intent.to} ${formatCurrency(payload.bid, intent.to, 4)}${payload.updated_at ? ` • ${payload.updated_at}` : ""}`,
      }],
      metrics: {
        data_api_calls: 1,
        web_search_calls: 0,
        external_context_hits: 1,
        router: "currency_api",
      },
      direct_answer: buildExchangeDirectAnswer(payload, userLanguage),
    }, FX_CACHE_TTL_MS);
  } catch (primaryError) {
    try {
      const response = await axiosGetWithRetry(fallbackUrl, {
        headers: REQUEST_HEADERS,
      }, {
        label: "fx_fallback",
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

      return setCacheEntry(cacheKey, {
        kind: "currency_api",
        text: [
          `[Cotação atual: ${intent.from}/${intent.to}]`,
          `Valor de referência: ${formatCurrency(rate, intent.to, 4)}`,
          payload.updated_at ? `Data base: ${payload.updated_at}` : "",
          "Fonte de fallback: Frankfurter / ECB.",
        ].filter(Boolean).join("\n"),
        sources: [{
          type: "data_api",
          label: `Frankfurter ${intent.from}/${intent.to}`,
          url: fallbackUrl,
          excerpt: `${intent.from}/${intent.to} ${formatCurrency(rate, intent.to, 4)}`,
        }],
        metrics: {
          data_api_calls: 1,
          web_search_calls: 0,
          external_context_hits: 1,
          router: "currency_api",
        },
        direct_answer: buildExchangeDirectAnswer(payload, userLanguage),
      }, FX_CACHE_TTL_MS);
    } catch (fallbackError) {
      return null;
    }
  }
}

async function fetchWeatherContext(query = "", { userLanguage = "pt" } = {}) {
  const intent = detectWeatherIntent(query);
  if (!intent) return null;

  const cacheKey = `weather:${intent.location}`;
  const cached = getCacheEntry(cacheKey);
  if (cached) return cached;

  const geoUrl = "https://geocoding-api.open-meteo.com/v1/search";
  const weatherBase = "https://api.open-meteo.com/v1/forecast";

  try {
    const geo = await axiosGetWithRetry(geoUrl, {
      headers: REQUEST_HEADERS,
      params: {
        name: intent.location,
        count: 1,
        language: String(userLanguage || "pt").startsWith("en") ? "en" : "pt",
        format: "json",
      },
    }, {
      label: "weather_geocoding",
    });
    const first = geo?.data?.results?.[0];
    if (!first) return null;

    const weather = await axiosGetWithRetry(weatherBase, {
      headers: REQUEST_HEADERS,
      params: {
        latitude: first.latitude,
        longitude: first.longitude,
        current: "temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m",
        timezone: "America/Sao_Paulo",
      },
    }, {
      label: "weather_forecast",
    });

    const current = weather?.data?.current;
    if (!current) return null;

    const locationLabel = compactText([first.name, first.admin1, first.country].filter(Boolean).join(", "), 120);
    const answer = String(userLanguage || "pt").startsWith("en")
      ? [
          `Current weather in **${locationLabel}**: **${current.temperature_2m}°C**.`,
          "",
          `- Feels like: ${current.apparent_temperature}°C`,
          `- Humidity: ${current.relative_humidity_2m}%`,
          `- Wind: ${current.wind_speed_10m} km/h`,
          `- Precipitation: ${current.precipitation} mm`,
          "",
          "✅ If you want, I can also summarize what this means for the rest of the day.",
        ].join("\n")
      : [
          `No momento, o clima em **${locationLabel}** está em **${current.temperature_2m}°C**.`,
          "",
          `- Sensação térmica: ${current.apparent_temperature}°C`,
          `- Umidade: ${current.relative_humidity_2m}%`,
          `- Vento: ${current.wind_speed_10m} km/h`,
          `- Precipitação: ${current.precipitation} mm`,
          "",
          "✅ Se quiser, posso também resumir o que isso significa para o resto do dia.",
        ].join("\n");

    return setCacheEntry(cacheKey, {
      kind: "weather_api",
      text: answer,
      sources: [{
        type: "data_api",
        label: `Open-Meteo ${locationLabel}`,
        url: weatherBase,
        excerpt: `${locationLabel} ${current.temperature_2m}°C`,
      }],
      metrics: {
        data_api_calls: 1,
        web_search_calls: 0,
        external_context_hits: 1,
        router: "weather_api",
      },
      direct_answer: answer,
    }, WEATHER_CACHE_TTL_MS);
  } catch {
    return null;
  }
}

function extractHtmlSearchResults(html = "") {
  const $ = cheerio.load(String(html || ""));
  const sources = [];
  $("a.result__a, .result__body a, a[data-testid='result-title-a']").each((_, element) => {
    const href = $(element).attr("href");
    const title = compactText($(element).text(), 160);
    if (!href || !title) return;
    pushUniqueSource(sources, {
      type: "web",
      label: title,
      url: href,
    });
  });
  return sources.slice(0, 6);
}

async function searchWebDetailed(query = "") {
  const normalized = compactText(query, 240);
  if (!normalized) {
    return {
      kind: "web_search",
      text: "",
      sources: [],
      metrics: {
        data_api_calls: 0,
        web_search_calls: 0,
        external_context_hits: 0,
        router: "empty",
      },
    };
  }

  const cacheKey = `web:${normalizeQuery(normalized)}`;
  const cached = getCacheEntry(cacheKey);
  if (cached) return cached;

  const sources = [];
  let answerText = "";

  try {
    const instant = await axiosGetWithRetry("https://api.duckduckgo.com/", {
      headers: REQUEST_HEADERS,
      params: {
        q: normalized,
        format: "json",
        no_html: 1,
        no_redirect: 1,
      },
    }, {
      label: "duckduckgo_instant",
    });
    const data = instant?.data || {};
    answerText = compactText(data?.AbstractText || data?.Answer || data?.Definition || "", 700);
    if (data?.AbstractURL) {
      pushUniqueSource(sources, {
        type: "web",
        label: data?.Heading || data?.AbstractSource || "Fonte externa",
        url: data.AbstractURL,
        excerpt: answerText,
      });
    }
    (Array.isArray(data?.RelatedTopics) ? data.RelatedTopics : []).slice(0, 5).forEach((item) => {
      if (item?.FirstURL && item?.Text) {
        pushUniqueSource(sources, {
          type: "web",
          label: item.Text,
          url: item.FirstURL,
          excerpt: item.Text,
        });
      }
    });
  } catch (err) {
    console.error("Erro no instant answer:", buildAxiosErrorDetails(err, {
      label: "duckduckgo_instant",
      url: "https://api.duckduckgo.com/",
    }));
  }

  if (!sources.length || !answerText) {
    try {
      const html = await axiosGetWithRetry("https://duckduckgo.com/html/", {
        headers: REQUEST_HEADERS,
        params: { q: normalized },
      }, {
        label: "duckduckgo_html",
      });
      extractHtmlSearchResults(html?.data || "").forEach((source) => pushUniqueSource(sources, source));
    } catch (err) {
      console.error("Erro no HTML search:", buildAxiosErrorDetails(err, {
        label: "duckduckgo_html",
        url: "https://duckduckgo.com/html/",
      }));
    }
  }

  const result = {
    kind: "web_search",
    text: answerText,
    sources: sources.slice(0, 6),
    metrics: {
      data_api_calls: 0,
      web_search_calls: sources.length ? 1 : 0,
      external_context_hits: sources.length ? 1 : 0,
      router: "web_search",
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
