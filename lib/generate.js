const fs = require("fs");
const path = require("path");
const XLSX = require("xlsx");

async function generateArtifact({ apiKey, prompt, outDir }) {

  const text = prompt.toLowerCase();

  if (text.includes("planilha") || text.includes("excel")) {

    const data = [
      ["Item", "Valor"],
      ["Exemplo", "100"]
    ];

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(data);

    XLSX.utils.book_append_sheet(wb, ws, "Planilha");

    const filename = "planilha-gerada.xlsx";
    const fullPath = path.join(outDir, filename);

    XLSX.writeFile(wb, fullPath);

    return {
      filename,
      fullPath,
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      reply: "Planilha gerada com sucesso."
    };

  }

  return null;
}

module.exports = { generateArtifact };
