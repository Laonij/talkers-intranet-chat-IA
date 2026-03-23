const { createLogger } = require("./appLogger");
const { detectArtifactKind } = require("./generate");
const { normalizeSemanticText } = require("./semantic");
const { queryLooksAboutTalkers } = require("./talkersPublicKnowledge");

const routerLogger = createLogger("routing");

function normalizeIntentText(value = "") {
  return normalizeSemanticText(String(value || "").trim());
}

function hasActionVerb(text = "") {
  return /\b(gere|gerar|crie|criar|monte|montar|produza|produzir|faca|fazer|transforme|transformar|edite|editar|ajuste|ajustar|deixe|coloque|troque|recrie|reorganize|organize|melhore|melhorar|padronize|reestruture|devolva|devolver|exporte|exportar)\b/.test(text);
}

function hasAnalysisVerb(text = "") {
  return /\b(analise|analisar|resuma|resumir|explique|explicar|interprete|interpretar|compare|comparar|avalie|avaliar|extraia|extrair|descreva|descrever|o que mostra|o que tem|o que aparece)\b/.test(text);
}

function looksLikeMetaCapabilityQuestion(text = "") {
  return /(limita|capacidade|capacidades|o que voce consegue|o que voce faz|quais arquivos|gera imagem|gera pdf|gera planilha|consegue criar|consegue gerar|pesquisa web|acesso a internet|ferramentas|tools|pptx|powerpoint|audio|transcricao)/.test(text);
}

function looksLikeContinuation(text = "") {
  return /^(ok|okay|sim|pode|pode seguir|pode gerar|gere|faca|fazer|entao faca|entao gere|continue|seguir|pode continuar|tente novamente|tentar novamente|repita|refaca|de novo)\b/.test(text);
}

function looksLikeAttachmentReference(text = "") {
  return /(essa planilha|esse arquivo|esse pdf|esse documento|essa imagem|esse anexo|nesta planilha|neste arquivo|nesse arquivo|nesse pdf|neste documento|o arquivo|a planilha|o pdf|o documento|o anexo|nessa foto|nesta foto|minha foto|minha imagem|esse audio|esse video|essa gravacao|essa apresentacao|isso aqui|isso ai|isso|aquilo)/.test(text);
}

function looksLikeImageModificationIntent(text = "") {
  if (!hasActionVerb(text)) return false;
  return /\b(me|minha|minha foto|minha imagem|isso|essa|esse|deixe|troque|coloque|transforme|estilo|versao|aparencia|roupa|cenario|idade|fundo|visual)\b/.test(text);
}

function looksLikeImageAnalysis(text = "", selectedFileKind = "") {
  if (selectedFileKind !== "image") return false;
  return hasAnalysisVerb(text)
    || /(ocr|extrair texto|extraia o texto|o que tem na imagem|descreva a imagem|leia a imagem|interprete a imagem|quais elementos|qual texto)/.test(text);
}

function looksLikeMediaAnalysis(text = "", selectedFileKind = "") {
  if (selectedFileKind !== "media") return false;
  return hasAnalysisVerb(text)
    || /(transcreva|transcrever|transcricao|resuma o audio|resuma o video|o que foi dito|topicos|acoes|ata do audio|ata da reuniao|resumo da gravacao)/.test(text);
}

function looksLikeSpreadsheetTransform(text = "", selectedFileKind = "") {
  if (selectedFileKind !== "spreadsheet") return false;
  return hasActionVerb(text)
    && /(planilha|xlsx|excel|aba|abas|coluna|colunas|kpi|kpis|organize|corrija|padronize|limpe|devolva|nova planilha|planilha melhor|planilha organizada|resumo executivo|ajustes sugeridos)/.test(text);
}

function looksLikeDocumentGeneration(text = "", selectedFileKind = "") {
  if (!hasActionVerb(text)) return false;
  const targetKind = detectArtifactKind(text, { referenceImages: [] });
  if (["docx", "pdf", "pptx"].includes(targetKind)) return true;
  return /(documento|relatorio|proposta|comunicado|checklist|manual|ata|resumo executivo|carta|contrato|apresentacao|slides|powerpoint|pptx|pdf|docx|word)/.test(text)
    && ["document", "pdf", "presentation", "generic", "media", ""].includes(selectedFileKind || "");
}

function looksLikeAttachmentAnalysis(text = "", hasRecentFiles = false) {
  if (!hasRecentFiles) return false;
  return hasAnalysisVerb(text) && (/(arquivo|documento|pdf|planilha|excel|xlsx|csv|imagem|foto|anexo|aba|coluna|linha|dados|audio|video|gravacao|ppt|pptx|slide|slides)/.test(text) || looksLikeAttachmentReference(text));
}

function looksLikeArtifactFollowUpQuestion(text = "", latestArtifactSession = null) {
  if (!latestArtifactSession?.artifact_type) return false;
  return /(usou a minha foto|usou minha foto|usou a minha imagem|usou minha imagem|foi com base na minha foto|foi com base na minha imagem|voce usou a foto|voce usou a imagem|qual arquivo voce usou|qual anexo voce usou|foi gerado do zero|mas eu ja mandei minha foto|eu ja mandei minha foto)/.test(text);
}

function buildRetryRoute(latestArtifactSession = null) {
  const lastKind = String(latestArtifactSession?.artifact_type || "").trim();
  if (!lastKind) return null;
  if (lastKind === "image_edit") {
    return { intent_mode: "image_edit", reason: "artifact_retry_or_continue", artifact_kind: "image_edit", should_use_recent_file: true, prefer_local_analysis: false, should_use_latest_image_base: true, response_mode: "artifact", retry_from_session: true };
  }
  if (lastKind === "image") {
    return { intent_mode: "image_generate", reason: "artifact_retry_or_continue", artifact_kind: "image", should_use_recent_file: false, prefer_local_analysis: false, response_mode: "artifact", retry_from_session: true };
  }
  if (lastKind === "xlsx") {
    return { intent_mode: "spreadsheet_transform", reason: "artifact_retry_or_continue", artifact_kind: "xlsx", should_use_recent_file: true, prefer_local_analysis: false, response_mode: "artifact", retry_from_session: true };
  }
  return { intent_mode: "document_generate", reason: "artifact_retry_or_continue", artifact_kind: lastKind, should_use_recent_file: true, prefer_local_analysis: false, response_mode: "artifact", retry_from_session: true };
}

function buildRoute(payload) {
  routerLogger.info(`${payload.intent_mode}_selected`, {
    reason: payload.reason || "",
    artifact_kind: payload.artifact_kind || "",
    response_mode: payload.response_mode || "",
    selected_file_kind: payload.selected_file_kind || "",
  });
  return payload;
}

function routeConversationIntent({
  userText = "",
  recentFiles = [],
  latestArtifactSession = null,
  referenceImages = [],
  selectedFile = null,
  selectedFileKind = "",
} = {}) {
  const normalized = normalizeIntentText(userText);
  const hasRecentFiles = Array.isArray(recentFiles) && recentFiles.length > 0;
  const hasReferenceImages = Array.isArray(referenceImages) && referenceImages.length > 0;
  const currentArtifactKind = detectArtifactKind(userText, { referenceImages });

  if (looksLikeMetaCapabilityQuestion(normalized)) {
    return buildRoute({
      intent_mode: "general_chat",
      reason: "capability_question",
      artifact_kind: null,
      should_use_recent_file: false,
      prefer_local_analysis: false,
      response_mode: "text",
      selected_file_kind: selectedFileKind,
    });
  }

  if (looksLikeArtifactFollowUpQuestion(normalized, latestArtifactSession)) {
    return buildRoute({
      intent_mode: "artifact_followup_meta",
      reason: "artifact_followup_question",
      artifact_kind: latestArtifactSession.artifact_type,
      should_use_recent_file: false,
      prefer_local_analysis: false,
      response_mode: "text",
      selected_file_kind: selectedFileKind,
    });
  }

  if (looksLikeContinuation(normalized) && latestArtifactSession?.artifact_type) {
    const retryRoute = buildRetryRoute(latestArtifactSession);
    if (retryRoute) return buildRoute({ ...retryRoute, selected_file_kind: selectedFileKind });
  }

  if (queryLooksAboutTalkers(normalized)) {
    return buildRoute({
      intent_mode: "talkers_context_query",
      reason: "explicit_talkers_context",
      artifact_kind: null,
      should_use_recent_file: false,
      prefer_local_analysis: false,
      response_mode: "text",
      selected_file_kind: selectedFileKind,
    });
  }

  if ((hasReferenceImages || selectedFileKind === "image") && looksLikeImageModificationIntent(normalized)) {
    return buildRoute({
      intent_mode: "image_edit",
      reason: "generic_image_modification_request",
      artifact_kind: "image_edit",
      should_use_recent_file: true,
      prefer_local_analysis: false,
      should_use_latest_image_base: true,
      response_mode: "artifact",
      selected_file_kind: selectedFileKind,
    });
  }

  if (looksLikeImageAnalysis(normalized, selectedFileKind)) {
    return buildRoute({
      intent_mode: "analyze_attachment",
      reason: "image_analysis_request",
      artifact_kind: null,
      should_use_recent_file: true,
      prefer_local_analysis: false,
      source_file_mode: "image_analysis",
      response_mode: "analysis",
      selected_file_kind: selectedFileKind,
    });
  }

  if (looksLikeMediaAnalysis(normalized, selectedFileKind)) {
    return buildRoute({
      intent_mode: "analyze_attachment",
      reason: "media_analysis_request",
      artifact_kind: null,
      should_use_recent_file: true,
      prefer_local_analysis: true,
      source_file_mode: "media_analysis",
      response_mode: "analysis",
      selected_file_kind: selectedFileKind,
    });
  }

  if (looksLikeSpreadsheetTransform(normalized, selectedFileKind)) {
    return buildRoute({
      intent_mode: "spreadsheet_transform",
      reason: "spreadsheet_transform_request",
      artifact_kind: "xlsx",
      should_use_recent_file: true,
      prefer_local_analysis: false,
      source_file_mode: "spreadsheet_transform",
      response_mode: "artifact",
      selected_file_kind: selectedFileKind,
    });
  }

  if (looksLikeDocumentGeneration(normalized, selectedFileKind)) {
    return buildRoute({
      intent_mode: "document_generate",
      reason: "document_generation_request",
      artifact_kind: currentArtifactKind || (selectedFileKind === "presentation" ? "pptx" : "docx"),
      should_use_recent_file: Boolean(selectedFile),
      prefer_local_analysis: false,
      source_file_mode: "document_generation",
      response_mode: "artifact",
      selected_file_kind: selectedFileKind,
    });
  }

  if (looksLikeAttachmentAnalysis(normalized, hasRecentFiles)) {
    return buildRoute({
      intent_mode: "analyze_attachment",
      reason: "attachment_analysis",
      artifact_kind: null,
      should_use_recent_file: true,
      prefer_local_analysis: selectedFileKind !== "image",
      source_file_mode: "attachment_analysis",
      response_mode: "analysis",
      selected_file_kind: selectedFileKind,
    });
  }

  if (currentArtifactKind === "image") {
    return buildRoute({
      intent_mode: "image_generate",
      reason: "image_generation_request",
      artifact_kind: "image",
      should_use_recent_file: false,
      prefer_local_analysis: false,
      response_mode: "artifact",
      selected_file_kind: selectedFileKind,
    });
  }

  if (currentArtifactKind) {
    return buildRoute({
      intent_mode: "transform_attachment",
      reason: "direct_artifact_request",
      artifact_kind: currentArtifactKind,
      should_use_recent_file: Boolean(selectedFile),
      prefer_local_analysis: false,
      response_mode: "artifact",
      selected_file_kind: selectedFileKind,
    });
  }

  if (looksLikeAttachmentReference(normalized) && hasRecentFiles) {
    return buildRoute({
      intent_mode: "analyze_attachment",
      reason: "attachment_reference",
      artifact_kind: null,
      should_use_recent_file: true,
      prefer_local_analysis: selectedFileKind !== "image",
      source_file_mode: "attachment_reference",
      response_mode: "analysis",
      selected_file_kind: selectedFileKind,
    });
  }

  return buildRoute({
    intent_mode: "general_chat",
    reason: "default_general_chat",
    artifact_kind: null,
    should_use_recent_file: false,
    prefer_local_analysis: false,
    response_mode: "text",
    selected_file_kind: selectedFileKind,
  });
}

module.exports = {
  routeConversationIntent,
};
