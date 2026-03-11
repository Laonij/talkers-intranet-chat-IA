const axios = require("axios");

async function searchWeb(query) {
  try {

    const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json`;

    const resp = await axios.get(url);

    if (!resp.data) return "";

    let text = "";

    if (resp.data.AbstractText) {
      text += resp.data.AbstractText + "\n";
    }

    if (resp.data.RelatedTopics) {
      resp.data.RelatedTopics.slice(0,5).forEach(t => {
        if (t.Text) text += "- " + t.Text + "\n";
      });
    }

    return text;

  } catch (err) {
    console.log("Erro web search:", err.message);
    return "";
  }
}

module.exports = { searchWeb };
