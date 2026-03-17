const { detectArtifactKind } = require("./generate");
const { normalizeSemanticText } = require("./semantic");

function normalizeIntentText(value = "") {
  return normalizeSemanticText(String(value || "").trim());
}

function looksLikeMetaCapabilityQuestion(text = "") {
  const value = normalizeIntentText(text);
  if (!value) return false;
  return /(limita|capacidade|capacidades|o que voce consegue|o que voce faz|analisa planilha|analisa pdf|quais arquivos|gera imagem|gera pdf|gera planilha|consegue criar|consegue gerar|internet|pesquisa web|pesquisar fora|acesso a internet|ferramentas|tools)/.test(value);
}

function looksLikeContinuation(text = "") {
  const value = normalizeIntentText(text);
  if (!value) return false;
  return /^(ok|okay|sim|pode|pode seguir|pode gerar|gere|faca|fazer|faça|entao faca|entao faça|entao gere|continue|seguir|pode continuar|tente novamente|tentar novamente|repita|refaca|refaça|de novo)\b/.test(value);
}

function looksLikeAttachmentReference(text = "") {
  const value = normalizeIntentText(text);
  if (!value) return false;
  return /(essa planilha|esse arquivo|esse pdf|esse documento|essa imagem|esse anexo|nesta planilha|neste arquivo|nesse arquivo|nesse pdf|neste documento|o arquivo|a planilha|o pdf|o documento|o anexo|o que essa planilha|o que esse arquivo|resuma esse|analise esse)/.test(value);
}

function looksLikeAttachmentAnalysis(text = "", hasRecentFiles = false) {
  const value = normalizeIntentText(text);
  if (!value || !hasRecentFiles) return false;
  const analysisCue = /(analise|analisar|resuma|resumir|explique|explicar|interprete|interpretar|compare|comparar|o que mostra|o que mostra|o que esse|o que essa|leia|ler|extraia|extrair|revise|revisar|avalie|avaliar|diagnostique|diagnosticar)/.test(value);
  const fileCue = /(arquivo|documento|pdf|planilha|excel|xlsx|csv|imagem|foto|anexo|aba|coluna|linha|dados|planilhas)/.test(value) || looksLikeAttachmentReference(value);
  return analysisCue && fileCue;
}

function looksLikeImageTransformation(text = "", hasReferenceImages = false) {
  const value = normalizeIntentText(text);
  if (!value || !hasReferenceImages) return false;
  return /(transforme|transformar|anime|viking|avatar|desenho|ilustracao|estilo|versao|edite|ajuste|minha foto|minha imagem|me deixe)/.test(value);
}

function routeConversationIntent({
  userText = "",
  recentFiles = [],
  latestArtifactSession = null,
  referenceImages = [],
} = {}) {
  const normalized = normalizeIntentText(userText);
  const hasRecentFiles = Array.isArray(recentFiles) && recentFiles.length > 0;
  const hasReferenceImages = Array.isArray(referenceImages) && referenceImages.length > 0;
  const currentArtifactKind = detectArtifactKind(userText, { referenceImages });

  if (looksLikeMetaCapabilityQuestion(normalized)) {
    return {
      intent_mode: "meta_capability",
      reason: "capability_question",
      artifact_kind: null,
      should_use_recent_file: false,
    };
  }

  if (currentArtifactKind === "image_edit" || looksLikeImageTransformation(normalized, hasReferenceImages)) {
    return {
      intent_mode: "image_edit",
      reason: "image_edit_request",
      artifact_kind: "image_edit",
      should_use_recent_file: true,
    };
  }

  if (looksLikeAttachmentAnalysis(normalized, hasRecentFiles)) {
    return {
      intent_mode: "analyze_attachment",
      reason: "attachment_analysis",
      artifact_kind: null,
      should_use_recent_file: true,
    };
  }

  if (currentArtifactKind) {
    return {
      intent_mode: "generate_artifact",
      reason: "direct_artifact_request",
      artifact_kind: currentArtifactKind,
      should_use_recent_file: currentArtifactKind === "image_edit",
    };
  }

  if (looksLikeContinuation(normalized) && latestArtifactSession?.artifact_type) {
    return {
      intent_mode: "continue_artifact",
      reason: "artifact_retry_or_continue",
      artifact_kind: latestArtifactSession.artifact_type,
      should_use_recent_file: Boolean(latestArtifactSession.input_files_json || latestArtifactSession.image_refs_json),
    };
  }

  if (looksLikeAttachmentReference(normalized) && hasRecentFiles) {
    return {
      intent_mode: "analyze_attachment",
      reason: "attachment_reference_without_analysis_keyword",
      artifact_kind: null,
      should_use_recent_file: true,
    };
  }

  return {
    intent_mode: "normal_question",
    reason: "default_normal_question",
    artifact_kind: null,
    should_use_recent_file: false,
  };
}

module.exports = {
  routeConversationIntent,
};
