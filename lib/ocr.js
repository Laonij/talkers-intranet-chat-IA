const Tesseract = require("tesseract.js");
const { createLogger } = require("./appLogger");
const { sanitizeTextForPostgres } = require("./postgresSanitizer");

const ocrLogger = createLogger("ocr");

async function recognize(input) {
  const result = await Tesseract.recognize(input, "por+eng", {
    logger: () => {},
  });

  return sanitizeTextForPostgres(result?.data?.text || "", {
    trim: true,
    normalizeWhitespace: false,
  }) || "";
}

async function ocrImage(filePath) {
  try {
    return await recognize(filePath);
  } catch (err) {
    ocrLogger.warn("Erro OCR imagem.", {
      message: err?.message || String(err || "ocr_image_failed"),
    });
    return "";
  }
}

async function ocrBuffer(buffer) {
  try {
    return await recognize(buffer);
  } catch (err) {
    ocrLogger.warn("Erro OCR buffer.", {
      message: err?.message || String(err || "ocr_buffer_failed"),
    });
    return "";
  }
}

module.exports = { ocrBuffer, ocrImage };
