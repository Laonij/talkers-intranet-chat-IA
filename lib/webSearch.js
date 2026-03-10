const axios = require("axios");
const cheerio = require("cheerio");

async function searchWeb(query) {
  try {
    const url = `https://duckduckgo.com/html/?q=${encodeURIComponent(query)}`;

    const response = await axios.get(url);

    const $ = cheerio.load(response.data);

    let results = [];

    $(".result__snippet").each((i, el) => {
      if (i < 5) {
        results.push($(el).text());
      }
    });

    return results.join("\n");
  } catch (error) {
    console.error("Erro na busca web:", error);
    return "";
  }
}

module.exports = { searchWeb };
