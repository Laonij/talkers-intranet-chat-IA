const {
  buildArtifactSourceContext,
  buildLocalFileAnalysisAnswer,
  buildStructuredFileContext,
  detectFileKind,
  parseStructuredConversationFile,
  selectRelevantConversationFile,
} = require("./filePipeline");
const { routeConversationIntent } = require("./intentRouter");

function buildReferenceImageFromFile(selectedFile = null, uploadsDir = "") {
  if (!selectedFile || detectFileKind(selectedFile) !== "image") return null;
  return {
    file_id: Number(selectedFile.id || 0) || null,
    fullPath: selectedFile.fullPath || "",
    originalName: selectedFile.original_name || selectedFile.originalName || "",
    mimeType: selectedFile.mime_type || selectedFile.mimeType || "",
    sizeBytes: Number(selectedFile.size_bytes || selectedFile.sizeBytes || 0) || 0,
    storedName: selectedFile.stored_name || selectedFile.storedName || "",
    uploadsDir,
  };
}

function mergeReferenceImages(selectedReference = null, referenceImages = []) {
  const merged = [];
  const seen = new Set();

  const pushImage = (item) => {
    if (!item?.fullPath) return;
    const key = String(item.fullPath || "").toLowerCase();
    if (!key || seen.has(key)) return;
    seen.add(key);
    merged.push(item);
  };

  pushImage(selectedReference);
  for (const item of Array.isArray(referenceImages) ? referenceImages : []) {
    pushImage(item);
  }
  return merged;
}

function buildArtifactFollowUpReply(route = null, latestArtifactSession = null) {
  if (!route || route.intent_mode !== "artifact_followup_meta" || !latestArtifactSession?.artifact_type) {
    return "";
  }

  const artifactType = String(latestArtifactSession.artifact_type || "");
  const usedImages = Array.isArray(latestArtifactSession.image_refs) ? latestArtifactSession.image_refs.length : 0;
  const usedFiles = Array.isArray(latestArtifactSession.input_files) ? latestArtifactSession.input_files.length : 0;

  if (artifactType === "image_edit") {
    if (usedImages > 0) {
      return [
        "Sim. Usei a imagem enviada na conversa como base para a edicao.",
        "",
        "O fluxo executado foi de imagem para imagem, nao uma geracao do zero.",
        "Se quiser, posso tentar outra variacao com a mesma foto, mudando estilo, roupa, cenario, enquadramento ou acabamento.",
      ].join("\n");
    }
    return [
      "Nesta ultima tentativa eu nao tinha uma imagem-base valida vinculada na sessao de artefato.",
      "",
      "Se voce quiser, posso repetir a edicao usando a foto mais recente da conversa como base.",
    ].join("\n");
  }

  if (usedFiles > 0) {
    return [
      "Usei o arquivo mais recente relacionado a esse pedido como base para executar a tarefa.",
      "",
      "Se quiser, posso repetir a execucao com outro foco ou transformar esse mesmo material em outro formato.",
    ].join("\n");
  }

  return [
    "Nessa ultima execucao eu usei principalmente o pedido textual da conversa.",
    "",
    "Se quiser, posso repetir a tarefa aproveitando um arquivo ou imagem anexada como base.",
  ].join("\n");
}

async function buildTurnExecutionPlan({
  userText = "",
  recentFiles = [],
  latestArtifactSession = null,
  referenceImages = [],
  uploadsDir = "",
} = {}) {
  const selectedFile = selectRelevantConversationFile(recentFiles, userText);
  const selectedFileKind = detectFileKind(selectedFile || {});
  const selectedReferenceImage = buildReferenceImageFromFile(selectedFile, uploadsDir);
  const referenceImagesForTurn = mergeReferenceImages(selectedReferenceImage, referenceImages);

  const route = routeConversationIntent({
    userText,
    recentFiles,
    latestArtifactSession,
    referenceImages: referenceImagesForTurn,
    selectedFile,
    selectedFileKind,
  });

  let fileProfile = null;
  if (route.should_use_recent_file && selectedFile) {
    fileProfile = await parseStructuredConversationFile(selectedFile, {
      uploadsDir,
      apiKey: process.env.OPENAI_API_KEY || "",
    }).catch(() => null);
  }

  const followUpReply = buildArtifactFollowUpReply(route, latestArtifactSession);
  const localAnalysisReply = route.intent_mode === "analyze_attachment" && route.prefer_local_analysis
    ? buildLocalFileAnalysisAnswer(fileProfile, route, userText)
    : "";

  return {
    route,
    selectedFile,
    selectedFileKind,
    fileProfile,
    fileContext: buildStructuredFileContext(fileProfile, userText, route),
    localAnalysisReply,
    artifactSourceContext: buildArtifactSourceContext(fileProfile, userText, route),
    followUpReply,
    referenceImagesForTurn,
  };
}

module.exports = {
  buildTurnExecutionPlan,
};
