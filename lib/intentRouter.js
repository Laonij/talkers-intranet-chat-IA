const { detectArtifactKind } = require("./generate");
const { normalizeSemanticText } = require("./semantic");

function normalizeIntentText(value = "") {
  return normalizeSemanticText(String(value || "").trim());
}

function looksLikeMetaCapabilityQuestion(text = "") {
  const value = normalizeIntentText(text);
  if (!value) return false;
  return /(limita|capacidade|capacidades|o que voce consegue|o que voce faz|analisa planilha|analisa pdf|quais arquivos|gera imagem|gera pdf|gera planilha|consegue criar|consegue gerar|internet|pesquisa web|pesquisar fora|acesso a internet|ferramentas|tools|pptx|powerpoint|audio|transcricao|transcricao)/.test(value);
}

function looksLikeContinuation(text = "") {
  const value = normalizeIntentText(text);
  if (!value) return false;
  return /^(ok|okay|sim|pode|pode seguir|pode gerar|gere|faca|fazer|entao faca|entao gere|continue|seguir|pode continuar|tente novamente|tentar novamente|repita|refaca|de novo)\b/.test(value);
}

function looksLikeAttachmentReference(text = "") {
  const value = normalizeIntentText(text);
  if (!value) return false;
  return /(essa planilha|esse arquivo|esse pdf|esse documento|essa imagem|esse anexo|nesta planilha|neste arquivo|nesse arquivo|nesse pdf|neste documento|o arquivo|a planilha|o pdf|o documento|o anexo|o que essa planilha|o que esse arquivo|resuma esse|analise esse|com base no arquivo|com base nessa planilha|com base nesse documento|nessa foto|nesta foto|minha foto|minha imagem)/.test(value);
}

function hasGenerationIntent(text = "") {
  return /(\bgere\b|\bgerar\b|\bcrie\b|\bcriar\b|\bmonte\b|\bmontar\b|\bproduza\b|\bproduzir\b|\bfaca\b|\bfazer\b|\bdesenvolva\b|\bdesenvolver\b|\bconstrua\b|\bconstruir\b|\belabore\b|\belaborar\b|\btransforme\b|\btransformar\b|\bdevolva\b|\bdevolver\b|\bexporte\b|\bexportar\b)/.test(text);
}

function hasAnalysisIntent(text = "") {
  return /(\banalise\b|\banalisar\b|\bexplique\b|\bexplicar\b|\bresuma\b|\bresumir\b|\binterprete\b|\binterpretar\b|\bcompare\b|\bcomparar\b|\brevise\b|\brevisar\b|\bavalie\b|\bavaliar\b|\bdiagnostique\b|\bdiagnosticar\b|\bextraia\b|\bextrair\b|\bo que mostra\b|\bo que essa\b|\bo que esse\b)/.test(text);
}

function looksLikeImageTransformation(text = "", hasReferenceImages = false, selectedFileKind = "") {
  const value = normalizeIntentText(text);
  if (!value) return false;
  if (!hasReferenceImages && selectedFileKind !== "image") return false;
  return /(transforme|transformar|estilo|anime|viking|avatar|desenho|ilustracao|versao|edite|ajuste|melhore|minha foto|minha imagem|use a minha foto|use minha imagem|troque a roupa|roupa formal|caracterizacao|caracterizacao|caricatura|cartoon|cyberpunk|realista)/.test(value);
}

function looksLikeImageAnalysis(text = "", selectedFileKind = "") {
  const value = normalizeIntentText(text);
  if (!value || selectedFileKind !== "image") return false;
  return hasAnalysisIntent(value)
    || /(ocr|extrair texto|extraia o texto|o que tem na imagem|descreva a imagem|leia a imagem|interprete a imagem|o que aparece|quais elementos|qual texto)/.test(value);
}

function looksLikeMediaTranscription(text = "", selectedFileKind = "") {
  const value = normalizeIntentText(text);
  if (!value || selectedFileKind !== "media") return false;
  return /(transcreva|transcrever|transcricao|resuma o audio|resuma o video|o que foi dito|topicos|acoes|ata do audio|ata da reuniao|resumo da gravacao)/.test(value)
    || (hasAnalysisIntent(value) && /(audio|video|gravacao|gravacao|midia|reuniao|reuniao gravada)/.test(value));
}

function looksLikeSpreadsheetTransformation(text = "", selectedFileKind = "") {
  const value = normalizeIntentText(text);
  if (!value || selectedFileKind !== "spreadsheet") return false;
  return hasGenerationIntent(value)
    && /(planilha|xlsx|excel|aba|abas|kpi|kpis|organize|organizar|melhore|melhorar|corrija|corrigir|padronize|padronizar|limpe|limpar|devolva|devolver|reestruture|reestruturar|nova planilha|planilha melhor|planilha organizada)/.test(value);
}

function looksLikeDocumentTransformation(text = "", selectedFileKind = "") {
  const value = normalizeIntentText(text);
  if (!value || !["document", "pdf", "spreadsheet", "generic", "media"].includes(selectedFileKind)) return false;
  return hasGenerationIntent(value)
    && /(pdf|docx|word|documento|relatorio|relatorio|proposta|comunicado|checklist|manual|ata|resumo executivo|carta|contrato|modelo|versao estruturada|versao formal)/.test(value);
}

function looksLikePresentationGeneration(text = "", selectedFileKind = "") {
  const value = normalizeIntentText(text);
  if (!value) return false;
  if (!hasGenerationIntent(value)) return false;
  if (!selectedFileKind && !looksLikeAttachmentReference(value)) return false;
  return /(ppt|pptx|powerpoint|slides|slide|apresentacao|apresentacao executiva|deck)/.test(value);
}

function looksLikeAttachmentAnalysis(text = "", hasRecentFiles = false) {
  const value = normalizeIntentText(text);
  if (!value || !hasRecentFiles) return false;
  const analysisCue = hasAnalysisIntent(value);
  const fileCue = /(arquivo|documento|pdf|planilha|excel|xlsx|csv|imagem|foto|anexo|aba|coluna|linha|dados|planilhas|audio|video|gravacao|ppt|pptx|slide|slides)/.test(value) || looksLikeAttachmentReference(value);
  return analysisCue && fileCue;
}

function looksLikeArtifactFollowUpQuestion(text = "", latestArtifactSession = null) {
  const value = normalizeIntentText(text);
  if (!value || !latestArtifactSession?.artifact_type) return false;
  return /(usou a minha foto|usou minha foto|usou a minha imagem|usou minha imagem|foi com base na minha foto|foi com base na minha imagem|voce usou a foto|voce usou a imagem|qual arquivo voce usou|qual anexo voce usou|foi gerado do zero|você usou minha foto)/.test(value);
}

function guessArtifactKindFromPrompt(text = "", selectedFileKind = "") {
  const detected = detectArtifactKind(text, {
    referenceImages: selectedFileKind === "image" ? [{}] : [],
  });
  if (detected) return detected;
  if (/(ppt|pptx|powerpoint|slides|apresentacao|deck)/.test(text)) return "pptx";
  if (/(planilha|xlsx|excel|csv)/.test(text)) return "xlsx";
  if (/(pdf)/.test(text)) return "pdf";
  if (/(docx|word|documento|relatorio|proposta|checklist|manual|ata|contrato|carta|resumo executivo)/.test(text)) return "docx";
  if (selectedFileKind === "spreadsheet") return "xlsx";
  if (selectedFileKind === "image") return "image_edit";
  if (selectedFileKind === "pdf") return "pdf";
  if (selectedFileKind === "document") return "docx";
  return null;
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
    return {
      intent_mode: "meta_capability",
      reason: "capability_question",
      artifact_kind: null,
      should_use_recent_file: false,
      prefer_local_analysis: false,
      response_mode: "text",
    };
  }

  if (looksLikeArtifactFollowUpQuestion(normalized, latestArtifactSession)) {
    return {
      intent_mode: "artifact_followup_meta",
      reason: "artifact_followup_question",
      artifact_kind: latestArtifactSession.artifact_type,
      should_use_recent_file: false,
      prefer_local_analysis: false,
      response_mode: "text",
    };
  }

  if (currentArtifactKind === "image_edit" || looksLikeImageTransformation(normalized, hasReferenceImages, selectedFileKind)) {
    return {
      intent_mode: "image_edit",
      reason: "image_edit_request",
      artifact_kind: "image_edit",
      should_use_recent_file: true,
      prefer_local_analysis: false,
      should_use_latest_image_base: true,
      response_mode: "artifact",
    };
  }

  if (looksLikeSpreadsheetTransformation(normalized, selectedFileKind)) {
    return {
      intent_mode: "transform_attachment",
      reason: "spreadsheet_transform_request",
      artifact_kind: "xlsx",
      should_use_recent_file: true,
      prefer_local_analysis: false,
      source_file_mode: "spreadsheet_transform",
      response_mode: "artifact",
    };
  }

  if (looksLikePresentationGeneration(normalized, selectedFileKind)) {
    return {
      intent_mode: "transform_attachment",
      reason: "presentation_generation_request",
      artifact_kind: "pptx",
      should_use_recent_file: true,
      prefer_local_analysis: false,
      source_file_mode: "presentation_generation",
      response_mode: "artifact",
    };
  }

  if (looksLikeDocumentTransformation(normalized, selectedFileKind)) {
    return {
      intent_mode: "transform_attachment",
      reason: "document_transform_request",
      artifact_kind: guessArtifactKindFromPrompt(normalized, selectedFileKind) || "docx",
      should_use_recent_file: true,
      prefer_local_analysis: false,
      source_file_mode: "document_transform",
      response_mode: "artifact",
    };
  }

  if (looksLikeMediaTranscription(normalized, selectedFileKind)) {
    return {
      intent_mode: "analyze_attachment",
      reason: "media_transcription_request",
      artifact_kind: null,
      should_use_recent_file: true,
      prefer_local_analysis: true,
      source_file_mode: "media_transcription",
      response_mode: "analysis",
    };
  }

  if (looksLikeImageAnalysis(normalized, selectedFileKind)) {
    return {
      intent_mode: "analyze_attachment",
      reason: "image_analysis_request",
      artifact_kind: null,
      should_use_recent_file: true,
      prefer_local_analysis: false,
      source_file_mode: "image_analysis",
      response_mode: "analysis",
    };
  }

  if (looksLikeAttachmentAnalysis(normalized, hasRecentFiles)) {
    return {
      intent_mode: "analyze_attachment",
      reason: "attachment_analysis",
      artifact_kind: null,
      should_use_recent_file: true,
      prefer_local_analysis: selectedFileKind !== "image",
      source_file_mode: "attachment_analysis",
      response_mode: "analysis",
    };
  }

  if (currentArtifactKind) {
    return {
      intent_mode: "generate_artifact",
      reason: "direct_artifact_request",
      artifact_kind: currentArtifactKind,
      should_use_recent_file: currentArtifactKind === "image_edit",
      prefer_local_analysis: false,
      response_mode: "artifact",
    };
  }

  if (looksLikeContinuation(normalized) && latestArtifactSession?.artifact_type) {
    return {
      intent_mode: "continue_artifact",
      reason: "artifact_retry_or_continue",
      artifact_kind: latestArtifactSession.artifact_type,
      should_use_recent_file: Boolean(latestArtifactSession.input_files_json || latestArtifactSession.image_refs_json),
      prefer_local_analysis: false,
      response_mode: "artifact",
    };
  }

  if (looksLikeAttachmentReference(normalized) && hasRecentFiles) {
    return {
      intent_mode: "analyze_attachment",
      reason: "attachment_reference_without_analysis_keyword",
      artifact_kind: null,
      should_use_recent_file: true,
      prefer_local_analysis: selectedFileKind !== "image",
      source_file_mode: "attachment_reference",
      response_mode: "analysis",
    };
  }

  return {
    intent_mode: "normal_question",
    reason: "default_normal_question",
    artifact_kind: null,
    should_use_recent_file: false,
    prefer_local_analysis: false,
    response_mode: "text",
  };
}

module.exports = {
  routeConversationIntent,
};
