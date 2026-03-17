const {
  buildLocalFileAnalysisAnswer,
  buildStructuredFileContext,
  parseStructuredConversationFile,
  selectRelevantConversationFile,
} = require("./filePipeline");
const { routeConversationIntent } = require("./intentRouter");

async function buildTurnExecutionPlan({
  userText = "",
  recentFiles = [],
  latestArtifactSession = null,
  referenceImages = [],
  uploadsDir = "",
} = {}) {
  const route = routeConversationIntent({
    userText,
    recentFiles,
    latestArtifactSession,
    referenceImages,
  });

  let selectedFile = null;
  let fileProfile = null;

  if (route.should_use_recent_file && Array.isArray(recentFiles) && recentFiles.length) {
    selectedFile = selectRelevantConversationFile(recentFiles, userText);
    if (selectedFile) {
      fileProfile = await parseStructuredConversationFile(selectedFile, { uploadsDir }).catch(() => null);
    }
  }

  return {
    route,
    selectedFile,
    fileProfile,
    fileContext: buildStructuredFileContext(fileProfile, userText),
    localAnalysisReply: buildLocalFileAnalysisAnswer(fileProfile),
  };
}

module.exports = {
  buildTurnExecutionPlan,
};
