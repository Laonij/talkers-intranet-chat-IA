const Tesseract = require("tesseract.js");

async function ocrImage(filePath) {
  try {
    const result = await Tesseract.recognize(
      filePath,
      "por+eng",
      { logger: () => {} }
    );

    return result.data.text || "";
  } catch (err) {
    console.log("Erro OCR:", err);
    return "";
  }
}

module.exports = { ocrImage };
