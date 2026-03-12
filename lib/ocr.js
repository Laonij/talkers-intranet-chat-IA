const Tesseract = require("tesseract.js");

async function recognize(input) {
  const result = await Tesseract.recognize(input, "por+eng", {
    logger: () => {},
  });

  return result?.data?.text || "";
}

async function ocrImage(filePath) {
  try {
    return await recognize(filePath);
  } catch (err) {
    console.log("Erro OCR imagem:", err?.message || err);
    return "";
  }
}

async function ocrBuffer(buffer) {
  try {
    return await recognize(buffer);
  } catch (err) {
    console.log("Erro OCR buffer:", err?.message || err);
    return "";
  }
}

module.exports = { ocrBuffer, ocrImage };